/**
 * @module components/ronos/helpers
 * @description Funciones auxiliares de formateo y cálculo de fechas para el módulo RONOS.
 *   - Formateo inteligente de horarios a 12 horas (AM/PM) en zona horaria America/Los_Angeles.
 *   - Formateo oficial de fechas para Estados Unidos: MM/DD/YYYY.
 *   - Algoritmo de agrupación de semanas en ciclos bisemanales alineados con Cingular HR.
 *
 * @businessRules
 *   - Todo horario debe renderizarse en formato legible de 12 horas (ej. 4:50 PM) para evitar confusiones de 24h.
 *   - Zona horaria oficial del negocio: America/Los_Angeles (PST/PDT).
 *   - Ciclos bisemanales anclados en Lunes 10 de Agosto de 2026.
 *
 * @dataFlow
 *   Utilizado por todos los subcomponentes de `components/ronos/`.
 *
 * @notes
 *   - Evita problemas de cambio de horario (daylight saving) parseando componentes de fecha explícitamente en hora del Pacífico.
 */

import { WorkWeekOption, BiWeeklyPeriod, EmployeeTimecard } from './types'

/**
 * Convierte timestamps ISO (ej. 2026-08-24T16:50:46.264-07:00) en hora legible 12h (ej. 4:50 PM)
 */
export function formatTime12h(val?: string | null): string {
  if (!val) return ''
  const trimmed = val.trim()
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(trimmed)) return trimmed.toUpperCase()

  try {
    const d = new Date(val)
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles'
      })
    }
  } catch {}

  const match = val.match(/T(\d{2}):(\d{2})/)
  if (match) {
    let h = parseInt(match[1], 10)
    const m = match[2]
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${m} ${ampm}`
  }

  return val
}

/**
 * Convierte cualquier fecha (YYYY-MM-DD o ISO) a formato estándar oficial de USA: MM/DD/YYYY
 * en la zona horaria del negocio (America/Los_Angeles).
 */
export function formatUsaDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  const trimmed = dateStr.trim()
  const clean = trimmed.substring(0, 10)
  const parts = clean.split('-')
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`
  }
  try {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      }).format(d)
    }
  } catch {}
  return clean
}

/**
 * Convierte un rango de fechas a formato estándar de USA: MM/DD/YYYY - MM/DD/YYYY
 */
export function formatUsaDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return ''
  return `${formatUsaDate(start)} - ${formatUsaDate(end)}`
}

/**
 * Formatea moneda USD con 2 decimales
 */
export function formatCurrency(val?: number | null): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val || 0)
}

/**
 * Retorna la fecha oficial de Los Angeles (YYYY-MM-DD) respetando la zona horaria America/Los_Angeles.
 * Si se especifica adjustBusinessDay=true, antes de las 6:00 AM cuenta como el día laboral anterior.
 */
export function getPacificDateString(date = new Date(), adjustBusinessDay = false): string {
  let target = date
  if (adjustBusinessDay) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hour12: false
    }).formatToParts(date)
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '12', 10)
    if (hour < 6) {
      target = new Date(date.getTime() - 6 * 3600 * 1000)
    }
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(target)
}

/**
 * Agrupa las semanas en periodos bisemanales alineados con el ciclo oficial de Cingular HR.
 * Serie anclada: Lunes 10 de Agosto de 2026 al Domingo 23 de Agosto de 2026.
 */
export function computeCingularBiWeeklyPeriods(weeks: WorkWeekOption[]): BiWeeklyPeriod[] {
  if (!weeks || !Array.isArray(weeks) || weeks.length === 0) return []

  const ANCHOR_DATE = new Date('2026-08-10T00:00:00Z')
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  const cyclesMap = new Map<string, { week1?: WorkWeekOption; week2?: WorkWeekOption }>()

  for (const w of weeks) {
    if (!w?.startDate) continue
    const cleanStart = w.startDate.substring(0, 10)
    const sDate = new Date(cleanStart + 'T12:00:00Z') // Usar mediodía para evitar cualquier desajuste de huso horario
    if (isNaN(sDate.getTime())) continue

    const daysDiff = Math.round((sDate.getTime() - ANCHOR_DATE.getTime()) / MS_PER_DAY)
    const weeksDiff = Math.round(daysDiff / 7)

    let cycleStartDate: Date
    let isWeek1 = false

    if (weeksDiff % 2 === 0) {
      cycleStartDate = sDate
      isWeek1 = true
    } else {
      cycleStartDate = new Date(sDate.getTime() - 7 * MS_PER_DAY)
      isWeek1 = false
    }

    const cycleKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(cycleStartDate)
    if (!cyclesMap.has(cycleKey)) {
      cyclesMap.set(cycleKey, {})
    }

    const cycleObj = cyclesMap.get(cycleKey)!
    if (isWeek1) {
      cycleObj.week1 = w
    } else {
      cycleObj.week2 = w
    }
  }

  const result: BiWeeklyPeriod[] = []

  cyclesMap.forEach((c, cycleKey) => {
    if (c.week1 && c.week2) {
      const minStart = c.week1.startDate < c.week2.startDate ? c.week1.startDate : c.week2.startDate
      const maxEnd = c.week1.endDate > c.week2.endDate ? c.week1.endDate : c.week2.endDate
      result.push({
        id: `${c.week1.weekId},${c.week2.weekId}`,
        weekIds: [c.week1.weekId, c.week2.weekId],
        startDate: minStart,
        endDate: maxEnd,
        label: `${formatUsaDate(minStart)} - ${formatUsaDate(maxEnd)}`
      })
    } else if (c.week1 && !c.week2) {
      const sDate = new Date(c.week1.startDate.substring(0, 10) + 'T00:00:00Z')
      const estEnd = new Date(sDate.getTime() + 13 * MS_PER_DAY).toISOString().substring(0, 10)
      result.push({
        id: `${c.week1.weekId}`,
        weekIds: [c.week1.weekId, c.week1.weekId],
        startDate: c.week1.startDate,
        endDate: estEnd,
        label: `${formatUsaDate(c.week1.startDate)} - ${formatUsaDate(estEnd)} (En curso)`
      })
    } else if (c.week2 && !c.week1) {
      const sDate = new Date(c.week2.startDate.substring(0, 10) + 'T00:00:00Z')
      const estStart = new Date(sDate.getTime() - 7 * MS_PER_DAY).toISOString().substring(0, 10)
      result.push({
        id: `${c.week2.weekId}`,
        weekIds: [c.week2.weekId, c.week2.weekId],
        startDate: estStart,
        endDate: c.week2.endDate,
        label: `${formatUsaDate(estStart)} - ${formatUsaDate(c.week2.endDate)}`
      })
    }
  })

  return result.sort((a, b) => b.startDate.localeCompare(a.startDate))
}

/**
 * Formatea el día de la semana y la fecha para encabezados limpios
 */
export function formatDayDetails(dateStr?: string, dayName?: string): { dayOfWeek: string; dateFormatted: string } {
  let dayOfWeek = dayName || ''
  let dateFormatted = formatUsaDate(dateStr)

  if (dateStr) {
    try {
      const clean = dateStr.substring(0, 10)
      const d = new Date(clean + 'T12:00:00Z')
      if (!isNaN(d.getTime()) && !dayOfWeek) {
        const rawDay = new Intl.DateTimeFormat('es-US', {
          timeZone: 'America/Los_Angeles',
          weekday: 'long'
        }).format(d)
        dayOfWeek = rawDay.charAt(0).toUpperCase() + rawDay.slice(1)
      }
    } catch {}
  }

  return { dayOfWeek, dateFormatted }
}

/**
 * Retorna la fecha oficial del día laboral en Los Ángeles (YYYY-MM-DD).
 * Regla de negocio:
 *   - De 06:00:00 AM a 23:59:59 PM: día civil actual.
 *   - De 00:00:00 AM a 05:59:59 AM: día civil anterior.
 */
export function getPacificBusinessDate(date: Date | string | number = new Date()): string {
  const d = typeof date === 'object' && date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d)

  const getPart = (type: string) => parts.find(p => p.type === type)?.value || ''
  const year = parseInt(getPart('year'), 10)
  const month = parseInt(getPart('month'), 10) - 1
  const day = parseInt(getPart('day'), 10)
  const hour = parseInt(getPart('hour'), 10)

  const calDate = new Date(Date.UTC(year, month, day))
  if (hour < 6) {
    calDate.setUTCDate(calDate.getUTCDate() - 1)
  }
  return calDate.toISOString().substring(0, 10)
}

/**
 * Umbrales operativos de alerta para detección temprana de posibles olvidos de ponchada.
 * NOTA: Son parámetros internos de supervisión operativa de restaurante, NO normativas laborales oficiales.
 */
export const RONOS_OPERATIONAL_THRESHOLDS = {
  /** Minutos máximos sugeridos en descanso de comida sin retorno antes de alertar posible olvido (default: 120 min) */
  MAX_MEAL_MINUTES_WITHOUT_RETURN: 120,
  /** Horas máximas continuas de turno sin salida antes de alertar posible olvido de ponchada (default: 14 horas) */
  MAX_SHIFT_HOURS_WITHOUT_OUT: 14,
} as const

export interface TodayAnomaly {
  emp: EmployeeTimecard
  issue: string
  reason: 'out_without_in' | 'lunch_without_return' | 'shift_over_14h'
  time?: string
}

export interface HistoricalBrokenItem {
  emp: EmployeeTimecard
  brokenDaysCount: number
  dates: string[]
}

export interface PendingWeeklyFlagItem {
  emp: EmployeeTimecard
  reason: 'weekly_flag_unspecified_date'
  note: string
}

/**
 * Calcula la fecha calendario anterior en formato YYYY-MM-DD
 */
function getPreviousDateString(dateStr: string): string {
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return ''
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().substring(0, 10)
}

/**
 * Separa de forma estricta las anomalías verificables ocurridas HOY en la jornada laboral vigente
 * de las tarjetas incompletas históricas de fechas anteriores del período.
 *
 * Reglas clave:
 * 1. Descarta eventos futuros respecto a asOfTimeMs.
 * 2. Valida contexto nocturno: una salida matutina posterior a las 6 AM no es huérfana si cierra un turno del día anterior.
 * 3. La antigüedad del turno continuo se mide desde el primer IN del turno, sin reiniciar por regreso de comida.
 * 4. Reconoce violaciones en mayúsculas y minúsculas (BROKEN_TIMECARD, broken_timecard, missing_punch).
 * 5. Una bandera semanal sola no inventa días históricos si no hay fechas demostradas.
 */
export function detectTodayAnomalies(
  employees: EmployeeTimecard[] | undefined | null,
  currentBusinessDate?: string,
  asOfTimeMs: number = Date.now()
): {
  openToday: TodayAnomaly[]
  historicalBroken: HistoricalBrokenItem[]
  pendingWeeklyReview: PendingWeeklyFlagItem[]
} {
  if (!employees || !Array.isArray(employees)) {
    return { openToday: [], historicalBroken: [], pendingWeeklyReview: [] }
  }

  const workDate = currentBusinessDate || getPacificBusinessDate(asOfTimeMs)
  const previousWorkDate = workDate ? getPreviousDateString(workDate) : ''
  const openToday: TodayAnomaly[] = []
  const historicalBroken: HistoricalBrokenItem[] = []
  const pendingWeeklyReview: PendingWeeklyFlagItem[] = []

  for (const emp of employees) {
    if (!emp) continue
    const days = emp.days || []
    const historicalDates: string[] = []
    let hasTodayAnomaly = false

    for (const d of days) {
      const dDate = d?.date?.substring(0, 10) || ''
      if (!dDate) continue

      if (dDate === workDate) {
        // Evaluar anomalías de HOY exclusivamente: descartar punches futuros respecto a asOfTimeMs
        const rawPunches = d.punches || []
        const validPunches = rawPunches.filter(p => {
          if (!p || typeof p !== 'object') return false  // Fix: descartar ponchadas null/malformadas
          const raw = p.timestampIso || p.punchTime
          if (raw == null || raw === '') return false     // Fix: descartar timestamps vacíos/null
          const pMs = new Date(raw).getTime()
          return !isNaN(pMs) && pMs > 86400000 && pMs <= asOfTimeMs  // Fix: epoch sanity check (>1971)
        })

        if (validPunches.length > 0) {
          const sorted = [...validPunches].sort((a, b) => {
            const tA = new Date(a.timestampIso || a.punchTime).getTime()
            const tB = new Date(b.timestampIso || b.punchTime).getTime()
            return tA - tB
          })

          // 1. Salida sin entrada (primer punch válido es OUT tipo 2)
          const firstPunch = sorted[0]
          if (Number(firstPunch?.punchType) === 2) {
            // Verificar contexto nocturno: ¿cerró un turno que empezó el día laboral anterior?
            let isLegitNightShiftExit = false
            if (previousWorkDate) {
              const prevDay = days.find(day => day?.date?.substring(0, 10) === previousWorkDate)
              const prevValidPunches = (prevDay?.punches || []).filter(p => {
                if (!p || typeof p !== 'object') return false
                const raw = p.timestampIso || p.punchTime
                if (raw == null || raw === '') return false
                const pMs = new Date(raw).getTime()
                return !isNaN(pMs) && pMs > 86400000 && pMs <= asOfTimeMs
              })
              if (prevValidPunches.length > 0) {
                const prevSorted = [...prevValidPunches].sort((a, b) => {
                  return new Date(a.timestampIso || a.punchTime).getTime() - new Date(b.timestampIso || b.punchTime).getTime()
                })
                const prevLast = prevSorted[prevSorted.length - 1]
                if (Number(prevLast?.punchType) === 1) {
                  isLegitNightShiftExit = true
                }
              }
            }

            if (!isLegitNightShiftExit) {
              openToday.push({
                emp,
                issue: 'Salida registrada sin entrada previa',
                reason: 'out_without_in',
                time: firstPunch.punchTime
              })
              hasTodayAnomaly = true
              continue
            }
          }

          const lastPunch = sorted[sorted.length - 1]
          const lastType = Number(lastPunch?.punchType)

          // 2. Comida prolongada (> 120 min sin regreso)
          if (lastType === 3) {
            const punchMs = new Date(lastPunch.timestampIso || lastPunch.punchTime).getTime()
            if (!isNaN(punchMs)) {
              const elapsedMin = Math.round((asOfTimeMs - punchMs) / 60000)
              if (elapsedMin > RONOS_OPERATIONAL_THRESHOLDS.MAX_MEAL_MINUTES_WITHOUT_RETURN) {
                openToday.push({
                  emp,
                  issue: `Descanso de comida prolongado (>2h: ${elapsedMin} min)`,
                  reason: 'lunch_without_return',
                  time: lastPunch.punchTime
                })
                hasTodayAnomaly = true
                continue
              }
            }
          }

          // 3. Turno continuo prolongado (>14 horas sin salida)
          // Regla compartida de sesiones: Tipo 1 tras tipo 3 es regreso de comida y NO reinicia el turno.
          // Un OUT (tipo 2) cierra la sesión. Una nueva entrada posterior abre otra sesión.
          if (lastType === 1 || lastType === 4) {
            let currentShiftStartMs = 0
            let onMeal = false
            for (const sp of sorted) {
              const spType = Number(sp.punchType)
              const spMs = new Date(sp.timestampIso || sp.punchTime).getTime()
              if (isNaN(spMs) || spMs <= 86400000) continue

              if (spType === 1) {
                if (onMeal) {
                  // Regreso de comida: se preserva el inicio original del turno
                  onMeal = false
                } else if (currentShiftStartMs === 0) {
                  // Nueva sesión / inicio de turno
                  currentShiftStartMs = spMs
                }
              } else if (spType === 3) {
                // Salida a descanso de comida (la sesión continúa abierta)
                onMeal = true
              } else if (spType === 4) {
                // Regreso formal de comida
                onMeal = false
              } else if (spType === 2) {
                // Salida formal: cierra la sesión
                currentShiftStartMs = 0
                onMeal = false
              }
            }

            if (currentShiftStartMs > 0 && !isNaN(currentShiftStartMs)) {
              const elapsedHours = (asOfTimeMs - currentShiftStartMs) / 3600000
              if (elapsedHours > RONOS_OPERATIONAL_THRESHOLDS.MAX_SHIFT_HOURS_WITHOUT_OUT) {
                const sessionStartPunch = sorted.find(sp => 
                  new Date(sp.timestampIso || sp.punchTime).getTime() === currentShiftStartMs
                )
                openToday.push({
                  emp,
                  issue: `Turno continuo prolongado (>14h: ${elapsedHours.toFixed(1)}h)`,
                  reason: 'shift_over_14h',
                  time: sessionStartPunch?.punchTime || lastPunch.punchTime
                })
                hasTodayAnomaly = true
                continue
              }
            }
          }
        }
      } else if (dDate < workDate) {
        // Fechas anteriores dentro del período semanal
        // Reconocer mayúsculas y minúsculas (BROKEN_TIMECARD, broken_timecard, missing_punch)
        const hasBrokenViolation = (d.violations || []).some(v => {
          const vType = String(v?.type || '').trim().toLowerCase()
          return vType === 'missing_punch' || vType === 'broken_timecard'
        })
        let isIncompleteDay = (Boolean(d.clockInTime) && !d.clockOutTime) || (!d.clockInTime && Boolean(d.clockOutTime))

        // Correlación nocturna cross-day precisa:
        // Si un día tiene clockInTime sin clockOutTime (aparenta incompleto),
        // verificar si el día SIGUIENTE tiene una ponchada OUT que cierra el turno nocturno.
        // REGLAS ESTRICTAS:
        // 1. Excluir ponchadas futuras relativas a asOfTimeMs.
        // 2. La primera ponchada del día siguiente DEBE ser OUT (tipo 2) que cierra el turno.
        // 3. Un OUT que pertenece a una nueva sesión (precedido por un IN de hoy) NO cierra la entrada previa.
        if (isIncompleteDay && Boolean(d.clockInTime) && !d.clockOutTime) {
          const dParts = dDate.split('-').map(Number)
          if (dParts.length === 3 && dParts.every(n => !isNaN(n))) {
            const nextD = new Date(Date.UTC(dParts[0], dParts[1] - 1, dParts[2]))
            nextD.setUTCDate(nextD.getUTCDate() + 1)
            const nextDateStr = nextD.toISOString().substring(0, 10)
            const nextDay = days.find(day => day?.date?.substring(0, 10) === nextDateStr)
            if (nextDay) {
              const nextValidPunches = (nextDay.punches || []).filter(p => {
                if (!p || typeof p !== 'object') return false
                const raw = p.timestampIso || p.punchTime
                if (raw == null || raw === '') return false
                const pMs = new Date(raw).getTime()
                return !isNaN(pMs) && pMs > 86400000 && pMs <= asOfTimeMs
              }).sort((a, b) => {
                const tA = new Date(a.timestampIso || a.punchTime).getTime()
                const tB = new Date(b.timestampIso || b.punchTime).getTime()
                return tA - tB
              })

              if (nextValidPunches.length > 0) {
                const firstNextPunch = nextValidPunches[0]
                if (Number(firstNextPunch.punchType) === 2) {
                  isIncompleteDay = false // Cierre legítimo de turno nocturno
                }
              }
            }
          }
        }

        if (hasBrokenViolation || isIncompleteDay) {
          historicalDates.push(dDate)
        }
      }
    }

    // Si tiene fechas históricas con evidencia demostrada
    if (historicalDates.length > 0) {
      historicalBroken.push({
        emp,
        brokenDaysCount: historicalDates.length,
        dates: historicalDates
      })
    }
    // Fix Bug D: Evaluación independiente (no else-if) para que ambas alertas coexistan.
    // Un empleado puede tener tanto historicalBroken como pendingWeeklyReview simultáneamente.
    if (emp.brokenHours && historicalDates.length === 0 && !hasTodayAnomaly) {
      // Bandera semanal sola sin fechas demostradas: categoría específica sin inventar días
      pendingWeeklyReview.push({
        emp,
        reason: 'weekly_flag_unspecified_date',
        note: 'Bandera semanal de horas rotas sin detalle diario específico'
      })
    }
  }

  return { openToday, historicalBroken, pendingWeeklyReview }
}


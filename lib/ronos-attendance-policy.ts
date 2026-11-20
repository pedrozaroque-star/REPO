/**
 * @module lib/ronos-attendance-policy
 * @description Motor centralizado de políticas de asistencia, puntualidad (±3 min), descansos de comida (30 min / 5ta hora),
 * detección inteligente de entradas tempranas por emergencia/cobertura gerencial, validación cruzada Toast POS vs RONOS
 * (reparación de ponchadas para protección del cheque de pago) y plantillas HTML oficiales de notificación
 * basadas en el Manual del Empleado de Cingular HR / Tacos Gavilan (`NHP TEG SPANISH.pdf`).
 *
 * @businessRules
 * 1. Exclusión de Salariados (Managers y Supervisores):
 *    - Nunca se envían alertas disciplinarias a Gerentes de Tienda, Supervisores de Zona o Directores asalariados
 *      (`isEmployeeSalaried`, `isSalaried`, `is_salaried`, `payType: 'Yearly' | 'Salary'`, roles `manager`/`supervisor`/`admin`).
 * 2. Política de Asistencia y Puntualidad (`NHP TEG SPANISH.pdf` p. 3 y p. 10) vs Horario Publicado del Planificador (`shifts`):
 *    - Margen estricto de ±3 minutos respecto a la hora programada de inicio del turno:
 *      * <= -4 min (ej. 8:56 AM para turno de 9:00 AM): `UNAUTHORIZED_EARLY_IN` ("Entrada Temprana No Autorizada").
 *      * -3 min a +3 min (ej. 8:57 AM a 9:03 AM para turno de 9:00 AM): `ON_TIME` ("A tiempo").
 *      * >= +4 min (ej. 9:04 AM para turno de 9:00 AM): `LATE_CLOCK_IN` ("Tardanza").
 *    - Exención Inteligente por Emergencia / Solicitud del Manager (`AUTHORIZED_EARLY_CALL_IN`):
 *      * Si un manager llama a un empleado a entrar temprano por emergencia, rush o para cubrir a un compañero,
 *        el sistema lo detecta mediante:
 *        a) `addedPunch === true` en la ponchada de entrada de RONOS (aprobada/agregada manualmente por gerencia), O
 *        b) Nota del turno en el Planificador (`notes` / `is_callback`) indicando cobertura/emergencia/autorización, O
 *        c) Entrada >= 15 minutos antes del turno programado Y al menos una señal operativa confirmada:
 *           (1) También ponchó entrada temprana activa en Toast POS (`clock_in` dentro de ±15 min de RONOS), O
 *           (2) Brecha de cobertura en la tienda ese mismo día (otro empleado con `NO_SHOW`, enfermo/vacaciones o tardanza >= 10 min), O
 *           (3) Entrada en bloque oficial de turno (`:00` o `:30`, al menos 30 minutos antes del turno, ej. llamado a las 8:00 AM o 8:30 AM para turno de 9:00 AM).
 *      * Cuando se clasifica como `AUTHORIZED_EARLY_CALL_IN`, se marca `isViolation = false` y
 *        `exemptionReason = 'Entrada temprana por cobertura/solicitud gerencial'`, evitando falsas alertas al empleado.
 *    - Salida Temprana (`EARLY_CLOCK_OUT`): Salida >= 15 minutos antes del fin del turno programado sin autorización.
 *    - Validación Cruzada Toast POS vs RONOS (`REPAIR_RONOS_PUNCH` vs `NO_SHOW`):
 *      * Si el colaborador TIENE ponchadas en Toast POS en esa fecha pero le falta Entrada, Comida o Salida en RONOS
 *        (o tiene 0 ponchadas en RONOS habiendo trabajado en Toast POS), se clasifica como `REPAIR_RONOS_PUNCH`
 *        mostrando las horas de Toast POS vs RONOS para que reparen su tarjeta en RONOS de inmediato (protegiendo su cheque de pago).
 *      * Si tenía turno publicado en el Planificador, sin ausencia aprobada (Sick/Vacation) y 0 ponchadas tanto en RONOS
 *        como en Toast POS, se clasifica como `NO_SHOW` ("Inasistencia a Turno Programado sin Autorización").
 *      * 3 o más turnos consecutivos ausentes por enfermedad activan `MEDICAL_NOTE_REQUIRED` ("3 o más turnos consecutivos por enfermedad requieren justificante médico").
 * 3. Política de Comida y Descanso en RONOS (`NHP TEG SPANISH.pdf` p. 4 y p. 10 / California Labor Code § 512):
 *    - `LONG_LUNCH`: Duración de comida >= 31 minutos cumplidos (tiempo oficial autorizado: 30 minutos exactos;
 *      PROHIBIDO mencionar cualquier margen de tolerancia en correos o interfaz).
 *    - `MEAL_PENALTY_SHORT`: Duración de comida < 30.0 minutos ininterrumpidos.
 *    - `MEAL_PENALTY_LATE`: Primer almuerzo iniciado después de > 5.0 horas de trabajo continuo (Violación de 5ta Hora).
 *    - `MEAL_PENALTY_MISSED`: Turno > 6.0 horas sin registrar comida (`LUNCH`) en RONOS (si registró comida en Toast POS,
 *      se muestran las horas de Toast POS para que reparen RONOS).
 *    - `BROKEN_TIMECARD`: Falta ponchada de entrada, regreso de comida o salida en RONOS (mostrando referencia de Toast POS).
 *
 * @dataFlow
 *   `shifts` (Planificador) + `punches` (Toast POS) + `RonosEmployeeTimecard` (RONOS API)
 *   -> `evaluateEmployeeDayAttendancePolicy` -> `/api/ronos/punches`, `/api/ronos/notify-violation`,
 *      `/api/cron/sync-ronos-violations` y `components/ronos/StoreAttendanceTab.tsx`.
 *
 * @notes
 *   - Todas las comparaciones de horario utilizan el huso horario oficial `America/Los_Angeles` y respetan el día
 *     de negocio de Tacos Gavilan (06:00 AM a 05:59 AM del día siguiente).
 *   - Cruce Toast POS vs RONOS sin falsos positivos: solo reporta discrepancia de entrada cuando falta Clock-In en RONOS
 *     o Toast fichó >= 15m ANTES que RONOS; en salida, ignora auto-clockout nocturno de Toast (5:50 AM–6:05 AM) cuando
 *     RONOS ya cerró antes, y exige >= 15m después en Toast POS para alertar.
 *   - Detección automática de errores AM/PM (±12h) en el Planificador para evitar falsas tardanzas/salidas tempranas.
 *   - HTML compacto (< 85 KB en reporte general de 15 tiendas) y `simulationTag` para evitar recorte y agrupación en Gmail.
 */

import { isEmployeeSalaried } from './payroll-classification'
import {
  AUTHORIZED_LUNCH_MINUTES,
  INTERNAL_LUNCH_MIN_VIOLATION_MINUTES,
  escapeHtmlSafe,
  formatBusinessDateEs,
  formatTimeLA,
  validateEmployeeViolationEmail,
  type RecipientEmailValidation,
} from './break-violations-policy'

export {
  AUTHORIZED_LUNCH_MINUTES,
  INTERNAL_LUNCH_MIN_VIOLATION_MINUTES,
  escapeHtmlSafe,
  formatBusinessDateEs,
  formatTimeLA,
  validateEmployeeViolationEmail,
  type RecipientEmailValidation,
}

// ============================================================================
// CONSTANTES OFICIALES DE POLÍTICA (NHP TEG SPANISH.pdf)
// ============================================================================

export const LA_TIMEZONE = 'America/Los_Angeles'

/** Margen estricto de puntualidad del manual NHP TEG SPANISH.pdf (p. 3 y p. 10): ±3 minutos */
export const NHP_PUNCTUALITY_GRACE_MINUTES = 3

/** A partir de 4 minutos antes (diffMinutes <= -4, ej. 8:56 AM para turno 9:00 AM) es Entrada Temprana */
export const NHP_EARLY_IN_THRESHOLD_MINUTES = -4

/** A partir de 4 minutos después (diffMinutes >= +4, ej. 9:04 AM para turno 9:00 AM) es Tardanza */
export const NHP_LATE_IN_THRESHOLD_MINUTES = 4

/** Umbral mínimo de entrada temprana (>= 15 min antes) para evaluar llamado/cobertura gerencial */
export const NHP_EMERGENCY_CALL_IN_MIN_EARLY_MINUTES = 15

/** Umbral de bloque de turno oficial (:00 o :30, al menos 30 min antes) para llamado gerencial */
export const NHP_SHIFT_BLOCK_CALL_IN_MIN_EARLY_MINUTES = 30

/** Umbral de salida temprana (>= 15 min antes del fin del turno programado) */
export const NHP_EARLY_OUT_THRESHOLD_MINUTES = -15

/** Discrepancia máxima en minutos entre Toast POS y RONOS antes de requerir reparación */
export const TOAST_RONOS_DISCREPANCY_THRESHOLD_MINUTES = 15

/** Turnos consecutivos por enfermedad que requieren justificante médico (NHP p. 3) */
export const NHP_CONSECUTIVE_SICK_DAYS_MEDICAL_NOTE = 3

/** Texto oficial de exención cuando se detecta entrada temprana por cobertura/emergencia */
export const AUTHORIZED_EARLY_CALL_IN_EXEMPTION_REASON =
  'Entrada temprana por cobertura/solicitud gerencial'

/** Destinatarios oficiales en copia (CC) del Reporte General Diario de Cadena (Cingular HR + Operaciones) */
export const RONOS_GENERAL_REPORT_CC: string[] = [
  'Stephany@cingularhr.com',
  'raquel@tacosgavilan.com',
]

/** Liderazgo ejecutivo destinatario principal del Reporte General Diario de Cadena (junto con supervisores activos de zona) */
export const RONOS_GENERAL_REPORT_LEADERSHIP: string[] = [
  'roberto@tacosgavilan.com',
]

// ============================================================================
// TIPOS E INTERFACES EXPORTADAS
// ============================================================================

export type RonosNhpViolationType =
  | 'UNAUTHORIZED_EARLY_IN'
  | 'LATE_CLOCK_IN'
  | 'EARLY_CLOCK_OUT'
  | 'NO_SHOW'
  | 'MEDICAL_NOTE_REQUIRED'
  | 'REPAIR_RONOS_PUNCH'
  | 'BROKEN_TIMECARD'
  | 'LONG_LUNCH'
  | 'MEAL_PENALTY_SHORT'
  | 'MEAL_PENALTY_LATE'
  | 'MEAL_PENALTY_MISSED'
  | 'EXCESSIVE_OVERTIME'

export type RonosPunctualityStatus =
  | 'ON_TIME'
  | 'UNAUTHORIZED_EARLY_IN'
  | 'AUTHORIZED_EARLY_CALL_IN'
  | 'LATE_CLOCK_IN'
  | 'NO_SHOW'
  | 'REPAIR_RONOS_PUNCH'
  | 'EXEMPT_SALARIED'
  | 'REST_OR_PTO'
  | 'UNSCHEDULED_WORKED'
  | 'NO_SHIFT_NO_PUNCH'

export interface PlannerScheduledShiftInput {
  id?: string | null
  employee_id?: string | null
  store_id?: string | null
  shift_date?: string | null // 'YYYY-MM-DD'
  start_time?: string | null // ISO UTC o 'HH:mm'
  end_time?: string | null   // ISO UTC o 'HH:mm'
  status?: string | null     // 'published' | 'draft'
  notes?: string | null
  is_callback?: boolean | null
  job_title?: string | null
}

export interface ToastPunchBreakInput {
  guid?: string | null
  paid?: boolean | null // false = Meal Lunch 30m, true = Rest Break 10m
  inDate?: string | null
  outDate?: string | null
  missed?: boolean | null
  waived?: boolean | null
}

export interface ToastPunchRecordInput {
  toast_id?: string | null
  store_id?: string | null
  employee_toast_guid?: string | null
  business_date?: string | null
  clock_in?: string | null
  in_date?: string | null // Alias soportado para pruebas/llamadores
  clockInTime?: string | null // Alias adicional
  clock_out?: string | null
  out_date?: string | null // Alias soportado
  clockOutTime?: string | null // Alias adicional
  regular_hours?: number | null
  overtime_hours?: number | null
  hourly_wage?: number | null
  breaks?: ToastPunchBreakInput[] | null
}

export interface RonosAtomicPunchInput {
  punchId?: number | string
  punchType: number // 1=IN/LUNCH_END, 2=OUT, 3=LUNCH_START
  punchTypeName?: string
  timestampIso?: string
  punchTime?: string
  localTime?: string
  localTimeWithoutOffset?: string
  photoURL?: string
  photoUrl?: string | null
  addedPunch?: boolean
  offline?: boolean
}

export interface RonosMealBreakInput {
  index?: number
  startTime?: string
  endTime?: string
  durationMinutes: number
  hoursWorkedBeforeMeal: number
}

export interface RonosDayInput {
  date?: string
  dayName?: string
  totalHours?: number
  regularHours?: number
  overtimeHours?: number
  doubleTimeHours?: number
  lunchHours?: number
  lunchDurationMinutes?: number
  vacationHours?: number
  sickHours?: number
  holidayHours?: number
  isVacation?: boolean
  isSick?: boolean
  isHoliday?: boolean
  clockInTime?: string | null
  lunchStartTime?: string | null
  lunchEndTime?: string | null
  clockOutTime?: string | null
  clockInAddedPunch?: boolean
  clockOutAddedPunch?: boolean
  mealBreaks?: RonosMealBreakInput[]
  punches?: RonosAtomicPunchInput[]
  violations?: Array<{
    type: string
    severity?: string
    title: string
    description: string
    estimatedCostUsd?: number
    minutes?: number
  }>
}

export interface StoreDayCoverageContext {
  hasStoreCoverageGap?: boolean
  absentOrLateCoworkersCount?: number
  coworkerDetails?: string[]
}

export interface RonosPolicyViolationItem {
  type: RonosNhpViolationType
  category: 'punctuality' | 'attendance' | 'meal_rest' | 'timecard_repair'
  severity: 'danger' | 'warning' | 'info'
  uiSeverity: 'critical' | 'warning' | 'info'
  isViolation: boolean
  title: string
  description: string
  policyReference: string
  actionRequired: string
  estimatedCostUsd: number
  minutes?: number
  diffMinutes?: number
  exemptionReason?: string | null
}

export interface PlannerShiftSummary {
  hasPublishedShift: boolean
  shiftId?: string | null
  shiftDate: string
  startTimeIso?: string | null
  endTimeIso?: string | null
  startTimeLA?: string | null
  endTimeLA?: string | null
  startTime24?: string | null
  endTime24?: string | null
  scheduledDurationHours?: number | null
  notes?: string | null
  isCallback?: boolean
}

export interface ToastPunchSummary {
  hasToastPunches: boolean
  clockInTime?: string | null
  clockOutTime?: string | null
  clockInLA?: string | null
  clockOutLA?: string | null
  lunchStartTime?: string | null
  lunchEndTime?: string | null
  lunchStartLA?: string | null
  lunchEndLA?: string | null
  lunchDurationMinutes?: number | null
  restBreaksCount: number
  totalHoursToast: number
  rawPunchesCount: number
}

export interface RonosDayAttendanceEvaluation {
  businessDate: string
  isExemptSalaried: boolean
  salariedExemptionReason: string | null
  punctualityStatus: RonosPunctualityStatus
  punctualityLabelEs: string
  punctualityLabelEn: string
  punctualityBadgeColor: 'emerald' | 'rose' | 'amber' | 'sky' | 'purple' | 'slate'
  diffMinutesFromSchedule: number | null
  endDiffMinutesFromSchedule: number | null
  isViolation: boolean
  isAuthorizedEarlyCallIn: boolean
  exemptionReason: string | null
  earlyCallInSignals: string[]
  hasToastRonosDiscrepancy: boolean
  discrepancyDetails: string[]
  requiresMedicalNote: boolean
  consecutiveSickDays: number
  scheduledShift: PlannerShiftSummary
  toastSummary: ToastPunchSummary
  ronosSummary: {
    hasRonosPunches: boolean
    clockInTime?: string | null
    clockOutTime?: string | null
    clockInLA?: string | null
    clockOutLA?: string | null
    lunchStartTime?: string | null
    lunchEndTime?: string | null
    lunchStartLA?: string | null
    lunchEndLA?: string | null
    lunchDurationMinutes: number
    totalHours: number
    clockInAddedPunch: boolean
    clockOutAddedPunch: boolean
    isSick: boolean
    isVacation: boolean
    isHoliday: boolean
  }
  violations: RonosPolicyViolationItem[]
}

// ============================================================================
// UTILIDADES DE TIEMPO Y ZONA HORARIA (America/Los_Angeles)
// ============================================================================

function safeNum(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Normaliza un timestamp de RONOS o ISO asegurando su zona horaria correcta.
 */
export function normalizeTimestampIso(raw?: string | Date | null): string {
  if (!raw) return ''
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : raw.toISOString()
  }
  const str = String(raw).trim()
  if (!str) return ''
  return str
}

/**
 * Convierte una cadena de fecha `'YYYY-MM-DD'` a su índice entero de días UTC (`Math.floor(utcMs / 86400000)`).
 */
function dateStrToUtcDayIndex(dateStr: string): number | null {
  const clean = String(dateStr || '').trim().slice(0, 10)
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const y = parseInt(match[1], 10)
  const m = parseInt(match[2], 10) - 1
  const d = parseInt(match[3], 10)
  const ms = Date.UTC(y, m, d)
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null
}

/**
 * Extrae la fecha local (`YYYY-MM-DD`), hora (`0-23`), minuto (`0-59`) y segundo (`0-59`)
 * en `America/Los_Angeles` a partir de un ISO timestamp, `Date` o cadena de hora (`"09:00"`, `"8:56 AM"`).
 */
export function parseTimeInLA(
  timeInput: string | Date | null | undefined,
  referenceBusinessDate?: string
): {
  dateStr: string
  hour: number
  minute: number
  second: number
  minuteOfDay: number
  relativeMinutesFromBizDate: number
  epochMs: number | null
  display12h: string
  display24h: string
} | null {
  if (!timeInput) return null

  const refDate = (referenceBusinessDate || '').trim().slice(0, 10) || '2026-01-01'
  const refDayIdx = dateStrToUtcDayIndex(refDate) ?? 0

  const formatDisplay = (h: number, m: number): { display12h: string; display24h: string } => {
    const safeH = ((h % 24) + 24) % 24
    const safeM = Math.max(0, Math.min(59, m))
    const display24h = `${String(safeH).padStart(2, '0')}:${String(safeM).padStart(2, '0')}`
    const period = safeH >= 12 ? 'PM' : 'AM'
    const h12 = safeH % 12 === 0 ? 12 : safeH % 12
    const display12h = `${h12}:${String(safeM).padStart(2, '0')} ${period}`
    return { display12h, display24h }
  }

  if (typeof timeInput === 'string') {
    const trimmed = timeInput.trim()
    if (!trimmed) return null

    // 1. Formato hora de 12 horas: "8:56 AM", "09:04 PM", "9:00:30 am"
    const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/)
    if (amPmMatch) {
      let hour = parseInt(amPmMatch[1], 10)
      const minute = parseInt(amPmMatch[2], 10)
      const second = amPmMatch[3] ? parseInt(amPmMatch[3], 10) : 0
      const isPm = amPmMatch[4].toUpperCase() === 'PM'
      if (hour === 12) {
        hour = isPm ? 12 : 0
      } else if (isPm) {
        hour += 12
      }
      const minuteOfDay = hour * 60 + minute
      const { display12h, display24h } = formatDisplay(hour, minute)
      return {
        dateStr: refDate,
        hour,
        minute,
        second,
        minuteOfDay,
        relativeMinutesFromBizDate: minuteOfDay,
        epochMs: null,
        display12h,
        display24h,
      }
    }

    // 2. Formato hora de 24 horas: "09:00", "08:56:15", "17:30"
    const h24Match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    if (h24Match) {
      const hour = parseInt(h24Match[1], 10)
      const minute = parseInt(h24Match[2], 10)
      const second = h24Match[3] ? parseInt(h24Match[3], 10) : 0
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const minuteOfDay = hour * 60 + minute
        const { display12h, display24h } = formatDisplay(hour, minute)
        return {
          dateStr: refDate,
          hour,
          minute,
          second,
          minuteOfDay,
          relativeMinutesFromBizDate: minuteOfDay,
          epochMs: null,
          display12h,
          display24h,
        }
      }
    }

    // 3. Formato ISO local sin zona horaria explícita: "2026-11-19T08:56:00" o "2026-11-19 08:56:00"
    const localIsoMatch = trimmed.match(
      /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
    )
    if (localIsoMatch) {
      const dateStr = localIsoMatch[1]
      const hour = parseInt(localIsoMatch[2], 10)
      const minute = parseInt(localIsoMatch[3], 10)
      const second = localIsoMatch[4] ? parseInt(localIsoMatch[4], 10) : 0
      const itemDayIdx = dateStrToUtcDayIndex(dateStr) ?? refDayIdx
      const dayOffset = itemDayIdx - refDayIdx
      const minuteOfDay = hour * 60 + minute
      const { display12h, display24h } = formatDisplay(hour, minute)
      return {
        dateStr,
        hour,
        minute,
        second,
        minuteOfDay,
        relativeMinutesFromBizDate: dayOffset * 1440 + minuteOfDay,
        epochMs: null,
        display12h,
        display24h,
      }
    }
  }

  // 4. Timestamp ISO con zona horaria ('Z', '+00:00', '-08:00', '-07:00') o instancia Date
  const d = timeInput instanceof Date ? timeInput : new Date(timeInput)
  if (Number.isNaN(d.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')
  const rawHour = parseInt(getPart('hour'), 10)
  const hour = rawHour === 24 ? 0 : rawHour
  const minute = parseInt(getPart('minute'), 10)
  const second = parseInt(getPart('second'), 10)

  const dateStr = `${year}-${month}-${day}`
  const itemDayIdx = dateStrToUtcDayIndex(dateStr) ?? refDayIdx
  const dayOffset = itemDayIdx - refDayIdx
  const minuteOfDay = hour * 60 + minute
  const { display12h, display24h } = formatDisplay(hour, minute)

  return {
    dateStr,
    hour,
    minute,
    second,
    minuteOfDay,
    relativeMinutesFromBizDate: dayOffset * 1440 + minuteOfDay,
    epochMs: d.getTime(),
    display12h,
    display24h,
  }
}

/**
 * Formatea cualquier entrada de hora/ISO a formato legible de 12 horas en California (ej. "8:56 AM").
 */
export function formatTimeDisplayLA(
  timeInput?: string | Date | null,
  referenceBusinessDate?: string
): string {
  const parsed = parseTimeInLA(timeInput, referenceBusinessDate)
  return parsed ? parsed.display12h : '--:--'
}

/**
 * Desplaza una hora/timestamp programado ±12 horas en reloj local de California (usado cuando el Planificador
 * tiene capturado AM en lugar de PM o viceversa, preservando la fecha de negocio y cruces de medianoche).
 */
function shiftTimeBy12Hours(
  rawTime: string,
  businessDate: string,
  direction: 1 | -1
): string {
  const parsed = parseTimeInLA(rawTime, businessDate)
  if (!parsed) return rawTime

  const adjustedRel = parsed.relativeMinutesFromBizDate + direction * 720
  const dayDelta = Math.floor(adjustedRel / 1440)
  const modMin = ((adjustedRel % 1440) + 1440) % 1440
  const hh = String(Math.floor(modMin / 60)).padStart(2, '0')
  const mm = String(modMin % 60).padStart(2, '0')

  const baseIdx = dateStrToUtcDayIndex(businessDate)
  let targetDate = businessDate
  if (baseIdx !== null && dayDelta !== 0) {
    targetDate = new Date((baseIdx + dayDelta) * 86_400_000).toISOString().slice(0, 10)
  }

  return `${targetDate}T${hh}:${mm}:00`
}

// ============================================================================
// 1. EXCLUSIÓN DE SALARIADOS (MANAGERS, SUPERVISORES Y DIRECTORES)
// ============================================================================

export interface SalariedCheckInput {
  jobTitle?: string | null
  fullName?: string | null
  payRate?: number | null
  isSalaried?: boolean | null
  is_salaried?: boolean | null
  payType?: string | null
  role?: string | null
}

/**
 * Determina si un colaborador es exento/asalariado (Manager, Supervisor de Zona, Director)
 * y por lo tanto NO debe recibir alertas disciplinarias de reloj checador por hora.
 */
export function evaluateSalariedExemption(params: SalariedCheckInput): {
  isExempt: boolean
  reason: string | null
} {
  if (!params) return { isExempt: false, reason: null }

  if (params.isSalaried === true || params.is_salaried === true) {
    return {
      isExempt: true,
      reason: 'Exento (Manager / Supervisor Asalariado)',
    }
  }

  const payTypeNorm = String(params.payType || '')
    .toLowerCase()
    .trim()
  if (
    payTypeNorm === 'yearly' ||
    payTypeNorm === 'salary' ||
    payTypeNorm === 'salaried' ||
    payTypeNorm === 'anual'
  ) {
    return {
      isExempt: true,
      reason: 'Exento (Esquema Salarial Anual / Fijo)',
    }
  }

  const titleNorm = String(params.jobTitle || '')
    .toLowerCase()
    .trim()
  const roleNorm = String(params.role || '')
    .toLowerCase()
    .trim()

  const isAssistantOrShiftLead =
    titleNorm.includes('asst') ||
    titleNorm.includes('assistant') ||
    titleNorm.includes('asistente') ||
    titleNorm.includes('subgerente') ||
    titleNorm.includes('shift') ||
    titleNorm.includes('lead') ||
    titleNorm.includes('lider') ||
    titleNorm.includes('turno') ||
    roleNorm.includes('asst') ||
    roleNorm.includes('assistant') ||
    roleNorm.includes('asistente') ||
    roleNorm.includes('subgerente')

  if (!isAssistantOrShiftLead) {
    if (
      roleNorm === 'manager' ||
      roleNorm === 'supervisor' ||
      roleNorm === 'admin' ||
      roleNorm === 'director' ||
      roleNorm === 'general_manager' ||
      roleNorm === 'district_manager'
    ) {
      return {
        isExempt: true,
        reason: `Exento por Rol de Liderazgo (${params.role})`,
      }
    }

    if (
      titleNorm.includes('director') ||
      titleNorm.includes('manager') ||
      titleNorm.includes('gerente') ||
      titleNorm.includes('supervisor')
    ) {
      return {
        isExempt: true,
        reason: `Exento por Puesto Gerencial (${params.jobTitle})`,
      }
    }
  }

  if (
    isEmployeeSalaried(
      params.jobTitle || undefined,
      params.fullName || undefined,
      params.payRate ?? undefined
    )
  ) {
    return {
      isExempt: true,
      reason: `Exento (${params.jobTitle || 'Manager / Supervisor Asalariado'})`,
    }
  }

  return { isExempt: false, reason: null }
}

/**
 * Helper booleano directo para verificar si un colaborador es asalariado/exento.
 */
export function isExemptSalariedEmployee(params: SalariedCheckInput): boolean {
  return evaluateSalariedExemption(params).isExempt
}

// ============================================================================
// 2. POLÍTICA DE ASISTENCIA Y PUNTUALIDAD (±3 MIN) & EXENCIÓN DE EMERGENCIA
// ============================================================================

const COVERAGE_NOTE_KEYWORDS = [
  'emergencia',
  'emergency',
  'cobertura',
  'coverage',
  'cubrir',
  'cover',
  'rush',
  'apoyo',
  'llamado',
  'call in',
  'call-in',
  'called in',
  'autorizado',
  'authorized',
  'manager',
  'gerente',
  'relevo',
  'extra',
]

/**
 * Verifica si las notas del turno indican llamado de emergencia, cobertura o autorización gerencial.
 */
export function hasCoverageOrEmergencyShiftNote(
  notes?: string | null,
  isCallback?: boolean | null
): boolean {
  if (isCallback === true) return true
  if (!notes) return false
  const clean = String(notes).toLowerCase()
  return COVERAGE_NOTE_KEYWORDS.some((kw) => clean.includes(kw))
}

export interface EvaluateClockInPunctualityParams {
  businessDate: string
  scheduledStartTime: string | Date
  actualClockInTime: string | Date
  addedPunch?: boolean | null
  shiftNotes?: string | null
  isCallback?: boolean | null
  toastClockInTime?: string | Date | null
  hasStoreCoverageGap?: boolean | null
  absentOrLateCoworkersCount?: number | null
  managerApprovedEarlyIn?: boolean | null
}

export interface ClockInPunctualityEvaluation {
  status: 'ON_TIME' | 'UNAUTHORIZED_EARLY_IN' | 'AUTHORIZED_EARLY_CALL_IN' | 'LATE_CLOCK_IN'
  diffMinutes: number // negativo = antes del turno, positivo = tarde, 0 = exacto
  earlyMinutes: number
  lateMinutes: number
  isViolation: boolean
  isAuthorizedEarlyCallIn: boolean
  exemptionReason: string | null
  earlyCallInSignals: string[]
  scheduledStartLA: string
  actualClockInLA: string
  title: string
  description: string
}

/**
 * Evalúa la hora de entrada (Clock-In) contra el horario publicado del Planificador aplicando:
 * - Margen estricto de ±3 minutos de `NHP TEG SPANISH.pdf` (p. 3 y p. 10):
 *   * `diffMinutes <= -4` (ej. 8:56 AM para turno 9:00 AM) -> `UNAUTHORIZED_EARLY_IN` (salvo exención por cobertura)
 *   * `-3 <= diffMinutes <= +3` (ej. 8:57 AM a 9:03 AM para turno 9:00 AM) -> `ON_TIME`
 *   * `diffMinutes >= +4` (ej. 9:04 AM para turno 9:00 AM) -> `LATE_CLOCK_IN`
 * - Detección inteligente de llamado/emergencia del Manager (`AUTHORIZED_EARLY_CALL_IN`).
 */
export function evaluateClockInPunctuality(
  params: EvaluateClockInPunctualityParams
): ClockInPunctualityEvaluation | null {
  const schedParsed = parseTimeInLA(params.scheduledStartTime, params.businessDate)
  const actualParsed = parseTimeInLA(params.actualClockInTime, params.businessDate)
  if (!schedParsed || !actualParsed) return null

  let schedMin = schedParsed.relativeMinutesFromBizDate
  let actualMin = actualParsed.relativeMinutesFromBizDate

  // Si ambos se pasaron como horas locales sin fecha y hay cruce nocturno
  if (Math.abs(actualMin - schedMin) > 720) {
    if (actualMin < 360 && schedMin >= 1080) {
      actualMin += 1440
    } else if (schedMin < 360 && actualMin >= 1080) {
      schedMin += 1440
    }
  }

  const diffMinutes = actualMin - schedMin
  const earlyMinutes = diffMinutes < 0 ? Math.abs(diffMinutes) : 0
  const lateMinutes = diffMinutes > 0 ? diffMinutes : 0

  // 1. Dentro de la ventana oficial de gracia (±3 minutos: -3 <= diffMinutes <= +3)
  if (
    diffMinutes >= -NHP_PUNCTUALITY_GRACE_MINUTES &&
    diffMinutes <= NHP_PUNCTUALITY_GRACE_MINUTES
  ) {
    return {
      status: 'ON_TIME',
      diffMinutes,
      earlyMinutes: 0,
      lateMinutes: 0,
      isViolation: false,
      isAuthorizedEarlyCallIn: false,
      exemptionReason: null,
      earlyCallInSignals: [],
      scheduledStartLA: schedParsed.display12h,
      actualClockInLA: actualParsed.display12h,
      title: 'Entrada a Tiempo (±3 min)',
      description: `Registró su entrada a las ${actualParsed.display12h} para su turno programado de las ${schedParsed.display12h} (dentro del margen oficial de ±3 minutos).`,
    }
  }

  // 2. Entrada temprana (4+ minutos antes del turno: diffMinutes <= -4, ej. 8:56 AM para turno 9:00 AM)
  if (diffMinutes <= NHP_EARLY_IN_THRESHOLD_MINUTES) {
    const signals: string[] = []

    // Señal (a): Ponchada manual agregada/aprobada por el Manager en RONOS (addedPunch === true)
    if (params.addedPunch === true || params.managerApprovedEarlyIn === true) {
      signals.push('Ponchada registrada/autorizada por Gerencia (addedPunch)')
    }

    // Señal (b): Nota en el Planificador o flag de callback/cobertura
    if (hasCoverageOrEmergencyShiftNote(params.shiftNotes, params.isCallback)) {
      signals.push(
        `Nota de cobertura/emergencia en Planificador${params.shiftNotes ? `: "${params.shiftNotes}"` : ''}`
      )
    }

    // Señal (c): Entrada >= 15 minutos antes del turno con evidencia operativa de llamado gerencial
    if (earlyMinutes >= NHP_EMERGENCY_CALL_IN_MIN_EARLY_MINUTES) {
      // (c1) También fichó entrada temprana en Toast POS (dentro de ±15 min de RONOS) trabajando activamente
      if (params.toastClockInTime) {
        const toastInParsed = parseTimeInLA(params.toastClockInTime, params.businessDate)
        if (toastInParsed) {
          const toastDiffFromRonos = Math.abs(
            toastInParsed.relativeMinutesFromBizDate - actualMin
          )
          const toastDiffFromSchedule = toastInParsed.relativeMinutesFromBizDate - schedMin
          if (toastDiffFromRonos <= 15 && toastDiffFromSchedule <= -10) {
            signals.push(
              `Turno activo en Toast POS desde las ${toastInParsed.display12h} (sincronizado con entrada en RONOS)`
            )
          }
        }
      }

      // (c2) Otro colaborador programado en la misma tienda/día faltó (NO_SHOW), estuvo enfermo/vacaciones o llegó >= 10 min tarde
      if (
        params.hasStoreCoverageGap === true ||
        safeNum(params.absentOrLateCoworkersCount, 0) > 0
      ) {
        signals.push(
          'Cobertura operativa en tienda por ausencia o retraso de otro colaborador en el turno'
        )
      }

      // (c3) Entrada en bloque oficial de horario (:00 o :30, con margen ±3 min del bloque) al menos 30 minutos antes
      if (earlyMinutes >= NHP_SHIFT_BLOCK_CALL_IN_MIN_EARLY_MINUTES) {
        const rem30 = ((actualParsed.minute % 30) + 30) % 30
        const isOnHalfHourBlockBoundary = rem30 <= 3 || rem30 >= 27
        if (isOnHalfHourBlockBoundary) {
          signals.push(
            `Llamado en bloque de turno anticipado (${actualParsed.display12h} vs ${schedParsed.display12h} programado, ${earlyMinutes} min antes)`
          )
        }
      }
    }

    if (signals.length > 0) {
      return {
        status: 'AUTHORIZED_EARLY_CALL_IN',
        diffMinutes,
        earlyMinutes,
        lateMinutes: 0,
        isViolation: false,
        isAuthorizedEarlyCallIn: true,
        exemptionReason: AUTHORIZED_EARLY_CALL_IN_EXEMPTION_REASON,
        earlyCallInSignals: signals,
        scheduledStartLA: schedParsed.display12h,
        actualClockInLA: actualParsed.display12h,
        title: 'Entrada Temprana Autorizada (Cobertura / Solicitud Gerencial)',
        description: `Entró a las ${actualParsed.display12h} (${earlyMinutes} min antes de su turno de las ${schedParsed.display12h}). Exento de sanción por cobertura/llamado gerencial: ${signals.join('; ')}.`,
      }
    }

    return {
      status: 'UNAUTHORIZED_EARLY_IN',
      diffMinutes,
      earlyMinutes,
      lateMinutes: 0,
      isViolation: true,
      isAuthorizedEarlyCallIn: false,
      exemptionReason: null,
      earlyCallInSignals: [],
      scheduledStartLA: schedParsed.display12h,
      actualClockInLA: actualParsed.display12h,
      title: 'Entrada Temprana No Autorizada (> 3 min antes del turno)',
      description: `Fichó su entrada a las ${actualParsed.display12h} (${earlyMinutes} minutos antes de su hora programada de las ${schedParsed.display12h}). El Manual del Empleado prohíbe fichar más de 3 minutos antes de su turno sin autorización previa del Gerente.`,
    }
  }

  // 3. Tardanza (4+ minutos después del turno: diffMinutes >= +4, ej. 9:04 AM para turno 9:00 AM)
  return {
    status: 'LATE_CLOCK_IN',
    diffMinutes,
    earlyMinutes: 0,
    lateMinutes,
    isViolation: true,
    isAuthorizedEarlyCallIn: false,
    exemptionReason: null,
    earlyCallInSignals: [],
    scheduledStartLA: schedParsed.display12h,
    actualClockInLA: actualParsed.display12h,
    title: 'Tardanza (> 3 min después de la hora programada)',
    description: `Fichó su entrada a las ${actualParsed.display12h} (${lateMinutes} minutos tarde respecto a su turno publicado de las ${schedParsed.display12h}). El margen máximo permitido de puntualidad es de 3 minutos.`,
  }
}

// ============================================================================
// 3. DETECCIÓN DE BRECHA DE COBERTURA EN TIENDA (STORE COVERAGE GAP)
// ============================================================================

/**
 * Analiza todos los turnos publicados de una sucursal en un `businessDate` para detectar si hubo
 * ausencias (`NO_SHOW`), licencias (Sick/Vacation) o tardanzas (`>= 10 min`) que justifiquen que
 * otro compañero haya sido llamado temprano a cubrir el turno.
 */
export function detectStoreDayCoverageGap(params: {
  businessDate: string
  publishedShifts: PlannerScheduledShiftInput[]
  employeeEvaluationsOrPunches: Array<{
    toastEmployeeId?: string | null
    clockInTime?: string | null
    isSick?: boolean | null
    isVacation?: boolean | null
  }>
}): StoreDayCoverageContext {
  const { businessDate, publishedShifts, employeeEvaluationsOrPunches } = params
  if (!Array.isArray(publishedShifts) || publishedShifts.length === 0) {
    return { hasStoreCoverageGap: false, absentOrLateCoworkersCount: 0, coworkerDetails: [] }
  }

  const details: string[] = []
  let gapCount = 0

  for (const shift of publishedShifts) {
    if (shift.status && shift.status !== 'published') continue
    if (!shift.employee_id || !shift.start_time) continue

    const empRecord = employeeEvaluationsOrPunches.find(
      (e) => e.toastEmployeeId && String(e.toastEmployeeId) === String(shift.employee_id)
    )

    if (!empRecord) {
      gapCount++
      details.push(`Ausencia en turno programado (${formatTimeDisplayLA(shift.start_time, businessDate)})`)
      continue
    }

    if (empRecord.isSick || empRecord.isVacation) {
      gapCount++
      details.push(
        `Licencia (${empRecord.isSick ? 'Sick' : 'Vacation'}) en turno de ${formatTimeDisplayLA(shift.start_time, businessDate)}`
      )
      continue
    }

    if (!empRecord.clockInTime) {
      gapCount++
      details.push(`Inasistencia en turno de ${formatTimeDisplayLA(shift.start_time, businessDate)}`)
      continue
    }

    const schedIn = parseTimeInLA(shift.start_time, businessDate)
    const actualIn = parseTimeInLA(empRecord.clockInTime, businessDate)
    if (schedIn && actualIn) {
      const diff = actualIn.relativeMinutesFromBizDate - schedIn.relativeMinutesFromBizDate
      if (diff >= 10) {
        gapCount++
        details.push(`Retraso de ${diff}m en turno de ${schedIn.display12h}`)
      }
    }
  }

  return {
    hasStoreCoverageGap: gapCount > 0,
    absentOrLateCoworkersCount: gapCount,
    coworkerDetails: details,
  }
}

// ============================================================================
// 4. VALIDACIÓN DE 3+ TURNOS CONSECUTIVOS POR ENFERMEDAD (JUSTIFICANTE MÉDICO)
// ============================================================================

export interface SickDayHistoryItem {
  date: string
  isSick?: boolean | null
  sickHours?: number | null
  shiftLabel?: string | null
  notes?: string | null
}

/**
 * Verifica si un colaborador acumula 3 o más turnos consecutivos por enfermedad (`NHP TEG SPANISH.pdf` p. 3),
 * lo cual requiere presentar justificante médico de un profesional de la salud.
 */
export function evaluateConsecutiveSickDays(params: {
  targetDate: string
  historyDays?: SickDayHistoryItem[] | null
  priorConsecutiveSickDays?: number | null
  isSickToday?: boolean | null
}): {
  requiresMedicalNote: boolean
  consecutiveSickDays: number
  violation: RonosPolicyViolationItem | null
} {
  const { targetDate, historyDays, priorConsecutiveSickDays, isSickToday } = params

  let consecutive = 0

  if (typeof priorConsecutiveSickDays === 'number' && priorConsecutiveSickDays >= 0) {
    consecutive = isSickToday ? priorConsecutiveSickDays + 1 : 0
  } else if (Array.isArray(historyDays) && historyDays.length > 0) {
    const sorted = [...historyDays]
      .filter((d) => d?.date && d.date.slice(0, 10) <= targetDate.slice(0, 10))
      .sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)))

    for (const day of sorted) {
      const label = String(day.shiftLabel || '').toUpperCase()
      const note = String(day.notes || '').toLowerCase()
      const dayIsSick =
        day.isSick === true ||
        safeNum(day.sickHours, 0) > 0 ||
        label === 'SICK' ||
        label === 'ENFERMO' ||
        note.includes('enferm') ||
        note.includes('sick')

      if (dayIsSick) {
        consecutive++
      } else {
        consecutive = 0
      }
    }
  } else if (isSickToday) {
    consecutive = 1
  }

  const requiresMedicalNote = consecutive >= NHP_CONSECUTIVE_SICK_DAYS_MEDICAL_NOTE

  if (!requiresMedicalNote) {
    return {
      requiresMedicalNote: false,
      consecutiveSickDays: consecutive,
      violation: null,
    }
  }

  return {
    requiresMedicalNote: true,
    consecutiveSickDays: consecutive,
    violation: {
      type: 'MEDICAL_NOTE_REQUIRED',
      category: 'attendance',
      severity: 'warning',
      uiSeverity: 'warning',
      isViolation: true,
      title: 'Justificante Médico Requerido (3+ Turnos por Enfermedad)',
      description: `Se registran ${consecutive} turnos consecutivos de ausencia por enfermedad. Conforme al Manual del Empleado (p. 3), 3 o más turnos consecutivos por enfermedad requieren presentar justificante médico para su reincorporación.`,
      policyReference:
        'Manual del Empleado NHP TEG SPANISH.pdf (p. 3 — Asistencia y Puntualidad / Ausencias por Enfermedad)',
      actionRequired:
        'Presentar justificante médico expedido por un profesional de la salud ante su Gerente de Tienda o Recursos Humanos antes de reincorporarse a su turno.',
      estimatedCostUsd: 0,
      minutes: 0,
    },
  }
}

// ============================================================================
// 5. RESUMEN DE PONCHADAS TOAST POS Y TURNO PLANIFICADOR
// ============================================================================

export function summarizeToastPunchesForDay(
  toastPunchesInput?: ToastPunchRecordInput | ToastPunchRecordInput[] | null,
  businessDate?: string
): ToastPunchSummary {
  const list = Array.isArray(toastPunchesInput)
    ? toastPunchesInput.filter(Boolean)
    : toastPunchesInput
      ? [toastPunchesInput]
      : []

  if (list.length === 0) {
    return {
      hasToastPunches: false,
      clockInTime: null,
      clockOutTime: null,
      clockInLA: null,
      clockOutLA: null,
      lunchStartTime: null,
      lunchEndTime: null,
      lunchStartLA: null,
      lunchEndLA: null,
      lunchDurationMinutes: null,
      restBreaksCount: 0,
      totalHoursToast: 0,
      rawPunchesCount: 0,
    }
  }

  const sorted = [...list].sort((a, b) => {
    const inA = a.clock_in || a.in_date || a.clockInTime || ''
    const inB = b.clock_in || b.in_date || b.clockInTime || ''
    return String(inA).localeCompare(String(inB))
  })

  const firstIn =
    sorted.map((p) => p.clock_in || p.in_date || p.clockInTime).find(Boolean) || null
  const lastOut =
    [...sorted]
      .reverse()
      .map((p) => p.clock_out || p.out_date || p.clockOutTime)
      .find(Boolean) || null

  let lunchStartTime: string | null = null
  let lunchEndTime: string | null = null
  let lunchDurationMinutes: number | null = null
  let restBreaksCount = 0
  let totalHoursToast = 0

  for (const p of sorted) {
    totalHoursToast += safeNum(p.regular_hours, 0) + safeNum(p.overtime_hours, 0)
    if (Array.isArray(p.breaks)) {
      for (const b of p.breaks) {
        if (!b) continue
        if (b.paid === true) {
          restBreaksCount++
        } else if (!lunchStartTime && b.inDate) {
          lunchStartTime = b.inDate
          lunchEndTime = b.outDate || null
          if (b.inDate && b.outDate) {
            const sParsed = parseTimeInLA(b.inDate, businessDate)
            const eParsed = parseTimeInLA(b.outDate, businessDate)
            if (sParsed?.epochMs && eParsed?.epochMs && eParsed.epochMs > sParsed.epochMs) {
              lunchDurationMinutes = Number(
                ((eParsed.epochMs - sParsed.epochMs) / 60_000).toFixed(2)
              )
            } else if (sParsed && eParsed) {
              lunchDurationMinutes = Math.max(
                0,
                eParsed.relativeMinutesFromBizDate - sParsed.relativeMinutesFromBizDate
              )
            }
          }
        }
      }
    }
  }

  if (totalHoursToast === 0 && firstIn && lastOut) {
    const inP = parseTimeInLA(firstIn, businessDate)
    const outP = parseTimeInLA(lastOut, businessDate)
    if (inP && outP) {
      let elapsedMin = outP.relativeMinutesFromBizDate - inP.relativeMinutesFromBizDate
      if (elapsedMin < 0) elapsedMin += 1440
      const netMin = Math.max(0, elapsedMin - safeNum(lunchDurationMinutes, 0))
      totalHoursToast = Number((netMin / 60).toFixed(2))
    }
  }

  return {
    hasToastPunches: Boolean(firstIn || lastOut || totalHoursToast > 0),
    clockInTime: firstIn,
    clockOutTime: lastOut,
    clockInLA: firstIn ? formatTimeDisplayLA(firstIn, businessDate) : null,
    clockOutLA: lastOut ? formatTimeDisplayLA(lastOut, businessDate) : null,
    lunchStartTime,
    lunchEndTime,
    lunchStartLA: lunchStartTime ? formatTimeDisplayLA(lunchStartTime, businessDate) : null,
    lunchEndLA: lunchEndTime ? formatTimeDisplayLA(lunchEndTime, businessDate) : null,
    lunchDurationMinutes,
    restBreaksCount,
    totalHoursToast: Number(totalHoursToast.toFixed(2)),
    rawPunchesCount: sorted.length,
  }
}

export function summarizePlannerShiftForDay(
  shiftsInput?: PlannerScheduledShiftInput | PlannerScheduledShiftInput[] | null,
  businessDate?: string
): PlannerShiftSummary {
  const bDate = (businessDate || '').trim().slice(0, 10)
  const list = Array.isArray(shiftsInput)
    ? shiftsInput.filter(Boolean)
    : shiftsInput
      ? [shiftsInput]
      : []

  const published = list.filter((s) => !s.status || s.status === 'published')
  if (published.length === 0) {
    return {
      hasPublishedShift: false,
      shiftDate: bDate,
    }
  }

  const sorted = [...published].sort((a, b) =>
    String(a.start_time || '').localeCompare(String(b.start_time || ''))
  )
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  const startParsed = parseTimeInLA(first.start_time, bDate)
  const endParsed = parseTimeInLA(last.end_time, bDate)

  let durationHours: number | null = null
  if (startParsed && endParsed) {
    let diffMin = endParsed.relativeMinutesFromBizDate - startParsed.relativeMinutesFromBizDate
    if (diffMin < 0) diffMin += 1440
    durationHours = Number((diffMin / 60).toFixed(2))
  }

  const combinedNotes = sorted
    .map((s) => s.notes?.trim())
    .filter(Boolean)
    .join(' | ')

  return {
    hasPublishedShift: Boolean(first.start_time),
    shiftId: first.id || null,
    shiftDate: first.shift_date?.slice(0, 10) || bDate,
    startTimeIso: first.start_time || null,
    endTimeIso: last.end_time || null,
    startTimeLA: startParsed ? startParsed.display12h : null,
    endTimeLA: endParsed ? endParsed.display12h : null,
    startTime24: startParsed ? startParsed.display24h : null,
    endTime24: endParsed ? endParsed.display24h : null,
    scheduledDurationHours: durationHours,
    notes: combinedNotes || null,
    isCallback: sorted.some((s) => s.is_callback === true),
  }
}

// ============================================================================
// 6. POLÍTICA DE COMIDA, DESCANSO Y TARJETAS EN RONOS (NHP p. 4 y p. 10)
// ============================================================================

/**
 * Evalúa las reglas de comida (Lunch 30 min exactos, <30m corto, 5ta hora >5.0h, omitido >6.0h)
 * y tarjetas rotas (`BROKEN_TIMECARD`) en RONOS, cruzando con Toast POS para indicar tiempos de referencia.
 */
export function evaluateRonosMealAndTimecardPolicy(params: {
  businessDate: string
  ronosDay: RonosDayInput
  toastSummary: ToastPunchSummary
  hourlyWage?: number
  isCurrentOpenShift?: boolean
}): RonosPolicyViolationItem[] {
  const {
    businessDate,
    ronosDay,
    toastSummary,
    hourlyWage = 19.5,
    isCurrentOpenShift = false,
  } = params

  const violations: RonosPolicyViolationItem[] = []
  const clockIn = ronosDay.clockInTime || null
  const clockOut = ronosDay.clockOutTime || null
  const lunchStart = ronosDay.lunchStartTime || null
  const lunchEnd = ronosDay.lunchEndTime || null

  const inParsed = parseTimeInLA(clockIn, businessDate)
  const outParsed = parseTimeInLA(clockOut, businessDate)

  // Construir lista de comidas desde mealBreaks o desde lunchStartTime/lunchEndTime
  const mealBreaks: RonosMealBreakInput[] = []
  if (Array.isArray(ronosDay.mealBreaks) && ronosDay.mealBreaks.length > 0) {
    mealBreaks.push(...ronosDay.mealBreaks)
  } else if (lunchStart || safeNum(ronosDay.lunchDurationMinutes, 0) > 0) {
    let durationMin = safeNum(ronosDay.lunchDurationMinutes, 0)
    let hoursBefore = 0
    const lStartParsed = parseTimeInLA(lunchStart, businessDate)
    const lEndParsed = parseTimeInLA(lunchEnd, businessDate)

    if (durationMin === 0 && lStartParsed && lEndParsed) {
      if (lStartParsed.epochMs && lEndParsed.epochMs && lEndParsed.epochMs > lStartParsed.epochMs) {
        const secs = Math.floor((lEndParsed.epochMs - lStartParsed.epochMs) / 1000)
        durationMin = Number((secs / 60).toFixed(2))
      } else {
        let diff =
          lEndParsed.relativeMinutesFromBizDate - lStartParsed.relativeMinutesFromBizDate
        if (diff < 0) diff += 1440
        durationMin = diff
      }
    }

    if (inParsed && lStartParsed) {
      if (inParsed.epochMs && lStartParsed.epochMs && lStartParsed.epochMs > inParsed.epochMs) {
        hoursBefore = Number(
          ((lStartParsed.epochMs - inParsed.epochMs) / (1000 * 60 * 60)).toFixed(2)
        )
      } else {
        let diff =
          lStartParsed.relativeMinutesFromBizDate - inParsed.relativeMinutesFromBizDate
        if (diff < 0) diff += 1440
        hoursBefore = Number((diff / 60).toFixed(2))
      }
    }

    mealBreaks.push({
      index: 1,
      startTime: lunchStart || undefined,
      endTime: lunchEnd || undefined,
      durationMinutes: durationMin,
      hoursWorkedBeforeMeal: hoursBefore,
    })
  }

  const totalLunchMinutes = mealBreaks.reduce((acc, m) => acc + safeNum(m.durationMinutes, 0), 0)

  let shiftHours = safeNum(ronosDay.totalHours, 0)
  if (shiftHours === 0 && inParsed && outParsed) {
    let rawElapsedMin =
      outParsed.relativeMinutesFromBizDate - inParsed.relativeMinutesFromBizDate
    if (rawElapsedMin < 0) rawElapsedMin += 1440
    shiftHours = Number(Math.max(0, (rawElapsedMin - totalLunchMinutes) / 60).toFixed(2))
  }

  // Evaluar cada período de comida registrado en RONOS
  for (const m of mealBreaks) {
    const idx = m.index || 1
    const hasCompletedLunch = Boolean(m.endTime) || safeNum(m.durationMinutes, 0) > 0
    const durationExact = safeNum(m.durationMinutes, 0)
    const completedMinutes = Math.floor(durationExact)

    if (hasCompletedLunch && durationExact > 0) {
      // A. MEAL_PENALTY_SHORT (< 30.0 minutos ininterrumpidos - California Labor Code § 512)
      if (durationExact < AUTHORIZED_LUNCH_MINUTES) {
        const fullMins = Math.floor(durationExact)
        const remSecs = Math.round((durationExact - fullMins) * 60)
        violations.push({
          type: 'MEAL_PENALTY_SHORT',
          category: 'meal_rest',
          severity: 'danger',
          uiSeverity: 'critical',
          isViolation: true,
          title:
            idx === 1
              ? 'Lunch Corto (< 30 minutos obligatorios)'
              : `Lunch #${idx} Corto (< 30 minutos obligatorios)`,
          description: `El descanso de comida duró ${fullMins}m${remSecs > 0 ? ` ${remSecs}s` : ''} (${durationExact} min). La ley laboral de California (§ 512) y el Manual del Empleado exigen 30 minutos ininterrumpidos completos.`,
          policyReference:
            'Manual del Empleado NHP TEG SPANISH.pdf (p. 4 y p. 10 — Período de Comida de 30 Minutos / California Labor Code § 512)',
          actionRequired:
            'Tomar siempre sus 30 minutos completos e ininterrumpidos de comida antes de fichar su regreso en la tableta de RONOS.',
          estimatedCostUsd: hourlyWage,
          minutes: durationExact,
        })
      }

      // B. LONG_LUNCH (>= 31 minutos cumplidos; tiempo oficial autorizado: 30 minutos exactos; CERO mención de tolerancia)
      if (completedMinutes >= INTERNAL_LUNCH_MIN_VIOLATION_MINUTES) {
        const excessMinutes = Math.max(1, completedMinutes - AUTHORIZED_LUNCH_MINUTES)
        violations.push({
          type: 'LONG_LUNCH',
          category: 'meal_rest',
          severity: 'warning',
          uiSeverity: 'warning',
          isViolation: true,
          title:
            idx === 1
              ? 'Exceso de Tiempo en Lunch (30 minutos autorizados)'
              : `Exceso de Tiempo en Lunch #${idx} (30 minutos autorizados)`,
          description: `Registró ${completedMinutes} minutos de comida (+${excessMinutes} min excedidos sobre los ${AUTHORIZED_LUNCH_MINUTES} minutos exactos autorizados).`,
          policyReference:
            'Manual del Empleado NHP TEG SPANISH.pdf (p. 4 y p. 10 — Política de Comida y Descanso: 30 minutos autorizados)',
          actionRequired:
            'Registrar su regreso puntualmente en la tableta de RONOS al cumplirse los 30 minutos exactos autorizados de comida.',
          estimatedCostUsd: 0,
          minutes: completedMinutes,
          diffMinutes: excessMinutes,
        })
      }
    }
  }

  // C. MEAL_PENALTY_LATE (Inicio de primer lunch después de la 5ta hora: > 5.0h de trabajo continuo)
  if (inParsed && mealBreaks.length > 0) {
    const firstMeal = mealBreaks[0]
    if (safeNum(firstMeal.hoursWorkedBeforeMeal, 0) > 5.0) {
      const minutesLate = Math.max(
        1,
        Math.round((firstMeal.hoursWorkedBeforeMeal - 5.0) * 60)
      )
      violations.push({
        type: 'MEAL_PENALTY_LATE',
        category: 'meal_rest',
        severity: 'danger',
        uiSeverity: 'critical',
        isViolation: true,
        title: 'Violación de 5ta Hora (Inicio Tardío de Lunch)',
        description: `Inició su descanso de comida a las ${firstMeal.hoursWorkedBeforeMeal.toFixed(2)} horas de trabajo continuo (${minutesLate} min después del límite legal de la 5ta hora).`,
        policyReference:
          'Manual del Empleado NHP TEG SPANISH.pdf (p. 4 — Período de Comida antes de la 5ta hora / California Labor Code § 512)',
        actionRequired:
          'Salir a comer y ponchar su inicio de Lunch en RONOS siempre antes de cumplir las 5.0 horas de trabajo continuo.',
        estimatedCostUsd: hourlyWage,
        minutes: minutesLate,
      })
    }
  }

  // D. MEAL_PENALTY_MISSED (Turno > 6.0 horas sin ponchar comida en RONOS)
  if (inParsed && mealBreaks.length === 0 && shiftHours > 6.0 && (outParsed || !isCurrentOpenShift)) {
    const toastHasLunch = Boolean(toastSummary.lunchStartLA)
    const toastRefText = toastHasLunch
      ? ` En Toast POS sí aparece registrado un Lunch (${toastSummary.lunchStartLA} - ${toastSummary.lunchEndLA || '--:--'}), por lo que olvidó ponchar su comida en la tableta de RONOS.`
      : ''

    violations.push({
      type: 'MEAL_PENALTY_MISSED',
      category: 'meal_rest',
      severity: 'danger',
      uiSeverity: 'critical',
      isViolation: true,
      title: toastHasLunch
        ? 'Lunch Omitido en RONOS (> 6h) — Registrado solo en Toast POS'
        : 'Lunch Omitido en Turno > 6 Horas (Meal Penalty)',
      description: `Turno de ${shiftHours.toFixed(2)} horas en RONOS sin registro de descanso de comida (obligatorio en jornadas mayores a 6 horas).${toastRefText}`,
      policyReference:
        'Manual del Empleado NHP TEG SPANISH.pdf (p. 4 y p. 10 — Obligación de fichar Inicio y Fin de Comida en RONOS / California Labor Code § 512)',
      actionRequired: toastHasLunch
        ? `Solicitar hoy mismo a su Gerente reparar su tarjeta de RONOS agregando el Lunch registrado en Toast POS (${toastSummary.lunchStartLA} - ${toastSummary.lunchEndLA || '--:--'}) para evitar errores en su cheque de pago.`
        : 'Coordinar con su Gerente para tomar y fichar su descanso de comida de 30 minutos en RONOS en todo turno mayor a 6 horas.',
      estimatedCostUsd: hourlyWage,
      minutes: 0,
    })
  }

  // E. BROKEN_TIMECARD (Falta Clock-In, Regreso de Lunch o Clock-Out en RONOS)
  const hasUnclosedLunch = mealBreaks.some((m) => Boolean(m.startTime) && !m.endTime && safeNum(m.durationMinutes, 0) === 0)
  const missingClockOut =
    Boolean(inParsed) &&
    !outParsed &&
    (shiftHours > 0 || !isCurrentOpenShift || Boolean(toastSummary.clockOutLA))
  const missingClockIn = !inParsed && (Boolean(outParsed) || mealBreaks.length > 0)

  if (missingClockIn || missingClockOut || hasUnclosedLunch) {
    let missingDetail = 'Ponchada incompleta en la tableta de RONOS.'
    if (missingClockIn) {
      missingDetail = `Falta ponchada de entrada (Clock In) en RONOS${toastSummary.clockInLA ? ` (en Toast POS fichó entrada a las ${toastSummary.clockInLA})` : ''}.`
    } else if (hasUnclosedLunch) {
      missingDetail = `Falta ponchada de regreso de comida (Lunch End) en RONOS${toastSummary.lunchEndLA ? ` (en Toast POS regresó de Lunch a las ${toastSummary.lunchEndLA})` : ''}.`
    } else if (missingClockOut) {
      missingDetail = `Falta ponchada de salida (Clock Out) en RONOS${toastSummary.clockOutLA ? ` (en Toast POS fichó salida a las ${toastSummary.clockOutLA})` : ''}.`
    }

    violations.push({
      type: 'BROKEN_TIMECARD',
      category: 'timecard_repair',
      severity: 'warning',
      uiSeverity: 'critical',
      isViolation: true,
      title: 'Ponchada Incompleta en RONOS (Tarjeta Rota / Reparar)',
      description: `${missingDetail} Es obligatorio revisar y reparar sus fichajes en RONOS porque de ello depende el cálculo exacto de su cheque de pago.`,
      policyReference:
        'Manual del Empleado NHP TEG SPANISH.pdf (p. 4 y p. 10 — Registro de Tiempo y Obligación de Reportar Ponchadas Omitidas)',
      actionRequired:
        'Reportar de inmediato a su Gerente de Tienda para completar y reparar su registro de tiempo en RONOS antes del cierre de nómina.',
      estimatedCostUsd: 0,
    })
  }

  return violations
}

// ============================================================================
// 7. VALIDACIÓN CRUZADA TOAST POS vs RONOS (REPAIR_RONOS_PUNCH)
// ============================================================================

/**
 * Compara las ponchadas de Toast POS (`punches`) contra las de RONOS en el mismo `businessDate`
 * para detectar olvidos de ponchada en la tableta de RONOS y exigir su reparación inmediata.
 */
export function evaluateToastVsRonosDiscrepancy(params: {
  businessDate: string
  ronosDay: RonosDayInput
  toastSummary: ToastPunchSummary
  isCurrentOpenShift?: boolean
}): {
  hasDiscrepancy: boolean
  details: string[]
  violation: RonosPolicyViolationItem | null
} {
  const { businessDate, ronosDay, toastSummary, isCurrentOpenShift = false } = params
  if (!toastSummary.hasToastPunches) {
    return { hasDiscrepancy: false, details: [], violation: null }
  }

  const details: string[] = []
  const ronosInParsed = parseTimeInLA(ronosDay.clockInTime, businessDate)
  const ronosOutParsed = parseTimeInLA(ronosDay.clockOutTime, businessDate)
  const ronosHasLunch =
    Boolean(ronosDay.lunchStartTime) ||
    safeNum(ronosDay.lunchDurationMinutes, 0) > 0 ||
    (Array.isArray(ronosDay.mealBreaks) && ronosDay.mealBreaks.length > 0)
  const hasAnyRonosPunch =
    Boolean(ronosInParsed) ||
    Boolean(ronosOutParsed) ||
    ronosHasLunch ||
    (Array.isArray(ronosDay.punches) && ronosDay.punches.length > 0) ||
    safeNum(ronosDay.totalHours, 0) > 0

  // Caso 1: Trabajó en Toast POS pero tiene 0 ponchadas en RONOS
  if (!hasAnyRonosPunch) {
    const toastWindow = `${toastSummary.clockInLA || '--:--'} a ${toastSummary.clockOutLA || 'En turno'}`
    details.push(
      `Trabajó y fichó en Toast POS (${toastWindow}${toastSummary.lunchStartLA ? `, Lunch: ${toastSummary.lunchStartLA} - ${toastSummary.lunchEndLA || '--:--'}` : ''}), pero NO registró ninguna ponchada en la tableta de RONOS.`
    )
  } else {
    // Caso 2: Falta entrada en RONOS o Toast POS registró entrada >= 15 min ANTES que RONOS
    if (toastSummary.clockInTime) {
      const toastInParsed = parseTimeInLA(toastSummary.clockInTime, businessDate)
      if (!ronosInParsed && toastInParsed) {
        details.push(
          `Fichó entrada en Toast POS a las ${toastInParsed.display12h}, pero olvidó fichar entrada (Clock In) en RONOS.`
        )
      } else if (ronosInParsed && toastInParsed) {
        let ronosInRel = ronosInParsed.relativeMinutesFromBizDate
        let toastInRel = toastInParsed.relativeMinutesFromBizDate
        if (ronosInParsed.epochMs === null || toastInParsed.epochMs === null) {
          if (ronosInRel < 360 && toastInRel >= 1080) ronosInRel += 1440
          else if (toastInRel < 360 && ronosInRel >= 1080) toastInRel += 1440
        }
        const toastEarlierByMin = ronosInRel - toastInRel
        if (toastEarlierByMin >= TOAST_RONOS_DISCREPANCY_THRESHOLD_MINUTES) {
          details.push(
            `Entrada en Toast POS ${toastEarlierByMin} min antes que RONOS: Toast POS (${toastInParsed.display12h}) vs RONOS (${ronosInParsed.display12h}).`
          )
        }
      }
    }

    // Caso 3: Tiene Lunch en Toast POS pero olvidó fichar Lunch en RONOS (o le faltó cerrar el Lunch en RONOS)
    if (toastSummary.lunchStartTime && !ronosHasLunch) {
      details.push(
        `Registró comida (Lunch) en Toast POS (${toastSummary.lunchStartLA} - ${toastSummary.lunchEndLA || '--:--'}), pero olvidó ponchar su comida en la tableta de RONOS.`
      )
    } else if (
      toastSummary.lunchEndTime &&
      ronosDay.lunchStartTime &&
      !ronosDay.lunchEndTime &&
      safeNum(ronosDay.lunchDurationMinutes, 0) === 0
    ) {
      details.push(
        `Registró regreso de comida en Toast POS a las ${toastSummary.lunchEndLA}, pero olvidó fichar su regreso de Lunch en RONOS.`
      )
    }

    // Caso 4: Falta salida en RONOS o Toast POS cerró >= 15 min DESPUÉS que RONOS (ignorando auto-clockout 5:50 AM–6:05 AM de Toast POS)
    if (toastSummary.clockOutTime && !isCurrentOpenShift) {
      const toastOutParsed = parseTimeInLA(toastSummary.clockOutTime, businessDate)
      if (!ronosOutParsed && toastOutParsed) {
        details.push(
          `Fichó salida en Toast POS a las ${toastOutParsed.display12h}, pero olvidó fichar salida (Clock Out) en RONOS.`
        )
      } else if (ronosOutParsed && toastOutParsed) {
        let ronosOutRel = ronosOutParsed.relativeMinutesFromBizDate
        let toastOutRel = toastOutParsed.relativeMinutesFromBizDate
        const ronosInRefMin = ronosInParsed?.relativeMinutesFromBizDate ?? null
        if (ronosOutParsed.epochMs === null && ronosOutRel < 360) {
          ronosOutRel += 1440
        }
        if (
          toastOutParsed.epochMs === null &&
          (toastOutRel < 360 || (toastOutRel <= 365 && ronosInRefMin !== null && ronosInRefMin >= 360))
        ) {
          toastOutRel += 1440
        }
        const isToastAutoClockOut =
          toastOutRel >= 1790 && toastOutRel <= 1805 && ronosOutRel < toastOutRel
        const toastLaterByMin = toastOutRel - ronosOutRel
        if (!isToastAutoClockOut && toastLaterByMin >= TOAST_RONOS_DISCREPANCY_THRESHOLD_MINUTES) {
          details.push(
            `Salida en Toast POS ${toastLaterByMin} min después que RONOS: Toast POS (${toastOutParsed.display12h}) vs RONOS (${ronosOutParsed.display12h}).`
          )
        }
      }
    }
  }

  if (details.length === 0) {
    return { hasDiscrepancy: false, details: [], violation: null }
  }

  return {
    hasDiscrepancy: true,
    details,
    violation: {
      type: 'REPAIR_RONOS_PUNCH',
      category: 'timecard_repair',
      severity: 'danger',
      uiSeverity: 'critical',
      isViolation: true,
      title: 'Discrepancia Toast POS vs RONOS — Reparar Ponchada en RONOS',
      description: `${details.join(' ')} Recuerde que su cheque de pago de nómina se calcula con las ponchadas de RONOS, por lo que debe reparar su registro con su Gerente hoy mismo.`,
      policyReference:
        'Manual del Empleado NHP TEG SPANISH.pdf (p. 4 y p. 10 — Exactitud de Registros de Tiempo y Nómina en RONOS)',
      actionRequired:
        'Acudir hoy mismo con su Gerente de Tienda para revisar las horas registradas en Toast POS y reparar su tarjeta de tiempo en RONOS.',
      estimatedCostUsd: 0,
    },
  }
}

// ============================================================================
// 8. EVALUADOR INTEGRAL DIARIO POR COLABORADOR
// ============================================================================

export interface EvaluateEmployeeDayAttendanceParams {
  businessDate: string
  employeeUserId?: number
  fullName?: string | null
  jobTitle?: string | null
  role?: string | null
  isSalaried?: boolean | null
  is_salaried?: boolean | null
  payType?: string | null
  payRate?: number | null
  ronosDay?: RonosDayInput | null
  scheduledShifts?: PlannerScheduledShiftInput | PlannerScheduledShiftInput[] | null
  toastPunches?: ToastPunchRecordInput | ToastPunchRecordInput[] | null
  storeCoverageContext?: StoreDayCoverageContext | null
  scheduleEntry?: {
    shift_label?: string | null
    start_time?: string | null
    end_time?: string | null
  } | null
  historyDays?: SickDayHistoryItem[] | null
  priorConsecutiveSickDays?: number | null
  isCurrentOpenShift?: boolean
  asOfDate?: Date | string | null
}

/**
 * Ejecuta la evaluación integral del día de un colaborador combinando:
 * 1) Exclusión de asalariados (Managers / Supervisores).
 * 2) Puntualidad (±3 min) y detección de llamado/emergencia gerencial (`AUTHORIZED_EARLY_CALL_IN`).
 * 3) Salida temprana (`EARLY_CLOCK_OUT`).
 * 4) Cruce Toast POS vs RONOS (`REPAIR_RONOS_PUNCH` vs `NO_SHOW`).
 * 5) Justificante médico por 3+ turnos consecutivos de enfermedad (`MEDICAL_NOTE_REQUIRED`).
 * 6) Políticas de comida y tarjeta en RONOS (`LONG_LUNCH`, `MEAL_PENALTY_SHORT`, `MEAL_PENALTY_LATE`, `MEAL_PENALTY_MISSED`, `BROKEN_TIMECARD`).
 */
export function evaluateEmployeeDayAttendancePolicy(
  params: EvaluateEmployeeDayAttendanceParams
): RonosDayAttendanceEvaluation {
  const businessDate = String(params.businessDate || '').trim().slice(0, 10)
  const rDay: RonosDayInput = params.ronosDay || {}

  // 1. Resúmenes de Planificador y Toast POS
  const scheduledShift = summarizePlannerShiftForDay(params.scheduledShifts, businessDate)
  const toastSummary = summarizeToastPunchesForDay(params.toastPunches, businessDate)

  // Extraer flags de ponchada manual (addedPunch) de RONOS
  const atomicPunches = Array.isArray(rDay.punches) ? rDay.punches : []
  const firstInAtomic = atomicPunches.find((p) => safeNum(p?.punchType) === 1)
  const lastOutAtomic = [...atomicPunches].reverse().find((p) => safeNum(p?.punchType) === 2)

  const clockInAddedPunch =
    rDay.clockInAddedPunch === true || firstInAtomic?.addedPunch === true
  const clockOutAddedPunch =
    rDay.clockOutAddedPunch === true || lastOutAtomic?.addedPunch === true

  const ronosClockIn = rDay.clockInTime || firstInAtomic?.timestampIso || firstInAtomic?.localTime || null
  const ronosClockOut = rDay.clockOutTime || lastOutAtomic?.timestampIso || lastOutAtomic?.localTime || null
  const ronosLunchStart = rDay.lunchStartTime || rDay.mealBreaks?.[0]?.startTime || null
  const ronosLunchEnd = rDay.lunchEndTime || rDay.mealBreaks?.[0]?.endTime || null
  const ronosLunchMinutes = safeNum(
    rDay.lunchDurationMinutes ?? rDay.mealBreaks?.[0]?.durationMinutes,
    0
  )
  const ronosTotalHours = safeNum(rDay.totalHours, 0)

  const schedLabelUpper = String(params.scheduleEntry?.shift_label || '').toUpperCase()
  const isSick =
    rDay.isSick === true ||
    safeNum(rDay.sickHours, 0) > 0 ||
    schedLabelUpper === 'SICK' ||
    schedLabelUpper === 'ENFERMO'
  const isVacation =
    rDay.isVacation === true ||
    safeNum(rDay.vacationHours, 0) > 0 ||
    schedLabelUpper === 'VAC' ||
    schedLabelUpper === 'VACATION' ||
    schedLabelUpper === 'VACACIONES'
  const isHoliday =
    rDay.isHoliday === true ||
    safeNum(rDay.holidayHours, 0) > 0 ||
    schedLabelUpper === 'HOLIDAY'

  const hasRonosPunches = Boolean(
    ronosClockIn ||
      ronosClockOut ||
      ronosLunchStart ||
      ronosTotalHours > 0 ||
      atomicPunches.length > 0
  )

  const ronosSummary = {
    hasRonosPunches,
    clockInTime: ronosClockIn,
    clockOutTime: ronosClockOut,
    clockInLA: ronosClockIn ? formatTimeDisplayLA(ronosClockIn, businessDate) : null,
    clockOutLA: ronosClockOut ? formatTimeDisplayLA(ronosClockOut, businessDate) : null,
    lunchStartTime: ronosLunchStart,
    lunchEndTime: ronosLunchEnd,
    lunchStartLA: ronosLunchStart ? formatTimeDisplayLA(ronosLunchStart, businessDate) : null,
    lunchEndLA: ronosLunchEnd ? formatTimeDisplayLA(ronosLunchEnd, businessDate) : null,
    lunchDurationMinutes: ronosLunchMinutes,
    totalHours: ronosTotalHours,
    clockInAddedPunch,
    clockOutAddedPunch,
    isSick,
    isVacation,
    isHoliday,
  }

  // 2. Verificar Exclusión de Salariados (Managers / Supervisores)
  const salariedCheck = evaluateSalariedExemption({
    jobTitle: params.jobTitle,
    fullName: params.fullName,
    payRate: params.payRate,
    isSalaried: params.isSalaried,
    is_salaried: params.is_salaried,
    payType: params.payType,
    role: params.role,
  })

  if (salariedCheck.isExempt) {
    return {
      businessDate,
      isExemptSalaried: true,
      salariedExemptionReason: salariedCheck.reason,
      punctualityStatus: 'EXEMPT_SALARIED',
      punctualityLabelEs: 'Exento (Manager / Supervisor)',
      punctualityLabelEn: 'Exempt (Salaried Manager / Supervisor)',
      punctualityBadgeColor: 'slate',
      diffMinutesFromSchedule: null,
      endDiffMinutesFromSchedule: null,
      isViolation: false,
      isAuthorizedEarlyCallIn: false,
      exemptionReason: salariedCheck.reason,
      earlyCallInSignals: [],
      hasToastRonosDiscrepancy: false,
      discrepancyDetails: [],
      requiresMedicalNote: false,
      consecutiveSickDays: 0,
      scheduledShift,
      toastSummary,
      ronosSummary,
      violations: [],
    }
  }

  const violations: RonosPolicyViolationItem[] = []
  let punctualityStatus: RonosPunctualityStatus = 'NO_SHIFT_NO_PUNCH'
  let punctualityLabelEs = 'Descanso / Sin Turno'
  let punctualityLabelEn = 'Off / No Shift'
  let punctualityBadgeColor: 'emerald' | 'rose' | 'amber' | 'sky' | 'purple' | 'slate' = 'slate'
  let diffMinutesFromSchedule: number | null = null
  let endDiffMinutesFromSchedule: number | null = null
  let isAuthorizedEarlyCallIn = false
  let exemptionReason: string | null = null
  let earlyCallInSignals: string[] = []

  // 3. Evaluar 3+ turnos consecutivos por enfermedad (Justificante Médico)
  const sickCheck = evaluateConsecutiveSickDays({
    targetDate: businessDate,
    historyDays: params.historyDays,
    priorConsecutiveSickDays: params.priorConsecutiveSickDays,
    isSickToday: isSick,
  })

  if (sickCheck.violation) {
    violations.push(sickCheck.violation)
  }

  // 4. Evaluar Discrepancias Toast POS vs RONOS (REPAIR_RONOS_PUNCH)
  const discrepancyCheck = evaluateToastVsRonosDiscrepancy({
    businessDate,
    ronosDay: {
      ...rDay,
      clockInTime: ronosClockIn,
      clockOutTime: ronosClockOut,
      lunchStartTime: ronosLunchStart,
      lunchEndTime: ronosLunchEnd,
      lunchDurationMinutes: ronosLunchMinutes,
      totalHours: ronosTotalHours,
    },
    toastSummary,
    isCurrentOpenShift: params.isCurrentOpenShift,
  })

  if (discrepancyCheck.violation) {
    violations.push(discrepancyCheck.violation)
  }

  // 5. Evaluar Puntualidad de Entrada y Salida vs Horario Publicado del Planificador
  if (scheduledShift.hasPublishedShift && scheduledShift.startTimeIso) {
    if (ronosClockIn) {
      let effectiveSchedStart: string = scheduledShift.startTimeIso
      let effectiveSchedEnd: string | null = scheduledShift.endTimeIso || null
      let wasAmPmAdjusted = false

      const rawSchedStartP = parseTimeInLA(scheduledShift.startTimeIso, businessDate)
      const rawActualInP = parseTimeInLA(ronosClockIn, businessDate)
      if (rawSchedStartP && rawActualInP) {
        const rawDiff =
          rawActualInP.relativeMinutesFromBizDate - rawSchedStartP.relativeMinutesFromBizDate
        if (Math.abs(Math.abs(rawDiff) - 720) <= 60) {
          const shiftDirection: 1 | -1 = rawDiff > 0 ? 1 : -1
          effectiveSchedStart = shiftTimeBy12Hours(
            scheduledShift.startTimeIso,
            businessDate,
            shiftDirection
          )
          if (scheduledShift.endTimeIso) {
            effectiveSchedEnd = shiftTimeBy12Hours(
              scheduledShift.endTimeIso,
              businessDate,
              shiftDirection
            )
          }
          wasAmPmAdjusted = true
        }
      }

      const pEval = evaluateClockInPunctuality({
        businessDate,
        scheduledStartTime: effectiveSchedStart,
        actualClockInTime: ronosClockIn,
        addedPunch: clockInAddedPunch,
        shiftNotes: scheduledShift.notes,
        isCallback: scheduledShift.isCallback,
        toastClockInTime: toastSummary.clockInTime,
        hasStoreCoverageGap: params.storeCoverageContext?.hasStoreCoverageGap,
        absentOrLateCoworkersCount: params.storeCoverageContext?.absentOrLateCoworkersCount,
      })

      if (pEval) {
        diffMinutesFromSchedule = pEval.diffMinutes
        isAuthorizedEarlyCallIn = pEval.isAuthorizedEarlyCallIn
        exemptionReason = pEval.exemptionReason
        earlyCallInSignals = pEval.earlyCallInSignals

        if (wasAmPmAdjusted) {
          const amPmNote = 'Turno AM/PM ajustado en evaluación'
          exemptionReason = exemptionReason ? `${exemptionReason} | ${amPmNote}` : amPmNote
        }

        if (pEval.status === 'ON_TIME') {
          punctualityStatus = 'ON_TIME'
          punctualityLabelEs = wasAmPmAdjusted
            ? 'A Tiempo (±3 min) — Turno AM/PM ajustado en evaluación'
            : 'A Tiempo (±3 min)'
          punctualityLabelEn = wasAmPmAdjusted
            ? 'On Time (±3 min) — AM/PM Planner Shift Adjusted'
            : 'On Time (±3 min)'
          punctualityBadgeColor = 'emerald'
        } else if (pEval.status === 'AUTHORIZED_EARLY_CALL_IN') {
          punctualityStatus = 'AUTHORIZED_EARLY_CALL_IN'
          punctualityLabelEs = `Cobertura / Emergencia Autorizada (${Math.abs(pEval.diffMinutes)}m antes)${wasAmPmAdjusted ? ' — Turno AM/PM ajustado en evaluación' : ''}`
          punctualityLabelEn = `Authorized Coverage / Call-In (${Math.abs(pEval.diffMinutes)}m early)${wasAmPmAdjusted ? ' — AM/PM Planner Shift Adjusted' : ''}`
          punctualityBadgeColor = 'sky'
        } else if (pEval.status === 'UNAUTHORIZED_EARLY_IN') {
          punctualityStatus = 'UNAUTHORIZED_EARLY_IN'
          punctualityLabelEs = `Entrada Temprana No Autorizada (${pEval.earlyMinutes}m antes)${wasAmPmAdjusted ? ' — Turno AM/PM ajustado en evaluación' : ''}`
          punctualityLabelEn = `Unauthorized Early Clock-In (${pEval.earlyMinutes}m early)${wasAmPmAdjusted ? ' — AM/PM Planner Shift Adjusted' : ''}`
          punctualityBadgeColor = 'amber'
          violations.push({
            type: 'UNAUTHORIZED_EARLY_IN',
            category: 'punctuality',
            severity: 'warning',
            uiSeverity: 'warning',
            isViolation: true,
            title: pEval.title,
            description: pEval.description,
            policyReference:
              'Manual del Empleado NHP TEG SPANISH.pdf (p. 3 y p. 10 — Asistencia y Puntualidad: Margen ±3 min)',
            actionRequired:
              'Respetar estrictamente el horario publicado en el Planificador y no fichar más de 3 minutos antes de su turno sin autorización expresa del Gerente.',
            estimatedCostUsd: 0,
            minutes: pEval.earlyMinutes,
            diffMinutes: pEval.diffMinutes,
          })
        } else if (pEval.status === 'LATE_CLOCK_IN') {
          punctualityStatus = 'LATE_CLOCK_IN'
          punctualityLabelEs = `Tardanza (+${pEval.lateMinutes} min)${wasAmPmAdjusted ? ' — Turno AM/PM ajustado en evaluación' : ''}`
          punctualityLabelEn = `Late Clock-In (+${pEval.lateMinutes} min)${wasAmPmAdjusted ? ' — AM/PM Planner Shift Adjusted' : ''}`
          punctualityBadgeColor = 'rose'
          violations.push({
            type: 'LATE_CLOCK_IN',
            category: 'punctuality',
            severity: 'danger',
            uiSeverity: 'critical',
            isViolation: true,
            title: pEval.title,
            description: pEval.description,
            policyReference:
              'Manual del Empleado NHP TEG SPANISH.pdf (p. 3 y p. 10 — Asistencia y Puntualidad: Margen ±3 min)',
            actionRequired:
              'Presentarse y fichar su entrada en la tableta de RONOS puntualmente a la hora de inicio de su turno (máximo 3 minutos de margen).',
            estimatedCostUsd: 0,
            minutes: pEval.lateMinutes,
            diffMinutes: pEval.diffMinutes,
          })
        }
      }

      // Evaluar Salida Temprana (EARLY_CLOCK_OUT: >= 15 min antes del fin del turno programado)
      if (effectiveSchedEnd && ronosClockOut) {
        const schedStartP = parseTimeInLA(effectiveSchedStart, businessDate)
        const schedEndP = parseTimeInLA(effectiveSchedEnd, businessDate)
        const actualOutP = parseTimeInLA(ronosClockOut, businessDate)

        if (schedStartP && schedEndP && actualOutP) {
          let schedEndMin = schedEndP.relativeMinutesFromBizDate
          if (schedEndMin < schedStartP.relativeMinutesFromBizDate) {
            schedEndMin += 1440
          }
          let actualOutMin = actualOutP.relativeMinutesFromBizDate
          if (actualOutMin < schedStartP.relativeMinutesFromBizDate - 120) {
            actualOutMin += 1440
          }

          endDiffMinutesFromSchedule = actualOutMin - schedEndMin

          if (
            endDiffMinutesFromSchedule <= NHP_EARLY_OUT_THRESHOLD_MINUTES &&
            !clockOutAddedPunch &&
            !hasCoverageOrEmergencyShiftNote(scheduledShift.notes, false)
          ) {
            const earlyOutMins = Math.abs(endDiffMinutesFromSchedule)
            violations.push({
              type: 'EARLY_CLOCK_OUT',
              category: 'punctuality',
              severity: 'warning',
              uiSeverity: 'warning',
              isViolation: true,
              title: 'Salida Temprana sin Autorización Registrada',
              description: `Fichó su salida a las ${actualOutP.display12h} (${earlyOutMins} minutos antes del fin de su turno programado a las ${schedEndP.display12h}).`,
              policyReference:
                'Manual del Empleado NHP TEG SPANISH.pdf (p. 3 y p. 10 — Cumplimiento de Turno Completo)',
              actionRequired:
                'Cumplir su horario completo hasta la hora de salida programada o contar con autorización del Gerente de Tienda antes de retirarse.',
              estimatedCostUsd: 0,
              minutes: earlyOutMins,
              diffMinutes: endDiffMinutesFromSchedule,
            })
          }
        }
      }
    } else if (toastSummary.hasToastPunches) {
      // Tiene turno programado y trabajó en Toast POS, pero no fichó entrada en RONOS
      punctualityStatus = 'REPAIR_RONOS_PUNCH'
      punctualityLabelEs = 'Reparar Ponchada en RONOS (Trabajó en Toast POS)'
      punctualityLabelEn = 'Repair RONOS Punch (Worked in Toast POS)'
      punctualityBadgeColor = 'purple'
    } else if (isSick || isVacation || isHoliday) {
      punctualityStatus = 'REST_OR_PTO'
      punctualityLabelEs = isSick
        ? 'Ausencia por Enfermedad (Sick)'
        : isVacation
          ? 'Vacaciones Autorizadas'
          : 'Día Festivo (Holiday)'
      punctualityLabelEn = isSick
        ? 'Sick Leave'
        : isVacation
          ? 'Approved Vacation'
          : 'Holiday'
      punctualityBadgeColor = 'sky'
    } else {
      // Verificar si el turno corresponde a un día futuro o aún no ha iniciado hoy (respetando día laboral 06:00 AM - 05:59 AM)
      let shiftStillInFuture = false
      if (params.asOfDate) {
        const nowP = parseTimeInLA(params.asOfDate, businessDate)
        const schedStartP = parseTimeInLA(scheduledShift.startTimeIso, businessDate)
        if (nowP) {
          let nowBizDate = nowP.dateStr
          if (nowP.hour < 6) {
            const dIdx = dateStrToUtcDayIndex(nowP.dateStr)
            if (dIdx !== null) {
              nowBizDate = new Date((dIdx - 1) * 86_400_000).toISOString().slice(0, 10)
            }
          }
          if (businessDate > nowBizDate) {
            shiftStillInFuture = true
          } else if (
            businessDate === nowBizDate &&
            schedStartP &&
            nowP.relativeMinutesFromBizDate < schedStartP.relativeMinutesFromBizDate + 15
          ) {
            shiftStillInFuture = true
          }
        }
      }

      if (shiftStillInFuture) {
        punctualityStatus = 'NO_SHIFT_NO_PUNCH'
        punctualityLabelEs = 'Turno Programado (Pendiente de Inicio)'
        punctualityLabelEn = 'Scheduled Shift (Upcoming)'
        punctualityBadgeColor = 'sky'
      } else {
        punctualityStatus = 'NO_SHOW'
        punctualityLabelEs = 'Inasistencia a Turno Programado'
        punctualityLabelEn = 'Unexcused Absence (No Show)'
        punctualityBadgeColor = 'rose'
        violations.push({
          type: 'NO_SHOW',
          category: 'attendance',
          severity: 'danger',
          uiSeverity: 'critical',
          isViolation: true,
          title: 'Inasistencia a Turno Programado sin Autorización',
          description: `Tenía turno publicado en el Planificador (${scheduledShift.startTimeLA || '--:--'} - ${scheduledShift.endTimeLA || '--:--'}), pero no registra ponchadas ni en RONOS ni en Toast POS, ni cuenta con licencia registrada.`,
          policyReference:
            'Manual del Empleado NHP TEG SPANISH.pdf (p. 3 y p. 10 — Asistencia e Inasistencias No Autorizadas)',
          actionRequired:
            'Notificar a su Gerente de Tienda con al menos 2 horas de anticipación ante cualquier imprevisto. El Gerente debe verificar si hubo cambio de turno o falta injustificada.',
          estimatedCostUsd: 0,
        })
      }
    }
  } else {
    // Sin turno publicado en el Planificador para este día
    if (hasRonosPunches) {
      punctualityStatus = 'UNSCHEDULED_WORKED'
      punctualityLabelEs = 'Turno Trabajado (Sin Horario en Planificador)'
      punctualityLabelEn = 'Worked Shift (Unscheduled in Planner)'
      punctualityBadgeColor = 'sky'
    } else if (toastSummary.hasToastPunches) {
      punctualityStatus = 'REPAIR_RONOS_PUNCH'
      punctualityLabelEs = 'Reparar Ponchada en RONOS (Trabajó en Toast POS)'
      punctualityLabelEn = 'Repair RONOS Punch (Worked in Toast POS)'
      punctualityBadgeColor = 'purple'
    } else if (isSick || isVacation || isHoliday) {
      punctualityStatus = 'REST_OR_PTO'
      punctualityLabelEs = isSick ? 'Enfermedad (Sick)' : isVacation ? 'Vacaciones' : 'Holiday'
      punctualityLabelEn = isSick ? 'Sick Leave' : isVacation ? 'Vacation' : 'Holiday'
      punctualityBadgeColor = 'sky'
    }
  }

  // 6. Evaluar Política de Comida y Tarjeta Rota en RONOS
  const mealAndCardViolations = evaluateRonosMealAndTimecardPolicy({
    businessDate,
    ronosDay: {
      ...rDay,
      clockInTime: ronosClockIn,
      clockOutTime: ronosClockOut,
      lunchStartTime: ronosLunchStart,
      lunchEndTime: ronosLunchEnd,
      lunchDurationMinutes: ronosLunchMinutes,
      totalHours: ronosTotalHours,
    },
    toastSummary,
    hourlyWage: safeNum(params.payRate, 19.5) || 19.5,
    isCurrentOpenShift: params.isCurrentOpenShift,
  })

  for (const mv of mealAndCardViolations) {
    // Evitar duplicar BROKEN_TIMECARD si ya hay REPAIR_RONOS_PUNCH que cubre exactamente la misma ponchada faltante,
    // o incluir ambos cuando aporten evidencia complementaria
    violations.push(mv)
  }

  // Si hay discrepancia Toast vs RONOS y el estado de puntualidad era genérico, destacar la reparación
  if (discrepancyCheck.hasDiscrepancy && punctualityStatus === 'UNSCHEDULED_WORKED') {
    punctualityStatus = 'REPAIR_RONOS_PUNCH'
    punctualityLabelEs = 'Reparar Ponchada en RONOS (Discrepancia Toast POS)'
    punctualityLabelEn = 'Repair RONOS Punch (Toast POS Discrepancy)'
    punctualityBadgeColor = 'purple'
  }

  const hasAnyActiveViolation = violations.some((v) => v.isViolation)

  return {
    businessDate,
    isExemptSalaried: false,
    salariedExemptionReason: null,
    punctualityStatus,
    punctualityLabelEs,
    punctualityLabelEn,
    punctualityBadgeColor,
    diffMinutesFromSchedule,
    endDiffMinutesFromSchedule,
    isViolation: hasAnyActiveViolation,
    isAuthorizedEarlyCallIn,
    exemptionReason,
    earlyCallInSignals,
    hasToastRonosDiscrepancy: discrepancyCheck.hasDiscrepancy,
    discrepancyDetails: discrepancyCheck.details,
    requiresMedicalNote: sickCheck.requiresMedicalNote,
    consecutiveSickDays: sickCheck.consecutiveSickDays,
    scheduledShift,
    toastSummary,
    ronosSummary,
    violations,
  }
}

// ============================================================================
// 9. PLANTILLAS HTML OFICIALES DE CORREO (EMPLEADO Y GERENTE DE TIENDA)
// ============================================================================

export interface EmployeeRonosPolicyEmailParams {
  storeName: string
  employeeName: string
  employeeJobTitle?: string | null
  businessDate: string
  evaluation: RonosDayAttendanceEvaluation
  managerContactEmail?: string | null
  managerName?: string | null
  warningStage?: 'first' | 'second' | 'suspension'
  additionalNotes?: string | null
}

/**
 * Construye el correo individual oficial para el empleado cuando se detectan infracciones a la política
 * de asistencia (±3 min), comida (30 min / 5ta hora) o discrepancias Toast POS vs RONOS que requieren
 * reparar su tarjeta de tiempo en RONOS para proteger su cheque de pago.
 * CERO mención de cualquier margen de tolerancia en comidas.
 */
export function buildEmployeeRonosPolicyEmailHtml(
  params: EmployeeRonosPolicyEmailParams
): { subject: string; html: string } {
  const {
    storeName,
    employeeName,
    employeeJobTitle,
    businessDate,
    evaluation,
    managerContactEmail,
    managerName,
    warningStage = 'first',
    additionalNotes,
  } = params

  const activeViolations = evaluation.violations.filter((v) => v.isViolation)
  const hasRepairAlert = activeViolations.some(
    (v) => v.type === 'REPAIR_RONOS_PUNCH' || v.type === 'BROKEN_TIMECARD'
  )
  const primaryTitle =
    activeViolations[0]?.title || 'Revisión de Asistencia y Ponchadas en RONOS'

  const subjectPrefix = hasRepairAlert
    ? '🔧 Acción Requerida (Protección de Cheque de Pago): Reparar Ponchada en RONOS'
    : '⚠️ Aviso Oficial de Asistencia y Cumplimiento Laboral (RONOS)'
  const subject = `${subjectPrefix} — ${storeName} (${businessDate})`

  const stageLabel =
    warningStage === 'suspension'
      ? '🚨 3er Aviso • Suspensión'
      : warningStage === 'second'
        ? '⚠️ 2do Aviso Formal'
        : '📌 Aviso Oficial de Monitoreo'

  const schedText = evaluation.scheduledShift.hasPublishedShift
    ? `${evaluation.scheduledShift.startTimeLA || '--:--'} a ${evaluation.scheduledShift.endTimeLA || '--:--'}`
    : 'Sin turno publicado en Planificador'

  const violationsCardsHtml = activeViolations
    .map((v) => {
      const isRepair = v.type === 'REPAIR_RONOS_PUNCH' || v.type === 'BROKEN_TIMECARD'
      const borderColor = isRepair ? '#7c3aed' : v.severity === 'danger' ? '#dc2626' : '#d97706'
      const bgColor = isRepair ? '#f5f3ff' : v.severity === 'danger' ? '#fef2f2' : '#fffbeb'
      const titleColor = isRepair ? '#5b21b6' : v.severity === 'danger' ? '#991b1b' : '#92400e'

      return `
        <div style="background-color: ${bgColor}; border-left: 4px solid ${borderColor}; padding: 14px 16px; border-radius: 8px; margin-bottom: 12px;">
          <div style="font-weight: 800; color: ${titleColor}; font-size: 14px; margin-bottom: 4px;">
            ${isRepair ? '🔧' : '⚠️'} ${escapeHtmlSafe(v.title)}
          </div>
          <p style="margin: 0 0 8px 0; color: #1f2937; font-size: 13px; line-height: 1.55;">
            ${escapeHtmlSafe(v.description)}
          </p>
          <div style="font-size: 12px; color: #475569; line-height: 1.45;">
            <strong>Acción requerida:</strong> ${escapeHtmlSafe(v.actionRequired)}
          </div>
        </div>
      `
    })
    .join('')

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; max-width: 660px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #b91c1c; color: #ffffff; padding: 22px 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; opacity: 0.92;">
            TACOS GAVILAN • CONTROL DE ASISTENCIA Y NÓMINA (RONOS)
          </div>
        </div>
        <h2 style="margin: 6px 0 4px 0; font-size: 20px; font-weight: 800; text-transform: uppercase;">
          ${escapeHtmlSafe(primaryTitle)}
        </h2>
        <p style="margin: 0; opacity: 0.95; font-size: 13px;">
          Sucursal: <strong>${escapeHtmlSafe(storeName)}</strong> • Jornada: <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong> • <span>${stageLabel}</span>
        </p>
      </div>

      <div style="padding: 24px;">
        <p style="font-size: 15px; margin-top: 0;">
          Hola <strong>${escapeHtmlSafe(employeeName)}</strong>${employeeJobTitle ? ` (${escapeHtmlSafe(employeeJobTitle)})` : ''},
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #374151;">
          El sistema central de auditoría laboral de <strong>Tacos Gavilan</strong> comparó tu horario publicado en el <strong>Planificador</strong>, tus ponchadas en el punto de venta (<strong>Toast POS</strong>) y tu tarjeta oficial de nómina en <strong>RONOS (Cingular HR)</strong> correspondiente al <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong>, detectando lo siguiente:
        </p>

        ${violationsCardsHtml}

        <!-- Tabla Comparativa: Planificador vs RONOS vs Toast POS -->
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 18px 0;">
          <div style="font-size: 12px; font-weight: 800; color: #334155; text-transform: uppercase; margin-bottom: 10px;">
            📊 Comparativa Oficial de Registros (${escapeHtmlSafe(businessDate)})
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="background-color: #e2e8f0; color: #1e293b; text-align: left;">
                <th style="padding: 8px 10px;">Fuente</th>
                <th style="padding: 8px 10px;">Entrada</th>
                <th style="padding: 8px 10px;">Comida (Lunch)</th>
                <th style="padding: 8px 10px;">Salida</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 10px; font-weight: 700; color: #0f172a;">📅 Planificador</td>
                <td style="padding: 8px 10px;" colspan="3"><strong>${escapeHtmlSafe(schedText)}</strong></td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0; background-color: #ffffff;">
                <td style="padding: 8px 10px; font-weight: 700; color: #b91c1c;">⏱️ RONOS (Nómina)</td>
                <td style="padding: 8px 10px; font-weight: 700;">${escapeHtmlSafe(evaluation.ronosSummary.clockInLA || 'Sin registro')}</td>
                <td style="padding: 8px 10px;">${
                  evaluation.ronosSummary.lunchStartLA
                    ? `${escapeHtmlSafe(evaluation.ronosSummary.lunchStartLA)} ➔ ${escapeHtmlSafe(evaluation.ronosSummary.lunchEndLA || 'Sin regreso')} (${Math.floor(evaluation.ronosSummary.lunchDurationMinutes)}m)`
                    : 'Sin registro'
                }</td>
                <td style="padding: 8px 10px; font-weight: 700;">${escapeHtmlSafe(evaluation.ronosSummary.clockOutLA || 'Sin registro')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 10px; font-weight: 700; color: #4338ca;">🖥️ Toast POS (Tienda)</td>
                <td style="padding: 8px 10px;">${escapeHtmlSafe(evaluation.toastSummary.clockInLA || 'Sin registro')}</td>
                <td style="padding: 8px 10px;">${
                  evaluation.toastSummary.lunchStartLA
                    ? `${escapeHtmlSafe(evaluation.toastSummary.lunchStartLA)} ➔ ${escapeHtmlSafe(evaluation.toastSummary.lunchEndLA || 'Sin regreso')}`
                    : 'Sin registro'
                }</td>
                <td style="padding: 8px 10px;">${escapeHtmlSafe(evaluation.toastSummary.clockOutLA || 'Sin registro')}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Importancia Crítica para el Cheque de Pago -->
        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; border-radius: 8px; padding: 14px 16px; margin: 18px 0; font-size: 13px; color: #1e3a8a; line-height: 1.6;">
          <strong>💳 Importante: Tu Cheque de Pago Depende de tus Ponchadas en RONOS</strong><br/>
          Recuerda que tu nómina y tu <strong>cheque de pago</strong> se procesan directamente con las horas registradas en la tableta de <strong>RONOS (Cingular HR)</strong>. Ponchar solo en Toast POS no registra tu pago en nómina. Si olvidaste ponchar tu entrada, tu comida o tu salida en RONOS, es tu responsabilidad revisarlo y reportarlo hoy mismo a tu Gerente de Tienda para reparar tu tarjeta de tiempo.
        </div>

        <!-- Políticas Oficiales del Manual del Empleado (NHP TEG SPANISH.pdf) -->
        <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; margin: 18px 0; font-size: 12.5px; color: #334155; line-height: 1.6;">
          <div style="font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 6px;">
            📖 Políticas Oficiales del Manual del Empleado (NHP TEG SPANISH.pdf):
          </div>
          <ul style="margin: 0; padding-left: 18px;">
            <li style="margin-bottom: 5px;"><strong>Asistencia y Puntualidad (±3 minutos, p. 3 y p. 10):</strong> Debes fichar tu entrada dentro del margen estricto de <strong>±3 minutos</strong> respecto a tu hora programada en el Planificador (por ejemplo, para un turno de 9:00 AM, entre 8:57 AM y 9:03 AM). Queda prohibido fichar más de 3 minutos antes sin autorización del Gerente; fichar 4 o más minutos después (ej. 9:04 AM) se registra como tardanza.</li>
            <li style="margin-bottom: 5px;"><strong>Período de Comida y Descanso (p. 4 y p. 10 / California Labor Code § 512):</strong> En turnos mayores a 6 horas es obligatorio tomar un descanso de comida de <strong>30 minutos exactos</strong> ininterrumpidos, iniciándolo siempre <strong>antes de cumplir la 5ta hora de trabajo continuo</strong>, y registrar tanto la salida como el regreso puntualmente en RONOS.</li>
            <li><strong>Ausencias por Enfermedad (p. 3):</strong> Si te ausentas 3 o más turnos consecutivos por enfermedad, se requiere presentar justificante médico para tu reincorporación.</li>
          </ul>
        </div>

        ${
          additionalNotes
            ? `<div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 14px; margin: 16px 0; font-size: 13px; color: #92400e;">
                <strong>Nota de Gerencia:</strong> ${escapeHtmlSafe(additionalNotes)}
               </div>`
            : ''
        }

        <p style="font-size: 13px; color: #475569; line-height: 1.5;">
          Tu Gerente de Tienda${managerName ? ` (<strong>${escapeHtmlSafe(managerName)}</strong>)` : ''}${managerContactEmail ? ` — <a href="mailto:${escapeHtmlSafe(managerContactEmail)}" style="color: #b91c1c; font-weight: 600;">${escapeHtmlSafe(managerContactEmail)}</a>` : ''} y tu Supervisor de Zona han recibido copia de este aviso para apoyarte con la reparación de ponchadas o seguimiento correspondiente.
        </p>

        <div style="border-top: 1px solid #e5e7eb; margin-top: 20px; padding-top: 14px; font-size: 12px; color: #6b7280;">
          Atentamente,<br/>
          <strong>Sistema de Monitoreo</strong><br/>
          Tacos Gavilan
        </div>
      </div>
    </div>
  `

  return { subject, html }
}

export interface ManagerDailyRonosReportItem {
  employeeUserId: number
  employeeName: string
  jobTitle?: string | null
  evaluation: RonosDayAttendanceEvaluation
  deliveryStatusLabel: string
  emailDelivered: boolean
}

export interface ChainGeneralDailyStoreInput {
  storeName: string
  storeCode?: string | null
  ronosCompanyId?: number | null
  supervisorName?: string | null
  supervisorEmail?: string | null
  managerEmails?: string[]
  evaluatedHourlyCount: number
  exemptSalariedCount: number
  items: ManagerDailyRonosReportItem[]
  authorizedCallIns?: ManagerDailyRonosReportItem[]
  error?: string | null
}

export interface ChainDailyRonosGeneralReportParams {
  businessDate: string
  stores: ChainGeneralDailyStoreInput[]
  intendedTo: string[]
  intendedCc: string[]
  isSimulation?: boolean
  isManualDispatch?: boolean
  simulationRecipientEmail?: string | null
  simulationTag?: string | null
}

function countRonosReportCategories(items: ManagerDailyRonosReportItem[]): {
  punctualityCount: number
  repairCount: number
  mealCount: number
  totalViolationEvents: number
} {
  let punctualityCount = 0
  let repairCount = 0
  let mealCount = 0
  let totalViolationEvents = 0

  for (const item of items || []) {
    for (const v of item.evaluation?.violations || []) {
      if (!v.isViolation) continue
      totalViolationEvents++
      if (v.category === 'punctuality' || v.category === 'attendance') punctualityCount++
      else if (v.category === 'timecard_repair') repairCount++
      else if (v.category === 'meal_rest') mealCount++
    }
  }

  return { punctualityCount, repairCount, mealCount, totalViolationEvents }
}

function isPlannedOrDeliveredEmailItem(item: ManagerDailyRonosReportItem): boolean {
  if (item.emailDelivered) return true
  const label = String(item.deliveryStatusLabel || '').trim()
  if (!label) return false
  if (/sin correo|inv[áa]lido|error al enviar|no cuenta con/i.test(label)) return false
  return /(se enviar[ií]a|enviado|destinatario|@)/i.test(label)
}

function renderRonosReportTableRowHtml(
  item: ManagerDailyRonosReportItem,
  options?: { showViolationDescriptions?: boolean; compact?: boolean }
): string {
  const ev = item.evaluation
  const showDesc = Boolean(options?.showViolationDescriptions)
  const compact = Boolean(options?.compact)

  const schedStr = ev.scheduledShift.hasPublishedShift
    ? `${ev.scheduledShift.startTimeLA || '--'} - ${ev.scheduledShift.endTimeLA || '--'}`
    : 'Sin horario'
  const ronosLunch = ev.ronosSummary.lunchStartLA
    ? `<br><span class="sub">L: ${escapeHtmlSafe(ev.ronosSummary.lunchStartLA)}-${escapeHtmlSafe(ev.ronosSummary.lunchEndLA || '--')} (${Math.floor(safeNum(ev.ronosSummary.lunchDurationMinutes, 0))}m)</span>`
    : ''
  const toastLunch = ev.toastSummary.lunchStartLA
    ? `<br><span class="subt">L: ${escapeHtmlSafe(ev.toastSummary.lunchStartLA)}-${escapeHtmlSafe(ev.toastSummary.lunchEndLA || '--')}</span>`
    : ''

  if (compact) {
    const ronosHtml = ev.ronosSummary.hasRonosPunches
      ? `${escapeHtmlSafe(ev.ronosSummary.clockInLA || '--')} / ${escapeHtmlSafe(ev.ronosSummary.clockOutLA || '--')}${ronosLunch}`
      : '<span class="err">0 ponchadas</span>'
    const toastHtml = ev.toastSummary.hasToastPunches
      ? `${escapeHtmlSafe(ev.toastSummary.clockInLA || '--')} / ${escapeHtmlSafe(ev.toastSummary.clockOutLA || '--')}${toastLunch}`
      : '<span class="mut">Sin Toast</span>'
    const badges = (ev.violations || [])
      .filter((v) => v.isViolation)
      .map((v) => {
        const isRep = v.type === 'REPAIR_RONOS_PUNCH' || v.type === 'BROKEN_TIMECARD'
        const cls = isRep ? 'br' : v.severity === 'danger' ? 'bd' : 'bw'
        return `<div class="bm"><span class="b ${cls}">${escapeHtmlSafe(v.title)}</span></div>`
      })
      .join('')
    const isPlan = !item.emailDelivered && isPlannedOrDeliveredEmailItem(item)
    const stCls = item.emailDelivered ? 'sok' : isPlan ? 'spl' : 'smn'
    return `<tr><td class="nm">${escapeHtmlSafe(item.employeeName)}${item.jobTitle ? `<div class="jt">${escapeHtmlSafe(item.jobTitle)}</div>` : ''}</td><td class="nw">${escapeHtmlSafe(schedStr)}</td><td>${ronosHtml}</td><td>${toastHtml}</td><td>${badges}</td><td class="st ${stCls}">${escapeHtmlSafe(item.deliveryStatusLabel)}</td></tr>`
  }

  const ronosStr = ev.ronosSummary.hasRonosPunches
    ? `In: ${escapeHtmlSafe(ev.ronosSummary.clockInLA || '--')} | Out: ${escapeHtmlSafe(ev.ronosSummary.clockOutLA || '--')}${
        ev.ronosSummary.lunchStartLA
          ? `<br/><span style="font-size:11px;color:#64748b;">Lunch: ${escapeHtmlSafe(ev.ronosSummary.lunchStartLA)}-${escapeHtmlSafe(ev.ronosSummary.lunchEndLA || '--')} (${Math.floor(safeNum(ev.ronosSummary.lunchDurationMinutes, 0))}m)</span>`
          : ''
      }`
    : '<span style="color:#dc2626;font-weight:700;">0 ponchadas en RONOS</span>'
  const toastStr = ev.toastSummary.hasToastPunches
    ? `In: ${escapeHtmlSafe(ev.toastSummary.clockInLA || '--')} | Out: ${escapeHtmlSafe(ev.toastSummary.clockOutLA || '--')}${
        ev.toastSummary.lunchStartLA
          ? `<br/><span style="font-size:11px;color:#4338ca;">Lunch Toast: ${escapeHtmlSafe(ev.toastSummary.lunchStartLA)}-${escapeHtmlSafe(ev.toastSummary.lunchEndLA || '--')}</span>`
          : ''
      }`
    : '<span style="color:#94a3b8;">Sin registro Toast</span>'

  const badgesHtml = (ev.violations || [])
    .filter((v) => v.isViolation)
    .map((v) => {
      const isRepair = v.type === 'REPAIR_RONOS_PUNCH' || v.type === 'BROKEN_TIMECARD'
      const bg = isRepair ? '#ede9fe' : v.severity === 'danger' ? '#fee2e2' : '#fef3c7'
      const fg = isRepair ? '#5b21b6' : v.severity === 'danger' ? '#991b1b' : '#92400e'
      const descHtml = showDesc && v.description
        ? `<div style="font-size:11px;color:#475569;line-height:1.4;margin-top:2px;">${escapeHtmlSafe(v.description)}</div>`
        : ''
      return `<div style="margin-bottom:5px;"><span style="background:${bg};color:${fg};padding:2px 8px;border-radius:9999px;font-weight:700;font-size:11px;display:inline-block;">${escapeHtmlSafe(v.title)}</span>${descHtml}</div>`
    })
    .join('')

  const isPlannedSend = !item.emailDelivered && isPlannedOrDeliveredEmailItem(item)
  const statusColor = item.emailDelivered ? '#047857' : isPlannedSend ? '#0369a1' : '#b45309'

  return `
    <tr>
      <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-weight: 700; color: #111827; vertical-align: top;">
        ${escapeHtmlSafe(item.employeeName)}
        ${item.jobTitle ? `<div style="font-size:11px;color:#64748b;font-weight:400;">${escapeHtmlSafe(item.jobTitle)}</div>` : ''}
      </td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #1e293b; white-space: nowrap; vertical-align: top;">
        ${escapeHtmlSafe(schedStr)}
      </td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #1f2937; vertical-align: top;">
        ${ronosStr}
      </td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151; vertical-align: top;">
        ${toastStr}
      </td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top;">
        ${badgesHtml}
      </td>
      <td style="padding: 10px 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px; font-weight: 600; color: ${statusColor}; vertical-align: top;">
        ${escapeHtmlSafe(item.deliveryStatusLabel)}
      </td>
    </tr>
  `
}

/**
 * Construye el reporte diario consolidado de RONOS para el Gerente de Tienda (con CC al Supervisor de Zona),
 * detallando infracciones de puntualidad (±3 min), reparaciones Toast POS vs RONOS, infracciones de comida
 * y también los llamados de cobertura/emergencia exentos (`AUTHORIZED_EARLY_CALL_IN`).
 */
export function buildManagerDailyRonosReportHtml(params: {
  storeName: string
  businessDate: string
  items: ManagerDailyRonosReportItem[]
  authorizedCallIns?: ManagerDailyRonosReportItem[]
  isManualDispatch?: boolean
}): { subject: string; html: string } {
  const {
    storeName,
    businessDate,
    items,
    authorizedCallIns = [],
    isManualDispatch = false,
  } = params

  const { punctualityCount: totalPunctuality, repairCount: totalRepairs, mealCount: totalMeals } =
    countRonosReportCategories(items)

  const rowsHtml = items
    .map((item) => renderRonosReportTableRowHtml(item))
    .join('')

  const authorizedCallInsHtml =
    authorizedCallIns.length > 0
      ? `
        <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px 16px; margin-top: 18px; font-size: 12.5px; color: #0c4a6e;">
          <div style="font-weight: 800; font-size: 13px; margin-bottom: 6px;">
            🛡️ Entradas Tempranas Exentas Automáticamente por Cobertura / Solicitud Gerencial (${authorizedCallIns.length}):
          </div>
          <ul style="margin: 0; padding-left: 18px;">
            ${authorizedCallIns
              .map(
                (c) =>
                  `<li><strong>${escapeHtmlSafe(c.employeeName)}</strong>: Turno ${escapeHtmlSafe(c.evaluation.scheduledShift.startTimeLA || '--')} ➔ Entró ${escapeHtmlSafe(c.evaluation.ronosSummary.clockInLA || '--')} (${escapeHtmlSafe(c.evaluation.exemptionReason || AUTHORIZED_EARLY_CALL_IN_EXEMPTION_REASON)} — <em>No se envió alerta disciplinaria</em>)</li>`
              )
              .join('')}
          </ul>
        </div>
      `
      : ''

  const subject = `📋 Auditoría Diaria RONOS (Puntualidad ±3m, Comidas y Reparación de Ponchadas) — ${storeName} (${businessDate})`

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; max-width: 880px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #1e293b; color: #ffffff; padding: 22px 20px; text-align: center;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #fca5a5; margin-bottom: 4px;">
          TACOS GAVILAN • AUDITORÍA DIARIA RONOS & PLANIFICADOR
        </div>
        <h2 style="margin: 0; text-transform: uppercase; font-size: 19px; font-weight: 800;">
          Reporte Gerencial de Puntualidad (±3 min), Comidas y Reparación de Ponchadas
        </h2>
        <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">
          Sucursal: <strong>${escapeHtmlSafe(storeName)}</strong> — Jornada Auditada: <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong>
        </p>
        <p style="margin: 4px 0 0 0; font-size: 11px; opacity: 0.75;">
          ${isManualDispatch ? 'Despacho oficial ejecutado desde el panel de auditoría RONOS.' : 'Despacho diario automático tras el cierre de la jornada.'}
        </p>
      </div>

      <div style="padding: 24px;">
        <p style="margin-top: 0; font-size: 15px;">
          <strong>Estimado(a) Gerente de Tienda (${escapeHtmlSafe(storeName)}):</strong>
        </p>
        <p style="color: #374151; font-size: 14px; line-height: 1.6;">
          A continuación se presenta la auditoría cruzada entre el <strong>Horario Publicado del Planificador</strong>, las ponchadas de <strong>Toast POS</strong> y las tarjetas de nómina de <strong>RONOS (Cingular HR)</strong> del <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong>, conforme a las reglas del Manual del Empleado (<code>NHP TEG SPANISH.pdf</code>).
        </p>

        <!-- KPI Summary -->
        <table style="width: 100%; border-collapse: separate; border-spacing: 8px; margin: 16px 0;">
          <tr>
            <td style="width: 25%; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 8px; text-align: center;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #991b1b;">Empleados con Alerta</div>
              <div style="font-size: 22px; font-weight: 800; color: #b91c1c; margin-top: 2px;">${items.length}</div>
            </td>
            <td style="width: 25%; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 8px; text-align: center;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #92400e;">Puntualidad / Asistencia</div>
              <div style="font-size: 22px; font-weight: 800; color: #d97706; margin-top: 2px;">${totalPunctuality}</div>
            </td>
            <td style="width: 25%; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 12px 8px; text-align: center;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #5b21b6;">Reparar RONOS vs Toast</div>
              <div style="font-size: 22px; font-weight: 800; color: #7c3aed; margin-top: 2px;">${totalRepairs}</div>
            </td>
            <td style="width: 25%; background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 8px; padding: 12px 8px; text-align: center;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #9d174d;">Comidas (30m / 5ta Hora)</div>
              <div style="font-size: 22px; font-weight: 800; color: #be185d; margin-top: 2px;">${totalMeals}</div>
            </td>
          </tr>
        </table>

        <!-- Violations Table -->
        <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 12.5px; text-align: left;">
          <thead>
            <tr style="background-color: #f1f5f9; color: #334155; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 10px 8px;">Colaborador</th>
              <th style="padding: 10px 8px;">Turno Planificador</th>
              <th style="padding: 10px 8px;">Ponchadas RONOS</th>
              <th style="padding: 10px 8px;">Ponchadas Toast POS</th>
              <th style="padding: 10px 8px;">Infracción / Alerta</th>
              <th style="padding: 10px 8px;">Aviso al Empleado</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        ${authorizedCallInsHtml}

        <!-- Mandatory Manager Responsibilities Box -->
        <div style="background-color: #fff7ed; border: 1px solid #fdba74; border-left: 5px solid #ea580c; border-radius: 8px; padding: 16px 18px; margin-top: 22px; font-size: 13px; color: #431407; line-height: 1.6;">
          <div style="font-weight: 800; font-size: 14px; text-transform: uppercase; color: #9a3412; margin-bottom: 8px;">
            📌 Acciones Obligatorias del Gerente de Tienda Hoy Mismo:
          </div>
          <ol style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 6px;"><strong>Reparación Inmediata de Tarjetas en RONOS (Protección del Cheque de Pago):</strong> Revisar cada caso marcado como <em>Discrepancia Toast POS vs RONOS</em> o <em>Ponchada Incompleta</em> y reparar hoy mismo la ponchada en RONOS usando como referencia las horas de Toast POS para que el cheque de pago del colaborador salga completo y sin retrasos.</li>
            <li style="margin-bottom: 6px;"><strong>Control de Puntualidad (±3 minutos):</strong> Supervisar que ningún colaborador fiche más de 3 minutos antes de su turno sin autorización gerencial y dar seguimiento individual a las tardanzas (&ge; 4 min después de la hora programada).</li>
            <li style="margin-bottom: 6px;"><strong>Cumplimiento de Comidas (30 minutos exactos antes de la 5ta hora):</strong> Asegurar que todo turno mayor a 6 horas salga a comer antes de cumplir la 5ta hora de trabajo continuo y regrese puntualmente a los 30 minutos exactos.</li>
            <li><strong>Justificantes Médicos (3+ Turnos por Enfermedad):</strong> Solicitar comprobante médico oficial a cualquier colaborador que acumule 3 o más turnos consecutivos de ausencia por enfermedad antes de su reincorporación.</li>
          </ol>
        </div>

        <p style="font-size: 12px; color: #64748b; margin-top: 22px; text-align: center;">
          <strong>Sistema de Monitoreo</strong> — Tacos Gavilan (CC Supervisor de Zona).
        </p>
      </div>
    </div>
  `

  return { subject, html }
}


/**
 * Construye el Reporte General Diario de Cadena (Todas las Tiendas) dirigido a Liderazgo Ejecutivo,
 * Supervisores de Zona y Cingular HR (CC: Stephany@cingularhr.com, raquel@tacosgavilan.com),
 * consolidando KPIs globales, tabla resumen por sucursal, detalle compacto Planificador vs RONOS vs Toast POS
 * y exenciones automáticas por cobertura/emergencia gerencial.
 * Usa CSS compacto en `<style>` y `showViolationDescriptions: false` para mantener el peso < 85 KB (evitando recorte en Gmail).
 */
export function buildChainDailyRonosGeneralReportHtml(
  params: ChainDailyRonosGeneralReportParams
): { subject: string; html: string } {
  const {
    businessDate,
    stores = [],
    intendedTo = [],
    intendedCc = [],
    isSimulation = false,
    isManualDispatch = false,
    simulationRecipientEmail,
    simulationTag,
  } = params

  const normalizedCc = intendedCc.length > 0 ? intendedCc : RONOS_GENERAL_REPORT_CC
  const normalizedTo = intendedTo.length > 0 ? intendedTo : RONOS_GENERAL_REPORT_LEADERSHIP

  let auditedSuccessCount = 0
  let errorStoresCount = 0
  let totalEvaluatedHourly = 0
  let totalExemptSalaried = 0
  let totalAlertEmployees = 0
  let totalPunctuality = 0
  let totalRepairs = 0
  let totalMeals = 0
  let totalViolationEvents = 0
  let totalAuthorizedCallIns = 0
  let projectedEmployeeEmails = 0
  let projectedManagerReports = 0

  const storeStats = stores.map((store) => {
    const items = Array.isArray(store.items) ? store.items : []
    const callIns = Array.isArray(store.authorizedCallIns) ? store.authorizedCallIns : []
    const cats = countRonosReportCategories(items)
    const hasError = Boolean(store.error)

    if (hasError) errorStoresCount++
    else auditedSuccessCount++

    const hourlyCount = Math.max(0, safeNum(store.evaluatedHourlyCount, 0))
    const salariedCount = Math.max(0, safeNum(store.exemptSalariedCount, 0))

    totalEvaluatedHourly += hourlyCount
    totalExemptSalaried += salariedCount
    totalAlertEmployees += items.length
    totalPunctuality += cats.punctualityCount
    totalRepairs += cats.repairCount
    totalMeals += cats.mealCount
    totalViolationEvents += cats.totalViolationEvents
    totalAuthorizedCallIns += callIns.length

    for (const item of items) {
      if (isPlannedOrDeliveredEmailItem(item)) projectedEmployeeEmails++
    }
    if (items.length > 0) projectedManagerReports++

    return {
      store,
      items,
      callIns,
      cats,
      hasError,
      hourlyCount,
      salariedCount,
      managerEmails: Array.isArray(store.managerEmails) ? store.managerEmails : [],
    }
  })

  const missingEmployeeEmails = Math.max(0, totalAlertEmployees - projectedEmployeeEmails)
  const projectedTotalEmails = projectedEmployeeEmails + projectedManagerReports + 1

  const cleanSimTag = simulationTag ? String(simulationTag).trim() : ''
  const simPrefix = cleanSimTag ? `[SIMULACIÓN ${cleanSimTag}]` : '[SIMULACIÓN]'
  const subject = isSimulation
    ? `${simPrefix} Reporte General Diario de Auditoría RONOS (Todas las Tiendas) — ${businessDate}`
    : `📊 Reporte General Diario de Auditoría RONOS (Todas las Tiendas) — ${businessDate}`

  const simBanner = isSimulation
    ? `<div class="sim-box"><div class="sim-t">🧪 Simulación Segura Activa — Envío Exclusivo a Correo de Prueba</div><p style="margin:0 0 6px 0">Auditoría real en vivo enviada únicamente a ${simulationRecipientEmail ? `<strong>${escapeHtmlSafe(simulationRecipientEmail)}</strong>` : 'la cuenta de prueba'}. <strong>NO</strong> se enviaron correos a empleados, gerentes, supervisores ni a Cingular HR, y <strong>NO</strong> se escribió en <code>ronos_violation_notifications</code>.</p><div class="sim-in"><div><strong>Para (To):</strong> ${normalizedTo.map(escapeHtmlSafe).join(', ')}</div><div><strong>Copia (CC HR &amp; Op.):</strong> ${normalizedCc.map(escapeHtmlSafe).join(', ')}</div><div><strong>BCC:</strong> carlos@tacosgavilan.com</div><div class="sim-cnt"><strong>Proyección Producción (${escapeHtmlSafe(businessDate)}):</strong> ${projectedEmployeeEmails} avisos a empleados (${missingEmployeeEmails} sin correo) + ${projectedManagerReports} reportes de tienda + 1 reporte general = <strong>${projectedTotalEmails} correos</strong></div></div></div>`
    : ''

  const summaryRowsHtml = storeStats
    .map(({ store, items, callIns, cats, hasError, hourlyCount, salariedCount, managerEmails }) => {
      const supLabel = store.supervisorName
        ? `${escapeHtmlSafe(store.supervisorName)}${store.supervisorEmail ? `<div class="jt">${escapeHtmlSafe(store.supervisorEmail)}</div>` : ''}`
        : store.supervisorEmail
          ? escapeHtmlSafe(store.supervisorEmail)
          : '<span class="mut">No asignado</span>'
      const mgrLabel = managerEmails.length > 0 ? `<div class="jt">Mgr: ${managerEmails.map(escapeHtmlSafe).join(', ')}</div>` : ''
      const badge = hasError
        ? '<span class="b bd">⚠️ Error</span>'
        : items.length === 0
          ? '<span class="b bok">✅ 100%</span>'
          : '<span class="b bw">⚠️ Alertas</span>'
      const cA = items.length > 0 ? '#b91c1c' : '#059669'
      const cP = cats.punctualityCount > 0 ? '#d97706' : '#64748b'
      const cR = cats.repairCount > 0 ? '#7c3aed' : '#64748b'
      const cM = cats.mealCount > 0 ? '#be185d' : '#64748b'
      const cC = callIns.length > 0 ? '#0284c7' : '#64748b'
      return `<tr><td class="nm">${escapeHtmlSafe(store.storeName)}${mgrLabel}</td><td>${supLabel}</td><td class="c">${badge}</td><td class="c"><b>${hourlyCount}</b>${salariedCount > 0 ? `<div class="jt">+${salariedCount} ex</div>` : ''}</td><td class="c" style="font-weight:800;color:${cA}">${items.length}</td><td class="c" style="font-weight:700;color:${cP}">${cats.punctualityCount}</td><td class="c" style="font-weight:700;color:${cR}">${cats.repairCount}</td><td class="c" style="font-weight:700;color:${cM}">${cats.mealCount}</td><td class="c" style="font-weight:700;color:${cC}">${callIns.length}</td></tr>`
    })
    .join('')

  const storeDetailsHtml = storeStats
    .map(({ store, items, callIns, hasError, hourlyCount, salariedCount, managerEmails }) => {
      const storeBody = hasError
        ? `<div class="err-box"><strong>⚠️ Error de auditoría:</strong> ${escapeHtmlSafe(store.error)}</div>`
        : items.length === 0
          ? '<div class="ok-box">✅ Sin infracciones ni reparaciones pendientes en esta sucursal.</div>'
          : `<table class="tg-tbl" cellspacing="0" cellpadding="0"><thead><tr><th>Colaborador</th><th>Planificador</th><th>RONOS</th><th>Toast POS</th><th>Infracción / Alerta</th><th>Aviso</th></tr></thead><tbody>${items.map((it) => renderRonosReportTableRowHtml(it, { showViolationDescriptions: false, compact: true })).join('')}</tbody></table>`

      const callInsHtml = callIns.length > 0
        ? `<div class="ci-box"><strong>🛡️ Coberturas Exentas (${callIns.length}):</strong><ul>${callIns.map((c) => `<li><b>${escapeHtmlSafe(c.employeeName)}</b>: ${escapeHtmlSafe(c.evaluation.scheduledShift.startTimeLA || '--')} ➔ ${escapeHtmlSafe(c.evaluation.ronosSummary.clockInLA || '--')} — ${escapeHtmlSafe(c.evaluation.exemptionReason || AUTHORIZED_EARLY_CALL_IN_EXEMPTION_REASON)}${c.evaluation.earlyCallInSignals.length > 0 ? ` <span class="ci-sig">(${c.evaluation.earlyCallInSignals.map(escapeHtmlSafe).join('; ')})</span>` : ''}</li>`).join('')}</ul></div>`
        : ''

      return `<div class="tg-card"><div class="tg-ch"><div class="tg-ct">🏪 ${escapeHtmlSafe(store.storeName)} <span class="tg-cs">(${hourlyCount} eval • ${salariedCount} ex • ${items.length} alerta)</span></div><div class="tg-cm"><b>Sup:</b> ${escapeHtmlSafe(store.supervisorName || 'N/A')}${store.supervisorEmail ? ` (${escapeHtmlSafe(store.supervisorEmail)})` : ''} • <b>Mgr:</b> ${managerEmails.length > 0 ? managerEmails.map(escapeHtmlSafe).join(', ') : 'N/A'}</div></div><div class="tg-cb">${storeBody}${callInsHtml}</div></div>`
    })
    .join('')

  const allCallInsList: Array<{ storeName: string; item: ManagerDailyRonosReportItem }> = []
  for (const { store, callIns } of storeStats) {
    for (const c of callIns) allCallInsList.push({ storeName: store.storeName, item: c })
  }

  const consolidatedCallInsHtml = allCallInsList.length > 0
    ? `<div class="ci-all"><div class="ci-allt">🛡️ Exenciones Automáticas por Cobertura / Emergencia Gerencial (${allCallInsList.length})</div><table class="tg-tbl" cellspacing="0" cellpadding="0"><thead><tr><th>Sucursal</th><th>Colaborador</th><th>Turno ➔ RONOS</th><th>Motivo y Evidencia</th></tr></thead><tbody>${allCallInsList.map(({ storeName: stName, item }) => { const ev = item.evaluation; return `<tr><td class="nm">${escapeHtmlSafe(stName)}</td><td><b>${escapeHtmlSafe(item.employeeName)}</b></td><td class="nw">${escapeHtmlSafe(ev.scheduledShift.startTimeLA || '--')} ➔ <b>${escapeHtmlSafe(ev.ronosSummary.clockInLA || '--')}</b></td><td><b>${escapeHtmlSafe(ev.exemptionReason || AUTHORIZED_EARLY_CALL_IN_EXEMPTION_REASON)}</b>${ev.earlyCallInSignals.length > 0 ? `<div class="ci-sig">${ev.earlyCallInSignals.map(escapeHtmlSafe).join(' • ')}</div>` : ''}</td></tr>` }).join('')}</tbody></table></div>`
    : '<div class="ci-none">🛡️ <strong>Exenciones por Cobertura / Emergencia Gerencial:</strong> Sin registros en esta jornada.</div>'

  const css = `<style>.tg-w{font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:980px;margin:0 auto;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden;background:#fff}.tg-hd{background:#0f172a;color:#fff;padding:18px 20px;border-top:5px solid #dc2626;text-align:center}.tg-bd{padding:18px}.sim-box{background:#fffbeb;border:2px solid #f59e0b;border-left:5px solid #d97706;border-radius:8px;padding:12px 14px;margin-bottom:14px;color:#78350f;font-size:12.5px;line-height:1.5}.sim-t{font-size:13px;font-weight:800;text-transform:uppercase;color:#92400e;margin-bottom:4px}.sim-in{background:#fff;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;margin-top:6px}.sim-cnt{margin-top:6px;padding-top:6px;border-top:1px dashed #fcd34d}.tg-dist{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:11.5px;color:#334155}.kpi{width:100%;border-collapse:separate;border-spacing:6px;margin:6px 0 14px}.kpi td{width:25%;border-radius:8px;padding:9px 6px;text-align:center;border:1px solid #cbd5e1}.kl{font-size:9.5px;font-weight:700;text-transform:uppercase}.kv{font-size:20px;font-weight:800;margin-top:2px}.ks{font-size:9.5px}.tg-h3{font-size:13.5px;font-weight:800;color:#0f172a;margin:16px 0 8px;text-transform:uppercase}.tg-tbl{width:100%;border-collapse:collapse;font-size:11.5px;text-align:left;border:1px solid #cbd5e1}.tg-tbl th{background:#f1f5f9;color:#334155;padding:7px 6px;border-bottom:2px solid #cbd5e1;font-size:11px}.tg-sum th{background:#1e293b;color:#fff;padding:8px 6px;font-size:11px}.tg-tbl td,.tg-sum td{padding:7px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top}.c{text-align:center}.nm{font-weight:700;color:#111827}.nw{white-space:nowrap}.jt{font-size:10px;color:#64748b;font-weight:400}.sub{font-size:10px;color:#64748b}.subt{font-size:10px;color:#4338ca}.mut{color:#94a3b8}.err{color:#dc2626;font-weight:700}.b{padding:2px 7px;border-radius:9999px;font-weight:700;font-size:10.5px;display:inline-block}.bm{margin-bottom:3px}.bd{background:#fee2e2;color:#991b1b}.bw{background:#fef3c7;color:#92400e}.br{background:#ede9fe;color:#5b21b6}.bok{background:#d1fae5;color:#065f46}.st{font-size:11px;font-weight:600}.sok{color:#047857}.spl{color:#0369a1}.smn{color:#b45309}.tg-card{border:1px solid #cbd5e1;border-radius:8px;margin-top:12px;overflow:hidden}.tg-ch{background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:9px 12px}.tg-ct{font-size:13.5px;font-weight:800;color:#0f172a}.tg-cs{font-size:11px;font-weight:700;color:#475569;margin-left:6px}.tg-cm{font-size:11px;color:#475569;margin-top:2px}.tg-cb{padding:10px 12px}.ok-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;color:#166534;font-size:12px;font-weight:600}.err-box{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;color:#991b1b;font-size:12px}.ci-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:11.5px;color:#0c4a6e}.ci-box ul{margin:4px 0 0;padding-left:16px}.ci-sig{color:#0369a1;font-size:10.5px}.ci-all{background:#f0f9ff;border:1px solid #7dd3fc;border-left:5px solid #0284c7;border-radius:8px;padding:12px 14px;margin-top:16px;color:#0c4a6e}.ci-allt{font-size:13px;font-weight:800;text-transform:uppercase;margin-bottom:6px}.ci-none{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-top:16px;font-size:12px;color:#475569}.tg-ft{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;margin-top:16px;font-size:11.5px;color:#475569;line-height:1.45}.tg-cp{font-size:11.5px;color:#64748b;margin-top:16px;text-align:center}</style>`

  const html = `<div class="tg-w">${css}<div class="tg-hd"><div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#fca5a5;margin-bottom:4px">TACOS GAVILAN • DIRECCIÓN DE OPERACIONES &amp; CINGULAR HR (RONOS)</div><h2 style="margin:0;font-size:19px;font-weight:800;text-transform:uppercase">${isSimulation ? `${escapeHtmlSafe(simPrefix)} ` : ''}Reporte General Diario de Auditoría RONOS (Todas las Tiendas)</h2><p style="margin:6px 0 0;font-size:13px">Jornada Auditada: <strong>${escapeHtmlSafe(formatBusinessDateEs(businessDate))}</strong> (${escapeHtmlSafe(businessDate)})</p><p style="margin:3px 0 0;font-size:11px;opacity:.85">${isSimulation ? 'Simulación Segura — Evaluación en vivo sin despacho real ni escritura en BD.' : isManualDispatch ? 'Despacho manual desde el panel administrativo.' : 'Despacho diario automático (11:59 AM hora de California).'}</p></div><div class="tg-bd">${simBanner}<div class="tg-dist"><strong>Distribución Oficial:</strong> Para: <b>${normalizedTo.map(escapeHtmlSafe).join(', ')}</b> • CC: <b>${normalizedCc.map(escapeHtmlSafe).join(', ')}</b></div><table class="kpi"><tr><td style="background:#f8fafc"><div class="kl" style="color:#475569">Tiendas Auditadas</div><div class="kv" style="color:#0f172a">${auditedSuccessCount} / ${stores.length}</div>${errorStoresCount > 0 ? `<div class="ks" style="color:#b91c1c;font-weight:700">${errorStoresCount} con error</div>` : ''}</td><td style="background:#f0fdf4;border-color:#bbf7d0"><div class="kl" style="color:#166534">Colaboradores Evaluados</div><div class="kv" style="color:#15803d">${totalEvaluatedHourly}</div><div class="ks" style="color:#166534">Personal por hora</div></td><td style="background:#fef2f2;border-color:#fecaca"><div class="kl" style="color:#991b1b">Total de Alertas</div><div class="kv" style="color:#b91c1c">${totalViolationEvents}</div><div class="ks" style="color:#991b1b">${totalAlertEmployees} colaboradores</div></td><td style="background:#fffbeb;border-color:#fde68a"><div class="kl" style="color:#92400e">Puntualidad ±3m / No-Show</div><div class="kv" style="color:#d97706">${totalPunctuality}</div></td></tr><tr><td style="background:#f5f3ff;border-color:#ddd6fe"><div class="kl" style="color:#5b21b6">Reparar RONOS vs Toast</div><div class="kv" style="color:#7c3aed">${totalRepairs}</div></td><td style="background:#fdf2f8;border-color:#fbcfe8"><div class="kl" style="color:#9d174d">Comidas (30m / 5ta Hr)</div><div class="kv" style="color:#be185d">${totalMeals}</div></td><td style="background:#f0f9ff;border-color:#bae6fd"><div class="kl" style="color:#075985">Exentos Cobertura</div><div class="kv" style="color:#0284c7">${totalAuthorizedCallIns}</div></td><td style="background:#f1f5f9"><div class="kl" style="color:#334155">Asalariados Exentos</div><div class="kv" style="color:#1e293b">${totalExemptSalaried}</div><div class="ks" style="color:#475569">Managers / Sup.</div></td></tr></table><h3 class="tg-h3">📋 Resumen Ejecutivo por Sucursal</h3><table class="tg-tbl tg-sum" cellspacing="0" cellpadding="0"><thead><tr><th>Sucursal</th><th>Supervisor</th><th class="c">Estado</th><th class="c">Eval.</th><th class="c">Alerta</th><th class="c">Punt.</th><th class="c">Reparar</th><th class="c">Comida</th><th class="c">Ex.Cob</th></tr></thead><tbody>${summaryRowsHtml}</tbody><tfoot><tr style="background:#f1f5f9;font-weight:800;color:#0f172a;border-top:2px solid #94a3b8"><td colspan="3">TOTAL CADENA (${stores.length} sucursales)</td><td class="c">${totalEvaluatedHourly} (+${totalExemptSalaried} ex)</td><td class="c" style="color:#b91c1c">${totalAlertEmployees}</td><td class="c" style="color:#d97706">${totalPunctuality}</td><td class="c" style="color:#7c3aed">${totalRepairs}</td><td class="c" style="color:#be185d">${totalMeals}</td><td class="c" style="color:#0284c7">${totalAuthorizedCallIns}</td></tr></tfoot></table><h3 class="tg-h3">🔍 Detalle por Sucursal y Colaborador (Planificador vs RONOS vs Toast POS)</h3>${storeDetailsHtml}${consolidatedCallInsHtml}<div class="tg-ft"><strong>Políticas Aplicadas (NHP TEG SPANISH.pdf &amp; CA Labor Code § 512):</strong> Puntualidad estricta de ±3 min frente al Planificador (con exención automática por llamado gerencial/cobertura o ajuste AM/PM), reparación obligatoria de RONOS frente a Toast POS para proteger el cheque de pago, comida de 30 minutos exactos antes de la 5ta hora en turnos &gt; 6h, y exclusión de Managers y Supervisores asalariados.</div><p class="tg-cp"><strong>Sistema de Monitoreo</strong> — Tacos Gavilan • Reporte General de Cadena (CC: ${normalizedCc.map(escapeHtmlSafe).join(', ')})</p></div></div>`

  return { subject, html }
}

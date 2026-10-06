/**
 * @module business-date
 * @description Utilidades para el manejo de fechas de negocio en Tacos Gavilan bajo zona horaria America/Los_Angeles y regla laboral de 6 AM.
 * @businessRules
 * - La zona horaria operativa es estrictamente 'America/Los_Angeles' (Pacific Time).
 * - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día calendario siguiente.
 * - El turno PM comprende desde las 5:00 PM (17:00) hasta las 5:59 AM del siguiente día.
 * - El turno AM (Apertura) comprende desde las 6:00 AM hasta las 4:59 PM (16:59).
 */

export function getCaliforniaDate(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) // returns YYYY-MM-DD
}

export function getCaliforniaBusinessDate(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const laDateStr = d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  const laDate = new Date(laDateStr)

  // Si es antes de las 6:00 AM, pertenece al día laboral anterior
  if (laDate.getHours() < 6) {
    laDate.setDate(laDate.getDate() - 1)
  }

  const y = laDate.getFullYear()
  const m = String(laDate.getMonth() + 1).padStart(2, '0')
  const day = String(laDate.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getCaliforniaTime(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

/**
 * Retorna el timestamp exacto en milisegundos (epoch ms) correspondiente a las 6:00:00.000 AM
 * de la jornada laboral en curso en Pacific Time (America/Los_Angeles).
 * Fundamental para que los módulos en vivo nunca arrastren órdenes de la jornada anterior.
 */
export function getBusinessDayStartMs(date: Date | string = new Date()): number {
  const bDate = getCaliforniaBusinessDate(date)
  const [year, month, day] = bDate.split('-').map(Number)
  const approxUtc = Date.UTC(year, month - 1, day, 13, 0, 0, 0)
  const laHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(approxUtc),
    10
  )
  const offsetHours = laHour - 6
  return approxUtc - offsetHours * 3600 * 1000
}

/**
 * Retorna el turno operativo actual de Tacos Gavilan:
 * - 'AM': 6:00 AM a 4:59:59 PM (16:59)
 * - 'PM': 5:00 PM (17:00) a 5:59:59 AM del siguiente día
 */
export function getCaliforniaShift(date: Date | string = new Date()): 'AM' | 'PM' {
  const d = typeof date === 'string' ? new Date(date) : date
  const laDateStr = d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  const laHour = new Date(laDateStr).getHours()
  return laHour >= 6 && laHour < 17 ? 'AM' : 'PM'
}


/**
 * @module business-date
 * @description Utilidades para el manejo de fechas de negocio en Tacos Gavilan bajo zona horaria America/Los_Angeles y regla laboral de 6 AM.
 * @businessRules
 * - La zona horaria operativa es estrictamente 'America/Los_Angeles' (Pacific Time).
 * - El día laboral inicia a las 6:00 AM y finaliza a las 5:59 AM del día calendario siguiente.
 * - Cualquier evento ocurrido entre 12:00 AM y 5:59 AM pertenece al día laboral anterior.
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

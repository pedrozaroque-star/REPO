/**
 * @module payroll-classification
 * @description Clasificación heredada para proyecciones de nómina y presentación.
 * @businessRules Comparte la misma clasificación entre UI y cálculo; no certifica exención legal.
 * @dataFlow Título, nombre y tarifa -> indicador estimado de salario fijo.
 * @notes Sin nombres ni umbrales monetarios fijos. El motor financiero usa clasificación y conceptos documentados; esto es solo una sugerencia visual por puesto.
 */
export function isEmployeeSalaried(jobTitle?: string, fullName?: string, payRate?: number): boolean {
  if (!jobTitle && !fullName) return false
  const title = String(jobTitle || '').toLowerCase().trim()

  // 2. Descalificación Inmediata: Asistentes, Mandos Medios y Personal Operativo
  // Indicador visual por puesto; no determina legalmente la exención ni el salario.
  if (
    title.includes('asst') ||
    title.includes('assistant') ||
    title.includes('asistente') ||
    title.includes('subgerente') ||
    title.includes('shift') ||
    title.includes('lead') ||
    title.includes('lider') ||
    title.includes('crew') ||
    title.includes('taquero') ||
    title.includes('cajero') ||
    title.includes('cocinero') ||
    title.includes('cook') ||
    title.includes('cashier') ||
    title.includes('dishwasher') ||
    title.includes('driver') ||
    title.includes('chofer') ||
    (title.includes('bodega') && !title.includes('manager') && !title.includes('supervisor') && !title.includes('gerente')) ||
    (title.includes('warehouse') && !title.includes('manager') && !title.includes('supervisor') && !title.includes('gerente')) ||
    title.includes('colaborador') ||
    title.includes('team')
  ) {
    return false
  }

  // 4. Verificación por Títulos Manageriales Exentos Reales
  return (
    title.includes('general manager') ||
    title.includes('gerente general') ||
    title.includes('district manager') ||
    title.includes('district supervisor') ||
    title.includes('area manager') ||
    title.includes('area supervisor') ||
    (title.includes('supervisor') && !title.includes('asst') && !title.includes('assistant') && !title.includes('shift') && !title.includes('turno')) ||
    title.includes('store manager') ||
    title === 'manager' ||
    (title.includes('gerente') && !title.includes('asistente') && !title.includes('subgerente') && !title.includes('turno'))
  )
}

/**
 * @module lib/viele-catalog-validation
 * @description Validación pura de cantidades PAR e identidad de sucursal de Tacos Gavilan.
 * @businessRules PAR acepta únicamente enteros finitos no negativos; no redondea ni convierte valores vacíos.
 * @dataFlow Payloads de API y Order Guide → validadores → operaciones de catálogo.
 * @notes Separado de DB y sesiones para comprobar casos límite sin mutaciones externas.
 */
export function parseVieleNonnegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export function parseVieleStoreId(value: unknown): number | null {
  const result = parseVieleNonnegativeInteger(value);
  return result !== null && result > 0 ? result : null;
}

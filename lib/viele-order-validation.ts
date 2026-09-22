/**
 * @module viele-order-validation
 * @description Valida captura de compras contra el catálogo server-side de Tacos Gavilan.
 * @businessRules Cantidades de pedido enteras; sobrantes/PAR admiten fracciones; no taxes estimados.
 * @dataFlow Body cliente + catálogo activo + membresía de sucursal → partidas normalizadas.
 * @notes Rechaza duplicados, tipos coercibles peligrosos y cambios de precio antes del checkout.
 */
export type OrderLine = { itemCode: string; description: string; uom: string; quantity: number; unitPrice: number; parQuantity: number; leftoverQuantity: number };
type CatalogRow = { item_code: string; description: string; uom: string; unit_price: number | string };

export function finiteAmount(value: unknown, label: string, integer = false): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) throw new Error(`${label}: número requerido.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999.99 || (integer && !Number.isSafeInteger(n))) throw new Error(`${label}: número ${integer ? 'entero ' : ''}no negativo inválido.`);
  return n;
}

export function normalizeVieleOrderLines(items: unknown, catalog: CatalogRow[], membership: string[]): OrderLine[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) throw new Error('Se requiere un arreglo de 1 a 500 artículos.');
  const rows = new Map(catalog.map(row => [row.item_code.trim().toUpperCase(), row]));
  const allowed = new Set(membership.map(code => code.trim().toUpperCase()));
  if (!allowed.size) throw new Error('La sucursal no tiene Order Guide sincronizado.');
  const seen = new Set<string>();
  const result: OrderLine[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.itemCode !== 'string') throw new Error('SKU requerido.');
    const code = item.itemCode.trim().toUpperCase();
    if (seen.has(code)) throw new Error(`SKU duplicado: ${code}.`);
    seen.add(code);
    const row = rows.get(code);
    if (!row || !allowed.has(code)) throw new Error(`${code}: no pertenece al catálogo activo de esta sucursal.`);
    const quantity = finiteAmount(item.orderQuantity, `${code} cantidad`, true);
    const parQuantity = finiteAmount(item.parQuantity ?? 0, `${code} PAR`);
    const leftoverQuantity = finiteAmount(item.leftoverQuantity ?? 0, `${code} sobrante`);
    const requestedPrice = finiteAmount(item.unitPrice, `${code} precio`);
    const unitPrice = finiteAmount(row.unit_price, `${code} precio de catálogo`);
    if (Math.round(requestedPrice * 100) !== Math.round(unitPrice * 100)) throw new Error(`${code}: precio cambió; actualiza el catálogo antes de enviar.`);
    if (item.uom !== row.uom) throw new Error(`${code}: unidad de compra cambió; actualiza el catálogo.`);
    if (quantity > 0) result.push({ itemCode: row.item_code, description: row.description, uom: row.uom, quantity, unitPrice, parQuantity, leftoverQuantity });
  }
  if (!result.length) throw new Error('Debe ordenar al menos un producto.');
  const subtotal = result.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0);
  if (!Number.isFinite(subtotal) || subtotal > 99999999.99) throw new Error('El importe supera el límite permitido.');
  return result;
}

export function vieleOrderDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validVieleShipDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

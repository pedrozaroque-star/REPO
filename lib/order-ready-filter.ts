/**
 * @module lib/order-ready-filter
 * @description Utilidades isomórficas (cliente y servidor) para la detección y filtrado de bebidas y postres en comandas de Toast POS.
 * 
 * @businessRules
 * - **Exclusión de Bebidas y Postres en Pantalla de Preparación (isDrinkOrDessertOnlyOrder)**:
 *   - Las órdenes compuestas EXCLUSIVAMENTE por bebidas (horchata, sodas, café, aguas, champurrado) o postres (flan, cheesecake)
 *     se atienden directamente en mostrador/caja y NO deben colocarse en la pantalla de preparación del preparador/parrilla (/inventory/preparador).
 *   - Si la comanda contiene al menos un platillo de cocina (tacos, burritos, quesadillas, sopes, mulitas, huevos, etc.), SÍ se muestra en cocina.
 *   - Marcadores de sistema (descuentos, separadores POS, tags de empleado) se descartan antes de evaluar si los artículos consumibles son bebidas/postres.
 * - **Cero Dependencias de Node.js**:
 *   - Este archivo es 100% puro y compatible con Client Components de React ('use client') y Server Components. No importa módulos de Node.js (fs, path, etc.).
 * 
 * @dataFlow
 * - Comandas de Toast POS (items_summary) -> isDrinkOrDessertOnlyOrder() -> Filtro en /inventory/preparador y /order-ready-board.
 * 
 * @notes
 * - Utiliza normalización Unicode NFD para eliminar diacríticos y tildes (ej. 'café' -> 'cafe', 'piña' -> 'pina') antes de la evaluación por expresiones regulares.
 */

/**
 * Normaliza el nombre de un platillo eliminando acentos/diacríticos y espacios extras para comparación uniforme.
 */
export function normalizeItemText(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Patrones de expresiones regulares para identificar bebidas y postres de Tacos Gavilan.
 * Cubre aguas frescas, sodas, bebidas calientes, jugos, aguas embotelladas, flan, cheesecake y postres.
 */
export const DRINK_DESSERT_PATTERNS: RegExp[] = [
  // Postres (Desserts)
  /\bflan\b/i,
  /\bcheesecake\b/i,
  /\bpostre\b/i,
  /\bdessert\b/i,
  /\barroz con leche\b/i,
  /\bgelatina\b/i,
  /\btres leches\b/i,
  /\bchurros?\b/i,
  /\bpastel\b/i,

  // Aguas Frescas
  /\bhorchata\b/i,
  /\bjamaica\b/i,
  /\btamarindo\b/i,
  /\blemonade\b/i,
  /\blimonada\b/i,
  /\bmelon\b/i,
  /\bsandia\b/i,
  /\bagua fresca\b/i,
  /\bgallon agua\b/i,
  /\bagua de\b/i,
  /\b(large|medium|small|med|lg|sm|vaso)\s+(de\s+)?pina\b/i,
  /^pina$/i,

  // Bebidas Calientes (Hot drinks)
  /\bchampurrado\b/i,
  /\bcoffee\b/i,
  /\bcafe\b/i,
  /\bchocolate caliente\b/i,
  /\bhot chocolate\b/i,
  /\btea\b/i,
  /\bte\b/i,

  // Agua y Jugos (Water & Juices)
  /\bbottled water\b/i,
  /\bagua embotellada\b/i,
  /\bjugo\b/i,
  /\bjuice\b/i,
  /\borange juice\b/i,
  /^water$/i,

  // Sodas y Refrescos
  /\bcoke\b/i,
  /\bcoca(\s*cola)?\b/i,
  /\bsprite\b/i,
  /\bfanta\b/i,
  /\bjarritos?\b/i,
  /\bsidral\b/i,
  /\bsangria\b/i,
  /\btopo chico\b/i,
  /\bsquirt\b/i,
  /\bpepsi\b/i,
  /\bdr(\.|\s+)?pepper\b/i,
  /\bcrush\b/i,
  /\brefresco\b/i,
  /\bsoda\b/i,
  /\bbeverage\b/i,
  /\bdrink\b/i,
  /\bcan soda\b/i,
  /\bbottle soda\b/i,
]

/**
 * Marcadores no-comida (descuentos, separadores POS) que no constituyen platillos a preparar en cocina.
 */
export const NON_FOOD_MARKER_PATTERNS: RegExp[] = [
  /\bseparator\b/i,
  /---+/,
  /\*{2,}/,
  /\bempleado\b/i,
  /\bpolicia\b/i,
  /\bdiscount\b/i,
  /\bdescuento\b/i
]

/**
 * Evalúa si un nombre de ítem corresponde a una bebida o postre.
 */
export function isDrinkOrDessertItem(name: string): boolean {
  const normalized = normalizeItemText(name)
  if (!normalized) return false
  return DRINK_DESSERT_PATTERNS.some(p => p.test(normalized))
}

/**
 * Evalúa si un ítem es un marcador administrativo o separador de Toast POS.
 */
export function isNonFoodMarkerItem(name: string): boolean {
  const normalized = normalizeItemText(name)
  if (!normalized) return false
  return NON_FOOD_MARKER_PATTERNS.some(p => p.test(normalized))
}

/**
 * REGLA CRÍTICA TACOS GAVILAN:
 * Determina si una orden está compuesta EXCLUSIVAMENTE por bebidas o postres (flan, cheesecake, etc.).
 * Si todos los ítems consumibles de la comanda son bebidas o postres, la orden NO debe mostrarse
 * en la pantalla de preparación del taquero/cocinero de parrilla (/inventory/preparador).
 */
export function isDrinkOrDessertOnlyOrder(itemsSummary: string | null | any[]): boolean {
  if (!itemsSummary) return false

  let items: any[] = []
  if (typeof itemsSummary === 'string') {
    try {
      items = JSON.parse(itemsSummary)
    } catch {
      return false
    }
  } else if (Array.isArray(itemsSummary)) {
    items = itemsSummary
  }

  if (!Array.isArray(items) || items.length === 0) return false

  // Filtrar ítems consumibles reales (descartando separadores y tags de descuento)
  const realItems = items.filter(it => !isNonFoodMarkerItem(it?.name || ''))
  if (realItems.length === 0) return false

  // La orden es SOLO bebidas/postres si el 100% de los ítems reales son bebidas o postres
  return realItems.every(it => isDrinkOrDessertItem(it?.name || ''))
}

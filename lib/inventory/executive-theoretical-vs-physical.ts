/**
 * @module lib/inventory/executive-theoretical-vs-physical
 * @description Motor ejecutivo integral "Platillos Vendidos & Consumo Teórico (POS) vs. Consumo Físico Real (Sobrantes + Bodega QBO)"
 *   para las 15 sucursales y todos los insumos alimenticios/operativos de Orden Diaria en Tacos Gavilan.
 *
 * @businessRules
 *   - **Cobertura Total de Platillos Vendidos en Toast POS (10 Familias)**:
 *     1. Tacos y Taco Plates (sumando exactamente los 3 sub-tacos reales de cada Taco Plate).
 *     2. Burritos (Regular, Super, Meat Only 12 oz y Burritos de Desayuno).
 *     3. Quesadillas (Regular, Super Quesadilla y Quesadilla de Queso).
 *     4. Mulitas (Regular y Super Mulita).
 *     5. Sopes (de carne y de frijol).
 *     6. Tortas (de carne, Cubana, Milanesa, Jamón y Huevo).
 *     7. Platos, Super Nachos, Desayunos y Sides de Carne.
 *     8. Party Trays / Fiesta Platters (15-20, 20-25, 25-30, 30-40 personas) y Carne por Libra (2/6/12 lb).
 *     9. Acompañamientos y Extras (Arroz, Frijol, Guacamole, Chips, Tortillas, Quesos extra).
 *     10. Aguas Frescas, Champurrado, Bebidas y Postres (Flan y Cheesecake individuales).
 *   - **Cobertura Total de Insumos de Cocina y Orden Diaria (~45 SKUs alimenticios/empaque directo)**:
 *     * Excluye uniformes (camisas, chamarras, gorras) y químicos/papelería de limpieza.
 *     * Normaliza `Papelito Para Torta` a costo por pieza individual (`purchase_unit_cost / 60 = $0.48/pza`),
 *       ya que en Orden Diaria y recetas se contabiliza por hoja/pieza y no por paquete de 60.
 *     * Para las 8 proteínas activas aplica `MEAT_COOKING_YIELDS` calibrados (`Asada 61.5%`, `Pastor 53.0%`,
 *       `Pollo 57.5%`, `Cabeza 78.5%`, `Lengua 92.5%`, `Chorizo 67.0%`, `Carnitas/Buche 100%`) y pesos de bolsa vigentes.
 *     * Para insumos de salsabar/autoservicio sin botón unitario en caja (`isHistoricalMassBalanceItem`),
 *       compara contra la mediana histórica propia de cada sucursal por cada $1,000 USD de venta neta
 *       y los identifica con transparencia como `'salsabar_benchmark'`.
 *   - **Conciliación Telescópica Exacta Mismo-Tramo `(t0, t1]`**:
 *     * Ignora conteos automáticos `AUTO_CYCLE_V2` y capturas aisladas de sábado (`dow === 6`).
 *     * `Consumo Físico Real = Sobrante(t0) + Entregas_Bodega_QBO[t0, t1) ± Traspasos_Tiendas(t0, t1] - Sobrante(t1)`.
 *     * Compara ese consumo físico estrictamente contra el consumo teórico POS de los mismos días `(t0, t1]`
 *       para eliminar cualquier distorsión cuando a una tienda le falta un conteo intermedio.
 *
 * @dataFlow
 *   `pmix_daily_cache` + `sales_daily_cache` + `inventory_counts` + `inventory_orders`/`inventory_order_lines`
 *   + `inventory_store_transfers` + `recipes` + `inventory_items`
 *   -> `computeExecutiveTheoreticalVsPhysicalReport()` -> `GET /api/food-cost/teorico-vs-fisico`.
 *
 * @notes
 *   - [2026-11-25] Blindaje de 5 Capas para Supabase `ci_small` (2 GB RAM):
 *     1) Lectura streaming de `pmix_daily_cache` vía `readPmixDailyCacheChunked` (`<= 15` filas/petición HTTP = ~3.2 MB JSONB,
 *        cero `OFFSET` y cero acumulación del arreglo `pmixRows` en RAM).
 *     2) Reconciliación QBO unificada en 1 sola llamada (cero fan-out paralelo de 15× y omitida si `endDate < todayLA - 45d`).
 *     3) Filtrado SQL de dos niveles en `inventory_counts` e `inventory_order_lines`: ventana corta `[startDate - 4d, endDate]`
 *        acotada a `eligibleItemIds` (~45 SKUs) sin `AUTO_CYCLE_V2`, y lookback histórico `[startDate - 28d, startDate - 5d]`
 *        restringido exclusivamente a `massBalanceItemIds` (~9 SKUs salsabar), reduciendo ~70% las filas transferidas.
 *     4) Aislamiento automático a 1 sucursal cuando `singleStore` consulta ventanas largas (`> 35` días) o rol `manager` local.
 *   - [2026-11-25] Ronda 2 Calibración Forense Multimensual:
 *     1) Ancla canónica `resolveCanonicalTelescopingAnchor` (cubre viernes `-3d` en inicios de lunes), filtro de plantilla
 *        acotado a `order_type = 'daily'` (sin bolsas plásticas externas) e inclusión de llegadas `['daily', 'liquids']`.
 *     2) Síntesis exacta de tickets PMIX con partición por intervalos para modificadores `"No ..."` / `"Sin ..."` desde
 *        `modifier_guids` usando su conteo exacto de ocurrencias, `unit_price` unitario y soporte multi-paréntesis en Party Trays.
 *     3) Validación `isPmixCacheRowFinalized` + fallback vivo acotado (`maxLiveFallbackCalls = 15`), pesos históricos pre-`2026-07-24`,
 *        `inventory_price_history` a `endDate`, `bodegaRatio = 0.90` en alimentos de Bodega y denominador `% ventas` emparejado al tramo medido.
 *   - [2026-11-25] Calibraciones confirmadas por Carlos: `251W Cheesecake` y `253W Whole Cheese Cake` marcados como
 *     proveedor externo directo (`bodegaRatio = 1.0`, sin descuento `0.90x` de Bodega); `029W Queso Fresco` promovido
 *     de `mass_balance` a `pos_recipe` tras calibrar `1 pza` en todas las Tortas.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix } from '@/lib/toast-pmix'
import { calculateDailyOrderConsumption } from '@/lib/inventory/daily-order-consumption-engine'
import {
  ACTIVE_PROTEIN_IDS,
  MEAT_COOKING_YIELDS,
  MEAT_DEFAULT_BAG_LBS,
  type ActiveProteinKey,
} from '@/lib/inventory/meat-allocation'
import {
  BODEGA_COST_RATIO_BY_PROTEIN,
  evaluatePmixItemsForProtein,
  formatShortDateLabelEs,
  getHistoricalMeatBagLbs,
  isHumanPhysicalCountRow,
} from '@/lib/inventory/toast-meat-sold-resolver'
import {
  extractBaseMenuItemName,
  isTacoPlateMenuItem,
} from '@/lib/inventory/meat-dish-equivalence'
import { isPartyTrayMenuItem } from '@/lib/inventory/party-tray-guidelines'
import {
  computeRobustMedian,
  isAutoCycleCountRecord,
  isHistoricalMassBalanceItem,
} from '@/lib/inventory/historical-mass-balance'
import {
  buildStoreItemDateNetTransferMap,
  fetchConfirmedStoreTransfers,
} from '@/lib/inventory/store-transfers'
import {
  isPmixCacheRowFinalized,
  PMIX_SAFE_CHUNK_ROWS,
  readPmixDailyCacheChunked,
} from '@/lib/inventory/pmix-cache-reader'
import { reconcileStoreOrdersWithQbInvoices } from '@/lib/inventory/qb-shipped-reconciliation'
import {
  addDaysIso,
  buildLAInstant,
  diffCalendarDays,
  getBusinessDateLA,
  resolveCanonicalTelescopingAnchor,
} from '@/lib/inventory/food-cost-sales-resolver'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import { EXTERNAL_TRACK_ONLY_ITEM_IDS } from '@/app/inventory/orders/utils'

const PAPELITO_ITEM_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807'
// Confirmado por Carlos: Cheesecake (251W) y Whole Cheese Cake (253W) son proveedor externo directo (0% markup Bodega -> bodegaRatio = 1.0)
const EXTERNAL_DIRECT_SUPPLIER_ITEM_IDS = new Set<string>([
  '8ba55664-5ca9-4886-8ac8-acf1fd070713', // 251W Cheesecake
  'df79c42c-7219-4563-8501-6acc1116238f', // 251W Cheese cake
  '2e53d7a5-67ff-4247-83cf-1d976650a9bf', // 253W Whole Cheese Cake
])
const NON_FOOD_PLASTIC_BAG_SKUS = new Set(['316W', '317W', '150I05'])
const NON_FOOD_POS_GUIDS = new Set([
  'd8f4d7cc-e98c-4953-babc-cbb05e96a33d', // Policia (descuento/cortesía sin comida propia)
  '0c592b57-dc09-4e81-8822-79ee02e9ef24', // Nota abierta / instrucción libre Toast
])

const PROTEIN_ID_TO_KEY = new Map<string, ActiveProteinKey>(
  (Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>).map(([k, id]) => [id, k])
)

export type ExecutiveDishFamilyKey =
  | 'tacos'
  | 'burritos'
  | 'quesadillas'
  | 'mulitas'
  | 'sopes'
  | 'tortas'
  | 'plates_breakfast_nachos'
  | 'party_trays_lbs'
  | 'sides_extras'
  | 'aguas_drinks_desserts'

export type ExecutiveProductCategory =
  | 'meats'
  | 'tortillas_bread'
  | 'dairy_avocado'
  | 'rice_beans_kitchen'
  | 'aguas_champurrado'
  | 'salsas_produce_packaging'

export type VarianceHealthStatus = 'ok' | 'warning' | 'critical' | 'saving' | 'unmeasured'

export interface ExecutiveDishTopItem {
  itemName: string
  ordersSold: number
  exactUnitsServed: number
  netSalesUsd: number
}

export interface ExecutiveDishFamilySummary {
  familyKey: ExecutiveDishFamilyKey
  ordersSold: number
  exactUnitsServed: number
  netSalesUsd: number
  meatCookedLbs: number
  meatRawLbs: number
  shareOfSalesPct: number
  topItems: ExecutiveDishTopItem[]
}

export interface ProductPerStoreCell {
  storeId: number
  storeName: string
  hasMeasuredSpan: boolean
  spanDays: number
  t0: string | null
  t1: string | null
  openingUnits: number | null
  arrivedUnits: number
  transferNetUnits: number
  closingUnits: number | null
  invoiceNumbers: string[]
  theoUnits: number
  physicalUnits: number | null
  diffUnits: number | null
  diffUnitsPerDay: number | null
  diffPct: number | null
  theoCostStoreUsd: number
  physicalCostStoreUsd: number | null
  diffCostStoreUsd: number | null
  diffCostBodegaUsd: number | null
  realOzPerTaco: number | null
  equivTacosDiff: number | null
  status: VarianceHealthStatus
}

export interface ExecutiveProductComparisonRow {
  itemId: string
  sku: string
  name: string
  category: ExecutiveProductCategory
  isMeat: boolean
  proteinKey: ActiveProteinKey | null
  measurementMode: 'pos_recipe' | 'salsabar_benchmark'
  unitLabelEs: string
  unitLabelEn: string
  packSizeQty: number
  baseMeasure: string
  yieldPct: number
  unitCostStoreUsd: number
  unitCostBodegaUsd: number
  relatedDishesEs: string
  relatedDishesEn: string
  hasMeasuredSpan: boolean
  measuredStoresCount: number
  spanDaysAvg: number
  anchorStart: string | null
  anchorEnd: string | null
  openingUnits: number
  arrivedUnits: number
  transferNetUnits: number
  closingUnits: number
  invoiceNumbers: string[]
  theoWindowUnits: number
  theoUnits: number
  theoBaseQty: number
  theoCookedLbs: number | null
  theoCostStoreUsd: number
  theoCostBodegaUsd: number
  physicalUnits: number
  physicalBaseQty: number
  physicalCookedLbsEquiv: number | null
  physicalCostStoreUsd: number
  physicalCostBodegaUsd: number
  diffUnits: number
  diffUnitsPerDay: number
  diffBaseQty: number
  diffPct: number | null
  efficiencyPct: number | null
  diffCostStoreUsd: number
  diffCostBodegaUsd: number
  equivTacos15Oz: number | null
  equivBurritos6Oz: number | null
  realAvgOzPerTaco: number | null
  realAvgOzPerBurrito: number | null
  comparisonNoteEs: string
  comparisonNoteEn: string
  status: VarianceHealthStatus
  perStoreBreakdown: ProductPerStoreCell[]
}

export interface ExecutiveStoreComparisonRow {
  storeId: number
  storeName: string
  netSalesUsd: number
  orderCount: number
  tacosSold: number
  burritosSold: number
  tortasSold: number
  quesadillasMulitasSopesSold: number
  platesNachosTraysSold: number
  meatsMeasuredCount: number
  meatsTheoBags: number
  meatsPhysicalBags: number
  meatsDiffBags: number
  meatsTheoRawLbs: number
  meatsPhysicalRawLbs: number
  meatsDiffRawLbs: number
  meatsDiffPct: number | null
  meatsTheoCostStoreUsd: number
  meatsPhysicalCostStoreUsd: number
  meatsDiffCostStoreUsd: number
  meatsDiffCostBodegaUsd: number
  meatsEquivTacosDiff: number
  asadaRealOzPerTaco: number | null
  allMeasuredItemsCount: number
  allTheoCostStoreUsd: number
  allPhysicalCostStoreUsd: number
  allDiffCostStoreUsd: number
  allDiffCostBodegaUsd: number
  allEfficiencyPct: number | null
  status: VarianceHealthStatus
}

export interface ExecutiveTheoreticalVsPhysicalReport {
  meta: {
    storeId: string
    storeNumericId: number | null
    storeName: string
    startDate: string
    endDate: string
    rangeLabelEs: string
    windowDays: number
    todayBusinessDateLA: string
    netSalesUsd: number
    orderCount: number
    measuredStoresCount: number
    totalActiveStoresCount: number
  }
  storesCatalog: Array<{ id: number; name: string; code: string }>
  kpis: {
    totalFoodUnitsSold: number
    tacosTotalSold: number
    burritosTotalSold: number
    tortasTotalSold: number
    quesadillasTotalSold: number
    mulitasTotalSold: number
    sopesTotalSold: number
    platesBreakfastNachosSold: number
    partyTraysAndLbsSold: number
    sidesExtrasSold: number
    aguasDrinksDessertsSold: number
    theoCostStoreUsd: number
    theoCostBodegaUsd: number
    theoPctOfSales: number
    physicalCostStoreUsd: number
    physicalCostBodegaUsd: number
    physicalPctOfSales: number
    varianceCostStoreUsd: number
    varianceCostBodegaUsd: number
    variancePctOfSales: number
    overallEfficiencyPct: number | null
    meatsSummary: {
      theoBags: number
      physicalBags: number
      diffBags: number
      theoRawLbs: number
      physicalRawLbs: number
      diffRawLbs: number
      theoCookedLbs: number
      physicalCookedLbsEquiv: number
      theoCostStoreUsd: number
      physicalCostStoreUsd: number
      diffCostStoreUsd: number
      diffCostBodegaUsd: number
      equivTacos15Oz: number
      equivBurritos6Oz: number
    }
  }
  dishFamilies: ExecutiveDishFamilySummary[]
  productRows: ExecutiveProductComparisonRow[]
  storeRows: ExecutiveStoreComparisonRow[]
}

// ── Caché ligero de catálogos (TTL 5 min) para respuesta instantánea ──
let cachedStaticCatalog: {
  expiresAt: number
  stores: any[]
  invItems: any[]
  recipes: any[]
  menuItems: any[]
  templateItemIds: Set<string>
  externalSupplierItemIds: Set<string>
  priceHistoryByItemId: Map<string, Array<{ effectiveMs: number; cost: number; qpu: number }>>
} | null = null

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function normalize(val: unknown): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; offset < 150_000; offset += pageSize) {
    let lastErr: any = null
    let batch: T[] | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await buildQuery(offset, offset + pageSize - 1)
      if (!error) {
        batch = data || []
        lastErr = null
        break
      }
      lastErr = error
      await new Promise((r) => setTimeout(r, 350 * attempt))
    }
    if (lastErr) throw new Error(lastErr.message || String(lastErr))
    if (!batch || batch.length === 0) break
    out.push(...batch)
    if (batch.length < pageSize) break
  }
  return out
}

function isNonFoodUniformOrJanitorialItem(item: {
  id: string
  sku?: string | null
  name: string
  is_bodega?: boolean | null
}): boolean {
  if (EXTERNAL_TRACK_ONLY_ITEM_IDS.has(String(item.id))) return true
  const skuUpper = String(item.sku || '').trim().toUpperCase()
  if (skuUpper && NON_FOOD_PLASTIC_BAG_SKUS.has(skuUpper)) return true
  const n = normalize(item.name)
  if (
    /\b(?:camisa|chamarra|polo|shift\s*leader|team\s*members|gorras?|apron|hairnets?|face\s*mask|wetmop|mop\s*head|glass\s*cleaner|grill\s*bright|pink\s*filter|lemon\s*oil|dermaclean|graffiti|scotch\s*brite|pads\s*mco|hand\s*sanitizer|printer\s*paper|papel\s*termico|thermal\s*label|trash\s*bag|mil\s*bag|bolsa\s*agua\s*uber)\b/.test(
      n
    )
  ) {
    return true
  }
  return false
}

function classifyProductCategory(item: { id: string; name: string }, isMeat: boolean): ExecutiveProductCategory {
  if (isMeat) return 'meats'
  const n = normalize(item.name)
  if (/\b(?:milane[sz]a|jamon|salchicha)\b/.test(n)) return 'meats'
  if (/\b(?:tortilla|mulita|telera|sopes?|quesadilla\s*bodega)\b/.test(n)) return 'tortillas_bread'
  if (/\b(?:queso|cheese|crema|aguacate|mayonesa)\b/.test(n)) return 'dairy_avocado'
  if (/\b(?:arroz|frijol|huevo|lard|manteca)\b/.test(n)) return 'rice_beans_kitchen'
  if (/\b(?:horchata|jamaica|pina|tamarindo|champurrado|cafe|agua\s*gavilan|agua\s*para\s*los\s*clientes)\b/.test(n)) {
    return 'aguas_champurrado'
  }
  return 'salsas_produce_packaging'
}

function classifyAllMenuDishFamily(rawItemName: string, guid?: string | null): {
  familyKey: ExecutiveDishFamilyKey
  subUnitsMultiplier: number
  isFoodOrDrink: boolean
} {
  const cleanGuid = String(guid || '').trim().toLowerCase()
  if (cleanGuid && NON_FOOD_POS_GUIDS.has(cleanGuid)) {
    return { familyKey: 'sides_extras', subUnitsMultiplier: 0, isFoodOrDrink: false }
  }
  const fullNorm = normalize(rawItemName)
  const baseNorm = normalize(extractBaseMenuItemName(rawItemName))
  if (
    !baseNorm ||
    /^(?:empleado|policia|borrar|pu|p\s+u|test\s*item|separator|separador|add\s*value|bolsa\s*apa[rd]te|coffee\s*mate|splenda|sugar|azucar|creamer)$/.test(
      baseNorm
    )
  ) {
    return { familyKey: 'sides_extras', subUnitsMultiplier: 0, isFoodOrDrink: false }
  }

  // Charolas de puro arroz/frijol (0 lb carne) van a acompañamientos/extras
  if (/^(?:half|full)\s*tray\s*(?:beans?|rice|frijol(?:es)?|arroz)\b/.test(baseNorm)) {
    return { familyKey: 'sides_extras', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }

  if (
    isPartyTrayMenuItem(rawItemName, guid) ||
    /\b\d+(?:\.\d+)?\s*lbs?\s*(?:meat|carne|asada|pastor|pollo|chicken|cabeza|lengua|carnitas|chorizo|buche)\b/.test(baseNorm) ||
    /\b\d+(?:\.\d+)?\s*lbs?\s*meat\b/.test(fullNorm) ||
    /\b(?:party\s*trays?|fiesta\s*platters?|charolas?|catering\s*meat|carne\s*por\s*libra|half\s*tray|full\s*tray)\b/.test(baseNorm) ||
    /^(?:asada|pastor|pollo|chicken|cabeza|lengua|carnitas|chorizo|buche)$/.test(baseNorm)
  ) {
    return { familyKey: 'party_trays_lbs', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }

  if (isTacoPlateMenuItem(rawItemName)) {
    return { familyKey: 'tacos', subUnitsMultiplier: 3, isFoodOrDrink: true }
  }
  if (/\btacos?\b/.test(baseNorm) && !/\bcover\b/.test(baseNorm)) {
    const m = baseNorm.match(/\b(\d+)\s*tacos?\b/)
    return { familyKey: 'tacos', subUnitsMultiplier: m ? Math.max(1, Number(m[1])) : 1, isFoodOrDrink: true }
  }
  if (/\bburritos?\b/.test(baseNorm)) {
    return { familyKey: 'burritos', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  if (/\bquesadillas?\b/.test(baseNorm)) {
    return { familyKey: 'quesadillas', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  if (/\bmulitas?\b/.test(baseNorm)) {
    return { familyKey: 'mulitas', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  if (/\bsopes?\b/.test(baseNorm)) {
    return { familyKey: 'sopes', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  if (/\btortas?\b/.test(baseNorm)) {
    return { familyKey: 'tortas', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  if (
    /\b(?:horchata|jamaica|pina|tamarindo|champurrado|coke|coca|pepsi|sprite|fanta|diet|dr\s*pepper|root\s*beer|squirt|manzanita|soda|refresco|fountain|agua\s*fresca|lemonade|limonada|iced?\s*tea|coffee|cafe|water|agua|jugo|juice|milk|leche|bottle|jarrito|sidral|sangria|mexican\s*coke|flan|cheesecake)\b/.test(
      baseNorm
    )
  ) {
    return { familyKey: 'aguas_drinks_desserts', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  const isNachoDish =
    (/\bnachos?\b/.test(baseNorm) || /\bsuper\s*nachos\b/.test(fullNorm)) &&
    !/\bnacho\s*cheese\b/.test(baseNorm)
  if (
    isNachoDish ||
    /\b(?:plato|plate|huevos?|chilaquiles?|machaca|omelet(?:te)?|side\s*(?:order\s*)?carne)\b/.test(baseNorm)
  ) {
    return { familyKey: 'plates_breakfast_nachos', subUnitsMultiplier: 1, isFoodOrDrink: true }
  }
  return { familyKey: 'sides_extras', subUnitsMultiplier: 1, isFoodOrDrink: true }
}

function buildUnitLabels(inv: any, isPapelito: boolean, proteinKey: ActiveProteinKey | null): {
  es: string
  en: string
  packSizeQty: number
  baseMeasure: string
} {
  if (isPapelito) {
    return { es: 'piezas (hojas)', en: 'sheets (pcs)', packSizeQty: 1, baseMeasure: 'pza' }
  }
  if (proteinKey) {
    const lbs = MEAT_DEFAULT_BAG_LBS[proteinKey]
    if (lbs < 1) {
      const oz = Math.round(lbs * 16)
      return {
        es: `bolsitas (${oz} oz)`,
        en: `pouches (${oz} oz)`,
        packSizeQty: lbs,
        baseMeasure: 'lb',
      }
    }
    return {
      es: `bolsas (${lbs} lb)`,
      en: `bags (${lbs} lb)`,
      packSizeQty: lbs,
      baseMeasure: 'lb',
    }
  }
  const qpu = Number(inv.quantity_per_unit || 1)
  const um = String(inv.unit_measure || 'pza')
  const n = normalize(inv.name)
  if (um === 'gal' || /gallon|galon/i.test(String(inv.unit_type || ''))) {
    return { es: 'galones', en: 'gallons', packSizeQty: qpu || 1, baseMeasure: 'gal' }
  }
  if (/tortilla.*60ct/.test(n)) return { es: 'paquetes (60 pza)', en: 'packs (60 pcs)', packSizeQty: 60, baseMeasure: 'pza' }
  if (/13.*flour/.test(n)) return { es: 'paquetes (12 pza)', en: 'packs (12 pcs)', packSizeQty: 12, baseMeasure: 'pza' }
  if (/regular\s*8\s*in/.test(n)) return { es: 'paquetes (12 pza)', en: 'packs (12 pcs)', packSizeQty: 12, baseMeasure: 'pza' }
  if (/mulitas/.test(n)) return { es: 'paquetes (12 pares)', en: 'packs (12 pairs)', packSizeQty: 12, baseMeasure: 'par' }
  if (/quesadilla\s*bodega/.test(n)) return { es: 'paquetes (12 pza)', en: 'packs (12 pcs)', packSizeQty: 12, baseMeasure: 'pza' }
  if (/sopes/.test(n)) return { es: 'paquetes (12 pza)', en: 'packs (12 pcs)', packSizeQty: 12, baseMeasure: 'pza' }
  if (/teleras/.test(n)) return { es: 'paquetes (6 pza)', en: 'packs (6 pcs)', packSizeQty: 6, baseMeasure: 'pza' }
  if (/tortilla\s*nachos/.test(n)) return { es: 'bolsas (4.5 oz)', en: 'bags (4.5 oz)', packSizeQty: 1, baseMeasure: 'bolsa' }
  if (/amarillo\s*cheese/.test(n)) return { es: 'cajas (440 oz)', en: 'cases (440 oz)', packSizeQty: 440, baseMeasure: 'oz' }
  if (/huevo\b/.test(n) && qpu >= 100) return { es: 'cajas (180 pza)', en: 'cases (180 pcs)', packSizeQty: 180, baseMeasure: 'pza' }
  if (/milane[sz]a/.test(n)) return { es: 'bolsas (20 pza)', en: 'bags (20 pcs)', packSizeQty: 20, baseMeasure: 'pza' }
  if (um === 'lb') return { es: `bolsas (${qpu} lb)`, en: `bags (${qpu} lb)`, packSizeQty: qpu, baseMeasure: 'lb' }
  if (um === 'oz') return { es: `bolsas (${qpu} oz)`, en: `bags (${qpu} oz)`, packSizeQty: qpu, baseMeasure: 'oz' }
  if (qpu > 1) return { es: `cajas/paq (${qpu} pza)`, en: `cases/packs (${qpu} pcs)`, packSizeQty: qpu, baseMeasure: 'pza' }
  return { es: 'unidades', en: 'units', packSizeQty: 1, baseMeasure: um }
}

function evaluateHealthStatus(params: {
  hasMeasuredSpan: boolean
  diffPct: number | null
  diffCostStoreUsd: number
  isMeat: boolean
  proteinKey: ActiveProteinKey | null
  spanDays: number
}): VarianceHealthStatus {
  if (!params.hasMeasuredSpan || params.diffPct === null) return 'unmeasured'
  const scale = Math.max(1 / 7, Math.min(1, params.spanDays / 7))
  if (params.diffCostStoreUsd <= -25 * scale && params.diffPct <= -3) return 'saving'
  if (params.proteinKey === 'asada') {
    if (params.diffPct > 5 && params.diffCostStoreUsd >= 180 * scale) return 'critical'
    if (params.diffPct > 3 && params.diffCostStoreUsd >= 90 * scale) return 'warning'
    return 'ok'
  }
  if (params.isMeat) {
    if (params.diffPct > 14 && params.diffCostStoreUsd >= 120 * scale) return 'critical'
    if (params.diffPct > 8 && params.diffCostStoreUsd >= 60 * scale) return 'warning'
    return 'ok'
  }
  if (params.diffPct > 18 && params.diffCostStoreUsd >= 75 * scale) return 'critical'
  if (params.diffPct > 10 && params.diffCostStoreUsd >= 40 * scale) return 'warning'
  return 'ok'
}

async function getStaticCatalog() {
  if (cachedStaticCatalog && cachedStaticCatalog.expiresAt > Date.now()) {
    return cachedStaticCatalog
  }
  const supabase = await getSupabaseAdminClient()
  const storesRes = await supabase
    .from('stores')
    .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })
  if (storesRes.error) throw new Error(storesRes.error.message)

  const invItems = await fetchAllPaginated<any>((f, t) =>
    supabase.from('inventory_items').select('*').order('id').range(f, t)
  )
  const recipes = await fetchAllPaginated<any>((f, t) =>
    supabase.from('recipes').select('*').order('id').range(f, t)
  )
  const menuItems = await fetchAllPaginated<any>((f, t) =>
    supabase.from('toast_menu_items').select('guid, name').order('guid').range(f, t)
  )
  const [templateRows, supplierMappings, priceHistoryRows] = await Promise.all([
    fetchAllPaginated<any>((f, t) =>
      supabase
        .from('store_order_template')
        .select('inventory_item_id')
        .eq('order_type', 'daily')
        .order('id')
        .range(f, t)
    ),
    fetchAllPaginated<any>((f, t) =>
      supabase
        .from('supplier_item_mappings')
        .select('master_item_id')
        .not('master_item_id', 'is', null)
        .order('master_item_id')
        .range(f, t)
    ),
    fetchAllPaginated<any>((f, t) =>
      supabase
        .from('inventory_price_history')
        .select('id, inventory_item_id, purchase_unit_cost, quantity_per_unit, effective_date')
        .order('effective_date', { ascending: true })
        .order('id', { ascending: true })
        .range(f, t)
    ),
  ])

  const templateItemIds = new Set<string>(templateRows.map((r: any) => String(r.inventory_item_id)))
  for (const id of Object.values(ACTIVE_PROTEIN_IDS)) templateItemIds.add(id)

  const externalSupplierItemIds = new Set<string>([
    ...supplierMappings.map((sm: any) => String(sm.master_item_id || '').trim()).filter(Boolean),
    ...EXTERNAL_DIRECT_SUPPLIER_ITEM_IDS,
  ])

  const priceHistoryByItemId = new Map<string, Array<{ effectiveMs: number; cost: number; qpu: number }>>()
  for (const ph of priceHistoryRows) {
    const iid = String(ph.inventory_item_id || '')
    const effMs = Date.parse(String(ph.effective_date || ''))
    const cost = Number(ph.purchase_unit_cost || 0)
    const qpu = Number(ph.quantity_per_unit || 0)
    if (!iid || !Number.isFinite(effMs) || cost <= 0) continue
    const arr = priceHistoryByItemId.get(iid) || []
    arr.push({ effectiveMs: effMs, cost, qpu })
    priceHistoryByItemId.set(iid, arr)
  }

  cachedStaticCatalog = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    stores: (storesRes.data || []).filter((s: any) => Boolean(s.external_id)),
    invItems,
    recipes,
    menuItems,
    templateItemIds,
    externalSupplierItemIds,
    priceHistoryByItemId,
  }
  return cachedStaticCatalog
}

export async function computeExecutiveTheoreticalVsPhysicalReport(params: {
  rawStoreId: string
  startDate: string
  endDate: string
  reconcileQb?: boolean
  includeChainBenchmark?: boolean
}): Promise<ExecutiveTheoreticalVsPhysicalReport> {
  const supabase = await getSupabaseAdminClient()
  const todayLA = getBusinessDateLA()
  const catalog = await getStaticCatalog()

  const allStoresSorted = sortStoresAlphabetically(
    catalog.stores.map((s: any) => ({
      id: Number(s.id),
      rawName: String(s.name),
      name: formatStoreDisplayName({ id: s.id, name: s.name }) || String(s.name),
      code: String(s.code || ''),
      external_id: String(s.external_id),
    })),
    (s) => s.name,
    { pinSpecialFirst: false }
  )

  const cleanStoreParam = (params.rawStoreId || 'all').trim()
  let selectedStores = allStoresSorted
  let singleStore: (typeof allStoresSorted)[number] | null = null

  if (cleanStoreParam.toLowerCase() !== 'all') {
    const found = allStoresSorted.find(
      (s) =>
        String(s.id) === cleanStoreParam ||
        s.external_id.toLowerCase() === cleanStoreParam.toLowerCase() ||
        normalize(s.name) === normalize(cleanStoreParam) ||
        normalize(s.rawName) === normalize(cleanStoreParam)
    )
    if (!found) {
      throw new Error(`Store not found: ${cleanStoreParam}`)
    }
    singleStore = found
    selectedStores = [found]
  }

  const startDate = params.startDate
  const endDate = params.endDate
  const windowDays = Math.max(1, diffCalendarDays(startDate, endDate) + 1)

  // Cuando se consulta una sola tienda por más de 35 días (hasta 65 días) o sin benchmark corporativo,
  // acotar la consulta exclusivamente a esa tienda para reducir 15× el volumen leído en PostgreSQL.
  const queriedStores =
    singleStore && (windowDays > 35 || params.includeChainBenchmark === false)
      ? [singleStore]
      : allStoresSorted

  // Reconciliar facturas QBO con UNA sola llamada global/por-tienda (cero fan-out de 15× en paralelo)
  if (params.reconcileQb !== false && queriedStores.length > 0 && endDate >= addDaysIso(todayLA, -45)) {
    try {
      await reconcileStoreOrdersWithQbInvoices({
        storeId: queriedStores.length === 1 ? queriedStores[0].id : undefined,
        lookbackDays: Math.min(35, Math.max(7, diffCalendarDays(startDate, todayLA) + 5)),
        forceResync: false,
      })
    } catch (qbErr) {
      console.warn('[ExecutiveTVF] Reconciliación QBO omitida por error transitorio:', qbErr)
    }
  }

  // Ventana corta (-4d) para anclas t0 de recetas/carnes; ventana larga (-28d) solo para los ~9 insumos de salsabar
  const histLookbackStart = addDaysIso(startDate, -28)
  const anchorLookbackStart = addDaysIso(startDate, -4)
  const pmixLookbackStart = anchorLookbackStart
  const histMassOnlyEnd = addDaysIso(anchorLookbackStart, -1)

  const queriedStoreNumericIds = queriedStores.map((s) => s.id)
  const queriedStoreExternalIds = queriedStores.map((s) => s.external_id)
  const queriedStoreTextIds = Array.from(
    new Set([...queriedStoreNumericIds.map(String), ...queriedStoreExternalIds])
  )
  const storeByExternalId = new Map(queriedStores.map((s) => [s.external_id, s]))

  // 1. Preparar catálogo elegible (~45 insumos alimenticios) y subconjunto salsabar (~9 insumos) ANTES de consultar DB
  const invById = new Map<string, any>(catalog.invItems.map((i: any) => [String(i.id), i]))
  const eligibleItemIds = Array.from(catalog.templateItemIds).filter((itemId) => {
    const inv = invById.get(itemId)
    if (!inv) return false
    return !isNonFoodUniformOrJanitorialItem(inv)
  })
  const massBalanceItemIds = eligibleItemIds.filter((itemId) => {
    if (PROTEIN_ID_TO_KEY.has(itemId)) return false
    const inv = invById.get(itemId)
    return Boolean(inv && isHistoricalMassBalanceItem({ id: itemId, name: inv.name }))
  })

  // 2. Consultas escalares indexadas y filtradas en PostgreSQL (sin JSONB pesados y excluyendo AUTO_CYCLE_V2 en SQL)
  const salesRows = await fetchAllPaginated<any>((f, t) =>
    supabase
      .from('sales_daily_cache')
      .select('store_id, business_date, net_sales, order_count')
      .in('store_id', queriedStoreExternalIds)
      .gte('business_date', histLookbackStart)
      .lte('business_date', endDate)
      .order('business_date', { ascending: true })
      .range(f, t)
  )

  const recentCounts =
    eligibleItemIds.length > 0
      ? await fetchAllPaginated<any>((f, t) =>
          supabase
            .from('inventory_counts')
            .select('id, store_id, inventory_item_id, count_date, quantity_on_hand, counted_by, notes, created_at')
            .in('inventory_item_id', eligibleItemIds)
            .in('store_id', queriedStoreTextIds)
            .or('counted_by.is.null,counted_by.neq.AUTO_CYCLE_V2')
            .gte('count_date', anchorLookbackStart)
            .lte('count_date', endDate)
            .order('count_date', { ascending: true })
            .order('id', { ascending: true })
            .range(f, t)
        )
      : []

  const histMassCounts =
    massBalanceItemIds.length > 0 && histLookbackStart <= histMassOnlyEnd
      ? await fetchAllPaginated<any>((f, t) =>
          supabase
            .from('inventory_counts')
            .select('id, store_id, inventory_item_id, count_date, quantity_on_hand, counted_by, notes, created_at')
            .in('inventory_item_id', massBalanceItemIds)
            .in('store_id', queriedStoreTextIds)
            .or('counted_by.is.null,counted_by.neq.AUTO_CYCLE_V2')
            .gte('count_date', histLookbackStart)
            .lte('count_date', histMassOnlyEnd)
            .order('count_date', { ascending: true })
            .order('id', { ascending: true })
            .range(f, t)
        )
      : []

  const rawCounts = [...histMassCounts, ...recentCounts]

  const rawOrders = await fetchAllPaginated<any>((f, t) =>
    supabase
      .from('inventory_orders')
      .select('id, store_id, order_date, status, qb_invoice_number')
      .in('store_id', queriedStoreNumericIds)
      .in('order_type', ['daily', 'liquids'])
      .in('status', ['sent', 'received'])
      .gte('order_date', histLookbackStart)
      .lte('order_date', endDate)
      .order('order_date', { ascending: true })
      .range(f, t)
  )

  const orderById = new Map<string, any>(rawOrders.map((o: any) => [String(o.id), o]))
  const recentOrderIds: string[] = []
  const histMassOrderIds: string[] = []
  for (const o of rawOrders) {
    const oDate = String(o.order_date || '')
    if (oDate >= anchorLookbackStart) recentOrderIds.push(String(o.id))
    else histMassOrderIds.push(String(o.id))
  }

  const rawOrderLines: any[] = []
  if (eligibleItemIds.length > 0) {
    for (let i = 0; i < recentOrderIds.length; i += 200) {
      const batch = recentOrderIds.slice(i, i + 200)
      const lines = await fetchAllPaginated<any>((f, t) =>
        supabase
          .from('inventory_order_lines')
          .select('id, order_id, inventory_item_id, calculated_qty, adjusted_qty, final_qty')
          .in('order_id', batch)
          .in('inventory_item_id', eligibleItemIds)
          .order('id', { ascending: true })
          .range(f, t)
      )
      rawOrderLines.push(...lines)
    }
  }
  if (massBalanceItemIds.length > 0) {
    for (let i = 0; i < histMassOrderIds.length; i += 200) {
      const batch = histMassOrderIds.slice(i, i + 200)
      const lines = await fetchAllPaginated<any>((f, t) =>
        supabase
          .from('inventory_order_lines')
          .select('id, order_id, inventory_item_id, calculated_qty, adjusted_qty, final_qty')
          .in('order_id', batch)
          .in('inventory_item_id', massBalanceItemIds)
          .order('id', { ascending: true })
          .range(f, t)
      )
      rawOrderLines.push(...lines)
    }
  }

  const transfers = await fetchConfirmedStoreTransfers({
    supabase,
    storeIds: queriedStoreNumericIds,
    minDate: anchorLookbackStart,
    maxDate: endDate,
  })
  const transferNetMap = buildStoreItemDateNetTransferMap(transfers, new Set(queriedStoreNumericIds))
  const toastNameByGuid = new Map<string, string>(
    catalog.menuItems.map((m: any) => [String(m.guid), String(m.name)])
  )
  const guidsByNormalizedMenuName = new Map<string, string[]>()
  for (const m of catalog.menuItems) {
    const k = normalize(m.name)
    const arr = guidsByNormalizedMenuName.get(k) || []
    arr.push(String(m.guid))
    guidsByNormalizedMenuName.set(k, arr)
  }
  const foodRecipesByGuid = new Map<string, any[]>()
  for (const r of catalog.recipes) {
    if (!['food', 'raw', 'cooked'].includes(String(r.type || ''))) continue
    const g = String(r.toast_menu_item_guid || '')
    const arr = foodRecipesByGuid.get(g) || []
    arr.push(r)
    foodRecipesByGuid.set(g, arr)
  }
  const meatEvalCtx = { toastNameByGuid, foodRecipesByGuid, guidsByNormalizedMenuName }

  const engineCatalogItems = catalog.invItems.map((i: any) => ({
    id: String(i.id),
    name: String(i.name),
    unit_type: i.unit_type,
    unit_measure: i.unit_measure,
    quantity_per_unit: Number(i.quantity_per_unit || 1),
    yield_percent: Number(i.yield_percent || 100),
  }))

  const engineRecipes = catalog.recipes.map((r: any) => ({
    toast_menu_item_guid: String(r.toast_menu_item_guid || ''),
    inventory_item_id: String(r.inventory_item_id || ''),
    quantity: Number(r.quantity || 0),
    unit: String(r.unit || 'pza'),
    type: String(r.type || 'food'),
  }))

  // 3. Evaluar cada `(storeId, businessDate)` de PMIX una sola vez en memoria:
  //    a) las 8 proteínas con `evaluatePmixItemsForProtein`
  //    b) todos los 51 insumos con `calculateDailyOrderConsumption`
  //    c) conteo de las 10 familias de platillos en `[startDate, endDate]`
  const selectedStoreIdSet = new Set<number>(selectedStores.map((s) => s.id))

  // `${storeId}::${date}` -> itemId -> units (en unidad de Orden Diaria)
  const dailyTheoUnitsByStoreDate = new Map<string, Map<string, number>>()
  // `${storeId}::${date}::${proteinKey}` -> { rawLbs, cookedLbs, tacos, burritos, quesadillas, mulitas, tortas, plates, traysCookedLbs }
  const dailyMeatDetailByStoreDate = new Map<
    string,
    {
      rawLbs: number
      cookedLbs: number
      tacos: number
      burritos: number
      quesadillas: number
      mulitas: number
      tortas: number
      plates: number
      traysCookedLbs: number
    }
  >()

  // Contadores de platillos vendidos por tienda en `[startDate, endDate]`
  const storeDishCounters = new Map<
    number,
    {
      tacos: number
      burritos: number
      quesadillas: number
      mulitas: number
      sopes: number
      tortas: number
      platesNachosTrays: number
    }
  >()
  for (const st of queriedStores) {
    storeDishCounters.set(st.id, {
      tacos: 0,
      burritos: 0,
      quesadillas: 0,
      mulitas: 0,
      sopes: 0,
      tortas: 0,
      platesNachosTrays: 0,
    })
  }

  // Acumulador de las 10 familias de platillos para `selectedStores` en `[startDate, endDate]`
  const FAMILY_ORDER: ExecutiveDishFamilyKey[] = [
    'tacos',
    'burritos',
    'quesadillas',
    'mulitas',
    'sopes',
    'tortas',
    'plates_breakfast_nachos',
    'party_trays_lbs',
    'sides_extras',
    'aguas_drinks_desserts',
  ]
  const familyAcc = new Map<
    ExecutiveDishFamilyKey,
    {
      ordersSold: number
      exactUnitsServed: number
      netSalesUsd: number
      meatCookedLbs: number
      meatRawLbs: number
      itemsMap: Map<string, { ordersSold: number; exactUnitsServed: number; netSalesUsd: number }>
    }
  >()
  for (const fk of FAMILY_ORDER) {
    familyAcc.set(fk, {
      ordersSold: 0,
      exactUnitsServed: 0,
      netSalesUsd: 0,
      meatCookedLbs: 0,
      meatRawLbs: 0,
      itemsMap: new Map(),
    })
  }

  // Acumulador de platillos relacionados por proteína en `selectedStores` `[startDate, endDate]`
  const proteinDishTotals = new Map<
    ActiveProteinKey,
    { tacos: number; burritos: number; tortas: number; quesadillas: number; mulitas: number; plates: number }
  >()
  for (const pk of Object.keys(ACTIVE_PROTEIN_IDS) as ActiveProteinKey[]) {
    proteinDishTotals.set(pk, { tacos: 0, burritos: 0, tortas: 0, quesadillas: 0, mulitas: 0, plates: 0 })
  }

  const processSinglePmixRow = (pRow: { store_id: string; business_date: string; items: any }) => {
    const store = storeByExternalId.get(String(pRow.store_id))
    if (!store) return
    const storeId = store.id
    const bDate = String(pRow.business_date)
    const pmixItems: any[] = Array.isArray(pRow.items) ? pRow.items : []
    const inSelectedWindow = bDate >= startDate && bDate <= endDate
    const isSelectedStore = selectedStoreIdSet.has(storeId)

    // A. Evaluar todos los insumos no cárnicos con `calculateDailyOrderConsumption`
    const byChannel = new Map<string, any[]>()
    const stDish = storeDishCounters.get(storeId)!

    for (const pm of pmixItems) {
      const qty = Number(pm.quantity_sold ?? pm.quantity ?? 0)
      if (!Number.isFinite(qty) || qty <= 0) continue
      const rawName = String(pm.name || '')
      const netSalesItem = Number(pm.net_sales || 0)

      if (inSelectedWindow) {
        const cls = classifyAllMenuDishFamily(rawName, pm.guid)
        if (cls.isFoodOrDrink && cls.subUnitsMultiplier > 0) {
          const unitsServed = qty * cls.subUnitsMultiplier
          if (cls.familyKey === 'tacos') stDish.tacos += unitsServed
          else if (cls.familyKey === 'burritos') stDish.burritos += unitsServed
          else if (cls.familyKey === 'quesadillas') stDish.quesadillas += unitsServed
          else if (cls.familyKey === 'mulitas') stDish.mulitas += unitsServed
          else if (cls.familyKey === 'sopes') stDish.sopes += unitsServed
          else if (cls.familyKey === 'tortas') stDish.tortas += unitsServed
          else if (cls.familyKey === 'plates_breakfast_nachos' || cls.familyKey === 'party_trays_lbs') {
            stDish.platesNachosTrays += unitsServed
          }

          if (isSelectedStore) {
            const fBucket = familyAcc.get(cls.familyKey)!
            fBucket.ordersSold += qty
            fBucket.exactUnitsServed += unitsServed
            fBucket.netSalesUsd += netSalesItem
            const baseClean = extractBaseMenuItemName(rawName) || rawName
            const prevIt = fBucket.itemsMap.get(baseClean) || {
              ordersSold: 0,
              exactUnitsServed: 0,
              netSalesUsd: 0,
            }
            prevIt.ordersSold += qty
            prevIt.exactUnitsServed += unitsServed
            prevIt.netSalesUsd += netSalesItem
            fBucket.itemsMap.set(baseClean, prevIt)
          }
        }
      }

      const pmGuid = String(pm.guid || '').trim()
      if (pmGuid && NON_FOOD_POS_GUIDS.has(pmGuid.toLowerCase())) continue

      const catalogBaseName = pmGuid ? toastNameByGuid.get(pmGuid) : undefined
      let resolvedSelName = catalogBaseName || extractBaseMenuItemName(rawName) || rawName
      // Preservar rango explícito (15-20 / 20-25 / 25-30 / 30-40 People) en Party Trays cuando Toast no lo incluye en el nombre base
      const sizeMatch = rawName.match(/\b(?:15\s*-\s*20|20\s*-\s*25|25\s*-\s*30|30\s*-\s*40)\s*(?:people|personas)\b/i)
      if (sizeMatch && !/\d+\s*-\s*\d+\s*(?:people|personas)/i.test(resolvedSelName)) {
        resolvedSelName = `${resolvedSelName} (${sizeMatch[0]})`
      }
      const baseMenuNorm = normalize(catalogBaseName || '')

      const unitPrice =
        Number(pm.unit_price) > 0
          ? Number(pm.unit_price)
          : qty > 0
            ? Number(pm.gross_sales ?? pm.net_sales ?? 0) / qty
            : 0

      // 1) Extraer todos los grupos parentéticos de rawName (sin romper "(In Store)" ni múltiples paréntesis)
      const parenTokenCounts = new Map<string, { raw: string; count: number }>()
      const cleanForParen = rawName.replace(/\(\s*in\s+store\s*\)/gi, '')
      for (const m of cleanForParen.matchAll(/\(([^)]+)\)/g)) {
        const groupContent = m[1].trim()
        if (!groupContent) continue
        if (baseMenuNorm && baseMenuNorm.includes(normalize(`(${groupContent})`))) continue
        for (const rawTok of groupContent.split(',')) {
          const tok = rawTok.trim()
          const tokNorm = normalize(tok)
          if (!tok || !tokNorm || tokNorm === 'in store' || /^\d+\s*-\s*\d+\s*(?:people|personas)$/.test(tokNorm)) {
            continue
          }
          const prev = parenTokenCounts.get(tokNorm) || { raw: tok, count: 0 }
          prev.count += 1
          parenTokenCounts.set(tokNorm, prev)
        }
      }

      const basePerOrderMods = Array.from(parenTokenCounts.values())
      const resolvedNormSet = new Set<string>(parenTokenCounts.keys())
      const hasJackInParens = Array.from(resolvedNormSet).some((k) => /^jack\s+cheese\b/.test(k))

      // 2) Contar ocurrencias exactas en modifier_guids para modificadores omitidos de pm.name (ej. "No Crema", "No Cheese", "No Mayo")
      const modGuidCounts = new Map<string, number>()
      if (Array.isArray(pm.modifier_guids)) {
        for (const mg of pm.modifier_guids) {
          const gStr = String(mg || '').trim()
          if (gStr) modGuidCounts.set(gStr, (modGuidCounts.get(gStr) || 0) + 1)
        }
      }

      const partialGuidMods: Array<{ guid: string; name: string; effCount: number }> = []
      for (const [mg, rawCnt] of modGuidCounts.entries()) {
        const rawModName = toastNameByGuid.get(mg)
        if (!rawModName) continue
        const cleanModName = rawModName.replace(/\s*\(\s*in\s+store\s*\)\s*$/i, '').trim()
        const normMod = normalize(cleanModName)
        if (!normMod || resolvedNormSet.has(normMod) || resolvedNormSet.has(normalize(rawModName))) continue

        const isRemovalMod = /^(?:no|sin)\s+/.test(normMod) || /^(?:solo\s+(?:frijol(?:es)?|arroz)|meat\s*only)\b/.test(normMod)
        // Si no había paréntesis en pm.name, permitir también modificadores funcionales de tortilla/queso; de lo contrario, solo exclusiones "No/Sin"
        if (!isRemovalMod && parenTokenCounts.size > 0) continue
        if (hasJackInParens && /^(?:no|sin)\s+(?:jack|cheese|queso)\b/.test(normMod) && rawCnt < qty) continue

        const effCount = Math.min(qty, Math.max(0, Math.round(rawCnt)))
        if (effCount <= 0) continue
        resolvedNormSet.add(normMod)
        partialGuidMods.push({ guid: mg, name: cleanModName, effCount })
      }

      const ch = String(pm.group_name || 'In Store')
      const list = byChannel.get(ch) || []

      // Particionar [0, qty) en intervalos exactos para que cada modificador parcial tenga mod.quantity === sliceQty
      // y descuente exactamente effCount porciones (nunca effCount * qty ni 0 por exclusión parcial).
      if (partialGuidMods.length === 0) {
        list.push({
          guid: pmGuid,
          name: resolvedSelName,
          price: unitPrice,
          quantity: qty,
          modifiers: basePerOrderMods.map((bm) => ({
            name: bm.raw,
            quantity: bm.count * qty,
          })),
        })
      } else {
        const breakpoints = Array.from(
          new Set<number>([0, qty, ...partialGuidMods.map((m) => m.effCount).filter((c) => c > 0 && c < qty)])
        ).sort((a, b) => a - b)

        for (let bi = 0; bi < breakpoints.length - 1; bi++) {
          const sliceStart = breakpoints[bi]
          const sliceEnd = breakpoints[bi + 1]
          const sliceQty = sliceEnd - sliceStart
          if (sliceQty <= 0) continue
          const sliceMods: Array<{ guid?: string | null; name: string; quantity: number }> = basePerOrderMods.map(
            (bm) => ({
              name: bm.raw,
              quantity: bm.count * sliceQty,
            })
          )
          for (const pmMod of partialGuidMods) {
            if (pmMod.effCount >= sliceEnd) {
              sliceMods.push({
                guid: pmMod.guid,
                name: pmMod.name,
                quantity: sliceQty,
              })
            }
          }
          list.push({
            guid: pmGuid,
            name: resolvedSelName,
            price: unitPrice,
            quantity: sliceQty,
            modifiers: sliceMods,
          })
        }
      }
      byChannel.set(ch, list)
    }

    const tickets = Array.from(byChannel.entries()).map(([ch, sels], idx) => ({
      orderGuid: `pmix-${storeId}-${bDate}-${idx}`,
      businessDate: bDate,
      diningOptionName: ch,
      deliveryService: /uber|doordash|grubhub|postmates/i.test(ch) ? ch : undefined,
      selections: sels,
    }))

    const engineRes = calculateDailyOrderConsumption(
      storeId,
      bDate,
      tickets as any,
      engineRecipes as any,
      engineCatalogItems as any
    )
    const dayMap = new Map<string, number>()
    for (const [itemId, det] of engineRes.itemConsumption.entries()) {
      dayMap.set(itemId, Number(det.totalCalculatedUsage || 0))
    }

    // B. Evaluar las 8 proteínas con `evaluatePmixItemsForProtein` (sobrescribe en `dayMap` con precisión exacta de bolsas)
    for (const [pKey, itemId] of Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>) {
      const invMeat = invById.get(itemId)
      const yieldPct = Number(invMeat?.yield_percent || MEAT_COOKING_YIELDS[pKey] * 100 || 100)
      const bagLbs = getHistoricalMeatBagLbs(pKey, bDate, MEAT_DEFAULT_BAG_LBS[pKey])
      const breakdownMap = inSelectedWindow && isSelectedStore ? new Map<string, any>() : undefined
      const mUsage = evaluatePmixItemsForProtein({
        pmixItems: pmixItems as any,
        inventoryItemId: itemId,
        proteinKey: pKey,
        yieldPercent: yieldPct,
        costPerRawLbStore: 1,
        costPerRawLbBodega: 1,
        ctx: meatEvalCtx,
        collectBreakdownMap: breakdownMap,
      })
      const bagsTheo = bagLbs > 0 ? mUsage.rawLbs / bagLbs : 0
      dayMap.set(itemId, bagsTheo)
      dailyMeatDetailByStoreDate.set(`${storeId}::${bDate}::${pKey}`, {
        rawLbs: mUsage.rawLbs,
        cookedLbs: mUsage.cookedLbs,
        tacos: mUsage.tacosUnits,
        burritos: mUsage.burritosUnits,
        quesadillas: mUsage.quesadillasUnits,
        mulitas: mUsage.mulitasUnits,
        tortas: mUsage.tortasUnits,
        plates: mUsage.platesUnits,
        traysCookedLbs: mUsage.partyTraysCookedLbs,
      })

      if (inSelectedWindow && isSelectedStore) {
        const pd = proteinDishTotals.get(pKey)!
        pd.tacos += mUsage.tacosUnits
        pd.burritos += mUsage.burritosUnits
        pd.tortas += mUsage.tortasUnits
        pd.quesadillas += mUsage.quesadillasUnits
        pd.mulitas += mUsage.mulitasUnits
        pd.plates += mUsage.platesUnits

        if (breakdownMap) {
          for (const line of breakdownMap.values()) {
            const fkMap: Record<string, ExecutiveDishFamilyKey> = {
              tacos: 'tacos',
              burritos: 'burritos',
              quesadillas: 'quesadillas',
              mulitas: 'mulitas',
              sopes: 'sopes',
              tortas: 'tortas',
              plates_nachos_sides: 'plates_breakfast_nachos',
              party_trays_lbs: 'party_trays_lbs',
            }
            const targetFk = fkMap[line.familyKey] || 'plates_breakfast_nachos'
            const fb = familyAcc.get(targetFk)!
            fb.meatCookedLbs += line.cookedLbs
            fb.meatRawLbs += line.rawLbs
          }
        }
      }
    }

    dailyTheoUnitsByStoreDate.set(`${storeId}::${bDate}`, dayMap)
  }

  // Leer pmix_daily_cache en modo streaming estricto (<= 15 filas por petición HTTP = ~3.2 MB JSONB, cero OFFSET, cero acumulación en RAM),
  // validando isPmixCacheRowFinalized en fechas cerradas (< todayLA) y aplicando fallback vivo acotado (<= 15 llamadas) para días faltantes/abiertos.
  const effectivePmixEnd = endDate <= todayLA ? endDate : todayLA
  const closedPmixEnd = effectivePmixEnd < todayLA ? effectivePmixEnd : addDaysIso(todayLA, -1)
  const finalizedPmixStoreDates = new Set<string>()

  if (queriedStoreExternalIds.length > 0 && pmixLookbackStart <= closedPmixEnd) {
    await readPmixDailyCacheChunked(supabase, {
      storeGuids: queriedStoreExternalIds,
      startDate: pmixLookbackStart,
      endDate: closedPmixEnd,
      includeUpdatedAt: true,
      chunkRows: PMIX_SAFE_CHUNK_ROWS,
      maxRows: 900,
      onChunk: (chunk) => {
        for (const pRow of chunk) {
          const guid = String(pRow.store_id || '')
          const bDate = String(pRow.business_date || '')
          if (!guid || !bDate || bDate >= todayLA) continue
          if (!Array.isArray(pRow.items) || pRow.items.length === 0) continue
          if (!isPmixCacheRowFinalized(bDate, pRow.updated_at, todayLA)) continue
          finalizedPmixStoreDates.add(`${guid}::${bDate}`)
          processSinglePmixRow(pRow)
        }
      },
    })
  }

  const MAX_LIVE_PMIX_FALLBACK_CALLS = 15
  let liveFallbackCount = 0
  if (queriedStores.length > 0 && pmixLookbackStart <= effectivePmixEnd) {
    for (const st of queriedStores) {
      for (let d = pmixLookbackStart; d <= effectivePmixEnd; d = addDaysIso(d, 1)) {
        const key = `${st.external_id}::${d}`
        if (finalizedPmixStoreDates.has(key)) continue
        if (diffCalendarDays(d, todayLA) > 120) continue
        if (liveFallbackCount >= MAX_LIVE_PMIX_FALLBACK_CALLS) break
        liveFallbackCount++
        try {
          const liveItems = await getProductMix({
            storeId: st.external_id,
            startDate: d,
            endDate: d,
            bundleModifiers: true,
            skipCache: d < todayLA,
          })
          if (Array.isArray(liveItems) && liveItems.length > 0) {
            processSinglePmixRow({ store_id: st.external_id, business_date: d, items: liveItems })
          }
        } catch (liveErr) {
          console.warn(`[ExecutiveTVF] Live PMIX fallback omitido en ${st.name} (${d}):`, liveErr)
        }
      }
      if (liveFallbackCount >= MAX_LIVE_PMIX_FALLBACK_CALLS) break
    }
  }

  // 4. Indexar Ventas Netas, Conteos Físicos Humanos y Entregas de Bodega (QBO)
  // `${storeId}::${date}` -> { netSales, orderCount }
  const salesByStoreDate = new Map<string, { netSales: number; orderCount: number }>()
  for (const s of salesRows) {
    const st = storeByExternalId.get(String(s.store_id))
    if (!st) continue
    salesByStoreDate.set(`${st.id}::${s.business_date}`, {
      netSales: Number(s.net_sales || 0),
      orderCount: Number(s.order_count || 0),
    })
  }

  // `${storeId}::${itemId}` -> Map<date, { qty, by, createdAt }>
  const humanCountsByStoreItem = new Map<string, Map<string, { qty: number; by: string | null; createdAt: string }>>()
  const numericStoreSet = new Set(queriedStoreNumericIds.map(String))
  for (const c of rawCounts) {
    if (!isHumanPhysicalCountRow(c) || isAutoCycleCountRecord({ countedBy: c.counted_by, notes: c.notes })) {
      continue
    }
    const rawSt = String(c.store_id || '').trim()
    let stNum: number | null = null
    if (numericStoreSet.has(rawSt)) stNum = Number(rawSt)
    else {
      const byExt = storeByExternalId.get(rawSt)
      if (byExt) stNum = byExt.id
    }
    if (!stNum) continue
    const itemId = String(c.inventory_item_id)
    const cDate = String(c.count_date)
    const key = `${stNum}::${itemId}`
    let dMap = humanCountsByStoreItem.get(key)
    if (!dMap) {
      dMap = new Map()
      humanCountsByStoreItem.set(key, dMap)
    }
    const prev = dMap.get(cDate)
    const createdAt = String(c.created_at || '')
    if (!prev || createdAt >= prev.createdAt) {
      dMap.set(cDate, {
        qty: Number(c.quantity_on_hand),
        by: c.counted_by ? String(c.counted_by) : null,
        createdAt,
      })
    }
  }

  // `${storeId}::${itemId}::${orderDate}` -> { qty, invoices }
  const arrivalsByStoreItemDate = new Map<string, { qty: number; invoices: string[] }>()
  for (const l of rawOrderLines) {
    const ord = orderById.get(String(l.order_id))
    if (!ord) continue
    const stNum = Number(ord.store_id)
    const itemId = String(l.inventory_item_id)
    const oDate = String(ord.order_date)
    const qty = Number(l.final_qty ?? l.adjusted_qty ?? l.calculated_qty ?? 0)
    const key = `${stNum}::${itemId}::${oDate}`
    const cur = arrivalsByStoreItemDate.get(key) || { qty: 0, invoices: [] }
    cur.qty += qty
    if (ord.qb_invoice_number) {
      const tag = `#${ord.qb_invoice_number}`
      if (!cur.invoices.includes(tag)) cur.invoices.push(tag)
    }
    arrivalsByStoreItemDate.set(key, cur)
  }

  // 5. Resolver ancla telescópica canónica `[t0, t1]` para cualquier `(storeId, itemId)` en `[startDate, endDate]`
  const resolveAnchor = (sortedDates: string[]) =>
    resolveCanonicalTelescopingAnchor(sortedDates, startDate, endDate)

  const endWindowInstantMs = buildLAInstant(addDaysIso(endDate, 1), 5, 59).getTime()
  const storePrimaryMeatSpan = new Map<number, { t0: string; t1: string; spanDays: number; isAsada: boolean }>()

  // 6. Acumuladores por tienda para `storeRows`
  const storeMetricsMap = new Map<
    number,
    {
      netSalesUsd: number
      orderCount: number
      meatsMeasuredCount: number
      meatsTheoBags: number
      meatsPhysicalBags: number
      meatsTheoRawLbs: number
      meatsPhysicalRawLbs: number
      meatsTheoCostStoreUsd: number
      meatsPhysicalCostStoreUsd: number
      meatsDiffCostStoreUsd: number
      meatsDiffCostBodegaUsd: number
      meatsEquivTacosDiff: number
      asadaRealOzPerTaco: number | null
      allMeasuredItemsCount: number
      allTheoCostStoreUsd: number
      allPhysicalCostStoreUsd: number
      allDiffCostStoreUsd: number
      allDiffCostBodegaUsd: number
    }
  >()

  for (const st of queriedStores) {
    let sSales = 0
    let sOrders = 0
    for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) {
      const rec = salesByStoreDate.get(`${st.id}::${d}`)
      if (rec) {
        sSales += rec.netSales
        sOrders += rec.orderCount
      }
    }
    storeMetricsMap.set(st.id, {
      netSalesUsd: round2(sSales),
      orderCount: sOrders,
      meatsMeasuredCount: 0,
      meatsTheoBags: 0,
      meatsPhysicalBags: 0,
      meatsTheoRawLbs: 0,
      meatsPhysicalRawLbs: 0,
      meatsTheoCostStoreUsd: 0,
      meatsPhysicalCostStoreUsd: 0,
      meatsDiffCostStoreUsd: 0,
      meatsDiffCostBodegaUsd: 0,
      meatsEquivTacosDiff: 0,
      asadaRealOzPerTaco: null,
      allMeasuredItemsCount: 0,
      allTheoCostStoreUsd: 0,
      allPhysicalCostStoreUsd: 0,
      allDiffCostStoreUsd: 0,
      allDiffCostBodegaUsd: 0,
    })
  }

  // Totales globales de platillos en `selectedStores`
  const getSelDishSum = (fn: (c: NonNullable<ReturnType<typeof storeDishCounters.get>>) => number) =>
    round1(selectedStores.reduce((a, s) => a + fn(storeDishCounters.get(s.id)!), 0))

  const selTacosAll = getSelDishSum((c) => c.tacos)
  const selBurritosAll = getSelDishSum((c) => c.burritos)
  const selQuesadillasAll = getSelDishSum((c) => c.quesadillas)
  const selMulitasAll = getSelDishSum((c) => c.mulitas)
  const selSopesAll = getSelDishSum((c) => c.sopes)
  const selTortasAll = getSelDishSum((c) => c.tortas)
  const selPlatesTraysAll = getSelDishSum((c) => c.platesNachosTrays)

  const buildRelatedDishesLabel = (inv: any, proteinKey: ActiveProteinKey | null) => {
    if (proteinKey) {
      const pd = proteinDishTotals.get(proteinKey)!
      const partsEs: string[] = []
      const partsEn: string[] = []
      if (pd.tacos > 0) {
        partsEs.push(`${Math.round(pd.tacos).toLocaleString('en-US')} tacos`)
        partsEn.push(`${Math.round(pd.tacos).toLocaleString('en-US')} tacos`)
      }
      if (pd.burritos > 0) {
        partsEs.push(`${Math.round(pd.burritos).toLocaleString('en-US')} burritos`)
        partsEn.push(`${Math.round(pd.burritos).toLocaleString('en-US')} burritos`)
      }
      if (pd.tortas > 0) {
        partsEs.push(`${Math.round(pd.tortas).toLocaleString('en-US')} tortas`)
        partsEn.push(`${Math.round(pd.tortas).toLocaleString('en-US')} tortas`)
      }
      if (pd.quesadillas + pd.mulitas > 0) {
        const qm = Math.round(pd.quesadillas + pd.mulitas)
        partsEs.push(`${qm.toLocaleString('en-US')} quesad./mulitas`)
        partsEn.push(`${qm.toLocaleString('en-US')} quesad./mulitas`)
      }
      if (pd.plates > 0) {
        partsEs.push(`${Math.round(pd.plates).toLocaleString('en-US')} platos/nachos`)
        partsEn.push(`${Math.round(pd.plates).toLocaleString('en-US')} plates/nachos`)
      }
      return {
        es: partsEs.join(' · ') || 'Sin ventas registradas en periodo',
        en: partsEn.join(' · ') || 'No sales recorded in period',
      }
    }
    const n = normalize(inv.name)
    if (/tortilla.*60ct/.test(n)) {
      return {
        es: `${Math.round(selTacosAll).toLocaleString('en-US')} tacos · platos/desayunos c/ maíz · charolas`,
        en: `${Math.round(selTacosAll).toLocaleString('en-US')} tacos · corn plates/breakfasts · trays`,
      }
    }
    if (/13.*flour/.test(n)) {
      return {
        es: `${Math.round(selBurritosAll).toLocaleString('en-US')} burritos vendidos`,
        en: `${Math.round(selBurritosAll).toLocaleString('en-US')} burritos sold`,
      }
    }
    if (/mulitas/.test(n)) {
      return {
        es: `${Math.round(selMulitasAll).toLocaleString('en-US')} mulitas vendidas`,
        en: `${Math.round(selMulitasAll).toLocaleString('en-US')} mulitas sold`,
      }
    }
    if (/quesadilla\s*bodega/.test(n)) {
      return {
        es: `${Math.round(selQuesadillasAll).toLocaleString('en-US')} quesadillas vendidas`,
        en: `${Math.round(selQuesadillasAll).toLocaleString('en-US')} quesadillas sold`,
      }
    }
    if (/sopes/.test(n)) {
      return {
        es: `${Math.round(selSopesAll).toLocaleString('en-US')} sopes vendidos`,
        en: `${Math.round(selSopesAll).toLocaleString('en-US')} sopes sold`,
      }
    }
    if (/teleras/.test(n)) {
      return {
        es: `${Math.round(selTortasAll).toLocaleString('en-US')} tortas vendidas`,
        en: `${Math.round(selTortasAll).toLocaleString('en-US')} tortas sold`,
      }
    }
    if (/arroz|frijol\s*molido/.test(n)) {
      return {
        es: `${Math.round(selBurritosAll).toLocaleString('en-US')} burritos · ${Math.round(selPlatesTraysAll).toLocaleString('en-US')} platos/charolas · sides`,
        en: `${Math.round(selBurritosAll).toLocaleString('en-US')} burritos · ${Math.round(selPlatesTraysAll).toLocaleString('en-US')} plates/trays · sides`,
      }
    }
    if (/aguacate/.test(n)) {
      return {
        es: 'Super Burritos · Tortas · Super Quesad./Mulitas · Platos · Guacamole',
        en: 'Super Burritos · Tortas · Super Quesad./Mulitas · Plates · Guacamole',
      }
    }
    if (/papelito/.test(n)) {
      return {
        es: `${Math.round(selTortasAll).toLocaleString('en-US')} tortas · platos regulares y desayunos`,
        en: `${Math.round(selTortasAll).toLocaleString('en-US')} tortas · regular plates & breakfasts`,
      }
    }
    if (isHistoricalMassBalanceItem({ id: String(inv.id), name: inv.name })) {
      return {
        es: 'Autoservicio / Salsabar (medido vs. ritmo propio por cada $1k venta)',
        en: 'Self-Serve / Salsa Bar (measured vs. store own rate per $1k sales)',
      }
    }
    return {
      es: 'Recetas directas cobradas en Toast POS',
      en: 'Direct recipes billed in Toast POS',
    }
  }

  // 7. Evaluar cada producto en las 15 sucursales y consolidar para `selectedStores`
  const productRows: ExecutiveProductComparisonRow[] = []

  for (const itemId of eligibleItemIds) {
    const inv = invById.get(itemId)
    if (!inv) continue
    const proteinKey = PROTEIN_ID_TO_KEY.get(itemId) || null
    const isMeat = proteinKey !== null
    const isPapelito = itemId === PAPELITO_ITEM_ID
    const isMassBalance = !isMeat && isHistoricalMassBalanceItem({ id: itemId, name: inv.name })
    const category = classifyProductCategory(inv, isMeat)
    const refBagLbs = proteinKey
      ? getHistoricalMeatBagLbs(proteinKey, endDate, MEAT_DEFAULT_BAG_LBS[proteinKey])
      : 0
    const uMeta = buildUnitLabels(inv, isPapelito, proteinKey)
    if (proteinKey && refBagLbs > 0 && refBagLbs !== uMeta.packSizeQty) {
      uMeta.packSizeQty = refBagLbs
      uMeta.es = refBagLbs < 1 ? `bolsitas (${Math.round(refBagLbs * 16)} oz)` : `bolsas (${refBagLbs} lb)`
      uMeta.en = refBagLbs < 1 ? `pouches (${Math.round(refBagLbs * 16)} oz)` : `bags (${refBagLbs} lb)`
    }
    const yieldPct = isMeat
      ? Number(inv.yield_percent || MEAT_COOKING_YIELDS[proteinKey] * 100)
      : Number(inv.yield_percent || 100)
    const yieldRatio = yieldPct > 0 ? yieldPct / 100 : 1

    let effectivePurchaseCost = Number(inv.purchase_unit_cost || 0)
    let effectiveQpu = Number(inv.quantity_per_unit || 0)
    const phList = catalog.priceHistoryByItemId.get(itemId)
    if (phList && phList.length > 0) {
      for (const ph of phList) {
        if (ph.effectiveMs <= endWindowInstantMs && ph.cost > 0) {
          effectivePurchaseCost = ph.cost
          if (ph.qpu > 0) effectiveQpu = ph.qpu
        }
      }
    }
    const papelitoDivisor = effectiveQpu >= 10 ? effectiveQpu : Math.max(1, Number(inv.quantity_per_unit || 60))
    const unitCostStoreUsd = isPapelito ? round2(effectivePurchaseCost / papelitoDivisor) : effectivePurchaseCost
    const isExternalDirectSupplier =
      catalog.externalSupplierItemIds.has(itemId) ||
      EXTERNAL_DIRECT_SUPPLIER_ITEM_IDS.has(itemId) ||
      inv.sku === '251W' ||
      inv.sku === '253W'
    const bodegaRatio = proteinKey
      ? BODEGA_COST_RATIO_BY_PROTEIN[proteinKey] ?? 0.85
      : isExternalDirectSupplier
        ? 1.0
        : 0.9
    const unitCostBodegaUsd = round2(unitCostStoreUsd * bodegaRatio)

    const perStoreBreakdown: ProductPerStoreCell[] = []

    // Acumuladores para `selectedStores`
    let selMeasuredStores = 0
    let selSpanDaysSum = 0
    let selMinT0: string | null = null
    let selMaxT1: string | null = null
    let selOpen = 0
    let selArr = 0
    let selTrans = 0
    let selClose = 0
    const selInvs = new Set<string>()
    let selTheoWindowUnits = 0
    let selTheoSpanUnits = 0
    let selPhysSpanUnits = 0
    let selTheoSpanCookedLbs = 0

    for (const st of queriedStores) {
      const isSelectedSt = selectedStoreIdSet.has(st.id)
      const countMap = humanCountsByStoreItem.get(`${st.id}::${itemId}`)
      const sortedDates = countMap ? Array.from(countMap.keys()).sort() : []
      const anchor = resolveAnchor(sortedDates)

      // Consumo teórico en toda la ventana `[startDate, endDate]`
      let stWindowTheoUnits = 0
      for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) {
        stWindowTheoUnits += dailyTheoUnitsByStoreDate.get(`${st.id}::${d}`)?.get(itemId) || 0
      }
      if (isSelectedSt) {
        selTheoWindowUnits += stWindowTheoUnits
      }

      if (!anchor || !countMap) {
        perStoreBreakdown.push({
          storeId: st.id,
          storeName: st.name,
          hasMeasuredSpan: false,
          spanDays: 0,
          t0: null,
          t1: null,
          openingUnits: null,
          arrivedUnits: 0,
          transferNetUnits: 0,
          closingUnits: null,
          invoiceNumbers: [],
          theoUnits: round2(stWindowTheoUnits),
          physicalUnits: null,
          diffUnits: null,
          diffUnitsPerDay: null,
          diffPct: null,
          theoCostStoreUsd: round2(stWindowTheoUnits * unitCostStoreUsd),
          physicalCostStoreUsd: null,
          diffCostStoreUsd: null,
          diffCostBodegaUsd: null,
          realOzPerTaco: null,
          equivTacosDiff: null,
          status: 'unmeasured',
        })
        continue
      }

      const { t0, t1, spanDays } = anchor
      const openQty = countMap.get(t0)!.qty
      const closeQty = countMap.get(t1)!.qty

      let arrivedQty = 0
      let arrivedMeatLbs = 0
      const stInvs: string[] = []
      for (let d = t0; d < t1; d = addDaysIso(d, 1)) {
        const arrRec = arrivalsByStoreItemDate.get(`${st.id}::${itemId}::${d}`)
        if (arrRec) {
          arrivedQty += arrRec.qty
          if (proteinKey) {
            arrivedMeatLbs += arrRec.qty * getHistoricalMeatBagLbs(proteinKey, d, refBagLbs)
          }
          for (const invTag of arrRec.invoices) {
            if (!stInvs.includes(invTag)) stInvs.push(invTag)
          }
        }
      }
      let transNetQty = 0
      let transMeatLbs = 0
      for (let d = addDaysIso(t0, 1); d <= t1; d = addDaysIso(d, 1)) {
        const trQty = transferNetMap.get(`${st.id}::${itemId}::${d}`)?.netQty || 0
        transNetQty += trQty
        if (proteinKey && trQty !== 0) {
          transMeatLbs += trQty * getHistoricalMeatBagLbs(proteinKey, d, refBagLbs)
        }
      }

      const rawPhysUsed = proteinKey
        ? refBagLbs > 0
          ? (openQty * getHistoricalMeatBagLbs(proteinKey, t0, refBagLbs) +
              arrivedMeatLbs +
              transMeatLbs -
              closeQty * getHistoricalMeatBagLbs(proteinKey, t1, refBagLbs)) /
            refBagLbs
          : 0
        : openQty + arrivedQty + transNetQty - closeQty
      if (rawPhysUsed < -0.01) {
        // Anomalía de captura negativa: reportar como no medido honestamente para no distorsionar totales
        perStoreBreakdown.push({
          storeId: st.id,
          storeName: st.name,
          hasMeasuredSpan: false,
          spanDays,
          t0,
          t1,
          openingUnits: openQty,
          arrivedUnits: round2(arrivedQty),
          transferNetUnits: round2(transNetQty),
          closingUnits: closeQty,
          invoiceNumbers: stInvs,
          theoUnits: round2(stWindowTheoUnits),
          physicalUnits: null,
          diffUnits: null,
          diffUnitsPerDay: null,
          diffPct: null,
          theoCostStoreUsd: round2(stWindowTheoUnits * unitCostStoreUsd),
          physicalCostStoreUsd: null,
          diffCostStoreUsd: null,
          diffCostBodegaUsd: null,
          realOzPerTaco: null,
          equivTacosDiff: null,
          status: 'unmeasured',
        })
        continue
      }

      const physUsed = Math.max(0, rawPhysUsed)

      // Calcular esperado teórico o mediana histórica en exactamente `(t0, t1]`
      let stSpanTheoUnits = 0
      let stSpanCookedLbs = 0
      let stSpanRawLbs = 0
      if (!isMassBalance) {
        for (let d = addDaysIso(t0, 1); d <= t1; d = addDaysIso(d, 1)) {
          if (proteinKey) {
            const md = dailyMeatDetailByStoreDate.get(`${st.id}::${d}::${proteinKey}`)
            stSpanRawLbs += md?.rawLbs || 0
            stSpanCookedLbs += md?.cookedLbs || 0
          } else {
            stSpanTheoUnits += dailyTheoUnitsByStoreDate.get(`${st.id}::${d}`)?.get(itemId) || 0
          }
        }
        if (proteinKey) {
          stSpanTheoUnits = refBagLbs > 0 ? stSpanRawLbs / refBagLbs : 0
        }
      } else {
        const preDates = sortedDates.filter((d) => d <= t0)
        const histRatesAll: number[] = []
        let nonZeroSpans = 0
        for (let k = 1; k < preDates.length; k++) {
          const p0 = preDates[k - 1]
          const p1 = preDates[k]
          if (diffCalendarDays(p0, p1) > 10) continue
          let pArr = 0
          for (let d = p0; d < p1; d = addDaysIso(d, 1)) {
            pArr += arrivalsByStoreItemDate.get(`${st.id}::${itemId}::${d}`)?.qty || 0
          }
          for (let d = addDaysIso(p0, 1); d <= p1; d = addDaysIso(d, 1)) {
            pArr += transferNetMap.get(`${st.id}::${itemId}::${d}`)?.netQty || 0
          }
          const pUsed = countMap.get(p0)!.qty + pArr - countMap.get(p1)!.qty
          let pSales = 0
          for (let d = addDaysIso(p0, 1); d <= p1; d = addDaysIso(d, 1)) {
            pSales += salesByStoreDate.get(`${st.id}::${d}`)?.netSales || 0
          }
          if (pUsed >= 0 && pSales > 1000) {
            histRatesAll.push(pUsed / (pSales / 1000))
            if (pUsed > 0) nonZeroSpans++
          }
        }
        // Tasa telescópica sin sesgo sobre toda la ventana histórica previa [preFirst, preLast]
        // para insumos de baja rotación por caja (ej. Viva Lard 48 lb, Agua Clientes, Agua Gavilan)
        // donde la mediana diaria da 0 y filtrar solo días >0 inflaría la tasa 4x–10x.
        let telescopicPreRate = 0
        if (preDates.length >= 2) {
          const preFirst = preDates[0]
          const preLast = preDates[preDates.length - 1]
          if (diffCalendarDays(preFirst, preLast) >= 5) {
            let totPreArr = 0
            for (let d = preFirst; d < preLast; d = addDaysIso(d, 1)) {
              totPreArr += arrivalsByStoreItemDate.get(`${st.id}::${itemId}::${d}`)?.qty || 0
            }
            for (let d = addDaysIso(preFirst, 1); d <= preLast; d = addDaysIso(d, 1)) {
              totPreArr += transferNetMap.get(`${st.id}::${itemId}::${d}`)?.netQty || 0
            }
            const totPreUsed = countMap.get(preFirst)!.qty + totPreArr - countMap.get(preLast)!.qty
            let totPreSales = 0
            for (let d = addDaysIso(preFirst, 1); d <= preLast; d = addDaysIso(d, 1)) {
              totPreSales += salesByStoreDate.get(`${st.id}::${d}`)?.netSales || 0
            }
            if (totPreUsed > 0 && totPreSales > 3000) {
              telescopicPreRate = totPreUsed / (totPreSales / 1000)
            }
          }
        }
        let spanSales = 0
        for (let d = addDaysIso(t0, 1); d <= t1; d = addDaysIso(d, 1)) {
          spanSales += salesByStoreDate.get(`${st.id}::${d}`)?.netSales || 0
        }
        const medianAll = computeRobustMedian(histRatesAll)
        const isFrequentDailyItem = histRatesAll.length >= 3 && nonZeroSpans / histRatesAll.length >= 0.6 && medianAll > 0
        const effectiveRatePer1k = isFrequentDailyItem ? medianAll : telescopicPreRate > 0 ? telescopicPreRate : medianAll
        if (effectiveRatePer1k > 0 && spanSales > 0) {
          stSpanTheoUnits = effectiveRatePer1k * (spanSales / 1000)
        } else {
          // Si no hay tasa histórica positiva previa suficiente, caer al motor POS si reporta >0 o igualar a físico para no inventar pérdida
          let posFallback = 0
          for (let d = addDaysIso(t0, 1); d <= t1; d = addDaysIso(d, 1)) {
            posFallback += dailyTheoUnitsByStoreDate.get(`${st.id}::${d}`)?.get(itemId) || 0
          }
          stSpanTheoUnits = posFallback > 0 ? posFallback : physUsed
        }
      }

      const stDiffUnits = physUsed - stSpanTheoUnits
      const stDiffPct = stSpanTheoUnits > 0.05 ? (stDiffUnits / stSpanTheoUnits) * 100 : null
      const stTheoCostStore = stSpanTheoUnits * unitCostStoreUsd
      const stPhysCostStore = physUsed * unitCostStoreUsd
      const stDiffCostStore = stDiffUnits * unitCostStoreUsd
      const stDiffCostBodega = stDiffUnits * unitCostBodegaUsd

      let stRealOzPerTaco: number | null = null
      let stEquivTacosDiff: number | null = null
      if (proteinKey) {
        const bagLbs = refBagLbs
        const physCookedOz = physUsed * bagLbs * yieldRatio * 16
        const theoCookedOz = stSpanCookedLbs * 16
        stEquivTacosDiff = Math.round((physCookedOz - theoCookedOz) / 1.5)
        if (theoCookedOz > 1.5) {
          stRealOzPerTaco = round2(1.5 * (physCookedOz / theoCookedOz))
        }
      }

      const stStatus = evaluateHealthStatus({
        hasMeasuredSpan: true,
        diffPct: stDiffPct,
        diffCostStoreUsd: stDiffCostStore,
        isMeat,
        proteinKey,
        spanDays,
      })

      perStoreBreakdown.push({
        storeId: st.id,
        storeName: st.name,
        hasMeasuredSpan: true,
        spanDays,
        t0,
        t1,
        openingUnits: round2(openQty),
        arrivedUnits: round2(arrivedQty),
        transferNetUnits: round2(transNetQty),
        closingUnits: round2(closeQty),
        invoiceNumbers: stInvs,
        theoUnits: round2(stSpanTheoUnits),
        physicalUnits: round2(physUsed),
        diffUnits: round2(stDiffUnits),
        diffUnitsPerDay: round2(stDiffUnits / Math.max(1, spanDays)),
        diffPct: stDiffPct !== null ? round1(stDiffPct) : null,
        theoCostStoreUsd: round2(stTheoCostStore),
        physicalCostStoreUsd: round2(stPhysCostStore),
        diffCostStoreUsd: round2(stDiffCostStore),
        diffCostBodegaUsd: round2(stDiffCostBodega),
        realOzPerTaco: stRealOzPerTaco,
        equivTacosDiff: stEquivTacosDiff,
        status: stStatus,
      })

      // Acumular en métricas de la sucursal (para la tabla comparativa de las 15 sucursales)
      const stMet = storeMetricsMap.get(st.id)!
      stMet.allMeasuredItemsCount += 1
      stMet.allTheoCostStoreUsd += stTheoCostStore
      stMet.allPhysicalCostStoreUsd += stPhysCostStore
      stMet.allDiffCostStoreUsd += stDiffCostStore
      stMet.allDiffCostBodegaUsd += stDiffCostBodega

      if (proteinKey) {
        const bagLbs = refBagLbs
        stMet.meatsMeasuredCount += 1
        stMet.meatsTheoBags += stSpanTheoUnits
        stMet.meatsPhysicalBags += physUsed
        stMet.meatsTheoRawLbs += stSpanTheoUnits * bagLbs
        stMet.meatsPhysicalRawLbs += physUsed * bagLbs
        stMet.meatsTheoCostStoreUsd += stTheoCostStore
        stMet.meatsPhysicalCostStoreUsd += stPhysCostStore
        stMet.meatsDiffCostStoreUsd += stDiffCostStore
        stMet.meatsDiffCostBodegaUsd += stDiffCostBodega
        stMet.meatsEquivTacosDiff += stEquivTacosDiff || 0
        if (proteinKey === 'asada') {
          stMet.asadaRealOzPerTaco = stRealOzPerTaco
        }
        const prevPrimary = storePrimaryMeatSpan.get(st.id)
        if (
          !prevPrimary ||
          (proteinKey === 'asada' && !prevPrimary.isAsada) ||
          (!prevPrimary.isAsada && spanDays > prevPrimary.spanDays)
        ) {
          storePrimaryMeatSpan.set(st.id, { t0, t1, spanDays, isAsada: proteinKey === 'asada' })
        }
      }

      if (isSelectedSt) {
        selMeasuredStores += 1
        selSpanDaysSum += spanDays
        if (!selMinT0 || t0 < selMinT0) selMinT0 = t0
        if (!selMaxT1 || t1 > selMaxT1) selMaxT1 = t1
        selOpen += openQty
        selArr += arrivedQty
        selTrans += transNetQty
        selClose += closeQty
        for (const tag of stInvs) selInvs.add(tag)
        selTheoSpanUnits += stSpanTheoUnits
        selPhysSpanUnits += physUsed
        selTheoSpanCookedLbs += stSpanCookedLbs
      }
    }

    const hasMeasured = selMeasuredStores > 0
    const avgSpanDays = hasMeasured ? Math.max(1, round1(selSpanDaysSum / selMeasuredStores)) : windowDays
    const effectiveTheoUnits = hasMeasured ? selTheoSpanUnits : selTheoWindowUnits
    const diffUnits = hasMeasured ? selPhysSpanUnits - selTheoSpanUnits : 0
    const diffUnitsPerDay = hasMeasured ? diffUnits / Math.max(1, avgSpanDays) : 0
    const diffPct = hasMeasured && selTheoSpanUnits > 0.05 ? (diffUnits / selTheoSpanUnits) * 100 : null
    const efficiencyPct =
      hasMeasured && selPhysSpanUnits > 0.05 ? (selTheoSpanUnits / selPhysSpanUnits) * 100 : null

    const theoBaseQty = effectiveTheoUnits * uMeta.packSizeQty
    const physBaseQty = selPhysSpanUnits * uMeta.packSizeQty
    const diffBaseQty = diffUnits * uMeta.packSizeQty

    const theoCostStore = effectiveTheoUnits * unitCostStoreUsd
    const theoCostBodega = effectiveTheoUnits * unitCostBodegaUsd
    const physCostStore = selPhysSpanUnits * unitCostStoreUsd
    const physCostBodega = selPhysSpanUnits * unitCostBodegaUsd
    const diffCostStore = hasMeasured ? diffUnits * unitCostStoreUsd : 0
    const diffCostBodega = hasMeasured ? diffUnits * unitCostBodegaUsd : 0

    let equivTacos15Oz: number | null = null
    let equivBurritos6Oz: number | null = null
    let realAvgOzPerTaco: number | null = null
    let realAvgOzPerBurrito: number | null = null
    let physCookedLbsEquiv: number | null = null

    if (proteinKey && hasMeasured) {
      const bagLbs = refBagLbs
      physCookedLbsEquiv = round2(selPhysSpanUnits * bagLbs * yieldRatio)
      const physCookedOz = physCookedLbsEquiv * 16
      const theoCookedOz = selTheoSpanCookedLbs * 16
      const diffCookedOz = physCookedOz - theoCookedOz
      equivTacos15Oz = Math.round(diffCookedOz / 1.5)
      equivBurritos6Oz = Math.round(diffCookedOz / 6.0)
      if (theoCookedOz > 1.5) {
        realAvgOzPerTaco = round2(1.5 * (physCookedOz / theoCookedOz))
        realAvgOzPerBurrito = round2(6.0 * (physCookedOz / theoCookedOz))
      }
    }

    const rowStatus = evaluateHealthStatus({
      hasMeasuredSpan: hasMeasured,
      diffPct,
      diffCostStoreUsd: diffCostStore,
      isMeat,
      proteinKey,
      spanDays: avgSpanDays,
    })

    let comparisonNoteEs = 'Sin segundo conteo físico en el periodo'
    let comparisonNoteEn = 'Missing second physical count in period'

    if (hasMeasured) {
      if (proteinKey && realAvgOzPerTaco !== null && equivTacos15Oz !== null) {
        const signTacos = equivTacos15Oz >= 0 ? `+${equivTacos15Oz.toLocaleString('en-US')}` : equivTacos15Oz.toLocaleString('en-US')
        comparisonNoteEs = `Porción real: ${realAvgOzPerTaco.toFixed(2)} oz/taco (meta 1.50 oz) · ${realAvgOzPerBurrito?.toFixed(2)} oz/burrito (meta 6.00 oz) · Equiv. ${signTacos} tacos`
        comparisonNoteEn = `Actual portion: ${realAvgOzPerTaco.toFixed(2)} oz/taco (1.50 oz std) · ${realAvgOzPerBurrito?.toFixed(2)} oz/burrito (6.00 oz std) · Equiv. ${signTacos} tacos`
      } else {
        const signBase = diffBaseQty >= 0 ? `+${round1(diffBaseQty).toLocaleString('en-US')}` : round1(diffBaseQty).toLocaleString('en-US')
        const signDay = diffUnitsPerDay >= 0 ? `+${round1(diffUnitsPerDay)}` : `${round1(diffUnitsPerDay)}`
        comparisonNoteEs = `Diferencia: ${signBase} ${uMeta.baseMeasure} (${signDay}/día)`
        comparisonNoteEn = `Difference: ${signBase} ${uMeta.baseMeasure} (${signDay}/day)`
      }
    }

    const related = buildRelatedDishesLabel(inv, proteinKey)

    // Evitar filas completamente muertas (sin uso teórico ni físico ni llegadas)
    if (!hasMeasured && effectiveTheoUnits < 0.01) continue

    productRows.push({
      itemId,
      sku: String(inv.sku || ''),
      name: String(inv.name || ''),
      category,
      isMeat,
      proteinKey,
      measurementMode: isMassBalance ? 'salsabar_benchmark' : 'pos_recipe',
      unitLabelEs: uMeta.es,
      unitLabelEn: uMeta.en,
      packSizeQty: uMeta.packSizeQty,
      baseMeasure: uMeta.baseMeasure,
      yieldPct: round1(yieldPct),
      unitCostStoreUsd: round2(unitCostStoreUsd),
      unitCostBodegaUsd: round2(unitCostBodegaUsd),
      relatedDishesEs: related.es,
      relatedDishesEn: related.en,
      hasMeasuredSpan: hasMeasured,
      measuredStoresCount: selMeasuredStores,
      spanDaysAvg: avgSpanDays,
      anchorStart: selMinT0,
      anchorEnd: selMaxT1,
      openingUnits: round2(selOpen),
      arrivedUnits: round2(selArr),
      transferNetUnits: round2(selTrans),
      closingUnits: round2(selClose),
      invoiceNumbers: Array.from(selInvs).slice(0, 20),
      theoWindowUnits: round2(selTheoWindowUnits),
      theoUnits: round2(effectiveTheoUnits),
      theoBaseQty: round2(theoBaseQty),
      theoCookedLbs: proteinKey ? round2(selTheoSpanCookedLbs) : null,
      theoCostStoreUsd: round2(theoCostStore),
      theoCostBodegaUsd: round2(theoCostBodega),
      physicalUnits: round2(selPhysSpanUnits),
      physicalBaseQty: round2(physBaseQty),
      physicalCookedLbsEquiv: physCookedLbsEquiv,
      physicalCostStoreUsd: round2(physCostStore),
      physicalCostBodegaUsd: round2(physCostBodega),
      diffUnits: round2(diffUnits),
      diffUnitsPerDay: round2(diffUnitsPerDay),
      diffBaseQty: round2(diffBaseQty),
      diffPct: diffPct !== null ? round1(diffPct) : null,
      efficiencyPct: efficiencyPct !== null ? round1(efficiencyPct) : null,
      diffCostStoreUsd: round2(diffCostStore),
      diffCostBodegaUsd: round2(diffCostBodega),
      equivTacos15Oz,
      equivBurritos6Oz,
      realAvgOzPerTaco,
      realAvgOzPerBurrito,
      comparisonNoteEs,
      comparisonNoteEn,
      status: rowStatus,
      perStoreBreakdown,
    })
  }

  // Ordenar productos: primero las carnes por impacto en $, luego el resto por impacto en $ descendente
  productRows.sort((a, b) => {
    if (a.hasMeasuredSpan !== b.hasMeasuredSpan) return a.hasMeasuredSpan ? -1 : 1
    if (a.proteinKey === 'asada') return -1
    if (b.proteinKey === 'asada') return 1
    return b.diffCostStoreUsd - a.diffCostStoreUsd
  })

  // 8. Consolidar KPIs globales para `selectedStores`
  const selSalesUsd = round2(
    selectedStores.reduce((a, s) => a + (storeMetricsMap.get(s.id)?.netSalesUsd || 0), 0)
  )
  const selOrderCount = selectedStores.reduce(
    (a, s) => a + (storeMetricsMap.get(s.id)?.orderCount || 0),
    0
  )

  const measuredProducts = productRows.filter((r) => r.hasMeasuredSpan)
  const measuredMeats = measuredProducts.filter((r) => r.proteinKey !== null)

  const totalTheoCostStore = round2(measuredProducts.reduce((a, r) => a + r.theoCostStoreUsd, 0))
  const totalTheoCostBodega = round2(measuredProducts.reduce((a, r) => a + r.theoCostBodegaUsd, 0))
  const totalPhysCostStore = round2(measuredProducts.reduce((a, r) => a + r.physicalCostStoreUsd, 0))
  const totalPhysCostBodega = round2(measuredProducts.reduce((a, r) => a + r.physicalCostBodegaUsd, 0))
  const totalVarCostStore = round2(totalPhysCostStore - totalTheoCostStore)
  const totalVarCostBodega = round2(totalPhysCostBodega - totalTheoCostBodega)

  const dishFamilies: ExecutiveDishFamilySummary[] = FAMILY_ORDER.map((fk) => {
    const b = familyAcc.get(fk)!
    const topItems = Array.from(b.itemsMap.entries())
      .map(([itemName, v]) => ({
        itemName,
        ordersSold: round1(v.ordersSold),
        exactUnitsServed: round1(v.exactUnitsServed),
        netSalesUsd: round2(v.netSalesUsd),
      }))
      .sort((x, y) => y.exactUnitsServed - x.exactUnitsServed)
      .slice(0, 25)

    return {
      familyKey: fk,
      ordersSold: round1(b.ordersSold),
      exactUnitsServed: round1(b.exactUnitsServed),
      netSalesUsd: round2(b.netSalesUsd),
      meatCookedLbs: round2(b.meatCookedLbs),
      meatRawLbs: round2(b.meatRawLbs),
      shareOfSalesPct: selSalesUsd > 0 ? round1((b.netSalesUsd / selSalesUsd) * 100) : 0,
      topItems,
    }
  })

  // 9. Construir tabla comparativa de sucursales (`storeRows`)
  const storeRows: ExecutiveStoreComparisonRow[] = queriedStores.map((st) => {
    const m = storeMetricsMap.get(st.id)!
    const d = storeDishCounters.get(st.id)!
    const hasMeas = m.allMeasuredItemsCount > 0
    const meatsDiffBags = m.meatsPhysicalBags - m.meatsTheoBags
    const meatsDiffLbs = m.meatsPhysicalRawLbs - m.meatsTheoRawLbs
    const meatsDiffPct = m.meatsTheoRawLbs > 0.5 ? (meatsDiffLbs / m.meatsTheoRawLbs) * 100 : null
    const allEff = m.allPhysicalCostStoreUsd > 1 ? (m.allTheoCostStoreUsd / m.allPhysicalCostStoreUsd) * 100 : null

    let stStatus: VarianceHealthStatus = 'unmeasured'
    if (hasMeas) {
      if (m.allDiffCostStoreUsd >= 900 || (meatsDiffPct !== null && meatsDiffPct > 12)) stStatus = 'critical'
      else if (m.allDiffCostStoreUsd >= 350 || (meatsDiffPct !== null && meatsDiffPct > 5)) stStatus = 'warning'
      else if (m.allDiffCostStoreUsd <= -200) stStatus = 'saving'
      else stStatus = 'ok'
    }

    return {
      storeId: st.id,
      storeName: st.name,
      netSalesUsd: m.netSalesUsd,
      orderCount: m.orderCount,
      tacosSold: Math.round(d.tacos),
      burritosSold: Math.round(d.burritos),
      tortasSold: Math.round(d.tortas),
      quesadillasMulitasSopesSold: Math.round(d.quesadillas + d.mulitas + d.sopes),
      platesNachosTraysSold: Math.round(d.platesNachosTrays),
      meatsMeasuredCount: m.meatsMeasuredCount,
      meatsTheoBags: round1(m.meatsTheoBags),
      meatsPhysicalBags: round1(m.meatsPhysicalBags),
      meatsDiffBags: round1(meatsDiffBags),
      meatsTheoRawLbs: round1(m.meatsTheoRawLbs),
      meatsPhysicalRawLbs: round1(m.meatsPhysicalRawLbs),
      meatsDiffRawLbs: round1(meatsDiffLbs),
      meatsDiffPct: meatsDiffPct !== null ? round1(meatsDiffPct) : null,
      meatsTheoCostStoreUsd: round2(m.meatsTheoCostStoreUsd),
      meatsPhysicalCostStoreUsd: round2(m.meatsPhysicalCostStoreUsd),
      meatsDiffCostStoreUsd: round2(m.meatsDiffCostStoreUsd),
      meatsDiffCostBodegaUsd: round2(m.meatsDiffCostBodegaUsd),
      meatsEquivTacosDiff: Math.round(m.meatsEquivTacosDiff),
      asadaRealOzPerTaco: m.asadaRealOzPerTaco,
      allMeasuredItemsCount: m.allMeasuredItemsCount,
      allTheoCostStoreUsd: round2(m.allTheoCostStoreUsd),
      allPhysicalCostStoreUsd: round2(m.allPhysicalCostStoreUsd),
      allDiffCostStoreUsd: round2(m.allDiffCostStoreUsd),
      allDiffCostBodegaUsd: round2(m.allDiffCostBodegaUsd),
      allEfficiencyPct: allEff !== null ? round1(allEff) : null,
      status: stStatus,
    }
  })

  const measuredStoresCount = selectedStores.filter(
    (s) => (storeMetricsMap.get(s.id)?.meatsMeasuredCount || 0) > 0
  ).length

  // Emparejar denominador y numerador de % sobre ventas únicamente sobre sucursales con carnes medidas
  // y exactamente en los días cubiertos por su tramo principal (t0, t1] para evitar distorsiones de 6d/8d vs 7d o tiendas sin conteo.
  let matchedSpanSalesUsd = 0
  let matchedTheoCostStoreUsd = 0
  let matchedPhysCostStoreUsd = 0
  for (const s of selectedStores) {
    const sm = storeMetricsMap.get(s.id)
    const pSpan = storePrimaryMeatSpan.get(s.id)
    if (!sm || sm.meatsMeasuredCount <= 0 || !pSpan) continue
    for (let d = addDaysIso(pSpan.t0, 1); d <= pSpan.t1; d = addDaysIso(d, 1)) {
      matchedSpanSalesUsd += salesByStoreDate.get(`${s.id}::${d}`)?.netSales || 0
    }
    matchedTheoCostStoreUsd += sm.allTheoCostStoreUsd
    matchedPhysCostStoreUsd += sm.allPhysicalCostStoreUsd
  }
  const matchedVarCostStoreUsd = matchedPhysCostStoreUsd - matchedTheoCostStoreUsd

  const famGetUnits = (fk: ExecutiveDishFamilyKey) =>
    Math.round(familyAcc.get(fk)?.exactUnitsServed || 0)

  const totalFoodUnitsSold =
    famGetUnits('tacos') +
    famGetUnits('burritos') +
    famGetUnits('quesadillas') +
    famGetUnits('mulitas') +
    famGetUnits('sopes') +
    famGetUnits('tortas') +
    famGetUnits('plates_breakfast_nachos') +
    famGetUnits('party_trays_lbs') +
    famGetUnits('sides_extras')

  const meatsTheoBags = round1(measuredMeats.reduce((a, r) => a + r.theoUnits, 0))
  const meatsPhysBags = round1(measuredMeats.reduce((a, r) => a + r.physicalUnits, 0))
  const meatsTheoRawLbs = round1(measuredMeats.reduce((a, r) => a + r.theoBaseQty, 0))
  const meatsPhysRawLbs = round1(measuredMeats.reduce((a, r) => a + r.physicalBaseQty, 0))
  const meatsTheoCookedLbs = round1(measuredMeats.reduce((a, r) => a + (r.theoCookedLbs || 0), 0))
  const meatsPhysCookedLbs = round1(measuredMeats.reduce((a, r) => a + (r.physicalCookedLbsEquiv || 0), 0))
  const meatsTheoCostStore = round2(measuredMeats.reduce((a, r) => a + r.theoCostStoreUsd, 0))
  const meatsPhysCostStore = round2(measuredMeats.reduce((a, r) => a + r.physicalCostStoreUsd, 0))
  const meatsDiffCostStore = round2(meatsPhysCostStore - meatsTheoCostStore)
  const meatsDiffCostBodega = round2(measuredMeats.reduce((a, r) => a + r.diffCostBodegaUsd, 0))
  const meatsEquivTacos = Math.round(measuredMeats.reduce((a, r) => a + (r.equivTacos15Oz || 0), 0))
  const meatsEquivBurritos = Math.round(measuredMeats.reduce((a, r) => a + (r.equivBurritos6Oz || 0), 0))

  return {
    meta: {
      storeId: singleStore ? String(singleStore.id) : 'all',
      storeNumericId: singleStore ? singleStore.id : null,
      storeName: singleStore ? singleStore.name : '15 Sucursales (Consolidado Cadena)',
      startDate,
      endDate,
      rangeLabelEs: `${formatShortDateLabelEs(startDate)} al ${formatShortDateLabelEs(endDate)}`,
      windowDays,
      todayBusinessDateLA: todayLA,
      netSalesUsd: selSalesUsd,
      orderCount: selOrderCount,
      measuredStoresCount,
      totalActiveStoresCount: selectedStores.length,
    },
    storesCatalog: allStoresSorted.map((s) => ({ id: s.id, name: s.name, code: s.code })),
    kpis: {
      totalFoodUnitsSold,
      tacosTotalSold: famGetUnits('tacos'),
      burritosTotalSold: famGetUnits('burritos'),
      tortasTotalSold: famGetUnits('tortas'),
      quesadillasTotalSold: famGetUnits('quesadillas'),
      mulitasTotalSold: famGetUnits('mulitas'),
      sopesTotalSold: famGetUnits('sopes'),
      platesBreakfastNachosSold: famGetUnits('plates_breakfast_nachos'),
      partyTraysAndLbsSold: famGetUnits('party_trays_lbs'),
      sidesExtrasSold: famGetUnits('sides_extras'),
      aguasDrinksDessertsSold: famGetUnits('aguas_drinks_desserts'),
      theoCostStoreUsd: totalTheoCostStore,
      theoCostBodegaUsd: totalTheoCostBodega,
      theoPctOfSales:
        matchedSpanSalesUsd > 0 ? round2((matchedTheoCostStoreUsd / matchedSpanSalesUsd) * 100) : 0,
      physicalCostStoreUsd: totalPhysCostStore,
      physicalCostBodegaUsd: totalPhysCostBodega,
      physicalPctOfSales:
        matchedSpanSalesUsd > 0 ? round2((matchedPhysCostStoreUsd / matchedSpanSalesUsd) * 100) : 0,
      varianceCostStoreUsd: totalVarCostStore,
      varianceCostBodegaUsd: totalVarCostBodega,
      variancePctOfSales:
        matchedSpanSalesUsd > 0 ? round2((matchedVarCostStoreUsd / matchedSpanSalesUsd) * 100) : 0,
      overallEfficiencyPct:
        totalPhysCostStore > 1 ? round1((totalTheoCostStore / totalPhysCostStore) * 100) : null,
      meatsSummary: {
        theoBags: meatsTheoBags,
        physicalBags: meatsPhysBags,
        diffBags: round1(meatsPhysBags - meatsTheoBags),
        theoRawLbs: meatsTheoRawLbs,
        physicalRawLbs: meatsPhysRawLbs,
        diffRawLbs: round1(meatsPhysRawLbs - meatsTheoRawLbs),
        theoCookedLbs: meatsTheoCookedLbs,
        physicalCookedLbsEquiv: meatsPhysCookedLbs,
        theoCostStoreUsd: meatsTheoCostStore,
        physicalCostStoreUsd: meatsPhysCostStore,
        diffCostStoreUsd: meatsDiffCostStore,
        diffCostBodegaUsd: meatsDiffCostBodega,
        equivTacos15Oz: meatsEquivTacos,
        equivBurritos6Oz: meatsEquivBurritos,
      },
    },
    dishFamilies,
    productRows,
    storeRows,
  }
}

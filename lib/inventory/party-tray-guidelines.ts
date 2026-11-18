/**
 * @module lib/inventory/party-tray-guidelines
 * @description Fuente única oficial de las cantidades operativas y de cara al cliente de
 *   Party Trays / Fiesta Platters de Tacos Gavilan (`docs/Party Tray Instructions.pdf`).
 * @businessRules
 *   - La guía determina cantidades exactas por rango de personas (`15-20`, `20-25`, `25-30`, `30-40`);
 *     no se infieren desde precio salvo cuando Toast omite el rango fuera del botón fijo de Delivery.
 *   - El botón genérico `"Fiesta Platters"` (`eea3f69d-596f-4526-9ab4-95aa532b47ea`) en Uber/plataformas
 *     Delivery corresponde siempre al tamaño `15-20` personas.
 *   - Maíz y harina son alternativas: si el ticket contiene ambas, cada una recibe 50% de su cantidad indicada.
 *   - Cada paquete de maíz (`1100`, `dcd79433-e97c-46dc-80c0-8429401e0fa0`) contiene 60 tortillas (`5` docenas),
 *     por lo que `2 / 3 / 4 / 5` paquetes equivalen a `10 / 15 / 20 / 25` docenas.
 *   - Cada paquete de harina (`358_9604BT` Regular 8 in, `1df90372-7648-4ec1-9a6c-fca4032095a6`) contiene
 *     12 tortillas (`1` docena), por lo que `5 / 7 / 9 / 12` paquetes equivalen a `5 / 7 / 9 / 12` docenas.
 *   - Un par `RC478 + 709DO` protege hasta 60 tortillas (30 pares); se redondea hacia arriba por seguridad alimentaria.
 *   - Charolas térmicas de aluminio con tapa según `docs/Party Tray Instructions.pdf`:
 *       • `15-20`: Arroz (`Medium Tray`), Frijol (`Medium Tray`), Carne 6 lb (`Medium Tray`) → `3 × RC1150 + RL970`.
 *       • `20-25`: Arroz (`Medium Tray`), Frijol (`Medium Tray`), Carne 7.5 lb (`Medium Tray`) → `3 × RC1150 + RL970`.
 *       • `25-30`: Arroz (`Medium Tray`), Frijol (`Medium Tray`), Carne 10 lb (`Full Tray`) → `2 × RC1150 + RL970` + `1 × RC1174 + RL990`.
 *       • `30-40`: Arroz (`Full Tray`), Frijol (`Full Tray`), Carne 12 lb (`Full Tray`) → `3 × RC1174 + RL990`.
 * @dataFlow
 *   Toast PMIX / Menú / Contestadora IA / Web → `PARTY_TRAY_GUIDELINES` & `buildPartyTrayVirtualIngredients()`
 *   → Food Cost, Detalle de Receta, Catálogo de Costos, Consumo Teórico y Cotizador de Fiesta Platters.
 * @notes
 *   - Basado en `Party Tray Guidelines` proporcionado por operación el 2026-09-23 (`docs/Party Tray Instructions.pdf`).
 *   - [2026-11-17] Confirmado por Dirección General como fuente oficial única para cocina, recetas virtuales,
 *     sitio web público (`tacosgavilan.com/fiesta-platter/`), Contestadora IA, POS y TEG Assistant.
 *     Corregido UUID de tortilla de harina en recetas virtuales a `358_9604BT Tortilla Regular 8 in`
 *     (`1df90372-7648-4ec1-9a6c-fca4032095a6`, 8" taco) en lugar de `358-9673BT 13" Flour Tortilla` (burrito).
 *   - [2026-11-17] Corregidas charolas de aluminio por componente conforme a `docs/Party Tray Instructions.pdf`:
 *     `25-30` usa `1 × Full (RC1174+RL990)` para carne + `2 × Medium/Half (RC1150+RL970)` para arroz y frijol;
 *     `15-20` usa `3 × Medium/Half (RC1150+RL970)` (alineado también con `6 lb Meat = half_pan` en `ticket-packaging.ts`);
 *     homologado `RC478 + 709DO` a `type: 'raw'` junto al resto de empaques integrados del paquete para no omitirse en Food Cost ni Delivery.
 */

export type PartyTraySize = '15-20' | '20-25' | '25-30' | '30-40'
export type PartyTrayPanSize = 'third' | 'half' | 'full'

export interface PartyTrayGuideline {
  riceLbs: number
  beansLbs: number
  meatLbs: number
  plates: number
  forks: number
  spoons: number
  cups: number
  napkinPacks: number
  salsaRojaPacks: number
  salsaVerdePacks: number
  mixtaBags: number
  limeBags: number
  jalapenoOz: number
  cornPacks: number
  flourPacks: number
  aguaGallons: number
  riceTraySize: PartyTrayPanSize
  beansTraySize: PartyTrayPanSize
  meatTraySize: PartyTrayPanSize
  /** Tamaño de la charola de carne (conservado por compatibilidad; usar `getPartyTrayFoodTrayAllocation` para conteo exacto). */
  foodTraySize: PartyTrayPanSize
}

export const PARTY_TRAY_GUIDELINES: Record<PartyTraySize, PartyTrayGuideline> = {
  '15-20': { riceLbs: 3, beansLbs: 3, meatLbs: 6, plates: 30, forks: 15, spoons: 15, cups: 20, napkinPacks: 1, salsaRojaPacks: 12, salsaVerdePacks: 12, mixtaBags: 16, limeBags: 16, jalapenoOz: 8, cornPacks: 2, flourPacks: 5, aguaGallons: 3, riceTraySize: 'half', beansTraySize: 'half', meatTraySize: 'half', foodTraySize: 'half' },
  '20-25': { riceLbs: 4, beansLbs: 4, meatLbs: 7.5, plates: 35, forks: 15, spoons: 15, cups: 25, napkinPacks: 1, salsaRojaPacks: 16, salsaVerdePacks: 16, mixtaBags: 20, limeBags: 20, jalapenoOz: 12, cornPacks: 3, flourPacks: 7, aguaGallons: 4, riceTraySize: 'half', beansTraySize: 'half', meatTraySize: 'half', foodTraySize: 'half' },
  '25-30': { riceLbs: 6, beansLbs: 6, meatLbs: 10, plates: 40, forks: 20, spoons: 20, cups: 30, napkinPacks: 2, salsaRojaPacks: 20, salsaVerdePacks: 20, mixtaBags: 20, limeBags: 20, jalapenoOz: 16, cornPacks: 4, flourPacks: 9, aguaGallons: 5, riceTraySize: 'half', beansTraySize: 'half', meatTraySize: 'full', foodTraySize: 'full' },
  '30-40': { riceLbs: 10, beansLbs: 10, meatLbs: 12, plates: 50, forks: 25, spoons: 25, cups: 40, napkinPacks: 3, salsaRojaPacks: 24, salsaVerdePacks: 24, mixtaBags: 30, limeBags: 30, jalapenoOz: 20, cornPacks: 5, flourPacks: 12, aguaGallons: 6, riceTraySize: 'full', beansTraySize: 'full', meatTraySize: 'full', foodTraySize: 'full' },
}

export const PARTY_TRAY_FOOD_TRAY_ITEMS = {
  third: { containerId: '66da6c4c-9811-4b53-9464-c95709e8da37', lidId: '7c5de7da-9a01-4a21-ad08-8203c2d8ad91' },
  half: { containerId: 'd415c752-ee89-4ff0-af67-f1499f9d7fa3', lidId: '93379ffd-cb66-4521-8561-17b5c5f90603' },
  full: { containerId: 'e1a10e05-6810-4fd7-923a-1d1fb356019a', lidId: '7c1d3e70-0fe0-40c1-8847-0d2467020264' },
} as const

/** Galón vacío plástico con tapa (`254W`, caja de 48 pzas). */
export const PARTY_TRAY_EMPTY_GALLON_ITEM_ID = '2fba5d5d-2af8-437d-8eae-844ed531dd8d'

/** Servilleta dispensador `DX900GE` de restaurante (`CS` de 6,000 pzas = 24 paquetes × 250 servilletas). */
export const PARTY_TRAY_NAPKIN_ITEM_ID = '328d996f-fed0-4731-b7eb-0b930e126dc4'

/** Conjunto de UUIDs de inventario que constituyen el empaque y desechables incluidos en un Fiesta Platter. */
export const PARTY_TRAY_PACKAGING_ITEM_IDS = new Set<string>([
  PARTY_TRAY_EMPTY_GALLON_ITEM_ID,
  '85533c59-b2df-4af3-bf2b-e684d3d6c125', // RC478 9" Round Aluminum Container
  'eba87715-ea18-4f9c-8f22-44c745e86572', // 709DO 9" Clear Dome Lid
  PARTY_TRAY_FOOD_TRAY_ITEMS.third.containerId,
  PARTY_TRAY_FOOD_TRAY_ITEMS.third.lidId,
  PARTY_TRAY_FOOD_TRAY_ITEMS.half.containerId,
  PARTY_TRAY_FOOD_TRAY_ITEMS.half.lidId,
  PARTY_TRAY_FOOD_TRAY_ITEMS.full.containerId,
  PARTY_TRAY_FOOD_TRAY_ITEMS.full.lidId,
  'ca959b14-fcef-4900-ae71-2388e4ac023c', // EP9PR Plato 9"
  'd920800f-e0ca-4799-8434-fea7712f7e98', // HEFO Tenedor
  'd11c55da-7bd1-4133-883c-f28eb9a31936', // HESP Cuchara
  'e48fbf27-ba61-414b-8bab-2a299e02f61a', // 12PR Vaso 12 oz
  '44272ca2-4891-43ec-abd8-2bf917363edb', // EL1CS2G Bolsa cubiertos
  PARTY_TRAY_NAPKIN_ITEM_ID, // DX900GE Servilletas
])

export function getPartyTrayFoodTrayAllocation(guidelineOrSize: PartyTrayGuideline | PartyTraySize): {
  counts: Record<PartyTrayPanSize, number>
  lines: Array<{ panSize: PartyTrayPanSize; containerId: string; lidId: string; quantity: number }>
} {
  const g = typeof guidelineOrSize === 'string' ? PARTY_TRAY_GUIDELINES[guidelineOrSize] : guidelineOrSize
  const counts: Record<PartyTrayPanSize, number> = { third: 0, half: 0, full: 0 }
  counts[g.riceTraySize] += 1
  counts[g.beansTraySize] += 1
  counts[g.meatTraySize] += 1

  const order: PartyTrayPanSize[] = ['third', 'half', 'full']
  const lines = order
    .filter((panSize) => counts[panSize] > 0)
    .map((panSize) => ({
      panSize,
      containerId: PARTY_TRAY_FOOD_TRAY_ITEMS[panSize].containerId,
      lidId: PARTY_TRAY_FOOD_TRAY_ITEMS[panSize].lidId,
      quantity: counts[panSize],
    }))

  return { counts, lines }
}

/** Tortilla blanca de maíz 1100 (60 pzas = 5 docenas por paquete). */
export const PARTY_TRAY_CORN_TORTILLA_ITEM_ID = 'dcd79433-e97c-46dc-80c0-8429401e0fa0'

/** Tortilla de harina 358_9604BT Regular 8 in para taco/banquete (12 pzas = 1 docena por paquete). */
export const PARTY_TRAY_FLOUR_TORTILLA_ITEM_ID = '1df90372-7648-4ec1-9a6c-fca4032095a6'

/** GUID oficial en Toast POS del botón genérico "Fiesta Platters" de plataformas Delivery (siempre 15-20 personas). */
export const DELIVERY_FIXED_FIESTA_PLATTER_GUID = 'eea3f69d-596f-4526-9ab4-95aa532b47ea'

export const PARTY_TRAY_KNOWN_TOAST_GUIDS: Record<string, PartyTraySize> = {
  'd9f81551-b3a5-48df-b4ee-3aa9e670bf0e': '15-20',
  'ae79ea50-d835-44b3-92a2-4e746e03fb10': '20-25',
  'e99e2f29-75d6-46e8-99e0-1cf072b636e5': '25-30',
  '81e1e9f7-de80-4f50-80ef-5e3d76541ef0': '30-40',
  [DELIVERY_FIXED_FIESTA_PLATTER_GUID]: '15-20',
}

/** Cada paquete operativo de DX900GE contiene 250 servilletas; la caja contiene 24 paquetes. */
export const PARTY_TRAY_NAPKINS_PER_PACK = 250

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function isPartyTrayMenuItem(itemName?: string | null, toastGuid?: string | null): boolean {
  const cleanGuid = String(toastGuid || '').trim().toLowerCase()
  if (cleanGuid && cleanGuid in PARTY_TRAY_KNOWN_TOAST_GUIDS) return true
  const name = normalized(String(itemName || ''))
  if (!name) return false
  return (
    name.includes('party tray') ||
    name.includes('fiesta platter') ||
    /\b(?:15\s*-\s*20|20\s*-\s*25|25\s*-\s*30|30\s*-\s*40)\s*(?:people|personas)\b/.test(name) ||
    (name.includes('people') && /\b(?:15|20|25|30|40)\b/.test(name))
  )
}

export function resolvePartyTraySize(itemName: string, unitPrice = 0): PartyTraySize {
  const name = normalized(itemName)
  if (name.includes('30-40') || name.includes('30 - 40')) return '30-40'
  if (name.includes('25-30') || name.includes('25 - 30')) return '25-30'
  if (name.includes('20-25') || name.includes('20 - 25')) return '20-25'
  if (name.includes('15-20') || name.includes('15 - 20')) return '15-20'
  if (unitPrice >= 310) return '30-40'
  if (unitPrice >= 265) return '25-30'
  if (unitPrice >= 220) return '20-25'
  return '15-20'
}

export function resolvePartyTraySizeWithChannel(params: {
  itemName?: string | null
  unitPrice?: number
  toastGuid?: string | null
  isDeliveryChannel?: boolean
}): PartyTraySize {
  const cleanGuid = String(params.toastGuid || '').trim().toLowerCase()
  if (cleanGuid && PARTY_TRAY_KNOWN_TOAST_GUIDS[cleanGuid]) {
    return PARTY_TRAY_KNOWN_TOAST_GUIDS[cleanGuid]
  }
  const rawName = String(params.itemName || '').trim()
  const norm = normalized(rawName)
  const hasExplicitRange = /\b(?:15\s*-\s*20|20\s*-\s*25|25\s*-\s*30|30\s*-\s*40)\b/.test(norm)
  if (
    !hasExplicitRange &&
    params.isDeliveryChannel &&
    /^fiesta\s+platters?(?:\s*\(|$)/.test(norm)
  ) {
    return '15-20'
  }
  return resolvePartyTraySize(rawName, params.unitPrice || 0)
}

export function getPartyTrayDozenCounts(guidelineOrSize: PartyTrayGuideline | PartyTraySize): {
  cornPacks: number
  flourPacks: number
  cornTortillas: number
  flourTortillas: number
  cornDozens: number
  flourDozens: number
} {
  const g = typeof guidelineOrSize === 'string' ? PARTY_TRAY_GUIDELINES[guidelineOrSize] : guidelineOrSize
  const cornTortillas = g.cornPacks * 60
  const flourTortillas = g.flourPacks * 12
  return {
    cornPacks: g.cornPacks,
    flourPacks: g.flourPacks,
    cornTortillas,
    flourTortillas,
    cornDozens: cornTortillas / 12,
    flourDozens: flourTortillas / 12,
  }
}

export function getPartyTrayTortillaAllocation(itemName: string, guideline: PartyTrayGuideline) {
  const name = normalized(itemName)
  const hasCorn = name.includes('maiz') || name.includes('corn')
  const hasFlour = name.includes('harina') || name.includes('flour')
  const splitBetweenBoth = hasCorn && hasFlour
  const cornPacks = hasCorn ? guideline.cornPacks * (splitBetweenBoth ? 0.5 : 1) : hasFlour ? 0 : guideline.cornPacks
  const flourPacks = hasFlour ? guideline.flourPacks * (splitBetweenBoth ? 0.5 : 1) : 0
  const totalTortillas = cornPacks * 60 + flourPacks * 12

  return {
    cornPacks,
    flourPacks,
    cornTortillas: cornPacks * 60,
    flourTortillas: flourPacks * 12,
    containerPairs: Math.ceil(totalTortillas / 60),
  }
}

const PARTY_TRAY_MEAT_MAP: Record<string, string> = {
  asada: 'fab9d589-8ae8-4381-87da-85f836068996',
  pollo: '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
  chicken: '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
  pastor: 'ad7e3703-2701-4a05-aa97-77866c8c717e',
  carnit: '14990e85-0d90-467c-ad9d-362e6ed4f1cd',
  buche: 'baac1d41-3b80-4f80-acfc-7a19f46e03c2',
  cabeza: '511e341b-ca42-44ed-89df-a4a84b51a619',
  lengua: '0fb87578-1185-41a9-a318-97428db20a5d',
  chorizo: '1e4c43b6-4e1b-4e51-8617-e127b89467f1',
}

const DEFAULT_PARTY_TRAY_MEAT_IDS = [
  'fab9d589-8ae8-4381-87da-85f836068996',
  '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
  'ad7e3703-2701-4a05-aa97-77866c8c717e',
  '14990e85-0d90-467c-ad9d-362e6ed4f1cd',
  'baac1d41-3b80-4f80-acfc-7a19f46e03c2',
  '511e341b-ca42-44ed-89df-a4a84b51a619',
  '0fb87578-1185-41a9-a318-97428db20a5d',
  '1e4c43b6-4e1b-4e51-8617-e127b89467f1',
]

const PARTY_TRAY_AGUA_MAP: Record<string, string> = {
  tamarindo: 'b6f3f5de-c554-4650-b0df-09dd5d3ca053',
  horchata: '085ecb0d-c711-4134-ae1a-f7630a22759c',
  pina: '9851a32c-dc35-4653-a1e4-b2cf7bac9009',
  jamaica: '6051e960-7564-41f6-9a52-ff79ed7c6353',
}

const DEFAULT_PARTY_TRAY_AGUA_IDS = [
  'b6f3f5de-c554-4650-b0df-09dd5d3ca053',
  '085ecb0d-c711-4134-ae1a-f7630a22759c',
  '9851a32c-dc35-4653-a1e4-b2cf7bac9009',
  '6051e960-7564-41f6-9a52-ff79ed7c6353',
]

export interface VirtualPartyTrayIngredient {
  inventory_item_id: string
  quantity: number
  unit: 'lb' | 'gal' | 'pza'
  type: 'food' | 'raw' | 'cooked' | 'cogs_takeout' | 'cogs_delivery' | 'cogs_dine_in'
}

/**
 * Construye los ingredientes virtuales exactos de un Party Tray / Fiesta Platter
 * conforme a `PARTY_TRAY_GUIDELINES` para Food Cost, Recipe Detail y Catálogo de Costos.
 */
export function buildPartyTrayVirtualIngredients(params: {
  itemName: string
  unitPrice?: number
  toastGuid?: string | null
  isDeliveryChannel?: boolean
  modifierTexts?: string[]
  inventoryItems?: Array<{ id: string; name?: string | null }>
}): {
  size: PartyTraySize
  guideline: PartyTrayGuideline
  ingredients: VirtualPartyTrayIngredient[]
} {
  const size = resolvePartyTraySizeWithChannel({
    itemName: params.itemName,
    unitPrice: params.unitPrice,
    toastGuid: params.toastGuid,
    isDeliveryChannel: params.isDeliveryChannel,
  })
  const guideline = PARTY_TRAY_GUIDELINES[size]

  const parentLower = normalized(params.itemName || '')
  const parenMatch = parentLower.match(/\(([^)]+)\)/)
  const modsFromName = parenMatch ? parenMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  const extraMods = (params.modifierTexts || []).map((m) => normalized(String(m || '')).trim()).filter(Boolean)
  const modsArr = [...modsFromName, ...extraMods]

  const meatsFound: string[] = []
  const aguasFound: string[] = []
  let exclusiveMeatId: string | null = null
  let exclusiveAguaId: string | null = null
  const exclusivePrefixes = ['todo', 'toda', 'solo', 'pura', 'puro', 'only', 'all']

  for (const mod of modsArr) {
    for (const prefix of exclusivePrefixes) {
      for (const [meatKey, meatId] of Object.entries(PARTY_TRAY_MEAT_MAP)) {
        if (mod.includes(`${prefix} ${meatKey}`) || mod.includes(`${prefix}${meatKey}`) || mod.includes(`${prefix} de ${meatKey}`)) {
          exclusiveMeatId = meatId
        }
      }
      for (const [aguaKey, aguaId] of Object.entries(PARTY_TRAY_AGUA_MAP)) {
        if (mod.includes(`${prefix} ${aguaKey}`) || mod.includes(`${prefix}${aguaKey}`) || mod.includes(`${prefix} de ${aguaKey}`)) {
          exclusiveAguaId = aguaId
        }
      }
    }
    for (const [meatKey, meatId] of Object.entries(PARTY_TRAY_MEAT_MAP)) {
      if (mod.includes(meatKey)) meatsFound.push(meatId)
    }
    for (const [aguaKey, aguaId] of Object.entries(PARTY_TRAY_AGUA_MAP)) {
      if (mod.includes(aguaKey)) aguasFound.push(aguaId)
    }
  }

  if (exclusiveMeatId) {
    meatsFound.length = 0
    meatsFound.push(exclusiveMeatId)
  }
  if (exclusiveAguaId) {
    aguasFound.length = 0
    aguasFound.push(exclusiveAguaId)
  }

  if (meatsFound.length === 0) meatsFound.push(...DEFAULT_PARTY_TRAY_MEAT_IDS)
  if (aguasFound.length === 0) aguasFound.push(...DEFAULT_PARTY_TRAY_AGUA_IDS)

  const ingredients: VirtualPartyTrayIngredient[] = []

  for (const mId of meatsFound) {
    ingredients.push({
      inventory_item_id: mId,
      quantity: guideline.meatLbs / meatsFound.length,
      unit: 'lb',
      type: 'cooked',
    })
  }
  for (const aId of aguasFound) {
    ingredients.push({
      inventory_item_id: aId,
      quantity: guideline.aguaGallons / aguasFound.length,
      unit: 'gal',
      type: 'raw',
    })
  }

  const gallonEmptyItem =
    (params.inventoryItems || []).find((inv) => inv?.id === PARTY_TRAY_EMPTY_GALLON_ITEM_ID) ||
    (params.inventoryItems || []).find((inv) => String(inv?.name || '').toLowerCase().includes('galones vacios'))
  ingredients.push({
    inventory_item_id: gallonEmptyItem?.id || PARTY_TRAY_EMPTY_GALLON_ITEM_ID,
    quantity: guideline.aguaGallons,
    unit: 'pza',
    type: 'raw',
  })

  // Guarniciones y condimentos oficiales (Party Tray Guidelines)
  ingredients.push({ inventory_item_id: 'a1bbc13a-a481-4b7f-a5c6-8a44a96ad562', quantity: guideline.riceLbs, unit: 'lb', type: 'raw' })
  ingredients.push({ inventory_item_id: '557d9414-c769-4399-a6cc-15bb81cba85f', quantity: guideline.beansLbs, unit: 'lb', type: 'raw' })
  ingredients.push({ inventory_item_id: 'a639ad41-81bf-4de6-8dbc-0291005654ad', quantity: guideline.salsaRojaPacks, unit: 'pza', type: 'raw' })
  ingredients.push({ inventory_item_id: '6c0a3378-8309-48c9-a438-15313cabd9d8', quantity: guideline.salsaVerdePacks, unit: 'pza', type: 'raw' })
  ingredients.push({ inventory_item_id: '90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb', quantity: guideline.mixtaBags, unit: 'pza', type: 'raw' })
  ingredients.push({ inventory_item_id: 'f73fe7a6-105c-4624-a87b-07d5f78c09ea', quantity: guideline.limeBags, unit: 'pza', type: 'raw' })
  ingredients.push({ inventory_item_id: 'd56d8df8-d30c-4964-a425-9aa25d962364', quantity: guideline.jalapenoOz / 16, unit: 'lb', type: 'raw' })

  // Tortillas (10/15/20/25 docenas maíz = 2/3/4/5 pk de 60; 5/7/9/12 docenas harina Regular 8" = 5/7/9/12 pk de 12)
  const combinedTortillaContext = [params.itemName || '', ...(params.modifierTexts || [])].join(' ')
  const tortillas = getPartyTrayTortillaAllocation(combinedTortillaContext, guideline)
  if (tortillas.cornTortillas > 0) {
    ingredients.push({
      inventory_item_id: PARTY_TRAY_CORN_TORTILLA_ITEM_ID,
      quantity: tortillas.cornTortillas,
      unit: 'pza',
      type: 'raw',
    })
  }
  if (tortillas.flourTortillas > 0) {
    ingredients.push({
      inventory_item_id: PARTY_TRAY_FLOUR_TORTILLA_ITEM_ID,
      quantity: tortillas.flourTortillas,
      unit: 'pza',
      type: 'raw',
    })
  }
  // Contenedores térmicos redondos 9" + tapa domo para tortillas (incluidos siempre en todo Fiesta Platter igual que charolas y desechables)
  ingredients.push({ inventory_item_id: '85533c59-b2df-4af3-bf2b-e684d3d6c125', quantity: tortillas.containerPairs, unit: 'pza', type: 'raw' }) // RC478
  ingredients.push({ inventory_item_id: 'eba87715-ea18-4f9c-8f22-44c745e86572', quantity: tortillas.containerPairs, unit: 'pza', type: 'raw' }) // 709DO

  // Charolas de aluminio con tapa por componente (arroz, frijol y carne según docs/Party Tray Instructions.pdf)
  const trayAllocation = getPartyTrayFoodTrayAllocation(guideline)
  for (const trayLine of trayAllocation.lines) {
    ingredients.push({ inventory_item_id: trayLine.containerId, quantity: trayLine.quantity, unit: 'pza', type: 'raw' })
    ingredients.push({ inventory_item_id: trayLine.lidId, quantity: trayLine.quantity, unit: 'pza', type: 'raw' })
  }

  // Desechables / Utensilios incluidos
  ingredients.push({ inventory_item_id: 'ca959b14-fcef-4900-ae71-2388e4ac023c', quantity: guideline.plates, unit: 'pza', type: 'raw' }) // Platos 9"
  ingredients.push({ inventory_item_id: 'd920800f-e0ca-4799-8434-fea7712f7e98', quantity: guideline.forks, unit: 'pza', type: 'raw' }) // Tenedores
  ingredients.push({ inventory_item_id: 'd11c55da-7bd1-4133-883c-f28eb9a31936', quantity: guideline.spoons, unit: 'pza', type: 'raw' }) // Cucharas
  ingredients.push({ inventory_item_id: 'e48fbf27-ba61-414b-8bab-2a299e02f61a', quantity: guideline.cups, unit: 'pza', type: 'raw' }) // Vasos 12 oz
  ingredients.push({ inventory_item_id: '44272ca2-4891-43ec-abd8-2bf917363edb', quantity: 1, unit: 'pza', type: 'raw' }) // Bolsa EL1CS2G cubiertos
  ingredients.push({
    inventory_item_id: PARTY_TRAY_NAPKIN_ITEM_ID,
    quantity: guideline.napkinPacks * PARTY_TRAY_NAPKINS_PER_PACK,
    unit: 'pza',
    type: 'raw',
  }) // Servilletas DX900GE (250 por paquete)

  return { size, guideline, ingredients }
}

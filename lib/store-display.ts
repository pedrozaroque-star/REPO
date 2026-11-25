/**
 * @module lib/store-display
 * @description Utilidades puras e isomórficas (Client + Server, cero dependencias de Node.js o base de datos)
 * para formatear nombres de sucursales de Tacos Gavilan sin prefijos/sufijos numéricos (`#1`, `#14`, `Sucursal #14`,
 * `Store #3`, `(#14)`) y ordenar cualquier lista o selector de sucursales en estricto orden alfabético (A–Z).
 *
 * @businessRules
 * - **Cero Números `#` en Nombres de Sucursal**: En toda la interfaz administrativa/operativa y en todos los
 *   correos automáticos del sistema, las sucursales NUNCA deben mostrar números `#` (`#1 - Rialto`, `#14 Lynwood`,
 *   `Sucursal #14`, `Tienda #5`, `Store #3`, `Lynwood (#14)`). Siempre se muestra únicamente el nombre limpio.
 * - **Orden Alfabético Estricto (A–Z)**: Todo selector, filtro, tabla general o bloque multi-sucursal se ordena
 *   alfabéticamente de la A a la Z (`Azusa` -> `West Covina`), manteniendo fijadas al inicio opciones globales
 *   (`Todas las Sucursales` / `All Stores`), `Bodega Central` y `Oficina Corporativa` cuando estén presentes.
 * - **Protección de Folios y Tickets**: `stripStoreNumberTokensInText` limpia números `#` asociados a sucursales
 *   en textos/asuntos/encabezados SIN alterar jamás números de `Ticket #148`, `Orden #123` o `Factura #W151879`.
 * - **Separación Uso Interno vs. Cliente (`lib/customer-store-names.ts`)**:
 *   * En canales internos (staff UI y correos internos) se mantienen los nombres cortos canónicos de `public.stores`
 *     (`LA Broadway`, `LA Central`, `Slauson`, etc.) sin `#`.
 *   * En canales de cara al cliente se continúa utilizando `formatCustomerStoreName` (`Los Ángeles (Vernon y Broadway)`,
 *     `Los Ángeles (Central y Washington)`, `Los Ángeles (Slauson y Broadway)`), también sin `#` y ordenados A–Z.
 *
 * @dataFlow
 * - Consumido por `lib/supabase.ts` (`formatStoreName`), endpoints `/api/*`, componentes UI (`app/**`, `components/**`)
 *   y generadores de correos automáticos (`lib/*email*`, `app/api/cron/**`).
 *
 * @notes
 * - [2026-11-24] Creado como fuente canónica para unificar visualización limpia y ordenamiento A–Z en todo TEG.
 */

export interface StoreDisplayObject {
  id?: number | string | null
  store_id?: number | string | null
  storeId?: number | string | null
  code?: string | null
  name?: string | null
  store_name?: string | null
  storeName?: string | null
  shortName?: string | null
  label?: string | null
  isWarehouse?: boolean | null
  isCorporate?: boolean | null
}

export type StoreDisplayInput = string | number | StoreDisplayObject | null | undefined

/**
 * Mapa canónico de IDs de `public.stores` a su nombre interno limpio oficial (sin `#`).
 * Se utiliza como respaldo cuando un registro o texto solo contiene el número de sucursal (ej. `"Sucursal #14"` -> `"Lynwood"`).
 */
export const CANONICAL_INTERNAL_STORE_NAMES_BY_ID: Readonly<Record<number, string>> = {
  1: 'Rialto',
  3: 'West Covina',
  4: 'Azusa',
  5: 'LA Broadway',
  6: 'LA Central',
  7: 'Slauson',
  8: 'Hollywood',
  9: 'Santa Ana',
  10: 'La Puente',
  11: 'Huntington Park',
  12: 'Norwalk',
  13: 'Bell',
  14: 'Lynwood',
  15: 'South Gate',
  16: 'Downey',
  99: 'Bodega Central'
}

const CANONICAL_INTERNAL_STORE_NAMES_BY_CODE: Readonly<Record<string, string>> = {
  RIALTO: 'Rialto',
  WCOVINA: 'West Covina',
  AZUSA: 'Azusa',
  LABROADWY: 'LA Broadway',
  LABROADWAY: 'LA Broadway',
  LACENTRAL: 'LA Central',
  SLAUSON: 'Slauson',
  HOLLYWOOD: 'Hollywood',
  SANTAANA: 'Santa Ana',
  LAPUENTE: 'La Puente',
  HPARK: 'Huntington Park',
  NORWALK: 'Norwalk',
  BELL: 'Bell',
  LYNWOOD: 'Lynwood',
  SOUTHGATE: 'South Gate',
  DOWNEY: 'Downey',
  BODEGA: 'Bodega Central'
}

/**
 * Resuelve el nombre interno limpio de una sucursal a partir de su `id` numérico (`1`, `3..16`, `99`).
 */
export function getInternalStoreNameById(storeId: number | string | null | undefined): string | null {
  if (storeId === null || storeId === undefined || storeId === '') return null
  const num = typeof storeId === 'number' ? storeId : Number(String(storeId).trim())
  if (!Number.isFinite(num)) return null
  return CANONICAL_INTERNAL_STORE_NAMES_BY_ID[num] || null
}

const NON_STORE_FOLIO_START_RE =
  /^(?:ticket|orden|order|factura|invoice|pedido|check|recibo|receipt|folio|caso|case|ref)\s*#/i

const STANDALONE_STORE_NUMBER_RE =
  /^(?:tacos\s+(?:el\s+)?gavil[aá]n\s*[-–—:|·•]?\s*)?(?:(sucursal|tienda|store|branch|ubicaci[oó]n)\s*)?#\s*(\d{1,3})\s*$/i

/**
 * Devuelve el nombre limpio de una sucursal sin marca inicial (`Tacos Gavilan`) y sin prefijos ni sufijos
 * de número de tienda (`#1 - Rialto`, `#14 Lynwood`, `Sucursal #14`, `Store #3`, `Lynwood (#14)`, `Lynwood #14`).
 */
export function formatStoreDisplayName(nameOrStore: StoreDisplayInput): string {
  if (nameOrStore === null || nameOrStore === undefined) return ''

  if (typeof nameOrStore === 'number') {
    return getInternalStoreNameById(nameOrStore) || ''
  }

  let raw = ''
  let fallbackId: number | string | null | undefined = null
  let fallbackCode: string | null | undefined = null

  if (typeof nameOrStore === 'string') {
    raw = nameOrStore
  } else if (typeof nameOrStore === 'object') {
    raw = String(
      nameOrStore.name ??
        nameOrStore.store_name ??
        nameOrStore.storeName ??
        nameOrStore.shortName ??
        nameOrStore.label ??
        ''
    )
    fallbackId = nameOrStore.id ?? nameOrStore.store_id ?? nameOrStore.storeId ?? null
    fallbackCode = nameOrStore.code ?? null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    const byId = getInternalStoreNameById(fallbackId)
    if (byId) return byId
    if (fallbackCode) {
      const codeKey = fallbackCode.trim().toUpperCase()
      if (CANONICAL_INTERNAL_STORE_NAMES_BY_CODE[codeKey]) {
        return CANONICAL_INTERNAL_STORE_NAMES_BY_CODE[codeKey]
      }
    }
    return ''
  }

  // Nunca mutilar cadenas que claramente sean un folio/ticket y no una sucursal
  if (NON_STORE_FOLIO_START_RE.test(trimmed)) {
    return trimmed
  }

  // Caso donde la cadena solo trae el número de tienda (ej. "Sucursal #14", "Store #3", "#5")
  const standaloneMatch = trimmed.match(STANDALONE_STORE_NUMBER_RE)
  if (standaloneMatch) {
    const prefixWord = standaloneMatch[1] || ''
    const storeNum = Number(standaloneMatch[2])
    const resolved = getInternalStoreNameById(storeNum)
    if (resolved) return resolved
    const byFallbackId = getInternalStoreNameById(fallbackId)
    if (byFallbackId) return byFallbackId
    return prefixWord ? prefixWord : ''
  }

  const clean = trimmed
    // 1. Quitar prefijo de marca "Tacos Gavilan" / "Tacos El Gavilan"
    .replace(/^tacos\s+(?:el\s+)?gavil[aá]n\s*[-–—:|·•]?\s*/i, '')
    // 2. Quitar prefijo numérico al inicio: "#14 - ", "Sucursal #14 - ", "Tienda #5: ", "Store #3 "
    .replace(/^(?:(?:sucursal|tienda|store|branch|ubicaci[oó]n)\s*)?#\s*\d+\s*[-–—:|·•]?\s*/i, '')
    // 3. Quitar prefijo de marca si venía después del número ("#14 - Tacos Gavilan Lynwood")
    .replace(/^tacos\s+(?:el\s+)?gavil[aá]n\s*[-–—:|·•]?\s*/i, '')
    // 4. Quitar etiquetas intermedias "Sucursal #14 - " / "Store #3 - "
    .replace(/\b(?:sucursal|tienda|store|branch|ubicaci[oó]n)\s*#\s*\d+\s*[-–—:|·•]?\s*/gi, '')
    // 5. Quitar sufijos entre paréntesis "(#14)", "(Sucursal #14)", "(Store #3)"
    .replace(/\s*\(\s*(?:(?:sucursal|tienda|store|branch|ubicaci[oó]n)\s*)?#\s*\d+\s*\)/gi, '')
    // 6. Quitar sufijo numérico final " #14" o " - #14"
    .replace(/\s*(?:[-–—:|·•]\s*)?#\s*\d+\s*$/i, '')
    // 7. Normalizar espacios y separadores residuales en extremos
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—:|·•\s]+|[-–—:|·•\s]+$/g, '')
    .trim()

  if (!clean) {
    const byId = getInternalStoreNameById(fallbackId)
    if (byId) return byId
  }

  return clean
}

const KNOWN_STORE_NAMES_PATTERN =
  '(?:West\\s+Covina|Huntington\\s+Park|South\\s+Gate|Santa\\s+Ana|La\\s+Puente|Los\\s+[ÁA]ngeles(?:\\s*\\([^)]*\\))?|L\\.?A\\.?\\s+Broadway|L\\.?A\\.?\\s+Central|L\\.?A\\.?\\s+Slauson|Bodega\\s+Central|Rialto|Azusa|Broadway|Central|Slauson|Hollywood|Norwalk|Bell|Lynwood|Downey)'

const FOLIO_WORD_GUARD_PATTERN =
  '(?:Ticket|Orden|Order|Factura|Invoice|Pedido|Check|Recibo|Receipt|Folio|Caso|Case|Ref|Cita|Turno|Item|L[íi]nea|Line|Paso|Step|Pregunta|Question|Regla|Rule)'

const TEXT_PREFIX_NUM_BEFORE_STORE_RE = new RegExp(
  `(\\b${FOLIO_WORD_GUARD_PATTERN}\\s+)?(\\b(?:Sucursal|Tienda|Store|Branch|Ubicaci[oó]n)\\s+)?#\\s*(\\d{1,2})(?:\\s*[-–—:|·•]\\s*|\\s+)(${KNOWN_STORE_NAMES_PATTERN})(?=\\b|[),.;:!?\\]]|\\s|$)`,
  'gi'
)

const TEXT_PREFIX_NUM_PAREN_STORE_RE = new RegExp(
  `(\\b${FOLIO_WORD_GUARD_PATTERN}\\s+)?(\\b(?:Sucursal|Tienda|Store|Branch|Ubicaci[oó]n)\\s+)?#\\s*(\\d{1,2})\\s*\\(\\s*(${KNOWN_STORE_NAMES_PATTERN})\\s*\\)`,
  'gi'
)

const TEXT_STORE_PAREN_NUM_RE = new RegExp(
  `(\\b${KNOWN_STORE_NAMES_PATTERN})\\s*\\(\\s*(?:(?:Sucursal|Tienda|Store|Branch|Ubicaci[oó]n)\\s*)?#\\s*\\d{1,2}\\s*\\)`,
  'gi'
)

const TEXT_STORE_TRAILING_NUM_RE = new RegExp(
  `(\\b${KNOWN_STORE_NAMES_PATTERN})\\s+#\\s*(\\d{1,2})\\b`,
  'gi'
)

const TEXT_STANDALONE_BRANCH_NUM_RE =
  /\b(Sucursal|sucursal|SUCURSAL|Tienda|tienda|TIENDA|Store|store|STORE|Branch|branch)\s*#\s*(\d{1,2})\b/g

/**
 * Elimina de forma segura tokens `#<número>` asociados a sucursales de Tacos Gavilan dentro de títulos,
 * encabezados, badges o textos de correos automáticos, SIN alterar jamás `Ticket #148`, `Orden #123` ni `#W151879`.
 */
export function stripStoreNumberTokensInText(text: string): string {
  if (!text) return ''
  let out = String(text)

  // 1. "Sucursal #14 (Lynwood)" -> "Sucursal Lynwood", "#14 (Lynwood)" -> "Lynwood" (protegiendo "Ticket #14 (Lynwood)")
  out = out.replace(
    TEXT_PREFIX_NUM_PAREN_STORE_RE,
    (fullMatch, folioPrefix: string | undefined, branchPrefix: string | undefined, _num: string, storeName: string) => {
      if (folioPrefix) return fullMatch
      return `${branchPrefix || ''}${storeName}`
    }
  )

  // 2. "#1 - Rialto" -> "Rialto", "#14 Lynwood" -> "Lynwood", "Sucursal #14 - Lynwood" -> "Sucursal Lynwood"
  //    (protegiendo "Ticket #12 - Norwalk" u "Orden #14 - Lynwood")
  out = out.replace(
    TEXT_PREFIX_NUM_BEFORE_STORE_RE,
    (fullMatch, folioPrefix: string | undefined, branchPrefix: string | undefined, _num: string, storeName: string) => {
      if (folioPrefix) return fullMatch
      return `${branchPrefix || ''}${storeName}`
    }
  )

  // 3. "Lynwood (#14)" / "Rialto (Store #1)" -> "Lynwood" / "Rialto"
  out = out.replace(TEXT_STORE_PAREN_NUM_RE, '$1')

  // 4. "Lynwood #14" -> "Lynwood" (solo si el número corresponde a un ID canónico de sucursal)
  out = out.replace(TEXT_STORE_TRAILING_NUM_RE, (fullMatch, storeName: string, numStr: string) => {
    const resolved = getInternalStoreNameById(Number(numStr))
    return resolved ? storeName : fullMatch
  })

  // 5. "Sucursal #14" / "Tienda #5" / "Store #3" sueltos -> "Sucursal Lynwood" / "Tienda LA Broadway" / "Store West Covina"
  out = out.replace(TEXT_STANDALONE_BRANCH_NUM_RE, (fullMatch, branchWord: string, numStr: string) => {
    const resolved = getInternalStoreNameById(Number(numStr))
    if (!resolved) return fullMatch
    return `${branchWord} ${resolved}`
  })

  return out
}

const PINNED_ALL_STORES_RE =
  /^(?:all(?:\s+(?:stores|locations|branches|\d+\s+(?:stores|locations|branches)))?|todas(?:\s+las\s+(?:\d+\s+)?(?:sucursales|tiendas|ubicaciones))?|global(?:\s*\(.*\))?)$/i

const PINNED_WAREHOUSE_RE = /\b(?:bodega|warehouse|commissary)\b/i
const PINNED_CORPORATE_RE = /\b(?:corporativ[oa]|corporate|oficina\s+central)\b/i

function getSpecialStorePinRank(cleanLabel: string, rawItem?: unknown): number {
  if (rawItem && typeof rawItem === 'object') {
    const obj = rawItem as StoreDisplayObject
    if (obj.isWarehouse) return 1
    if (obj.isCorporate) return 2
  }
  if (!cleanLabel) return 4
  if (PINNED_ALL_STORES_RE.test(cleanLabel)) return 0
  if (PINNED_WAREHOUSE_RE.test(cleanLabel)) return 1
  if (PINNED_CORPORATE_RE.test(cleanLabel)) return 2
  return 3
}

/**
 * Comparador alfabético A–Z insensible a mayúsculas/acentos (`es`, `sensitivity: 'base'`, `numeric: true`)
 * evaluado siempre sobre el nombre limpio de la sucursal (`formatStoreDisplayName`).
 */
export function compareStoreNamesAlphabetically(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const cleanA = formatStoreDisplayName(a)
  const cleanB = formatStoreDisplayName(b)
  if (!cleanA && !cleanB) return 0
  if (!cleanA) return 1
  if (!cleanB) return -1
  return cleanA.localeCompare(cleanB, 'es', { sensitivity: 'base', numeric: true })
}

/**
 * Devuelve una nueva copia ordenada alfabéticamente (A–Z) usando `formatStoreDisplayName`.
 * Mantiene fijadas al inicio opciones especiales si aparecen en la colección:
 * `Todas las Sucursales / All Stores` -> `Bodega Central` -> `Oficina Corporativa` -> Sucursales `A–Z`.
 */
export function sortStoresAlphabetically<T>(
  items: readonly T[],
  getLabel?: (item: T) => string | null | undefined,
  options?: { pinSpecialFirst?: boolean }
): T[] {
  if (!Array.isArray(items) || items.length <= 1) {
    return Array.isArray(items) ? [...items] : []
  }

  const pinSpecialFirst = options?.pinSpecialFirst !== false

  const extractClean = (item: T): string => {
    if (getLabel) {
      return formatStoreDisplayName(getLabel(item))
    }
    if (typeof item === 'string' || typeof item === 'number' || item === null || item === undefined) {
      return formatStoreDisplayName(item as StoreDisplayInput)
    }
    if (typeof item === 'object') {
      return formatStoreDisplayName(item as StoreDisplayObject)
    }
    return formatStoreDisplayName(String(item))
  }

  return [...items].sort((a, b) => {
    const labelA = extractClean(a)
    const labelB = extractClean(b)

    if (pinSpecialFirst) {
      const rankA = getSpecialStorePinRank(labelA, a)
      const rankB = getSpecialStorePinRank(labelB, b)
      if (rankA !== rankB) return rankA - rankB
    }

    return compareStoreNamesAlphabetically(labelA, labelB)
  })
}

/**
 * @module lib/customer-store-names
 * @description Fuente única de verdad (Single Source of Truth) para el nombrado oficial de las 15 sucursales
 * de Tacos Gavilan en TODOS los canales de cara al cliente (Customer-Facing): Contestadora IA y Voz Neuronal `Kore`,
 * sitio web público, cotizaciones y app móvil, portales de encuestas QR (`/clientes`, `/feedback-publico`),
 * DoorDash Storefront / Drive, recibos térmicos de cliente y tableros de comedor en Modo TV.
 *
 * @businessRules
 * - **Separación Estricta Uso Interno vs. Cliente**:
 *   1) Internamente (administración, gerencia, horarios, inventarios, contabilidad, `public.stores.name`),
 *      las sucursales #5, #6 y #7 conservan sus nombres cortos operativos: `LA Broadway` (`Broadway`),
 *      `LA Central` (`Central`) y `Slauson`.
 *   2) **PARA LOS CLIENTES (REGLA OBLIGATORIA GLOBAL)**: Queda estrictamente prohibido mostrar o pronunciar
 *      únicamente `"Broadway"`, `"Central"`, `"Slauson"`, `"LA Broadway"`, `"LA Central"` o `"LA Slauson"`.
 *      Ambas sucursales #5 (`4380 S. Broadway`) y #7 (`5833 S. Broadway`) están sobre South Broadway en la ciudad
 *      de Los Ángeles, y #6 (`1900 S. Central Ave.`) también está en Los Ángeles; por ello SIEMPRE deben nombrarse
 *      como **Los Ángeles** (`Los Angeles` en inglés) especificando sus **entrecalles (esquinas)**:
 *      - **#5 (`LA Broadway`)**: `Los Ángeles (Vernon y Broadway)` / `Los Angeles (Vernon & Broadway)`
 *      - **#6 (`LA Central`, con Drive-Thru)**: `Los Ángeles (Central y Washington)` / `Los Angeles (Central & Washington)`
 *      - **#7 (`Slauson`)**: `Los Ángeles (Slauson y Broadway)` / `Los Angeles (Slauson & Broadway)`
 * - Módulo 100% puro e isomórfico (cero dependencias de Node o base de datos) para importarse en servidor y cliente.
 *
 * @dataFlow
 * - `store` (`id`, `code`, `slug` o `name`) -> `formatCustomerStoreName()` / `formatCustomerGreetingTarget()`
 * - Respuesta generada por LLM -> `sanitizeCustomerStoreReferencesInText()` -> texto y audio sin fugas internas.
 *
 * @notes
 * - Creado el 2026-11-17 para erradicar de raíz en todo el ecosistema la confusión de clientes entre las sucursales
 *   de Los Ángeles.
 */

export type CustomerLang = 'es' | 'en'

export type CustomerStoreNameStyle = 'display' | 'spoken' | 'spoken_compact' | 'web_title'

export interface CustomerStoreDescriptor {
  id?: number | string | null
  code?: string | null
  slug?: string | null
  name?: string | null
}

export interface CanonicalCustomerStoreMeta {
  id: number
  code: string
  slug: string
  internalName: string
  isLosAngelesCrossStreetStore: boolean
  cityEs: string
  cityEn: string
  crossStreetsEs: string
  crossStreetsEn: string
  spokenCrossStreetsEn: string
  displayEs: string
  displayEn: string
  spokenEs: string
  spokenEn: string
  spokenCompactEs: string
  spokenCompactEn: string
  webTitleEn: string
  searchKeywords: string
}

export const CANONICAL_CUSTOMER_STORES_BY_ID: Record<number, CanonicalCustomerStoreMeta> = {
  1: {
    id: 1,
    code: 'RIALTO',
    slug: 'rialto',
    internalName: 'Rialto',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Rialto',
    cityEn: 'Rialto',
    crossStreetsEs: 'Baseline y Riverside',
    crossStreetsEn: 'Baseline & Riverside',
    spokenCrossStreetsEn: 'Baseline and Riverside',
    displayEs: 'Rialto',
    displayEn: 'Rialto',
    spokenEs: 'Rialto',
    spokenEn: 'Rialto',
    spokenCompactEs: 'Rialto',
    spokenCompactEn: 'Rialto',
    webTitleEn: 'Rialto Baseline & Riverside',
    searchKeywords: 'rialto baseline riverside inland empire san bernardino'
  },
  3: {
    id: 3,
    code: 'WCOVINA',
    slug: 'west-covina',
    internalName: 'West Covina',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'West Covina',
    cityEn: 'West Covina',
    crossStreetsEs: '10 Freeway y Azusa',
    crossStreetsEn: '10 FWY & Azusa',
    spokenCrossStreetsEn: '10 Freeway and Azusa',
    displayEs: 'West Covina',
    displayEn: 'West Covina',
    spokenEs: 'West Covina',
    spokenEn: 'West Covina',
    spokenCompactEs: 'West Covina',
    spokenCompactEn: 'West Covina',
    webTitleEn: 'West Covina 10 FWY & Azusa',
    searchKeywords: 'west covina azusa 10 fwy san gabriel'
  },
  4: {
    id: 4,
    code: 'AZUSA',
    slug: 'azusa',
    internalName: 'Azusa',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Azusa',
    cityEn: 'Azusa',
    crossStreetsEs: 'Azusa y Arrow',
    crossStreetsEn: 'Azusa & Arrow',
    spokenCrossStreetsEn: 'Azusa and Arrow',
    displayEs: 'Azusa',
    displayEn: 'Azusa',
    spokenEs: 'Azusa',
    spokenEn: 'Azusa',
    spokenCompactEs: 'Azusa',
    spokenCompactEn: 'Azusa',
    webTitleEn: 'Azusa Azusa & Arrow',
    searchKeywords: 'azusa arrow highway san gabriel'
  },
  5: {
    id: 5,
    code: 'LABROADWY',
    slug: 'la-broadway',
    internalName: 'LA Broadway',
    isLosAngelesCrossStreetStore: true,
    cityEs: 'Los Ángeles',
    cityEn: 'Los Angeles',
    crossStreetsEs: 'Vernon y Broadway',
    crossStreetsEn: 'Vernon & Broadway',
    spokenCrossStreetsEn: 'Vernon and Broadway',
    displayEs: 'Los Ángeles (Vernon y Broadway)',
    displayEn: 'Los Angeles (Vernon & Broadway)',
    spokenEs: 'Los Ángeles, en la esquina de Vernon y Broadway',
    spokenEn: 'Los Angeles, at the corner of Vernon and Broadway',
    spokenCompactEs: 'Los Ángeles (Vernon y Broadway)',
    spokenCompactEn: 'Los Angeles (Vernon and Broadway)',
    webTitleEn: 'Los Angeles Vernon & Broadway',
    searchKeywords: 'los angeles vernon broadway 4380 south la centro'
  },
  6: {
    id: 6,
    code: 'LACENTRAL',
    slug: 'la-central',
    internalName: 'LA Central',
    isLosAngelesCrossStreetStore: true,
    cityEs: 'Los Ángeles',
    cityEn: 'Los Angeles',
    crossStreetsEs: 'Central y Washington',
    crossStreetsEn: 'Central & Washington',
    spokenCrossStreetsEn: 'Central and Washington',
    displayEs: 'Los Ángeles (Central y Washington)',
    displayEn: 'Los Angeles (Central & Washington)',
    spokenEs: 'Los Ángeles, en la esquina de Central y Washington',
    spokenEn: 'Los Angeles, at the corner of Central and Washington',
    spokenCompactEs: 'Los Ángeles (Central y Washington)',
    spokenCompactEn: 'Los Angeles (Central and Washington)',
    webTitleEn: 'Los Angeles Central & Washington',
    searchKeywords: 'los angeles central washington 1900 south la downtown centro'
  },
  7: {
    id: 7,
    code: 'SLAUSON',
    slug: 'slauson',
    internalName: 'Slauson',
    isLosAngelesCrossStreetStore: true,
    cityEs: 'Los Ángeles',
    cityEn: 'Los Angeles',
    crossStreetsEs: 'Slauson y Broadway',
    crossStreetsEn: 'Slauson & Broadway',
    spokenCrossStreetsEn: 'Slauson and Broadway',
    displayEs: 'Los Ángeles (Slauson y Broadway)',
    displayEn: 'Los Angeles (Slauson & Broadway)',
    spokenEs: 'Los Ángeles, en la esquina de Slauson y Broadway',
    spokenEn: 'Los Angeles, at the corner of Slauson and Broadway',
    spokenCompactEs: 'Los Ángeles (Slauson y Broadway)',
    spokenCompactEn: 'Los Angeles (Slauson and Broadway)',
    webTitleEn: 'Los Angeles Slauson & Broadway',
    searchKeywords: 'los angeles slauson broadway 5833 south la'
  },
  8: {
    id: 8,
    code: 'HOLLYWOOD',
    slug: 'hollywood',
    internalName: 'Hollywood',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Hollywood',
    cityEn: 'Hollywood',
    crossStreetsEs: 'Sunset y La Brea',
    crossStreetsEn: 'Sunset & La Brea',
    spokenCrossStreetsEn: 'Sunset and La Brea',
    displayEs: 'Hollywood',
    displayEn: 'Hollywood',
    spokenEs: 'Hollywood',
    spokenEn: 'Hollywood',
    spokenCompactEs: 'Hollywood',
    spokenCompactEn: 'Hollywood',
    webTitleEn: 'Hollywood Sunset & La Brea',
    searchKeywords: 'hollywood sunset la brea los angeles 7070'
  },
  9: {
    id: 9,
    code: 'SANTAANA',
    slug: 'santa-ana',
    internalName: 'Santa Ana',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Santa Ana',
    cityEn: 'Santa Ana',
    crossStreetsEs: '17th y Grand',
    crossStreetsEn: '17th & Grand',
    spokenCrossStreetsEn: 'Seventeenth and Grand',
    displayEs: 'Santa Ana',
    displayEn: 'Santa Ana',
    spokenEs: 'Santa Ana',
    spokenEn: 'Santa Ana',
    spokenCompactEs: 'Santa Ana',
    spokenCompactEn: 'Santa Ana',
    webTitleEn: 'Santa Ana 17th & Grand',
    searchKeywords: 'santa ana 17th seventeenth grand orange county'
  },
  10: {
    id: 10,
    code: 'LAPUENTE',
    slug: 'la-puente',
    internalName: 'La Puente',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'La Puente',
    cityEn: 'La Puente',
    crossStreetsEs: '605 Freeway y Valley',
    crossStreetsEn: '605 FWY & Valley',
    spokenCrossStreetsEn: '605 Freeway and Valley',
    displayEs: 'La Puente',
    displayEn: 'La Puente',
    spokenEs: 'La Puente',
    spokenEn: 'La Puente',
    spokenCompactEs: 'La Puente',
    spokenCompactEn: 'La Puente',
    webTitleEn: 'La Puente 605 FWY & Valley',
    searchKeywords: 'la puente valley 605 san gabriel'
  },
  11: {
    id: 11,
    code: 'HPARK',
    slug: 'huntington-park',
    internalName: 'Huntington Park',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Huntington Park',
    cityEn: 'Huntington Park',
    crossStreetsEs: 'Florence y Santa Fe',
    crossStreetsEn: 'Florence & Santa Fe',
    spokenCrossStreetsEn: 'Florence and Santa Fe',
    displayEs: 'Huntington Park',
    displayEn: 'Huntington Park',
    spokenEs: 'Huntington Park',
    spokenEn: 'Huntington Park',
    spokenCompactEs: 'Huntington Park',
    spokenCompactEn: 'Huntington Park',
    webTitleEn: 'Huntington Park Florence & Santa Fe',
    searchKeywords: 'huntington park florence santa fe east la southeast'
  },
  12: {
    id: 12,
    code: 'NORWALK',
    slug: 'norwalk',
    internalName: 'Norwalk',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Norwalk',
    cityEn: 'Norwalk',
    crossStreetsEs: 'Rosecrans y Studebaker',
    crossStreetsEn: 'Rosecrans & Studebaker',
    spokenCrossStreetsEn: 'Rosecrans and Studebaker',
    displayEs: 'Norwalk',
    displayEn: 'Norwalk',
    spokenEs: 'Norwalk',
    spokenEn: 'Norwalk',
    spokenCompactEs: 'Norwalk',
    spokenCompactEn: 'Norwalk',
    webTitleEn: 'Norwalk Rosecrans & Studebaker',
    searchKeywords: 'norwalk rosecrans studebaker'
  },
  13: {
    id: 13,
    code: 'BELL',
    slug: 'bell',
    internalName: 'Bell',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Bell',
    cityEn: 'Bell',
    crossStreetsEs: 'Florence y Atlantic',
    crossStreetsEn: 'Florence & Atlantic',
    spokenCrossStreetsEn: 'Florence and Atlantic',
    displayEs: 'Bell',
    displayEn: 'Bell',
    spokenEs: 'Bell',
    spokenEn: 'Bell',
    spokenCompactEs: 'Bell',
    spokenCompactEn: 'Bell',
    webTitleEn: 'Bell Florence & Atlantic',
    searchKeywords: 'bell florence atlantic'
  },
  14: {
    id: 14,
    code: 'LYNWOOD',
    slug: 'lynwood',
    internalName: 'Lynwood',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Lynwood',
    cityEn: 'Lynwood',
    crossStreetsEs: 'Imperial y Long Beach',
    crossStreetsEn: 'Imperial & Long Beach',
    spokenCrossStreetsEn: 'Imperial and Long Beach',
    displayEs: 'Lynwood',
    displayEn: 'Lynwood',
    spokenEs: 'Lynwood',
    spokenEn: 'Lynwood',
    spokenCompactEs: 'Lynwood',
    spokenCompactEn: 'Lynwood',
    webTitleEn: 'Lynwood Imperial & Long Beach',
    searchKeywords: 'lynwood imperial long beach'
  },
  15: {
    id: 15,
    code: 'SOUTHGATE',
    slug: 'south-gate',
    internalName: 'South Gate',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'South Gate',
    cityEn: 'South Gate',
    crossStreetsEs: 'Firestone y Garfield',
    crossStreetsEn: 'Firestone & Garfield',
    spokenCrossStreetsEn: 'Firestone and Garfield',
    displayEs: 'South Gate',
    displayEn: 'South Gate',
    spokenEs: 'South Gate',
    spokenEn: 'South Gate',
    spokenCompactEs: 'South Gate',
    spokenCompactEn: 'South Gate',
    webTitleEn: 'South Gate Firestone & Garfield',
    searchKeywords: 'south gate firestone garfield'
  },
  16: {
    id: 16,
    code: 'DOWNEY',
    slug: 'downey',
    internalName: 'Downey',
    isLosAngelesCrossStreetStore: false,
    cityEs: 'Downey',
    cityEn: 'Downey',
    crossStreetsEs: 'Florence y Paramount',
    crossStreetsEn: 'Florence & Paramount',
    spokenCrossStreetsEn: 'Florence and Paramount',
    displayEs: 'Downey',
    displayEn: 'Downey',
    spokenEs: 'Downey',
    spokenEn: 'Downey',
    spokenCompactEs: 'Downey',
    spokenCompactEn: 'Downey',
    webTitleEn: 'Downey Florence & Paramount',
    searchKeywords: 'downey florence paramount'
  }
}

function normalizeStoreLookupToken(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^tacos\s+(?:el\s+)?gavilan\s*[-—:]?\s*/i, '')
    .replace(/\(\s*l\.?a\.?\s*\)/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Resuelve la metadata canónica de cliente para cualquiera de las 15 sucursales a partir de `id`, `code`, `slug` o `name`.
 */
export function resolveCustomerStoreMeta(
  store: CustomerStoreDescriptor | string | number | null | undefined
): CanonicalCustomerStoreMeta | null {
  if (store === null || store === undefined) return null

  if (typeof store === 'number') {
    return CANONICAL_CUSTOMER_STORES_BY_ID[store] || null
  }

  if (typeof store === 'string') {
    const trimmed = store.trim()
    if (/^\d+$/.test(trimmed)) {
      const byNum = CANONICAL_CUSTOMER_STORES_BY_ID[Number(trimmed)]
      if (byNum) return byNum
    }
    return resolveCustomerStoreMetaByTokens(trimmed, null, null)
  }

  const numericId = Number(store.id)
  if (Number.isFinite(numericId) && CANONICAL_CUSTOMER_STORES_BY_ID[numericId]) {
    return CANONICAL_CUSTOMER_STORES_BY_ID[numericId]
  }

  return resolveCustomerStoreMetaByTokens(store.name, store.code, store.slug)
}

function resolveCustomerStoreMetaByTokens(
  name?: string | null,
  code?: string | null,
  slug?: string | null
): CanonicalCustomerStoreMeta | null {
  const codeNorm = String(code || '').trim().toUpperCase()
  const slugNorm = String(slug || '').trim().toLowerCase()
  for (const meta of Object.values(CANONICAL_CUSTOMER_STORES_BY_ID)) {
    if (codeNorm && (meta.code === codeNorm || (codeNorm === 'LABROADWAY' && meta.id === 5))) return meta
    if (slugNorm && meta.slug === slugNorm) return meta
  }

  const tok = normalizeStoreLookupToken(name)
  if (!tok) return null

  // Reglas exactas de desambiguación para las 3 sucursales de Los Ángeles (#5, #6 y #7)
  if (tok.includes('slauson') || tok.includes('5833')) {
    return CANONICAL_CUSTOMER_STORES_BY_ID[7]
  }
  if (tok.includes('vernon') || tok === 'broadway' || tok === 'la broadway' || tok === 'los angeles broadway' || tok.includes('4380')) {
    return CANONICAL_CUSTOMER_STORES_BY_ID[5]
  }
  if (tok.includes('washington') || tok === 'central' || tok === 'la central' || tok === 'los angeles central' || tok.includes('1900')) {
    return CANONICAL_CUSTOMER_STORES_BY_ID[6]
  }

  for (const meta of Object.values(CANONICAL_CUSTOMER_STORES_BY_ID)) {
    if (normalizeStoreLookupToken(meta.internalName) === tok || meta.slug.replace(/-/g, ' ') === tok) {
      return meta
    }
  }
  return null
}

/**
 * Formatea el nombre de una sucursal para mostrarse o pronunciarse a CLIENTES:
 * - #5 (`LA Broadway`) -> `Los Ángeles (Vernon y Broadway)` [ES] / `Los Angeles (Vernon & Broadway)` [EN]
 * - #6 (`LA Central`)  -> `Los Ángeles (Central y Washington)` [ES] / `Los Angeles (Central & Washington)` [EN]
 * - #7 (`Slauson`)     -> `Los Ángeles (Slauson y Broadway)` [ES] / `Los Angeles (Slauson & Broadway)` [EN]
 * - Resto de las 12 sucursales -> nombre limpio de ciudad/zona (`West Covina`, `Lynwood`, `Hollywood`, etc.).
 */
export function formatCustomerStoreName(
  store: CustomerStoreDescriptor | string | number | null | undefined,
  lang: CustomerLang = 'es',
  opts?: { style?: CustomerStoreNameStyle }
): string {
  const style: CustomerStoreNameStyle = opts?.style || 'display'
  const meta = resolveCustomerStoreMeta(store)
  if (meta) {
    if (style === 'spoken') {
      return lang === 'en' ? meta.spokenEn : meta.spokenEs
    }
    if (style === 'spoken_compact') {
      return lang === 'en' ? meta.spokenCompactEn : meta.spokenCompactEs
    }
    if (style === 'web_title') {
      return meta.webTitleEn
    }
    return lang === 'en' ? meta.displayEn : meta.displayEs
  }

  const raw =
    typeof store === 'string'
      ? store
      : typeof store === 'object' && store !== null
        ? String(store.name || store.code || '')
        : String(store ?? '')
  return raw
    .replace(/^Tacos\s+(?:El\s+)?Gavil[aá]n\s*[-—:]?\s*/i, '')
    .trim()
}

/**
 * Devuelve el complemento gramatical natural después de `"Tacos Gavilan"` para saludos al cliente:
 * - Para #5, #6 y #7: `"en Los Ángeles, esquina de Vernon y Broadway"` / `"in Los Angeles, at the corner of Vernon and Broadway"`
 * - Para las otras 12 sucursales: `"Lynwood"` / `"West Covina"` (directo tras `"Tacos Gavilan"`).
 */
export function formatCustomerGreetingTarget(
  store: CustomerStoreDescriptor | string | number | null | undefined,
  lang: CustomerLang = 'es'
): string {
  const meta = resolveCustomerStoreMeta(store)
  if (meta?.isLosAngelesCrossStreetStore) {
    return lang === 'en'
      ? `in Los Angeles, at the corner of ${meta.spokenCrossStreetsEn}`
      : `en Los Ángeles, esquina de ${meta.crossStreetsEs}`
  }
  return formatCustomerStoreName(store, lang, { style: 'display' })
}

/**
 * Devuelve las entrecalles (esquinas) oficiales de una sucursal para enriquecer búsquedas y prompts.
 */
export function getCustomerStoreCrossStreets(
  store: CustomerStoreDescriptor | string | number | null | undefined,
  lang: CustomerLang = 'es'
): string | null {
  const meta = resolveCustomerStoreMeta(store)
  if (!meta) return null
  return lang === 'en' ? meta.crossStreetsEn : meta.crossStreetsEs
}

/**
 * Sanitiza de forma determinista cualquier mención interna accidental a `"LA Central"`, `"LA Broadway"`,
 * `"LA Slauson"`, `"sucursal Central"`, `"sucursal Broadway"` o `"sucursal Slauson"` en textos dirigidos
 * al cliente, convirtiéndola a `"Los Ángeles"` con sus entrecalles oficiales sin alterar direcciones postales
 * reales (`1900 South Central Avenue`, `4380 South Broadway`, `5833 South Broadway`).
 */
export function sanitizeCustomerStoreReferencesInText(rawText: string, lang: CustomerLang = 'es'): string {
  if (!rawText) return ''
  let out = String(rawText)

  if (lang === 'en') {
    // 1. Prefijos internos "LA Broadway", "LA Central", "LA Slauson"
    out = out
      .replace(/\bL\.?A\.?\s+Broadway\b(?!\s*(?:&|and)\s*Vernon)/gi, 'Los Angeles (Vernon and Broadway)')
      .replace(/\bL\.?A\.?\s+Central\b(?!\s*(?:&|and)\s*Washington)/gi, 'Los Angeles (Central and Washington)')
      .replace(/\bL\.?A\.?\s+Slauson\b(?!\s*(?:&|and)\s*Broadway)/gi, 'Los Angeles (Slauson and Broadway)')
      .replace(/\b(Central)\s*\(\s*L\.?A\.?\s*\)/gi, 'Los Angeles (Central and Washington)')
      .replace(/\b(Broadway)\s*\(\s*L\.?A\.?\s*\)/gi, 'Los Angeles (Vernon and Broadway)')
      .replace(/\b(Slauson)\s*\(\s*L\.?A\.?\s*\)/gi, 'Los Angeles (Slauson and Broadway)')

    // 2. "our Central/Broadway/Slauson location/store/branch" (sin entrecalles ni nombre de calle postal)
    out = out
      .replace(
        /\b(our|the)\s+Central\s+(location|store|branch)\b/gi,
        '$1 Los Angeles $2 at Central and Washington'
      )
      .replace(
        /\b(our|the)\s+Broadway\s+(location|store|branch)\b/gi,
        '$1 Los Angeles $2 at Vernon and Broadway'
      )
      .replace(
        /\b(our|the)\s+Slauson\s+(location|store|branch)\b/gi,
        '$1 Los Angeles $2 at Slauson and Broadway'
      )
    return out
  }

  // Español:
  // 1. Prefijos internos "LA Broadway", "LA Central", "LA Slauson" o "(LA)"
  out = out
    .replace(/\bL\.?A\.?\s+Broadway\b(?!\s*(?:&|y)\s*Vernon)/gi, 'Los Ángeles (Vernon y Broadway)')
    .replace(/\bL\.?A\.?\s+Central\b(?!\s*(?:&|y)\s*Washington)/gi, 'Los Ángeles (Central y Washington)')
    .replace(/\bL\.?A\.?\s+Slauson\b(?!\s*(?:&|y)\s*Broadway)/gi, 'Los Ángeles (Slauson y Broadway)')
    .replace(/\bCentral\s*\(\s*L\.?A\.?\s*\)/gi, 'Los Ángeles (Central y Washington)')
    .replace(/\bBroadway\s*\(\s*L\.?A\.?\s*\)/gi, 'Los Ángeles (Vernon y Broadway)')
    .replace(/\bSlauson\s*\(\s*L\.?A\.?\s*\)/gi, 'Los Ángeles (Slauson y Broadway)')

  // 2. "sucursal (de )?Central / Broadway / Slauson" cuando NO incluye ya la entrecalle ni es dirección vial
  out = out
    .replace(
      /\b(sucursal|tienda|ubicaci[oó]n)\s+(?:de\s+)?Central\b(?!\s*(?:&|y|and|con|esquina)\s*Washington|\s+(?:Ave|Avenue))/gi,
      '$1 de Los Ángeles en la esquina de Central y Washington'
    )
    .replace(
      /\b(sucursal|tienda|ubicaci[oó]n)\s+(?:de\s+)?Broadway\b(?!\s*(?:&|y|and|con|esquina)\s*(?:Vernon|Slauson))/gi,
      '$1 de Los Ángeles en la esquina de Vernon y Broadway'
    )
    .replace(
      /\b(sucursal|tienda|ubicaci[oó]n)\s+(?:de\s+)?Slauson\b(?!\s*(?:&|y|and|con|esquina)\s*Broadway|\s+(?:Ave|Avenue))/gi,
      '$1 de Los Ángeles en la esquina de Slauson y Broadway'
    )

  return out
}

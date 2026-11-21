/**
 * @module MobileAddressAutocompleteRoute
 * @description Endpoint de autocompletado de direcciones postales en tiempo real para entregas a domicilio (Delivery).
 * Devuelve sugerencias estructuradas (calle, unidad opcional, ciudad, estado y código postal) mientras el cliente escribe.
 *
 * @businessRules
 * - Prioriza direcciones cercanas a la sucursal seleccionada (`lat`, `lng` = coordenadas de la TIENDA, no del usuario).
 * - Extrae `street`, `aptSuite` (si aplica), `city`, `state` y `zipCode` para rellenar los campos con un solo toque.
 * - Terceros que reciben el texto escrito (desde nuestro servidor, no desde el teléfono):
 *   1) Esri ArcGIS World Geocoder `suggest` (sin llave); 2) Google Geocoding API (solo si hay < 2 resultados y existe
 *   `GOOGLE_MAPS_API_KEY`). Debe reflejarse en la Política de Privacidad de la app.
 * - Límite acotado por IP (`x-vercel-forwarded-for` / `x-real-ip`, 35 solicitudes/min, máx 2,000 cubetas en RAM) + validación de `Origin`/`Referer` para bloquear abuso cross-origin de cuota de Google Maps.
 *
 * @dataFlow
 * Cliente Móvil/Web (`GET /api/mobile/address/autocomplete?q=...&lat=...&lng=...`) -> Origin Check + Rate Limit -> Proveedor de Geocodificación -> Lista de `AddressSuggestion`.
 *
 * @notes
 * - 2026-10-16: se retiró OpenStreetMap Nominatim y los errores ya no devuelven `err.message` al cliente.
 * - 2026-11-21: blindado con validación estricta de `Origin`/`Referer` para navegadores web y `Map` acotado por IP (`x-vercel-forwarded-for` / `x-real-ip`).
 */

import { NextResponse } from 'next/server'
import { corsHeaders } from '../../_helpers'

export interface AddressSuggestionDTO {
  id: string
  label: string
  primaryText: string
  secondaryText: string
  street: string
  aptSuite?: string
  city: string
  state: string
  zipCode: string
}

const DEFAULT_LA_LAT = 33.9301
const DEFAULT_LA_LNG = -118.2115

const SUBADDRESS_REGEX =
  /\b(?:apt|apartment|ste|suite|unit|bldg|building|fl|floor|spc|space|lot|#)\s*[a-z0-9-]+$/i

const PROVIDER_TIMEOUT_MS = 4000
const MAX_QUERY_LENGTH = 120
const RATE_LIMIT_PER_MINUTE = 35
const RATE_WINDOW_MS = 60_000
const MAX_IP_BUCKETS = 2000
const ipBuckets = new Map<string, number[]>()

function extractTrustedClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function checkBoundedAutocompleteRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  if (ipBuckets.size >= MAX_IP_BUCKETS && !ipBuckets.has(ip)) {
    for (const [k, arr] of ipBuckets) {
      const valid = arr.filter((t) => now - t < RATE_WINDOW_MS)
      if (valid.length === 0) ipBuckets.delete(k)
      else ipBuckets.set(k, valid)
    }
    if (ipBuckets.size >= MAX_IP_BUCKETS) {
      const oldest = ipBuckets.keys().next().value
      if (oldest) ipBuckets.delete(oldest)
    }
  }
  const hits = (ipBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_PER_MINUTE) {
    ipBuckets.set(ip, hits)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000)),
    }
  }
  hits.push(now)
  ipBuckets.set(ip, hits)
  return { allowed: true, retryAfterSeconds: 0 }
}

function isAllowedAutocompleteOrigin(request: Request): { allowed: boolean; resolvedOrigin: string | null } {
  const rawOrigin = request.headers.get('origin')?.trim() || ''
  const rawReferer = request.headers.get('referer')?.trim() || ''

  // Clientes nativos iOS/Android (Expo React Native fetch) no envían Origin/Referer
  if (!rawOrigin && !rawReferer) {
    return { allowed: true, resolvedOrigin: null }
  }

  // Esquemas nativos móviles (Expo / Capacitor / React Native WebView local)
  if (/^(?:exp|exps|tacosgavilan|capacitor|ionic):\/\//i.test(rawOrigin)) {
    return { allowed: true, resolvedOrigin: rawOrigin }
  }

  const candidateUrlStr = rawOrigin || rawReferer
  let parsed: URL
  try {
    parsed = new URL(candidateUrlStr)
  } catch {
    return { allowed: false, resolvedOrigin: null }
  }

  const host = parsed.hostname.toLowerCase()
  let reqHost = ''
  try {
    reqHost = new URL(request.url).hostname.toLowerCase()
  } catch {
    reqHost = ''
  }

  const envHostCandidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
  ]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(String(u)).hostname.toLowerCase()
      } catch {
        return ''
      }
    })
    .filter(Boolean)

  const isTrustedProdHost =
    host === 'tacosgavilan.com' ||
    host.endsWith('.tacosgavilan.com') ||
    host === 'tacosgavilan.vercel.app' ||
    host === 'teg-modernizado.vercel.app' ||
    (host.endsWith('.vercel.app') && (host.includes('tacosgavilan') || host.includes('teg-modernizado'))) ||
    (reqHost !== '' && host === reqHost) ||
    envHostCandidates.includes(host)

  const isDevLocalhost =
    process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1')

  if (isTrustedProdHost || isDevLocalhost) {
    return { allowed: true, resolvedOrigin: `${parsed.protocol}//${parsed.host}` }
  }

  return { allowed: false, resolvedOrigin: null }
}

function buildAutocompleteCorsHeaders(resolvedOrigin: string | null): Record<string, string> {
  const base = corsHeaders()
  if (resolvedOrigin) {
    return {
      ...base,
      'Access-Control-Allow-Origin': resolvedOrigin,
      Vary: 'Origin',
    }
  }
  return base
}

/**
 * Parsea una línea de dirección formateada estilo:
 * "11005 Long Beach Blvd, Lynwood, CA, 90262, USA" o
 * "3300 Gage Ave, Apt 4, Huntington Park, CA, 90255, USA"
 */
export function parseFormattedUsAddress(
  rawText: string,
  idPrefix: string,
  index: number
): AddressSuggestionDTO | null {
  const cleaned = String(rawText || '').trim()
  if (!cleaned) return null

  const parts = cleaned
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  if (
    parts.length > 0 &&
    /^(usa|united states|us)$/i.test(parts[parts.length - 1])
  ) {
    parts.pop()
  }

  if (parts.length < 3) return null

  let zipCode = ''
  let state = 'CA'
  let city = ''
  let streetParts: string[] = []

  const lastPart = parts[parts.length - 1]
  const secondLastPart = parts[parts.length - 2]

  if (/^\d{5}(-\d{4})?$/.test(lastPart) && /^[A-Za-z]{2}$/.test(secondLastPart)) {
    zipCode = lastPart.slice(0, 5)
    state = secondLastPart.toUpperCase()
    city = parts[parts.length - 3] || ''
    streetParts = parts.slice(0, parts.length - 3)
  } else {
    const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
    if (stateZipMatch) {
      state = stateZipMatch[1].toUpperCase()
      zipCode = stateZipMatch[2]
      city = secondLastPart || ''
      streetParts = parts.slice(0, parts.length - 2)
    } else if (/^[A-Za-z]{2}$/.test(lastPart)) {
      state = lastPart.toUpperCase()
      city = secondLastPart || ''
      streetParts = parts.slice(0, parts.length - 2)
    } else {
      return null
    }
  }

  if (streetParts.length === 0 || !city) return null

  let street = streetParts[0]
  let aptSuite: string | undefined

  if (streetParts.length > 1) {
    aptSuite = streetParts.slice(1).join(', ')
  } else {
    const inlineSubMatch = street.match(SUBADDRESS_REGEX)
    if (inlineSubMatch && inlineSubMatch.index && inlineSubMatch.index > 3) {
      aptSuite = inlineSubMatch[0].trim()
      street = street.slice(0, inlineSubMatch.index).replace(/,\s*$/, '').trim()
    }
  }

  if (!street || street.length < 3) return null

  const primaryText = aptSuite ? `${street} (${aptSuite})` : street
  const secondaryText = [city, state, zipCode].filter(Boolean).join(', ')
  const label = `${primaryText}, ${secondaryText}`

  return {
    id: `${idPrefix}-${index}-${street}-${zipCode}`.replace(/\s+/g, '_'),
    label,
    primaryText,
    secondaryText,
    street,
    ...(aptSuite ? { aptSuite } : {}),
    city,
    state,
    zipCode,
  }
}

export async function OPTIONS(request: Request) {
  const originCheck = isAllowedAutocompleteOrigin(request)
  if (!originCheck.allowed) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN_ORIGIN' }, { status: 403 })
  }
  return new NextResponse(null, {
    status: 204,
    headers: buildAutocompleteCorsHeaders(originCheck.resolvedOrigin),
  })
}

export async function GET(request: Request) {
  const originCheck = isAllowedAutocompleteOrigin(request)
  if (!originCheck.allowed) {
    return NextResponse.json(
      { ok: false, suggestions: [], code: 'FORBIDDEN_ORIGIN', error: 'Origin not allowed' },
      { status: 403 }
    )
  }

  const responseHeaders = buildAutocompleteCorsHeaders(originCheck.resolvedOrigin)

  try {
    const ip = extractTrustedClientIp(request.headers)
    const rl = checkBoundedAutocompleteRateLimit(ip)
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, suggestions: [], code: 'RATE_LIMITED', retryAfterSeconds: rl.retryAfterSeconds },
        {
          status: 429,
          headers: {
            ...responseHeaders,
            'Retry-After': String(rl.retryAfterSeconds),
          },
        }
      )
    }

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim().slice(0, MAX_QUERY_LENGTH)
    const latParam = Number(searchParams.get('lat'))
    const lngParam = Number(searchParams.get('lng'))

    const lat =
      Number.isFinite(latParam) && Math.abs(latParam) > 1 && Math.abs(latParam) <= 90
        ? latParam
        : DEFAULT_LA_LAT
    const lng =
      Number.isFinite(lngParam) && Math.abs(lngParam) > 1 && Math.abs(lngParam) <= 180
        ? lngParam
        : DEFAULT_LA_LNG

    if (q.length < 3) {
      return NextResponse.json(
        { ok: true, suggestions: [] },
        { status: 200, headers: responseHeaders }
      )
    }

    const suggestions: AddressSuggestionDTO[] = []
    const seenKeys = new Set<string>()

    const pushUnique = (item: AddressSuggestionDTO | null) => {
      if (!item) return
      const dedupeKey = `${item.street.toLowerCase()}|${item.city.toLowerCase()}|${item.zipCode}`
      if (seenKeys.has(dedupeKey)) return
      seenKeys.add(dedupeKey)
      suggestions.push(item)
    }

    // 1. Proveedor Primario: ArcGIS World Geocoder Suggest con sesgo geográfico a la sucursal
    try {
      const minLng = (lng - 1.25).toFixed(4)
      const minLat = (lat - 0.85).toFixed(4)
      const maxLng = (lng + 1.25).toFixed(4)
      const maxLat = (lat + 0.85).toFixed(4)

      const suggestUrl =
        `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest` +
        `?f=json` +
        `&text=${encodeURIComponent(q)}` +
        `&location=${lng},${lat}` +
        `&searchExtent=${minLng},${minLat},${maxLng},${maxLat}` +
        `&countryCode=USA` +
        `&category=${encodeURIComponent('Point Address,Street Address,Subaddress')}` +
        `&maxSuggestions=6`

      const arcRes = await fetch(suggestUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })

      if (arcRes.ok) {
        const arcData = (await arcRes.json()) as {
          suggestions?: Array<{ text?: string; magicKey?: string }>
        }
        const rawList = Array.isArray(arcData.suggestions)
          ? arcData.suggestions
          : []
        rawList.forEach((entry, idx) => {
          const parsed = parseFormattedUsAddress(
            String(entry?.text || ''),
            'arc',
            idx
          )
          pushUnique(parsed)
        })
      }
    } catch {
      // Continúa al siguiente proveedor en caso de error de red o timeout
    }

    // 2. Respaldo con Google Maps Geocoding API (si hay menos de 2 sugerencias)
    const googleKey =
      process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY
    if (suggestions.length < 2 && googleKey) {
      try {
        const bounds = `${(lat - 0.5).toFixed(4)},${(lng - 0.5).toFixed(4)}|${(lat + 0.5).toFixed(4)},${(lng + 0.5).toFixed(4)}`
        const googleUrl =
          `https://maps.googleapis.com/maps/api/geocode/json` +
          `?address=${encodeURIComponent(`${q}, CA`)}` +
          `&components=country:US|administrative_area:CA` +
          `&bounds=${encodeURIComponent(bounds)}` +
          `&key=${googleKey}` +
          `&solution_id=gmp_git_agentskills_v1`

        const gRes = await fetch(googleUrl, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
        if (gRes.ok) {
          const gData = (await gRes.json()) as {
            status?: string
            results?: Array<{
              formatted_address?: string
              address_components?: Array<{
                long_name: string
                short_name: string
                types: string[]
              }>
            }>
          }

          if (gData.status === 'OK' && Array.isArray(gData.results)) {
            gData.results.slice(0, 5).forEach((resItem, idx) => {
              const comps = Array.isArray(resItem.address_components)
                ? resItem.address_components
                : []
              const getShort = (type: string) =>
                comps.find((c) => c.types.includes(type))?.short_name || ''
              const getLong = (type: string) =>
                comps.find((c) => c.types.includes(type))?.long_name || ''

              const streetNum = getShort('street_number')
              const route = getShort('route')
              const subpremise = getShort('subpremise')
              const locality =
                getLong('locality') ||
                getLong('sublocality') ||
                getLong('neighborhood')
              const stateCode =
                getShort('administrative_area_level_1') || 'CA'
              const postalCode = getShort('postal_code')

              if (streetNum && route && locality && postalCode) {
                const street = `${streetNum} ${route}`.trim()
                const secondaryText = `${locality}, ${stateCode}, ${postalCode}`
                pushUnique({
                  id: `ggl-${idx}-${street}-${postalCode}`.replace(/\s+/g, '_'),
                  label: `${street}, ${secondaryText}`,
                  primaryText: street,
                  secondaryText,
                  street,
                  ...(subpremise ? { aptSuite: `#${subpremise}` } : {}),
                  city: locality,
                  state: stateCode,
                  zipCode: postalCode,
                })
              } else if (resItem.formatted_address) {
                pushUnique(
                  parseFormattedUsAddress(
                    resItem.formatted_address,
                    'ggl',
                    idx
                  )
                )
              }
            })
          }
        }
      } catch {
        // Sin más respaldos
      }
    }

    return NextResponse.json(
      {
        ok: true,
        suggestions: suggestions.slice(0, 5),
      },
      { status: 200, headers: responseHeaders }
    )
  } catch {
    return NextResponse.json(
      { ok: false, suggestions: [], error: 'Address lookup failed' },
      { status: 500, headers: responseHeaders }
    )
  }
}

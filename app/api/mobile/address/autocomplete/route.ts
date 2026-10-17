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
 * - Límite: 40 solicitudes/min por IP (memoria, mejor esfuerzo), consulta ≤ 120 caracteres, timeout 4 s por proveedor.
 *
 * @dataFlow
 * Cliente Móvil/Web (`GET /api/mobile/address/autocomplete?q=...&lat=...&lng=...`) -> Proveedor de Geocodificación -> Lista de `AddressSuggestion`.
 *
 * @notes
 * - 2026-10-16: se retiró OpenStreetMap Nominatim (su política pública prohíbe búsquedas tipo autocompletado) y los
 *   errores ya no devuelven `err.message` al cliente.
 */

import { NextResponse } from 'next/server'
import { corsHeaders } from '../../_helpers'
import { checkRateLimit, getClientIp } from '@/lib/storefront/rate-limit'

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

  // Eliminar país final si es USA / United States
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

  // Caso A: [..., City, State, Zip] (ej. "11005 Long Beach Blvd", "Lynwood", "CA", "90262")
  if (/^\d{5}(-\d{4})?$/.test(lastPart) && /^[A-Za-z]{2}$/.test(secondLastPart)) {
    zipCode = lastPart.slice(0, 5)
    state = secondLastPart.toUpperCase()
    city = parts[parts.length - 3] || ''
    streetParts = parts.slice(0, parts.length - 3)
  } else {
    // Caso B: [..., City, "CA 90262"]
    const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
    if (stateZipMatch) {
      state = stateZipMatch[1].toUpperCase()
      zipCode = stateZipMatch[2]
      city = secondLastPart || ''
      streetParts = parts.slice(0, parts.length - 2)
    } else if (/^[A-Za-z]{2}$/.test(lastPart)) {
      // Caso C: [Street, City, State] sin ZIP explícito
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

  // Filtrar sugerencias que no comienzan con número de calle o dirección válida
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

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() })
}

const PROVIDER_TIMEOUT_MS = 4000
const MAX_QUERY_LENGTH = 120
const RATE_LIMIT_PER_MINUTE = 40

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request.headers)
    const rl = checkRateLimit(`address-autocomplete:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, suggestions: [], code: 'RATE_LIMITED', retryAfterSeconds: rl.retryAfterSeconds },
        { status: 429, headers: corsHeaders() }
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
        { status: 200, headers: corsHeaders() }
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
        // Sin más respaldos: Nominatim se retiró (su política de uso prohíbe autocompletado).
      }
    }

    return NextResponse.json(
      {
        ok: true,
        suggestions: suggestions.slice(0, 5),
      },
      { status: 200, headers: corsHeaders() }
    )
  } catch {
    return NextResponse.json(
      { ok: false, suggestions: [], code: 'AUTOCOMPLETE_ERROR' },
      { status: 200, headers: corsHeaders() }
    )
  }
}

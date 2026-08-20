/**
 * @module lib/store-coordinates
 * @description Diccionario canónico centralizado y utilidades de geolocalización para todas las sucursales
 *              activas de Tacos Gavilan, Bodega Central y Oficina Corporativa.
 * @businessRules
 * - Las coordenadas están geocodificadas con alta precisión basadas en las direcciones físicas oficiales.
 * - Sirve como fuente de verdad única para MilesIQ, Tiendas, Detección GPS y Navegación Externa.
 * - Integra Bodega Central (Vernon) y Oficina Corporativa (Los Ángeles).
 * @dataFlow
 * - Importado por TripModal, RouteMap, /api/miles/*, /api/tiendas/* y chat-tools.
 * @notes
 * - Todas las tiendas pertenecen estrictamente a la marca 'Tacos Gavilan'.
 */

export interface StoreLocation {
  id?: number
  name: string
  shortName: string
  address: string
  city: string
  state: string
  zip_code: string
  lat: number
  lng: number
  isWarehouse?: boolean
  isCorporate?: boolean
}

export const CANONICAL_STORE_COORDINATES: Record<string, StoreLocation> = {
  'Tacos Gavilan LA Central': {
    id: 6,
    name: 'Tacos Gavilan LA Central',
    shortName: 'LA Central',
    address: '1900 S. Central Ave.',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90011',
    lat: 34.023884,
    lng: -118.250561
  },
  'Tacos Gavilan LA Broadway': {
    id: 5,
    name: 'Tacos Gavilan LA Broadway',
    shortName: 'LA Broadway',
    address: '4380 S. Broadway',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90037',
    lat: 34.004005,
    lng: -118.278106
  },
  'Tacos Gavilan Slauson': {
    id: 7,
    name: 'Tacos Gavilan Slauson',
    shortName: 'Slauson',
    address: '200 W. Slauson Ave.',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90003',
    lat: 33.989040,
    lng: -118.276330
  },
  'Tacos Gavilan Hollywood': {
    id: 8,
    name: 'Tacos Gavilan Hollywood',
    shortName: 'Hollywood',
    address: '7070 Sunset Blvd.',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90028',
    lat: 34.097757,
    lng: -118.343890
  },
  'Tacos Gavilan Huntington Park': {
    id: 11,
    name: 'Tacos Gavilan Huntington Park',
    shortName: 'Huntington Park',
    address: '2425 E. Florence Ave.',
    city: 'Huntington Park',
    state: 'CA',
    zip_code: '90255',
    lat: 33.975055,
    lng: -118.229235
  },
  'Tacos Gavilan Bell': {
    id: 13,
    name: 'Tacos Gavilan Bell',
    shortName: 'Bell',
    address: '4406 E. Florence Ave.',
    city: 'Bell',
    state: 'CA',
    zip_code: '90201',
    lat: 33.970395,
    lng: -118.188871
  },
  'Tacos Gavilan South Gate': {
    id: 15,
    name: 'Tacos Gavilan South Gate',
    shortName: 'South Gate',
    address: '5800 Firestone Blvd.',
    city: 'South Gate',
    state: 'CA',
    zip_code: '90280',
    lat: 33.948795,
    lng: -118.164767
  },
  'Tacos Gavilan Downey': {
    id: 16,
    name: 'Tacos Gavilan Downey',
    shortName: 'Downey',
    address: '7947 E. Florence Ave.',
    city: 'Downey',
    state: 'CA',
    zip_code: '90240',
    lat: 33.953703,
    lng: -118.130299
  },
  'Tacos Gavilan Lynwood': {
    id: 14,
    name: 'Tacos Gavilan Lynwood',
    shortName: 'Lynwood',
    address: '3220 E. Imperial Hwy.',
    city: 'Lynwood',
    state: 'CA',
    zip_code: '90262',
    lat: 33.930001,
    lng: -118.212320
  },
  'Tacos Gavilan Norwalk': {
    id: 12,
    name: 'Tacos Gavilan Norwalk',
    shortName: 'Norwalk',
    address: '10968 Rosecrans Ave.',
    city: 'Norwalk',
    state: 'CA',
    zip_code: '90650',
    lat: 33.901810,
    lng: -118.100403
  },
  'Tacos Gavilan Santa Ana': {
    id: 9,
    name: 'Tacos Gavilan Santa Ana',
    shortName: 'Santa Ana',
    address: '1258 E. 17th St.',
    city: 'Santa Ana',
    state: 'CA',
    zip_code: '92701',
    lat: 33.759621,
    lng: -117.852252
  },
  'Tacos Gavilan La Puente': {
    id: 10,
    name: 'Tacos Gavilan La Puente',
    shortName: 'La Puente',
    address: '13009 Valley Blvd.',
    city: 'La Puente',
    state: 'CA',
    zip_code: '91746',
    lat: 34.053251,
    lng: -118.001777
  },
  'Tacos Gavilan West Covina': {
    id: 3,
    name: 'Tacos Gavilan West Covina',
    shortName: 'West Covina',
    address: '101 S. Azusa Ave.',
    city: 'West Covina',
    state: 'CA',
    zip_code: '91791',
    lat: 34.070966,
    lng: -117.908150
  },
  'Tacos Gavilan Azusa': {
    id: 4,
    name: 'Tacos Gavilan Azusa',
    shortName: 'Azusa',
    address: '887 S. Azusa Ave.',
    city: 'Azusa',
    state: 'CA',
    zip_code: '91702',
    lat: 34.107074,
    lng: -117.908194
  },
  'Tacos Gavilan Rialto': {
    id: 1,
    name: 'Tacos Gavilan Rialto',
    shortName: 'Rialto',
    address: '115 E. Baseline Rd.',
    city: 'Rialto',
    state: 'CA',
    zip_code: '92376',
    lat: 34.121100,
    lng: -117.370048
  },
  'Bodega Central': {
    name: 'Bodega Central',
    shortName: 'Bodega Central',
    address: '5182 Malabar St',
    city: 'Vernon',
    state: 'CA',
    zip_code: '90058',
    lat: 33.995979,
    lng: -118.227535,
    isWarehouse: true
  },
  'Oficina Corporativa': {
    name: 'Oficina Corporativa',
    shortName: 'Oficina Corporativa',
    address: '5304 S Broadway',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90037',
    lat: 33.993999,
    lng: -118.278007,
    isCorporate: true
  }
}

/**
 * Calcula la distancia en línea recta en millas (Haversine Formula)
 */
export function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8 // Radio de la Tierra en millas
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Encuentra la sucursal más cercana dadas coordenadas GPS del dispositivo
 */
export function findClosestStore(
  latitude: number,
  longitude: number,
  customCoords?: Record<string, { lat: number; lng: number }>
): { name: string; distanceMiles: number; fullAddress: string } | null {
  const coordsMap = customCoords || CANONICAL_STORE_COORDINATES
  let closestName = ''
  let minDistance = Infinity

  for (const [name, loc] of Object.entries(coordsMap)) {
    if (loc.lat && loc.lng) {
      const dist = haversineDistanceMiles(latitude, longitude, loc.lat, loc.lng)
      if (dist < minDistance) {
        minDistance = dist
        closestName = name
      }
    }
  }

  if (!closestName) return null

  const loc = CANONICAL_STORE_COORDINATES[closestName]
  const fullAddress = loc
    ? `${loc.address}, ${loc.city}, ${loc.state} ${loc.zip_code}`
    : closestName

  return {
    name: closestName,
    distanceMiles: parseFloat(minDistance.toFixed(2)),
    fullAddress
  }
}

/**
 * Normaliza el nombre de una tienda a su versión completa oficial
 */
export function normalizeStoreName(name: string): string {
  if (!name) return ''
  const trimmed = name.trim()
  if (trimmed === 'Bodega Central' || trimmed === 'Oficina Corporativa') return trimmed
  if (trimmed.startsWith('Tacos Gavilan')) return trimmed
  return `Tacos Gavilan ${trimmed}`
}

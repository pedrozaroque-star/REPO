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
    address: '4801 S Central Ave',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90011',
    lat: 34.000150,
    lng: -118.256705
  },
  'Tacos Gavilan LA Broadway': {
    id: 5,
    name: 'Tacos Gavilan LA Broadway',
    shortName: 'LA Broadway',
    address: '4363 S Broadway',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90037',
    lat: 34.004274,
    lng: -118.278645
  },
  'Tacos Gavilan Slauson': {
    id: 7,
    name: 'Tacos Gavilan Slauson',
    shortName: 'Slauson',
    address: '200 W Slauson Ave',
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
    address: '7083 Sunset Blvd',
    city: 'Los Angeles',
    state: 'CA',
    zip_code: '90028',
    lat: 34.098453,
    lng: -118.343943
  },
  'Tacos Gavilan Huntington Park': {
    id: 11,
    name: 'Tacos Gavilan Huntington Park',
    shortName: 'Huntington Park',
    address: '2652 Florence Ave',
    city: 'Huntington Park',
    state: 'CA',
    zip_code: '90255',
    lat: 33.973780,
    lng: -118.223654
  },
  'Tacos Gavilan Bell': {
    id: 13,
    name: 'Tacos Gavilan Bell',
    shortName: 'Bell',
    address: '4406 E Florence Ave',
    city: 'Bell',
    state: 'CA',
    zip_code: '90201',
    lat: 33.970111,
    lng: -118.188911
  },
  'Tacos Gavilan South Gate': {
    id: 15,
    name: 'Tacos Gavilan South Gate',
    shortName: 'South Gate',
    address: '8940 Garfield Ave',
    city: 'South Gate',
    state: 'CA',
    zip_code: '90280',
    lat: 33.949877,
    lng: -118.164547
  },
  'Tacos Gavilan Downey': {
    id: 16,
    name: 'Tacos Gavilan Downey',
    shortName: 'Downey',
    address: '12051 Paramount Blvd',
    city: 'Downey',
    state: 'CA',
    zip_code: '90240',
    lat: 33.932377,
    lng: -118.145903
  },
  'Tacos Gavilan Lynwood': {
    id: 14,
    name: 'Tacos Gavilan Lynwood',
    shortName: 'Lynwood',
    address: '3740 E Imperial Hwy',
    city: 'Lynwood',
    state: 'CA',
    zip_code: '90262',
    lat: 33.931789,
    lng: -118.197964
  },
  'Tacos Gavilan Norwalk': {
    id: 12,
    name: 'Tacos Gavilan Norwalk',
    shortName: 'Norwalk',
    address: '12539 Rosecrans Ave',
    city: 'Norwalk',
    state: 'CA',
    zip_code: '90650',
    lat: 33.902375,
    lng: -118.065294
  },
  'Tacos Gavilan Santa Ana': {
    id: 9,
    name: 'Tacos Gavilan Santa Ana',
    shortName: 'Santa Ana',
    address: '801 W 17th St',
    city: 'Santa Ana',
    state: 'CA',
    zip_code: '92701',
    lat: 33.760303,
    lng: -117.875791
  },
  'Tacos Gavilan La Puente': {
    id: 10,
    name: 'Tacos Gavilan La Puente',
    shortName: 'La Puente',
    address: '13009 Valley Blvd',
    city: 'La Puente',
    state: 'CA',
    zip_code: '91746',
    lat: 34.053204,
    lng: -118.001794
  },
  'Tacos Gavilan West Covina': {
    id: 3,
    name: 'Tacos Gavilan West Covina',
    shortName: 'West Covina',
    address: '2330 S Azusa Ave',
    city: 'West Covina',
    state: 'CA',
    zip_code: '91791',
    lat: 34.035433,
    lng: -117.910469
  },
  'Tacos Gavilan Azusa': {
    id: 4,
    name: 'Tacos Gavilan Azusa',
    shortName: 'Azusa',
    address: '122 N Azusa Ave',
    city: 'Azusa',
    state: 'CA',
    zip_code: '91702',
    lat: 34.122386,
    lng: -117.907348
  },
  'Tacos Gavilan Rialto': {
    id: 1,
    name: 'Tacos Gavilan Rialto',
    shortName: 'Rialto',
    address: '240 W Baseline Rd',
    city: 'Rialto',
    state: 'CA',
    zip_code: '92376',
    lat: 34.121809,
    lng: -117.373453
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

/**
 * @module app/api/mobile/stores/route
 * @description Endpoint público de consulta de las 15 sucursales oficiales activas de Tacos Gavilan.
 *
 * @businessRules
 * - Retorna únicamente sucursales activas (`is_active = true`) con coordenadas GPS reales (`latitude`, `longitude`).
 * - No requiere sesión autenticada para permitir que comensales invitados seleccionen sucursal antes de iniciar sesión.
 *
 * @dataFlow
 * - App Móvil GET `/api/mobile/stores` -> Consulta `public.stores` -> Retorna arreglo ordenado alfabéticamente.
 *
 * @notes
 * - Sincronizado con los identificadores numéricos reales de las 15 sucursales en Supabase (`1, 3..16`)
 *   y teléfonos/direcciones contrastados contra https://tacosgavilan.com/locations/.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError } from '../_helpers'

/** Columnas seleccionadas de la tabla stores */
const STORE_SELECT_COLUMNS = 'id, name, address, city, latitude, longitude, phone' as const

/** Catálogo canónico del sitio web oficial (tacosgavilan.com) en el mismo orden de volumen */
const CANONICAL_WEB_STORES: Record<
  number,
  {
    orderIndex: number
    cityTitle: string
    crossStreets: string
    name: string
    streetAddress: string
    address: string
    phone: string
    toastOrderingUrl: string
  }
> = {
  6: {
    orderIndex: 1,
    cityTitle: 'Los Angeles',
    crossStreets: 'Central & Washington',
    name: 'Los Angeles Central & Washington',
    streetAddress: '1900 S. Central Ave',
    address: '1900 S. Central Ave, Los Angeles, CA 90011',
    phone: '(213) 742-6677',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260847',
  },
  14: {
    orderIndex: 2,
    cityTitle: 'Lynwood',
    crossStreets: 'Imperial & Long Beach',
    name: 'Lynwood Imperial & Long Beach',
    streetAddress: '3220 E. Imperial Hwy',
    address: '3220 E. Imperial Hwy, Lynwood, CA 90262',
    phone: '(424) 785-5535',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-lynwood-727877',
  },
  5: {
    orderIndex: 3,
    cityTitle: 'Los Angeles',
    crossStreets: 'Vernon & Broadway',
    name: 'Los Angeles Vernon & Broadway',
    streetAddress: '4380 S. Broadway',
    address: '4380 S. Broadway, Los Angeles, CA 90037',
    phone: '(323) 233-2302',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260769',
  },
  12: {
    orderIndex: 4,
    cityTitle: 'Norwalk',
    crossStreets: 'Rosecrans & Studebaker',
    name: 'Norwalk Rosecrans & Studebaker',
    streetAddress: '10968 Rosecrans Ave',
    address: '10968 Rosecrans Ave, Norwalk, CA 90650',
    phone: '(562) 651-0045',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-norwalk-1327857',
  },
  7: {
    orderIndex: 5,
    cityTitle: 'Los Angeles',
    crossStreets: 'Slauson & Broadway',
    name: 'Los Angeles Slauson & Broadway',
    streetAddress: '5833 S. Broadway',
    address: '5833 S. Broadway, Los Angeles, CA 90003',
    phone: '(323) 615-0084',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119',
  },
  1: {
    orderIndex: 6,
    cityTitle: 'Rialto',
    crossStreets: 'Baseline & Riverside',
    name: 'Rialto Baseline & Riverside',
    streetAddress: '115 E. Baseline Rd',
    address: '115 E. Baseline Rd, Rialto, CA 92376',
    phone: '(909) 562-0430',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-rialto-841931',
  },
  3: {
    orderIndex: 7,
    cityTitle: 'West Covina',
    crossStreets: '10 FWY & Azusa',
    name: 'West Covina 10 FWY & Azusa',
    streetAddress: '101 S. Azusa Ave',
    address: '101 S. Azusa Ave, West Covina, CA 91791',
    phone: '(626) 917-2662',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-west-covina-725035',
  },
  15: {
    orderIndex: 8,
    cityTitle: 'South Gate',
    crossStreets: 'Firestone & Garfield',
    name: 'South Gate Firestone & Garfield',
    streetAddress: '5800 Firestone Blvd',
    address: '5800 Firestone Blvd, South Gate, CA 90280',
    phone: '(562) 806-1200',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-south-gate-846517',
  },
  16: {
    orderIndex: 9,
    cityTitle: 'Downey',
    crossStreets: 'Florence & Paramount',
    name: 'Downey Florence & Paramount',
    streetAddress: '7947 E. Florence Ave',
    address: '7947 E. Florence Ave, Downey, CA 90240',
    phone: '(562) 927-7486',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-downey-302620',
  },
  8: {
    orderIndex: 10,
    cityTitle: 'Hollywood',
    crossStreets: 'Sunset & La Brea',
    name: 'Hollywood Sunset & La Brea',
    streetAddress: '7070 Sunset Blvd',
    address: '7070 Sunset Blvd, Los Angeles, CA 90028',
    phone: '(323) 963-7993',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-los-angeles-551916',
  },
  9: {
    orderIndex: 11,
    cityTitle: 'Santa Ana',
    crossStreets: '17th & Grand',
    name: 'Santa Ana 17th & Grand',
    streetAddress: '1258 E. 17th St',
    address: '1258 E. 17th St, Santa Ana, CA 92701',
    phone: '(714) 480-0713',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-santa-ana-724574',
  },
  11: {
    orderIndex: 12,
    cityTitle: 'Huntington Park',
    crossStreets: 'Florence & Santa Fe',
    name: 'Huntington Park Florence & Santa Fe',
    streetAddress: '2425 E. Florence Ave',
    address: '2425 E. Florence Ave, Huntington Park, CA 90255',
    phone: '(323) 581-7309',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-huntington-park-260849',
  },
  10: {
    orderIndex: 13,
    cityTitle: 'La Puente',
    crossStreets: '605 FWY & Valley',
    name: 'La Puente 605 FWY & Valley',
    streetAddress: '13009 Valley Blvd',
    address: '13009 Valley Blvd, La Puente, CA 91746',
    phone: '(626) 336-3000',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-la-puente-963464',
  },
  4: {
    orderIndex: 14,
    cityTitle: 'Azusa',
    crossStreets: 'Azusa & Arrow',
    name: 'Azusa Azusa & Arrow',
    streetAddress: '887 S. Azusa Ave',
    address: '887 S. Azusa Ave, Azusa, CA 91702',
    phone: '(626) 969-1011',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-azusa-718169',
  },
  13: {
    orderIndex: 15,
    cityTitle: 'Bell',
    crossStreets: 'Florence & Atlantic',
    name: 'Bell Florence & Atlantic',
    streetAddress: '4406 E Florence Ave',
    address: '4406 E Florence Ave, Bell, CA 90201',
    phone: '(323) 771-1722',
    toastOrderingUrl: 'https://order.online/store/tacos-gavilan-bell-260912',
  },
}

export async function GET(): Promise<NextResponse> {
  try {
    const { data, error } = await supabaseAdmin
      .from('stores')
      .select(STORE_SELECT_COLUMNS)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) {
      console.error('❌ [mobile/stores] Error al consultar tiendas:', error.message)
      return jsonError('Error al obtener las sucursales', 500)
    }

    const enrichedStores = (data ?? [])
      .map((row) => {
        const canonical = CANONICAL_WEB_STORES[Number(row.id)]
        if (!canonical) return { ...row, orderIndex: 999 }
        return {
          ...row,
          orderIndex: canonical.orderIndex,
          cityTitle: canonical.cityTitle,
          crossStreets: canonical.crossStreets,
          name: canonical.name,
          streetAddress: canonical.streetAddress,
          address: canonical.address,
          phone: canonical.phone,
          toastOrderingUrl: canonical.toastOrderingUrl,
        }
      })
      .sort((a, b) => a.orderIndex - b.orderIndex)

    return jsonOk({ stores: enrichedStores })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('❌ [mobile/stores] Error inesperado:', message)
    return jsonError('Error interno del servidor', 500)
  }
}

// ============================================================================
// OPTIONS — Preflight CORS
// ============================================================================
export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

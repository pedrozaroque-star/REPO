/**
 * @module api/miles/store-coordinates/route
 * @description API endpoint que retorna las coordenadas geográficas de todas las tiendas activas,
 *              la Bodega Central y la Oficina Corporativa para pintar marcadores en el mapa de MilesIQ.
 * @businessRules
 * - Las coordenadas provienen primero de la tabla 'stores' en Supabase.
 * - Si una tienda no tiene coordenadas en DB, se usa el diccionario hardcodeado STORE_COORDINATES como fallback.
 * - Siempre incluye Bodega Central (5182 Malabar St, Vernon) y Oficina Corporativa.
 * @dataFlow Client GET → Supabase stores → merge con fallback → JSON response
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { CANONICAL_STORE_COORDINATES } from '@/lib/store-coordinates'

export async function GET() {
  try {
    const supabase = await getSupabaseAdminClient()

    const { data: dbStores } = await supabase
      .from('stores')
      .select('name, address, city, state, zip_code, latitude, longitude')
      .eq('is_active', true)

    // Base canonical coordinates
    const coordinates: Record<string, { lat: number; lng: number; address: string }> = {}

    // Populate from CANONICAL_STORE_COORDINATES
    Object.entries(CANONICAL_STORE_COORDINATES).forEach(([key, loc]) => {
      const fullAddr = `${loc.address}, ${loc.city}, ${loc.state} ${loc.zip_code}`.trim()
      coordinates[key] = { lat: loc.lat, lng: loc.lng, address: fullAddr }
      if (loc.shortName && loc.shortName !== key) {
        coordinates[loc.shortName] = coordinates[key]
      }
    })

    // Merge/Override with live DB store data if present
    if (dbStores && dbStores.length > 0) {
      dbStores.forEach(s => {
        if (s.latitude && s.longitude) {
          const fullName = s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
          const fullAddr = `${s.address || ''}, ${s.city || ''}, ${s.state || 'CA'} ${s.zip_code || ''}`.trim()
          coordinates[fullName] = {
            lat: Number(s.latitude),
            lng: Number(s.longitude),
            address: fullAddr
          }
          const shortName = s.name.replace(/^Tacos Gavilan\s+/i, '').trim()
          if (shortName && shortName !== fullName) {
            coordinates[shortName] = coordinates[fullName]
          }
        }
      })
    }

    return NextResponse.json({ success: true, coordinates })
  } catch (err: any) {
    console.error('Error in GET /api/miles/store-coordinates:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

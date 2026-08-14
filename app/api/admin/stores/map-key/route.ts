/**
 * @module api/admin/stores/map-key
 * @description Endpoint seguro que sirve la API key de Google Maps para componentes del frontend.
 * @businessRules
 * - La key se lee de la variable de entorno GOOGLE_MAPS_API_KEY.
 * - Solo se expone la key de Maps JavaScript API, no service keys.
 * @dataFlow ENV → API response → Frontend map components
 */

import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || ''
  
  if (!apiKey) {
    return NextResponse.json(
      { apiKey: null, error: 'GOOGLE_MAPS_API_KEY not configured' },
      { status: 200 }
    )
  }

  return NextResponse.json({ apiKey })
}

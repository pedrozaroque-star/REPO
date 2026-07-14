/**
 * @module GeocodeStore
 * @description Geocodes an address to latitude and longitude coordinates.
 *              Tries Google Geocoding API first (if enabled), falls back to OpenStreetMap Nominatim.
 * @businessRules Must keep Google API keys secure on the backend.
 *                Must fall back gracefully to ensure high availability.
 * @dataFlow Takes address, city, state, zip as URL search params.
 *           Queries Google Maps Geocoding API or OpenStreetMap Nominatim.
 *           Returns { lat, lng, source, formatted_address, success }.
 */

import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const address = searchParams.get('address')
    const city = searchParams.get('city')
    const state = searchParams.get('state')
    const zip = searchParams.get('zip')

    if (!address && !city) {
      return NextResponse.json({ error: 'Missing address or city', success: false }, { status: 400 })
    }

    const query = `${address || ''} ${city || ''} ${state || ''} ${zip || ''}`.trim()

    // 1. Try Google Maps Geocoding first
    const googleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY
    if (googleKey) {
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${googleKey}`
        const googleRes = await fetch(googleUrl)
        if (googleRes.ok) {
          const googleData = await googleRes.json()
          if (googleData.status === 'OK' && googleData.results?.length > 0) {
            const loc = googleData.results[0].geometry.location
            return NextResponse.json({
              lat: loc.lat,
              lng: loc.lng,
              source: 'google',
              formatted_address: googleData.results[0].formatted_address,
              success: true
            })
          } else {
            console.warn('Google Geocoding failed or denied:', googleData.status, googleData.error_message)
          }
        }
      } catch (googleErr) {
        console.error('Error in Google Geocoding:', googleErr)
      }
    }

    // 2. Fallback to OpenStreetMap Nominatim
    console.log('Falling back to OpenStreetMap Nominatim geocoding...')
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
    const nominatimRes = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'TacosElGavilanPortal/1.0'
      }
    })

    if (nominatimRes.ok) {
      const nominatimData = await nominatimRes.json()
      if (nominatimData && nominatimData.length > 0) {
        const item = nominatimData[0]
        return NextResponse.json({
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          source: 'nominatim',
          formatted_address: item.display_name,
          success: true
        })
      }
    }

    return NextResponse.json({ error: 'Address not found', success: false }, { status: 404 })

  } catch (err: any) {
    console.error('Geocoding route exception:', err)
    return NextResponse.json({ error: err.message, success: false }, { status: 500 })
  }
}

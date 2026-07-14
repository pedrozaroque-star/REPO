/**
 * @module GetMapKey
 * @description Securely fetches and provides the Google Maps API key to the authorized frontend client.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || ''
  return NextResponse.json({ apiKey: key })
}

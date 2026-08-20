/**
 * @module api/stores/route
 * @description API endpoint to fetch active stores list with full location and coordinate details.
 * @businessRules
 * - Returns only active stores (`is_active = true`).
 * - Includes geographical coordinates (latitude, longitude) and physical address for map integrations.
 * @dataFlow Client GET request -> Supabase ('stores') -> Response JSON.
 */

import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, address, city, state, zip_code, latitude, longitude, external_id, has_drive_thru')
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

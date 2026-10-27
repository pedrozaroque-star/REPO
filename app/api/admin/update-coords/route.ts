/**
 * @module UpdateCoordsRoute
 * @description API route to update store coordinates in the database.
 * @businessRules
 * - Requires authenticated admin or supervisor session via verifyStaffAuth.
 * @dataFlow
 * - Request (storeId, lat, lon) -> Verify Auth -> Supabase stores update -> Response (success)
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'

export async function POST(request: Request) {
    const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'] })
    if (!auth.authorized) return auth.response!

    try {
        const { storeId, lat, lon } = await request.json()

        const supabase = await getSupabaseAdminClient()

        // Update store coordinates
        const { error } = await supabase
            .from('stores')
            .update({ latitude: lat, longitude: lon })
            .eq('id', storeId)

        if (error) {
            console.error('Error updating coords:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

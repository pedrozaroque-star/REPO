
import { getSupabaseAdminClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
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

import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET() {
    try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
            .from('stores')
            .select('id, name, external_id')
            .eq('is_active', true)
            .order('name')

        if (error) throw error

        return NextResponse.json(data)
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

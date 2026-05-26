import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const store_id = searchParams.get('store_id')

    if (!store_id) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })

    const { data, error } = await supabaseAdmin
        .from('station_templates')
        .select('*')
        .eq('store_id', store_id)
        .neq('template_name', '__CONFIG_ACTIVITIES__')
        .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
}

export async function POST(req: Request) {
    const body = await req.json()
    const { id, store_id, template_name, data } = body

    if (!store_id || !template_name || !data) {
        return NextResponse.json({ error: 'Missing logic data' }, { status: 400 })
    }

    const { data: result, error } = await supabaseAdmin
        .from('station_templates')
        .upsert({ 
            id: id || undefined, 
            store_id, 
            template_name, 
            data, 
            updated_at: new Date().toISOString() 
        })
        .select()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, template: result[0] })
}

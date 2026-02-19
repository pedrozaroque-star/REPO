import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const guid = searchParams.get('guid')

    if (!guid) {
        return NextResponse.json({ error: 'Missing guid' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value },
            },
        }
    )

    const { data, error } = await supabase
        .from('recipes')
        .select(`
            id,
            quantity,
            unit,
            inventory_item:inventory_items (
                id,
                name,
                unit_type,
                yield_percent,
                purchase_unit_cost,
                quantity_per_unit,
                unit_measure
            )
        `)
        .eq('toast_menu_item_guid', guid)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

export async function POST(request: Request) {
    const body = await request.json()
    const { toast_guid, ingredients } = body

    if (!toast_guid || !Array.isArray(ingredients)) {
        return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    // Use Admin Client for writes (bypassing RLS for now to ensure consistency)
    const supabase = await getSupabaseAdminClient()

    // 1. Delete existing recipe ingredients for this item
    const { error: deleteError } = await supabase
        .from('recipes')
        .delete()
        .eq('toast_menu_item_guid', toast_guid)

    if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    // 2. Insert new ingredients (if any)
    if (ingredients.length > 0) {
        const payload = ingredients.map((ing: any) => ({
            toast_menu_item_guid: toast_guid,
            inventory_item_id: ing.inventory_item_id,
            quantity: ing.quantity,
            unit: ing.unit
        }))

        const { error: insertError } = await supabase
            .from('recipes')
            .insert(payload)

        if (insertError) {
            return NextResponse.json({ error: insertError.message }, { status: 500 })
        }
    }

    return NextResponse.json({ success: true })
}

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET(request: Request) {
    const cookieStore = await cookies()

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value, ...options })
                    } catch (error) {
                        // The `set` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
                remove(name: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value: '', ...options })
                    } catch (error) {
                        // The `delete` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    )

    // Fetch items with categories
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select(`
            *,
            category:inventory_categories(name)
        `)
        .order('name', { ascending: true })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Also fetch categories for the dropdown
    const { data: categories } = await supabase
        .from('inventory_categories')
        .select('*')
        .order('name', { ascending: true })

    return NextResponse.json({ items, categories })
}

export async function POST(request: Request) {
    // Use Admin Client to bypass missing RLS insert policy for now
    const supabase = await getSupabaseAdminClient()
    const body = await request.json()

    // Validate
    if (!body.name || !body.unit_type || !body.category_id) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('inventory_items')
        .insert({
            name: body.name,
            sku: body.sku || null,
            unit_type: body.unit_type,
            quantity_per_unit: body.quantity_per_unit || 1,
            unit_measure: body.unit_measure || 'pza',
            category_id: body.category_id,
            purchase_unit_cost: body.cost || null,
            yield_percent: body.yield_percent || 100,
            alert_threshold: body.alert_threshold || null
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

export async function PUT(request: Request) {
    const supabase = await getSupabaseAdminClient()
    const body = await request.json()

    if (!body.id || !body.name || !body.unit_type || !body.category_id) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('inventory_items')
        .update({
            name: body.name,
            sku: body.sku || null,
            unit_type: body.unit_type,
            quantity_per_unit: body.quantity_per_unit || 1,
            unit_measure: body.unit_measure || 'pza',
            category_id: body.category_id,
            purchase_unit_cost: body.cost || null,
            yield_percent: body.yield_percent || 100,
            alert_threshold: body.alert_threshold || null
        })
        .eq('id', body.id)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

/**
 * @module api/inventory/recipes
 *
 * @description
 * API para leer y guardar recetas de platillos del menú de Toast.
 * Cada receta vincula un platillo (por su Toast GUID) con ingredientes del inventario,
 * especificando cantidades, unidades y tipo (food, raw, cooked, cogs_dine_in, etc.).
 *
 * @businessRules
 * - GET: Retorna los ingredientes de la receta para un GUID de Toast específico,
 *   incluyendo los datos del ingrediente (precio, qty_per_unit, yield, etc.).
 * - POST: Borra la receta anterior y reinserta los ingredientes nuevos.
 *   Si `recipe_na` es true, se marca el platillo como "sin receta" y se borran ingredientes.
 * - Al guardar una receta, se invalida la caché de food cost del día actual
 *   (`food_cost_daily_cache`) para que el dashboard muestre costos actualizados de inmediato.
 *
 * @dataFlow
 * - Lee de: `recipes`, `toast_menu_items`, `inventory_items`
 * - Escribe en: `recipes`, `toast_menu_items` (flag recipe_na)
 * - Invalida: `food_cost_daily_cache` (al hacer POST)
 *
 * @notes
 * - [2026-07-26] Agregada invalidación automática de food_cost_daily_cache al guardar receta.
 *   Antes de este cambio, editar una receta no se reflejaba en el dashboard hasta que el
 *   cron sync-food-cost recalculara (podía tomar hasta 12 horas).
 */
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

    // 1. Fetch Recipes
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select(`
            id,
            quantity,
            unit,
            type,
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

    // 2. Fetch Item Metadata (recipe_na)
    const { data: itemData } = await supabase
        .from('toast_menu_items')
        .select('recipe_na')
        .eq('guid', guid)
        .single()

    return NextResponse.json({
        recipes: recipes || [],
        meta: {
            recipe_na: itemData?.recipe_na || false
        }
    })
}

export async function POST(request: Request) {
    const body = await request.json()
    const { toast_guid, ingredients, recipe_na } = body

    if (!toast_guid || (!Array.isArray(ingredients) && !recipe_na)) {
        return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    // Use Admin Client for writes (bypassing RLS per user request for consistency)
    const supabase = await getSupabaseAdminClient()

    // 1. Update flag on toast_menu_items
    const { error: updateError } = await supabase
        .from('toast_menu_items')
        .update({ recipe_na: !!recipe_na })
        .eq('guid', toast_guid)

    if (updateError) {
        console.error('Error updating recipe_na flag:', updateError)
        return NextResponse.json({ error: `Update Failed: ${updateError.message}. (Database column 'recipe_na' likely missing)` }, { status: 500 })
    }

    // 2. Delete existing recipe ingredients for this item
    // (Even if N/A, we want to clear ingredients so double-entry doesn't happen)
    const { error: deleteError } = await supabase
        .from('recipes')
        .delete()
        .eq('toast_menu_item_guid', toast_guid)

    if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    // 3. Insert new ingredients (if any AND not N/A)
    // If recipe_na is true, we should probably ignore ingredients or ensure they are empty.
    // User might want to save N/A and clear ingredients.
    if (!recipe_na && ingredients && ingredients.length > 0) {
        const payload = ingredients.map((ing: any) => ({
            toast_menu_item_guid: toast_guid,
            inventory_item_id: ing.inventory_item_id,
            quantity: ing.quantity,
            unit: ing.unit,
            type: ing.type || 'food'
        }))

        const { error: insertError } = await supabase
            .from('recipes')
            .insert(payload)

        if (insertError) {
            return NextResponse.json({ error: insertError.message }, { status: 500 })
        }
    }

    // Invalidar caché de food cost del día actual para que el dashboard
    // muestre los costos actualizados inmediatamente después de editar una receta
    try {
        const today = new Date().toISOString().split('T')[0]
        await supabase.from('food_cost_daily_cache').delete().eq('business_date', today)
        console.log(`[Recipes] 🗑️ Caché de food cost invalidada para ${today} por edición de receta (guid: ${toast_guid})`)
    } catch (cacheErr: any) {
        console.error('[Recipes] ⚠️ Error invalidando caché de food cost:', cacheErr.message)
    }

    return NextResponse.json({ success: true })
}

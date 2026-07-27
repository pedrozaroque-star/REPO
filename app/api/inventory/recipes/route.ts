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
 * - **Validación de anomalías**: Al guardar, calcula costo teórico unitario y devuelve
 *   advertencias si: (a) un ingrediente individual cuesta >$15, (b) la receta pide 'pza'
 *   pero el inventario está en lb/gal (riesgo de cobrar bolsa completa), (c) costo total >$20.
 *
 * @dataFlow
 * - Lee de: `recipes`, `toast_menu_items`, `inventory_items`
 * - Escribe en: `recipes`, `toast_menu_items` (flag recipe_na)
 * - Invalida: `food_cost_daily_cache` (al hacer POST)
 *
 * @notes
 * - [2026-07-26] Agregada invalidación automática de food_cost_daily_cache al guardar receta.
 * - [2026-07-27] FIX: Bug de Milaneza — receta pedía 'pza' pero inventario estaba en 'lb',
 *   el motor cobraba la bolsa completa ($26.43) por 1 pieza. Food cost inflado 5 meses.
 *   Agregada validación automática post-save con 3 capas: costo unitario, unit mismatch,
 *   y costo total de receta.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { calculateIngredientCost } from '@/lib/inventory/recipe-calculations'

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
    // ============================================================
    // 3. Insert new ingredients + VALIDATE for anomalies
    // ============================================================
    const warnings: string[] = []

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

        // ============================================================
        // CAPA A: Validación post-save — detectar anomalías de costo
        // Previene bugs tipo Milaneza (FC 560% por 5 meses sin detectar)
        // ============================================================
        try {
            const itemIds = payload.map((p: any) => p.inventory_item_id)
            const { data: invItems } = await supabase
                .from('inventory_items')
                .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type, yield_percent')
                .in('id', itemIds)
            const invMap = new Map((invItems || []).map((i: any) => [i.id, i]))

            let totalRecipeCost = 0

            for (const ing of payload) {
                const inv = invMap.get(ing.inventory_item_id)
                if (!inv) continue

                const cost = calculateIngredientCost(
                    Number(ing.quantity) || 0,
                    ing.unit || '',
                    inv,
                    ing.type || 'cooked'
                )
                totalRecipeCost += cost

                // CAPA C: Detección de mismatch de unidades (pza vs lb/gal)
                const rUnit = (ing.unit || '').toLowerCase().trim()
                const iUnit = (inv.unit_measure || '').toLowerCase().trim()
                if ((rUnit === 'pza' || rUnit === 'unit') && iUnit !== 'pza' && iUnit !== 'unit') {
                    warnings.push(
                        `⚠️ UNIT MISMATCH: "${inv.name}" — recipe asks ${ing.quantity} ${ing.unit} but inventory is in ${inv.unit_measure}. ` +
                        `The system charges ${inv.quantity_per_unit} ${inv.unit_measure} per pza ($${cost.toFixed(2)}). ` +
                        `If this item is sold by piece, set unit_measure='pza' and quantity_per_unit=pieces_per_package in inventory.`
                    )
                }

                // CAPA A: Ingrediente individual demasiado caro
                if (cost > 15) {
                    warnings.push(
                        `🔴 HIGH COST INGREDIENT: "${inv.name}" costs $${cost.toFixed(2)} per serving (${ing.quantity} ${ing.unit}). Verify recipe quantity and inventory unit configuration.`
                    )
                }
            }

            // CAPA A: Costo total de receta demasiado alto
            if (totalRecipeCost > 20) {
                warnings.push(
                    `🔴 HIGH RECIPE COST: Total theoretical cost = $${totalRecipeCost.toFixed(2)} per unit. ` +
                    `This seems too high for a single menu item. Please verify ingredient quantities and unit configurations.`
                )
            }

            if (warnings.length > 0) {
                console.warn(`[Recipes] ⚠️ ANOMALIES DETECTED for guid ${toast_guid} (${warnings.length} warnings):`)
                warnings.forEach(w => console.warn(`  ${w}`))
            } else {
                console.log(`[Recipes] ✅ Recipe saved for ${toast_guid}: total cost $${totalRecipeCost.toFixed(2)} — no anomalies.`)
            }
        } catch (validationErr: any) {
            console.error('[Recipes] ⚠️ Validation error (non-blocking):', validationErr.message)
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

    return NextResponse.json({ success: true, warnings })
}

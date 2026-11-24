/**
 * @module app/api/inventory/items/route
 * @description API CRUD para el catálogo maestro de insumos de inventario (`inventory_items`) y sus categorías (`inventory_categories`).
 * @businessRules
 * - GET devuelve insumos ordenados alfabéticamente con su categoría asociada y el catálogo de categorías para selectores.
 * - POST/PUT persisten costos de compra (`purchase_unit_cost`), rendimiento (`yield_percent`), unidad base y bandera `is_bodega`.
 * @dataFlow
 * - UI Inventario / Food Cost / RecipeModal -> GET/POST/PUT `/api/inventory/items` -> `inventory_items` + `inventory_categories` (Supabase).
 * @notes
 * - 2026-11-19 (Paquete 2A): Reemplazado `select('*')` por columnas verificadas contra todos los consumidores (`app/inventory/items/page.tsx`, `app/admin/food-cost/meats/page.tsx`, `app/inventory/menu/components/RecipeModal.tsx`).
 * - 2026-11-23: Cambiado `Cache-Control` en GET a `no-store` para reflejar ediciones inmediatamente en UI, migrado GET a `getSupabaseAdminClient()` tras `verifyStaffAuth` (compatible con RLS endurecido), eliminado bug de coerción falsy de `0` en `cost`/`alert_threshold` y agregada validación estricta de `quantity_per_unit > 0` y `yield_percent` (`1..100`).
 */
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'

const INVENTORY_WRITE_ROLES = [
    'admin',
    'supervisor',
    'manager',
    'asistente',
    'assistant',
    'general_manager',
    'accounting',
    'contador',
]

const INVENTORY_ITEM_SELECT = `
    id,
    name,
    sku,
    category_id,
    unit_type,
    quantity_per_unit,
    unit_measure,
    purchase_unit_cost,
    yield_percent,
    alert_threshold,
    is_bodega,
    category:inventory_categories(name)
`

function parseAndValidateItemPayload(body: Record<string, any>) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const unitType = typeof body.unit_type === 'string' ? body.unit_type.trim() : ''
    const categoryId = typeof body.category_id === 'string' ? body.category_id.trim() : ''

    if (!name || !unitType || !categoryId) {
        return { error: 'Missing required fields' }
    }

    const rawCost = body.cost !== undefined ? body.cost : body.purchase_unit_cost
    const parsedCost =
        rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== ''
            ? Number(rawCost)
            : null
    if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
        return { error: 'Invalid cost: must be a non-negative number' }
    }

    const parsedQtyPerUnit =
        body.quantity_per_unit !== undefined &&
        body.quantity_per_unit !== null &&
        String(body.quantity_per_unit).trim() !== ''
            ? Number(body.quantity_per_unit)
            : 1
    if (!Number.isFinite(parsedQtyPerUnit) || parsedQtyPerUnit <= 0) {
        return { error: 'Invalid quantity_per_unit: must be greater than 0' }
    }

    const parsedYield =
        body.yield_percent !== undefined &&
        body.yield_percent !== null &&
        String(body.yield_percent).trim() !== ''
            ? Number(body.yield_percent)
            : 100
    if (!Number.isFinite(parsedYield) || parsedYield < 1 || parsedYield > 100) {
        return { error: 'Invalid yield_percent: must be between 1 and 100' }
    }

    const parsedThreshold =
        body.alert_threshold !== undefined &&
        body.alert_threshold !== null &&
        String(body.alert_threshold).trim() !== ''
            ? Number(body.alert_threshold)
            : null
    if (parsedThreshold !== null && (!Number.isFinite(parsedThreshold) || parsedThreshold < 0)) {
        return { error: 'Invalid alert_threshold: must be a non-negative number' }
    }

    const sku = typeof body.sku === 'string' && body.sku.trim() !== '' ? body.sku.trim() : null
    const unitMeasure =
        typeof body.unit_measure === 'string' && body.unit_measure.trim() !== ''
            ? body.unit_measure.trim()
            : 'pza'

    return {
        values: {
            name,
            sku,
            unit_type: unitType,
            quantity_per_unit: parsedQtyPerUnit,
            unit_measure: unitMeasure,
            category_id: categoryId,
            purchase_unit_cost: parsedCost,
            yield_percent: parsedYield,
            alert_threshold: parsedThreshold,
            is_bodega: Boolean(body.is_bodega),
        },
    }
}

export async function GET(request: Request) {
    const auth = verifyStaffAuth(request, { allowCron: true })
    if (!auth.authorized) return auth.response!

    const supabase = await getSupabaseAdminClient()

    // Fetch items with categories (explicit slim projection verified against all UI callers)
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select(INVENTORY_ITEM_SELECT)
        .order('name', { ascending: true })
        .limit(5000)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Also fetch categories for the dropdown
    const { data: categories } = await supabase
        .from('inventory_categories')
        .select('id, name')
        .order('name', { ascending: true })

    return NextResponse.json(
        { items, categories },
        {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        }
    )
}

export async function POST(request: Request) {
    const auth = verifyStaffAuth(request, { allowedRoles: INVENTORY_WRITE_ROLES, allowCron: true })
    if (!auth.authorized) return auth.response!

    const supabase = await getSupabaseAdminClient()
    const body = await request.json()

    const parsed = parseAndValidateItemPayload(body)
    if (parsed.error || !parsed.values) {
        return NextResponse.json({ error: parsed.error || 'Invalid payload' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('inventory_items')
        .insert(parsed.values)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

export async function PUT(request: Request) {
    const auth = verifyStaffAuth(request, { allowedRoles: INVENTORY_WRITE_ROLES, allowCron: true })
    if (!auth.authorized) return auth.response!

    const supabase = await getSupabaseAdminClient()
    const body = await request.json()

    if (!body.id) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const parsed = parseAndValidateItemPayload(body)
    if (parsed.error || !parsed.values) {
        return NextResponse.json({ error: parsed.error || 'Invalid payload' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('inventory_items')
        .update({
            ...parsed.values,
            updated_at: new Date().toISOString(),
        })
        .eq('id', body.id)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

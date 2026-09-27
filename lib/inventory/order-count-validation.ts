/**
 * @module inventory/order-count-validation
 * @description Verifica que todos los artículos de Orden Diaria tengan sobrante físico capturado para la fecha.
 * @businessRules Cero es un conteo válido; ausencia o valor no numérico bloquea guardar y enviar la orden.
 * @dataFlow store_order_template/inventory_items + inventory_counts → lista de artículos sin conteo.
 * @notes Valida en servidor contra DB para evitar que una pantalla desactualizada envíe una orden parcial.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const DESSERT_IDS = [
    'f8f776c5-3b8c-453e-8161-b49840823933',
    '8ba55664-5ca9-4886-8ac8-acf1fd070713'
]

export async function getMissingDailyCounts(db: SupabaseClient, storeId: string | number, date: string) {
    const { data: template, error: templateError } = await db.from('store_order_template')
        .select('inventory_item_id, inventory_items:inventory_item_id(name)')
        .eq('store_id', storeId).eq('order_type', 'daily')
    if (templateError) throw templateError

    const required = new Map<string, string>()
    if (template?.length) {
        for (const row of template) {
            const item = row.inventory_items as unknown as { name: string } | null
            if (row.inventory_item_id) required.set(row.inventory_item_id, item?.name || row.inventory_item_id)
        }
    } else {
        const { data: fallback, error } = await db.from('inventory_items')
            .select('id,name').not('excel_reference', 'is', null)
        if (error) throw error
        for (const item of fallback || []) required.set(item.id, item.name)
    }
    const { data: desserts, error: dessertError } = await db.from('inventory_items')
        .select('id,name').in('id', DESSERT_IDS)
    if (dessertError) throw dessertError
    for (const item of desserts || []) required.set(item.id, item.name)

    const ids = [...required.keys()]
    if (!ids.length) throw new Error('No hay artículos configurados para Orden Diaria.')
    const { data: counts, error: countError } = await db.from('inventory_counts')
        .select('inventory_item_id,quantity_on_hand')
        .eq('store_id', String(storeId)).eq('count_date', date)
        .in('inventory_item_id', ids)
    if (countError) throw countError
    const captured = new Set((counts || [])
        .filter(row => row.quantity_on_hand !== null && row.quantity_on_hand !== undefined && Number.isFinite(Number(row.quantity_on_hand)) && Number(row.quantity_on_hand) >= 0)
        .map(row => row.inventory_item_id))
    return ids.filter(id => !captured.has(id)).map(id => ({ id, name: required.get(id)! }))
}

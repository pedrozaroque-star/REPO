/**
 * @module scripts/verify-order-count-gate
 * @description Simula con conteos reales de Lynwood el bloqueo de una Orden Diaria incompleta.
 * @businessRules Conteo físico cero es válido; la ausencia de un artículo requerido impide el pedido.
 * @dataFlow Supabase store_order_template/inventory_counts → getMissingDailyCounts → aserciones.
 * @notes Solo lectura; no genera pedidos ni toca QuickBooks.
 */
import dotenv from 'dotenv'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { getMissingDailyCounts } from '../lib/inventory/order-count-validation'

async function main() {
    dotenv.config({ path: '.env.local', quiet: true })
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    assert(url && key, 'Faltan credenciales de Supabase')
    const db = createClient(url, key, { auth: { persistSession: false } })
    const store = 14
    const day = '2026-09-21'
    const missing = await getMissingDailyCounts(db, store, day)
    const { data: template, error: templateError } = await db.from('store_order_template')
        .select('inventory_item_id').eq('store_id', store).eq('order_type', 'daily')
    if (templateError) throw templateError
    assert(template && template.length > 0)
    const ids = template.map(t => t.inventory_item_id)
    const { data: counts, error: countError } = await db.from('inventory_counts')
        .select('inventory_item_id,quantity_on_hand').eq('store_id', String(store))
        .eq('count_date', day).in('inventory_item_id', ids)
    if (countError) throw countError
    const zeroIds = (counts || []).filter(c => Number(c.quantity_on_hand) === 0).map(c => c.inventory_item_id)
    assert(zeroIds.length > 0, 'La fecha de prueba necesita al menos un conteo cero real')
    for (const id of zeroIds) assert(!missing.some(m => m.id === id), `El cero capturado fue marcado como faltante: ${id}`)
    const absentIds = ids.filter(id => !(counts || []).some(c => c.inventory_item_id === id))
    for (const id of absentIds) assert(missing.some(m => m.id === id), `Falta un SKU sin captura: ${id}`)
    const impossibleDateMissing = await getMissingDailyCounts(db, store, '1900-01-01')
    assert(impossibleDateMissing.length >= ids.length, 'Una fecha sin conteos debe quedar bloqueada')
    console.log(JSON.stringify({ store, day, templateItems: ids.length, captured: counts?.length, capturedZeros: zeroIds.length, missing: missing.length, emptyDateMissing: impossibleDateMissing.length, result: 'PASS' }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

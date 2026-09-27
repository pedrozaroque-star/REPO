/**
 * @module scripts/probe-lynwood-virtual-stock
 * @description Diagnostica fuentes para calcular sobrantes automáticos sin conteo diario en Lynwood.
 * @businessRules Existencia virtual = último conteo confiable + pedidos recibidos - consumo teórico; no afirmar que sea inventario físico.
 * @dataFlow inventory_counts + inventory_orders/lines + inventory_usage_log → cobertura por SKU y fecha.
 * @notes Solo lectura. El día 22 de septiembre se excluye del piloto por instrucción del usuario.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const items = [
    { id: '90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb', name: 'Mixta bolsitas' },
    { id: 'ea165e4e-d939-49a8-af9a-7bc186f50e2e', name: 'Mixta granel' },
    { id: 'f73fe7a6-105c-4624-a87b-07d5f78c09ea', name: 'Lima bolsitas' },
    { id: '0c1f780a-1166-44fd-aa51-879173fa0861', name: 'Lima granel' },
    { id: 'b4e7349c-669a-42e6-9810-ec3a7673b3f2', name: 'Rajas bolsitas' },
    { id: 'd56d8df8-d30c-4964-a425-9aa25d962364', name: 'Rajas granel' }
]
async function main() {
    const { data: store, error: storeError } = await db.from('stores').select('id,name,external_id').eq('id', 14).single()
    if (storeError) throw storeError
    const usageStoreId = String(store.external_id)
    const { count: allUsageRows, error: allUsageError } = await db.from('inventory_usage_log')
        .select('inventory_item_id', { count: 'exact', head: true }).eq('store_id', usageStoreId)
        .gte('business_date', '2026-09-19').lte('business_date', '2026-09-24')
    if (allUsageError) throw allUsageError
    const { data: latestUsage, error: latestUsageError } = await db.from('inventory_usage_log')
        .select('business_date,inventory_item_id').eq('store_id', usageStoreId)
        .order('business_date', { ascending: false }).limit(1)
    if (latestUsageError) throw latestUsageError
    const { count: numericUsageRows, error: numericUsageError } = await db.from('inventory_usage_log')
        .select('inventory_item_id', { count: 'exact', head: true }).eq('store_id', '14')
        .gte('business_date', '2026-09-19').lte('business_date', '2026-09-24')
    if (numericUsageError) throw numericUsageError
    const { data: latestNumericUsage, error: latestNumericError } = await db.from('inventory_usage_log')
        .select('business_date,inventory_item_id').eq('store_id', '14')
        .order('business_date', { ascending: false }).limit(1)
    if (latestNumericError) throw latestNumericError
    const ids = items.map(i => i.id)
    const [counts, usage, orders] = await Promise.all([
        db.from('inventory_counts').select('inventory_item_id,count_date,quantity_on_hand').eq('store_id', '14').in('inventory_item_id', ids).gte('count_date', '2026-09-19').lte('count_date', '2026-09-24'),
        db.from('inventory_usage_log').select('inventory_item_id,business_date,theoretical_usage').eq('store_id', usageStoreId).in('inventory_item_id', ids).gte('business_date', '2026-09-19').lte('business_date', '2026-09-24'),
        db.from('inventory_orders').select('order_date,status,inventory_order_lines(inventory_item_id,final_qty)').eq('store_id', 14).eq('order_type', 'daily').gte('order_date', '2026-09-19').lte('order_date', '2026-09-24')
    ])
    for (const result of [counts, usage, orders]) if (result.error) throw result.error
    console.log(JSON.stringify({ store: store.name, externalUsageStoreId: usageStoreId, externalUsageRows: allUsageRows, externalLatestUsageDate: latestUsage?.[0]?.business_date || null, numericUsageStoreId: '14', numericUsageRows, numericLatestUsageDate: latestNumericUsage?.[0]?.business_date || null, selectedSkuUsageRows: usage.data?.length }))
    for (const day of ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-23', '2026-09-24']) {
        const order = orders.data?.find(o => o.order_date === day)
        console.log(JSON.stringify({ day, orderStatus: order?.status || null, skus: items.map(item => ({
            item: item.name,
            count: counts.data?.find(c => c.count_date === day && c.inventory_item_id === item.id)?.quantity_on_hand ?? null,
            usage: usage.data?.find(u => u.business_date === day && u.inventory_item_id === item.id)?.theoretical_usage ?? null,
            ordered: order?.inventory_order_lines?.find(l => l.inventory_item_id === item.id)?.final_qty ?? null
        })) }))
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

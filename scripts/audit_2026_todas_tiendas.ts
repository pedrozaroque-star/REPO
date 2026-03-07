import { getSupabaseClient } from '../lib/supabase'

async function runAudit() {
    const supabase = await getSupabaseClient()

    console.log("=== INICIANDO AUDITORIA DE BASE DE DATOS (01 ENE 2026 - 06 MAR 2026) ===")

    // 1. Get all active stores
    const { data: stores, error: storesError } = await supabase
        .from('stores')
        .select('external_id, name')
        .eq('is_active', true)
        .order('name')

    if (storesError || !stores) {
        console.error("Error fetching stores:", storesError)
        return
    }

    console.log(`Encontradas ${stores.length} tiendas activas. Revisando registros...\n`)

    const startDate = new Date('2026-01-01')
    const endDate = new Date('2026-03-06')

    // Generate array of expected dates
    const expectedDates: string[] = []
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        expectedDates.push(d.toISOString().split('T')[0])
    }

    const { data: allSales, error: salesError } = await supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, net_sales')
        .gte('business_date', '2026-01-01')
        .lte('business_date', '2026-03-06')

    if (salesError) {
        console.error("Error fetching sales data:", salesError)
        return
    }

    const report: any[] = []

    for (const store of stores) {
        // Find sales for this store
        const storeSales = allSales?.filter(s => s.store_id === store.external_id) || []

        let missingDates: string[] = []
        let zeroSalesDates: string[] = []

        for (const targetDateStr of expectedDates) {
            const saleRecord = storeSales.find(s => s.business_date === targetDateStr)
            if (!saleRecord) {
                missingDates.push(targetDateStr)
            } else if (saleRecord.net_sales <= 0) {
                zeroSalesDates.push(targetDateStr)
            }
        }

        report.push({
            storeName: store.name,
            totalExpected: expectedDates.length,
            totalFound: storeSales.length,
            missingCount: missingDates.length,
            zeroSalesCount: zeroSalesDates.length,
            missingExample: missingDates.slice(0, 3).join(', ') + (missingDates.length > 3 ? '...' : ''),
            zeroExample: zeroSalesDates.slice(0, 3).join(', ') + (zeroSalesDates.length > 3 ? '...' : '')
        })
    }

    console.table(report)

    console.log("\n✅ Auditoría Completa. Revisa la tabla superior para ver qué tiendas tienen días faltantes o ventas en $0.")
}

runAudit()

import { getProductMix } from '../lib/toast-pmix'

async function debugPmix() {
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
    // The user mentioned February 12, 2026.
    const startDate = '2026-02-12'
    const endDate = '2026-02-12'

    console.log(`Analyzing PMIX for ${startDate}...`)
    try {
        const items = await getProductMix({ storeId, startDate, endDate })

        const totalNet = items.reduce((sum, i) => sum + i.net_sales, 0)
        const totalGross = items.reduce((sum, i) => sum + i.gross_sales, 0)

        console.log(`Total Net Sales: $${totalNet.toFixed(2)}`)
        console.log(`Total Gross Sales: $${totalGross.toFixed(2)}`)

        // Top 20 items by Net Sales
        console.log('\nTop 20 Items by Net Sales:')
        items.sort((a, b) => b.net_sales - a.net_sales)
            .slice(0, 20)
            .forEach(i => console.log(`${i.name}: $${i.net_sales.toFixed(2)} (Qty: ${i.quantity})`))

        const negatives = items.filter(i => i.net_sales < 0)
        if (negatives.length > 0) {
            console.log('\n--- NEGATIVE ITEMS (Refunds/Adjustments) ---')
            negatives.forEach(i => console.log(`${i.name}: $${i.net_sales.toFixed(2)}`))
        }

        // Check specifically for problematic types
        console.log('\nChecking for potential non-sales items:')
        const suspected = items.filter(i =>
            i.name.toLowerCase().includes('gift') ||
            i.name.toLowerCase().includes('card') ||
            i.name.toLowerCase().includes('deposit') ||
            i.name.toLowerCase().includes('open') ||
            i.name.toLowerCase().includes('charge') ||
            i.name.toLowerCase().includes('propina') ||
            i.name.toLowerCase().includes('tip')
        )
        suspected.forEach(i => console.log(`[SUSPECT] ${i.name}: $${i.net_sales.toFixed(2)}`))

    } catch (e: any) {
        console.error("Error:", e.message)
    }
}

debugPmix()

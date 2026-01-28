
import dotenv from 'dotenv'
import path from 'path'

// load env BEFORE importing app code
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function test() {
    // Dynamic import to ensure env vars are ready
    const { generateSmartForecast } = await import('@/lib/intelligence')

    const LYNWOOD_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

    console.log('🔮 Testing Smart Forecast Algorithm...')

    // Test for Next Friday (Assuming higher volume)
    // Let's pick a fixed date: Feb 6, 2026 (Friday)
    const futureDate = '2026-02-06'

    const result = await generateSmartForecast(LYNWOOD_ID, futureDate)

    console.log(`\n📅 FORECAST FOR: ${result.date} (Store: Lynwood)`)
    console.log(`💰 Total Projected Sales: $${result.total_sales.toFixed(2)} (Growth Applied: ${result.growth_factor_applied}x)`)

    console.log('\n--- HOURLY STAFFING GUIDE ---')
    console.log('Hour | Proj $$$ | Proj Tix | SUGGEST CASHIERS | SUGGEST KITCHEN')
    console.log('---------------------------------------------------------------')

    result.hours.forEach(h => {
        // Only show operating hours (9am to 11pm roughly)
        if (h.sales_projected > 10 || h.tickets_projected > 0) {
            const time = h.hour.toString().padStart(2, '0') + ':00'
            const sales = `$${h.sales_projected.toFixed(0)}`.padStart(8)
            const tix = `${h.tickets_projected.toFixed(0)} tix`.padStart(7)
            const cash = `${h.required_cashiers}`.padStart(16)
            const kitch = `${h.required_kitchen}`.padStart(15)

            console.log(`${time} | ${sales} | ${tix} | ${cash} | ${kitch}`)
        }
    })

    console.log('\n✅ Rules Logic:')
    console.log(`   - 1 Cashier per 18.3 tickets (Min 1)`)
    console.log(`   - 1 Kitchen per $211 sales (Min 2)`)
}

test()

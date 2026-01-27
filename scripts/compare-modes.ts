
import { fetchToastData } from '@/lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function compareModes() {
    // Hardcoded for Lynwood on Jan 27 2026
    const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
    const DATE = '2026-01-27'

    console.log(`🔍 Comparing Modes for Store ${STORE_ID} on ${DATE}`)

    // 1. Run FULL MODE (The "Truth")
    console.log('\n🐢 Running FULL MODE...')
    const fullRes = await fetchToastData({
        storeIds: STORE_ID,
        startDate: DATE,
        endDate: DATE,
        groupBy: 'day',
        fastMode: false,
        skipCache: true
    })

    if (fullRes.rows.length === 0) {
        console.log('❌ No data returned for Full Mode')
        return
    }
    const fullRow = fullRes.rows[0]
    console.log(`✅ FULL Total: $${fullRow.netSales}`)
    console.log(`   (Gross: ${fullRow.grossSales}, Disc: ${fullRow.discounts}, Refunds via logic?)`)
    console.log(`   (Service Charges Detected: ${fullRow.serviceCharges})`)


    // 2. Run FAST MODE
    console.log('\n🐇 Running FAST MODE...')
    const fastRes = await fetchToastData({
        storeIds: STORE_ID,
        startDate: DATE,
        endDate: DATE,
        groupBy: 'day',
        fastMode: true,
        skipCache: true
    })

    if (fastRes.rows.length === 0) {
        console.log('❌ No data returned for Fast Mode')
        return
    }
    const fastRow = fastRes.rows[0]
    console.log(`✅ FAST Total: $${fastRow.netSales}`)

    // 3. Compare
    const diff = fullRow.netSales - fastRow.netSales
    console.log(`\n⚖️ DIFFERENCE (Full - Fast): $${diff.toFixed(2)}`)

    if (Math.abs(diff) > 0.01) {
        console.log('⚠️ MISMATCH DETECTED!')
        console.log('Lets analyze what component matches the diff...')
        console.log(`Maybe Service Charges? Full SC: ${fullRow.serviceCharges}, Fast SC: ${fastRow.serviceCharges}`)
        console.log(`Maybe Tips? Full Tips: ${fullRow.tips}, Fast Tips: ${fastRow.tips}`)
        console.log(`Maybe Tax? Full Tax: ${fullRow.taxes}, Fast Tax: ${fastRow.taxes}`)
    } else {
        console.log('✨ Data Matches!')
    }
}

compareModes()

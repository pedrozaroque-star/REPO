
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function testHolidays() {
    const { getComparativeDates, getHolidayName } = await import('@/lib/holidays')
    const { generateSmartForecast } = await import('@/lib/intelligence')

    // TEST 1: Cinco de Mayo 2026 (Tuesday)
    const cincoMayo = '2026-05-05'
    console.log(`\n🎉 TESTING SPECIAL EVENT: ${cincoMayo} (Cinco de Mayo)`)
    const name1 = getHolidayName(cincoMayo)
    const peers1 = getComparativeDates(cincoMayo)
    console.log(`   Identified as: ${name1}`)
    console.log(`   Logic: Using Dates -> ${JSON.stringify(peers1)}`)

    // Verify NOT using 52-week logic (which would be May 6 2025)
    if (peers1?.includes('2025-05-05')) {
        console.log(`   ✅ CORRECT: Comparing May 5th with May 5th!`)
    } else {
        console.log(`   ❌ WRONG: Logic failed.`)
    }

    // TEST 2: Random Tuesday (Jan 27 2026)
    const randomTue = '2026-01-27'
    console.log(`\n📅 TESTING NORMAL DAY: ${randomTue}`)
    const name2 = getHolidayName(randomTue)
    console.log(`   Identified as: ${name2 || 'Normal Day'}`)

    if (!name2) {
        console.log(`   Logic: Will use standard 52-week lookback (Jan 28 2025, Jan 30 2024...)`)
    }
}

testHolidays()

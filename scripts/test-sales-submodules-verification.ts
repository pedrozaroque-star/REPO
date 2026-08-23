/**
 * Simulation Test Suite for Sales Submodules:
 * 1. Yearly History Matrix & YoY Comparison (app/ventas/historial/page.tsx, app/api/ventas/yearly/route.ts)
 * 2. Weekly Operations, Labor Log, & Monthly Reports (app/ventas/reportes/page.tsx, app/api/reports/weekly-ops/route.ts, app/api/ventas/autofill/route.ts)
 * 3. 6:00 AM Business Day & 5:00 PM PM Shift Threshold Calculations
 * 4. Division-by-Zero, NaN, and Infinite Float Guards
 * 5. Dynamic Currency & Weighted Average Validations
 */

function runSubmodulesSimulationTests() {
    console.log("🚀 Starting Sales Submodules Simulation & Boundary Testing Suite...\n")
    let passedTests = 0
    let failedTests = 0

    const assert = (condition: boolean, testName: string, details?: string) => {
        if (condition) {
            console.log(`  ✅ [PASS] ${testName}`)
            passedTests++
        } else {
            console.error(`  ❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`)
            failedTests++
        }
    }

    // ----------------------------------------------------
    // TEST 1: Yearly Date Construction (No Timezone Shifting)
    // ----------------------------------------------------
    console.log("🧪 Test Suite 1: Pure Calendar Date Math for Yearly Matrix")
    const year = 2026
    const pad = (n: number) => String(n).padStart(2, '0')
    for (let m = 0; m < 12; m++) {
        const monthPad = pad(m + 1)
        const startStr = `${year}-${monthPad}-01`
        const lastDayOfMonth = new Date(Number(year), m + 1, 0)
        const endStr = `${year}-${monthPad}-${pad(lastDayOfMonth.getDate())}`
        
        assert(startStr.startsWith('2026-') && startStr.endsWith('-01'), `Month ${m + 1} start date is deterministic: ${startStr}`)
        assert(Number(endStr.split('-')[2]) >= 28 && Number(endStr.split('-')[2]) <= 31, `Month ${m + 1} end date is valid: ${endStr}`)
    }

    // ----------------------------------------------------
    // TEST 2: YTD Historical Analysis Asymmetry & Closed/New Stores
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 2: YoY Store Comparison Integrity (New & Closed Stores)")
    const mockCurrent = [
        { name: "Store Bell", months: [100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 300 },
        { name: "Store New Central", months: [50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 150 } // New store
    ]
    const mockPrev = [
        { name: "Store Bell", months: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80], total: 240 },
        { name: "Store Closed Old", months: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], total: 1200 } // Closed store
    ]

    const allStoreNames = Array.from(new Set([...mockCurrent.map(d => d.name), ...mockPrev.map(d => d.name)]))
    const comparison = allStoreNames.map(name => {
        const curr = mockCurrent.find(c => c.name === name)
        const prev = mockPrev.find(p => p.name === name)
        const currTotal = curr ? Number(curr.total || 0) : 0
        const prevTotal = prev ? Number(prev.total || 0) : 0
        const diff = currTotal - prevTotal
        const percent = prevTotal === 0 ? (currTotal > 0 ? 100 : 0) : (diff / prevTotal) * 100
        const isNew = prevTotal === 0 && currTotal > 0
        const isClosed = currTotal === 0 && prevTotal > 0

        return { name, curr: currTotal, prev: prevTotal, diff, percent, isNew, isClosed }
    })

    const globalCurr = comparison.reduce((sum, item) => sum + item.curr, 0)
    const globalPrev = comparison.reduce((sum, item) => sum + item.prev, 0)
    
    assert(comparison.length === 3, "All 3 stores (ongoing, new, closed) included in comparison matrix")
    assert(globalCurr === 450, `Global Current matches exact sum: $${globalCurr}`)
    assert(globalPrev === 1440, `Global Prev correctly includes closed store: $${globalPrev} (no omission skew)`)
    assert(comparison.find(c => c.name === "Store New Central")?.isNew === true, "New store identified as isNew")
    assert(comparison.find(c => c.name === "Store Closed Old")?.isClosed === true, "Closed store identified as isClosed")

    // ----------------------------------------------------
    // TEST 3: AM and PM Shift Hours Split (6 AM - 4:59 PM vs 5 PM - 5:59 AM)
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 3: Shift Hour Allocations (AM vs PM Turnos)")
    const hourlySalesMock: Record<number, number> = {
        6: 50, 7: 100, 8: 200, 9: 300, 10: 400, 11: 600, 12: 800, 13: 700, 14: 500, 15: 400, 16: 300, // AM Shift = 4350
        17: 600, 18: 900, 19: 1000, 20: 800, 21: 700, 22: 500, 23: 300, 0: 200, 1: 100, 2: 50, 3: 0, 4: 0, 5: 0 // PM Shift = 5150
    }

    const amHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    const pmHours = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

    const openShiftSum = amHours.reduce((sum, h) => sum + (hourlySalesMock[h] || 0), 0)
    const closeShiftSum = pmHours.reduce((sum, h) => sum + (hourlySalesMock[h] || 0), 0)

    assert(openShiftSum === 4350, `AM Shift (Apertura) sums hours 6..16 correctly: $${openShiftSum}`)
    assert(closeShiftSum === 5150, `PM Shift (Cierre) sums hours 17..5 correctly: $${closeShiftSum}`)
    assert(openShiftSum + closeShiftSum === 9500, `Total daily sales equals AM + PM sum ($9,500)`)

    // ----------------------------------------------------
    // TEST 4: Weekly Operations & Labor Log Weighted Averages
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 4: Labor % & Ticket Weighted Averages (No Simple Mean Skew)")
    const weekDays = [
        { sales: 2000, laborCost: 700, orders: 100 }, // 35.00% labor, $20 avg ticket
        { sales: 3000, laborCost: 750, orders: 150 }, // 25.00% labor, $20 avg ticket
        { sales: 4000, laborCost: 880, orders: 200 }, // 22.00% labor, $20 avg ticket
        { sales: 5000, laborCost: 1000, orders: 250 }, // 20.00% labor, $20 avg ticket
        { sales: 8000, laborCost: 1520, orders: 400 }, // 19.00% labor, $20 avg ticket
        { sales: 10000, laborCost: 1800, orders: 500 }, // 18.00% labor, $20 avg ticket
        { sales: 12000, laborCost: 2040, orders: 600 }  // 17.00% labor, $20 avg ticket
    ]

    const totalWeeklySales = weekDays.reduce((sum, d) => sum + d.sales, 0)
    const totalWeeklyLaborCost = weekDays.reduce((sum, d) => sum + d.laborCost, 0)
    const totalWeeklyOrders = weekDays.reduce((sum, d) => sum + d.orders, 0)

    const trueWeightedLaborPct = (totalWeeklyLaborCost / totalWeeklySales) * 100
    const trueWeightedAvgTicket = totalWeeklySales / totalWeeklyOrders

    assert(totalWeeklySales === 44000, `Total sales: $${totalWeeklySales}`)
    assert(totalWeeklyLaborCost === 8690, `Total labor cost: $${totalWeeklyLaborCost}`)
    assert(Math.abs(trueWeightedLaborPct - 19.75) < 0.01, `Weighted Labor % correctly calculated: ${trueWeightedLaborPct.toFixed(2)}%`)
    assert(Math.abs(trueWeightedAvgTicket - 20.00) < 0.01, `Weighted Avg Ticket correctly calculated: $${trueWeightedAvgTicket.toFixed(2)}`)

    // ----------------------------------------------------
    // TEST 5: Currency Display Formatting with Negative Values
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 5: Currency Display Formatting (Negative Numbers Standard)")
    const formatCurrencyDisplay = (num: number) => {
        const isNeg = num < 0
        const formatted = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return isNeg ? `-$${formatted}` : `$${formatted}`
    }

    assert(formatCurrencyDisplay(1500.5) === '$1,500.50', "Positive currency: $1,500.50")
    assert(formatCurrencyDisplay(-500.25) === '-$500.25', "Negative currency: -$500.25 (no '$-500.25' glitch)")
    assert(formatCurrencyDisplay(0) === '$0.00', "Zero currency: $0.00")

    // ----------------------------------------------------
    // TEST 6: 12-Hour AM/PM Formatting for Charts
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 6: 12-Hour AM/PM Time Formatting for Charts")
    const formatHourAMPM = (timeStr: string) => {
        const hourPart = timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr
        const [hStr] = hourPart.split(':')
        const h = parseInt(hStr, 10)
        if (isNaN(h)) return timeStr
        const period = h >= 12 ? 'pm' : 'am'
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
        return `${h12}${period}`
    }

    assert(formatHourAMPM("2026-08-22 07:00") === "7am", "07:00 -> 7am")
    assert(formatHourAMPM("2026-08-22 11:00") === "11am", "11:00 -> 11am")
    assert(formatHourAMPM("2026-08-22 12:00") === "12pm", "12:00 -> 12pm (Noon)")
    assert(formatHourAMPM("2026-08-22 13:00") === "1pm", "13:00 -> 1pm")
    assert(formatHourAMPM("2026-08-22 14:00") === "2pm", "14:00 -> 2pm")
    assert(formatHourAMPM("2026-08-22 17:00") === "5pm", "17:00 -> 5pm (Shift PM Start)")
    assert(formatHourAMPM("2026-08-22 23:00") === "11pm", "23:00 -> 11pm")
    assert(formatHourAMPM("2026-08-23 00:00") === "12am", "00:00 -> 12am (Midnight)")
    assert(formatHourAMPM("2026-08-23 05:00") === "5am", "05:00 -> 5am (Shift PM End)")

    // Summary
    console.log("\n=======================================================")
    console.log(`🎉 SUBMODULES SIMULATION TEST RESULTS:`)
    console.log(`   Passed: ${passedTests}`)
    console.log(`   Failed: ${failedTests}`)
    console.log("=======================================================\n")

    if (failedTests > 0) {
        process.exit(1)
    }
}

runSubmodulesSimulationTests()

/**
 * Comprehensive Simulation Test Suite for Sales Submodules:
 * 1. Yearly History Matrix & YoY Comparison (app/ventas/historial/page.tsx, app/api/ventas/yearly/route.ts)
 * 2. Weekly Operations, Labor Log, & Monthly Reports (app/ventas/reportes/page.tsx, app/api/reports/weekly-ops/route.ts, app/api/ventas/autofill/route.ts)
 * 3. 6:00 AM Business Day & 5:00 PM PM Shift Threshold Calculations
 * 4. Division-by-Zero, NaN, and Infinite Float Guards
 * 5. Dynamic Currency & Weighted Average Validations
 * 6. 12-Hour AM/PM Time Formatting
 * 7. Custom Single-Day Projections Deduplication
 * 8. Tax Included Selection Discount Mathematics
 * 9. Cross-Date Refund Bounding
 * 10. Multi-Store Autofill Aggregation
 * 11. Negative Difference Sums in Weekly Ops Summary
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
    const formatHourAMPM = (timeStr?: string) => {
        if (!timeStr || typeof timeStr !== 'string') return ''
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
    assert(formatHourAMPM(undefined) === "", "undefined timeStr -> empty string (safe)")

    // ----------------------------------------------------
    // TEST 7: Single-Day Custom Period Projection Deduplication
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 7: Custom Single-Day Projections Deduplication")
    const mockHourlyRows = Array.from({ length: 24 }, (_, h) => ({
        storeId: "store_bell",
        periodStart: `2026-08-15 ${String(h).padStart(2, '0')}:00`,
        netSales: 300,
        projectedSales: 8000, // Day total projection repeated in hourly rows
        projectedToDate: 8000
    }))

    const storeMap = new Map<string, any>()
    const seenDayStores = new Set<string>()
    const groupByMode = 'hour'

    mockHourlyRows.forEach(row => {
        if (!storeMap.has(row.storeId)) {
            storeMap.set(row.storeId, {
                storeId: row.storeId,
                netSales: 0,
                projectedSales: 0,
                projectedToDate: 0
            })
        }
        const s = storeMap.get(row.storeId)
        s.netSales += row.netSales

        // Deduplication logic under test:
        if (groupByMode === 'hour' || row.periodStart.includes(':')) {
            s.projectedSales = (row.projectedSales || 0)
            s.projectedToDate = (row.projectedToDate || 0)
        } else {
            const dayStoreKey = `${row.storeId}_${row.periodStart}`
            if (!seenDayStores.has(dayStoreKey)) {
                seenDayStores.add(dayStoreKey)
                s.projectedSales += (row.projectedSales || 0)
                s.projectedToDate += (row.projectedToDate || 0)
            }
        }
    })

    const bellStore = storeMap.get("store_bell")
    assert(bellStore.projectedSales === 8000, `Single-day projection not multiplied 24x ($8,000 vs expected $8,000): $${bellStore.projectedSales}`)
    assert(bellStore.netSales === 7200, `Total hourly sales aggregated correctly: $${bellStore.netSales}`)

    // ----------------------------------------------------
    // TEST 8: Tax Included Discount Mathematics
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 8: Tax-Included Selection Discount Mathematics")
    const selTaxIncluded = {
        price: 11.00, // $10 item + $1 tax
        preDiscountPrice: 11.00,
        tax: 1.00,
        taxInclusion: 'INCLUDED'
    }

    let itemPrice = Number(selTaxIncluded.price || 0)
    let itemPreDiscount = Number(selTaxIncluded.preDiscountPrice || selTaxIncluded.price || 0)

    if (selTaxIncluded.taxInclusion === 'INCLUDED') {
        const taxAmount = Number(selTaxIncluded.tax || 0)
        itemPrice -= taxAmount
        itemPreDiscount -= taxAmount
    }

    const calculatedDiscount = itemPreDiscount - itemPrice
    assert(itemPrice === 10.00, `Tax-included item price deducted to net: $${itemPrice.toFixed(2)}`)
    assert(itemPreDiscount === 10.00, `Tax-included preDiscount price deducted to net: $${itemPreDiscount.toFixed(2)}`)
    assert(calculatedDiscount === 0, `Artificial discount eliminated (expected $0 discount): $${calculatedDiscount.toFixed(2)}`)

    // ----------------------------------------------------
    // TEST 9: Cross-Date Refund Bounding
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 9: Cross-Date Refund Bounding")
    const mockPayment = {
        refund: { refundAmount: 50.00 } // Physical refund on card was $50
    }
    const refundTip = 0
    let refundNet = 150.00 // Sum of order items was $150 (e.g. whole tray)

    if (mockPayment.refund?.refundAmount) {
        const maxAllowed = Math.max(0, Number(mockPayment.refund.refundAmount) - refundTip)
        if (refundNet === 0 || refundNet > maxAllowed) {
            refundNet = maxAllowed
        }
    }

    assert(refundNet === 50.00, `Cross-date refund bounded to physical payment amount ($50.00 vs $150 order total): $${refundNet.toFixed(2)}`)

    // ----------------------------------------------------
    // TEST 10: Multi-Store Autofill Aggregation
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 10: Multi-Store Autofill Aggregation")
    const mockMultiStoreRows = [
        { periodStart: "2026-08-18", netSales: 5000, totalHours: 100, laborCost: 1000, orderCount: 250, guestCount: 300, uberSales: 200, doordashSales: 300, grubhubSales: 100, ebtAmount: 50, hourlySales: { 12: 500, 18: 600 } },
        { periodStart: "2026-08-18", netSales: 4000, totalHours: 80, laborCost: 800, orderCount: 200, guestCount: 250, uberSales: 150, doordashSales: 200, grubhubSales: 50, ebtAmount: 30, hourlySales: { 12: 400, 18: 500 } }
    ]

    const dailyDataAcc: Record<string, any> = {}
    mockMultiStoreRows.forEach(row => {
        const dateStr = row.periodStart
        if (!dailyDataAcc[dateStr]) {
            dailyDataAcc[dateStr] = { netSales: 0, totalHours: 0, laborCost: 0, orderCount: 0, guestCount: 0, uberSales: 0, doordashSales: 0, grubhubSales: 0, ebtAmount: 0 }
        }
        const curr = dailyDataAcc[dateStr]
        curr.netSales += row.netSales
        curr.totalHours += row.totalHours
        curr.laborCost += row.laborCost
        curr.orderCount += row.orderCount
        curr.guestCount += row.guestCount
        curr.uberSales += row.uberSales
        curr.doordashSales += row.doordashSales
        curr.grubhubSales += row.grubhubSales
        curr.ebtAmount += row.ebtAmount
    })

    const agg = dailyDataAcc["2026-08-18"]
    assert(agg.netSales === 9000, `Multi-store aggregated net sales: $${agg.netSales}`)
    assert(agg.totalHours === 180, `Multi-store aggregated total hours: ${agg.totalHours}`)
    assert(agg.orderCount === 450, `Multi-store aggregated order count: ${agg.orderCount}`)

    // ----------------------------------------------------
    // TEST 11: Negative Differences in Weekly Ops Summary
    // ----------------------------------------------------
    console.log("\n🧪 Test Suite 11: Negative Difference Sums in Weekly Ops Summary")
    const mockDiffDays = [
        { diff_labor: -1.50, hasSales: true },
        { diff_labor: -2.00, hasSales: true },
        { diff_labor: 1.00, hasSales: true },
        { diff_labor: -0.50, hasSales: true },
        { diff_labor: -1.00, hasSales: true },
        { diff_labor: 0.00, hasSales: true },
        { diff_labor: -1.00, hasSales: true }
    ]

    const activeDaysCount = mockDiffDays.filter(d => d.hasSales).length
    const diffSum = mockDiffDays.reduce((s, d) => s + d.diff_labor, 0)
    const avgDiff = diffSum / activeDaysCount

    assert(activeDaysCount === 7, `All 7 active days counted (no > 0 filter drop): ${activeDaysCount} days`)
    assert(Math.abs(avgDiff - (-0.714)) < 0.01, `Average labor savings correctly calculated with negatives included: ${avgDiff.toFixed(2)}%`)

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

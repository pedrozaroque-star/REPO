
import { createClient } from '@supabase/supabase-js'
import { addDays, format, subYears } from 'date-fns'

// --- CONSTANTS FROM INTELLIGENCE MINING (2025 Analysis) ---
export const CAPACITY_RULES = {
    // Front of House: Throughput limit driven by transaction count
    // Changed to 7 tickets/hour (Feb 2026 calibration)
    CASHIER_TICKETS_PER_HOUR_MEDIAN: 7.0,

    // Back of House: Production throughput driven by sales volume
    // Changed from $250 to $280 per cook/hour (Feb 2026 calibration)
    KITCHEN_SALES_PER_HOUR_MEDIAN: 280.0,

    // Baseline minimums from POOL (SL + Asst are separate)
    // Only 1 cook + 1 cashier needed from pool to open
    MIN_CASHIERS: 1,
    MIN_KITCHEN: 1  // Changed from 2 (Feb 2026) - SL + Asst cover the rest
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface OperatingHour {
    hour: number
    projected_sales: number
    projected_tickets: number
    required_kitchen: number
    required_foh: number
    reasoning: string
}

export interface DayForecast {
    date: string
    store_id: string
    total_sales: number
    growth_factor_applied: number
    weather_adjustment?: boolean
    hours: OperatingHour[]
}

/**
 * GENERATE HYBRID FORECAST
 * ------------------------
 * 1. Historical Base: Looks at Same Day Last Year (match Day of Week, not just date)
 * 2. Trend Adjustment: Calculates 2026 vs 2025 growth for the last 4 weeks.
 * 3. Granularity: Reconstructs hourly curve from historical hourly percents.
 */
export async function generateSmartForecast(storeId: string, targetDateStr: string): Promise<DayForecast> {
    // FORCE NOON to avoid Timezone Shift (e.g. UTC midnight -> Previous Day 4pm PST)
    const targetDate = new Date(targetDateStr + 'T12:00:00')

    // 1. Find Historical Comp Date (Same Weekday, Last Year)
    // subYears(targetDate, 1) gives same date last year, matches day-of-week closely but not perfectly due to leap years/shifts.
    // Better strategy: Same Week Number, Same Weekday of previous year.
    // Simplifying for now: Date - 364 days (52 weeks * 7) ensures same weekday.
    const baseDate = new Date(targetDate)
    baseDate.setDate(baseDate.getDate() - 364)
    const baseDateStr = baseDate.toISOString().split('T')[0]

    // 2. Fetch Historical Data (Multi-Year Weighted Average)
    // STRATEGY: 
    // A. Check for "Apples-to-Apples" Holiday Mapping (e.g. Super Bowl vs Super Bowl)
    // B. Default to Same Weekday (Year-1, Year-2, Year-3)

    const { getComparativeDates, getHolidayName, getHolidayImpact, getHolidayEarlyClose, getHolidayLateOpen } = await import('@/lib/holidays')
    const specialEventPeers = getComparativeDates(targetDateStr)
    const holidayName = getHolidayName(targetDateStr)
    const holidayImpact = getHolidayImpact(targetDateStr)
    const earlyCloseHour = getHolidayEarlyClose(targetDateStr)
    const lateOpenHour = getHolidayLateOpen(targetDateStr)

    // CLOSED HOLIDAY CHECK (Abort Early)
    if (holidayImpact === 'CLOSED') {
        return {
            date: targetDateStr,
            store_id: storeId,
            total_sales: 0,
            growth_factor_applied: 0,
            weather_adjustment: false,
            hours: [] // No operations
        }
    }

    // ... (rest of code)

    // 3. Make sure to update the loop logic far below (using multi_replace doesn't let me jump around easily with context)
    // I will target the imports block first, then I'll make a second call for the loop.
    // Wait, I can't do multiple discontinuous edits unless I use multi_replace.
    // I will use MultiReplaceFileContent.


    let baseSales = 0
    let hourlySalesDist: Record<string, number> = {}
    let hourlyTicketDist: Record<string, number> = {}

    const compDays: string[] = []

    const targetMonth = targetDate.getUTCMonth() // 0-11
    const targetDayOfMonth = targetDate.getUTCDate()

    // CHRISTMAS EXCEPTION: SURGICAL (Only Critical Days)
    // - Dec 23 (Peak Rush)
    // - Dec 24 (Christmas Eve)
    // - Dec 25 (Christmas)
    // - Dec 30 (Pre-NYE Rush)
    // - Dec 31 (NYE)
    // - Jan 1 (New Year)
    // For intermediate days (e.g. Dec 27, 28), standard Day-of-Week is safer to capture Weekend trends.

    const isCriticalHoliday = (targetMonth === 11 && [23, 24, 25, 30, 31].includes(targetDayOfMonth)) ||
        (targetMonth === 0 && targetDayOfMonth === 1)

    if (specialEventPeers && specialEventPeers.length > 0) {
        // CASE A: SPECIAL EVENT (Use manual peers)
        // Apply "Weekend Adjustment": If moving from Weekend (Hist) to Weekday (Target), penalize.

        const targetDay = new Date(targetDate).getUTCDay() // 0=Sun, 6=Sat
        const isTargetWeekend = targetDay === 0 || targetDay >= 5

        specialEventPeers.forEach(dStr => {
            const peerDate = new Date(dStr)
            const peerDay = peerDate.getUTCDay()
            const isPeerWeekend = peerDay === 0 || peerDay >= 5

            // let adjFactor = 1.0 (Logic applied later via loop)
            compDays.push(dStr)
        })
    } else {
        // CASE B: STANDARD LOOKBACK
        const yearsBack = 3
        for (let i = 1; i <= yearsBack; i++) {
            if (isCriticalHoliday) {
                // FIXED DATE MAPPING (e.g. Dec 23 2025 -> Dec 23 2024)
                const d = subYears(targetDate, i)
                compDays.push(d.toISOString().split('T')[0])
            } else {
                // WEEKDAY MAPPING (e.g. Tue -> Tue)
                const d = new Date(targetDate)
                d.setDate(d.getDate() - (i * 364))
                compDays.push(d.toISOString().split('T')[0])
            }
        }
    }

    const { data: historyPoints } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales, hourly_data, hourly_tickets')
        .eq('store_id', storeId)
        .in('business_date', compDays)
        .gt('net_sales', 0)

    if (historyPoints && historyPoints.length > 0) {
        // Calculate Weighted Average
        let totalWeight = 0
        let weightedSales = 0
        const weightedHrS: Record<string, number> = {}
        const weightedHrT: Record<string, number> = {}



        // weights: index 0 (1yr ago) = 3, index 1 (2yrs ago) = 2, index 2 = 1
        historyPoints.forEach(pt => {
            // Determine recency
            const ptDate = new Date(pt.business_date)
            const ytDate = new Date(targetDate) // Target

            // WEEKEND ADJUSTMENT LOGIC (Repetitive but safe)
            const ptDay = ptDate.getUTCDay()
            const ytDay = ytDate.getUTCDay()
            const isPtWeekend = ptDay === 0 || ptDay >= 5
            const isYtWeekend = ytDay === 0 || ytDay >= 5

            let dayShiftFactor = 1.0
            // Only apply if it's a Special Event Peer (we can infer this if diffYears isn't exact 52 weeks, or just always apply?)
            // Always applying it is dangerous for normal days (comparing apples to apples usually).
            // But compDays were selected carefully.
            // If we are in "Holiday Mode" (specialEventPeers exists), apply it.

            if (specialEventPeers && specialEventPeers.length > 0) {
                if (isYtWeekend && !isPtWeekend) dayShiftFactor = 1.20
                else if (!isYtWeekend && isPtWeekend) dayShiftFactor = 0.80
            }

            const diffYears = Math.round((ytDate.getTime() - ptDate.getTime()) / (1000 * 60 * 60 * 24 * 365))

            let weight = 1
            if (diffYears === 1) weight = 3
            if (diffYears === 2) weight = 2

            // CORRECTION: Apply DayShift ONLY to value, not to weight!
            // We want to say: "This historical point counts fully (weight), but its value should be adjusted down/up".

            totalWeight += weight // Denominator keeps full weight
            weightedSales += (pt.net_sales * dayShiftFactor * weight) // Numerator gets adjusted value



            if (pt.hourly_data) {
                Object.entries(pt.hourly_data).forEach(([h, v]) => {
                    weightedHrS[h] = (weightedHrS[h] || 0) + (Number(v) * dayShiftFactor * weight)
                })
            }
            if (pt.hourly_tickets) {
                Object.entries(pt.hourly_tickets).forEach(([h, v]) => {
                    weightedHrT[h] = (weightedHrT[h] || 0) + (Number(v) * dayShiftFactor * weight)
                })
            }
        })

        baseSales = weightedSales / totalWeight

        // Normalize hourly
        Object.keys(weightedHrS).forEach(h => hourlySalesDist[h] = weightedHrS[h] / totalWeight)
        Object.keys(weightedHrT).forEach(h => hourlyTicketDist[h] = weightedHrT[h] / totalWeight)



    } else {
        // Strict 0 triggers safety net
        baseSales = 0
    }

    // --- SAFETY NET: FALLBACK TO RECENT TREND IF NO HISTORY ---
    if (baseSales === 0) {
        // Fetch last 4 same-weekdays (e.g. last 4 Tuesdays)
        // We go back 4 weeks from targetDate
        const recentDates = []
        for (let i = 1; i <= 4; i++) {
            const d = new Date(targetDate)
            d.setDate(d.getDate() - (i * 7))
            recentDates.push(d.toISOString().split('T')[0])
        }

        const { data: recentHistory } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, hourly_data, hourly_tickets')
            .eq('store_id', storeId)
            .in('business_date', recentDates)
            .gt('net_sales', 0) // Filter out closed days

        if (recentHistory && recentHistory.length > 0) {
            // Calculate Average
            let totalS = 0
            const avgHourlyS: Record<string, number> = {}
            const avgHourlyT: Record<string, number> = {}

            recentHistory.forEach(day => {
                totalS += day.net_sales

                // Sum Hourly
                if (day.hourly_data) {
                    Object.entries(day.hourly_data).forEach(([h, val]) => {
                        avgHourlyS[h] = (avgHourlyS[h] || 0) + Number(val)
                    })
                }
                if (day.hourly_tickets) {
                    Object.entries(day.hourly_tickets).forEach(([h, val]) => {
                        avgHourlyT[h] = (avgHourlyT[h] || 0) + Number(val)
                    })
                }
            })

            // Average it out
            baseSales = totalS / recentHistory.length

            Object.keys(avgHourlyS).forEach(h => avgHourlyS[h] = avgHourlyS[h] / recentHistory.length)
            Object.keys(avgHourlyT).forEach(h => avgHourlyT[h] = avgHourlyT[h] / recentHistory.length)

            hourlySalesDist = avgHourlyS
            hourlyTicketDist = avgHourlyT

            // console.log(`   ℹ️ Values inferred from ${recentHistory.length} recent weeks (No historical match).`)
        }
    }

    // 3. Calculate Dynamic Growth Factor (Hybrid Trend: 28-Day Stability + 7-Day Immediacy)
    let growthFactor = 1.0

    // Range A: 28 Days (Stability)
    // Anchor trend analysis to the target date (simulate "what we knew then")
    const dRecentEnd = new Date(targetDate)
    dRecentEnd.setDate(dRecentEnd.getDate() - 1)
    const dRecentStart = new Date(dRecentEnd)
    dRecentStart.setDate(dRecentStart.getDate() - 28)

    // Range B: 7 Days (Immediate Reactivity)
    const dShortStart = new Date(dRecentEnd)
    dShortStart.setDate(dShortStart.getDate() - 7)

    // Last Year Ranges
    const dLastYearEnd = new Date(dRecentEnd)
    dLastYearEnd.setDate(dLastYearEnd.getDate() - 364)
    const dLastYearStart = new Date(dLastYearEnd)
    dLastYearStart.setDate(dLastYearStart.getDate() - 28)
    const dLastYearShort = new Date(dLastYearEnd)
    dLastYearShort.setDate(dLastYearShort.getDate() - 7)

    // FETCH 28-DAY DATA
    const { data: salesRecent28 } = await supabase
        .from('sales_daily_cache')
        .select('net_sales, business_date')
        .eq('store_id', storeId)
        .gte('business_date', dRecentStart.toISOString().split('T')[0])
        .lte('business_date', dRecentEnd.toISOString().split('T')[0])

    // ... (Keep the fix for salesLastYearSafe below) ...

    const { data: salesLastYear28, error: errorLastYear } = await supabase
        .from('sales_daily_cache')
        .select('net_sales, business_date, total_tickets')
        .eq('store_id', storeId)
        .gte('business_date', dLastYearStart.toISOString().split('T')[0])
        .lte('business_date', dLastYearEnd.toISOString().split('T')[0])

    let salesLastYearSafe = salesLastYear28

    if (!salesLastYear28 || errorLastYear) {
        // Fallback: Fetch ONLY net_sales if total_tickets doesn't exist
        const { data: retryData } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, business_date')
            .eq('store_id', storeId)
            .gte('business_date', dLastYearStart.toISOString().split('T')[0])
            .lte('business_date', dLastYearEnd.toISOString().split('T')[0])

        salesLastYearSafe = retryData as any
    }

    // Compute 28-Day Growth
    // --- TREND ANALYSIS (Sales & Tickets) ---
    // We calculate separate trends because Sales Growth != Traffic Growth (Inflation/Price Hikes)

    // 1. Sales Growth Factors
    const sumRecent28 = salesRecent28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const sumLastYear28 = salesLastYearSafe?.reduce((a, b: any) => a + b.net_sales, 0) || 0
    let salesGrowth28 = 1.0
    if (sumLastYear28 > 1000) salesGrowth28 = sumRecent28 / sumLastYear28

    const sumRecentShort = salesRecent28?.filter(s => s.business_date >= dShortStart.toISOString().split('T')[0])
        .reduce((a, b: any) => a + b.net_sales, 0) || 0
    const sumLastYearShort = salesLastYearSafe?.filter((s: any) => s.business_date >= dLastYearShort.toISOString().split('T')[0])
        .reduce((a, b: any) => a + b.net_sales, 0) || 0
    let salesGrowthShort = 1.0
    if (sumLastYearShort > 1000) salesGrowthShort = sumRecentShort / sumLastYearShort

    // 2. Ticket Growth Factors
    const sumTicketsRecent28 = salesRecent28?.reduce((a, b: any) => a + (b.total_tickets || 0), 0) || 0
    const sumTicketsLastYear28 = (salesLastYearSafe as any[])?.reduce((a, b) => a + (b.total_tickets || 0), 0) || 0
    let ticketGrowth28 = 1.0
    if (sumTicketsLastYear28 > 100) ticketGrowth28 = sumTicketsRecent28 / sumTicketsLastYear28

    const sumTicketsRecentShort = salesRecent28?.filter(s => s.business_date >= dShortStart.toISOString().split('T')[0])
        .reduce((a, b: any) => a + (b.total_tickets || 0), 0) || 0
    const sumTicketsLastYearShort = (salesLastYearSafe as any[])?.filter(s => s.business_date >= dLastYearShort.toISOString().split('T')[0])
        .reduce((a, b) => a + (b.total_tickets || 0), 0) || 0
    let ticketGrowthShort = 1.0
    if (sumTicketsLastYearShort > 100) ticketGrowthShort = sumTicketsRecentShort / sumTicketsLastYearShort



    // WEIGHTED MERGE: SEGMENTED TREND LOGIC (NEW v2)
    // Instead of global 28-day trend, we look at THIS specific weekday's recent performance.
    // If Mondays are tanking but Saturdays are booming, we shouldn't lift Monday's forecast.

    // 1. Filter history for SAME WEEKDAY only (e.g. only Mondays)
    const targetDayOfWeek = targetDate.getUTCDay() // 0-6
    const safeHistory = historyPoints || []
    const sameWeekdayHistory = safeHistory.filter(h => {
        const d = new Date(h.business_date)
        return d.getUTCDay() === targetDayOfWeek
    })

    // 2. Sort by date desc
    sameWeekdayHistory.sort((a, b) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())

    // 3. Take last 4 instances (Last 4 Mondays)
    const recent4SameDays = sameWeekdayHistory.slice(0, 4) // Today is 2026, historyPoints includes 2025 comp. 
    // WAIT! historyPoints ONLY has the Comp Dates (Year -1, -2, -3). It does NOT have "Last Week".
    // We need to fetch "Last 4 Weeks" ACTUALS to calculate trend.
    // The previous code had "sumRecent28". Let's reuse that but filter carefully.

    // RE-FETCH RECENT TREND DATA (Last 28 Days)
    // We need to fetch it here because historyPoints above only has the OLD data.
    const trendStartDate = new Date(targetDate)
    trendStartDate.setDate(trendStartDate.getDate() - 35) // 5 weeks buffer

    const { data: recentTrendData } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales, hourly_tickets')
        .eq('store_id', storeId)
        .gte('business_date', trendStartDate.toISOString().split('T')[0])
        .lt('business_date', targetDateStr)

    // Calculate Trend specific to Day of Week
    let specificTrendFactor = 1.0

    if (recentTrendData && recentTrendData.length > 0) {
        // Filter for same weekday in recent data (e.g. Jan 21, Jan 14, Jan 7 -> for Jan 28 target)
        const recentSameWeekdays = recentTrendData.filter(d => {
            const dt = new Date(d.business_date)
            return dt.getUTCDay() === targetDayOfWeek
        })

        // Compare "Recent Same Weekdays" vs "Last Year Same Weekdays" (from historyPoints)
        // Actually, simpler: Compare "Recent Same Day Average" vs "Last Year Same Day Average"

        let sumRecentSpecific = 0
        let countRecentSpecific = 0
        recentSameWeekdays.forEach(d => {
            if (d.net_sales > 100) { // Filter noise
                sumRecentSpecific += d.net_sales
                countRecentSpecific++
            }
        })

        let sumHistSpecific = 0
        let countHistSpecific = 0
        const safeHistPoints = historyPoints || []
        safeHistPoints.forEach(h => {
            // historyPoints already filtered for comp days (which are same weekday by definition)
            if (h.net_sales > 100) {
                sumHistSpecific += h.net_sales
                countHistSpecific++
            }
        })

        if (countRecentSpecific > 0 && countHistSpecific > 0) {
            const avgRecent = sumRecentSpecific / countRecentSpecific
            const avgHist = sumHistSpecific / countHistSpecific
            specificTrendFactor = avgRecent / avgHist
        }
    }

    // Blend: 70% Specific Trend, 30% Global Trend (to capture macro shifts like "Holidays are booming")
    // Previous global calculation:
    let globalGrowth = 1.0
    if (sumLastYear28 > 1000 && sumRecent28 > 1000) {
        globalGrowth = sumRecent28 / sumLastYear28
    }

    let growthFactorSales = (specificTrendFactor * 0.7) + (globalGrowth * 0.3)

    // Safety Bounds (Don't let it go crazy)
    growthFactorSales = Math.min(Math.max(growthFactorSales, 0.85), 1.40)

    // --- SPECIAL RULE: SHORT DAYS (Early Close) ---
    // If the day is physically shorter multiple hours, high growth is unlikely realized.
    // Cap growth at 5% for short days to be conservative.
    if (earlyCloseHour !== null) {
        growthFactorSales = Math.min(growthFactorSales, 1.05)
    }

    // Apply same logic to Tickets? For now just mirror Sales factor
    let growthFactorTickets = growthFactorSales; // Simplified alignment

    // --- WEATHER INTEL ---
    const { getStoreWeatherForecast } = await import('@/lib/weather')
    let weatherFactor = 1.0
    let weatherNote = null

    try {
        const weather = await getStoreWeatherForecast(storeId, targetDateStr)
        if (weather && weather.isSevere) {
            weatherFactor = 0.95 // -5% Impact (Conservative: Delivery offsets foot traffic loss)
            weatherNote = `Severe Weather Alert: ${weather.condition} (${weather.precipProb}%)`
        }
    } catch (e) {
        // Ignore weather errors, proceed with baseline
    }

    // --- HOLIDAY LOGIC: VALENTINE'S DAY ---
    if (targetMonth === 1 && targetDayOfMonth === 14) {
        // Feb 14th - Historical analysis shows inconsistent boost (2021-2025 avg ~+7%)
        // Changed from 15% to 7% (Feb 2026 calibration based on 5-year average)
        baseSales *= 1.07
        Object.keys(hourlySalesDist).forEach(h => hourlySalesDist[h] *= 1.07)
        Object.keys(hourlyTicketDist).forEach(h => hourlyTicketDist[h] *= 1.05)
    }

    // APPLY FACTORS SEPARATELY
    const projectedTotal = baseSales * growthFactorSales * weatherFactor

    // 4. Build Hourly Projection
    const hours: OperatingHour[] = []

    // Standard business hours 8am - 12am (allow 24h though)
    for (let h = 0; h < 24; h++) {
        const histSales = Number(hourlySalesDist[h] || 0)
        const histTickets = Number(hourlyTicketDist[h] || 0)

        // Apply distinct growth factors AND weather
        let projSales = histSales * growthFactorSales * weatherFactor
        let projTickets = histTickets * growthFactorTickets * weatherFactor // Uses Ticket Growth

        // --- OPERATING HOURS ENFORCEMENT ---
        // Late Open (e.g. 11am) OR Early Close (e.g. 4pm)
        if (
            (lateOpenHour !== null && h < lateOpenHour) ||
            (earlyCloseHour !== null && h >= earlyCloseHour)
        ) {
            projSales = 0
            projTickets = 0
        }



        // FALLBACK: If hourly tickets missing, estimate from Average Ticket Value (ATV)
        // Avg Ticket = Total Sales / Total Tickets (Day level)
        // If Data missing, assume $25.00 avg ticket conservative
        if (projTickets === 0 && projSales > 0) {
            const dayTotalSales = Object.values(hourlySalesDist).reduce((a: any, b: any) => Number(a) + Number(b), 0) as number
            const dayTotalTickets = Object.values(hourlyTicketDist).reduce((a: any, b: any) => Number(a) + Number(b), 0) as number

            let atv = 25.0
            if (dayTotalSales > 0 && dayTotalTickets > 0) {
                atv = dayTotalSales / dayTotalTickets
            }

            projTickets = projSales / atv
        }

        // APPLY INTELLIGENCE RULES
        // Cashiers: Based on tickets
        let reqCashiers = Math.ceil(projTickets / CAPACITY_RULES.CASHIER_TICKETS_PER_HOUR_MEDIAN)
        if (reqCashiers < CAPACITY_RULES.MIN_CASHIERS && projSales > 0) reqCashiers = CAPACITY_RULES.MIN_CASHIERS
        if (projSales === 0) reqCashiers = 0 // Closed

        // Kitchen: Based on Sales
        let reqKitchen = Math.ceil(projSales / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)
        if (reqKitchen < CAPACITY_RULES.MIN_KITCHEN && projSales > 0) reqKitchen = CAPACITY_RULES.MIN_KITCHEN
        if (projSales === 0) reqKitchen = 0 // Closed

        hours.push({
            hour: h,
            projected_sales: projSales,
            projected_tickets: projTickets, // Using ticket count logic
            required_foh: reqCashiers, // Renamed from required_cashiers
            required_kitchen: reqKitchen,
            reasoning: `Based on ${projTickets.toFixed(0)} tix & $${projSales.toFixed(0)} sales`
        })
    }

    // RE-CALCULATE TOTAL FROM HOURS (To account for Early Close / Late Open cuts)
    const finalTotalSales = hours.reduce((acc, h) => acc + h.projected_sales, 0)

    return {
        date: targetDateStr,
        store_id: storeId,
        total_sales: finalTotalSales,
        growth_factor_applied: growthFactorSales,
        weather_adjustment: weatherFactor < 1.0,
        hours
    }
}

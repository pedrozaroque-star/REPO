
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

import { supabase } from '@/lib/supabase'

function getSupabase() {
    return supabase // Use anon client (Has proven read access)
}

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
    base_sales?: number
    growth_factor_applied: number
    weather_adjustment?: boolean
    hours: OperatingHour[]
}

// Add simple fast memory cache to avoid blasting Supabase 300+ times per API hit
const _memCache = new Map<string, { data: any, time: number }>();
async function _cachedQuery(key: string, queryFn: () => Promise<any>) {
    const now = Date.now();
    const cached = _memCache.get(key);
    if (cached && now - cached.time < 60000) return cached.data;
    const data = await queryFn();
    _memCache.set(key, { data, time: now });
    return data;
}

/**
 * GENERATE HYBRID FORECAST
 * ------------------------
 * 1. Historical Base: Looks at Same Day Last Year (match Day of Week, not just date)
 * 2. Trend Adjustment: Calculates 2026 vs 2025 growth for the last 4 weeks.
 * 3. Granularity: Reconstructs hourly curve from historical hourly percents.
 */
export async function generateSmartForecast(storeId: string, targetDateStr: string): Promise<DayForecast> {
    const supabase = getSupabase()
    // FORCE NOON to avoid Timezone Shift (e.g. UTC midnight -> Previous Day 4pm PST)
    const targetDate = new Date(targetDateStr + 'T12:00:00')

    // 🌟 MASTER FIX: SINGLE SOURCE OF TRUTH (CACHE PRIORITY) 🌟
    // Before doing any complex math, check if we already have a locked/cached projection.
    const { data: cachedProj } = await supabase
        .from('sales_projections_cache')
        .select('total_sales, hourly_data, meta')
        .eq('store_id', storeId)
        .eq('business_date', targetDateStr)
        .single()

    let lockedTotalSales = null;
    let lockedHourlyData = null;

    if (cachedProj && cachedProj.total_sales > 0) {
        lockedTotalSales = Number(cachedProj.total_sales);
        if (cachedProj.hourly_data && Object.keys(cachedProj.hourly_data).length > 0) {
            lockedHourlyData = cachedProj.hourly_data;
        }
        
        // If we have BOTH total and hourly, we can bypass the entire expensive calculation!
        if (lockedTotalSales > 0 && lockedHourlyData) {
            console.log(`🔒 [INTELLIGENCE] Using fully cached projection for ${storeId} on ${targetDateStr}: $${lockedTotalSales}`)
            
            // Reconstruct hours array
            const hours: OperatingHour[] = []
            Object.entries(lockedHourlyData).forEach(([hStr, pSales]) => {
                const hour = Number(hStr)
                const sales = Number(pSales)
                // Reverse calculate required staff (approximate)
                const reqK = Math.ceil(sales / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)
                const reqF = Math.ceil(Math.ceil(sales / 25) / CAPACITY_RULES.CASHIER_TICKETS_PER_HOUR_MEDIAN) // Assuming avg ticket $25
                
                hours.push({
                    hour,
                    projected_sales: sales,
                    projected_tickets: Math.ceil(sales / 25),
                    required_kitchen: Math.max(CAPACITY_RULES.MIN_KITCHEN, reqK),
                    required_foh: Math.max(CAPACITY_RULES.MIN_CASHIERS, reqF),
                    reasoning: 'Loaded from Single Source of Truth Cache'
                })
            })
            
            return {
                date: targetDateStr,
                store_id: storeId,
                total_sales: lockedTotalSales,
                growth_factor_applied: 1.0,
                hours
            }
        } else if (lockedTotalSales > 0) {
            // We have a total, but no hourly curve (e.g. overridden in Planificador without saving curve).
            // We must continue the calculation to get the historical curve, but we will force the TOTAL to equal lockedTotalSales.
            console.log(`🔒 [INTELLIGENCE] Found cached total for ${storeId} on ${targetDateStr}: $${lockedTotalSales}. Calculating curve...`)
        }
    }

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

    const historyPoints = await _cachedQuery(`hist_${storeId}_${compDays.join(',')}`, async () => {
        const { data } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales, hourly_data, hourly_tickets')
            .eq('store_id', storeId)
            .in('business_date', compDays)
            .gt('net_sales', 0)
        return data || []
    });

    if (historyPoints && historyPoints.length > 0) {
        // Calculate Weighted Average
        let totalWeight = 0
        let weightedSales = 0
        const weightedHrS: Record<string, number> = {}
        const weightedHrT: Record<string, number> = {}



        // weights: index 0 (1yr ago) = 3, index 1 (2yrs ago) = 2, index 2 = 1
        historyPoints.forEach((pt: any) => {
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
        const recentDates: string[] = []
        for (let i = 1; i <= 4; i++) {
            const d = new Date(targetDate)
            d.setDate(d.getDate() - (i * 7))
            recentDates.push(d.toISOString().split('T')[0])
        }

        const recentHistory = await _cachedQuery(`recent4_${storeId}_${recentDates.join(',')}`, async () => {
            const { data } = await supabase
                .from('sales_daily_cache')
                .select('net_sales, hourly_data, hourly_tickets')
                .eq('store_id', storeId)
                .in('business_date', recentDates)
                .gt('net_sales', 0) // Filter out closed days
            return data || []
        });

        if (recentHistory && recentHistory.length > 0) {
            // Calculate Average
            let totalS = 0
            const avgHourlyS: Record<string, number> = {}
            const avgHourlyT: Record<string, number> = {}

            recentHistory.forEach((day: any) => {
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

    // NEW STABILITY ANCHOR: Lock the trend analysis to the Sunday BEFORE the target week.
    // This ensures that whether we generate a forecast on Monday morning or Friday night
    // for this same week, the "recent trend" data snapshot remains identical, freezing the projection.
    const dayOfWeek = targetDate.getUTCDay() // 0 = Sunday, 1 = Monday, etc.
    // If target is Sunday (0), we want the Sunday 7 days ago to avoid incomplete data. 
    // If target is Monday (1), we want Sunday (target - 1).
    const daysToPriorSunday = dayOfWeek === 0 ? 7 : dayOfWeek

    const dRecentEnd = new Date(targetDate)
    dRecentEnd.setDate(dRecentEnd.getDate() - daysToPriorSunday)

    // Range A: 28 Days (Stability)
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
    const dRecStartStr = dRecentStart.toISOString().split('T')[0]
    const dRecEndStr = dRecentEnd.toISOString().split('T')[0]
    const dLYStartStr = dLastYearStart.toISOString().split('T')[0]
    const dLYEndStr = dLastYearEnd.toISOString().split('T')[0]

    const salesRecent28 = await _cachedQuery(`rec28_${storeId}_${dRecStartStr}_${dRecEndStr}`, async () => {
        const { data } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, business_date, total_tickets')
            .eq('store_id', storeId)
            .gte('business_date', dRecStartStr)
            .lte('business_date', dRecEndStr)
        return data || []
    });

    // ... (Keep the fix for salesLastYearSafe below) ...

    const salesLastYearSafe = await _cachedQuery(`ly28_${storeId}_${dLYStartStr}_${dLYEndStr}`, async () => {
        let { data, error } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, business_date, total_tickets')
            .eq('store_id', storeId)
            .gte('business_date', dLYStartStr)
            .lte('business_date', dLYEndStr)

        if (!data || error) {
            // Fallback: Fetch ONLY net_sales if total_tickets doesn't exist
            const { data: retryData } = await supabase
                .from('sales_daily_cache')
                .select('net_sales, business_date')
                .eq('store_id', storeId)
                .gte('business_date', dLYStartStr)
                .lte('business_date', dLYEndStr)
            data = retryData as any
        }
        return data || []
    });

    // Compute 28-Day Growth
    // --- TREND ANALYSIS (Sales & Tickets) ---
    // We calculate separate trends because Sales Growth != Traffic Growth (Inflation/Price Hikes)

    // 1. Sales Growth Factors
    const sumRecent28 = salesRecent28?.reduce((a: any, b: any) => a + b.net_sales, 0) || 0
    const sumLastYear28 = salesLastYearSafe?.reduce((a: any, b: any) => a + b.net_sales, 0) || 0
    let salesGrowth28 = 1.0
    if (sumLastYear28 > 1000) salesGrowth28 = sumRecent28 / sumLastYear28

    const sumRecentShort = salesRecent28?.filter((s: any) => s.business_date >= dShortStart.toISOString().split('T')[0])
        .reduce((a: any, b: any) => a + b.net_sales, 0) || 0
    const sumLastYearShort = salesLastYearSafe?.filter((s: any) => s.business_date >= dLastYearShort.toISOString().split('T')[0])
        .reduce((a: any, b: any) => a + b.net_sales, 0) || 0
    let salesGrowthShort = 1.0
    if (sumLastYearShort > 1000) salesGrowthShort = sumRecentShort / sumLastYearShort

    // 2. Ticket Growth Factors
    const sumTicketsRecent28 = salesRecent28?.reduce((a: any, b: any) => a + (b.total_tickets || 0), 0) || 0
    const sumTicketsLastYear28 = (salesLastYearSafe as any[])?.reduce((a: any, b: any) => a + (b.total_tickets || 0), 0) || 0
    let ticketGrowth28 = 1.0
    if (sumTicketsLastYear28 > 100) ticketGrowth28 = sumTicketsRecent28 / sumTicketsLastYear28

    const sumTicketsRecentShort = salesRecent28?.filter((s: any) => s.business_date >= dShortStart.toISOString().split('T')[0])
        .reduce((a: any, b: any) => a + (b.total_tickets || 0), 0) || 0
    const sumTicketsLastYearShort = (salesLastYearSafe as any[])?.filter((s: any) => s.business_date >= dLastYearShort.toISOString().split('T')[0])
        .reduce((a: any, b: any) => a + (b.total_tickets || 0), 0) || 0
    let ticketGrowthShort = 1.0
    if (sumTicketsLastYearShort > 100) ticketGrowthShort = sumTicketsRecentShort / sumTicketsLastYearShort



    // WEIGHTED MERGE: SEGMENTED TREND LOGIC (NEW v2)
    // Instead of global 28-day trend, we look at THIS specific weekday's recent performance.
    // If Mondays are tanking but Saturdays are booming, we shouldn't lift Monday's forecast.

    // 1. Filter history for SAME WEEKDAY only (e.g. only Mondays)
    const targetDayOfWeek = targetDate.getUTCDay() // 0-6
    const safeHistory = historyPoints || []
    const sameWeekdayHistory = safeHistory.filter((h: any) => {
        const d = new Date(h.business_date)
        return d.getUTCDay() === targetDayOfWeek
    })

    // 2. Sort by date desc
    sameWeekdayHistory.sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())

    // 3. Take last 4 instances (Last 4 Mondays)
    const recent4SameDays = sameWeekdayHistory.slice(0, 4) // Today is 2026, historyPoints includes 2025 comp. 
    // WAIT! historyPoints ONLY has the Comp Dates (Year -1, -2, -3). It does NOT have "Last Week".
    // We need to fetch "Last 4 Weeks" ACTUALS to calculate trend.
    // The previous code had "sumRecent28". Let's reuse that but filter carefully.

    // RE-FETCH RECENT TREND DATA (Last 21 Days - More reactive to current month)
    // Anchored to the exact same 'dRecentEnd' (Prior Sunday) so intra-week days don't shift the trend.
    const trendStartDate = new Date(dRecentEnd)
    trendStartDate.setDate(trendStartDate.getDate() - 21 + 1) // +1 because the query is .gte 

    const tsDStr = trendStartDate.toISOString().split('T')[0]
    const teDStr = dRecentEnd.toISOString().split('T')[0]
    const recentTrendData = await _cachedQuery(`trend_${storeId}_${tsDStr}_${teDStr}`, async () => {
        const { data } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales, hourly_tickets')
            .eq('store_id', storeId)
            .gte('business_date', tsDStr)
            .lte('business_date', teDStr)
        return data || []
    });

    // Calculate Trend specific to Day of Week
    let specificTrendFactor = 1.0

    if (recentTrendData && recentTrendData.length > 0) {
        // Filter for same weekday in recent data (e.g. Jan 21, Jan 14, Jan 7 -> for Jan 28 target)
        const recentSameWeekdays = recentTrendData.filter((d: any) => {
            const dt = new Date(d.business_date)
            return dt.getUTCDay() === targetDayOfWeek
        })

        // Compare "Recent Same Weekdays" vs "Last Year Same Weekdays" (from historyPoints)
        // Actually, simpler: Compare "Recent Same Day Average" vs "Last Year Same Day Average"

        let sumRecentSpecific = 0
        let countRecentSpecific = 0
        recentSameWeekdays.forEach((d: any) => {
            if (d.net_sales > 100) { // Filter noise
                sumRecentSpecific += d.net_sales
                countRecentSpecific++
            }
        })

        let sumHistSpecific = 0
        let countHistSpecific = 0
        const safeHistPoints = historyPoints || []
        safeHistPoints.forEach((h: any) => {
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

    // Blend: 80% Specific Trend, 20% Global Trend (to capture macro shifts like "Holidays are booming")
    // Previous global calculation:
    let globalGrowth = 1.0
    if (sumLastYear28 > 1000 && sumRecent28 > 1000) {
        globalGrowth = sumRecent28 / sumLastYear28
    }

    // V2.2 Calibration: Increased Global weight and Raised Floor
    let growthFactorSales = (specificTrendFactor * 0.6) + (globalGrowth * 0.4)

    // Safety Bounds (Dampened to prevent extreme drops)
    growthFactorSales = Math.min(Math.max(growthFactorSales, 0.92), 1.50)

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
    // if (targetMonth === 1 && targetDayOfMonth === 14) {
    //    // Feb 14th - Historical analysis shows inconsistent boost (2021-2025 avg ~+7%)
    //    // Changed from 15% to 7% (Feb 2026 calibration based on 5-year average)
    //    baseSales *= 1.07
    //    Object.keys(hourlySalesDist).forEach(h => hourlySalesDist[h] *= 1.07)
    //    Object.keys(hourlyTicketDist).forEach(h => hourlyTicketDist[h] *= 1.05)
    // }

    // APPLY FACTORS SEPARATELY
    let projectedTotal = baseSales * growthFactorSales * weatherFactor
    let overrideMultiplier = 1.0;

    if (lockedTotalSales !== null && lockedTotalSales > 0) {
        console.log(`🔒 [INTELLIGENCE] Overriding calculated total ($${projectedTotal}) with Locked Cache ($${lockedTotalSales})`)
        if (projectedTotal > 0) {
            overrideMultiplier = lockedTotalSales / projectedTotal;
        } else {
            // Safety: if projection was 0 but cache has value, we can't multiply by 0. 
            // We just let the gap filler handle it or assign evenly if no history.
        }
        projectedTotal = lockedTotalSales;
    }

    // --- FETCH STORE OPERATING HOURS (WEEKLY AWARE) ---
    // We fetch both standard and weekly_hours to apply specific day logic.
    let dbOpenHour: number | null = null
    let dbCloseHour: number | null = null // Optional logic if we want to trim end

    try {
        const { data: storeInfo } = await supabase
            .from('stores')
            .select('opening_time, closing_time, weekly_hours')
            .eq('external_id', storeId)
            .single()

        if (storeInfo) {
            // 1. Default to standard hours
            if (storeInfo.opening_time) dbOpenHour = parseInt(storeInfo.opening_time.split(':')[0], 10)
            if (storeInfo.closing_time) dbCloseHour = parseInt(storeInfo.closing_time.split(':')[0], 10)

            // 2. Check for Day-Specific Override in weekly_hours
            // weekly_hours structure: [{ day: 1, open: '10:00', close: '23:00' }, ...]
            // Target Date Day (0=Sun, 1=Mon...)
            const [y, m, d] = targetDateStr.split('-').map(Number)
            const localDate = new Date(y, m - 1, d) // Month is 0-indexed
            const dayOfWeek = localDate.getDay() // 0-6 Sun-Sat

            if (storeInfo.weekly_hours && Array.isArray(storeInfo.weekly_hours)) {
                const dayConfig = storeInfo.weekly_hours.find((c: any) => c.day === dayOfWeek)
                if (dayConfig && dayConfig.open) {
                    dbOpenHour = parseInt(dayConfig.open.split(':')[0], 10)
                }
                if (dayConfig && dayConfig.close) {
                    dbCloseHour = parseInt(dayConfig.close.split(':')[0], 10)
                }
            }
        }
    } catch (err) {
        // Ignore error, fallback to default/history
    }

    // 4. Build Hourly Projection
    const hours: OperatingHour[] = []

    // Standard business hours 8am - 12am (allow 24h though)
    // EXTENDED: Iterate up to 30 (6 AM next day) to capture late night sales
    for (let h = 0; h < 30; h++) {
        // MAPPING LOGIC:
        // Hours 0-23 map directly.
        // Hours 24-29 map to 0-5 of the NEXT day (or same day early morning).
        // Since historical data is usually stored as 0-23, we check:
        // If h >= 24, look for sales at h - 24.

        const lookupHour = h >= 24 ? h - 24 : h

        const histSales = Number(hourlySalesDist[lookupHour] || 0)
        const histTickets = Number(hourlyTicketDist[lookupHour] || 0)

        // Apply distinct growth factors AND weather AND cache override multiplier
        let projSales = histSales * growthFactorSales * weatherFactor * overrideMultiplier
        let projTickets = histTickets * growthFactorTickets * weatherFactor * overrideMultiplier

        // --- OPERATING HOURS ENFORCEMENT ---
        // Late Open (e.g. 11am) OR Early Close (e.g. 4pm)
        // Note: Logic for 24+ might need adjustment if LateOpen applies to next day?
        // Assuming holiday hours apply to the main business day.

        if (
            (lateOpenHour !== null && h < lateOpenHour) ||
            (earlyCloseHour !== null && h >= earlyCloseHour) ||
            // ENFORCE DB OPENING HOURS (Standard Day)
            // If DB says open at 10 AM, prevent sales at 9 AM (h=9).
            // Only apply to morning hours (h < 24) to avoid killing late night (h=25).
            (dbOpenHour !== null && h < 24 && h < dbOpenHour)
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

        // GAP FILLING: If sales are 0 but store is OPEN (based on DB hours), extrapolate!
        // This handles cases where hours were recently extended (so history is 0)
        let effectiveClose = dbCloseHour
        if (dbCloseHour !== null && dbOpenHour !== null) {
            if (dbCloseHour < dbOpenHour) effectiveClose = dbCloseHour + 24
        }

        // Only trigger if we are in the "active" window (after open, before close)
        // And we have a valid previous hour to extrapolate from
        if (projSales === 0
            && dbOpenHour !== null
            && effectiveClose !== null
            && h >= dbOpenHour
            && h < effectiveClose
            && hours.length > 0
            && hours[hours.length - 1].projected_sales > 0) {

            // Extrapolate: Decay last hour by 15% to be conservative
            const lastSales = hours[hours.length - 1].projected_sales
            // Don't carry over huge spikes, cap decay
            projSales = lastSales * 0.85

            // Also extrapolate tickets
            const lastTickets = hours[hours.length - 1].projected_tickets
            projTickets = lastTickets * 0.85
            // Ensure capacity is recalculated for gap-filled hours
            reqCashiers = Math.ceil(projTickets / CAPACITY_RULES.CASHIER_TICKETS_PER_HOUR_MEDIAN)
            if (reqCashiers < CAPACITY_RULES.MIN_CASHIERS) reqCashiers = CAPACITY_RULES.MIN_CASHIERS

            reqKitchen = Math.ceil(projSales / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)
            if (reqKitchen < CAPACITY_RULES.MIN_KITCHEN) reqKitchen = CAPACITY_RULES.MIN_KITCHEN
        }

        hours.push({
            hour: h,
            projected_sales: projSales,
            projected_tickets: projTickets, // Using ticket count logic
            required_foh: reqCashiers, // Renamed from required_cashiers
            required_kitchen: reqKitchen,
            reasoning: `Based on ${projTickets.toFixed(0)} tix & $${projSales.toFixed(0)} sales`
        })
    }

    // --- SMART TRIM: Remove trailing inactive hours ---
    // But keep open until Closing Time if known
    let lastActiveIndex = hours.length - 1

    // 1. Find last actual sale
    while (lastActiveIndex > 0) {
        if (hours[lastActiveIndex].projected_sales > 0) break
        lastActiveIndex--
    }

    // 2. Enforce minimum visual duration based on DB Closing Time
    if (dbCloseHour !== null) {
        let closeH = dbCloseHour
        // If close < open, assume next day (e.g. Open 10, Close 2 -> Close 26)
        // If close > open (Open 10, Close 23), use 23.
        // We need dbOpenHour to be sure.
        const openH = dbOpenHour || 9
        if (closeH < openH) closeH += 24

        // If store closes at 2am (26), we want to show up to hour 26
        // But only if it's within our 30h window
        if (closeH < 30) {
            lastActiveIndex = Math.max(lastActiveIndex, closeH)
        }
    }

    // Keep up to lastActiveIndex + 1 (buffer for closing visual)
    const cutOffIndex = Math.min(lastActiveIndex + 1, hours.length - 1)
    const trimmedHours = hours.slice(0, cutOffIndex + 1)

    // RE-CALCULATE TOTAL FROM TRIMMED HOURS
    const finalTotalSales = trimmedHours.reduce((acc, h) => acc + h.projected_sales, 0)

    return {
        date: targetDateStr,
        store_id: storeId,
        total_sales: finalTotalSales,
        base_sales: baseSales,
        growth_factor_applied: growthFactorSales,
        weather_adjustment: weatherFactor < 1.0,
        hours: trimmedHours
    }
}

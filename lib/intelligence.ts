
/**
 * @module SalesForecastIntelligence
 * @description Motor canónico de proyección diaria y horaria de ventas para Tacos Gavilan.
 * @businessRules
 * - El día operativo comprende de 6:00 AM a 5:59 AM del día siguiente.
 * - La venta se proyecta como tráfico (tickets) por ticket promedio cuando existen datos confiables.
 * - Una proyección guardada permanece congelada salvo recálculo explícito.
 * @dataFlow sales_daily_cache + stores + eventos + clima -> forecast diario -> curva horaria y dotación.
 * @notes La curva horaria se normaliza al total diario para impedir inflación por huecos o doble conteo después de medianoche.
 */

import { subYears } from 'date-fns'
import { empiricalConfidenceBand, robustAverageCheck, robustWeightedMean, safeRatio } from '@/lib/forecast-statistics'

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
    // v3.0 Transparency Fields (Guest-Centric Model)
    base_tickets?: number          // Historical ticket count used as base
    avg_check_used?: number        // Current average check (últimas 4 semanas)
    ticket_growth_factor?: number  // Traffic growth factor (tickets only, immune to price inflation)
    holiday_multiplier?: number    // Holiday impact multiplier (1.0 = no impact)
    weather_factor?: number        // Weather factor (1.0 = no impact)
    methodology?: string           // 'ticket-based' | 'dollar-fallback'
    confidence_low?: number
    confidence_high?: number
    sample_size?: number
}

function ticketCount(row: any): number {
    const direct = Number(row?.order_count ?? row?.total_tickets)
    if (Number.isFinite(direct) && direct > 0) return direct
    if (!row?.hourly_tickets || typeof row.hourly_tickets !== 'object') return 0
    return Object.values(row.hourly_tickets).reduce<number>((sum, value) => {
        const numeric = Number(value)
        return sum + (Number.isFinite(numeric) && numeric > 0 ? numeric : 0)
    }, 0)
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
export async function generateSmartForecast(storeId: string, targetDateStr: string, forceRecalculate: boolean = false): Promise<DayForecast> {
    const supabase = getSupabase()
    // FORCE NOON to avoid Timezone Shift (e.g. UTC midnight -> Previous Day 4pm PST)
    const targetDate = new Date(targetDateStr + 'T12:00:00')

    let lockedTotalSales = null;
    let lockedHourlyData = null;

    if (!forceRecalculate) {
        // 🌟 MASTER FIX: SINGLE SOURCE OF TRUTH (CACHE PRIORITY) 🌟
        // Before doing any complex math, check if we already have a locked/cached projection.
        const { data: cachedProj } = await supabase
            .from('sales_projections_cache')
            .select('total_sales, hourly_data, meta')
            .eq('store_id', storeId)
            .eq('business_date', targetDateStr)
            .single()

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
                const cachedEntries = Array.isArray(lockedHourlyData)
                    ? lockedHourlyData.map((row: any) => [row?.hour, row?.projected_sales, row?.projected_tickets] as const)
                    : Object.entries(lockedHourlyData).map(([hour, sales]) => [hour, sales, undefined] as const)
                cachedEntries.forEach(([hStr, pSales, pTickets]) => {
                    const hour = Number(hStr)
                    const sales = Number(pSales)
                    if (!Number.isFinite(hour) || !Number.isFinite(sales) || sales < 0) return
                    const cachedTickets = Number(pTickets)
                    const tickets = Number.isFinite(cachedTickets) && cachedTickets >= 0 ? cachedTickets : sales / 25
                    // Reverse calculate required staff (approximate)
                    const reqK = Math.ceil(sales / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)
                    const reqF = Math.ceil(tickets / CAPACITY_RULES.CASHIER_TICKETS_PER_HOUR_MEDIAN)
                    
                    hours.push({
                        hour,
                        projected_sales: sales,
                        projected_tickets: tickets,
                        required_kitchen: Math.max(CAPACITY_RULES.MIN_KITCHEN, reqK),
                        required_foh: Math.max(CAPACITY_RULES.MIN_CASHIERS, reqF),
                        reasoning: 'Loaded from Single Source of Truth Cache'
                    })
                })
                hours.sort((a, b) => a.hour - b.hour)
                
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
    let baseTickets = 0 // v3.0: Historical ticket count base
    let currentAvgCheck = 0 // v3.0: Current average check (last 4 weeks same weekday)
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
            .select('business_date, net_sales, order_count, total_tickets, hourly_data, hourly_tickets')
            .eq('store_id', storeId)
            .in('business_date', compDays)
            .gt('net_sales', 0)
        return data || []
    });

    if (historyPoints && historyPoints.length > 0) {
        // Calculate Weighted Average
        let totalWeight = 0
        let weightedSales = 0
        let weightedTickets = 0 // v3.0: Ticket-based base
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
            weightedTickets += (ticketCount(pt) * dayShiftFactor * weight)


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
        baseTickets = totalWeight > 0 ? weightedTickets / totalWeight : 0 // v3.0: Historical ticket count base

        // Normalize hourly
        Object.keys(weightedHrS).forEach(h => hourlySalesDist[h] = weightedHrS[h] / totalWeight)
        Object.keys(weightedHrT).forEach(h => hourlyTicketDist[h] = weightedHrT[h] / totalWeight)



    } else {
        // Strict 0 triggers safety net
        baseSales = 0
    }

    // V3.1 recent comparable anchor: eight completed instances of the same weekday.
    // This is the backtested primary base; annual peers remain available for trend/event context.
    const recentComparableDates = Array.from({ length: 8 }, (_, index) => {
        const date = new Date(targetDate)
        date.setUTCDate(date.getUTCDate() - ((index + 1) * 7))
        return date.toISOString().slice(0, 10)
    })
    const recentComparables = await _cachedQuery(`recent8_${storeId}_${recentComparableDates.join(',')}`, async () => {
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales, order_count, total_tickets, hourly_data, hourly_tickets')
            .eq('store_id', storeId)
            .in('business_date', recentComparableDates)
            .gt('net_sales', 0)
        if (error) throw new Error(`Recent comparable query failed: ${error.message}`)
        return data || []
    })
    if (recentComparables.length >= 4) {
        const ordered = [...recentComparables].sort((a: any, b: any) => a.business_date.localeCompare(b.business_date))
        const observations = ordered.map((row: any, index: number) => ({ value: Number(row.net_sales), weight: index + 1 }))
        const ticketObservations = ordered.map((row: any, index: number) => ({ value: ticketCount(row), weight: index + 1 }))
        baseSales = robustWeightedMean(observations)
        const recentTicketBase = robustWeightedMean(ticketObservations)
        if (recentTicketBase > 0) baseTickets = recentTicketBase

        const hourKeys = new Set<string>()
        ordered.forEach((row: any) => {
            Object.keys(row.hourly_data || {}).forEach(key => hourKeys.add(key))
            Object.keys(row.hourly_tickets || {}).forEach(key => hourKeys.add(key))
        })
        for (const hour of hourKeys) {
            hourlySalesDist[hour] = robustWeightedMean(ordered.map((row: any, index: number) => ({
                value: Number(row.hourly_data?.[hour] || 0), weight: index + 1
            })))
            hourlyTicketDist[hour] = robustWeightedMean(ordered.map((row: any, index: number) => ({
                value: Number(row.hourly_tickets?.[hour] || 0), weight: index + 1
            })))
        }
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
                .select('net_sales, order_count, total_tickets, hourly_data, hourly_tickets')
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
            baseTickets = recentHistory.reduce((sum: number, day: any) => sum + ticketCount(day), 0) / recentHistory.length

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
            .select('business_date, net_sales, order_count, total_tickets, hourly_tickets')
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

    // v3.0: Calculate TICKET growth separately (immune to price inflation)
    // Blend: 60% specific weekday ticket trend + 40% global ticket trend
    let specificTicketTrend = 1.0
    if (recentTrendData && recentTrendData.length > 0) {
        const recentSameWeekdays = recentTrendData.filter((d: any) => {
            const dt = new Date(d.business_date)
            return dt.getUTCDay() === targetDayOfWeek
        })
        // Sum hourly_tickets for recent same weekdays
        let sumRecentTickets = 0, countRecentTickets = 0
        recentSameWeekdays.forEach((d: any) => {
            if (d.hourly_tickets) {
                const dayTickets = Object.values(d.hourly_tickets as Record<string, number>).reduce((a, b) => a + Number(b), 0)
                if (dayTickets > 10) { sumRecentTickets += dayTickets; countRecentTickets++ }
            }
        })
        // Compare to historical comp ticket counts
        let sumHistTickets = 0, countHistTickets = 0
        const safeHP = historyPoints || []
        safeHP.forEach((h: any) => {
            const tickets = ticketCount(h)
            if (tickets > 10) { sumHistTickets += tickets; countHistTickets++ }
        })
        if (countRecentTickets > 0 && countHistTickets > 0) {
            specificTicketTrend = (sumRecentTickets / countRecentTickets) / (sumHistTickets / countHistTickets)
        }
    }
    let globalTicketGrowth = ticketGrowth28 > 0 ? ticketGrowth28 : 1.0
    let growthFactorTickets = (specificTicketTrend * 0.6) + (globalTicketGrowth * 0.4)
    // v3.0: Tighter clamp for tickets (prevents outliers like Slauson +20%)
    growthFactorTickets = Math.min(Math.max(growthFactorTickets, 0.92), 1.15)
    if (earlyCloseHour !== null) {
        growthFactorTickets = Math.min(growthFactorTickets, 1.05)
    }

    // v3.0: Compute currentAvgCheck from last 4 same-weekday actuals
    {
        const avgCheckData = recentTrendData?.filter((d: any) => {
            const dt = new Date(d.business_date)
            return dt.getUTCDay() === targetDayOfWeek
        }) || []
        const fallbackCheck = safeRatio(baseSales, baseTickets, 18.50)
        currentAvgCheck = robustAverageCheck(avgCheckData.map((day: any) => ({
            sales: Number(day.net_sales),
            tickets: ticketCount(day)
        })), fallbackCheck)
    }

    // --- WEATHER INTEL ---
    const { getStoreWeatherForecast } = await import('@/lib/weather')
    let weatherFactor = 1.0
    let weatherNote = null

    try {
        const weather = await getStoreWeatherForecast(storeId, targetDateStr)
        if (weather) {
            // v3.0: Use graduated weatherFactor from weather module (0.70/0.85/0.95/1.0)
            weatherFactor = (weather as any).weatherFactor ?? (weather.isSevere ? 0.95 : 1.0)
            if (weatherFactor < 1.0) {
                weatherNote = `Weather: ${weather.condition} (${weather.precipProb}% precip) → factor ${weatherFactor}`
            }
        }
    } catch (e) {
        // Ignore weather errors, proceed with baseline
    }

    // v3.0: EVENT INTELLIGENCE — Query events for this date
    let eventMultiplier = 1.0
    let eventMethodology = ''
    try {
        const { getEventMultiplier } = await import('@/lib/event-intelligence')
        const isHolidayComp = Boolean(specialEventPeers && specialEventPeers.length > 0)
        const eventResult = await getEventMultiplier(storeId, targetDateStr, isHolidayComp)
        eventMultiplier = eventResult.multiplier
        eventMethodology = eventResult.methodology
    } catch (e) {
        // Event intelligence is optional — if table doesn't exist yet, proceed without it
    }

    // --- HOLIDAY LOGIC: VALENTINE'S DAY ---
    // if (targetMonth === 1 && targetDayOfMonth === 14) {
    //    // Feb 14th - Historical analysis shows inconsistent boost (2021-2025 avg ~+7%)
    //    // Changed from 15% to 7% (Feb 2026 calibration based on 5-year average)
    //    baseSales *= 1.07
    //    Object.keys(hourlySalesDist).forEach(h => hourlySalesDist[h] *= 1.07)
    //    Object.keys(hourlyTicketDist).forEach(h => hourlyTicketDist[h] *= 1.05)
    // }

    // v3.0: TICKET-BASED PROJECTION FORMULA
    // Instead of: baseSales($$) × growthFactor($$)
    // We use:     baseTickets × ticketGrowth × currentAvgCheck × eventMultiplier × weatherFactor
    // This is IMMUNE to price inflation because tickets and avg check are separated
    let projectedTotal: number
    let projectionMethodology = 'dollar-fallback'

    if (baseTickets > 0 && currentAvgCheck > 0) {
        // PRIMARY: Ticket-based (v3.0)
        projectedTotal = baseTickets * growthFactorTickets * currentAvgCheck * eventMultiplier * weatherFactor
        projectionMethodology = 'ticket-based'
    } else {
        // FALLBACK: Dollar-based (v2 legacy) — only when ticket data is unavailable
        projectedTotal = baseSales * growthFactorSales * eventMultiplier * weatherFactor
        projectionMethodology = 'dollar-fallback'
    }

    let overrideMultiplier = 1.0;

    if (!forceRecalculate && lockedTotalSales !== null && lockedTotalSales > 0) {
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
    const parseOperatingHour = (time: string, closing: boolean): number | null => {
        const [hour, minute = 0] = time.split(':').map(Number)
        if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
        return closing && minute > 0 ? hour + 1 : hour
    }

    try {
        const { data: storeInfo } = await supabase
            .from('stores')
            .select('opening_time, closing_time, weekly_hours')
            .eq('external_id', storeId)
            .single()

        if (storeInfo) {
            // 1. Default to standard hours
            if (storeInfo.opening_time) dbOpenHour = parseOperatingHour(storeInfo.opening_time, false)
            if (storeInfo.closing_time) dbCloseHour = parseOperatingHour(storeInfo.closing_time, true)

            // 2. Check for Day-Specific Override in weekly_hours
            // weekly_hours structure: [{ day: 1, open: '10:00', close: '23:00' }, ...]
            // Target Date Day (0=Sun, 1=Mon...)
            const [y, m, d] = targetDateStr.split('-').map(Number)
            const localDate = new Date(y, m - 1, d) // Month is 0-indexed
            const dayOfWeek = localDate.getDay() // 0-6 Sun-Sat

            if (storeInfo.weekly_hours && Array.isArray(storeInfo.weekly_hours)) {
                const dayConfig = storeInfo.weekly_hours.find((c: any) => c.day === dayOfWeek)
                if (dayConfig && dayConfig.open) {
                    dbOpenHour = parseOperatingHour(dayConfig.open, false)
                }
                if (dayConfig && dayConfig.close) {
                    dbCloseHour = parseOperatingHour(dayConfig.close, true)
                }
            }
        }
    } catch (err) {
        // Ignore error, fallback to default/history
    }

    // 4. Build Hourly Projection
    const hours: OperatingHour[] = []

    const normalizeHour = (hour: number | null): number | null => {
        if (hour === null || !Number.isFinite(hour)) return null
        return hour < 6 ? hour + 24 : hour
    }
    const configuredOpen = normalizeHour(dbOpenHour) ?? 6
    let configuredClose = dbCloseHour ?? 30
    if (configuredClose <= configuredOpen) configuredClose += 24
    const effectiveOpen = Math.max(configuredOpen, normalizeHour(lateOpenHour) ?? configuredOpen)
    const effectiveClose = Math.min(configuredClose, normalizeHour(earlyCloseHour) ?? configuredClose)
    const activeHours: number[] = []
    for (let hour = 6; hour < 30; hour++) {
        if (hour >= effectiveOpen && hour < effectiveClose) activeHours.push(hour)
    }

    const historicalValue = (distribution: Record<string, number>, hour: number): number => {
        const extended = Number(distribution[String(hour)])
        const clock = Number(distribution[String(hour >= 24 ? hour - 24 : hour)])
        const value = Number.isFinite(extended) && extended >= 0 ? extended : clock
        return Number.isFinite(value) && value >= 0 ? value : 0
    }

    // Complete gaps in the weight vector before normalization. This preserves the daily total.
    const salesWeights = activeHours.map(hour => historicalValue(hourlySalesDist, hour))
    const ticketWeights = activeHours.map(hour => historicalValue(hourlyTicketDist, hour))
    for (let index = 0; index < activeHours.length; index++) {
        if (salesWeights[index] <= 0 && index > 0 && salesWeights[index - 1] > 0) salesWeights[index] = salesWeights[index - 1] * 0.85
        if (ticketWeights[index] <= 0 && index > 0 && ticketWeights[index - 1] > 0) ticketWeights[index] = ticketWeights[index - 1] * 0.85
    }
    const salesWeightTotal = salesWeights.reduce((sum, value) => sum + value, 0)
    const ticketWeightTotal = ticketWeights.reduce((sum, value) => sum + value, 0)
    const projectedTicketsTotal = currentAvgCheck > 0
        ? safeRatio(projectedTotal, currentAvgCheck, 0)
        : baseTickets * growthFactorTickets * eventMultiplier * weatherFactor

    for (let index = 0; index < activeHours.length; index++) {
        const h = activeHours[index]
        const uniformWeight = activeHours.length > 0 ? 1 / activeHours.length : 0
        const salesRatio = salesWeightTotal > 0 ? salesWeights[index] / salesWeightTotal : uniformWeight
        const ticketRatio = ticketWeightTotal > 0 ? ticketWeights[index] / ticketWeightTotal : salesRatio
        const projSales = projectedTotal * salesRatio
        const projTickets = projectedTicketsTotal * ticketRatio

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

    const finalTotalSales = hours.reduce((acc, h) => acc + h.projected_sales, 0)

    const confidenceScale = safeRatio(finalTotalSales, baseSales, 1)
    const confidence = empiricalConfidenceBand(
        recentComparables.map((row: any) => Number(row.net_sales) * confidenceScale),
        finalTotalSales
    )

    return {
        date: targetDateStr,
        store_id: storeId,
        total_sales: finalTotalSales,
        base_sales: baseSales,
        growth_factor_applied: growthFactorSales,
        weather_adjustment: weatherFactor < 1.0,
        hours,
        // v3.0 Transparency Fields
        base_tickets: baseTickets > 0 ? baseTickets : undefined,
        avg_check_used: currentAvgCheck > 0 ? currentAvgCheck : undefined,
        ticket_growth_factor: growthFactorTickets,
        holiday_multiplier: eventMultiplier !== 1.0 ? eventMultiplier : undefined,
        weather_factor: weatherFactor !== 1.0 ? weatherFactor : undefined,
        methodology: projectionMethodology + (eventMethodology ? ` | ${eventMethodology}` : ''),
        confidence_low: confidence.low,
        confidence_high: confidence.high,
        sample_size: confidence.sampleSize,
    }
}

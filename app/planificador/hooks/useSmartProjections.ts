/**
 * useSmartProjections - Hybrid Hook
 * 
 * PRIMARY: Calls the Intelligence Engine API (/api/projections/generate)
 * FALLBACK: Uses legacy local calculation if API fails
 * 
 * This provides a safe migration path with A/B comparison logging.
 */

import { useState, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { addDays, formatDateISO } from '../lib/utils'
import { checkHoliday } from '../lib/holidayEngine'

// Feature flag: Set to false to disable Intelligence and use only Legacy
const USE_INTELLIGENCE_API = true

export function useSmartProjections(storeGuid: string | undefined, weekStartInput: string | Date) {
    const [projections, setProjections] = useState<Record<string, string>>({})
    const [isGenerating, setIsGenerating] = useState(false)

    // Helper: Parse naive date string "YYYY-MM-DD" to Local Midnight Date
    const parseNaiveDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number)
        return new Date(y, m - 1, d, 0, 0, 0, 0)
    }

    // ========== INTELLIGENCE ENGINE (PRIMARY) ==========
    const generateViaIntelligenceAPI = async (weekStartStr: string, force = false): Promise<Record<string, string> | null> => {
        try {


            const response = await fetch('/api/projections/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storeId: storeGuid,
                    weekStart: weekStartStr,
                    forceRecalc: force
                })
            })

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`)
            }

            const data = await response.json()

            if (!data.success || !data.projections) {
                throw new Error(data.error || 'Invalid API response')
            }

            // Convert numeric projections to strings (for UI compatibility)
            const result: Record<string, string> = {}
            for (const [date, value] of Object.entries(data.projections)) {
                result[date] = String(Math.round(value as number))
            }



            return result

        } catch (error: any) {

            return null
        }
    }

    // ========== LEGACY ENGINE (FALLBACK) ==========
    const generateViaLegacy = async (): Promise<Record<string, string>> => {


        const supabase = await getSupabaseClient()

        // 1. Normalize Start Date
        let targetStart: Date
        if (typeof weekStartInput === 'string') {
            targetStart = parseNaiveDate(weekStartInput)
        } else {
            targetStart = new Date(weekStartInput)
            targetStart.setHours(0, 0, 0, 0)
        }

        const targetEndDay = new Date(targetStart)
        targetEndDay.setDate(targetStart.getDate() + 6)

        const weekStartStr = formatDateISO(targetStart)
        const weekEndStr = formatDateISO(targetEndDay)

        // Lookback: Last 56 days (8 weeks)
        const lookbackStart = new Date(targetStart)
        lookbackStart.setDate(targetStart.getDate() - 56)
        const lookbackEnd = new Date(targetStart)
        lookbackEnd.setDate(targetStart.getDate() - 1)

        // Seasonality: Last year (approx 364 days ago)
        const seasonalStart = new Date(targetStart)
        seasonalStart.setDate(targetStart.getDate() - 364)
        const seasonalEnd = new Date(seasonalStart)
        seasonalEnd.setDate(seasonalStart.getDate() + 7)

        // PARALLEL FETCH
        const [historyRes, weatherRes, eventsRes] = await Promise.all([
            supabase
                .from('sales_daily_cache')
                .select('business_date, net_sales, order_count')
                .eq('store_id', storeGuid)
                .or(`and(business_date.gte.${formatDateISO(lookbackStart)},business_date.lte.${formatDateISO(lookbackEnd)}),and(business_date.gte.${formatDateISO(seasonalStart)},business_date.lte.${formatDateISO(seasonalEnd)})`),

            fetch(`/api/external/weather?storeId=${storeGuid}`),

            supabase
                .from('calendar_events')
                .select('*')
                .or(`store_id.eq.${storeGuid},store_id.is.null`)
                .gte('date', weekStartStr)
                .lte('date', weekEndStr)
        ])

        const history = historyRes.data || []

        // Process Weather
        let weatherData: any[] = []
        if (weatherRes.ok) {
            const wJson = await weatherRes.json()
            weatherData = wJson.data || []
        }

        // Process Events
        const events = eventsRes.data || []

        // 3. Compute Averages per Weekday
        const newProjections: Record<string, string> = {}

        for (let i = 0; i < 7; i++) {
            const dayDate = addDays(targetStart, i)
            const dateStr = formatDateISO(dayDate)

            const targetDayIndex = dayDate.getDay()

            // --- FACTORS ---
            let weatherFactor = 1.0

            const wParams = weatherData.find((w: any) => {
                const wDate = new Date(w.dt * 1000).toISOString().split('T')[0]
                return wDate === dateStr
            })

            if (wParams) {
                const cond = wParams.weather?.[0]?.main?.toLowerCase() || ''
                const tempMax = wParams.temp?.max || 70
                if (cond.includes('rain')) weatherFactor = 0.95
                else if (cond.includes('snow')) weatherFactor = 0.85
                else if (tempMax > 95) weatherFactor = 0.95
            }

            // Event Factor
            let eventFactor = 1.0
            const dayEvents = events.filter((e: any) => e.date === dateStr)
            dayEvents.forEach((e: any) => {
                const mult = Number(e.impact_multiplier) || 1.0
                eventFactor *= mult
            })

            // --- BASE ALGORITHM ---
            const todayStr = formatDateISO(new Date())
            const recentRows = history
                .filter((h: any) => new Date(h.business_date + 'T00:00:00').getDay() === targetDayIndex)
                .filter((h: any) => {
                    const isInRange = h.business_date >= lookbackStart.toISOString().split('T')[0] && h.business_date <= lookbackEnd.toISOString().split('T')[0]
                    const hasSales = Number(h.net_sales) > 100
                    const isPast = h.business_date < todayStr
                    return isInRange && hasSales && isPast
                })
                .sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())

            const seasonalRow = history
                .filter((h: any) => new Date(h.business_date + 'T00:00:00').getDay() === targetDayIndex)
                .find((h: any) => h.business_date >= seasonalStart.toISOString().split('T')[0] && h.business_date <= seasonalEnd.toISOString().split('T')[0])

            // Component 1: Recent Weighted
            const weights = [0.40, 0.20, 0.15, 0.10, 0.05, 0.05, 0.03, 0.02]
            let wRecentSales = 0, tWeight = 0

            recentRows.forEach((row: any, idx: number) => {
                if (idx < weights.length) {
                    const sales = Number(row.net_sales) || 0
                    wRecentSales += sales * weights[idx]
                    tWeight += weights[idx]
                }
            })

            const finalRecentSales = tWeight > 0 ? wRecentSales / tWeight : 0

            // Component 2: Seasonal
            const sSales = Number(seasonalRow?.net_sales) || 0

            // Component 3: Trend (DAMPENED for stability)
            const firstPeriod = recentRows.slice(0, 2).reduce((a: number, b: any) => a + Number(b.net_sales), 0) / 2
            const secondPeriod = recentRows.slice(2, 6).reduce((a: number, b: any) => a + Number(b.net_sales), 0) / 4

            let trendFactor = 1.0
            if (secondPeriod > 0) {
                const rawTrend = firstPeriod / secondPeriod
                trendFactor = 1.0 + (rawTrend - 1.0) * 0.5
                trendFactor = Math.max(0.90, Math.min(1.10, trendFactor))
            }

            // Ensemble
            let projSales = 0
            const isSeasonalValid = sSales > 0 && sSales > (finalRecentSales * 0.5)

            if (isSeasonalValid) {
                projSales = (finalRecentSales * 0.7 + sSales * 0.3) * (finalRecentSales > 0 ? trendFactor : 1)
            } else {
                projSales = finalRecentSales * trendFactor
            }

            // --- SAFETY CAP ---
            const baselineMax = Math.max(finalRecentSales, sSales)
            if (baselineMax > 0 && projSales > baselineMax * 1.20) {
                projSales = baselineMax * 1.20
            }

            // --- HOLIDAY RULES ENGINE ---
            const holidayRule = checkHoliday(new Date(dateStr + 'T12:00:00'))

            let finalEventFactor = 1.0

            if (dayEvents.length > 0) {
                dayEvents.forEach((e: any) => {
                    const mult = Number(e.impact_multiplier) || 1.0
                    finalEventFactor *= mult
                })
                if (holidayRule.factor === 0.0) finalEventFactor = 0.0
            } else {
                finalEventFactor = holidayRule.factor
            }

            // APPLY FACTORS
            projSales = projSales * weatherFactor * finalEventFactor

            if (projSales > 0) {
                newProjections[dateStr] = Math.round(projSales).toString()
            }
        }


        return newProjections
    }

    // ========== MAIN GENERATOR (Hybrid Strategy) ==========
    const generateSmartProjections = useCallback(async (force = false) => {
        if (!storeGuid) return

        setIsGenerating(true)

        // Normalize weekStart to string
        let weekStartStr: string
        if (typeof weekStartInput === 'string') {
            weekStartStr = weekStartInput
        } else {
            const d = new Date(weekStartInput)
            weekStartStr = formatDateISO(d)
        }

        let newProjections: Record<string, string> = {}

        // TRY INTELLIGENCE FIRST (if enabled)
        if (USE_INTELLIGENCE_API) {
            const intelligenceResult = await generateViaIntelligenceAPI(weekStartStr, force)

            if (intelligenceResult && Object.keys(intelligenceResult).length > 0) {
                newProjections = intelligenceResult

            } else {
                // FALLBACK TO LEGACY

                newProjections = await generateViaLegacy()
            }
        } else {
            // INTELLIGENCE DISABLED - Use Legacy directly
            newProjections = await generateViaLegacy()
        }


        if (Object.keys(newProjections).length > 0) {
            setProjections(prev => ({ ...prev, ...newProjections }))
        }

        setIsGenerating(false)
        return newProjections

    }, [storeGuid, weekStartInput])

    return { projections, setProjections, calculateProjections: generateSmartProjections, isGenerating }
}

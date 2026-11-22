/**
 * @module useSmartProjections
 * @description Hook del Planificador que obtiene proyecciones desde Intelligence v3.1, gestiona bloqueos estáticos
 *   manuales por día (`manual_override`) sincronizados con `sales_projections_cache` y `weekly_budgets`,
 *   y conserva el cálculo legado únicamente como contingencia sin pisar días bloqueados manualmente.
 *
 * @businessRules
 *   - Día laboral: 6:00 AM a 5:59 AM del siguiente día (`America/Los_Angeles`).
 *   - Días movidos manualmente por el Manager/Supervisor quedan fijos (`manual: true`) y jamás son sobreescritos
 *     por recargas, cambios de semana/tienda ni por el botón general de recálculo (`forceRecalc`).
 *   - Cada día manual conserva `aiBaseSales` para auditoría transparente y restauración de 1 clic (`unlock`).
 *
 * @dataFlow
 *   Planificador -> `/api/projections/generate` & `/api/projections/override` -> `sales_projections_cache` + `weekly_budgets`.
 *
 * @notes
 *   - Limpia las proyecciones al cambiar de tienda o semana para evitar acumular fechas de otras semanas en `weekly_budgets`.
 */

import { useState, useCallback, useRef } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { addDays, formatDateISO } from '../lib/utils'
import { checkHoliday } from '../lib/holidayEngine'

const USE_INTELLIGENCE_API = true

export interface ProjectionOverrideMeta {
    manual: boolean
    aiBaseSales: number
    overriddenBy?: string
    overriddenAt?: string
}

export interface SaveManualProjectionResult {
    ok: boolean
    totalSales?: number
    aiBaseSales?: number
    errorCode?: string
    minAllowed?: number
    maxAllowed?: number
    message?: string
}

export function useSmartProjections(storeGuid: string | undefined, weekStartInput: string | Date) {
    const [projections, setProjections] = useState<Record<string, string>>({})
    const [projectionOverrides, setProjectionOverrides] = useState<Record<string, ProjectionOverrideMeta>>({})
    const [isGenerating, setIsGenerating] = useState(false)
    const [savingProjectionDate, setSavingProjectionDate] = useState<string | null>(null)
    const overridesRef = useRef<Record<string, ProjectionOverrideMeta>>({})

    const updateOverridesState = (next: Record<string, ProjectionOverrideMeta>) => {
        overridesRef.current = next
        setProjectionOverrides(next)
    }

    const parseNaiveDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number)
        return new Date(y, m - 1, d, 0, 0, 0, 0)
    }

    // ========== INTELLIGENCE ENGINE (PRIMARY) ==========
    const generateViaIntelligenceAPI = async (
        weekStartStr: string,
        force = false
    ): Promise<{ projections: Record<string, string>; overrides: Record<string, ProjectionOverrideMeta> } | null> => {
        try {
            const response = await fetch('/api/projections/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('teg_token') || ''}`
                },
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

            if (!data.success || data.partial || !data.projections) {
                throw new Error(data.error || 'Invalid API response')
            }

            const result: Record<string, string> = {}
            for (const [date, value] of Object.entries(data.projections)) {
                result[date] = String(Math.round(value as number))
            }

            const overridesMap: Record<string, ProjectionOverrideMeta> = {}
            if (data.overrides && typeof data.overrides === 'object') {
                for (const [date, meta] of Object.entries(data.overrides as Record<string, any>)) {
                    if (meta?.manual) {
                        overridesMap[date] = {
                            manual: true,
                            aiBaseSales: Math.round(Number(meta.aiBaseSales ?? result[date] ?? 0)),
                            overriddenBy: meta.overriddenBy,
                            overriddenAt: meta.overriddenAt,
                        }
                    }
                }
            }

            return { projections: result, overrides: overridesMap }
        } catch {
            return null
        }
    }

    // ========== LEGACY ENGINE (FALLBACK) ==========
    const generateViaLegacy = async (): Promise<Record<string, string>> => {
        const supabase = await getSupabaseClient()

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

        const lookbackStart = new Date(targetStart)
        lookbackStart.setDate(targetStart.getDate() - 56)
        const lookbackEnd = new Date(targetStart)
        lookbackEnd.setDate(targetStart.getDate() - 1)

        const seasonalStart = new Date(targetStart)
        seasonalStart.setDate(targetStart.getDate() - 364)
        const seasonalEnd = new Date(seasonalStart)
        seasonalEnd.setDate(seasonalStart.getDate() + 7)

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

        let weatherData: any[] = []
        if (weatherRes.ok) {
            const wJson = await weatherRes.json()
            weatherData = wJson.data || []
        }

        const events = eventsRes.data || []
        const newProjections: Record<string, string> = {}

        for (let i = 0; i < 7; i++) {
            const dayDate = addDays(targetStart, i)
            const dateStr = formatDateISO(dayDate)
            const targetDayIndex = dayDate.getDay()

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

            const dayEvents = events.filter((e: any) => e.date === dateStr)
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
            const sSales = Number(seasonalRow?.net_sales) || 0

            const firstPeriod = recentRows.slice(0, 2).reduce((a: number, b: any) => a + Number(b.net_sales), 0) / 2
            const secondPeriod = recentRows.slice(2, 6).reduce((a: number, b: any) => a + Number(b.net_sales), 0) / 4

            let trendFactor = 1.0
            if (secondPeriod > 0) {
                const rawTrend = firstPeriod / secondPeriod
                trendFactor = 1.0 + (rawTrend - 1.0) * 0.5
                trendFactor = Math.max(0.90, Math.min(1.10, trendFactor))
            }

            let projSales = 0
            const isSeasonalValid = sSales > 0 && sSales > (finalRecentSales * 0.5)

            if (isSeasonalValid) {
                projSales = (finalRecentSales * 0.7 + sSales * 0.3) * (finalRecentSales > 0 ? trendFactor : 1)
            } else {
                projSales = finalRecentSales * trendFactor
            }

            const baselineMax = Math.max(finalRecentSales, sSales)
            if (baselineMax > 0 && projSales > baselineMax * 1.20) {
                projSales = baselineMax * 1.20
            }

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

            projSales = projSales * weatherFactor * finalEventFactor

            if (projSales >= 0) {
                newProjections[dateStr] = Math.round(projSales).toString()
            }
        }

        return newProjections
    }

    // ========== MAIN GENERATOR (Hybrid Strategy) ==========
    const generateSmartProjections = useCallback(async (force = false) => {
        if (!storeGuid) return

        setIsGenerating(true)
        try {
            let weekStartStr: string
            if (typeof weekStartInput === 'string') {
                weekStartStr = weekStartInput
            } else {
                const d = new Date(weekStartInput)
                weekStartStr = formatDateISO(d)
            }

            let newProjections: Record<string, string> = {}
            let newOverrides: Record<string, ProjectionOverrideMeta> = {}

            if (USE_INTELLIGENCE_API) {
                const intelligenceResult = await generateViaIntelligenceAPI(weekStartStr, force)
                if (intelligenceResult && Object.keys(intelligenceResult.projections).length > 0) {
                    newProjections = intelligenceResult.projections
                    newOverrides = intelligenceResult.overrides
                } else {
                    newProjections = await generateViaLegacy()
                    newOverrides = overridesRef.current
                }
            } else {
                newProjections = await generateViaLegacy()
                newOverrides = overridesRef.current
            }

            if (Object.keys(newProjections).length > 0) {
                setProjections(newProjections)
                updateOverridesState(newOverrides)
            }
            return newProjections
        } finally {
            setIsGenerating(false)
        }
    }, [storeGuid, weekStartInput])

    // ========== MANUAL STATIC OVERRIDE (SET / LOCK) ==========
    const saveManualProjection = useCallback(async (
        dateStr: string,
        rawAmount: string | number
    ): Promise<SaveManualProjectionResult> => {
        if (!storeGuid || !dateStr) {
            return { ok: false, message: 'Missing store or date' }
        }
        const cleanNumber = Math.round(Number(String(rawAmount).replace(/[^0-9.]/g, '')))
        if (!Number.isFinite(cleanNumber) || cleanNumber < 0) {
            return { ok: false, message: 'Invalid amount' }
        }

        setSavingProjectionDate(dateStr)
        try {
            const res = await fetch('/api/projections/override', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('teg_token') || ''}`
                },
                body: JSON.stringify({
                    storeId: storeGuid,
                    businessDate: dateStr,
                    action: 'set',
                    totalSales: cleanNumber,
                })
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.success) {
                return {
                    ok: false,
                    errorCode: data.error,
                    minAllowed: data.minAllowed,
                    maxAllowed: data.maxAllowed,
                    aiBaseSales: data.aiBaseSales,
                    message: data.message || data.error || 'Error saving manual projection',
                }
            }

            const lockedVal = String(Math.round(Number(data.totalSales)))
            setProjections(prev => ({ ...prev, [dateStr]: lockedVal }))
            updateOverridesState({
                ...overridesRef.current,
                [dateStr]: {
                    manual: true,
                    aiBaseSales: Math.round(Number(data.aiBaseSales ?? cleanNumber)),
                    overriddenBy: data.overriddenBy,
                    overriddenAt: data.overriddenAt,
                }
            })

            return {
                ok: true,
                totalSales: Math.round(Number(data.totalSales)),
                aiBaseSales: Math.round(Number(data.aiBaseSales ?? cleanNumber)),
            }
        } catch (err: any) {
            return { ok: false, message: err?.message || 'Network error' }
        } finally {
            setSavingProjectionDate(null)
        }
    }, [storeGuid])

    // ========== UNLOCK MANUAL OVERRIDE (RESTORE AI) ==========
    const unlockManualProjection = useCallback(async (
        dateStr: string
    ): Promise<SaveManualProjectionResult> => {
        if (!storeGuid || !dateStr) {
            return { ok: false, message: 'Missing store or date' }
        }

        setSavingProjectionDate(dateStr)
        try {
            const res = await fetch('/api/projections/override', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('teg_token') || ''}`
                },
                body: JSON.stringify({
                    storeId: storeGuid,
                    businessDate: dateStr,
                    action: 'unlock',
                })
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.success) {
                return { ok: false, message: data.error || 'Error unlocking projection' }
            }

            const restored = Math.round(Number(data.totalSales) || 0)
            setProjections(prev => ({ ...prev, [dateStr]: String(restored) }))
            const nextOverrides = { ...overridesRef.current }
            delete nextOverrides[dateStr]
            updateOverridesState(nextOverrides)

            return {
                ok: true,
                totalSales: restored,
                aiBaseSales: restored,
            }
        } catch (err: any) {
            return { ok: false, message: err?.message || 'Network error' }
        } finally {
            setSavingProjectionDate(null)
        }
    }, [storeGuid])

    return {
        projections,
        setProjections,
        projectionOverrides,
        savingProjectionDate,
        saveManualProjection,
        unlockManualProjection,
        calculateProjections: generateSmartProjections,
        isGenerating
    }
}

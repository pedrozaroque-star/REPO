/**
 * @module app/planificador/components/SalesDetailModal
 * @description Modal showing hourly sales trend, projected pace, and labor curve for a specific store and date from the planner budget bar.
 * @businessRules
 * - Shows 23 hours from 7:00 AM to 5:00 AM of the next day.
 * - Projected hourly pace must be parsed ONCE per store to avoid multiplying projections across 24 hourly rows.
 * - Dynamically switches between 'today' (intraday pace tracking) and 'custom' for past/future dates.
 * @dataFlow
 * - Store ID + Date -> GET /api/ventas?storeIds=...&startDate=...&endDate=...&groupBy=hour -> SalesCharts.
 */
'use client'

import React, { useState, useEffect } from 'react'
import { X, RefreshCw, TrendingUp } from 'lucide-react'
import SalesCharts from '@/components/sales/SalesCharts'
import { useLanguage } from '@/lib/i18n'
import SurpriseLoader from '@/components/SurpriseLoader'

interface SalesDetailModalProps {
    isOpen: boolean
    onClose: () => void
    storeGuid: string
    date: string
    storeName?: string
}

export function SalesDetailModal({ isOpen, onClose, storeGuid, date, storeName }: SalesDetailModalProps) {
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<any>(null)
    const { t } = useLanguage()

    const fetchData = async () => {
        if (!isOpen || !storeGuid || !date) return
        setLoading(true)
        try {
            const token = localStorage.getItem('teg_token')
            const query = new URLSearchParams({
                storeIds: storeGuid,
                startDate: date,
                endDate: date,
                groupBy: 'hour'
            })

            const res = await fetch(`/api/ventas?${query}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            const json = await res.json()

            if (json.data) {
                const processed = processData(json.data, date)
                setData(processed)
            }
        } catch (e) {
            console.error('Error fetching modal sales data:', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (isOpen) {
            fetchData()
        }
    }, [isOpen, storeGuid, date])

    // Canonical processData aligning with app/ventas/page.tsx
    const processData = (rawRows: any[], referenceDate: string) => {
        if (!rawRows || rawRows.length === 0) return []

        // If multiple stores are in response, filter by the target store
        const rows = storeGuid && storeGuid !== 'all'
            ? rawRows.filter((r: any) =>
                r.storeId === storeGuid ||
                (storeName && r.storeName?.toLowerCase() === storeName.toLowerCase())
            )
            : rawRows

        const effectiveRows = rows.length > 0 ? rows : rawRows

        const nextDate = new Date(referenceDate + 'T00:00:00')
        nextDate.setDate(nextDate.getDate() + 1)
        const nextDateStr = nextDate.toISOString().split('T')[0]

        const trendMap = new Map<string, { amount: number, labor: number }>()
        const projMap = new Map<string, number>()

        // Standard Business Day Operating Hours: 7 AM to 5 AM (next day)
        const hoursOfInterest = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

        hoursOfInterest.forEach(h => {
            const isNextDay = h < 6
            const dateP = isNextDay ? nextDateStr : referenceDate
            const timeKey = `${dateP} ${h.toString().padStart(2, '0')}:00`
            trendMap.set(timeKey, { amount: 0, labor: 0 })
            projMap.set(timeKey, 0)
        })

        // 1. Distribute Net Sales per Hourly Row
        effectiveRows.forEach((row: any) => {
            const rowPeriod = row.periodStart || ''
            if (rowPeriod && trendMap.has(rowPeriod)) {
                const bucket = trendMap.get(rowPeriod)!
                bucket.amount += (Number(row.netSales) || 0)
            }
        })

        // 2. Distribute Hourly Labor via hourlyLabor map
        const storeHourlyLaborMaps = new Map<string, Record<number, number>>()
        effectiveRows.forEach((row: any) => {
            if (row.hourlyLabor && Object.keys(row.hourlyLabor).length > 0 && !storeHourlyLaborMaps.has(row.storeId)) {
                storeHourlyLaborMaps.set(row.storeId, row.hourlyLabor)
            }
        })

        effectiveRows.forEach((row: any) => {
            const rowPeriod = row.periodStart || ''
            if (rowPeriod && trendMap.has(rowPeriod)) {
                const bucket = trendMap.get(rowPeriod)!
                const hourlyLaborMap = storeHourlyLaborMaps.get(row.storeId)
                if (hourlyLaborMap) {
                    const hourStr = rowPeriod.split(' ')[1]?.split(':')[0]
                    const hour = parseInt(hourStr || '0', 10)
                    bucket.labor += (hourlyLaborMap[hour] || 0)
                } else {
                    bucket.labor += (Number(row.laborCost) || 0)
                }
            }
        })

        // 3. Process Projected Hourly Pace — ONLY ONCE per unique store (prevents multiplying 24x)
        const seenStoresForProj = new Set<string>()
        effectiveRows.forEach((row: any) => {
            if (row.projectedHourly && !seenStoresForProj.has(row.storeId)) {
                seenStoresForProj.add(row.storeId)
                Object.entries(row.projectedHourly).forEach(([h, amount]) => {
                    let hourInt = parseInt(h, 10)
                    let isNext = hourInt < 6
                    if (hourInt >= 24) {
                        hourInt -= 24
                        isNext = true
                    }
                    const dStr = isNext ? nextDateStr : referenceDate
                    const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                    const currentVal = projMap.get(key) || 0
                    projMap.set(key, currentVal + (Number(amount) || 0))
                })
            }
        })

        const trendData = Array.from(trendMap.entries())
            .map(([time, val]) => ({
                time,
                amount: val.amount,
                laborCost: val.labor,
                laborPercentage: val.amount > 0 ? (val.labor / val.amount) * 100 : null,
                projected: projMap.get(time) || 0
            }))
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

        return trendData
    }

    if (!isOpen) return null

    // Determine if date inspected is today in California timezone
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const isToday = date === todayStr
    const chartPeriod = isToday ? 'today' : 'custom'

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="bg-emerald-500 p-2 rounded-xl text-white">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                {t('sales.charts.sales_trend')}
                            </h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {storeName || 'Tacos Gavilan'} • {date}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchData}
                            disabled={loading}
                            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
                            title={t('common.refresh') || 'Refresh'}
                        >
                            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-4 text-slate-500">
                            <SurpriseLoader />
                            <p className="animate-pulse">{t('sales.loading_fetching')}</p>
                        </div>
                    ) : data && data.length > 0 ? (
                        <div className="animate-in slide-in-from-bottom-4 duration-500">
                            <SalesCharts trendData={data} period={chartPeriod} />
                        </div>
                    ) : (
                        <div className="h-64 flex flex-col items-center justify-center text-slate-500 italic">
                            No data available for this date.
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 text-center text-[10px] text-slate-400 uppercase tracking-widest font-semibold">
                    Análisis de Ventas vs Proyecciones • Tacos Gavilan
                </div>
            </div>
        </div>
    )
}

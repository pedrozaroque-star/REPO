'use client'

import React, { useState, useEffect, useMemo } from 'react'
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
                const processed = processData(json.data, 'hour', date)
                setData(processed)
            }
        } catch (e) {
            console.error('Error fetching modal sales data:', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [isOpen, storeGuid, date])

    // Simplified processData from app/ventas/page.tsx
    const processData = (rows: any[], groupByMode: string, referenceDate: string) => {
        const nextDate = new Date(referenceDate + 'T00:00:00')
        nextDate.setDate(nextDate.getDate() + 1)
        const nextDateStr = nextDate.toISOString().split('T')[0]

        const trendMap = new Map<string, { amount: number, labor: number }>()
        const projMap = new Map<string, number>()

        // Horas de interés: 7 AM a 5 AM (next day)
        const hoursOfInterest = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

        hoursOfInterest.forEach(h => {
            const isNextDay = h < 6
            const dateP = isNextDay ? nextDateStr : referenceDate
            const timeKey = `${dateP} ${h.toString().padStart(2, '0')}:00`
            trendMap.set(timeKey, { amount: 0, labor: 0 })
            projMap.set(timeKey, 0)
        })

        rows.forEach((row: any) => {
            if (row.hourlySales) {
                Object.entries(row.hourlySales).forEach(([h, amount]) => {
                    const hourInt = parseInt(h)
                    const isNext = hourInt < 6
                    const dStr = isNext ? nextDateStr : referenceDate
                    const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                    const bucket = trendMap.get(key)
                    if (bucket) bucket.amount += (Number(amount) || 0)
                })
            }

            if (row.hourlyLabor) {
                Object.entries(row.hourlyLabor).forEach(([h, cost]) => {
                    const hourInt = parseInt(h)
                    const isNext = hourInt < 6
                    const dStr = isNext ? nextDateStr : referenceDate
                    const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                    const bucket = trendMap.get(key)
                    if (bucket) bucket.labor += (Number(cost) || 0)
                })
            }

            if (row.projectedHourly) {
                Object.entries(row.projectedHourly).forEach(([h, amount]) => {
                    let hourInt = parseInt(h)
                    let isNext = hourInt < 6
                    if (hourInt >= 24) { hourInt -= 24; isNext = true; }
                    const dStr = isNext ? nextDateStr : referenceDate
                    const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                    const current = projMap.get(key) || 0
                    projMap.set(key, current + (Number(amount) || 0))
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
                                {storeName} • {date}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchData}
                            disabled={loading}
                            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
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
                    ) : data ? (
                        <div className="animate-in slide-in-from-bottom-4 duration-500">
                            <SalesCharts trendData={data} period="today" />
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

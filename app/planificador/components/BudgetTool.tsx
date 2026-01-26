'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { addDays, formatDateISO } from '../lib/utils'

export function BudgetTool({ weekStart, shifts, weeklyStats, laborStats, projections, setProjections, actuals, storeId, onRefresh }: any) {
    const [isOpen, setIsOpen] = useState(true)
    const [isSyncing, setIsSyncing] = useState(false)
    const [liveSalesOverride, setLiveSalesOverride] = useState<number | null>(null)
    const hasAutoSynced = useRef(false)

    // --- LOGIC ---
    const handleSync = async (isManual = true) => {
        if (!storeId || isSyncing) return
        setIsSyncing(true)
        try {
            const token = localStorage.getItem('teg_token')
            if (!token) return
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
            const query = new URLSearchParams({ storeIds: 'all', startDate: today, endDate: today, groupBy: 'day' })
            const res = await fetch(`/api/ventas?${query}`, { headers: { 'Authorization': `Bearer ${token}` } })
            if (!res.ok) throw new Error("API Error")
            const json = await res.json()
            const rows = json.data || []
            let targetRow = rows.find((r: any) => r.storeId === storeId)

            if (targetRow && targetRow.netSales > 0) {
                setLiveSalesOverride(targetRow.netSales)
            } else if (isManual) {
                const manual = prompt(`⚠️ API retornó $0. Ingresar manualmente:`)
                if (manual && !isNaN(Number(manual))) setLiveSalesOverride(Number(manual))
            }
            fetch('/api/sync/sales-live', { method: 'POST', body: JSON.stringify({ storeId }) }).catch(console.error)
            if (onRefresh) await onRefresh()
        } catch (e) {
            if (isManual) {
                const manual = prompt(`❌ Error conexión. Ingresar manual:`)
                if (manual && !isNaN(Number(manual))) setLiveSalesOverride(Number(manual))
            }
        } finally {
            setIsSyncing(false)
        }
    }

    const handleManualOverride = () => {
        const manual = prompt('Venta Real HOY:', liveSalesOverride?.toString() || '')
        if (manual && !isNaN(Number(manual))) setLiveSalesOverride(Number(manual))
    }

    useEffect(() => {
        if (!storeId) return
        const todayFn = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        const currentSales = actuals?.[todayFn]?.sales || 0
        if (!hasAutoSynced.current && currentSales === 0 && liveSalesOverride === null) {
            hasAutoSynced.current = true
            handleSync(false)
        }
    }, [storeId, actuals, liveSalesOverride])

    const dailyData = useMemo(() => {
        const days = Array.from({ length: 7 }, (_, i) => {
            const date = addDays(weekStart, i)
            const dateStr = formatDateISO(date)
            const salesProj = parseFloat(projections[dateStr] || '0')
            let salesAct = actuals?.[dateStr]?.sales || 0
            const todayStr = formatDateISO(new Date())
            if (dateStr === todayStr && liveSalesOverride !== null) salesAct = liveSalesOverride
            const schedStats = laborStats[dateStr] || { cost: 0, hours: 0 }
            const actStats = actuals?.[dateStr]?.labor || { cost: 0, hours: 0 }
            const laborPctProj = salesProj > 0 ? (schedStats.cost / salesProj) * 100 : 0
            const laborPctAct = salesAct > 0 ? (actStats.cost / salesAct) * 100 : (salesProj > 0 ? (actStats.cost / salesProj) * 100 : 0)
            const isBurnRate = salesAct === 0 && salesProj > 0
            return { date, dateStr, salesProj, salesAct, costSched: schedStats.cost, costAct: actStats.cost, hoursSched: schedStats.hours, hoursAct: actStats.hours, laborPctProj, laborPctAct, isBurnRate }
        })
        return days
    }, [weekStart, projections, laborStats, actuals, liveSalesOverride])

    // Totals
    const hoursSched = dailyData.reduce((a, d) => a + d.hoursSched, 0)
    const hoursAct = dailyData.reduce((a, d) => a + d.hoursAct, 0)
    const costSched = dailyData.reduce((a, d) => a + d.costSched, 0)
    const costAct = dailyData.reduce((a, d) => a + d.costAct, 0)
    const salesProj = dailyData.reduce((a, d) => a + d.salesProj, 0)
    const salesAct = dailyData.reduce((a, d) => a + d.salesAct, 0)
    const laborPctProj = salesProj > 0 ? (costSched / salesProj) * 100 : 0
    const laborPctAct = salesAct > 0 ? (costAct / salesAct) * 100 : (salesProj > 0 ? (costAct / salesProj) * 100 : 0)

    const totals = { hoursSched, hoursAct, costSched, costAct, salesProj, salesAct, laborPctProj, laborPctAct }

    // Formatters - All with thousand separators except percentages
    const fmtHrs = (n: number) => n > 0 ? `${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h` : '-'
    const fmtMoney = (n: number) => n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : '-'
    const fmtPct = (n: number) => n > 0 ? `${n.toFixed(1)}%` : '-'

    // Color logic
    const getPctColor = (val: number, isBurn = false) => {
        if (isBurn) return 'bg-amber-100 text-amber-700 border-amber-300'
        if (val > 22) return 'bg-red-100 text-red-700 border-red-300'
        return 'bg-emerald-100 text-emerald-700 border-emerald-300'
    }

    return (
        <div className="sticky bottom-4 z-40 mx-4 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-[1px] border-gray-300 dark:border-slate-600 shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_35px_60px_-15px_rgba(0,0,0,0.8)] font-sans text-xs ring-1 ring-black/5 dark:ring-white/10 transition-all duration-500">
            {/* Handle - 3D Button Style */}
            {/* Handle - 3D Button Style */}
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-10 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 border-b-0 rounded-t-xl cursor-pointer flex items-center justify-center gap-2 shadow-[0_-4px_6px_-2px_rgba(0,0,0,0.1)] hover:bg-gray-50 dark:hover:bg-slate-800 transition-all z-50"
            >
                <div className="absolute inset-0 -top-4" /> {/* Invisible extended hit area */}
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Budget</span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            <div className={`transition-all duration-300 overflow-hidden ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                {/* MASTER GRID: Match table columns exactly */}
                <div className="grid grid-cols-[25%_repeat(7,10.7%)]">

                    {/* ROW HEADERS */}
                    <div className="bg-gray-100 dark:bg-slate-900/80 flex flex-col border-r border-gray-300 dark:border-slate-700">
                        {/* Hours Header */}
                        <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-800">
                            <span className="font-bold text-gray-700 uppercase tracking-wide text-sm">Hours</span>
                            <div className="flex gap-2 text-sm">
                                <span className="text-blue-600 font-bold">{fmtHrs(totals.hoursSched)}</span>
                                <span className={`font-bold ${totals.hoursAct > totals.hoursSched ? 'text-red-500' : 'text-emerald-600'}`}>{fmtHrs(totals.hoursAct)}</span>
                            </div>
                        </div>
                        {/* Labor $ Header */}
                        <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-800">
                            <span className="font-bold text-gray-700 uppercase tracking-wide text-sm">Labor $</span>
                            <div className="flex gap-2 text-sm">
                                <span className="text-blue-600 font-bold">{fmtMoney(totals.costSched)}</span>
                                <span className={`font-bold ${totals.costAct > totals.costSched ? 'text-red-500' : 'text-emerald-600'}`}>{fmtMoney(totals.costAct)}</span>
                            </div>
                        </div>
                        {/* Sales Header */}
                        <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-700 uppercase tracking-wide text-sm">Sales</span>
                                <button onClick={() => handleSync(true)} disabled={isSyncing} className={`p-1 rounded hover:bg-gray-200 ${isSyncing ? 'animate-spin text-indigo-500' : 'text-gray-400'}`}>
                                    <RefreshCw size={14} />
                                </button>
                            </div>
                            <div className="flex gap-2 text-sm">
                                <span className="text-blue-600 font-bold">{fmtMoney(totals.salesProj)}</span>
                                <span className={`font-bold ${totals.salesAct < totals.salesProj ? 'text-red-500' : 'text-emerald-600'}`}>{fmtMoney(totals.salesAct)}</span>
                            </div>
                        </div>
                        {/* Labor % Header */}
                        <div className="h-11 flex items-center justify-between px-4">
                            <span className="font-bold text-gray-700 uppercase tracking-wide text-sm">Labor %</span>
                            <div className="flex gap-2 text-sm items-center">
                                <span className="text-blue-600 font-bold">{fmtPct(totals.laborPctProj)}</span>
                                <span className={`px-2 py-0.5 rounded border font-bold ${getPctColor(totals.laborPctAct)}`}>{fmtPct(totals.laborPctAct)}</span>
                            </div>
                        </div>
                    </div>

                    {/* DAYS DATA */}
                    {dailyData.map(day => (
                        <div key={day.dateStr} className="flex flex-col text-center border-r border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">

                            {/* Hours Row */}
                            <div className="h-11 border-b border-gray-100 dark:border-slate-800 grid grid-cols-2 items-center px-1">
                                <span className="text-blue-600 font-bold text-right pr-1 text-sm">{day.hoursSched > 0 ? day.hoursSched.toFixed(1) : '-'}</span>
                                <span className={`font-bold text-left pl-1 text-sm ${day.hoursAct > day.hoursSched ? 'text-red-500' : 'text-emerald-600'}`}>{day.hoursAct > 0 ? day.hoursAct.toFixed(1) : '-'}</span>
                            </div>

                            {/* Labor $ Row */}
                            <div className="h-11 border-b border-gray-100 dark:border-slate-800 grid grid-cols-2 items-center px-1 bg-indigo-50/30 dark:bg-indigo-900/10">
                                <span className="text-blue-600 font-bold text-right pr-1 text-sm">{fmtMoney(day.costSched)}</span>
                                <span className={`font-bold text-left pl-1 text-sm ${day.costAct > day.costSched ? 'text-red-500' : 'text-emerald-600'}`}>{fmtMoney(day.costAct)}</span>
                            </div>

                            {/* Sales Row */}
                            <div className="h-11 border-b border-gray-100 dark:border-slate-800 grid grid-cols-2 items-center px-1">
                                <input
                                    className="h-full bg-transparent text-right pr-1 text-blue-600 font-bold focus:text-blue-800 outline-none w-full text-sm"
                                    placeholder="-"
                                    value={projections[day.dateStr] ? Math.round(Number(projections[day.dateStr])).toLocaleString('en-US') : ''}
                                    onChange={e => {
                                        const val = e.target.value.replace(/[^0-9]/g, '')
                                        setProjections((p: any) => ({ ...p, [day.dateStr]: val }))
                                    }}
                                />
                                <span
                                    className={`font-bold text-left pl-1 cursor-pointer text-xs ${day.salesAct < day.salesProj ? 'text-red-500' : 'text-emerald-600'}`}
                                    onClick={handleManualOverride}
                                >
                                    {day.salesAct > 0 ? fmtMoney(day.salesAct) : '-'}
                                </span>
                            </div>

                            {/* Labor % Row */}
                            <div className="h-11 grid grid-cols-2 items-center px-1">
                                <span className={`text-right pr-1 text-sm font-bold ${day.laborPctProj > 22 ? 'text-red-500' : 'text-blue-600'}`}>{fmtPct(day.laborPctProj)}</span>
                                <div className="text-left pl-1">
                                    {day.laborPctAct > 0 && (
                                        <span className={`px-1.5 py-0.5 rounded border text-xs font-bold ${getPctColor(day.laborPctAct, day.isBurnRate)}`}>
                                            {day.laborPctAct.toFixed(1)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

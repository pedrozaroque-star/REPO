import React, { useState, useMemo } from 'react'
import { ArrowDownAZ, Clock, DollarSign, Activity } from 'lucide-react'
import { addDays, formatDateISO } from '../lib/utils'

export function BudgetTool({ weekStart, shifts, weeklyStats, laborStats, projections, setProjections }: any) {
    const [isOpen, setIsOpen] = useState(true)

    // Compute Daily Totals
    const dailyData = useMemo(() => {
        const days = Array.from({ length: 7 }, (_, i) => {
            const date = addDays(weekStart, i)
            const dateStr = formatDateISO(date)
            // Sales
            const sales = parseFloat(projections[dateStr] || '0')

            // Labor from Parent
            const stats = laborStats[dateStr] || { cost: 0, hours: 0 }
            const cost = stats.cost
            const hours = stats.hours
            const pct = sales > 0 ? (cost / sales) * 100 : 0

            return { date, dateStr, sales, cost, hours, pct }
        })
        return days
    }, [weekStart, projections, laborStats])

    const totalSales = dailyData.reduce((acc, d) => acc + d.sales, 0)
    const totalCost = dailyData.reduce((acc, d) => acc + d.cost, 0)
    const totalHours = dailyData.reduce((acc, d) => acc + d.hours, 0)
    const totalPct = totalSales > 0 ? (totalCost / totalSales) * 100 : 0

    return (
        <div className="sticky bottom-0 z-40 shadow-[0_-15px_40px_-5px_rgba(0,0,0,0.25)] drop-shadow-xl bg-slate-100 dark:bg-slate-800 border-t border-gray-300 dark:border-slate-700 w-[99%] mx-auto">
            <div className="flex w-full">
                {/* LEFT PANEL (Labels + Totals) - Matches 25% min-w-[300px] */}
                <div className="w-[25%] min-w-[300px] shrink-0 border-r border-gray-300 dark:border-slate-700 relative">
                    {/* Toggle Handle */}
                    <div
                        onClick={() => setIsOpen(!isOpen)}
                        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-slate-100 dark:bg-slate-800 border-t border-l border-r border-gray-300 dark:border-slate-700 rounded-t-xl px-4 py-1.5 cursor-pointer flex items-center gap-3 shadow-[0_-8px_15px_-3px_rgba(0,0,0,0.2)] group hover:pb-2 transition-all z-50"
                    >
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${totalPct > 21.5 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                            <span className="text-[11px] font-black uppercase text-gray-600 dark:text-gray-300 tracking-widest group-hover:text-indigo-600 transition-colors">Budget Control</span>
                        </div>
                        <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                            <ArrowDownAZ size={14} className="text-gray-400 group-hover:text-indigo-500" />
                        </div>
                    </div>

                    <div className={`flex h-full divide-x divide-gray-200 dark:divide-slate-700 transition-all duration-300 overflow-hidden ${isOpen ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'}`}>
                        <div className="flex-1 bg-slate-100 dark:bg-slate-800 pr-4 flex flex-col justify-center gap-4 py-3">
                            <div className="h-10 flex items-center justify-end text-xs font-black text-gray-500 uppercase tracking-wide">
                                <Clock size={15} className="mr-2 text-gray-400" /> Scheduled
                            </div>
                            <div className="h-10 flex items-center justify-end text-xs font-black text-indigo-600 uppercase tracking-wide">
                                <DollarSign size={15} className="mr-2 text-indigo-400" /> Projected
                            </div>
                            <div className="h-8 flex items-center justify-end text-xs font-black text-gray-600 uppercase tracking-wide">
                                <Activity size={15} className="mr-2 text-gray-400" /> Labor %
                            </div>
                        </div>

                        <div className="w-[120px] shrink-0 px-2 bg-indigo-50/30 dark:bg-indigo-900/10 flex flex-col gap-4 py-3 text-center">
                            <div className="h-10 flex flex-col justify-center">
                                <span className="text-xl font-black text-gray-900 dark:text-white leading-none">{totalHours.toFixed(0)} <span className="text-xs text-gray-500 font-bold">HRS</span></span>
                                <span className="text-sm font-bold text-gray-600 dark:text-gray-300 mt-0.5">${totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                            </div>
                            <div className="h-10 flex items-center justify-center">
                                <div className="bg-white dark:bg-slate-800 border-2 border-indigo-100 dark:border-indigo-900 rounded-lg px-2 py-1 flex items-center gap-1 shadow-sm w-full justify-center">
                                    <span className="text-xs text-gray-400 font-bold mr-0.5">$</span>
                                    <span className="text-base font-black text-indigo-900 dark:text-indigo-100 truncate">{Math.round(totalSales).toLocaleString('en-US')}</span>
                                </div>
                            </div>
                            <div className="h-8 flex items-center justify-center">
                                <span className={`text-base font-black px-3 py-0.5 rounded-lg border-2 shadow-sm ${totalPct > 21.5
                                    ? 'bg-red-50 border-red-100 text-red-600 dark:bg-red-900/20 dark:border-red-900/50 dark:text-red-400'
                                    : 'bg-green-50 border-green-100 text-green-600 dark:bg-green-900/20 dark:border-green-900/50 dark:text-green-400'
                                    }`}>
                                    {totalPct.toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* DAYS COLUMNS - Matches 10.7% each */}
                {dailyData.map((day, i) => (
                    <div key={day.dateStr} className="w-[10.7%] shrink-0 border-r border-gray-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                        <div className={`flex flex-col gap-4 py-3 text-center relative group hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-all duration-300 overflow-hidden ${isOpen ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'}`}>
                            {/* Scheduled Info */}
                            <div className="h-10 flex flex-col justify-center">
                                <span className="text-lg font-black text-gray-800 dark:text-gray-200">{day.hours.toFixed(0)} <span className="text-[10px] text-gray-500 font-bold">HRS</span></span>
                                <span className="text-xs font-bold text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">${day.cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                            </div>

                            {/* Sales Input */}
                            <div className="h-10 flex items-center justify-center px-1">
                                <div className="relative group/input w-full">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 font-bold group-hover/input:text-indigo-400 transition-colors">$</span>
                                    <input
                                        type="text"
                                        value={projections[day.dateStr] ? Number(projections[day.dateStr]).toLocaleString('en-US') : ''}
                                        onChange={(e) => {
                                            const val = e.target.value.replace(/[^0-9]/g, '')
                                            setProjections((prev: any) => ({ ...prev, [day.dateStr]: val }))
                                        }}
                                        className={`w-full text-sm font-black text-center bg-gray-50 dark:bg-slate-800 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none py-1.5 pl-3 pr-1 transition-all
                                                    ${!projections[day.dateStr] ? 'border-gray-200 text-gray-400' : 'border-indigo-200 text-indigo-700 dark:text-indigo-300 dark:border-indigo-900'}
                                        `}
                                        placeholder="-"
                                    />
                                </div>
                            </div>

                            {/* Labor Result */}
                            <div className="h-8 flex items-center justify-center">
                                <span className={`text-md font-black transition-colors ${day.pct === 0 ? 'text-gray-300' : (day.pct > 21.5 ? 'text-red-500' : 'text-green-500')}`}>
                                    {day.pct > 0 ? `${day.pct.toFixed(0)}%` : '-'}
                                </span>
                            </div>

                            {/* Simple Target Line (Visual Aid) */}
                            {day.pct > 21.5 && (
                                <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500/50 rounded-bl-full animate-pulse" />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

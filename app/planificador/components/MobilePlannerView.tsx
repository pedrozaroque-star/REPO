'use client'

import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Users,
    Clock,
    ChevronRight,
    ChevronLeft,
    Calendar,
    AlertCircle,
    Plus,
    RefreshCcw,
    Bot,
    TrendingUp,
    DollarSign,
    BarChart3
} from 'lucide-react'
import { formatDateISO, formatTime12h, stringToColor } from '../lib/utils'

interface MobilePlannerViewProps {
    shifts: any[]
    employees: any[]
    jobs: any[]
    weekDays: Date[]
    shiftStats: Record<string, any>
    laborStats: Record<string, any>
    projections: Record<string, any>
    actuals: Record<string, any>
    punches?: any[]
    onEditShift: (shift: any, date: Date, empId: string) => void
    onAddShift: (date: Date, empId: string) => void
    onShowSalesDetail: (date: string) => void
    onRefresh: () => void
    onCalculateProjections: () => void
    isExternalLoading?: boolean
}

export function MobilePlannerView({
    shifts,
    employees,
    jobs,
    weekDays,
    shiftStats,
    laborStats,
    projections,
    actuals,
    punches = [],
    onEditShift,
    onAddShift,
    onShowSalesDetail,
    onRefresh,
    onCalculateProjections,
    isExternalLoading
}: MobilePlannerViewProps) {
    const [activeTab, setActiveTab] = useState<'daily' | 'weekly'>('daily')
    const [selectedDateIndex, setSelectedDateIndex] = useState(0)
    const selectedDate = weekDays[selectedDateIndex]
    const dateStr = formatDateISO(selectedDate)

    const dayShifts = useMemo(() => {
        return shifts.filter(s => s.shift_date === dateStr)
    }, [shifts, dateStr])

    const dayProjections = parseFloat(projections[dateStr] || '0')
    const dayActuals = actuals[dateStr]?.sales || 0
    const daySchedStats = laborStats[dateStr] || { cost: 0, hours: 0 }
    const dayActStats = actuals[dateStr]?.labor || { cost: 0, hours: 0 }

    const laborPctProj = dayProjections > 0 ? (daySchedStats.cost / dayProjections) * 100 : 0
    const laborPctAct = dayActuals > 0 ? (dayActStats.cost / dayActuals) * 100 : (dayProjections > 0 ? (dayActStats.cost / dayProjections) * 100 : 0)

    // Weekly Stats Calc - Strictly Filtered by weekDays to ensure parity with Desktop
    const weeklyStats = useMemo(() => {
        let totalProjSales = 0
        let totalActualSales = 0
        let totalHoursSched = 0
        let totalCostSched = 0
        let totalHoursAct = 0
        let totalCostAct = 0

        weekDays.forEach(day => {
            const dStr = formatDateISO(day)

            // Sales
            totalProjSales += parseFloat(projections[dStr] || '0')
            totalActualSales += actuals[dStr]?.sales || 0

            // Scheduled Labor (from dailyLaborStats in page.tsx)
            const sched = laborStats[dStr]
            if (sched) {
                totalHoursSched += sched.hours || 0
                totalCostSched += sched.cost || 0
            }

            // Actual Labor (from useActualStats in page.tsx)
            const act = actuals[dStr]?.labor
            if (act) {
                totalHoursAct += act.hours || 0
                totalCostAct += act.cost || 0
            }
        })

        const totalLaborPctProj = totalProjSales > 0 ? (totalCostSched / totalProjSales) * 100 : 0
        // Parity with Desktop Logic: if no actual sales, use projected sales as baseline for real labor %
        const totalLaborPctAct = totalActualSales > 0
            ? (totalCostAct / totalActualSales) * 100
            : (totalProjSales > 0 ? (totalCostAct / totalProjSales) * 100 : 0)

        return {
            totalProjSales,
            totalActualSales,
            totalHoursSched,
            totalCostSched,
            totalHoursAct,
            totalCostAct,
            totalLaborPctProj,
            totalLaborPctAct
        }
    }, [projections, actuals, laborStats, weekDays])

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950 overflow-hidden font-sans">
            {/* View Switcher Tabs - Premium Style */}
            <div className="bg-white dark:bg-slate-900 px-4 pt-4 flex gap-6 border-b border-gray-200 dark:border-slate-800">
                <button
                    onClick={() => setActiveTab('daily')}
                    className={`pb-3 text-xs font-black tracking-[0.2em] uppercase transition-all relative ${activeTab === 'daily' ? 'text-indigo-600' : 'text-gray-400'
                        }`}
                >
                    Plan Diario
                    {activeTab === 'daily' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-[0_-2px_8px_rgba(79,70,229,0.4)]" />}
                </button>
                <button
                    onClick={() => setActiveTab('weekly')}
                    className={`pb-3 text-xs font-black tracking-[0.2em] uppercase transition-all relative ${activeTab === 'weekly' ? 'text-indigo-600' : 'text-gray-400'
                        }`}
                >
                    Budget Semanal
                    {activeTab === 'weekly' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full shadow-[0_-2px_8px_rgba(79,70,229,0.4)]" />}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
                {activeTab === 'daily' ? (
                    <div className="p-4 space-y-4 pb-32">
                        {/* Day Selector Bar - Native feel */}
                        <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm rounded-2xl p-1.5 border border-gray-100 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar px-1">
                                {weekDays.map((date, i) => {
                                    const isSelected = i === selectedDateIndex
                                    const dayName = date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')
                                    const dayNum = date.getDate()
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => setSelectedDateIndex(i)}
                                            className={`flex-1 min-w-[45px] flex flex-col items-center py-2.5 rounded-xl transition-all ${isSelected
                                                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-200 dark:shadow-none font-bold scale-105'
                                                : 'text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800'
                                                }`}
                                        >
                                            <span className="text-[9px] uppercase tracking-tighter mb-0.5">{dayName}</span>
                                            <span className="text-[15px] font-black">{dayNum}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Day Stats - Pixel Perfect Replication of Daily Budget Table */}
                        <motion.div
                            whileTap={{ scale: 0.99 }}
                            onClick={() => onShowSalesDetail(dateStr)}
                            className="bg-white dark:bg-slate-900 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border border-gray-200 dark:border-slate-800 overflow-hidden"
                        >
                            {/* Header representing the 'Budget Tool' look for the day */}
                            <div className="bg-indigo-600 px-5 py-3 text-white flex justify-between items-center">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Métricas del Día</h3>
                                <div className="flex gap-12 text-[9px] font-black uppercase tracking-widest text-indigo-100">
                                    <span className="w-16 text-right">Plan</span>
                                    <span className="w-16 text-right">Actuals</span>
                                </div>
                            </div>

                            <div className="divide-y divide-gray-100 dark:divide-slate-800">
                                {/* HOURS ROW */}
                                <div className="flex items-center justify-between px-5 py-3.5">
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Hours</span>
                                    <div className="flex gap-10">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            {daySchedStats.hours.toFixed(1)}h
                                        </span>
                                        <span className={`text-[15px] font-black w-20 text-right ${dayActStats.hours > 0 ? (dayActStats.hours > daySchedStats.hours ? 'text-red-500' : 'text-emerald-600') : 'text-gray-300'}`}>
                                            {dayActStats.hours > 0 ? `${dayActStats.hours.toFixed(1)}h` : '-'}
                                        </span>
                                    </div>
                                </div>

                                {/* LABOR $ ROW */}
                                <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50/30 dark:bg-slate-900/50">
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Labor $</span>
                                    <div className="flex gap-10">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            ${Math.round(daySchedStats.cost).toLocaleString('en-US')}
                                        </span>
                                        <span className={`text-[15px] font-black w-20 text-right ${dayActStats.cost > 0 ? (dayActStats.cost > daySchedStats.cost ? 'text-red-500' : 'text-emerald-600') : 'text-gray-300'}`}>
                                            {dayActStats.cost > 0 ? `$${Math.round(dayActStats.cost).toLocaleString('en-US')}` : '-'}
                                        </span>
                                    </div>
                                </div>

                                {/* SALES ROW */}
                                <div className="flex items-center justify-between px-5 py-3.5">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Sales</span>
                                        <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-slate-800 rounded-lg">
                                            <button onClick={(e) => { e.stopPropagation(); onRefresh(); }} className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-md text-indigo-500 transition-colors">
                                                <RefreshCcw size={13} className={isExternalLoading ? 'animate-spin' : ''} />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); onCalculateProjections(); }} className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-md text-purple-500 transition-colors">
                                                <Bot size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-10">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            ${Math.round(Number(dayProjections)).toLocaleString('en-US')}
                                        </span>
                                        <span className={`text-[15px] font-black w-20 text-right ${dayActuals > 0 ? (dayActuals < dayProjections ? 'text-red-500' : 'text-emerald-500') : 'text-gray-300'}`}>
                                            {dayActuals > 0 ? `$${Math.round(dayActuals).toLocaleString('en-US')}` : '-'}
                                        </span>
                                    </div>
                                </div>

                                {/* LABOR % ROW */}
                                <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50/30 dark:bg-slate-900/50">
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Labor %</span>
                                    <div className="flex gap-10 items-center">
                                        <span className={`text-[15px] font-black w-20 text-right ${laborPctProj > 22 ? 'text-red-500' : 'text-blue-600'}`}>
                                            {laborPctProj.toFixed(1)}%
                                        </span>
                                        <div className="w-20 flex justify-end">
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-black border-2 ${laborPctAct > 22
                                                ? 'bg-red-100 text-red-700 border-red-300'
                                                : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                                }`}>
                                                {laborPctAct.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="px-5 py-2 bg-gray-100 dark:bg-slate-800 flex justify-center items-center gap-2 group">
                                <BarChart3 size={12} className="text-gray-400 group-hover:text-indigo-500 transition-colors" />
                                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 group-hover:text-indigo-500 transition-colors">Toca para ver detalle de ventas</span>
                            </div>
                        </motion.div>

                        {/* Employee List */}
                        <div className="space-y-4 mt-6">
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                    <Users size={14} className="text-gray-400" />
                                    <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">Equipo Programado</h3>
                                </div>
                                <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1 rounded-full uppercase tracking-widest border border-indigo-100 dark:border-indigo-800">
                                    {employees.filter(emp => shifts.some(s => s.employee_id === emp.id && s.shift_date === dateStr)).length} Activos
                                </span>
                            </div>

                            <div className="space-y-2.5">
                                {employees.map((emp, idx) => {
                                    const empShifts = dayShifts.filter(s => s.employee_id === emp.id)
                                    const jobGuid = emp.job_references?.[0]?.guid
                                    const job = jobs.find(j => j.guid === jobGuid)
                                    const jobTitle = job?.title || 'Rol'
                                    const jobColor = stringToColor(jobTitle)

                                    let matchedPunch = null;
                                    let realIn = '';
                                    let realOut = '';

                                    const formatRealTime = (isoString?: string) => {
                                        if (!isoString) return null;
                                        return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', '');
                                    };

                                    if (punches && punches.length > 0 && empShifts.length > 0) {
                                        matchedPunch = punches.find((p: any) => p.employee_toast_guid === emp.toast_guid && p.business_date === empShifts[0].shift_date);
                                        if (matchedPunch) {
                                            if (matchedPunch.clock_in) realIn = formatRealTime(matchedPunch.clock_in) || '';
                                            if (matchedPunch.clock_out) realOut = formatRealTime(matchedPunch.clock_out) || '';
                                        }
                                    }

                                    return (
                                        <motion.div
                                            key={emp.id}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: idx * 0.05 }}
                                            whileTap={{ scale: 0.98 }}
                                            className="bg-white dark:bg-slate-900/80 rounded-2xl border border-gray-100 dark:border-slate-800 p-3.5 shadow-sm transition-all active:shadow-inner"
                                            onClick={() => {
                                                if (empShifts.length > 0) {
                                                    onEditShift(empShifts[0], selectedDate, emp.id)
                                                } else {
                                                    onAddShift(selectedDate, emp.id)
                                                }
                                            }}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="relative">
                                                    <div
                                                        className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black text-[15px] shrink-0 shadow-lg"
                                                        style={{ background: `linear-gradient(135deg, ${jobColor}, ${jobColor}dd)` }}
                                                    >
                                                        {emp.first_name?.[0]}{emp.last_name?.[0]}
                                                    </div>
                                                    {empShifts.length > 0 && (
                                                        <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-green-500 border-2 border-white dark:border-slate-900 rounded-full flex items-center justify-center shadow-sm">
                                                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-black text-gray-900 dark:text-white text-[15px] truncate tracking-tight">
                                                        {emp.chosen_name || emp.first_name} {emp.last_name}
                                                    </h4>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span
                                                            className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border"
                                                            style={{ color: jobColor, borderColor: `${jobColor}40`, backgroundColor: `${jobColor}10` }}
                                                        >
                                                            {jobTitle}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    {empShifts.length > 0 ? (
                                                        <div className="flex flex-col items-end">
                                                            <div className="px-2.5 py-1.5 bg-indigo-50/50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100/50 dark:border-indigo-800/30">
                                                                <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-black text-[11px] tracking-tight uppercase">
                                                                    <Clock size={12} />
                                                                    {formatTime12h(empShifts[0].start_time)} - {formatTime12h(empShifts[0].end_time)}
                                                                </div>
                                                            </div>

                                                            {/* ACTUAL PUNCH OVERLAY */}
                                                            {(realIn || realOut) && (
                                                                <div className="text-[10px] font-black tracking-tight flex items-center gap-1 text-sky-600 dark:text-sky-400 mt-1" title="Entrada / Salida Real">
                                                                    {realIn || '--'} <span className="text-sky-400/70 dark:text-sky-600/70 font-normal">➔</span> {realOut || '--'}
                                                                </div>
                                                            )}

                                                            {/* BREAKS OVERLAY (MINIMALIST) */}
                                                            {matchedPunch?.breaks && Array.isArray(matchedPunch.breaks) && matchedPunch.breaks.length > 0 && (
                                                                <div className="flex flex-col items-end mt-0.5 gap-[1px]">
                                                                    {[...matchedPunch.breaks].sort((a: any, b: any) => new Date(a.inDate).getTime() - new Date(b.inDate).getTime()).map((rk: any, idx: number) => {
                                                                        const formatRealTimeLocal = (isoString?: string) => {
                                                                            if (!isoString) return null;
                                                                            return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', '');
                                                                        };
                                                                        const bIn = formatRealTimeLocal(rk.inDate);
                                                                        const bOut = formatRealTimeLocal(rk.outDate);
                                                                        const typeLabel = rk.paid ? "BRK" : "LUN";
                                                                        const colorClass = rk.paid ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400";

                                                                        if (!bIn) return null;
                                                                        return (
                                                                            <div key={idx} className="text-[9px] font-medium tracking-tight flex items-center gap-1 text-gray-600 dark:text-slate-300">
                                                                                <span className={`font-bold text-[8px] ${colorClass}`}>{typeLabel}</span> {bIn} <span className="text-gray-300 dark:text-slate-600 font-normal">➔</span> {bOut || '--'}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            {shiftStats[empShifts[0].id]?.totalOT > 0 && (
                                                                <span className="text-[10px] text-red-600 dark:text-red-400 font-black mt-1 uppercase tracking-tighter">
                                                                    {shiftStats[empShifts[0].id].totalOT.toFixed(1)}h OT ⚡
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 text-gray-400 dark:text-slate-600 font-black text-[10px] uppercase tracking-[0.1em] bg-gray-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-slate-800">
                                                            <Plus size={12} className="opacity-50" />
                                                            LIBRE
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* WEEKLY BUDGET TAB - Pixel Perfect Replication of Desktop BudgetTool */
                    <div className="p-4 space-y-4 pb-32">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] dark:shadow-none border border-gray-200 dark:border-slate-800 overflow-hidden">
                            {/* Header representing the 'Budget Tool' toggle look */}
                            <div className="bg-indigo-600 px-5 py-3 text-white flex justify-between items-center">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Semana Actual</h3>
                                <div className="flex gap-12 text-[9px] font-black uppercase tracking-widest text-indigo-100">
                                    <span className="w-16 text-right">Plan</span>
                                    <span className="w-16 text-right">Real</span>
                                </div>
                            </div>

                            <div className="divide-y divide-gray-100 dark:divide-slate-800">
                                {/* HOURS ROW */}
                                <div className="flex items-center justify-between px-5 py-4">
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Hours</span>
                                    <div className="flex gap-10">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            {weeklyStats.totalHoursSched.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h
                                        </span>
                                        <span className={`text-[15px] font-black w-20 text-right ${weeklyStats.totalHoursAct > 0 ? (weeklyStats.totalHoursAct > weeklyStats.totalHoursSched ? 'text-red-500' : 'text-emerald-500') : 'text-gray-300'}`}>
                                            {weeklyStats.totalHoursAct > 0 ? `${weeklyStats.totalHoursAct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h` : '-'}
                                        </span>
                                    </div>
                                </div>

                                {/* LABOR $ ROW */}
                                <div className="flex items-center justify-between px-5 py-4 bg-gray-50/30 dark:bg-slate-900/50">
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Labor $</span>
                                    <div className="flex gap-10">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            ${Math.round(weeklyStats.totalCostSched).toLocaleString('en-US')}
                                        </span>
                                        <span className={`text-[15px] font-black w-20 text-right ${weeklyStats.totalCostAct > 0 ? (weeklyStats.totalCostAct > weeklyStats.totalCostSched ? 'text-red-500' : 'text-emerald-500') : 'text-gray-300'}`}>
                                            {weeklyStats.totalCostAct > 0 ? `$${Math.round(weeklyStats.totalCostAct).toLocaleString('en-US')}` : '-'}
                                        </span>
                                    </div>
                                </div>

                                {/* SALES ROW */}
                                <div className="flex items-center justify-between px-5 py-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Sales</span>
                                        <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-slate-800 rounded-lg">
                                            <button onClick={onRefresh} className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-md text-indigo-500 transition-colors">
                                                <RefreshCcw size={13} className={isExternalLoading ? 'animate-spin' : ''} />
                                            </button>
                                            <button onClick={onCalculateProjections} className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-md text-purple-500 transition-colors">
                                                <Bot size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-10">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            ${Math.round(weeklyStats.totalProjSales).toLocaleString('en-US')}
                                        </span>
                                        <span className={`text-[15px] font-black w-20 text-right ${weeklyStats.totalActualSales > 0 ? (weeklyStats.totalActualSales < weeklyStats.totalProjSales ? 'text-red-500' : 'text-emerald-500') : 'text-gray-300'}`}>
                                            ${Math.round(weeklyStats.totalActualSales).toLocaleString('en-US')}
                                        </span>
                                    </div>
                                </div>

                                {/* LABOR % ROW */}
                                <div className="flex items-center justify-between px-5 py-4 bg-gray-50/30 dark:bg-slate-900/50">
                                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Labor %</span>
                                    <div className="flex gap-10 items-center">
                                        <span className="text-[15px] font-black text-blue-600 w-20 text-right">
                                            {weeklyStats.totalLaborPctProj.toFixed(1)}%
                                        </span>
                                        <div className="w-20 flex justify-end">
                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-black border-2 ${weeklyStats.totalLaborPctAct > 22
                                                ? 'bg-red-100 text-red-700 border-red-300'
                                                : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                                }`}>
                                                {weeklyStats.totalLaborPctAct > 0 ? `${weeklyStats.totalLaborPctAct.toFixed(1)}%` : '-'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tactical Advice Card */}
                        <div className={`p-5 rounded-2xl shadow-lg border-l-8 ${weeklyStats.totalLaborPctAct > 22 ? 'bg-red-50 dark:bg-red-900/20 border-red-500' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500'}`}>
                            <div className="flex gap-4">
                                <div className={`p-2 rounded-xl text-white ${weeklyStats.totalLaborPctAct > 22 ? 'bg-red-500' : 'bg-emerald-500'}`}>
                                    <AlertCircle size={20} />
                                </div>
                                <div className="flex-1">
                                    <h4 className={`text-sm font-black uppercase tracking-widest ${weeklyStats.totalLaborPctAct > 22 ? 'text-red-800 dark:text-red-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                                        Estado de la Operación
                                    </h4>
                                    <p className={`text-sm mt-1 font-medium ${weeklyStats.totalLaborPctAct > 22 ? 'text-red-700/80 dark:text-red-300/80' : 'text-emerald-700/80 dark:text-emerald-300/80'}`}>
                                        {weeklyStats.totalLaborPctAct > 22
                                            ? 'El porcentaje de labor está excediendo la meta semanal. Se recomienda revisar los horarios para optimizar costos.'
                                            : 'El porcentaje de labor está alineado con las metas semanales. Continúa con este nivel de eficiencia.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

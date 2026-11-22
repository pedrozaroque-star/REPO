/**
 * @module app/planificador/components/BudgetTool
 * @description Sticky weekly and daily budget bar for the schedule planner in Tacos Gavilan.
 * Displays hours, scheduled labor cost, actual Toast labor cost, sales projections (with static manual lock 🔒),
 * and labor cost percentage vs corporate targets.
 *
 * @businessRules
 * - Corporate labor cost target for Tacos Gavilan is strictly < 21.5%.
 * - Workday starts at 6:00 AM and ends at 5:59 AM next day (`America/Los_Angeles`).
 * - General Manager hours and wages are excluded from hourly employee labor budget calculations.
 * - Editing a day's projected sales persists immediately on blur/Enter as a static manual override (`🔒`),
 *   synchronized with `/ventas`, `/ventas/reportes`, and `SalesDetailModal` while preserving `aiBaseSales`.
 *
 * @dataFlow
 * Toast net sales + Intelligence v3.1 projections + `/api/projections/override` -> BudgetTool -> UI indicators & warnings
 */

'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronDown, RefreshCw, Brain, Lock, Loader2 } from 'lucide-react'
import { addDays, formatDateISO, toast } from '../lib/utils'
import { useLanguage } from '@/lib/i18n'

export function BudgetTool({
    weekStart,
    shifts,
    weeklyStats,
    laborStats,
    projections,
    setProjections,
    projectionOverrides = {},
    savingProjectionDate = null,
    onSaveManualProjection,
    onUnlockManualProjection,
    actuals,
    storeId,
    onRefresh,
    onCalculateProjections,
    isExternalLoading,
    onShowSalesDetail,
    canEdit = true,
}: any) {
    const { t } = useLanguage()
    const [isOpen, setIsOpen] = useState(true)
    const [isSyncing, setIsSyncing] = useState(false)
    const [editingDrafts, setEditingDrafts] = useState<Record<string, string>>({})
    const hasAutoSynced = useRef(false)

    // --- BUSINESS DATE AWARENESS ---
    const getBusinessDate = () => {
        const now = new Date()
        const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
        if (laTime.getHours() < 6) {
            laTime.setDate(laTime.getDate() - 1)
        }
        const y = laTime.getFullYear()
        const m = String(laTime.getMonth() + 1).padStart(2, 0 as any)
        const d = String(laTime.getDate()).padStart(2, 0 as any)
        return `${y}-${m}-${d}`
    }

    const handleSync = async () => {
        if (!onRefresh || isSyncing) return
        setIsSyncing(true)
        try {
            await onRefresh()
        } catch (e) {
            console.error(e)
        } finally {
            setIsSyncing(false)
        }
    }

    useEffect(() => {
        if (!storeId) return
        const businessToday = getBusinessDate()
        const currentSales = actuals?.[businessToday]?.sales || 0
        if (!hasAutoSynced.current && currentSales === 0) {
            hasAutoSynced.current = true
            handleSync()
        }
    }, [storeId, actuals])

    const commitManualEdit = async (dateStr: string) => {
        if (!(dateStr in editingDrafts)) return
        const rawDraft = editingDrafts[dateStr]
        setEditingDrafts(prev => {
            const copy = { ...prev }
            delete copy[dateStr]
            return copy
        })

        const cleaned = rawDraft.replace(/[^0-9]/g, '')
        if (!cleaned) return

        const nextNum = Math.round(Number(cleaned))
        const currentNum = Math.round(Number(projections?.[dateStr] || 0))
        if (!Number.isFinite(nextNum) || nextNum === currentNum) return

        if (!onSaveManualProjection) {
            setProjections?.((p: any) => ({ ...p, [dateStr]: String(nextNum) }))
            return
        }

        const res = await onSaveManualProjection(dateStr, nextNum)
        if (res?.ok) {
            toast.success(
                t('planner.mobile.projection_locked_saved').replace('${amount}', `$${Number(res.totalSales ?? nextNum).toLocaleString('en-US')}`)
            )
        } else if (res?.errorCode === 'GUARDRAIL_EXCEEDED') {
            toast.error(
                t('planner.mobile.projection_guardrail_error')
                    .replace('${min}', `$${Number(res.minAllowed || 0).toLocaleString('en-US')}`)
                    .replace('${max}', `$${Number(res.maxAllowed || 0).toLocaleString('en-US')}`)
                    .replace('${base}', `$${Number(res.aiBaseSales || 0).toLocaleString('en-US')}`)
            )
        } else {
            toast.error(res?.message || t('planner.mobile.projection_save_error'))
        }
    }

    const handleUnlockDay = async (e: React.MouseEvent, dateStr: string) => {
        e.stopPropagation()
        if (!onUnlockManualProjection || savingProjectionDate === dateStr) return
        const res = await onUnlockManualProjection(dateStr)
        if (res?.ok) {
            toast.info(
                t('planner.mobile.projection_unlocked_restored').replace('${amount}', `$${Number(res.totalSales || 0).toLocaleString('en-US')}`)
            )
        } else {
            toast.error(res?.message || t('planner.mobile.projection_save_error'))
        }
    }

    const dailyData = useMemo(() => {
        const days = Array.from({ length: 7 }, (_, i) => {
            const date = addDays(weekStart, i)
            const dateStr = formatDateISO(date)
            const effectiveRaw = dateStr in editingDrafts ? editingDrafts[dateStr] : (projections[dateStr] || '0')
            const salesProj = parseFloat(effectiveRaw || '0') || 0
            const salesAct = actuals?.[dateStr]?.sales || 0
            const schedStats = laborStats[dateStr] || { cost: 0, hours: 0 }
            const actStats = actuals?.[dateStr]?.labor || { cost: 0, hours: 0 }
            const laborPctProj = salesProj > 0 ? (schedStats.cost / salesProj) * 100 : 0
            const laborPctAct = salesAct > 0 ? (actStats.cost / salesAct) * 100 : (salesProj > 0 ? (actStats.cost / salesProj) * 100 : 0)
            const isBurnRate = salesAct === 0 && salesProj > 0
            return {
                date,
                dateStr,
                salesProj,
                salesAct,
                costSched: schedStats.cost,
                costAct: actStats.cost,
                hoursSched: schedStats.hours,
                hoursAct: actStats.hours,
                laborPctProj,
                laborPctAct,
                isBurnRate
            }
        })
        return days
    }, [weekStart, projections, editingDrafts, laborStats, actuals])

    const hoursSched = dailyData.reduce((a, d) => a + d.hoursSched, 0)
    const hoursAct = dailyData.reduce((a, d) => a + d.hoursAct, 0)
    const costSched = dailyData.reduce((a, d) => a + d.costSched, 0)
    const costAct = dailyData.reduce((a, d) => a + d.costAct, 0)
    const salesProj = dailyData.reduce((a, d) => a + d.salesProj, 0)
    const salesAct = dailyData.reduce((a, d) => a + d.salesAct, 0)
    const laborPctProj = salesProj > 0 ? (costSched / salesProj) * 100 : 0
    const laborPctAct = salesAct > 0 ? (costAct / salesAct) * 100 : (salesProj > 0 ? (costAct / salesProj) * 100 : 0)
    const totals = { hoursSched, hoursAct, costSched, costAct, salesProj, salesAct, laborPctProj, laborPctAct }

    const fmtHrs = (n: number) => n > 0 ? `${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h` : '-'
    const fmtMoney = (n: number) => n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : '-'
    const fmtPct = (n: number) => n > 0 ? `${n.toFixed(1)}%` : '-'
    const getPctColor = (val: number, isBurn = false) => {
        if (isBurn) return 'bg-amber-100 text-amber-700 border-amber-300'
        if (val > 21.5) return 'bg-red-100 text-red-700 border-red-300'
        return 'bg-emerald-100 text-emerald-700 border-emerald-300'
    }

    return (
        <div className="sticky bottom-4 z-40 mx-4 rounded-xl rounded-t-lg bg-gray-50/98 dark:bg-slate-900/98 backdrop-blur-md border-x border-b border-t-4 border-gray-200 border-t-indigo-500 dark:border-slate-600 dark:border-t-indigo-500 shadow-[0_0_70px_20px_rgba(0,0,0,0.65)] dark:shadow-[0_0_80px_20px_rgba(0,0,0,0.95)] font-sans text-xs ring-1 ring-black/5 dark:ring-white/10 transition-all duration-500">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="absolute -top-8 left-1/2 -translate-x-1/2 w-32 h-8 bg-indigo-500 dark:bg-indigo-600 rounded-t-lg cursor-pointer flex items-center justify-center gap-1.5 shadow-lg hover:bg-indigo-600 dark:hover:bg-indigo-500 transition-all z-50 ring-1 ring-black/5"
            >
                <div className="absolute inset-0 -top-4" />
                <span className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-wider text-shadow-sm">Budget Tool</span>
                <ChevronDown size={14} className={`text-indigo-100 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            <div className={`transition-all duration-300 overflow-hidden ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="grid grid-cols-[300px_repeat(7,1fr)] min-w-[1200px]">
                    <div className="bg-gray-100 dark:bg-slate-900/80 flex flex-col border-r border-gray-300 dark:border-slate-700 sticky left-0 z-20 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_10px_-4px_rgba(0,0,0,0.5)]">
                        <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-800">
                            <span className="font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide text-sm">Hours</span>
                            <div className="flex gap-2 text-sm">
                                <span className="text-blue-600 font-bold">{fmtHrs(totals.hoursSched)}</span>
                                <span className={`font-bold ${totals.hoursAct > totals.hoursSched ? 'text-red-500' : 'text-emerald-600'}`}>{fmtHrs(totals.hoursAct)}</span>
                            </div>
                        </div>
                        <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-800">
                            <span className="font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide text-sm">Labor $</span>
                            <div className="flex gap-2 text-sm">
                                <span className="text-blue-600 font-bold">{fmtMoney(totals.costSched)}</span>
                                <span className={`font-bold ${totals.costAct > totals.costSched ? 'text-red-500' : 'text-emerald-600'}`}>{fmtMoney(totals.costAct)}</span>
                            </div>
                        </div>
                        <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide text-sm">Sales</span>
                                <div className="flex gap-1">
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleSync(); }}
                                        disabled={isSyncing || isExternalLoading}
                                        title="Actualizar Ventas Reales (Toast)"
                                        className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-800 ${(isSyncing || isExternalLoading) ? 'text-indigo-500' : 'text-gray-400'}`}
                                    >
                                        <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onCalculateProjections && onCalculateProjections(); }}
                                        disabled={isExternalLoading}
                                        title="Recalcular Proyecciones Automáticas (respeta días con candado 🔒)"
                                        className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-800 ${isExternalLoading ? 'text-purple-500' : 'text-gray-400'}`}
                                    >
                                        <Brain size={14} className={isExternalLoading ? 'animate-pulse' : ''} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2 text-sm">
                                <span className="text-blue-600 font-bold">{fmtMoney(totals.salesProj)}</span>
                                <span className={`font-bold ${totals.salesAct < totals.salesProj ? 'text-red-500' : 'text-emerald-600'}`}>{fmtMoney(totals.salesAct)}</span>
                            </div>
                        </div>
                        <div className="h-11 flex items-center justify-between px-4">
                            <span className="font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide text-sm">Labor %</span>
                            <div className="flex gap-2 text-sm items-center">
                                <span className="text-blue-600 font-bold">{fmtPct(totals.laborPctProj)}</span>
                                <span className={`px-2 py-0.5 rounded border font-bold ${getPctColor(totals.laborPctAct)}`}>{fmtPct(totals.laborPctAct)}</span>
                            </div>
                        </div>
                    </div>

                    {dailyData.map(day => {
                        const overrideMeta = projectionOverrides?.[day.dateStr]
                        const isManualLocked = Boolean(overrideMeta?.manual)
                        const isSavingThisDay = savingProjectionDate === day.dateStr
                        const isEditingThisDay = day.dateStr in editingDrafts
                        const displayValue = isEditingThisDay
                            ? editingDrafts[day.dateStr]
                            : (projections[day.dateStr] !== undefined && projections[day.dateStr] !== ''
                                ? Math.round(Number(projections[day.dateStr])).toLocaleString('en-US')
                                : '')

                        const lockTip = isManualLocked
                            ? t('planner.mobile.projection_locked_tip').replace('${base}', `$${Math.round(Number(overrideMeta?.aiBaseSales || 0)).toLocaleString('en-US')}`)
                            : t('planner.mobile.projection_edit_prompt')

                        return (
                            <div
                                key={day.dateStr}
                                title="Ver Detalle de Ventas"
                                onClick={() => onShowSalesDetail && onShowSalesDetail(day.dateStr)}
                                className="flex flex-col text-center border-r border-gray-200 dark:border-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all cursor-pointer group"
                            >
                                <div className="h-11 border-b border-gray-100 dark:border-slate-800 grid grid-cols-2 items-center px-1">
                                    <span className="text-blue-600 font-bold text-right pr-1 text-sm">{day.hoursSched > 0 ? day.hoursSched.toFixed(1) : '-'}</span>
                                    <span className={`font-bold text-left pl-1 text-sm ${day.hoursAct > day.hoursSched ? 'text-red-500' : 'text-emerald-600'}`}>{day.hoursAct > 0 ? day.hoursAct.toFixed(1) : '-'}</span>
                                </div>
                                <div className="h-11 border-b border-gray-100 dark:border-slate-800 grid grid-cols-2 items-center px-1 bg-indigo-50/10 dark:bg-indigo-900/5 group-hover:bg-indigo-100/30">
                                    <span className="text-blue-600 font-bold text-right pr-1 text-sm">{fmtMoney(day.costSched)}</span>
                                    <span className={`font-bold text-left pl-1 text-sm ${day.costAct > day.costSched ? 'text-red-500' : 'text-emerald-600'}`}>{fmtMoney(day.costAct)}</span>
                                </div>
                                <div className="h-11 border-b border-gray-100 dark:border-slate-800 grid grid-cols-2 items-center px-1">
                                    <div
                                        onClick={(e) => e.stopPropagation()}
                                        className={`flex items-center justify-end gap-0.5 h-7 rounded px-1 transition-colors ${
                                            isManualLocked
                                                ? 'bg-amber-50/90 dark:bg-amber-950/35 ring-1 ring-amber-300/70 dark:ring-amber-700/60'
                                                : 'hover:bg-white/70 dark:hover:bg-slate-700/50'
                                        }`}
                                        title={lockTip}
                                    >
                                        {isSavingThisDay ? (
                                            <Loader2 size={11} className="animate-spin text-indigo-500 shrink-0" />
                                        ) : isManualLocked && canEdit ? (
                                            <button
                                                type="button"
                                                onClick={(e) => handleUnlockDay(e, day.dateStr)}
                                                title={lockTip}
                                                className="p-0.5 rounded text-amber-600 hover:text-amber-800 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-900/50 transition-colors shrink-0 cursor-pointer"
                                            >
                                                <Lock size={11} />
                                            </button>
                                        ) : isManualLocked ? (
                                            <Lock size={11} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                        ) : null}

                                        <input
                                            disabled={!canEdit || isSavingThisDay}
                                            className={`h-full bg-transparent text-right outline-none w-full min-w-0 text-sm font-bold ${
                                                isManualLocked
                                                    ? 'text-amber-700 dark:text-amber-300 focus:text-amber-900'
                                                    : 'text-blue-600 dark:text-blue-400 focus:text-blue-800'
                                            }`}
                                            placeholder="-"
                                            value={displayValue}
                                            onFocus={() => {
                                                const raw = projections[day.dateStr] ? String(Math.round(Number(projections[day.dateStr]))) : ''
                                                setEditingDrafts(prev => ({ ...prev, [day.dateStr]: raw }))
                                            }}
                                            onChange={e => {
                                                const val = e.target.value.replace(/[^0-9]/g, '')
                                                setEditingDrafts(prev => ({ ...prev, [day.dateStr]: val }))
                                            }}
                                            onBlur={() => commitManualEdit(day.dateStr)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault()
                                                    ;(e.currentTarget as HTMLInputElement).blur()
                                                } else if (e.key === 'Escape') {
                                                    setEditingDrafts(prev => {
                                                        const copy = { ...prev }
                                                        delete copy[day.dateStr]
                                                        return copy
                                                    })
                                                    ;(e.currentTarget as HTMLInputElement).blur()
                                                }
                                            }}
                                        />
                                    </div>
                                    <span
                                        className={`font-bold text-left pl-1 cursor-pointer text-xs ${day.salesAct < day.salesProj ? 'text-red-500' : 'text-emerald-600'}`}
                                    >
                                        {day.salesAct > 0 ? fmtMoney(day.salesAct) : '-'}
                                    </span>
                                </div>
                                <div className="h-11 grid grid-cols-2 items-center px-1">
                                    <span className={`text-right pr-1 text-sm font-bold ${day.laborPctProj > 21.5 ? 'text-red-500' : 'text-blue-600'}`}>{fmtPct(day.laborPctProj)}</span>
                                    <div className="text-left pl-1">
                                        {day.laborPctAct > 0 && (
                                            <span className={`px-1.5 py-0.5 rounded border text-xs font-bold ${getPctColor(day.laborPctAct, day.isBurnRate)}`}>
                                                {day.laborPctAct.toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

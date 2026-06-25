/**
 * @module components/dashboard/DriveThruLeaderboard
 * @description Widget de leaderboard Drive-Thru para el Dashboard principal. Muestra ranking de tiendas 
 * por velocidad de servicio (SOS), con código de colores estilo HME (verde/amarillo/rojo), 
 * navegación por media hora, y alertas para tiendas que exceden el tiempo objetivo.
 * 
 * @businessRules
 * - Umbrales de tiempo: 🟢 ≤ 3:30 (≤210s), 🟡 3:31-5:00 (211-300s), 🔴 > 5:00 (>300s)
 * - El día laboral empieza a las 6 AM y termina a las 5:59 AM del día siguiente
 * - Solo muestra tiendas con has_drive_thru = true en la tabla stores
 * - Auto-refresh cada 60 segundos
 * 
 * @dataFlow
 * - Consume /api/drive-thru/leaderboard?date=YYYY-MM-DD&slot=HH:MM
 * - Datos provienen de dt_halfhour_stats (pre-agregados por el cron sync-drive-thru)
 * 
 * @notes
 * - Diseño inspirado en HME ZOOM Nitro Leaderboard con podio visual
 * - Click en tienda navega a /drive-thru con filtro de tienda
 */
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Timer, ChevronLeft, ChevronRight, Trophy, Zap, Car, AlertTriangle, TrendingUp, Clock } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface LeaderboardEntry {
    store_id: string
    store_name: string
    avg_duration_sec: number
    order_count: number
    fastest_order: { number: string | null, duration: number } | null
    slowest_order: { number: string | null, duration: number } | null
    color: 'green' | 'yellow' | 'red'
    rank: number
}

interface LeaderboardData {
    entries: LeaderboardEntry[]
    globalAvg: number
    totalCars: number
    date: string
    slot: string | null
}

function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

function getColorClasses(color: string) {
    switch (color) {
        case 'green': return {
            bg: 'bg-emerald-50 dark:bg-emerald-950/30',
            border: 'border-emerald-200 dark:border-emerald-800',
            text: 'text-emerald-700 dark:text-emerald-400',
            dot: 'bg-emerald-500',
            bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
        }
        case 'yellow': return {
            bg: 'bg-amber-50 dark:bg-amber-950/30',
            border: 'border-amber-200 dark:border-amber-800',
            text: 'text-amber-700 dark:text-amber-400',
            dot: 'bg-amber-500',
            bar: 'bg-gradient-to-r from-amber-400 to-amber-500',
        }
        case 'red': return {
            bg: 'bg-rose-50 dark:bg-rose-950/30',
            border: 'border-rose-200 dark:border-rose-800',
            text: 'text-rose-700 dark:text-rose-400',
            dot: 'bg-rose-500',
            bar: 'bg-gradient-to-r from-rose-400 to-rose-500',
        }
        default: return {
            bg: 'bg-slate-50 dark:bg-slate-950/30',
            border: 'border-slate-200 dark:border-slate-800',
            text: 'text-slate-700 dark:text-slate-400',
            dot: 'bg-slate-500',
            bar: 'bg-gradient-to-r from-slate-400 to-slate-500',
        }
    }
}

function getMedalEmoji(rank: number): string {
    switch (rank) {
        case 1: return '🥇'
        case 2: return '🥈'
        case 3: return '🥉'
        default: return `${rank}.`
    }
}

// Generate half-hour slots starting from 6 AM
function generateSlots(): string[] {
    const slots: string[] = []
    // From 06:00 to 05:30 next day (business day)
    for (let h = 6; h < 30; h++) {
        const hour = h % 24
        slots.push(`${String(hour).padStart(2, '0')}:00`)
        slots.push(`${String(hour).padStart(2, '0')}:30`)
    }
    return slots
}

function getCurrentSlot(): string {
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const h = laTime.getHours()
    const m = laTime.getMinutes()
    const slotMin = m < 30 ? '00' : '30'
    return `${String(h).padStart(2, '0')}:${slotMin}`
}

function getBusinessDate(): string {
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    if (laTime.getHours() < 6) {
        laTime.setDate(laTime.getDate() - 1)
    }
    const y = laTime.getFullYear()
    const m = String(laTime.getMonth() + 1).padStart(2, '0')
    const d = String(laTime.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

const ALL_SLOTS = generateSlots()

interface DriveThruLeaderboardProps {
    selectedDate?: string
}

export default function DriveThruLeaderboard({ selectedDate }: DriveThruLeaderboardProps) {
    const { t } = useLanguage()
    const router = useRouter()
    const [data, setData] = useState<LeaderboardData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'slot' | 'day'>('day')
    const [currentSlotIndex, setCurrentSlotIndex] = useState(() => {
        const current = getCurrentSlot()
        const idx = ALL_SLOTS.indexOf(current)
        return idx >= 0 ? idx : 0
    })
    const abortRef = useRef<AbortController | null>(null)

    const fetchData = useCallback(async () => {
        if (abortRef.current) abortRef.current.abort()
        const controller = new AbortController()
        abortRef.current = controller

        try {
            const date = selectedDate || getBusinessDate()
            const slot = viewMode === 'slot' ? ALL_SLOTS[currentSlotIndex] : undefined
            const url = `/api/drive-thru/leaderboard?date=${date}${slot ? `&slot=${slot}` : ''}`

            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)

            const json = await res.json()
            setData(json)
            setError(null)
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                setError(e.message)
            }
        } finally {
            setLoading(false)
        }
    }, [viewMode, currentSlotIndex, selectedDate])

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 60000) // Auto-refresh every 60s
        return () => {
            clearInterval(interval)
            if (abortRef.current) abortRef.current.abort()
        }
    }, [fetchData])

    const navigateSlot = (direction: -1 | 1) => {
        setCurrentSlotIndex(prev => {
            const next = prev + direction
            if (next < 0 || next >= ALL_SLOTS.length) return prev
            return next
        })
    }

    const isToday = !selectedDate || selectedDate === getBusinessDate()
    const realTimeSlotIndex = ALL_SLOTS.indexOf(getCurrentSlot())
    const isNextDisabled = currentSlotIndex >= ALL_SLOTS.length - 1 || (isToday && currentSlotIndex >= realTimeSlotIndex)

    // Find alerts (stores in red)
    const redStores = data?.entries.filter(e => e.color === 'red') || []
    // Max bar width reference
    const maxDuration = data?.entries.length ? Math.max(...data.entries.map(e => e.avg_duration_sec), 300) : 300

    if (loading) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl">
                        <Timer className="text-white" size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">{t('drive_thru.title')}</h3>
                        <p className="text-xs text-slate-500">{t('drive_thru.subtitle')}</p>
                    </div>
                </div>
                <div className="flex items-center justify-center h-40">
                    <div className="animate-pulse text-slate-400 text-sm">{t('drive_thru.loading')}</div>
                </div>
            </div>
        )
    }

    if (error || !data || data.entries.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl">
                        <Timer className="text-white" size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">{t('drive_thru.title')}</h3>
                        <p className="text-xs text-slate-500">{t('drive_thru.subtitle')}</p>
                    </div>
                </div>
                <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                    {t('drive_thru.no_dt_data')}
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center justify-between w-full sm:w-auto">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl shadow-lg shadow-orange-500/20">
                                <Timer className="text-white" size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white text-sm">{t('drive_thru.title')}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{t('drive_thru.subtitle')}</p>
                            </div>
                        </div>
                        {/* Link to full module (mobile only) */}
                        <button
                            onClick={() => router.push('/drive-thru')}
                            className="sm:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                            title="Ver módulo completo"
                        >
                            <TrendingUp size={16} />
                        </button>
                    </div>
                    <div className="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-2 flex-wrap sm:flex-nowrap">
                        {/* View Mode Toggle */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-xs">
                            <button
                                onClick={() => setViewMode('day')}
                                className={`px-2 sm:px-2.5 py-1 rounded-md transition-all font-medium ${viewMode === 'day'
                                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                {t('drive_thru.current_day')}
                            </button>
                            <button
                                onClick={() => setViewMode('slot')}
                                className={`px-2 sm:px-2.5 py-1 rounded-md transition-all font-medium ${viewMode === 'slot'
                                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                {t('drive_thru.by_slot')}
                            </button>
                        </div>

                        {/* Slot Navigation (only in slot mode) */}
                        {viewMode === 'slot' && (
                            <div className="flex items-center gap-1 ml-1">
                                <button
                                    onClick={() => navigateSlot(-1)}
                                    disabled={currentSlotIndex <= 0}
                                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 min-w-[40px] text-center bg-slate-100 dark:bg-slate-800 px-1.5 sm:px-2 py-1 rounded-md">
                                    {ALL_SLOTS[currentSlotIndex]}
                                </span>
                                <button
                                    onClick={() => navigateSlot(1)}
                                    disabled={isNextDisabled}
                                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}

                        {/* Link to full module (desktop only) */}
                        <button
                            onClick={() => router.push('/drive-thru')}
                            className="hidden sm:block p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                            title="Ver módulo completo"
                        >
                            <TrendingUp size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Leaderboard Entries */}
            <div className="px-4 py-3 space-y-1.5 max-h-[380px] overflow-y-auto">
                {data.entries.map((entry) => {
                    const colors = getColorClasses(entry.color)
                    const barWidth = Math.min((entry.avg_duration_sec / maxDuration) * 100, 100)

                    return (
                        <div
                            key={entry.store_id}
                            onClick={() => router.push(`/drive-thru?store=${entry.store_id}`)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all hover:scale-[1.01] hover:shadow-sm ${colors.bg} ${colors.border}`}
                        >
                            {/* Rank */}
                            <span className="text-base font-bold min-w-[28px] text-center">
                                {getMedalEmoji(entry.rank)}
                            </span>

                            {/* Store Name */}
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[90px] truncate">
                                {entry.store_name}
                            </span>

                            {/* Progress Bar */}
                            <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar}`}
                                    style={{ width: `${barWidth}%` }}
                                />
                            </div>

                            {/* Duration */}
                            <span className={`text-sm font-bold min-w-[45px] text-right tabular-nums ${colors.text}`}>
                                {formatDuration(entry.avg_duration_sec)}
                            </span>

                            {/* Car Count */}
                            <div className="flex items-center gap-1 min-w-[55px] text-right">
                                <Car size={12} className="text-slate-400" />
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums">
                                    {entry.order_count}
                                </span>
                            </div>

                            {/* Status Dot */}
                            <div className={`w-2.5 h-2.5 rounded-full ${colors.dot} ${entry.color === 'red' ? 'animate-pulse' : ''}`} />
                        </div>
                    )
                })}
            </div>

            {/* Footer Stats */}
            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between text-xs">
                    {/* Global Stats */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-400" />
                            <span className="text-slate-500">{t('drive_thru.global_avg')}:</span>
                            <span className={`font-bold ${data.globalAvg <= 210 ? 'text-emerald-600' : data.globalAvg <= 300 ? 'text-amber-600' : 'text-rose-600'}`}>
                                {formatDuration(data.globalAvg)}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Car size={12} className="text-slate-400" />
                            <span className="text-slate-500">{t('drive_thru.total_cars')}:</span>
                            <span className="font-bold text-slate-700 dark:text-slate-300">{data.totalCars}</span>
                        </div>
                    </div>

                    {/* Fastest / Slowest */}
                    {data.entries.length > 0 && (
                        <div className="flex items-center gap-4">
                            {data.entries[0]?.fastest_order && (
                                <div className="flex items-center gap-1 select-none">
                                    <Zap size={12} className="text-emerald-500" />
                                    <span className="text-emerald-600 font-medium">
                                        Rápida: #{data.entries[0].fastest_order.number} ({formatDuration(data.entries[0].fastest_order.duration)})
                                    </span>
                                </div>
                            )}
                            {data.entries[0]?.slowest_order && (
                                <div className="flex items-center gap-1 select-none">
                                    <AlertTriangle size={12} className="text-rose-500" />
                                    <span className="text-rose-600 font-medium">
                                        Lenta: #{data.entries[0].slowest_order.number} ({formatDuration(data.entries[0].slowest_order.duration)})
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Alert Banner */}
                {redStores.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 px-3 py-1.5 rounded-lg text-xs font-medium animate-pulse">
                        <AlertTriangle size={14} />
                        <span>
                            {t('drive_thru.alert_critical').replace('{count}', String(redStores.length))}:
                            {' '}{redStores.map(s => s.store_name).join(', ')}
                        </span>
                    </div>
                )}
            </div>
        </div>
    )
}

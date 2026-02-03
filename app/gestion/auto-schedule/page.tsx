'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { startOfWeek, addWeeks, format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'

interface WeekStats {
    weekStart: string
    status: 'draft' | 'published' | 'closed' | 'not_generated'
    totalShifts: number
    claimedShifts: number
    kitchenSlots: number
    cashierSlots: number
}

export default function AdminAutoSchedulePage() {
    const { language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    const [weekStats, setWeekStats] = useState<WeekStats[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
    const [stores, setStores] = useState<{ external_id: string; name: string }[]>([])

    // Generate week start dates for next 4 weeks
    const getWeekStarts = () => {
        const weeks: Date[] = []
        const today = new Date()
        const thisWeek = startOfWeek(today, { weekStartsOn: 1 })

        for (let i = 0; i < 4; i++) {
            weeks.push(addWeeks(thisWeek, i))
        }
        return weeks
    }

    // Fetch week statistics
    const fetchStats = useCallback(async () => {
        setIsLoading(true)
        try {
            const weeks = getWeekStarts()
            const stats: WeekStats[] = []

            for (const week of weeks) {
                const weekStr = format(week, 'yyyy-MM-dd')

                const { data: shifts, error } = await supabase
                    .from('open_shifts')
                    .select('id, position_type, status, claimed_count, required_count')
                    .eq('week_start', weekStr)

                if (error) {
                    console.error('Error fetching shifts:', error)
                    continue
                }

                if (!shifts || shifts.length === 0) {
                    stats.push({
                        weekStart: weekStr,
                        status: 'not_generated',
                        totalShifts: 0,
                        claimedShifts: 0,
                        kitchenSlots: 0,
                        cashierSlots: 0
                    })
                } else {
                    const mainStatus = shifts[0]?.status || 'draft'
                    const totalClaimed = shifts.reduce((sum, s) => sum + (s.claimed_count || 0), 0)
                    const totalRequired = shifts.reduce((sum, s) => sum + (s.required_count || 0), 0)
                    const kitchenSlots = shifts.filter(s => s.position_type === 'kitchen').reduce((sum, s) => sum + s.required_count, 0)
                    const cashierSlots = shifts.filter(s => s.position_type === 'cashier').reduce((sum, s) => sum + s.required_count, 0)

                    stats.push({
                        weekStart: weekStr,
                        status: mainStatus as any,
                        totalShifts: totalRequired,
                        claimedShifts: totalClaimed,
                        kitchenSlots,
                        cashierSlots
                    })
                }
            }

            setWeekStats(stats)

            // Fetch stores
            const { data: storeData } = await supabase
                .from('stores')
                .select('external_id, name')
                .eq('is_active', true)
            setStores(storeData || [])

        } catch (error) {
            console.error('Error:', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchStats()
    }, [fetchStats])

    // Generate shifts for a week
    const handleGenerate = async (weekStart: string, publish: boolean = false) => {
        setIsGenerating(true)
        const token = localStorage.getItem('teg_token')

        try {
            const res = await fetch('/api/self-schedule/admin/generate', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    weekStart,
                    publish
                })
            })

            const data = await res.json()

            if (!res.ok) {
                alert(data.error || 'Error generating shifts')
                return
            }

            alert(language === 'es'
                ? `✅ ${data.stats.shifts_created} turnos generados para ${data.stats.stores_processed} tiendas`
                : `✅ ${data.stats.shifts_created} shifts generated for ${data.stats.stores_processed} stores`)

            fetchStats()

        } catch (error) {
            console.error('Generate error:', error)
            alert('Error generating shifts')
        } finally {
            setIsGenerating(false)
        }
    }

    // Publish/unpublish a week
    const handlePublish = async (weekStart: string, newStatus: 'published' | 'draft' | 'closed') => {
        const token = localStorage.getItem('teg_token')

        try {
            const res = await fetch('/api/self-schedule/admin/generate', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    weekStart,
                    status: newStatus
                })
            })

            if (!res.ok) {
                const data = await res.json()
                alert(data.error || 'Error updating status')
                return
            }

            fetchStats()

        } catch (error) {
            console.error('Publish error:', error)
        }
    }

    // Delete all shifts for a week (only drafts)
    const handleDelete = async (weekStart: string) => {
        const confirmMsg = language === 'es'
            ? '¿Estás seguro que deseas eliminar todos los turnos de esta semana?'
            : 'Are you sure you want to delete all shifts for this week?'

        if (!confirm(confirmMsg)) return

        try {
            const { error } = await supabase
                .from('open_shifts')
                .delete()
                .eq('week_start', weekStart)
                .eq('status', 'draft')

            if (error) {
                console.error('Delete error:', error)
                alert(language === 'es' ? 'Error al eliminar' : 'Error deleting')
                return
            }

            alert(language === 'es' ? '✅ Semana eliminada' : '✅ Week deleted')
            fetchStats()

        } catch (error) {
            console.error('Delete error:', error)
        }
    }

    const formatWeekRange = (weekStart: string) => {
        const start = new Date(weekStart + 'T12:00:00')
        const end = addWeeks(start, 1)
        return `${format(start, 'MMM d', { locale })} - ${format(end, 'MMM d', { locale })}`
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'published':
                return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {language === 'es' ? 'Publicado' : 'Published'}
                </span>
            case 'draft':
                return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    {language === 'es' ? 'Borrador' : 'Draft'}
                </span>
            case 'closed':
                return <span className="px-2 py-1 text-xs font-medium rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {language === 'es' ? 'Cerrado' : 'Closed'}
                </span>
            default:
                return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    {language === 'es' ? 'No Generado' : 'Not Generated'}
                </span>
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-zinc-800 dark:text-white flex items-center gap-3">
                        🗓️ {language === 'es' ? 'Auto-Programación' : 'Self-Scheduling'}
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-2">
                        {language === 'es'
                            ? 'Genera y publica turnos para que los empleados elijan sus horarios'
                            : 'Generate and publish shifts for employees to choose their schedules'}
                    </p>
                </div>

                {/* Weeks Grid */}
                <div className="grid gap-6">
                    {isLoading ? (
                        <div className="text-center py-10">
                            <div className="animate-spin text-4xl">⏳</div>
                        </div>
                    ) : (
                        weekStats.map((week) => (
                            <div
                                key={week.weekStart}
                                className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                            >
                                <div className="p-6">
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                        {/* Week Info */}
                                        <div>
                                            <h2 className="text-xl font-bold text-zinc-800 dark:text-white flex items-center gap-2">
                                                📅 {formatWeekRange(week.weekStart)}
                                                {getStatusBadge(week.status)}
                                            </h2>
                                            <p className="text-sm text-zinc-500 mt-1">
                                                {language === 'es' ? 'Semana del' : 'Week of'} {format(new Date(week.weekStart + 'T12:00:00'), 'PPPP', { locale })}
                                            </p>
                                        </div>

                                        {/* Stats */}
                                        {week.status !== 'not_generated' && (
                                            <div className="flex gap-4">
                                                <div className="text-center">
                                                    <p className="text-2xl font-bold text-emerald-600">{week.claimedShifts}</p>
                                                    <p className="text-xs text-zinc-500">{language === 'es' ? 'Reclamados' : 'Claimed'}</p>
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-2xl font-bold text-blue-600">{week.totalShifts}</p>
                                                    <p className="text-xs text-zinc-500">{language === 'es' ? 'Total' : 'Total'}</p>
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-2xl font-bold text-orange-500">{week.kitchenSlots}</p>
                                                    <p className="text-xs text-zinc-500">🍳 {language === 'es' ? 'Cocina' : 'Kitchen'}</p>
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-2xl font-bold text-purple-500">{week.cashierSlots}</p>
                                                    <p className="text-xs text-zinc-500">💵 {language === 'es' ? 'Cajeros' : 'Cashiers'}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Progress bar */}
                                    {week.status !== 'not_generated' && week.totalShifts > 0 && (
                                        <div className="mt-4">
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="text-zinc-500">
                                                    {language === 'es' ? 'Ocupación' : 'Occupancy'}
                                                </span>
                                                <span className="font-medium">
                                                    {Math.round((week.claimedShifts / week.totalShifts) * 100)}%
                                                </span>
                                            </div>
                                            <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
                                                    style={{ width: `${(week.claimedShifts / week.totalShifts) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex flex-wrap gap-3 mt-6">
                                        {week.status === 'not_generated' && (
                                            <button
                                                onClick={() => handleGenerate(week.weekStart, false)}
                                                disabled={isGenerating}
                                                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 transition-all disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {isGenerating ? '⏳' : '🔮'}
                                                {language === 'es' ? 'Generar con Intelligence' : 'Generate with Intelligence'}
                                            </button>
                                        )}

                                        {week.status === 'draft' && (
                                            <>
                                                <button
                                                    onClick={() => handlePublish(week.weekStart, 'published')}
                                                    className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center gap-2"
                                                >
                                                    ✅ {language === 'es' ? 'Publicar' : 'Publish'}
                                                </button>
                                                <button
                                                    onClick={() => handleGenerate(week.weekStart, false)}
                                                    disabled={isGenerating}
                                                    className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex items-center gap-2"
                                                >
                                                    🔄 {language === 'es' ? 'Regenerar' : 'Regenerate'}
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(week.weekStart)}
                                                    className="px-4 py-2 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-xl font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-all flex items-center gap-2"
                                                >
                                                    🗑️ {language === 'es' ? 'Eliminar' : 'Delete'}
                                                </button>
                                            </>
                                        )}

                                        {week.status === 'published' && (
                                            <>
                                                <button
                                                    onClick={() => handlePublish(week.weekStart, 'closed')}
                                                    className="px-4 py-2 bg-zinc-600 text-white rounded-xl font-medium hover:bg-zinc-700 transition-all flex items-center gap-2"
                                                >
                                                    🔒 {language === 'es' ? 'Cerrar Semana' : 'Close Week'}
                                                </button>
                                                <button
                                                    onClick={() => handlePublish(week.weekStart, 'draft')}
                                                    className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex items-center gap-2"
                                                >
                                                    ⏸️ {language === 'es' ? 'Despublicar' : 'Unpublish'}
                                                </button>
                                            </>
                                        )}

                                        {week.status === 'closed' && (
                                            <button
                                                onClick={() => handlePublish(week.weekStart, 'published')}
                                                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-2"
                                            >
                                                🔓 {language === 'es' ? 'Reabrir' : 'Reopen'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Info box */}
                <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                    <h3 className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2">
                        💡 {language === 'es' ? 'Cómo funciona' : 'How it works'}
                    </h3>
                    <ul className="mt-2 text-sm text-blue-700 dark:text-blue-400 space-y-1">
                        <li>1️⃣ {language === 'es' ? 'Genera los turnos usando el Intelligence Engine' : 'Generate shifts using the Intelligence Engine'}</li>
                        <li>2️⃣ {language === 'es' ? 'Revisa y publica cuando estés listo' : 'Review and publish when ready'}</li>
                        <li>3️⃣ {language === 'es' ? 'Los empleados verán y podrán reclamar turnos en /mis-horarios' : 'Employees will see and can claim shifts at /mis-horarios'}</li>
                        <li>4️⃣ {language === 'es' ? 'Cierra la semana cuando ya no quieras más cambios' : 'Close the week when you don\'t want more changes'}</li>
                    </ul>
                </div>
            </div>
        </div>
    )
}

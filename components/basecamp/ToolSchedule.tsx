/**
 * @module ToolSchedule
 * @description Módulo de Calendario y Agenda (Schedule) para eventos e hitos de Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_schedules, bc_schedule_entries)
 *              y realiza escrituras bidireccionales en Basecamp API a través de /api/basecamp/action.
 *              Implementa vistas de lista cronológica y cuadrícula de calendario mensual interactiva.
 * @businessRules
 *   - Visualización de fechas límite, reuniones y visitas.
 *   - Crear y eliminar eventos propaga cambios a Basecamp API y Supabase.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga eventos de `bc_schedule_entries` para el proyecto.
 *   - Escritura: Llama a `/api/basecamp/action`.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: Funciona localmente en Supabase de forma autónoma.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Calendar as CalendarIcon, Plus, Trash2, Clock, MapPin, List, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

interface ToolScheduleProps {
    project: any
    currentUserName: string
}

export default function ToolSchedule({ project, currentUserName }: ToolScheduleProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const [schedule, setSchedule] = useState<{ id: string; bc_id: number } | null>(null)
    const [events, setEvents] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)

    // Modos de visualización: 'list' | 'calendar'
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar')

    // Estado del mes del calendario
    const [currentDate, setCurrentDate] = useState(new Date())

    // Estados de formulario
    const [showAddForm, setShowAddForm] = useState(false)
    const [newTitle, setNewTitle] = useState('')
    const [newDate, setNewDate] = useState('')
    const [newLocation, setNewLocation] = useState('')
    const [newNotes, setNewNotes] = useState('')

    // Fetch schedule container and entries
    const fetchScheduleAndEntries = async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // Get or create schedule container
            let { data: dbSchedule } = await supabase
                .from('bc_schedules')
                .select('id, bc_id')
                .eq('project_id', project.db_id)
                .limit(1)
                .single()

            if (!dbSchedule) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newSched, error: schedErr } = await supabase
                    .from('bc_schedules')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId
                    })
                    .select('id, bc_id')
                    .single()
                if (schedErr) throw schedErr
                dbSchedule = newSched
            }

            if (dbSchedule) {
                setSchedule({ id: dbSchedule.id, bc_id: Number(dbSchedule.bc_id) })

                // Fetch schedule entries
                const { data: dbEntries, error: entErr } = await supabase
                    .from('bc_schedule_entries')
                    .select(`
                        *,
                        author:bc_people(name)
                    `)
                    .eq('project_id', project.db_id)
                    .order('starts_at', { ascending: true })

                if (entErr) throw entErr
                setEvents(dbEntries || [])
            }
        } catch (err: any) {
            console.error('❌ [ToolSchedule Fetch] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchScheduleAndEntries()
    }, [project.id, project.db_id])

    // Add Event
    const handleAddEvent = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTitle.trim() || !newDate || !schedule) return
        setActionLoading(true)
        try {
            // all_day events should have 00:00:00 to 23:59:59
            const startsAt = `${newDate}T00:00:00`
            const endsAt = `${newDate}T23:59:59`

            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_schedule_entry',
                    projectId: project.id,
                    scheduleId: schedule.bc_id,
                    scheduleDbId: schedule.id,
                    title: newTitle.trim(),
                    description: newNotes.trim() + (newLocation ? `\nUbicación: ${newLocation}` : ''),
                    starts_at: startsAt,
                    ends_at: endsAt,
                    all_day: true
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewTitle('')
            setNewDate('')
            setNewLocation('')
            setNewNotes('')
            setShowAddForm(false)
            await fetchScheduleAndEntries()
        } catch (err: any) {
            console.error('❌ [ToolSchedule Add] Error:', err.message)
        } finally {
            setActionLoading(false)
        }
    }

    // Delete Event
    const handleDeleteEvent = async (ev: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_event_confirm'))) return
        setLoading(true)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: ev.bc_id,
                    recordingDbId: ev.id,
                    tableName: 'bc_schedule_entries'
                })
            })

            if (!res.ok) throw new Error(await res.text())
            await fetchScheduleAndEntries()
        } catch (err: any) {
            console.error('❌ [ToolSchedule Delete] Error:', err.message)
            setLoading(false)
        }
    }

    // Local date parsing without UTC shift
    const getLocalDateParts = (dateStr: string) => {
        if (!dateStr) return { month: '', day: 0 }
        const clean = dateStr.split('T')[0]
        const parts = clean.split('-').map(Number)
        if (parts.length === 3) {
            const d = new Date(parts[0], parts[1] - 1, parts[2])
            return {
                month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
                day: parts[2]
            }
        }
        const d = new Date(dateStr)
        return {
            month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
            day: d.getDate()
        }
    }

    const getPacificTodayStr = () => {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
            return formatter.format(new Date())
        } catch {
            const now = new Date()
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        }
    }

    // Date formatting helper for Basecamp list view
    const getMonthName = (dateStr: string) => getLocalDateParts(dateStr).month
    const getDayNum = (dateStr: string) => getLocalDateParts(dateStr).day

    // ── CALENDAR GRID MATH ──
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay()

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    }

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    }

    const renderCalendarGrid = () => {
        const year = currentDate.getFullYear()
        const month = currentDate.getMonth()
        const daysInMonth = getDaysInMonth(year, month)
        const firstDayIndex = getFirstDayOfMonth(year, month)

        const monthName = currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

        // Days from previous month to pad grid
        const prevDaysCount = firstDayIndex
        const prevMonthDate = new Date(year, month - 1, 1)
        const daysInPrevMonth = getDaysInMonth(prevMonthDate.getFullYear(), prevMonthDate.getMonth())

        const gridCells: any[] = []

        // Pad previous month days
        for (let i = prevDaysCount - 1; i >= 0; i--) {
            const dayNum = daysInPrevMonth - i
            gridCells.push({
                day: dayNum,
                isCurrentMonth: false,
                date: new Date(year, month - 1, dayNum)
            })
        }

        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            gridCells.push({
                day: d,
                isCurrentMonth: true,
                date: new Date(year, month, d)
            })
        }

        // Pad next month days to make grid complete row
        const totalCells = Math.ceil(gridCells.length / 7) * 7
        const nextDaysCount = totalCells - gridCells.length
        for (let n = 1; n <= nextDaysCount; n++) {
            gridCells.push({
                day: n,
                isCurrentMonth: false,
                date: new Date(year, month + 1, n)
            })
        }

        const weekdayLabels = [
            t('basecamp.weekday_sun'),
            t('basecamp.weekday_mon'),
            t('basecamp.weekday_tue'),
            t('basecamp.weekday_wed'),
            t('basecamp.weekday_thu'),
            t('basecamp.weekday_fri'),
            t('basecamp.weekday_sat')
        ]

        return (
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl p-2 sm:p-4 shadow-sm">
                {/* Month navigation */}
                <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h4 className="text-sm font-black text-slate-800 dark:text-slate-200 capitalize">
                        {monthName}
                    </h4>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handlePrevMonth}
                            className="p-1 rounded-lg border border-slate-250 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={handleNextMonth}
                            className="p-1 rounded-lg border border-slate-250 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

                {/* Weekdays */}
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1 text-center mb-1">
                    {weekdayLabels.map((lbl, idx) => (
                        <div key={idx} className="text-[9px] sm:text-[10px] font-black text-slate-400 dark:text-slate-500 py-1">
                            {lbl}
                        </div>
                    ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1 bg-slate-100/50 dark:bg-slate-800 p-0.5 sm:p-1 rounded-xl">
                    {gridCells.map((cell, idx) => {
                        const cellYear = cell.date.getFullYear()
                        const cellMonth = String(cell.date.getMonth() + 1).padStart(2, '0')
                        const cellDay = String(cell.date.getDate()).padStart(2, '0')
                        const cellDateStr = `${cellYear}-${cellMonth}-${cellDay}`

                        const dayEvents = events.filter(e => {
                            if (!e.starts_at) return false
                            const eDateStr = (e.starts_at || '').split('T')[0]
                            return eDateStr === cellDateStr
                        })

                        const isToday = getPacificTodayStr() === cellDateStr

                        return (
                            <div
                                key={idx}
                                onClick={() => {
                                    if (cell.isCurrentMonth) {
                                        setNewDate(cellDateStr)
                                        setShowAddForm(true)
                                    }
                                }}
                                className={`min-h-[50px] sm:min-h-[70px] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/40 p-1 sm:p-1.5 rounded-md sm:rounded-lg flex flex-col justify-between transition-colors ${
                                    cell.isCurrentMonth 
                                        ? 'cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800' 
                                        : 'opacity-40 pointer-events-none'
                                } ${isToday ? 'ring-2 ring-purple-500 ring-inset' : ''}`}
                            >
                                <span className={`text-[9px] sm:text-[10px] font-black ${
                                    cell.isCurrentMonth 
                                        ? 'text-slate-800 dark:text-slate-200' 
                                        : 'text-slate-400'
                                }`}>
                                    {cell.day}
                                </span>

                                <div className="space-y-0.5 sm:space-y-1 mt-0.5 sm:mt-1 max-h-[30px] sm:max-h-[48px] overflow-y-auto no-scrollbar">
                                    {dayEvents.map((ev, eidx) => (
                                        <div
                                            key={eidx}
                                            title={ev.title}
                                            className="text-[7px] sm:text-[9px] font-extrabold truncate px-0.5 sm:px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border border-purple-200/30 line-clamp-1"
                                        >
                                            {ev.title}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col gap-6">
            {/* Cabecera */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center border border-purple-200/30">
                        <CalendarIcon size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-extrabold text-slate-850 dark:text-slate-100">
                            {t('basecamp.schedule')}
                        </h3>
                        <p className="text-[10px] text-slate-450 dark:text-slate-400 uppercase tracking-wider">
                            {t('basecamp.schedule_sub')}
                        </p>
                    </div>
                </div>

                {!showAddForm && (
                    <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
                        {/* Toggle de vistas */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/30 dark:border-slate-700">
                            <button
                                onClick={() => setViewMode('calendar')}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                                    viewMode === 'calendar'
                                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm'
                                        : 'text-slate-450 hover:text-slate-600'
                                    }`}
                            >
                                {t('basecamp.calendar_view')}
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1 ${
                                    viewMode === 'list'
                                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm'
                                        : 'text-slate-450 hover:text-slate-600'
                                }`}
                            >
                                <List size={10} />
                                <span>{t('basecamp.list_view')}</span>
                            </button>
                        </div>

                        <button
                            onClick={() => {
                                setNewDate(new Date().toISOString().split('T')[0])
                                setShowAddForm(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs shadow-sm transition-all"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.add_event_btn')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* ── 1. FORMULARIO DE CREACIÓN ── */}
            {showAddForm && (
                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-6 rounded-2xl shadow-sm animate-in fade-in zoom-in-95 duration-200">
                    <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="text-xs text-slate-450 hover:text-slate-700 dark:hover:text-slate-200 font-bold mb-4 block"
                    >
                        {t('basecamp.cancel_back')}
                    </button>
                    <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2.5 mb-4">
                        {t('basecamp.add_event_btn')}
                    </h4>
                    <form onSubmit={handleAddEvent} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('basecamp.event_name_label')}</label>
                                <input
                                    type="text"
                                    required
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder={t('basecamp.new_event_title')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('basecamp.date_label')}</label>
                                <input
                                    type="date"
                                    required
                                    value={newDate}
                                    onChange={(e) => setNewDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('basecamp.location_label')}</label>
                                <input
                                    type="text"
                                    value={newLocation}
                                    onChange={(e) => setNewLocation(e.target.value)}
                                    placeholder={t('basecamp.location_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('basecamp.notes_label')}</label>
                            <textarea
                                value={newNotes}
                                onChange={(e) => setNewNotes(e.target.value)}
                                placeholder={t('basecamp.event_notes')}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs h-24"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowAddForm(false)}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={actionLoading}
                                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-extrabold text-xs shadow-sm flex items-center gap-1.5"
                            >
                                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{t('basecamp.save_event')}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── 2. VISTAS DE CONTENIDO ── */}
            {!showAddForm && (
                <div>
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                        </div>
                    ) : viewMode === 'calendar' ? (
                        renderCalendarGrid()
                    ) : (
                        <div className="space-y-4">
                            {events.length > 0 ? (
                                events.map((e) => (
                                    <div
                                        key={e.id}
                                        className="flex gap-4 p-4 rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-900 dark:border-slate-800 shadow-sm relative group items-start"
                                    >
                                        {/* Bloque de fecha */}
                                        <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200/30 w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0">
                                            <span className="text-[9px] font-black uppercase text-purple-600">
                                                {getMonthName(e.starts_at)}
                                            </span>
                                            <span className="text-lg font-black text-slate-800 dark:text-slate-200 leading-none">
                                                {getDayNum(e.starts_at)}
                                            </span>
                                        </div>

                                        {/* Información del evento */}
                                        <div className="flex-1 min-w-0 pr-6">
                                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                                {e.title}
                                            </h4>
                                            <div className="flex items-center gap-4 text-[10px] text-slate-450 mt-1 flex-wrap font-medium">
                                                <span className="flex items-center gap-1.5">
                                                    <Clock size={11} />
                                                    {new Date(e.starts_at).toLocaleDateString()} {new Date(e.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {(() => {
                                                    const locMatch = e.description?.match(/(?:Ubicación|Location):\s*(.*)/i);
                                                    return locMatch ? (
                                                        <span className="flex items-center gap-1.5">
                                                            <MapPin size={11} />
                                                            {locMatch[1].trim()}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>
                                            {e.description && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed whitespace-pre-wrap">
                                                    {e.description.replace(/(?:\r?\n)?(?:Ubicación|Location):.*/i, '')}
                                                </p>
                                            )}
                                        </div>

                                        {/* Eliminar */}
                                        <button
                                            onClick={(event) => handleDeleteEvent(e, event)}
                                            className="absolute right-3 top-4 p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-850 rounded-2xl">
                                    <CalendarIcon size={40} className="text-slate-300 mx-auto mb-3" />
                                    <p className="text-xs text-slate-400 italic">{t('basecamp.no_events_desc')}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

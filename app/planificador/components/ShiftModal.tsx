/**
 * @module app/planificador/components/ShiftModal
 * @description Modal dialog for creating and editing shifts in the Tacos Gavilan schedule planner.
 * Features 7-day multi-day batch assignment, allowing restaurant managers to assign the exact
 * same shift schedule across multiple selected days of the week in a single click or tap.
 * 
 * @businessRules
 * - Workday starts at 6:00 AM and ends at 5:59 AM next day.
 * - PM shift starts at 5:00 PM per corporate standard.
 * - Employees can only be scheduled for job roles configured for them in Toast POS.
 * - Multi-day selector defaults to the day clicked by the manager, but allows toggling any of the 7 week days.
 * - Quick presets allow 1-tap selection of weekdays (Lun-Vie), weekends (Sáb-Dom), or all week.
 * - If an existing shift is detected on a selected target day, it updates that day's shift rather than creating duplicate overlapping shifts.
 * - Full bilingual support (Spanish/English) using useLanguage().
 * 
 * @dataFlow
 * Planner page -> ShiftModal (employees, jobs, weekDays, existingShifts) -> onSave(shift | shifts[])
 * 
 * @notes
 * - Solves the friction of having to repeatedly copy or recreate the same shift day-by-day.
 * - Automatically adjusts button label to indicate the exact number of shifts being created (e.g. "Guardar 5 Turnos").
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, Calendar, Clock, Check, Sparkles } from 'lucide-react'
import { toast, formatDateISO, addDays, getMonday } from '../lib/utils'
import { useLanguage } from '@/lib/i18n'

interface ShiftModalProps {
    isOpen: boolean
    onClose: () => void
    onSave: (shift: any | any[]) => void | Promise<void>
    onDelete: (id: string) => void | Promise<void>
    initialData?: any
    employees: any[]
    jobs: any[]
    defaultDate?: Date | string
    defaultEmpId?: string
    weekDays?: Date[]
    existingShifts?: any[]
}

export function ShiftModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    initialData,
    employees,
    jobs,
    defaultDate,
    defaultEmpId,
    weekDays,
    existingShifts = []
}: ShiftModalProps) {
    const { t, language } = useLanguage()

    const [empId, setEmpId] = useState(defaultEmpId || '')
    const [jobId, setJobId] = useState('')
    const [startTime, setStartTime] = useState('09:00')
    const [endTime, setEndTime] = useState('17:00')
    const [notes, setNotes] = useState('')
    const [isOpenShift, setIsOpenShift] = useState(false)
    const [selectedDayDates, setSelectedDayDates] = useState<string[]>([])

    // Compute the 7 calendar days of the target week
    const computedWeekDays = useMemo(() => {
        if (weekDays && weekDays.length === 7) return weekDays
        let baseDate: Date
        if (typeof defaultDate === 'string') {
            baseDate = new Date(defaultDate.includes('T') ? defaultDate : defaultDate + 'T12:00:00')
        } else if (defaultDate instanceof Date) {
            baseDate = defaultDate
        } else {
            baseDate = new Date()
        }
        const monday = getMonday(baseDate)
        return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    }, [weekDays, defaultDate])

    // Initialize or reset form state when modal opens
    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                // Edit Mode
                setEmpId(initialData.employee_id || '')
                setJobId(initialData.job_id || '')
                setIsOpenShift(initialData.is_open || !initialData.employee_id)
                setNotes(initialData.notes || '')

                const start = new Date(initialData.start_time)
                const end = new Date(initialData.end_time)
                setStartTime(start.toTimeString().slice(0, 5))
                setEndTime(end.toTimeString().slice(0, 5))

                const initialDateStr = initialData.shift_date || formatDateISO(start)
                setSelectedDayDates([initialDateStr])
            } else {
                // Create Mode
                setEmpId(defaultEmpId || '')
                setIsOpenShift(!defaultEmpId)
                setJobId(jobs.length > 0 ? jobs[0].id : '')
                setStartTime('09:00')
                setEndTime('17:00')
                setNotes('')

                let initialDateStr = ''
                if (defaultDate) {
                    const d = typeof defaultDate === 'string'
                        ? new Date(defaultDate.includes('T') ? defaultDate : defaultDate + 'T12:00:00')
                        : defaultDate
                    initialDateStr = formatDateISO(d)
                } else if (computedWeekDays[0]) {
                    initialDateStr = formatDateISO(computedWeekDays[0])
                }
                setSelectedDayDates(initialDateStr ? [initialDateStr] : [])
            }
        }
    }, [isOpen, initialData, defaultEmpId, defaultDate, jobs, computedWeekDays])

    // Constraint Logic: Compute Available Jobs for selected Employee
    const availableJobs = useMemo(() => {
        if (isOpenShift || !empId) return jobs

        const emp = employees.find((e: any) => e.id === empId)
        if (!emp) return jobs

        const validGuids = new Set<string>()
        if (emp.wage_data && Array.isArray(emp.wage_data)) {
            emp.wage_data.forEach((w: any) => validGuids.add(w.job_guid))
        }
        if (emp.job_references && Array.isArray(emp.job_references)) {
            emp.job_references.forEach((r: any) => validGuids.add(r.guid))
        }

        const filtered = jobs.filter((j: any) => validGuids.has(j.guid) || validGuids.has(j.id))
        return filtered.length > 0 ? filtered : jobs
    }, [empId, isOpenShift, employees, jobs])

    // Auto-select first valid job when employee changes
    useEffect(() => {
        if (isOpen && !initialData && availableJobs.length > 0) {
            const isValid = availableJobs.some((j: any) => j.id === jobId)
            if (!isValid) {
                setJobId(availableJobs[0].id)
            }
        }
    }, [empId, availableJobs, isOpen, initialData, jobId])

    // Day Toggle Handler
    const toggleDay = (dStr: string) => {
        setSelectedDayDates(prev => {
            if (prev.includes(dStr)) {
                if (prev.length === 1) {
                    toast.error(t('planner.modal_shift.select_day_error'))
                    return prev
                }
                return prev.filter(d => d !== dStr)
            } else {
                return [...prev, dStr].sort()
            }
        })
    }

    // Quick Day Preset Helpers
    const selectWeekdays = () => {
        const monToFri = computedWeekDays.slice(0, 5).map(d => formatDateISO(d))
        setSelectedDayDates(monToFri)
    }

    const selectWeekend = () => {
        const satSun = computedWeekDays.slice(5, 7).map(d => formatDateISO(d))
        setSelectedDayDates(satSun)
    }

    const selectAllWeek = () => {
        const allDays = computedWeekDays.map(d => formatDateISO(d))
        setSelectedDayDates(allDays)
    }

    const resetToDefaultDay = () => {
        let initialDateStr = ''
        if (initialData?.start_time) {
            initialDateStr = formatDateISO(new Date(initialData.start_time))
        } else if (defaultDate) {
            const d = typeof defaultDate === 'string'
                ? new Date(defaultDate.includes('T') ? defaultDate : defaultDate + 'T12:00:00')
                : defaultDate
            initialDateStr = formatDateISO(d)
        } else if (computedWeekDays[0]) {
            initialDateStr = formatDateISO(computedWeekDays[0])
        }
        setSelectedDayDates(initialDateStr ? [initialDateStr] : [])
    }

    // Submit Handler: Saves single or multiple shifts
    const handleSubmit = () => {
        if (!jobId) return toast.error(t('planner.modal_shift.select_role_error'))
        if (!isOpenShift && !empId) return toast.error(t('planner.modal_shift.select_emp_error'))
        if (selectedDayDates.length === 0) return toast.error(t('planner.modal_shift.select_day_error'))

        const [sh, sm] = startTime.split(':').map(Number)
        const [eh, em] = endTime.split(':').map(Number)
        const isOvernight = (eh < sh) || (eh === sh && em < sm)

        const shiftsToSave = selectedDayDates.map(dStr => {
            const dateBase = new Date(dStr + 'T12:00:00')
            const start = new Date(dateBase)
            start.setHours(sh, sm, 0, 0)

            const end = new Date(dateBase)
            if (isOvernight) end.setDate(end.getDate() + 1)
            end.setHours(eh, em, 0, 0)

            // Look up existing shift for this employee on this specific date
            const existing = existingShifts?.find((s: any) =>
                (isOpenShift ? s.is_open : s.employee_id === empId) && s.shift_date === dStr
            )

            // If initialData matches this exact date, preserve its id; otherwise update existing or insert new
            const isInitialDay = initialData && (initialData.shift_date === dStr || formatDateISO(new Date(initialData.start_time)) === dStr)
            const shiftId = isInitialDay ? initialData.id : (existing?.id || undefined)

            return {
                id: shiftId,
                employee_id: isOpenShift ? null : empId,
                job_id: jobId,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                is_open: isOpenShift,
                notes,
                status: 'draft' // Any shift created or edited via ShiftModal is a draft until published
            }
        })

        if (shiftsToSave.length === 1) {
            onSave(shiftsToSave[0])
        } else {
            onSave(shiftsToSave)
        }
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.15 }}
                className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-slate-800 flex flex-col max-h-[92vh]"
            >
                {/* MODAL HEADER */}
                <div className="px-5 py-3.5 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50/70 dark:bg-slate-800/40 shrink-0">
                    <div className="flex items-center gap-2">
                        <Calendar size={18} className="text-indigo-600 dark:text-indigo-400" />
                        <h3 className="font-black text-base text-gray-900 dark:text-white">
                            {initialData ? t('planner.modal_shift.edit_title') : t('planner.modal_shift.new_title')}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                        aria-label="Cerrar modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* MODAL BODY (SCROLLABLE) */}
                <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                    {/* Open Shift Checkbox */}
                    <div className="flex items-center gap-2.5 bg-gray-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-gray-100 dark:border-slate-800">
                        <input
                            type="checkbox"
                            id="isOpenShift"
                            checked={isOpenShift}
                            onChange={(e) => setIsOpenShift(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <label htmlFor="isOpenShift" className="text-xs font-bold text-gray-700 dark:text-gray-300 select-none cursor-pointer">
                            {t('planner.modal_shift.open_shift')}
                        </label>
                    </div>

                    {/* Employee Selector */}
                    {!isOpenShift && (
                        <div>
                            <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                {t('planner.modal_shift.employee')}
                            </label>
                            <select
                                value={empId}
                                onChange={(e) => setEmpId(e.target.value)}
                                className="w-full p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                            >
                                <option value="">{t('planner.modal_shift.select_employee')}</option>
                                {employees.map((e: any) => (
                                    <option key={e.id} value={e.id}>
                                        {e.chosen_name || e.first_name} {e.last_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Job Role Selector */}
                    <div>
                        <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                            {t('planner.modal_shift.role')}
                        </label>
                        <select
                            value={jobId}
                            onChange={(e) => setJobId(e.target.value)}
                            className="w-full p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                        >
                            {availableJobs.map((j: any) => (
                                <option key={j.id} value={j.id}>{j.title}</option>
                            ))}
                        </select>
                    </div>

                    {/* Time Pickers (Start / End) */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                <Clock size={12} className="text-indigo-500" />
                                <span>{t('planner.modal_shift.start')}</span>
                            </label>
                            <input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="w-full p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                <Clock size={12} className="text-indigo-500" />
                                <span>{t('planner.modal_shift.end')}</span>
                            </label>
                            <input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="w-full p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                            />
                        </div>
                    </div>

                    {/* MULTI-DAY BATCH ASSIGNMENT SECTION */}
                    <div className="pt-1">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-black text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                                {t('planner.modal_shift.assign_days')}
                            </label>
                            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                                {selectedDayDates.length} {selectedDayDates.length === 1 ? 'día' : 'días'}
                            </span>
                        </div>

                        {/* 7-DAY PILL TOGGLES */}
                        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                            {computedWeekDays.map((dayDate) => {
                                const dStr = formatDateISO(dayDate)
                                const isSelected = selectedDayDates.includes(dStr)
                                const dayName = dayDate.toLocaleDateString(language === 'en' ? 'en-US' : 'es-ES', { weekday: 'short' }).replace('.', '').slice(0, 3)
                                const dayNum = dayDate.getDate()
                                const hasExistingShift = Boolean(existingShifts?.some((s: any) =>
                                    (isOpenShift ? s.is_open : s.employee_id === empId) && s.shift_date === dStr && (!initialData || s.id !== initialData.id)
                                ))

                                return (
                                    <button
                                        key={dStr}
                                        type="button"
                                        onClick={() => toggleDay(dStr)}
                                        className={`flex flex-col items-center py-2 px-1 rounded-xl transition-all border text-center relative select-none active:scale-95 cursor-pointer ${
                                            isSelected
                                                ? 'bg-gradient-to-b from-indigo-600 to-indigo-700 text-white border-indigo-600 shadow-md shadow-indigo-300 dark:shadow-none font-black scale-[1.02]'
                                                : 'bg-gray-50 dark:bg-slate-800/80 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700'
                                        }`}
                                    >
                                        {hasExistingShift && (
                                            <div
                                                className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-amber-300' : 'bg-amber-500'}`}
                                                title="Ya tiene un turno en este día (se actualizará con este nuevo horario)"
                                            />
                                        )}
                                        <span className="text-[9px] uppercase font-bold tracking-tight opacity-90">{dayName}</span>
                                        <span className="text-sm font-black leading-none mt-0.5">{dayNum}</span>
                                    </button>
                                )
                            })}
                        </div>

                        {/* SHORTCUT PILLS */}
                        <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar pt-0.5">
                            <button
                                type="button"
                                onClick={selectWeekdays}
                                className="px-2 py-1 bg-gray-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg text-[10px] font-bold border border-gray-200 dark:border-slate-700 transition-colors"
                            >
                                {t('planner.modal_shift.weekdays')}
                            </button>
                            <button
                                type="button"
                                onClick={selectWeekend}
                                className="px-2 py-1 bg-gray-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg text-[10px] font-bold border border-gray-200 dark:border-slate-700 transition-colors"
                            >
                                {t('planner.modal_shift.weekend')}
                            </button>
                            <button
                                type="button"
                                onClick={selectAllWeek}
                                className="px-2 py-1 bg-gray-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg text-[10px] font-bold border border-gray-200 dark:border-slate-700 transition-colors"
                            >
                                {t('planner.modal_shift.all_week')}
                            </button>
                            <button
                                type="button"
                                onClick={resetToDefaultDay}
                                className="px-2 py-1 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 rounded-lg text-[10px] font-bold transition-colors ml-auto"
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* Notes Textarea */}
                    <div>
                        <label className="block text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                            {t('planner.modal_shift.notes')}
                        </label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs resize-none"
                            placeholder={t('planner.modal_shift.notes_placeholder')}
                        />
                    </div>
                </div>

                {/* MODAL FOOTER */}
                <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 border-t border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0">
                    {initialData ? (
                        <button
                            onClick={() => { onDelete(initialData.id); onClose(); }}
                            className="text-red-500 hover:text-red-600 p-2 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all"
                        >
                            <Trash2 size={16} />
                            <span>{t('planner.modal_shift.delete')}</span>
                        </button>
                    ) : (
                        <div />
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-xs sm:text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl active:scale-95 transition-all"
                        >
                            {t('planner.modal_shift.cancel')}
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="px-4 py-2 text-xs sm:text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none active:scale-95 transition-all flex items-center gap-1.5"
                        >
                            <span>
                                {selectedDayDates.length > 1
                                    ? t('planner.modal_shift.save_multiple').replace('{n}', String(selectedDayDates.length))
                                    : t('planner.modal_shift.save_single')
                                }
                            </span>
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    )
}

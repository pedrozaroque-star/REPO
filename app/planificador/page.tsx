'use client'

import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import {
    X, Clock, Coffee, Sun, Sunrise, Moon, MoonStar,
    Calendar, User, Save, Trash2, ArrowRight, Plus,
    ChevronLeft, ChevronRight, AlertCircle, Loader2, Zap, RefreshCcw, GripVertical, ArrowDownAZ, Bot, Sparkles,
    LayoutTemplate, Copy, FileDown, FileUp
} from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import { syncEmployeesAction } from '@/app/actions/sync'
const toast = { success: (m: string) => window.alert(m), error: (m: string) => window.alert(m), info: (m: string) => window.alert(m) }

// --- TYPES ---
type Shift = {
    id?: string
    employee_id: string | null // null for Open Shift
    job_id: string
    store_id: string
    start_time: string // ISO
    end_time: string   // ISO
    status: 'draft' | 'published'
    notes?: string
    is_open?: boolean
    shift_date: string // YYYY-MM-DD
}

// --- UTILS ---
const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}
const addDays = (d: Date, days: number) => {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
}
const formatDateISO = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const formatDateNice = (d: Date) => {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}
const getDayName = (d: Date) => ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][d.getDay()];

const formatTime12h = (isoString: string) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12;
        if (minutes === 0) return `${hours}${ampm}`;
        const mStr = minutes < 10 ? '0' + minutes : minutes;
        return `${hours}:${mStr}${ampm}`;
    } catch (e) { return ''; }
}

const stringToColor = (title: string) => {
    const t = (title || '').toLowerCase();
    // Check for Asst/Asistente FIRST before Manager to avoid "Asst Manager" being blue
    if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) return '#22c55e'; // Verde
    if (t.includes('manager')) return '#3b82f6'; // Azul
    if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) return '#000000'; // Negro
    if (t.includes('cashier') || t.includes('cajera')) return '#ec4899'; // Rosa
    if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero') || t.includes('tortill')) return '#ef4444'; // Rojo

    // Fallback deterministic color
    let hash = 0;
    for (let i = 0; i < t.length; i++) {
        hash = t.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

const getRoleWeight = (title: string, shifts: any[] = []) => {
    const t = (title || '').toLowerCase();

    // 1. Manager Global (Always Top, Score < 100)
    // Must exclude 'assistant' to avoid capturing 'Assistant Manager' here
    if (t.includes('manager') && !t.includes('asst') && !t.includes('assist') && !t.includes('asistente') && !t.includes('shift')) {
        return 10;
    }

    // 2. Determine Block (AM vs PM)
    // Logic: Calculate overlap with AM window (Open-17:00) vs PM window (17:00-Close)
    // Whichever has more hours determines the block.
    // Default to AM if no shifts or tie.
    let totalAmHours = 0;
    let totalPmHours = 0;

    if (shifts && shifts.length > 0) {
        shifts.forEach(s => {
            if (!s.start_time || !s.end_time) return;
            const start = new Date(s.start_time);
            const end = new Date(s.end_time);

            // Normalize to hours (float 0-24)
            const startH = start.getHours() + (start.getMinutes() / 60);
            let endH = end.getHours() + (end.getMinutes() / 60);
            if (endH < startH) endH += 24; // Overnight shift logic

            // AM Window: 0 to 17 (5 PM)
            const amLimit = 17;

            // Overlap AM
            // Segment 1: startH to min(endH, 17)
            const overlapAm = Math.max(0, Math.min(endH, amLimit) - startH);

            // Overlap PM
            // Segment 2: max(startH, 17) to endH
            const overlapPm = Math.max(0, endH - Math.max(startH, amLimit));

            totalAmHours += overlapAm;
            totalPmHours += overlapPm;
        });
    }

    const isPM = totalPmHours > totalAmHours;

    // Base Scores: AM=1000, PM=2000
    const blockScore = isPM ? 2000 : 1000;

    // 3. Role Scores within Block
    let roleScore = 99;
    if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) roleScore = 1;
    else if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) roleScore = 2;
    else if (t.includes('cashier') || t.includes('cajera')) roleScore = 3;
    else if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero') || t.includes('tortill')) roleScore = 4;

    return blockScore + roleScore;
}

const getJobColor = (title: string) => {
    // Deterministic color based on title for badge
    const colors = [
        'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500',
        'bg-yellow-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500'
    ];
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

const calculateShiftHours = (s: Shift) => {
    const start = new Date(s.start_time);
    const end = new Date(s.end_time);
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return diff > 0 ? diff : 0;
}

// --- COMPONENTS ---

// Week Selector
function WeekSelector({ currentDate, onDateChange, weekStart }: { currentDate: Date, onDateChange: (d: Date) => void, weekStart: Date }) {
    const weekEnd = addDays(weekStart, 6);
    const dateRangeText = `${formatDateNice(weekStart)} - ${formatDateNice(weekEnd)}, ${weekStart.getFullYear()}`;

    return (
        <div className="flex items-center bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-1">
            <button onClick={() => onDateChange(addDays(currentDate, -7))} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md text-gray-500">
                <ChevronLeft size={18} />
            </button>
            <div className="px-3 text-sm font-bold text-gray-700 dark:text-gray-200 min-w-[140px] text-center select-none">
                {dateRangeText}
            </div>
            <button onClick={() => onDateChange(addDays(currentDate, 7))} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md text-gray-500">
                <ChevronRight size={18} />
            </button>
            <div className="border-l border-gray-200 dark:border-slate-700 ml-1 pl-1">
                <button
                    onClick={() => onDateChange(new Date())}
                    className="px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded"
                >
                    Hoy
                </button>
            </div>
        </div>
    );
}

// Shift Modal (Add/Edit)
function ShiftModal({ isOpen, onClose, onSave, onDelete, initialData, employees, jobs, defaultDate, defaultEmpId }: any) {
    const [empId, setEmpId] = useState(defaultEmpId || '')
    const [jobId, setJobId] = useState('')
    const [startTime, setStartTime] = useState('09:00')
    const [endTime, setEndTime] = useState('17:00')
    const [notes, setNotes] = useState('')
    const [isOpenShift, setIsOpenShift] = useState(false)

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
            } else {
                // Create Mode
                setEmpId(defaultEmpId || '')
                setIsOpenShift(!defaultEmpId) // If no empId passed, assume open shift context but let user change
                setJobId(jobs.length > 0 ? jobs[0].id : '')
                setStartTime('09:00')
                setEndTime('17:00')
                setNotes('')
            }
        }
    }, [isOpen, initialData, defaultEmpId, jobs])

    // Constraint Logic: Compute Available Jobs for selected Employee
    const availableJobs = useMemo(() => {
        if (isOpenShift || !empId) return jobs; // Open shifts can be any job (or restrict to all? usually all)

        const emp = employees.find((e: any) => e.id === empId);
        if (!emp) return jobs;

        // Collect all valid job GUIDs for this employee
        const validGuids = new Set<string>();
        if (emp.wage_data && Array.isArray(emp.wage_data)) {
            emp.wage_data.forEach((w: any) => validGuids.add(w.job_guid));
        }
        if (emp.job_references && Array.isArray(emp.job_references)) {
            emp.job_references.forEach((r: any) => validGuids.add(r.guid));
        }

        // Filter global jobs list
        const filtered = jobs.filter((j: any) => validGuids.has(j.guid) || validGuids.has(j.id));

        // Fallback: If no wage data found (shouldn't happen with correct sync), show all or handle?
        // Let's show all if empty to avoid blocking usage, but ideally it should be strict.
        // User asked for STRICT ("no se pueda cambiar"). So if filtered has items, use them.
        return filtered.length > 0 ? filtered : jobs;
    }, [empId, isOpenShift, employees, jobs]);

    // Auto-select first valid job when employee changes (if current job is invalid)
    useEffect(() => {
        if (isOpen && !initialData && availableJobs.length > 0) {
            // If current jobId is not in availableJobs, switch it
            const isValid = availableJobs.some((j: any) => j.id === jobId);
            if (!isValid) {
                setJobId(availableJobs[0].id);
            }
        }
    }, [empId, availableJobs, isOpen, initialData, jobId]);

    const handleSubmit = () => {
        if (!jobId) return toast.error('Selecciona un rol')
        if (!isOpenShift && !empId) return toast.error('Selecciona un empleado')

        // Construct Dates
        // NOTE: mixing defaultDate (Year-Month-Day) with startTime (HH:mm)
        // Using local time construction
        const dateBase = new Date(defaultDate)
        const [sh, sm] = startTime.split(':').map(Number)
        const [eh, em] = endTime.split(':').map(Number)

        const start = new Date(dateBase)
        start.setHours(sh, sm, 0, 0)

        const end = new Date(dateBase)
        end.setHours(eh, em, 0, 0)

        // Handle overnight shifts (end time < start time)
        if (end < start) {
            end.setDate(end.getDate() + 1)
        }

        onSave({
            id: initialData?.id,
            employee_id: isOpenShift ? null : empId,
            job_id: jobId,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            is_open: isOpenShift,
            notes,
            status: initialData?.status || 'draft'
        })
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            >
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-slate-800/50">
                    <h3 className="font-bold text-lg text-gray-800 dark:text-white">
                        {initialData ? 'Editar Turno' : 'Nuevo Turno'}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Employee Selector */}
                    <div className="flex items-center gap-2 mb-2">
                        <input
                            type="checkbox"
                            id="isOpenShift"
                            checked={isOpenShift}
                            onChange={(e) => setIsOpenShift(e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="isOpenShift" className="text-sm font-medium text-gray-700 dark:text-gray-300 select-none">
                            Turno Abierto (Sin asignar)
                        </label>
                    </div>

                    {!isOpenShift && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Empleado</label>
                            <select
                                value={empId}
                                onChange={(e) => setEmpId(e.target.value)}
                                className="w-full p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                            >
                                <option value="">Seleccionar Empleado...</option>
                                {employees.map((e: any) => (
                                    <option key={e.id} value={e.id}>{e.chosen_name || e.first_name} {e.last_name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rol / Puesto (Limitado a Toast)</label>
                        <select
                            value={jobId}
                            onChange={(e) => setJobId(e.target.value)}
                            className="w-full p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                        >
                            {availableJobs.map((j: any) => (
                                <option key={j.id} value={j.id}>{j.title}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Inicio</label>
                            <input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="w-full p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fin</label>
                            <input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="w-full p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notas (Opcional)</label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full p-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm resize-none"
                            placeholder="Ej. Limpieza profunda..."
                        />
                    </div>
                </div>

                <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex justify-between items-center">
                    {initialData ? (
                        <button
                            onClick={() => { onDelete(initialData.id); onClose(); }}
                            className="text-red-500 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg text-sm font-medium flex items-center gap-1"
                        >
                            <Trash2 size={16} /> Eliminar
                        </button>
                    ) : <div></div>}

                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
                        <button
                            onClick={handleSubmit}
                            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-lg shadow-indigo-200 dark:shadow-none transition-all"
                        >
                            Guardar Turno
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    )
}

// Template Modal
function TemplateModal({ isOpen, onClose, templates, onSave, onApply, onDelete, isSaving, name, setName }: any) {
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-slate-800"
            >
                <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-amber-50/30 dark:bg-amber-900/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl text-amber-600 dark:text-amber-400">
                            <LayoutTemplate size={20} />
                        </div>
                        <h3 className="font-black text-xl text-gray-800 dark:text-white tracking-tight uppercase">Templates</h3>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* SAVE SECTION */}
                    <div>
                        <label className="block text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-3">Guardar Semana Actual</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Nombre del Template (ej: Verano Ideal)"
                                className="flex-1 p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                            />
                            <button
                                onClick={onSave}
                                disabled={isSaving || !name.trim()}
                                className="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-200 dark:shadow-none transition-all flex items-center gap-2"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Guardar
                            </button>
                        </div>
                    </div>

                    {/* LIST SECTION */}
                    <div>
                        <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-3">Templates Guardados</label>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                            {templates.length === 0 ? (
                                <div className="text-center py-10 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                                    <p className="text-sm text-gray-400 font-medium italic">No hay templates guardados aún</p>
                                </div>
                            ) : (
                                templates.map((t: any) => (
                                    <div
                                        key={t.id}
                                        onClick={() => onApply(t.id)}
                                        className="group flex items-center justify-between p-4 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl hover:border-amber-500 hover:shadow-md cursor-pointer transition-all"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors">
                                                <FileDown size={18} className="text-gray-400 group-hover:text-amber-600 transition-colors" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-800 dark:text-gray-200 group-hover:text-amber-600 transition-colors">{t.name}</p>
                                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">{t.description}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => onDelete(t.id, e)}
                                            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Al aplicar se sobreescribirá el borrador actual</p>
                </div>
            </motion.div>
        </div>
    )
}

// Premium Confirmation Modal
function PremiumConfirmModal({ isOpen, onClose, onConfirm, title, message, type = 'primary', icon: Icon }: any) {
    if (!isOpen) return null
    const colors = {
        primary: 'bg-indigo-600 shadow-indigo-200 dark:shadow-none',
        danger: 'bg-red-600 shadow-red-200 dark:shadow-none',
        warning: 'bg-amber-500 shadow-amber-200 dark:shadow-none'
    }
    const iconBg = {
        primary: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
        danger: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
        warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-slate-800"
            >
                <div className="p-8 text-center">
                    <div className={`mx-auto w-16 h-16 rounded-3xl ${iconBg[type as keyof typeof iconBg]} flex items-center justify-center mb-6`}>
                        {Icon ? <Icon size={32} /> : <AlertCircle size={32} />}
                    </div>
                    <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2 uppercase tracking-tighter">{title}</h3>
                    <p className="text-gray-500 dark:text-slate-400 text-sm leading-relaxed mb-8 px-4 whitespace-pre-line">{message}</p>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onClose} className="px-6 py-4 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded-2xl font-black uppercase text-xs hover:bg-gray-200 dark:hover:bg-slate-700 transition-all tracking-widest">Cancelar</button>
                        <button onClick={() => { onConfirm(); onClose(); }} className={`px-6 py-4 text-white rounded-2xl font-black uppercase text-xs ${colors[type as keyof typeof colors]} hover:opacity-90 transition-all shadow-lg tracking-widest`}>Confirmar</button>
                    </div>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Acción Requerida</p>
                </div>
            </motion.div>
        </div>
    )
}

// --- REORDERABLE EMPLOYEE ROW COMPONENT ---
function EmployeeRow({
    emp,
    totals,
    weekDays,
    getShiftsForCell,
    jobs,
    weeklyStats,
    formatTime12h,
    stringToColor,
    handleDragStart,
    handleDrop,
    setModalConfig
}: any) {
    const controls = useDragControls()

    return (
        <Reorder.Item
            key={emp.id}
            value={emp}
            as="tr"
            dragListener={false}
            dragControls={controls}
            className="group hover:bg-gray-100 dark:hover:bg-slate-800/80 transition-colors relative"
            initial={{ backgroundColor: "transparent", boxShadow: "none" }}
            animate={{ backgroundColor: "transparent", boxShadow: "none" }}
            whileDrag={{
                backgroundColor: "rgba(99, 102, 241, 0.05)",
                boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
                scale: 1.01,
                zIndex: 50
            }}
        >
            <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-gray-100 dark:group-hover:bg-slate-800/80 border-r border-b border-gray-200 dark:border-slate-800 p-3 transition-colors shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)] w-[25%] min-w-[300px]">
                <div className="flex items-center gap-3">
                    {/* Grip Handle */}
                    <div
                        onPointerDown={(e) => controls.start(e)}
                        className="text-gray-300 hover:text-indigo-500 cursor-grab active:cursor-grabbing transition-colors p-1 -ml-1 touch-none"
                    >
                        <GripVertical size={16} />
                    </div>

                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm shadow-sm relative shrink-0">
                        {emp.first_name?.[0]}{emp.last_name?.[0]}
                        {totals.totalOT > 0 &&
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-[8px]">!</div>
                        }
                    </div>
                    <div className="flex flex-col min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100 text-lg leading-tight truncate">
                            {emp.chosen_name || emp.first_name} {emp.last_name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            {(() => {
                                const jobGuid = emp.job_references?.[0]?.guid;
                                const job = jobs.find((j: any) => j.guid === jobGuid);
                                if (!job) return null;
                                const color = stringToColor(job.title);
                                return (
                                    <span
                                        className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-widest border shrink-0"
                                        style={{
                                            backgroundColor: `${color}15`,
                                            color: color,
                                            borderColor: `${color}30`
                                        }}
                                    >
                                        {job.title}
                                    </span>
                                );
                            })()}
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-900 dark:text-gray-100 font-medium uppercase tracking-tight">
                                <span>{totals.totalHours.toFixed(2)} hrs</span>
                                <span className="text-gray-300 dark:text-gray-700">|</span>
                                <span>${totals.totalWage.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                        {totals.totalOT > 0 && (
                            <p className="text-[11px] text-red-500 dark:text-red-400 font-medium uppercase tracking-tight mt-1">
                                {totals.totalOT.toFixed(1)}h Total OT
                            </p>
                        )}
                    </div>
                </div>
            </td>

            {
                weekDays.map((day: Date) => {
                    const cellShifts = getShiftsForCell(emp.id, day);
                    return (
                        <td
                            key={`${emp.id}-${day.toISOString()}`}
                            className="border-r border-b border-gray-200 dark:border-slate-800 h-24 p-1 relative group-hover:bg-gray-100 dark:group-hover:bg-slate-800/80 transition-colors"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => handleDrop(e, emp.id, day)}
                        >
                            <div className="w-full h-full flex flex-col gap-1">
                                {cellShifts.map((shift: any) => {
                                    const job = jobs.find((j: any) => j.id === shift.job_id)
                                    const jobTitle = job?.title || 'Rol'
                                    const sStats = weeklyStats.shiftStats[shift.id] || { totalOT: 0, dailyOT: 0, weeklyOT: 0 };

                                    return (
                                        <div
                                            key={shift.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, shift)}
                                            onClick={() => setModalConfig({ isOpen: true, data: shift, targetDate: day, targetEmpId: emp.id })}
                                            className={`relative p-2 rounded-l-md border-y border-r border-l-[5px] shadow-sm cursor-grab active:cursor-grabbing hover:brightness-110 transition-all mb-1 h-auto
                                            ${shift.status === 'published'
                                                    ? 'bg-blue-600/15 dark:bg-blue-600/15 border-blue-500/10 dark:border-blue-500/10 text-blue-900 dark:text-blue-100'
                                                    : 'bg-blue-600/5 dark:bg-blue-600/5 border-dashed border-blue-400/10 dark:border-blue-500/5 text-blue-800 dark:text-blue-200'}
                                        `}
                                            style={{ borderLeftColor: stringToColor(jobTitle) }}
                                        >
                                            <div className="flex flex-col justify-center gap-0.5">
                                                <div className="font-medium text-gray-900 dark:text-gray-100 leading-none text-base sm:text-[16px]">
                                                    {formatTime12h(shift.start_time)} - {formatTime12h(shift.end_time)}
                                                </div>
                                                {/* Puesto movido al subtítulo del nombre del empleado */}
                                                {sStats.totalOT > 0 && (
                                                    <div className="mt-1">
                                                        <span className="text-sm text-red-500 font-medium whitespace-nowrap">{sStats.totalOT.toFixed(1)}h OT</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}

                                <button
                                    onClick={() => setModalConfig({ isOpen: true, data: null, targetDate: day, targetEmpId: emp.id })}
                                    className="hidden group-hover:flex w-full min-h-[24px] items-center justify-center text-gray-300 hover:text-indigo-500 hover:bg-gray-100 rounded text-xs transition-colors"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        </td>
                    )
                })
            }
        </Reorder.Item >
    );
}

// Main Scheduler Component
function SchedulePlanner() {
    const { user } = useAuth()
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)

    // State
    const [currentDate, setCurrentDate] = useState(new Date())
    const [stores, setStores] = useState<any[]>([])
    const [selectedStoreId, setSelectedStoreId] = useState<string>('') // Store Table ID (BigInt/String)
    const [employees, setEmployees] = useState<any[]>([])
    const [jobs, setJobs] = useState<any[]>([])
    const [shifts, setShifts] = useState<any[]>([])

    // Sync State
    const [isSyncingEmployees, setIsSyncingEmployees] = useState(false)
    const [showAIInfo, setShowAIInfo] = useState(false)
    const [showSyncInfo, setShowSyncInfo] = useState(false)
    const [showOrderInfo, setShowOrderInfo] = useState(false)
    const [showClearInfo, setShowClearInfo] = useState(false)
    const [showPublishInfo, setShowPublishInfo] = useState(false)

    // Template State
    const [showTemplateModal, setShowTemplateModal] = useState(false)
    const [savedTemplates, setSavedTemplates] = useState<any[]>([])
    const [isSavingTemplate, setIsSavingTemplate] = useState(false)
    const [templateName, setTemplateName] = useState('')
    const [showTemplateInfo, setShowTemplateInfo] = useState(false)
    const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => { }, type: 'primary', icon: null })

    const handleSyncEmployees = async () => {
        if (!storeGuid) return
        setIsSyncingEmployees(true)
        const res = await syncEmployeesAction(storeGuid)
        setIsSyncingEmployees(false)
        if (res.success) {
            toast.success(`Sincronizados ${res.count} empleados`)
            loadStoreData()
        } else {
            toast.error('Error sincronizando: ' + res.error)
        }
    }

    const handleGenerateSmart = async () => {
        if (!storeGuid) return
        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))
        const storeName = currentStore?.name || 'la tienda'

        setConfirmModal({
            isOpen: true,
            title: 'Generador Inteligente',
            message: `¿Deseas generar horarios automáticos para "${storeName}"?\n\nSe eliminarán los borradores actuales de esta semana (${startStr} a ${endStr}) y se crearán nuevos basados en el historial real y sincronización con Toast.`,
            type: 'primary',
            icon: Bot,
            onConfirm: async () => {
                setIsGenerating(true)
                try {
                    const res = await fetch('/api/scheduler/generate-smart', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            storeId: storeGuid,
                            startDate: startStr,
                            endDate: endStr
                        })
                    })

                    const data = await res.json()
                    if (data.success) {
                        toast.success(`¡Misión cumplida! Se generaron ${data.count} turnos inteligentes.`)
                        loadStoreData()
                    } else {
                        toast.error('Error al generar: ' + (data.error || 'Error desconocido'))
                    }
                } catch (e: any) {
                    toast.error('Error de conexión: ' + e.message)
                } finally {
                    setIsGenerating(false)
                }
            }
        })
    }
    // --- TEMPLATE LOGIC ---
    useEffect(() => {
        if (selectedStoreId) fetchTemplates()
    }, [selectedStoreId])

    const fetchTemplates = async () => {
        if (!storeGuid) return
        const supabase = await getSupabaseClient()
        const { data } = await supabase
            .from('schedule_templates')
            .select('*')
            .eq('store_id', storeGuid)
            .order('created_at', { ascending: false })
        setSavedTemplates(data || [])
    }

    const handleSaveCurrentAsTemplate = async () => {
        if (!templateName.trim()) return toast.error('Ingresa un nombre para la plantilla')
        setIsSavingTemplate(true)
        try {
            const supabase = await getSupabaseClient()

            // 1. Create Template Record
            const { data: template, error: tErr } = await supabase
                .from('schedule_templates')
                .insert({
                    store_id: storeGuid,
                    name: templateName,
                    description: `Guardado el ${new Date().toLocaleDateString()}`
                })
                .select()
                .single()

            if (tErr) throw tErr

            // 2. Prepare Items
            const items = shifts.map(s => {
                const startTime = new Date(s.start_time)
                const endTime = new Date(s.end_time)

                // Day of Week offset from Monday (0-6)
                const d = new Date(s.shift_date + 'T12:00:00')
                let day = d.getDay() // 0=Sun, 1=Mon...
                const dayOffset = day === 0 ? 6 : day - 1 // 0=Mon... 6=Sun

                return {
                    template_id: template.id,
                    employee_id: s.employee_id,
                    job_id: s.job_id,
                    day_of_week: dayOffset,
                    start_time: startTime.toTimeString().slice(0, 5),
                    end_time: endTime.toTimeString().slice(0, 5),
                    is_open: s.is_open
                }
            })

            if (items.length > 0) {
                const { error: iErr } = await supabase.from('schedule_template_items').insert(items)
                if (iErr) throw iErr
            }

            toast.success('¡Template guardado con éxito!')
            setTemplateName('')
            setShowTemplateModal(false)
            fetchTemplates()
        } catch (error: any) {
            toast.error('Error al guardar template: ' + error.message)
        } finally {
            setIsSavingTemplate(false)
        }
    }

    const handleApplyTemplate = async (templateId: string) => {
        setConfirmModal({
            isOpen: true,
            title: 'Aplicar Plantilla',
            message: '¿Estás seguro de aplicar esta plantilla?\n\nEsto reemplazará todos los borradores actuales de esta semana. Los turnos ya publicados no se verán afectados.',
            type: 'warning',
            icon: LayoutTemplate,
            onConfirm: async () => {
                setSyncing(true)
                try {
                    const supabase = await getSupabaseClient()

                    // 1. Fetch Template Items
                    const { data: items, error: fetchErr } = await supabase
                        .from('schedule_template_items')
                        .select('*')
                        .eq('template_id', templateId)

                    if (fetchErr) throw fetchErr
                    if (!items || items.length === 0) return toast.error('La plantilla está vacía')

                    // 2. Clear current drafts
                    const startStr = formatDateISO(weekStart)
                    const endStr = formatDateISO(addDays(weekStart, 6))
                    await supabase
                        .from('shifts')
                        .delete()
                        .eq('store_id', storeGuid)
                        .eq('status', 'draft')
                        .gte('shift_date', startStr)
                        .lte('shift_date', endStr)

                    // 3. Create new shifts based on template
                    const newShifts = items.map(item => {
                        const targetDay = addDays(weekStart, item.day_of_week)
                        const dateStr = formatDateISO(targetDay)

                        const start = new Date(`${dateStr}T${item.start_time}:00`)
                        const end = new Date(`${dateStr}T${item.end_time}:00`)
                        if (end < start) end.setDate(end.getDate() + 1)

                        return {
                            employee_id: item.employee_id,
                            job_id: item.job_id,
                            store_id: storeGuid,
                            start_time: start.toISOString(),
                            end_time: end.toISOString(),
                            shift_date: dateStr,
                            is_open: item.is_open,
                            status: 'draft'
                        }
                    })

                    const { error: insErr } = await supabase.from('shifts').insert(newShifts)
                    if (insErr) throw insErr

                    toast.success('Template aplicado exitosamente')
                    setShowTemplateModal(false)
                    loadStoreData()
                } catch (error: any) {
                    toast.error('Error al aplicar template: ' + error.message)
                } finally {
                    setSyncing(false)
                }
            }
        })
    }

    const handleDeleteTemplate = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        setConfirmModal({
            isOpen: true,
            title: 'Eliminar Plantilla',
            message: '¿Estás seguro de eliminar esta plantilla permanentemente?\nEsta acción no se puede deshacer.',
            type: 'danger',
            icon: Trash2,
            onConfirm: async () => {
                const supabase = await getSupabaseClient()
                await supabase.from('schedule_templates').delete().eq('id', id)
                fetchTemplates()
            }
        })
    }

    const [draggedShift, setDraggedShift] = useState<any>(null)
    const [isCtrlPressed, setIsCtrlPressed] = useState(false)
    const [modalConfig, setModalConfig] = useState<any>({ isOpen: false, data: null, targetDate: null, targetEmpId: null })

    // Derived
    const weekStart = useMemo(() => getMonday(currentDate), [currentDate])
    const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart])

    // Derived: Current Store Object and GUID
    const currentStore = useMemo(() => stores.find(s => String(s.id) === String(selectedStoreId)), [stores, selectedStoreId])
    const storeGuid = currentStore?.external_id

    // 1. Initial Load
    useEffect(() => {
        async function loadBasics() {
            setLoading(true)
            const supabase = await getSupabaseClient()

            // Fetch Stores
            const { data: storesData } = await supabase.from('stores').select('*').order('name')
            if (storesData) {
                setStores(storesData)
                if (storesData.length > 0) {
                    const lynwood = storesData.find((s: any) => s.name.toLowerCase().includes('lynwood'));
                    if (lynwood) {
                        setSelectedStoreId(String(lynwood.id));
                    } else {
                        setSelectedStoreId(String(storesData[0].id));
                    }
                }
            }

            // Fetch Jobs
            const { data: jobsData } = await supabase.from('toast_jobs').select('*').order('title')
            if (jobsData) setJobs(jobsData)

            setLoading(false)
        }
        loadBasics()
    }, [])

    async function loadStoreData() {
        if (!storeGuid) return;
        setSyncing(true)
        const supabase = await getSupabaseClient()
        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))

        // Fetch Employees (Filter by Store GUID in store_ids JSONB)
        const { data: allEmpData, error: empError } = await supabase
            .from('toast_employees')
            .select('*')
            .order('sort_order', { ascending: true }) // Sort by order first
            .order('first_name', { ascending: true }) // Then by name

        if (empError) {
            console.error('Supabase Error:', JSON.stringify(empError, null, 2))
            toast.error('Error cargando empleados: ' + empError.message)
        }

        let rawEmployees = []
        if (allEmpData) {
            rawEmployees = allEmpData.filter((e: any) => {
                if (Array.isArray(e.store_ids)) return e.store_ids.includes(storeGuid)
                if (typeof e.store_ids === 'string') return e.store_ids.includes(storeGuid)
                return false
            })
        }

        const { data: shiftData } = await supabase
            .from('shifts')
            .select('*')
            .eq('store_id', storeGuid)
            .gte('shift_date', startStr)
            .lte('shift_date', endStr)

        if (shiftData) setShifts(shiftData)

        const sortedEmployees = rawEmployees.sort((a: any, b: any) => {
            const aShifts = (shiftData || []).filter(s => s.employee_id === a.id);
            const bShifts = (shiftData || []).filter(s => s.employee_id === b.id);
            const aJobGuid = a.job_references?.[0]?.guid;
            const bJobGuid = b.job_references?.[0]?.guid;
            const aJob = jobs.find((j: any) => j.guid === aJobGuid)?.title || '';
            const bJob = jobs.find((j: any) => j.guid === bJobGuid)?.title || '';
            const weightA = getRoleWeight(aJob, aShifts);
            const weightB = getRoleWeight(bJob, bShifts);
            const isManagerA = weightA < 100
            const isManagerB = weightB < 100
            if (isManagerA && !isManagerB) return -1
            if (!isManagerA && isManagerB) return 1
            if (isManagerA && isManagerB) if (weightA !== weightB) return weightA - weightB
            if (!isManagerA && !isManagerB) {
                const hasShiftsA = aShifts.length > 0
                const hasShiftsB = bShifts.length > 0
                if (hasShiftsA && !hasShiftsB) return -1
                if (!hasShiftsA && hasShiftsB) return 1
            }
            if (weightA !== weightB) return weightA - weightB;
            const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
            const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
            return nameA.localeCompare(nameB);
        });

        setEmployees(sortedEmployees)
        setSyncing(false)
    }

    // 2. Load Data when Store/Date changes
    useEffect(() => {
        loadStoreData()
    }, [storeGuid, weekStart, jobs.length])

    // --- DRAG & DROP (EMPLOYEES) ---
    // Framer Motion Reorder handles the visual logic, we just handle the outcome
    const handleReorder = async (newVisibleOrder: any[]) => {
        // 1. Update main employees state
        // We need to merge the newly ordered visible employees back into the full list
        // so that non-visible employees (if any) aren't lost and the state is consistent.
        setEmployees(current => {
            const others = current.filter(emp => !newVisibleOrder.find(v => v.id === emp.id))
            // We'll place the visible ones according to their new order. 
            // Usually, visible ones are a contiguous block or the main set.
            // Simplified: just update with the new visible ones.
            return [...newVisibleOrder, ...others]
        })

        // 2. Persist to DB
        // We only really need to update the sort_order of the ones that were just reordered
        const updates = newVisibleOrder.map((emp, index) => ({
            id: emp.id,
            toast_guid: emp.toast_guid,
            sort_order: index + 1
        }))

        const supabase = await getSupabaseClient()
        const { error } = await supabase.from('toast_employees').upsert(updates, { onConflict: 'id' }).select('id')

        if (error) {
            console.error('Error saving order:', error.message)
            toast.error('Error guardando el orden')
        }
    }

    const handleResetOrder = async () => {
        setConfirmModal({
            isOpen: true,
            title: 'Restablecer Orden',
            message: '¿Restablecer el orden jerárquico por roles?\nEsto ordenará a los empleados por Manager, Assistant, etc.',
            type: 'primary',
            icon: ArrowDownAZ,
            onConfirm: async () => {
                const sorted = [...employees].sort((a, b) => {
                    const aShifts = (shifts || []).filter(s => s.employee_id === a.id);
                    const bShifts = (shifts || []).filter(s => s.employee_id === b.id);
                    const aJob = a.job_references?.[0]?.title || '';
                    const bJob = b.job_references?.[0]?.title || '';

                    const weightA = getRoleWeight(aJob, aShifts);
                    const weightB = getRoleWeight(bJob, bShifts);

                    if (weightA !== weightB) return weightA - weightB;

                    const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
                    const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
                    return nameA.localeCompare(nameB);
                })

                setEmployees(sorted)

                const updates = sorted.map((emp, index) => ({
                    id: emp.id,
                    toast_guid: emp.toast_guid,
                    sort_order: index + 1
                }))

                const supabase = await getSupabaseClient()
                const { error } = await supabase.from('toast_employees').upsert(updates, { onConflict: 'id' }).select('id')

                if (error) toast.error('Error al resetear orden: ' + (error.message || ''))
                else toast.success('Orden jerárquico restablecido')
            }
        })
    }

    // Keyboard Listeners
    useEffect(() => {
        const down = (e: KeyboardEvent) => (e.ctrlKey || e.shiftKey) && setIsCtrlPressed(true)
        const up = (e: KeyboardEvent) => setIsCtrlPressed(false)
        window.addEventListener('keydown', down)
        window.addEventListener('keyup', up)
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    }, [])


    // --- ACTIONS ---

    const handleSaveShift = async (shiftData: Shift) => {
        if (!storeGuid) return
        const supabase = await getSupabaseClient()

        // Optimistic Update
        const tempId = shiftData.id || `temp-${Date.now()}`
        const optimisticShift = { ...shiftData, id: tempId, store_id: storeGuid }

        if (shiftData.id) {
            setShifts(prev => prev.map(s => s.id === shiftData.id ? optimisticShift : s))
        } else {
            setShifts(prev => [...prev, optimisticShift])
        }

        const payload = { ...shiftData, store_id: storeGuid }
        delete payload.id // let DB gen ID for insert, but using upsert below needs ID if edit

        // Ensure dates are ISO strings
        if (payload.start_time instanceof Date) payload.start_time = payload.start_time.toISOString()
        if (payload.end_time instanceof Date) payload.end_time = payload.end_time.toISOString()

        // Sync shift_date with start_time (local date part)
        if (payload.start_time) {
            const d = new Date(payload.start_time)
            // Use local date part for shift_date
            const datePart = d.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
            payload.shift_date = datePart
        }

        let result;
        if (shiftData.id && !shiftData.id.startsWith('temp-')) {
            result = await supabase.from('shifts').update(payload).eq('id', shiftData.id).select().single()
        } else {
            // remove id for insert
            const { id, ...insertPayload } = payload
            result = await supabase.from('shifts').insert(insertPayload).select().single()
        }

        if (result.data) {
            setShifts(prev => prev.map(s => s.id === tempId || s.id === result.data.id ? result.data : s))
            toast.success('Turno guardado')
        } else {
            toast.error('Error al guardar turno')
            // Revert?
        }
    }

    const handleDeleteShift = async (id: string) => {
        const supabase = await getSupabaseClient()
        setShifts(prev => prev.filter(s => s.id !== id))
        await supabase.from('shifts').delete().eq('id', id)
        toast.success('Turno eliminado')
    }

    const handleClearDrafts = async () => {
        if (!storeGuid) return
        const draftShifts = shifts.filter(s => s.status === 'draft')
        if (draftShifts.length === 0) return toast.info('No hay borradores para limpiar')

        setConfirmModal({
            isOpen: true,
            title: 'Limpiar Borradores',
            message: `¿Estás seguro de eliminar los ${draftShifts.length} turnos en borrador de esta semana?\nEsta acción es irreversible.`,
            type: 'danger',
            icon: Trash2,
            onConfirm: async () => {
                try {
                    const supabase = await getSupabaseClient()
                    const draftIds = draftShifts.map(s => s.id)

                    const { error } = await supabase.from('shifts').delete().in('id', draftIds)
                    if (error) throw error

                    setShifts(prev => prev.filter(s => s.status !== 'draft'))
                    toast.success('Borrador limpiado')
                } catch (e: any) {
                    toast.error('Error al limpiar borrador: ' + e.message)
                }
            }
        })
    }

    const handlePublish = async () => {
        if (!storeGuid) return
        const draftIds = shifts.filter(s => s.status === 'draft').map(s => s.id)
        if (draftIds.length === 0) return toast.info('No hay borradores para publicar')

        setConfirmModal({
            isOpen: true,
            title: 'Publicar Horario',
            message: `Vas a publicar ${draftIds.length} turnos.\nSe enviarán notificaciones automáticas por Email y SMS a todo el equipo. ¿Deseas continuar?`,
            type: 'primary',
            icon: Zap,
            onConfirm: async () => {
                setLoading(true)
                try {
                    const supabase = await getSupabaseClient()

                    // 1. Update DB Status
                    const { error } = await supabase.from('shifts').update({ status: 'published' }).in('id', draftIds)
                    if (error) throw error

                    setShifts(prev => prev.map(s => draftIds.includes(s.id) ? { ...s, status: 'published' } : s))

                    // 2. Call Notification API
                    const startStr = formatDateISO(weekStart)
                    const endStr = formatDateISO(addDays(weekStart, 6))

                    const response = await fetch('/api/notifications/publish-schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            store_id: storeGuid,
                            start_date: startStr,
                            end_date: endStr
                        })
                    })

                    const result = await response.json()
                    if (result.success) {
                        toast.success(`Turnos publicados.\nEmails: ${result.stats.email} | SMS: ${result.stats.gateway_sms}`)
                    } else {
                        toast.error('Error en notificaciones: ' + result.error)
                    }
                } catch (e: any) {
                    toast.error('Error al publicar: ' + e.message)
                } finally {
                    setLoading(false)
                }
            }
        })
    }

    // --- DRAG & DROP ---
    const handleDragStart = (e: React.DragEvent, shift: any) => {
        setDraggedShift(shift)
        e.dataTransfer.effectAllowed = isCtrlPressed ? "copy" : "move"
    }

    const handleDrop = async (e: React.DragEvent, targetEmpId: string | null, targetDate: Date) => {
        e.preventDefault()
        if (!draggedShift || !storeGuid) return

        const isCopy = isCtrlPressed;
        const supabase = await getSupabaseClient()
        const durationMs = new Date(draggedShift.end_time).getTime() - new Date(draggedShift.start_time).getTime()
        const targetDateStr = formatDateISO(targetDate)

        // Preserve time, change date
        const origStart = new Date(draggedShift.start_time)
        const newStart = new Date(`${targetDateStr}T${origStart.toISOString().split('T')[1]}`)
        const newEnd = new Date(newStart.getTime() + durationMs)

        const newShiftPayload = {
            employee_id: targetEmpId, // null if dropped on open shift
            job_id: draggedShift.job_id,
            store_id: storeGuid,
            start_time: newStart.toISOString(),
            end_time: newEnd.toISOString(),
            shift_date: targetDateStr,
            status: 'draft', // Always draft when moving/copying
            is_open: !targetEmpId,
            notes: draggedShift.notes
        }

        if (isCopy) {
            // INSERT
            const { data } = await supabase.from('shifts').insert(newShiftPayload).select().single()
            if (data) setShifts([...shifts, data])
        } else {
            // MOVE (Update)
            // Optimistic update
            setShifts(prev => prev.map(s => s.id === draggedShift.id ? { ...s, ...newShiftPayload, id: s.id } : s))

            const { data } = await supabase.from('shifts').update(newShiftPayload).eq('id', draggedShift.id).select().single()
            if (data) {
                setShifts(prev => prev.map(s => s.id === data.id ? data : s))
            }
        }
        setDraggedShift(null)
    }

    // --- CALCULATIONS & MEMOIZATION ---
    // We calculate all stats once per render to avoid heavy computation in loops
    const weeklyStats = useMemo(() => {
        const stats: Record<string, any> = {}; // empId -> totals
        const shiftStats: Record<string, any> = {}; // shiftId -> { dailyOT, weeklyOT, duration, cost, isOvertime }

        // Helper purely for local use inside memo
        const calcDuration = (s: Shift) => {
            const start = new Date(s.start_time);
            const end = new Date(s.end_time);
            let rawDuration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

            // Si el fin es menor que el inicio, asumimos que cruzó la medianoche (ej: 5pm - 2am)
            if (rawDuration < 0) rawDuration += 24;

            return (rawDuration > 6) ? rawDuration - 0.5 : Math.max(0, rawDuration);
        }

        // Banker's Rounding (Round Half to Even)
        const bankersRound = (num: number) => {
            const n = num * 100;
            const i = Math.round(n);
            const remainder = Math.abs(n) % 1;
            if (Math.abs(remainder - 0.5) < 0.0000001) {
                const floor = Math.floor(n);
                return (floor % 2 === 0 ? floor : floor + 1) / 100;
            }
            return Math.round(n) / 100;
        }

        employees.forEach(emp => {
            const empShifts = shifts.filter(s => s.employee_id === emp.id);
            // Sort by start time for correct weekly accumulation
            const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

            let totalHours = 0;
            let totalWage = 0;
            let totalOT = 0;
            let regularHoursAccumulator = 0;

            // Para acumular horas por jornada diaria (shift_date)
            let dailyHoursAccumulator = 0;
            let lastShiftDate = "";

            sorted.forEach(s => {
                const duration = calcDuration(s);

                // Si cambiamos de fecha de turno (shift_date), reseteamos el acumulador diario
                if (s.shift_date !== lastShiftDate) {
                    dailyHoursAccumulator = 0;
                    lastShiftDate = s.shift_date;
                }

                // --- 1. DAILY OT (Acumulado por jornada) ---
                let dailyOT = 0;
                const hoursBeforeThisShift = dailyHoursAccumulator;
                dailyHoursAccumulator += duration;

                if (hoursBeforeThisShift >= 8) {
                    // Ya estábamos en OT desde el principio de este turno
                    dailyOT = duration;
                } else if (hoursBeforeThisShift + duration > 8) {
                    // Este turno cruza el límite de las 8 horas
                    dailyOT = (hoursBeforeThisShift + duration) - 8;
                }
                const dailyRegular = duration - dailyOT;

                // --- 2. WEEKLY OT (Acumulado semanal) ---
                let weeklyOT = 0;
                // Las horas que ya son Daily OT no cuentan para el acumulador semanal regular (según CA law)
                if (regularHoursAccumulator >= 40) {
                    weeklyOT = dailyRegular;
                } else if (regularHoursAccumulator + dailyRegular > 40) {
                    weeklyOT = (regularHoursAccumulator + dailyRegular) - 40;
                }

                // Actualizar acumulador semanal (solo con horas que no son de ningún tipo de OT)
                regularHoursAccumulator += (dailyRegular - weeklyOT);

                // Wage Lookup
                let rate = 16.00;
                if (emp.wage_data && Array.isArray(emp.wage_data)) {
                    const wEntry = emp.wage_data.find((w: any) => {
                        const j = jobs.find(job => job.id === s.job_id);
                        return j && (w.job_guid === j.guid || w.job_guid === j.id);
                    });
                    if (wEntry) rate = wEntry.wage;
                    else if (emp.wage_data.length > 0) rate = emp.wage_data[0].wage;
                }

                const totalShiftOT = dailyOT + weeklyOT;
                const regularPaid = duration - totalShiftOT;
                const cost = (regularPaid * rate) + (totalShiftOT * rate * 1.5);
                const roundedCost = bankersRound(cost);

                shiftStats[s.id] = {
                    duration,
                    dailyOT,
                    weeklyOT,
                    totalOT: totalShiftOT,
                    cost: roundedCost,
                    isOvertime: totalShiftOT > 0
                };

                totalHours += duration;
                totalWage += roundedCost;
                totalOT += totalShiftOT;
            });

            stats[emp.id] = { totalHours, totalWage, totalOT };
        });

        return { stats, shiftStats };
    }, [shifts, employees, jobs]);

    // --- FILTER LOGIC ---
    const visibleEmployees = useMemo(() => {
        // Roles we want to show for Active employees (without shifts)
        const ALLOWED_ROLES = ['manager', 'shift', 'cook', 'cocinero', 'cashier', 'cajero', 'prep', 'taquero', 'assistant', 'asst'];

        return employees.filter(emp => {
            // 1. ALWAYS SHOW if they have a shift this week
            const hasShift = shifts.some(s => s.employee_id === emp.id);
            if (hasShift) return true;

            // 2. If no shift, ONLY SHOW if NOT deleted AND has a relevant role
            if (emp.deleted) return false;

            // Check roles
            const empJobGuids = new Set<string>();
            if (emp.job_references && Array.isArray(emp.job_references)) {
                emp.job_references.forEach((r: any) => empJobGuids.add(r.guid));
            }
            if (emp.wage_data && Array.isArray(emp.wage_data)) {
                emp.wage_data.forEach((w: any) => empJobGuids.add(w.job_guid));
            }

            let hasAllowedRole = false;
            for (const guid of empJobGuids) {
                const job = jobs.find(j => j.guid === guid || j.id === guid);
                if (job && job.title) {
                    const titleLower = job.title.toLowerCase();
                    if (ALLOWED_ROLES.some(role => titleLower.includes(role))) {
                        hasAllowedRole = true;
                        break;
                    }
                }
            }

            return hasAllowedRole;
        });
    }, [employees, shifts, jobs]);

    // Re-declare format functions if used inside loops, or keep them outside.
    // formatTime12h should be outside or above.

    // Legacy functions replaced by stats logic above
    const calculateShiftHours = (s: Shift) => {
        const d = weeklyStats.shiftStats[s.id];
        return d ? d.duration : 0;
    }

    const getShiftsForCell = (empId: string | null, day: Date) => {
        const dateStr = formatDateISO(day)
        return shifts.filter(s => {
            if (empId === null) {
                if (s.employee_id !== null) return false
            } else {
                if (s.employee_id !== empId) return false
            }
            // Use shift_date directly as the source of truth for the grid
            return s.shift_date === dateStr
        })
    }

    if (loading) return <SurpriseLoader />

    return (
        <div className="flex flex-col h-screen bg-gray-50 dark:bg-slate-950 overflow-hidden">
            <ShiftModal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onSave={handleSaveShift}
                onDelete={handleDeleteShift}
                initialData={modalConfig.data}
                defaultDate={modalConfig.targetDate}
                defaultEmpId={modalConfig.targetEmpId}
                employees={employees}
                jobs={jobs}
            />

            <TemplateModal
                isOpen={showTemplateModal}
                onClose={() => setShowTemplateModal(false)}
                templates={savedTemplates}
                onSave={handleSaveCurrentAsTemplate}
                onApply={handleApplyTemplate}
                onDelete={handleDeleteTemplate}
                isSaving={isSavingTemplate}
                name={templateName}
                setName={setTemplateName}
            />

            <PremiumConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                type={confirmModal.type}
                icon={confirmModal.icon}
            />

            {/* HEADER */}
            <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-30">
                <div className="flex items-center gap-6">
                    <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <Calendar className="text-indigo-600" />
                        Planificador
                    </h1>

                    <div className="relative">
                        <select
                            value={selectedStoreId}
                            onChange={(e) => setSelectedStoreId(e.target.value)}
                            className="bg-gray-100 dark:bg-slate-800 border-0 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 cursor-pointer min-w-[200px]"
                        >
                            {stores.map(s => (
                                <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                            ))}
                        </select>
                    </div>

                    <WeekSelector currentDate={currentDate} onDateChange={setCurrentDate} weekStart={weekStart} />

                    {syncing && <div className="flex items-center gap-3 text-xs text-indigo-500 font-bold animate-pulse"><Loader2 size={12} className="animate-spin" /> Syncing...</div>}
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold uppercase">
                        <Clock size={14} />
                        <span>Borrador: {shifts.filter(s => s.status === 'draft').length}</span>
                    </div>
                    <div className="relative">
                        <button
                            onClick={handlePublish}
                            onMouseEnter={() => setShowPublishInfo(true)}
                            onMouseLeave={() => setShowPublishInfo(false)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-all flex items-center gap-2"
                        >
                            <Zap size={16} fill="currentColor" /> Publicar
                        </button>
                        <AnimatePresence>
                            {showPublishInfo && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                    className="absolute top-full mt-2 right-0 w-72 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-indigo-500/30 z-[100]"
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <Zap size={14} className="text-indigo-400" />
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Publicación Oficial</h4>
                                    </div>
                                    <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                        Publica el horario y activa el envío automático de notificaciones por <span className="text-indigo-300 font-bold">Email y SMS</span>.
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </header >

            {/* FLOATING TOOLBAR */}
            <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3 p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-white/20 dark:border-slate-800 animate-in slide-in-from-right duration-500">
                {/* AI Button - Primary */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleGenerateSmart}
                        disabled={isGenerating}
                        onMouseEnter={() => setShowAIInfo(true)}
                        onMouseLeave={() => setShowAIInfo(false)}
                        whileHover={isGenerating ? {} : { scale: 1.1 }}
                        whileTap={isGenerating ? {} : { scale: 0.9 }}
                        className={`p-3 rounded-2xl flex items-center justify-center transition-all shadow-lg
                            ${isGenerating ? 'bg-gray-100 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 dark:shadow-none'}
                        `}
                    >
                        {isGenerating ? <Loader2 size={24} className="animate-spin" /> : <Bot size={24} />}
                    </motion.button>
                    <AnimatePresence>
                        {showAIInfo && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                                className="absolute right-full mr-5 top-0 w-80 p-5 bg-slate-900 text-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-indigo-500/30 z-[100] overflow-hidden"
                            >
                                {/* Glassmorphism Background Decoration */}
                                <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl"></div>

                                <div className="relative z-10">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                            <Bot size={20} className="text-indigo-400" />
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black uppercase tracking-[0.2em] text-indigo-400">Generador de Horarios Inteligentes</h4>
                                            <div className="flex gap-1 mt-1">
                                                {[1, 2, 3].map(i => (
                                                    <motion.div
                                                        key={i}
                                                        className="w-1 h-1 bg-indigo-400 rounded-full"
                                                        animate={{ opacity: [0.3, 1, 0.3] }}
                                                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-[13px] text-slate-300 leading-relaxed font-medium">
                                        El sistema sincroniza datos en tiempo real de <span className="text-indigo-300 font-bold">Toast</span>, analiza patrones de turnos de los últimos 6 meses y aplica automáticamente <span className="text-indigo-300 font-bold">reglas de descanso obligatorio</span> para generar el horario más preciso basado en el historial real del equipo.
                                    </p>

                                    {/* Animated Neural Network-like Waveform */}
                                    <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estado: Listo</span>
                                        <div className="flex items-end gap-1 h-4">
                                            {[1, 2, 3, 4, 5, 6, 7].map(i => (
                                                <motion.div
                                                    key={i}
                                                    className="w-1 bg-indigo-500/60 rounded-full"
                                                    animate={{ height: ['30%', '100%', '30%'] }}
                                                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Template Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={() => setShowTemplateModal(true)}
                        onMouseEnter={() => setShowTemplateInfo(true)}
                        onMouseLeave={() => setShowTemplateInfo(false)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className="p-3 bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20"
                    >
                        <LayoutTemplate size={24} />
                    </motion.button>
                    <AnimatePresence>
                        {showTemplateInfo && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="absolute right-full mr-5 top-0 w-64 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-amber-500/30 z-[100]"
                            >
                                <div className="flex items-center gap-2 mb-2 text-amber-400">
                                    <LayoutTemplate size={14} />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest">Plantilla Ideal</h4>
                                </div>
                                <p className="text-[12px] text-slate-300">Carga o guarda estructuras base para ganar tiempo.</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="h-px bg-gray-200 dark:bg-slate-800 mx-2 my-1" />

                {/* Sync Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleSyncEmployees}
                        disabled={isSyncingEmployees}
                        onMouseEnter={() => setShowSyncInfo(true)}
                        onMouseLeave={() => setShowSyncInfo(false)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className="p-3 text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 rounded-2xl flex items-center justify-center transition-all bg-gray-50 dark:bg-slate-800/50"
                    >
                        <RefreshCcw size={22} className={isSyncingEmployees ? "animate-spin" : ""} />
                    </motion.button>
                    <AnimatePresence>
                        {showSyncInfo && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                                className="absolute right-full mr-5 top-0 w-64 p-5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-amber-500/30 z-[100] overflow-hidden"
                            >
                                <div className="absolute -top-5 -right-5 w-20 h-20 bg-amber-500/10 rounded-full blur-2xl"></div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="p-2 bg-amber-500/20 rounded-xl border border-amber-500/30">
                                            <LayoutTemplate size={18} className="text-amber-400" />
                                        </div>
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">Plantilla Ideal</h4>
                                    </div>
                                    <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                        Guarda este horario como <span className="text-amber-300 font-bold">Template</span> o carga uno existente para ahorrar tiempo.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Sort Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleResetOrder}
                        onMouseEnter={() => setShowOrderInfo(true)}
                        onMouseLeave={() => setShowOrderInfo(false)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className="p-3 text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 rounded-2xl flex items-center justify-center transition-all bg-gray-50 dark:bg-slate-800/50"
                    >
                        <ArrowDownAZ size={24} />
                    </motion.button>
                    <AnimatePresence>
                        {showOrderInfo && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                                className="absolute right-full mr-5 top-0 w-64 p-5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-indigo-500/30 z-[100] overflow-hidden"
                            >
                                <div className="absolute -top-5 -right-5 w-20 h-20 bg-indigo-500/10 rounded-full blur-2xl"></div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                            <ArrowDownAZ size={18} className="text-indigo-400" />
                                        </div>
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Ordenar Lista</h4>
                                    </div>
                                    <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                        Restablece el orden <span className="text-indigo-300 font-bold">Jerárquico</span> por roles y antigüedad.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="h-px bg-gray-200 dark:bg-slate-800 mx-2 my-1" />

                {/* Clear Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleClearDrafts}
                        onMouseEnter={() => setShowClearInfo(true)}
                        onMouseLeave={() => setShowClearInfo(false)}
                        whileHover={{ scale: 1.1, backgroundColor: '#fef2f2', color: '#ef4444' }}
                        whileTap={{ scale: 0.9 }}
                        className="p-3 text-gray-400 hover:text-red-500 rounded-2xl flex items-center justify-center transition-all bg-gray-50 dark:bg-slate-800/50"
                    >
                        <Trash2 size={24} />
                    </motion.button>
                    <AnimatePresence>
                        {showClearInfo && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                                className="absolute right-full mr-5 bottom-0 w-64 p-5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-red-500/30 z-[100] overflow-hidden"
                            >
                                <div className="absolute top-0 right-0 w-20 h-20 bg-red-500/10 rounded-full blur-2xl"></div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="p-2 bg-red-500/20 rounded-xl border border-red-500/30">
                                            <Trash2 size={18} className="text-red-400" />
                                        </div>
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Limpiar Todo</h4>
                                    </div>
                                    <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                        Elimina permanentemente todos los turnos en <span className="text-red-300 font-bold">Borrador</span> de esta semana.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* MAIN GRID */}
            <div className="flex-1 overflow-auto bg-gray-50 dark:bg-slate-950 relative custom-scrollbar">
                <div className="w-[99%] mx-auto h-full border-x border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <table className="w-full border-separate border-spacing-0 table-fixed">
                        <colgroup>
                            <col className="w-[25%] min-w-[300px]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                            <col className="w-[10.7%]" />
                        </colgroup>
                        <thead className="sticky top-0 z-20 bg-white dark:bg-slate-900 shadow-sm ring-1 ring-black/5">
                            <tr>
                                <th className="sticky left-0 z-30 bg-white dark:bg-slate-900 border-r border-b border-gray-200 dark:border-slate-800 p-4 text-left shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                                    <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Empleados ({visibleEmployees.length})</span>
                                </th>
                                {weekDays.map(day => (
                                    <th key={day.toISOString()} className="border-b border-r border-gray-200 dark:border-slate-800 p-2 text-center bg-gray-50/50 dark:bg-slate-900">
                                        <div className="flex flex-col items-center">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase">{getDayName(day)}</span>
                                            <div className={`flex flex-col leading-none mt-1 items-center ${day.toDateString() === new Date().toDateString() ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-900 dark:text-white'
                                                }`}>
                                                <span className="text-xl font-black">{day.getDate()}</span>
                                            </div>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <Reorder.Group as="tbody" axis="y" values={visibleEmployees} onReorder={handleReorder} className="bg-white dark:bg-slate-900">
                            {/* OPEN SHIFTS ROW */}
                            <tr className="bg-gray-50/30 dark:bg-slate-800/20">
                                <td className="sticky left-0 z-10 bg-gray-50 dark:bg-slate-800 border-r border-b border-gray-200 dark:border-slate-800 p-3 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]">
                                    <div className="flex items-center gap-3 opacity-70">
                                        <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center">
                                            <Plus size={18} className="text-gray-400" />
                                        </div>
                                        <span className="font-bold text-gray-500 text-sm uppercase">Turnos Abiertos</span>
                                    </div>
                                </td>
                                {weekDays.map(day => (
                                    <td
                                        key={`open-${day.toISOString()}`}
                                        className="border-r border-b border-gray-200 dark:border-slate-800 h-20 p-1 relative hover:bg-gray-50/50 transition-colors"
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => handleDrop(e, null, day)}
                                    >
                                        <div className="w-full h-full flex flex-col gap-1">
                                            {getShiftsForCell(null, day).map(shift => {
                                                const job = jobs.find(j => j.id === shift.job_id)
                                                const jobTitle = job?.title || 'Rol'
                                                const color = stringToColor(jobTitle)
                                                return (
                                                    <div
                                                        key={shift.id}
                                                        draggable
                                                        onDragStart={(e) => handleDragStart(e, shift)}
                                                        onClick={() => setModalConfig({ isOpen: true, data: shift, targetDate: day, targetEmpId: null })}
                                                        className={`p-2 rounded-md border text-sm shadow-sm cursor-pointer hover:scale-[1.02] transition-all
                                                        bg-blue-600/10 dark:bg-blue-600/10 border-dashed border-blue-400/10 dark:border-blue-500/10 text-blue-800 dark:text-blue-200
                                                    `}
                                                        style={{ borderLeftColor: color, borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
                                                    >
                                                        <div className="flex justify-between items-start text-sm font-medium mb-0.5">
                                                            <span>{formatTime12h(shift.start_time)} - {formatTime12h(shift.end_time)}</span>
                                                        </div>
                                                        <span className="text-[10px] font-medium text-gray-400 uppercase truncate block">
                                                            {jobTitle}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                            <button
                                                onClick={() => setModalConfig({ isOpen: true, data: null, targetDate: day, targetEmpId: null })}
                                                className="w-full h-full min-h-[40px] flex items-center justify-center text-gray-300 hover:text-indigo-500 hover:bg-indigo-50/50 rounded transition-colors opacity-0 hover:opacity-100"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                    </td>
                                ))}
                            </tr>

                            {/* EMPLOYEES ROWS */}
                            {visibleEmployees.map(emp => {
                                const totals = weeklyStats.stats[emp.id] || { totalHours: 0, totalWage: 0, totalOT: 0 };
                                return (
                                    <EmployeeRow
                                        key={emp.id}
                                        emp={emp}
                                        totals={totals}
                                        weekDays={weekDays}
                                        getShiftsForCell={getShiftsForCell}
                                        jobs={jobs}
                                        weeklyStats={weeklyStats}
                                        formatTime12h={formatTime12h}
                                        stringToColor={stringToColor}
                                        handleDragStart={handleDragStart}
                                        handleDrop={handleDrop}
                                        setModalConfig={setModalConfig}
                                    />
                                )
                            })}
                        </Reorder.Group>
                    </table>
                </div>
            </div>

            {/* FOOTER */}
            <div className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 p-2 text-center text-xs text-gray-400">
                Turnos: {shifts.length} | Planificador v1.0
            </div>
        </div>
    )
}

export default function Page() {
    return (
        <ProtectedRoute>
            <Suspense fallback={<SurpriseLoader />}>
                <SchedulePlanner />
            </Suspense>
        </ProtectedRoute>
    )
}

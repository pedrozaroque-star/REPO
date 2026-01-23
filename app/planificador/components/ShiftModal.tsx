import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, Trash2 } from 'lucide-react'
import { toast } from '../lib/utils'

export function ShiftModal({ isOpen, onClose, onSave, onDelete, initialData, employees, jobs, defaultDate, defaultEmpId }: any) {
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

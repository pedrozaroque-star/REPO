import React from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Plus, Mail, Phone } from 'lucide-react'
import { formatTime12h, stringToColor } from '../lib/utils'

export function EmployeeRow({
    emp,
    totals,
    weekDays,
    getShiftsForCell,
    jobs,
    weeklyStats,
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
            className="group hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors relative"
            initial={{ backgroundColor: "transparent", boxShadow: "none" }}
            animate={{ backgroundColor: "transparent", boxShadow: "none" }}
            whileDrag={{
                backgroundColor: "rgba(99, 102, 241, 0.1)",
                boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5)",
                scale: 1.01,
                zIndex: 50
            }}
        >
            <td className="sticky left-0 z-10 group-hover:z-[60] bg-white dark:bg-[#0f172a] group-hover:bg-gray-50 dark:group-hover:bg-[#1e293b] border-r border-b border-gray-200 dark:border-slate-800 p-3 transition-colors shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] w-[25%] min-w-[300px]">
                <div className="flex items-center gap-3 relative group/profile">
                    {/* Grip Handle */}
                    <div
                        onPointerDown={(e) => controls.start(e)}
                        className="text-gray-300 dark:text-slate-600 hover:text-indigo-500 dark:hover:text-indigo-400 cursor-grab active:cursor-grabbing transition-colors p-1 -ml-1 touch-none"
                    >
                        <GripVertical size={16} />
                    </div>

                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-500/20 relative shrink-0 cursor-help ring-2 ring-white dark:ring-slate-800">
                        {emp.first_name?.[0]}{emp.last_name?.[0]}
                        {totals.totalOT > 0 &&
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full border-2 border-white dark:border-slate-800 flex items-center justify-center text-[9px] font-bold">!</div>
                        }
                    </div>

                    {/* CONTACT CARD HOVER */}
                    <div className="absolute left-12 top-8 z-50 invisible group-hover/profile:visible opacity-0 group-hover/profile:opacity-100 transition-all duration-200 translate-y-2 group-hover/profile:translate-y-0 pointer-events-none group-hover/profile:pointer-events-auto">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-100 dark:border-slate-700 p-4 w-72 mt-2">
                            {/* ... (Keep existing contact card content, structurally same, just ensuring colors work) ... */}
                            {/* Minimized diff strategy: Assume existing inner content is OK or minimal change needed. 
                                 Actually, let's keep the contact card as is in the original file to avoid large diff, 
                                 the user cares about the grid rows mostly.
                             */}
                            <div className="flex items-start gap-3 mb-3 pb-3 border-b border-gray-100 dark:border-slate-700">
                                <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-lg">
                                    {emp.first_name?.[0]}{emp.last_name?.[0]}
                                </div>
                                <div>
                                    <h4 className="font-bold text-gray-900 dark:text-white text-base leading-tight">
                                        {emp.first_name} {emp.last_name}
                                    </h4>
                                    <p className="text-xs text-gray-400 font-mono mt-0.5">{emp.external_employee_id || 'No ID'}</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-300">
                                    <Mail size={14} className="text-gray-400" />
                                    <span className="truncate select-all">{emp.email || 'Sin Email'}</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-300">
                                    <Phone size={14} className="text-gray-400" />
                                    <span className="select-all">{emp.phone || 'Sin Teléfono'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col min-w-0">
                        <p className="font-bold text-gray-900 dark:text-slate-100 text-sm sm:text-base leading-tight truncate">
                            {emp.chosen_name || emp.first_name} {emp.last_name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                            {(() => {
                                const jobGuid = emp.job_references?.[0]?.guid;
                                const job = jobs.find((j: any) => j.guid === jobGuid);
                                if (!job) return null;

                                const title = job.title || 'Rol'
                                const color = stringToColor(title);
                                const titleLower = title.toLowerCase();
                                const isManager = titleLower.includes('manager') && !titleLower.includes('assist') && !titleLower.includes('asst') && !titleLower.includes('shift');

                                return (
                                    <>
                                        <span
                                            className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border shrink-0 opacity-90 dark:opacity-100"
                                            style={{
                                                backgroundColor: `${color}20`, // Slightly stronger bg
                                                color: color,
                                                borderColor: `${color}40`
                                            }}
                                        >
                                            {job.title}
                                        </span>
                                        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-slate-400 font-medium uppercase tracking-tight">
                                            <span>{totals.totalHours.toFixed(2)} hrs</span>
                                            {!isManager && (
                                                <>
                                                    <span className="text-gray-300 dark:text-slate-700">|</span>
                                                    <span>${totals.totalWage.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                        {totals.totalOT > 0 && (
                            <p className="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-wider mt-0.5">
                                {totals.totalOT.toFixed(1)}h OT
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
                            className="border-r border-b border-gray-200 dark:border-slate-800 h-24 p-1.5 relative transition-colors bg-transparent"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => handleDrop(e, emp.id, day)}
                        >
                            <div className="w-full h-full flex flex-col gap-1.5">
                                {cellShifts.map((shift: any) => {
                                    const job = jobs.find((j: any) => j.id === shift.job_id)
                                    const jobTitle = job?.title || 'Rol'
                                    const sStats = weeklyStats[shift.id] || { totalOT: 0, dailyOT: 0, weeklyOT: 0 };
                                    const isPublished = shift.status === 'published'

                                    return (
                                        <div
                                            key={shift.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, shift)}
                                            onClick={() => setModalConfig({ isOpen: true, data: shift, targetDate: day, targetEmpId: emp.id })}
                                            // PREMIUM CARD STYLE
                                            className={`relative p-2.5 rounded-lg border-l-[4px] shadow-sm cursor-grab active:cursor-grabbing hover:scale-[1.02] hover:shadow-md transition-all group/card
                                            ${isPublished
                                                    ? 'bg-blue-50 dark:bg-[#1e293b] border-blue-500' // Dark mode: Slate 800 bg
                                                    : 'bg-white dark:bg-slate-900 border-dashed border-gray-300 dark:border-slate-600'}
                                        `}
                                            style={{ borderLeftColor: isPublished ? stringToColor(jobTitle) : undefined }}
                                        >
                                            <div className="flex flex-col justify-center gap-0.5">
                                                <div className={`font-bold leading-none text-sm tracking-tight
                                                    ${isPublished ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-slate-400'}
                                                `}>
                                                    {formatTime12h(shift.start_time)} - {formatTime12h(shift.end_time)}
                                                </div>

                                                {/* OT Indicator */}
                                                {sStats.totalOT > 0 && (
                                                    <div className="mt-1 flex items-center gap-1">
                                                        <div className="h-1 w-1 bg-red-500 rounded-full animate-pulse"></div>
                                                        <span className="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-wider">{sStats.totalOT.toFixed(1)}h OT</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}

                                <button
                                    onClick={() => setModalConfig({ isOpen: true, data: null, targetDate: day, targetEmpId: emp.id })}
                                    className="hidden group-hover:flex w-full py-1 items-center justify-center text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded text-xs transition-colors mt-auto opacity-0 group-hover:opacity-100"
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                        </td>
                    )
                })
            }
        </Reorder.Item >
    );
}

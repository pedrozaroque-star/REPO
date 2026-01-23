import React from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Plus } from 'lucide-react'
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

                                const title = job.title || 'Rol'
                                const color = stringToColor(title);
                                const titleLower = title.toLowerCase();
                                const isManager = titleLower.includes('manager') && !titleLower.includes('assist') && !titleLower.includes('asst') && !titleLower.includes('shift');

                                return (
                                    <>
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
                                        <div className="flex items-center gap-1.5 text-[11px] text-gray-900 dark:text-gray-100 font-medium uppercase tracking-tight">
                                            <span>{totals.totalHours.toFixed(2)} hrs</span>
                                            {!isManager && (
                                                <>
                                                    <span className="text-gray-300 dark:text-gray-700">|</span>
                                                    <span>${totals.totalWage.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
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
                                    const sStats = weeklyStats[shift.id] || { totalOT: 0, dailyOT: 0, weeklyOT: 0 };

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

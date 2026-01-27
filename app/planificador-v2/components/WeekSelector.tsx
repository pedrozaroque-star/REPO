import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, formatDateNice } from '../lib/utils'

export function WeekSelector({ currentDate, onDateChange, weekStart }: { currentDate: Date, onDateChange: (d: Date) => void, weekStart: Date }) {
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

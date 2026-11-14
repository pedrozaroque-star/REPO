import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, formatDateNice } from '../lib/utils'
import { useLanguage } from '@/lib/i18n'

export function WeekSelector({ currentDate, onDateChange, weekStart }: { currentDate: Date, onDateChange: (d: Date) => void, weekStart: Date }) {
    const { t, language } = useLanguage();
    const locale = language === 'en' ? 'en-US' : 'es-ES';
    const weekEnd = addDays(weekStart, 6);
    const dateRangeText = `${formatDateNice(weekStart, locale)} - ${formatDateNice(weekEnd, locale)}, ${weekStart.getFullYear()}`;

    return (
        <div className="flex items-center bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-1">
            <button
                type="button"
                onClick={() => onDateChange(addDays(currentDate, -7))}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md text-gray-500 min-w-[36px] min-h-[36px] flex items-center justify-center"
                aria-label={t('planner.mobile.previous_week')}
            >
                <ChevronLeft size={18} />
            </button>
            <div className="px-2 sm:px-3 text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-200 min-w-[130px] sm:min-w-[140px] text-center select-none">
                {dateRangeText}
            </div>
            <button
                type="button"
                onClick={() => onDateChange(addDays(currentDate, 7))}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md text-gray-500 min-w-[36px] min-h-[36px] flex items-center justify-center"
                aria-label={t('planner.mobile.next_week')}
            >
                <ChevronRight size={18} />
            </button>
            <div className="border-l border-gray-200 dark:border-slate-700 ml-1 pl-1">
                <button
                    type="button"
                    onClick={() => onDateChange(new Date())}
                    className="px-2.5 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded"
                >
                    {t('planner.mobile.today')}
                </button>
            </div>
        </div>
    );
}

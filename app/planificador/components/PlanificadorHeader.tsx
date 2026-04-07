
import { Calendar, Loader2, Clock, Zap, ChevronRight, Sliders, Coffee } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { WeekSelector } from './WeekSelector'
import { formatStoreName } from '../lib/utils'
import { useLanguage } from '@/lib/i18n'
import Link from 'next/link'

export function PlanificadorHeader({
    selectedStoreId,
    setSelectedStoreId,
    stores,
    weekStart,
    currentDate,
    setCurrentDate,
    syncing,
    draftCount,
    handlePublish,
    showPublishInfo,
    setShowPublishInfo,
    googleConnected,
    googleEmail,
    isToolbarVisible,
    setIsToolbarVisible
}: any) {
    const { t } = useLanguage()

    return (
        <>
            <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between shrink-0 shadow-sm z-30">
                <div className="flex items-center gap-2 sm:gap-6">
                    <h1 className="text-lg sm:text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <Calendar className="text-indigo-600" size={24} />
                        <span className="hidden xs:inline">{t('planner.title')}</span>
                    </h1>

                    <div className="relative flex-1 sm:flex-none max-w-[150px] sm:max-w-none">
                        <select
                            value={selectedStoreId}
                            onChange={(e) => setSelectedStoreId(e.target.value)}
                            className="w-full bg-gray-100 dark:bg-slate-800 border-0 rounded-lg px-2 sm:px-4 py-2 text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                        >
                            {stores.map((s: any) => (
                                <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                            ))}
                        </select>
                    </div>

                    <div className="hidden sm:block">
                        <WeekSelector currentDate={currentDate} onDateChange={setCurrentDate} weekStart={weekStart} />
                    </div>

                    {syncing && <div className="hidden sm:flex items-center gap-3 text-xs text-indigo-500 font-bold animate-pulse"><Loader2 size={12} className="animate-spin" /> {t('planner.syncing')}</div>}
                </div>

                <div className="flex items-center gap-2 sm:gap-4">
                    <Link 
                        href={`/descansos?store=${selectedStoreId}&date=${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`} 
                        className="hidden md:flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-lg text-xs font-black shadow-md transition-transform hover:scale-105 active:scale-95"
                    >
                        <Coffee size={16} />
                        <span className="drop-shadow-sm">AI Breaks</span>
                    </Link>
                    
                    <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold uppercase">
                        <Clock size={14} />
                        <span>
                            {draftCount}
                            <span className="hidden sm:inline ml-1 opacity-80">{t('planner.header.draft_label')}</span>
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {googleConnected && (
                            <div className="hidden xs:flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-bold border border-green-200" title={`Conectado como ${googleEmail}`}>
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                <span className="max-w-[100px] truncate">{googleEmail}</span>
                            </div>
                        )}

                        <div className="relative">
                            <button
                                onClick={handlePublish}
                                disabled={draftCount === 0}
                                onMouseEnter={() => setShowPublishInfo(true)}
                                onMouseLeave={() => setShowPublishInfo(false)}
                                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-lg transition-all flex items-center gap-1.5 sm:gap-2 
                                ${draftCount === 0
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none dark:bg-slate-700 dark:text-slate-500' // Disabled State
                                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 dark:shadow-none' // Active State
                                    }
                            `}
                            >
                                <Zap size={16} fill={draftCount > 0 ? "currentColor" : "none"} />
                                <span className="hidden xs:inline">{draftCount > 0 ? t('planner.header.publish_changes') : t('planner.header.published')}</span>
                                <span className="xs:hidden">{draftCount > 0 ? 'Publicar' : '✔'}</span>
                            </button>
                        </div>

                        <button
                            onClick={() => setIsToolbarVisible(!isToolbarVisible)}
                            className={`p-2 rounded-lg transition-all border ${isToolbarVisible
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
                                }`}
                            title={isToolbarVisible ? "Ocultar Herramientas" : "Mostrar Herramientas"}
                        >
                            <Sliders size={20} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Week Selector Row */}
            <div className="sm:hidden flex justify-center px-4 py-2 bg-gray-50 dark:bg-slate-800/30 border-b border-gray-200 dark:border-slate-800/50">
                <WeekSelector currentDate={currentDate} onDateChange={setCurrentDate} weekStart={weekStart} />
            </div>
        </>
    )
}

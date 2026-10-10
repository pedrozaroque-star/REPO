/**
 * @module app/planificador/components/PlanificadorHeader
 * @description Top navigation and action header for the schedule planner in Tacos Gavilan.
 * Includes store selector, week selector, clone modal launcher, draft count indicator,
 * auto-save status indicator, Google/Gmail OAuth connection badge, and schedule publication trigger.
 * 
 * @businessRules
 * - Store selection filters the entire schedule planner to that store's employees and shifts.
 * - Week selection navigates Monday-to-Sunday schedule weeks.
 * - All draft changes are automatically saved to Supabase; the header communicates this with an auto-save badge.
 * - Bilingual labels and tooltips in Spanish and English via useLanguage.
 * 
 * @dataFlow
 * Planner state -> PlanificadorHeader -> User navigation / OAuth / Modal triggers
 */

import { Calendar, Loader2, Clock, Zap, ChevronRight, Sliders, Coffee, Copy, Mail, CheckCircle2 } from 'lucide-react'
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
    totalShiftsCount = 0,
    handlePublish,
    showPublishInfo,
    setShowPublishInfo,
    googleConnected,
    googleEmail,
    isToolbarVisible,
    setIsToolbarVisible,
    onCloneClick,
    onConnectGmail
}: any) {
    const { t, language } = useLanguage()

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

                    {syncing && (
                        <div className="hidden sm:flex items-center gap-2 text-xs text-indigo-500 font-bold animate-pulse">
                            <Loader2 size={13} className="animate-spin" />
                            <span>{t('planner.syncing')}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 sm:gap-4">
                    {/* Auto-Save Status Badge */}
                    <div
                        className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-semibold border border-emerald-200/60 dark:border-emerald-800/40 select-none shadow-2xs"
                        title={language === 'en' ? 'Changes are automatically saved as drafts' : 'Todos los cambios se guardan automáticamente como borrador'}
                    >
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        <span>{language === 'en' ? 'Auto-Saved' : 'Guardado'}</span>
                    </div>

                    <button
                        onClick={onCloneClick}
                        className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-lg text-xs font-bold shadow-sm transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                    >
                        <Copy size={16} />
                        <span>{t('planner.header.clone')}</span>
                    </button>

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
                        {googleConnected ? (
                            <div className="hidden xs:flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-bold border border-green-200" title={`Conectado como ${googleEmail}`}>
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                <span className="max-w-[100px] truncate">{googleEmail}</span>
                            </div>
                        ) : (
                            <button
                                onClick={onConnectGmail}
                                className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-red-500 to-yellow-500 hover:from-red-400 hover:to-yellow-400 text-white rounded-lg text-xs font-black shadow-md transition-all hover:scale-105 active:scale-95 animate-pulse hover:animate-none cursor-pointer"
                                title="Vincular tu cuenta de Gmail de Tacos Gavilan para poder publicar horarios y enviar avisos"
                            >
                                <Mail size={16} />
                                <span className="hidden sm:inline drop-shadow-sm">Vincular Gmail</span>
                                <span className="sm:hidden drop-shadow-sm">Gmail</span>
                            </button>
                        )}

                        <div className="relative">
                            <button
                                onClick={handlePublish}
                                disabled={draftCount === 0 && totalShiftsCount === 0}
                                onMouseEnter={() => setShowPublishInfo(true)}
                                onMouseLeave={() => setShowPublishInfo(false)}
                                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold shadow-lg transition-all flex items-center gap-1.5 sm:gap-2 cursor-pointer 
                                ${draftCount > 0
                                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 dark:shadow-none animate-pulse hover:animate-none' // Active Drafts State
                                        : totalShiftsCount > 0
                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 dark:shadow-none' // Re-publish State
                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none dark:bg-slate-700 dark:text-slate-500' // Disabled (Empty)
                                    }
                            `}
                                title={
                                    draftCount > 0
                                        ? `${draftCount} ${language === 'en' ? 'draft shifts pending publication' : 'turnos borrador pendientes de publicar'}`
                                        : totalShiftsCount > 0
                                        ? (language === 'en' ? 'Schedule is published. Click to re-notify crew.' : 'Horario publicado. Clic para re-notificar al equipo.')
                                        : (language === 'en' ? 'No shifts to publish' : 'No hay turnos para publicar')
                                }
                            >
                                <Zap size={16} fill={draftCount > 0 || totalShiftsCount > 0 ? "currentColor" : "none"} />
                                <span className="hidden xs:inline">
                                    {draftCount > 0 
                                        ? `${t('planner.header.publish_changes')} (${draftCount})` 
                                        : totalShiftsCount > 0
                                        ? (t('planner.header.republish') || 'Re-publicar')
                                        : t('planner.header.published')
                                    }
                                </span>
                                <span className="xs:hidden">
                                    {draftCount > 0 
                                        ? `Publicar (${draftCount})` 
                                        : totalShiftsCount > 0
                                        ? 'Re-publicar'
                                        : '✔'
                                    }
                                </span>
                            </button>
                        </div>

                        <button
                            onClick={() => setIsToolbarVisible(!isToolbarVisible)}
                            className={`p-2 rounded-lg transition-all border ${isToolbarVisible
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
                                }`}
                            title={isToolbarVisible ? "Ocultar Barra de Herramientas" : "Mostrar Barra de Herramientas"}
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

/**
 * @module app/planificador/components/FloatingToolbar
 * @description Docked horizontal tool ribbon for schedule planner operations in Tacos Gavilan.
 * Provides quick access to AI Smart Generation, Schedule Templates, Store Employee Sync,
 * Printable View, Alphabetical Sorting, and Draft Clearing.
 * 
 * @businessRules
 * - Docked cleanly below the header to guarantee 0% visual obstruction of Saturday/Sunday columns.
 * - Employee sync targets the selected store exclusively.
 * - Bilingual labels and tooltips in Spanish and English via useLanguage.
 * 
 * @dataFlow
 * Planner state & actions -> FloatingToolbar buttons -> Page modal / API dispatchers
 */

'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Loader2, LayoutTemplate, RefreshCcw, ArrowDownAZ, Trash2, Printer, Sparkles } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export function FloatingToolbar({
    handleGenerateSmart,
    isGenerating,
    showAIInfo,
    setShowAIInfo,
    setShowTemplateModal,
    handleSyncEmployees,
    isSyncingEmployees,
    showSyncInfo,
    setShowSyncInfo,
    handleResetOrder,
    showOrderInfo,
    setShowOrderInfo,
    handleClearDrafts,
    showClearInfo,
    setShowClearInfo,
    setShowTemplateInfo,
    showTemplateInfo,
    handlePrint,
    showPrintInfo,
    setShowPrintInfo
}: any) {
    const { t, language } = useLanguage()

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="w-full bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 px-4 sm:px-6 py-2 flex items-center justify-between gap-2 overflow-x-auto z-20 shadow-xs"
        >
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {/* AI Smart Schedule Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleGenerateSmart}
                        disabled={isGenerating}
                        onMouseEnter={() => setShowAIInfo(true)}
                        onMouseLeave={() => setShowAIInfo(false)}
                        whileTap={isGenerating ? {} : { scale: 0.96 }}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold text-xs shadow-sm transition-all
                            ${isGenerating
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white shadow-indigo-200 dark:shadow-none'
                            }
                        `}
                    >
                        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
                        <span className="hidden sm:inline">
                            {language === 'en' ? 'Smart Generator (AI)' : 'Generador Inteligente (IA)'}
                        </span>
                        <span className="sm:hidden">IA</span>
                    </motion.button>

                    <AnimatePresence>
                        {showAIInfo && (
                            <motion.div
                                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                className="absolute left-0 top-full mt-2 w-80 p-4 bg-slate-900 text-white rounded-2xl shadow-2xl border border-indigo-500/30 z-[100] overflow-hidden"
                            >
                                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                                    <Sparkles size={16} />
                                    <h4 className="text-xs font-black uppercase tracking-wider">{t('planner.tooltips.ai_generator.title')}</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-relaxed font-medium">
                                    {t('planner.tooltips.ai_generator.description')}
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Templates Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={() => setShowTemplateModal(true)}
                        onMouseEnter={() => setShowTemplateInfo(true)}
                        onMouseLeave={() => setShowTemplateInfo(false)}
                        whileTap={{ scale: 0.96 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500 hover:text-white border border-amber-500/30 font-bold text-xs transition-colors"
                    >
                        <LayoutTemplate size={16} />
                        <span className="hidden sm:inline">
                            {language === 'en' ? 'Templates' : 'Plantillas'}
                        </span>
                        <span className="sm:hidden">Plantillas</span>
                    </motion.button>

                    <AnimatePresence>
                        {showTemplateInfo && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                className="absolute left-0 top-full mt-2 w-64 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-amber-500/30 z-[100]"
                            >
                                <div className="flex items-center gap-2 mb-2 text-amber-400">
                                    <LayoutTemplate size={14} />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest">{t('planner.tooltips.template.title')}</h4>
                                </div>
                                <p className="text-[12px] text-slate-300">{t('planner.tooltips.template.description')}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="h-5 w-px bg-gray-200 dark:bg-slate-700 mx-1 hidden sm:block" />

                {/* Sync Store Employees Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleSyncEmployees}
                        disabled={isSyncingEmployees}
                        onMouseEnter={() => setShowSyncInfo(true)}
                        onMouseLeave={() => setShowSyncInfo(false)}
                        whileTap={{ scale: 0.96 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 hover:text-indigo-600 font-bold text-xs transition-colors border border-gray-200 dark:border-slate-700 shadow-2xs"
                    >
                        <RefreshCcw size={15} className={isSyncingEmployees ? "animate-spin text-indigo-500" : ""} />
                        <span className="hidden sm:inline">
                            {language === 'en' ? 'Sync Store Employees' : 'Sincronizar Tienda'}
                        </span>
                        <span className="sm:hidden">Sync</span>
                    </motion.button>

                    <AnimatePresence>
                        {showSyncInfo && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                className="absolute left-0 top-full mt-2 w-72 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-indigo-500/30 z-[100]"
                            >
                                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                                    <RefreshCcw size={14} />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest">{t('planner.tooltips.sync.title')}</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-relaxed">{t('planner.tooltips.sync.description')}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Print Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handlePrint}
                        onMouseEnter={() => setShowPrintInfo(true)}
                        onMouseLeave={() => setShowPrintInfo(false)}
                        whileTap={{ scale: 0.96 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 hover:text-indigo-600 font-bold text-xs transition-colors border border-gray-200 dark:border-slate-700 shadow-2xs"
                    >
                        <Printer size={15} />
                        <span className="hidden sm:inline">
                            {language === 'en' ? 'Print Schedule' : 'Imprimir'}
                        </span>
                    </motion.button>

                    <AnimatePresence>
                        {showPrintInfo && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                className="absolute left-0 top-full mt-2 w-64 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-indigo-500/30 z-[100]"
                            >
                                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                                    <Printer size={14} />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest">{t('planner.tooltips.print.title')}</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-relaxed">{t('planner.tooltips.print.description')}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Sort A-Z Button */}
                <div className="relative group/tool">
                    <motion.button
                        onClick={handleResetOrder}
                        onMouseEnter={() => setShowOrderInfo(true)}
                        onMouseLeave={() => setShowOrderInfo(false)}
                        whileTap={{ scale: 0.96 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 hover:text-indigo-600 font-bold text-xs transition-colors border border-gray-200 dark:border-slate-700 shadow-2xs"
                    >
                        <ArrowDownAZ size={16} />
                        <span className="hidden sm:inline">
                            {language === 'en' ? 'Sort A-Z' : 'Ordenar A-Z'}
                        </span>
                    </motion.button>

                    <AnimatePresence>
                        {showOrderInfo && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                className="absolute left-0 top-full mt-2 w-64 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-indigo-500/30 z-[100]"
                            >
                                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                                    <ArrowDownAZ size={14} />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest">{t('planner.tooltips.sort.title')}</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-relaxed">{t('planner.tooltips.sort.description')}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Clear Drafts Button (Danger Action - Kept to the right) */}
            <div className="relative group/tool shrink-0">
                <motion.button
                    onClick={handleClearDrafts}
                    onMouseEnter={() => setShowClearInfo(true)}
                    onMouseLeave={() => setShowClearInfo(false)}
                    whileTap={{ scale: 0.96 }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white font-bold text-xs transition-colors border border-red-200 dark:border-red-900/50"
                >
                    <Trash2 size={15} />
                    <span className="hidden sm:inline">
                        {language === 'en' ? 'Clear Week' : 'Limpiar Semana'}
                    </span>
                </motion.button>

                <AnimatePresence>
                    {showClearInfo && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            className="absolute right-0 top-full mt-2 w-64 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-red-500/30 z-[100]"
                        >
                            <div className="flex items-center gap-2 mb-2 text-red-400">
                                <Trash2 size={14} />
                                <h4 className="text-[10px] font-black uppercase tracking-widest">{t('planner.tooltips.clear.title')}</h4>
                            </div>
                            <p className="text-[12px] text-slate-300 leading-relaxed">{t('planner.tooltips.clear.description')}</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    )
}

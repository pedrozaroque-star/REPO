'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, X, Calendar, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatDateISO, formatDateNice, getMonday, addDays } from '../lib/utils'

export function CloneModal({
    isOpen,
    onClose,
    onConfirm,
    weekStart,
    isProcessing
}: {
    isOpen: boolean
    onClose: () => void
    onConfirm: (sourceWeekStart: Date, overwrite: boolean) => Promise<void>
    weekStart: Date
    isProcessing: boolean
}) {
    const { t } = useLanguage()
    const [selectedOption, setSelectedOption] = useState<string>('7') // '7', '14', '21', '28', 'custom'
    const [customDate, setCustomDate] = useState<string>('')
    const [overwriteMode, setOverwriteMode] = useState<boolean>(true) // default to overwrite

    useEffect(() => {
        if (isOpen) {
            setSelectedOption('7')
            setCustomDate('')
            setOverwriteMode(true)
        }
    }, [isOpen])

    if (!isOpen) return null

    // Helper to calculate target source date
    const getSourceWeekStart = (): Date => {
        if (selectedOption === 'custom') {
            if (!customDate) return addDays(weekStart, -7)
            const dateObj = new Date(customDate + 'T12:00:00')
            return getMonday(dateObj)
        }
        const offsetDays = parseInt(selectedOption, 10)
        return addDays(weekStart, -offsetDays)
    }

    const sourceWeekStart = getSourceWeekStart()

    const handleConfirm = async () => {
        await onConfirm(sourceWeekStart, overwriteMode)
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-slate-800"
            >
                {/* Header */}
                <div className="p-6 pb-2 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                            <Copy size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">
                                {t('planner.modals.clone.title')}
                            </h3>
                            <p className="text-xs text-gray-400 font-bold">
                                {t('planner.modals.clone.subtitle')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Source Week Select */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            {t('planner.modals.clone.source_label')}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="relative">
                                <select
                                    value={selectedOption}
                                    onChange={(e) => setSelectedOption(e.target.value)}
                                    disabled={isProcessing}
                                    className="w-full bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                                >
                                    <option value="7">{t('planner.modals.clone.weeks_1')}</option>
                                    <option value="14">{t('planner.modals.clone.weeks_2')}</option>
                                    <option value="21">{t('planner.modals.clone.weeks_3')}</option>
                                    <option value="28">{t('planner.modals.clone.weeks_4')}</option>
                                    <option value="custom">{t('planner.modals.clone.weeks_custom')}</option>
                                </select>
                            </div>

                            {selectedOption === 'custom' && (
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="relative flex items-center"
                                >
                                    <input
                                        type="date"
                                        value={customDate}
                                        onChange={(e) => setCustomDate(e.target.value)}
                                        disabled={isProcessing}
                                        className="w-full bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-2xl px-4 py-2.5 text-sm font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </motion.div>
                            )}
                        </div>

                        {/* Calculated Source Range Info */}
                        <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/30 rounded-2xl flex items-start gap-3">
                            <Calendar className="text-indigo-500 mt-0.5 shrink-0" size={16} />
                            <div className="text-xs">
                                <p className="font-bold text-indigo-700 dark:text-indigo-300">
                                    {formatDateNice(sourceWeekStart)} - {formatDateNice(addDays(sourceWeekStart, 6))}
                                </p>
                                <p className="text-gray-400 mt-0.5">
                                    {selectedOption === 'custom' && !customDate 
                                        ? 'Selecciona una fecha para ubicar la semana.' 
                                        : 'Se copiarán los turnos asignados de este periodo.'
                                    }
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Conflict Mode */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            {t('planner.modals.clone.conflict_label')}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setOverwriteMode(true)}
                                disabled={isProcessing}
                                className={`px-4 py-4 rounded-2xl border text-left flex flex-col justify-between h-24 transition-all ${
                                    overwriteMode
                                        ? 'bg-red-50/50 dark:bg-red-950/10 border-red-500 text-red-700 dark:text-red-400 shadow-md shadow-red-100/10 dark:shadow-none'
                                        : 'bg-gray-50 dark:bg-slate-800/30 border-gray-200 dark:border-slate-800 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-850'
                                }`}
                            >
                                <AlertTriangle className={overwriteMode ? 'text-red-500' : 'text-gray-400'} size={20} />
                                <div>
                                    <p className="text-xs font-black uppercase tracking-tight">
                                        {t('planner.modals.clone.conflict_overwrite')}
                                    </p>
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={() => setOverwriteMode(false)}
                                disabled={isProcessing}
                                className={`px-4 py-4 rounded-2xl border text-left flex flex-col justify-between h-24 transition-all ${
                                    !overwriteMode
                                        ? 'bg-indigo-50/50 dark:bg-indigo-950/10 border-indigo-500 text-indigo-700 dark:text-indigo-400 shadow-md shadow-indigo-100/10 dark:shadow-none'
                                        : 'bg-gray-50 dark:bg-slate-800/30 border-gray-200 dark:border-slate-800 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-850'
                                }`}
                            >
                                <Copy className={!overwriteMode ? 'text-indigo-500' : 'text-gray-400'} size={20} />
                                <div>
                                    <p className="text-xs font-black uppercase tracking-tight">
                                        {t('planner.modals.clone.conflict_merge')}
                                    </p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-6 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="px-6 py-3.5 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded-2xl font-black uppercase text-xs hover:bg-gray-200 dark:hover:bg-slate-700 transition-all tracking-wider disabled:opacity-50"
                    >
                        {t('planner.modals.clone.cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isProcessing || (selectedOption === 'custom' && !customDate)}
                        className={`px-8 py-3.5 text-white rounded-2xl font-black uppercase text-xs transition-all shadow-lg tracking-wider flex items-center gap-2 ${
                            overwriteMode 
                                ? 'bg-red-600 hover:bg-red-700 shadow-red-200 dark:shadow-none' 
                                : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 dark:shadow-none'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>Procesando...</span>
                            </>
                        ) : (
                            <>
                                <Check size={14} />
                                <span>{t('planner.modals.clone.confirm')}</span>
                            </>
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    )
}

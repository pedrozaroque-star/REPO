/**
 * @module app/planificador/components/PremiumConfirmModal
 * @description Confirmation and status feedback modal for planner operations (publish, clear, sync, smart generation, templates).
 *
 * @businessRules
 * - Displays bilingual confirmation prompts and a single Accept button when `type === 'success'`.
 * - Supports mobile viewports with scrollable max-height and safe-area padding above `BottomTabBar`.
 *
 * @dataFlow
 * Planner actions -> PremiumConfirmModal -> onConfirm / onClose
 */

'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export function PremiumConfirmModal({ isOpen, onClose, onConfirm, title, message, type = 'primary', icon: Icon, count, generating }: any) {
    const { t } = useLanguage()
    const [isBusy, setIsBusy] = React.useState(false)

    // Reset busy state if modal closes or identifying props change
    React.useEffect(() => {
        setIsBusy(false)
    }, [isOpen, count, title])

    if (!isOpen) return null

    // Adapt content if "Publish" mode (count provided) but no explicit title/message
    const effectiveTitle = title || (count ? t('planner.confirm_modal.default_publish_title') : t('planner.confirm_modal.default_confirm_title'))
    const effectiveMessage = message || (count
        ? t('planner.confirm_modal.default_publish_msg').replace('{n}', String(count))
        : t('planner.confirm_modal.default_confirm_msg'))

    const colors: any = {
        primary: 'bg-indigo-600 shadow-indigo-200 dark:shadow-none',
        danger: 'bg-red-600 shadow-red-200 dark:shadow-none',
        warning: 'bg-amber-500 shadow-amber-200 dark:shadow-none',
        success: 'bg-green-600 shadow-green-200 dark:shadow-none'
    }
    const iconBg: any = {
        primary: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
        danger: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
        warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
        success: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
    }

    const showLoading = generating || isBusy

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto border border-gray-100 dark:border-slate-800"
            >
                <div className="p-6 sm:p-8 text-center">
                    <div className={`mx-auto w-14 h-14 sm:w-16 sm:h-16 rounded-3xl ${iconBg[type] || iconBg.primary} flex items-center justify-center mb-5 sm:mb-6`}>
                        {showLoading ? (
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current"></div>
                        ) : (
                            Icon ? <Icon size={32} /> : <AlertCircle size={32} />
                        )}
                    </div>

                    <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white mb-2 uppercase tracking-tighter">
                        {showLoading ? t('planner.confirm_modal.processing_title') : effectiveTitle}
                    </h3>

                    <p className="text-gray-700 dark:text-slate-300 text-sm leading-relaxed mb-7 sm:mb-8 px-2 sm:px-4 whitespace-pre-line font-medium">
                        {showLoading ? t('planner.confirm_modal.processing_desc') : effectiveMessage}
                    </p>

                    {!showLoading && (
                        type === 'success' ? (
                            <button
                                type="button"
                                onClick={() => { onConfirm ? onConfirm() : onClose(); }}
                                className={`w-full px-6 py-4 text-white rounded-2xl font-black uppercase text-xs ${colors.success} hover:opacity-90 transition-all shadow-lg tracking-widest`}
                            >
                                {t('planner.confirm_modal.ok')}
                            </button>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 sm:px-6 py-4 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded-2xl font-black uppercase text-xs hover:bg-gray-200 dark:hover:bg-slate-700 transition-all tracking-widest"
                                >
                                    {t('planner.confirm_modal.cancel')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setIsBusy(true); onConfirm(); }}
                                    disabled={isBusy}
                                    className={`px-4 sm:px-6 py-4 text-white rounded-2xl font-black uppercase text-xs ${colors[type] || colors.primary} hover:opacity-90 transition-all shadow-lg tracking-widest disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {t('planner.confirm_modal.confirm')} {count ? `(${count})` : ''}
                                </button>
                            </div>
                        )
                    )}
                </div>
                {!generating && (
                    <div className="p-3 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 text-center">
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">{t('planner.confirm_modal.action_required')}</p>
                    </div>
                )}
            </motion.div>
        </div>
    )
}

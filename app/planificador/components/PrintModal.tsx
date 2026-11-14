/**
 * @module app/planificador/components/PrintModal
 * @description Modal wrapper around the printable weekly schedule iframe, with direct PDF/new-tab open support for mobile iOS/Android.
 *
 * @businessRules
 * - Mobile Safari/Android browsers often fail to print nested iframes reliably; opening `/planificador/imprimir` in a dedicated tab lets the OS share/save PDF natively.
 * - Full bilingual support (ES/EN) via useLanguage().
 *
 * @dataFlow
 * Planner print URL -> PrintModal iframe / new tab window.open
 */

import { X, Printer, ExternalLink } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from '../lib/utils'
import { useLanguage } from '@/lib/i18n'

export function PrintModal({ isOpen, onClose, url }: any) {
    const { t } = useLanguage()
    if (!isOpen) return null

    const handlePrint = () => {
        const iframe = document.getElementById('print-frame') as HTMLIFrameElement
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.print()
        } else {
            toast.error(t('planner.toasts.conn_error'))
        }
    }

    const handleOpenFull = () => {
        if (url && typeof window !== 'undefined') {
            window.open(url, '_blank', 'noopener,noreferrer')
        }
    }

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full h-full max-w-5xl flex flex-col overflow-hidden relative"
            >
                {/* Header */}
                <div className="flex flex-wrap justify-between items-center gap-2 p-3 sm:p-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
                    <h2 className="text-base sm:text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-white">
                        <Printer size={20} />
                        {t('planner.print_view.preview_title')}
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleOpenFull}
                            className="bg-indigo-600 text-white px-3 sm:px-4 py-2 rounded-lg font-bold text-xs sm:text-sm hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
                        >
                            <ExternalLink size={16} />
                            <span className="hidden sm:inline">{t('planner.print_view.open_full_pdf')}</span>
                            <span className="sm:hidden">PDF</span>
                        </button>
                        <button
                            type="button"
                            onClick={handlePrint}
                            className="bg-black dark:bg-white dark:text-black text-white px-3 sm:px-4 py-2 rounded-lg font-bold text-xs sm:text-sm hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors flex items-center gap-1.5"
                        >
                            <Printer size={16} />
                            <span className="hidden sm:inline">{t('planner.print_view.print_now')}</span>
                            <span className="sm:hidden">{t('planner.print_view.print_btn')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('planner.modal_shift.close_modal')}
                            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors text-gray-500 dark:text-gray-400"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Iframe content */}
                <div className="flex-1 bg-gray-100 dark:bg-slate-950 overflow-hidden relative">
                    <iframe
                        id="print-frame"
                        src={url}
                        className="w-full h-full border-0 block"
                        title="Print Preview"
                    />
                </div>
            </motion.div>
        </div>
    )
}

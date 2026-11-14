/**
 * @module app/planificador/components/TemplateModal
 * @description Modal to save, apply, and delete weekly schedule templates in Tacos Gavilan.
 *
 * @businessRules
 * - Applying a saved template overwrites current weekly draft shifts for the active store.
 * - Full touch and bilingual support (ES/EN) via useLanguage().
 *
 * @dataFlow
 * schedule_templates table <-> TemplateModal <-> Planner state
 */

import React from 'react'
import { motion } from 'framer-motion'
import { LayoutTemplate, X, Loader2, Save, FileDown, Trash2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export function TemplateModal({ isOpen, onClose, templates, onSave, onApply, onDelete, isSaving, name, setName }: any) {
    const { t } = useLanguage()
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden border border-gray-100 dark:border-slate-800"
            >
                <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-amber-50/30 dark:bg-amber-900/10 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl text-amber-600 dark:text-amber-400 shrink-0">
                            <LayoutTemplate size={20} />
                        </div>
                        <h3 className="font-black text-lg sm:text-xl text-gray-800 dark:text-white tracking-tight uppercase truncate">{t('planner.template_modal.title')}</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('planner.modal_shift.close_modal')}
                        className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 transition-colors shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 flex-1 overflow-y-auto">
                    {/* SAVE SECTION */}
                    <div>
                        <label className="block text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-3">
                            {t('planner.template_modal.save_current')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('planner.template_modal.name_placeholder')}
                                className="flex-1 min-w-0 p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-base sm:text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                            />
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={isSaving || !name.trim()}
                                className="px-4 sm:px-6 py-3 shrink-0 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-200 dark:shadow-none transition-all flex items-center gap-2"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {t('planner.template_modal.save_btn')}
                            </button>
                        </div>
                    </div>

                    {/* LIST SECTION */}
                    <div>
                        <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                            {t('planner.template_modal.saved_list')}
                        </label>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 sm:pr-2">
                            {templates.length === 0 ? (
                                <div className="text-center py-10 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                                    <p className="text-sm text-gray-400 font-medium italic">{t('planner.template_modal.empty_list')}</p>
                                </div>
                            ) : (
                                templates.map((tpl: any) => (
                                    <div
                                        key={tpl.id}
                                        onClick={() => onApply(tpl.id)}
                                        className="group flex items-center justify-between gap-2 p-3.5 sm:p-4 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl hover:border-amber-500 hover:shadow-md cursor-pointer transition-all"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors shrink-0">
                                                <FileDown size={18} className="text-gray-400 group-hover:text-amber-600 transition-colors" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-gray-800 dark:text-gray-200 group-hover:text-amber-600 transition-colors truncate">{tpl.name}</p>
                                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter truncate">{tpl.description}</p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => onDelete(tpl.id, e)}
                                            aria-label={t('planner.modal_shift.delete')}
                                            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all opacity-100 lg:opacity-0 lg:group-hover:opacity-100 shrink-0"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 text-center shrink-0">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.15em] sm:tracking-[0.2em]">{t('planner.template_modal.overwrite_notice')}</p>
                </div>
            </motion.div>
        </div>
    )
}

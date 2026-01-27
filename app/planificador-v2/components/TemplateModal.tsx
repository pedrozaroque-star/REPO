import React from 'react'
import { motion } from 'framer-motion'
import { LayoutTemplate, X, Loader2, Save, FileDown, Trash2 } from 'lucide-react'

export function TemplateModal({ isOpen, onClose, templates, onSave, onApply, onDelete, isSaving, name, setName }: any) {
    if (!isOpen) return null
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-slate-800"
            >
                <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center bg-amber-50/30 dark:bg-amber-900/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl text-amber-600 dark:text-amber-400">
                            <LayoutTemplate size={20} />
                        </div>
                        <h3 className="font-black text-xl text-gray-800 dark:text-white tracking-tight uppercase">Templates</h3>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* SAVE SECTION */}
                    <div>
                        <label className="block text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-3">Guardar Semana Actual</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Nombre del Template (ej: Verano Ideal)"
                                className="flex-1 p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                            />
                            <button
                                onClick={onSave}
                                disabled={isSaving || !name.trim()}
                                className="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-200 dark:shadow-none transition-all flex items-center gap-2"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Guardar
                            </button>
                        </div>
                    </div>

                    {/* LIST SECTION */}
                    <div>
                        <label className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest mb-3">Templates Guardados</label>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                            {templates.length === 0 ? (
                                <div className="text-center py-10 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                                    <p className="text-sm text-gray-400 font-medium italic">No hay templates guardados aún</p>
                                </div>
                            ) : (
                                templates.map((t: any) => (
                                    <div
                                        key={t.id}
                                        onClick={() => onApply(t.id)}
                                        className="group flex items-center justify-between p-4 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl hover:border-amber-500 hover:shadow-md cursor-pointer transition-all"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors">
                                                <FileDown size={18} className="text-gray-400 group-hover:text-amber-600 transition-colors" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-800 dark:text-gray-200 group-hover:text-amber-600 transition-colors">{t.name}</p>
                                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">{t.description}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => onDelete(t.id, e)}
                                            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Al aplicar se sobreescribirá el borrador actual</p>
                </div>
            </motion.div>
        </div>
    )
}

import React from 'react'
import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'

export function PremiumConfirmModal({ isOpen, onClose, onConfirm, title, message, type = 'primary', icon: Icon }: any) {
    if (!isOpen) return null
    const colors = {
        primary: 'bg-indigo-600 shadow-indigo-200 dark:shadow-none',
        danger: 'bg-red-600 shadow-red-200 dark:shadow-none',
        warning: 'bg-amber-500 shadow-amber-200 dark:shadow-none'
    }
    const iconBg = {
        primary: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
        danger: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
        warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-slate-800"
            >
                <div className="p-8 text-center">
                    <div className={`mx-auto w-16 h-16 rounded-3xl ${iconBg[type as keyof typeof iconBg]} flex items-center justify-center mb-6`}>
                        {Icon ? <Icon size={32} /> : <AlertCircle size={32} />}
                    </div>
                    <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2 uppercase tracking-tighter">{title}</h3>
                    <p className="text-gray-500 dark:text-slate-400 text-sm leading-relaxed mb-8 px-4 whitespace-pre-line">{message}</p>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onClose} className="px-6 py-4 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded-2xl font-black uppercase text-xs hover:bg-gray-200 dark:hover:bg-slate-700 transition-all tracking-widest">Cancelar</button>
                        <button onClick={() => { onConfirm(); onClose(); }} className={`px-6 py-4 text-white rounded-2xl font-black uppercase text-xs ${colors[type as keyof typeof colors]} hover:opacity-90 transition-all shadow-lg tracking-widest`}>Confirmar</button>
                    </div>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Acción Requerida</p>
                </div>
            </motion.div>
        </div>
    )
}

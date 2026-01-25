import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Loader2, LayoutTemplate, RefreshCcw, ArrowDownAZ, Trash2 } from 'lucide-react'

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
    showTemplateInfo
}: any) {
    return (
        <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3 p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-white/20 dark:border-slate-800 animate-in slide-in-from-right duration-500">
            {/* AI Button - Primary */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleGenerateSmart}
                    disabled={isGenerating}
                    onMouseEnter={() => setShowAIInfo(true)}
                    onMouseLeave={() => setShowAIInfo(false)}
                    whileHover={isGenerating ? {} : { scale: 1.1 }}
                    whileTap={isGenerating ? {} : { scale: 0.9 }}
                    className={`p-3 rounded-2xl flex items-center justify-center transition-all shadow-lg
                            ${isGenerating ? 'bg-gray-100 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 dark:shadow-none'}
                        `}
                >
                    {isGenerating ? <Loader2 size={24} className="animate-spin" /> : <Bot size={24} />}
                </motion.button>
                <AnimatePresence>
                    {showAIInfo && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: 20 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9, x: 20 }}
                            className="absolute right-full mr-5 top-0 w-80 p-5 bg-slate-900 text-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-indigo-500/30 z-[100] overflow-hidden"
                        >
                            {/* Glassmorphism Background Decoration */}
                            <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl"></div>

                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                        <Bot size={20} className="text-indigo-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-black uppercase tracking-[0.2em] text-indigo-400">Generador de Horarios Inteligentes</h4>
                                        <div className="flex gap-1 mt-1">
                                            {[1, 2, 3].map(i => (
                                                <motion.div
                                                    key={i}
                                                    className="w-1 h-1 bg-indigo-400 rounded-full"
                                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <p className="text-[13px] text-slate-300 leading-relaxed font-medium">
                                    El sistema sincroniza datos en tiempo real de <span className="text-indigo-300 font-bold">Toast</span>, analiza patrones de turnos de los últimos 6 meses y aplica automáticamente <span className="text-indigo-300 font-bold">reglas de descanso obligatorio</span> para generar el horario más preciso basado en el historial real del equipo.
                                </p>

                                {/* Animated Neural Network-like Waveform */}
                                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estado: Listo</span>
                                    <div className="flex items-end gap-1 h-4">
                                        {[1, 2, 3, 4, 5, 6, 7].map(i => (
                                            <motion.div
                                                key={i}
                                                className="w-1 bg-indigo-500/60 rounded-full"
                                                animate={{ height: ['30%', '100%', '30%'] }}
                                                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Template Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={() => setShowTemplateModal(true)}
                    onMouseEnter={() => setShowTemplateInfo(true)}
                    onMouseLeave={() => setShowTemplateInfo(false)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="p-3 bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20"
                >
                    <LayoutTemplate size={24} />
                </motion.button>
                <AnimatePresence>
                    {showTemplateInfo && (
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="absolute right-full mr-5 top-0 w-64 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-amber-500/30 z-[100]"
                        >
                            <div className="flex items-center gap-2 mb-2 text-amber-400">
                                <LayoutTemplate size={14} />
                                <h4 className="text-[10px] font-black uppercase tracking-widest">Plantilla Ideal</h4>
                            </div>
                            <p className="text-[12px] text-slate-300">Carga o guarda estructuras base para ganar tiempo.</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-800 mx-2 my-1" />

            {/* Sync Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleSyncEmployees}
                    disabled={isSyncingEmployees}
                    onMouseEnter={() => setShowSyncInfo(true)}
                    onMouseLeave={() => setShowSyncInfo(false)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="p-3 text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 rounded-2xl flex items-center justify-center transition-all bg-gray-50 dark:bg-slate-800/50"
                >
                    <RefreshCcw size={22} className={isSyncingEmployees ? "animate-spin" : ""} />
                </motion.button>
                <AnimatePresence>
                    {showSyncInfo && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: 20 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9, x: 20 }}
                            className="absolute right-full mr-5 top-0 w-64 p-5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-amber-500/30 z-[100] overflow-hidden"
                        >
                            <div className="absolute -top-5 -right-5 w-20 h-20 bg-amber-500/10 rounded-full blur-2xl"></div>
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                        <RefreshCcw size={18} className="text-indigo-400" />
                                    </div>
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Sincronizar Empleados</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                    Actualiza la lista de empleados y puestos desde <span className="text-indigo-300 font-bold">Toast</span> en tiempo real.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Sort Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleResetOrder}
                    onMouseEnter={() => setShowOrderInfo(true)}
                    onMouseLeave={() => setShowOrderInfo(false)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="p-3 text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 rounded-2xl flex items-center justify-center transition-all bg-gray-50 dark:bg-slate-800/50"
                >
                    <ArrowDownAZ size={24} />
                </motion.button>
                <AnimatePresence>
                    {showOrderInfo && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: 20 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9, x: 20 }}
                            className="absolute right-full mr-5 top-0 w-64 p-5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-indigo-500/30 z-[100] overflow-hidden"
                        >
                            <div className="absolute -top-5 -right-5 w-20 h-20 bg-indigo-500/10 rounded-full blur-2xl"></div>
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                        <ArrowDownAZ size={18} className="text-indigo-400" />
                                    </div>
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Ordenar Lista</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                    Restablece el orden <span className="text-indigo-300 font-bold">Jerárquico</span> por roles y antigüedad.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="h-px bg-gray-200 dark:bg-slate-800 mx-2 my-1" />

            {/* Clear Button */}
            <div className="relative group/tool">
                <motion.button
                    onClick={handleClearDrafts}
                    onMouseEnter={() => setShowClearInfo(true)}
                    onMouseLeave={() => setShowClearInfo(false)}
                    whileHover={{ scale: 1.1, backgroundColor: '#fef2f2', color: '#ef4444' }}
                    whileTap={{ scale: 0.9 }}
                    className="p-3 text-gray-400 hover:text-red-500 rounded-2xl flex items-center justify-center transition-all bg-gray-50 dark:bg-slate-800/50"
                >
                    <Trash2 size={24} />
                </motion.button>
                <AnimatePresence>
                    {showClearInfo && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, x: 20 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.9, x: 20 }}
                            className="absolute right-full mr-5 bottom-0 w-64 p-5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-red-500/30 z-[100] overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 w-20 h-20 bg-red-500/10 rounded-full blur-2xl"></div>
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 bg-red-500/20 rounded-xl border border-red-500/30">
                                        <Trash2 size={18} className="text-red-400" />
                                    </div>
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Limpiar Todo</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                    Elimina permanentemente todos los turnos en <span className="text-red-300 font-bold">Borrador</span> de esta semana.
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}

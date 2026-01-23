import { Calendar, Loader2, Clock, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { WeekSelector } from './WeekSelector'
import { formatStoreName } from '../lib/utils'

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
    setShowPublishInfo
}: any) {
    return (
        <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-30">
            <div className="flex items-center gap-6">
                <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                    <Calendar className="text-indigo-600" />
                    Planificador
                </h1>

                <div className="relative">
                    <select
                        value={selectedStoreId}
                        onChange={(e) => setSelectedStoreId(e.target.value)}
                        className="bg-gray-100 dark:bg-slate-800 border-0 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 cursor-pointer min-w-[200px]"
                    >
                        {stores.map((s: any) => (
                            <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>
                        ))}
                    </select>
                </div>

                <WeekSelector currentDate={currentDate} onDateChange={setCurrentDate} weekStart={weekStart} />

                {syncing && <div className="flex items-center gap-3 text-xs text-indigo-500 font-bold animate-pulse"><Loader2 size={12} className="animate-spin" /> Syncing...</div>}
            </div>

            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold uppercase">
                    <Clock size={14} />
                    <span>Borrador: {draftCount}</span>
                </div>
                <div className="relative">
                    <button
                        onClick={handlePublish}
                        onMouseEnter={() => setShowPublishInfo(true)}
                        onMouseLeave={() => setShowPublishInfo(false)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-all flex items-center gap-2"
                    >
                        <Zap size={16} fill="currentColor" /> Publicar
                    </button>
                    <AnimatePresence>
                        {showPublishInfo && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                className="absolute top-full mt-2 right-0 w-72 p-4 bg-slate-900 text-white rounded-xl shadow-2xl border border-indigo-500/30 z-[100]"
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Zap size={14} className="text-indigo-400" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Publicación Oficial</h4>
                                </div>
                                <p className="text-[12px] text-slate-300 leading-snug font-medium">
                                    Publica el horario y activa el envío automático de notificaciones por <span className="text-indigo-300 font-bold">Email y SMS</span>.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </header>
    )
}

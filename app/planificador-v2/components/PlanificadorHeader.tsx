
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
    setShowPublishInfo,
    googleConnected,
    googleEmail
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
                <div className="flex items-center gap-2">
                    {!googleConnected ? (
                        <a
                            href="/api/auth/google/start?returnUrl=/planificador"
                            className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 transition-colors flex items-center gap-2"
                            title="Conecta tu Gmail corporativo para enviar horarios"
                        >
                            <svg viewBox="0 0 24 24" className="w-4 h-4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                            <span className="hidden sm:inline">Conectar Gmail</span>
                        </a>
                    ) : (
                        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-bold border border-green-200" title={`Conectado como ${googleEmail}`}>
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <span className="max-w-[100px] truncate">{googleEmail}</span>
                        </div>
                    )}

                    <div className="relative">
                        <button
                            onClick={handlePublish}
                            onMouseEnter={() => setShowPublishInfo(true)}
                            onMouseLeave={() => setShowPublishInfo(false)}
                            className={`px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all flex items-center gap-2 ${googleConnected
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 dark:shadow-none'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' // Keep visual hint but allow click for modal
                                }`}
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
            </div>
        </header>
    )
}

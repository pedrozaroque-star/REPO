
/**
 * @module components/SystemUpdateDetector
 * @description Notificación flotante de actualización del sistema para avisar al usuario de nuevas versiones desplegadas.
 * @businessRules
 *   1. Se desactiva automáticamente en modo TV (/tv, /t/).
 *   2. Se ubica flotante en la parte inferior central (bottom-center) para no obstruir el botón flotante del Asistente IA (Chatbot) ni la barra lateral.
 *   3. Provee botón de actualización inmediata ('Actualizar') y botón de cierre/descarte (✕).
 * @dataFlow Consulta /api/system/version periódicamente mediante useSystemUpdate.
 * @notes
 *   - Fix: Se corrigió la posición en desktop (antes md:right-6) que provocaba que el banner se encimara directamente sobre el botón del chatbot en la esquina inferior derecha.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useSystemUpdate } from '@/hooks/useSystemUpdate'
import { RefreshCcw, Zap, CheckCircle2, X } from 'lucide-react'
import { usePathname } from 'next/navigation'

export function SystemUpdateDetector() {
    const pathname = usePathname()
    // Apaga el detector silenciosamente si estamos en modo TV
    const isTvMode = pathname?.startsWith('/tv') || pathname?.startsWith('/t/')

    // Check every 2 minutes
    const { hasUpdate, updateMessage, triggerUpdate } = useSystemUpdate(isTvMode ? undefined : 1000 * 60 * 2)
    const [showSuccess, setShowSuccess] = useState(false)
    const [dismissed, setDismissed] = useState(false)

    if (isTvMode) return null;

    useEffect(() => {
        // Check if we just updated
        if (typeof window !== 'undefined' && sessionStorage.getItem('teg_update_completed')) {
            setShowSuccess(true)
            sessionStorage.removeItem('teg_update_completed')
            const timer = setTimeout(() => setShowSuccess(false), 5000)
            return () => clearTimeout(timer)
        }
    }, [])

    // Reset dismissed state if a new update arrives
    useEffect(() => {
        if (hasUpdate) {
            setDismissed(false)
        }
    }, [hasUpdate, updateMessage])

    const handleUpdate = () => {
        sessionStorage.setItem('teg_update_completed', 'true')
        triggerUpdate()
    }

    if (showSuccess) {
        return (
            <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[99999] pointer-events-auto">
                <div className="bg-emerald-600/95 dark:bg-emerald-500/95 backdrop-blur-xl text-white p-2 pl-4 pr-6 rounded-full shadow-2xl flex items-center gap-3 border border-white/10 ring-1 ring-black/5 animate-in slide-in-from-bottom-5 fade-in zoom-in duration-500">
                    <div className="bg-white/20 rounded-full p-1">
                        <CheckCircle2 size={18} className="text-white" strokeWidth={3} />
                    </div>
                    <span className="font-black text-sm tracking-wide">Actualización completada</span>
                </div>
            </div>
        )
    }

    if (!hasUpdate || dismissed) return null

    return (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[99999] pointer-events-auto">
            <div className="bg-slate-900/95 dark:bg-white/95 backdrop-blur-xl text-white dark:text-slate-900 p-2 pl-4 pr-3 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.35)] flex items-center gap-3.5 border border-white/10 dark:border-slate-900/10 ring-1 ring-black/5 animate-in slide-in-from-bottom-5 fade-in duration-500 max-w-[92vw] sm:max-w-md">

                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative shrink-0">
                        <Zap size={18} className="text-yellow-400 fill-yellow-400" />
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                        </span>
                    </div>
                    <div className="flex flex-col leading-tight overflow-hidden">
                        <span className="font-bold text-sm">Actualización lista</span>
                        <span className="text-[10px] text-gray-300 dark:text-gray-600 font-medium whitespace-normal break-words leading-snug opacity-90 truncate max-w-[220px] sm:max-w-xs">
                            {updateMessage || 'Nueva versión disponible'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        onClick={handleUpdate}
                        className="bg-indigo-600 hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 text-white px-4 py-2 shrink-0 rounded-full text-xs font-bold transition-all flex items-center gap-2 shadow-lg hover:scale-105 active:scale-95"
                    >
                        <RefreshCcw size={13} className={hasUpdate ? "animate-spin-slow" : ""} />
                        Actualizar
                    </button>
                    <button
                        onClick={() => setDismissed(true)}
                        className="text-gray-400 hover:text-white dark:text-gray-500 dark:hover:text-slate-900 p-1.5 rounded-full hover:bg-white/10 dark:hover:bg-slate-900/10 transition-colors"
                        title="Descartar por ahora"
                        aria-label="Cerrar aviso"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>
        </div>
    )
}

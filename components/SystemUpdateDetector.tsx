
/**
 * @module components/SystemUpdateDetector
 * @description Notificación flotante de actualización del sistema para avisar al usuario de nuevas versiones desplegadas.
 * @businessRules
 *   1. Se desactiva automáticamente en modo TV (/tv, /t/) pasando `0` a `useSystemUpdate` para evitar peticiones a `/api/system/version`.
 *   2. En clientes web consulta cada 5 minutos (`300_000ms`) además de verificar al regresar a la pestaña (`visibilitychange`), respaldado por Vercel Edge CDN (`s-maxage=60`).
 *   3. Se ubica flotante en la parte inferior central (bottom-center) para no obstruir el botón flotante del Asistente IA (Chatbot) ni la barra lateral.
 *   4. Provee botón de actualización inmediata ('Actualizar') y botón de cierre/descarte (✕).
 * @dataFlow Consulta /api/system/version periódicamente mediante useSystemUpdate.
 * @notes
 *   - Fix: Se corrigió la posición en desktop (antes md:right-6) que provocaba que el banner se encimara directamente sobre el botón del chatbot en la esquina inferior derecha.
 *   - Fix 2026-11-19: Corregido bug de Rules of Hooks (antes `if (isTvMode) return null` ejecutaba antes de los `useEffect`), se pasa `0` en modo TV (antes `undefined` caía al default de 60s) y se ajustó el intervalo web a 5 minutos.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useSystemUpdate } from '@/hooks/useSystemUpdate'
import { RefreshCcw, Zap, CheckCircle2, X } from 'lucide-react'
import { usePathname } from 'next/navigation'

export function SystemUpdateDetector() {
    const pathname = usePathname()
    // Apaga el detector silenciosamente si estamos en modo TV
    const isTvMode = Boolean(pathname?.startsWith('/tv') || pathname?.startsWith('/t/'))

    // Check every 5 minutes on web clients; pass 0 in TV mode to disable polling completely
    const { hasUpdate, updateMessage, triggerUpdate } = useSystemUpdate(isTvMode ? 0 : 1000 * 60 * 5)
    const [showSuccess, setShowSuccess] = useState(false)
    const [dismissedUpdateKey, setDismissedUpdateKey] = useState<string | null>(null)

    useEffect(() => {
        if (isTvMode) return
        // Check if we just updated
        if (typeof window !== 'undefined' && sessionStorage.getItem('teg_update_completed')) {
            const showTimer = setTimeout(() => {
                sessionStorage.removeItem('teg_update_completed')
                setShowSuccess(true)
            }, 0)
            const hideTimer = setTimeout(() => setShowSuccess(false), 5000)
            return () => {
                clearTimeout(showTimer)
                clearTimeout(hideTimer)
            }
        }
    }, [isTvMode])

    if (isTvMode) return null

    const currentUpdateKey = updateMessage || '__update__'
    const dismissed = dismissedUpdateKey !== null && dismissedUpdateKey === currentUpdateKey

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
                        onClick={() => setDismissedUpdateKey(currentUpdateKey)}
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

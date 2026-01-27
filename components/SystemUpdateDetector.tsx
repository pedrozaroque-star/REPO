
'use client'

import React from 'react'
import { useSystemUpdate } from '@/hooks/useSystemUpdate'
import { RefreshCcw, Zap } from 'lucide-react'

export function SystemUpdateDetector() {
    // Check every 2 minutes
    const { hasUpdate, triggerUpdate } = useSystemUpdate(1000 * 60 * 2)

    if (!hasUpdate) return null

    return (
        <div className="fixed bottom-6 right-6 z-[9999] animate-bounce-subtle">
            <div className="bg-slate-900/95 dark:bg-white/95 backdrop-blur-xl text-white dark:text-slate-900 p-1 pl-4 pr-1.5 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-4 border border-white/10 dark:border-slate-900/10 ring-1 ring-black/5 transition-all duration-300 hover:scale-105">

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Zap size={18} className="text-yellow-400 fill-yellow-400 animate-pulse" />
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                        </span>
                    </div>
                    <div className="flex flex-col leading-tight">
                        <span className="font-bold text-sm">Nueva versión disponible</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">Mejoras de rendimiento listas</span>
                    </div>
                </div>

                <button
                    onClick={triggerUpdate}
                    className="ml-2 bg-indigo-600 hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 text-white px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 shadow-lg"
                >
                    <RefreshCcw size={14} />
                    Refrescar
                </button>
            </div>
        </div>
    )
}

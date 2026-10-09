/**
 * @module app/nueva-web/page
 * @description Visor interactivo y entorno de pruebas en tiempo real para el nuevo sitio web de Tacos Gavilan.
 * Permite a gerentes, supervisores y desarrolladores auditar, interactuar y probar el diseño web
 * en desarrollo en file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html en diferentes dispositivos
 * (Escritorio, Tablet y Móvil) directamente desde la barra lateral del Sistema de Monitoreo TEG.
 * 
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan (presentación 1:1 con colores corporativos #50050a y #FDC82F).
 * - **Acceso Operativo**: Ubicado en la barra lateral en la sección de Operaciones, junto a Customer App.
 * - **Visualización Multi-Dispositivo**: Modos responsivos para Escritorio (100%), Tablet (768px) y Móvil (390px).
 * - **Lanzador Directo de Archivo Local**: Conexión al puente nativo para abrir file:/// en el navegador del sistema.
 * - **Copia de Ruta en 1 Toque**: Permite copiar al portapapeles la URL local file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html.
 * - **Recarga en Caliente**: Botón para refrescar el iframe instantáneamente tras editar archivos HTML/CSS/JS.
 * - **Soporte de Teclado**: Tecla [Escape] para retornar de inmediato al Dashboard.
 * 
 * @dataFlow
 * - Iframe renderiza /api/web-preview/index.html servido por el endpoint dinámico en tiempo real.
 * - Consulta de estado y verificación de timestamps con /api/web-preview?action=status.
 * - Acción de apertura de archivo local en Windows vía POST /api/web-preview/launch.
 * 
 * @notes
 * - Soporta i18n bilingüe total (Español e Inglés) a través del hook useLanguage().
 * - Implementa controles de pantalla completa nativa vía document.documentElement.requestFullscreen().
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
    ArrowLeft, Monitor, Tablet, Smartphone, RefreshCw, ExternalLink,
    Copy, Check, Maximize2, Minimize2, Globe, Sparkles, FolderOpen,
    Code2, Info, ChevronDown
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

type ViewportMode = 'desktop' | 'tablet' | 'mobile'

const FILE_URL = 'file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html'

export default function NewWebsiteViewerPage() {
    const router = useRouter()
    const { t, language } = useLanguage()

    const [viewport, setViewport] = useState<ViewportMode>('desktop')
    const [iframeKey, setIframeKey] = useState<number>(Date.now())
    const [isLoading, setIsLoading] = useState<boolean>(true)
    const [copied, setCopied] = useState<boolean>(false)
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
    const [launching, setLaunching] = useState<boolean>(false)
    const [localStatus, setLocalStatus] = useState<{ exists: boolean; lastModified: string | null } | null>(null)
    const [toastMessage, setToastMessage] = useState<string | null>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    // Consultar estado del archivo local al montar
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const res = await fetch('/api/web-preview?action=status')
                if (res.ok) {
                    const data = await res.json()
                    setLocalStatus({ exists: data.exists, lastModified: data.lastModified })
                }
            } catch {
                // Silencioso
            }
        }
        checkStatus()
    }, [])

    // Soporte para tecla Escape para salir rápidamente
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !document.fullscreenElement) {
                handleExit()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    const handleExit = () => {
        if (typeof window !== 'undefined' && window.history.length > 2) {
            router.back()
        } else {
            router.push('/dashboard')
        }
    }

    const showToast = (msg: string) => {
        setToastMessage(msg)
        setTimeout(() => setToastMessage(null), 3000)
    }

    const copyFilePath = async () => {
        try {
            await navigator.clipboard.writeText(FILE_URL)
            setCopied(true)
            showToast(t('new_website.copied_toast') || 'Ruta copiada al portapapeles')
            setTimeout(() => setCopied(false), 2000)
        } catch {
            showToast('Error al copiar al portapapeles')
        }
    }

    const handleReload = () => {
        setIsLoading(true)
        setIframeKey(Date.now())
    }

    const handleOpenInNewTab = () => {
        window.open('/api/web-preview/index.html', '_blank')
    }

    const handleLaunchLocalFile = async () => {
        setLaunching(true)
        try {
            const res = await fetch('/api/web-preview/launch', { method: 'POST' })
            const data = await res.json()
            if (data.ok) {
                showToast(t('new_website.launch_success') || 'Abriendo archivo local en el navegador predeterminado...')
            } else {
                showToast(t('new_website.launch_error') || 'No se pudo abrir automáticamente. Usa el botón de copiar.')
            }
        } catch {
            showToast(t('new_website.launch_error') || 'Error de conexión con el lanzador.')
        } finally {
            setLaunching(false)
        }
    }

    const toggleFullscreen = () => {
        if (typeof document === 'undefined') return
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
            setIsFullscreen(true)
        } else {
            document.exitFullscreen().catch(() => {})
            setIsFullscreen(false)
        }
    }

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden select-none">
            {/* ── TOP CONTROL BAR ── */}
            <header className="flex-shrink-0 h-14 bg-[#50050a] border-b border-[#FDC82F]/30 px-3 sm:px-4 flex items-center justify-between z-30 shadow-md">
                {/* Lado Izquierdo: Volver + Título + Badges */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <button
                        onClick={handleExit}
                        className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white border border-white/10 hover:border-[#FDC82F]/50 transition-all text-xs font-semibold"
                        title={t('new_website.back_to_teg') || 'Regresar a TEG System'}
                    >
                        <ArrowLeft size={14} className="text-[#FDC82F] group-hover:-translate-x-0.5 transition-transform" />
                        <span className="hidden md:inline">{t('new_website.back_to_teg') || 'Regresar'}</span>
                    </button>

                    <div className="h-5 w-px bg-white/10 hidden sm:block" />

                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FDC82F] to-[#d49900] flex items-center justify-center text-[#50050a] font-black shadow-xs shrink-0">
                            <Globe size={16} />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-xs sm:text-sm font-black tracking-tight text-white truncate">
                                    Tacos Gavilan <span className="text-[#FDC82F] font-medium">— {t('new_website.title') || 'Nueva Web'}</span>
                                </span>
                                <span className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                    {t('new_website.badge_dev') || 'DISEÑO ACTUAL'}
                                </span>
                            </div>
                            <span className="text-[10px] text-white/60 truncate hidden sm:inline">
                                file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html
                            </span>
                        </div>
                    </div>
                </div>

                {/* Centro: Selector de Dispositivos (Desktop, Tablet, Mobile) */}
                <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10 shadow-inner">
                    <button
                        onClick={() => setViewport('desktop')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            viewport === 'desktop'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                        title={language === 'es' ? 'Vista Escritorio (100%)' : 'Desktop View (100%)'}
                    >
                        <Monitor size={14} />
                        <span className="hidden md:inline">{t('new_website.view_desktop') || 'Escritorio'}</span>
                    </button>
                    <button
                        onClick={() => setViewport('tablet')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            viewport === 'tablet'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                        title={language === 'es' ? 'Vista Tablet (768px)' : 'Tablet View (768px)'}
                    >
                        <Tablet size={14} />
                        <span className="hidden md:inline">{t('new_website.view_tablet') || 'Tablet'}</span>
                    </button>
                    <button
                        onClick={() => setViewport('mobile')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            viewport === 'mobile'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                        title={language === 'es' ? 'Vista Móvil (390px iPhone)' : 'Mobile View (390px iPhone)'}
                    >
                        <Smartphone size={14} />
                        <span className="hidden md:inline">{t('new_website.view_mobile') || 'Móvil'}</span>
                    </button>
                </div>

                {/* Lado Derecho: Acciones (Recargar, Abrir pestaña, Copiar file:///, Lanzar en SO, Fullscreen) */}
                <div className="flex items-center gap-1 sm:gap-1.5">
                    {/* Botón de Recarga en Caliente */}
                    <button
                        onClick={handleReload}
                        className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white/90 hover:text-white border border-white/10 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                        title={t('new_website.reload') || 'Recargar diseño'}
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin text-[#FDC82F]' : ''} />
                        <span className="hidden xl:inline">{t('new_website.reload') || 'Recargar'}</span>
                    </button>

                    {/* Copiar enlace local file:/// */}
                    <button
                        onClick={copyFilePath}
                        className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white/90 hover:text-white border border-white/10 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                        title={t('new_website.copy_path') || 'Copiar ruta local'}
                    >
                        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        <span className="hidden xl:inline">
                            {copied ? '¡Copiado!' : (t('new_website.copy_path') || 'Copiar Ruta')}
                        </span>
                    </button>

                    {/* Lanzador Nativo Windows (Abre Chrome/Edge en el SO con file:///) */}
                    <button
                        onClick={handleLaunchLocalFile}
                        disabled={launching}
                        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white border border-emerald-400/40 shadow-xs transition-all text-xs font-bold disabled:opacity-50"
                        title={t('new_website.launch_browser') || 'Abrir archivo local (file:///) en navegador'}
                    >
                        <FolderOpen size={14} />
                        <span className="hidden 2xl:inline">{t('new_website.launch_browser') || 'Abrir en Navegador (file:///)'}</span>
                        <span className="inline 2xl:hidden">file:///</span>
                    </button>

                    {/* Abrir en nueva pestaña vía /api/web-preview */}
                    <button
                        onClick={handleOpenInNewTab}
                        className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-[#FDC82F] hover:bg-[#e6b528] text-[#50050a] transition-all flex items-center gap-1.5 text-xs font-black shadow-sm"
                        title={t('new_website.open_tab') || 'Abrir en nueva pestaña'}
                    >
                        <ExternalLink size={14} />
                        <span className="hidden sm:inline">{t('new_website.open_tab') || 'Pestaña Nueva'}</span>
                    </button>

                    {/* Fullscreen */}
                    <button
                        onClick={toggleFullscreen}
                        className="hidden lg:flex p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white/80 hover:text-white border border-white/10 transition-colors"
                        title={isFullscreen ? (t('new_website.exit_fullscreen') || 'Salir') : (t('new_website.fullscreen') || 'Pantalla completa')}
                    >
                        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                </div>
            </header>

            {/* ── SUB-BAR: Status & Quick Info ── */}
            <div className="bg-slate-950/80 border-b border-slate-800 px-4 py-1 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-slate-300 font-semibold truncate">
                        {t('new_website.local_file_detected') || 'Archivo local en desarrollo'}:
                    </span>
                    <code className="text-emerald-400 font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 truncate">
                        {FILE_URL}
                    </code>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {localStatus?.lastModified && (
                        <span className="text-[10px] text-slate-400 hidden sm:inline">
                            {language === 'es' ? 'Modificado' : 'Modified'}: {new Date(localStatus.lastModified).toLocaleTimeString()}
                        </span>
                    )}
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                        {viewport === 'desktop' ? '100% Full' : viewport === 'tablet' ? '768 × 1024' : '390 × 844'}
                    </span>
                </div>
            </div>

            {/* ── MAIN VIEWER CONTAINER ── */}
            <main className="flex-1 bg-slate-950 flex items-center justify-center p-0 md:p-3 overflow-hidden relative">
                {/* Notificación Toast flotante */}
                <AnimatePresence>
                    {toastMessage && (
                        <motion.div
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            className="absolute top-4 z-50 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs shadow-2xl flex items-center gap-2 border border-emerald-400"
                        >
                            <Sparkles size={14} />
                            <span>{toastMessage}</span>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Spinner de Carga */}
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-xs">
                        <div className="w-12 h-12 rounded-full border-3 border-[#FDC82F]/20 border-t-[#FDC82F] animate-spin mb-3" />
                        <p className="text-xs text-slate-300 font-semibold tracking-wide">
                            {t('new_website.loading_preview') || 'Cargando diseño web de Tacos Gavilan...'}
                        </p>
                    </div>
                )}

                {/* Marco Responsivo Según Dispositivo */}
                <div
                    className={`h-full transition-all duration-300 flex flex-col bg-white overflow-hidden shadow-2xl ${
                        viewport === 'desktop'
                            ? 'w-full rounded-none'
                            : viewport === 'tablet'
                            ? 'w-[768px] max-w-full rounded-2xl border-4 border-slate-700 ring-4 ring-black/40'
                            : 'w-[390px] max-w-full rounded-[2.5rem] border-8 border-slate-800 ring-4 ring-black/50'
                    }`}
                >
                    {/* Barra decorativa de dispositivo en modo móvil/tablet */}
                    {viewport !== 'desktop' && (
                        <div className="h-6 bg-slate-900 flex items-center justify-center px-4 shrink-0">
                            {viewport === 'mobile' && (
                                <div className="w-24 h-3.5 bg-black rounded-full" />
                            )}
                            {viewport === 'tablet' && (
                                <div className="w-3 h-3 rounded-full bg-slate-700" />
                            )}
                        </div>
                    )}

                    {/* El Iframe que renderiza la web servida en vivo */}
                    <iframe
                        ref={iframeRef}
                        key={iframeKey}
                        src="/api/web-preview/index.html"
                        className="w-full flex-1 border-0 bg-white"
                        title="Tacos Gavilan New Website Live Preview"
                        onLoad={() => setIsLoading(false)}
                        allow="geolocation; camera; microphone; clipboard-write"
                    />
                </div>
            </main>
        </div>
    )
}

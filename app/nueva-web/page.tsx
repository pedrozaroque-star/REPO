/**
 * @module app/nueva-web/page
 * @description Visor interactivo y entorno de pruebas en tiempo real para el nuevo sitio web de Tacos Gavilan.
 * Permite a gerentes, supervisores y desarrolladores auditar, interactuar y probar el diseño web
 * en desarrollo en file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html en diferentes dispositivos
 * (Escritorio, Tablet y Móvil) directamente desde la barra lateral del Sistema de Monitoreo TEG,
 * con soporte para sincronización hacia la nube para que pueda verse tanto en PC como en teléfonos móviles.
 * 
 * @businessRules
 * - **Marca Oficial**: Tacos Gavilan (presentación 1:1 con colores corporativos #50050a y #FDC82F).
 * - **Acceso Operativo**: Ubicado en la barra lateral en la sección de Operaciones, junto a Customer App.
 * - **Visualización Multi-Dispositivo**: Modos responsivos para Escritorio (100%), Tablet (768px) y Móvil (390px).
 *   En teléfonos móviles reales, se adapta automáticamente a pantalla completa nativa sin marcos artificiales.
 * - **Sincronización a Móvil / Nube**: Botón de un solo clic que copia los archivos locales hacia public/tacosgavilan-web
 *   para que puedan ser desplegados a Vercel y consultados desde cualquier smartphone.
 * - **Detección Automática de Fuente**: En localhost lee los archivos locales en vivo; en Vercel o teléfonos remotos
 *   consume automáticamente la versión estática sincronizada (/tacosgavilan-web/index.html).
 * - **Lanzador Directo de Archivo Local**: Conexión al puente nativo para abrir file:/// en el navegador del sistema.
 * - **Copia de Ruta en 1 Toque**: Permite copiar al portapapeles la URL local file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html.
 * - **Recarga en Caliente**: Botón para refrescar el iframe instantáneamente tras editar archivos HTML/CSS/JS.
 * - **Soporte de Teclado**: Tecla [Escape] para retornar de inmediato al Dashboard.
 * 
 * @dataFlow
 * - Iframe renderiza /api/web-preview/index.html (en desarrollo local) o /tacosgavilan-web/index.html (en Vercel/Móvil).
 * - Consulta de estado y verificación de timestamps con /api/web-preview?action=status.
 * - Acción de sincronización masiva hacia public/tacosgavilan-web vía POST /api/web-preview/sync.
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
    CloudUpload, CheckCircle2, ShieldCheck, Share2
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
    const [syncing, setSyncing] = useState<boolean>(false)
    const [isMobileScreen, setIsMobileScreen] = useState<boolean>(false)
    const [localStatus, setLocalStatus] = useState<{
        localExists: boolean
        fallbackExists: boolean
        localLastModified: string | null
        fallbackLastModified: string | null
        activeSource: 'local' | 'cloud' | 'none'
    } | null>(null)
    const [toastMessage, setToastMessage] = useState<string | null>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    // Detectar si la pantalla es móvil real (<768px)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const checkScreen = () => {
                const isMobile = window.innerWidth < 768
                setIsMobileScreen(isMobile)
                if (isMobile) {
                    setViewport('desktop') // 100% de la pantalla del teléfono
                }
            }
            checkScreen()
            window.addEventListener('resize', checkScreen)
            return () => window.removeEventListener('resize', checkScreen)
        }
    }, [])

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/web-preview?action=status')
            if (res.ok) {
                const data = await res.json()
                setLocalStatus({
                    localExists: !!data.localExists,
                    fallbackExists: !!data.fallbackExists,
                    localLastModified: data.localLastModified || null,
                    fallbackLastModified: data.fallbackLastModified || null,
                    activeSource: data.activeSource || 'none'
                })
            }
        } catch {
            // Silencioso
        }
    }

    // Consultar estado al montar
    useEffect(() => {
        fetchStatus()
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
        setTimeout(() => setToastMessage(null), 3500)
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

    // Sincronizar archivos de desarrollo local hacia public/tacosgavilan-web para visualización en móvil/Vercel
    const handleSyncToMobile = async () => {
        setSyncing(true)
        try {
            const res = await fetch('/api/web-preview/sync', { method: 'POST' })
            const data = await res.json()
            if (data.ok) {
                showToast(
                    language === 'es'
                        ? `¡Sincronizado! ${data.copiedFiles} archivos listos. Haz COMMIT y PUSH para verlos en tu teléfono.`
                        : `Synced! ${data.copiedFiles} files ready. Run COMMIT and PUSH to view on your phone.`
                )
                await fetchStatus()
                handleReload()
            } else {
                showToast(data.message || 'Error al sincronizar')
            }
        } catch {
            showToast('Error de conexión al sincronizar con el servidor')
        } finally {
            setSyncing(false)
        }
    }

    const handleOpenInNewTab = () => {
        // En Vercel o teléfono remoto usamos la ruta estática directa
        const targetUrl = (localStatus?.localExists)
            ? '/api/web-preview/index.html'
            : '/tacosgavilan-web/index.html'
        window.open(targetUrl, '_blank')
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

    // Determinar la URL óptima para el iframe
    // Si la máquina tiene la carpeta local de Pedro, usamos /api/web-preview/index.html para ver cambios en vivo
    // Si está en el teléfono o Vercel, usamos la versión estática /tacosgavilan-web/index.html
    const effectiveIframeSrc = localStatus?.localExists
        ? `/api/web-preview/index.html?t=${iframeKey}`
        : `/tacosgavilan-web/index.html?t=${iframeKey}`

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden select-none">
            {/* ── TOP CONTROL BAR ── */}
            <header className="flex-shrink-0 h-14 bg-[#50050a] border-b border-[#FDC82F]/30 px-2 sm:px-4 flex items-center justify-between z-30 shadow-md">
                {/* Lado Izquierdo: Volver + Título + Badges */}
                <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
                    <button
                        onClick={handleExit}
                        className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white border border-white/10 hover:border-[#FDC82F]/50 transition-all text-xs font-semibold shrink-0"
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
                            <div className="flex items-center gap-1.5 sm:gap-2">
                                <span className="text-xs sm:text-sm font-black tracking-tight text-white truncate">
                                    Tacos Gavilan <span className="text-[#FDC82F] font-medium hidden sm:inline">— {t('new_website.title') || 'Nueva Web'}</span>
                                </span>
                                {localStatus?.localExists ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                        <span className="hidden sm:inline">{t('new_website.viewing_local') || 'LOCAL EN VIVO'}</span>
                                        <span className="sm:hidden">LOCAL</span>
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/40 shrink-0">
                                        <CheckCircle2 size={10} className="text-sky-400" />
                                        <span className="hidden sm:inline">{t('new_website.viewing_cloud') || 'NUBE SINCRONIZADA'}</span>
                                        <span className="sm:hidden">NUBE</span>
                                    </span>
                                )}
                            </div>
                            <span className="text-[10px] text-white/60 truncate hidden md:inline">
                                {localStatus?.localExists
                                    ? FILE_URL
                                    : '/tacosgavilan-web/index.html (Móvil / Vercel CDN)'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Centro: Selector de Dispositivos (Solo en pantallas de escritorio o tablet) */}
                {!isMobileScreen && (
                    <div className="hidden lg:flex items-center bg-black/40 p-1 rounded-xl border border-white/10 shadow-inner">
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
                            <span>{t('new_website.view_desktop') || 'Escritorio'}</span>
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
                            <span>{t('new_website.view_tablet') || 'Tablet'}</span>
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
                            <span>{t('new_website.view_mobile') || 'Móvil'}</span>
                        </button>
                    </div>
                )}

                {/* Lado Derecho: Acciones (Sincronizar a Móvil, Recargar, Pestaña, Copiar, Fullscreen) */}
                <div className="flex items-center gap-1 sm:gap-1.5">
                    {/* Botón de Sincronización a Móvil (Cuando estamos en la PC con carpeta local) */}
                    {localStatus?.localExists && (
                        <button
                            onClick={handleSyncToMobile}
                            disabled={syncing}
                            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg bg-sky-600/90 hover:bg-sky-600 text-white border border-sky-400/40 shadow-xs transition-all text-xs font-bold disabled:opacity-50"
                            title={t('new_website.sync_hint') || 'Sincronizar cambios locales para ver en el teléfono'}
                        >
                            <CloudUpload size={14} className={syncing ? 'animate-bounce' : ''} />
                            <span className="hidden sm:inline">
                                {syncing ? (t('new_website.syncing') || 'Sincronizando...') : (t('new_website.sync_cloud') || 'Sincronizar a Móvil')}
                            </span>
                        </button>
                    )}

                    {/* Botón de Recarga en Caliente */}
                    <button
                        onClick={handleReload}
                        className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white/90 hover:text-white border border-white/10 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                        title={t('new_website.reload') || 'Recargar diseño'}
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin text-[#FDC82F]' : ''} />
                        <span className="hidden xl:inline">{t('new_website.reload') || 'Recargar'}</span>
                    </button>

                    {/* Copiar enlace local file:/// (Solo en escritorio cuando existe la ruta local) */}
                    {localStatus?.localExists && (
                        <button
                            onClick={copyFilePath}
                            className="hidden lg:flex p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white/90 hover:text-white border border-white/10 transition-colors items-center gap-1.5 text-xs font-semibold"
                            title={t('new_website.copy_path') || 'Copiar ruta local'}
                        >
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            <span className="hidden xl:inline">
                                {copied ? '¡Copiado!' : (t('new_website.copy_path') || 'Copiar')}
                            </span>
                        </button>
                    )}

                    {/* Lanzador Nativo Windows (Solo en PC cuando existe la ruta local) */}
                    {localStatus?.localExists && (
                        <button
                            onClick={handleLaunchLocalFile}
                            disabled={launching}
                            className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white border border-emerald-400/40 shadow-xs transition-all text-xs font-bold disabled:opacity-50"
                            title={t('new_website.launch_browser') || 'Abrir archivo local (file:///) en navegador'}
                        >
                            <FolderOpen size={14} />
                            <span>file:///</span>
                        </button>
                    )}

                    {/* Abrir en nueva pestaña */}
                    <button
                        onClick={handleOpenInNewTab}
                        className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-[#FDC82F] hover:bg-[#e6b528] text-[#50050a] transition-all flex items-center gap-1.5 text-xs font-black shadow-sm"
                        title={t('new_website.open_tab') || 'Abrir en nueva pestaña'}
                    >
                        <ExternalLink size={14} />
                        <span className="hidden sm:inline">{t('new_website.open_tab') || 'Pestaña'}</span>
                    </button>

                    {/* Fullscreen */}
                    <button
                        onClick={toggleFullscreen}
                        className="hidden md:flex p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white/80 hover:text-white border border-white/10 transition-colors"
                        title={isFullscreen ? (t('new_website.exit_fullscreen') || 'Salir') : (t('new_website.fullscreen') || 'Pantalla completa')}
                    >
                        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                </div>
            </header>

            {/* ── SUB-BAR: Status & Quick Info (Oculta en teléfonos pequeños para maximizar espacio) ── */}
            <div className="bg-slate-950/80 border-b border-slate-800 px-3 sm:px-4 py-1 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-2 truncate">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${localStatus?.localExists ? 'bg-emerald-500' : 'bg-sky-500'}`} />
                    <span className="text-slate-300 font-semibold truncate">
                        {localStatus?.localExists
                            ? (t('new_website.local_file_detected') || 'Archivo local en desarrollo (PC):')
                            : (t('new_website.viewing_cloud') || 'Versión sincronizada en la nube (Móvil):')}
                    </span>
                    <code className="text-emerald-400 font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 truncate hidden sm:inline">
                        {localStatus?.localExists ? FILE_URL : '/tacosgavilan-web/index.html'}
                    </code>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {localStatus?.fallbackLastModified && (
                        <span className="text-[10px] text-slate-400 hidden md:inline">
                            {language === 'es' ? 'Sincronizado' : 'Synced'}: {new Date(localStatus.fallbackLastModified).toLocaleTimeString()}
                        </span>
                    )}
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                        {isMobileScreen
                            ? 'Móvil Nativo 100%'
                            : viewport === 'desktop'
                            ? '100% Full'
                            : viewport === 'tablet'
                            ? '768 × 1024'
                            : '390 × 844'}
                    </span>
                </div>
            </div>

            {/* ── MAIN VIEWER CONTAINER ── */}
            <main className="flex-1 bg-slate-950 flex items-center justify-center p-0 md:p-2 overflow-hidden relative">
                {/* Notificación Toast flotante */}
                <AnimatePresence>
                    {toastMessage && (
                        <motion.div
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            className="absolute top-4 z-50 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs shadow-2xl flex items-center gap-2 border border-emerald-400 max-w-[90vw]"
                        >
                            <Sparkles size={14} className="shrink-0" />
                            <span className="leading-tight">{toastMessage}</span>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Spinner de Carga */}
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-xs">
                        <div className="w-10 h-10 rounded-full border-3 border-[#FDC82F]/20 border-t-[#FDC82F] animate-spin mb-3" />
                        <p className="text-xs text-slate-300 font-semibold tracking-wide">
                            {t('new_website.loading_preview') || 'Cargando diseño web de Tacos Gavilan...'}
                        </p>
                    </div>
                )}

                {/* Marco Responsivo Según Dispositivo */}
                <div
                    className={`h-full transition-all duration-300 flex flex-col bg-white overflow-hidden shadow-2xl ${
                        isMobileScreen || viewport === 'desktop'
                            ? 'w-full rounded-none'
                            : viewport === 'tablet'
                            ? 'w-[768px] max-w-full rounded-2xl border-4 border-slate-700 ring-4 ring-black/40'
                            : 'w-[390px] max-w-full rounded-[2.5rem] border-8 border-slate-800 ring-4 ring-black/50'
                    }`}
                >
                    {/* Barra decorativa de dispositivo en modo móvil/tablet en escritorio */}
                    {!isMobileScreen && viewport !== 'desktop' && (
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
                        src={effectiveIframeSrc}
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

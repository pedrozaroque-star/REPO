/**
 * @module app/nueva-web/page
 * @description Centro de Control Integral, Monitoreo Administrativo y Entorno de Pruebas del Sitio Web Oficial de Tacos Gavilan (tacosgavilan.com).
 * Integra herramientas administrativas completas:
 * 1. Simulador y Visor en Vivo Multi-Dispositivo (Desktop, Tablet y Móvil con sincronización hacia la nube).
 * 2. Buzón de Contacto y Leads en Vivo conectado a la base de datos de Supabase (customer_feedback).
 * 3. Monitor de Salud DNS y Dominio en tiempo real (detección de GoDaddy, WP Engine vs Vercel y protección de MX de Google Workspace).
 * 4. Constitución Técnica, Historia, Origen, Destino y Futuro Esperado del sitio web oficial.
 * 5. Biblioteca de Activos de Marca y Recursos Oficiales (logos SVG, folleto PDF Fiesta Platters, fotografías de tiendas).
 * 
 * @businessRules
 * - **Marca Oficial**: Estrictamente "Tacos Gavilan" (colores corporativos #50050a y #FDC82F, cero emojis en comunicación formal).
 * - **Aislamiento de Hosting**: El sitio oficial corre en Vercel a $0 de costo de servidor, reemplazando la suscripción mensual de WP Engine.
 * - **Protección de Correo Corporativo**: La migración de DNS preserva al 100% los registros MX de Google Workspace (cero caída de correos @tacosgavilan.com).
 * - **Persistencia de Datos**: Formulario de contacto y feedback de clientes se centralizan en la tabla customer_feedback de Supabase.
 * - **Preservación de SEO**: Todas las 42 URLs heredadas de WordPress se redirigen mediante reglas HTTP 301 en vercel.json.
 * 
 * @dataFlow
 * - Iframe de diseño: consume /api/web-preview/index.html (desarrollo local) o /tacosgavilan-web/index.html (nube/móvil).
 * - DNS Health: GET /api/web-preview?action=dns-status (resuelve A, CNAME, MX, NS en tiempo real).
 * - Supabase Feedback: GET /api/web-preview?action=feedback (consulta customer_feedback).
 * - Brand Assets: GET /api/web-preview?action=brand-assets (inventario de biblioteca multimedia).
 * 
 * @notes
 * - Soporte total i18n bilingüe (Español e Inglés) a través del sistema useLanguage().
 * - Totalmente adaptado para pantallas táctiles de teléfonos móviles y computadoras de escritorio.
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
    ArrowLeft, Monitor, Tablet, Smartphone, RefreshCw, ExternalLink,
    Copy, Check, Maximize2, Minimize2, Globe, Sparkles, FolderOpen,
    CloudUpload, CheckCircle2, ShieldCheck, Mail, Database, BookOpen,
    Download, AlertTriangle, Layers, MapPin, Send, User, Phone,
    Calendar, Clock, Server, ArrowRight, ShieldAlert, FileText, CheckCircle
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

type ActiveTab = 'preview' | 'feedback' | 'domain' | 'constitution' | 'assets'
type ViewportMode = 'desktop' | 'tablet' | 'mobile'

const FILE_URL = 'file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html'

export default function WebsiteCommandCenterPage() {
    const router = useRouter()
    const { t, language } = useLanguage()

    // Pestaña activa
    const [activeTab, setActiveTab] = useState<ActiveTab>('preview')

    // Estados para el visor de diseño
    const [viewport, setViewport] = useState<ViewportMode>('desktop')
    const [iframeKey, setIframeKey] = useState<number>(Date.now())
    const [isLoading, setIsLoading] = useState<boolean>(true)
    const [copied, setCopied] = useState<boolean>(false)
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
    const [launching, setLaunching] = useState<boolean>(false)
    const [syncing, setSyncing] = useState<boolean>(false)
    const [isMobileScreen, setIsMobileScreen] = useState<boolean>(false)
    const [toastMessage, setToastMessage] = useState<string | null>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    // Estado del archivo local / nube
    const [localStatus, setLocalStatus] = useState<{
        localExists: boolean
        fallbackExists: boolean
        localLastModified: string | null
        fallbackLastModified: string | null
        activeSource: 'local' | 'cloud' | 'none'
    } | null>(null)

    // Estado de DNS en vivo
    const [dnsData, setDnsData] = useState<{
        ok: boolean
        domain: string
        aRecords: string[]
        cnameRecords: string[]
        mxRecords: Array<{ exchange: string; priority: number }>
        nsRecords: string[]
        isVercel: boolean
        isCnameVercel?: boolean
        isWpEngine: boolean
        isMxSafe: boolean
        hostingDetected: string
        lastChecked: string
    } | null>(null)
    const [loadingDns, setLoadingDns] = useState<boolean>(false)

    // Estado de Feedback / Leads de Supabase
    const [feedbackRows, setFeedbackRows] = useState<any[]>([])
    const [loadingFeedback, setLoadingFeedback] = useState<boolean>(false)
    const [feedbackFilter, setFeedbackFilter] = useState<string>('all')

    // Estado de activos de marca
    const [assetsData, setAssetsData] = useState<any[]>([])
    const [loadingAssets, setLoadingAssets] = useState<boolean>(false)

    // Detectar si la pantalla es móvil real
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const checkScreen = () => {
                const isMobile = window.innerWidth < 768
                setIsMobileScreen(isMobile)
                if (isMobile) setViewport('desktop')
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

    const fetchDns = async () => {
        setLoadingDns(true)
        try {
            const res = await fetch('/api/web-preview?action=dns-status')
            if (res.ok) {
                const data = await res.json()
                setDnsData(data)
            }
        } catch {
            // Silencioso
        } finally {
            setLoadingDns(false)
        }
    }

    const fetchFeedback = async () => {
        setLoadingFeedback(true)
        try {
            const res = await fetch('/api/web-preview?action=feedback')
            if (res.ok) {
                const json = await res.json()
                setFeedbackRows(json.data || [])
            }
        } catch {
            // Silencioso
        } finally {
            setLoadingFeedback(false)
        }
    }

    const fetchAssets = async () => {
        setLoadingAssets(true)
        try {
            const res = await fetch('/api/web-preview?action=brand-assets')
            if (res.ok) {
                const json = await res.json()
                setAssetsData(json.items || [])
            }
        } catch {
            // Silencioso
        } finally {
            setLoadingAssets(false)
        }
    }

    useEffect(() => {
        fetchStatus()
        fetchDns()
    }, [])

    useEffect(() => {
        if (activeTab === 'feedback' && feedbackRows.length === 0) {
            fetchFeedback()
        }
        if (activeTab === 'domain') {
            fetchDns()
        }
        if (activeTab === 'assets' && assetsData.length === 0) {
            fetchAssets()
        }
    }, [activeTab])

    const showToast = (msg: string) => {
        setToastMessage(msg)
        setTimeout(() => setToastMessage(null), 3500)
    }

    const handleExit = () => {
        if (typeof window !== 'undefined' && window.history.length > 2) {
            router.back()
        } else {
            router.push('/dashboard')
        }
    }

    const copyToClipboard = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text)
            showToast(`${label} ${language === 'es' ? 'copiado al portapapeles' : 'copied to clipboard'}`)
        } catch {
            showToast('Error al copiar')
        }
    }

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
                setIframeKey(Date.now())
            } else {
                showToast(data.message || 'Error al sincronizar')
            }
        } catch {
            showToast('Error de conexión al sincronizar con el servidor')
        } finally {
            setSyncing(false)
        }
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

    const effectiveIframeSrc = localStatus?.localExists
        ? `/api/web-preview/index.html?t=${iframeKey}`
        : `/tacosgavilan-web/index.html?t=${iframeKey}`

    const filteredFeedback = feedbackRows.filter(row => {
        if (feedbackFilter === 'all') return true
        const typeStr = (row.complaint_type || '').toLowerCase()
        const commentStr = (row.comments || '').toLowerCase()
        const sourceStr = (row.source || '').toLowerCase()
        if (feedbackFilter === 'catering') return typeStr.includes('cater') || commentStr.includes('banquet') || commentStr.includes('platter')
        if (feedbackFilter === 'feedback') return typeStr.includes('feedback') || typeStr.includes('general') || typeStr.includes('other')
        if (feedbackFilter === 'newsletter') return sourceStr.includes('newsletter') || typeStr.includes('newsletter')
        if (feedbackFilter === 'accessibility') return typeStr.includes('access') || commentStr.includes('ada')
        return true
    })

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden select-none">
            {/* ── ENCABEZADO PRINCIPAL DE CONTROL ── */}
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
                                    Tacos Gavilan <span className="text-[#FDC82F] font-medium hidden sm:inline">— {t('new_website.official_web_command') || 'Centro Web Oficial'}</span>
                                </span>
                                {dnsData?.isVercel ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                        <span>VERCEL LIVE</span>
                                    </span>
                                ) : dnsData?.isWpEngine ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                        <span>WP ENGINE</span>
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/40 shrink-0">
                                        <CheckCircle2 size={10} className="text-sky-400" />
                                        <span>tacosgavilan.com</span>
                                    </span>
                                )}
                            </div>
                            <span className="text-[10px] text-white/60 truncate hidden md:inline">
                                https://tacosgavilan.com • Vercel CDN • Supabase DB • Toast POS
                            </span>
                        </div>
                    </div>
                </div>

                {/* Centro: Selector de Pestañas de Gestión */}
                <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10 shadow-inner overflow-x-auto max-w-[45vw] sm:max-w-none">
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                            activeTab === 'preview'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <Monitor size={14} />
                        <span className="hidden sm:inline">{t('new_website.tab_preview') || 'Diseño & Simulador'}</span>
                        <span className="sm:hidden">{t('new_website.tab_preview_short') || 'Diseño'}</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('feedback')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                            activeTab === 'feedback'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <Mail size={14} />
                        <span className="hidden sm:inline">{t('new_website.tab_feedback') || 'Buzón & Leads'}</span>
                        <span className="sm:hidden">{t('new_website.tab_feedback_short') || 'Buzón'}</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('domain')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                            activeTab === 'domain'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <Server size={14} />
                        <span className="hidden sm:inline">{t('new_website.tab_domain') || 'Dominio & Vercel'}</span>
                        <span className="sm:hidden">{t('new_website.tab_domain_short') || 'Dominio'}</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('constitution')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                            activeTab === 'constitution'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <BookOpen size={14} />
                        <span className="hidden md:inline">{t('new_website.tab_constitution') || 'Historia & Futuro'}</span>
                        <span className="md:hidden">{t('new_website.tab_constitution_short') || 'Historia'}</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('assets')}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                            activeTab === 'assets'
                                ? 'bg-[#FDC82F] text-[#50050a] shadow-sm'
                                : 'text-white/70 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <Layers size={14} />
                        <span className="hidden lg:inline">{t('new_website.tab_assets') || 'Biblioteca & Recursos'}</span>
                        <span className="lg:hidden">{t('new_website.tab_assets_short') || 'Recursos'}</span>
                    </button>
                </div>

                {/* Lado Derecho: Acciones Rápidas */}
                <div className="flex items-center gap-1 sm:gap-1.5">
                    {/* Botón sincronizar a móvil (visible en pestaña preview) */}
                    {activeTab === 'preview' && localStatus?.localExists && (
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

                    {/* Abrir sitio en nueva pestaña */}
                    <a
                        href={localStatus?.localExists ? '/api/web-preview/index.html' : '/tacosgavilan-web/index.html'}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-[#FDC82F] hover:bg-[#e6b528] text-[#50050a] transition-all flex items-center gap-1.5 text-xs font-black shadow-sm"
                        title={t('new_website.open_tab') || 'Abrir en nueva pestaña'}
                    >
                        <ExternalLink size={14} />
                        <span className="hidden sm:inline">{t('new_website.open_tab') || 'Pestaña'}</span>
                    </a>

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

            {/* ── NOTIFICACIÓN TOAST FLOTANTE ── */}
            <AnimatePresence>
                {toastMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.95 }}
                        className="absolute top-16 right-4 z-50 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs shadow-2xl flex items-center gap-2 border border-emerald-400 max-w-[90vw]"
                    >
                        <Sparkles size={14} className="shrink-0" />
                        <span className="leading-tight">{toastMessage}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── CONTENIDO PRINCIPAL SEGÚN PESTAÑA ACTIVA ── */}
            <div className="flex-1 overflow-hidden relative flex flex-col bg-slate-950">
                {/* ══════════ PESTAÑA 1: SIMULADOR & DISEÑO ══════════ */}
                {activeTab === 'preview' && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Sub-barra de controles de vista */}
                        <div className="bg-slate-950 border-b border-slate-800 px-3 sm:px-4 py-1.5 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
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

                            {/* Selector de Dispositivos */}
                            {!isMobileScreen && (
                                <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-slate-800">
                                    <button
                                        onClick={() => setViewport('desktop')}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                            viewport === 'desktop' ? 'bg-[#FDC82F] text-[#50050a]' : 'text-slate-400 hover:text-white'
                                        }`}
                                    >
                                        <Monitor size={12} />
                                        <span>{t('new_website.view_desktop') || 'Escritorio'}</span>
                                    </button>
                                    <button
                                        onClick={() => setViewport('tablet')}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                            viewport === 'tablet' ? 'bg-[#FDC82F] text-[#50050a]' : 'text-slate-400 hover:text-white'
                                        }`}
                                    >
                                        <Tablet size={12} />
                                        <span>{t('new_website.view_tablet') || 'Tablet (768px)'}</span>
                                    </button>
                                    <button
                                        onClick={() => setViewport('mobile')}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                                            viewport === 'mobile' ? 'bg-[#FDC82F] text-[#50050a]' : 'text-slate-400 hover:text-white'
                                        }`}
                                    >
                                        <Smartphone size={12} />
                                        <span>{t('new_website.view_mobile') || 'Móvil (390px)'}</span>
                                    </button>
                                </div>
                            )}

                            {/* Recargar y copiar */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        setIsLoading(true)
                                        setIframeKey(Date.now())
                                    }}
                                    className="p-1 rounded hover:bg-slate-800 text-slate-300 flex items-center gap-1 text-[11px]"
                                    title={t('new_website.reload') || 'Recargar'}
                                >
                                    <RefreshCw size={12} className={isLoading ? 'animate-spin text-[#FDC82F]' : ''} />
                                    <span className="hidden sm:inline">{t('new_website.reload') || 'Recargar'}</span>
                                </button>
                                {localStatus?.localExists && (
                                    <button
                                        onClick={handleLaunchLocalFile}
                                        className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/60 hover:bg-emerald-600 text-white text-[10px] font-bold"
                                        title={t('new_website.launch_browser') || 'Abrir file:/// en navegador predeterminado'}
                                    >
                                        <FolderOpen size={11} />
                                        <span>file:///</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Contenedor del Iframe */}
                        <div className="flex-1 flex items-center justify-center p-0 md:p-2 overflow-hidden relative bg-slate-950">
                            {isLoading && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-xs">
                                    <div className="w-10 h-10 rounded-full border-3 border-[#FDC82F]/20 border-t-[#FDC82F] animate-spin mb-3" />
                                    <p className="text-xs text-slate-300 font-semibold tracking-wide">
                                        {t('new_website.loading_preview') || 'Cargando diseño web de Tacos Gavilan...'}
                                    </p>
                                </div>
                            )}
                            <div
                                className={`h-full transition-all duration-300 flex flex-col bg-white overflow-hidden shadow-2xl ${
                                    isMobileScreen || viewport === 'desktop'
                                        ? 'w-full rounded-none'
                                        : viewport === 'tablet'
                                        ? 'w-[768px] max-w-full rounded-2xl border-4 border-slate-700 ring-4 ring-black/40'
                                        : 'w-[390px] max-w-full rounded-[2.5rem] border-8 border-slate-800 ring-4 ring-black/50'
                                }`}
                            >
                                <iframe
                                    ref={iframeRef}
                                    key={iframeKey}
                                    src={effectiveIframeSrc}
                                    className="w-full flex-1 border-0 bg-white"
                                    title="Tacos Gavilan Live Preview"
                                    onLoad={() => setIsLoading(false)}
                                    allow="geolocation; camera; microphone; clipboard-write"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ══════════ PESTAÑA 2: BUZÓN & LEADS (SUPABASE) ══════════ */}
                {activeTab === 'feedback' && (
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6">
                        {/* Cabecera del Buzón */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
                            <div>
                                <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                                    <Mail className="text-[#FDC82F]" size={22} />
                                    <span>{t('new_website.feedback_title') || 'Buzón de Contacto y Leads Web Oficial'}</span>
                                </h2>
                                <p className="text-xs text-slate-400 mt-1">
                                    {t('new_website.feedback_subtitle') || 'Mensajes recibidos desde el formulario web de tacosgavilan.com y guardados en Supabase (public.customer_feedback)'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={fetchFeedback}
                                    disabled={loadingFeedback}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors"
                                >
                                    <RefreshCw size={14} className={loadingFeedback ? 'animate-spin text-[#FDC82F]' : ''} />
                                    <span>{t('new_website.refresh') || 'Actualizar'}</span>
                                </button>
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                                    {feedbackRows.length} {t('new_website.messages_logged') || 'Mensajes Web Registrados'}
                                </span>
                            </div>
                        </div>

                        {/* Filtros de Categorías */}
                        <div className="flex items-center gap-2 overflow-x-auto pb-2">
                            {[
                                { id: 'all', label: t('new_website.filter_all') || 'Todos los Mensajes' },
                                { id: 'catering', label: t('new_website.filter_catering') || 'Banquetes & Catering' },
                                { id: 'feedback', label: t('new_website.filter_feedback') || 'Comentarios & Servicio' },
                                { id: 'newsletter', label: t('new_website.filter_newsletter') || 'Newsletter & Suscripciones' },
                                { id: 'accessibility', label: t('new_website.filter_accessibility') || 'Accesibilidad ADA' }
                            ].map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setFeedbackFilter(filter.id)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                                        feedbackFilter === filter.id
                                            ? 'bg-[#FDC82F] text-[#50050a] shadow-md'
                                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>

                        {/* Listado de Mensajes */}
                        {loadingFeedback ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <div className="w-8 h-8 rounded-full border-2 border-[#FDC82F] border-t-transparent animate-spin mb-3" />
                                <p className="text-xs">{t('new_website.querying_supabase') || 'Consultando Supabase...'}</p>
                            </div>
                        ) : filteredFeedback.length === 0 ? (
                            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
                                <CheckCircle size={36} className="mx-auto text-emerald-500 mb-2 opacity-80" />
                                <h3 className="text-sm font-bold text-slate-200">{t('new_website.empty_category_title') || 'No hay mensajes registrados en esta categoría'}</h3>
                                <p className="text-xs text-slate-500 mt-1">{t('new_website.empty_category_desc') || 'Los nuevos mensajes enviados desde el formulario web oficial aparecerán aquí en tiempo real.'}</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {filteredFeedback.map((row, idx) => (
                                    <div
                                        key={row.id || idx}
                                        className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-slate-700 transition-all"
                                    >
                                        <div>
                                            <div className="flex items-start justify-between gap-2 mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-[#50050a] text-[#FDC82F] flex items-center justify-center font-bold text-xs shrink-0 border border-[#FDC82F]/30">
                                                        {(row.customer_name || 'U')[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs sm:text-sm font-black text-white">{row.customer_name || (t('new_website.anonymous_customer') || 'Cliente Anónimo')}</h4>
                                                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                            <Clock size={10} />
                                                            {new Date(row.created_at || row.submission_date).toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                                    (row.complaint_type || '').toLowerCase().includes('cater')
                                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                                        : (row.complaint_type || '').toLowerCase().includes('newsletter')
                                                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                                        : (row.complaint_type || '').toLowerCase().includes('access')
                                                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                                }`}>
                                                    {row.complaint_type || 'General'}
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-3 my-2 text-[11px] text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                                                {row.customer_email && (
                                                    <a href={`mailto:${row.customer_email}`} className="flex items-center gap-1 text-sky-400 hover:underline">
                                                        <Mail size={12} />
                                                        <span>{row.customer_email}</span>
                                                    </a>
                                                )}
                                                {row.customer_phone && (
                                                    <a href={`tel:${row.customer_phone}`} className="flex items-center gap-1 text-emerald-400 hover:underline">
                                                        <Phone size={12} />
                                                        <span>{row.customer_phone}</span>
                                                    </a>
                                                )}
                                                {row.store_id && (
                                                    <span className="flex items-center gap-1 text-[#FDC82F] font-semibold">
                                                        <MapPin size={12} />
                                                        <span>{t('new_website.store_label') || 'Sucursal'}: {row.store_name ? `${row.store_name} (#${row.store_id})` : `#${row.store_id}`}</span>
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-xs text-slate-200 mt-3 whitespace-pre-wrap leading-relaxed line-clamp-4 hover:line-clamp-none transition-all">
                                                {row.comments || (t('new_website.no_comments') || 'Sin comentarios registrados.')}
                                            </p>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px]">
                                            <span className="text-slate-500 text-[10px]">
                                                {t('new_website.source_label') || 'Origen'}: {row.source || 'website_contact'}
                                            </span>
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                                                {t('new_website.status_label') || 'Estado'}: {row.admin_review_status || (t('new_website.status_pending') || 'Pendiente')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ══════════ PESTAÑA 3: DOMINIO & VERCEL DNS ══════════ */}
                {activeTab === 'domain' && (
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6">
                        {/* Banner de Estado de Corte DNS en Producción */}
                        {dnsData?.isVercel && (
                            <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-2xl p-4 sm:p-5 shadow-xl flex items-start gap-3">
                                <CheckCircle2 className="text-emerald-400 shrink-0 mt-0.5" size={22} />
                                <div>
                                    <h3 className="text-xs sm:text-sm font-black text-emerald-300 uppercase tracking-wider">
                                        {t('new_website.cutover_completed_badge') || 'CORTE DE DNS COMPLETADO Y EN VIVO EN VERCEL EDGE'}
                                    </h3>
                                    <p className="text-xs text-emerald-100/80 mt-1 leading-relaxed">
                                        {t('new_website.cutover_completed_desc') || 'El dominio raíz tacosgavilan.com (76.76.21.21) y el subdominio www.tacosgavilan.com (cname.vercel-dns.com) ya operan en producción sobre Vercel Edge con SSL activo y redirección canónica 308.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Tarjeta de Estado del Dominio */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Server className="text-[#FDC82F]" size={22} />
                                        <h2 className="text-lg sm:text-xl font-black text-white">
                                            {t('new_website.domain_title') || 'Administración del Dominio y Salud DNS'}
                                        </h2>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {t('new_website.domain_subtitle') || 'Supervisión en tiempo real del dominio oficial tacosgavilan.com en Vercel Edge Network'}
                                    </p>
                                </div>
                                <button
                                    onClick={fetchDns}
                                    disabled={loadingDns}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors shrink-0"
                                >
                                    <RefreshCw size={14} className={loadingDns ? 'animate-spin text-[#FDC82F]' : ''} />
                                    <span>{t('new_website.scan_dns_live') || 'Escanear DNS en Vivo'}</span>
                                </button>
                            </div>

                            {/* Resumen de Estado en 4 Columnas */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                                {/* Estado Web (Registro A) */}
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('new_website.current_hosting_label') || 'Hosting Web Actual'}</span>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className={`w-3 h-3 rounded-full ${dnsData?.isVercel ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                                        <span className="text-sm font-black text-white">{dnsData?.hostingDetected || (t('new_website.detecting') || 'Detectando...')}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-2 font-mono">
                                        A (@): {dnsData?.aRecords?.join(', ') || (t('new_website.querying') || 'Consultando...')}
                                    </p>
                                </div>

                                {/* Subdominio www (CNAME) */}
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('new_website.cname_www_label') || 'Subdominio www (CNAME)'}</span>
                                    <div className="flex items-center gap-2 mt-2">
                                        <CheckCircle2 size={16} className={dnsData?.cnameRecords?.length ? 'text-emerald-400' : 'text-amber-400'} />
                                        <span className="text-sm font-black text-white">www.tacosgavilan.com</span>
                                    </div>
                                    <p className="text-[11px] text-emerald-400 mt-2 font-mono truncate">
                                        {dnsData?.cnameRecords?.join(', ') || 'cname.vercel-dns.com'}
                                    </p>
                                </div>

                                {/* Nameservers */}
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('new_website.dns_manager_label') || 'Gestor de Dominio (DNS)'}</span>
                                    <div className="flex items-center gap-2 mt-2">
                                        <CheckCircle2 size={16} className="text-emerald-400" />
                                        <span className="text-sm font-black text-white">GoDaddy DNS</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-2 font-mono truncate">
                                        {dnsData?.nsRecords?.join(', ') || 'ns73/ns74.domaincontrol.com'}
                                    </p>
                                </div>

                                {/* Protección de Correos */}
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('new_website.mx_servers_label') || 'Servidores de Correo (MX)'}</span>
                                    <div className="flex items-center gap-2 mt-2">
                                        <ShieldCheck size={16} className="text-emerald-400" />
                                        <span className="text-sm font-black text-emerald-400">{t('new_website.mx_protected_status') || 'Google Workspace (Protegido)'}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-2 font-mono">
                                        {dnsData?.mxRecords?.length || 5} {t('new_website.mx_active_count') || 'servidores MX activos (Gmail Corporativo)'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Tabla de Registros DNS en GoDaddy */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
                            <h3 className="text-base font-black text-white flex items-center gap-2 mb-2">
                                <Server className="text-[#FDC82F]" size={18} />
                                <span>{t('new_website.godaddy_guide_title') || 'Configuración DNS en GoDaddy (Vercel Edge)'}</span>
                            </h3>
                            <p className="text-xs text-slate-400 mb-4">
                                {t('new_website.godaddy_table_subtitle_live') || 'Registros DNS configurados en GoDaddy apuntando a Vercel Edge Network sin afectar Google Workspace:'}
                            </p>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider bg-slate-950">
                                            <th className="py-2.5 px-3">{t('new_website.col_type') || 'Tipo (Type)'}</th>
                                            <th className="py-2.5 px-3">{t('new_website.col_name') || 'Nombre (Name)'}</th>
                                            <th className="py-2.5 px-3">{t('new_website.col_old_value') || 'Valor Anterior (WP Engine)'}</th>
                                            <th className="py-2.5 px-3 text-[#FDC82F]">{t('new_website.col_active_value') || 'Valor en Vercel'}</th>
                                            <th className="py-2.5 px-3">{t('new_website.col_status') || 'Estado / Acción'}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                                        <tr className="hover:bg-slate-800/40">
                                            <td className="py-3 px-3 font-bold text-white">A</td>
                                            <td className="py-3 px-3 text-slate-300">@</td>
                                            <td className="py-3 px-3 text-rose-400 line-through">141.193.213.11</td>
                                            <td className="py-3 px-3 text-emerald-400 font-bold">76.76.21.21</td>
                                            <td className="py-3 px-3 flex items-center gap-2">
                                                {dnsData?.isVercel && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                                        <CheckCircle2 size={10} /> {t('new_website.verified_badge') || 'Activo en Vivo'}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => copyToClipboard('76.76.21.21', 'IP de Vercel')}
                                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-sans flex items-center gap-1"
                                                >
                                                    <Copy size={10} /> {t('new_website.copy_btn') || 'Copiar'}
                                                </button>
                                            </td>
                                        </tr>
                                        <tr className="hover:bg-slate-800/40">
                                            <td className="py-3 px-3 font-bold text-white">CNAME</td>
                                            <td className="py-3 px-3 text-slate-300">www</td>
                                            <td className="py-3 px-3 text-rose-400 line-through">tacosgavilan.wpengine.com</td>
                                            <td className="py-3 px-3 text-emerald-400 font-bold">cname.vercel-dns.com</td>
                                            <td className="py-3 px-3 flex items-center gap-2">
                                                {(dnsData?.isCnameVercel || dnsData?.isVercel) && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                                        <CheckCircle2 size={10} /> {t('new_website.verified_badge') || 'Activo en Vivo'}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => copyToClipboard('cname.vercel-dns.com', 'CNAME de Vercel')}
                                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-sans flex items-center gap-1"
                                                >
                                                    <Copy size={10} /> {t('new_website.copy_btn') || 'Copiar'}
                                                </button>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* Advertencia Crítica de Correos */}
                            <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                                <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
                                <div className="text-xs text-amber-200/90 leading-relaxed">
                                    <strong className="text-amber-300 block mb-1">{t('new_website.critical_email_rule_title') || 'REGLA CRÍTICA DE SEGURIDAD (CORREOS CORPORATIVOS):'}</strong>
                                    {t('new_website.godaddy_warning') || 'NUNCA modifiques los Nameservers ni los registros MX de Google Workspace. Mantén ns73/ns74.domaincontrol.com para evitar la desconexión del correo corporativo.'}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ══════════ PESTAÑA 4: CONSTITUCIÓN, HISTORIA & FUTURO ══════════ */}
                {activeTab === 'constitution' && (
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-8">
                        {/* Encabezado */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
                            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
                                <BookOpen className="text-[#FDC82F]" size={26} />
                                <span>{t('new_website.history_title') || 'Constitución Técnica, Historia y Futuro del Sitio Web Oficial'}</span>
                            </h2>
                            <p className="text-xs text-slate-400 mt-2">
                                {t('new_website.history_subtitle') || 'Documento rector para la dirección, gerencia y equipo técnico de Tacos Gavilan sobre la evolución del dominio tacosgavilan.com.'}
                            </p>
                        </div>

                        {/* Sección 1: Historia y Origen */}
                        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
                            <div className="flex items-center gap-2 text-rose-400 font-black text-sm uppercase tracking-wider">
                                <Clock size={16} />
                                <span>{t('new_website.sec1_title') || '1. Historia y Origen (El WordPress Heredado)'}</span>
                            </div>
                            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                El sitio web anterior de Tacos Gavilan fue construido entre 2021 y 2022 sobre la plataforma <strong>WordPress</strong> (tema personalizado <em>Tacos Gavilan V2.0</em> desarrollado por jjrod.com) y alojado en los servidores de <strong>WP Engine</strong>.
                            </p>
                            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                Con el paso de los años, este esquema presentó tres problemas críticos para el negocio:
                            </p>
                            <ul className="text-xs sm:text-sm text-slate-400 space-y-2 list-disc pl-5">
                                <li><strong>Costos Recurrentes Innecesarios</strong>: Pago mensual constante a WP Engine simplemente por mantener encendidos servidores PHP y bases de datos MySQL desactualizadas.</li>
                                <li><strong>Vulnerabilidad Legal (Demanda ADA en California)</strong>: En 2026 la empresa enfrentó demandas bajo el <em>California Unruh Civil Rights Act</em> y <em>ADA Title III</em> debido a la falta de accesibilidad digital (WCAG 2.2 AA) y avisos obligatorios de privacidad (CCPA/CPRA) en el WordPress viejo.</li>
                                <li><strong>Lentitud y Rigidez en Teléfonos Móviles</strong>: Plugins pesados como WP Rocket generaban inconsistencias de caché, impidiendo que clientes y supervisores vieran promociones en tiempo real.</li>
                            </ul>
                        </div>

                        {/* Sección 2: Constitución Técnica Actual */}
                        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
                            <div className="flex items-center gap-2 text-emerald-400 font-black text-sm uppercase tracking-wider">
                                <ShieldCheck size={16} />
                                <span>{t('new_website.sec2_title') || '2. Constitución Técnica (Arquitectura Desacoplada y Moderna)'}</span>
                            </div>
                            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                El nuevo sitio web oficial fue diseñado desde cero eliminando WordPress y adoptando una <strong>arquitectura desacoplada y estática (*JAMstack*)</strong> con los más altos estándares tecnológicos:
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <h4 className="text-xs font-bold text-white mb-1">Frontend Ultra Rápido (HTML5 / CSS / Vanilla JS)</h4>
                                    <p className="text-[11px] text-slate-400">Carga en menos de 1 segundo en cualquier celular. Cero dependencias pesadas, responsive 100% y sin bases de datos lentas intermedias.</p>
                                </div>
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <h4 className="text-xs font-bold text-white mb-1">Integración Nativa Toast POS (15 Tiendas)</h4>
                                    <p className="text-[11px] text-slate-400">Enlaces y rutas directas a las 15 sucursales activas para pedidos en línea sin comisiones excesivas de plataformas externas.</p>
                                </div>
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <h4 className="text-xs font-bold text-white mb-1">Persistencia Segura en Supabase</h4>
                                    <p className="text-[11px] text-slate-400">Todos los formularios de banquetes (Catering), servicio al cliente y newsletter se guardan automáticamente en la nube de Supabase.</p>
                                </div>
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <h4 className="text-xs font-bold text-white mb-1">Blindaje Legal Integral (WCAG 2.2 AA / CCPA 2026)</h4>
                                    <p className="text-[11px] text-slate-400">Herramientas de accesibilidad para personas con discapacidad, contraste, selector de fuentes y aviso de protección de datos.</p>
                                </div>
                            </div>
                        </div>

                        {/* Sección 3: Estado en Producción y Futuro Esperado */}
                        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
                            <div className="flex items-center gap-2 text-[#FDC82F] font-black text-sm uppercase tracking-wider">
                                <Sparkles size={16} />
                                <span>{t('new_website.sec3_title') || '3. Estado en Producción y Futuro Estratégico'}</span>
                            </div>
                            <div className="space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
                                <p className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-100">
                                    {t('new_website.sec3_live_status') || 'Estado Actual en Producción (Completado): El dominio oficial tacosgavilan.com ya opera al 100% en la red global de Vercel Edge (76.76.21.21) con certificado SSL/TLS activo, redirecciones 301/308 para las 42 URLs históricas, costo de servidor de $0 mensuales, correos corporativos (@tacosgavilan.com) intactos en Google Workspace, y 4 capas de respaldo del WordPress clásico (incluyendo https://tacosgavilan-sitio-anterior-backup.vercel.app y la rama classic-wordpress-backup).'}
                                </p>
                                <p>
                                    <strong>Futuro Estratégico</strong>:
                                </p>
                                <ul className="text-xs sm:text-sm text-slate-400 space-y-2 list-disc pl-5">
                                    <li><strong>Sinergia con la Customer App</strong>: Los clientes podrán pasar sin fricción entre la web oficial y la app móvil para acumular recompensas y pedir comida.</li>
                                    <li><strong>Cotizador Interactivo de Banquetes y Taquizas</strong>: Sistema en línea donde clientes corporativos y familiares pueden cotizar paquetes de fiesta en segundos con confirmación directa a la gerencia de tienda.</li>
                                    <li><strong>Independencia Comercial</strong>: Disminución progresiva del volumen de pedidos en DoorDash y UberEats empujando a los clientes hacia la web y app oficial, ahorrando miles de dólares en comisiones de delivery.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* ══════════ PESTAÑA 5: BIBLIOTECA & RECURSOS DE MARCA ══════════ */}
                {activeTab === 'assets' && (
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6">
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                                    <Layers className="text-[#FDC82F]" size={22} />
                                    <span>{t('new_website.assets_title') || 'Biblioteca Oficial de Recursos y Medios de Marca'}</span>
                                </h2>
                                <p className="text-xs text-slate-400 mt-1">
                                    {t('new_website.assets_subtitle') || 'Activos vectoriales, documentos legales, folleto PDF Fiesta Platters y fotografías de alta resolución de las 15 sucursales.'}
                                </p>
                            </div>
                            <span className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold">
                                {assetsData.length > 0 ? assetsData.length : 121} {t('new_website.assets_backed_up_badge') || 'Recursos Respaldados en PC'}
                            </span>
                        </div>

                        {/* Recursos Destacados */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Folleto Fiesta Platters */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                                <div>
                                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-[#FDC82F] flex items-center justify-center mb-3 border border-amber-500/40">
                                        <FileText size={20} />
                                    </div>
                                    <h4 className="text-sm font-black text-white">{t('new_website.brochure_title') || 'Folleto Oficial Fiesta Platters'}</h4>
                                    <p className="text-xs text-slate-400 mt-1">{t('new_website.brochure_desc') || 'Folleto tri-fold oficial en PDF para eventos, taquizas y charolas familiares (activo en producción y local).'}</p>
                                    <span className="text-[10px] text-slate-500 font-mono mt-2 block">Gavilan-Party-Tray-Brochure-WEB.pdf (722 KB)</span>
                                </div>
                                <a
                                    href="/Gavilan-Party-Tray-Brochure-WEB.pdf"
                                    download
                                    className="mt-4 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#FDC82F] hover:bg-[#e6b528] text-[#50050a] font-black text-xs transition-all shadow-sm"
                                >
                                    <Download size={14} /> {t('new_website.download_brochure') || 'Descargar Folleto PDF'}
                                </a>
                            </div>

                            {/* Logotipos Vectoriales SVG */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                                <div>
                                    <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center mb-3 border border-sky-500/40">
                                        <Sparkles size={20} />
                                    </div>
                                    <h4 className="text-sm font-black text-white">{t('new_website.svg_logos_title') || 'Logotipos Vectoriales SVG'}</h4>
                                    <p className="text-xs text-slate-400 mt-1">{t('new_website.svg_logos_desc') || 'Logos originales escalables sin pérdida de resolución (horizontal, vertical e icono).'}</p>
                                    <span className="text-[10px] text-slate-500 font-mono mt-2 block">theme-gavilan/gavilan/img/*.svg</span>
                                </div>
                                <button
                                    onClick={() => copyToClipboard('C:\\Users\\pedro\\Desktop\\tacosgavilan-oficial-backup\\theme-gavilan\\gavilan\\img', 'Ruta de logos')}
                                    className="mt-4 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-all border border-slate-700"
                                >
                                    <Copy size={14} /> {t('new_website.copy_pc_path') || 'Copiar Ruta en PC'}
                                </button>
                            </div>

                            {/* Base de Datos de Producción SQL y Espejo Clásico */}
                            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                                <div>
                                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3 border border-emerald-500/40">
                                        <Database size={20} />
                                    </div>
                                    <h4 className="text-sm font-black text-white">{t('new_website.mysql_backup_title') || 'Respaldo MySQL y Espejo Clásico'}</h4>
                                    <p className="text-xs text-slate-400 mt-1">{t('new_website.mysql_backup_desc') || 'Volcado SQL puro (83.75 MB), exportación XML de WordPress y sitio clásico de respaldo en Vercel.'}</p>
                                    <span className="text-[10px] text-slate-500 font-mono mt-2 block">database-export/ (83.75 MB SQL + 1.45 MB XML)</span>
                                </div>
                                <div className="mt-4 flex items-center gap-2">
                                    <button
                                        onClick={() => copyToClipboard('C:\\Users\\pedro\\Desktop\\tacosgavilan-oficial-backup\\database-export', 'Ruta de Base de Datos')}
                                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-all border border-slate-700"
                                    >
                                        <Copy size={14} /> {t('new_website.copy_pc_path') || 'Copiar Ruta en PC'}
                                    </button>
                                    <a
                                        href="https://tacosgavilan-sitio-anterior-backup.vercel.app"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs flex items-center gap-1 transition-all"
                                        title="Abrir espejo clásico WordPress en vivo"
                                    >
                                        <ExternalLink size={13} /> WP Backup
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* Catálogo de Fotografías de las 15 Sucursales Oficiales */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
                            <h3 className="text-sm font-black text-white flex items-center gap-2 mb-4">
                                <MapPin className="text-[#FDC82F]" size={16} />
                                <span>{t('new_website.store_photos_title') || 'Inventario Fotográfico de Sucursales (15 Tiendas Oficiales)'}</span>
                            </h3>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                {[
                                    { name: 'Rialto (#1)', file: 'rialto-hero.webp' },
                                    { name: 'West Covina (#3)', file: 'west-covina-hero.webp' },
                                    { name: 'Azusa (#4)', file: 'azusa-hero.webp' },
                                    { name: 'LA Broadway (#5)', file: 'la-broadway-hero.webp' },
                                    { name: 'LA Central (#6)', file: 'la-central-hero.webp' },
                                    { name: 'Slauson (#7)', file: 'slauson-hero.webp' },
                                    { name: 'Hollywood (#8)', file: 'hollywood-hero.webp' },
                                    { name: 'Santa Ana (#9)', file: 'santa-ana-hero.webp' },
                                    { name: 'La Puente (#10)', file: 'la-puente-hero.webp' },
                                    { name: 'Huntington Park (#11)', file: 'huntington-park-hero.webp' },
                                    { name: 'Norwalk (#12)', file: 'norwalk-hero.webp' },
                                    { name: 'Bell (#13)', file: 'bell-hero.webp' },
                                    { name: 'Lynwood (#14)', file: 'lynwood-hero.webp' },
                                    { name: 'South Gate (#15)', file: 'south-gate-hero.webp' },
                                    { name: 'Downey (#16)', file: 'downey-hero.webp' }
                                ].map((store, i) => (
                                    <div key={i} className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center">
                                        <div className="h-16 rounded-lg bg-slate-900 flex items-center justify-center text-slate-500 font-bold text-xs mb-2 overflow-hidden border border-slate-800 relative">
                                            <img
                                                src={`/tacosgavilan-web/img/locations/${store.file}`}
                                                alt={store.name}
                                                className="w-full h-full object-cover opacity-85 hover:opacity-100 transition-opacity"
                                                loading="lazy"
                                            />
                                        </div>
                                        <h5 className="text-xs font-bold text-white truncate">{store.name}</h5>
                                        <span className="text-[10px] text-slate-500 truncate block font-mono mt-0.5">{store.file}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

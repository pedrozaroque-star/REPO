'use client'

/**
 * @module app/nueva-web/page
 * @description Panel Ejecutivo del Sitio Web Oficial de Tacos Gavilan (https://tacosgavilan.com).
 * Centraliza en una interfaz clara y sin tecnicismos:
 *   1. Contador en tiempo real de visitas al sitio web, visitantes únicos, dispositivos e idiomas.
 *   2. Contador de clics en "Ordenar en Línea" (Toast POS), llamadas telefónicas y mapas por cada una de las 15 sucursales.
 *   3. Cruce financiero con Ventas Digitales y Online ejecutadas en Toast POS (Toast Directo, DoorDash, Uber Eats, Grubhub).
 *   4. Buzón de mensajes de clientes, cotizaciones de Fiesta Platters y suscripciones recibidas desde la web.
 *   5. Visor interactivo del sitio web oficial publicado (Escritorio, Tablet y Teléfono Móvil).
 *
 * @businessRules
 * - **Día Laboral Oficial**: Inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente (America/Los_Angeles).
 * - **15 Sucursales Oficiales**: Muestra el desglose completo de las 15 tiendas activas de Tacos Gavilan.
 * - **Protocolo Bilingüe (i18n)**: 100% de los textos visibles utilizan `useLanguage()` (`es` / `en`) desde `lib/i18n.tsx`.
 * - **Marca Oficial**: Estrictamente "Tacos Gavilan".
 *
 * @dataFlow
 * - `https://tacosgavilan.com` (`compliance-a11y.js` -> `POST /api/track`) -> Supabase `public.activity_logs` (`entity_type = 'tacosgavilan_web'`).
 * - `GET /api/web-preview?action=analytics&range=today|yesterday|7d|30d` -> Combina `activity_logs`, `sales_daily_cache`, `accounting_sales_packets` y `customer_feedback`.
 *
 * @notes
 * - Adaptado al sistema de diseño claro/oscuro (`bg-white dark:bg-slate-900`) estándar de SM TEG Monitoring System.
 * - **Adaptación Móvil Integral (`320px–768px`)**:
 *   1. Encabezado no intrusivo en móvil (`relative lg:sticky lg:top-16`) con barra superior compacta y selector de 3 pestañas (`grid-cols-3 sm:flex`) sin desbordamiento horizontal.
 *   2. Tarjetas móviles nativas (`md:hidden`) para la Bitácora de Órdenes Completadas y la Tabla de 15 Sucursales, manteniendo las tablas completas en escritorio (`hidden md:block`).
 *   3. Escalado dinámico por `ResizeObserver` (`stageWidth`) en el visor en vivo (`live_site`), iniciando en vista móvil nativa en teléfonos y escalando proporcionalmente los marcos de Tablet (`768px`) y Escritorio (`1280px`) para evitar cortes laterales.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    Globe,
    ExternalLink,
    RefreshCw,
    Maximize2,
    Minimize2,
    Monitor,
    Smartphone,
    Tablet,
    Inbox,
    FileText,
    Mail,
    Phone,
    MapPin,
    Clock,
    ShoppingBag,
    Users,
    MousePointerClick,
    DollarSign,
    TrendingUp,
    Sparkles,
    Navigation,
    Store,
    Languages
} from 'lucide-react'

type ViewportMode = 'desktop' | 'tablet' | 'mobile'
type ActiveTab = 'analytics' | 'messages' | 'live_site'
type DateRangeKey = 'today' | 'yesterday' | '7d' | '30d'

interface StoreAnalyticsRow {
    id: number
    name: string
    crossStreets: string
    phone: string
    toastUrl: string
    webOrderClicks: number
    webPhoneClicks: number
    webDirectionsClicks: number
    webStoreViews: number
    matchedWebOrdersCount: number
    matchedWebOrdersSales: number
    pickupOrdersCount: number
    pickupOrdersSales: number
    deliveryOrdersCount: number
    deliveryOrdersSales: number
    storefrontOrdersCount: number
    storefrontOrdersSales: number
    toastDirectSales: number
}

interface StorefrontOrderRow {
    orderGuid: string
    orderCode: string
    storeId: number
    storeName: string
    customerMasked: string
    fulfillmentType: 'pickup' | 'delivery'
    netSales: number
    openedDate: string
    businessDate?: string
}

interface MatchedOrderRow {
    orderGuid: string
    orderCode: string
    storeId: number
    storeName: string
    customerMasked: string
    fulfillmentType?: 'pickup' | 'delivery'
    netSales: number
    openedDate: string
    clickAt: string
    buttonSource: string
    matchType: 'exact_store' | 'session_store' | 'general_selector'
    minutesAfterClick: number
}

interface TopPageRow {
    path: string
    views: number
    pct: number
}

interface RecentEventRow {
    id: number
    action: string
    page_path: string
    store_id: number | null
    store_name: string | null
    platform: string
    button_source: string
    device_type: string
    lang: string
    referrer: string
    created_at: string
}

interface AnalyticsPayload {
    ok: boolean
    range: string
    startDate: string
    endDate: string
    todayBusinessDate: string
    summary: {
        totalPageViews: number
        uniqueVisitors: number
        totalOrderClicks: number
        totalPhoneClicks: number
        totalDirectionsClicks: number
        generalSelectorClicks: number
        matchedWebOrdersCount: number
        matchedWebOrdersSales: number
        pickupOrdersCount: number
        pickupOrdersSales: number
        deliveryOrdersCount: number
        deliveryOrdersSales: number
        storefrontOrdersCount: number
        storefrontOrdersSales: number
        toastDirectSales: number
        totalFeedbackCount: number
    }
    deviceBreakdown: {
        mobile: number
        desktop: number
        tablet: number
    }
    langBreakdown: {
        es: number
        en: number
    }
    topPages: TopPageRow[]
    storeBreakdown: StoreAnalyticsRow[]
    storefrontOrders?: StorefrontOrderRow[]
    matchedOrders: MatchedOrderRow[]
    recentEvents: RecentEventRow[]
    feedback: any[]
}

function formatCurrency(val: number): string {
    return val.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })
}

function getFriendlyPageLabel(pagePath: string, lang: 'es' | 'en'): string {
    const clean = (pagePath || '/').toLowerCase()
    if (clean === '/' || clean === '') return lang === 'es' ? 'Inicio (Página Principal)' : 'Homepage (Main)'
    if (clean.startsWith('/menu')) return lang === 'es' ? `Menú (${clean})` : `Menu (${clean})`
    if (clean.startsWith('/locations')) return lang === 'es' ? `Sucursales (${clean})` : `Locations (${clean})`
    if (clean.startsWith('/fiesta-platter')) return 'Fiesta Platters / Catering'
    if (clean.startsWith('/contact')) return lang === 'es' ? 'Contacto' : 'Contact Us'
    if (clean.startsWith('/careers')) return lang === 'es' ? 'Bolsa de Trabajo (Empleo)' : 'Careers (Jobs)'
    if (clean.startsWith('/blog')) return 'Blog Oficial'
    if (clean.startsWith('/privacy') || clean.startsWith('/terms') || clean.startsWith('/accessibility')) {
        return lang === 'es' ? `Legal (${clean})` : `Legal (${clean})`
    }
    return pagePath
}

export default function NuevaWebPage() {
    const { t, language } = useLanguage()
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const stageRef = useRef<HTMLDivElement>(null)

    const [activeTab, setActiveTab] = useState<ActiveTab>('analytics')
    const [dateRange, setDateRange] = useState<DateRangeKey>('today')
    const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
    const [loadingAnalytics, setLoadingAnalytics] = useState<boolean>(true)
    const [feedbackFilter, setFeedbackFilter] = useState<string>('all')
    const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'pickup' | 'delivery'>('all')

    // Live site preview state
    const [viewport, setViewport] = useState<ViewportMode>('desktop')
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
    const [iframeLoading, setIframeLoading] = useState<boolean>(true)
    const [refreshKey, setRefreshKey] = useState<number>(0)
    const [stageWidth, setStageWidth] = useState<number>(0)

    const previewUrl = `/api/web-preview/index.html?v=${refreshKey}`

    // Default to 'mobile' simulator view when accessed from a mobile screen
    useEffect(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            setViewport('mobile')
        }
    }, [])

    // Measure live preview stage width for responsive hardware frame scaling on small screens
    useEffect(() => {
        if (activeTab !== 'live_site') return
        const el = stageRef.current
        const updateWidth = () => {
            if (el) {
                setStageWidth(el.clientWidth)
            } else if (typeof window !== 'undefined') {
                setStageWidth(window.innerWidth - 32)
            }
        }
        updateWidth()
        let ro: ResizeObserver | null = null
        if (typeof ResizeObserver !== 'undefined' && el) {
            ro = new ResizeObserver(() => updateWidth())
            ro.observe(el)
        }
        window.addEventListener('resize', updateWidth)
        return () => {
            if (ro) ro.disconnect()
            window.removeEventListener('resize', updateWidth)
        }
    }, [activeTab, isFullscreen, viewport])

    const fetchAnalyticsData = useCallback(async (selectedRange: DateRangeKey, force = false) => {
        setLoadingAnalytics(true)
        try {
            const url = `/api/web-preview?action=analytics&range=${selectedRange}${force ? '&force=1' : ''}`
            const res = await fetch(url, {
                cache: 'no-store'
            })
            const data = await res.json()
            if (data && data.ok) {
                setAnalytics(data)
            }
        } catch {
            // Silent catch
        } finally {
            setLoadingAnalytics(false)
        }
    }, [])

    useEffect(() => {
        fetchAnalyticsData(dateRange)
        const interval = setInterval(() => {
            fetchAnalyticsData(dateRange)
        }, 45000)
        return () => clearInterval(interval)
    }, [dateRange, fetchAnalyticsData])

    const handleReloadPreview = () => {
        setIframeLoading(true)
        setRefreshKey(prev => prev + 1)
    }

    const summary = analytics?.summary || {
        totalPageViews: 0,
        uniqueVisitors: 0,
        totalOrderClicks: 0,
        totalPhoneClicks: 0,
        totalDirectionsClicks: 0,
        generalSelectorClicks: 0,
        matchedWebOrdersCount: 0,
        matchedWebOrdersSales: 0,
        pickupOrdersCount: 0,
        pickupOrdersSales: 0,
        deliveryOrdersCount: 0,
        deliveryOrdersSales: 0,
        storefrontOrdersCount: 0,
        storefrontOrdersSales: 0,
        toastDirectSales: 0,
        totalFeedbackCount: 0
    }

    const feedbackRows = analytics?.feedback || []
    const filteredFeedback = feedbackRows.filter((item: any) => {
        if (feedbackFilter === 'all') return true
        return (item.complaint_type || '').toLowerCase() === feedbackFilter
    })

    const totalDeviceCount =
        (analytics?.deviceBreakdown.mobile || 0) +
        (analytics?.deviceBreakdown.desktop || 0) +
        (analytics?.deviceBreakdown.tablet || 0)

    const mobilePct = totalDeviceCount > 0 ? Math.round(((analytics?.deviceBreakdown.mobile || 0) / totalDeviceCount) * 100) : 0
    const desktopPct = totalDeviceCount > 0 ? Math.round(((analytics?.deviceBreakdown.desktop || 0) / totalDeviceCount) * 100) : 0

    const totalLangCount = (analytics?.langBreakdown.es || 0) + (analytics?.langBreakdown.en || 0)
    const esPct = totalLangCount > 0 ? Math.round(((analytics?.langBreakdown.es || 0) / totalLangCount) * 100) : 0
    const enPct = totalLangCount > 0 ? Math.round(((analytics?.langBreakdown.en || 0) / totalLangCount) * 100) : 0

    return (
        <div
            className={`flex flex-col bg-transparent text-slate-900 dark:text-white font-sans antialiased tracking-[0.01em] transition-all duration-300 max-w-full ${
                isFullscreen
                    ? 'fixed inset-0 z-[9999] h-screen w-screen overflow-y-auto p-3 sm:p-5 bg-slate-50 dark:bg-slate-950'
                    : 'min-h-[calc(100vh-4rem)] w-full pb-10'
            }`}
        >
            {/* Top Executive Header */}
            <header className="w-full flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4 p-3.5 sm:px-6 sm:py-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md relative z-20 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                {/* Mobile Top Utility Row (< sm): Live Badge + Open Site Action */}
                <div className="flex sm:hidden items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span className="truncate">tacosgavilan.com</span>
                    </span>

                    <a
                        href="https://tacosgavilan.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold tracking-wide transition-colors shadow-sm shrink-0"
                    >
                        <ExternalLink className="w-3 h-3" />
                        <span>{t('new_website.open_live_site_short')}</span>
                    </a>
                </div>

                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-red-600 to-amber-500 flex items-center justify-center shadow-md shadow-red-500/20 shrink-0 mt-0.5 sm:mt-0">
                            <Globe className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <h1 className="text-sm sm:text-xl font-bold tracking-normal text-slate-900 dark:text-white leading-snug sm:truncate">
                                    {t('new_website.exec_title')}
                                </h1>
                                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 shrink-0">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    tacosgavilan.com
                                </span>
                            </div>
                            <p className="text-[11px] sm:text-xs font-normal text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 sm:line-clamp-1">
                                {t('new_website.exec_subtitle')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right Controls: 3 Responsive Tabs + Desktop Direct Action Button */}
                <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto shrink-0">
                    <div className="grid grid-cols-3 sm:flex items-center w-full sm:w-auto bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 gap-1">
                        <button
                            onClick={() => setActiveTab('analytics')}
                            className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold tracking-normal transition-all min-w-0 ${
                                activeTab === 'analytics'
                                    ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm border border-slate-200/80 dark:border-slate-700'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                            <span className="sm:hidden truncate">{t('new_website.tab_analytics_short')}</span>
                            <span className="hidden sm:inline truncate">{t('new_website.tab_analytics')}</span>
                        </button>

                        <button
                            onClick={() => setActiveTab('messages')}
                            className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold tracking-normal transition-all min-w-0 ${
                                activeTab === 'messages'
                                    ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm border border-slate-200/80 dark:border-slate-700'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Inbox className="w-3.5 h-3.5 shrink-0" />
                            <span className="sm:hidden truncate">{t('new_website.tab_messages_short')}</span>
                            <span className="hidden sm:inline truncate">{t('new_website.tab_messages')}</span>
                            {summary.totalFeedbackCount > 0 && (
                                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0">
                                    {summary.totalFeedbackCount}
                                </span>
                            )}
                        </button>

                        <button
                            onClick={() => setActiveTab('live_site')}
                            className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold tracking-normal transition-all min-w-0 ${
                                activeTab === 'live_site'
                                    ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm border border-slate-200/80 dark:border-slate-700'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Monitor className="w-3.5 h-3.5 shrink-0" />
                            <span className="sm:hidden truncate">{t('new_website.tab_live_site_short')}</span>
                            <span className="hidden sm:inline truncate">{t('new_website.tab_live_site')}</span>
                        </button>
                    </div>

                    <a
                        href="https://tacosgavilan.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold tracking-wide transition-colors shadow-sm shrink-0"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{t('new_website.open_live_site_btn')}</span>
                    </a>
                </div>
            </header>

            {/* =====================================================================
                TAB 1: VISITAS Y ÓRDENES (EXECUTIVE TRAFFIC & ORDERS DASHBOARD)
               ===================================================================== */}
            {activeTab === 'analytics' && (
                <div className="flex-1 py-4 sm:py-5 w-full space-y-4 sm:space-y-6">
                    {/* Period Selector & Refresh Bar */}
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2">
                            {(
                                [
                                    { key: 'today', label: t('new_website.range_today') },
                                    { key: 'yesterday', label: t('new_website.range_yesterday') },
                                    { key: '7d', label: t('new_website.range_7d') },
                                    { key: '30d', label: t('new_website.range_30d') }
                                ] as { key: DateRangeKey; label: string }[]
                            ).map(r => (
                                <button
                                    key={r.key}
                                    onClick={() => setDateRange(r.key)}
                                    className={`px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold tracking-normal transition-all text-center truncate ${
                                        dateRange === r.key
                                            ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 shadow-sm'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                            {analytics?.startDate && (
                                <span className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 font-mono font-medium tracking-wide bg-slate-100 dark:bg-slate-800 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 truncate">
                                    {analytics.startDate === analytics.endDate
                                        ? analytics.startDate
                                        : `${analytics.startDate} → ${analytics.endDate}`}
                                </span>
                            )}
                            <button
                                onClick={() => fetchAnalyticsData(dateRange, true)}
                                disabled={loadingAnalytics}
                                className="flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold tracking-normal text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? 'animate-spin text-red-600 dark:text-amber-400' : ''}`} />
                                <span>{t('new_website.refresh')}</span>
                            </button>
                        </div>
                    </div>

                    {/* 4 Big Executive KPI Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                        {/* KPI 1: Website Visits */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                                <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                    {t('new_website.kpi_visits_title')}
                                </span>
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 flex items-center justify-center shrink-0">
                                    <Users className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-blue-600 dark:text-blue-400" />
                                </div>
                            </div>
                            <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-normal">
                                {summary.totalPageViews.toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-normal">
                                {t('new_website.kpi_visits_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                                <span className="text-slate-500 dark:text-slate-400 font-normal">{t('new_website.kpi_unique_visitors')}:</span>
                                <span className="font-semibold tracking-wide text-blue-600 dark:text-blue-400">{summary.uniqueVisitors.toLocaleString()}</span>
                            </div>
                        </div>

                        {/* KPI 2: Order Online Clicks (100% from tacosgavilan.com) */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                                <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                    {t('new_website.kpi_order_clicks_title')}
                                </span>
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
                                    <MousePointerClick className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-amber-600 dark:text-amber-400" />
                                </div>
                            </div>
                            <div className="text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400 tracking-normal">
                                {summary.totalOrderClicks.toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-normal">
                                {t('new_website.kpi_order_clicks_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-medium">
                                {t('new_website.kpi_phone_dirs_sub', {
                                    storeClicks: Math.max(0, summary.totalOrderClicks - summary.generalSelectorClicks),
                                    generalClicks: summary.generalSelectorClicks
                                })}
                            </div>
                        </div>

                        {/* KPI 3: Order.Online Orders (Pickup vs. Delivery) */}
                        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                                <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                    {t('new_website.kpi_matched_orders_title')}
                                </span>
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
                                    <DollarSign className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-2.5 flex-wrap">
                                <div className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400 tracking-normal">
                                    ${formatCurrency(summary.storefrontOrdersSales)}
                                </div>
                                <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-semibold tracking-wide bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                    {t('new_website.kpi_matched_orders_count_badge', {
                                        count: summary.storefrontOrdersCount
                                    })}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-normal">
                                {t('new_website.kpi_matched_orders_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5 text-xs">
                                <div className="flex-1 min-w-[140px] flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70">
                                    <span className="font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                                        🛍️ {t('new_website.fulfillment_pickup_short')}
                                    </span>
                                    <span className="font-mono font-semibold tracking-wide text-blue-800 dark:text-blue-200 shrink-0">
                                        {summary.pickupOrdersCount} (${formatCurrency(summary.pickupOrdersSales)})
                                    </span>
                                </div>
                                <div className="flex-1 min-w-[140px] flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70">
                                    <span className="font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
                                        🛵 {t('new_website.fulfillment_delivery_short')}
                                    </span>
                                    <span className="font-mono font-semibold tracking-wide text-amber-800 dark:text-amber-200 shrink-0">
                                        {summary.deliveryOrdersCount} (${formatCurrency(summary.deliveryOrdersSales)})
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* KPI 4: Customer Messages, Calls & Directions */}
                        <div
                            onClick={() => setActiveTab('messages')}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-purple-400 dark:hover:border-purple-500 rounded-2xl p-4 sm:p-5 shadow-sm cursor-pointer transition-all"
                        >
                            <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                                <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                                    {t('new_website.kpi_messages_title')}
                                </span>
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 flex items-center justify-center shrink-0">
                                    <Inbox className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-purple-600 dark:text-purple-400" />
                                </div>
                            </div>
                            <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-normal">
                                {summary.totalFeedbackCount.toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-normal">
                                {t('new_website.kpi_messages_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-purple-600 dark:text-purple-400 font-medium">
                                <span>
                                    {t('new_website.kpi_toast_direct_sub', {
                                        phones: summary.totalPhoneClicks,
                                        dirs: summary.totalDirectionsClicks
                                    })}
                                </span>
                                <span>→</span>
                            </div>
                        </div>
                    </div>

                    {/* Simplified Order.Online Orders Table (Pickup vs. Delivery) */}
                    {(() => {
                        const allSfOrders: StorefrontOrderRow[] = analytics?.storefrontOrders || []
                        const filteredSfOrders = allSfOrders.filter(o => {
                            if (orderTypeFilter === 'all') return true
                            return o.fulfillmentType === orderTypeFilter
                        })

                        return (
                            <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50/80 via-white to-white dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900 border-b border-emerald-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <h2 className="text-sm sm:text-base font-bold tracking-normal text-slate-900 dark:text-white flex items-center gap-2">
                                            <ShoppingBag className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <span>{t('new_website.matched_orders_log_title')}</span>
                                        </h2>
                                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 font-normal">
                                            {t('new_website.matched_orders_log_subtitle')}
                                        </p>
                                    </div>

                                    {/* Interactive Filter & Summary Pills: All / Pickup / Delivery */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={() => setOrderTypeFilter('all')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold tracking-wide border transition-all ${
                                                orderTypeFilter === 'all'
                                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            {t('new_website.filter_all_orders')}: {summary.storefrontOrdersCount} (${formatCurrency(summary.storefrontOrdersSales)})
                                        </button>

                                        <button
                                            onClick={() => setOrderTypeFilter('pickup')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold tracking-wide border transition-all ${
                                                orderTypeFilter === 'pickup'
                                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                                    : 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100/80'
                                            }`}
                                        >
                                            🛍️ {t('new_website.fulfillment_pickup_short')}: {summary.pickupOrdersCount} (${formatCurrency(summary.pickupOrdersSales)})
                                        </button>

                                        <button
                                            onClick={() => setOrderTypeFilter('delivery')}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold tracking-wide border transition-all ${
                                                orderTypeFilter === 'delivery'
                                                    ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                                                    : 'bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100/80'
                                            }`}
                                        >
                                            🛵 {t('new_website.fulfillment_delivery_short')}: {summary.deliveryOrdersCount} (${formatCurrency(summary.deliveryOrdersSales)})
                                        </button>
                                    </div>
                                </div>

                                {filteredSfOrders.length === 0 ? (
                                    <div className="p-5 sm:p-6 text-center text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {t('new_website.matched_orders_empty')}
                                    </div>
                                ) : (
                                    <>
                                        {/* Mobile Cards View (< md) */}
                                        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                                            {filteredSfOrders.map(ord => {
                                                const orderTimeStr = new Date(ord.openedDate).toLocaleTimeString(language === 'es' ? 'es-MX' : 'en-US', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    timeZone: 'America/Los_Angeles'
                                                })
                                                const isDelivery = ord.fulfillmentType === 'delivery'

                                                return (
                                                    <div key={ord.orderGuid} className="p-3.5 flex items-center justify-between gap-3">
                                                        <div className="min-w-0 flex-1 space-y-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-mono font-semibold tracking-wide text-xs text-slate-900 dark:text-white">
                                                                    {ord.orderCode}
                                                                </span>
                                                                <span
                                                                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide border ${
                                                                        isDelivery
                                                                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                                                            : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                                                                    }`}
                                                                >
                                                                    {isDelivery
                                                                        ? `🛵 ${t('new_website.fulfillment_delivery_short')}`
                                                                        : `🛍️ ${t('new_website.fulfillment_pickup_short')}`}
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-slate-600 dark:text-slate-300 font-normal truncate">
                                                                <span className="font-semibold text-slate-900 dark:text-white">{ord.storeName}</span>
                                                                {' • '}
                                                                <span>{ord.customerMasked}</span>
                                                                {' • '}
                                                                <span className="font-mono tracking-wide text-slate-500">{orderTimeStr}</span>
                                                            </div>
                                                        </div>
                                                        <div className="font-mono font-semibold tracking-wide text-sm text-emerald-700 dark:text-emerald-400 shrink-0">
                                                            ${formatCurrency(ord.netSales)}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {/* Desktop Table View (md+): 5 Clean, Easy-to-Read Columns */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                        <th className="py-3 px-4">{t('new_website.matched_col_order')}</th>
                                                        <th className="py-3 px-4">{t('new_website.matched_col_store')}</th>
                                                        <th className="py-3 px-4 text-center">{t('new_website.matched_col_type')}</th>
                                                        <th className="py-3 px-4 text-center">{t('new_website.matched_col_order_time')}</th>
                                                        <th className="py-3 px-5 text-right text-emerald-700 dark:text-emerald-400">{t('new_website.matched_col_net_sales')}</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                                    {filteredSfOrders.map(ord => {
                                                        const orderTimeStr = new Date(ord.openedDate).toLocaleTimeString(language === 'es' ? 'es-MX' : 'en-US', {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            timeZone: 'America/Los_Angeles'
                                                        })
                                                        const isDelivery = ord.fulfillmentType === 'delivery'

                                                        return (
                                                            <tr key={ord.orderGuid} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                                <td className="py-3 px-4">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-mono font-semibold tracking-wide text-slate-900 dark:text-white text-xs">
                                                                            {ord.orderCode}
                                                                        </span>
                                                                        <span className="text-slate-400">•</span>
                                                                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                                                                            {ord.customerMasked}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="py-3 px-4 font-semibold tracking-normal text-slate-900 dark:text-white text-sm">
                                                                    {ord.storeName}
                                                                </td>
                                                                <td className="py-3 px-4 text-center">
                                                                    <span
                                                                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold tracking-wide border ${
                                                                            isDelivery
                                                                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                                                                : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                                                                        }`}
                                                                    >
                                                                        {isDelivery
                                                                            ? `🛵 ${t('new_website.fulfillment_delivery')}`
                                                                            : `🛍️ ${t('new_website.fulfillment_pickup')}`}
                                                                    </span>
                                                                </td>
                                                                <td className="py-3 px-4 text-center font-mono font-medium tracking-wide text-slate-700 dark:text-slate-300">
                                                                    {orderTimeStr}
                                                                </td>
                                                                <td className="py-3 px-5 text-right font-mono font-semibold tracking-wide text-sm text-emerald-700 dark:text-emerald-400">
                                                                    ${formatCurrency(ord.netSales)}
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                )}
                            </div>
                        )
                    })()}

                    {/* 15 Stores Breakdown Table (Simplified: Web Visits/Clicks + Pickup vs Delivery order.online) */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-sm sm:text-base font-bold tracking-normal text-slate-900 dark:text-white flex items-center gap-2">
                                    <Store className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-red-600 dark:text-amber-400 shrink-0" />
                                    <span>{t('new_website.store_table_title')}</span>
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-normal">
                                    {t('new_website.store_table_subtitle')}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                <span>{t('new_website.general_selector_clicks_label')}:</span>
                                <span className="font-semibold tracking-wide text-amber-600 dark:text-amber-400">
                                    {summary.generalSelectorClicks.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        {/* Mobile Store Cards View (< md) */}
                        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                            {(analytics?.storeBreakdown || []).map(st => (
                                <div key={st.id} className="p-3.5 space-y-2.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold tracking-normal text-slate-900 dark:text-white text-sm truncate">{st.name}</div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal truncate">
                                                {st.crossStreets} • {st.phone}
                                            </div>
                                        </div>
                                        <a
                                            href={st.toastUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-[11px] font-semibold tracking-wide transition-colors shrink-0"
                                        >
                                            <span>{t('new_website.btn_open_toast')}</span>
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                                                {t('new_website.col_web_activity')}
                                            </div>
                                            <div className="text-xs font-semibold tracking-wide text-slate-800 dark:text-slate-100 mt-0.5 truncate">
                                                {st.webStoreViews} {t('new_website.views_short')} • {st.webOrderClicks} {t('new_website.clicks_short')}
                                            </div>
                                        </div>

                                        <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-200/70 dark:border-emerald-900/50">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 truncate">
                                                {t('new_website.col_total_online_orders')}
                                            </div>
                                            <div className="text-xs font-mono font-semibold tracking-wide text-emerald-700 dark:text-emerald-300 mt-0.5 truncate">
                                                {st.storefrontOrdersCount > 0
                                                    ? `${st.storefrontOrdersCount} ${t('new_website.orders_short_unit')} • $${formatCurrency(st.storefrontOrdersSales)}`
                                                    : '—'}
                                            </div>
                                        </div>

                                        <div className="bg-blue-50/60 dark:bg-blue-950/20 p-2.5 rounded-xl border border-blue-200/70 dark:border-blue-900/50">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400 truncate">
                                                🛍️ {t('new_website.fulfillment_pickup_short')}
                                            </div>
                                            <div className="text-xs font-mono font-semibold tracking-wide text-blue-800 dark:text-blue-200 mt-0.5 truncate">
                                                {st.pickupOrdersCount > 0
                                                    ? `${st.pickupOrdersCount} ${t('new_website.orders_short_unit')} • $${formatCurrency(st.pickupOrdersSales)}`
                                                    : '—'}
                                            </div>
                                        </div>

                                        <div className="bg-amber-50/60 dark:bg-amber-950/20 p-2.5 rounded-xl border border-amber-200/70 dark:border-amber-900/50">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 truncate">
                                                🛵 {t('new_website.fulfillment_delivery_short')}
                                            </div>
                                            <div className="text-xs font-mono font-semibold tracking-wide text-amber-800 dark:text-amber-200 mt-0.5 truncate">
                                                {st.deliveryOrdersCount > 0
                                                    ? `${st.deliveryOrdersCount} ${t('new_website.orders_short_unit')} • $${formatCurrency(st.deliveryOrdersSales)}`
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop Table View (md+): 6 Clean, Scannable Columns */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        <th className="py-3.5 px-4">{t('new_website.col_store_name')}</th>
                                        <th className="py-3.5 px-3 text-center">{t('new_website.col_web_activity')}</th>
                                        <th className="py-3.5 px-3 text-center text-blue-700 dark:text-blue-400">🛍️ {t('new_website.col_pickup_orders')}</th>
                                        <th className="py-3.5 px-3 text-center text-amber-700 dark:text-amber-400">🛵 {t('new_website.col_delivery_orders')}</th>
                                        <th className="py-3.5 px-3 text-center text-emerald-700 dark:text-emerald-400">{t('new_website.col_total_online_orders')}</th>
                                        <th className="py-3.5 px-4 text-center">{t('new_website.col_open_order')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {(analytics?.storeBreakdown || []).map(st => {
                                        return (
                                            <tr key={st.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                <td className="py-3 px-4">
                                                    <div className="font-semibold tracking-normal text-slate-900 dark:text-white text-sm">{st.name}</div>
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                                                        {st.crossStreets} • {st.phone}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <div className="inline-flex items-center gap-2 text-xs">
                                                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                                                            {st.webStoreViews.toLocaleString()} {t('new_website.views_short')}
                                                        </span>
                                                        <span className="text-slate-300 dark:text-slate-600">•</span>
                                                        <span
                                                            className={`px-2 py-0.5 rounded-md font-semibold tracking-wide ${
                                                                st.webOrderClicks > 0
                                                                    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                                                                    : 'text-slate-400 dark:text-slate-500'
                                                            }`}
                                                        >
                                                            {st.webOrderClicks.toLocaleString()} {t('new_website.clicks_short')}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3 text-center font-mono">
                                                    {st.pickupOrdersCount > 0 ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold tracking-wide text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                            <span>{st.pickupOrdersCount} {t('new_website.orders_short_unit')}</span>
                                                            <span>•</span>
                                                            <span>${formatCurrency(st.pickupOrdersSales)}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-700">—</span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-3 text-center font-mono">
                                                    {st.deliveryOrdersCount > 0 ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold tracking-wide text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                            <span>{st.deliveryOrdersCount} {t('new_website.orders_short_unit')}</span>
                                                            <span>•</span>
                                                            <span>${formatCurrency(st.deliveryOrdersSales)}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-700">—</span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-3 text-center font-mono">
                                                    {st.storefrontOrdersCount > 0 ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold tracking-wide text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                                            <span>{st.storefrontOrdersCount} {t('new_website.orders_short_unit')}</span>
                                                            <span>•</span>
                                                            <span>${formatCurrency(st.storefrontOrdersSales)}</span>
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-700">—</span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-center">
                                                    <a
                                                        href={st.toastUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-[11px] font-semibold tracking-wide transition-colors"
                                                    >
                                                        <span>{t('new_website.btn_open_toast')}</span>
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-50 dark:bg-slate-800/90 border-t-2 border-slate-200 dark:border-slate-700 text-xs font-semibold tracking-wide">
                                        <td className="py-3.5 px-4 text-slate-900 dark:text-white">
                                            {t('new_website.totals_row_label')}
                                        </td>
                                        <td className="py-3.5 px-3 text-center text-slate-700 dark:text-slate-200">
                                            {summary.totalOrderClicks.toLocaleString()} {t('new_website.clicks_short')}
                                        </td>
                                        <td className="py-3.5 px-3 text-center font-mono text-blue-700 dark:text-blue-300">
                                            {summary.pickupOrdersCount} {t('new_website.orders_short_unit')} • ${formatCurrency(summary.pickupOrdersSales)}
                                        </td>
                                        <td className="py-3.5 px-3 text-center font-mono text-amber-700 dark:text-amber-300">
                                            {summary.deliveryOrdersCount} {t('new_website.orders_short_unit')} • ${formatCurrency(summary.deliveryOrdersSales)}
                                        </td>
                                        <td className="py-3.5 px-3 text-center font-mono text-emerald-700 dark:text-emerald-400">
                                            {summary.storefrontOrdersCount} {t('new_website.orders_short_unit')} • ${formatCurrency(summary.storefrontOrdersSales)}
                                        </td>
                                        <td className="py-3.5 px-4 text-center text-slate-400">—</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* 3 Bottom Insight Cards: Top Pages, Visitor Profile, Live Activity Feed */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
                        {/* 1. Most Visited Pages */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col shadow-sm">
                            <h3 className="text-sm font-bold tracking-normal text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                                <span>{t('new_website.top_pages_title')}</span>
                            </h3>
                            {(analytics?.topPages || []).length === 0 ? (
                                <div className="text-xs text-slate-400 py-8 text-center font-normal">
                                    {t('new_website.top_pages_empty')}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {(analytics?.topPages || []).map(tp => (
                                        <div key={tp.path} className="space-y-1">
                                            <div className="flex items-center justify-between gap-2 text-xs">
                                                <span className="font-medium text-slate-700 dark:text-slate-200 truncate min-w-0 flex-1">
                                                    {getFriendlyPageLabel(tp.path, language)}
                                                </span>
                                                <span className="font-semibold tracking-wide text-amber-600 dark:text-amber-400 shrink-0">
                                                    {tp.views} ({tp.pct}%)
                                                </span>
                                            </div>
                                            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-red-600 to-amber-500"
                                                    style={{ width: `${Math.max(tp.pct, 4)}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* 2. Visitor Profile (Devices & Languages) */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-5 shadow-sm">
                            <div>
                                <h3 className="text-sm font-bold tracking-normal text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                    <Languages className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                                    <span>{t('new_website.audience_title')}</span>
                                </h3>

                                <div className="space-y-3">
                                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                                                {t('new_website.device_mobile')}
                                            </span>
                                        </div>
                                        <span className="text-xs sm:text-sm font-semibold tracking-wide text-emerald-600 dark:text-emerald-400 shrink-0">
                                            {analytics?.deviceBreakdown.mobile || 0} ({mobilePct}%)
                                        </span>
                                    </div>

                                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <Monitor className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                                            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                                                {t('new_website.device_desktop')}
                                            </span>
                                        </div>
                                        <span className="text-xs sm:text-sm font-semibold tracking-wide text-blue-600 dark:text-blue-400 shrink-0">
                                            {analytics?.deviceBreakdown.desktop || 0} ({desktopPct}%)
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 pt-2">
                                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 sm:p-3 text-center">
                                            <div className="text-[11px] font-semibold tracking-wider text-amber-700 dark:text-amber-300 uppercase">
                                                {t('new_website.lang_es')}
                                            </div>
                                            <div className="text-lg sm:text-xl font-bold tracking-normal text-slate-900 dark:text-white mt-1">
                                                {analytics?.langBreakdown.es || 0} ({esPct}%)
                                            </div>
                                        </div>
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-2.5 sm:p-3 text-center">
                                            <div className="text-[11px] font-semibold tracking-wider text-blue-700 dark:text-blue-300 uppercase">
                                                {t('new_website.lang_en')}
                                            </div>
                                            <div className="text-lg sm:text-xl font-bold tracking-normal text-slate-900 dark:text-white mt-1">
                                                {analytics?.langBreakdown.en || 0} ({enPct}%)
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Quick Links to Live Pages */}
                            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                                    {t('new_website.quick_links_title')}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { href: 'https://tacosgavilan.com/', label: t('new_website.link_home') },
                                        { href: 'https://tacosgavilan.com/menu/', label: t('new_website.link_menu') },
                                        { href: 'https://tacosgavilan.com/locations/', label: t('new_website.link_locations') },
                                        { href: 'https://tacosgavilan.com/fiesta-platter/', label: t('new_website.link_fiesta') },
                                        { href: 'https://tacosgavilan.com/careers/', label: t('new_website.link_careers') },
                                        { href: 'https://tacosgavilan.com/privacy/', label: t('new_website.link_privacy') }
                                    ].map(l => (
                                        <a
                                            key={l.href}
                                            href={l.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-medium tracking-normal text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                                        >
                                            <span>{l.label}</span>
                                            <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* 3. Live Real-Time Activity Feed */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col shadow-sm">
                            <h3 className="text-sm font-bold tracking-normal text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                                <span>{t('new_website.live_feed_title')}</span>
                            </h3>
                            {(analytics?.recentEvents || []).length === 0 ? (
                                <div className="text-xs text-slate-400 py-8 text-center font-normal">
                                    {t('new_website.live_feed_empty')}
                                </div>
                            ) : (
                                <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                                    {(analytics?.recentEvents || []).map(ev => {
                                        const isOrder = ev.action === 'website_order_click' && ev.platform === 'toast'
                                        const isPhone = ev.action === 'website_order_click' && ev.platform === 'phone'
                                        const isDirs = ev.action === 'website_order_click' && ev.platform === 'directions'

                                        let label = t('new_website.event_page_view')
                                        let badgeClass = 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                                        if (isOrder) {
                                            label = t('new_website.event_order_click')
                                            badgeClass = 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                        } else if (isPhone) {
                                            label = t('new_website.event_phone_click')
                                            badgeClass = 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                        } else if (isDirs) {
                                            label = t('new_website.event_directions_click')
                                            badgeClass = 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                                        }

                                        return (
                                            <div
                                                key={ev.id}
                                                className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs"
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide border ${badgeClass}`}>
                                                            {label}
                                                        </span>
                                                        {ev.store_name && (
                                                            <span className="font-semibold tracking-normal text-slate-900 dark:text-white truncate">
                                                                {ev.store_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate font-normal">
                                                        {getFriendlyPageLabel(ev.page_path, language)} • {ev.device_type.toUpperCase()} • {ev.lang.toUpperCase()}
                                                    </div>
                                                </div>
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-mono font-medium tracking-wide">
                                                    {ev.created_at
                                                        ? new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                                        : ''}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* =====================================================================
                TAB 2: MENSAJES DE CLIENTES (GUEST INQUIRIES & CATERING LEADS)
               ===================================================================== */}
            {activeTab === 'messages' && (
                <div className="flex-1 overflow-y-auto py-4 sm:py-5 w-full space-y-4 sm:space-y-6">
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 sm:gap-4 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div>
                            <h2 className="text-base sm:text-lg font-bold tracking-normal text-slate-900 dark:text-white flex items-center gap-2">
                                <Inbox className="w-5 h-5 text-red-600 dark:text-amber-400 shrink-0" />
                                <span>{t('new_website.feedback_title')}</span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-normal">
                                {t('new_website.feedback_subtitle')}
                            </p>
                        </div>
                        <button
                            onClick={() => fetchAnalyticsData(dateRange)}
                            className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold tracking-normal transition-colors shrink-0"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? 'animate-spin' : ''}`} />
                            <span>{t('new_website.refresh')}</span>
                        </button>
                    </div>

                    {/* Filter Pills (Swipeable horizontal bar on mobile, wrapped on sm+) */}
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1 sm:flex-wrap sm:overflow-visible">
                        {[
                            { key: 'all', label: t('new_website.filter_all') },
                            { key: 'catering', label: t('new_website.filter_catering') },
                            { key: 'feedback', label: t('new_website.filter_feedback') },
                            { key: 'newsletter', label: t('new_website.filter_newsletter') },
                            { key: 'accessibility', label: t('new_website.filter_accessibility') }
                        ].map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFeedbackFilter(f.key)}
                                className={`px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-normal transition-all border shrink-0 ${
                                    feedbackFilter === f.key
                                        ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 border-slate-900 dark:border-amber-400 shadow-sm'
                                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-800'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {filteredFeedback.length === 0 ? (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-12 text-center space-y-2 shadow-sm">
                            <Inbox className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('new_website.empty_category_title')}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t('new_website.empty_category_desc')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
                            {filteredFeedback.map((item: any) => (
                                <div
                                    key={item.id}
                                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3 hover:border-amber-400 dark:hover:border-amber-500/50 transition-all shadow-sm"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700 mb-1.5">
                                                {item.complaint_type || 'general'}
                                            </span>
                                            <h3 className="text-sm font-semibold tracking-normal text-slate-900 dark:text-white break-words">
                                                {item.customer_name || t('new_website.anonymous_customer')}
                                            </h3>
                                        </div>
                                        <span className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1 font-normal shrink-0">
                                            <Clock className="w-3 h-3" />
                                            {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-2.5 sm:gap-3 text-xs text-slate-600 dark:text-slate-300 font-medium">
                                        {item.customer_email && (
                                            <a
                                                href={`mailto:${item.customer_email}`}
                                                className="inline-flex items-center gap-1 text-red-600 dark:text-amber-400 hover:underline break-all"
                                            >
                                                <Mail className="w-3.5 h-3.5 shrink-0" />
                                                <span>{item.customer_email}</span>
                                            </a>
                                        )}
                                        {item.customer_phone && (
                                            <a
                                                href={`tel:${item.customer_phone}`}
                                                className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline"
                                            >
                                                <Phone className="w-3.5 h-3.5 shrink-0" />
                                                <span>{item.customer_phone}</span>
                                            </a>
                                        )}
                                        {item.store_name && (
                                            <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-semibold">
                                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                                <span>{item.store_name}</span>
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/70 p-3 sm:p-3.5 rounded-xl border border-slate-200/70 dark:border-slate-800 whitespace-pre-line break-words leading-relaxed font-normal">
                                        {item.comments || t('new_website.no_comments')}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* =====================================================================
                TAB 3: VER SITIO WEB EN VIVO (CLEAN INTERACTIVE PREVIEW)
               ===================================================================== */}
            {activeTab === 'live_site' && (() => {
                const isNarrowPhone = stageWidth > 0 && stageWidth < 430
                const tabletScale = stageWidth > 0 && stageWidth < 820 ? Math.max(0.32, (stageWidth - 16) / 802) : 1
                const desktopScale = stageWidth > 0 && stageWidth < 1024 ? Math.max(0.22, (stageWidth - 8) / 1280) : 1

                const activeScale =
                    viewport === 'tablet'
                        ? tabletScale
                        : viewport === 'desktop' && stageWidth > 0 && stageWidth < 1024
                        ? desktopScale
                        : 1

                const unscaledFrameHeight =
                    viewport === 'tablet'
                        ? 876
                        : viewport === 'desktop' && stageWidth > 0 && stageWidth < 1024
                        ? 800
                        : 0

                const scaledContainerHeight =
                    activeScale < 1 && unscaledFrameHeight > 0
                        ? Math.round(unscaledFrameHeight * activeScale) + 12
                        : undefined

                return (
                    <div className="flex-1 flex flex-col overflow-hidden py-4 sm:py-5 w-full space-y-3 sm:space-y-4">
                        {/* Sub-toolbar with Device Switcher & Brochure Download */}
                        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 p-3 sm:px-6 sm:py-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="grid grid-cols-3 sm:flex items-center gap-1 sm:gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 w-full sm:w-auto">
                                <button
                                    onClick={() => setViewport('desktop')}
                                    className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold tracking-normal transition-all min-w-0 ${
                                        viewport === 'desktop'
                                            ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <Monitor className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{t('new_website.view_desktop')}</span>
                                </button>
                                <button
                                    onClick={() => setViewport('tablet')}
                                    className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold tracking-normal transition-all min-w-0 ${
                                        viewport === 'tablet'
                                            ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <Tablet className="w-3.5 h-3.5 shrink-0" />
                                    <span className="sm:hidden truncate">{t('new_website.view_tablet_short')}</span>
                                    <span className="hidden sm:inline truncate">{t('new_website.view_tablet')}</span>
                                </button>
                                <button
                                    onClick={() => setViewport('mobile')}
                                    className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold tracking-normal transition-all min-w-0 ${
                                        viewport === 'mobile'
                                            ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <Smartphone className="w-3.5 h-3.5 shrink-0" />
                                    <span className="sm:hidden truncate">{t('new_website.view_mobile_short')}</span>
                                    <span className="hidden sm:inline truncate">{t('new_website.view_mobile')}</span>
                                </button>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                                <a
                                    href="https://tacosgavilan.com/docs/Tacos-Gavilan-Fiesta-Platter-Brochure.pdf"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700 text-xs font-semibold tracking-normal transition-colors min-w-0"
                                >
                                    <FileText className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{t('new_website.download_brochure')}</span>
                                </a>

                                <button
                                    onClick={handleReloadPreview}
                                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
                                    title={t('new_website.reload')}
                                >
                                    <RefreshCw className={`w-4 h-4 ${iframeLoading ? 'animate-spin text-red-600 dark:text-amber-400' : ''}`} />
                                </button>

                                <button
                                    onClick={() => setIsFullscreen(prev => !prev)}
                                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors shrink-0"
                                    title={isFullscreen ? t('new_website.exit_fullscreen') : t('new_website.fullscreen')}
                                >
                                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {/* Iframe Viewport & Hardware Device Simulator Stage */}
                        <div
                            ref={stageRef}
                            className={`relative flex-1 flex flex-col items-center justify-start w-full transition-all duration-300 overflow-hidden ${
                                viewport !== 'desktop'
                                    ? 'bg-slate-200/70 dark:bg-slate-900/70 rounded-2xl border border-slate-200 dark:border-slate-800 py-3 sm:py-6 px-2 sm:px-6 shadow-inner'
                                    : 'bg-transparent'
                            }`}
                        >
                            {iframeLoading && (
                                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm rounded-2xl">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-amber-500 flex items-center justify-center shadow-xl shadow-red-600/30 animate-bounce mb-3">
                                        <Globe className="w-6 h-6 text-white" />
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('new_website.loading_preview')}</p>
                                </div>
                            )}

                            {/* Active Device Dimension Badge when in Tablet or Mobile Simulator */}
                            {viewport !== 'desktop' && (
                                <div className="mb-2.5 sm:mb-3 inline-flex items-center gap-2 px-3 sm:px-3.5 py-1 rounded-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 shadow-sm text-[11px] font-semibold tracking-wide text-slate-700 dark:text-slate-300 max-w-full">
                                    {viewport === 'tablet' ? (
                                        <>
                                            <Tablet className="w-3.5 h-3.5 text-red-600 dark:text-amber-400 shrink-0" />
                                            <span className="truncate">
                                                iPad Air · 768 × 1024 px{tabletScale < 1 ? ` (${Math.round(tabletScale * 100)}%)` : ''}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <Smartphone className="w-3.5 h-3.5 text-red-600 dark:text-amber-400 shrink-0" />
                                            <span className="truncate">
                                                {isNarrowPhone ? t('new_website.native_mobile_view') : 'iPhone 15 Pro · 390 × 844 px'}
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Responsive Scale Wrapper for Tablet/Desktop on small screens */}
                            <div
                                className="w-full flex flex-col items-center justify-start overflow-hidden"
                                style={{
                                    height: scaledContainerHeight ? `${scaledContainerHeight}px` : undefined
                                }}
                            >
                                {/* Unified Hardware Frame + Single Persistent Iframe (Zero Reload on Device Switch) */}
                                <div
                                    className={`relative transition-all duration-300 ease-out flex flex-col items-center shrink-0 ${
                                        viewport === 'desktop'
                                            ? stageWidth > 0 && stageWidth < 1024
                                                ? 'w-[1280px]'
                                                : 'w-full'
                                            : viewport === 'tablet'
                                            ? 'bg-slate-900 p-3.5 rounded-[38px] border-[3px] border-slate-700 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.55)]'
                                            : isNarrowPhone
                                            ? 'w-full bg-slate-950 p-1.5 rounded-[28px] border-2 border-slate-700 shadow-xl'
                                            : 'bg-slate-950 p-3 rounded-[50px] border-[3px] border-slate-700 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)]'
                                    }`}
                                    style={{
                                        transform: activeScale < 1 ? `scale(${activeScale})` : undefined,
                                        transformOrigin: activeScale < 1 ? 'top center' : undefined
                                    }}
                                >
                                    {/* Hardware Side Buttons for Tablet */}
                                    {viewport === 'tablet' && (
                                        <>
                                            <div className="absolute -right-[5px] top-16 w-[3px] h-12 bg-slate-600 rounded-r-md" />
                                            <div className="absolute -right-[5px] top-32 w-[3px] h-12 bg-slate-600 rounded-r-md" />
                                            <div className="w-full flex items-center justify-center pb-2">
                                                <div className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                                                    <div className="w-1 h-1 rounded-full bg-blue-500/60" />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* Hardware Side Buttons for Mobile (iPhone 15 Pro - hidden on narrow phone so frame fits 100%) */}
                                    {viewport === 'mobile' && !isNarrowPhone && (
                                        <>
                                            <div className="absolute -left-[5px] top-24 w-[3px] h-7 bg-slate-600 rounded-l-md" />
                                            <div className="absolute -left-[5px] top-36 w-[3px] h-12 bg-slate-600 rounded-l-md" />
                                            <div className="absolute -left-[5px] top-52 w-[3px] h-12 bg-slate-600 rounded-l-md" />
                                            <div className="absolute -right-[5px] top-40 w-[3px] h-16 bg-slate-600 rounded-r-md" />
                                        </>
                                    )}

                                    {/* Inner Screen Container */}
                                    <div
                                        className={`relative overflow-hidden bg-slate-950 flex flex-col transition-all duration-300 ease-out ${
                                            viewport === 'desktop'
                                                ? 'w-full rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl'
                                                : viewport === 'tablet'
                                                ? 'rounded-[22px] border border-slate-800'
                                                : isNarrowPhone
                                                ? 'w-full rounded-[22px] border border-slate-800'
                                                : 'rounded-[38px] border border-slate-800'
                                        }`}
                                        style={{
                                            width:
                                                viewport === 'desktop'
                                                    ? stageWidth > 0 && stageWidth < 1024
                                                        ? '1280px'
                                                        : '100%'
                                                    : viewport === 'tablet'
                                                    ? '768px'
                                                    : isNarrowPhone
                                                    ? '100%'
                                                    : '390px',
                                            height:
                                                viewport === 'desktop'
                                                    ? stageWidth > 0 && stageWidth < 1024
                                                        ? '800px'
                                                        : isFullscreen
                                                        ? 'calc(100vh - 105px)'
                                                        : 'calc(100vh - 165px)'
                                                    : viewport === 'tablet'
                                                    ? isFullscreen && tabletScale === 1
                                                        ? 'calc(100vh - 190px)'
                                                        : '820px'
                                                    : isNarrowPhone
                                                    ? isFullscreen
                                                        ? 'calc(100dvh - 160px)'
                                                        : 'calc(100dvh - 250px)'
                                                    : isFullscreen
                                                    ? 'calc(100vh - 180px)'
                                                    : '780px',
                                            minHeight:
                                                viewport === 'desktop' && (stageWidth === 0 || stageWidth >= 1024)
                                                    ? '680px'
                                                    : isNarrowPhone && viewport === 'mobile'
                                                    ? '520px'
                                                    : undefined
                                        }}
                                    >
                                        {/* iPadOS Top Status Bar */}
                                        {viewport === 'tablet' && (
                                            <div className="h-6 bg-black text-white px-5 flex items-center justify-between text-[11px] font-medium select-none shrink-0 border-b border-white/5">
                                                <span>9:41 AM &nbsp;·&nbsp; Fri Oct 16</span>
                                                <div className="flex items-center gap-2 text-[10px] text-white/90">
                                                    <span>5G</span>
                                                    <span>Wi-Fi</span>
                                                    <span>100%</span>
                                                    <div className="w-5 h-2.5 rounded-sm border border-white/80 p-0.5 flex items-center">
                                                        <div className="w-full h-full bg-emerald-400 rounded-[1px]" />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* iOS Top Status Bar + Dynamic Island */}
                                        {viewport === 'mobile' && (
                                            <div className="h-8 sm:h-9 bg-black text-white px-4 sm:px-6 flex items-center justify-between text-xs font-semibold select-none shrink-0 border-b border-white/5">
                                                <span className="tracking-normal">9:41</span>
                                                <div className="w-20 sm:w-24 h-4.5 sm:h-5 bg-zinc-900 border border-zinc-800 rounded-full flex items-center justify-end px-2">
                                                    <div className="w-2 h-2 rounded-full bg-indigo-950 border border-indigo-500/40" />
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                    <span>5G</span>
                                                    <div className="w-5 h-2.5 rounded-sm border border-white/80 p-0.5 flex items-center">
                                                        <div className="w-full h-full bg-emerald-400 rounded-[1px]" />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <iframe
                                            key={refreshKey}
                                            ref={iframeRef}
                                            src={previewUrl}
                                            title="Tacos Gavilan Official Website"
                                            className="w-full flex-1 border-0 bg-slate-950"
                                            onLoad={() => setIframeLoading(false)}
                                        />
                                    </div>

                                    {/* Bottom Home Indicator Pill for Tablet & Mobile */}
                                    {viewport !== 'desktop' && (
                                        <div className="pt-2 pb-0.5 flex items-center justify-center w-full">
                                            <div className="w-28 sm:w-32 h-1 rounded-full bg-slate-600" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })()}
        </div>
    )
}

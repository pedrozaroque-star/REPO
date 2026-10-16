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
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
    ArrowLeft,
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
    toastDirectSales: number
    doordashSales: number
    uberSales: number
    grubhubSales: number
    totalDigitalSales: number
    netSales: number
    orderCount: number
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
        toastDirectSales: number
        uberSales: number
        doordashSales: number
        grubhubSales: number
        totalDigitalSales: number
        totalNetSales: number
        totalOrdersCount: number
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
    const router = useRouter()
    const { t, language } = useLanguage()
    const iframeRef = useRef<HTMLIFrameElement>(null)

    const [activeTab, setActiveTab] = useState<ActiveTab>('analytics')
    const [dateRange, setDateRange] = useState<DateRangeKey>('today')
    const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
    const [loadingAnalytics, setLoadingAnalytics] = useState<boolean>(true)
    const [feedbackFilter, setFeedbackFilter] = useState<string>('all')

    // Live site preview state
    const [viewport, setViewport] = useState<ViewportMode>('desktop')
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
    const [iframeLoading, setIframeLoading] = useState<boolean>(true)
    const [refreshKey, setRefreshKey] = useState<number>(0)

    const previewUrl = `/api/web-preview?v=${refreshKey}`

    const fetchAnalyticsData = useCallback(async (selectedRange: DateRangeKey) => {
        setLoadingAnalytics(true)
        try {
            const res = await fetch(`/api/web-preview?action=analytics&range=${selectedRange}`, {
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
        toastDirectSales: 0,
        uberSales: 0,
        doordashSales: 0,
        grubhubSales: 0,
        totalDigitalSales: 0,
        totalNetSales: 0,
        totalOrdersCount: 0,
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

    const getViewportWidth = () => {
        if (viewport === 'mobile') return 'max-w-[412px]'
        if (viewport === 'tablet') return 'max-w-[820px]'
        return 'w-full'
    }

    return (
        <div
            className={`flex flex-col bg-transparent text-slate-900 dark:text-white font-sans transition-all duration-300 ${
                isFullscreen
                    ? 'fixed inset-0 z-[9999] h-screen w-screen bg-slate-50 dark:bg-slate-950'
                    : 'min-h-[calc(100vh-4rem)] w-full pb-10'
            }`}
        >
            {/* Top Executive Header */}
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
                <div className="flex items-center gap-3">
                    {!isFullscreen && (
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors border border-slate-200 dark:border-slate-700"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>{t('new_website.back_to_teg')}</span>
                        </button>
                    )}

                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-amber-500 flex items-center justify-center shadow-md shadow-red-500/20">
                            <Globe className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <h1 className="text-base sm:text-xl font-black tracking-tight text-slate-900 dark:text-white">
                                    {t('new_website.exec_title')}
                                </h1>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    tacosgavilan.com
                                </span>
                            </div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 hidden sm:block mt-0.5">
                                {t('new_website.exec_subtitle')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Main 3 Clean Tabs */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                        onClick={() => setActiveTab('analytics')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'analytics'
                                ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm border border-slate-200/80 dark:border-slate-700'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>{t('new_website.tab_analytics')}</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('messages')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'messages'
                                ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm border border-slate-200/80 dark:border-slate-700'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Inbox className="w-3.5 h-3.5" />
                        <span>{t('new_website.tab_messages')}</span>
                        {summary.totalFeedbackCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                {summary.totalFeedbackCount}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => setActiveTab('live_site')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            activeTab === 'live_site'
                                ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm border border-slate-200/80 dark:border-slate-700'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Monitor className="w-3.5 h-3.5" />
                        <span>{t('new_website.tab_live_site')}</span>
                    </button>
                </div>

                {/* Direct Action Button to Live Public Website */}
                <div className="flex items-center gap-2">
                    <a
                        href="https://tacosgavilan.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
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
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
                    {/* Period Selector & Refresh Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2">
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
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                        dateRange === r.key
                                            ? 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 shadow-sm'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-3">
                            {analytics?.startDate && (
                                <span className="text-xs text-slate-600 dark:text-slate-300 font-mono font-semibold bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                    {analytics.startDate === analytics.endDate
                                        ? analytics.startDate
                                        : `${analytics.startDate} → ${analytics.endDate}`}
                                </span>
                            )}
                            <button
                                onClick={() => fetchAnalyticsData(dateRange)}
                                disabled={loadingAnalytics}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? 'animate-spin text-red-600 dark:text-amber-400' : ''}`} />
                                <span>{t('new_website.refresh')}</span>
                            </button>
                        </div>
                    </div>

                    {/* 4 Big Executive KPI Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* KPI 1: Website Visits */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                    {t('new_website.kpi_visits_title')}
                                </span>
                                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 flex items-center justify-center">
                                    <Users className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
                                </div>
                            </div>
                            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                                {summary.totalPageViews.toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                {t('new_website.kpi_visits_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">{t('new_website.kpi_unique_visitors')}:</span>
                                <span className="font-black text-blue-600 dark:text-blue-400">{summary.uniqueVisitors.toLocaleString()}</span>
                            </div>
                        </div>

                        {/* KPI 2: Order Online Clicks (100% from tacosgavilan.com) */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                    {t('new_website.kpi_order_clicks_title')}
                                </span>
                                <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 flex items-center justify-center">
                                    <MousePointerClick className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
                                </div>
                            </div>
                            <div className="text-3xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
                                {summary.totalOrderClicks.toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                {t('new_website.kpi_order_clicks_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                                {t('new_website.kpi_phone_dirs_sub', {
                                    storeClicks: Math.max(0, summary.totalOrderClicks - summary.generalSelectorClicks),
                                    generalClicks: summary.generalSelectorClicks
                                })}
                            </div>
                        </div>

                        {/* KPI 3: Phone Calls & Map Directions (100% from tacosgavilan.com) */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                    {t('new_website.kpi_digital_sales_title')}
                                </span>
                                <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center">
                                    <Navigation className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                            </div>
                            <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                                {(summary.totalPhoneClicks + summary.totalDirectionsClicks).toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                {t('new_website.kpi_digital_sales_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                                <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                                    {t('new_website.kpi_toast_direct_sub', {
                                        phones: summary.totalPhoneClicks,
                                        dirs: summary.totalDirectionsClicks
                                    })}
                                </span>
                            </div>
                        </div>

                        {/* KPI 4: Customer Messages & Catering Leads */}
                        <div
                            onClick={() => setActiveTab('messages')}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-purple-400 dark:hover:border-purple-500 rounded-2xl p-5 shadow-sm cursor-pointer transition-all"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">
                                    {t('new_website.kpi_messages_title')}
                                </span>
                                <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 flex items-center justify-center">
                                    <Inbox className="w-4.5 h-4.5 text-purple-600 dark:text-purple-400" />
                                </div>
                            </div>
                            <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                                {summary.totalFeedbackCount.toLocaleString()}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                {t('new_website.kpi_messages_sub')}
                            </p>
                            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-purple-600 dark:text-purple-400 font-bold">
                                <span>{t('new_website.tab_messages')} →</span>
                            </div>
                        </div>
                    </div>

                    {/* General Selector Banner */}
                    <div className="bg-gradient-to-r from-amber-50 via-orange-50/60 to-white dark:from-amber-950/30 dark:via-slate-900 dark:to-slate-900 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 flex items-center justify-center shrink-0 mt-0.5">
                                <ShoppingBag className="w-5 h-5 text-amber-700 dark:text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                                    {t('new_website.general_selector_banner_title')}
                                </h3>
                                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 max-w-3xl font-medium">
                                    {t('new_website.general_selector_banner_desc')}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 bg-white dark:bg-slate-800 px-4 py-2.5 rounded-xl border border-amber-200 dark:border-amber-700 shadow-sm">
                            <span className="text-xs text-slate-600 dark:text-slate-300 font-bold">
                                {t('new_website.general_selector_clicks_label')}:
                            </span>
                            <span className="text-xl font-black text-amber-600 dark:text-amber-400">
                                {summary.generalSelectorClicks.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    {/* 15 Stores Breakdown Table (100% Originated on tacosgavilan.com) */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                                    <Store className="w-5 h-5 text-red-600 dark:text-amber-400" />
                                    <span>{t('new_website.store_table_title')}</span>
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                                    {t('new_website.store_table_subtitle')}
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        <th className="py-3.5 px-4">{t('new_website.col_store_name')}</th>
                                        <th className="py-3.5 px-3 text-center">{t('new_website.col_web_views')}</th>
                                        <th className="py-3.5 px-3 text-center text-amber-700 dark:text-amber-400">{t('new_website.col_order_clicks')}</th>
                                        <th className="py-3.5 px-3 text-center">{t('new_website.col_calls_maps')}</th>
                                        <th className="py-3.5 px-3 text-center">{t('new_website.col_toast_direct')}</th>
                                        <th className="py-3.5 px-4 text-center text-slate-900 dark:text-white">{t('new_website.col_delivery_apps')}</th>
                                        <th className="py-3.5 px-4 text-center">{t('new_website.col_open_order')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {(analytics?.storeBreakdown || []).map(st => {
                                        const totalWebActions =
                                            st.webStoreViews + st.webOrderClicks + st.webPhoneClicks + st.webDirectionsClicks
                                        return (
                                            <tr key={st.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                <td className="py-3.5 px-4">
                                                    <div className="font-black text-slate-900 dark:text-white text-sm">{st.name}</div>
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                                        {st.crossStreets} • {st.phone}
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300">
                                                    {st.webStoreViews.toLocaleString()}
                                                </td>
                                                <td className="py-3.5 px-3 text-center">
                                                    <span
                                                        className={`inline-flex items-center justify-center min-w-[2.25rem] px-2.5 py-1 rounded-lg font-black text-xs ${
                                                            st.webOrderClicks > 0
                                                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                                        }`}
                                                    >
                                                        {st.webOrderClicks.toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-3 text-center text-slate-600 dark:text-slate-300 font-semibold">
                                                    <span className="inline-flex items-center gap-1 text-xs">
                                                        <Phone className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                                        <span>{st.webPhoneClicks.toLocaleString()}</span>
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-3 text-center text-slate-600 dark:text-slate-300 font-semibold">
                                                    <span className="inline-flex items-center gap-1 text-xs">
                                                        <Navigation className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                        <span>{st.webDirectionsClicks.toLocaleString()}</span>
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-center font-mono font-black text-sm text-slate-900 dark:text-white">
                                                    {totalWebActions.toLocaleString()}
                                                </td>
                                                <td className="py-3.5 px-4 text-center">
                                                    <a
                                                        href={st.toastUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-[11px] font-bold transition-colors"
                                                    >
                                                        <span>{t('new_website.btn_open_toast')}</span>
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* 3 Bottom Insight Cards: Top Pages, Visitor Profile, Live Activity Feed */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        {/* 1. Most Visited Pages */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col shadow-sm">
                            <h3 className="text-sm font-black text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-500" />
                                <span>{t('new_website.top_pages_title')}</span>
                            </h3>
                            {(analytics?.topPages || []).length === 0 ? (
                                <div className="text-xs text-slate-400 py-8 text-center font-medium">
                                    {t('new_website.top_pages_empty')}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {(analytics?.topPages || []).map(tp => (
                                        <div key={tp.path} className="space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-bold text-slate-700 dark:text-slate-200 truncate max-w-[210px]">
                                                    {getFriendlyPageLabel(tp.path, language)}
                                                </span>
                                                <span className="font-black text-amber-600 dark:text-amber-400">
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
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-5 shadow-sm">
                            <div>
                                <h3 className="text-sm font-black text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                    <Languages className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    <span>{t('new_website.audience_title')}</span>
                                </h3>

                                <div className="space-y-3">
                                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                {t('new_website.device_mobile')}
                                            </span>
                                        </div>
                                        <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                                            {analytics?.deviceBreakdown.mobile || 0} ({mobilePct}%)
                                        </span>
                                    </div>

                                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <Monitor className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                                {t('new_website.device_desktop')}
                                            </span>
                                        </div>
                                        <span className="text-sm font-black text-blue-600 dark:text-blue-400">
                                            {analytics?.deviceBreakdown.desktop || 0} ({desktopPct}%)
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 pt-2">
                                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-center">
                                            <div className="text-[11px] font-black text-amber-700 dark:text-amber-300 uppercase">
                                                {t('new_website.lang_es')}
                                            </div>
                                            <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                                                {analytics?.langBreakdown.es || 0} ({esPct}%)
                                            </div>
                                        </div>
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-center">
                                            <div className="text-[11px] font-black text-blue-700 dark:text-blue-300 uppercase">
                                                {t('new_website.lang_en')}
                                            </div>
                                            <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                                                {analytics?.langBreakdown.en || 0} ({enPct}%)
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Quick Links to Live Pages */}
                            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                                <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
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
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                                        >
                                            <span>{l.label}</span>
                                            <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* 3. Live Real-Time Activity Feed */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col shadow-sm">
                            <h3 className="text-sm font-black text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                                <span>{t('new_website.live_feed_title')}</span>
                            </h3>
                            {(analytics?.recentEvents || []).length === 0 ? (
                                <div className="text-xs text-slate-400 py-8 text-center font-medium">
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
                                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeClass}`}>
                                                            {label}
                                                        </span>
                                                        {ev.store_name && (
                                                            <span className="font-black text-slate-900 dark:text-white truncate">
                                                                {ev.store_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate font-medium">
                                                        {getFriendlyPageLabel(ev.page_path, language)} • {ev.device_type.toUpperCase()} • {ev.lang.toUpperCase()}
                                                    </div>
                                                </div>
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-mono font-semibold">
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
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <Inbox className="w-5 h-5 text-red-600 dark:text-amber-400" />
                                <span>{t('new_website.feedback_title')}</span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                {t('new_website.feedback_subtitle')}
                            </p>
                        </div>
                        <button
                            onClick={() => fetchAnalyticsData(dateRange)}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold transition-colors"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? 'animate-spin' : ''}`} />
                            <span>{t('new_website.refresh')}</span>
                        </button>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex flex-wrap items-center gap-2">
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
                                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
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
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-2 shadow-sm">
                            <Inbox className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-sm font-black text-slate-900 dark:text-white">{t('new_website.empty_category_title')}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t('new_website.empty_category_desc')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredFeedback.map((item: any) => (
                                <div
                                    key={item.id}
                                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 hover:border-amber-400 dark:hover:border-amber-500/50 transition-all shadow-sm"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700 mb-1.5">
                                                {item.complaint_type || 'general'}
                                            </span>
                                            <h3 className="text-sm font-black text-slate-900 dark:text-white">
                                                {item.customer_name || t('new_website.anonymous_customer')}
                                            </h3>
                                        </div>
                                        <span className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1 font-medium">
                                            <Clock className="w-3 h-3" />
                                            {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                                        {item.customer_email && (
                                            <a
                                                href={`mailto:${item.customer_email}`}
                                                className="inline-flex items-center gap-1 text-red-600 dark:text-amber-400 hover:underline"
                                            >
                                                <Mail className="w-3.5 h-3.5" />
                                                <span>{item.customer_email}</span>
                                            </a>
                                        )}
                                        {item.customer_phone && (
                                            <a
                                                href={`tel:${item.customer_phone}`}
                                                className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline"
                                            >
                                                <Phone className="w-3.5 h-3.5" />
                                                <span>{item.customer_phone}</span>
                                            </a>
                                        )}
                                        {item.store_name && (
                                            <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-bold">
                                                <MapPin className="w-3.5 h-3.5" />
                                                <span>{item.store_name}</span>
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200/70 dark:border-slate-800 whitespace-pre-line leading-relaxed font-medium">
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
            {activeTab === 'live_site' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Sub-toolbar with Device Switcher & Brochure Download */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => setViewport('desktop')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    viewport === 'desktop'
                                        ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Monitor className="w-3.5 h-3.5" />
                                <span>{t('new_website.view_desktop')}</span>
                            </button>
                            <button
                                onClick={() => setViewport('tablet')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    viewport === 'tablet'
                                        ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Tablet className="w-3.5 h-3.5" />
                                <span>{t('new_website.view_tablet')}</span>
                            </button>
                            <button
                                onClick={() => setViewport('mobile')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    viewport === 'mobile'
                                        ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-amber-400 shadow-sm'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Smartphone className="w-3.5 h-3.5" />
                                <span>{t('new_website.view_mobile')}</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <a
                                href="https://tacosgavilan.com/docs/Tacos-Gavilan-Fiesta-Platter-Brochure.pdf"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700 text-xs font-bold transition-colors"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                <span>{t('new_website.download_brochure')}</span>
                            </a>

                            <button
                                onClick={handleReloadPreview}
                                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                                title={t('new_website.reload')}
                            >
                                <RefreshCw className={`w-4 h-4 ${iframeLoading ? 'animate-spin text-red-600 dark:text-amber-400' : ''}`} />
                            </button>

                            <button
                                onClick={() => setIsFullscreen(prev => !prev)}
                                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                                title={isFullscreen ? t('new_website.exit_fullscreen') : t('new_website.fullscreen')}
                            >
                                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {/* Iframe Viewport Container */}
                    <div className="relative flex-1 flex items-center justify-center bg-slate-100 dark:bg-slate-950 overflow-hidden p-0 sm:p-4">
                        {iframeLoading && (
                            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm">
                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-amber-500 flex items-center justify-center shadow-xl shadow-red-600/30 animate-bounce mb-3">
                                    <Globe className="w-6 h-6 text-white" />
                                </div>
                                <p className="text-sm font-bold text-slate-900 dark:text-white">{t('new_website.loading_preview')}</p>
                            </div>
                        )}

                        <div
                            className={`relative h-full transition-all duration-300 ease-out bg-white shadow-xl overflow-hidden ${getViewportWidth()} ${
                                viewport !== 'desktop'
                                    ? 'rounded-[28px] border-[6px] border-slate-800 shadow-slate-400/40 dark:shadow-black/80 my-auto max-h-[92vh]'
                                    : 'w-full h-full rounded-none sm:rounded-2xl border border-slate-200 dark:border-slate-800'
                            }`}
                            style={{
                                height: isFullscreen ? 'calc(100vh - 105px)' : 'calc(100vh - 165px)'
                            }}
                        >
                            <iframe
                                key={refreshKey}
                                ref={iframeRef}
                                src={previewUrl}
                                title="Tacos Gavilan Official Website"
                                className="w-full h-full border-0 bg-white"
                                onLoad={() => setIframeLoading(false)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

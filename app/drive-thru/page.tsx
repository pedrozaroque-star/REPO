/**
 * @module app/drive-thru/page
 * @description Módulo completo de Drive-Thru con 4 pestañas: Leaderboard (ranking de tiendas),
 *   Timeline (vista por media hora de una tienda), Lookup (búsqueda de orden por número), y
 *   Reports (reportes por período con exportación CSV y sección de Tiempo Ideal).
 *
 * @businessRules
 * - Umbrales de tiempo: 🟢 ≤ 3:30 (≤210s), 🟡 3:31-5:00 (211-300s), 🔴 > 5:00 (>300s)
 * - El día laboral empieza a las 6 AM y termina a las 5:59 AM del día siguiente
 * - El turno PM inicia a las 5 PM
 * - Zona horaria: America/Los_Angeles
 * - Solo muestra tiendas con Drive-Thru: LA Central, Lynwood, West Covina, Norwalk, La Puente, South Gate
 * - Auto-refresh cada 60 segundos en Leaderboard tab
 * - Navegación por media hora con slots de 30 minutos: "06:00", "06:30", "07:00", etc.
 *
 * @dataFlow
 * - Tab Leaderboard: GET /api/drive-thru/leaderboard?date=YYYY-MM-DD&slot=HH:MM
 * - Tab Timeline:    GET /api/drive-thru/stats?storeId=UUID&date=YYYY-MM-DD
 * - Tab Lookup:      GET /api/drive-thru/lookup?orderNumber=X&storeId=X&date=X
 * - Tab Reports:     GET /api/drive-thru/reports?startDate=X&endDate=X&storeId=X&groupBy=X
 * - Ideal Time:      GET /api/drive-thru/ideal-time?storeId=UUID
 * - Datos provienen de dt_halfhour_stats y dt_orders (pre-agregados por el cron sync-drive-thru)
 *
 * @notes
 * - Diseño inspirado en HME ZOOM Nitro con podio visual y barras de progreso con colores
 * - Click en una tienda del leaderboard navega a la tab Timeline con esa tienda preseleccionada
 * - Soporta URL param ?store=UUID para preseleccionar tienda en Timeline
 * - Exportar CSV genera un archivo descargable con los datos del reporte activo
 * - Los tabs tienen animaciones suaves y soportan dark mode completo
 */
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
    Timer, Trophy, Zap, Car, AlertTriangle, TrendingUp, Clock,
    ChevronLeft, ChevronRight, Search, Download, BarChart3, Calendar,
    ArrowUp, ArrowDown, Minus
} from 'lucide-react'

// ─────────────────────────────────────────────────────────
// Tipos / Interfaces
// ─────────────────────────────────────────────────────────

interface LeaderboardEntry {
    store_id: string
    store_name: string
    avg_duration_sec: number
    order_count: number
    fastest_order: { number: string | null; duration: number } | null
    slowest_order: { number: string | null; duration: number } | null
    color: 'green' | 'yellow' | 'red'
    rank: number
}

interface LeaderboardData {
    entries: LeaderboardEntry[]
    globalAvg: number
    totalCars: number
    date: string
    slot: string | null
}

interface TimelineSlot {
    slot_label: string
    slot_index: number
    order_count: number
    avg_duration: number
    min_duration: number
    max_duration: number
    store_id: string
    store_name: string
    business_date: string
}

interface TimelineData {
    slots: TimelineSlot[]
    dayTotal: number
    dayAvg: number
    date: string
    storeId: string
}

interface LookupOrder {
    order_number: string
    store_id: string
    store_name: string
    opened_at: string
    closed_at: string
    duration_seconds: number
    business_date: string
    slot_label: string
    dining_option: string
    order_guid: string
    net_sales: number
}

interface LookupData {
    orders: LookupOrder[]
    count: number
    total: number
}

interface ReportStoreEntry {
    store_id: string
    store_name: string
    total_orders: number
    avg_duration: number
    min_duration: number
    max_duration: number
    cars_per_hour_avg: number
    pct_within_goal: number
}

interface ReportPeriod {
    period: string
    stores: ReportStoreEntry[]
}

interface ReportData {
    periods: ReportPeriod[]
    summary: {
        overall_avg: number
        total_cars: number
        pct_within_goal: number
    }
}

interface IdealTimeData {
    storeId: string
    idealTime: number
    isCustom: boolean
}

/** Las 6 tiendas con Drive-Thru y sus GUIDs */
const DT_STORES = [
    { id: '8685e942-3f07-403a-afb6-faec697cd2cb', name: 'LA Central' },
    { id: '80a1ec95-bc73-402e-8884-e5abbe9343e6', name: 'Lynwood' },
    { id: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02', name: 'West Covina' },
    { id: '42ed15a6-106b-466a-9076-1e8f72451f6b', name: 'Norwalk' },
    { id: '3a803939-eb13-4def-a1a4-462df8e90623', name: 'La Puente' },
    { id: '95866cfc-eeb8-4af9-9586-f78931e1ea04', name: 'South Gate' },
]

type TabId = 'leaderboard' | 'timeline' | 'lookup' | 'reports'

// ─────────────────────────────────────────────────────────
// Funciones helper
// ─────────────────────────────────────────────────────────

/** Formatea segundos a M:SS (ej: 215 → "3:35") */
function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

/** Retorna clases Tailwind por color de umbral */
function getColorClasses(color: string) {
    switch (color) {
        case 'green': return {
            bg: 'bg-emerald-50 dark:bg-emerald-950/30',
            border: 'border-emerald-200 dark:border-emerald-800',
            text: 'text-emerald-700 dark:text-emerald-400',
            dot: 'bg-emerald-500',
            bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
        }
        case 'yellow': return {
            bg: 'bg-amber-50 dark:bg-amber-950/30',
            border: 'border-amber-200 dark:border-amber-800',
            text: 'text-amber-700 dark:text-amber-400',
            dot: 'bg-amber-500',
            bar: 'bg-gradient-to-r from-amber-400 to-amber-500',
        }
        case 'red': return {
            bg: 'bg-rose-50 dark:bg-rose-950/30',
            border: 'border-rose-200 dark:border-rose-800',
            text: 'text-rose-700 dark:text-rose-400',
            dot: 'bg-rose-500',
            bar: 'bg-gradient-to-r from-rose-400 to-rose-500',
        }
        default: return {
            bg: 'bg-slate-50 dark:bg-slate-950/30',
            border: 'border-slate-200 dark:border-slate-800',
            text: 'text-slate-700 dark:text-slate-400',
            dot: 'bg-slate-500',
            bar: 'bg-gradient-to-r from-slate-400 to-slate-500',
        }
    }
}

/** Emoji de medalla por posición */
function getMedalEmoji(rank: number): string {
    switch (rank) {
        case 1: return '🥇'
        case 2: return '🥈'
        case 3: return '🥉'
        default: return `${rank}.`
    }
}

/** Genera los 48 slots de media hora del día laboral (06:00 → 05:30) */
function generateSlots(): string[] {
    const slots: string[] = []
    for (let h = 6; h < 30; h++) {
        const hour = h % 24
        slots.push(`${String(hour).padStart(2, '0')}:00`)
        slots.push(`${String(hour).padStart(2, '0')}:30`)
    }
    return slots
}

/** Retorna el slot actual basado en la hora LA */
function getCurrentSlot(): string {
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const h = laTime.getHours()
    const m = laTime.getMinutes()
    const slotMin = m < 30 ? '00' : '30'
    return `${String(h).padStart(2, '0')}:${slotMin}`
}

/** Retorna la fecha laboral actual (YYYY-MM-DD) con regla de las 6 AM */
function getBusinessDate(): string {
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    if (laTime.getHours() < 6) {
        laTime.setDate(laTime.getDate() - 1)
    }
    const y = laTime.getFullYear()
    const m = String(laTime.getMonth() + 1).padStart(2, '0')
    const d = String(laTime.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/** Clasifica duración en color de umbral */
function getDurationColor(seconds: number): 'green' | 'yellow' | 'red' {
    if (seconds <= 210) return 'green'
    if (seconds <= 300) return 'yellow'
    return 'red'
}

/** Suma un día a una fecha YYYY-MM-DD */
function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
}

const ALL_SLOTS = generateSlots()

// ─────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────

function DriveThruContent() {
    const { t } = useLanguage()
    const router = useRouter()
    const searchParams = useSearchParams()

    // ─── State global ───
    const [activeTab, setActiveTab] = useState<TabId>('leaderboard')
    const [selectedDate, setSelectedDate] = useState(getBusinessDate)
    const [dtStores, setDtStores] = useState<{ id: string; name: string }[]>(DT_STORES)

    useEffect(() => {
        fetch('/api/stores')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    const filtered = data
                        .filter((s: any) => s.has_drive_thru === true)
                        .map((s: any) => ({ id: s.external_id, name: s.name }))
                    if (filtered.length > 0) {
                        setDtStores(filtered)
                    }
                }
            })
            .catch(err => console.error('[DT] Error fetching dynamic stores list:', err))
    }, [])

    // ═══════════════════════════════════════════════════════
    // TAB 1: LEADERBOARD
    // ═══════════════════════════════════════════════════════
    const [lbData, setLbData] = useState<LeaderboardData | null>(null)
    const [lbLoading, setLbLoading] = useState(true)
    const [lbError, setLbError] = useState<string | null>(null)
    const [lbViewMode, setLbViewMode] = useState<'slot' | 'day'>('day')
    const [lbSlotIndex, setLbSlotIndex] = useState(() => {
        const current = getCurrentSlot()
        const idx = ALL_SLOTS.indexOf(current)
        return idx >= 0 ? idx : 0
    })
    const lbAbortRef = useRef<AbortController | null>(null)

    const fetchLeaderboard = useCallback(async () => {
        if (lbAbortRef.current) lbAbortRef.current.abort()
        const controller = new AbortController()
        lbAbortRef.current = controller

        setLbLoading(true)
        try {
            const slot = lbViewMode === 'slot' ? ALL_SLOTS[lbSlotIndex] : undefined
            const url = `/api/drive-thru/leaderboard?date=${selectedDate}${slot ? `&slot=${slot}` : ''}`
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setLbData(json)
            setLbError(null)
        } catch (e: any) {
            if (e.name !== 'AbortError') setLbError(e.message)
        } finally {
            setLbLoading(false)
        }
    }, [lbViewMode, lbSlotIndex, selectedDate])

    useEffect(() => {
        if (activeTab === 'leaderboard') {
            fetchLeaderboard()
            const interval = setInterval(fetchLeaderboard, 60000)
            return () => {
                clearInterval(interval)
                if (lbAbortRef.current) lbAbortRef.current.abort()
            }
        }
    }, [activeTab, fetchLeaderboard])

    const navigateLbSlot = (direction: -1 | 1) => {
        setLbSlotIndex(prev => {
            const next = prev + direction
            if (next < 0 || next >= ALL_SLOTS.length) return prev
            return next
        })
    }

    const isLbToday = !selectedDate || selectedDate === getBusinessDate()
    const realTimeSlotIndex = ALL_SLOTS.indexOf(getCurrentSlot())
    const isLbNextDisabled = lbSlotIndex >= ALL_SLOTS.length - 1 || (isLbToday && lbSlotIndex >= realTimeSlotIndex)

    // ═══════════════════════════════════════════════════════
    // TAB 2: TIMELINE
    // ═══════════════════════════════════════════════════════
    const [tlStoreId, setTlStoreId] = useState<string>('')
    const [tlDate, setTlDate] = useState(getBusinessDate)
    const [tlData, setTlData] = useState<TimelineData | null>(null)
    const [tlLoading, setTlLoading] = useState(false)
    const [tlError, setTlError] = useState<string | null>(null)
    const tlAbortRef = useRef<AbortController | null>(null)

    // Preseleccionar tienda desde URL param ?store=UUID
    useEffect(() => {
        const storeParam = searchParams.get('store')
        if (storeParam) {
            setTlStoreId(storeParam)
            setActiveTab('timeline')
        }
    }, [searchParams])

    const fetchTimeline = useCallback(async () => {
        if (!tlStoreId) return
        if (tlAbortRef.current) tlAbortRef.current.abort()
        const controller = new AbortController()
        tlAbortRef.current = controller

        setTlLoading(true)
        try {
            const url = `/api/drive-thru/stats?storeId=${tlStoreId}&date=${tlDate}`
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setTlData(json)
            setTlError(null)
        } catch (e: any) {
            if (e.name !== 'AbortError') setTlError(e.message)
        } finally {
            setTlLoading(false)
        }
    }, [tlStoreId, tlDate])

    useEffect(() => {
        if (activeTab === 'timeline' && tlStoreId) {
            fetchTimeline()
            return () => {
                if (tlAbortRef.current) tlAbortRef.current.abort()
            }
        }
    }, [activeTab, fetchTimeline, tlStoreId])

    // ═══════════════════════════════════════════════════════
    // TAB 3: LOOKUP (Órdenes Individuales)
    // ═══════════════════════════════════════════════════════
    const [luOrderNumber, setLuOrderNumber] = useState('')
    const [luStoreId, setLuStoreId] = useState<string>('')
    const [luDate, setLuDate] = useState<string>(getBusinessDate)
    const [luData, setLuData] = useState<LookupData | null>(null)
    const [luLoading, setLuLoading] = useState(false)
    const [luError, setLuError] = useState<string | null>(null)
    const [luSearched, setLuSearched] = useState(false)

    // Paginación y Ordenamiento
    const [luPage, setLuPage] = useState(1)
    const luPageSize = 100
    const [sortField, setSortField] = useState<'order_number' | 'store_name' | 'slot' | 'opened_at' | 'closed_at' | 'duration_seconds' | null>(null)
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

    // Estado del modal de detalle de recibo (idéntico al de auditoria-descuentos)
    const [orderDetailData, setOrderDetailData] = useState<{
        loading: boolean
        data?: any
        error?: string
        checkId?: string
        storeName?: string
        cajeraName?: string
    } | null>(null)

    const fetchLookup = useCallback(async () => {
        setLuLoading(true)
        setLuSearched(true)
        try {
            let url = `/api/drive-thru/lookup?`
            const params: string[] = []
            if (luOrderNumber.trim()) {
                params.push(`orderNumber=${encodeURIComponent(luOrderNumber.trim())}`)
            }
            if (luStoreId) {
                params.push(`storeId=${luStoreId}`)
            }
            if (luDate) {
                params.push(`date=${luDate}`)
            }
            params.push(`limit=${luPageSize}`)
            params.push(`offset=${(luPage - 1) * luPageSize}`)

            const res = await fetch(url + params.join('&'))
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setLuData(json)
            setLuError(null)
        } catch (e: any) {
            setLuError(e.message)
        } finally {
            setLuLoading(false)
        }
    }, [luOrderNumber, luStoreId, luDate, luPage])

    const handleSearch = useCallback(() => {
        if (luPage === 1) {
            fetchLookup()
        } else {
            setLuPage(1)
        }
    }, [luPage, fetchLookup])

    const handleSort = useCallback((field: typeof sortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDirection('asc')
        }
    }, [sortField])

    const handleOrderClick = useCallback((order: LookupOrder) => {
        setOrderDetailData({
            loading: true,
            checkId: order.order_number,
            storeName: order.store_name,
            cajeraName: 'Drive-Thru'
        })
        fetch(`/api/toast-order-detail?guid=${order.order_guid}&storeId=${order.store_id}`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    setOrderDetailData(prev => prev ? { ...prev, loading: false, error: data.error } : null)
                } else {
                    setOrderDetailData(prev => prev ? { ...prev, loading: false, data: data.order } : null)
                }
            })
            .catch(err => {
                setOrderDetailData(prev => prev ? { ...prev, loading: false, error: err.message } : null)
            })
    }, [])

    useEffect(() => {
        if (activeTab === 'lookup') {
            fetchLookup()
        }
    }, [activeTab, luStoreId, luDate, luPage, fetchLookup])

    // ═══════════════════════════════════════════════════════
    // TAB 4: REPORTS
    // ═══════════════════════════════════════════════════════
    const [rpStartDate, setRpStartDate] = useState(() => {
        // Default: 7 días atrás
        const d = new Date()
        d.setDate(d.getDate() - 7)
        return d.toISOString().split('T')[0]
    })
    const [rpEndDate, setRpEndDate] = useState(() => getBusinessDate())
    const [rpStoreId, setRpStoreId] = useState<string>('all')
    const [rpGroupBy, setRpGroupBy] = useState<'day' | 'week' | 'month'>('day')
    const [rpData, setRpData] = useState<ReportData | null>(null)
    const [rpLoading, setRpLoading] = useState(false)
    const [rpError, setRpError] = useState<string | null>(null)
    const [rpGenerated, setRpGenerated] = useState(false)

    // Ideal Time
    const [itData, setItData] = useState<IdealTimeData | null>(null)
    const [itLoading, setItLoading] = useState(false)

    const fetchReports = useCallback(async () => {
        setRpLoading(true)
        setRpGenerated(true)
        try {
            let url = `/api/drive-thru/reports?startDate=${rpStartDate}&endDate=${rpEndDate}&groupBy=${rpGroupBy}`
            if (rpStoreId !== 'all') url += `&storeId=${rpStoreId}`
            const res = await fetch(url)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setRpData(json)
            setRpError(null)
        } catch (e: any) {
            setRpError(e.message)
        } finally {
            setRpLoading(false)
        }
    }, [rpStartDate, rpEndDate, rpStoreId, rpGroupBy])

    const fetchIdealTime = useCallback(async (storeId: string) => {
        if (!storeId || storeId === 'all') {
            setItData(null)
            return
        }
        setItLoading(true)
        try {
            const res = await fetch(`/api/drive-thru/ideal-time?storeId=${storeId}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            setItData(json)
        } catch {
            setItData(null)
        } finally {
            setItLoading(false)
        }
    }, [])

    // Cargar ideal time cuando cambia la tienda seleccionada en Reports
    useEffect(() => {
        if (activeTab === 'reports' && rpStoreId !== 'all') {
            fetchIdealTime(rpStoreId)
        }
    }, [activeTab, rpStoreId, fetchIdealTime])

    /** Exportar CSV de los datos de reporte */
    const exportCSV = () => {
        if (!rpData || rpData.periods.length === 0) return

        const headers = [
            t('drive_thru.slot'),
            t('drive_thru.store'),
            t('drive_thru.total_orders'),
            t('drive_thru.avg_time'),
            t('drive_thru.fastest'),
            t('drive_thru.slowest'),
            t('drive_thru.cars_per_hour'),
            t('drive_thru.pct_within_goal'),
        ]

        const rows: string[][] = []
        for (const period of rpData.periods) {
            for (const store of period.stores) {
                rows.push([
                    period.period,
                    store.store_name,
                    String(store.total_orders),
                    formatDuration(store.avg_duration),
                    formatDuration(store.min_duration),
                    formatDuration(store.max_duration),
                    String(store.cars_per_hour_avg),
                    `${store.pct_within_goal}%`,
                ])
            }
        }

        // Fila de resumen
        rows.push([])
        rows.push([
            t('drive_thru.summary'),
            '',
            String(rpData.summary.total_cars),
            formatDuration(rpData.summary.overall_avg),
            '',
            '',
            '',
            `${rpData.summary.pct_within_goal}%`,
        ])

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.map(cell => `"${cell}"`).join(',')),
        ].join('\n')

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `drive-thru-report_${rpStartDate}_${rpEndDate}.csv`
        link.click()
        URL.revokeObjectURL(url)
    }

    // Obtener datos derivados del leaderboard
    const lbRedStores = lbData?.entries.filter(e => e.color === 'red') || []
    const lbMaxDuration = lbData?.entries.length ? Math.max(...lbData.entries.map(e => e.avg_duration_sec), 300) : 300

    // Datos derivados del Timeline
    const currentSlot = getCurrentSlot()
    const tlBestSlot = tlData?.slots.length
        ? tlData.slots.reduce((best, s) => (s.order_count > 0 && s.avg_duration > 0 && (s.avg_duration < best.avg_duration || best.avg_duration === 0)) ? s : best, tlData.slots[0])
        : null
    const tlWorstSlot = tlData?.slots.length
        ? tlData.slots.reduce((worst, s) => (s.order_count > 0 && s.avg_duration > worst.avg_duration) ? s : worst, tlData.slots[0])
        : null
    const tlMaxOrders = tlData?.slots.length ? Math.max(...tlData.slots.map(s => s.order_count), 1) : 1

    // ─── Tab config ───
    const tabs: { id: TabId; icon: React.ReactNode; label: string }[] = [
        { id: 'leaderboard', icon: <Trophy size={16} />, label: t('drive_thru.leaderboard') },
        { id: 'timeline', icon: <Clock size={16} />, label: t('drive_thru.timeline') },
        { id: 'lookup', icon: <Search size={16} />, label: t('drive_thru.lookup') },
        { id: 'reports', icon: <BarChart3 size={16} />, label: t('drive_thru.reports') },
    ]

    // Click en tienda del leaderboard → Timeline
    const handleStoreClick = (storeId: string) => {
        setTlStoreId(storeId)
        setTlDate(selectedDate)
        setActiveTab('timeline')
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* ═══════════════════════════════════════════ */}
            {/* HEADER */}
            {/* ═══════════════════════════════════════════ */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl shadow-lg shadow-orange-500/20">
                                <Timer className="text-white" size={24} />
                            </div>
                            <div>
                                <h1 className="text-xl font-black text-slate-900 dark:text-white">
                                    {t('drive_thru.title')}
                                </h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {t('drive_thru.subtitle')}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Calendar size={16} className="text-slate-400" />
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Tab Navigation */}
                    <div className="flex gap-1 mt-4 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center
                                    ${activeTab === tab.id
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                {tab.icon}
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════ */}
            {/* TAB CONTENT */}
            {/* ═══════════════════════════════════════════ */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

                {/* ─────────────────────────────────── */}
                {/* TAB 1: LEADERBOARD */}
                {/* ─────────────────────────────────── */}
                {activeTab === 'leaderboard' && (
                    <div className="space-y-4">
                        {/* Controls */}
                        <div className="flex items-center justify-between flex-wrap gap-3 w-full">
                            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-xs sm:text-sm">
                                <button
                                    onClick={() => setLbViewMode('day')}
                                    className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all font-medium ${lbViewMode === 'day'
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    {t('drive_thru.current_day')}
                                </button>
                                <button
                                    onClick={() => setLbViewMode('slot')}
                                    className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-md transition-all font-medium ${lbViewMode === 'slot'
                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    {t('drive_thru.by_slot')}
                                </button>
                            </div>

                            {/* Slot navigation */}
                            {lbViewMode === 'slot' && (
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => navigateLbSlot(-1)}
                                        disabled={lbSlotIndex <= 0}
                                        className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors border border-slate-200 dark:border-slate-700"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 min-w-[50px] sm:min-w-[60px] text-center bg-slate-100 dark:bg-slate-800 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg">
                                        {ALL_SLOTS[lbSlotIndex]}
                                    </span>
                                    <button
                                        onClick={() => navigateLbSlot(1)}
                                        disabled={isLbNextDisabled}
                                        className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors border border-slate-200 dark:border-slate-700"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Alert Banner for red stores */}
                        {!lbLoading && lbRedStores.length > 0 && (
                            <div className="flex items-center gap-3 bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-sm font-medium animate-pulse">
                                <AlertTriangle size={18} />
                                <span>
                                    {t('drive_thru.alert_critical').replace('{count}', String(lbRedStores.length))}:{' '}
                                    {lbRedStores.map(s => s.store_name).join(', ')}
                                </span>
                            </div>
                        )}

                        {/* Loading */}
                        {lbLoading && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12">
                                <div className="flex items-center justify-center">
                                    <div className="animate-pulse text-slate-400 text-sm">{t('drive_thru.loading')}</div>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {!lbLoading && lbError && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800 p-8 text-center">
                                <AlertTriangle size={32} className="mx-auto text-rose-400 mb-2" />
                                <p className="text-rose-600 dark:text-rose-400 text-sm">{lbError}</p>
                            </div>
                        )}

                        {/* Empty */}
                        {!lbLoading && !lbError && (!lbData || lbData.entries.length === 0) && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                                <Car size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                                <p className="text-slate-400 text-sm">{t('drive_thru.no_dt_data')}</p>
                            </div>
                        )}

                        {/* Leaderboard entries */}
                        {!lbLoading && !lbError && lbData && lbData.entries.length > 0 && (
                            <>
                                {/* Podio top 3 */}
                                <div className="grid grid-cols-3 gap-3">
                                    {lbData.entries.slice(0, 3).map((entry) => {
                                        const colors = getColorClasses(entry.color)
                                        const isFirst = entry.rank === 1
                                        return (
                                            <div
                                                key={entry.store_id}
                                                onClick={() => handleStoreClick(entry.store_id)}
                                                className={`cursor-pointer rounded-2xl border-2 p-4 text-center transition-all hover:scale-[1.02] hover:shadow-lg ${colors.bg} ${colors.border} ${isFirst ? 'ring-2 ring-yellow-400 dark:ring-yellow-600' : ''}`}
                                            >
                                                <span className="text-3xl">{getMedalEmoji(entry.rank)}</span>
                                                <h3 className="font-bold text-slate-800 dark:text-slate-200 mt-1 text-sm truncate">{entry.store_name}</h3>
                                                <p className={`text-2xl font-black tabular-nums mt-1 ${colors.text}`}>
                                                    {formatDuration(entry.avg_duration_sec)}
                                                </p>
                                                <div className="flex items-center justify-center gap-1 mt-1">
                                                    <Car size={12} className="text-slate-400" />
                                                    <span className="text-xs text-slate-500 tabular-nums">{entry.order_count} {t('drive_thru.cars')}</span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>

                                {/* Full table */}
                                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-16">{t('drive_thru.rank')}</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.store')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.avg_time')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.cars')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 hidden md:table-cell">{t('drive_thru.fastest')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 hidden md:table-cell">{t('drive_thru.slowest')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-20">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {lbData.entries.map((entry) => {
                                                    const colors = getColorClasses(entry.color)
                                                    const barWidth = Math.min((entry.avg_duration_sec / lbMaxDuration) * 100, 100)
                                                    return (
                                                        <tr
                                                            key={entry.store_id}
                                                            onClick={() => handleStoreClick(entry.store_id)}
                                                            className="border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                                        >
                                                            <td className="px-4 py-3">
                                                                <span className="text-base font-bold">{getMedalEmoji(entry.rank)}</span>
                                                            </td>
                                                            <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                                                {entry.store_name}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className={`font-bold tabular-nums ${colors.text}`}>
                                                                        {formatDuration(entry.avg_duration_sec)}
                                                                    </span>
                                                                    <div className="w-full max-w-[100px] h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                                        <div
                                                                            className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar}`}
                                                                            style={{ width: `${barWidth}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <Car size={14} className="text-slate-400" />
                                                                    <span className="font-medium text-slate-600 dark:text-slate-400 tabular-nums">
                                                                        {entry.order_count}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-center hidden md:table-cell">
                                                                {entry.fastest_order ? (
                                                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                                                                        <Zap size={12} className="inline mr-1" />
                                                                        {formatDuration(entry.fastest_order.duration)}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-300">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-center hidden md:table-cell">
                                                                {entry.slowest_order ? (
                                                                    <span className="text-rose-600 dark:text-rose-400 font-medium tabular-nums">
                                                                        {formatDuration(entry.slowest_order.duration)}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-300">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <div className={`w-3 h-3 rounded-full mx-auto ${colors.dot} ${entry.color === 'red' ? 'animate-pulse' : ''}`} />
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Footer Stats */}
                                    <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
                                        <div className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-6">
                                                <div className="flex items-center gap-2">
                                                    <Clock size={14} className="text-slate-400" />
                                                    <span className="text-slate-500">{t('drive_thru.global_avg')}:</span>
                                                    <span className={`font-bold tabular-nums ${lbData.globalAvg <= 210 ? 'text-emerald-600' : lbData.globalAvg <= 300 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                        {formatDuration(lbData.globalAvg)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Car size={14} className="text-slate-400" />
                                                    <span className="text-slate-500">{t('drive_thru.total_cars')}:</span>
                                                    <span className="font-bold text-slate-700 dark:text-slate-300 tabular-nums">{lbData.totalCars}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ─────────────────────────────────── */}
                {/* TAB 2: TIMELINE */}
                {/* ─────────────────────────────────── */}
                {activeTab === 'timeline' && (
                    <div className="space-y-4">
                        {/* Controls */}
                        <div className="flex items-center gap-3 flex-wrap">
                            {/* Store selector */}
                            <select
                                value={tlStoreId}
                                onChange={(e) => setTlStoreId(e.target.value)}
                                className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none min-w-[180px]"
                            >
                                <option value="">{t('drive_thru.store')}...</option>
                                {dtStores.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>

                            {/* Date navigation */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setTlDate(prev => addDays(prev, -1))}
                                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <input
                                    type="date"
                                    value={tlDate}
                                    onChange={(e) => setTlDate(e.target.value)}
                                    className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                />
                                <button
                                    onClick={() => setTlDate(prev => addDays(prev, 1))}
                                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>

                        {/* No store selected */}
                        {!tlStoreId && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                                <Car size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                                <p className="text-slate-400 text-sm">{t('drive_thru.store')}...</p>
                            </div>
                        )}

                        {/* Loading */}
                        {tlStoreId && tlLoading && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12">
                                <div className="flex items-center justify-center">
                                    <div className="animate-pulse text-slate-400 text-sm">{t('drive_thru.loading')}</div>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {tlStoreId && !tlLoading && tlError && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800 p-8 text-center">
                                <AlertTriangle size={32} className="mx-auto text-rose-400 mb-2" />
                                <p className="text-rose-600 dark:text-rose-400 text-sm">{tlError}</p>
                            </div>
                        )}

                        {/* Empty */}
                        {tlStoreId && !tlLoading && !tlError && (!tlData || tlData.slots.length === 0) && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                                <Car size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                                <p className="text-slate-400 text-sm">{t('drive_thru.no_data')}</p>
                            </div>
                        )}

                        {/* Timeline slots */}
                        {tlStoreId && !tlLoading && !tlError && tlData && tlData.slots.length > 0 && (
                            <>
                                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {tlData.slots.map((slot) => {
                                            const color = getDurationColor(slot.avg_duration)
                                            const colors = getColorClasses(color)
                                            const barWidth = Math.min((slot.order_count / tlMaxOrders) * 100, 100)
                                            const isCurrentSlot = slot.slot_label === currentSlot && tlDate === getBusinessDate()

                                            return (
                                                <div
                                                    key={slot.slot_index}
                                                    className={`flex flex-col gap-1.5 px-5 py-3.5 transition-colors ${isCurrentSlot ? 'bg-orange-50 dark:bg-orange-950/20 border-l-4 border-orange-500' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'}`}
                                                >
                                                    {/* Top row: Label, progress bar, car count, status dot */}
                                                    <div className="flex items-center gap-4">
                                                        {/* Slot label */}
                                                        <div className="min-w-[60px]">
                                                            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                                                {slot.slot_label}
                                                            </span>
                                                            {isCurrentSlot && (
                                                                <div className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 mt-0.5 animate-pulse font-sans">
                                                                    {t('drive_thru.in_progress')}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Bar */}
                                                        <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar}`}
                                                                style={{ width: `${barWidth}%` }}
                                                            />
                                                        </div>

                                                        {/* Cars Count & Dot */}
                                                        <div className="flex items-center gap-3 min-w-[70px] justify-end">
                                                            <div className="flex items-center gap-1">
                                                                <Car size={14} className="text-slate-400" />
                                                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 tabular-nums font-bold">
                                                                    {slot.order_count}
                                                                </span>
                                                            </div>
                                                            <div className={`w-2.5 h-2.5 rounded-full ${slot.order_count > 0 ? colors.dot : 'bg-slate-200 dark:bg-slate-700'}`} />
                                                        </div>
                                                    </div>

                                                    {/* Bottom row: sub-stats (only when order_count > 0) */}
                                                    {slot.order_count > 0 && (
                                                        <div className="flex items-center gap-4 text-xs ml-[76px] text-slate-500 dark:text-slate-400 select-none">
                                                             <div className="flex items-center gap-1">
                                                                 <Clock size={12} className="text-slate-400" />
                                                                 <span>Avg: <span className={`font-bold tabular-nums ${colors.text}`}>{formatDuration(slot.avg_duration)}</span></span>
                                                             </div>
                                                             <div className="flex items-center gap-1">
                                                                 <Zap size={12} className="text-emerald-500" />
                                                                 <span>Rápida: <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatDuration(slot.min_duration)}</span></span>
                                                             </div>
                                                             <div className="flex items-center gap-1">
                                                                 <AlertTriangle size={12} className="text-rose-500" />
                                                                 <span>Lenta: <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{formatDuration(slot.max_duration)}</span></span>
                                                             </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Day summary stats */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-center">
                                        <p className="text-xs text-slate-500 mb-1">{t('drive_thru.day_total')}</p>
                                        <p className="text-2xl font-black text-slate-800 dark:text-white tabular-nums">{tlData.dayTotal}</p>
                                        <p className="text-xs text-slate-400">{t('drive_thru.cars')}</p>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-center">
                                        <p className="text-xs text-slate-500 mb-1">{t('drive_thru.day_avg')}</p>
                                        <p className={`text-2xl font-black tabular-nums ${tlData.dayAvg <= 210 ? 'text-emerald-600' : tlData.dayAvg <= 300 ? 'text-amber-600' : 'text-rose-600'}`}>
                                            {formatDuration(tlData.dayAvg)}
                                        </p>
                                    </div>
                                    {tlBestSlot && tlBestSlot.order_count > 0 && (
                                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-emerald-200 dark:border-emerald-800 p-4 text-center">
                                            <p className="text-xs text-slate-500 mb-1">{t('drive_thru.best_slot')}</p>
                                            <p className="text-lg font-black text-emerald-600 tabular-nums">{tlBestSlot.slot_label}</p>
                                            <p className="text-xs text-emerald-500 tabular-nums">{formatDuration(tlBestSlot.avg_duration)}</p>
                                        </div>
                                    )}
                                    {tlWorstSlot && tlWorstSlot.order_count > 0 && (
                                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800 p-4 text-center">
                                            <p className="text-xs text-slate-500 mb-1">{t('drive_thru.worst_slot')}</p>
                                            <p className="text-lg font-black text-rose-600 tabular-nums">{tlWorstSlot.slot_label}</p>
                                            <p className="text-xs text-rose-500 tabular-nums">{formatDuration(tlWorstSlot.avg_duration)}</p>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ─────────────────────────────────── */}
                {/* TAB 3: LOOKUP */}
                {/* ─────────────────────────────────── */}
                {activeTab === 'lookup' && (
                    <div className="space-y-4">
                        {/* Search form */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="flex-1">
                                    <input
                                        type="text"
                                        value={luOrderNumber}
                                        onChange={(e) => setLuOrderNumber(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                        placeholder={t('drive_thru.search_order')}
                                        className="w-full px-4 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none placeholder-slate-400"
                                    />
                                </div>
                                <select
                                    value={luStoreId}
                                    onChange={(e) => {
                                        setLuStoreId(e.target.value)
                                        setLuPage(1)
                                    }}
                                    className="px-4 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                >
                                    <option value="">{t('drive_thru.all_stores')}</option>
                                    {dtStores.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                                <input
                                    type="date"
                                    value={luDate}
                                    onChange={(e) => {
                                        setLuDate(e.target.value)
                                        setLuPage(1)
                                    }}
                                    className="px-4 py-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                />
                                <button
                                    onClick={handleSearch}
                                    disabled={luLoading}
                                    className="flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium text-sm rounded-xl hover:from-orange-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-500/20"
                                >
                                    <Search size={16} />
                                    {t('drive_thru.search')}
                                </button>
                            </div>
                        </div>

                        {/* Loading */}
                        {luLoading && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12">
                                <div className="flex items-center justify-center">
                                    <div className="animate-pulse text-slate-400 text-sm">{t('drive_thru.loading')}</div>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {!luLoading && luError && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800 p-8 text-center">
                                <AlertTriangle size={32} className="mx-auto text-rose-400 mb-2" />
                                <p className="text-rose-600 dark:text-rose-400 text-sm">{luError}</p>
                            </div>
                        )}

                        {/* No results */}
                        {!luLoading && !luError && luSearched && luData && luData.orders.length === 0 && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                                <Search size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                                <p className="text-slate-400 text-sm">{t('drive_thru.no_results')}</p>
                            </div>
                        )}

                        {/* Results table */}
                        {!luLoading && !luError && luData && luData.orders.length > 0 && (() => {
                            const sortedOrders = [...luData.orders].sort((a, b) => {
                                if (!sortField) return 0

                                let aVal: any
                                let bVal: any

                                if (sortField === 'slot') {
                                    aVal = `${a.business_date} ${a.slot_label}`
                                    bVal = `${b.business_date} ${b.slot_label}`
                                } else {
                                    aVal = a[sortField as keyof LookupOrder]
                                    bVal = b[sortField as keyof LookupOrder]
                                }

                                if (aVal === undefined || aVal === null) return 1
                                if (bVal === undefined || bVal === null) return -1

                                if (typeof aVal === 'string') {
                                    return sortDirection === 'asc'
                                        ? aVal.localeCompare(bVal)
                                        : bVal.localeCompare(aVal)
                                } else {
                                    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
                                }
                            })

                            return (
                                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                    <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                        <h3 className="font-bold text-slate-800 dark:text-white text-sm">
                                            {t('drive_thru.order_details')} ({luData.total})
                                        </h3>
                                        <span className="text-xs text-slate-500 font-medium">
                                            Mostrando {Math.min((luPage - 1) * luPageSize + 1, luData.total)} - {Math.min(luPage * luPageSize, luData.total)} de {luData.total}
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto font-sans">
                                        <table className="w-full text-sm text-slate-700 dark:text-slate-300">
                                            <thead>
                                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                                                    <th 
                                                        onClick={() => handleSort('order_number')}
                                                        className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-1 select-none">
                                                            {t('drive_thru.order_number')}
                                                            {sortField === 'order_number' && (
                                                                sortDirection === 'asc' ? <ArrowUp size={14} className="text-orange-500" /> : <ArrowDown size={14} className="text-orange-500" />
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th 
                                                        onClick={() => handleSort('store_name')}
                                                        className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-1 select-none">
                                                            {t('drive_thru.store')}
                                                            {sortField === 'store_name' && (
                                                                sortDirection === 'asc' ? <ArrowUp size={14} className="text-orange-500" /> : <ArrowDown size={14} className="text-orange-500" />
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th 
                                                        onClick={() => handleSort('slot')}
                                                        className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors hidden sm:table-cell"
                                                    >
                                                        <div className="flex items-center justify-center gap-1 select-none">
                                                            {t('drive_thru.slot')}
                                                            {sortField === 'slot' && (
                                                                sortDirection === 'asc' ? <ArrowUp size={14} className="text-orange-500" /> : <ArrowDown size={14} className="text-orange-500" />
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th 
                                                        onClick={() => handleSort('opened_at')}
                                                        className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors"
                                                    >
                                                        <div className="flex items-center justify-center gap-1 select-none">
                                                            {t('drive_thru.opened_at')}
                                                            {sortField === 'opened_at' && (
                                                                sortDirection === 'asc' ? <ArrowUp size={14} className="text-orange-500" /> : <ArrowDown size={14} className="text-orange-500" />
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th 
                                                        onClick={() => handleSort('closed_at')}
                                                        className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors"
                                                    >
                                                        <div className="flex items-center justify-center gap-1 select-none">
                                                            {t('drive_thru.closed_at')}
                                                            {sortField === 'closed_at' && (
                                                                sortDirection === 'asc' ? <ArrowUp size={14} className="text-orange-500" /> : <ArrowDown size={14} className="text-orange-500" />
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th 
                                                        onClick={() => handleSort('duration_seconds')}
                                                        className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors"
                                                    >
                                                        <div className="flex items-center justify-center gap-1 select-none">
                                                            {t('drive_thru.duration')}
                                                            {sortField === 'duration_seconds' && (
                                                                sortDirection === 'asc' ? <ArrowUp size={14} className="text-orange-500" /> : <ArrowDown size={14} className="text-orange-500" />
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-16 select-none">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedOrders.map((order, idx) => {
                                                    const color = getDurationColor(order.duration_seconds)
                                                    const colors = getColorClasses(color)
                                                    const openedTime = order.opened_at ? new Date(order.opened_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Los_Angeles' }) : '—'
                                                    const closedTime = order.closed_at ? new Date(order.closed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Los_Angeles' }) : '—'

                                                    return (
                                                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                            <td className="px-4 py-3 font-mono font-bold">
                                                                <button
                                                                    title={`GUID: ${order.order_guid}\nHaz clic para extraer ticket desde los servidores de Toast.`}
                                                                    className="hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-400/10 px-2 py-0.5 rounded cursor-pointer border border-transparent hover:border-amber-200 dark:hover:border-amber-500/30 transition-all font-bold text-sky-600 dark:text-sky-400 text-left font-mono"
                                                                    onClick={() => handleOrderClick(order)}
                                                                >
                                                                    #{order.order_number || 'N/A'}
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                                                                {order.store_name}
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-slate-500 tabular-nums hidden sm:table-cell">
                                                                {order.business_date} {order.slot_label}
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-400 tabular-nums">
                                                                {openedTime}
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-400 tabular-nums">
                                                                {closedTime}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className={`font-bold tabular-nums ${colors.text}`}>
                                                                    {formatDuration(order.duration_seconds)}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <div className={`w-3 h-3 rounded-full mx-auto ${colors.dot}`} />
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pagination Controls */}
                                    {luData.total > luPageSize && (
                                        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                            <button
                                                onClick={() => setLuPage(prev => Math.max(prev - 1, 1))}
                                                disabled={luPage === 1}
                                                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-slate-700 dark:text-slate-300 shadow-sm"
                                            >
                                                Anterior
                                            </button>
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 select-none">
                                                Página {luPage} de {Math.ceil(luData.total / luPageSize)}
                                            </span>
                                            <button
                                                onClick={() => setLuPage(prev => Math.min(prev + 1, Math.ceil(luData.total / luPageSize)))}
                                                disabled={luPage >= Math.ceil(luData.total / luPageSize)}
                                                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-slate-700 dark:text-slate-300 shadow-sm"
                                            >
                                                Siguiente
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })()}
                    </div>
                )}

                {/* ─────────────────────────────────── */}
                {/* TAB 4: REPORTS */}
                {/* ─────────────────────────────────── */}
                {activeTab === 'reports' && (
                    <div className="space-y-4">
                        {/* Controls */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                                        {t('drive_thru.date_range')} ({t('drive_thru.day')})
                                    </label>
                                    <input
                                        type="date"
                                        value={rpStartDate}
                                        onChange={(e) => setRpStartDate(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                                        {t('drive_thru.date_range')} ({t('drive_thru.day')})
                                    </label>
                                    <input
                                        type="date"
                                        value={rpEndDate}
                                        onChange={(e) => setRpEndDate(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                                        {t('drive_thru.group_by')}
                                    </label>
                                    <select
                                        value={rpGroupBy}
                                        onChange={(e) => setRpGroupBy(e.target.value as 'day' | 'week' | 'month')}
                                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                    >
                                        <option value="day">{t('drive_thru.day')}</option>
                                        <option value="week">{t('drive_thru.week')}</option>
                                        <option value="month">{t('drive_thru.month')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                                        {t('drive_thru.store')}
                                    </label>
                                    <select
                                        value={rpStoreId}
                                        onChange={(e) => setRpStoreId(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                    >
                                        <option value="all">{t('drive_thru.all_stores')}</option>
                                        {dtStores.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={fetchReports}
                                        disabled={rpLoading}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white font-medium text-sm rounded-xl hover:from-orange-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-500/20"
                                    >
                                        <BarChart3 size={16} />
                                        {t('drive_thru.generate_report')}
                                    </button>
                                    <button
                                        onClick={exportCSV}
                                        disabled={!rpData || rpData.periods.length === 0}
                                        className="flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium text-sm rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    >
                                        <Download size={16} />
                                        <span className="hidden sm:inline">{t('drive_thru.export_csv')}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Loading */}
                        {rpLoading && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12">
                                <div className="flex items-center justify-center">
                                    <div className="animate-pulse text-slate-400 text-sm">{t('drive_thru.loading')}</div>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {!rpLoading && rpError && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-800 p-8 text-center">
                                <AlertTriangle size={32} className="mx-auto text-rose-400 mb-2" />
                                <p className="text-rose-600 dark:text-rose-400 text-sm">{rpError}</p>
                            </div>
                        )}

                        {/* Empty */}
                        {!rpLoading && !rpError && rpGenerated && rpData && rpData.periods.length === 0 && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                                <BarChart3 size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                                <p className="text-slate-400 text-sm">{t('drive_thru.no_dt_data')}</p>
                            </div>
                        )}

                        {/* Report results */}
                        {!rpLoading && !rpError && rpData && rpData.periods.length > 0 && (
                            <>
                                {/* Summary cards */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-center">
                                        <p className="text-xs text-slate-500 mb-1">{t('drive_thru.global_avg')}</p>
                                        <p className={`text-2xl font-black tabular-nums ${rpData.summary.overall_avg <= 210 ? 'text-emerald-600' : rpData.summary.overall_avg <= 300 ? 'text-amber-600' : 'text-rose-600'}`}>
                                            {formatDuration(rpData.summary.overall_avg)}
                                        </p>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-center">
                                        <p className="text-xs text-slate-500 mb-1">{t('drive_thru.total_cars')}</p>
                                        <p className="text-2xl font-black text-slate-800 dark:text-white tabular-nums">
                                            {rpData.summary.total_cars.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-center">
                                        <p className="text-xs text-slate-500 mb-1">{t('drive_thru.pct_within_goal')}</p>
                                        <p className={`text-2xl font-black tabular-nums ${rpData.summary.pct_within_goal >= 80 ? 'text-emerald-600' : rpData.summary.pct_within_goal >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
                                            {rpData.summary.pct_within_goal}%
                                        </p>
                                    </div>
                                </div>

                                {/* Period table */}
                                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.slot')}</th>
                                                    <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.store')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.total_orders')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.avg_time')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 hidden md:table-cell">{t('drive_thru.fastest')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 hidden md:table-cell">{t('drive_thru.slowest')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 hidden lg:table-cell">{t('drive_thru.cars_per_hour')}</th>
                                                    <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">{t('drive_thru.pct_within_goal')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rpData.periods.map((period) =>
                                                    period.stores.map((store, sIdx) => {
                                                        const color = getDurationColor(store.avg_duration)
                                                        const colors = getColorClasses(color)
                                                        return (
                                                            <tr key={`${period.period}-${store.store_id}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                                {sIdx === 0 ? (
                                                                    <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-200 tabular-nums" rowSpan={period.stores.length}>
                                                                        {period.period}
                                                                    </td>
                                                                ) : null}
                                                                <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                                                                    {store.store_name}
                                                                </td>
                                                                <td className="px-4 py-3 text-center tabular-nums text-slate-600 dark:text-slate-400">
                                                                    {store.total_orders}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    <span className={`font-bold tabular-nums ${colors.text}`}>
                                                                        {formatDuration(store.avg_duration)}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-center hidden md:table-cell">
                                                                    <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                                        {formatDuration(store.min_duration)}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-center hidden md:table-cell">
                                                                    <span className="text-rose-600 dark:text-rose-400 tabular-nums">
                                                                        {formatDuration(store.max_duration)}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-center hidden lg:table-cell tabular-nums text-slate-600 dark:text-slate-400">
                                                                    {store.cars_per_hour_avg}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    <span className={`font-bold tabular-nums ${store.pct_within_goal >= 80 ? 'text-emerald-600' : store.pct_within_goal >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                                        {store.pct_within_goal}%
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        )
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Summary footer */}
                                    <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-bold text-slate-700 dark:text-slate-300">{t('drive_thru.summary')}</span>
                                            <div className="flex items-center gap-6">
                                                <div className="flex items-center gap-2">
                                                    <Clock size={14} className="text-slate-400" />
                                                    <span className="text-slate-500">{t('drive_thru.global_avg')}:</span>
                                                    <span className={`font-bold tabular-nums ${rpData.summary.overall_avg <= 210 ? 'text-emerald-600' : rpData.summary.overall_avg <= 300 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                        {formatDuration(rpData.summary.overall_avg)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Car size={14} className="text-slate-400" />
                                                    <span className="font-bold text-slate-700 dark:text-slate-300 tabular-nums">{rpData.summary.total_cars.toLocaleString()}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <TrendingUp size={14} className="text-slate-400" />
                                                    <span className={`font-bold tabular-nums ${rpData.summary.pct_within_goal >= 80 ? 'text-emerald-600' : rpData.summary.pct_within_goal >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                        {rpData.summary.pct_within_goal}% {t('drive_thru.on_target')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Ideal Time section (only when a specific store is selected) */}
                                {rpStoreId !== 'all' && (
                                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                        <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700">
                                            <div className="flex items-center gap-2">
                                                <Trophy size={16} className="text-orange-500" />
                                                <h3 className="font-bold text-slate-800 dark:text-white text-sm">{t('drive_thru.ideal_time')}</h3>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-0.5">{t('drive_thru.calculated_from')}</p>
                                        </div>

                                        {itLoading && (
                                            <div className="p-8 text-center">
                                                <div className="animate-pulse text-slate-400 text-sm">{t('drive_thru.loading')}</div>
                                            </div>
                                        )}

                                        {!itLoading && itData && (
                                            <div className="p-5">
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                                                    {/* Ideal time display */}
                                                    <div className="col-span-2 sm:col-span-4 bg-gradient-to-r from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/20 rounded-xl p-4 text-center border border-emerald-200 dark:border-emerald-800">
                                                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">{t('drive_thru.goal_time')}</p>
                                                        <p className="text-3xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                                                            {formatDuration(itData.idealTime)}
                                                        </p>
                                                        {itData.isCustom && (
                                                            <p className="text-xs text-emerald-500 mt-1">{t('drive_thru.custom')}</p>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Color legend */}
                                                <div className="grid grid-cols-3 gap-3">
                                                    <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
                                                        <div className="w-3 h-3 rounded-full bg-emerald-500 mx-auto mb-1" />
                                                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t('drive_thru.on_target')}</p>
                                                        <p className="text-xs text-emerald-600 dark:text-emerald-500 tabular-nums">≤ 3:30</p>
                                                    </div>
                                                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-center">
                                                        <div className="w-3 h-3 rounded-full bg-amber-500 mx-auto mb-1" />
                                                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{t('drive_thru.caution')}</p>
                                                        <p className="text-xs text-amber-600 dark:text-amber-500 tabular-nums">3:31 - 5:00</p>
                                                    </div>
                                                    <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-center">
                                                        <div className="w-3 h-3 rounded-full bg-rose-500 mx-auto mb-1" />
                                                        <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">{t('drive_thru.critical')}</p>
                                                        <p className="text-xs text-rose-600 dark:text-rose-500 tabular-nums">&gt; 5:00</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {!itLoading && !itData && (
                                            <div className="p-8 text-center text-slate-400 text-sm">
                                                {t('drive_thru.no_dt_data')}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* SECONDARY MODAL: RECEIPT VIEWER */}
                {orderDetailData && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in zoom-in-95 duration-200" onClick={() => setOrderDetailData(null)}>
                        <div className="bg-white dark:bg-slate-900/90 rounded-none md:rounded-xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col font-mono text-sm border-2 border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                            
                            <div className="p-4 border-b-2 border-dashed border-slate-300 dark:border-slate-700 font-bold text-center bg-white dark:bg-slate-800 md:rounded-t-xl shrink-0">
                                RECIBO TICKET #{orderDetailData.checkId}
                                {orderDetailData.loading && <p className="text-amber-500 animate-pulse text-xs mt-1">Conectando con cajero virtual...</p>}
                            </div>
                            
                            <div className="p-4 overflow-auto custom-scrollbar flex-1 bg-[#f9fafb] dark:bg-slate-900">
                                {orderDetailData.error && <div className="text-red-500 text-xs break-all bg-red-50 p-2 rounded border border-red-200">{orderDetailData.error}</div>}
                                
                                {orderDetailData.data && (
                                    <div className="space-y-4 text-slate-800 dark:text-slate-200">
                                        <div className="text-xs text-center border-b border-slate-200 dark:border-slate-800 pb-3">
                                            <div className="font-bold text-[14px] uppercase tracking-wider mb-1">SUCURSAL {orderDetailData.storeName || orderDetailData.data.restaurantService?.name || 'TACOS GAVILAN'}</div>
                                            <div>{orderDetailData.data.diningOption?.name || 'Para Llevar / Dine In'}</div>
                                            <div>{new Date(orderDetailData.data.openedDate).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</div>
                                            <div className="mt-1">Cajero/a: <span className="font-bold">{orderDetailData.cajeraName || orderDetailData.data.server?.name || 'Automático'}</span></div>
                                        </div>
                                        
                                        <div className="border-b-2 border-dashed border-slate-300 dark:border-slate-700 pb-3 space-y-1">
                                            <div className="flex justify-between font-bold text-[10px] text-slate-400 mb-2 uppercase tracking-widest">
                                                <span>ITEM</span>
                                                <span>TOTAL</span>
                                            </div>
                                            {orderDetailData.data.checks?.map((check:any, idx:number) => (
                                                <div key={idx} className="space-y-2">
                                                    {check.selections?.filter((s:any)=> !s.deleted && !s.voided).map((sel:any, i:number) => {
                                                        const qty = sel.quantity || 1;
                                                        const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0);
                                                        const originalLinePrice = unitPrice * qty;
                                                        const finalLinePrice = Number(sel.price || 0);
                                                        const inferredDiscount = originalLinePrice - finalLinePrice;
                                                        const validDiscounts = sel.appliedDiscounts?.filter((d:any)=> !d.deleted && !d.voided && d.state !== 'VOIDED' && d.state !== 'REMOVED' && d.applied !== false && Number(d.discountAmount || 0) <= inferredDiscount + 0.05) || [];

                                                        return (
                                                            <div key={i} className="flex justify-between items-start text-xs">
                                                                <span className="flex-1 pr-2">
                                                                    {qty}x {sel.displayName || sel.item?.name}
                                                                    {validDiscounts.map((d:any, j:number) => (
                                                                        <div key={`expl-${j}`} className="text-amber-600 dark:text-amber-400 text-[10px] ml-4 font-bold border-l-2 border-amber-300 pl-1 mt-0.5">
                                                                            ↳ DESC: {d.name} (-${Number(d.discountAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                                                        </div>
                                                                    ))}
                                                                    {validDiscounts.length === 0 && inferredDiscount > 0.009 && (
                                                                        <div className="text-amber-600 dark:text-amber-400 text-[10px] ml-4 font-bold border-l-2 border-amber-300 pl-1 mt-0.5">
                                                                            ↳ DESC. AL PLATILLO (-${inferredDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                                                        </div>
                                                                    )}
                                                                </span>
                                                                <span className="font-bold whitespace-nowrap">${originalLinePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                            </div>
                                                        )
                                                    })}
                                                    {/* Mostrar descuentos a nivel ticket solo como referencia visual, pero NO sumarlos al total porque Toast ya los prorrateó en los items */}
                                                    {check.appliedDiscounts?.filter((d:any)=> !d.deleted && !d.voided && d.state !== 'VOIDED' && d.state !== 'REMOVED' && d.applied !== false).map((d:any, j:number) => (
                                                        <div key={`chk-${j}`} className="flex justify-between items-start text-[11px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-500/10 p-1 -mx-1 rounded">
                                                            <span>REFERENCIA TICKET: {d.name}</span>
                                                            <span>(-${Number(d.discountAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                        
                                        <div className="text-right space-y-1 text-xs">
                                            {(() => {
                                                const checks = orderDetailData.data.checks || [];
                                                const check = checks[0];
                                                if (!check) return null;

                                                // Cálculo matemático puro basado en el costo real vs el cobrado
                                                const subtotalBruto = check.selections?.filter((s:any)=> !s.deleted && !s.voided).reduce((sum: number, sel: any) => {
                                                    const qty = sel.quantity || 1;
                                                    const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0);
                                                    return sum + (unitPrice * qty);
                                                }, 0) || 0;

                                                const subtotalNeto = Number(check.amount || 0);
                                                const totalDiscounts = Math.max(0, subtotalBruto - subtotalNeto);

                                                return (
                                                    <>
                                                        <div className="flex justify-between text-slate-500"><span>Subtotal bruto:</span> <span>${subtotalBruto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                        {totalDiscounts > 0.009 && (
                                                            <div className="flex justify-between font-bold text-amber-600 dark:text-amber-400"><span>Descuentos prorrateados aplicados:</span> <span>-${totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                        )}
                                                        <div className="flex justify-between text-slate-700 dark:text-slate-300 font-semibold mt-1"><span>Subtotal neto:</span> <span>${subtotalNeto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                        <div className="flex justify-between text-slate-500"><span>Tax:</span> <span>${Number(check.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                        <div className="flex justify-between font-bold text-lg mt-2 text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-800 pt-2"><span>TOTAL:</span> <span>${(Number(check.totalAmount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                    </>
                                                );
                                            })()}
                                        </div>

                                        {orderDetailData.data.checks?.[0]?.payments?.length > 0 && (
                                            <div className="text-xs pt-3 border-t-2 border-dashed border-slate-300 dark:border-slate-700">
                                                <div className="font-bold text-slate-400 mb-1">PAGOS APLICADOS:</div>
                                                {orderDetailData.data.checks?.[0]?.payments.map((p:any, pIdx:number) => (
                                                    <div key={pIdx} className="flex justify-between text-slate-600 dark:text-slate-400">
                                                        <span>{p.type || 'Pago'} {p.originalPaymentStatus && p.originalPaymentStatus !== 'NONE' ? '(Original)' : ''} {p.refundStatus && p.refundStatus !== 'NONE' ? '(Reembolsado)' : ''}</span>
                                                        <span>${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            
                            <div className="p-3 text-center border-t-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 md:rounded-b-xl shrink-0">
                                <button onClick={() => setOrderDetailData(null)} className="text-xs uppercase tracking-widest font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 px-6 py-2 rounded transition-colors w-full border border-slate-200 dark:border-slate-700 cursor-pointer">
                                    Cerrar Recibo
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────
// Exportación con ProtectedRoute
// ─────────────────────────────────────────────────────────

export default function DriveThruPage() {
    return (
        <ProtectedRoute allowedRoles={['manager', 'supervisor', 'admin']}>
            <DriveThruContent />
        </ProtectedRoute>
    )
}

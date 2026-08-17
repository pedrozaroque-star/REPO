/**
 * @module inventory/orders/page
 * @description Página principal del módulo de Pedidos Automáticos a Bodega.
 *              Diseño de 2 pestañas:
 *              - PEDIDO DEL DÍA: Vista unificada que combina sobrantes + orden calculada
 *                en una sola tabla. El manager ingresa el sobrante inline y ve el pedido
 *                auto-calculado al instante.
 *              - CONFIG SEMANAL: Configuración de BASE (PAR) semanal con tabla de 7 días
 *                editables + PAR Ideal de referencia.
 *
 * @businessRules
 * - FÓRMULA CORE: ORDER = PAR_mañana − Sobrante_hoy
 * - Viernes no lleva BASE; Sábado cubre Sáb+Dom juntos
 * - Redondeos: Papelitos → CEILING(x, 30), Quesadillas → CEILING(x, 4)
 * - Lunes usa Sobrante_Domingo de la semana anterior
 * - Rollover solo si TODOS los items tienen sobrante de Domingo
 * - El día laboral empieza a las 6:00 AM
 * - Items con qb_item_id === 'TRACK_ONLY' aparecen en sección de solo rastreo
 * - Permite forzar el PAR de otro día de la semana (por ejemplo, usar PAR de viernes en otro día) en caso de cierres tempranos, días festivos o eventos de venta especial.
 *
 * @dataFlow
 * - inventory_items (con excel_reference) → items del pedido
 * - inventory_weekly_bases → PAR semanal por tienda/item/semana
 * - inventory_counts → Sobrantes diarios por tienda/item/fecha
 * - inventory_orders + inventory_order_lines → Órdenes guardadas
 * - inventory_par_ideal → PAR de referencia
 * - quickbooks_mappings → QB item IDs para Estimates
 *
 * @notes
 * - [2026-06-24] Reescritura total. Eliminados todos los datos hardcodeados.
 *   Ahora todo viene de la BD. Integración con QuickBooks para Estimates.
 * - [2026-07-01] Rediseño a 2 pestañas (daily_order + weekly_config).
 *   Sobrante inline editable en la tabla del pedido diario.
 * - [2026-07-02] Añadida edición de estimados anteriores en modal responsivo e independiente.
 *   Añadido selector inline de copia de PAR de un día a otro en la configuración semanal.
 */
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Package, ClipboardList, ShoppingCart, BarChart3,
    ArrowLeft, ArrowRight, Copy, Save, Send, RefreshCcw,
    Check, X, Link, AlertTriangle, ChevronDown, Download, Info, Trash2, Printer, Eye, EyeOff
} from 'lucide-react'
import {
    fetchOrderableItems, fetchAllInventoryItems, fetchWeeklyData,
    calculateDailyOrder, updateWeeklyBase, updateDailyLeftover,
    clonePreviousWeekBases, copyFromParIdeal, linkExcelItem,
    saveOrderDraft, executeWeekRollover, fetchAnalysisData,
    saveWeeklyBases, saveSingleItemWeeklyBase, fetchMappedItems, fetchHistoryData,
    type OrderType
} from './actions'
import {
    getMonday, getBusinessMonday, addDays,
    type OrderableItem, type WeeklyBaseRecord, type ParIdealRecord,
    type CalculatedOrderLine
} from './utils'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'
import { useLanguage } from '@/lib/i18n'

// ============================================================================
// HELPERS
// ============================================================================
function getLocalBusinessDate(d: Date = new Date()): string {
    const year = d.getFullYear()
    const month = d.getMonth()
    const date = d.getDate()
    const hours = d.getHours()

    const localDate = new Date(year, month, date, 12, 0, 0)
    if (hours < 6) {
        localDate.setDate(localDate.getDate() - 1)
    }

    const y = localDate.getFullYear()
    const m = String(localDate.getMonth() + 1).padStart(2, '0')
    const r = String(localDate.getDate()).padStart(2, '0')
    return `${y}-${m}-${r}`
}

// ============================================================================
// TYPES
// ============================================================================
type TabId = 'daily_order' | 'weekly_config' | 'history' | 'leftovers'

const WEEK_DAYS = [
    { key: 'mon', baseField: 'mon_par', offset: 0 },
    { key: 'tue', baseField: 'tue_par', offset: 1 },
    { key: 'wed', baseField: 'wed_par', offset: 2 },
    { key: 'thu', baseField: 'thu_par', offset: 3 },
    { key: 'fri', baseField: 'fri_par', offset: 4 },
    { key: 'sat', baseField: 'sat_par', offset: 5 },
    { key: 'sun', baseField: 'sun_par', offset: 6 },
]

function getTrafficLight(pct: number, isSaturday: boolean) {
    if (isSaturday) {
        // Sábado: ≥40% = rojo, 15-40% = verde, <15% = amarillo
        if (pct >= 40) return { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: '⬇️' }
        if (pct >= 15) return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: '✅' }
        return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', label: '⬆️' }
    }
    // L-V: ≥60% = rojo, 20-60% = verde, <20% = amarillo
    if (pct >= 60) return { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: '⬇️' }
    if (pct >= 20) return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: '✅' }
    return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', label: '⬆️' }
}

// ============================================================================
// COMPONENT
// ============================================================================
const supabase = createClient()

export default function InventoryOrdersPage() {
    const { user } = useAuth()
    const { t, language } = useLanguage()

    // --- State ---
    const [activeMonday, setActiveMonday] = useState<string>(getBusinessMonday(new Date()))
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    const [activeTab, setActiveTab] = useState<TabId>('daily_order')
    const [orderType, setOrderType] = useState<OrderType>('daily')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [hasBaseChanges, setHasBaseChanges] = useState(false)
    const [savingPar, setSavingPar] = useState(false)
    const [weeklyRightView, setWeeklyRightView] = useState<'leftovers' | 'par_ideal'>('leftovers')
    const lastSyncedKeyRef = useRef('')
    const [qbAuthRequired, setQbAuthRequired] = useState(false)

    // Data
    const [items, setItems] = useState<OrderableItem[]>([])
    const [allItems, setAllItems] = useState<any[]>([])
    const [bases, setBases] = useState<Record<string, WeeklyBaseRecord>>({})
    const [nextWeekBases, setNextWeekBases] = useState<Record<string, WeeklyBaseRecord>>({})
    const [originalBases, setOriginalBases] = useState<Record<string, WeeklyBaseRecord>>({})
    const [parIdeal, setParIdeal] = useState<Record<string, ParIdealRecord>>({})
    const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
    const [orderLines, setOrderLines] = useState<CalculatedOrderLine[]>([])
    const [adjustments, setAdjustments] = useState<Record<string, number>>({})
    const [orders, setOrders] = useState<any[]>([])
    const [analysisData, setAnalysisData] = useState<any>(null)

    // Emergency / extraordinary items states
    const [mappedItems, setMappedItems] = useState<any[]>([])
    const [extraordinarySearch, setExtraordinarySearch] = useState('')
    const [showExtraordinaryDropdown, setShowExtraordinaryDropdown] = useState(false)

    // Linking modal
    const [linkModal, setLinkModal] = useState<{ open: boolean; excelName: string }>({ open: false, excelName: '' })
    const [selectedItemId, setSelectedItemId] = useState('')
    const [searchTerm, setSearchTerm] = useState('')
    const [showIdealInfo, setShowIdealInfo] = useState(false)
    const [showInfoModal, setShowInfoModal] = useState(false)
    const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null)

    // QB sending state
    const [sendingToQb, setSendingToQb] = useState(false)
    const [syncingQb, setSyncingQb] = useState(false)
    const [orderNotes, setOrderNotes] = useState('')
    const [overrideDayField, setOverrideDayField] = useState<string>('auto')
    const [selectedOrderDate, setSelectedOrderDate] = useState<string>(() => getLocalBusinessDate(new Date()))
    const [copySrcDay, setCopySrcDay] = useState<string>('mon_par')
    const [copyTgtDay, setCopyTgtDay] = useState<string>('all')
    const [parBoostPercent, setParBoostPercent] = useState<number>(0)

    const [champurradoForecast, setChampurradoForecast] = useState<any>(null)

    useEffect(() => {
        if (!storeId) return
        fetch(`/api/inventory/champurrado-forecast?storeId=${storeId}`)
            .then(res => res.json())
            .then(data => {
                if (!data.error) {
                    setChampurradoForecast(data)
                }
            })
            .catch(console.error)
    }, [storeId])

    const renderItemName = (name: string, className: string = "font-semibold") => {
        if (!name) return name;
        const isChampurrado = name.toLowerCase().includes('champurrado')
        
        if (!isChampurrado || !champurradoForecast) return <span className={className}>{name}</span>;

        const gallons = champurradoForecast.suggested_daily_gallons ?? 0
        const years = champurradoForecast.historical_years_count ?? 0
        const confidence = champurradoForecast.confidence ?? 'NONE'

        // No mostrar sugerencia si no hay datos útiles
        if (confidence === 'NONE' || gallons <= 0) return <span className={className}>{name}</span>;

        const confColor = confidence === 'HIGH' ? 'text-emerald-600' : confidence === 'MEDIUM' ? 'text-amber-600' : 'text-red-600'

        return (
            <div className="flex flex-col">
                <span className={className}>{name}</span>
                <span className={`text-[10px] ${confColor} font-semibold leading-tight mt-0.5`}>
                    ☕ ~{gallons} gal/día ({years} {language === 'es' ? (years === 1 ? 'año' : 'años') : (years === 1 ? 'yr' : 'yrs')})
                </span>
            </div>
        )
    }

    // Computed
    const todayStr = getLocalBusinessDate(new Date())
    const isCurrentWeek = activeMonday === getMonday(new Date(todayStr + 'T12:00:00'))

    // Edit modal states for past estimates
    const [editModal, setEditModal] = useState<{ open: boolean; order: any | null }>({ open: false, order: null })
    const [modalLines, setModalLines] = useState<any[]>([])
    const [modalNotes, setModalNotes] = useState('')
    const [savingModal, setSavingModal] = useState(false)
    const [modalReadOnly, setModalReadOnly] = useState(false)
    const [modalExtraSearch, setModalExtraSearch] = useState('')
    const [showModalExtraDropdown, setShowModalExtraDropdown] = useState(false)
    const [isLiveSaving, setIsLiveSaving] = useState(false)

    // Column visibility toggles (with localStorage persistence)
    const [showParIdealCol, setShowParIdealCol] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('teg_show_par_ideal_col')
            return saved !== null ? JSON.parse(saved) : true
        }
        return true
    })

    const [showSuggestedCol, setShowSuggestedCol] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('teg_show_suggested_col')
            return saved !== null ? JSON.parse(saved) : true
        }
        return true
    })

    const toggleParIdealCol = () => {
        setShowParIdealCol(prev => {
            const next = !prev
            if (typeof window !== 'undefined') {
                localStorage.setItem('teg_show_par_ideal_col', JSON.stringify(next))
            }
            return next
        })
    }

    const toggleSuggestedCol = () => {
        setShowSuggestedCol(prev => {
            const next = !prev
            if (typeof window !== 'undefined') {
                localStorage.setItem('teg_show_suggested_col', JSON.stringify(next))
            }
            return next
        })
    }

    // History tab state
    const [historyMonday, setHistoryMonday] = useState<string>(getBusinessMonday(new Date()))
    const [historyOrders, setHistoryOrders] = useState<any[]>([])
    const [historyCounts, setHistoryCounts] = useState<Record<string, Record<string, number>>>({})
    const [historyBases, setHistoryBases] = useState<Record<string, any>>({})
    const [historyLoading, setHistoryLoading] = useState(false)
    const [sendingModal, setSendingModal] = useState(false)

    const weekDays = WEEK_DAYS.map(d => ({
        ...d,
        dateStr: addDays(activeMonday, d.offset),
        label: t(`bodegaOrders.${d.key}`),
    }))

    // --- Load stores ---
    const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name').eq('is_active', true).order('name')
            if (data) {
                // Admins/Supervisors ven todas las tiendas; managers/assistants solo ven su(s) tienda(s) asignada(s)
                let filteredStores = data
                if (!isSuper && user) {
                    const userStoreIds: string[] = []
                    if (user.store_id) userStoreIds.push(String(user.store_id))
                    if (user.store_ids?.length) user.store_ids.forEach(sid => { if (!userStoreIds.includes(String(sid))) userStoreIds.push(String(sid)) })
                    if (userStoreIds.length > 0) {
                        filteredStores = data.filter(s => userStoreIds.includes(String(s.id)))
                    }
                }
                setStores(filteredStores)
                if (!isSuper && user?.store_id) {
                    setStoreId(user.store_id)
                } else {
                    const saved = localStorage.getItem('teg_preparador_store')
                    if (saved && filteredStores.find(s => s.id == saved)) setStoreId(saved)
                    else if (filteredStores.length > 0) setStoreId(filteredStores[0].id)
                }
            }
        }
        if (user !== undefined) fetchStores()
    }, [user])

    // --- Load all data ---
    const loadData = useCallback(async () => {
        if (!storeId) return
        setLoading(true)
        try {
            // 1. Cargar inmediatamente los datos locales desde la base de datos (Supabase)
            const [orderableItems, allInvItems, mappedInvItems, weekData] = await Promise.all([
                fetchOrderableItems(storeId, orderType),
                fetchAllInventoryItems(),
                fetchMappedItems(),
                fetchWeeklyData(storeId, activeMonday, orderType),
            ])
            setItems(orderableItems)
            setAllItems(allInvItems)
            setMappedItems(mappedInvItems)
            setBases(weekData.bases)
            setNextWeekBases((weekData as any).nextWeekBases || {})
            setOriginalBases(JSON.parse(JSON.stringify(weekData.bases || {})))
            setParIdeal(weekData.parIdeal)
            setCounts(weekData.counts)
            setOrders(weekData.orders)
            setHasBaseChanges(false)

            // Pre-cargar notas y ajustes de la orden de hoy
            const todayOrder = weekData.orders?.find((o: any) => o.order_date === selectedOrderDate)
            
            // Extract extraordinary lines saved in database
            const extraordinarySavedLines: CalculatedOrderLine[] = []
            if (todayOrder && todayOrder.inventory_order_lines) {
                const templateItemIds = new Set(orderableItems.map(i => i.id))
                todayOrder.inventory_order_lines.forEach((l: any) => {
                    if (!templateItemIds.has(l.inventory_item_id)) {
                        const itemMeta = mappedInvItems.find(mi => mi.id === l.inventory_item_id)
                        extraordinarySavedLines.push({
                            inventory_item_id: l.inventory_item_id,
                            item_name: itemMeta?.name || `Product #${l.inventory_item_id}`,
                            unit_description: itemMeta?.order_unit_description || itemMeta?.unit_type || 'Unit',
                            par_value: l.par_value || 0,
                            par_ideal_value: 0,
                            leftover_value: l.leftover_value,
                            calculated_qty: l.calculated_qty || 0,
                            adjusted_qty: l.adjusted_qty ?? undefined,
                            rounding_rule: 'none',
                            qb_item_id: itemMeta?.qb_item_id || l.qb_item_id || 'UNKNOWN',
                            is_extraordinary: true
                        })
                    }
                })
            }

            if (todayOrder) {
                setOrderNotes(todayOrder.notes || '')
                const savedAdjustments: Record<string, number> = {}
                todayOrder.inventory_order_lines?.forEach((l: any) => {
                    if (l.adjusted_qty !== null && l.adjusted_qty !== undefined) {
                        savedAdjustments[l.inventory_item_id] = l.adjusted_qty
                    }
                })
                setAdjustments(savedAdjustments)
            } else {
                setOrderNotes('')
                setAdjustments({})
            }

            // Calculate order
            if (isCurrentWeek) {
                const lines = await calculateDailyOrder(
                    storeId, selectedOrderDate, orderableItems,
                    weekData.bases, weekData.counts, activeMonday,
                    weekData.parIdeal, overrideDayField, parBoostPercent,
                    orderType, (weekData as any).nextWeekBases
                )
                setOrderLines([...lines, ...extraordinarySavedLines])
            }

            // 2. Apagar el spinner de carga de inmediato para visualización instantánea
            setLoading(false)

            // 3. Lanzar la sincronización en segundo plano con QuickBooks Online sin bloquear al usuario
            const syncKey = `${storeId}_${orderType}_${activeMonday}`
            if (syncKey !== lastSyncedKeyRef.current) {
                fetch('/api/inventory/sync-quickbooks', { method: 'POST' })
                    .then(async (res) => {
                        const data = await res.json()
                        if (res.status === 401 || data.reauth_url) {
                            setQbAuthRequired(true)
                        } else {
                            setQbAuthRequired(false)
                            lastSyncedKeyRef.current = syncKey
                            
                            // Si el sync actualizó templates o empaques, recargar silenciosamente los estados
                            if (data.templates_updated > 0 || data.items_updated > 0) {
                                console.log('[QB-Sync] Cambios en QB detectados en segundo plano. Recargando items...');
                                const [freshItems, freshAllItems, freshMapped] = await Promise.all([
                                    fetchOrderableItems(storeId, orderType),
                                    fetchAllInventoryItems(),
                                    fetchMappedItems()
                                ])
                                setItems(freshItems)
                                setAllItems(freshAllItems)
                                setMappedItems(freshMapped)
                            }
                        }
                    })
                    .catch((e) => {
                        console.error('[QB-Sync] Error en la sincronización en segundo plano:', e)
                    })
            }
        } catch (error) {
            console.error('Error loading data:', error)
            setLoading(false)
        }
    }, [storeId, activeMonday, overrideDayField, selectedOrderDate, orderType, parBoostPercent])

    useEffect(() => { loadData() }, [loadData])

    // Recalcular orden localmente al cambiar el día de base a usar o la fecha seleccionada o el incremento de PAR
    useEffect(() => {
        if (!loading && storeId && items.length > 0 && bases && Object.keys(bases).length > 0) {
            calculateDailyOrder(
                storeId, selectedOrderDate, items,
                bases, counts, activeMonday,
                parIdeal, overrideDayField, parBoostPercent,
                orderType, nextWeekBases
            ).then(newLines => {
                setOrderLines(prev => {
                    const prevExtraordinary = prev.filter(l => l.is_extraordinary)
                    return [...newLines, ...prevExtraordinary]
                })
            })
        }
    }, [loading, overrideDayField, storeId, selectedOrderDate, items, bases, nextWeekBases, counts, activeMonday, parIdeal, parBoostPercent, orderType])

    // Load analysis data when tab switches
    useEffect(() => {
        if (activeTab === 'analysis' as any && storeId && !analysisData) {
            fetchAnalysisData(storeId).then(setAnalysisData)
        }
    }, [activeTab, storeId])

    // Load history/leftovers data function
    const loadHistoryData = useCallback(async () => {
        if (!storeId) return
        setHistoryLoading(true)
        try {
            const result = await fetchHistoryData(storeId, historyMonday)
            setHistoryOrders(result.orders)
            setHistoryCounts(result.counts)
            setHistoryBases(result.bases)
        } catch (e) {
            console.error('Error loading history data:', e)
        } finally {
            setHistoryLoading(false)
        }
    }, [storeId, historyMonday])

    useEffect(() => {
        if (!storeId || (activeTab !== 'history' && activeTab !== 'leftovers')) return
        loadHistoryData()
    }, [activeTab, storeId, historyMonday, loadHistoryData])

    // --- Edit Modal Handlers ---
    function handleOpenEditModal(order: any) {
        // Determinar si el pedido es de hoy (editable) o de otro día (solo consulta)
        const isEditable = order.order_date === todayStr
        setModalReadOnly(!isEditable)
        setEditModal({ open: true, order })
        setModalNotes(order.notes || '')
        setModalExtraSearch('')
        setShowModalExtraDropdown(false)
        
        // Mapear las líneas guardadas de la orden con sus metadatos de insumos
        const lines = order.inventory_order_lines.map((line: any) => {
            const item = allItems.find(i => i.id === line.inventory_item_id)
            return {
                ...line,
                item_name: item?.name || 'Insumo Desconocido',
                unit_description: item?.order_unit_description || '',
                qb_item_id: item?.qb_item_id || null,
                purchase_unit_cost: item?.purchase_unit_cost,
                unit_measure: item?.unit_measure
            }
        })
        setModalLines(lines)
    }

    function handleModalLeftoverChange(itemId: string, value: string) {
        const numVal = value === '' ? null : (parseFloat(value) || 0)
        setModalLines(prev => prev.map(line => {
            if (line.inventory_item_id !== itemId) return line
            const leftoverVal = numVal ?? 0
            const calculatedQty = line.par_value - leftoverVal
            return { ...line, leftover_value: numVal, calculated_qty: calculatedQty }
        }))
    }

    function handleModalAdjustmentChange(itemId: string, value: string) {
        const numVal = value === '' ? null : (parseFloat(value) || 0)
        setModalLines(prev => prev.map(line => {
            if (line.inventory_item_id !== itemId) return line
            return { ...line, adjusted_qty: numVal }
        }))
    }

    async function handleSaveModalChanges() {
        if (!editModal.order || !storeId) return
        setSavingModal(true)
        try {
            const lines = modalLines.map(l => ({
                inventory_item_id: l.inventory_item_id,
                calculated_qty: l.calculated_qty,
                adjusted_qty: l.adjusted_qty,
                par_value: l.par_value,
                leftover_value: l.leftover_value ?? 0
            }))

            const res = await saveOrderDraft(
                storeId, 
                editModal.order.order_date, 
                editModal.order.week_start_date || activeMonday, // Usar la semana real de la orden, no la actual
                lines, 
                user?.name, 
                modalNotes || undefined,
                editModal.order.order_type || 'daily'
            )
            if (res.error) {
                alert(res.error)
            } else {
                alert(t('bodegaOrders.savedLocal'))
                setEditModal({ open: false, order: null })
                await Promise.all([loadData(), loadHistoryData()])
            }
        } catch (e: any) {
            alert(t('bodegaOrders.errorSave') + e.message)
        } finally {
            setSavingModal(false)
        }
    }

    async function handleSendModalToQb() {
        if (!editModal.order || !storeId) return
        setSendingModal(true)
        try {
            const lines = modalLines.map(l => ({
                inventory_item_id: l.inventory_item_id,
                calculated_qty: l.calculated_qty,
                adjusted_qty: l.adjusted_qty,
                par_value: l.par_value,
                leftover_value: l.leftover_value ?? 0
            }))

            const saveRes = await saveOrderDraft(
                storeId, 
                editModal.order.order_date, 
                editModal.order.week_start_date || activeMonday, // Usar la semana real de la orden, no la actual
                lines, 
                user?.name, 
                modalNotes || undefined,
                editModal.order.order_type || 'daily'
            )
            if (saveRes.error) {
                alert(saveRes.error)
                setSendingModal(false)
                return
            }

            const res = await fetch('/api/inventory/orders/send-to-qb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: saveRes.orderId, userEmail: user?.email })
            })
            const data = await res.json()

            if (res.status === 401 || data.error === 'token_expired' || data.reauth_url) {
                alert(t('bodegaOrders.qbReauthModalAlert'))
                setSendingModal(false)
                return
            }

            if (data.error) {
                alert(`Error: ${data.error}`)
            } else {
                alert(t('bodegaOrders.orderSentDesc', { number: data.estimateNumber }))
                setEditModal({ open: false, order: null })
                await Promise.all([loadData(), loadHistoryData()])
            }
        } catch (e: any) {
            alert(t('bodegaOrders.errorSendQb') + e.message)
        } finally {
            setSendingModal(false)
        }
    }

    async function handleCopyDayPar(src: string, tgt: string) {
        if (src === tgt) {
            alert(t('bodegaOrders.sameDayError'))
            return
        }
        const labelSrc = t(`bodegaOrders.dayLabels.${src}`)
        const labelTgt = t(`bodegaOrders.dayLabels.${tgt}`)
        const msg = t('bodegaOrders.confirmCopyDayPar')
            .replace('{src}', labelSrc)
            .replace('{tgt}', labelTgt)

        if (!confirm(msg)) return

        const nextBases = { ...bases }
        const updatedList: any[] = []

        Object.keys(nextBases).forEach(itemId => {
            const itemBase = { ...nextBases[itemId] } as any
            if (!itemBase.inventory_item_id) itemBase.inventory_item_id = itemId
            const sourceVal = itemBase[src] || 0
            if (tgt === 'all') {
                itemBase.mon_par = sourceVal
                itemBase.tue_par = sourceVal
                itemBase.wed_par = sourceVal
                itemBase.thu_par = sourceVal
                itemBase.fri_par = sourceVal
                itemBase.sat_par = sourceVal
                itemBase.sun_par = sourceVal
            } else {
                itemBase[tgt] = sourceVal
            }
            nextBases[itemId] = itemBase
            updatedList.push({
                inventory_item_id: itemBase.inventory_item_id,
                mon_par: itemBase.mon_par || 0,
                tue_par: itemBase.tue_par || 0,
                wed_par: itemBase.wed_par || 0,
                thu_par: itemBase.thu_par || 0,
                fri_par: itemBase.fri_par || 0,
                sat_par: itemBase.sat_par || 0,
                sun_par: itemBase.sun_par || 0
            })
        })
        
        setBases(nextBases)
        setHasBaseChanges(true)

        // Live Auto-Save to Supabase
        if (storeId && updatedList.length > 0) {
            setIsLiveSaving(true)
            try {
                await saveWeeklyBases(storeId, activeMonday, updatedList)
            } catch (err) {
                console.error('Error auto-saving copied day PAR:', err)
            } finally {
                setIsLiveSaving(false)
            }
        }
    }

    function handleOrderDateChange(dateStr: string) {
        setSelectedOrderDate(dateStr)
        const targetMonday = getMonday(new Date(dateStr + 'T12:00:00'))
        if (targetMonday !== activeMonday) {
            setActiveMonday(targetMonday)
        }
    }

    function handleUndoBases() {
        if (!confirm(t('bodegaOrders.confirmUndoBases'))) return
        setBases(JSON.parse(JSON.stringify(originalBases)))
        setHasBaseChanges(false)
    }

    // Mapping de días a desplazamientos
    const fieldIndexMap: Record<string, number> = {
        mon_par: 0, tue_par: 1, wed_par: 2, thu_par: 3, fri_par: 4, sat_par: 5, sun_par: 6
    }

    // --- Handlers ---
    async function handleBaseChange(itemId: string, field: string, value: string) {
        if (!storeId) return
        let numVal = value === '' ? 0 : (parseFloat(value) || 0)
        const item = items.find(i => i.id === itemId)
        if (item && numVal > 0) {
            if (item.order_rounding_rule === 'ceiling_60') numVal = Math.ceil(numVal / 60) * 60
            else if (item.order_rounding_rule === 'ceiling_30') numVal = Math.ceil(numVal / 30) * 30
            else if (item.order_rounding_rule === 'ceiling_4') numVal = Math.ceil(numVal / 4) * 4
        }

        const dayOffset = fieldIndexMap[field] ?? 0
        const fieldDateStr = addDays(activeMonday, dayOffset)

        // Verificar si el día ya pasó o ya tiene sobrante capturado
        const hasLeftover = counts[itemId]?.[fieldDateStr] !== undefined && counts[itemId]?.[fieldDateStr] !== null
        const isPastDay = fieldDateStr < todayStr
        const isLockedForCurrentWeek = hasLeftover || isPastDay

        const nextWeekMonday = addDays(activeMonday, 7)
        const b = bases[itemId] || { inventory_item_id: itemId, mon_par: 0, tue_par: 0, wed_par: 0, thu_par: 0, fri_par: 0, sat_par: 0, sun_par: 0 }

        // Siempre actualizar en el estado local `bases` para que el campo de texto muestre lo que el usuario escribió
        const updatedItemBase = { ...b, inventory_item_id: itemId, [field]: numVal }
        setBases(prev => ({ ...prev, [itemId]: updatedItemBase as any }))
        setHasBaseChanges(true)

        // También actualizar en el estado local `nextWeekBases`
        const nextBaseObj = nextWeekBases[itemId] || b
        const updatedNextWeekBase = { ...nextBaseObj, inventory_item_id: itemId, [field]: numVal }
        setNextWeekBases(prev => ({ ...prev, [itemId]: updatedNextWeekBase as any }))

        setIsLiveSaving(true)

        if (isLockedForCurrentWeek) {
            // Regla de negocio: Si el día YA tiene sobrante capturado o ya pasó,
            // Guardamos el nuevo PAR exclusivamente para la PRÓXIMA semana en Supabase.
            // El histórico de esta semana y el cálculo del % de sobrante usan originalBases.
            saveSingleItemWeeklyBase(storeId, nextWeekMonday, updatedNextWeekBase as any)
                .then(() => setIsLiveSaving(false))
                .catch(err => {
                    console.error('Error auto-saving PAR base for next week:', err)
                    setIsLiveSaving(false)
                })
        } else {
            // Si AÚN NO tiene sobrante capturado y es hoy/futuro:
            // Actualizamos en la semana actual (activeMonday) Y en la próxima semana (nextWeekMonday).
            Promise.all([
                saveSingleItemWeeklyBase(storeId, activeMonday, updatedItemBase as any),
                saveSingleItemWeeklyBase(storeId, nextWeekMonday, updatedItemBase as any)
            ])
                .then(() => setIsLiveSaving(false))
                .catch(err => {
                    console.error('Error auto-saving PAR base:', err)
                    setIsLiveSaving(false)
                })
        }
    }

    async function handleLiquidsParChange(itemId: string, value: string) {
        if (!storeId) return
        let numVal = value === '' ? 0 : (parseFloat(value) || 0)
        const item = items.find(i => i.id === itemId)
        if (item && numVal > 0) {
            if (item.order_rounding_rule === 'ceiling_60') numVal = Math.ceil(numVal / 60) * 60
            else if (item.order_rounding_rule === 'ceiling_30') numVal = Math.ceil(numVal / 30) * 30
            else if (item.order_rounding_rule === 'ceiling_4') numVal = Math.ceil(numVal / 4) * 4
        }

        const nextWeekMonday = addDays(activeMonday, 7)

        const b = bases[itemId] || { inventory_item_id: itemId, mon_par: 0, tue_par: 0, wed_par: 0, thu_par: 0, fri_par: 0, sat_par: 0, sun_par: 0 }
        const updatedItemBase = {
            ...b,
            inventory_item_id: itemId,
            mon_par: numVal,
            tue_par: numVal,
            wed_par: numVal,
            thu_par: numVal,
            fri_par: numVal,
            sat_par: numVal,
            sun_par: numVal
        }

        const newBases = { ...bases, [itemId]: updatedItemBase as any }
        setBases(newBases)
        setNextWeekBases(prev => ({ ...prev, [itemId]: updatedItemBase as any }))
        setHasBaseChanges(true)

        setIsLiveSaving(true)

        try {
            await Promise.all([
                saveSingleItemWeeklyBase(storeId, activeMonday, updatedItemBase as any),
                saveSingleItemWeeklyBase(storeId, nextWeekMonday, updatedItemBase as any)
            ])

            const lines = await calculateDailyOrder(
                storeId, selectedOrderDate, items,
                newBases, counts, activeMonday,
                parIdeal, overrideDayField, parBoostPercent,
                orderType, nextWeekBases
            )
            setOrderLines(lines)
        } catch (err) {
            console.error('Error auto-saving liquids PAR base:', err)
        } finally {
            setIsLiveSaving(false)
        }
    }

    async function handleSavePar() {
        if (!storeId) return
        setSavingPar(true)
        try {
            const nextWeekMonday = addDays(activeMonday, 7)
            const currentWeekBasesList: any[] = []
            const nextWeekBasesList: any[] = []

            Object.entries(bases).forEach(([itemId, b]: [string, any]) => {
                const itemCounts = counts[itemId] || {}
                const currentBaseObj = originalBases[itemId] || b
                const nextBaseObj = nextWeekBases[itemId] || b
                
                const currentBasePayload: any = { inventory_item_id: itemId }
                const nextBasePayload: any = { inventory_item_id: itemId }

                const fields = ['mon_par', 'tue_par', 'wed_par', 'thu_par', 'fri_par', 'sat_par', 'sun_par']
                fields.forEach((f, idx) => {
                    const fieldDateStr = addDays(activeMonday, idx)
                    const hasLeftover = itemCounts[fieldDateStr] !== undefined && itemCounts[fieldDateStr] !== null
                    const isPastDay = fieldDateStr < todayStr
                    const isLocked = (orderType === 'daily') ? (hasLeftover || isPastDay) : false

                    nextBasePayload[f] = (nextBaseObj as any)[f] !== undefined ? (nextBaseObj as any)[f] : ((b as any)[f] || 0)

                    if (isLocked) {
                        currentBasePayload[f] = (currentBaseObj as any)[f] || 0
                    } else {
                        currentBasePayload[f] = (b as any)[f] || 0
                    }
                })

                currentWeekBasesList.push(currentBasePayload)
                nextWeekBasesList.push(nextBasePayload)
            })

            await saveWeeklyBases(storeId, activeMonday, currentWeekBasesList)
            await saveWeeklyBases(storeId, nextWeekMonday, nextWeekBasesList)

            const successMsg = language === 'es'
                ? `⚡ PAR Guardado exitosamente. Se actualizaron las bases de la semana actual (${activeMonday}) y la próxima semana (${nextWeekMonday}).`
                : `⚡ PAR saved successfully. Bases updated for current week (${activeMonday}) and next week (${nextWeekMonday}).`
            alert(successMsg)
            setOriginalBases(JSON.parse(JSON.stringify(bases)))
            setHasBaseChanges(false)
            
            // Recalcular orden del día preservando insumos extraordinarios
            const lines = await calculateDailyOrder(
                storeId, selectedOrderDate, items,
                bases, counts, activeMonday,
                parIdeal, overrideDayField, parBoostPercent,
                orderType, nextWeekBases
            )
            setOrderLines(prev => {
                const prevExtraordinary = prev.filter(l => l.is_extraordinary)
                return [...lines, ...prevExtraordinary]
            })
        } catch (e: any) {
            alert(t('bodegaOrders.errorSave') + e.message)
        } finally {
            setSavingPar(false)
        }
    }

    async function handleLeftoverChange(itemId: string, dateStr: string, value: string) {
        if (!storeId) return
        if (value === '') {
            const itemCounts = counts[itemId] || {}
            const newCounts = { ...itemCounts }
            delete newCounts[dateStr]
            setCounts({ ...counts, [itemId]: newCounts })
            await updateDailyLeftover(storeId, itemId, dateStr, null)
            return
        }
        const numVal = parseFloat(value) || 0
        const itemCounts = counts[itemId] || {}
        setCounts({ ...counts, [itemId]: { ...itemCounts, [dateStr]: numVal } })
        await updateDailyLeftover(storeId, itemId, dateStr, numVal)
    }

    /** Handler para edición inline de sobrantes en la tabla del pedido diario.
     *  Guarda en DB + recalcula la línea de orden en tiempo real. */
    async function handleInlineLeftoverChange(itemId: string, value: string) {
        // 1. Update counts state + save to DB
        await handleLeftoverChange(itemId, selectedOrderDate, value)

        // 2. Recalculate that specific order line
        const numVal = value === '' ? null : (parseFloat(value) || 0)
        setOrderLines(prev => prev.map(line => {
            if (line.inventory_item_id !== itemId) return line
            const effectiveLeftover = numVal ?? 0
            let calculatedQty = line.par_value - effectiveLeftover
            
            // Apply rounding rule if positive
            if (calculatedQty > 0) {
                const rule = line.rounding_rule || 'none'
                if (rule === 'ceiling_30') {
                    calculatedQty = Math.ceil(calculatedQty / 30) * 30
                } else if (rule === 'ceiling_4') {
                    calculatedQty = Math.ceil(calculatedQty / 4) * 4
                } else {
                    calculatedQty = Math.round(calculatedQty)
                }
            }

            return { ...line, leftover_value: numVal, calculated_qty: calculatedQty }
        }))
    }

    async function handleDeleteOrder(orderId: string, qbEstimateNum: string | null) {
        const warningMsg = qbEstimateNum 
            ? `⚠️ ¡ATENCIÓN! Esta orden está vinculada al Estimate #${qbEstimateNum} en QuickBooks.\n\nAl eliminar esta orden, también se ELIMINARÁ permanentemente de QuickBooks.\n\n¿Estás seguro de que deseas continuar?`
            : `¿Estás seguro de que deseas eliminar esta orden de forma permanente?`;

        if (!confirm(warningMsg)) return

        setDeletingOrderId(orderId)
        try {
            const response = await fetch('/api/inventory/orders/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId }),
            })
            const result = await response.json()
            if (!response.ok) {
                throw new Error(result.error || 'Error al eliminar la orden')
            }
            alert(t('bodegaOrders.orderDeleted'))
            await loadData()
        } catch (err: any) {
            alert('Error al eliminar: ' + err.message)
        } finally {
            setDeletingOrderId(null)
        }
    }

    async function handleCopyPreviousWeek() {
        if (!storeId || !confirm(t('bodegaOrders.confirmCopyPrev'))) return
        setLoading(true)
        const res = await clonePreviousWeekBases(storeId, activeMonday)
        if (res.error) alert(res.error)
        else { alert(t('bodegaOrders.copied')); await loadData() }
        setLoading(false)
    }

    async function handleCopyParIdeal() {
        if (!storeId || !confirm(t('bodegaOrders.confirmCopyPar'))) return
        setLoading(true)
        const res = await copyFromParIdeal(storeId, activeMonday)
        if (res.error) alert(res.error)
        else { alert(t('bodegaOrders.copied')); await loadData() }
        setLoading(false)
    }

    async function handleSaveLink() {
        if (!selectedItemId) return
        setLoading(true)
        const res = await linkExcelItem(selectedItemId, linkModal.excelName)
        if (res.error) alert(res.error)
        else { setLinkModal({ open: false, excelName: '' }); await loadData() }
        setLoading(false)
    }

    function validateFlanAndCheesecake(lines: any[]): boolean {
        if (orderType !== 'daily') return true

        const flanLine = lines.find(l => 
            l.inventory_item_id === 'f8f776c5-3b8c-453e-8161-b49840823933' || 
            (l.item_name || l.name || '').toLowerCase() === 'flan' ||
            (l.item_name || l.name || '').toLowerCase() === 'whole flan'
        )
        const cheesecakeLine = lines.find(l => 
            l.inventory_item_id === '8ba55664-5ca9-4886-8ac8-acf1fd070713' || 
            (l.item_name || l.name || '').toLowerCase() === 'cheesecake' ||
            (l.item_name || l.name || '').toLowerCase() === 'cheese cake' ||
            (l.item_name || l.name || '').toLowerCase() === 'whole cheese cake'
        )

        const missing: string[] = []
        
        if (flanLine && flanLine.leftover_value === null) {
            missing.push('Flan')
        }
        if (cheesecakeLine && cheesecakeLine.leftover_value === null) {
            missing.push('Cheesecake')
        }

        if (missing.length > 0) {
            alert(`⚠️ VALIDACIÓN REQUERIDA:\nDebes capturar el sobrante de: ${missing.join(' y ')} antes de generar la orden o enviar a QuickBooks.`)
            return false
        }

        return true
    }

    async function handleGenerateOrder() {
        if (!storeId) return
        if (!validateFlanAndCheesecake(orderLines)) return
        setSaving(true)
        const lines = orderLines.filter(l => {
            if (!l.is_extraordinary && (l.leftover_value === null || l.leftover_value === undefined)) return false
            const adj = adjustments[l.inventory_item_id]
            const finalQty = adj !== undefined ? adj : l.calculated_qty
            return finalQty > 0
        }).map(l => ({
            inventory_item_id: l.inventory_item_id,
            calculated_qty: l.calculated_qty,
            adjusted_qty: adjustments[l.inventory_item_id],
            par_value: l.par_value,
            leftover_value: l.leftover_value ?? 0
        }))

        const res = await saveOrderDraft(storeId, selectedOrderDate, activeMonday, lines, user?.name, orderNotes || undefined, orderType)
        if (res.error) alert(res.error)
        else { alert(t('bodegaOrders.saved')); await loadData() }
        setSaving(false)
    }

    async function handleSendToQb() {
        if (!validateFlanAndCheesecake(orderLines)) return
        if (!confirm(t('bodegaOrders.confirmSend'))) return

        // SIEMPRE re-guardar las líneas antes de enviar a QB,
        // incluso si la orden ya existe (podría tener 0 líneas de un guardado parcial previo)
        setSaving(true)
        const lines = orderLines.filter(l => {
            if (!l.is_extraordinary && (l.leftover_value === null || l.leftover_value === undefined)) return false
            const adj = adjustments[l.inventory_item_id]
            const finalQty = adj !== undefined ? adj : l.calculated_qty
            return finalQty > 0
        }).map(l => ({
            inventory_item_id: l.inventory_item_id,
            calculated_qty: l.calculated_qty,
            adjusted_qty: adjustments[l.inventory_item_id],
            par_value: l.par_value,
            leftover_value: l.leftover_value ?? 0
        }))

        if (lines.length === 0) {
            alert(t('bodegaOrders.noItemsToOrderError'))
            setSaving(false)
            return
        }

        const saveRes = await saveOrderDraft(storeId, selectedOrderDate, activeMonday, lines, user?.name, orderNotes || undefined, orderType)
        if (saveRes.error) { alert(saveRes.error); setSaving(false); return }
        const orderId = saveRes.orderId
        setSaving(false)

        setSendingToQb(true)
        try {
            const res = await fetch('/api/inventory/orders/send-to-qb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, userEmail: user?.email })
            })
            const data = await res.json()

            // Si la sesión de QuickBooks ha expirado
            if (res.status === 401 || data.error === 'token_expired' || data.reauth_url) {
                const width = 600, height = 700;
                const left = (window.screen.width - width) / 2;
                const top = (window.screen.height - height) / 2;
                
                alert(t('bodegaOrders.qbSessionExpiredPrompt'));
                
                const popup = window.open(
                    '/api/integrations/quickbooks/auth',
                    'qb_auth_popup',
                    `width=${width},height=${height},left=${left},top=${top}`
                );

                if (popup) {
                    const handleMessage = async (e: MessageEvent) => {
                        if (e.data === 'qb_authorized') {
                            window.removeEventListener('message', handleMessage);
                            if (timer) clearInterval(timer);
                            // Reintentar de forma automática
                            alert(t('bodegaOrders.qbSessionStarted'));
                            setSendingToQb(true);
                            try {
                                const retryRes = await fetch('/api/inventory/orders/send-to-qb', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ orderId, userEmail: user?.email })
                                });
                                const retryData = await retryRes.json();
                                if (retryData.error) {
                                    alert(`Error: ${retryData.error}`);
                                } else {
                                    alert(t('bodegaOrders.orderSentDesc', { number: retryData.estimateNumber }));
                                    await loadData();
                                }
                            } catch (retryErr: any) {
                                alert(`Error al reintentar: ${retryErr.message}`);
                            } finally {
                                setSendingToQb(false);
                            }
                        }
                    };
                    window.addEventListener('message', handleMessage);

                    // Limpiar listener si el popup se cierra
                    const timer = setInterval(() => {
                        if (popup.closed) {
                            clearInterval(timer);
                            window.removeEventListener('message', handleMessage);
                        }
                    }, 1000);
                } else {
                    alert(t('bodegaOrders.popupBlocked'));
                }
                setSendingToQb(false);
                return;
            }

            if (data.error) {
                alert(`Error: ${data.error}`)
            } else {
                alert(t('bodegaOrders.orderSentDesc', { number: data.estimateNumber }))
                await loadData()
            }
        } catch (err: any) {
            alert(`Error: ${err.message}`)
        }
        setSendingToQb(false)
    }

    async function handleForceQbSync() {
        setSyncingQb(true)
        try {
            const res = await fetch('/api/inventory/sync-quickbooks', { method: 'POST' })
            const data = await res.json()

            // Si la sesión de QuickBooks ha expirado
            if (res.status === 401 || data.reauth_url) {
                const width = 600, height = 700;
                const left = (window.screen.width - width) / 2;
                const top = (window.screen.height - height) / 2;
                
                alert(t('bodegaOrders.qbSyncPrompt'));
                
                const popup = window.open(
                    '/api/integrations/quickbooks/auth',
                    'qb_auth_popup',
                    `width=${width},height=${height},left=${left},top=${top}`
                );

                if (popup) {
                    const handleMessage = async (e: MessageEvent) => {
                        if (e.data === 'qb_authorized') {
                            window.removeEventListener('message', handleMessage);
                            if (timer) clearInterval(timer);
                            alert(t('bodegaOrders.qbSyncRetrySessionStarted'));
                            setSyncingQb(true);
                            try {
                                const retryRes = await fetch('/api/inventory/sync-quickbooks', { method: 'POST' });
                                const retryData = await retryRes.json();
                                if (retryData.error) {
                                    alert(`Error: ${retryData.error}`);
                                } else {
                                    alert(t('bodegaOrders.qbSyncSuccess'));
                                    await loadData();
                                }
                            } catch (retryErr: any) {
                                alert(`Error al reintentar: ${retryErr.message}`);
                            } finally {
                                setSyncingQb(false);
                            }
                        }
                    };
                    window.addEventListener('message', handleMessage);

                    // Limpiar listener si el popup se cierra
                    const timer = setInterval(() => {
                        if (popup.closed) {
                            clearInterval(timer);
                            window.removeEventListener('message', handleMessage);
                        }
                    }, 1000);
                } else {
                    alert(t('bodegaOrders.popupBlocked'));
                }
                setSyncingQb(false);
                return;
            }

            if (data.error) {
                alert(`Error: ${data.error}`)
            } else {
                alert(t('bodegaOrders.qbSyncSuccess'))
                await loadData()
            }
        } catch (err: any) {
            alert(`Error: ${err.message}`)
        } finally {
            setSyncingQb(false)
        }
    }

    async function handleCloseWeek() {
        if (!storeId || !confirm(t('bodegaOrders.closeWeekConfirm'))) return
        setLoading(true)
        const res = await executeWeekRollover(storeId, activeMonday)
        if (res.error) {
            alert(res.error)
        } else {
            alert(t('bodegaOrders.weekClosed'))
            setActiveMonday(res.nextMonday!)
        }
        setLoading(false)
    }

    // Grid keyboard navigation
    function handleGridKeyDown(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault()
            document.getElementById(`input_${r + 1}_${c}`)?.focus()
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            document.getElementById(`input_${r - 1}_${c}`)?.focus()
        } else if (e.key === 'ArrowRight') {
            document.getElementById(`input_${r}_${c + 1}`)?.focus()
        } else if (e.key === 'ArrowLeft') {
            document.getElementById(`input_${r}_${c - 1}`)?.focus()
        }
    }

    // Count captured leftovers for today
    const capturedToday = items.filter(i => counts[i.id]?.[selectedOrderDate] !== undefined).length
    const sundayDate = addDays(activeMonday, 6)
    const capturedSunday = items.filter(i => counts[i.id]?.[sundayDate] !== undefined).length

    // Summary cards for Order tab
    const itemsToOrder = orderLines.filter(l => {
        if (!l.is_extraordinary && (l.leftover_value === null || l.leftover_value === undefined)) return false
        const adj = adjustments[l.inventory_item_id]
        const finalQty = adj !== undefined ? adj : l.calculated_qty
        return finalQty > 0
    }).length
    const excessItems = orderLines.filter(l => l.leftover_value !== null && l.leftover_value !== undefined && l.par_value > 0 && l.leftover_value > l.par_value).length

    // Compute the next day name + date for daily order header
    const tomorrow = new Date(selectedOrderDate + 'T12:00:00')
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dayNames: Record<string, { es: string; en: string }> = {
        '0': { es: 'Domingo', en: 'Sunday' },
        '1': { es: 'Lunes', en: 'Monday' },
        '2': { es: 'Martes', en: 'Tuesday' },
        '3': { es: 'Miércoles', en: 'Wednesday' },
        '4': { es: 'Jueves', en: 'Thursday' },
        '5': { es: 'Viernes', en: 'Friday' },
        '6': { es: 'Sábado', en: 'Saturday' },
    }
    const tomorrowDayName = dayNames[String(tomorrow.getDay())]
    const tomorrowFormatted = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}/${String(tomorrow.getDate()).padStart(2, '0')}/${tomorrow.getFullYear()}`

    // Separate orderable vs tracking-only lines vs extraordinary items
    const orderableLines = orderLines.filter(l => l.qb_item_id && l.qb_item_id !== 'TRACK_ONLY' && !l.is_extraordinary)
    const trackingLines = orderLines.filter(l => (!l.qb_item_id || l.qb_item_id === 'TRACK_ONLY') && !l.is_extraordinary)
    const extraordinaryLines = orderLines.filter(l => l.is_extraordinary)

    // ============================================================================
    // RENDER
    // ============================================================================
    return (
        <div className="p-4 md:p-6 max-w-[100vw] min-h-screen bg-slate-50 text-slate-800">
            {/* ============ LINK MODAL ============ */}
            {linkModal.open && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg border border-blue-100">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-blue-900">{t('bodegaOrders.linkProduct')}</h2>
                            <button onClick={() => setLinkModal({ open: false, excelName: '' })} className="text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="mb-4 text-slate-600">
                            {t('bodegaOrders.linkProductDesc')}: <strong className="text-blue-600">&quot;{linkModal.excelName}&quot;</strong>
                        </p>
                        <input
                            type="text"
                            placeholder={`🔍 ${t('bodegaOrders.searchItem')}`}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full border-2 border-slate-300 p-3 rounded-t-xl font-medium text-slate-700 outline-none focus:border-blue-500"
                        />
                        <div className="w-full border-2 border-t-0 border-slate-300 rounded-b-xl mb-5 max-h-48 overflow-y-auto bg-white">
                            {allItems.filter(i => (!i.excel_reference || i.excel_reference === linkModal.excelName) && i.name.toLowerCase().includes(searchTerm.toLowerCase())).map(i => (
                                <div
                                    key={i.id}
                                    onClick={() => setSelectedItemId(i.id)}
                                    className={`p-3 border-b border-slate-100 cursor-pointer transition-colors ${selectedItemId === i.id ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}
                                >
                                    {i.name} ({i.unit_type})
                                </div>
                            ))}
                            {allItems.filter(i => (!i.excel_reference || i.excel_reference === linkModal.excelName) && i.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                                <div className="p-4 text-center text-slate-400">{t('bodegaOrders.noResults')}</div>
                            )}
                        </div>
                        <button
                            disabled={!selectedItemId}
                            onClick={handleSaveLink}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 rounded-xl disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                        >
                            {t('bodegaOrders.saveLink')}
                        </button>
                    </div>
                </div>
            )}

            {/* ============ IDEAL PAR INFO MODAL ============ */}
            {showIdealInfo && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-xl border border-violet-100 relative">
                        <button 
                            onClick={() => setShowIdealInfo(false)} 
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                        
                        <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
                            <div className="p-2 bg-violet-100 text-violet-700 rounded-lg">
                                <Info className="w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-slate-800">
                                    {language === 'es' ? '¿Cómo se calcula el PAR Ideal?' : 'How is Ideal PAR Calculated?'}
                                </h2>
                                <p className="text-xs text-slate-400">
                                    {language === 'es' ? 'Fórmulas automáticas del historial (Últimas 4 semanas)' : 'Automatic history formulas (Last 4 weeks)'}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4 text-sm text-slate-600 max-h-[60vh] overflow-y-auto pr-1">
                            {language === 'es' ? (
                                <>
                                    <p className="leading-relaxed">
                                        El <strong>PAR Ideal</strong> es una sugerencia matemática calculada automáticamente 
                                        por el sistema promediando las bases reales de las últimas <strong>4 semanas</strong> y aplicando ajustes inteligentes basados en los sobrantes diarios.
                                    </p>

                                    <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-150">
                                        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-emerald-700">📅 Lunes a Viernes:</h3>
                                        <p className="text-xs leading-relaxed">
                                            Se calcula el porcentaje de sobrante al final del día respecto a la base del día: <code>(Sobrante / PAR) × 100</code>.
                                        </p>
                                        <ul className="list-disc list-inside text-xs space-y-1.5 pl-1 text-slate-500">
                                            <li><strong className="text-amber-600">Exceso (&gt; 60% sobrante):</strong> Sobró demasiado producto. El PAR se reduce entre un <strong>10% y 15%</strong>.</li>
                                            <li><strong className="text-red-500">Escasez (&lt; 20% sobrante):</strong> Quedó muy poco o se agotó. El PAR se incrementa entre un <strong>10% y 20%</strong>.</li>
                                            <li><strong className="text-emerald-600">Rango Ideal (20% a 60%):</strong> El PAR se mantiene intacto.</li>
                                        </ul>
                                    </div>

                                    <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-150">
                                        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-indigo-700">📅 Sábado (Pedido de Fin de Semana):</h3>
                                        <p className="text-xs leading-relaxed">
                                            Dado que el pedido del sábado cubre tanto sábado como domingo, el sobrante se valida con el conteo físico del **Domingo por la noche**:
                                        </p>
                                        <ul className="list-disc list-inside text-xs space-y-1.5 pl-1 text-slate-500">
                                            <li><strong className="text-amber-600">Exceso (&gt; 40% sobrante el Domingo):</strong> El PAR del sábado se reduce un <strong>10% o 15%</strong>.</li>
                                            <li><strong className="text-red-500">Escasez (&lt; 15% sobrante el Domingo):</strong> El PAR del sábado se incrementa un <strong>10% o 20%</strong>.</li>
                                            <li><strong className="text-emerald-600">Rango Ideal (15% a 40%):</strong> El PAR del sábado se mantiene intacto.</li>
                                        </ul>
                                    </div>

                                    <p className="text-[11px] text-slate-400 italic">
                                        * Nota: Domingo siempre calcula PAR 0 ya que no hay entregas de bodega los domingos.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="leading-relaxed">
                                        The <strong>Ideal PAR</strong> is a mathematical suggestion automatically calculated 
                                        by the system by averaging the real bases of the last <strong>4 weeks</strong> and applying smart adjustments based on daily leftovers.
                                    </p>

                                    <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-150">
                                        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-emerald-700">📅 Monday to Friday:</h3>
                                        <p className="text-xs leading-relaxed">
                                            The leftover percentage at the end of the day relative to the daily base is calculated: <code>(Leftover / PAR) × 100</code>.
                                        </p>
                                        <ul className="list-disc list-inside text-xs space-y-1.5 pl-1 text-slate-500">
                                            <li><strong className="text-amber-600">Excess (&gt; 60% leftover):</strong> Too much leftover product. The PAR is reduced by <strong>10% to 15%</strong>.</li>
                                            <li><strong className="text-red-500">Shortage (&lt; 20% leftover):</strong> Too little or ran out. The PAR is increased by <strong>10% to 20%</strong>.</li>
                                            <li><strong className="text-emerald-600">Ideal Range (20% to 60%):</strong> The PAR remains unchanged.</li>
                                        </ul>
                                    </div>

                                    <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-150">
                                        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-indigo-700">📅 Saturday (Weekend Order):</h3>
                                        <p className="text-xs leading-relaxed">
                                            Since Saturday's order covers both Saturday and Sunday, leftovers are verified with **Sunday night's** physical count:
                                        </p>
                                        <ul className="list-disc list-inside text-xs space-y-1.5 pl-1 text-slate-500">
                                            <li><strong className="text-amber-600">Excess (&gt; 40% leftover on Sunday):</strong> Saturday's PAR is reduced by <strong>10% or 15%</strong>.</li>
                                            <li><strong className="text-red-500">Shortage (&lt; 15% leftover on Sunday):</strong> Saturday's PAR is increased by <strong>10% or 20%</strong>.</li>
                                            <li><strong className="text-emerald-600">Ideal Range (15% to 40%):</strong> Saturday's PAR remains unchanged.</li>
                                        </ul>
                                    </div>

                                    <p className="text-[11px] text-slate-400 italic">
                                        * Note: Sunday always calculates PAR 0 since there are no warehouse deliveries on Sundays.
                                    </p>
                                </>
                            )}
                        </div>
                        
                        <div className="mt-5 border-t border-slate-100 pt-4 flex justify-end">
                            <button
                                onClick={() => setShowIdealInfo(false)}
                                className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-colors shadow-sm"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ EDIT ESTIMATE MODAL ============ */}
            {editModal.open && editModal.order && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden transform transition-all border border-slate-100">
                        {/* Header */}
                        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200/60 flex items-center justify-between">
                            <div>
                                <h2 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-1.5">
                                    {modalReadOnly ? '📋 Consultar Pedido' : '✏️ Editar Pedido'}
                                    {modalReadOnly && (
                                        <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full ml-1">
                                            {language === 'es' ? 'Solo lectura' : 'Read-only'}
                                        </span>
                                    )}
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Pedido del {editModal.order.order_date} (Store ID: {storeId}) {editModal.order.qb_estimate_number && `| Estimate QB #${editModal.order.qb_estimate_number}`}
                                </p>
                            </div>
                            <button 
                                onClick={() => setEditModal({ open: false, order: null })} 
                                className="text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-2 rounded-xl transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Body (scrollable) */}
                        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
                            {/* Observations */}
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    Observaciones / Notas
                                </label>
                                <textarea
                                    value={modalNotes}
                                    onChange={e => setModalNotes(e.target.value)}
                                    placeholder="Notas opcionales para este pedido..."
                                    rows={2}
                                    disabled={modalReadOnly}
                                    className={`w-full px-4 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 resize-none placeholder:text-slate-400 ${modalReadOnly ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`}
                                />
                            </div>

                            {/* Table of items */}
                            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="max-h-[50vh] overflow-y-auto">
                                    <table className="w-full text-xs sm:text-sm text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px] sm:text-xs">
                                                <th className="p-2 sm:p-3">{t('bodegaOrders.item')}</th>
                                                <th className="p-2 sm:p-3 text-center">{t('bodegaOrders.packagingCol')}</th>
                                                <th className="p-2 sm:p-3 text-center">{t('bodegaOrders.costCol')}</th>
                                                <th className="p-2 sm:p-3 text-center w-14 sm:w-16">PAR</th>
                                                <th className="p-2 sm:p-3 text-center w-20 sm:w-24">Sobrante</th>
                                                <th className="p-2 sm:p-3 text-center w-16 sm:w-20">Pedir</th>
                                                <th className="p-2 sm:p-3 text-center w-20 sm:w-24">Ajuste</th>
                                                <th className="p-2 sm:p-3 text-center w-16 sm:w-20">Final</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {modalLines.map((line: any, index: number) => {
                                                const leftoverVal = line.leftover_value;
                                                const isZeroLeftover = leftoverVal === null || leftoverVal === undefined;
                                                const parVal = line.par_value || 0;
                                                const calculatedQty = line.calculated_qty;
                                                const adj = line.adjusted_qty;
                                                const finalQty = adj !== null && adj !== undefined ? adj : calculatedQty;
                                                const isNegative = calculatedQty < 0;

                                                return (
                                                    <tr key={line.id || index} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                                        {/* Producto */}
                                                        <td className="p-2 sm:p-3">
                                                            {renderItemName(line.item_name, "font-semibold text-slate-800 leading-tight text-[11px] sm:text-[13px]")}
                                                        </td>
                                                        {/* Empaque (QB) */}
                                                        <td className="p-2 text-center text-slate-600 font-medium text-xs">
                                                            {line.unit_description || '-'}
                                                        </td>
                                                        {/* Costo (QB) */}
                                                        <td className="p-2 text-center text-slate-700 font-bold text-xs">
                                                            {line.purchase_unit_cost !== undefined && line.purchase_unit_cost !== null ? (
                                                                `$${Number(line.purchase_unit_cost).toFixed(2)}`
                                                            ) : (
                                                                '-'
                                                            )}
                                                            {line.unit_measure && (
                                                                <span className="text-[9px] text-slate-400 font-normal block">
                                                                    / {line.unit_measure}
                                                                </span>
                                                            )}
                                                        </td>
                                                        {/* PAR */}
                                                        <td className="p-2 sm:p-3 text-center font-medium bg-emerald-50/30 text-emerald-800">
                                                            {parVal}
                                                        </td>
                                                        {/* Sobrante */}
                                                        <td className="p-1 sm:p-1.5 text-center bg-orange-50/20">
                                                            {modalReadOnly ? (
                                                                <span className="font-bold text-orange-800 text-[11px] sm:text-xs">{leftoverVal !== null && leftoverVal !== undefined ? leftoverVal : '-'}</span>
                                                            ) : (
                                                                <input
                                                                    type="number"
                                                                    value={leftoverVal !== null && leftoverVal !== undefined ? leftoverVal : ''}
                                                                    onChange={e => handleModalLeftoverChange(line.inventory_item_id, e.target.value)}
                                                                    onFocus={e => e.target.select()}
                                                                    placeholder="Sobrante"
                                                                    className="w-full p-1.5 text-center bg-white border border-orange-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-400 font-bold text-orange-800 text-[11px] sm:text-xs"
                                                                />
                                                            )}
                                                        </td>
                                                        {/* Pedir */}
                                                        <td className={`p-2 sm:p-3 text-center font-bold ${isNegative ? 'text-red-500 bg-red-50/20' : 'text-blue-700 bg-blue-50/10'}`}>
                                                            {isZeroLeftover ? '-' : calculatedQty}
                                                        </td>
                                                        {/* Ajuste */}
                                                        <td className="p-1 sm:p-1.5 text-center bg-indigo-50/10">
                                                            {modalReadOnly ? (
                                                                <span className="font-bold text-indigo-700 text-[11px] sm:text-xs">{adj !== null && adj !== undefined ? adj : '-'}</span>
                                                            ) : (
                                                                <input
                                                                    type="number"
                                                                    value={adj !== null && adj !== undefined ? adj : ''}
                                                                    onChange={e => handleModalAdjustmentChange(line.inventory_item_id, e.target.value)}
                                                                    onFocus={e => e.target.select()}
                                                                    placeholder="-"
                                                                    className="w-full p-1.5 text-center bg-white border border-indigo-100 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-indigo-700 text-[11px] sm:text-xs"
                                                                />
                                                            )}
                                                        </td>
                                                        {/* Final */}
                                                        <td className={`p-2 sm:p-3 text-center font-black text-[12px] sm:text-sm ${finalQty > 0 ? 'text-slate-800 bg-slate-50/50' : 'text-slate-300'}`}>
                                                            {isZeroLeftover ? '-' : finalQty}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ---- Combo de insumos extraordinarios (solo en modo edición) ---- */}
                            {!modalReadOnly && (
                                <div className="p-4 border-t border-slate-200 bg-indigo-50/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                    <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
                                        🚨 {language === 'es' ? 'Agregar insumo extra:' : 'Add extra item:'}
                                    </span>
                                    <div className="relative flex-1 z-25">
                                        <input
                                            type="text"
                                            placeholder={language === 'es' ? 'Escribe el nombre del insumo para buscar...' : 'Type item name to search...'}
                                            value={modalExtraSearch}
                                            onChange={e => {
                                                setModalExtraSearch(e.target.value)
                                                setShowModalExtraDropdown(true)
                                            }}
                                            onFocus={() => setShowModalExtraDropdown(true)}
                                            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 font-medium"
                                        />
                                        
                                        {showModalExtraDropdown && modalExtraSearch.trim().length > 0 && (
                                            <div className="absolute left-0 right-0 bottom-full mb-1 z-30 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                                {mappedItems
                                                    .filter(item => {
                                                        const isAlreadyAdded = modalLines.some((l: any) => l.inventory_item_id === item.id)
                                                        const matchesSearch = item.name.toLowerCase().includes(modalExtraSearch.toLowerCase())
                                                        return !isAlreadyAdded && matchesSearch
                                                    })
                                                    .map(item => (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            onClick={() => {
                                                                const newModalLine = {
                                                                    id: `temp-${Date.now()}`,
                                                                    order_id: editModal.order?.id,
                                                                    inventory_item_id: item.id,
                                                                    item_name: item.name,
                                                                    unit_description: item.order_unit_description || item.unit_type,
                                                                    purchase_unit_cost: item.purchase_unit_cost,
                                                                    unit_measure: item.unit_measure,
                                                                    qb_item_id: item.qb_item_id,
                                                                    par_value: 0,
                                                                    leftover_value: 0,
                                                                    calculated_qty: 0,
                                                                    adjusted_qty: 1,
                                                                    is_extraordinary: true
                                                                }
                                                                setModalLines((prev: any[]) => [...prev, newModalLine])
                                                                setModalExtraSearch('')
                                                                setShowModalExtraDropdown(false)
                                                            }}
                                                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors flex items-center justify-between border-b border-slate-100 last:border-0"
                                                        >
                                                            {renderItemName(item.name, "font-semibold text-slate-800")}
                                                            <span className="text-xs text-slate-400 font-medium">({item.unit_type})</span>
                                                        </button>
                                                    ))
                                                }
                                                {mappedItems.filter(item => {
                                                    const isAlreadyAdded = modalLines.some((l: any) => l.inventory_item_id === item.id)
                                                    const matchesSearch = item.name.toLowerCase().includes(modalExtraSearch.toLowerCase())
                                                    return !isAlreadyAdded && matchesSearch
                                                }).length === 0 && (
                                                    <div className="p-4 text-center text-xs text-slate-400">
                                                        {language === 'es' ? 'No se encontraron insumos' : 'No items found'}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {showModalExtraDropdown && (
                                        <div 
                                            className="fixed inset-0 z-10 bg-transparent"
                                            onClick={() => setShowModalExtraDropdown(false)}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2 justify-end">
                            <button
                                onClick={() => setEditModal({ open: false, order: null })}
                                disabled={savingModal || sendingModal}
                                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold text-xs sm:text-sm hover:bg-slate-100 transition-colors disabled:opacity-50"
                            >
                                {modalReadOnly ? (language === 'es' ? 'Cerrar' : 'Close') : 'Cancelar'}
                            </button>
                            {!modalReadOnly && (
                                <>
                                    <button
                                        onClick={handleSaveModalChanges}
                                        disabled={savingModal || sendingModal}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Save size={14} /> {savingModal ? 'Guardando...' : 'Guardar Local'}
                                    </button>
                                    <button
                                        onClick={handleSendModalToQb}
                                        disabled={savingModal || sendingModal}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Send size={14} /> {sendingModal ? 'Enviando...' : 'Enviar a QB'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ============ HEADER BAR ============ */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        📦 {orderType === 'daily' ? t('bodegaOrders.title') : orderType === 'liquids' ? t('bodegaOrders.liquidsTitle') : t('bodegaOrders.uniformsTitle')}
                        <button
                            onClick={() => setShowInfoModal(true)}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-full transition-all"
                            title="Guía de uso / User guide"
                        >
                            <Info size={18} />
                        </button>
                    </h1>
                    <p className="text-slate-500 text-sm mt-0.5">{t('bodegaOrders.subtitle')}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Order Type Toggle */}
                    <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 shadow-sm">
                        <button
                            onClick={() => setOrderType('daily')}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all ${
                                orderType === 'daily'
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            📦 {t('bodegaOrders.title')}
                        </button>
                        <button
                            onClick={() => setOrderType('liquids')}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all ${
                                orderType === 'liquids'
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            🧴 {t('bodegaOrders.liquidsTitle')}
                        </button>
                        <button
                            onClick={() => setOrderType('uniforms')}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs transition-all ${
                                orderType === 'uniforms'
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            🎽 {t('bodegaOrders.uniformsTitle')}
                        </button>
                    </div>

                    {/* Store selector — hidden for single-store managers, visible for admins/supervisors */}
                    {stores.length <= 1 ? (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-2.5 font-bold text-sm shadow-sm flex items-center gap-2">
                            <span className="text-base">📍</span>
                            {stores[0]?.name || '...'}
                        </div>
                    ) : (
                        <select
                            value={storeId}
                            onChange={e => {
                                setStoreId(e.target.value)
                                localStorage.setItem('teg_preparador_store', e.target.value)
                            }}
                            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-4 py-2.5 font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none shadow-sm text-sm"
                        >
                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    )}

                    {/* Week navigator — only visible on weekly_config tab */}
                    {activeTab === 'weekly_config' && (
                        <div className="flex items-center gap-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                            <button className="px-3 py-2.5 hover:bg-slate-100 transition-colors" onClick={() => setActiveMonday(addDays(activeMonday, -7))}>
                                <ArrowLeft className="w-4 h-4 text-slate-500" />
                            </button>
                            <div className="px-3 py-2 font-bold text-sm border-x border-slate-200 min-w-[120px] text-center">
                                {isCurrentWeek && <span className="text-xs text-emerald-600 block font-medium">{t('bodegaOrders.currentWeek')}</span>}
                                {activeMonday}
                            </div>
                            <button className="px-3 py-2.5 hover:bg-slate-100 transition-colors" onClick={() => setActiveMonday(addDays(activeMonday, 7))}>
                                <ArrowRight className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                    )}

                </div>
            </div>

            {/* QB Re-auth Alert Banner */}
            {qbAuthRequired && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-amber-800 text-sm shadow-2xs animate-fade-in max-w-5xl">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                        <span>
                            {language === 'es' 
                                ? 'La sesión de QuickBooks ha expirado. Sincronización en vivo pausada.' 
                                : 'QuickBooks session expired. Live synchronization paused.'}
                        </span>
                    </div>
                    <button
                        onClick={handleForceQbSync}
                        disabled={syncingQb}
                        className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors shadow-2xs flex items-center gap-1.5"
                    >
                        <RefreshCcw size={12} className={syncingQb ? 'animate-spin' : ''} />
                        {syncingQb 
                            ? (language === 'es' ? 'Autorizando...' : 'Authorizing...') 
                            : (language === 'es' ? 'Iniciar Sesión en QB' : 'Log In to QB')}
                    </button>
                </div>
            )}

            {/* ============ TAB BAR ============ */}
            <div className="flex gap-2 mb-0">
                {/* Tab: Pedido del Día */}
                <button
                    onClick={() => setActiveTab('daily_order')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-t-2xl font-bold text-sm transition-all duration-200 border-t-[3px] ${
                        activeTab === 'daily_order'
                            ? 'bg-white border-t-blue-600 text-blue-800 shadow-sm'
                            : 'bg-slate-100 border-t-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                    }`}
                >
                    📋 {t('bodegaOrders.dailyOrderTab')}
                    {itemsToOrder > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                            activeTab === 'daily_order' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                            {itemsToOrder}
                        </span>
                    )}
                </button>

                {/* Tab: Config Semanal */}
                <button
                    onClick={() => setActiveTab('weekly_config')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-t-2xl font-bold text-sm transition-all duration-200 border-t-[3px] ${
                        activeTab === 'weekly_config'
                            ? 'bg-white border-t-indigo-600 text-indigo-800 shadow-sm'
                            : 'bg-slate-100 border-t-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                    }`}
                >
                    ⚙️ {t('bodegaOrders.weeklyConfigTab')}
                </button>

                {/* Tab: Historial */}
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-t-2xl font-bold text-sm transition-all duration-200 border-t-[3px] ${
                        activeTab === 'history'
                            ? 'bg-white border-t-amber-500 text-amber-800 shadow-sm'
                            : 'bg-slate-100 border-t-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                    }`}
                >
                    📄 {t('bodegaOrders.historyTab')}
                    {orders && orders.length > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                            activeTab === 'history' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                            {orders.length}
                        </span>
                    )}
                </button>

                {/* Tab: Sobrantes */}
                <button
                    onClick={() => setActiveTab('leftovers')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-t-2xl font-bold text-sm transition-all duration-200 border-t-[3px] ${
                        activeTab === 'leftovers'
                            ? 'bg-white border-t-orange-500 text-orange-800 shadow-sm'
                            : 'bg-slate-100 border-t-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                    }`}
                >
                    📦 {t('bodegaOrders.leftoversTab')}
                </button>
            </div>

            {/* ============ CONTENT ============ */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-b-2xl rounded-tr-2xl min-h-[500px]">
                {loading ? (
                    <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                        {t('bodegaOrders.loading')}
                    </div>
                ) : (
                    <>
                        {/* ======================================================== */}
                        {/* TAB 1: DAILY ORDER                                       */}
                        {/* ======================================================== */}
                        {activeTab === 'daily_order' && (() => {
                            const existingOrder = orders.find((o: any) => o.order_date === selectedOrderDate)

                            if (!isCurrentWeek) {
                                return (
                                    <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
                                        <AlertTriangle className="w-10 h-10 text-amber-400" />
                                        <span className="text-lg font-bold text-slate-500">{t('bodegaOrders.notCurrentWeek')}</span>
                                    </div>
                                )
                            }

                            return (
                                <div>
                                    {/* ---- Header: Pedido para [TOMORROW] ---- */}
                                    <div className="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-4">
                                        <h2 className="text-xl font-black text-slate-800">
                                            📦 {t('bodegaOrders.orderForDate')} {tomorrowDayName?.es || ''} ({tomorrowFormatted})
                                        </h2>
                                        
                                        <div className="flex flex-wrap items-center gap-3">
                                            {/* Selector de fecha de conteo con botones de navegación rápida */}
                                            <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-xl p-1 shadow-sm text-xs">
                                                <button
                                                    type="button"
                                                    onClick={() => handleOrderDateChange(addDays(selectedOrderDate, -1))}
                                                    className="px-2 py-1 bg-white hover:bg-blue-100 text-blue-800 font-bold rounded-lg border border-blue-200 shadow-2xs transition-all active:scale-95"
                                                    title="Ver fecha anterior (ej. Ayer)"
                                                >
                                                    ◀ Ayer
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleOrderDateChange(todayStr)}
                                                    className={`px-2 py-1 font-bold rounded-lg transition-all ${
                                                        selectedOrderDate === todayStr 
                                                            ? 'bg-blue-600 text-white shadow-2xs' 
                                                            : 'bg-white text-blue-700 hover:bg-blue-50 border border-blue-200'
                                                    }`}
                                                >
                                                    Hoy
                                                </button>
                                                <input
                                                    type="date"
                                                    value={selectedOrderDate}
                                                    onChange={e => handleOrderDateChange(e.target.value)}
                                                    className="bg-white text-blue-900 font-black outline-none cursor-pointer focus:ring-2 focus:ring-blue-500 rounded-lg px-2 py-1 border border-blue-300 font-sans"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleOrderDateChange(addDays(selectedOrderDate, 1))}
                                                    className="px-2 py-1 bg-white hover:bg-blue-100 text-blue-800 font-bold rounded-lg border border-blue-200 shadow-2xs transition-all active:scale-95"
                                                    title="Ver fecha siguiente"
                                                >
                                                    Mañana ▶
                                                </button>
                                            </div>

                                            {/* Dropdown to override PAR base day field */}
                                            <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm text-xs">
                                                <span className="font-bold text-slate-500">📅 Usar PAR de:</span>
                                                <select
                                                    value={overrideDayField}
                                                    onChange={e => setOverrideDayField(e.target.value)}
                                                    className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer focus:text-blue-600 font-sans"
                                                >
                                                    <option value="auto">Automático ({tomorrowDayName?.es || ''})</option>
                                                    <option value="mon_par">Lunes / Monday</option>
                                                    <option value="tue_par">Martes / Tuesday</option>
                                                    <option value="wed_par">Miércoles / Wednesday</option>
                                                    <option value="thu_par">Jueves / Thursday</option>
                                                    <option value="fri_par">Viernes / Friday</option>
                                                    <option value="sat_par">Sábado / Saturday</option>
                                                    <option value="sun_par">Domingo / Sunday</option>
                                                </select>
                                            </div>

                                            {/* Selector de Incremento de PAR (Emergencia) */}
                                            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-1.5 shadow-sm text-xs text-indigo-800">
                                                <span className="font-bold text-indigo-700">{t('bodegaOrders.parBoost')}:</span>
                                                <select
                                                    value={parBoostPercent}
                                                    onChange={e => setParBoostPercent(Number(e.target.value))}
                                                    className="bg-transparent font-bold outline-none cursor-pointer text-indigo-900"
                                                >
                                                    <option value="0">{t('bodegaOrders.noBoost')}</option>
                                                    <option value="10">{t('bodegaOrders.boost10')}</option>
                                                    <option value="15">{t('bodegaOrders.boost15')}</option>
                                                    <option value="20">{t('bodegaOrders.boost20')}</option>
                                                    <option value="25">{t('bodegaOrders.boost25')}</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ---- Banner Explicativo de Cálculo ---- */}
                                    {orderType === 'uniforms' ? (
                                        <div className="mx-5 mb-3 p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-900 shadow-2xs">
                                            <div className="flex items-center gap-2">
                                                <span className="text-base">🎽</span>
                                                <div>
                                                    <span className="font-bold text-emerald-950">Sincronización en Vivo con Módulo de Uniformes: </span>
                                                    <span className="font-medium bg-white px-2 py-0.5 rounded border border-emerald-200 text-emerald-900">
                                                        PAR = Stock Mínimo | Sobrante = En Existencia Real | Pedir = PAR − Sobrante
                                                    </span>
                                                </div>
                                            </div>
                                            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-1 rounded-lg border border-emerald-300">
                                                ✨ Captura automática activa. No requiere ingresar sobrantes manualmente.
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="mx-5 mb-3 p-3 bg-cyan-50/80 border border-cyan-200 rounded-xl flex items-center justify-between gap-3 text-xs text-cyan-900 shadow-2xs">
                                            <div className="flex items-center gap-2">
                                                <span className="text-base">🤖</span>
                                                <div>
                                                    <span className="font-bold text-cyan-950">Fórmula de Sobrante Teórico Sugerido: </span>
                                                    <span className="font-mono font-semibold bg-white px-2 py-0.5 rounded border border-cyan-200 text-cyan-900">
                                                        Sobrante Ayer + Llegó Hoy AM − Ventas Toast ({selectedOrderDate})
                                                    </span>
                                                </div>
                                            </div>
                                            {selectedOrderDate === todayStr && (
                                                <span className="text-[11px] font-semibold text-cyan-800 bg-cyan-100 px-2 py-1 rounded-lg border border-cyan-300">
                                                    💡 Consejo: Cambia a una fecha pasada (ej. <b>◀ Ayer</b>) para auditar ventas cerradas.
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* ---- Success banner if already sent to QB ---- */}
                                    {existingOrder?.qb_estimate_number && (
                                        <div className="mx-5 mb-4 bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex flex-wrap gap-4 items-center justify-between shadow-sm">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
                                                    <Check className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-800 text-sm">
                                                        {t('bodegaOrders.orderSent')}
                                                    </h4>
                                                    <p className="text-xs text-slate-500">
                                                        {t('bodegaOrders.orderSentDesc', { number: existingOrder.qb_estimate_number })}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={() => window.open(`/api/inventory/orders/estimate-pdf?estimateId=${existingOrder.qb_estimate_id}`, '_blank')}
                                                    className="flex items-center gap-1.5 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 px-3.5 py-2 rounded-xl font-bold text-xs shadow-sm transition-all"
                                                >
                                                    <Download size={14} /> {t('bodegaOrders.printPdf')}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* ---- Summary cards ---- */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-5 pb-4">
                                        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                                            <div className="text-xs text-blue-500 font-bold uppercase tracking-wider">{t('bodegaOrders.totalItemsToOrder')}</div>
                                            <div className="text-3xl font-black text-blue-700 mt-1">{itemsToOrder}</div>
                                        </div>
                                        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                                            <div className="text-xs text-amber-500 font-bold uppercase tracking-wider">{t('bodegaOrders.excessItems')}</div>
                                            <div className="text-3xl font-black text-amber-600 mt-1">{excessItems}</div>
                                        </div>
                                        <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                                            <div className="text-xs text-emerald-500 font-bold uppercase tracking-wider">{t('bodegaOrders.qbEstimate')}</div>
                                            <div className="text-lg font-black text-emerald-700 mt-1">
                                                {existingOrder?.qb_estimate_number
                                                    ? `#${existingOrder.qb_estimate_number}`
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ---- Progress bar ---- */}
                                    <div className="px-5 pb-3">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-bold text-slate-500">
                                                {t('bodegaOrders.itemsCaptured', { count: capturedToday, total: items.length })}
                                            </span>
                                            {capturedToday === items.length && items.length > 0 && (
                                                <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-3 py-0.5 rounded-full flex items-center gap-1">
                                                    <Check size={12} /> {t('bodegaOrders.allItemsCaptured')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-1.5">
                                            <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${items.length ? (capturedToday / items.length) * 100 : 0}%` }} />
                                        </div>
                                    </div>

                                    {/* ---- Action buttons (Top duplicate for easy access) ---- */}
                                    <div className="mx-5 mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap gap-3 justify-end items-center">
                                        <span className="text-xs font-black text-slate-500 uppercase tracking-wider mr-auto">
                                            ⚡ Acciones Rápidas
                                        </span>

                                        {/* Column Visibility Toggles */}
                                        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs text-xs font-semibold select-none">
                                            <span className="text-slate-400 font-bold text-[11px] uppercase px-1.5 flex items-center gap-1">
                                                <Eye size={12} /> {t('bodegaOrders.toggleColumns')}:
                                            </span>
                                            <button
                                                type="button"
                                                onClick={toggleParIdealCol}
                                                className={`px-2.5 py-1 rounded-lg transition-all text-xs font-bold flex items-center gap-1 cursor-pointer ${
                                                    showParIdealCol
                                                        ? 'bg-violet-100 text-violet-800 border border-violet-300 shadow-2xs'
                                                        : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200 line-through opacity-70'
                                                }`}
                                                title="Mostrar u ocultar la columna PAR Ideal"
                                            >
                                                {showParIdealCol ? <Eye size={12} /> : <EyeOff size={12} />} {t('bodegaOrders.toggleParIdeal')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={toggleSuggestedCol}
                                                className={`px-2.5 py-1 rounded-lg transition-all text-xs font-bold flex items-center gap-1 cursor-pointer ${
                                                    showSuggestedCol
                                                        ? 'bg-cyan-100 text-cyan-800 border border-cyan-300 shadow-2xs'
                                                        : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200 line-through opacity-70'
                                                }`}
                                                title="Mostrar u ocultar la columna Sugerido"
                                            >
                                                {showSuggestedCol ? <Eye size={12} /> : <EyeOff size={12} />} {t('bodegaOrders.toggleSuggested')}
                                            </button>
                                        </div>

                                        <button
                                            onClick={() => {
                                                const url = `/inventory/orders/print-sheet?storeId=${storeId}&orderType=${orderType}&week=${activeMonday}`
                                                window.open(url, '_blank')
                                            }}
                                            className="flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-colors"
                                        >
                                            <Printer size={14} /> {t('bodegaOrders.printSheet')}
                                        </button>
                                        <button onClick={handleGenerateOrder} disabled={saving}
                                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-colors disabled:opacity-50">
                                            <Save size={14} /> {saving ? t('bodegaOrders.saving') : t('bodegaOrders.generateOrder')}
                                        </button>
                                        <button onClick={handleSendToQb} disabled={sendingToQb || !isCurrentWeek}
                                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                            <Send size={14} /> {sendingToQb ? t('bodegaOrders.sendingToQb') : t('bodegaOrders.sendToQb')}
                                        </button>
                                    </div>

                                    {/* ---- Unified order table ---- */}
                                    <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm bg-white">
                                        <table className="w-full text-sm border-collapse whitespace-nowrap">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300 text-xs">
                                                    <th className="sticky left-0 bg-slate-50 border-b-2 border-slate-300 p-3 text-left w-72 min-w-[220px] max-w-[300px] z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                                        {t('bodegaOrders.item')}
                                                    </th>
                                                    <th className="p-3 text-left w-52 min-w-[160px] bg-slate-50 text-slate-600 border-b-2 border-slate-300">
                                                        {t('bodegaOrders.packagingCol')}
                                                    </th>
                                                    <th className="p-3 text-center w-28 min-w-[90px] bg-slate-50 text-slate-600 border-b-2 border-slate-300">
                                                        {t('bodegaOrders.costCol')}
                                                    </th>
                                                    {showParIdealCol && (
                                                         <th className="p-3 text-center w-24 bg-violet-50 text-violet-700 border-b-2 border-violet-200">
                                                             <div className="flex items-center justify-center gap-1">
                                                                 <span>{t('bodegaOrders.parIdeal')}</span>
                                                                 <button
                                                                     type="button"
                                                                     onClick={() => setShowIdealInfo(true)}
                                                                     className="text-violet-400 hover:text-violet-600 transition-colors"
                                                                     title="¿Cómo se calcula?"
                                                                 >
                                                                     <Info size={13} />
                                                                 </button>
                                                             </div>
                                                         </th>
                                                     )}
                                                     <th className="p-3 text-center w-20 bg-emerald-50 text-emerald-700 border-b-2 border-emerald-200">
                                                         {orderType === 'daily' ? t('bodegaOrders.parTomorrow') : 'PAR'}
                                                     </th>
                                                     {showSuggestedCol && (
                                                         <th className="p-3 text-center w-24 bg-cyan-50 text-cyan-800 border-b-2 border-cyan-200">
                                                             <div className="flex items-center justify-center gap-1" title="Sobrante Teórico sugerido automáticamente por el sistema">
                                                                 <span>🤖 {t('bodegaOrders.suggested')}</span>
                                                             </div>
                                                         </th>
                                                     )}
                                                    <th className="p-3 text-center w-24 bg-orange-50 text-orange-700 border-b-2 border-orange-200">
                                                        {t('bodegaOrders.leftover')}
                                                    </th>
                                                    <th className="p-3 text-center w-20 bg-blue-50 text-blue-700 border-b-2 border-blue-200">
                                                        {t('bodegaOrders.orderCol')}
                                                    </th>
                                                    <th className="p-3 text-center w-24 bg-indigo-50 text-indigo-700 border-b-2 border-indigo-200">
                                                        {t('bodegaOrders.adjustCol')}
                                                    </th>
                                                    <th className="p-3 text-center w-20 bg-slate-100 text-slate-800 border-b-2 border-slate-300 font-black">
                                                        {t('bodegaOrders.finalQty')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {/* ---- Orderable items ---- */}
                                                {orderableLines.map((line, rowIndex) => {
                                                    const adj = adjustments[line.inventory_item_id]
                                                    const finalQty = adj !== undefined ? adj : line.calculated_qty
                                                    const isNegative = line.calculated_qty < 0
                                                    const isZeroLeftover = line.leftover_value === null
                                                    const currentLeftover = counts[line.inventory_item_id]?.[selectedOrderDate]

                                                    return (
                                                        <tr key={line.inventory_item_id}
                                                            className={`transition-colors border-b border-slate-100 ${isNegative ? 'bg-red-50/30' : finalQty > 0 ? 'hover:bg-blue-50/20' : 'hover:bg-slate-50/50'}`}>
                                                            {/* Producto */}
                                                            <td className="sticky left-0 bg-white border-b border-slate-100 p-2.5 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)] w-72 min-w-[220px] max-w-[300px]">
                                                                {renderItemName(line.item_name, "font-semibold text-slate-800")}
                                                            </td>
                                                            {/* Empaque (QB) */}
                                                            <td className="p-2.5 text-left text-slate-600 border-b border-slate-100 font-medium text-xs w-52 min-w-[160px]">
                                                                {line.unit_description || '-'}
                                                            </td>
                                                            {/* Costo (QB) */}
                                                            <td className="p-2.5 text-center text-slate-700 border-b border-slate-100 font-bold text-xs w-28 min-w-[90px]">
                                                                {line.purchase_unit_cost !== undefined && line.purchase_unit_cost !== null ? (
                                                                    `$${Number(line.purchase_unit_cost).toFixed(2)}`
                                                                ) : (
                                                                    '-'
                                                                )}
                                                                {line.unit_measure && (
                                                                    <span className="text-[9px] text-slate-400 font-normal block">
                                                                        / {line.unit_measure}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            {/* PAR Ideal (readonly) */}
                                                            {showParIdealCol && (
                                                                <td className="p-2 text-center font-medium text-violet-600 bg-violet-50/40 border-b border-violet-100">
                                                                    {line.par_ideal_value || '-'}
                                                                </td>
                                                            )}
                                                            {/* PAR (readonly) */}
                                                            <td className="p-2 text-center font-bold text-emerald-700 bg-emerald-50/40 border-b border-emerald-100">
                                                                {line.par_value || '-'}
                                                                {parBoostPercent > 0 && line.par_value > 0 && (
                                                                    <span className="text-[9px] text-indigo-600 font-semibold block mt-0.5 animate-pulse">+{parBoostPercent}%</span>
                                                                )}
                                                            </td>
                                                            {/* Sugerido (Teórico) */}
                                                            {showSuggestedCol && (
                                                                <td className="p-2 text-center font-bold text-cyan-800 bg-cyan-50/40 border-b border-cyan-100">
                                                                    {line.suggested_leftover !== null && line.suggested_leftover !== undefined ? (
                                                                        <span className="flex items-center justify-center gap-1" title={line.is_burn_rate ? "Promedio histórico diario (Burn Rate)" : "Ventas Toast × Recetas"}>
                                                                            <span>{line.suggested_leftover}</span>
                                                                            <span className="text-[10px]">{line.is_burn_rate ? '📊' : '🤖'}</span>
                                                                        </span>
                                                                    ) : (
                                                                        '—'
                                                                    )}
                                                                </td>
                                                            )}
                                                            {/* Sobrante (AUTO-FILLED FOR UNIFORMS, EDITABLE FOR OTHERS) */}
                                                            <td className="p-0 border-b border-orange-200 bg-orange-50/30">
                                                                {orderType === 'uniforms' ? (
                                                                    <div className="px-3 py-2 text-center font-extrabold text-xs text-emerald-800 bg-emerald-50/70 border-l-[3px] border-l-emerald-500 flex items-center justify-center gap-1 shadow-2xs" title="Sincronizado automáticamente desde En Existencia del Módulo de Uniformes">
                                                                        <span>🎽 {currentLeftover !== undefined ? currentLeftover : 0}</span>
                                                                        <span className="text-[10px] text-emerald-600 font-medium">({t('bodegaOrders.inStock') || 'En Existencia'})</span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="relative flex items-center">
                                                                        <input
                                                                            id={`input_${rowIndex}_0`}
                                                                            type="number"
                                                                            placeholder={t('bodegaOrders.enterLeftover')}
                                                                            className="w-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-orange-400 font-bold text-orange-800 text-sm placeholder:text-orange-300 placeholder:text-xs placeholder:font-normal border-l-[3px] border-l-orange-400"
                                                                            value={currentLeftover !== undefined ? currentLeftover : ''}
                                                                            onChange={e => handleInlineLeftoverChange(line.inventory_item_id, e.target.value)}
                                                                            onKeyDown={e => handleGridKeyDown(e, rowIndex, 0)}
                                                                            onFocus={e => e.target.select()}
                                                                        />
                                                                        {line.variance !== null && line.variance !== undefined && currentLeftover !== undefined && (
                                                                            <span className={`absolute right-1 text-[9px] px-1 py-0.5 rounded font-black ${
                                                                                line.variance === 0
                                                                                    ? 'bg-emerald-100 text-emerald-800'
                                                                                    : line.variance < 0
                                                                                    ? 'bg-amber-100 text-amber-800'
                                                                                    : 'bg-red-100 text-red-800'
                                                                            }`} title={`Varianza: ${line.variance > 0 ? '+' : ''}${line.variance}`}>
                                                                                {line.variance > 0 ? `+${line.variance}` : line.variance}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            {/* Pedir (calculated) */}
                                                            <td className={`p-2 text-center font-bold border-b ${
                                                                isNegative ? 'text-red-600 bg-red-50/40 border-red-100'
                                                                : isZeroLeftover ? 'text-slate-300 bg-slate-50 border-slate-100'
                                                                : 'text-blue-700 bg-blue-50/30 border-blue-100'
                                                            }`}>
                                                                {isZeroLeftover ? '-' : line.calculated_qty}
                                                            </td>
                                                            {/* Ajuste (optional override) */}
                                                            <td className="p-0 border-b border-indigo-100 bg-indigo-50/20">
                                                                <input
                                                                    id={`input_${rowIndex}_1`}
                                                                    type="number"
                                                                    placeholder="-"
                                                                    className="w-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-indigo-400 font-bold text-indigo-700 text-sm placeholder:text-indigo-200"
                                                                    value={adj !== undefined ? adj : ''}
                                                                    onChange={e => {
                                                                        const v = e.target.value
                                                                        if (v === '') {
                                                                            const newAdj = { ...adjustments }
                                                                            delete newAdj[line.inventory_item_id]
                                                                            setAdjustments(newAdj)
                                                                        } else {
                                                                            setAdjustments({ ...adjustments, [line.inventory_item_id]: parseFloat(v) || 0 })
                                                                        }
                                                                    }}
                                                                    onKeyDown={e => handleGridKeyDown(e, rowIndex, 1)}
                                                                    onFocus={e => e.target.select()}
                                                                />
                                                            </td>
                                                            {/* Final */}
                                                            <td className={`p-2 text-center font-black text-base border-b border-indigo-100 bg-indigo-50/20 ${isZeroLeftover ? 'text-slate-300' : 'text-indigo-800'}`}>
                                                                {isZeroLeftover ? '-' : finalQty}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}

                                                {/* ---- Extraordinary items ---- */}
                                                {extraordinaryLines.length > 0 && (
                                                    <tr>
                                                        <td colSpan={8 + (showParIdealCol ? 1 : 0) + (showSuggestedCol ? 1 : 0)} className="p-3 text-center bg-indigo-50/50 border-y-2 border-indigo-200">
                                                            <span className="text-xs font-black text-indigo-700 uppercase tracking-widest">
                                                                ── Insumos Extraordinarios / Emergency Items ──
                                                            </span>
                                                        </td>
                                                    </tr>
                                                )}

                                                {extraordinaryLines.map((line, idx) => {
                                                    const rowIndex = orderableLines.length + idx + 1
                                                    const adj = adjustments[line.inventory_item_id]
                                                    const finalQty = adj !== undefined ? adj : line.calculated_qty

                                                    return (
                                                        <tr key={line.inventory_item_id} className="transition-colors border-b border-indigo-100/50 hover:bg-indigo-50/10">
                                                            {/* Producto */}
                                                            <td className="sticky left-0 bg-white border-b border-indigo-100 p-2.5 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)]">
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setOrderLines(prev => prev.filter(l => l.inventory_item_id !== line.inventory_item_id))
                                                                            setAdjustments(prev => {
                                                                                const copy = { ...prev }
                                                                                delete copy[line.inventory_item_id]
                                                                                return copy
                                                                            })
                                                                        }}
                                                                        className="text-red-500 hover:text-red-700 transition-colors p-1"
                                                                        title="Eliminar insumo extraordinario"
                                                                    >
                                                                        <Trash2 size={15} />
                                                                    </button>
                                                                    <div className="flex flex-col">
                                                                        {line.unit_description && (
                                                                            <span className="text-[10px] text-slate-400 font-medium leading-tight">{line.unit_description}</span>
                                                                        )}
                                                                        {renderItemName(line.item_name, "font-semibold text-indigo-900")}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            {/* Empaque (QB) */}
                                                            <td className="p-2 text-center text-slate-600 border-b border-indigo-100 font-medium text-xs font-mono">{line.unit_description || '-'}</td>
                                                            {/* Costo (QB) */}
                                                            <td className="p-2 text-center text-slate-700 border-b border-indigo-100 font-bold text-xs">
                                                                {line.purchase_unit_cost ? `$${Number(line.purchase_unit_cost).toFixed(2)}` : '-'}
                                                            </td>
                                                            {/* PAR Ideal — dash */}
                                                            {showParIdealCol && (
                                                                <td className="p-2 text-center text-slate-300 border-b border-indigo-100 bg-indigo-50/5">—</td>
                                                            )}
                                                            {/* PAR — dash */}
                                                            <td className="p-2 text-center text-slate-300 border-b border-indigo-100 bg-indigo-50/5">—</td>
                                                            {/* Sugerido — dash */}
                                                            {showSuggestedCol && (
                                                                <td className="p-2 text-center text-slate-300 border-b border-indigo-100 bg-indigo-50/5">—</td>
                                                            )}
                                                            {/* Sobrante — dash */}
                                                            <td className="p-2 text-center text-slate-300 border-b border-indigo-100 bg-indigo-50/5">—</td>
                                                            {/* Pedir — dash */}
                                                            <td className="p-2 text-center text-slate-300 border-b border-indigo-100 bg-indigo-50/5">—</td>
                                                            {/* Ajuste (optional override) */}
                                                            <td className="p-0 border-b border-indigo-250 bg-indigo-50/20">
                                                                <input
                                                                    id={`input_${rowIndex}_1`}
                                                                    type="number"
                                                                    placeholder="-"
                                                                    className="w-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-indigo-400 font-bold text-indigo-700 text-sm placeholder:text-indigo-200 border-l-[3px] border-l-indigo-300"
                                                                    value={adj !== undefined ? adj : ''}
                                                                    onChange={e => {
                                                                        const v = e.target.value
                                                                        if (v === '') {
                                                                            const newAdj = { ...adjustments }
                                                                            delete newAdj[line.inventory_item_id]
                                                                            setAdjustments(newAdj)
                                                                        } else {
                                                                            setAdjustments({ ...adjustments, [line.inventory_item_id]: parseFloat(v) || 0 })
                                                                        }
                                                                    }}
                                                                    onKeyDown={e => handleGridKeyDown(e, rowIndex, 1)}
                                                                    onFocus={e => e.target.select()}
                                                                />
                                                            </td>
                                                            {/* Final */}
                                                            <td className="p-2 text-center font-black text-base border-b border-indigo-100 bg-indigo-50/20 text-indigo-800">
                                                                {finalQty}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}

                                                {/* ---- Tracking Only separator ---- */}
                                                {trackingLines.length > 0 && (
                                                    <tr>
                                                        <td colSpan={8 + (showParIdealCol ? 1 : 0) + (showSuggestedCol ? 1 : 0)} className="p-3 text-center bg-slate-100 border-y-2 border-slate-300">
                                                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                                                                ── {t('bodegaOrders.trackingOnly')} / Tracking Only ──
                                                            </span>
                                                        </td>
                                                    </tr>
                                                )}

                                                {/* ---- Tracking-only items ---- */}
                                                {trackingLines.map((line, idx) => {
                                                    const rowIndex = orderableLines.length + idx + 1
                                                    const currentLeftover = counts[line.inventory_item_id]?.[selectedOrderDate]

                                                    return (
                                                        <tr key={line.inventory_item_id} className="transition-colors border-b border-slate-100 hover:bg-slate-50/50">
                                                            {/* Producto */}
                                                            <td className="sticky left-0 bg-white border-b border-slate-100 p-2.5 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)]">
                                                                <div className="flex flex-col">
                                                                    {line.unit_description && (
                                                                        <span className="text-[10px] text-slate-400 font-medium leading-tight">{line.unit_description}</span>
                                                                    )}
                                                                    {renderItemName(line.item_name, "font-semibold text-slate-500")}
                                                                </div>
                                                            </td>
                                                            {/* Empaque (QB) */}
                                                            <td className="p-2 text-center text-slate-600 border-b border-slate-100 font-medium text-xs">{line.unit_description || '-'}</td>
                                                            {/* Costo (QB) */}
                                                            <td className="p-2 text-center text-slate-700 border-b border-slate-100 font-bold text-xs">
                                                                {line.purchase_unit_cost ? `$${Number(line.purchase_unit_cost).toFixed(2)}` : '-'}
                                                            </td>
                                                            {/* PAR Ideal */}
                                                            {showParIdealCol && (
                                                                <td className="p-2 text-center font-medium text-violet-500 bg-violet-50/20 border-b border-violet-100">
                                                                    {line.par_ideal_value || '-'}
                                                                </td>
                                                            )}
                                                            {/* PAR */}
                                                            <td className="p-2 text-center font-bold text-emerald-600 bg-emerald-50/30 border-b border-emerald-100">
                                                                {line.par_value || '-'}
                                                            </td>
                                                            {/* Sugerido — dash */}
                                                            {showSuggestedCol && (
                                                                <td className="p-2 text-center text-slate-300 border-b border-slate-100">—</td>
                                                            )}
                                                            {/* Sobrante (EDITABLE for tracking too) */}
                                                            <td className="p-0 border-b border-orange-200 bg-orange-50/20">
                                                                <input
                                                                    id={`input_${rowIndex}_0`}
                                                                    type="number"
                                                                    placeholder={t('bodegaOrders.enterLeftover')}
                                                                    className="w-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-orange-400 font-bold text-orange-700 text-sm placeholder:text-orange-300 placeholder:text-xs placeholder:font-normal border-l-[3px] border-l-orange-300"
                                                                    value={currentLeftover !== undefined ? currentLeftover : ''}
                                                                    onChange={e => handleInlineLeftoverChange(line.inventory_item_id, e.target.value)}
                                                                    onKeyDown={e => handleGridKeyDown(e, rowIndex, 0)}
                                                                    onFocus={e => e.target.select()}
                                                                />
                                                            </td>
                                                            {/* Pedir — dash */}
                                                            <td className="p-2 text-center text-slate-300 border-b border-slate-100">—</td>
                                                            {/* Ajuste — dash */}
                                                            <td className="p-2 text-center text-slate-300 border-b border-slate-100">—</td>
                                                            {/* Final — dash */}
                                                            <td className="p-2 text-center text-slate-300 border-b border-slate-100">—</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* ---- Search bar for emergency items (Outside the table) ---- */}
                                    <div className="p-4 border-t border-slate-200 bg-indigo-50/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                        <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider whitespace-nowrap flex items-center gap-1.5">
                                            🚨 ¿Pedir insumo extraordinario de emergencia?:
                                        </span>
                                        <div className="relative flex-1 z-25">
                                            <input
                                                type="text"
                                                placeholder="Escribe el nombre del insumo para buscar..."
                                                value={extraordinarySearch}
                                                onChange={e => {
                                                    setExtraordinarySearch(e.target.value)
                                                    setShowExtraordinaryDropdown(true)
                                                }}
                                                onFocus={() => setShowExtraordinaryDropdown(true)}
                                                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 font-medium"
                                            />
                                            
                                            {showExtraordinaryDropdown && extraordinarySearch.trim().length > 0 && (
                                                <div className="absolute left-0 right-0 bottom-full mb-1 z-30 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                                    {mappedItems
                                                        .filter(item => {
                                                            const isAlreadyAdded = orderLines.some(l => l.inventory_item_id === item.id)
                                                            const matchesSearch = item.name.toLowerCase().includes(extraordinarySearch.toLowerCase())
                                                            return !isAlreadyAdded && matchesSearch
                                                        })
                                                        .map(item => (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    const newLine = {
                                                                        inventory_item_id: item.id,
                                                                        item_name: item.name,
                                                                        unit_description: item.order_unit_description || item.unit_type,
                                                                        par_value: 0,
                                                                        par_ideal_value: 0,
                                                                        leftover_value: null,
                                                                        calculated_qty: 0,
                                                                        rounding_rule: 'none',
                                                                        qb_item_id: item.qb_item_id,
                                                                        is_extraordinary: true
                                                                    }
                                                                    setOrderLines(prev => [...prev, newLine])
                                                                    setAdjustments(prev => ({ ...prev, [item.id]: 1 }))
                                                                    setExtraordinarySearch('')
                                                                    setShowExtraordinaryDropdown(false)
                                                                }}
                                                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors flex items-center justify-between border-b border-slate-100 last:border-0"
                                                            >
                                                                {renderItemName(item.name, "font-semibold text-slate-800")}
                                                                <span className="text-xs text-slate-400 font-medium">({item.unit_type})</span>
                                                            </button>
                                                        ))
                                                    }
                                                    {mappedItems.filter(item => {
                                                        const isAlreadyAdded = orderLines.some(l => l.inventory_item_id === item.id)
                                                        const matchesSearch = item.name.toLowerCase().includes(extraordinarySearch.toLowerCase())
                                                        return !isAlreadyAdded && matchesSearch
                                                    }).length === 0 && (
                                                        <div className="p-4 text-center text-xs text-slate-400">
                                                            No se encontraron insumos mapeados
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {/* Click outside backdrop */}
                                        {showExtraordinaryDropdown && (
                                            <div 
                                                className="fixed inset-0 z-10 bg-transparent"
                                                onClick={() => setShowExtraordinaryDropdown(false)}
                                            />
                                        )}
                                    </div>

                                    {/* ---- Observations textarea ---- */}
                                    <div className="p-5 border-t border-slate-200 bg-slate-50/30">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            📝 {t('bodegaOrders.observations')}
                                        </label>
                                        <textarea
                                            value={orderNotes}
                                            onChange={e => setOrderNotes(e.target.value)}
                                            placeholder={t('bodegaOrders.observationsPlaceholder')}
                                            rows={2}
                                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 resize-none bg-white placeholder:text-slate-400"
                                        />
                                    </div>

                                    {/* ---- Action buttons ---- */}
                                    <div className="p-5 border-t border-slate-200 bg-slate-50/50 flex flex-wrap gap-3 justify-end">
                                        <button
                                            onClick={() => {
                                                const url = `/inventory/orders/print-sheet?storeId=${storeId}&orderType=${orderType}&week=${activeMonday}`
                                                window.open(url, '_blank')
                                            }}
                                            className="flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-5 py-3 rounded-xl font-bold shadow-sm transition-colors"
                                        >
                                            <Printer size={16} /> {t('bodegaOrders.printSheet')}
                                        </button>
                                        <button onClick={handleGenerateOrder} disabled={saving}
                                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold shadow-sm transition-colors disabled:opacity-50">
                                            <Save size={16} /> {saving ? t('bodegaOrders.saving') : t('bodegaOrders.generateOrder')}
                                        </button>
                                        <button onClick={handleSendToQb} disabled={sendingToQb || !isCurrentWeek}
                                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                            <Send size={16} /> {sendingToQb ? t('bodegaOrders.sendingToQb') : t('bodegaOrders.sendToQb')}
                                        </button>
                                    </div>

                                </div>
                            )
                        })()}

                        {/* ======================================================== */}
                        {/* TAB 2: WEEKLY CONFIG                                     */}
                        {/* ======================================================== */}
                        {activeTab === 'weekly_config' && (
                            <div>
                                {/* ---- Header ---- */}
                                <div className="px-5 pt-5 pb-3 border-b border-slate-200">
                                    <h2 className="text-xl font-black text-slate-800">
                                        ⚙️ {t('bodegaOrders.weeklyConfigTitle')}
                                    </h2>
                                    <p className="text-sm text-slate-500 mt-0.5">{t('bodegaOrders.weeklyConfigSubtitle')}</p>
                                </div>

                                {/* ---- Action buttons bar ---- */}
                                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center gap-2">
                                    <button onClick={handleSavePar} disabled={savingPar || !hasBaseChanges}
                                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-all duration-200 ${
                                            hasBaseChanges 
                                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer ring-2 ring-emerald-400 ring-offset-1' 
                                                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                        }`}>
                                        <Save size={14} /> {savingPar ? t('bodegaOrders.savingPar') : t('bodegaOrders.savePar')}
                                    </button>

                                    {/* Live Auto-Save Badge */}
                                    <span className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1.5 rounded-xl font-bold text-[11px] shadow-2xs">
                                        <span className={`w-2 h-2 rounded-full ${isLiveSaving ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
                                        {isLiveSaving 
                                            ? (language === 'es' ? 'Guardando en vivo...' : 'Saving live...') 
                                            : (language === 'es' ? '⚡ Guardado en vivo activo' : '⚡ Live Auto-Save Active')
                                        }
                                    </span>
                                    {hasBaseChanges && (
                                        <button onClick={handleUndoBases}
                                            className="flex items-center gap-1.5 bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 px-3 py-2 rounded-xl font-semibold text-xs shadow-sm transition-colors cursor-pointer"
                                        >
                                            <X size={14} /> Deshacer / Descartar
                                        </button>
                                    )}
                                    <button onClick={handleCopyPreviousWeek} disabled={loading}
                                        className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-xl font-semibold text-xs shadow-sm transition-colors disabled:opacity-50">
                                        <Copy size={14} /> {t('bodegaOrders.copyPrevWeek')}
                                    </button>
                                    <button onClick={handleCopyParIdeal} disabled={loading}
                                        className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 px-3 py-2 rounded-xl font-semibold text-xs shadow-sm transition-colors disabled:opacity-50">
                                        <RefreshCcw size={14} /> {t('bodegaOrders.copyFromParIdeal')}
                                    </button>

                                    {orderType === 'daily' && (
                                         <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm text-xs select-none">
                                             <span className="font-bold text-slate-500">📋 Copiar PAR:</span>
                                             <select 
                                                 value={copySrcDay} 
                                                 onChange={(e) => setCopySrcDay(e.target.value)} 
                                                 className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer focus:text-blue-600 font-sans border-0 p-0"
                                             >
                                                 <option value="mon_par">Lunes</option>
                                                 <option value="tue_par">Martes</option>
                                                 <option value="wed_par">Miércoles</option>
                                                 <option value="thu_par">Jueves</option>
                                                 <option value="fri_par">Viernes</option>
                                                 <option value="sat_par">Sábado</option>
                                                 <option value="sun_par">Domingo</option>
                                             </select>
                                             <span className="font-bold text-slate-400">➡️ a:</span>
                                             <select 
                                                 value={copyTgtDay} 
                                                 onChange={(e) => setCopyTgtDay(e.target.value)} 
                                                 className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer focus:text-blue-600 font-sans border-0 p-0"
                                             >
                                                 <option value="all">Todos los días</option>
                                                 <option value="mon_par">Lunes</option>
                                                 <option value="tue_par">Martes</option>
                                                 <option value="wed_par">Miércoles</option>
                                                 <option value="thu_par">Jueves</option>
                                                 <option value="fri_par">Viernes</option>
                                                 <option value="sat_par">Sábado</option>
                                                 <option value="sun_par">Domingo</option>
                                             </select>
                                             <button 
                                                 onClick={() => handleCopyDayPar(copySrcDay, copyTgtDay)}
                                                 className="ml-1 bg-blue-600 hover:bg-blue-700 text-white font-black px-2.5 py-1 rounded-lg transition-all text-xs"
                                             >
                                                 Copiar
                                             </button>
                                         </div>
                                    )}

                                    {orderType === 'daily' && (
                                         <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 shadow-sm text-xs select-none ml-auto sm:ml-2">
                                             <button
                                                 type="button"
                                                 onClick={() => setWeeklyRightView('leftovers')}
                                                 className={`px-3 py-1 font-bold rounded-lg transition-all ${
                                                     weeklyRightView === 'leftovers'
                                                         ? 'bg-orange-600 text-white shadow-2xs'
                                                         : 'hover:bg-slate-200 text-slate-700'
                                                 }`}
                                             >
                                                 📦 {t('bodegaOrders.showLeftovers')}
                                             </button>
                                             <button
                                                 type="button"
                                                 onClick={() => setWeeklyRightView('par_ideal')}
                                                 className={`px-3 py-1 font-bold rounded-lg transition-all ${
                                                     weeklyRightView === 'par_ideal'
                                                         ? 'bg-indigo-600 text-white shadow-2xs'
                                                         : 'hover:bg-slate-200 text-slate-700'
                                                 }`}
                                             >
                                                 ✨ {t('bodegaOrders.showParIdeal')}
                                             </button>
                                         </div>
                                    )}

                                    <div className="flex-1" />

                                    {/* Close Week button */}
                                    {isCurrentWeek && capturedSunday === items.length && items.length > 0 && (
                                        <button onClick={handleCloseWeek} disabled={loading}
                                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-colors">
                                            <Check size={14} /> {t('bodegaOrders.closeWeek')}
                                        </button>
                                    )}
                                </div>

                                {/* ---- BASE PAR table (editable grid) ---- */}
                                <div className="overflow-auto max-h-[calc(100vh-280px)] border border-slate-200 rounded-xl shadow-sm bg-white">
                                    <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                                        <thead>
                                            {/* Primera Fila: Encabezados de grupo */}
                                            <tr>
                                                <th rowSpan={2} className="bg-slate-100 border-b-2 border-slate-300 p-3 sticky left-0 top-0 z-30 font-black min-w-[200px] shadow-[2px_0_5px_rgba(0,0,0,0.05)] align-middle text-slate-700">
                                                    {t('bodegaOrders.item')}
                                                </th>
                                                {orderType === 'daily' ? (
                                                    <>
                                                        <th colSpan={7} className="bg-emerald-100/80 text-emerald-800 text-center font-black text-xs uppercase tracking-wider py-1.5 border-b-2 border-emerald-300 sticky top-0 z-20">
                                                            {t('bodegaOrders.parActualHeader')}
                                                        </th>
                                                        <th rowSpan={2} className="bg-slate-300 border-b-2 border-slate-300 p-0 w-[2px] sticky top-0 z-20"></th>
                                                        <th colSpan={7} className={`text-center font-black text-xs uppercase tracking-wider py-1.5 border-b-2 sticky top-0 z-20 ${
                                                            weeklyRightView === 'leftovers'
                                                                ? 'bg-orange-100/80 text-orange-800 border-orange-300'
                                                                : 'bg-violet-100/80 text-violet-800 border-violet-300'
                                                        }`}>
                                                            {weeklyRightView === 'leftovers' ? t('bodegaOrders.showLeftovers') : t('bodegaOrders.parIdealHeader')}
                                                        </th>
                                                    </>
                                                ) : (
                                                    <>
                                                        <th className="bg-emerald-100/80 text-emerald-800 text-center font-black text-xs uppercase tracking-wider py-1.5 border-b-2 border-emerald-300 w-32 sticky top-0 z-20">
                                                            {t('bodegaOrders.parActualHeader')}
                                                        </th>
                                                        <th rowSpan={2} className="bg-slate-300 border-b-2 border-slate-300 p-0 w-[2px] sticky top-0 z-20"></th>
                                                        <th className="bg-violet-100/80 text-violet-800 text-center font-black text-xs uppercase tracking-wider py-1.5 border-b-2 border-violet-300 w-24 sticky top-0 z-20">
                                                            {t('bodegaOrders.parIdealHeader')}
                                                        </th>
                                                    </>
                                                )}
                                            </tr>
                                            {/* Segunda Fila: Detalles de los días */}
                                            <tr>
                                                {orderType === 'daily' ? (
                                                    <>
                                                        {weekDays.map(d => (
                                                            <th key={`bh_${d.key}`} className="bg-emerald-50 border-b border-emerald-200 p-2 text-center w-20 text-xs text-emerald-700 font-bold sticky top-[36px] z-20">
                                                                {d.label}<br/>
                                                                <span className="font-normal text-emerald-500">{d.dateStr.slice(5)}</span>
                                                            </th>
                                                        ))}
                                                        {weekDays.map(d => (
                                                            <th key={`pih_${d.key}`} className={`border-b p-2 text-center w-16 text-[10px] font-bold sticky top-[36px] z-20 ${
                                                                weeklyRightView === 'leftovers'
                                                                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                                                                    : 'bg-violet-50/60 border-violet-200 text-violet-600'
                                                            }`}>
                                                                {d.label}<br/>
                                                                <span className="font-normal">{weeklyRightView === 'leftovers' ? d.dateStr.slice(5) : 'Ideal'}</span>
                                                            </th>
                                                        ))}
                                                    </>
                                                ) : (
                                                    <>
                                                        <th className="bg-emerald-50 border-b border-emerald-200 p-1.5 text-center text-xs text-emerald-700 font-bold sticky top-[36px] z-20">
                                                            PAR
                                                        </th>
                                                        <th className="bg-violet-50/60 border-b border-violet-200 p-1.5 text-center text-[10px] text-violet-600 font-bold sticky top-[36px] z-20">
                                                            Ideal
                                                        </th>
                                                    </>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item, rowIndex) => {
                                                const b = bases[item.id]

                                                return (
                                                    <tr key={item.id} className="hover:bg-emerald-50/20 transition-colors border-b border-slate-100">
                                                        <td className="sticky left-0 bg-white border-b border-slate-100 p-2.5 font-semibold text-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.03)] z-10">
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-slate-400 font-medium leading-tight">{item.order_unit_description || ''}</span>
                                                                {renderItemName(item.excel_reference || item.name, "")}
                                                            </div>
                                                        </td>
                                                        {orderType === 'daily' ? (
                                                            <>
                                                            {weekDays.map((d, colIndex) => {
                                                                const val = b ? (b as any)[d.baseField] : undefined
                                                                const piVal = parIdeal[item.id] ? (parIdeal[item.id] as any)[d.baseField] : undefined
                                                                const isOver = val !== undefined && (val || 0) > (piVal || 0)
                                                                const isUnder = val !== undefined && (val || 0) < (piVal || 0)

                                                                const dayOffset = fieldIndexMap[d.baseField] ?? 0
                                                                const fieldDateStr = addDays(activeMonday, dayOffset)
                                                                const hasLeftover = counts[item.id]?.[fieldDateStr] !== undefined && counts[item.id]?.[fieldDateStr] !== null
                                                                const isPastDay = fieldDateStr < todayStr
                                                                const isLocked = hasLeftover || isPastDay
                                                                const nextWeekVal = nextWeekBases[item.id] ? (nextWeekBases[item.id] as any)[d.baseField] : undefined

                                                                return (
                                                                    <td key={`bc_${item.id}_${d.key}`} className="p-1 border-b border-emerald-100/50 text-center">
                                                                        <input
                                                                            id={`input_${rowIndex}_${colIndex}`}
                                                                            type="number"
                                                                            placeholder=""
                                                                            className={`w-full p-2 text-center outline-none focus:bg-white focus:ring-2 text-sm transition-all rounded-lg ${
                                                                                isOver
                                                                                ? 'bg-indigo-50/50 text-indigo-700 font-bold border-b-2 border-b-indigo-400 focus:ring-indigo-400'
                                                                                : isUnder
                                                                                ? 'bg-amber-50/50 text-amber-700 font-bold border-b-2 border-b-amber-400 focus:ring-amber-400'
                                                                                : 'bg-transparent text-slate-800 font-medium border-b border-b-transparent focus:ring-emerald-400'
                                                                            }`}
                                                                            value={val !== undefined && val !== null ? val : ''}
                                                                            onChange={e => handleBaseChange(item.id, d.baseField, e.target.value)}
                                                                            onKeyDown={e => handleGridKeyDown(e, rowIndex, colIndex)}
                                                                            onFocus={e => e.target.select()}
                                                                        />
                                                                        {isLocked && nextWeekVal !== undefined && nextWeekVal !== val && (
                                                                            <div className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5 mt-0.5 text-center shadow-2xs" title="Este valor está guardado y se aplicará automáticamente a partir de la PRÓXIMA SEMANA">
                                                                                ➡️ Próx: {nextWeekVal}
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            {/* PAR Ideal values (violet, readonly) */}
                                                            <td className="bg-slate-200 p-0 w-[2px] border-b border-slate-200"></td>
                                                            {weekDays.map(d => {
                                                                if (weeklyRightView === 'leftovers') {
                                                                    const itemCounts = counts[item.id] || {}
                                                                    const leftover = itemCounts[d.dateStr]
                                                                    const hasVal = leftover !== undefined && leftover !== null
                                                                    const origB = originalBases[item.id] || b
                                                                    const parVal = origB ? Number((origB as any)[d.baseField]) || 0 : (b ? Number((b as any)[d.baseField]) || 0 : 0)
                                                                    const isSaturday = d.key === 'sat'

                                                                    let pct: number | null = null
                                                                    let traffic = { bg: '', text: 'text-slate-300', border: '', label: '' }

                                                                    if (hasVal && parVal >= 8) {
                                                                        pct = Math.round((leftover / parVal) * 100)
                                                                        traffic = getTrafficLight(pct, isSaturday)
                                                                    } else if (hasVal && leftover === 0) {
                                                                        pct = 0
                                                                        traffic = { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: '🔴' }
                                                                    }

                                                                    if (!hasVal) {
                                                                        return (
                                                                            <td key={`cnt_${item.id}_${d.key}`} className="border-b border-slate-100 text-slate-200 p-1.5 text-center bg-slate-50/10">
                                                                                -
                                                                            </td>
                                                                        )
                                                                    }

                                                                    return (
                                                                        <td key={`cnt_${item.id}_${d.key}`} className={`border-b border-slate-100 p-1 text-center font-bold ${traffic.bg} transition-all`}>
                                                                            <div className="flex items-center justify-center gap-1.5 min-h-[32px]">
                                                                                <span className={`text-sm font-black ${leftover === 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                                                                    {leftover}
                                                                                </span>
                                                                                {pct !== null ? (
                                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${traffic.text} ${
                                                                                        traffic.bg === 'bg-red-50' ? 'bg-red-100' 
                                                                                        : traffic.bg === 'bg-emerald-50' ? 'bg-emerald-100' 
                                                                                        : traffic.bg === 'bg-amber-50' ? 'bg-amber-100' 
                                                                                        : 'bg-slate-100'
                                                                                    }`}>
                                                                                        {pct}%
                                                                                    </span>
                                                                                ) : null}
                                                                            </div>
                                                                        </td>
                                                                    )
                                                                } else {
                                                                    const piVal = parIdeal[item.id] ? (parIdeal[item.id] as any)[d.baseField] : null
                                                                    return (
                                                                        <td key={`pi_${item.id}_${d.key}`} className="border-b border-violet-100/50 p-1.5 text-center text-violet-500 font-medium text-xs bg-violet-50/20">
                                                                            {piVal || '-'}
                                                                        </td>
                                                                    )
                                                                }
                                                            })}
                                                            </>
                                                        ) : (
                                                            <>
                                                            {(() => {
                                                                const val = b ? b.mon_par : undefined
                                                                const piVal = parIdeal[item.id] ? parIdeal[item.id].mon_par : undefined
                                                                const isOver = val !== undefined && (val || 0) > (piVal || 0)
                                                                const isUnder = val !== undefined && (val || 0) < (piVal || 0)

                                                                return (
                                                                    <td className="p-0 border-b border-emerald-100/50">
                                                                        <input
                                                                            id={`input_${rowIndex}_0`}
                                                                            type="number"
                                                                            placeholder=""
                                                                            className={`w-full h-full p-2.5 text-center outline-none focus:bg-white focus:ring-2 text-sm transition-all ${
                                                                                isOver
                                                                                ? 'bg-indigo-50/50 text-indigo-700 font-bold border-b-2 border-b-indigo-400 focus:ring-indigo-400'
                                                                                : isUnder
                                                                                ? 'bg-amber-50/50 text-amber-700 font-bold border-b-2 border-b-amber-400 focus:ring-amber-400'
                                                                                : 'bg-transparent text-slate-800 font-medium border-b border-b-transparent focus:ring-emerald-400'
                                                                            }`}
                                                                            value={val !== undefined && val !== null ? val : ''}
                                                                            onChange={e => handleLiquidsParChange(item.id, e.target.value)}
                                                                            onKeyDown={e => handleGridKeyDown(e, rowIndex, 0)}
                                                                            onFocus={e => e.target.select()}
                                                                        />
                                                                    </td>
                                                                )
                                                            })()}
                                                            {/* PAR Ideal value (violet, readonly) */}
                                                            <td className="bg-slate-200 p-0 w-[2px] border-b border-slate-200"></td>
                                                            <td className="border-b border-violet-100/50 p-1.5 text-center text-violet-500 font-medium text-xs bg-violet-50/20">
                                                                {parIdeal[item.id]?.mon_par || '-'}
                                                            </td>
                                                            </>
                                                        )}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>


                            </div>
                        )}

                        {/* ======================================================== */}
                        {/* TAB 3: HISTORY                                            */}
                        {/* ======================================================== */}
                        {activeTab === 'history' && (
                            <div className="p-6">
                                {/* Header + Week Navigator */}
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
                                    <div>
                                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                            📄 {t('bodegaOrders.historyTab')}
                                        </h2>
                                        <p className="text-sm text-slate-500 mt-0.5">
                                            {language === 'es' 
                                                ? `Pedidos registrados de la semana` 
                                                : `Registered orders for the week`}
                                        </p>
                                    </div>
                                    {/* Week navigator */}
                                    <div className="flex items-center gap-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                        <button className="px-3 py-2.5 hover:bg-slate-100 transition-colors" onClick={() => setHistoryMonday(addDays(historyMonday, -7))}>
                                            <ArrowLeft className="w-4 h-4 text-slate-500" />
                                        </button>
                                        <div className="px-3 py-2 font-bold text-sm border-x border-slate-200 min-w-[140px] text-center">
                                            {historyMonday === getMonday(new Date()) && <span className="text-xs text-emerald-600 block font-medium">{language === 'es' ? 'Semana Actual' : 'Current Week'}</span>}
                                            {historyMonday} → {addDays(historyMonday, 6)}
                                        </div>
                                        <button className="px-3 py-2.5 hover:bg-slate-100 transition-colors" onClick={() => setHistoryMonday(addDays(historyMonday, 7))}>
                                            <ArrowRight className="w-4 h-4 text-slate-500" />
                                        </button>
                                    </div>
                                </div>

                                {/* Advertencia */}
                                <div className="mb-5 bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-xs text-amber-800 leading-relaxed shadow-sm">
                                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <strong className="block font-bold mb-0.5 text-amber-900">⚠️ {language === 'es' ? 'ADVERTENCIA OPERATIVA' : 'OPERATIONAL WARNING'}</strong>
                                        {language === 'es' 
                                            ? 'Desde aquí puedes editar cantidades de pedidos anteriores con el botón ✏️ Editar, lo cual actualizará el Estimate en QuickBooks automáticamente. Al eliminar un pedido, también se eliminará de forma definitiva el Estimate en QuickBooks.'
                                            : 'From here you can edit quantities of previous orders using the ✏️ Edit button, which will automatically update the QuickBooks Estimate. Deleting an order will also permanently delete the QuickBooks Estimate.'}
                                    </div>
                                </div>

                                {historyLoading ? (
                                    <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
                                        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
                                        {language === 'es' ? 'Cargando historial...' : 'Loading history...'}
                                    </div>
                                ) : historyOrders.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {historyOrders.map((order: any) => {
                                            const isDeleting = deletingOrderId === order.id
                                            return (
                                                <div key={order.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow relative flex flex-col justify-between min-h-[160px]">
                                                    <div>
                                                        <div className="flex justify-between items-start mb-2">
                                                            <span className="font-black text-slate-800 text-sm">📅 {language === 'es' ? 'Pedido del' : 'Order from'} {order.order_date}</span>
                                                            <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                                                order.status === 'sent' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                                                order.status === 'draft' ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                                                                'bg-blue-100 text-blue-800 border border-blue-200'
                                                            }`}>
                                                                {t(`bodegaOrders.status.${order.status}`)}
                                                            </span>
                                                        </div>

                                                        {order.qb_estimate_number && (
                                                            <div className="text-xs text-emerald-600 font-bold mb-1 flex items-center gap-1">
                                                                <span>Estimate QB: #{order.qb_estimate_number}</span>
                                                            </div>
                                                        )}

                                                        <div className="text-[11px] text-slate-400 mt-1">
                                                            {language === 'es' ? 'Creado por' : 'Created by'}: {order.created_by || 'Sistema'}
                                                        </div>

                                                        {order.notes && (
                                                            <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg mt-2 border border-slate-100 italic truncate max-h-[50px]">
                                                                &quot;{order.notes}&quot;
                                                            </p>
                                                        )}

                                                        {order.inventory_order_lines && (
                                                            <div className="text-[11px] text-blue-500 mt-2 font-medium">
                                                                📦 {order.inventory_order_lines.length} {language === 'es' ? 'items' : 'items'}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                                                        <div className="flex gap-2">
                                                            {order.qb_estimate_number ? (
                                                                <button 
                                                                    onClick={() => window.open(`/api/inventory/orders/estimate-pdf?estimateId=${order.qb_estimate_id}`, '_blank')}
                                                                    className="text-xs text-blue-600 hover:text-blue-800 font-bold transition-colors flex items-center gap-1"
                                                                >
                                                                    🖨️ PDF
                                                                </button>
                                                            ) : (
                                                                <span className="text-[11px] text-slate-400">{language === 'es' ? 'Sin QB' : 'No QB'}</span>
                                                            )}

                                                            <button
                                                                onClick={() => handleOpenEditModal(order)}
                                                                className={`text-xs px-2.5 py-1 rounded-lg font-black transition-all flex items-center gap-0.5 ${order.order_date === todayStr ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                                                            >
                                                                {order.order_date === todayStr
                                                                    ? `✏️ ${language === 'es' ? 'Editar' : 'Edit'}`
                                                                    : `👁️ ${language === 'es' ? 'Ver' : 'View'}`
                                                                }
                                                            </button>
                                                        </div>

                                                        <button
                                                            onClick={() => handleDeleteOrder(order.id, order.qb_estimate_number)}
                                                            disabled={isDeleting || loading}
                                                            className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 p-1.5 rounded-lg font-bold flex items-center gap-1 transition-all disabled:opacity-50"
                                                        >
                                                            <Trash2 size={13} className={isDeleting ? 'animate-pulse' : ''} />
                                                            {isDeleting 
                                                                ? (language === 'es' ? 'Eliminando...' : 'Deleting...') 
                                                                : (language === 'es' ? 'Eliminar' : 'Delete')}
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-16 text-slate-400">
                                        <div className="text-5xl mb-3">📭</div>
                                        <p className="text-lg font-bold text-slate-500">
                                            {language === 'es' ? 'No hay pedidos esta semana' : 'No orders this week'}
                                        </p>
                                        <p className="text-sm mt-1">
                                            {language === 'es' 
                                                ? 'Los pedidos que generes aparecerán aquí' 
                                                : 'Orders you create will appear here'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ======================================================== */}
                        {activeTab === 'leftovers' && (() => {
                            const historyWeekDays = WEEK_DAYS.map(d => ({
                                ...d,
                                dateStr: addDays(historyMonday, d.offset),
                                label: t(`bodegaOrders.${d.key}`),
                            }))
                            const itemsWithCounts = items.filter(item => {
                                const itemCounts = historyCounts[item.id]
                                return itemCounts && Object.keys(itemCounts).length > 0
                            })
                            const allOrderableItems = items

                            return (
                                <div className="p-6">
                                    {/* Header + Week Navigator */}
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
                                        <div>
                                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                                📦 {t('bodegaOrders.leftoversTab')}
                                            </h2>
                                            <p className="text-sm text-slate-500 mt-0.5">
                                                {language === 'es' 
                                                    ? `Sobrantes capturados por día — ${itemsWithCounts.length} de ${allOrderableItems.length} items con datos` 
                                                    : `Captured leftovers by day — ${itemsWithCounts.length} of ${allOrderableItems.length} items with data`}
                                            </p>
                                        </div>
                                        {/* Week navigator */}
                                        <div className="flex items-center gap-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                            <button className="px-3 py-2.5 hover:bg-slate-100 transition-colors" onClick={() => setHistoryMonday(addDays(historyMonday, -7))}>
                                                <ArrowLeft className="w-4 h-4 text-slate-500" />
                                            </button>
                                            <div className="px-3 py-2 font-bold text-sm border-x border-slate-200 min-w-[140px] text-center">
                                                {historyMonday === getMonday(new Date()) && <span className="text-xs text-emerald-600 block font-medium">{language === 'es' ? 'Semana Actual' : 'Current Week'}</span>}
                                                {historyMonday} → {addDays(historyMonday, 6)}
                                            </div>
                                            <button className="px-3 py-2.5 hover:bg-slate-100 transition-colors" onClick={() => setHistoryMonday(addDays(historyMonday, 7))}>
                                                <ArrowRight className="w-4 h-4 text-slate-500" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Legend - Clean pill design */}
                                    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                                        <span className="font-bold text-slate-500 mr-1">% =</span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                                            ✅ 20–60% {language === 'es' ? 'Ideal' : 'Ideal'}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-bold">
                                            ⬆️ &lt;20% {language === 'es' ? 'Riesgo' : 'Risk'}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-bold">
                                            ⬇️ ≥60% {language === 'es' ? 'Exceso' : 'Excess'}
                                        </span>
                                        <span className="text-slate-400 ml-1">
                                            {language === 'es' ? '(Sáb: <15% riesgo, 15-40% ideal, ≥40% exceso)' : '(Sat: <15% risk, 15-40% ideal, ≥40% excess)'}
                                        </span>
                                    </div>

                                    {historyLoading ? (
                                        <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
                                            <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
                                            {language === 'es' ? 'Cargando sobrantes...' : 'Loading leftovers...'}
                                        </div>
                                    ) : allOrderableItems.length > 0 ? (
                                        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                                            <table className="w-full text-sm border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-100">
                                                        <th className="sticky left-0 bg-slate-100 p-3 text-left font-black text-slate-700 min-w-[200px] z-10 border-b-2 border-slate-300 shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
                                                            {language === 'es' ? 'Producto' : 'Product'}
                                                        </th>
                                                        {historyWeekDays.map(d => (
                                                            <th key={d.key} className="p-2.5 text-center font-bold text-slate-600 min-w-[90px] border-b-2 border-slate-300">
                                                                <div className="text-xs font-black">{d.label}</div>
                                                                <div className="text-[10px] text-slate-400 font-normal">{d.dateStr.slice(5)}</div>
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {allOrderableItems.map((item) => {
                                                        const itemCounts = historyCounts[item.id] || {}
                                                        const itemBases = historyBases[item.id]
                                                        const hasAnyCounts = Object.keys(itemCounts).length > 0
                                                        
                                                        return (
                                                            <tr key={item.id} className={`transition-colors ${hasAnyCounts ? '' : 'opacity-30'}`}>
                                                                <td className="sticky left-0 bg-white p-2.5 z-10 border-b border-slate-100 shadow-[2px_0_5px_rgba(0,0,0,0.04)]">
                                                                    <div className="flex flex-col">
                                                                        {item.order_unit_description && (
                                                                            <span className="text-[10px] text-slate-400 font-medium leading-tight">{item.order_unit_description}</span>
                                                                        )}
                                                                        {renderItemName(item.excel_reference || item.name, "font-semibold text-slate-800 text-xs")}
                                                                    </div>
                                                                </td>
                                                                {historyWeekDays.map(d => {
                                                                    const leftover = itemCounts[d.dateStr]
                                                                    const hasVal = leftover !== undefined && leftover !== null
                                                                    const parVal = itemBases ? Number((itemBases as any)[d.baseField]) || 0 : 0
                                                                    const isSaturday = d.key === 'sat'
                                                                    
                                                                    // Calculate percentage
                                                                    let pct: number | null = null
                                                                    let traffic = { bg: '', text: 'text-slate-300', border: '', label: '' }
                                                                    
                                                                    if (hasVal && parVal >= 8) {
                                                                        pct = Math.round((leftover / parVal) * 100)
                                                                        traffic = getTrafficLight(pct, isSaturday)
                                                                    } else if (hasVal && leftover === 0) {
                                                                        pct = 0
                                                                        traffic = { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: '🔴' }
                                                                    }

                                                                    if (!hasVal) {
                                                                        return (
                                                                            <td key={d.key} className="text-center border-b border-slate-100 text-slate-200 p-2">
                                                                                -
                                                                            </td>
                                                                        )
                                                                    }

                                                                    return (
                                                                        <td key={d.key} className={`border-b border-slate-100 p-0`}>
                                                                            <div className={`flex flex-col items-center justify-center py-2 px-1 ${traffic.bg} min-h-[56px]`}>
                                                                                {/* PAR reference - subtle top label */}
                                                                                {parVal > 0 && (
                                                                                    <span className="text-[9px] text-slate-400 font-medium leading-none">
                                                                                        PAR {parVal}
                                                                                    </span>
                                                                                )}
                                                                                {/* Leftover - protagonist number */}
                                                                                <span className={`text-base font-black leading-tight ${leftover === 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                                                                    {leftover}
                                                                                </span>
                                                                                {/* Percentage pill */}
                                                                                {pct !== null ? (
                                                                                    <span className={`text-[10px] font-bold px-1.5 rounded-full mt-0.5 ${traffic.text} ${
                                                                                        traffic.bg === 'bg-red-50' ? 'bg-red-100' 
                                                                                        : traffic.bg === 'bg-emerald-50' ? 'bg-emerald-100' 
                                                                                        : traffic.bg === 'bg-amber-50' ? 'bg-amber-100' 
                                                                                        : 'bg-slate-100'
                                                                                    }`}>
                                                                                        {pct}%
                                                                                    </span>
                                                                                ) : parVal > 0 && parVal < 8 ? (
                                                                                    <span className="text-[9px] text-slate-300 mt-0.5">—</span>
                                                                                ) : null}
                                                                            </div>
                                                                        </td>
                                                                    )
                                                                })}
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="text-center py-16 text-slate-400">
                                            <div className="text-5xl mb-3">📦</div>
                                            <p className="text-lg font-bold text-slate-500">
                                                {language === 'es' ? 'No hay sobrantes registrados esta semana' : 'No leftovers recorded this week'}
                                            </p>
                                            <p className="text-sm mt-1">
                                                {language === 'es' 
                                                    ? 'Los sobrantes capturados aparecerán aquí' 
                                                    : 'Captured leftovers will appear here'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )
                        })()}
                    </>
                )}
            </div>

            {/* ============ INFORMATION MODAL (i) ============ */}
            {showInfoModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
                    <div className="relative bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-100 flex flex-col">
                        {/* Header */}
                        <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between z-10">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">ℹ️</span>
                                <h3 className="text-lg font-black text-slate-800 uppercase tracking-wider font-sans">
                                    {language === 'es' ? 'Guía del Módulo de Pedidos a Bodega' : 'Warehouse Orders Module Guide'}
                                </h3>
                            </div>
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6 text-sm text-slate-600 leading-relaxed font-sans max-h-[60vh] overflow-y-auto">
                            {language === 'es' ? (
                                <>
                                    {/* PESTAÑAS DEL MÓDULO */}
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            📂 Pestañas del Módulo (¿Qué hace cada una?)
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">📝 Pedido del Día</span>
                                                Pantalla principal para capturar sobrantes del cierre del restaurante, ver el cálculo automático del pedido diario, hacer ajustes y enviarlo a QuickBooks.
                                            </div>
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">⚙️ Config Semanal</span>
                                                Permite configurar el PAR diario (base de inventario) de Lunes a Domingo, y compararlo contra el PAR Ideal sugerido por estadísticas.
                                            </div>
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">📋 Historial</span>
                                                Permite buscar, auditar y consultar todos los pedidos pasados que ya fueron generados y enviados a QuickBooks.
                                            </div>
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">📊 Sobrantes</span>
                                                Reporte de auditoría para verificar y comparar los sobrantes físicos reportados en semanas anteriores y analizar tendencias de consumo.
                                            </div>
                                        </div>
                                    </div>

                                    {/* PASO A PASO */}
                                    <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
                                        <h4 className="font-bold text-blue-900 text-sm flex items-center gap-1.5 mb-2">
                                            🚀 ¿Cómo hacer el Pedido Diario? (Paso a Paso)
                                        </h4>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-blue-900/80">
                                            <li><strong>Selecciona la Sucursal:</strong> Elige tu tienda en el selector arriba a la derecha.</li>
                                            <li><strong>Verifica la Fecha de Conteo:</strong> Selecciona el día en el que estás contando los productos físicos (por defecto hoy). El pedido se programará para entregarse el **día siguiente**.</li>
                                            <li><strong>Ingresa los Sobrantes (Conteo Físico):</strong> En la columna naranja <strong>"Sobrante"</strong>, escribe la cantidad de producto que quedó en tu restaurante al cierre. Si ya se habían capturado sobrantes para esta fecha, se cargarán solos de inmediato.</li>
                                            <li><strong>Revisa la Cantidad Calculada:</strong> El sistema calculará automáticamente cuánto pedir en la columna <strong>"Pedir"</strong> utilizando la fórmula: <code className="bg-white px-1.5 py-0.5 rounded border font-bold text-blue-700">PAR de Mañana − Sobrante</code>. Si tienes suficiente stock, te marcará "Exceso".</li>
                                            <li><strong>Haz Ajustes Manuales (Opcional):</strong> Si por algún evento especial quieres pedir una cantidad distinta al cálculo del sistema, escribe la cantidad deseada en la columna <strong>"Ajuste"</strong>. La columna <strong>"Final"</strong> tomará ese valor ajustado.</li>
                                            <li><strong>Guarda y Sincroniza:</strong> Haz clic en <strong>"Generar Orden"</strong> para guardar localmente y luego en <strong>"Enviar a QuickBooks"</strong> para crear el Estimate oficial.</li>
                                        </ol>
                                    </div>

                                    {/* HORARIO LABORAL DE NEGOCIO */}
                                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            ⏰ Día Laboral Operativo (Transición Nocturna)
                                        </h4>
                                        <p className="text-xs text-slate-600">
                                            El sistema se rige bajo el horario operativo oficial de la empresa: <strong>el día laboral inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día</strong> (el turno PM inicia a las 5:00 PM).
                                        </p>
                                        <ul className="list-disc pl-5 mt-1.5 text-xs space-y-1 text-slate-500">
                                            <li>Si capturas sobrantes a las 11:30 PM de un Domingo o a la 1:00 AM de un Lunes calendario, el sistema sabe que operativamente sigue siendo el día de negocio <strong>Domingo</strong> y guardará tus datos de forma correcta.</li>
                                        </ul>
                                    </div>

                                    {/* ORDEN DE LÍQUIDOS */}
                                    <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl">
                                        <h4 className="font-bold text-amber-900 text-sm flex items-center gap-1.5 mb-2">
                                            🧴 ¿Cómo hacer la Orden de Líquidos? (Semanal)
                                        </h4>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-amber-900/80">
                                            <li><strong>Cambia el Selector de Arriba:</strong> Selecciona el botón de <strong>"🧴 Orden Líquidos"</strong> en el header.</li>
                                            <li><strong>Día de Pedido:</strong> Recuerda que esta orden se solicita los <strong>Domingos</strong> para recibirse los <strong>Lunes</strong>.</li>
                                            <li><strong>Carga y Conteo:</strong> La tabla se filtrará automáticamente con los insumos del template oficial de QB. Captura los sobrantes en la columna naranja.</li>
                                            <li><strong>Cálculo y Envió:</strong> Funciona igual que la orden diaria. Calcula automáticamente <code>PAR - Sobrante</code> y al enviarse a QB genera un Estimate con el prefijo <code>[LÍQUIDOS]</code> en el memo para control administrativo.</li>
                                        </ol>
                                    </div>

                                    {/* ORDEN DE UNIFORMES */}
                                    <div className="bg-violet-50/50 border border-violet-100 p-4 rounded-xl">
                                        <h4 className="font-bold text-violet-900 text-sm flex items-center gap-1.5 mb-2">
                                            🎽 ¿Cómo hacer la Orden de Uniformes?
                                        </h4>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-violet-900/80">
                                            <li><strong>Cambia el Selector de Arriba:</strong> Selecciona el botón de <strong>"🎽 Orden Uniformes"</strong> en el header.</li>
                                            <li><strong>Template Único:</strong> A diferencia de la orden diaria (que tiene un template diferente por tienda), la orden de uniformes usa <strong>un solo template maestro</strong> de QuickBooks que aplica a todas las tiendas.</li>
                                            <li><strong>Misma Mecánica:</strong> Funciona igual que las otras órdenes. Captura sobrantes → el sistema calcula <code className="bg-white px-1.5 py-0.5 rounded border font-bold text-violet-700">PAR − Sobrante</code> → Genera Orden → Envía a QB.</li>
                                            <li><strong>Identificación:</strong> Al enviarse a QuickBooks, el Estimate se crea con el Customer de tu tienda (nombre, correo, domicilio) y el prefijo <code>[UNIFORMES]</code> en el memo para control administrativo.</li>
                                            <li><strong>Productos:</strong> Incluye playeras (Team Members, Shift Leader, Assistant Manager, Store Manager), chamarras (rojas y negras) y gorras en todas las tallas disponibles.</li>
                                        </ol>
                                    </div>

                                    {/* SIGNIFICA CADA COSA */}
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            📋 ¿Qué significa cada columna de la Tabla?
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="border border-slate-100 p-3 rounded-lg">
                                                <span className="font-bold text-emerald-600 block text-xs uppercase">PAR Mañana</span>
                                                La cantidad óptima del producto que debe tener el restaurante al inicio del día siguiente.
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg bg-orange-50/10">
                                                <span className="font-bold text-orange-600 block text-xs uppercase">Sobrante (Naranja)</span>
                                                El inventario físico actual (lo que te queda en el restaurante hoy).
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg bg-blue-50/10">
                                                <span className="font-bold text-blue-600 block text-xs uppercase">Pedir (Azul)</span>
                                                La cantidad sugerida por el sistema (<code className="bg-slate-50 px-1 py-0.5 rounded text-[10px]">PAR − Sobrante</code>).
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg bg-indigo-50/10">
                                                <span className="font-bold text-indigo-600 block text-xs uppercase">Ajuste (Índigo)</span>
                                                Sobrescribe el pedido automático en caso de emergencias, eventos especiales o redondeos.
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg col-span-1 md:col-span-2">
                                                <span className="font-bold text-slate-800 block text-xs uppercase">Final</span>
                                                La cantidad real que se enviará en la orden final (toma el valor de Ajuste si existe, sino toma el de Pedir).
                                            </div>
                                        </div>
                                    </div>

                                    {/* CONFIGURACIÓN SEMANAL */}
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            ⚙️ Pestaña: Configuración Semanal (PAR)
                                        </h4>
                                        <p className="mb-2">Aquí es donde los administradores configuran el PAR ideal diario de cada día de la semana (Lunes a Domingo):</p>
                                        <ul className="list-disc pl-5 space-y-1.5">
                                            <li><strong>Edición de Celdas:</strong> Haz clic y escribe directamente en la cuadrícula de días para ajustar el PAR diario de cualquier producto.</li>
                                            <li><strong>📋 Copiar PAR:</strong> Si vas a tener un día festivo o de ventas inusuales, puedes duplicar las bases de un día a otro. Selecciona el día de origen (ej. Viernes), selecciona el día de destino (ej. Lunes o "Todos los días") y haz clic en <strong>Copiar</strong>.</li>
                                            <li><strong>↩️ Deshacer / Descartar:</strong> Si cometes un error durante la edición y no has presionado "Guardar", haz clic en este botón rojo para revertir la tabla completa a su estado inicial.</li>
                                            <li><strong>PAR Ideal (Referencia):</strong> Muestra una sugerencia matemática basada en el historial de las últimas 4 semanas y ajustada automáticamente según el porcentaje de sobrantes.</li>
                                            <li><strong>🎨 Resaltado Semántico de Alertas:</strong> Al editar valores, se te alertará visualmente en comparación con la recomendación ideal:
                                                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-xs text-slate-500">
                                                    <li><span className="text-indigo-600 font-bold">Color Azul/Índigo:</span> Tu PAR actual es <strong>mayor (exceso)</strong> que el ideal sugerido.</li>
                                                    <li><span className="text-amber-600 font-bold">Color Naranja/Ámbar:</span> Tu PAR actual es <strong>menor (faltante)</strong> que el ideal sugerido (riesgo de desabasto).</li>
                                                    <li>Las semanas futuras que no han sido configuradas o clonadas se muestran limpias en blanco con una guía del ideal en gris claro.</li>
                                                </ul>
                                            </li>
                                        </ul>
                                    </div>

                                    {/* QUICKBOOKS */}
                                    <div className="border-t border-slate-100 pt-4">
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            💼 Integración con QuickBooks (Estimates)
                                        </h4>
                                        <ul className="list-disc pl-5 space-y-1 text-xs text-slate-500">
                                            <li>El envío a QuickBooks crea automáticamente un Estimate para la tienda en cuestión.</li>
                                            <li><strong>Clase y Ubicación:</strong> El sistema preconfigura automáticamente el Class y Department/Location en "Warehouse" (Bodega) en QuickBooks para asegurar el flujo correcto en contabilidad.</li>
                                            <li><strong>Seguridad Antierrores:</strong> Si el Estimate anterior de la base de datos fue eliminado en QuickBooks o contiene productos que ya fueron desactivados, el sistema lo detectará solo y creará un Estimate nuevo limpio con tus productos activos actuales.</li>
                                            <li><strong>Sincronización Inteligente:</strong> Los precios y las plantillas se sincronizan automáticamente en segundo plano. Si realizaste cambios en QuickBooks y deseas verlos inmediatamente, puedes hacer clic en <strong>"Sincronizar con QuickBooks"</strong> arriba a la derecha.</li>
                                            <li><strong>Reglas de Redondeo:</strong> Para ciertos insumos (como panes y tortillas), el sistema aplica automáticamente redondeos de empaque cerrado (ej. múltiplos de 30 o 60) definidos por administración.</li>
                                        </ul>
                                    </div>
                                </>
                            ) : (
                                <>
                                    {/* MODULE TABS */}
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            📂 Module Tabs (What does each one do?)
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">📝 Daily Order</span>
                                                Main screen to count leftovers, view the system-calculated daily warehouse order, apply manual adjustments, and send it to QuickBooks.
                                            </div>
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">⚙️ Weekly Config</span>
                                                Set the daily baseline PAR (inventory levels) from Monday to Sunday, and compare it against the statistically generated Ideal PAR.
                                            </div>
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">📋 History</span>
                                                Search, audit, and inspect all past orders that have been successfully finalized and sent to QuickBooks.
                                            </div>
                                            <div className="border border-slate-200 p-3 rounded-lg bg-slate-50/50">
                                                <span className="font-bold text-slate-800 block mb-0.5">📊 Leftovers</span>
                                                Audit log to verify and track physical leftovers logged in previous weeks to analyze usage patterns.
                                            </div>
                                        </div>
                                    </div>

                                    {/* STEP BY STEP */}
                                    <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl">
                                        <h4 className="font-bold text-blue-900 text-sm flex items-center gap-1.5 mb-2">
                                            🚀 How to place the Daily Order? (Step by Step)
                                        </h4>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-blue-900/80">
                                            <li><strong>Select Store:</strong> Choose your store in the selector on the top right.</li>
                                            <li><strong>Verify Count Date:</strong> Select the day you are counting physical products (today by default). The order is scheduled for delivery on the **next day**.</li>
                                            <li><strong>Enter Leftovers (Physical Count):</strong> In the orange <strong>"Leftover"</strong> column, type the quantity of product left in your restaurant at closing. If leftovers were already counted for this date, they will load automatically.</li>
                                            <li><strong>Check Calculated Qty:</strong> The system automatically calculates how much to order in the <strong>"Order"</strong> column using the formula: <code className="bg-white px-1.5 py-0.5 rounded border font-bold text-blue-700">Tomorrow's PAR − Leftover</code>. If you have enough stock, it will show "Excess".</li>
                                            <li><strong>Make Manual Adjustments (Optional):</strong> If you want to order a different quantity due to a special event, type the desired quantity in the <strong>"Adjustment"</strong> column. The <strong>"Final"</strong> column will use this value.</li>
                                            <li><strong>Save and Sync:</strong> Click <strong>"Generate Order"</strong> to save locally and then <strong>"Send to QuickBooks"</strong> to create the official Estimate.</li>
                                        </ol>
                                    </div>

                                    {/* BUSINESS HOURS / OPERATING DAY */}
                                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            ⏰ Operating Business Day (Night Shift Transition)
                                        </h4>
                                        <p className="text-xs text-slate-600">
                                            The system functions according to the company's official operating hours: <strong>the business day begins at 6:00 AM and ends at 5:59 AM of the following day</strong> (the PM shift starts at 5:00 PM).
                                        </p>
                                        <ul className="list-disc pl-5 mt-1.5 text-xs space-y-1 text-slate-500">
                                            <li>If you register leftovers at 11:30 PM on a Sunday or at 1:00 AM on a calendar Monday, the system understands it is operatively still <strong>Sunday</strong> and will route the count correctly.</li>
                                        </ul>
                                    </div>

                                    {/* LIQUIDS ORDER */}
                                    <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl">
                                        <h4 className="font-bold text-amber-900 text-sm flex items-center gap-1.5 mb-2">
                                            🧴 How to make the Liquids Order? (Weekly)
                                        </h4>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-amber-900/80">
                                            <li><strong>Switch the Selector Above:</strong> Select the <strong>"🧴 Liquids Order"</strong> button in the header.</li>
                                            <li><strong>Order Day:</strong> Remember this order is requested on <strong>Sundays</strong> for delivery on <strong>Mondays</strong>.</li>
                                            <li><strong>Load and Count:</strong> The table will filter automatically with items from the official QB template. Capture leftovers in the orange column.</li>
                                            <li><strong>Calculate and Send:</strong> Works exactly like the daily order. It calculates <code>PAR - Leftover</code> and when sent to QB generates an Estimate with the prefix <code>[LÍQUIDOS]</code> in the memo for administrative control.</li>
                                        </ol>
                                    </div>

                                    {/* UNIFORMS ORDER */}
                                    <div className="bg-violet-50/50 border border-violet-100 p-4 rounded-xl">
                                        <h4 className="font-bold text-violet-900 text-sm flex items-center gap-1.5 mb-2">
                                            🎽 How to make the Uniforms Order?
                                        </h4>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-violet-900/80">
                                            <li><strong>Switch the Selector Above:</strong> Select the <strong>"🎽 Uniforms Order"</strong> button in the header.</li>
                                            <li><strong>Single Template:</strong> Unlike the daily order (which has a different template per store), the uniforms order uses <strong>a single master template</strong> from QuickBooks that applies to all stores.</li>
                                            <li><strong>Same Mechanics:</strong> Works exactly like other orders. Capture leftovers → system calculates <code className="bg-white px-1.5 py-0.5 rounded border font-bold text-violet-700">PAR − Leftover</code> → Generate Order → Send to QB.</li>
                                            <li><strong>Identification:</strong> When sent to QuickBooks, the Estimate is created with your store's Customer (name, email, address) and the prefix <code>[UNIFORMES]</code> in the memo.</li>
                                            <li><strong>Products:</strong> Includes shirts (Team Members, Shift Leader, Assistant Manager, Store Manager), jackets (red and black), and caps in all available sizes.</li>
                                        </ol>
                                    </div>

                                    {/* WHAT COLUMNS MEAN */}
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            📋 What does each table column mean?
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="border border-slate-100 p-3 rounded-lg">
                                                <span className="font-bold text-emerald-600 block text-xs uppercase">Tomorrow's PAR</span>
                                                The optimal product quantity the restaurant should have at the start of the next day.
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg bg-orange-50/10">
                                                <span className="font-bold text-orange-600 block text-xs uppercase">Leftover (Orange)</span>
                                                Current physical inventory (what you have left in the restaurant today).
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg bg-blue-50/10">
                                                <span className="font-bold text-blue-600 block text-xs uppercase">Order (Blue)</span>
                                                The system-suggested quantity (<code className="bg-slate-50 px-1 py-0.5 rounded text-[10px]">PAR − Leftover</code>).
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg bg-indigo-50/10">
                                                <span className="font-bold text-indigo-600 block text-xs uppercase">Adjustment (Indigo)</span>
                                                Overrides the automatic calculation for emergencies, special events, or packaging rounding rules.
                                            </div>
                                            <div className="border border-slate-100 p-3 rounded-lg col-span-1 md:col-span-2">
                                                <span className="font-bold text-slate-800 block text-xs uppercase">Final</span>
                                                The actual quantity that will be sent in the final order (uses the Adjustment value if it exists, otherwise uses the Order value).
                                            </div>
                                        </div>
                                    </div>

                                    {/* WEEKLY CONFIG */}
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            ⚙️ Tab: Weekly Config (PAR)
                                        </h4>
                                        <p className="mb-2">Here administrators configure the daily Ideal PAR for each day of the week (Monday to Sunday):</p>
                                        <ul className="list-disc pl-5 space-y-1.5">
                                            <li><strong>Edit Cells:</strong> Click and type directly in the day grid to adjust the daily PAR for any product.</li>
                                            <li><strong>📋 Copy PAR:</strong> If you have a holiday or unusual sales days, you can duplicate bases from one day to another. Select the source day (e.g., Friday), select the target day (e.g., Monday or "All days"), and click <strong>Copy</strong>.</li>
                                            <li><strong>↩️ Undo / Discard:</strong> If you make a mistake and haven't clicked "Save", click this red button to revert the entire grid to its initial state.</li>
                                            <li><strong>Ideal PAR (Reference):</strong> Shows a mathematical suggestion based on the last 4 weeks' history adjusted automatically by leftover percentages.</li>
                                            <li><strong>🎨 Semantical Color Highlights:</strong> When editing values, cells are color-coded to compare your PAR with the Ideal baseline:
                                                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-xs text-slate-500">
                                                    <li><span className="text-indigo-600 font-bold">Blue/Indigo Highlight:</span> Your active PAR is <strong>greater (excess)</strong> than the suggested ideal.</li>
                                                    <li><span className="text-amber-600 font-bold">Orange/Amber Highlight:</span> Your active PAR is <strong>less (deficit)</strong> than the suggested ideal (risk of stockout).</li>
                                                    <li>Future weeks that have not been manually set or cloned will remain clean and white with the ideal value shown as a gray placeholder.</li>
                                                </ul>
                                            </li>
                                        </ul>
                                    </div>

                                    {/* QUICKBOOKS */}
                                    <div className="border-t border-slate-100 pt-4">
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 mb-2">
                                            💼 QuickBooks Integration (Estimates)
                                        </h4>
                                        <ul className="list-disc pl-5 space-y-1 text-xs text-slate-500">
                                            <li>Sending to QuickBooks automatically creates an Estimate for the respective store.</li>
                                            <li><strong>Class and Location:</strong> The system automatically preconfigures Class and Department/Location to "Warehouse" in QuickBooks to ensure correct accounting flows.</li>
                                            <li><strong>Error Prevention:</strong> If the previous Estimate from the database was deleted in QuickBooks or contains discontinued products, the system will detect it and create a new clean Estimate with your active products.</li>
                                            <li><strong>Smart Sync:</strong> Item prices and templates are synchronized automatically in the background. If you made changes in QuickBooks and need to see them immediately, click <strong>"Sincronizar con QuickBooks"</strong> on the top right.</li>
                                            <li><strong>Rounding Rules:</strong> For specific supplies (like breads or tortillas), the system automatically applies packaging rounding rules (e.g., multiples of 30 or 60) set by administration.</li>
                                        </ul>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end">
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-sm transition-all"
                            >
                                {language === 'es' ? 'Entendido' : 'Understood'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

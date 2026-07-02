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

import { useState, useEffect, useCallback } from 'react'
import {
    Package, ClipboardList, ShoppingCart, BarChart3,
    ArrowLeft, ArrowRight, Copy, Save, Send, RefreshCcw,
    Check, X, Link, AlertTriangle, ChevronDown, Download, Info, Trash2, Printer
} from 'lucide-react'
import {
    fetchOrderableItems, fetchAllInventoryItems, fetchWeeklyData,
    calculateDailyOrder, updateWeeklyBase, updateDailyLeftover,
    clonePreviousWeekBases, copyFromParIdeal, linkExcelItem,
    saveOrderDraft, executeWeekRollover, fetchAnalysisData,
    saveWeeklyBases
} from './actions'
import {
    getMonday, addDays,
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
type TabId = 'daily_order' | 'weekly_config'

const WEEK_DAYS = [
    { key: 'mon', baseField: 'mon_par', offset: 0 },
    { key: 'tue', baseField: 'tue_par', offset: 1 },
    { key: 'wed', baseField: 'wed_par', offset: 2 },
    { key: 'thu', baseField: 'thu_par', offset: 3 },
    { key: 'fri', baseField: 'fri_par', offset: 4 },
    { key: 'sat', baseField: 'sat_par', offset: 5 },
    { key: 'sun', baseField: 'sun_par', offset: 6 },
]

// ============================================================================
// COMPONENT
// ============================================================================
export default function InventoryOrdersPage() {
    const { user } = useAuth()
    const supabase = createClient()
    const { t } = useLanguage()

    // --- State ---
    const [activeMonday, setActiveMonday] = useState<string>(getMonday(new Date()))
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    const [activeTab, setActiveTab] = useState<TabId>('daily_order')
    const [orderType, setOrderType] = useState<'daily' | 'liquids'>('daily')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [hasBaseChanges, setHasBaseChanges] = useState(false)
    const [savingPar, setSavingPar] = useState(false)

    // Data
    const [items, setItems] = useState<OrderableItem[]>([])
    const [allItems, setAllItems] = useState<any[]>([])
    const [bases, setBases] = useState<Record<string, WeeklyBaseRecord>>({})
    const [originalBases, setOriginalBases] = useState<Record<string, WeeklyBaseRecord>>({})
    const [parIdeal, setParIdeal] = useState<Record<string, ParIdealRecord>>({})
    const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
    const [orderLines, setOrderLines] = useState<CalculatedOrderLine[]>([])
    const [adjustments, setAdjustments] = useState<Record<string, number>>({})
    const [orders, setOrders] = useState<any[]>([])
    const [analysisData, setAnalysisData] = useState<any>(null)

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

    // Computed
    const todayStr = getLocalBusinessDate(new Date())
    const isCurrentWeek = activeMonday === getMonday(new Date(todayStr + 'T12:00:00'))

    // Edit modal states for past estimates
    const [editModal, setEditModal] = useState<{ open: boolean; order: any | null }>({ open: false, order: null })
    const [modalLines, setModalLines] = useState<any[]>([])
    const [modalNotes, setModalNotes] = useState('')
    const [savingModal, setSavingModal] = useState(false)
    const [sendingModal, setSendingModal] = useState(false)

    const weekDays = WEEK_DAYS.map(d => ({
        ...d,
        dateStr: addDays(activeMonday, d.offset),
        label: t(`bodegaOrders.${d.key}`),
    }))

    // --- Load stores ---
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name').eq('is_active', true).order('name')
            if (data) {
                setStores(data)
                const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                if (user && !isSuper && user.store_id) {
                    setStoreId(user.store_id)
                } else {
                    const saved = localStorage.getItem('teg_preparador_store')
                    if (saved && data.find(s => s.id == saved)) setStoreId(saved)
                    else if (data.length > 0) setStoreId(data[0].id)
                }
            }
        }
        if (user !== undefined) fetchStores()
    }, [supabase, user])

    // --- Load all data ---
    const loadData = useCallback(async () => {
        if (!storeId) return
        setLoading(true)
        try {
            const [orderableItems, allInvItems, weekData] = await Promise.all([
                fetchOrderableItems(storeId, orderType),
                fetchAllInventoryItems(),
                fetchWeeklyData(storeId, activeMonday, orderType),
            ])
            setItems(orderableItems)
            setAllItems(allInvItems)
            setBases(weekData.bases)
            setOriginalBases(JSON.parse(JSON.stringify(weekData.bases || {})))
            setParIdeal(weekData.parIdeal)
            setCounts(weekData.counts)
            setOrders(weekData.orders)
            setHasBaseChanges(false)

            // Pre-cargar notas y ajustes de la orden de hoy
            const todayOrder = weekData.orders?.find((o: any) => o.order_date === selectedOrderDate)
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
                    weekData.parIdeal, overrideDayField
                )
                setOrderLines(lines)
            }
        } catch (error) {
            console.error('Error loading data:', error)
        } finally {
            setLoading(false)
        }
    }, [storeId, activeMonday, overrideDayField, selectedOrderDate, orderType])

    useEffect(() => { loadData() }, [loadData])

    // Recalcular orden localmente al cambiar el día de base a usar o la fecha seleccionada
    useEffect(() => {
        if (storeId && items.length > 0 && bases && Object.keys(bases).length > 0) {
            calculateDailyOrder(
                storeId, selectedOrderDate, items,
                bases, counts, activeMonday,
                parIdeal, overrideDayField
            ).then(setOrderLines)
        }
    }, [overrideDayField, storeId, selectedOrderDate, items, bases, counts, activeMonday, parIdeal])

    // Load analysis data when tab switches
    useEffect(() => {
        if (activeTab === 'analysis' as any && storeId && !analysisData) {
            fetchAnalysisData(storeId).then(setAnalysisData)
        }
    }, [activeTab, storeId])

    // --- Edit Modal Handlers ---
    function handleOpenEditModal(order: any) {
        setEditModal({ open: true, order })
        setModalNotes(order.notes || '')
        
        // Mapear las líneas guardadas de la orden con sus metadatos de insumos
        const lines = order.inventory_order_lines.map((line: any) => {
            const item = allItems.find(i => i.id === line.inventory_item_id)
            return {
                ...line,
                item_name: item?.name || 'Insumo Desconocido',
                unit_description: item?.order_unit_description || '',
                qb_item_id: item?.qb_item_id || null
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
                activeMonday, 
                lines, 
                user?.name, 
                modalNotes || undefined,
                editModal.order.order_type || 'daily'
            )
            if (res.error) {
                alert(res.error)
            } else {
                alert('¡Pedido guardado con éxito localmente!')
                setEditModal({ open: false, order: null })
                await loadData()
            }
        } catch (e: any) {
            alert('Error al guardar: ' + e.message)
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
                activeMonday, 
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
                alert('La sesión de QuickBooks expiró. Por favor cierra este modal y usa el botón de Enviar a QuickBooks principal en la pantalla de hoy para re-iniciar sesión.')
                setSendingModal(false)
                return
            }

            if (data.error) {
                alert(`Error: ${data.error}`)
            } else {
                alert(t('bodegaOrders.orderSentDesc', { number: data.estimateNumber }))
                setEditModal({ open: false, order: null })
                await loadData()
            }
        } catch (e: any) {
            alert('Error al enviar a QB: ' + e.message)
        } finally {
            setSendingModal(false)
        }
    }

    function handleCopyDayPar(src: string, tgt: string) {
        if (src === tgt) {
            alert('El día de origen y destino no pueden ser el mismo.')
            return
        }
        const dayLabels: Record<string, string> = {
            mon_par: 'Lunes',
            tue_par: 'Martes',
            wed_par: 'Miércoles',
            thu_par: 'Jueves',
            fri_par: 'Viernes',
            sat_par: 'Sábado',
            sun_par: 'Domingo',
            all: 'Todos los días'
        }
        if (!confirm(`¿Estás seguro de copiar el PAR de ${dayLabels[src]} a ${dayLabels[tgt]}?`)) return

        setBases(prev => {
            const nextBases = { ...prev }
            Object.keys(nextBases).forEach(itemId => {
                const itemBase = { ...nextBases[itemId] } as any
                if (!itemBase.inventory_item_id) return
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
            })
            return nextBases
        })
        setHasBaseChanges(true)
    }

    function handleOrderDateChange(dateStr: string) {
        setSelectedOrderDate(dateStr)
        const targetMonday = getMonday(new Date(dateStr + 'T12:00:00'))
        if (targetMonday !== activeMonday) {
            setActiveMonday(targetMonday)
        }
    }

    function handleUndoBases() {
        if (!confirm('¿Estás seguro de deshacer todos los cambios no guardados en el PAR semanal?')) return
        setBases(JSON.parse(JSON.stringify(originalBases)))
        setHasBaseChanges(false)
    }

    // --- Handlers ---
    async function handleBaseChange(itemId: string, field: string, value: string) {
        if (!storeId) return
        const numVal = parseFloat(value) || 0
        const b = bases[itemId] || { inventory_item_id: itemId, mon_par: 0, tue_par: 0, wed_par: 0, thu_par: 0, fri_par: 0, sat_par: 0, sun_par: 0 }
        setBases({ ...bases, [itemId]: { ...b, [field]: numVal } as any })
        setHasBaseChanges(true)
    }

    async function handleLiquidsParChange(itemId: string, value: string) {
        if (!storeId) return
        const numVal = parseFloat(value) || 0
        const b = bases[itemId] || { inventory_item_id: itemId, mon_par: 0, tue_par: 0, wed_par: 0, thu_par: 0, fri_par: 0, sat_par: 0, sun_par: 0 }
        setBases({
            ...bases,
            [itemId]: {
                ...b,
                mon_par: numVal,
                tue_par: numVal,
                wed_par: numVal,
                thu_par: numVal,
                fri_par: numVal,
                sat_par: numVal,
                sun_par: numVal
            } as any
        })
        setHasBaseChanges(true)
    }

    async function handleSavePar() {
        if (!storeId) return
        setSavingPar(true)
        try {
            const basesList = Object.values(bases).map((b: any) => ({
                inventory_item_id: b.inventory_item_id,
                mon_par: b.mon_par || 0,
                tue_par: b.tue_par || 0,
                wed_par: b.wed_par || 0,
                thu_par: b.thu_par || 0,
                fri_par: b.fri_par || 0,
                sat_par: b.sat_par || 0,
                sun_par: b.sun_par || 0
            }))
            
            await saveWeeklyBases(storeId, activeMonday, basesList)
            alert(t('bodegaOrders.parSaved'))
            setOriginalBases(JSON.parse(JSON.stringify(bases)))
            setHasBaseChanges(false)
            
            // Recalcular orden del día
            const lines = await calculateDailyOrder(
                storeId, selectedOrderDate, items,
                bases, counts, activeMonday,
                parIdeal, overrideDayField
            )
            setOrderLines(lines)
        } catch (e: any) {
            alert('Error: ' + e.message)
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
            alert('¡Orden eliminada exitosamente en el sistema y en QuickBooks!')
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

    async function handleGenerateOrder() {
        if (!storeId) return
        setSaving(true)
        const lines = orderLines.filter(l => {
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
        if (!confirm(t('bodegaOrders.confirmSend'))) return

        // SIEMPRE re-guardar las líneas antes de enviar a QB,
        // incluso si la orden ya existe (podría tener 0 líneas de un guardado parcial previo)
        setSaving(true)
        const lines = orderLines.filter(l => {
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
            alert('No hay items con cantidad > 0 para enviar. Verifica los sobrantes y la base del día.')
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
                
                alert('Sesión de QuickBooks expirada. Se abrirá una ventana emergente para iniciar sesión de nuevo. Al completarla, la orden se enviará automáticamente.');
                
                const popup = window.open(
                    '/api/integrations/quickbooks/auth',
                    'qb_auth_popup',
                    `width=${width},height=${height},left=${left},top=${top}`
                );

                if (popup) {
                    const handleMessage = async (e: MessageEvent) => {
                        if (e.data === 'qb_authorized') {
                            window.removeEventListener('message', handleMessage);
                            // Reintentar de forma automática
                            alert('¡Sesión iniciada! Reintentando el envío...');
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
                } else {
                    alert('Bloqueador de popups detectado. Habilita las ventanas flotantes e ingresa a: /api/integrations/quickbooks/auth');
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
                
                alert('Sesión de QuickBooks expirada. Se abrirá una ventana emergente para iniciar sesión de nuevo. Al completarla, la sincronización se ejecutará automáticamente.');
                
                const popup = window.open(
                    '/api/integrations/quickbooks/auth',
                    'qb_auth_popup',
                    `width=${width},height=${height},left=${left},top=${top}`
                );

                if (popup) {
                    const handleMessage = async (e: MessageEvent) => {
                        if (e.data === 'qb_authorized') {
                            window.removeEventListener('message', handleMessage);
                            alert('¡Sesión iniciada! Reintentando sincronización...');
                            setSyncingQb(true);
                            try {
                                const retryRes = await fetch('/api/inventory/sync-quickbooks', { method: 'POST' });
                                const retryData = await retryRes.json();
                                if (retryData.error) {
                                    alert(`Error: ${retryData.error}`);
                                } else {
                                    alert('¡Sincronización de QuickBooks completada con éxito!');
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
                } else {
                    alert('Bloqueador de popups detectado. Habilita las ventanas flotantes e ingresa a: /api/integrations/quickbooks/auth');
                }
                setSyncingQb(false);
                return;
            }

            if (data.error) {
                alert(`Error: ${data.error}`)
            } else {
                alert('¡Sincronización de QuickBooks completada con éxito!')
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
        const adj = adjustments[l.inventory_item_id]
        const finalQty = adj !== undefined ? adj : l.calculated_qty
        return finalQty > 0
    }).length
    const excessItems = orderLines.filter(l => l.calculated_qty < 0).length

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

    // Separate orderable vs tracking-only lines
    const orderableLines = orderLines.filter(l => l.qb_item_id && l.qb_item_id !== 'TRACK_ONLY')
    const trackingLines = orderLines.filter(l => !l.qb_item_id || l.qb_item_id === 'TRACK_ONLY')

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
                                <h2 className="text-lg font-black text-slate-800">¿Cómo se calcula el PAR Ideal?</h2>
                                <p className="text-xs text-slate-400">Fórmulas automáticas del historial (Últimas 8 semanas)</p>
                            </div>
                        </div>

                        <div className="space-y-4 text-sm text-slate-600 max-h-[60vh] overflow-y-auto pr-1">
                            <p className="leading-relaxed">
                                El <strong>PAR Ideal</strong> es una sugerencia matemática calculada automáticamente 
                                por el sistema promediando las bases reales de las últimas <strong>8 semanas</strong> y aplicando ajustes inteligentes basados en los sobrantes diarios.
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
                                    <li><strong className="text-amber-600">Exceso (&gt; 30% sobrante el Domingo):</strong> El PAR del sábado se reduce un <strong>10% o 15%</strong>.</li>
                                    <li><strong className="text-red-500">Escasez (&lt; 10% sobrante el Domingo):</strong> El PAR del sábado se incrementa un <strong>10% o 20%</strong>.</li>
                                    <li><strong className="text-emerald-600">Rango Ideal (10% a 30%):</strong> El PAR del sábado se mantiene intacto.</li>
                                </ul>
                            </div>

                            <p className="text-[11px] text-slate-400 italic">
                                * Nota: Domingo siempre calcula PAR 0 ya que no hay entregas de bodega los domingos.
                            </p>
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
                                    ✏️ Editar Pedido
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
                                    className="w-full px-4 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 resize-none bg-white placeholder:text-slate-400"
                                />
                            </div>

                            {/* Table of items */}
                            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="max-h-[50vh] overflow-y-auto">
                                    <table className="w-full text-xs sm:text-sm text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px] sm:text-xs">
                                                <th className="p-2 sm:p-3">Producto</th>
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
                                                            <div className="flex flex-col">
                                                                {line.unit_description && (
                                                                    <span className="text-[9px] sm:text-[10px] text-slate-400 font-medium leading-none mb-0.5">{line.unit_description}</span>
                                                                )}
                                                                <span className="font-semibold text-slate-800 leading-tight text-[11px] sm:text-[13px]">{line.item_name}</span>
                                                            </div>
                                                        </td>
                                                        {/* PAR */}
                                                        <td className="p-2 sm:p-3 text-center font-medium bg-emerald-50/30 text-emerald-800">
                                                            {parVal}
                                                        </td>
                                                        {/* Sobrante */}
                                                        <td className="p-1 sm:p-1.5 text-center bg-orange-50/20">
                                                            <input
                                                                type="number"
                                                                value={leftoverVal !== null && leftoverVal !== undefined ? leftoverVal : ''}
                                                                onChange={e => handleModalLeftoverChange(line.inventory_item_id, e.target.value)}
                                                                onFocus={e => e.target.select()}
                                                                placeholder="Sobrante"
                                                                className="w-full p-1.5 text-center bg-white border border-orange-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-400 font-bold text-orange-800 text-[11px] sm:text-xs"
                                                            />
                                                        </td>
                                                        {/* Pedir */}
                                                        <td className={`p-2 sm:p-3 text-center font-bold ${isNegative ? 'text-red-500 bg-red-50/20' : 'text-blue-700 bg-blue-50/10'}`}>
                                                            {isZeroLeftover ? '-' : calculatedQty}
                                                        </td>
                                                        {/* Ajuste */}
                                                        <td className="p-1 sm:p-1.5 text-center bg-indigo-50/10">
                                                            <input
                                                                type="number"
                                                                value={adj !== null && adj !== undefined ? adj : ''}
                                                                onChange={e => handleModalAdjustmentChange(line.inventory_item_id, e.target.value)}
                                                                onFocus={e => e.target.select()}
                                                                placeholder="-"
                                                                className="w-full p-1.5 text-center bg-white border border-indigo-100 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-indigo-700 text-[11px] sm:text-xs"
                                                            />
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
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2 justify-end">
                            <button
                                onClick={() => setEditModal({ open: false, order: null })}
                                disabled={savingModal || sendingModal}
                                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold text-xs sm:text-sm hover:bg-slate-100 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
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
                        </div>
                    </div>
                </div>
            )}

            {/* ============ HEADER BAR ============ */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        📦 {orderType === 'daily' ? t('bodegaOrders.title') : t('bodegaOrders.liquidsTitle')}
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
                    </div>

                    {/* Store selector */}
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

                    {/* QB Sync button */}
                    <button onClick={handleForceQbSync} disabled={syncingQb || loading}
                        className="flex items-center gap-1.5 bg-white border border-amber-200 hover:bg-amber-50 text-amber-700 px-3 py-2.5 rounded-xl font-semibold text-xs shadow-sm transition-colors disabled:opacity-50">
                        <RefreshCcw size={14} className={syncingQb ? 'animate-spin' : ''} /> {syncingQb ? 'Sincronizando...' : t('bodegaOrders.forceSync')}
                    </button>
                </div>
            </div>

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
                                            {/* Selector de fecha de conteo */}
                                            <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm text-xs">
                                                <span className="font-bold text-slate-500">📅 Fecha de Conteo:</span>
                                                <input
                                                    type="date"
                                                    value={selectedOrderDate}
                                                    onChange={e => handleOrderDateChange(e.target.value)}
                                                    className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer focus:text-blue-600 font-sans border-0 p-0"
                                                />
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
                                        </div>
                                    </div>

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
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm border-collapse whitespace-nowrap">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300 text-xs">
                                                    <th className="sticky left-0 bg-slate-50 border-b-2 border-slate-300 p-3 text-left min-w-[200px] z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                                        {t('bodegaOrders.item')}
                                                    </th>
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
                                                    <th className="p-3 text-center w-20 bg-emerald-50 text-emerald-700 border-b-2 border-emerald-200">
                                                        {orderType === 'daily' ? t('bodegaOrders.parTomorrow') : 'PAR'}
                                                    </th>
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
                                                            <td className="sticky left-0 bg-white border-b border-slate-100 p-2.5 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)]">
                                                                <div className="flex flex-col">
                                                                    {line.unit_description && (
                                                                        <span className="text-[10px] text-slate-400 font-medium leading-tight">{line.unit_description}</span>
                                                                    )}
                                                                    <span className="font-semibold text-slate-800">{line.item_name}</span>
                                                                </div>
                                                            </td>
                                                            {/* PAR Ideal (readonly) */}
                                                            <td className="p-2 text-center font-medium text-violet-600 bg-violet-50/40 border-b border-violet-100">
                                                                {line.par_ideal_value || '-'}
                                                            </td>
                                                            {/* PAR (readonly) */}
                                                            <td className="p-2 text-center font-bold text-emerald-700 bg-emerald-50/40 border-b border-emerald-100">
                                                                {line.par_value || '-'}
                                                            </td>
                                                            {/* Sobrante (EDITABLE) */}
                                                            <td className="p-0 border-b border-orange-200 bg-orange-50/30">
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
                                                            <td className={`p-2 text-center font-black text-base border-b ${
                                                                finalQty > 0 ? 'text-slate-800 bg-slate-50/60 border-slate-200'
                                                                : finalQty < 0 ? 'text-red-500 bg-red-50/30 border-red-100'
                                                                : 'text-slate-300 border-slate-100'
                                                            }`}>
                                                                {isZeroLeftover ? '-' : finalQty}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}

                                                {/* ---- Tracking Only separator ---- */}
                                                {trackingLines.length > 0 && (
                                                    <tr>
                                                        <td colSpan={7} className="p-3 text-center bg-slate-100 border-y-2 border-slate-300">
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
                                                                    <span className="font-semibold text-slate-500">{line.item_name}</span>
                                                                </div>
                                                            </td>
                                                            {/* PAR Ideal */}
                                                            <td className="p-2 text-center font-medium text-violet-500 bg-violet-50/20 border-b border-violet-100">
                                                                {line.par_ideal_value || '-'}
                                                            </td>
                                                            {/* PAR */}
                                                            <td className="p-2 text-center font-bold text-emerald-600 bg-emerald-50/30 border-b border-emerald-100">
                                                                {line.par_value || '-'}
                                                            </td>
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

                                    {/* ---- Weekly estimates history list ---- */}
                                    {orders && orders.length > 0 && (
                                        <div className="p-5 border-t border-slate-200 bg-slate-50/20">
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                                                    📄 Historial de Pedidos de esta Semana
                                                </h3>
                                            </div>

                                            {/* Advertencia / Alerta */}
                                            <div className="mb-4 bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-xs text-amber-800 leading-relaxed shadow-sm">
                                                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                                <div>
                                                    <strong className="block font-bold mb-0.5 text-amber-900">⚠️ ADVERTENCIA OPERATIVA</strong>
                                                    Al **eliminar** un pedido desde esta lista, también se **eliminará de forma definitiva el Estimate en QuickBooks**. 
                                                    Para **editar** cantidades, simplemente modifícalas en la tabla de arriba y vuelve a hacer clic en &quot;Enviar a QuickBooks&quot;, lo cual actualizará el Estimate existente automáticamente sin crear duplicados.
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {orders.map((order: any) => {
                                                    const isDeleting = deletingOrderId === order.id
                                                    return (
                                                        <div key={order.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow relative flex flex-col justify-between min-h-[140px]">
                                                            <div>
                                                                <div className="flex justify-between items-start mb-2">
                                                                    <span className="font-black text-slate-800 text-sm">📅 Pedido del {order.order_date}</span>
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
                                                                    Creado por: {order.created_by || 'Sistema'}
                                                                </div>

                                                                {order.notes && (
                                                                    <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg mt-2 border border-slate-100 italic truncate max-h-[50px]">
                                                                        &quot;{order.notes}&quot;
                                                                    </p>
                                                                )}
                                                            </div>

                                                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                                                                <div className="flex gap-2">
                                                                    {order.qb_estimate_number ? (
                                                                        <button 
                                                                            onClick={() => window.open(`/api/inventory/orders/estimate-pdf?estimateId=${order.qb_estimate_id}`, '_blank')}
                                                                            className="text-xs text-blue-600 hover:text-blue-800 font-bold transition-colors"
                                                                        >
                                                                            🖨️ PDF
                                                                        </button>
                                                                    ) : (
                                                                        <span className="text-[11px] text-slate-400">Sin QB</span>
                                                                    )}

                                                                    <button
                                                                        onClick={() => handleOpenEditModal(order)}
                                                                        className="text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-50 px-2.5 py-1 rounded-lg font-black transition-all flex items-center gap-0.5"
                                                                    >
                                                                        ✏️ Editar
                                                                    </button>
                                                                </div>

                                                                <button
                                                                    onClick={() => handleDeleteOrder(order.id, order.qb_estimate_number)}
                                                                    disabled={isDeleting || loading}
                                                                    className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 p-1.5 rounded-lg font-bold flex items-center gap-1 transition-all disabled:opacity-50"
                                                                >
                                                                    <Trash2 size={13} className={isDeleting ? 'animate-pulse' : ''} />
                                                                    {isDeleting ? 'Eliminando...' : 'Eliminar'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
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
                                             <select id="copy_src_day" className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer focus:text-blue-600 font-sans border-0 p-0">
                                                 <option value="mon_par">Lunes</option>
                                                 <option value="tue_par">Martes</option>
                                                 <option value="wed_par">Miércoles</option>
                                                 <option value="thu_par">Jueves</option>
                                                 <option value="fri_par">Viernes</option>
                                                 <option value="sat_par">Sábado</option>
                                                 <option value="sun_par">Domingo</option>
                                             </select>
                                             <span className="font-bold text-slate-400">➡️ a:</span>
                                             <select id="copy_tgt_day" className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer focus:text-blue-600 font-sans border-0 p-0">
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
                                                 onClick={() => {
                                                     const src = (document.getElementById('copy_src_day') as HTMLSelectElement).value
                                                     const tgt = (document.getElementById('copy_tgt_day') as HTMLSelectElement).value
                                                     handleCopyDayPar(src, tgt)
                                                 }}
                                                 className="ml-1 bg-blue-600 hover:bg-blue-700 text-white font-black px-2.5 py-1 rounded-lg transition-all text-xs"
                                             >
                                                 Copiar
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
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                                        <thead>
                                            <tr>
                                                <th className="bg-slate-100 border-b-2 border-slate-300 p-3 sticky left-0 z-10 font-black min-w-[200px] shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                                    {t('bodegaOrders.item')}
                                                </th>
                                                {orderType === 'daily' ? (
                                                    weekDays.map(d => (
                                                        <th key={`bh_${d.key}`} className="bg-emerald-50 border-b-2 border-emerald-200 p-2 text-center w-20 text-xs text-emerald-700 font-bold">
                                                            {d.label}<br/>
                                                            <span className="font-normal text-emerald-500">{d.dateStr.slice(5)}</span>
                                                        </th>
                                                    ))
                                                ) : (
                                                    <th className="bg-emerald-50 border-b-2 border-emerald-200 p-2 text-center w-32 text-xs text-emerald-700 font-bold">
                                                        PAR
                                                    </th>
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
                                                                <span>{item.excel_reference || item.name}</span>
                                                            </div>
                                                        </td>
                                                        {orderType === 'daily' ? (
                                                            weekDays.map((d, colIndex) => {
                                                                const val = b ? (b as any)[d.baseField] : undefined
                                                                const piVal = parIdeal[item.id] ? (parIdeal[item.id] as any)[d.baseField] : undefined

                                                                return (
                                                                    <td key={`bc_${item.id}_${d.key}`} className="p-0 border-b border-emerald-100/50">
                                                                        <input
                                                                            id={`input_${rowIndex}_${colIndex}`}
                                                                            type="number"
                                                                            placeholder={piVal ? String(piVal) : '-'}
                                                                            className="w-full h-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400 font-medium text-slate-800 placeholder:text-slate-300 text-sm"
                                                                            value={val !== undefined && val !== null ? val : ''}
                                                                            onChange={e => handleBaseChange(item.id, d.baseField, e.target.value)}
                                                                            onKeyDown={e => handleGridKeyDown(e, rowIndex, colIndex)}
                                                                            onFocus={e => e.target.select()}
                                                                        />
                                                                    </td>
                                                                )
                                                            })
                                                        ) : (
                                                            (() => {
                                                                const val = b ? b.mon_par : undefined
                                                                const piVal = parIdeal[item.id] ? parIdeal[item.id].mon_par : undefined

                                                                return (
                                                                    <td className="p-0 border-b border-emerald-100/50">
                                                                        <input
                                                                            id={`input_${rowIndex}_0`}
                                                                            type="number"
                                                                            placeholder={piVal !== undefined && piVal !== null ? String(piVal) : '-'}
                                                                            className="w-full h-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400 font-medium text-slate-800 placeholder:text-slate-300 text-sm"
                                                                            value={val !== undefined && val !== null ? val : ''}
                                                                            onChange={e => handleLiquidsParChange(item.id, e.target.value)}
                                                                            onKeyDown={e => handleGridKeyDown(e, rowIndex, 0)}
                                                                            onFocus={e => e.target.select()}
                                                                        />
                                                                    </td>
                                                                )
                                                            })()
                                                        )}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* ---- PAR Ideal reference table (readonly) ---- */}
                                <div className="border-t-2 border-slate-200">
                                    <div className="px-5 py-3 bg-violet-50/50 border-b border-violet-100">
                                        <h3 className="text-sm font-black text-violet-700 uppercase tracking-wider">
                                            {t('bodegaOrders.parIdealHeader')}
                                        </h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                                            <thead>
                                                <tr>
                                                    <th className="bg-violet-50/30 border-b border-violet-100 p-3 sticky left-0 z-10 font-bold min-w-[200px] text-violet-700 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                                        {t('bodegaOrders.item')}
                                                    </th>
                                                    {orderType === 'daily' ? (
                                                        weekDays.map(d => (
                                                            <th key={`pih_${d.key}`} className="bg-violet-50/30 border-b border-violet-100 p-2 text-center w-20 text-xs text-violet-600 font-bold">
                                                                {d.label}
                                                            </th>
                                                        ))
                                                    ) : (
                                                        <th className="bg-violet-50/30 border-b border-violet-100 p-2 text-center w-32 text-xs text-violet-600 font-bold">
                                                            PAR
                                                        </th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {items.map(item => {
                                                    const pi = parIdeal[item.id]
                                                    return (
                                                        <tr key={item.id} className="border-b border-violet-50 hover:bg-violet-50/20 transition-colors">
                                                            <td className="sticky left-0 bg-white border-b border-violet-50 p-2.5 font-semibold text-slate-700 shadow-[2px_0_5px_rgba(0,0,0,0.03)] z-10">
                                                                {item.excel_reference || item.name}
                                                            </td>
                                                            {orderType === 'daily' ? (
                                                                weekDays.map(d => {
                                                                    const piVal = pi ? (pi as any)[d.baseField] : null
                                                                    return (
                                                                        <td key={`pi_${item.id}_${d.key}`} className="border-b border-violet-50 p-2 text-center text-violet-600 font-medium text-sm">
                                                                            {piVal || '-'}
                                                                        </td>
                                                                    )
                                                                })
                                                            ) : (
                                                                (() => {
                                                                    const piVal = pi ? pi.mon_par : null
                                                                    return (
                                                                        <td className="border-b border-violet-50 p-2 text-center text-violet-600 font-medium text-sm">
                                                                            {piVal !== null && piVal !== undefined ? piVal : '-'}
                                                                        </td>
                                                                    )
                                                                })()
                                                            )}
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
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
                                    Guía del Módulo de Pedidos a Bodega
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
                                    <li><strong>PAR Ideal (Referencia):</strong> Muestra una sugerencia matemática basada en el historial de las últimas 8 semanas y ajustada automáticamente según el porcentaje de sobrantes.</li>
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
                                </ul>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end">
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-sm transition-all"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

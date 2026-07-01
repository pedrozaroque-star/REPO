/**
 * @module inventory/orders/page
 * @description Página principal del módulo de Pedidos Automáticos a Bodega.
 *              Replica y mejora el flujo del Excel "Lynwood Order" con 4 pestañas:
 *              BASE (PAR semanal), SOBRANTES (conteo diario), ORDEN DEL DÍA (cálculo
 *              automático + envío a QB), y ANÁLISIS (tendencias y porcentajes).
 *
 * @businessRules
 * - FÓRMULA CORE: ORDER = PAR_mañana − Sobrante_hoy
 * - Viernes no lleva BASE; Sábado cubre Sáb+Dom juntos
 * - Redondeos: Papelitos → CEILING(x, 30), Quesadillas → CEILING(x, 4)
 * - Lunes usa Sobrante_Domingo de la semana anterior
 * - Rollover solo si TODOS los items tienen sobrante de Domingo
 * - El día laboral empieza a las 6:00 AM
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
 */
'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    Package, ClipboardList, ShoppingCart, BarChart3,
    ArrowLeft, ArrowRight, Copy, Save, Send, RefreshCcw,
    Check, X, Link, AlertTriangle, ChevronDown, Download
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
// TYPES
// ============================================================================
type TabId = 'base' | 'leftovers' | 'order' | 'analysis'

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
    const [activeTab, setActiveTab] = useState<TabId>('base')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [hasBaseChanges, setHasBaseChanges] = useState(false)
    const [savingPar, setSavingPar] = useState(false)

    // Data
    const [items, setItems] = useState<OrderableItem[]>([])
    const [allItems, setAllItems] = useState<any[]>([])
    const [bases, setBases] = useState<Record<string, WeeklyBaseRecord>>({})
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

    // QB sending state
    const [sendingToQb, setSendingToQb] = useState(false)
    const [syncingQb, setSyncingQb] = useState(false)
    const [orderNotes, setOrderNotes] = useState('')

    // Computed
    const todayStr = new Date().toISOString().split('T')[0]
    const isCurrentWeek = activeMonday === getMonday(new Date())

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
                fetchOrderableItems(storeId),
                fetchAllInventoryItems(),
                fetchWeeklyData(storeId, activeMonday),
            ])
            setItems(orderableItems)
            setAllItems(allInvItems)
            setBases(weekData.bases)
            setParIdeal(weekData.parIdeal)
            setCounts(weekData.counts)
            setOrders(weekData.orders)
            setHasBaseChanges(false)

            // Pre-cargar notas de la orden existente de hoy
            const todayOrder = weekData.orders?.find((o: any) => o.order_date === new Date().toISOString().split('T')[0])
            if (todayOrder?.notes) setOrderNotes(todayOrder.notes)
            else setOrderNotes('')

            // Calculate today's order
            if (isCurrentWeek) {
                const lines = await calculateDailyOrder(
                    storeId, todayStr, orderableItems,
                    weekData.bases, weekData.counts, activeMonday
                )
                setOrderLines(lines)
            }
        } catch (error) {
            console.error('Error loading data:', error)
        } finally {
            setLoading(false)
        }
    }, [storeId, activeMonday])

    useEffect(() => { loadData() }, [loadData])

    // Load analysis data when tab switches
    useEffect(() => {
        if (activeTab === 'analysis' && storeId && !analysisData) {
            fetchAnalysisData(storeId).then(setAnalysisData)
        }
    }, [activeTab, storeId])

    // --- Handlers ---
    async function handleBaseChange(itemId: string, field: string, value: string) {
        if (!storeId) return
        const numVal = parseFloat(value) || 0
        const b = bases[itemId] || { inventory_item_id: itemId, mon_par: 0, tue_par: 0, wed_par: 0, thu_par: 0, fri_par: 0, sat_par: 0, sun_par: 0 }
        setBases({ ...bases, [itemId]: { ...b, [field]: numVal } as any })
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
            setHasBaseChanges(false)
            
            // Recalcular orden del día
            const lines = await calculateDailyOrder(
                storeId, todayStr, items,
                bases, counts, activeMonday
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

        const res = await saveOrderDraft(storeId, todayStr, activeMonday, lines, user?.name, orderNotes || undefined)
        if (res.error) alert(res.error)
        else { alert(t('bodegaOrders.saved')); await loadData() }
        setSaving(false)
    }

    async function handleSendToQb() {
        if (!confirm(t('bodegaOrders.confirmSend'))) return

        // First save/generate the order if not already
        const existingOrder = orders.find((o: any) => o.order_date === todayStr)
        let orderId = existingOrder?.id

        if (!orderId) {
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
            const saveRes = await saveOrderDraft(storeId, todayStr, activeMonday, lines, user?.name, orderNotes || undefined)
            if (saveRes.error) { alert(saveRes.error); setSaving(false); return }
            orderId = saveRes.orderId
            setSaving(false)
        }

        setSendingToQb(true)
        try {
            const res = await fetch('/api/inventory/orders/send-to-qb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId })
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
                                    body: JSON.stringify({ orderId })
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
    const capturedToday = items.filter(i => counts[i.id]?.[todayStr] !== undefined).length
    const sundayDate = addDays(activeMonday, 6)
    const capturedSunday = items.filter(i => counts[i.id]?.[sundayDate] !== undefined).length

    // Summary cards for Order tab
    const itemsToOrder = orderLines.filter(l => {
        const adj = adjustments[l.inventory_item_id]
        const finalQty = adj !== undefined ? adj : l.calculated_qty
        return finalQty > 0
    }).length
    const excessItems = orderLines.filter(l => l.calculated_qty < 0).length

    // ============================================================================
    // TABS CONFIG
    // ============================================================================
    const tabs: { id: TabId; icon: any; labelKey: string; badge?: string }[] = [
        { id: 'base', icon: Package, labelKey: 'bodegaOrders.tabBase' },
        { id: 'leftovers', icon: ClipboardList, labelKey: 'bodegaOrders.tabLeftovers', badge: isCurrentWeek ? `${capturedToday}/${items.length}` : undefined },
        { id: 'order', icon: ShoppingCart, labelKey: 'bodegaOrders.tabOrder', badge: itemsToOrder > 0 ? `${itemsToOrder}` : undefined },
        { id: 'analysis', icon: BarChart3, labelKey: 'bodegaOrders.tabAnalysis' },
    ]

    // ============================================================================
    // RENDER
    // ============================================================================
    return (
        <div className="p-4 md:p-6 max-w-[100vw] min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 text-slate-800">
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

            {/* ============ HEADER ============ */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-black bg-gradient-to-r from-blue-900 to-indigo-700 bg-clip-text text-transparent">
                        {t('bodegaOrders.title')}
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">{t('bodegaOrders.subtitle')}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Store selector */}
                    <select
                        value={storeId}
                        onChange={e => {
                            setStoreId(e.target.value)
                            localStorage.setItem('teg_preparador_store', e.target.value)
                        }}
                        className="bg-white border-2 border-slate-200 text-slate-700 rounded-xl px-4 py-2 font-bold focus:border-blue-500 outline-none shadow-sm"
                    >
                        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>

                    {/* Week navigator */}
                    <div className="flex items-center gap-1 bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <button className="px-3 py-2 hover:bg-slate-100 transition-colors" onClick={() => setActiveMonday(addDays(activeMonday, -7))}>
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                        <div className="px-3 py-2 font-bold text-sm border-x border-slate-200 min-w-[110px] text-center">
                            {isCurrentWeek && <span className="text-xs text-emerald-600 block font-medium">{t('bodegaOrders.currentWeek')}</span>}
                            {activeMonday}
                        </div>
                        <button className="px-3 py-2 hover:bg-slate-100 transition-colors" onClick={() => setActiveMonday(addDays(activeMonday, 7))}>
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                        {activeTab === 'base' && (
                            <button onClick={handleSavePar} disabled={savingPar || !hasBaseChanges}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-all duration-200 ${
                                    hasBaseChanges 
                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer ring-2 ring-emerald-400 ring-offset-1' 
                                        : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                }`}>
                                <Save size={14} /> {savingPar ? t('bodegaOrders.savingPar') : t('bodegaOrders.savePar')}
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
                        <button onClick={handleForceQbSync} disabled={syncingQb || loading}
                            className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-700 px-3 py-2 rounded-xl font-semibold text-xs shadow-sm transition-colors disabled:opacity-50">
                            <RefreshCcw size={14} className={syncingQb ? 'animate-spin' : ''} /> {syncingQb ? 'Sincronizando...' : t('bodegaOrders.forceSync')}
                        </button>
                        {isCurrentWeek && capturedSunday === items.length && items.length > 0 && (
                            <button onClick={handleCloseWeek} disabled={loading}
                                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-colors">
                                <Check size={14} /> {t('bodegaOrders.closeWeek')}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ============ TABS ============ */}
            <div className="flex gap-1 mb-0 border-b-0">
                {tabs.map(tab => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-3 rounded-t-xl font-bold text-sm border-t-4 transition-all duration-200 ${
                                isActive
                                    ? 'bg-white border-t-blue-600 text-blue-800 shadow-sm'
                                    : 'bg-slate-100 border-t-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                            }`}
                        >
                            <Icon size={16} />
                            {t(tab.labelKey)}
                            {tab.badge && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                    isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* ============ CONTENT ============ */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-b-xl rounded-tr-xl min-h-[500px]">
                {loading ? (
                    <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                        {t('bodegaOrders.loading')}
                    </div>
                ) : (
                    <>
                        {/* ---- TAB: BASE ---- */}
                        {activeTab === 'base' && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                                    <thead>
                                        <tr>
                                            <th className="bg-slate-100 border p-3 border-slate-300 sticky left-0 z-10 font-black min-w-[200px]"></th>
                                            <th colSpan={7} className="bg-emerald-100/80 text-emerald-900 border p-3 text-center border-emerald-200 font-black text-sm">
                                                {t('bodegaOrders.baseHeader')}
                                            </th>
                                            <th className="w-2 bg-slate-50"></th>
                                            <th colSpan={7} className="bg-orange-100/80 text-orange-900 border p-3 text-center border-orange-200 font-black text-sm">
                                                {t('bodegaOrders.leftoverHeader')}
                                            </th>
                                            <th className="w-2 bg-slate-50"></th>
                                            <th colSpan={7} className="bg-violet-100/80 text-violet-900 border p-3 text-center border-violet-200 font-black text-sm">
                                                {t('bodegaOrders.parIdealHeader')}
                                            </th>
                                        </tr>
                                        <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300">
                                            <th className="sticky left-0 bg-slate-50 border p-3 min-w-[200px] z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">{t('bodegaOrders.item')}</th>
                                            {/* Base columns */}
                                            {weekDays.map(d => <th key={`bh_${d.key}`} className="border p-2 text-center w-20 text-xs">{d.label}<br/><span className="font-normal text-slate-400">{d.dateStr.slice(5)}</span></th>)}
                                            <th className="w-2 bg-slate-100 border-none"></th>
                                            {/* Leftover columns */}
                                            {weekDays.map(d => <th key={`sh_${d.key}`} className="border p-2 text-center w-20 text-xs">{d.label}<br/><span className="font-normal text-slate-400">{d.dateStr.slice(5)}</span></th>)}
                                            <th className="w-2 bg-slate-100 border-none"></th>
                                            {/* PAR Ideal columns */}
                                            {weekDays.map(d => <th key={`ph_${d.key}`} className="border p-2 text-center w-20 text-xs text-violet-500">{d.label}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, rowIndex) => {
                                            const b = bases[item.id]
                                            const pi = parIdeal[item.id]
                                            const itemC = counts[item.id] || {}

                                            return (
                                                <tr key={item.id} className="hover:bg-blue-50/30 transition-colors">
                                                    <td className="sticky left-0 bg-white border border-slate-200 p-2 font-semibold text-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs text-slate-500">{item.order_unit_description || ''}</span>
                                                            <span>{item.excel_reference || item.name}</span>
                                                        </div>
                                                    </td>
                                                    {/* BASE inputs */}
                                                    {weekDays.map((d, colIndex) => {
                                                        const val = b ? (b as any)[d.baseField] : undefined
                                                        const pVal = Number(val) || 0
                                                        const piVal = pi ? (pi as any)[d.baseField] : undefined
                                                        // Alert color based on leftover percentage (Excel rules)
                                                        let alertColor = ''
                                                        if (pVal > 0) {
                                                            if (['mon', 'tue', 'wed', 'thu', 'fri'].includes(d.key)) {
                                                                const leftover = itemC[d.dateStr]
                                                                if (leftover !== undefined && pVal >= 10) {
                                                                    const pct = (leftover / pVal) * 100
                                                                    if (pct < 20 || pct > 60) {
                                                                        alertColor = 'bg-yellow-50 border-yellow-300'
                                                                    }
                                                                }
                                                            } else if (d.key === 'sat') {
                                                                // Sábado se valida con el sobrante del Domingo (que es d.dateStr + 1 día)
                                                                const sundayDateStr = addDays(d.dateStr, 1)
                                                                const sundayLeftover = itemC[sundayDateStr]
                                                                if (sundayLeftover !== undefined && pVal >= 8) {
                                                                    const pct = (sundayLeftover / pVal) * 100
                                                                    if (pct < 10 || pct > 30) {
                                                                        alertColor = 'bg-yellow-50 border-yellow-300'
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        return (
                                                            <td key={`bc_${item.id}_${d.key}`} className={`border p-0 ${alertColor || 'border-emerald-100 bg-emerald-50/20'}`}>
                                                                <input
                                                                    id={`input_${rowIndex}_${colIndex}`}
                                                                    type="number"
                                                                    placeholder={piVal ? String(piVal) : '-'}
                                                                    className="w-full h-full p-2 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-emerald-400 font-medium text-slate-800 placeholder:text-slate-300 text-sm"
                                                                    value={val !== undefined && val !== null ? val : ''}
                                                                    onChange={e => handleBaseChange(item.id, d.baseField, e.target.value)}
                                                                    onKeyDown={e => handleGridKeyDown(e, rowIndex, colIndex)}
                                                                />
                                                            </td>
                                                        )
                                                    })}
                                                    <td className="bg-slate-50 border-y"></td>
                                                    {/* LEFTOVER inputs */}
                                                    {weekDays.map((d, colOffset) => {
                                                        const sVal = itemC[d.dateStr]
                                                        const colIndex = 7 + colOffset
                                                        const isToday = d.dateStr === todayStr
                                                        return (
                                                            <td key={`sc_${item.id}_${d.key}`} className={`border p-0 ${isToday ? 'border-orange-400 bg-orange-100/50' : 'border-orange-100 bg-orange-50/20'}`}>
                                                                <input
                                                                    id={`input_${rowIndex}_${colIndex}`}
                                                                    type="number"
                                                                    placeholder="-"
                                                                    className="w-full h-full p-2 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-orange-400 font-bold text-orange-900 placeholder:text-orange-900/20 text-sm"
                                                                    value={sVal !== undefined ? sVal : ''}
                                                                    onChange={e => handleLeftoverChange(item.id, d.dateStr, e.target.value)}
                                                                    onKeyDown={e => handleGridKeyDown(e, rowIndex, colIndex)}
                                                                />
                                                            </td>
                                                        )
                                                    })}
                                                    <td className="bg-slate-50 border-y"></td>
                                                    {/* PAR IDEAL (read-only) */}
                                                    {weekDays.map(d => {
                                                        const piVal = pi ? (pi as any)[d.baseField] : null
                                                        return (
                                                            <td key={`pi_${item.id}_${d.key}`} className="border border-violet-100 bg-violet-50/20 p-2 text-center text-violet-600 font-medium text-sm">
                                                                {piVal || '-'}
                                                            </td>
                                                        )
                                                    })}
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* ---- TAB: LEFTOVERS ---- */}
                        {activeTab === 'leftovers' && (
                            <div className="overflow-x-auto">
                                {/* Progress bar */}
                                <div className="p-4 border-b border-slate-200 bg-slate-50/50">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-bold text-slate-700">
                                            {t('bodegaOrders.itemsCaptured', { count: capturedToday, total: items.length })}
                                        </span>
                                        {capturedToday === items.length && items.length > 0 && (
                                            <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full flex items-center gap-1">
                                                <Check size={12} /> {t('bodegaOrders.allItemsCaptured')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="w-full bg-slate-200 rounded-full h-2">
                                        <div className="bg-emerald-500 h-2 rounded-full transition-all duration-500" style={{ width: `${items.length ? (capturedToday / items.length) * 100 : 0}%` }} />
                                    </div>
                                </div>
                                <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300">
                                            <th className="sticky left-0 bg-slate-50 border p-3 min-w-[200px] z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">{t('bodegaOrders.item')}</th>
                                            <th className="border p-3 text-center w-24 text-xs">{t('bodegaOrders.unit')}</th>
                                            {weekDays.map(d => {
                                                const isToday = d.dateStr === todayStr
                                                return (
                                                    <th key={`lh_${d.key}`} className={`border p-2 text-center w-24 ${isToday ? 'bg-orange-100 text-orange-800' : ''}`}>
                                                        <span className="text-xs">{d.label}</span>
                                                        <br/><span className="font-normal text-slate-400 text-xs">{d.dateStr.slice(5)}</span>
                                                        {isToday && <div className="text-[10px] text-orange-600 font-bold mt-0.5">{t('bodegaOrders.today')}</div>}
                                                    </th>
                                                )
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, rowIndex) => {
                                            const itemC = counts[item.id] || {}
                                            return (
                                                <tr key={item.id} className="hover:bg-orange-50/30 transition-colors">
                                                    <td className="sticky left-0 bg-white border border-slate-200 p-2 font-semibold text-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">
                                                        {item.excel_reference || item.name}
                                                    </td>
                                                    <td className="border border-slate-200 p-2 text-center text-xs text-slate-500">
                                                        {item.order_unit_description || item.unit_type}
                                                    </td>
                                                    {weekDays.map((d, colIndex) => {
                                                        const sVal = itemC[d.dateStr]
                                                        const isToday = d.dateStr === todayStr
                                                        return (
                                                            <td key={`lc_${item.id}_${d.key}`} className={`border p-0 ${isToday ? 'border-orange-400 bg-orange-100/40' : 'border-slate-200'}`}>
                                                                <input
                                                                    id={`input_${rowIndex}_${colIndex}`}
                                                                    type="number"
                                                                    placeholder="-"
                                                                    className={`w-full h-full p-2.5 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-orange-400 font-bold text-sm ${isToday ? 'text-orange-900' : 'text-slate-700'} placeholder:text-slate-300`}
                                                                    value={sVal !== undefined ? sVal : ''}
                                                                    onChange={e => handleLeftoverChange(item.id, d.dateStr, e.target.value)}
                                                                    onKeyDown={e => handleGridKeyDown(e, rowIndex, colIndex)}
                                                                />
                                                            </td>
                                                        )
                                                    })}
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* ---- TAB: ORDER ---- */}
                        {activeTab === 'order' && (() => {
                            const existingOrder = orders.find((o: any) => o.order_date === todayStr);
                            return (
                                <div>
                                    {/* Success banner if already sent to QBO */}
                                    {existingOrder?.qb_estimate_number && (
                                        <div className="mx-5 mt-5 bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex flex-wrap gap-4 items-center justify-between shadow-sm">
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

                                    {/* Summary cards */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 border-b border-slate-200 bg-gradient-to-r from-blue-50/50 to-indigo-50/50">
                                        <div className="bg-white rounded-xl p-4 border border-blue-200 shadow-sm">
                                            <div className="text-xs text-blue-500 font-bold uppercase tracking-wider">{t('bodegaOrders.totalItemsToOrder')}</div>
                                            <div className="text-3xl font-black text-blue-700 mt-1">{itemsToOrder}</div>
                                        </div>
                                        <div className="bg-white rounded-xl p-4 border border-amber-200 shadow-sm">
                                            <div className="text-xs text-amber-500 font-bold uppercase tracking-wider">{t('bodegaOrders.excessItems')}</div>
                                            <div className="text-3xl font-black text-amber-600 mt-1">{excessItems}</div>
                                        </div>
                                        <div className="bg-white rounded-xl p-4 border border-emerald-200 shadow-sm">
                                            <div className="text-xs text-emerald-500 font-bold uppercase tracking-wider">{t('bodegaOrders.qbEstimate')}</div>
                                            <div className="text-lg font-black text-emerald-700 mt-1">
                                                {existingOrder?.qb_estimate_number
                                                    ? `#${existingOrder.qb_estimate_number}`
                                                    : '—'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Order table */}
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm border-collapse whitespace-nowrap">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300">
                                                    <th className="sticky left-0 bg-slate-50 border p-3 text-left min-w-[200px] z-10">{t('bodegaOrders.item')}</th>
                                                    <th className="border p-3 text-center w-28">{t('bodegaOrders.unit')}</th>
                                                    <th className="border p-3 text-center w-20 bg-emerald-50 text-emerald-700">{t('bodegaOrders.parIdeal')}</th>
                                                    <th className="border p-3 text-center w-20 bg-orange-50 text-orange-700">{t('bodegaOrders.leftover')}</th>
                                                    <th className="border p-3 text-center w-20 bg-blue-50 text-blue-700">{t('bodegaOrders.calculated')}</th>
                                                    <th className="border p-3 text-center w-24 bg-indigo-50 text-indigo-700">{t('bodegaOrders.adjusted')}</th>
                                                    <th className="border p-3 text-center w-20 bg-violet-50 text-violet-700 font-black">{t('bodegaOrders.finalQty')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {orderLines.map((line, i) => {
                                                    const adj = adjustments[line.inventory_item_id]
                                                    const finalQty = adj !== undefined ? adj : line.calculated_qty
                                                    const isNegative = line.calculated_qty < 0
                                                    const isZeroLeftover = line.leftover_value === null

                                                    return (
                                                        <tr key={line.inventory_item_id}
                                                            className={`transition-colors ${isNegative ? 'bg-red-50/30' : isZeroLeftover ? 'bg-slate-50' : finalQty > 0 ? 'hover:bg-blue-50/30' : ''}`}>
                                                            <td className="sticky left-0 bg-white border border-slate-200 p-2 font-semibold text-slate-800 z-10">
                                                                {line.item_name}
                                                            </td>
                                                            <td className="border border-slate-200 p-2 text-center text-xs text-slate-500">{line.unit_description}</td>
                                                            <td className="border border-emerald-100 p-2 text-center font-medium text-emerald-700 bg-emerald-50/30">{line.par_value || '-'}</td>
                                                            <td className={`border p-2 text-center font-bold ${isZeroLeftover ? 'text-slate-300 bg-slate-50 border-slate-200' : 'text-orange-700 border-orange-100 bg-orange-50/30'}`}>
                                                                {line.leftover_value !== null ? line.leftover_value : '-'}
                                                            </td>
                                                            <td className={`border p-2 text-center font-bold ${isNegative ? 'text-red-600 bg-red-50 border-red-200' : isZeroLeftover ? 'text-slate-300 border-slate-200 bg-slate-50' : 'text-blue-700 bg-blue-50/30 border-blue-100'}`}>
                                                                {isZeroLeftover ? '-' : line.calculated_qty}
                                                            </td>
                                                            <td className="border border-indigo-100 p-0 bg-indigo-50/20">
                                                                <input
                                                                    type="number"
                                                                    placeholder="-"
                                                                    className="w-full p-2 text-center outline-none bg-transparent focus:bg-white focus:ring-2 focus:ring-indigo-400 font-bold text-indigo-700 text-sm placeholder:text-indigo-200"
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
                                                                />
                                                            </td>
                                                            <td className={`border p-2 text-center font-black text-lg ${finalQty > 0 ? 'text-violet-700 bg-violet-50/30 border-violet-200' : finalQty < 0 ? 'text-red-400 bg-red-50/20 border-red-100' : 'text-slate-300 border-slate-200'}`}>
                                                                {isZeroLeftover ? '-' : finalQty}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Observations and notes */}
                                    <div className="p-5 border-t border-slate-200 mt-6 bg-slate-50/30">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            📝 {t('bodegaOrders.observations')}
                                        </label>
                                        <textarea
                                            value={orderNotes}
                                            onChange={e => setOrderNotes(e.target.value)}
                                            placeholder={t('bodegaOrders.observationsPlaceholder')}
                                            rows={2}
                                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none bg-white placeholder:text-slate-400"
                                        />
                                    </div>

                                    {/* Action buttons */}
                                    <div className="p-5 border-t border-slate-200 bg-slate-50/50 flex flex-wrap gap-3 justify-end">
                                        <button onClick={handleGenerateOrder} disabled={saving}
                                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold shadow-sm transition-colors disabled:opacity-50">
                                            <Save size={16} /> {saving ? t('bodegaOrders.saving') : t('bodegaOrders.generateOrder')}
                                        </button>
                                        <button onClick={handleSendToQb} disabled={sendingToQb || !isCurrentWeek}
                                            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white px-6 py-3 rounded-xl font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                            <Send size={16} /> {sendingToQb ? t('bodegaOrders.sendingToQb') : t('bodegaOrders.sendToQb')}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ---- TAB: ANALYSIS ---- */}
                        {activeTab === 'analysis' && (
                            <div className="p-5">
                                <h2 className="text-lg font-black text-slate-800 mb-4">{t('bodegaOrders.analysisTitle')}</h2>

                                {/* Usage percentage table */}
                                <div className="overflow-x-auto mb-8">
                                    <table className="w-full text-sm border-collapse whitespace-nowrap">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-600 font-bold border-b-2 border-slate-300">
                                                <th className="sticky left-0 bg-slate-50 border p-3 text-left min-w-[200px] z-10">{t('bodegaOrders.item')}</th>
                                                {weekDays.map(d => (
                                                    <th key={`ah_${d.key}`} className="border p-2 text-center w-20">
                                                        {d.label}<br/><span className="text-xs font-normal text-slate-400">{t('bodegaOrders.usagePercent')}</span>
                                                    </th>
                                                ))}
                                                <th className="border p-2 text-center w-20 bg-slate-100 font-black">{t('bodegaOrders.total')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map(item => {
                                                const b = bases[item.id]
                                                const itemC = counts[item.id] || {}
                                                let totalBase = 0
                                                let totalLeft = 0

                                                return (
                                                    <tr key={item.id} className="hover:bg-teal-50/30">
                                                        <td className="sticky left-0 bg-white border border-slate-200 p-2 font-semibold text-slate-800 z-10">
                                                            {item.excel_reference || item.name}
                                                        </td>
                                                        {weekDays.map(d => {
                                                            const base = b ? (b as any)[d.baseField] || 0 : 0
                                                            const left = itemC[d.dateStr]
                                                            totalBase += base
                                                            if (left !== undefined) totalLeft += left

                                                            if (base === 0 || left === undefined) {
                                                                return <td key={`ac_${item.id}_${d.key}`} className="border border-slate-200 p-2 text-center text-slate-300">-</td>
                                                            }
                                                            const pct = Math.round((left / base) * 100)
                                                            let color = 'text-slate-700'
                                                            let bg = ''
                                                            if (pct > 50) { color = 'text-amber-700'; bg = 'bg-amber-50' }
                                                            else if (pct < 10) { color = 'text-red-600'; bg = 'bg-red-50' }
                                                            else if (pct >= 20 && pct <= 35) { color = 'text-emerald-700'; bg = 'bg-emerald-50' }

                                                            return (
                                                                <td key={`ac_${item.id}_${d.key}`} className={`border border-slate-200 p-2 text-center font-bold text-xs ${color} ${bg}`}>
                                                                    {pct}%
                                                                </td>
                                                            )
                                                        })}
                                                        <td className="border border-slate-300 p-2 text-center font-black bg-slate-50">
                                                            {totalBase > 0 ? `${Math.round((totalLeft / totalBase) * 100)}%` : '-'}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Order History */}
                                {analysisData?.orderHistory && analysisData.orderHistory.length > 0 && (
                                    <div className="mt-6">
                                        <h3 className="text-md font-black text-slate-700 mb-3">{t('bodegaOrders.orderHistory')}</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {analysisData.orderHistory.map((order: any) => (
                                                <div key={order.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="font-bold text-slate-800">{order.order_date}</div>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                                            order.status === 'sent' ? 'bg-emerald-100 text-emerald-700' :
                                                            order.status === 'draft' ? 'bg-slate-100 text-slate-600' :
                                                            'bg-blue-100 text-blue-700'
                                                        }`}>
                                                            {t(`bodegaOrders.status.${order.status}`)}
                                                        </span>
                                                    </div>
                                                    {order.qb_estimate_number && (
                                                        <div className="text-xs text-emerald-600 font-medium">
                                                            QB Estimate #{order.qb_estimate_number}
                                                        </div>
                                                    )}
                                                    <div className="text-xs text-slate-400 mt-1">
                                                        {t('bodegaOrders.weekOf')} {order.week_start_date}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

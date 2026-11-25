/**
 * @module components/food-cost/ProductDetailModal
 * @description Modal de desglose unitario de receta (Comida vs Empaque), margen y tickets reales de Toast POS
 *   por platillo para el módulo Food Cost de Tacos Gavilan.
 * @businessRules
 * - Clasificación estricta de ingredientes vs empaque por `ing.type?.startsWith('cogs_')` (PROHIBIDO usar subcadenas
 *   como `"bolsa"` o `"bag"`, para que insumos de comida como `"Bolsa Aguacate"`, `"Bolsa Crema"`, `"Bolsa Mayonesa"`,
 *   `"1 oz Bolsa de Mixta"` y `"Salchicha Bag"` permanezcan siempre en Ingredientes de Comida).
 * - Envía `&price=${item.unit_price}` a `/api/inventory/recipe-detail` para resolver correctamente tamaños de Party Trays / Fiesta Platters.
 * - Semáforo canónico unificado (`getFoodCostStatus` de `lib/inventory/food-cost-sales-resolver.ts`):
 *   `<= 32%` verde esmeralda, `> 32%–35%` ámbar, `> 35%` rojo crítico.
 * @dataFlow
 * - `/api/inventory/recipe-detail` + `/api/inventory/item-tickets` + `/api/toast-order-detail` -> Modal interactivo.
 * @notes
 * - [2026-11-23] Corregida separación estricta Food vs Packaging por `type`, añadido `&price=`, corregida etiqueta `% rendimiento`
 *   (en vez de `merma`), reseteo de pestaña al cambiar platillo y paso de `storeName` real al recibo de Toast.
 */

'use client'

import React, { useEffect, useState } from 'react'
import { X, ChefHat, DollarSign, TrendingDown, Sparkles, AlertTriangle, Package, Receipt, FileText, ShoppingBag, Utensils, Info, ChevronRight, Search } from 'lucide-react'
import {
    FOOD_COST_MAX_RANGE_ALL_STORES_DAYS,
    getFoodCostStatus,
    validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'
import { useLanguage } from '@/lib/i18n'

interface RecipeBreakdownItem {
    inventoryItemId?: string
    itemName: string
    quantity: number
    unit: string
    type?: string
    yieldPercent: number
    cost: number
    isMissingPrice: boolean
}

interface ProductItem {
    guid: string
    name: string
    group_name?: string
    store_name?: string
    quantity: number
    net_sales: number
    gross_sales: number
    discounts: number
    unit_price: number
    total_modifier_cost: number // extras revenue per unit
    unit_cost: number
    total_cost: number
    food_cost?: number
    packaging_cost?: number
    packaging_cost_percent?: number
    food_cost_percent: number
    has_recipe: boolean
    missing_prices: boolean
    modifier_guids?: string[]
}

interface ProductDetailModalProps {
    item: ProductItem | null
    storeId?: string
    storeName?: string
    startDate?: string
    endDate?: string
    onClose: () => void
}

export default function ProductDetailModal({ item, storeId, storeName, startDate, endDate, onClose }: ProductDetailModalProps) {
    const { language, t } = useLanguage()
    const isEn = language === 'en'

    const [recipeData, setRecipeData] = useState<{
        has_recipe: boolean
        breakdown: RecipeBreakdownItem[]
        total_cost: number
        food_cost?: number
        packaging_cost?: number
        match_method: string
        missing_prices: number
    } | null>(null)
    const [loading, setLoading] = useState(false)

    // Tickets feature
    const [activeTab, setActiveTab] = useState<'summary' | 'tickets'>('summary')
    const [tickets, setTickets] = useState<{ date: string; orderId?: string; checkId?: string; orderNumber: string; quantity: number; diningOption?: string }[] | null>(null)
    const [loadingTickets, setLoadingTickets] = useState(false)
    const [ticketsRangeBlocked, setTicketsRangeBlocked] = useState(false)
    const [ticketSearch, setTicketSearch] = useState('')

    // Purchase Ticket Modal State (matches Discounts module)
    const [orderDetailData, setOrderDetailData] = useState<{
        loading: boolean
        checkId: string
        storeName?: string
        cajeraName?: string
        data?: any
        error?: string
    } | null>(null)

    useEffect(() => {
        if (!item) return
        const controller = new AbortController()
        setLoading(true)
        setActiveTab('summary')
        setTicketSearch('')
        setTickets(null)
        setTicketsRangeBlocked(false)
        setRecipeData(null)

        const params = new URLSearchParams()
        params.append('guid', item.guid)
        params.append('name', item.name)
        params.append('quantity', item.quantity.toString())
        if (Number.isFinite(item.unit_price) && item.unit_price > 0) {
            params.append('price', item.unit_price.toString())
        }
        if (item.modifier_guids && item.modifier_guids.length > 0) {
            params.append('modifiers', item.modifier_guids.join(','))
        }
        if (item.group_name) {
            params.append('dining_option', item.group_name)
        }

        fetch(`/api/inventory/recipe-detail?${params.toString()}`, { signal: controller.signal })
            .then(async r => {
                if (!r.ok) return null
                const text = await r.text()
                return text ? JSON.parse(text) : null
            })
            .then(data => {
                if (!controller.signal.aborted) setRecipeData(data)
            })
            .catch(() => {
                if (!controller.signal.aborted) setRecipeData(null)
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false)
            })

        return () => controller.abort()
    }, [item])

    // Fetch tickets on demand
    useEffect(() => {
        if (activeTab === 'tickets' && !tickets && item && storeId && startDate && endDate) {
            const rangeCheck = validateDateRangeWithinMaxDays(startDate, endDate, FOOD_COST_MAX_RANGE_ALL_STORES_DAYS)
            if (!rangeCheck.ok) {
                setTicketsRangeBlocked(true)
                setTickets([])
                setLoadingTickets(false)
                return
            }

            const controller = new AbortController()
            setTicketsRangeBlocked(false)
            setLoadingTickets(true)
            const params = new URLSearchParams()
            params.append('storeId', storeId)
            params.append('startDate', startDate)
            params.append('endDate', endDate)
            params.append('guid', item.guid)
            params.append('name', item.name)
            if (item.group_name) params.append('group_name', item.group_name)
            if (item.quantity) params.append('quantity', String(item.quantity))

            fetch(`/api/inventory/item-tickets?${params.toString()}`, { signal: controller.signal })
                .then(async r => {
                    if (!r.ok) return { tickets: [] }
                    const text = await r.text()
                    return text ? JSON.parse(text) : { tickets: [] }
                })
                .then(data => {
                    if (controller.signal.aborted) return
                    if (data?.tickets) setTickets(data.tickets)
                    else setTickets([])
                })
                .catch(() => {
                    if (!controller.signal.aborted) setTickets([])
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoadingTickets(false)
                })

            return () => controller.abort()
        }
    }, [activeTab, item, storeId, startDate, endDate, tickets])

    if (!item) return null

    // Strictly split Food vs Packaging by `ing.type?.startsWith('cogs_')` — NEVER by substring ("bolsa", "bag", etc.)!
    const isPackagingIngredient = (ing: RecipeBreakdownItem): boolean => Boolean(ing.type && ing.type.startsWith('cogs_'))
    const foodBreakdown = recipeData?.breakdown.filter(ing => !isPackagingIngredient(ing)) || []
    const packagingBreakdown = recipeData?.breakdown.filter(ing => isPackagingIngredient(ing)) || []

    const foodCostSum = foodBreakdown.reduce((acc, ing) => acc + ing.cost, 0)
    const packagingCostSum = packagingBreakdown.reduce((acc, ing) => acc + ing.cost, 0)

    // Revenue & Cost breakdown (per unit)
    const pricePerUnit = item.unit_price
    const discountPerUnit = item.quantity > 0 ? item.discounts / item.quantity : 0
    const extrasPerUnit = item.total_modifier_cost
    const netPerUnit = item.quantity > 0 ? item.net_sales / item.quantity : 0
    const pureFoodCostPerUnit = recipeData?.has_recipe ? foodCostSum : item.unit_cost
    const pkgCostPerUnit = recipeData?.has_recipe
        ? packagingCostSum
        : (item.quantity > 0 && (item.packaging_cost ?? 0) > 0 ? (item.packaging_cost! / item.quantity) : 0)
    const totalCogsPerUnit = pureFoodCostPerUnit + pkgCostPerUnit
    const profitPerUnit = netPerUnit - pureFoodCostPerUnit

    // Totals
    const totalProfit = item.net_sales - item.total_cost
    const profitMargin = item.net_sales > 0 ? (totalProfit / item.net_sales) * 100 : 0
    const costPercent = item.food_cost_percent
    const pkgPercent = netPerUnit > 0 && pkgCostPerUnit > 0 ? (pkgCostPerUnit / netPerUnit) * 100 : (item.packaging_cost_percent ?? 0)
    const fcStatus = getFoodCostStatus(costPercent)

    const resolvedStoreLabel = (storeName || item.store_name || '').replace(/^Tacos Gavilan\s+/i, '').trim() || 'Tacos Gavilan'

    const handleOpenTicket = (orderId: string, checkId: string) => {
        if (!orderId || orderId === 'N/A' || orderId === item.guid || orderId.length < 20) {
            alert(isEn ? 'This ticket does not have an active order ID in Toast POS.' : 'Este ticket no cuenta con un ID de orden activo en Toast POS.')
            return
        }
        setOrderDetailData({
            loading: true,
            checkId: checkId || orderId.slice(0, 8),
            storeName: resolvedStoreLabel
        })

        const fetchUrl = `/api/toast-order-detail?guid=${orderId}${storeId ? `&storeId=${storeId}` : ''}`
        fetch(fetchUrl)
            .then(res => res.json())
            .then(data => {
                if (data.error) setOrderDetailData(prev => prev ? { ...prev, loading: false, error: data.error } : null)
                else setOrderDetailData(prev => prev ? { ...prev, loading: false, data: data.order } : null)
            })
            .catch(err => setOrderDetailData(prev => prev ? { ...prev, loading: false, error: err.message } : null))
    }

    const fcBarColor = fcStatus === 'critical' ? 'bg-rose-500' : fcStatus === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
    const fcCardColor = fcStatus === 'critical'
        ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
        : fcStatus === 'warning'
            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
            : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6" onClick={onClose}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity" />

            {/* Main Modal Container */}
            <div
                className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col cursor-default"
                onClick={e => e.stopPropagation()}
            >
                {/* ═══ TOP HEADER BAR ═══ */}
                <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-6 pt-5 pb-0 shrink-0 text-white border-b border-slate-700/50">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="text-[10px] font-black uppercase tracking-wider text-sky-400 bg-sky-500/20 px-2.5 py-0.5 rounded-full border border-sky-400/30">
                                    {item.group_name || (isEn ? 'General Channel' : 'Canal General')}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">GUID: {item.guid.slice(0, 8)}</span>
                            </div>
                            <h2 className="font-black text-white text-lg md:text-xl leading-tight truncate tracking-tight">{item.name}</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white rounded-full transition-all shrink-0 cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* ═══ HIGHLIGHTED KPI CARDS ═══ */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 mb-2">
                        {/* Venta Neta */}
                        <div className="bg-slate-800/80 dark:bg-slate-900/80 rounded-xl p-2.5 border border-slate-700/60 text-center">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                                {isEn ? 'Net Sales' : 'Venta Neta'}
                            </span>
                            <span className="font-mono font-black text-emerald-400 text-sm md:text-base block mt-0.5">
                                ${item.net_sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                        {/* Food Cost $ */}
                        <div className="bg-slate-800/80 dark:bg-slate-900/80 rounded-xl p-2.5 border border-slate-700/60 text-center">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                                {isEn ? 'Food Cost ($)' : 'Costo Comida'}
                            </span>
                            <span className="font-mono font-black text-rose-300 text-sm md:text-base block mt-0.5">
                                ${item.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                        {/* Ganancia */}
                        <div className="bg-slate-800/80 dark:bg-slate-900/80 rounded-xl p-2.5 border border-slate-700/60 text-center">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                                {isEn ? 'Food Margin' : 'Ganancia'}
                            </span>
                            <span className={`font-mono font-black text-sm md:text-base block mt-0.5 ${totalProfit >= 0 ? 'text-sky-300' : 'text-rose-400'}`}>
                                ${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                        {/* Food Cost % */}
                        <div className={`rounded-xl p-2.5 border text-center ${fcCardColor}`}>
                            <span className="text-[9px] font-bold uppercase tracking-wider block opacity-90">Food Cost %</span>
                            <span className="font-mono font-black text-sm md:text-base block mt-0.5">
                                {item.net_sales > 0 ? `${costPercent.toFixed(1)}%` : 'N/A'}
                            </span>
                            {pkgPercent > 0 && (
                                <span className="font-mono text-[10px] text-sky-300 block">
                                    +{pkgPercent.toFixed(1)}% {isEn ? 'Pkg' : 'Empaque'}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* ═══ TABS NAVIGATION ═══ */}
                    <div className="flex items-center gap-6 mt-3">
                        <button
                            onClick={() => setActiveTab('summary')}
                            className={`pb-3 text-xs md:text-sm font-bold tracking-wide transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                                activeTab === 'summary'
                                    ? 'text-white border-sky-400'
                                    : 'text-slate-400 border-transparent hover:text-slate-200'
                            }`}
                        >
                            <FileText size={15} /> {isEn ? 'Food & Packaging Breakdown' : 'Desglose de Food Cost y Empaque'}
                        </button>
                        <button
                            onClick={() => setActiveTab('tickets')}
                            className={`pb-3 text-xs md:text-sm font-bold tracking-wide transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                                activeTab === 'tickets'
                                    ? 'text-white border-sky-400'
                                    : 'text-slate-400 border-transparent hover:text-slate-200'
                            }`}
                        >
                            <Receipt size={15} /> {isEn ? 'Toast Receipts & Tickets' : 'Recibos & Tickets Toast'} ({tickets ? tickets.length : item.quantity})
                        </button>
                    </div>
                </div>

                {/* ═══ SCROLLABLE MODAL BODY ═══ */}
                <div className="overflow-y-auto flex-1 styled-scrollbar p-6 space-y-6 bg-slate-50/50 dark:bg-slate-900/50">
                    {activeTab === 'summary' ? (
                        <>
                            {/* ═══ 1. VISUAL COST BAR & MARGIN RATIO ═══ */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div className="flex justify-between items-center mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <span>{isEn ? `Unit Price Distribution ($${netPerUnit.toFixed(2)} / unit)` : `Distribución del Precio de Venta ($${netPerUnit.toFixed(2)} / unidad)`}</span>
                                    <span className="font-mono text-slate-700 dark:text-slate-200">{isEn ? 'Margin' : 'Margen'}: {profitMargin.toFixed(1)}%</span>
                                </div>

                                {/* Progress Bar */}
                                <div className="h-4 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex shadow-inner">
                                    <div
                                        style={{ width: `${Math.min(100, Math.max(0, costPercent))}%` }}
                                        className={`h-full transition-all ${fcBarColor}`}
                                        title={`Food Cost: ${costPercent.toFixed(1)}%`}
                                    />
                                    {pkgPercent > 0 && (
                                        <div
                                            style={{ width: `${Math.min(100 - Math.min(100, Math.max(0, costPercent)), Math.max(0, pkgPercent))}%` }}
                                            className="h-full bg-indigo-500 transition-all"
                                            title={`${isEn ? 'Packaging' : 'Empaque'}: ${pkgPercent.toFixed(1)}%`}
                                        />
                                    )}
                                    <div
                                        style={{ width: `${Math.min(100, Math.max(0, profitMargin - pkgPercent))}%` }}
                                        className="h-full bg-sky-500 transition-all"
                                        title={`${isEn ? 'Gross Profit' : 'Ganancia Bruta'}: ${Math.max(0, profitMargin - pkgPercent).toFixed(1)}%`}
                                    />
                                </div>

                                <div className="flex flex-wrap justify-between items-center gap-2 mt-3.5 text-xs font-mono">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-3 h-3 rounded-full ${fcBarColor}`} />
                                        <span className="text-slate-600 dark:text-slate-400">
                                            {isEn ? 'Food Cost' : 'Comida'}: <strong className="text-slate-900 dark:text-white">${pureFoodCostPerUnit.toFixed(2)}</strong>
                                        </span>
                                    </div>
                                    {pkgCostPerUnit > 0 && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-3 h-3 rounded-full bg-indigo-500" />
                                            <span className="text-slate-600 dark:text-slate-400">
                                                {isEn ? 'Packaging' : 'Empaque'}: <strong className="text-slate-900 dark:text-white">${pkgCostPerUnit.toFixed(2)}</strong>
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full bg-sky-500" />
                                        <span className="text-slate-600 dark:text-slate-400">
                                            {isEn ? 'Unit Profit' : 'Ganancia Neta'}: <strong className="text-slate-900 dark:text-white">${profitPerUnit.toFixed(2)}</strong>
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* ═══ 2. UNIT REVENUE & PRICING METRICS ═══ */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-400 mb-3 flex items-center gap-2">
                                    <DollarSign size={14} className="text-emerald-500" /> {isEn ? 'Unit Revenue Breakdown' : 'Desglose de Ingreso Unitario (Revenue)'}
                                </h3>

                                <div className="space-y-2 font-mono text-xs">
                                    <div className="flex justify-between items-center py-1">
                                        <span className="text-slate-600 dark:text-slate-400">{isEn ? 'Base Menu Price' : 'Precio Base en Menú'}</span>
                                        <span className="font-bold text-slate-900 dark:text-white">${pricePerUnit.toFixed(2)}</span>
                                    </div>
                                    {discountPerUnit > 0 && (
                                        <div className="flex justify-between items-center py-1 text-rose-500">
                                            <span className="flex items-center gap-1.5"><TrendingDown size={13} /> {isEn ? 'Applied Discounts' : 'Descuentos Aplicados'}</span>
                                            <span className="font-bold">-${discountPerUnit.toFixed(2)}</span>
                                        </div>
                                    )}
                                    {extrasPerUnit > 0 && (
                                        <div className="flex justify-between items-center py-1 text-sky-500">
                                            <span className="flex items-center gap-1.5"><Sparkles size={13} /> {isEn ? 'Modifiers / Extras' : 'Modificadores / Extras'}</span>
                                            <span className="font-bold">+${extrasPerUnit.toFixed(2)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-center pt-2.5 mt-1 border-t border-dashed border-slate-200 dark:border-slate-700 font-sans">
                                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">{isEn ? '= Net Sales per Unit' : '= Venta Neta por Unidad'}</span>
                                        <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">${netPerUnit.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* ═══ 3. RECIPE BREAKDOWN (FOOD VS PACKAGING BY STRICT `ing.type`) ═══ */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-400 flex items-center gap-2">
                                        <ChefHat size={14} className="text-sky-500" /> {isEn ? 'Recipe — Theoretical Portion per Unit' : 'Receta — Porción Teórica por Unidad'}
                                    </h3>
                                    {recipeData?.has_recipe && (
                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                                            {recipeData.breakdown.length} {isEn ? 'Inputs' : 'Insumos'}
                                        </span>
                                    )}
                                </div>

                                {loading ? (
                                    <div className="flex items-center gap-3 py-6 text-slate-400 justify-center">
                                        <div className="w-5 h-5 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin"></div>
                                        <span className="text-sm font-medium">{isEn ? 'Loading recipe breakdown...' : 'Consultando receta en bodega...'}</span>
                                    </div>
                                ) : recipeData?.has_recipe ? (
                                    <div className="space-y-4">
                                        {/* Food Ingredients */}
                                        {foodBreakdown.length > 0 && (
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                                        <Utensils size={12} className="text-amber-500" /> {isEn ? 'Food Ingredients (Food Cost)' : 'Ingredientes (Comida / Food Cost)'}
                                                    </span>
                                                    <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">${foodCostSum.toFixed(4)}</span>
                                                </div>
                                                <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-slate-50/50 dark:bg-slate-900/40 rounded-xl px-3 border border-slate-100 dark:border-slate-700">
                                                    {foodBreakdown.map((ing, i) => (
                                                        <div key={i} className="flex justify-between items-center py-2 text-xs">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <Package size={13} className={ing.isMissingPrice ? 'text-amber-500' : 'text-slate-400'} />
                                                                <div className="min-w-0">
                                                                    <span className={`font-semibold truncate block ${ing.isMissingPrice ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                        {ing.itemName}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400 font-mono">
                                                                        {ing.quantity.toFixed(2)} {ing.unit}
                                                                        {ing.yieldPercent < 100 && ` (${ing.yieldPercent}% ${isEn ? 'yield' : 'rendimiento'})`}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <span className={`font-mono font-bold shrink-0 ${ing.isMissingPrice ? 'text-amber-500' : 'text-slate-800 dark:text-slate-200'}`}>
                                                                {ing.isMissingPrice ? '⚠ $0.00' : `$${ing.cost.toFixed(4)}`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Packaging / Supplies */}
                                        {packagingBreakdown.length > 0 && (
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                                        <ShoppingBag size={12} className="text-sky-500" /> {isEn ? 'Packaging & Disposables (Separate)' : 'Empaques & Desechables (Separado)'}
                                                    </span>
                                                    <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">${packagingCostSum.toFixed(4)}</span>
                                                </div>
                                                <div className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-slate-50/50 dark:bg-slate-900/40 rounded-xl px-3 border border-slate-100 dark:border-slate-700">
                                                    {packagingBreakdown.map((ing, i) => (
                                                        <div key={i} className="flex justify-between items-center py-2 text-xs">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <Package size={13} className={ing.isMissingPrice ? 'text-amber-500' : 'text-slate-400'} />
                                                                <div className="min-w-0">
                                                                    <span className={`font-semibold truncate block ${ing.isMissingPrice ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                        {ing.itemName}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400 font-mono">
                                                                        {ing.quantity.toFixed(2)} {ing.unit}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <span className={`font-mono font-bold shrink-0 ${ing.isMissingPrice ? 'text-amber-500' : 'text-slate-800 dark:text-slate-200'}`}>
                                                                {ing.isMissingPrice ? '⚠ $0.00' : `$${ing.cost.toFixed(4)}`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-1.5 pt-3 border-t border-slate-200 dark:border-slate-700 font-sans">
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                                                    {isEn ? '= Food Cost per Unit' : '= Food Cost por Unidad (Comida)'}
                                                </span>
                                                <span className="font-mono font-black text-slate-900 dark:text-white text-base">${pureFoodCostPerUnit.toFixed(2)}</span>
                                            </div>
                                            {packagingCostSum > 0 && (
                                                <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                                                    <span>{isEn ? '+ Packaging Cost per Unit (Channel)' : '+ Empaque por Unidad (Canal)'}</span>
                                                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400">+${packagingCostSum.toFixed(2)} (Total COGS: ${totalCogsPerUnit.toFixed(2)})</span>
                                                </div>
                                            )}
                                        </div>

                                        {recipeData.missing_prices > 0 && (
                                            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-bold bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-xl border border-amber-200 dark:border-amber-800/50">
                                                <AlertTriangle size={14} className="shrink-0" />
                                                {isEn
                                                    ? `Attention: ${recipeData.missing_prices} ingredient(s) have no price registered in QuickBooks.`
                                                    : `Atención: ${recipeData.missing_prices} ingrediente(s) no tienen precio registrado en QuickBooks.`}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="py-6 text-center">
                                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-xl">
                                            <AlertTriangle size={14} className="text-amber-500" /> {isEn ? 'No recipe assigned in system' : 'Sin receta asignada en sistema'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        /* ═══ 4. ORDERS & TICKETS TAB ═══ */
                        <div className="space-y-4">
                            {/* Helper Banner & Ticket Search */}
                            <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 rounded-2xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-sky-900 dark:text-sky-200">
                                <div className="flex items-start gap-3">
                                    <Info size={18} className="text-sky-500 shrink-0 mt-0.5" />
                                    <div className="text-xs leading-relaxed">
                                        <strong className="block text-sky-950 dark:text-sky-100 font-bold mb-0.5">
                                            {isEn ? 'Real-Time Receipt Audit:' : 'Auditoría de Recibos en Tiempo Real:'}
                                        </strong>
                                        {isEn ? 'Click the ticket number ' : 'Haz clic en el número de ticket '}
                                        <span className="font-mono font-bold bg-sky-100 dark:bg-sky-900/60 px-1.5 py-0.5 rounded text-sky-700 dark:text-sky-300">#Ticket</span>
                                        {isEn ? ' to open the official receipt.' : ' para abrir el recibo oficial.'}
                                    </div>
                                </div>
                                <div className="relative shrink-0 min-w-[200px]">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder={isEn ? 'Search # ticket (e.g. 940)...' : 'Buscar por # ticket (ej: 940)...'}
                                        value={ticketSearch}
                                        onChange={e => setTicketSearch(e.target.value)}
                                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono text-slate-800 dark:text-slate-100"
                                    />
                                </div>
                            </div>

                            {/* Orders Table Container */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                                <div className="grid grid-cols-4 gap-2 px-4 py-3 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 font-black text-[10px] tracking-wider uppercase text-slate-500">
                                    <div className="col-span-2">{isEn ? 'Local Date / Time' : 'Fecha / Hora Local'}</div>
                                    <div># Ticket Toast</div>
                                    <div className="text-right">{isEn ? 'Quantity' : 'Cantidad'}</div>
                                </div>

                                <div className="divide-y divide-slate-100 dark:divide-slate-700/60 max-h-[50vh] overflow-y-auto styled-scrollbar">
                                    {loadingTickets ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                            <div className="w-6 h-6 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin mb-3"></div>
                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{isEn ? 'Searching Toast POS orders...' : 'Buscando órdenes en el TPV de Toast...'}</span>
                                            <span className="text-[10px] opacity-70 mt-1">{isEn ? 'Connecting to store...' : 'Conectando con la sucursal...'}</span>
                                        </div>
                                    ) : ticketsRangeBlocked ? (
                                        <div className="py-10 px-6 text-center text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30">
                                            {t('food_cost.tickets_range_limit')}
                                        </div>
                                    ) : !tickets || tickets.length === 0 ? (
                                        <div className="py-12 text-center text-xs font-medium text-slate-500">
                                            {isEn ? 'No tickets found for this period.' : 'No se encontraron tickets registrados para este periodo.'}
                                        </div>
                                    ) : (
                                        <>
                                            {tickets
                                                .filter(t => {
                                                    if (!ticketSearch.trim()) return true
                                                    const query = ticketSearch.trim().toLowerCase().replace('#', '')
                                                    return (t.checkId && t.checkId.toLowerCase().includes(query)) ||
                                                        (t.orderNumber && t.orderNumber.toLowerCase().includes(query)) ||
                                                        (t.date && t.date.toLowerCase().includes(query)) ||
                                                        (t.orderId && t.orderId.toLowerCase().includes(query))
                                                })
                                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                                .map((t, i) => {
                                                    const hasOrderGuid = Boolean(t.orderId && t.orderId.length > 20)
                                                    const rawNum = (t.orderNumber && !t.orderNumber.includes('N/A') && !t.orderNumber.includes('TICKET'))
                                                        ? t.orderNumber
                                                        : (t.checkId && !t.checkId.includes('N/A') && !t.checkId.includes('TICKET') ? `#${t.checkId}` : (hasOrderGuid ? `#${t.orderId!.slice(0, 8)}` : '#TICKET'))

                                                    const cleanCheckId = rawNum.replace('#', '')

                                                    return (
                                                        <div
                                                            key={i}
                                                            onClick={() => {
                                                                if (hasOrderGuid) handleOpenTicket(t.orderId!, cleanCheckId)
                                                                else alert(isEn ? 'This order has no active Toast POS ID.' : 'Esta orden no cuenta con un ID activo en Toast POS para descargar el ticket completo.')
                                                            }}
                                                            className="grid grid-cols-4 gap-2 px-4 py-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors items-center cursor-pointer group"
                                                        >
                                                            <div className="col-span-2 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                                                {t.date}
                                                            </div>
                                                            <div>
                                                                <span className={`inline-flex items-center gap-1 font-mono text-xs font-bold px-2.5 py-1 rounded-lg border transition-all shadow-sm ${
                                                                    hasOrderGuid
                                                                        ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 group-hover:bg-sky-500 group-hover:text-white border-sky-200 dark:border-sky-800'
                                                                        : 'text-slate-500 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                                                                }`}>
                                                                    {rawNum} {hasOrderGuid && <ChevronRight size={12} className="opacity-70" />}
                                                                </span>
                                                            </div>
                                                            <div className="text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                                                                {t.quantity} pza
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            {tickets.length === 250 && (
                                                <div className="px-4 py-3 text-center text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400">
                                                    {isEn ? 'Showing first 250 results for optimal performance.' : 'Mostrando los primeros 250 resultados para óptimo rendimiento.'}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ FULL TOAST PURCHASE TICKET RECEIPT MODAL (MATCHES DISCOUNTS MODULE 100%) ═══ */}
            {orderDetailData && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200 cursor-pointer"
                    onClick={(e) => {
                        e.stopPropagation()
                        setOrderDetailData(null)
                    }}
                >
                    <div
                        className="bg-white dark:bg-slate-900 w-full max-w-md max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white cursor-default"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Ticket Header Bar */}
                        <div className="p-4 border-b-2 border-dashed border-slate-300 dark:border-slate-700 font-bold text-center bg-slate-50 dark:bg-slate-800 shrink-0 flex items-center justify-between">
                            <span className="text-sm tracking-wider uppercase font-mono font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                🧾 {isEn ? 'RECEIPT TICKET' : 'RECIBO TICKET'} #{orderDetailData.checkId}
                            </span>
                            <button
                                onClick={() => setOrderDetailData(null)}
                                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Scrollable Receipt Body */}
                        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 bg-[#f9fafb] dark:bg-slate-900">
                            {orderDetailData.loading && (
                                <div className="flex flex-col items-center justify-center py-12 text-sky-500 animate-pulse">
                                    <div className="w-7 h-7 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                                    <p className="text-xs font-bold">{isEn ? 'Downloading receipt from Toast POS...' : 'Descargando recibo desde Toast POS...'}</p>
                                </div>
                            )}

                            {orderDetailData.error && (
                                <div className="text-rose-500 text-xs break-all bg-rose-50 dark:bg-rose-950/30 p-3.5 rounded-xl border border-rose-200 dark:border-rose-800 font-mono">
                                    ❌ {orderDetailData.error}
                                </div>
                            )}

                            {orderDetailData.data && (
                                <div className="space-y-4 text-slate-800 dark:text-slate-200">
                                    {/* Store Info & Metadata */}
                                    <div className="text-xs text-center border-b border-slate-200 dark:border-slate-800 pb-3">
                                        <div className="font-black text-sm uppercase tracking-wider mb-1 text-slate-900 dark:text-white">
                                            TACOS GAVILAN — {orderDetailData.storeName || 'SUCURSAL'}
                                        </div>
                                        <div className="font-semibold text-slate-600 dark:text-slate-400">
                                            {orderDetailData.data.diningOption?.name || 'To Go / Dine In'}
                                        </div>
                                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                            {new Date(orderDetailData.data.openedDate).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
                                        </div>
                                        <div className="mt-1 text-slate-600 dark:text-slate-400">
                                            {isEn ? 'Cashier' : 'Cajero/a'}: <span className="font-bold text-slate-900 dark:text-slate-100">{orderDetailData.cajeraName || orderDetailData.data.server?.name || 'Automático'}</span>
                                        </div>
                                    </div>

                                    {/* Selections / Items List */}
                                    <div className="border-b-2 border-dashed border-slate-300 dark:border-slate-700 pb-3 space-y-2">
                                        <div className="flex justify-between font-bold text-[10px] text-slate-400 uppercase tracking-widest">
                                            <span>ITEM</span>
                                            <span>TOTAL</span>
                                        </div>
                                        {orderDetailData.data.checks?.map((check: any, idx: number) => (
                                            <div key={idx} className="space-y-2">
                                                {check.selections?.filter((s: any) => !s.deleted && !s.voided).map((sel: any, i: number) => {
                                                    const qty = sel.quantity || 1
                                                    const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0)
                                                    const originalLinePrice = unitPrice * qty
                                                    const finalLinePrice = Number(sel.price || 0)
                                                    const inferredDiscount = originalLinePrice - finalLinePrice
                                                    const validDiscounts = sel.appliedDiscounts?.filter((d: any) => !d.deleted && !d.voided && d.state !== 'VOIDED' && d.state !== 'REMOVED' && d.applied !== false && Number(d.discountAmount || 0) <= inferredDiscount + 0.05) || []

                                                    return (
                                                        <div key={i} className="flex justify-between items-start text-xs font-mono">
                                                            <span className="flex-1 pr-2">
                                                                <span className="font-bold text-slate-900 dark:text-white">{qty}x</span> {sel.displayName || sel.item?.name}
                                                                {validDiscounts.map((d: any, j: number) => (
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
                                                            <span className="font-bold whitespace-nowrap text-slate-900 dark:text-white">
                                                                ${originalLinePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                                {check.appliedDiscounts?.filter((d: any) => !d.deleted && !d.voided && d.state !== 'VOIDED' && d.state !== 'REMOVED' && d.applied !== false).map((d: any, j: number) => (
                                                    <div key={`chk-${j}`} className="flex justify-between items-start text-[11px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-500/10 p-1 rounded font-mono">
                                                        <span>REFERENCIA TICKET: {d.name}</span>
                                                        <span>(-${Number(d.discountAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Calculations Breakdown */}
                                    <div className="text-right space-y-1 text-xs font-mono">
                                        {(() => {
                                            const checks = orderDetailData.data.checks || []
                                            const check = checks[0]
                                            if (!check) return null

                                            const subtotalBruto = check.selections?.filter((s: any) => !s.deleted && !s.voided).reduce((sum: number, sel: any) => {
                                                const qty = sel.quantity || 1
                                                const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0)
                                                return sum + (unitPrice * qty)
                                            }, 0) || 0

                                            const subtotalNeto = Number(check.amount || 0)
                                            const totalDiscounts = Math.max(0, subtotalBruto - subtotalNeto)

                                            return (
                                                <>
                                                    <div className="flex justify-between text-slate-500">
                                                        <span>Subtotal bruto:</span>
                                                        <span>${subtotalBruto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                    {totalDiscounts > 0.009 && (
                                                        <div className="flex justify-between font-bold text-amber-600 dark:text-amber-400">
                                                            <span>Descuentos aplicados:</span>
                                                            <span>-${totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between text-slate-700 dark:text-slate-300 font-semibold mt-1">
                                                        <span>Subtotal neto:</span>
                                                        <span>${subtotalNeto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                    <div className="flex justify-between text-slate-500">
                                                        <span>Tax:</span>
                                                        <span>${Number(check.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                    <div className="flex justify-between font-bold text-base mt-2 text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-800 pt-2">
                                                        <span>TOTAL:</span>
                                                        <span className="text-emerald-600 dark:text-emerald-400">${Number(check.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                </>
                                            )
                                        })()}
                                    </div>

                                    {/* Payments Section */}
                                    {orderDetailData.data.checks?.[0]?.payments?.length > 0 && (
                                        <div className="text-xs pt-3 border-t-2 border-dashed border-slate-300 dark:border-slate-700 font-mono">
                                            <div className="font-bold text-slate-400 mb-1.5 uppercase text-[10px]">PAGOS APLICADOS:</div>
                                            {orderDetailData.data.checks?.[0]?.payments.map((p: any, pIdx: number) => (
                                                <div key={pIdx} className="flex justify-between text-slate-600 dark:text-slate-400 py-0.5">
                                                    <span>{p.type || 'Pago'} {p.originalPaymentStatus && p.originalPaymentStatus !== 'NONE' ? '(Original)' : ''} {p.refundStatus && p.refundStatus !== 'NONE' ? '(Reembolsado)' : ''}</span>
                                                    <span className="font-bold text-slate-800 dark:text-slate-200">${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer Bar */}
                        <div className="p-3 text-center border-t-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shrink-0">
                            <button
                                onClick={() => setOrderDetailData(null)}
                                className="text-xs uppercase tracking-widest font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 px-6 py-2 rounded-xl transition-colors w-full border border-slate-300 dark:border-slate-700 cursor-pointer"
                            >
                                {isEn ? 'Close Receipt' : 'Cerrar Recibo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

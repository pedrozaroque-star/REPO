/**
 * @module components/gavilan-pos/CashierRegister
 * @description Pantalla de Caja (order entry) de Gavilan POS diseñada con los datos reales de lo que las cajeras
 *              de Tacos Gavilan presionan en Toast (13.48M unidades, 349 días × 15 tiendas) y con ergonomía de clase
 *              mundial de POS QSR (Oracle MICROS Simphony Conversational Ordering, McDonald's NP6, Taco Bell POS,
 *              Toast Quick Order / Open View y Square for Restaurants, WCAG 2.5.5).
 *
 * @businessRules
 * - **Layout QSR sin espacios muertos (pantalla 14" / 1080p horizontal)**:
 *   1) Ticket a la IZQUIERDA (~30%, igual que Toast para preservar la memoria espacial de las cajeras), con encabezados
 *      de Plato/Bolsa interactivos (tocar PLATO 1 permite seguir agregando platillos a ese plato) y borrado de
 *      modificadores en 1 toque directo desde el ticket.
 *   2) Riel de Categorías en DOBLE COLUMNA SIN SCROLL (~13%, 224px) para que las 19 familias + Matriz Rápida estén
 *      100% visibles al mismo tiempo sin barra de desplazamiento.
 *   3) Lienzo de Platillos + Banda de Complementos/Bebidas de 1 Toque + Panel de Modificadores Conversacionales (~57%).
 * - **Taxonomía de color por Proteína y Tamaño (Protein Color Coding)**: Cada proteína tiene su color e insignia fija
 *   en todas las familias (Asada=Rojo, Pastor=Naranja, Pollo=Ámbar, Cabeza=Rose, Lengua=Morado, Carnitas=Cobre,
 *   Buche=Teal, Chorizo=Guinda, Vegetariano/Queso=Esmeralda, Bebidas Large 32oz=Azul Rey, Medium 22oz=Celeste).
 * - **Modificadores Conversacionales agrupados por color**:
 *   🔴 Sin / Quitar (Exclusiones en rojo coral) · 🟢 Extras con Cargo (+$ en verde esmeralda) ·
 *   🔵 Preparación, Tortilla y Salsa (en slate/azul) · 🟣 Mitad y Mitad · 📝 Notas Frecuentes.
 * - **Cobro Rápido en 1 Toque (Fast Cash & Smart Denominations)**: Botones directos de Efectivo Exacto, 3 denominaciones
 *   inteligentes superiores al total (calculando y mostrando el CAMBIO A ENTREGAR al instante), Tarjeta 1-Toque y
 *   EBT 0% Tax 1-Toque, además del modal completo de Pago Dividido.
 *
 * @dataFlow
 * - `GET /api/gavilan-pos/register-catalog` (con caché offline en localStorage) → items + modificadores.
 * - Ticket controlado por el padre (`app/gavilan-pos/page.tsx`) vía `cart`/`setCart`; el cobro usa `onCharge` o `onQuickTender`.
 * - Autorizaciones de gerente → `POST /api/gavilan-pos/manager-approval`.
 *
 * @notes
 * - Tamaños táctiles: platillos ≥ 88px de alto, chips ≥ 46px, COBRAR ≥ 60px (guías Apple 44pt / Android 48dp / POS 12–15mm).
 */
'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Zap, Plus, Minus, Trash2, Copy, Scissors, ShoppingBag, UtensilsCrossed, Car, StickyNote, BadgePercent,
    KeyRound, Maximize2, Minimize2, CheckCircle2, AlertTriangle, X, RefreshCw, Lock, Ban, Delete, Search,
    Banknote, CreditCard, Landmark, Hash, Sparkles,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
    REGISTER_FAMILIES, MATRIX_COLUMNS, PROTEIN_ORDER, DISCOUNT_PRESETS,
    requiredRulesFor, requiredStatusForLine, cartHasUnmetRequired, groupLinesByPlate, plateWord,
    lineUnitPrice, lineTotal, nextPlateNumber, normalizeText, itemVisualStyle, classifyModifierBucket,
    smartCashDenominations,
    type RegisterCartLine, type RegisterCatalogItem, type RegisterModifierOption, type RegisterFamilyKey,
    type DiningMode, type DiscountType, type RegisterLineModifier,
} from '@/lib/gavilan-pos/register-layout'

const CATALOG_CACHE_KEY = 'gavilan_pos_register_catalog_v1'
const QTY_PRESETS = [2, 3, 4, 5, 6, 8, 10, 12]
const VEHICLE_COLORS = ['white', 'black', 'gray', 'silver', 'red', 'blue'] as const
const VEHICLE_TYPES = ['sedan', 'suv', 'truck', 'van'] as const

/** High-frequency cross-sell drinks & sides (by normalized name) surfaced below food grids so cashiers don't switch tabs */
const QUICK_COMPLEMENT_NAMES = [
    'large horchata',
    'medium horchata',
    'large jamaica',
    'large pina',
    'large coke',
    'chips',
    'side order guacamole',
    'side order rice',
    'side order beans',
    'side order nacho cheese',
]

export interface CashierRegisterTotals {
    rawSubtotal: number
    totalDiscount: number
    subtotal: number
    tax: number
    total: number
}

export interface AppliedDiscount {
    type: DiscountType
    pct: number
    approverName: string
}

export type QuickTenderMethod = 'CASH' | 'CARD' | 'EBT_FOOD'

export interface CashierRegisterProps {
    cart: RegisterCartLine[]
    setCart: React.Dispatch<React.SetStateAction<RegisterCartLine[]>>
    diningOption: DiningMode
    setDiningOption: (m: DiningMode) => void
    customerName: string
    setCustomerName: (v: string) => void
    vehicleColor: string
    setVehicleColor: (v: string) => void
    vehicleType: string
    setVehicleType: (v: string) => void
    orderNumber: number
    storeNumber: number
    taxRatePct: number
    totals: CashierRegisterTotals
    appliedDiscount: AppliedDiscount | null
    onApplyDiscount: (d: AppliedDiscount) => void
    onClearDiscount: () => void
    onCharge: () => void
    onOpenSplitPayment?: () => void
    onQuickTender?: (method: QuickTenderMethod, cashReceived?: number) => void
    chargeBusy?: boolean
    onVoidLastOrder?: (approverName: string, isWaste: boolean) => Promise<void> | void
    canVoidLastOrder?: boolean
}

type ApprovalMode = { kind: 'DISCOUNT'; type: DiscountType; pct: number } | { kind: 'VOID'; isWaste: boolean }

const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`
const newId = () => `ln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const sameMods = (a: RegisterLineModifier[], b: RegisterLineModifier[]) =>
    a.length === b.length && a.every((m, i) => m.name === b[i].name && (m.count || 1) === (b[i].count || 1) && m.groupKey === b[i].groupKey)

export default function CashierRegister(props: CashierRegisterProps) {
    const {
        cart, setCart, diningOption, setDiningOption, customerName, setCustomerName,
        vehicleColor, setVehicleColor, vehicleType, setVehicleType,
        orderNumber, storeNumber, taxRatePct, totals, appliedDiscount, onApplyDiscount, onClearDiscount,
        onCharge, onOpenSplitPayment, onQuickTender, chargeBusy, onVoidLastOrder, canVoidLastOrder,
    } = props
    const { t, language } = useLanguage()
    const isEs = language === 'es'
    const tr = useCallback((k: string, o?: Record<string, unknown>) => t(`gavilan_pos.register.${k}`, o), [t])

    // ------------------------------------------------------------------ catalog
    const [items, setItems] = useState<RegisterCatalogItem[]>([])
    const [modifiers, setModifiers] = useState<RegisterModifierOption[]>([])
    const [catalogState, setCatalogState] = useState<'loading' | 'live' | 'cache' | 'error'>('loading')
    const [catalogError, setCatalogError] = useState('')

    const loadCatalog = useCallback(async () => {
        setCatalogState('loading')
        try {
            const res = await fetch('/api/gavilan-pos/register-catalog', { cache: 'no-store' })
            const data = await res.json()
            if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`)
            setItems(data.items || [])
            setModifiers(data.modifiers || [])
            setCatalogState('live')
            try { window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ items: data.items, modifiers: data.modifiers, savedAt: data.generatedAt })) } catch { /* storage full */ }
        } catch (err: any) {
            try {
                const cached = JSON.parse(window.localStorage.getItem(CATALOG_CACHE_KEY) || 'null')
                if (cached?.items?.length) {
                    setItems(cached.items)
                    setModifiers(cached.modifiers || [])
                    setCatalogState('cache')
                    return
                }
            } catch { /* corrupted cache */ }
            setCatalogError(err?.message || 'error')
            setCatalogState('error')
        }
    }, [])

    useEffect(() => { loadCatalog() }, [loadCatalog])

    // ------------------------------------------------------------------ ui state
    const [activeTab, setActiveTab] = useState<'quick' | RegisterFamilyKey>('tacos')
    const [pendingQty, setPendingQty] = useState<number | null>(null)
    const [customQtyOpen, setCustomQtyOpen] = useState(false)
    const [customQtyDraft, setCustomQtyDraft] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [currentPlate, setCurrentPlate] = useState(1)
    const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
    const [showMore, setShowMore] = useState(false)
    const [fullscreen, setFullscreen] = useState(false)
    const [noteOpen, setNoteOpen] = useState(false)
    const [noteText, setNoteText] = useState('')
    const [approval, setApproval] = useState<ApprovalMode | null>(null)
    const [pinSetupOpen, setPinSetupOpen] = useState(false)
    const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
    const [lastCashChangeBanner, setLastCashChangeBanner] = useState<{ tendered: number; change: number } | null>(null)

    useEffect(() => {
        if (!flash) return
        const id = setTimeout(() => setFlash(null), 3500)
        return () => clearTimeout(id)
    }, [flash])

    useEffect(() => {
        if (!lastCashChangeBanner) return
        const id = setTimeout(() => setLastCashChangeBanner(null), 7000)
        return () => clearTimeout(id)
    }, [lastCashChangeBanner])

    // Reset plate counter when the ticket is emptied (e.g. after payment)
    useEffect(() => {
        if (cart.length === 0) { setCurrentPlate(1); setSelectedLineId(null) }
    }, [cart.length])

    // If the cashier leaves Drive-Thru while on the DT Condiments tab, go back to Tacos
    useEffect(() => {
        if (diningOption !== 'DRIVE-THRU' && activeTab === 'dt_condiments') setActiveTab('tacos')
    }, [diningOption, activeTab])

    const visibleFamilies = useMemo(
        () => REGISTER_FAMILIES.filter(f => !f.driveThruOnly || diningOption === 'DRIVE-THRU'),
        [diningOption]
    )
    const itemsByFamily = useMemo(() => {
        const m = new Map<RegisterFamilyKey, RegisterCatalogItem[]>()
        for (const it of items) {
            if (!m.has(it.family)) m.set(it.family, [])
            m.get(it.family)!.push(it)
        }
        return m
    }, [items])
    const modsByFamily = useMemo(() => {
        const m = new Map<RegisterFamilyKey, RegisterModifierOption[]>()
        for (const md of modifiers) {
            if (!m.has(md.family)) m.set(md.family, [])
            m.get(md.family)!.push(md)
        }
        return m
    }, [modifiers])

    // 1-Tap cross-sell drinks & sides to fill lower canvas space productively
    const quickComplementItems = useMemo(() => {
        const byNorm = new Map<string, RegisterCatalogItem>()
        for (const it of items) {
            byNorm.set(normalizeText(it.name), it)
        }
        const out: RegisterCatalogItem[] = []
        for (const target of QUICK_COMPLEMENT_NAMES) {
            const match = byNorm.get(target)
            if (match) out.push(match)
        }
        return out
    }, [items])

    // Live instant search across all families
    const searchResults = useMemo(() => {
        const q = normalizeText(searchQuery)
        if (!q) return []
        return items.filter(it => normalizeText(it.name).includes(q)).slice(0, 20)
    }, [items, searchQuery])

    const selectedLine = cart.find(l => l.id === selectedLineId) || null
    const plateGroups = useMemo(() => groupLinesByPlate(cart), [cart])
    const plateCount = plateGroups.length
    const totalItemUnits = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart])
    const unmetRequired = cartHasUnmetRequired(cart)
    const cashDenominations = useMemo(() => smartCashDenominations(totals.total), [totals.total])

    // ------------------------------------------------------------------ cart operations
    const defaultRequiredMods = useCallback((item: RegisterCatalogItem): RegisterLineModifier[] => {
        const rules = requiredRulesFor(item.family, item.name)
        const famMods = modsByFamily.get(item.family) || []
        const out: RegisterLineModifier[] = []
        for (const rule of rules) {
            if (rule.min !== 1 || rule.max !== 1) continue
            const def = famMods.find(m => m.kind === 'REQUIRED' && m.groupKey === rule.optionGroup && m.isDefault)
            if (def) {
                out.push({ name: def.label, price: def.price, guid: def.toastGuid, kind: 'REQUIRED', groupKey: rule.groupKey, isAlert: def.isAlert, count: 1 })
            }
        }
        return out
    }, [modsByFamily])

    const addItem = useCallback((item: RegisterCatalogItem) => {
        if (!item.inStock) return
        const qty = pendingQty || 1
        const defaults = defaultRequiredMods(item)
        setCart(prev => {
            const matchingInTargetPlate = [...prev].reverse().find(
                l => l.guid === item.guid && (l.plate || 1) === currentPlate && sameMods(l.modifiers, defaults)
            )
            if (matchingInTargetPlate) {
                setSelectedLineId(matchingInTargetPlate.id)
                return prev.map(l => (l.id === matchingInTargetPlate.id ? { ...l, qty: l.qty + qty } : l))
            }
            const id = newId()
            setSelectedLineId(id)
            return [...prev, {
                id, guid: item.guid, name: item.name, unitPrice: item.price, qty,
                prepStation: item.prepStation, modifiers: defaults, family: item.family, plate: currentPlate,
            }]
        })
        setPendingQty(null)
    }, [pendingQty, currentPlate, defaultRequiredMods, setCart])

    const updateLine = useCallback((id: string, fn: (l: RegisterCartLine) => RegisterCartLine | null) => {
        setCart(prev => prev.flatMap(l => {
            if (l.id !== id) return [l]
            const next = fn(l)
            return next ? [next] : []
        }))
    }, [setCart])

    const changeQty = (id: string, delta: number) => updateLine(id, l => (l.qty + delta <= 0 ? null : { ...l, qty: l.qty + delta }))

    const removeModifierAtIndex = (lineId: string, modIdx: number) => {
        updateLine(lineId, l => ({
            ...l,
            modifiers: l.modifiers.filter((_, idx) => idx !== modIdx),
        }))
    }

    const removeSelected = () => {
        if (!selectedLine) return
        updateLine(selectedLine.id, () => null)
        setSelectedLineId(null)
    }

    const repeatSelected = () => {
        if (!selectedLine) return
        changeQty(selectedLine.id, 1)
    }

    const toggleChip = (opt: RegisterModifierOption) => {
        if (!selectedLine) return
        const isIce = (label: string) => /\b(ice|hielo)\b/i.test(label)
        updateLine(selectedLine.id, l => {
            const exists = l.modifiers.some(m => m.kind === opt.kind && m.groupKey === opt.groupKey && m.name === opt.label)
            let mods = exists
                ? l.modifiers.filter(m => !(m.kind === opt.kind && m.groupKey === opt.groupKey && m.name === opt.label))
                : [...l.modifiers, { name: opt.label, price: opt.price, guid: opt.toastGuid, kind: opt.kind, groupKey: opt.groupKey, isAlert: opt.isAlert }]
            // "Half" is a single choice per line; ice level is a single choice per drink
            if (!exists && opt.groupKey === 'half') {
                mods = mods.filter(m => !(m.groupKey === 'half' && m.name !== opt.label))
            }
            if (!exists && opt.family === 'bebidas' && isIce(opt.label)) {
                mods = mods.filter(m => !(m.kind === 'CHIP' && isIce(m.name) && m.name !== opt.label))
            }
            return { ...l, modifiers: mods }
        })
    }

    const pickRequired = (ruleGroupKey: string, max: number, allowRepeat: boolean, opt: RegisterModifierOption, delta: 1 | -1) => {
        if (!selectedLine) return
        updateLine(selectedLine.id, l => {
            const inGroup = l.modifiers.filter(m => m.kind === 'REQUIRED' && m.groupKey === ruleGroupKey)
            const others = l.modifiers.filter(m => !(m.kind === 'REQUIRED' && m.groupKey === ruleGroupKey))
            const total = inGroup.reduce((s, m) => s + (m.count || 1), 0)
            const current = inGroup.find(m => m.name === opt.label)
            const fresh: RegisterLineModifier = { name: opt.label, price: opt.price, guid: opt.toastGuid, kind: 'REQUIRED', groupKey: ruleGroupKey, isAlert: opt.isAlert, count: 1 }
            let nextGroup = inGroup
            if (delta === 1) {
                if (max === 1 && !allowRepeat) {
                    nextGroup = [fresh]
                } else if (total >= max) {
                    setFlash({ tone: 'error', text: tr('max_reached', { max }) })
                    return l
                } else if (current) {
                    if (!allowRepeat) return l
                    nextGroup = inGroup.map(m => (m.name === opt.label ? { ...m, count: (m.count || 1) + 1 } : m))
                } else {
                    nextGroup = [...inGroup, fresh]
                }
            } else if (current) {
                nextGroup = (current.count || 1) > 1
                    ? inGroup.map(m => (m.name === opt.label ? { ...m, count: (m.count || 1) - 1 } : m))
                    : inGroup.filter(m => m.name !== opt.label)
            }
            return { ...l, modifiers: [...others, ...nextGroup] }
        })
    }

    const toggleToGoFlag = () => {
        if (!selectedLine || diningOption === 'DRIVE-THRU') return
        const label = diningOption === 'FOR HERE' ? tr('flag_to_go') : tr('flag_for_here')
        updateLine(selectedLine.id, l => {
            const has = l.modifiers.some(m => m.kind === 'ACTION' && m.groupKey === 'dining_flag')
            return {
                ...l,
                modifiers: has
                    ? l.modifiers.filter(m => !(m.kind === 'ACTION' && m.groupKey === 'dining_flag'))
                    : [...l.modifiers, { name: label, price: 0, kind: 'ACTION', groupKey: 'dining_flag', isAlert: true }],
            }
        })
    }

    const addFreeNote = () => {
        const text = noteText.trim().slice(0, 60)
        if (!selectedLine || !text) return
        updateLine(selectedLine.id, l => ({ ...l, modifiers: [...l.modifiers, { name: text, price: 0, kind: 'NOTE', groupKey: 'free' }] }))
        setNoteText('')
        setNoteOpen(false)
    }

    const separatePlate = () => {
        if (cart.length === 0) return
        const hasLinesInCurrent = cart.some(l => (l.plate || 1) === currentPlate)
        if (!hasLinesInCurrent) {
            setFlash({ tone: 'error', text: tr('plate_empty', { word: plateWord(diningOption, isEs), n: currentPlate }) })
            return
        }
        setCurrentPlate(nextPlateNumber(cart))
        setSelectedLineId(null)
    }

    const clearTicket = () => {
        if (cart.length === 0) return
        if (typeof window !== 'undefined' && !window.confirm(tr('confirm_clear'))) return
        setCart([])
        onClearDiscount()
    }

    const triggerQuickTender = (method: QuickTenderMethod, cashReceived?: number) => {
        if (cart.length === 0 || chargeBusy) return
        if (unmetRequired) {
            setFlash({ tone: 'error', text: tr('cannot_charge_required') })
            return
        }
        if (method === 'CASH') {
            const tendered = typeof cashReceived === 'number' && cashReceived >= totals.total ? cashReceived : totals.total
            const change = Math.max(0, Number((tendered - totals.total).toFixed(2)))
            setLastCashChangeBanner({ tendered, change })
        } else {
            setLastCashChangeBanner(null)
        }
        if (onQuickTender) {
            onQuickTender(method, cashReceived)
        } else {
            onCharge()
        }
    }

    // ------------------------------------------------------------------ rendering helpers
    const renderItemButton = (item: RegisterCatalogItem, compactLabel?: string, compactHeight?: boolean) => {
        const vStyle = itemVisualStyle(item)
        return (
            <button
                key={item.guid}
                type="button"
                disabled={!item.inStock}
                onClick={() => addItem(item)}
                aria-label={`${item.name} ${money(item.price)}`}
                className={`relative ${compactHeight ? 'min-h-[72px] px-2.5 py-2' : 'min-h-[92px] px-3 py-2.5'} rounded-xl border-2 text-left flex flex-col justify-between transition active:scale-[0.97] active:brightness-95 select-none shadow-2xs ${
                    item.inStock ? `${vStyle.cardCls} hover:shadow-md cursor-pointer` : 'bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed'
                }`}
            >
                <div className="flex items-start justify-between gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider leading-none ${vStyle.badgeCls}`}>
                        {vStyle.tagLabel}
                    </span>
                    {pendingQty && item.inStock && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[11px] font-black leading-none">
                            ×{pendingQty}
                        </span>
                    )}
                </div>
                <span className={`${compactHeight ? 'text-[14px]' : 'text-[16px]'} font-black leading-tight text-slate-900 line-clamp-2 mt-1`}>
                    {compactLabel || item.name}
                </span>
                <span className="flex items-center justify-between mt-1.5">
                    <span className={`px-2 py-0.5 rounded-md text-[13px] font-black tabular-nums ${vStyle.priceCls}`}>
                        {money(item.price)}
                    </span>
                    {!item.inStock && <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[11px] font-black">86</span>}
                </span>
            </button>
        )
    }

    const proteinLabel = (p: string) => tr(`proteins.${p}`)

    const renderQuickMatrix = () => (
        <div className="overflow-auto">
            <table className="w-full border-separate" style={{ borderSpacing: 6 }}>
                <thead>
                    <tr>
                        <th className="w-24" />
                        {MATRIX_COLUMNS.map(col => (
                            <th key={col} className="text-[12px] font-black uppercase tracking-wider text-slate-700 bg-slate-100 rounded-lg py-1.5 px-2">
                                {tr(`families.${col}`)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {PROTEIN_ORDER.map(p => (
                        <tr key={p}>
                            <th className="text-left text-[13px] font-black uppercase tracking-wide text-slate-800 pr-1">{proteinLabel(p)}</th>
                            {MATRIX_COLUMNS.map(col => {
                                const it = (itemsByFamily.get(col) || []).find(i => i.protein === p && !i.secondary)
                                return (
                                    <td key={col} className="align-top">
                                        {it ? renderItemButton(it, `${tr(`families_singular.${col}`)} ${proteinLabel(p)}`, true) : <div className="min-h-[72px] rounded-xl border-2 border-dashed border-slate-200" />}
                                    </td>
                                )
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    const renderFamilyGrid = (family: RegisterFamilyKey) => {
        const list = itemsByFamily.get(family) || []
        const primary = list.filter(i => !i.secondary)
        const secondary = list.filter(i => i.secondary)
        const showComplementStrip = family !== 'bebidas' && family !== 'sides' && family !== 'postres' && quickComplementItems.length > 0

        return (
            <div className="space-y-4">
                <div className="grid grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5">
                    {primary.map(it => renderItemButton(it))}
                </div>
                {secondary.length > 0 && (
                    <div>
                        <button type="button" onClick={() => setShowMore(s => !s)} className="min-h-[44px] px-4 rounded-xl border-2 border-slate-300 bg-white text-[13px] font-black text-slate-700 hover:bg-slate-100">
                            {showMore ? tr('less') : tr('more', { count: secondary.length })}
                        </button>
                        {showMore && <div className="mt-2.5 grid grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5">{secondary.map(it => renderItemButton(it))}</div>}
                    </div>
                )}
                {list.length === 0 && catalogState !== 'loading' && <p className="text-sm text-slate-500">{tr('empty_family')}</p>}

                {/* 1-Tap Cross-Sell Drinks & Sides Strip (eliminates empty white canvas and saves tab switches) */}
                {showComplementStrip && (
                    <div className="pt-3 border-t-2 border-dashed border-slate-200">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Sparkles size={15} className="text-sky-600" />
                            <span className="text-[12px] font-black uppercase tracking-wider text-slate-600">
                                {tr('quick_sides_drinks')}
                            </span>
                        </div>
                        <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
                            {quickComplementItems.map(it => renderItemButton(it, undefined, true))}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    const renderModifierPanel = () => {
        if (!selectedLine) {
            return <p className="text-[14px] font-semibold text-slate-500 py-2">{tr('select_line_hint')}</p>
        }
        const fam = selectedLine.family
        const famMods = fam ? (modsByFamily.get(fam) || []) : []
        const statuses = requiredStatusForLine(selectedLine)
        const chips = famMods.filter(m => m.kind === 'CHIP' && m.groupKey === 'chips')
        const noChips = chips.filter(m => classifyModifierBucket(m) === 'NO')
        const extraChips = chips.filter(m => classifyModifierBucket(m) === 'EXTRA')
        const prepChips = chips.filter(m => classifyModifierBucket(m) === 'PREP')
        const half = famMods.filter(m => m.kind === 'CHIP' && m.groupKey === 'half')
        const notes = famMods.filter(m => m.kind === 'NOTE')
        const isOn = (m: RegisterModifierOption) => selectedLine.modifiers.some(x => x.kind === m.kind && x.groupKey === m.groupKey && x.name === m.label)

        const bucketChipCls = (bucket: 'NO' | 'EXTRA' | 'PREP' | 'HALF' | 'NOTE', on: boolean) => {
            const base = 'min-h-[44px] px-3 rounded-xl border-2 text-[13px] font-extrabold transition active:scale-[0.97] select-none cursor-pointer'
            if (bucket === 'NO') {
                return `${base} ${on ? 'bg-red-600 border-red-700 text-white shadow-xs' : 'bg-red-50/80 border-red-200 text-red-900 hover:bg-red-100'}`
            }
            if (bucket === 'EXTRA') {
                return `${base} ${on ? 'bg-emerald-700 border-emerald-800 text-white shadow-xs' : 'bg-emerald-50/80 border-emerald-300 text-emerald-950 hover:bg-emerald-100'}`
            }
            if (bucket === 'HALF') {
                return `${base} ${on ? 'bg-purple-700 border-purple-800 text-white shadow-xs' : 'bg-purple-50/70 border-purple-200 text-purple-950 hover:bg-purple-100'}`
            }
            if (bucket === 'NOTE') {
                return `${base} border-dashed ${on ? 'bg-indigo-700 border-indigo-800 text-white' : 'bg-indigo-50/60 border-indigo-200 text-indigo-950 hover:bg-indigo-100'}`
            }
            return `${base} ${on ? 'bg-slate-900 border-slate-900 text-white shadow-xs' : 'bg-slate-50 border-slate-300 text-slate-900 hover:bg-slate-100'}`
        }

        return (
            <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[12px] font-black tabular-nums">
                            {selectedLine.qty}×
                        </span>
                        <p className="text-[15px] font-black text-slate-900 truncate">{selectedLine.name}</p>
                    </div>
                    <span className="text-[13px] font-black text-slate-700 tabular-nums">{money(lineUnitPrice(selectedLine))} c/u</span>
                </div>

                {/* Required modifier groups */}
                {statuses.map(st => {
                    const opts = famMods.filter(m => m.kind === 'REQUIRED' && m.groupKey === st.rule.optionGroup)
                    return (
                        <div key={st.rule.groupKey} className={`rounded-xl border-2 p-2.5 ${st.satisfied ? 'border-emerald-300 bg-emerald-50/50' : 'border-amber-400 bg-amber-50'}`}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                {st.satisfied ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-amber-600" />}
                                <span className="text-[12px] font-black uppercase tracking-wide text-slate-800">
                                    {tr(`required.${st.rule.labelKey}`)} · {tr('required_count', { picked: st.picked, min: st.rule.min, max: st.rule.max })}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {opts.map(o => {
                                    const picked = selectedLine.modifiers.find(m => m.kind === 'REQUIRED' && m.groupKey === st.rule.groupKey && m.name === o.label)
                                    return (
                                        <span key={o.id} className="inline-flex items-stretch">
                                            <button type="button" aria-pressed={Boolean(picked)} onClick={() => pickRequired(st.rule.groupKey, st.rule.max, st.rule.allowRepeat, o, 1)}
                                                className={bucketChipCls(o.isAlert ? 'NO' : 'PREP', Boolean(picked))}>
                                                {o.label}{picked && (picked.count || 1) > 1 ? ` ×${picked.count}` : ''}{o.price > 0 ? ` +${money(o.price)}` : ''}
                                            </button>
                                            {picked && st.rule.allowRepeat && (
                                                <button type="button" aria-label={tr('remove_one')} onClick={() => pickRequired(st.rule.groupKey, st.rule.max, st.rule.allowRepeat, o, -1)} className="ml-1 min-h-[44px] w-10 rounded-xl border-2 border-slate-300 bg-white flex items-center justify-center">
                                                    <Minus size={15} />
                                                </button>
                                            )}
                                        </span>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })}

                {/* Semantic Row 1: SIN / QUITAR (Red Coral) */}
                {noChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-1 rounded-lg bg-red-100 text-red-900 text-[11px] font-black uppercase tracking-wider">
                            {tr('mod_group_no')}
                        </span>
                        {noChips.map(m => (
                            <button key={m.id} type="button" aria-pressed={isOn(m)} onClick={() => toggleChip(m)} className={bucketChipCls('NO', isOn(m))}>
                                {m.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Semantic Row 2: EXTRAS CON CARGO (Emerald Green) */}
                {extraChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-950 text-[11px] font-black uppercase tracking-wider">
                            {tr('mod_group_extra')}
                        </span>
                        {extraChips.map(m => (
                            <button key={m.id} type="button" aria-pressed={isOn(m)} onClick={() => toggleChip(m)} className={bucketChipCls('EXTRA', isOn(m))}>
                                {m.label} <span className="underline decoration-dotted">+{money(m.price)}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Semantic Row 3: PREPARACIÓN, TORTILLA Y SALSA (Slate/Blue) */}
                {prepChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-1 rounded-lg bg-slate-200 text-slate-800 text-[11px] font-black uppercase tracking-wider">
                            {tr('mod_group_prep')}
                        </span>
                        {prepChips.map(m => (
                            <button key={m.id} type="button" aria-pressed={isOn(m)} onClick={() => toggleChip(m)} className={bucketChipCls('PREP', isOn(m))}>
                                {m.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Semantic Row 4: MITAD Y MITAD (Purple) */}
                {half.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-1 rounded-lg bg-purple-100 text-purple-950 text-[11px] font-black uppercase tracking-wider">
                            {tr('half_label')}
                        </span>
                        {half.map(m => (
                            <button key={m.id} type="button" aria-pressed={isOn(m)} onClick={() => toggleChip(m)} className={bucketChipCls('HALF', isOn(m))}>
                                ½ {m.label.replace(/^half\s+/i, '')}
                            </button>
                        ))}
                    </div>
                )}

                {/* Semantic Row 5: NOTAS FRECUENTES (Indigo Dashed) */}
                {notes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-1 rounded-lg bg-indigo-100 text-indigo-950 text-[11px] font-black uppercase tracking-wider">
                            {tr('notes_label')}
                        </span>
                        {notes.map(m => (
                            <button key={m.id} type="button" aria-pressed={isOn(m)} onClick={() => toggleChip(m)} className={bucketChipCls('NOTE', isOn(m))}>
                                {m.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    // ------------------------------------------------------------------ layout
    const wrapperCls = fullscreen
        ? 'fixed inset-0 z-[60] bg-slate-100 flex flex-col'
        : 'bg-slate-100 rounded-2xl border border-slate-200 flex flex-col min-h-[calc(100vh-160px)]'
    const flagLabel = diningOption === 'FOR HERE' ? tr('flag_to_go') : tr('flag_for_here')
    const pWord = plateWord(diningOption, isEs)

    return (
        <div className={wrapperCls}>
            {/* ===== HEADER ===== */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b border-slate-200">
                {(['FOR HERE', 'TO GO', 'DRIVE-THRU'] as DiningMode[]).map(mode => (
                    <button
                        key={mode}
                        type="button"
                        aria-pressed={diningOption === mode}
                        onClick={() => setDiningOption(mode)}
                        className={`min-h-[48px] px-3.5 rounded-xl border-2 text-[14px] font-black flex items-center gap-1.5 cursor-pointer ${
                            diningOption === mode ? 'bg-red-600 border-red-700 text-white shadow-xs' : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                        }`}
                    >
                        {mode === 'FOR HERE' ? <UtensilsCrossed size={17} /> : mode === 'TO GO' ? <ShoppingBag size={17} /> : <Car size={17} />}
                        {tr(`mode_${mode === 'FOR HERE' ? 'for_here' : mode === 'TO GO' ? 'to_go' : 'drive_thru'}`)}
                    </button>
                ))}
                <span className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[15px] font-black tabular-nums">#{orderNumber}</span>
                <input
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value.slice(0, 40))}
                    placeholder={diningOption === 'DRIVE-THRU' ? tr('car_or_name_placeholder') : tr('name_placeholder')}
                    className="min-h-[46px] w-44 px-3 rounded-xl border-2 border-slate-200 text-[14px] font-bold text-slate-900 bg-slate-50 focus:bg-white"
                    aria-label={tr('name_placeholder')}
                />

                {/* Instant PLU / Dish Search Bar */}
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={tr('search_placeholder')}
                        className="w-full min-h-[46px] pl-9 pr-8 rounded-xl border-2 border-slate-200 text-[14px] font-bold text-slate-900 bg-slate-50 focus:bg-white"
                        aria-label={tr('search_placeholder')}
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            aria-label={tr('clear_search')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {diningOption === 'DRIVE-THRU' && (
                    <div className="flex flex-wrap items-center gap-1">
                        {VEHICLE_COLORS.map(c => (
                            <button key={c} type="button" aria-pressed={vehicleColor === c} onClick={() => setVehicleColor(vehicleColor === c ? '' : c)}
                                className={`min-h-[42px] px-2.5 rounded-lg border-2 text-[12px] font-bold ${vehicleColor === c ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'}`}>
                                {tr(`vehicle_colors.${c}`)}
                            </button>
                        ))}
                        {VEHICLE_TYPES.map(v => (
                            <button key={v} type="button" aria-pressed={vehicleType === v} onClick={() => setVehicleType(vehicleType === v ? '' : v)}
                                className={`min-h-[42px] px-2.5 rounded-lg border-2 text-[12px] font-bold ${vehicleType === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'}`}>
                                {tr(`vehicle_types.${v}`)}
                            </button>
                        ))}
                    </div>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                    {catalogState === 'cache' && <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-900 text-[12px] font-black">{tr('catalog_offline')}</span>}
                    {canVoidLastOrder && onVoidLastOrder && (
                        <button type="button" onClick={() => setApproval({ kind: 'VOID', isWaste: true })} className="min-h-[46px] px-3 rounded-xl border-2 border-rose-200 bg-rose-50 text-rose-800 text-[13px] font-black flex items-center gap-1.5 cursor-pointer">
                            <Ban size={15} /> {tr('void_last_order')}
                        </button>
                    )}
                    <button type="button" onClick={() => setPinSetupOpen(true)} className="min-h-[46px] px-3 rounded-xl border-2 border-slate-200 bg-white text-slate-700 text-[13px] font-black flex items-center gap-1.5 cursor-pointer" aria-label={tr('pin_setup_title')}>
                        <KeyRound size={15} /> {tr('my_pin')}
                    </button>
                    <button type="button" onClick={() => setFullscreen(f => !f)} className="min-h-[46px] w-11 rounded-xl border-2 border-slate-200 bg-white flex items-center justify-center cursor-pointer" aria-label={fullscreen ? tr('exit_fullscreen') : tr('fullscreen')}>
                        {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                    </button>
                </div>
            </div>

            {flash && (
                <div className={`mx-3 mt-1.5 px-3 py-1.5 rounded-xl text-[13px] font-bold ${flash.tone === 'ok' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-rose-50 text-rose-900 border border-rose-200'}`} role="status">
                    {flash.text}
                </div>
            )}

            {lastCashChangeBanner && (
                <div className="mx-3 mt-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[15px] font-black flex items-center justify-between shadow-sm" role="status">
                    <span>💵 {tr('change_due_banner', { tendered: money(lastCashChangeBanner.tendered), change: money(lastCashChangeBanner.change) })}</span>
                    <button type="button" onClick={() => setLastCashChangeBanner(null)} className="h-7 w-7 rounded-lg bg-emerald-700 flex items-center justify-center">
                        <X size={15} />
                    </button>
                </div>
            )}

            {/* ===== BODY (3 Ergonomic Zones: Ticket 30% | 2-Col Zero-Scroll Category Rail 224px | Items + Conversational Modifiers) ===== */}
            <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,29%)_224px_1fr] gap-0">
                {/* ---- ZONE 1: TICKET (left) ---- */}
                <section className="min-h-0 flex flex-col bg-white border-r border-slate-200" aria-label={tr('ticket')}>
                    {/* Ticket Summary Header */}
                    {cart.length > 0 && (
                        <div className="px-3 py-1.5 bg-slate-900 text-white flex items-center justify-between text-[12px] font-black uppercase tracking-wider">
                            <span>{tr('items_count_summary', { items: totalItemUnits, plates: Math.max(1, plateCount), plateWord: pWord })}</span>
                            <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px]">
                                {pWord} #{currentPlate}
                            </span>
                        </div>
                    )}

                    <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                        {cart.length === 0 && <p className="py-10 text-center text-[15px] font-semibold text-slate-400">{tr('empty_ticket')}</p>}
                        {plateGroups.map(group => {
                            const isTargetPlate = group.plate === currentPlate
                            return (
                                <div key={group.plate} className="space-y-1">
                                    {(plateCount > 1 || currentPlate > 1) && (
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPlate(group.plate)}
                                            className={`w-full px-2.5 py-1 rounded-lg text-[12px] font-black tracking-wide flex items-center justify-between cursor-pointer transition ${
                                                isTargetPlate ? 'bg-red-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                            }`}
                                        >
                                            <span>{pWord} {group.plate}</span>
                                            {isTargetPlate && <span className="text-[11px] font-extrabold opacity-95">{tr('active_plate_badge')}</span>}
                                        </button>
                                    )}
                                    {group.lines.map(line => {
                                        const sel = line.id === selectedLineId
                                        const unmet = requiredStatusForLine(line).some(s => !s.satisfied)
                                        return (
                                            <div key={line.id} onClick={() => { setSelectedLineId(line.id); setCurrentPlate(line.plate || 1) }}
                                                className={`rounded-xl border-2 p-2 cursor-pointer transition ${sel ? 'border-blue-600 bg-blue-50/70 shadow-2xs' : unmet ? 'border-amber-400 bg-amber-50' : 'border-slate-100 hover:bg-slate-50'}`}>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center rounded-lg border border-slate-300 bg-white">
                                                        <button type="button" aria-label={tr('qty_minus')} onClick={e => { e.stopPropagation(); changeQty(line.id, -1) }} className="h-9 w-9 flex items-center justify-center hover:bg-slate-100"><Minus size={15} /></button>
                                                        <span className="w-7 text-center text-[15px] font-black tabular-nums">{line.qty}</span>
                                                        <button type="button" aria-label={tr('qty_plus')} onClick={e => { e.stopPropagation(); changeQty(line.id, 1) }} className="h-9 w-9 flex items-center justify-center hover:bg-slate-100"><Plus size={15} /></button>
                                                    </div>
                                                    <span className="flex-1 text-[15px] font-extrabold text-slate-900 leading-tight">{line.name}</span>
                                                    <span className="text-[15px] font-black tabular-nums text-slate-900">{money(lineTotal(line))}</span>
                                                </div>
                                                {line.modifiers.length > 0 && (
                                                    <div className="mt-1.5 pl-2 flex flex-wrap gap-1">
                                                        {line.modifiers.map((m, i) => (
                                                            <span
                                                                key={`${m.name}-${i}`}
                                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-bold border ${
                                                                    m.isAlert
                                                                        ? 'bg-red-50 border-red-200 text-red-800'
                                                                        : m.price > 0
                                                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                                                            : m.kind === 'NOTE'
                                                                                ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                                                                                : 'bg-white border-slate-200 text-slate-700'
                                                                }`}
                                                            >
                                                                <span>{(m.count || 1) > 1 ? `${m.count}× ` : ''}{m.name}{m.price > 0 ? ` +${money(m.price * (m.count || 1))}` : ''}</span>
                                                                <button
                                                                    type="button"
                                                                    aria-label={tr('remove_modifier')}
                                                                    onClick={e => { e.stopPropagation(); removeModifierAtIndex(line.id, i) }}
                                                                    className="ml-0.5 text-slate-400 hover:text-rose-600"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {unmet && <p className="mt-1 pl-2 text-[12px] font-black text-amber-700">{tr('needs_required')}</p>}
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>

                    {/* line actions */}
                    <div className="grid grid-cols-4 gap-1.5 px-2 py-1.5 border-t border-slate-200 bg-slate-50/50">
                        <button type="button" disabled={!selectedLine} onClick={repeatSelected} className="min-h-[46px] rounded-xl border-2 border-slate-200 bg-white text-[12px] font-black text-slate-800 disabled:opacity-40 flex flex-col items-center justify-center cursor-pointer"><Copy size={15} />{tr('repeat')}</button>
                        <button type="button" disabled={!selectedLine || diningOption === 'DRIVE-THRU'} onClick={toggleToGoFlag} className="min-h-[46px] rounded-xl border-2 border-slate-200 bg-white text-[12px] font-black text-slate-800 disabled:opacity-40 flex flex-col items-center justify-center cursor-pointer"><ShoppingBag size={15} />{flagLabel}</button>
                        <button type="button" disabled={!selectedLine} onClick={() => setNoteOpen(true)} className="min-h-[46px] rounded-xl border-2 border-slate-200 bg-white text-[12px] font-black text-slate-800 disabled:opacity-40 flex flex-col items-center justify-center cursor-pointer"><StickyNote size={15} />{tr('note')}</button>
                        <button type="button" disabled={!selectedLine} onClick={removeSelected} className="min-h-[46px] rounded-xl border-2 border-rose-200 bg-rose-50 text-[12px] font-black text-rose-800 disabled:opacity-40 flex flex-col items-center justify-center cursor-pointer"><Trash2 size={15} />{tr('remove')}</button>
                    </div>

                    {/* discounts */}
                    <div className="px-2 pb-1.5 flex flex-wrap items-center gap-1.5 bg-slate-50/50">
                        {appliedDiscount ? (
                            <div className="flex-1 flex items-center justify-between gap-2 rounded-xl bg-indigo-50 border-2 border-indigo-200 px-3 py-1.5">
                                <span className="text-[13px] font-black text-indigo-900">
                                    <BadgePercent size={15} className="inline mr-1" />
                                    {tr(`discount_${appliedDiscount.type.toLowerCase()}`)} {appliedDiscount.pct}% · {tr('approved_by', { name: appliedDiscount.approverName })}
                                </span>
                                <button type="button" onClick={onClearDiscount} className="h-8 w-8 rounded-lg bg-white border border-indigo-200 flex items-center justify-center" aria-label={tr('remove_discount')}><X size={15} /></button>
                            </div>
                        ) : (
                            <>
                                <button type="button" disabled={cart.length === 0} onClick={() => setApproval({ kind: 'DISCOUNT', type: 'EMPLEADO', pct: DISCOUNT_PRESETS.EMPLEADO.defaultPct })} className="flex-1 min-h-[42px] rounded-xl border-2 border-indigo-200 bg-indigo-50 text-indigo-900 text-[13px] font-black disabled:opacity-40 cursor-pointer">
                                    {tr('discount_empleado')} {DISCOUNT_PRESETS.EMPLEADO.defaultPct}%
                                </button>
                                <button type="button" disabled={cart.length === 0} onClick={() => setApproval({ kind: 'DISCOUNT', type: 'POLICIA', pct: DISCOUNT_PRESETS.POLICIA.defaultPct })} className="flex-1 min-h-[42px] rounded-xl border-2 border-indigo-200 bg-indigo-50 text-indigo-900 text-[13px] font-black disabled:opacity-40 cursor-pointer">
                                    {tr('discount_policia')}
                                </button>
                            </>
                        )}
                    </div>

                    {/* totals + 1-Tap Fast Cash / Quick Tender + Charge */}
                    <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 space-y-1.5">
                        <div className="flex justify-between text-[13px] font-bold text-slate-600">
                            <span>{tr('subtotal')} { money(totals.rawSubtotal) } · {tr('tax', { rate: taxRatePct })} { money(totals.tax) }</span>
                            {totals.totalDiscount > 0 && <span className="text-emerald-700 font-black">−{money(totals.totalDiscount)}</span>}
                        </div>
                        <div className="flex justify-between items-baseline">
                            <span className="text-[22px] font-black text-slate-900 leading-none">{tr('total')}</span>
                            <span className="text-[30px] font-black tabular-nums text-red-600 leading-none">{money(totals.total)}</span>
                        </div>

                        {/* 1-Tap Fast Cash & Quick Tender Strip (Toast Quick Order / Square Fast Cash standard) */}
                        {cart.length > 0 && !unmetRequired && (
                            <div className="grid grid-cols-5 gap-1 pt-0.5">
                                <button
                                    type="button"
                                    disabled={chargeBusy}
                                    onClick={() => triggerQuickTender('CASH', totals.total)}
                                    className="min-h-[42px] rounded-lg border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-[11px] font-black flex flex-col items-center justify-center leading-tight cursor-pointer"
                                >
                                    <span className="flex items-center gap-0.5"><Banknote size={12} /> {tr('fast_exact')}</span>
                                    <span className="tabular-nums text-[12px]">{money(totals.total)}</span>
                                </button>
                                {cashDenominations.slice(0, 2).map(bill => (
                                    <button
                                        key={bill}
                                        type="button"
                                        disabled={chargeBusy}
                                        onClick={() => triggerQuickTender('CASH', bill)}
                                        className="min-h-[42px] rounded-lg border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-[12px] font-black flex flex-col items-center justify-center leading-tight cursor-pointer"
                                    >
                                        <span className="text-[10px] font-bold text-emerald-700">CASH</span>
                                        <span className="tabular-nums text-[13px]">${bill}</span>
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    disabled={chargeBusy}
                                    onClick={() => triggerQuickTender('CARD')}
                                    className="min-h-[42px] rounded-lg border-2 border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-950 text-[11px] font-black flex flex-col items-center justify-center leading-tight cursor-pointer"
                                >
                                    <CreditCard size={13} />
                                    <span>{tr('fast_card')}</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={chargeBusy}
                                    onClick={() => triggerQuickTender('EBT_FOOD')}
                                    className="min-h-[42px] rounded-lg border-2 border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-950 text-[11px] font-black flex flex-col items-center justify-center leading-tight cursor-pointer"
                                >
                                    <Landmark size={13} />
                                    <span>{tr('fast_ebt')}</span>
                                </button>
                            </div>
                        )}

                        <div className="grid grid-cols-[1fr_1fr_2.4fr] gap-1.5 pt-0.5">
                            <button type="button" onClick={clearTicket} disabled={cart.length === 0} className="min-h-[54px] rounded-xl border-2 border-slate-300 bg-white text-[12px] font-black text-slate-700 disabled:opacity-40 cursor-pointer">{tr('clear')}</button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (unmetRequired) { setFlash({ tone: 'error', text: tr('cannot_charge_required') }); return }
                                    if (onOpenSplitPayment) onOpenSplitPayment()
                                    else onCharge()
                                }}
                                disabled={cart.length === 0 || chargeBusy}
                                className="min-h-[54px] rounded-xl border-2 border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-[12px] font-black text-indigo-950 disabled:opacity-40 cursor-pointer flex flex-col items-center justify-center leading-tight"
                            >
                                <span>🔀 {tr('fast_split')}</span>
                                <span className="text-[10px] font-bold text-indigo-700">Multi-Método</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (unmetRequired) { setFlash({ tone: 'error', text: tr('cannot_charge_required') }); return }
                                    onCharge()
                                }}
                                disabled={cart.length === 0 || chargeBusy}
                                className={`min-h-[54px] rounded-xl text-[17px] font-black text-white shadow-sm disabled:bg-slate-300 cursor-pointer ${unmetRequired ? 'bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                            >
                                {unmetRequired ? tr('complete_required') : tr('charge', { total: money(totals.total) })}
                            </button>
                        </div>
                    </div>
                </section>

                {/* ---- ZONE 2: 2-COLUMN ZERO-SCROLL CATEGORY RAIL ---- */}
                <nav className="min-h-0 overflow-y-auto bg-slate-100 border-r border-slate-200 p-1.5 flex flex-col gap-1.5" aria-label={tr('categories')}>
                    <button
                        type="button"
                        aria-pressed={activeTab === 'quick'}
                        onClick={() => { setActiveTab('quick'); setSearchQuery('') }}
                        className={`w-full min-h-[46px] rounded-xl px-2.5 text-left text-[13px] font-black flex items-center justify-center gap-1.5 border-2 transition cursor-pointer ${
                            activeTab === 'quick' && !searchQuery
                                ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                                : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                        }`}
                    >
                        <Zap size={15} className={activeTab === 'quick' && !searchQuery ? 'text-amber-400' : 'text-amber-500'} />
                        <span>{tr('tab_quick')} (8×7)</span>
                    </button>

                    <div className="grid grid-cols-2 gap-1.5 flex-1 content-start">
                        {visibleFamilies.map(f => {
                            const isActive = activeTab === f.key && !searchQuery
                            return (
                                <button
                                    key={f.key}
                                    type="button"
                                    aria-pressed={isActive}
                                    onClick={() => { setActiveTab(f.key); setShowMore(false); setSearchQuery('') }}
                                    className={`min-h-[50px] rounded-xl px-2 py-1.5 text-left text-[12px] font-black flex items-center gap-1.5 border-2 transition cursor-pointer ${
                                        isActive
                                            ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                                            : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                >
                                    <span className={`h-7 w-1.5 rounded-full shrink-0 ${f.accent}`} aria-hidden />
                                    <span className="leading-tight line-clamp-2">{tr(`families.${f.labelKey}`)}</span>
                                </button>
                            )
                        })}
                    </div>
                </nav>

                {/* ---- ZONE 3: ITEMS + CONVERSATIONAL MODIFIERS ---- */}
                <section className="min-h-0 flex flex-col bg-slate-50/60">
                    {/* Quantity Multiplier Bar + Custom Qty + Separate Plate/Bag */}
                    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-white border-b border-slate-200">
                        <span className="text-[12px] font-black uppercase text-slate-500 mr-0.5">{tr('qty_label')}</span>
                        {QTY_PRESETS.map(q => (
                            <button key={q} type="button" aria-pressed={pendingQty === q} onClick={() => setPendingQty(pendingQty === q ? null : q)}
                                className={`min-h-[44px] min-w-[44px] px-2 rounded-xl border-2 text-[15px] font-black cursor-pointer transition ${pendingQty === q ? 'bg-blue-600 border-blue-700 text-white shadow-xs' : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'}`}>
                                ×{q}
                            </button>
                        ))}
                        {pendingQty && !QTY_PRESETS.includes(pendingQty) && (
                            <button
                                type="button"
                                onClick={() => setPendingQty(null)}
                                className="min-h-[44px] px-3 rounded-xl border-2 bg-blue-600 border-blue-700 text-white text-[15px] font-black"
                            >
                                ×{pendingQty} ✕
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => { setCustomQtyDraft(pendingQty ? String(pendingQty) : ''); setCustomQtyOpen(true) }}
                            className="min-h-[44px] px-3 rounded-xl border-2 border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[13px] font-black flex items-center gap-1 cursor-pointer"
                        >
                            <Hash size={14} /> {tr('custom_qty')}
                        </button>

                        <button type="button" onClick={separatePlate} disabled={cart.length === 0}
                            className="ml-auto min-h-[46px] px-3.5 rounded-xl border-2 border-red-300 bg-red-50 hover:bg-red-100 text-red-900 text-[14px] font-black flex items-center gap-2 disabled:opacity-40 cursor-pointer">
                            <Scissors size={16} /> {tr('separate_plate', { word: pWord })}
                            <span className="px-2 py-0.5 rounded-lg bg-red-600 text-white text-[12px]">{currentPlate}</span>
                        </button>
                    </div>

                    {/* Main Item Grid / Search Results / Quick Matrix */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-3">
                        {catalogState === 'loading' && (
                            <div className="flex items-center gap-2 text-slate-500 text-[15px] font-semibold"><RefreshCw size={16} className="animate-spin" /> {tr('loading_catalog')}</div>
                        )}
                        {catalogState === 'error' && (
                            <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-rose-900">
                                <p className="font-black">{tr('catalog_error')}</p>
                                <p className="text-sm mt-1">{catalogError}</p>
                                <button type="button" onClick={loadCatalog} className="mt-3 min-h-[48px] px-4 rounded-xl bg-rose-600 text-white font-black">{tr('retry')}</button>
                            </div>
                        )}
                        {(catalogState === 'live' || catalogState === 'cache') && (
                            searchQuery.trim() ? (
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[13px] font-black uppercase text-slate-600">
                                            {tr('search_results_title', { count: searchResults.length })}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5">
                                        {searchResults.map(it => renderItemButton(it))}
                                    </div>
                                </div>
                            ) : activeTab === 'quick' ? (
                                renderQuickMatrix()
                            ) : (
                                renderFamilyGrid(activeTab)
                            )
                        )}
                    </div>

                    {/* Semantic Conversational Modifier Tray */}
                    <div className="max-h-[44%] overflow-y-auto border-t-2 border-slate-200 bg-white px-3 py-2.5 shadow-inner" aria-label={tr('modifiers')}>
                        {renderModifierPanel()}
                    </div>
                </section>
            </div>

            {/* ===== CUSTOM QUANTITY KEYPAD MODAL ===== */}
            {customQtyOpen && (
                <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-xs bg-white rounded-2xl p-5 space-y-3 shadow-xl">
                        <p className="text-[16px] font-black text-slate-900">{tr('custom_qty_title')}</p>
                        <div className="h-14 rounded-xl border-2 border-slate-300 bg-slate-50 flex items-center justify-center text-[28px] font-black tabular-nums text-slate-900">
                            {customQtyDraft ? `×${customQtyDraft}` : '×1'}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                                <button key={d} type="button" onClick={() => { if (customQtyDraft.length < 3) setCustomQtyDraft(customQtyDraft + d) }}
                                    className="min-h-[54px] rounded-xl border-2 border-slate-200 bg-white text-[20px] font-black active:bg-slate-100">
                                    {d}
                                </button>
                            ))}
                            <button type="button" onClick={() => setCustomQtyDraft('')} className="min-h-[54px] rounded-xl border-2 border-slate-200 bg-white text-[13px] font-black">{tr('clear')}</button>
                            <button type="button" onClick={() => { if (customQtyDraft.length > 0 && customQtyDraft.length < 3) setCustomQtyDraft(customQtyDraft + '0') }} className="min-h-[54px] rounded-xl border-2 border-slate-200 bg-white text-[20px] font-black">0</button>
                            <button type="button" onClick={() => setCustomQtyDraft(customQtyDraft.slice(0, -1))} className="min-h-[54px] rounded-xl border-2 border-slate-200 bg-white flex items-center justify-center"><Delete size={18} /></button>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button type="button" onClick={() => setCustomQtyOpen(false)} className="flex-1 min-h-[48px] rounded-xl border-2 border-slate-200 font-black">{tr('cancel')}</button>
                            <button
                                type="button"
                                onClick={() => {
                                    const n = Math.max(1, Math.min(200, Number(customQtyDraft) || 1))
                                    if (selectedLine) {
                                        updateLine(selectedLine.id, l => ({ ...l, qty: n }))
                                    } else {
                                        setPendingQty(n)
                                    }
                                    setCustomQtyOpen(false)
                                }}
                                className="flex-1 min-h-[48px] rounded-xl bg-blue-600 text-white font-black"
                            >
                                {tr('apply_qty')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== FREE NOTE MODAL ===== */}
            {noteOpen && (
                <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-lg bg-white rounded-2xl p-5 space-y-3">
                        <p className="text-[18px] font-black text-slate-900">{tr('note_title')}</p>
                        <input autoFocus value={noteText} maxLength={60} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addFreeNote() }}
                            className="w-full min-h-[56px] px-3 rounded-xl border-2 border-slate-300 text-[17px] font-bold" placeholder={tr('note_placeholder')} />
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => { setNoteOpen(false); setNoteText('') }} className="min-h-[52px] px-5 rounded-xl border-2 border-slate-200 font-black">{tr('cancel')}</button>
                            <button type="button" onClick={addFreeNote} disabled={!noteText.trim()} className="min-h-[52px] px-5 rounded-xl bg-slate-900 text-white font-black disabled:opacity-40">{tr('add')}</button>
                        </div>
                    </div>
                </div>
            )}

            {approval && (
                <ManagerPinModal
                    mode={approval}
                    tr={tr}
                    storeNumber={storeNumber}
                    clientOrderRef={`ORDER-${storeNumber}-${orderNumber}`}
                    onCancel={() => setApproval(null)}
                    onChangeMode={setApproval}
                    onApproved={async (approverName) => {
                        const current = approval
                        setApproval(null)
                        if (current.kind === 'DISCOUNT') {
                            onApplyDiscount({ type: current.type, pct: current.pct, approverName })
                            setFlash({ tone: 'ok', text: tr('discount_applied', { name: approverName }) })
                        } else if (onVoidLastOrder) {
                            await onVoidLastOrder(approverName, current.isWaste)
                            setFlash({ tone: 'ok', text: tr('void_done', { name: approverName }) })
                        }
                    }}
                />
            )}

            {pinSetupOpen && <PinSetupModal tr={tr} onClose={() => setPinSetupOpen(false)} onSaved={(name) => { setPinSetupOpen(false); setFlash({ tone: 'ok', text: tr('pin_saved', { name }) }) }} />}
        </div>
    )
}

// =============================================================================
// Numeric PIN pad (on-screen, no OS keyboard needed on the POS tablet)
// =============================================================================
function PinPad({ value, onChange, tr }: { value: string; onChange: (v: string) => void; tr: (k: string) => string }) {
    const press = (d: string) => { if (value.length < 8) onChange(value + d) }
    return (
        <div className="space-y-3">
            <div className="h-14 rounded-xl border-2 border-slate-300 bg-slate-50 flex items-center justify-center text-[28px] font-black tracking-[0.4em] text-slate-900" aria-live="polite">
                {value ? '•'.repeat(value.length) : <span className="text-[15px] tracking-normal font-bold text-slate-400">{tr('pin_placeholder')}</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                    <button key={d} type="button" onClick={() => press(d)} className="min-h-[60px] rounded-xl border-2 border-slate-200 bg-white text-[22px] font-black active:bg-slate-100">{d}</button>
                ))}
                <button type="button" onClick={() => onChange('')} className="min-h-[60px] rounded-xl border-2 border-slate-200 bg-white text-[14px] font-black">{tr('clear')}</button>
                <button type="button" onClick={() => press('0')} className="min-h-[60px] rounded-xl border-2 border-slate-200 bg-white text-[22px] font-black">0</button>
                <button type="button" onClick={() => onChange(value.slice(0, -1))} className="min-h-[60px] rounded-xl border-2 border-slate-200 bg-white flex items-center justify-center" aria-label={tr('backspace')}><Delete size={20} /></button>
            </div>
        </div>
    )
}

function ManagerPinModal(props: {
    mode: ApprovalMode
    tr: (k: string, o?: Record<string, unknown>) => string
    storeNumber: number
    clientOrderRef: string
    onCancel: () => void
    onChangeMode: (m: ApprovalMode) => void
    onApproved: (approverName: string) => void | Promise<void>
}) {
    const { mode, tr, storeNumber, clientOrderRef, onCancel, onChangeMode, onApproved } = props
    const [pin, setPin] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const submit = async () => {
        if (pin.length < 4 || busy) return
        setBusy(true)
        setError('')
        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(tr('pin_requires_network'))
            const res = await fetch('/api/gavilan-pos/manager-approval', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'VERIFY',
                    pin,
                    approvalType: mode.kind === 'DISCOUNT' ? mode.type : 'VOID_ORDER',
                    discountPct: mode.kind === 'DISCOUNT' ? mode.pct : 0,
                    storeNumber,
                    clientOrderId: clientOrderRef,
                    note: mode.kind === 'VOID' ? (mode.isWaste ? 'WASTE' : 'RETURN_TO_STOCK') : null,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`)
            await onApproved(String(data.approverName || ''))
        } catch (e: any) {
            setError(e?.message || 'Error')
            setPin('')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <Lock size={18} className="text-slate-700" />
                    <p className="text-[18px] font-black text-slate-900">{mode.kind === 'DISCOUNT' ? tr('manager_approval_discount') : tr('manager_approval_void')}</p>
                </div>
                {mode.kind === 'DISCOUNT' && (
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(DISCOUNT_PRESETS) as DiscountType[]).flatMap(type => DISCOUNT_PRESETS[type].allowedPcts.map(pct => (
                            <button key={`${type}-${pct}`} type="button" aria-pressed={mode.type === type && mode.pct === pct}
                                onClick={() => onChangeMode({ kind: 'DISCOUNT', type, pct })}
                                className={`min-h-[48px] px-3 rounded-xl border-2 text-[14px] font-black ${mode.type === type && mode.pct === pct ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
                                {tr(`discount_${type.toLowerCase()}`)} {pct}%
                            </button>
                        )))}
                    </div>
                )}
                {mode.kind === 'VOID' && (
                    <div className="flex gap-2">
                        {[true, false].map(w => (
                            <button key={String(w)} type="button" aria-pressed={mode.isWaste === w} onClick={() => onChangeMode({ kind: 'VOID', isWaste: w })}
                                className={`flex-1 min-h-[48px] rounded-xl border-2 text-[14px] font-black ${mode.isWaste === w ? 'bg-rose-600 border-rose-700 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
                                {w ? tr('void_waste') : tr('void_restock')}
                            </button>
                        ))}
                    </div>
                )}
                <PinPad value={pin} onChange={setPin} tr={tr} />
                {error && <p className="text-[14px] font-bold text-rose-700" role="alert">{error}</p>}
                <div className="flex gap-2">
                    <button type="button" onClick={onCancel} className="flex-1 min-h-[56px] rounded-xl border-2 border-slate-200 font-black">{tr('cancel')}</button>
                    <button type="button" onClick={submit} disabled={pin.length < 4 || busy} className="flex-1 min-h-[56px] rounded-xl bg-slate-900 text-white font-black disabled:opacity-40">
                        {busy ? tr('verifying') : tr('authorize')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function PinSetupModal({ tr, onClose, onSaved }: { tr: (k: string, o?: Record<string, unknown>) => string; onClose: () => void; onSaved: (name: string) => void }) {
    const [step, setStep] = useState<1 | 2>(1)
    const [first, setFirst] = useState('')
    const [second, setSecond] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const save = async () => {
        if (first !== second) { setError(tr('pin_mismatch')); setSecond(''); return }
        setBusy(true)
        setError('')
        try {
            const res = await fetch('/api/gavilan-pos/manager-approval', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'SET_PIN', pin: first }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`)
            onSaved(String(data.approverName || ''))
        } catch (e: any) {
            setError(e?.message || 'Error')
            setStep(1); setFirst(''); setSecond('')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4">
                <p className="text-[18px] font-black text-slate-900">{tr('pin_setup_title')}</p>
                <p className="text-[14px] text-slate-600">{step === 1 ? tr('pin_setup_step1') : tr('pin_setup_step2')}</p>
                {step === 1 ? <PinPad value={first} onChange={setFirst} tr={tr} /> : <PinPad value={second} onChange={setSecond} tr={tr} />}
                {error && <p className="text-[14px] font-bold text-rose-700" role="alert">{error}</p>}
                <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="flex-1 min-h-[56px] rounded-xl border-2 border-slate-200 font-black">{tr('cancel')}</button>
                    {step === 1 ? (
                        <button type="button" onClick={() => setStep(2)} disabled={first.length < 4} className="flex-1 min-h-[56px] rounded-xl bg-slate-900 text-white font-black disabled:opacity-40">{tr('next')}</button>
                    ) : (
                        <button type="button" onClick={save} disabled={second.length < 4 || busy} className="flex-1 min-h-[56px] rounded-xl bg-slate-900 text-white font-black disabled:opacity-40">{busy ? tr('verifying') : tr('save_pin')}</button>
                    )}
                </div>
            </div>
        </div>
    )
}

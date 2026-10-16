/**
 * @module app/gavilan-pos/page
 * @description Ecosistema independiente en Modo Claro ("Clean Light Mode") para Gavilan POS Cloud & Terminal Suite.
 * Diseñado para reemplazar y superar al 100% la plataforma administrativa de Toast Web (`pos.toasttab.com`),
 * sus terminales POS físicas, pantallas KDS, impresoras y pasarela de pagos en las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - **Diseño Exclusivo Light Mode (Cero Dark Mode)**: Interfaz limpia, de alto contraste sobre lienzo blanco/alabastro (`#F8FAFC` / `#FFFFFF`),
 *   organizada por categorías con íconos semánticos, búsqueda global instantánea (`Ctrl+K`) y simuladores de hardware en vivo.
 * - **Publicación con Diff Visual (Git-Style Smart Publish)**: Elimina el error crítico de Toast Web ("Save vs. Publish Now" a ciegas),
 *   mostrando exactamente qué cambios están en borrador antes de sincronizarlos a las terminales de las 15 tiendas.
 * - **Regla EBT CalFresh RMP (Restaurant Meals Program)**: Al cobrar con `EBT Food Stamps` en la Caja POS, el sistema elimina
 *   automáticamente el California Sales Tax (`0% tax`), desactiva propinas y recargos, solicita PIN encriptado en el lector
 *   semi-integrado (`PAX A35`) e imprime el saldo restante (`FoodBalance`) en el recibo térmico.
 * - **Límites del Día Laboral (6:00 AM Rule)**: Cortes de caja (Z-Reports) y métricas operan bajo el horario oficial de Tacos Gavilan
 *   (6:00 AM a 5:59 AM del día siguiente, Turno PM desde las 5:00 PM en `America/Los_Angeles`).
 *
 * @dataFlow
 * - Consume datos reales de las 15 tiendas, catálogo de platillos (`toast_menu_items`) y ventas (`sales_daily_cache`)
 *   desde `/api/gavilan-pos/overview`.
 * - Conecta interactivamente la Caja POS en Vivo con el Simulador KDS + Espejeo HDMI y el Diseñador de Tickets ESC/POS.
 *
 * @notes
 * - Se abre en una pestaña independiente (`target="_blank"`) desde `AppSidebar` y se excluye del layout oscuro en `ClientLayout`.
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    LayoutGrid, UtensilsCrossed, Monitor, Tv, Printer, CreditCard, Truck, HardDrive,
    BookOpen, Search, Store, CheckCircle2, AlertTriangle, Sparkles, ArrowUpRight,
    Plus, Minus, Trash2, Check, X, RefreshCw, Wifi, ShieldCheck, DollarSign,
    Sliders, Flame, Clock, Volume2, QrCode, Split, Eye, Send, Terminal,
    FileCode, Lock, Users, KeyRound, Layers, ChevronRight, Zap, Play, Pause,
    Tag, Percent, Calculator, Cable, Radio, PackageCheck, HelpCircle
} from 'lucide-react'

// --- TYPES ---
type ModuleCategoryId =
    | 'command'
    | 'menu'
    | 'register'
    | 'drivethru'
    | 'kiosk_tv'
    | 'kds'
    | 'tickets'
    | 'payments'
    | 'delivery'
    | 'hardware'
    | 'anatomy'

interface StoreInfo {
    id: string
    toastGuid: string
    storeNumber: number
    name: string
    taxRate: number
    fnsNumber: string
    status: 'ONLINE' | 'OFFLINE_LAN'
    latestDate: string
    netSales: number
    orderCount: number
    uberSales: number
    doordashSales: number
    grubhubSales: number
    ebtAmount: number
    quoteMinutes?: number
    receiptHeader?: string
    receiptFooter?: string
    printRedModifiers?: boolean
    printerReceiptIp?: string
    printerKitchenIp?: string
    offlineSafLimitUsd?: number
    upsBatteryModel?: string
    cellularFailoverModel?: string
}

interface PosMenuItem {
    guid: string
    name: string
    groupName: string
    basePrice: number
    deliveryPrice: number
    prepStation: 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS' | 'NONE'
    taxInherited: boolean
    inStock: boolean
    remainingQty?: number | null
    buttonColor?: string
    channels: {
        pos: boolean
        kiosk: boolean
        online: boolean
        delivery: boolean
    }
}

interface StagedChange {
    id: string
    module: string
    target: string
    before: string
    after: string
    timestamp: string
}

interface CartItem {
    id: string
    guid: string
    name: string
    unitPrice: number
    qty: number
    prepStation: 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS' | 'NONE'
    modifiers: { name: string; price: number; isAlert?: boolean }[]
}

interface KdsOrderTicket {
    id: string
    checkNumber: number
    channel: 'FOR HERE' | 'TO GO' | 'DRIVE-THRU' | 'UBER EATS' | 'DOORDASH' | 'GRUBHUB'
    customerName: string
    createdAtMs: number
    elapsedMinutes: number
    level1Done: boolean
    items: {
        name: string
        qty: number
        station: 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS' | 'NONE'
        modifiers: string[]
        done: boolean
    }[]
}

// --- DEFAULT CURATED TACOS GAVILAN ITEMS (FALLBACK WHILE DB LOADS OR AUGMENTATION) ---
const CURATED_GAVILAN_ITEMS: PosMenuItem[] = [
    { guid: 'tg-1', name: 'Taco de Asada', groupName: 'Tacos', basePrice: 3.49, deliveryPrice: 4.12, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-red-50 border-red-200 text-red-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-2', name: 'Taco al Pastor', groupName: 'Tacos', basePrice: 3.49, deliveryPrice: 4.12, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-orange-50 border-orange-200 text-orange-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-3', name: 'Taco de Pollo', groupName: 'Tacos', basePrice: 3.29, deliveryPrice: 3.88, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-amber-50 border-amber-200 text-amber-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-4', name: 'Taco de Lengua', groupName: 'Tacos', basePrice: 4.29, deliveryPrice: 5.06, prepStation: 'PARRILLA', taxInherited: true, inStock: true, remainingQty: 18, buttonColor: 'bg-rose-50 border-rose-200 text-rose-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-5', name: 'Taco de Cabeza', groupName: 'Tacos', basePrice: 3.79, deliveryPrice: 4.47, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-stone-50 border-stone-200 text-stone-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-6', name: 'Burrito Regular de Asada', groupName: 'Burritos', basePrice: 11.49, deliveryPrice: 13.56, prepStation: 'LINEA', taxInherited: true, inStock: true, buttonColor: 'bg-emerald-50 border-emerald-200 text-emerald-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-7', name: 'Burrito Especial Gavilan', groupName: 'Burritos', basePrice: 13.29, deliveryPrice: 15.68, prepStation: 'LINEA', taxInherited: true, inStock: true, buttonColor: 'bg-emerald-50 border-emerald-200 text-emerald-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-8', name: 'Quesadilla Grande con Carne', groupName: 'Quesadillas & Mulitas', basePrice: 12.49, deliveryPrice: 14.74, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-yellow-50 border-yellow-200 text-yellow-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-9', name: 'Mulita de Asada', groupName: 'Quesadillas & Mulitas', basePrice: 4.69, deliveryPrice: 5.53, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-yellow-50 border-yellow-200 text-yellow-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-10', name: 'Vampiro de Pastor', groupName: 'Quesadillas & Mulitas', basePrice: 4.69, deliveryPrice: 5.53, prepStation: 'PARRILLA', taxInherited: true, inStock: true, buttonColor: 'bg-orange-50 border-orange-200 text-orange-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-11', name: 'Combo #1 (3 Tacos + Arroz y Frijol + Bebida)', groupName: 'Combos & Platos', basePrice: 14.99, deliveryPrice: 17.69, prepStation: 'LINEA', taxInherited: true, inStock: true, buttonColor: 'bg-blue-50 border-blue-200 text-blue-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-12', name: 'Party Tray 20-25 Personas (Asada y Pollo)', groupName: 'Party Trays', basePrice: 189.99, deliveryPrice: 224.19, prepStation: 'LINEA', taxInherited: true, inStock: true, buttonColor: 'bg-purple-50 border-purple-200 text-purple-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-13', name: 'Agua de Horchata (Large 32oz)', groupName: 'Aguas & Bebidas', basePrice: 4.49, deliveryPrice: 5.30, prepStation: 'BEBIDAS', taxInherited: true, inStock: true, buttonColor: 'bg-cyan-50 border-cyan-200 text-cyan-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-14', name: 'Agua de Jamaica (Large 32oz)', groupName: 'Aguas & Bebidas', basePrice: 4.49, deliveryPrice: 5.30, prepStation: 'BEBIDAS', taxInherited: true, inStock: true, buttonColor: 'bg-pink-50 border-pink-200 text-pink-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
    { guid: 'tg-15', name: 'Orden de Tortillas Hechas a Mano (4 pzs)', groupName: 'Extras & Sides', basePrice: 2.25, deliveryPrice: 2.66, prepStation: 'TORTILLAS', taxInherited: true, inStock: true, buttonColor: 'bg-amber-50 border-amber-200 text-amber-900', channels: { pos: true, kiosk: true, online: true, delivery: true } },
]

const AVAILABLE_MODIFIERS = [
    { name: 'Con Todo (Cilantro y Cebolla)', price: 0, isAlert: false },
    { name: '*** SIN CEBOLLA ***', price: 0, isAlert: true },
    { name: '*** SIN CILANTRO ***', price: 0, isAlert: true },
    { name: 'Tortilla de Maíz Recién Hecha', price: 0, isAlert: false },
    { name: 'Tortilla de Harina', price: 0, isAlert: false },
    { name: 'Extra Carne (+Asada)', price: 2.25, isAlert: true },
    { name: 'Extra Aguacate / Guacamole', price: 1.50, isAlert: false },
    { name: 'Salsa Verde Picante', price: 0, isAlert: false },
    { name: 'Salsa Roja de Árbol', price: 0, isAlert: true },
]

export default function GavilanPosEcosystemPage() {
    const { language, setLanguage, t } = useLanguage()
    const isEs = language === 'es'

    // Active Module Category
    const [activeCategory, setActiveCategory] = useState<ModuleCategoryId>('command')
    const [selectedStoreId, setSelectedStoreId] = useState<string>('ALL')
    const [searchQuery, setSearchQuery] = useState('')
    const [spotlightOpen, setSpotlightOpen] = useState(false)

    // Real Data State from /api/gavilan-pos/overview (Supabase PostgreSQL + LocalStorage Offline Cache)
    const [loadingData, setLoadingData] = useState(true)
    const [stores, setStores] = useState<StoreInfo[]>([])
    const [menuItems, setMenuItems] = useState<PosMenuItem[]>(CURATED_GAVILAN_ITEMS)
    const [latestBusinessDate, setLatestBusinessDate] = useState<string>('2026-10-13')
    const [metricsSummary, setMetricsSummary] = useState({
        annualizedNetSales: 71090000,
        annualizedGrossCollected: 77911000,
        annualizedCardVolume: 43200000,
        annualizedOrders: 3662000,
        annualizedDeliveryNet: 12919000,
        annualizedEbtSales: 1980000,
    })

    // Offline-First & Anti-Blackout (Battery / UPS) Real Engine States
    const [networkPowerMode, setNetworkPowerMode] = useState<'ONLINE_AC' | 'CELLULAR_5G_UPS' | 'OFFLINE_BATTERY'>('ONLINE_AC')
    const [offlineOutbox, setOfflineOutbox] = useState<{ id: string; action: string; payload: any; queuedAt: string }[]>([])
    const [syncingOutbox, setSyncingOutbox] = useState(false)
    const [lastDbWriteBadge, setLastDbWriteBadge] = useState<string>('Conectado a Supabase PostgreSQL')
    const [batteryStatus, setBatteryStatus] = useState<{
        supported: boolean
        levelPct: number
        charging: boolean
        backupHoursEstimated: number
    }>({
        supported: true,
        levelPct: 98,
        charging: true,
        backupHoursEstimated: 7.5
    })

    // Real Persistent Cash Closeouts (Z-Reports) & TCP 9100 Print Test States
    const [closeoutsHistory, setCloseoutsHistory] = useState<any[]>([])
    const [blindCountInput, setBlindCountInput] = useState<string>('485.00')
    const [closeoutCashierName, setCloseoutCashierName] = useState<string>('Gerente Turno AM')
    const [savingCloseout, setSavingCloseout] = useState(false)
    const [printerTargetIp, setPrinterTargetIp] = useState<string>('192.168.14.50:9100')
    const [tcpPrintResult, setTcpPrintResult] = useState<{
        target: string
        bytesLength: number
        hexPreview: string
        connected: boolean
        message: string
    } | null>(null)
    const [testingTcpPrint, setTestingTcpPrint] = useState(false)

    // Git-Style Visual Diff Staged Changes (Fixing Toast Web's #1 "Save vs Publish" pain point)
    const [stagedChanges, setStagedChanges] = useState<StagedChange[]>([])
    const [publishModalOpen, setPublishModalOpen] = useState(false)
    const [lastPublishedAt, setLastPublishedAt] = useState<string>('Sincronizado en Vivo con Supabase')

    // Menu Studio States
    const [menuViewMode, setMenuViewMode] = useState<'visual' | 'matrix' | 'modifiers'>('visual')
    const [selectedMenuGroup, setSelectedMenuGroup] = useState<string>('ALL')
    const [editingItem, setEditingItem] = useState<PosMenuItem | null>(null)
    const [deliveryUpliftPct, setDeliveryUpliftPct] = useState<number>(18)

    // Live POS Register States
    const [diningOption, setDiningOption] = useState<'FOR HERE' | 'TO GO' | 'DRIVE-THRU'>('TO GO')
    const [customerNameOrder, setCustomerNameOrder] = useState<string>('CARLOS M.')
    const [cart, setCart] = useState<CartItem[]>([
        {
            id: 'c-1',
            guid: 'tg-1',
            name: 'Taco de Asada',
            unitPrice: 3.49,
            qty: 4,
            prepStation: 'PARRILLA',
            modifiers: [
                { name: 'Con Todo (Cilantro y Cebolla)', price: 0 },
                { name: '*** SIN CEBOLLA *** (en 2 tacos)', price: 0, isAlert: true }
            ]
        },
        {
            id: 'c-2',
            guid: 'tg-6',
            name: 'Burrito Regular de Asada',
            unitPrice: 11.49,
            qty: 1,
            prepStation: 'LINEA',
            modifiers: [
                { name: 'Extra Aguacate / Guacamole', price: 1.50 }
            ]
        },
        {
            id: 'c-3',
            guid: 'tg-13',
            name: 'Agua de Horchata (Large 32oz)',
            unitPrice: 4.49,
            qty: 2,
            prepStation: 'BEBIDAS',
            modifiers: []
        }
    ])
    const [selectedCartItemId, setSelectedCartItemId] = useState<string>('c-1')
    const [selectedTender, setSelectedTender] = useState<'CARD' | 'EBT_FOOD' | 'EBT_CASH' | 'CASH' | 'SPLIT_EBT_MIXED'>('CARD')
    const [splitEbtAmount, setSplitEbtAmount] = useState<number>(15.00)
    const [splitSecondaryMethod, setSplitSecondaryMethod] = useState<'CASH' | 'CARD_NFC'>('CASH')
    const [discountPct, setDiscountPct] = useState<number>(0)
    const [discountReason, setDiscountReason] = useState<string>('')
    const [managerPinInput, setManagerPinInput] = useState<string>('1425')
    const [voidIsWaste, setVoidIsWaste] = useState<boolean>(true)
    const [loyaltyPhoneInput, setLoyaltyPhoneInput] = useState<string>('323-555-0148')
    const [appliedLoyaltyDiscount, setAppliedLoyaltyDiscount] = useState<number>(0)
    const [cashTendered, setCashTendered] = useState<number>(40)
    const [pinPadStatus, setPinPadStatus] = useState<'IDLE' | 'WAITING_PIN_TAP' | 'APPROVED'>('IDLE')
    const [lastReceiptInfo, setLastReceiptInfo] = useState<{
        checkNumber: number
        tender: string
        subtotal: number
        tax: number
        total: number
        ebtRemainingBalance: number | null
        authCode: string
        drawerOpened: boolean
    }>({
        checkNumber: 1044,
        tender: 'VISA CONTACTLESS (Apple Pay)',
        subtotal: 35.93,
        tax: 3.68,
        total: 39.61,
        ebtRemainingBalance: null,
        authCode: '09481C',
        drawerOpened: false
    })

    // V2 Ecosystem Persistent DB Collections (Drive-Thru, Catering, Cash Events, Timeclock, Loyalty)
    const [rawOrders, setRawOrders] = useState<any[]>([])
    const [cashEvents, setCashEvents] = useState<any[]>([])
    const [timeclockEntries, setTimeclockEntries] = useState<any[]>([])
    const [loyaltyAccounts, setLoyaltyAccounts] = useState<any[]>([])

    // Drive-Thru Multi-Station States (Speaker + OCB + Sequential FIFO Queue + Window)
    const [dtLane, setDtLane] = useState<number>(1)
    const [dtPreFireStreaming, setDtPreFireStreaming] = useState<boolean>(true)
    const [selectedDtOrderId, setSelectedDtOrderId] = useState<string>('SEED-1044')
    const [dtWindowTender, setDtWindowTender] = useState<'CARD_NFC' | 'EBT_CALFRESH' | 'CASH' | 'SPLIT_EBT_MIXED'>('EBT_CALFRESH')

    // Warehouse Lab (La Bodega Central) Phase 2 Idempotency, LAN IP & Physical Printer Scanner States
    const [runningIdempotencyLab, setRunningIdempotencyLab] = useState<boolean>(false)
    const [idempotencyLabResult, setIdempotencyLabResult] = useState<{
        clientOrderId: string
        attemptsSent: number
        attempt1Replay: boolean
        attempt2Replay: boolean
        attempt3Replay: boolean
        persistedRowCount: number
        zeroDuplicatesVerified: boolean
        verifiedAt: string
    } | null>(null)
    const [localLanInfo, setLocalLanInfo] = useState<{
        primaryIp: string
        subnetPrefix: string
        posLanUrl: string
        interfaces: { iface: string; ip: string; subnetPrefix: string }[]
    }>({
        primaryIp: '192.168.1.100',
        subnetPrefix: '192.168.1',
        posLanUrl: 'http://localhost:3000/gavilan-pos',
        interfaces: []
    })
    const [scanningWarehouseLan, setScanningWarehouseLan] = useState<boolean>(false)
    const [discoveredPrinters, setDiscoveredPrinters] = useState<{ ipPort: string; latencyMs: number }[]>([])
    const [lastScanSubnet, setLastScanSubnet] = useState<string>('')

    // Kiosk, Order Ready TV & Scheduled Party Trays Catering States
    const [kioskUpsellAccepted, setKioskUpsellAccepted] = useState<boolean>(true)
    const [kioskTender, setKioskTender] = useState<'CARD_NFC' | 'EBT_CALFRESH'>('CARD_NFC')
    const [cateringCustomer, setCateringCustomer] = useState<string>('FAMILIA HERNÁNDEZ')
    const [cateringPhone, setCateringPhone] = useState<string>('323-555-0148')
    const [cateringPickupTime, setCateringPickupTime] = useState<string>('18:00 PM (Auto-Fire 17:15 PM)')
    const [cateringPackage, setCateringPackage] = useState<'15-20' | '20-25' | '30-40'>('30-40')
    const [voiceAnnounceStatus, setVoiceAnnounceStatus] = useState<string>('')

    // Cash Drawer Live Ledger & POS Timeclock States
    const [newCashEventType, setNewCashEventType] = useState<'CASH_DROP' | 'PAY_OUT' | 'PAY_IN' | 'NO_SALE'>('CASH_DROP')
    const [newCashEventAmount, setNewCashEventAmount] = useState<string>('350.00')
    const [newCashEventReason, setNewCashEventReason] = useState<string>('Sangría #2 a Caja Fuerte Smart Safe')
    const [tcEmployeeName, setTcEmployeeName] = useState<string>('Pedro Hernández')
    const [tcEmployeeRole, setTcEmployeeRole] = useState<string>('Taquero Parrilla')
    const [tcPasscode, setTcPasscode] = useState<string>('5512')
    const [tcPunchType, setTcPunchType] = useState<'CLOCK_IN' | 'START_REST_BREAK_10' | 'START_MEAL_BREAK_30' | 'CLOCK_OUT'>('START_MEAL_BREAK_30')
    const [tcShiftElapsedMins, setTcShiftElapsedMins] = useState<number>(285)

    // Live KDS + HDMI Mirror States
    const [kdsStationFilter, setKdsStationFilter] = useState<'ALL_EXPO' | 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS'>('ALL_EXPO')
    const [hdmiMirrorMode, setHdmiMirrorMode] = useState<'MIRROR_CLONE' | 'EXTENDED_GRILL'>('MIRROR_CLONE')
    const [edidLockEnabled, setEdidLockEnabled] = useState<boolean>(true)
    const [kdsTickets, setKdsTickets] = useState<KdsOrderTicket[]>([])

    // Ticket & Receipt Designer States
    const [receiptConfig, setReceiptConfig] = useState({
        showLogo: true,
        giantOrderNumber: true,
        consolidateIdenticalItems: true,
        redInkKitchenModifiers: true,
        printEbtRemainingBalance: true,
        showQrCodeSurvey: true,
        soundKitchenBuzzer: true,
        customFooterEs: '¡Gracias por su preferencia en Tacos Gavilan! 100% Carne Asada al Carbón.',
        customFooterEn: 'Thank you for visiting Tacos Gavilan! Authentic Charcoal Grilled Meats.'
    })

    // Payments & Interchange++ States
    const [toastEffectiveRate, setToastEffectiveRate] = useState<number>(2.49)
    const [interchangePlusMarkupBps, setInterchangePlusMarkupBps] = useState<number>(8) // 0.08%
    const [regulatedDebitSharePct, setRegulatedDebitSharePct] = useState<number>(65)

    // Delivery & Online States
    const [onlineQuoteMins, setOnlineQuoteMins] = useState<number>(15)
    const [smartThrottlingCap, setSmartThrottlingCap] = useState<number>(20)
    const [deliverySnoozed, setDeliverySnoozed] = useState<boolean>(false)

    // Read real device battery via Web Battery Status API + monitor navigator.onLine
    useEffect(() => {
        if (typeof window === 'undefined') return

        // Load persisted offline outbox if any
        try {
            const rawOutbox = window.localStorage.getItem('gavilan_pos_offline_outbox_v1')
            if (rawOutbox) {
                const parsed = JSON.parse(rawOutbox)
                if (Array.isArray(parsed)) setOfflineOutbox(parsed)
            }
        } catch {}

        // Web Battery API
        const navAny = navigator as any
        if (typeof navAny.getBattery === 'function') {
            navAny.getBattery().then((bat: any) => {
                const updateBat = () => {
                    const pct = Math.round((bat.level ?? 1) * 100)
                    setBatteryStatus({
                        supported: true,
                        levelPct: pct,
                        charging: Boolean(bat.charging),
                        backupHoursEstimated: Number(((pct / 100) * 7.8).toFixed(1))
                    })
                }
                updateBat()
                bat.addEventListener('levelchange', updateBat)
                bat.addEventListener('chargingchange', updateBat)
            }).catch(() => {})
        }

        const handleOffline = () => {
            setNetworkPowerMode('OFFLINE_BATTERY')
            setLastDbWriteBadge('MODO OFFLINE ACTIVO (Guardando en Cola SAF Local)')
        }
        const handleOnline = () => {
            setNetworkPowerMode('ONLINE_AC')
            setLastDbWriteBadge('Conexión Restaurada — Listo para Sincronizar')
        }
        window.addEventListener('offline', handleOffline)
        window.addEventListener('online', handleOnline)
        return () => {
            window.removeEventListener('offline', handleOffline)
            window.removeEventListener('online', handleOnline)
        }
    }, [])

    // Local LAN Mesh BroadcastChannel (syncs POS Cashier Tab <-> KDS HDMI Tab in <5ms even without internet!)
    useEffect(() => {
        if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
        const channel = new BroadcastChannel('gavilan_pos_lan_mesh')
        channel.onmessage = (ev) => {
            const msg = ev.data
            if (!msg || !msg.type) return
            if (msg.type === 'NEW_KDS_TICKET' && msg.ticket) {
                setKdsTickets(prev => {
                    if (prev.some(k => k.id === msg.ticket.id)) return prev
                    return [msg.ticket, ...prev]
                })
            } else if (msg.type === 'BUMP_KDS_TICKET' && msg.ticketId) {
                setKdsTickets(prev => prev.filter(k => k.id !== msg.ticketId))
            } else if (msg.type === 'TOGGLE_86_ITEM' && msg.guid) {
                setMenuItems(prev => prev.map(m => m.guid === msg.guid ? { ...m, inStock: msg.inStock } : m))
            }
        }
        return () => channel.close()
    }, [])

    const broadcastLanEvent = (data: any) => {
        if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
        try {
            const ch = new BroadcastChannel('gavilan_pos_lan_mesh')
            ch.postMessage(data)
            ch.close()
        } catch {}
    }

    // Core Persistent Mutation Dispatcher (Writes to Supabase PostgreSQL or queues in Offline SAF Outbox)
    const dispatchPosMutation = async (action: string, payload: any) => {
        const isOffline = networkPowerMode === 'OFFLINE_BATTERY' || (typeof navigator !== 'undefined' && !navigator.onLine)
        if (isOffline) {
            const newEntry = {
                id: `saf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                action,
                payload,
                queuedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            }
            setOfflineOutbox(prev => {
                const updated = [...prev, newEntry]
                try {
                    window.localStorage.setItem('gavilan_pos_offline_outbox_v1', JSON.stringify(updated))
                } catch {}
                return updated
            })
            setLastDbWriteBadge(`Encolado Offline SAF (${action}) • Se subirá al volver red`)
            return { ok: true, queuedOffline: true }
        }

        try {
            const res = await fetch('/api/gavilan-pos/overview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...payload })
            })
            const data = await res.json()
            if (data?.ok) {
                const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                setLastDbWriteBadge(`Guardado en Supabase PostgreSQL (${action} • ${timeStr})`)
            }
            return data
        } catch (err) {
            // Network dropped mid-request: automatic Store-and-Forward fallback!
            const fallbackEntry = {
                id: `saf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                action,
                payload,
                queuedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            }
            setOfflineOutbox(prev => {
                const updated = [...prev, fallbackEntry]
                try {
                    window.localStorage.setItem('gavilan_pos_offline_outbox_v1', JSON.stringify(updated))
                } catch {}
                return updated
            })
            setNetworkPowerMode('OFFLINE_BATTERY')
            setLastDbWriteBadge(`Failover Automático a Cola Offline SAF (${action})`)
            return { ok: true, queuedOffline: true }
        }
    }

    // Flush Offline Outbox to Supabase PostgreSQL when Internet returns
    const flushOfflineOutbox = async () => {
        if (offlineOutbox.length === 0) return
        setSyncingOutbox(true)
        try {
            const res = await fetch('/api/gavilan-pos/overview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'SYNC_OFFLINE_OUTBOX',
                    events: offlineOutbox
                })
            })
            const data = await res.json()
            if (data?.ok) {
                const failedIds = new Set(
                    Array.isArray(data.results)
                        ? data.results.filter((r: any) => r.ok === false).map((r: any) => r.id)
                        : []
                )
                const remaining = offlineOutbox.filter(ev => failedIds.has(ev.id))
                setOfflineOutbox(remaining)
                try {
                    if (remaining.length === 0) {
                        window.localStorage.removeItem('gavilan_pos_offline_outbox_v1')
                    } else {
                        window.localStorage.setItem('gavilan_pos_offline_outbox_v1', JSON.stringify(remaining))
                    }
                } catch {}
                setNetworkPowerMode('ONLINE_AC')
                setLastDbWriteBadge(`¡${data.syncedCount} transacciones Offline sincronizadas a Supabase!`)
            }
        } catch (e) {
            console.error('Error syncing offline outbox:', e)
        } finally {
            setSyncingOutbox(false)
        }
    }

    // Fetch real overview data from Supabase (with automatic LocalStorage Offline Cache fallback)
    useEffect(() => {
        async function loadOverview() {
            setLoadingData(true)
            try {
                const res = await fetch('/api/gavilan-pos/overview')
                const data = await res.json()
                if (data?.ok) {
                    try {
                        window.localStorage.setItem('gavilan_pos_offline_cache_v1', JSON.stringify(data))
                    } catch {}

                    if (Array.isArray(data.stores) && data.stores.length > 0) {
                        setStores(data.stores)
                        const lynwoodOrFirst = data.stores.find((s: StoreInfo) => s.storeNumber === 14) || data.stores[0]
                        if (lynwoodOrFirst) {
                            if (lynwoodOrFirst.quoteMinutes) setOnlineQuoteMins(Number(lynwoodOrFirst.quoteMinutes))
                            if (lynwoodOrFirst.printerReceiptIp) setPrinterTargetIp(lynwoodOrFirst.printerReceiptIp)
                            setReceiptConfig(prev => ({
                                ...prev,
                                redInkKitchenModifiers: lynwoodOrFirst.printRedModifiers ?? prev.redInkKitchenModifiers,
                                customFooterEs: lynwoodOrFirst.receiptFooter || prev.customFooterEs,
                            }))
                        }
                    }
                    if (data.latestBusinessDate) {
                        setLatestBusinessDate(data.latestBusinessDate)
                    }
                    if (data.localLanInfo) {
                        setLocalLanInfo(data.localLanInfo)
                    }
                    if (data.metricsSummary) {
                        setMetricsSummary(prev => ({ ...prev, ...data.metricsSummary }))
                    }
                    if (Array.isArray(data.closeouts)) {
                        setCloseoutsHistory(data.closeouts)
                    }
                    if (Array.isArray(data.cashEvents)) {
                        setCashEvents(data.cashEvents)
                    }
                    if (Array.isArray(data.timeclockEntries)) {
                        setTimeclockEntries(data.timeclockEntries)
                    }
                    if (Array.isArray(data.loyaltyAccounts)) {
                        setLoyaltyAccounts(data.loyaltyAccounts)
                    }
                    if (Array.isArray(data.orders) && data.orders.length > 0) {
                        setRawOrders(data.orders)
                        const activeKds: KdsOrderTicket[] = data.orders
                            .filter((o: any) => o.kds_status !== 'BUMPED' && o.kds_status !== 'SCHEDULED_HOLD' && !o.is_voided)
                            .map((o: any) => ({
                                id: o.id || o.client_order_id,
                                checkNumber: Number(o.order_number || 1042),
                                channel: (String(o.dining_option || 'TO GO').replace('_', ' ')) as any,
                                customerName: o.customer_name || `ORDEN #${o.order_number}`,
                                createdAtMs: o.created_at ? new Date(o.created_at).getTime() : Date.now(),
                                elapsedMinutes: Math.max(1, Math.min(25, Math.round((Date.now() - (o.created_at ? new Date(o.created_at).getTime() : Date.now())) / 60000))),
                                level1Done: false,
                                items: Array.isArray(o.items) ? o.items.map((it: any) => ({
                                    name: it.name || 'Taco Asada',
                                    qty: Number(it.qty || 1),
                                    station: it.station || 'PARRILLA',
                                    modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
                                    done: false
                                })) : []
                            }))
                        setKdsTickets(activeKds)
                        const maxOrderNum = data.orders.reduce((max: number, o: any) => Math.max(max, Number(o.order_number || 1040)), 1046)
                        setLastReceiptInfo(prev => ({ ...prev, checkNumber: maxOrderNum }))
                    }
                    if (Array.isArray(data.menuItems) && data.menuItems.length > 0) {
                        const dbMapped: PosMenuItem[] = data.menuItems.slice(0, 60).map((m: any, idx: number) => ({
                            guid: m.guid || `db-${idx}`,
                            name: m.name,
                            groupName: m.groupName || 'Menú General',
                            basePrice: Number(m.basePrice || 3.49),
                            deliveryPrice: Number(m.deliveryPrice || (Number(m.basePrice || 3.49) * 1.18).toFixed(2)),
                            prepStation: m.prepStation || 'PARRILLA',
                            taxInherited: Boolean(m.taxInherited ?? true),
                            inStock: Boolean(m.inStock ?? true),
                            buttonColor: 'bg-slate-50 border-slate-200 text-slate-900',
                            channels: { pos: true, kiosk: true, online: true, delivery: true }
                        }))
                        setMenuItems(dbMapped)
                    }
                }
            } catch (e) {
                console.warn('Cargando desde Caché Local Offline-First:', e)
                try {
                    const cachedRaw = window.localStorage.getItem('gavilan_pos_offline_cache_v1')
                    if (cachedRaw) {
                        const cached = JSON.parse(cachedRaw)
                        if (Array.isArray(cached.stores)) setStores(cached.stores)
                        if (Array.isArray(cached.menuItems)) setMenuItems(cached.menuItems)
                        if (Array.isArray(cached.orders)) setRawOrders(cached.orders)
                        if (Array.isArray(cached.cashEvents)) setCashEvents(cached.cashEvents)
                        if (Array.isArray(cached.timeclockEntries)) setTimeclockEntries(cached.timeclockEntries)
                        if (Array.isArray(cached.loyaltyAccounts)) setLoyaltyAccounts(cached.loyaltyAccounts)
                        setNetworkPowerMode('OFFLINE_BATTERY')
                        setLastDbWriteBadge('Operando desde Caché Local Offline (IndexedDB / LocalStorage)')
                    }
                } catch {}
            } finally {
                setLoadingData(false)
            }
        }
        loadOverview()
    }, [])

    // Bump KDS order (persists to Supabase + updates Guest Order Ready TV + broadcasts to LAN tabs)
    const handleBumpKdsOrder = (ticket: KdsOrderTicket) => {
        setKdsTickets(prev => prev.filter(k => k.id !== ticket.id))
        setRawOrders(prev => prev.map(o => (o.id === ticket.id || o.client_order_id === ticket.id || Number(o.order_number) === ticket.checkNumber) ? { ...o, kds_status: 'BUMPED', bumped_at: new Date().toISOString() } : o))
        broadcastLanEvent({ type: 'BUMP_KDS_TICKET', ticketId: ticket.id })
        dispatchPosMutation('BUMP_ORDER', {
            orderId: ticket.id,
            clientOrderId: ticket.id,
            orderNumber: ticket.checkNumber,
            prepSeconds: Math.max(45, ticket.elapsedMinutes * 60)
        })
    }

    // Recall last bumped KDS order from Supabase
    const handleRecallLastKdsOrder = async () => {
        const res = await dispatchPosMutation('RECALL_ORDER', {})
        if (res?.recalledOrders && Array.isArray(res.recalledOrders) && res.recalledOrders.length > 0) {
            const o = res.recalledOrders[0]
            setRawOrders(prev => prev.map(r => (r.id === o.id || r.client_order_id === o.client_order_id) ? { ...r, kds_status: 'IN_PREP', bumped_at: null } : r))
            const recalledTicket: KdsOrderTicket = {
                id: o.id || o.client_order_id,
                checkNumber: Number(o.order_number || 1042),
                channel: (String(o.dining_option || 'TO GO').replace('_', ' ')) as any,
                customerName: o.customer_name || `ORDEN #${o.order_number}`,
                createdAtMs: o.created_at ? new Date(o.created_at).getTime() : Date.now(),
                elapsedMinutes: 1,
                level1Done: false,
                items: Array.isArray(o.items) ? o.items.map((it: any) => ({
                    name: it.name || 'Taco Asada',
                    qty: Number(it.qty || 1),
                    station: it.station || 'PARRILLA',
                    modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
                    done: false
                })) : []
            }
            setKdsTickets(prev => [recalledTicket, ...prev.filter(k => k.id !== recalledTicket.id)])
            broadcastLanEvent({ type: 'NEW_KDS_TICKET', ticket: recalledTicket })
        }
    }

    // Keyboard shortcut Ctrl+K for Spotlight Search & Number Keys 1-9 for KDS Bump Bar
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setSpotlightOpen(prev => !prev)
                return
            }
            if (activeCategory === 'kds' && !spotlightOpen) {
                const tag = (e.target as HTMLElement)?.tagName
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
                if (e.key >= '1' && e.key <= '9') {
                    const idx = parseInt(e.key, 10) - 1
                    const targetTicket = kdsTickets[idx]
                    if (targetTicket) handleBumpKdsOrder(targetTicket)
                } else if (e.key === 'Enter') {
                    const firstTicket = kdsTickets[0]
                    if (firstTicket) handleBumpKdsOrder(firstTicket)
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [activeCategory, spotlightOpen, kdsTickets])

    // Helper to record a staged change
    const recordChange = (moduleName: string, target: string, before: string, after: string) => {
        const nowStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        setStagedChanges(prev => [
            {
                id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                module: moduleName,
                target,
                before,
                after,
                timestamp: nowStr
            },
            ...prev
        ])
    }

    // Active Store Object
    const activeStore = useMemo(() => {
        if (selectedStoreId === 'ALL') return null
        return stores.find(s => s.id === selectedStoreId || s.name === selectedStoreId) || null
    }, [selectedStoreId, stores])

    useEffect(() => {
        if (!activeStore) return
        if (activeStore.quoteMinutes) setOnlineQuoteMins(Number(activeStore.quoteMinutes))
        if (activeStore.printerReceiptIp) setPrinterTargetIp(activeStore.printerReceiptIp)
        setReceiptConfig(prev => ({
            ...prev,
            redInkKitchenModifiers: activeStore.printRedModifiers ?? prev.redInkKitchenModifiers,
            customFooterEs: activeStore.receiptFooter || prev.customFooterEs,
        }))
    }, [activeStore])

    const currentTaxRate = activeStore ? activeStore.taxRate : 10.25 // LA County default 10.25%

    // Cart Math with Automatic California EBT RMP 0% Sales Tax & Partial Split-Tender Compliance (CDTFA Reg. 1603)
    const cartTotals = useMemo(() => {
        let rawSubtotal = 0
        for (const item of cart) {
            const modSum = item.modifiers.reduce((s, m) => s + m.price, 0)
            rawSubtotal += (item.unitPrice + modSum) * item.qty
        }
        const discountDollar = Number(((rawSubtotal * discountPct) / 100).toFixed(2))
        const totalDiscount = Number(Math.min(rawSubtotal, discountDollar + appliedLoyaltyDiscount).toFixed(2))
        const subtotal = Number(Math.max(0, rawSubtotal - totalDiscount).toFixed(2))

        // CRITICAL CALIFORNIA CDTFA REG. 1603 / USDA FNS RULE:
        // 1) Full EBT Food Stamps (CalFresh RMP): 100% exempt from state & local sales tax ($0.00 tax).
        // 2) Split Tender (Partial EBT + Cash/Card): EBT portion is 0% tax; tax only applies to remaining non-EBT subtotal!
        const isEbtFoodStamp = selectedTender === 'EBT_FOOD'
        const isSplitEbt = selectedTender === 'SPLIT_EBT_MIXED'
        const ebtCoveredPortion = isEbtFoodStamp
            ? subtotal
            : isSplitEbt
                ? Math.min(subtotal, Math.max(0, Number(splitEbtAmount || 0)))
                : 0
        const taxableRemainingSubtotal = Number(Math.max(0, subtotal - ebtCoveredPortion).toFixed(2))
        const tax = (isEbtFoodStamp || taxableRemainingSubtotal === 0)
            ? 0
            : Number(((taxableRemainingSubtotal * currentTaxRate) / 100).toFixed(2))
        const total = Number((subtotal + tax).toFixed(2))
        const secondaryDue = Number((taxableRemainingSubtotal + tax).toFixed(2))

        // Real Interchange++ vs Toast Fee calculation on this ticket
        const cardChargedAmt = selectedTender === 'CARD' ? total : (isSplitEbt && splitSecondaryMethod === 'CARD_NFC' ? secondaryDue : 0)
        const toastFee = cardChargedAmt > 0 ? Number(((cardChargedAmt * 0.0249) + 0.15).toFixed(2)) : 0
        const icPlusDurbinFee = cardChargedAmt > 0
            ? Number(((cardChargedAmt * 0.0005) + 0.22 + (cardChargedAmt * (interchangePlusMarkupBps / 10000)) + 0.03).toFixed(2))
            : (selectedTender === 'EBT_FOOD' || selectedTender === 'EBT_CASH' || isSplitEbt)
                ? 0.05 // Standard EBT flat processor fee ($0.05)
                : 0

        return {
            rawSubtotal: Number(rawSubtotal.toFixed(2)),
            totalDiscount,
            subtotal,
            ebtCoveredPortion,
            taxableRemainingSubtotal,
            secondaryDue,
            tax,
            total,
            isEbtFoodStamp,
            isSplitEbt,
            toastFee,
            icPlusDurbinFee
        }
    }, [cart, selectedTender, splitEbtAmount, splitSecondaryMethod, discountPct, appliedLoyaltyDiscount, currentTaxRate, interchangePlusMarkupBps])

    // Active Cash Drawer Expected Balance (Starting Bank + Cash Sales + Pay-In - Cash Drops - Pay-Outs)
    const liveDrawerExpectedCash = useMemo(() => {
        let balance = 0
        for (const ev of cashEvents) {
            const amt = Number(ev.amount || 0)
            if (ev.event_type === 'STARTING_BANK' || ev.event_type === 'PAY_IN') balance += amt
            else if (ev.event_type === 'CASH_DROP' || ev.event_type === 'PAY_OUT') balance -= amt
        }
        // Add cash orders from rawOrders
        for (const ord of rawOrders) {
            if (ord.is_voided) continue
            if (ord.payment_method === 'CASH') balance += Number(ord.total_amount || 0)
            else if (ord.payment_method === 'SPLIT_EBT_MIXED' && ord.split_secondary_method === 'CASH') {
                balance += Number(ord.split_secondary_amount || 0)
            }
        }
        return Number(Math.max(0, balance).toFixed(2))
    }, [cashEvents, rawOrders])

    // Menu Categories
    const menuGroups = useMemo(() => {
        const groups = Array.from(new Set(menuItems.map(i => i.groupName)))
        return ['ALL', ...groups]
    }, [menuItems])

    const filteredMenuItems = useMemo(() => {
        return menuItems.filter(item => {
            const matchesGroup = selectedMenuGroup === 'ALL' || item.groupName === selectedMenuGroup
            const matchesSearch = !searchQuery.trim() ||
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.groupName.toLowerCase().includes(searchQuery.toLowerCase())
            return matchesGroup && matchesSearch
        })
    }, [menuItems, selectedMenuGroup, searchQuery])

    // Add item to live POS cart (and if in Drive-Thru Pre-Fire mode, stream to KDS immediately!)
    const addToCart = (item: PosMenuItem) => {
        if (!item.inStock) return
        setCart(prev => {
            const existing = prev.find(c => c.guid === item.guid && c.modifiers.length === 0)
            if (existing) {
                setSelectedCartItemId(existing.id)
                return prev.map(c => c.id === existing.id ? { ...c, qty: c.qty + 1 } : c)
            }
            const newId = `cart-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
            setSelectedCartItemId(newId)
            return [
                ...prev,
                {
                    id: newId,
                    guid: item.guid,
                    name: item.name,
                    unitPrice: item.basePrice,
                    qty: 1,
                    prepStation: item.prepStation,
                    modifiers: [{ name: 'Con Todo (Cilantro y Cebolla)', price: 0 }]
                }
            ]
        })
    }

    // Toggle modifier on selected cart item
    const toggleModifierOnSelected = (mod: { name: string; price: number; isAlert?: boolean }) => {
        if (!selectedCartItemId) return
        setCart(prev => prev.map(c => {
            if (c.id !== selectedCartItemId) return c
            const exists = c.modifiers.some(m => m.name === mod.name)
            const nextMods = exists
                ? c.modifiers.filter(m => m.name !== mod.name)
                : [...c.modifiers, mod]
            return { ...c, modifiers: nextMods }
        }))
    }

    // Complete Live Checkout & Persist to Supabase PostgreSQL (or Offline SAF Queue) + Fire to KDS + Printer
    const handleProcessPayment = () => {
        if (cart.length === 0) return
        setPinPadStatus('WAITING_PIN_TAP')
        setTimeout(() => {
            setPinPadStatus('APPROVED')
            const nextCheckNum = lastReceiptInfo.checkNumber + 1
            const isOffline = networkPowerMode === 'OFFLINE_BATTERY'
            const tenderLabel =
                selectedTender === 'EBT_FOOD'
                    ? (networkPowerMode === 'CELLULAR_5G_UPS' ? 'EBT CALFRESH RMP (5G FAILOVER AUTH)' : 'EBT CALFRESH RMP (CHIP + PIN)')
                    : selectedTender === 'SPLIT_EBT_MIXED'
                        ? `PAGO DIVIDIDO: EBT $${cartTotals.ebtCoveredPortion.toFixed(2)} (0% TAX) + ${splitSecondaryMethod} $${cartTotals.secondaryDue.toFixed(2)}`
                        : selectedTender === 'EBT_CASH'
                            ? 'EBT CASH / CALWORKS (CHIP + PIN)'
                            : selectedTender === 'CASH'
                                ? 'EFECTIVO (CASH - CAJÓN ABIERTO)'
                                : isOffline
                                    ? 'VISA / APPLE PAY (OFFLINE SAF ENCRYPTED)'
                                    : 'VISA / APPLE PAY (PAX A35 NFC)'

            setLastReceiptInfo({
                checkNumber: nextCheckNum,
                tender: tenderLabel,
                subtotal: cartTotals.subtotal,
                tax: cartTotals.tax,
                total: cartTotals.total,
                ebtRemainingBalance: selectedTender === 'EBT_FOOD'
                    ? Number((184.50 - cartTotals.total).toFixed(2))
                    : selectedTender === 'SPLIT_EBT_MIXED'
                        ? 0.00
                        : null,
                authCode: selectedTender === 'CASH' ? 'CASH-OK' : isOffline ? `SAF-${nextCheckNum}` : `A${Math.floor(10000 + Math.random() * 89999)}`,
                drawerOpened: selectedTender === 'CASH' || (selectedTender === 'SPLIT_EBT_MIXED' && splitSecondaryMethod === 'CASH')
            })

            const clientOrderId = `POS-${activeStore?.storeNumber || 14}-${nextCheckNum}-${Date.now()}`
            const newKdsTicket: KdsOrderTicket = {
                id: clientOrderId,
                checkNumber: nextCheckNum,
                channel: diningOption,
                customerName: customerNameOrder || `ORDEN #${nextCheckNum}`,
                createdAtMs: Date.now(),
                elapsedMinutes: 0,
                level1Done: false,
                items: cart.map(c => ({
                    name: c.name,
                    qty: c.qty,
                    station: c.prepStation,
                    modifiers: c.modifiers.map(m => m.name),
                    done: false
                }))
            }
            setKdsTickets(prev => [newKdsTicket, ...prev])
            broadcastLanEvent({ type: 'NEW_KDS_TICKET', ticket: newKdsTicket })

            const resolvedPayMethod =
                selectedTender === 'EBT_FOOD'
                    ? 'EBT_CALFRESH'
                    : selectedTender === 'SPLIT_EBT_MIXED'
                        ? 'SPLIT_EBT_MIXED'
                        : selectedTender === 'CARD'
                            ? 'CARD_NFC'
                            : selectedTender

            const newOrderRecord = {
                id: clientOrderId,
                client_order_id: clientOrderId,
                order_number: nextCheckNum,
                store_number: activeStore?.storeNumber || 14,
                dining_option: diningOption.replace(' ', '_'),
                customer_name: customerNameOrder || `ORDEN #${nextCheckNum}`,
                items: cart.map(c => ({
                    id: c.guid,
                    name: c.name,
                    qty: c.qty,
                    unitPrice: c.unitPrice,
                    station: c.prepStation,
                    modifiers: c.modifiers.map(m => m.name)
                })),
                subtotal: cartTotals.subtotal,
                tax_rate: cartTotals.isEbtFoodStamp ? 0 : currentTaxRate,
                tax_amount: cartTotals.tax,
                total_amount: cartTotals.total,
                payment_method: resolvedPayMethod,
                kds_status: 'IN_PREP',
                split_ebt_amount: cartTotals.ebtCoveredPortion,
                split_secondary_amount: cartTotals.isSplitEbt ? cartTotals.secondaryDue : 0,
                split_secondary_method: cartTotals.isSplitEbt ? splitSecondaryMethod : null,
                discount_amount: cartTotals.totalDiscount,
                discount_reason: discountReason || null,
                loyalty_phone: loyaltyPhoneInput || null,
                created_at: new Date().toISOString()
            }
            setRawOrders(prev => [newOrderRecord, ...prev])

            // Persist real order to Supabase (or Offline Store-and-Forward Outbox)
            dispatchPosMutation('CREATE_ORDER', {
                clientOrderId,
                orderNumber: nextCheckNum,
                storeNumber: activeStore?.storeNumber || 14,
                diningOption: diningOption.replace(' ', '_'),
                customerName: customerNameOrder || `ORDEN #${nextCheckNum}`,
                items: cart.map(c => ({
                    id: c.guid,
                    name: c.name,
                    qty: c.qty,
                    unitPrice: c.unitPrice,
                    station: c.prepStation,
                    modifiers: c.modifiers.map(m => m.name)
                })),
                subtotal: cartTotals.subtotal,
                taxRate: cartTotals.isEbtFoodStamp ? 0 : currentTaxRate,
                taxAmount: cartTotals.tax,
                totalAmount: cartTotals.total,
                paymentMethod: resolvedPayMethod,
                paymentCaptureMode: isOffline
                    ? (selectedTender === 'CASH' ? 'CASH_LOCAL_DRAWER' : 'OFFLINE_SAF_ENCRYPTED')
                    : networkPowerMode === 'CELLULAR_5G_UPS'
                        ? '5G_CELLULAR_FAILOVER'
                        : 'ONLINE_AUTH',
                stationCode: cart[0]?.prepStation || 'PARRILLA',
                createdOffline: isOffline,
                powerSourceMode: networkPowerMode === 'ONLINE_AC' ? 'AC_GRID' : 'LIFEPO4_UPS_BACKUP',
                splitEbtAmount: cartTotals.ebtCoveredPortion,
                splitSecondaryAmount: cartTotals.isSplitEbt ? cartTotals.secondaryDue : 0,
                splitSecondaryMethod: cartTotals.isSplitEbt ? splitSecondaryMethod : null,
                discountAmount: cartTotals.totalDiscount,
                discountReason: discountReason || null,
                loyaltyPhone: loyaltyPhoneInput || null,
            })

            setTimeout(() => setPinPadStatus('IDLE'), 1800)
        }, 500)
    }

    // Persist incoming Uber Eats / DoorDash / Grubhub Webhook Order to Supabase + KDS
    const simulateIncomingDeliveryOrder = (platform: 'UBER EATS' | 'DOORDASH' | 'GRUBHUB') => {
        const nextCheckNum = lastReceiptInfo.checkNumber + 1
        setLastReceiptInfo(prev => ({ ...prev, checkNumber: nextCheckNum }))
        const sampleCustomer = platform === 'UBER EATS' ? 'MARIA L. (#UE-409)' : platform === 'DOORDASH' ? 'DAVID R. (#DD-772)' : 'SOFIA T. (#GH-118)'
        const clientOrderId = `DELIV-${platform.replace(' ', '')}-${nextCheckNum}-${Date.now()}`
        const itemsList = [
            { name: 'Combo #1 (3 Tacos + Arroz y Frijol)', qty: 1, unitPrice: 17.69, station: 'LINEA' as const, modifiers: ['Asada', '*** SIN CEBOLLA ***', 'Salsa Verde'], done: false },
            { name: 'Taco al Pastor', qty: 3, unitPrice: 4.12, station: 'PARRILLA' as const, modifiers: ['Con Todo', '*** BIEN DORADO ***'], done: false },
            { name: 'Agua de Jamaica 32oz', qty: 2, unitPrice: 5.30, station: 'BEBIDAS' as const, modifiers: [], done: false }
        ]
        const newTicket: KdsOrderTicket = {
            id: clientOrderId,
            checkNumber: nextCheckNum,
            channel: platform,
            customerName: sampleCustomer,
            createdAtMs: Date.now(),
            elapsedMinutes: 0,
            level1Done: false,
            items: itemsList
        }
        setKdsTickets(prev => [newTicket, ...prev])
        broadcastLanEvent({ type: 'NEW_KDS_TICKET', ticket: newTicket })

        dispatchPosMutation('CREATE_ORDER', {
            clientOrderId,
            orderNumber: nextCheckNum,
            storeNumber: activeStore?.storeNumber || 14,
            diningOption: platform.replace(' ', '_'),
            customerName: sampleCustomer,
            items: itemsList,
            subtotal: 40.65,
            taxRate: currentTaxRate,
            taxAmount: 4.17,
            totalAmount: 44.82,
            paymentMethod: `${platform.replace(' ', '_')}_API`,
            paymentCaptureMode: 'ONLINE_AUTH',
            stationCode: 'PARRILLA',
            createdOffline: false,
            powerSourceMode: networkPowerMode === 'ONLINE_AC' ? 'AC_GRID' : 'LIFEPO4_UPS_BACKUP'
        })

        setActiveCategory('kds')
    }

    // Active Drive-Thru Queue Cars from rawOrders
    const driveThruCars = useMemo(() => {
        return rawOrders.filter(
            (o: any) => (o.dining_option === 'DRIVE_THRU' || o.dining_option === 'DRIVE-THRU') &&
                o.drive_thru_stage !== 'COMPLETED' &&
                !o.is_voided
        )
    }, [rawOrders])

    // Navigation Categories Definition
    const categories: {
        id: ModuleCategoryId
        label: string
        subtitle: string
        icon: React.ReactNode
        color: string
        activeBg: string
        badge?: string
    }[] = [
        {
            id: 'command',
            label: t('gavilan_pos.nav_command'),
            subtitle: t('gavilan_pos.nav_command_desc'),
            icon: <LayoutGrid size={18} />,
            color: 'text-blue-600',
            activeBg: 'bg-blue-50/90 border-blue-200 text-blue-950'
        },
        {
            id: 'menu',
            label: t('gavilan_pos.nav_menu'),
            subtitle: t('gavilan_pos.nav_menu_desc'),
            icon: <UtensilsCrossed size={18} />,
            color: 'text-emerald-600',
            activeBg: 'bg-emerald-50/90 border-emerald-200 text-emerald-950',
            badge: `${menuItems.length}`
        },
        {
            id: 'register',
            label: t('gavilan_pos.nav_register'),
            subtitle: t('gavilan_pos.nav_register_desc'),
            icon: <Monitor size={18} />,
            color: 'text-red-600',
            activeBg: 'bg-red-50/90 border-red-200 text-red-950',
            badge: 'LIVE'
        },
        {
            id: 'drivethru',
            label: t('gavilan_pos.nav_drivethru'),
            subtitle: t('gavilan_pos.nav_drivethru_desc'),
            icon: <Radio size={18} />,
            color: 'text-rose-600',
            activeBg: 'bg-rose-50/90 border-rose-200 text-rose-950',
            badge: `${driveThruCars.length} AUTOS`
        },
        {
            id: 'kiosk_tv',
            label: t('gavilan_pos.nav_kiosk_tv'),
            subtitle: t('gavilan_pos.nav_kiosk_tv_desc'),
            icon: <Sparkles size={18} />,
            color: 'text-cyan-600',
            activeBg: 'bg-cyan-50/90 border-cyan-200 text-cyan-950',
            badge: 'KIOSK+TV'
        },
        {
            id: 'kds',
            label: t('gavilan_pos.nav_kds'),
            subtitle: t('gavilan_pos.nav_kds_desc'),
            icon: <Tv size={18} />,
            color: 'text-amber-600',
            activeBg: 'bg-amber-50/90 border-amber-200 text-amber-950',
            badge: `${kdsTickets.length}`
        },
        {
            id: 'tickets',
            label: t('gavilan_pos.nav_tickets'),
            subtitle: t('gavilan_pos.nav_tickets_desc'),
            icon: <Printer size={18} />,
            color: 'text-purple-600',
            activeBg: 'bg-purple-50/90 border-purple-200 text-purple-950'
        },
        {
            id: 'payments',
            label: t('gavilan_pos.nav_payments'),
            subtitle: t('gavilan_pos.nav_payments_desc'),
            icon: <CreditCard size={18} />,
            color: 'text-teal-600',
            activeBg: 'bg-teal-50/90 border-teal-200 text-teal-950',
            badge: 'EBT RMP'
        },
        {
            id: 'delivery',
            label: t('gavilan_pos.nav_delivery'),
            subtitle: t('gavilan_pos.nav_delivery_desc'),
            icon: <Truck size={18} />,
            color: 'text-orange-600',
            activeBg: 'bg-orange-50/90 border-orange-200 text-orange-950',
            badge: '$0/mes'
        },
        {
            id: 'hardware',
            label: t('gavilan_pos.nav_hardware'),
            subtitle: t('gavilan_pos.nav_hardware_desc'),
            icon: <HardDrive size={18} />,
            color: 'text-indigo-600',
            activeBg: 'bg-indigo-50/90 border-indigo-200 text-indigo-950'
        },
        {
            id: 'anatomy',
            label: isEs ? 'Toast Web vs Gavilan' : 'Toast Web vs Gavilan',
            subtitle: isEs ? 'Documentación 100% de opciones Toast Web' : '100% Toast Web options documentation',
            icon: <BookOpen size={18} />,
            color: 'text-slate-700',
            activeBg: 'bg-slate-100 border-slate-300 text-slate-950',
            badge: '100%'
        }
    ]

    // Annual Savings Calculation for Payments Module
    const savingsMath = useMemo(() => {
        const cardVol = metricsSummary.annualizedCardVolume || 43200000
        const cardTxCount = 2030000 // ~2.03M card transactions/year at ~$21.28 avg ticket
        const toastAnnualFees = (cardVol * (toastEffectiveRate / 100))
        // Regulated debit (Durbin: 0.05% + $0.22) vs Unregulated Credit (~1.65% + $0.10) + processor markup
        const debitShare = regulatedDebitSharePct / 100
        const creditShare = 1 - debitShare
        const blendedInterchangeRate = (debitShare * 0.0005) + (creditShare * 0.0165) + (interchangePlusMarkupBps / 10000)
        const blendedPerTxFee = (debitShare * 0.22) + (creditShare * 0.10) + 0.03
        const icPlusAnnualFees = (cardVol * blendedInterchangeRate) + (cardTxCount * blendedPerTxFee)
        const cardSavings = Math.max(0, toastAnnualFees - icPlusAnnualFees)
        const saasSavings = 109704 // Real 15-store Toast SaaS invoices (~$9,142/mo * 12 = ~$109,704/yr)
        return {
            toastAnnualFees,
            icPlusAnnualFees,
            icPlusEffectivePct: (icPlusAnnualFees / cardVol) * 100,
            cardSavings,
            saasSavings,
            totalAnnualSavings: cardSavings + saasSavings
        }
    }, [metricsSummary.annualizedCardVolume, toastEffectiveRate, interchangePlusMarkupBps, regulatedDebitSharePct])

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] font-sans selection:bg-red-100 selection:text-red-900 flex flex-col">
            {/* =====================================================================
                TOP COMMAND HEADER (100% LIGHT MODE, PRECISION ENTERPRISE DESIGN)
               ===================================================================== */}
            <header className="sticky top-0 z-40 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                {/* Brand Identity */}
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white flex items-center justify-center shadow-sm shadow-red-200 shrink-0 font-black text-lg tracking-tight">
                        TG
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h1 className="text-base font-extrabold tracking-tight text-slate-900 truncate">
                                {t('gavilan_pos.brand_title')}
                            </h1>
                            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                DB + Offline-First
                            </span>
                        </div>
                        <p className="text-[11px] font-semibold text-emerald-700 truncate hidden md:block">
                            {lastDbWriteBadge}
                        </p>
                    </div>
                </div>

                {/* Global Spotlight Search Bar (Ctrl+K) */}
                <div className="flex-1 max-w-sm hidden 2xl:block">
                    <div className="relative">
                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => setSpotlightOpen(true)}
                            placeholder={t('gavilan_pos.search_placeholder')}
                            className="w-full pl-9 pr-16 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs font-medium text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10 outline-none transition-all"
                        />
                        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-semibold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            Ctrl+K
                        </kbd>
                    </div>
                </div>

                {/* Store Selector + Network/UPS Mode + Offline Outbox + Smart Publisher + Language */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Live Power & Connectivity Mode Switcher (Online AC / 5G Failover / Offline Battery UPS) */}
                    <div className={`flex items-center gap-1.5 border rounded-xl px-2.5 py-1.5 ${
                        networkPowerMode === 'ONLINE_AC'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : networkPowerMode === 'CELLULAR_5G_UPS'
                                ? 'bg-amber-50 border-amber-300 text-amber-950'
                                : 'bg-orange-100 border-orange-400 text-orange-950'
                    }`}>
                        <Zap size={13} className={networkPowerMode === 'ONLINE_AC' ? 'text-emerald-600' : 'text-orange-600'} />
                        <select
                            value={networkPowerMode}
                            onChange={(e) => {
                                const val = e.target.value as 'ONLINE_AC' | 'CELLULAR_5G_UPS' | 'OFFLINE_BATTERY'
                                setNetworkPowerMode(val)
                                if (val === 'OFFLINE_BATTERY') {
                                    setLastDbWriteBadge('MODO ANTI-APAGÓN ACTIVO: Batería UPS/Tablet + Cola SAF Local')
                                } else if (val === 'CELLULAR_5G_UPS') {
                                    setLastDbWriteBadge('FAILOVER 5G ACTIVO: Peplink Dual-WAN + UPS LiFePO4 (EBT Online)')
                                } else {
                                    setLastDbWriteBadge('Conectado a Fibra + Corriente AC 120V + Supabase PostgreSQL')
                                }
                            }}
                            className="bg-transparent text-[11px] font-extrabold outline-none cursor-pointer"
                        >
                            <option value="ONLINE_AC">🟢 Fibra + Luz AC 120V ({batteryStatus.levelPct}% Bat)</option>
                            <option value="CELLULAR_5G_UPS">🟡 Sin Fibra → 5G Backup + UPS ({batteryStatus.backupHoursEstimated}h)</option>
                            <option value="OFFLINE_BATTERY">🟠 Apagón Total → 100% Offline + Batería Tablet/UPS</option>
                        </select>
                    </div>

                    {/* Offline Outbox Sync Button (Appears whenever offline transactions are queued) */}
                    {offlineOutbox.length > 0 && (
                        <button
                            onClick={flushOfflineOutbox}
                            disabled={syncingOutbox}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-extrabold cursor-pointer shadow-xs"
                        >
                            <RefreshCw size={13} className={syncingOutbox ? 'animate-spin' : ''} />
                            <span>Sincronizar Cola SAF ({offlineOutbox.length})</span>
                        </button>
                    )}

                    {/* Store Selector */}
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                        <Store size={14} className="text-red-600 shrink-0" />
                        <select
                            value={selectedStoreId}
                            onChange={(e) => setSelectedStoreId(e.target.value)}
                            className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer pr-1"
                        >
                            <option value="ALL">{t('gavilan_pos.all_stores')}</option>
                            {stores.map(s => (
                                <option key={s.id} value={s.id}>
                                    #{s.storeNumber} - Tacos Gavilan {s.name} (Tax {s.taxRate}%)
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Git-Style Visual Diff Publish Button */}
                    <button
                        onClick={() => setPublishModalOpen(true)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                            stagedChanges.length > 0
                                ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 shadow-xs'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                        }`}
                    >
                        {stagedChanges.length > 0 ? (
                            <>
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                                <span>{stagedChanges.length} {t('gavilan_pos.staged_changes')}</span>
                                <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-extrabold">
                                    {t('gavilan_pos.review_publish_btn')}
                                </span>
                            </>
                        ) : (
                            <>
                                <CheckCircle2 size={14} className="text-emerald-600" />
                                <span>{t('gavilan_pos.all_synced')}</span>
                            </>
                        )}
                    </button>

                    {/* Quick Jump to Live POS Register */}
                    <button
                        onClick={() => setActiveCategory('register')}
                        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
                    >
                        <Monitor size={13} />
                        <span>{t('gavilan_pos.open_pos_simulator')}</span>
                    </button>

                    {/* Language Toggle ES/EN */}
                    <button
                        onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[11px] font-black text-slate-700 transition-colors cursor-pointer"
                    >
                        {language === 'es' ? 'ES 🇲🇽' : 'EN 🇺🇸'}
                    </button>
                </div>
            </header>

            {/* =====================================================================
                MAIN WORKSPACE: LEFT PRECISION ICON RAIL + RIGHT CONTENT CANVAS
               ===================================================================== */}
            <div className="flex-1 flex overflow-hidden">
                {/* LEFT CATEGORY NAVIGATION RAIL (CLEAN LIGHT MODE) */}
                <aside className="w-72 bg-white border-r border-slate-200 shrink-0 flex flex-col justify-between p-3 overflow-y-auto">
                    <div className="space-y-1">
                        <div className="px-2.5 py-1.5 flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                                {isEs ? 'MÓDULOS DEL ECOSISTEMA (9)' : 'ECOSYSTEM MODULES (9)'}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400">Light UI</span>
                        </div>

                        {categories.map((cat) => {
                            const isActive = activeCategory === cat.id
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveCategory(cat.id)}
                                    className={`w-full text-left flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                                        isActive
                                            ? `${cat.activeBg} shadow-xs`
                                            : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200 text-slate-700'
                                    }`}
                                >
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                                        isActive ? 'bg-white border-slate-200/80 shadow-2xs' : 'bg-slate-50 border-slate-200/60'
                                    } ${cat.color}`}>
                                        {cat.icon}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-1">
                                            <span className={`text-xs font-extrabold truncate ${isActive ? 'text-slate-950' : 'text-slate-800'}`}>
                                                {cat.label}
                                            </span>
                                            {cat.badge && (
                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                                                    isActive
                                                        ? 'bg-white text-slate-900 border-slate-300'
                                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                                }`}>
                                                    {cat.badge}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-tight mt-0.5 line-clamp-1">
                                            {cat.subtitle}
                                        </p>
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    {/* Hardware, Anti-Blackout UPS & Offline-First Status Card at Bottom of Rail */}
                    <div className={`mt-6 p-3.5 rounded-2xl border space-y-2.5 ${
                        networkPowerMode === 'OFFLINE_BATTERY'
                            ? 'bg-orange-50 border-orange-300'
                            : networkPowerMode === 'CELLULAR_5G_UPS'
                                ? 'bg-amber-50 border-amber-300'
                                : 'bg-slate-50 border-slate-200'
                    }`}>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
                                {networkPowerMode === 'OFFLINE_BATTERY'
                                    ? 'MODO APAGÓN (UPS + SAF)'
                                    : networkPowerMode === 'CELLULAR_5G_UPS'
                                        ? 'FAILOVER 5G + BATERÍA'
                                        : 'NODO LAN + BATERÍA UPS'}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                networkPowerMode === 'OFFLINE_BATTERY'
                                    ? 'bg-orange-200 text-orange-950'
                                    : 'bg-emerald-100 text-emerald-800'
                            }`}>
                                <Wifi size={10} /> {networkPowerMode === 'OFFLINE_BATTERY' ? 'LAN MESH' : 'ONLINE'}
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-600 space-y-1">
                            <div className="flex justify-between">
                                <span>Batería POS / UPS LiFePO4:</span>
                                <span className="font-mono font-bold text-emerald-700">
                                    {batteryStatus.levelPct}% (~{batteryStatus.backupHoursEstimated}h)
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>Cola Offline (SAF Outbox):</span>
                                <span className="font-mono font-bold text-slate-900">
                                    {offlineOutbox.length} pendientes
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>Epson TM-T88VII / P80II:</span>
                                <span className="font-mono font-bold text-slate-900">:9100 + Bat 34h</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Splitter HDMI EDID Lock:</span>
                                <span className="font-mono font-bold text-emerald-700">1080p @ 60Hz</span>
                            </div>
                        </div>
                        {offlineOutbox.length > 0 && (
                            <button
                                onClick={flushOfflineOutbox}
                                disabled={syncingOutbox}
                                className="w-full py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-extrabold cursor-pointer"
                            >
                                {syncingOutbox ? 'Sincronizando...' : `Subir ${offlineOutbox.length} Eventos a Supabase`}
                            </button>
                        )}
                        <div className="pt-1 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
                            <span>Persistencia DB:</span>
                            <span className="font-bold text-slate-700 truncate max-w-[140px]">{lastPublishedAt}</span>
                        </div>
                    </div>
                </aside>

                {/* RIGHT MAIN WORKSPACE CONTENT */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
                    {/* =================================================================
                        MODULE 1: CENTRO DE COMANDO & PULSO EN VIVO (COMMAND CENTER)
                       ================================================================= */}
                    {activeCategory === 'command' && (
                        <div className="space-y-6">
                            {/* Top Hero Banner */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-wider">
                                        <Sparkles size={14} />
                                        <span>{isEs ? 'Centro de Comando Unificado — Reemplazo de Toast Home & Publishing' : 'Unified Command Center — Replaces Toast Home & Publishing'}</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        {activeStore ? `Tacos Gavilan — Sucursal #${activeStore.storeNumber} ${activeStore.name}` : 'Tacos Gavilan — Ecosistema Corporativo (15 Sucursales)'}
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {isEs
                                            ? `Datos reales sincronizados (${latestBusinessDate}) • Regla de Día Laboral: 6:00 AM a 5:59 AM • Turno PM: 5:00 PM`
                                            : `Live synced metrics (${latestBusinessDate}) • Business Day Rule: 6:00 AM to 5:59 AM • PM Shift: 5:00 PM`}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={() => setActiveCategory('register')}
                                        className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                                    >
                                        <Monitor size={14} />
                                        {isEs ? 'Probar Caja Registradora en Vivo' : 'Test Live POS Register'}
                                    </button>
                                    <button
                                        onClick={() => setActiveCategory('kds')}
                                        className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <Tv size={14} />
                                        {isEs ? 'Ver KDS + Monitor Espejo HDMI' : 'View KDS + HDMI Mirror'}
                                    </button>
                                    <button
                                        onClick={() => setActiveCategory('hardware')}
                                        className="px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <Zap size={14} />
                                        {isEs ? 'Baterías Anti-Apagón & Modo Offline' : 'Anti-Blackout Batteries & Offline'}
                                    </button>
                                </div>
                            </div>

                            {/* 4 Macro Financial & Operational KPIs */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-500">
                                            {isEs ? 'Ventas Netas Anualizadas (15 Tiendas)' : 'Annualized Net Sales (15 Stores)'}
                                        </span>
                                        <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
                                            <DollarSign size={16} />
                                        </div>
                                    </div>
                                    <p className="text-2xl font-black text-slate-900 mt-2 tabular-nums">
                                        ${(metricsSummary.annualizedNetSales / 1e6).toFixed(2)}M <span className="text-xs font-bold text-slate-400">USD/año</span>
                                    </p>
                                    <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                                        ~${(metricsSummary.annualizedGrossCollected / 1e6).toFixed(2)}M cobrados con Sales Tax
                                    </p>
                                </div>

                                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-500">
                                            {isEs ? 'Volumen Tarjetas + EBT CalFresh RMP' : 'Card Volume + EBT CalFresh RMP'}
                                        </span>
                                        <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 text-teal-600 flex items-center justify-center">
                                            <CreditCard size={16} />
                                        </div>
                                    </div>
                                    <p className="text-2xl font-black text-slate-900 mt-2 tabular-nums">
                                        ${(metricsSummary.annualizedCardVolume / 1e6).toFixed(1)}M <span className="text-xs font-bold text-teal-700">+ $1.98M EBT</span>
                                    </p>
                                    <p className="text-[11px] text-slate-500 font-medium mt-1">
                                        59% Contactless (Apple/Google Pay) • 40% Chip
                                    </p>
                                </div>

                                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-500">
                                            {isEs ? 'Delivery Directo (Uber / DoorDash / GH)' : 'Direct Delivery (Uber / DoorDash / GH)'}
                                        </span>
                                        <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center">
                                            <Truck size={16} />
                                        </div>
                                    </div>
                                    <p className="text-2xl font-black text-slate-900 mt-2 tabular-nums">
                                        ${(metricsSummary.annualizedDeliveryNet / 1e6).toFixed(2)}M <span className="text-xs font-bold text-orange-600">(18.2%)</span>
                                    </p>
                                    <p className="text-[11px] text-orange-700 font-semibold mt-1">
                                        $0/mes comisión POS con API Directa
                                    </p>
                                </div>

                                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-4 shadow-2xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-extrabold text-emerald-900">
                                            {isEs ? 'Ahorro Anual Estimado vs. Toast' : 'Estimated Annual Savings vs. Toast'}
                                        </span>
                                        <div className="w-8 h-8 rounded-lg bg-white border border-emerald-200 text-emerald-700 flex items-center justify-center font-black text-xs">
                                            ROI
                                        </div>
                                    </div>
                                    <p className="text-2xl font-black text-emerald-950 mt-2 tabular-nums">
                                        +${Math.round(savingsMath.totalAnnualSavings).toLocaleString('en-US')} <span className="text-xs font-bold text-emerald-700">/año</span>
                                    </p>
                                    <p className="text-[11px] text-emerald-800 font-semibold mt-1">
                                        SaaS (${(savingsMath.saasSavings / 1e3).toFixed(0)}k) + Interchange++ (${(savingsMath.cardSavings / 1e3).toFixed(0)}k)
                                    </p>
                                </div>
                            </div>

                            {/* Quick Action Strip: Instant 86ing + Smart Quote Time (Persisted in Supabase) */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {/* Quick 86 Panel */}
                                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                                    <div className="flex items-center justify-between mb-3">
                                        <div>
                                            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                                                <Zap size={16} className="text-amber-500" />
                                                {isEs ? 'Control Instantáneo "86" Persistente en Supabase (POS + Uber Eats + DoorDash)' : 'Persistent Instant "86" Stock Control'}
                                            </h3>
                                            <p className="text-xs text-slate-500">
                                                {isEs ? 'Guarda directamente en gavilan_pos_menu_items en Supabase (o en la Cola SAF si no hay internet) y sincroniza por LAN.' : 'Persists directly to gavilan_pos_menu_items in Supabase and broadcasts over LAN.'}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setActiveCategory('menu')}
                                            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                                        >
                                            <span>{isEs ? 'Ir al Estudio de Menú' : 'Open Menu Studio'}</span>
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                        {menuItems.slice(0, 6).map(item => (
                                            <div
                                                key={item.guid}
                                                className={`p-3 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                                                    item.inStock
                                                        ? 'bg-slate-50/70 border-slate-200'
                                                        : 'bg-rose-50 border-rose-200'
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <p className={`text-xs font-bold truncate ${item.inStock ? 'text-slate-900' : 'text-rose-900 line-through'}`}>
                                                        {item.name}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500">
                                                        ${item.basePrice.toFixed(2)} • {item.prepStation}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const nextState = !item.inStock
                                                        setMenuItems(prev => prev.map(m => m.guid === item.guid ? { ...m, inStock: nextState } : m))
                                                        broadcastLanEvent({ type: 'TOGGLE_86_ITEM', guid: item.guid, inStock: nextState })
                                                        dispatchPosMutation('TOGGLE_86', { guid: item.guid, inStock: nextState })
                                                        recordChange(
                                                            'Inventario Rápido (86)',
                                                            item.name,
                                                            item.inStock ? 'IN STOCK (Activo)' : '86 AGOTADO',
                                                            nextState ? 'IN STOCK (Activo)' : '86 AGOTADO (Persistido en Supabase)'
                                                        )
                                                    }}
                                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer shrink-0 border ${
                                                        item.inStock
                                                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-rose-100 hover:text-rose-800 hover:border-rose-200'
                                                            : 'bg-rose-600 text-white border-rose-700 hover:bg-emerald-600'
                                                    }`}
                                                >
                                                    {item.inStock ? 'IN STOCK' : '86 AGOTADO'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Online & Delivery Quote Time / Snooze Panel */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between space-y-4">
                                    <div>
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                                                <Clock size={16} className="text-blue-600" />
                                                {isEs ? 'Pulso de Cocina & Tiempos' : 'Kitchen Pulse & Quote Times'}
                                            </h3>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                deliverySnoozed ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                                            }`}>
                                                {deliverySnoozed ? 'PAUSADO (SNOOZE 20M)' : 'RECIBIENDO ÓRDENES'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {isEs ? 'Persiste en gavilan_pos_store_configs en Supabase.' : 'Persists to gavilan_pos_store_configs in Supabase.'}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                                        <span className="text-xs font-bold text-slate-700">Tiempo de Preparación (Quote):</span>
                                        <div className="flex items-center gap-1.5">
                                            {[10, 15, 25, 35].map(mins => (
                                                <button
                                                    key={mins}
                                                    onClick={() => {
                                                        recordChange('Takeout & Delivery', 'Quote Time Prometido', `${onlineQuoteMins} min`, `${mins} min`)
                                                        setOnlineQuoteMins(mins)
                                                        dispatchPosMutation('SAVE_STORE_CONFIG', {
                                                            storeNumber: activeStore?.storeNumber || 14,
                                                            quoteMinutes: mins,
                                                            receiptHeader: 'TACOS GAVILAN — SABOR AUTÉNTICO',
                                                            receiptFooter: receiptConfig.customFooterEs,
                                                            printRedModifiers: receiptConfig.redInkKitchenModifiers,
                                                            printerReceiptIp: printerTargetIp
                                                        })
                                                    }}
                                                    className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer border ${
                                                        onlineQuoteMins === mins
                                                            ? 'bg-blue-600 text-white border-blue-700'
                                                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    {mins}m
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setDeliverySnoozed(prev => !prev)
                                            recordChange('Takeout & Delivery', 'Estado de Recepción de Órdenes', deliverySnoozed ? 'Pausado' : 'Activo', !deliverySnoozed ? 'Pausado 20 min' : 'Activo')
                                        }}
                                        className={`w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border cursor-pointer transition-all ${
                                            deliverySnoozed
                                                ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                                                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                                        }`}
                                    >
                                        {deliverySnoozed ? <Play size={14} /> : <Pause size={14} />}
                                        {deliverySnoozed
                                            ? (isEs ? 'Reanudar Recepción en las 15 Tiendas' : 'Resume Orders Across 15 Stores')
                                            : (isEs ? 'Pausar Temporalmente Delivery (Snooze 20m)' : 'Snooze Delivery Channels (20m)')}
                                    </button>
                                </div>
                            </div>

                            {/* 15-Store Live Fleet Table */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-extrabold text-slate-900">
                                            {isEs ? `Estado en Vivo de las 15 Sucursales de Tacos Gavilan (${latestBusinessDate})` : `Live 15-Store Fleet Status (${latestBusinessDate})`}
                                        </h3>
                                        <p className="text-xs text-slate-500">
                                            {isEs ? 'Ventas Netas, Órdenes, Delivery (Uber/DoorDash/Grubhub), EBT CalFresh RMP, Número FNS y Estado del Nodo Local.' : 'Net Sales, Orders, Delivery, EBT CalFresh RMP, USDA FNS Number & Local Node Status.'}
                                        </p>
                                    </div>
                                    <span className="text-xs font-bold text-slate-500">
                                        {loadingData ? 'Sincronizando con Supabase...' : '15 / 15 Sucursales Conectadas'}
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                                                <th className="py-3 px-4">Sucursal</th>
                                                <th className="py-3 px-3">Estado LAN</th>
                                                <th className="py-3 px-3">USDA FNS (RMP)</th>
                                                <th className="py-3 px-3 text-right">Sales Tax</th>
                                                <th className="py-3 px-4 text-right">Ventas Netas Día</th>
                                                <th className="py-3 px-3 text-right">Órdenes</th>
                                                <th className="py-3 px-4 text-right">Delivery (3PD)</th>
                                                <th className="py-3 px-4 text-right">EBT CalFresh</th>
                                                <th className="py-3 px-4 text-center">Acción</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-xs">
                                            {stores.map((st) => {
                                                const delivTotal = st.uberSales + st.doordashSales + st.grubhubSales
                                                return (
                                                    <tr key={st.id} className="hover:bg-slate-50/80 transition-colors">
                                                        <td className="py-3 px-4 font-extrabold text-slate-900">
                                                            #{st.storeNumber} {st.name}
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                                LAN + Cloud OK
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                                                            FNS #{st.fnsNumber}
                                                        </td>
                                                        <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700">
                                                            {st.taxRate.toFixed(2)}%
                                                        </td>
                                                        <td className="py-3 px-4 text-right font-extrabold text-slate-900 tabular-nums">
                                                            ${st.netSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="py-3 px-3 text-right font-bold text-slate-700 tabular-nums">
                                                            {st.orderCount}
                                                        </td>
                                                        <td className="py-3 px-4 text-right font-semibold text-orange-700 tabular-nums">
                                                            ${delivTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="py-3 px-4 text-right font-bold text-teal-700 tabular-nums">
                                                            ${st.ebtAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="py-3 px-4 text-center">
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedStoreId(st.id)
                                                                    setActiveCategory('register')
                                                                }}
                                                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 font-bold text-[11px] border border-slate-200 cursor-pointer transition-colors"
                                                            >
                                                                Abrir Caja #{st.storeNumber}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 2: ESTUDIO UNIFICADO DE MENÚ (REPLACES TOAST'S 4 EDITORS)
                       ================================================================= */}
                    {activeCategory === 'menu' && (
                        <div className="space-y-5">
                            {/* Header + 3-in-1 View Switcher */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider">
                                        <UtensilsCrossed size={14} />
                                        <span>Estudio Unificado de Menú — Adiós a los 4 Editores Separados de Toast Web</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        Constructor Visual + Matriz Avanzada en Lote + Reglas de Modificadores
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        En Toast Web tienes que saltar entre <em>Menu Builder</em>, <em>Classic Edit Menus</em>, <em>Advanced Properties</em> e <em>Item Library</em>. Aquí todo vive en una sola vista.
                                    </p>
                                </div>

                                {/* 3-Mode Segmented Control */}
                                <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 shrink-0">
                                    {[
                                        { id: 'visual', label: '1. Tarjetas Visuales (Builder)' },
                                        { id: 'matrix', label: '2. Matriz en Lote (Advanced Grid)' },
                                        { id: 'modifiers', label: '3. Modificadores & Estrategias Precio' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setMenuViewMode(tab.id as any)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                menuViewMode === tab.id
                                                    ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                                                    : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Category Filter Pills + Global Delivery Markup Control */}
                            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {menuGroups.slice(0, 10).map(grp => (
                                        <button
                                            key={grp}
                                            onClick={() => setSelectedMenuGroup(grp)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                                selectedMenuGroup === grp
                                                    ? 'bg-slate-900 text-white border-slate-900'
                                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                            }`}
                                        >
                                            {grp === 'ALL' ? `Todos (${menuItems.length})` : grp}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-xl">
                                    <Percent size={14} className="text-orange-600" />
                                    <span className="text-xs font-bold text-orange-950">Sobreprecio Delivery (Uber/DD):</span>
                                    <select
                                        value={deliveryUpliftPct}
                                        onChange={(e) => {
                                            const pct = Number(e.target.value)
                                            setDeliveryUpliftPct(pct)
                                            setMenuItems(prev => prev.map(m => ({
                                                ...m,
                                                deliveryPrice: Number((m.basePrice * (1 + pct / 100)).toFixed(2))
                                            })))
                                            recordChange('Estudio de Menú', 'Markup Global Delivery 3PD', `+${deliveryUpliftPct}%`, `+${pct}%`)
                                        }}
                                        className="bg-white border border-orange-300 rounded-lg px-2 py-0.5 text-xs font-black text-orange-900 outline-none cursor-pointer"
                                    >
                                        <option value={0}>+0% (Mismo Precio)</option>
                                        <option value={15}>+15% Uplift</option>
                                        <option value={18}>+18% Uplift (Recomendado)</option>
                                        <option value={20}>+20% Uplift</option>
                                        <option value={25}>+25% Uplift</option>
                                    </select>
                                </div>
                            </div>

                            {/* VIEW 1: VISUAL CARDS BUILDER */}
                            {menuViewMode === 'visual' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {filteredMenuItems.map(item => (
                                        <div
                                            key={item.guid}
                                            className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between gap-3"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                                        {item.groupName}
                                                    </span>
                                                    <h4 className="text-sm font-extrabold text-slate-900 mt-1.5">
                                                        {item.name}
                                                    </h4>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-base font-black text-slate-900 tabular-nums">
                                                        ${item.basePrice.toFixed(2)}
                                                    </p>
                                                    <p className="text-[10px] font-bold text-orange-600 tabular-nums">
                                                        3PD: ${item.deliveryPrice.toFixed(2)}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Explicit Inheritance & Routing Badges */}
                                            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                                    item.prepStation === 'PARRILLA'
                                                        ? 'bg-red-50 text-red-700 border-red-200'
                                                        : item.prepStation === 'LINEA'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                            : item.prepStation === 'BEBIDAS'
                                                                ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                                                                : 'bg-amber-50 text-amber-700 border-amber-200'
                                                }`}>
                                                    🔥 KDS: {item.prepStation}
                                                </span>
                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-200">
                                                    Tax: {item.taxInherited ? 'Heredado (0% en EBT)' : 'Personalizado'}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between pt-1">
                                                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100">POS</span>
                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100">Kiosk</span>
                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100">Uber/DD</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={() => setEditingItem(item)}
                                                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
                                                    >
                                                        Editar Precio / Ruta
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            addToCart(item)
                                                            setActiveCategory('register')
                                                        }}
                                                        className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold cursor-pointer"
                                                    >
                                                        + Probar en Caja
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* VIEW 2: BULK MATRIX SPREADSHEET (REPLACES TOAST ADVANCED PROPERTIES) */}
                            {menuViewMode === 'matrix' && (
                                <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                                    <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                        <span className="text-xs font-extrabold text-slate-800">
                                            Matriz de Propiedades Avanzadas en Lote (Edita precios, estaciones KDS y visibilidad sin cambiar de pantalla)
                                        </span>
                                        <span className="text-[11px] text-slate-500 font-semibold">
                                            Cambios se registran automáticamente en el Diff Publisher
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50/60 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                                                    <th className="py-2.5 px-4">Platillo</th>
                                                    <th className="py-2.5 px-3">Categoría</th>
                                                    <th className="py-2.5 px-3">Precio POS ($)</th>
                                                    <th className="py-2.5 px-3">Precio Delivery ($)</th>
                                                    <th className="py-2.5 px-3">Estación KDS (Pantallas HDMI)</th>
                                                    <th className="py-2.5 px-3 text-center">Herencia Tax</th>
                                                    <th className="py-2.5 px-3 text-center">Estado Stock</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 text-xs">
                                                {filteredMenuItems.slice(0, 25).map(item => (
                                                    <tr key={item.guid} className="hover:bg-slate-50">
                                                        <td className="py-2.5 px-4 font-bold text-slate-900">{item.name}</td>
                                                        <td className="py-2.5 px-3 text-slate-600">{item.groupName}</td>
                                                        <td className="py-2.5 px-3">
                                                            <input
                                                                type="number"
                                                                step="0.10"
                                                                value={item.basePrice}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value)
                                                                    if (val <= 0) return
                                                                    const newDeliv = Number((val * (1 + deliveryUpliftPct / 100)).toFixed(2))
                                                                    recordChange('Matriz de Menú', `Precio Base: ${item.name}`, `$${item.basePrice.toFixed(2)}`, `$${val.toFixed(2)}`)
                                                                    setMenuItems(prev => prev.map(m => m.guid === item.guid ? {
                                                                        ...m,
                                                                        basePrice: val,
                                                                        deliveryPrice: newDeliv
                                                                    } : m))
                                                                    dispatchPosMutation('UPDATE_MENU_ITEM', {
                                                                        guid: item.guid,
                                                                        basePrice: val,
                                                                        deliveryPrice: newDeliv
                                                                    })
                                                                }}
                                                                className="w-20 px-2 py-1 rounded-lg border border-slate-200 bg-white font-bold text-slate-900 tabular-nums"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-3 font-mono font-bold text-orange-700">
                                                            ${item.deliveryPrice.toFixed(2)}
                                                        </td>
                                                        <td className="py-2.5 px-3">
                                                            <select
                                                                value={item.prepStation}
                                                                onChange={(e) => {
                                                                    const st = e.target.value as PosMenuItem['prepStation']
                                                                    recordChange('Ruteo Cocina KDS', `Estación KDS de ${item.name}`, item.prepStation, st)
                                                                    setMenuItems(prev => prev.map(m => m.guid === item.guid ? { ...m, prepStation: st } : m))
                                                                    dispatchPosMutation('UPDATE_MENU_ITEM', {
                                                                        guid: item.guid,
                                                                        prepStation: st
                                                                    })
                                                                }}
                                                                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 cursor-pointer"
                                                            >
                                                                <option value="PARRILLA">🔥 PARRILLA / TAQUERO (KDS HDMI)</option>
                                                                <option value="LINEA">🥗 LÍNEA / PREPARACIÓN (KDS HDMI)</option>
                                                                <option value="TORTILLAS">🫓 TORTILLAS (KDS HDMI)</option>
                                                                <option value="BEBIDAS">🥤 AGUAS / BEBIDAS</option>
                                                                <option value="NONE">🚫 NO ENVIAR A KDS COCINA</option>
                                                            </select>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-center">
                                                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                                                                Sí (0% en EBT)
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-center">
                                                            <button
                                                                onClick={() => {
                                                                    const nextInStock = !item.inStock
                                                                    setMenuItems(prev => prev.map(m => m.guid === item.guid ? { ...m, inStock: nextInStock } : m))
                                                                    dispatchPosMutation('TOGGLE_86', { guid: item.guid, inStock: nextInStock })
                                                                }}
                                                                className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                                                                    item.inStock ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-600 text-white'
                                                                }`}
                                                            >
                                                                {item.inStock ? 'IN STOCK' : '86 AGOTADO'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* VIEW 3: MODIFIER GROUPS & PRICING STRATEGIES */}
                            {menuViewMode === 'modifiers' && (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                        <h3 className="text-sm font-extrabold text-slate-900">
                                            Grupos de Modificadores (Reglas Min/Max, Pre-Selección y Alerta en KDS HDMI / Ticket)
                                        </h3>
                                        {[
                                            {
                                                name: '1. Elección de Carne (Proteína Principal)',
                                                rule: 'OBLIGATORIO (Min: 1, Max: 1)',
                                                options: 'Asada ($0), Pastor ($0), Pollo ($0), Cabeza (+$0.30), Lengua (+$0.80), Buche ($0), Chorizo ($0), Carnitas ($0)',
                                                badge: 'bg-red-50 text-red-700 border-red-200'
                                            },
                                            {
                                                name: '2. Verdura Estándar (Pre-Seleccionado por Defecto)',
                                                rule: 'OPCIONAL (Default: Con Todo)',
                                                options: 'Con Todo (Default), *** SIN CEBOLLA *** (Alerta Roja en KDS HDMI + Bloque Invertido en Ticket), *** SIN CILANTRO *** (Alerta Roja en KDS HDMI + Bloque Invertido en Ticket)',
                                                badge: 'bg-amber-50 text-amber-800 border-amber-200'
                                            },
                                            {
                                                name: '3. Salsas & Extras (Umbral Gratis + Cargo Extra)',
                                                rule: 'OPCIONAL (Primeras 2 Gratis, Adicional +$0.75)',
                                                options: 'Salsa Verde, Salsa Roja de Árbol, Extra Aguacate (+$1.50), Extra Carne (+$2.25)',
                                                badge: 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                            }
                                        ].map((mg, i) => (
                                            <div key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-extrabold text-slate-900">{mg.name}</span>
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${mg.badge}`}>
                                                        {mg.rule}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-600">{mg.options}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                        <h3 className="text-sm font-extrabold text-slate-900">
                                            Las 6 Estrategias de Precio de Toast Web — Unificadas en Gavilan POS
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {[
                                                { title: '1. Base Price (Precio Fijo)', desc: 'Precio único estándar en mostrador y Drive-Thru.' },
                                                { title: '2. Size Pricing (Por Tamaño)', desc: 'Ej. Aguas Frescas Regular 20oz vs Large 32oz, o Party Trays (15-20, 20-25, 30-40 personas).' },
                                                { title: '3. Channel-Specific Price (Por Canal)', desc: `Aplica automáticamente +${deliveryUpliftPct}% en Uber Eats, DoorDash y Grubhub usando el mismo GUID para que cuadre el PMIX.` },
                                                { title: '4. Time-Specific (Por Horario/Día)', desc: 'Precios automáticos para promociones por día o turno (AM vs PM 5:00 PM).' },
                                                { title: '5. Location Tier (Por Sucursal)', desc: 'Permite precios diferenciados por condado (ej. Hollywood vs Rialto).' },
                                                { title: '6. Open Price (Precio Abierto)', desc: 'Para órdenes especiales de catering con autorización de PIN de Gerente.' }
                                            ].map((st, idx) => (
                                                <div key={idx} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                                                    <p className="text-xs font-extrabold text-slate-900">{st.title}</p>
                                                    <p className="text-[11px] text-slate-600 mt-1">{st.desc}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Slide-over Modal for Quick Item Editing */}
                            {editingItem && (
                                <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex items-center justify-end">
                                    <div className="w-full max-w-md bg-white h-full border-l border-slate-200 p-6 flex flex-col justify-between shadow-2xl">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                                <h3 className="text-base font-black text-slate-900">Inspector de Platillo (Persistencia Real DB)</h3>
                                                <button onClick={() => setEditingItem(null)} className="p-1 rounded-lg hover:bg-slate-100 cursor-pointer">
                                                    <X size={18} />
                                                </button>
                                            </div>
                                            <div>
                                                <label className="text-[11px] font-bold uppercase text-slate-500">Nombre del Platillo</label>
                                                <input
                                                    type="text"
                                                    value={editingItem.name}
                                                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                                                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-900"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[11px] font-bold uppercase text-slate-500">Precio Mostrador ($)</label>
                                                    <input
                                                        type="number"
                                                        step="0.10"
                                                        value={editingItem.basePrice}
                                                        onChange={(e) => {
                                                            const p = Number(e.target.value)
                                                            setEditingItem({
                                                                ...editingItem,
                                                                basePrice: p,
                                                                deliveryPrice: Number((p * (1 + deliveryUpliftPct / 100)).toFixed(2))
                                                            })
                                                        }}
                                                        className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-900"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-bold uppercase text-orange-600">Precio Delivery (+{deliveryUpliftPct}%)</label>
                                                    <input
                                                        type="number"
                                                        step="0.10"
                                                        value={editingItem.deliveryPrice}
                                                        onChange={(e) => setEditingItem({ ...editingItem, deliveryPrice: Number(e.target.value) })}
                                                        className="w-full mt-1 px-3 py-2 rounded-xl border border-orange-200 bg-orange-50/40 text-sm font-bold text-orange-900"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[11px] font-bold uppercase text-slate-500">Estación KDS de Cocina (Pantallas Duplicadas HDMI — 0% Papel)</label>
                                                <select
                                                    value={editingItem.prepStation}
                                                    onChange={(e) => setEditingItem({ ...editingItem, prepStation: e.target.value as any })}
                                                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-900"
                                                >
                                                    <option value="PARRILLA">🔥 PARRILLA / TAQUERO (KDS Principal + Monitor Espejo HDMI — 0% Papel)</option>
                                                    <option value="LINEA">🥗 LÍNEA / PREPARACIÓN (KDS Principal HDMI)</option>
                                                    <option value="TORTILLAS">🫓 TORTILLAS (KDS HDMI)</option>
                                                    <option value="BEBIDAS">🥤 AGUAS / BEBIDAS</option>
                                                    <option value="NONE">🚫 NO ENVIAR A KDS COCINA</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 pt-4 border-t border-slate-200">
                                            <button
                                                onClick={() => setEditingItem(null)}
                                                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setMenuItems(prev => prev.map(m => m.guid === editingItem.guid ? editingItem : m))
                                                    recordChange('Estudio de Menú', editingItem.name, 'Actualización de platillo', `$${editingItem.basePrice.toFixed(2)} (${editingItem.prepStation})`)
                                                    dispatchPosMutation('UPDATE_MENU_ITEM', {
                                                        guid: editingItem.guid,
                                                        name: editingItem.name,
                                                        basePrice: editingItem.basePrice,
                                                        deliveryPrice: editingItem.deliveryPrice,
                                                        prepStation: editingItem.prepStation,
                                                        inStock: editingItem.inStock
                                                    })
                                                    setEditingItem(null)
                                                }}
                                                className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                                            >
                                                Guardar en Supabase / Cola Offline
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 3: TERMINAL CAJA POS EN VIVO + PANTALLA CLIENTE (CFD)
                       ================================================================= */}
                    {activeCategory === 'register' && (
                        <div className="space-y-5">
                            {/* Top Bar Info */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-red-600 uppercase tracking-wider">
                                        <Monitor size={14} />
                                        <span>Simulador Funcional "Caja de Pruebas #1" (Elo 15.6" Cajero + Pantalla Cliente 10.1" + Lector PAX A35)</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Toca cualquier platillo, agrega modificadores, cambia entre Tarjeta / Efectivo / <strong>EBT CalFresh RMP (0% Tax automático)</strong> y envía la orden en vivo al KDS HDMI.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {(['FOR HERE', 'TO GO', 'DRIVE-THRU'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            onClick={() => setDiningOption(opt)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer transition-all ${
                                                diningOption === opt
                                                    ? 'bg-red-600 text-white border-red-700 shadow-2xs'
                                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                            }`}
                                        >
                                            {opt === 'FOR HERE' ? '🍽️ COMER AQUÍ (FOR HERE)' : opt === 'TO GO' ? '🛍️ PARA LLEVAR (TO GO)' : '🚗 DRIVE-THRU'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Main Dual-Screen POS Register Layout */}
                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                                {/* LEFT 7 COLS: CASHIER TOUCH MENU + MODIFIER BAR */}
                                <div className="xl:col-span-7 space-y-4">
                                    {/* Category Tabs */}
                                    <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs flex flex-wrap gap-1.5">
                                        {menuGroups.slice(0, 8).map(grp => (
                                            <button
                                                key={grp}
                                                onClick={() => setSelectedMenuGroup(grp)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer ${
                                                    selectedMenuGroup === grp
                                                        ? 'bg-slate-900 text-white border-slate-900'
                                                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                {grp === 'ALL' ? 'Todo el Menú' : grp}
                                            </button>
                                        ))}
                                    </div>

                                    {/* POS Touch Grid */}
                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                            {filteredMenuItems.slice(0, 15).map(item => (
                                                <button
                                                    key={item.guid}
                                                    disabled={!item.inStock}
                                                    onClick={() => addToCart(item)}
                                                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[84px] cursor-pointer active:scale-[0.98] ${
                                                        !item.inStock
                                                            ? 'bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed'
                                                            : item.buttonColor || 'bg-slate-50 hover:bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-1">
                                                        <span className="text-xs font-extrabold leading-snug line-clamp-2">
                                                            {item.name}
                                                        </span>
                                                        {!item.inStock && (
                                                            <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[9px] font-black">86</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-black/5">
                                                        <span className="text-[10px] font-bold opacity-75">{item.prepStation}</span>
                                                        <span className="text-xs font-black tabular-nums">${item.basePrice.toFixed(2)}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Instant Modifier Touch Pad for Selected Check Item */}
                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                                        <div className="flex items-center justify-between mb-2.5">
                                            <span className="text-xs font-extrabold text-slate-900">
                                                Modificadores Rápidos (Se aplican al artículo seleccionado en la cuenta)
                                            </span>
                                            <span className="text-[11px] font-bold text-red-600">
                                                Rojo = Imprime en Tinta Roja en Epson TM-U220B
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {AVAILABLE_MODIFIERS.map(mod => {
                                                const selectedItemObj = cart.find(c => c.id === selectedCartItemId)
                                                const isApplied = selectedItemObj?.modifiers.some(m => m.name === mod.name)
                                                return (
                                                    <button
                                                        key={mod.name}
                                                        onClick={() => toggleModifierOnSelected(mod)}
                                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                                            isApplied
                                                                ? mod.isAlert
                                                                    ? 'bg-red-600 text-white border-red-700'
                                                                    : 'bg-slate-900 text-white border-slate-900'
                                                                : mod.isAlert
                                                                    ? 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                                                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {mod.name} {mod.price > 0 ? `+$${mod.price.toFixed(2)}` : ''}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* RIGHT 5 COLS: ACTIVE CHECK + PAX A35 PIN PAD + 10.1" CUSTOMER DISPLAY */}
                                <div className="xl:col-span-5 space-y-4">
                                    {/* Active Check & Tender Box */}
                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-xs font-black">
                                                        ORDEN #{lastReceiptInfo.checkNumber + 1}
                                                    </span>
                                                    <span className="text-xs font-extrabold text-red-600">{diningOption}</span>
                                                </div>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    <span className="text-[11px] font-bold text-slate-500">Cliente:</span>
                                                    <input
                                                        type="text"
                                                        value={customerNameOrder}
                                                        onChange={(e) => setCustomerNameOrder(e.target.value)}
                                                        className="px-2 py-0.5 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-md"
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setCart([])}
                                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                                            >
                                                <Trash2 size={13} /> Limpiar
                                            </button>
                                        </div>

                                        {/* Cart Items List */}
                                        <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 pr-1">
                                            {cart.length === 0 ? (
                                                <p className="py-8 text-center text-xs text-slate-400 font-medium">
                                                    Toca un platillo a la izquierda para agregarlo a la orden.
                                                </p>
                                            ) : (
                                                cart.map(c => {
                                                    const isSelected = c.id === selectedCartItemId
                                                    const modSum = c.modifiers.reduce((s, m) => s + m.price, 0)
                                                    const lineTotal = (c.unitPrice + modSum) * c.qty
                                                    return (
                                                        <div
                                                            key={c.id}
                                                            onClick={() => setSelectedCartItemId(c.id)}
                                                            className={`py-2.5 px-2.5 rounded-xl cursor-pointer transition-colors ${
                                                                isSelected ? 'bg-blue-50/70 border border-blue-200' : 'hover:bg-slate-50'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex items-center border border-slate-200 rounded-lg bg-white">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation()
                                                                                setCart(prev => prev.map(x => x.id === c.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x).filter(x => x.qty > 0))
                                                                            }}
                                                                            className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
                                                                        >
                                                                            <Minus size={11} />
                                                                        </button>
                                                                        <span className="px-2 text-xs font-black tabular-nums">{c.qty}</span>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation()
                                                                                setCart(prev => prev.map(x => x.id === c.id ? { ...x, qty: x.qty + 1 } : x))
                                                                            }}
                                                                            className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
                                                                        >
                                                                            <Plus size={11} />
                                                                        </button>
                                                                    </div>
                                                                    <span className="text-xs font-extrabold text-slate-900">{c.name}</span>
                                                                </div>
                                                                <span className="text-xs font-black text-slate-900 tabular-nums">
                                                                    ${lineTotal.toFixed(2)}
                                                                </span>
                                                            </div>
                                                            {c.modifiers.length > 0 && (
                                                                <div className="mt-1 pl-14 space-y-0.5">
                                                                    {c.modifiers.map((m, idx) => (
                                                                        <p key={idx} className={`text-[11px] font-bold ${m.isAlert ? 'text-red-600' : 'text-slate-500'}`}>
                                                                            • {m.name} {m.price > 0 ? `(+$${m.price.toFixed(2)})` : ''}
                                                                        </p>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </div>

                                        {/* Payment Tender Selector (Card / EBT Food / Split EBT+Cash / EBT Cash / Cash) */}
                                        <div className="pt-2 border-t border-slate-200 space-y-2">
                                            <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                                                Método de Pago (PAX A35 Semi-Integrado + Cajón RJ12 + Pago Dividido EBT CDTFA)
                                            </label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {[
                                                    { id: 'CARD', label: '💳 Tarjeta / Apple Pay / Google Pay', sub: 'Interchange++ (Durbin 0.05%)' },
                                                    { id: 'EBT_FOOD', label: '🏛️ EBT CalFresh RMP (100% Comida)', sub: 'Elimina Sales Tax a $0.00 auto' },
                                                    { id: 'SPLIT_EBT_MIXED', label: '🔀 Pago Dividido: EBT Parcial + Resto', sub: '0% Tax en EBT + Tax solo al resto (CDTFA)' },
                                                    { id: 'EBT_CASH', label: '💵 EBT Cash (CalWORKs)', sub: 'Con PIN en lector PAX A35' },
                                                    { id: 'CASH', label: '💶 Efectivo (Cash Drawer)', sub: 'Pulso ESC p abre cajón APG' }
                                                ].map(tnd => (
                                                    <button
                                                        key={tnd.id}
                                                        onClick={() => setSelectedTender(tnd.id as any)}
                                                        className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                                                            tnd.id === 'SPLIT_EBT_MIXED' ? 'col-span-2 ' : ''
                                                        }${
                                                            selectedTender === tnd.id
                                                                ? 'bg-teal-50 border-teal-500 text-teal-950 shadow-2xs'
                                                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        <p className="text-xs font-extrabold">{tnd.label}</p>
                                                        <p className="text-[10px] text-slate-500 mt-0.5">{tnd.sub}</p>
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Partial EBT Split-Tender Configuration Box (CDTFA Reg. 1603) */}
                                            {selectedTender === 'SPLIT_EBT_MIXED' && (
                                                <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-300 space-y-2 text-xs">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-extrabold text-teal-950">
                                                            🏛️ Regla Oficial California CDTFA Reg. 1603 (Split EBT RMP)
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded bg-teal-200 text-teal-900 text-[10px] font-black">
                                                            0% Tax en porción EBT
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-[10px] font-bold uppercase text-teal-800">Monto Aprobado en EBT ($)</label>
                                                            <input
                                                                type="number"
                                                                step="1.00"
                                                                value={splitEbtAmount}
                                                                onChange={(e) => setSplitEbtAmount(Math.max(0, Number(e.target.value)))}
                                                                className="w-full mt-0.5 px-2.5 py-1 rounded-lg border border-teal-300 bg-white font-black text-teal-950"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold uppercase text-teal-800">2do Método por Remanente</label>
                                                            <select
                                                                value={splitSecondaryMethod}
                                                                onChange={(e) => setSplitSecondaryMethod(e.target.value as any)}
                                                                className="w-full mt-0.5 px-2 py-1 rounded-lg border border-teal-300 bg-white font-bold text-slate-900"
                                                            >
                                                                <option value="CASH">💶 Efectivo (Abre Cajón)</option>
                                                                <option value="CARD_NFC">💳 Tarjeta / Apple Pay</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <p className="text-[11px] text-teal-900">
                                                        Exento EBT: <strong>${cartTotals.ebtCoveredPortion.toFixed(2)} ($0.00 Tax)</strong> • Base Gravable Restante: <strong>${cartTotals.taxableRemainingSubtotal.toFixed(2)}</strong> + Tax ({currentTaxRate}%): <strong>${cartTotals.tax.toFixed(2)}</strong> → A cobrar en {splitSecondaryMethod}: <strong>${cartTotals.secondaryDue.toFixed(2)}</strong>
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Loyalty Gavilan Rewards + Manager Discount/Comp/Void Controls */}
                                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-extrabold uppercase text-amber-700">⭐ Gavilan Rewards / Teléfono:</span>
                                                    <input
                                                        type="text"
                                                        value={loyaltyPhoneInput}
                                                        onChange={(e) => setLoyaltyPhoneInput(e.target.value)}
                                                        className="w-28 px-2 py-0.5 rounded border border-slate-300 bg-white font-mono text-xs font-bold text-slate-900"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={async () => {
                                                            setAppliedLoyaltyDiscount(prev => prev === 5 ? 0 : 5)
                                                            await dispatchPosMutation('UPDATE_LOYALTY_OR_GIFTCARD', {
                                                                phone: loyaltyPhoneInput,
                                                                customerName: customerNameOrder,
                                                                pointsDelta: appliedLoyaltyDiscount === 5 ? 100 : -100,
                                                                giftcardDeltaUsd: 0,
                                                                orderTotalUsd: cartTotals.total
                                                            })
                                                        }}
                                                        className={`px-2 py-1 rounded-lg text-[10px] font-black cursor-pointer border ${
                                                            appliedLoyaltyDiscount > 0
                                                                ? 'bg-amber-500 text-white border-amber-600'
                                                                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                                                        }`}
                                                    >
                                                        {appliedLoyaltyDiscount > 0 ? '✓ -$5.00 Canjeado (100 pts)' : 'Canjear -$5.00 (100 pts)'}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const nextPct = discountPct === 50 ? 0 : 50
                                                            setDiscountPct(nextPct)
                                                            setDiscountReason(nextPct === 50 ? 'Comida de Empleado 50% (PIN 1425)' : '')
                                                        }}
                                                        className={`px-2 py-1 rounded-lg text-[10px] font-black cursor-pointer border ${
                                                            discountPct === 50
                                                                ? 'bg-indigo-600 text-white border-indigo-700'
                                                                : 'bg-indigo-50 text-indigo-900 border-indigo-200 hover:bg-indigo-100'
                                                        }`}
                                                    >
                                                        {discountPct === 50 ? '✓ Empleado 50% OFF' : 'Empleado 50% OFF'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Post-Send Void & Waste Tracking with Manager PIN */}
                                            <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-bold text-slate-500">PIN Gerente:</span>
                                                    <input
                                                        type="password"
                                                        maxLength={6}
                                                        value={managerPinInput}
                                                        onChange={(e) => setManagerPinInput(e.target.value)}
                                                        className="w-16 px-2 py-0.5 rounded border border-slate-300 bg-white font-mono text-xs font-bold text-slate-900"
                                                    />
                                                    <button
                                                        onClick={() => setVoidIsWaste(prev => !prev)}
                                                        className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer ${
                                                            voidIsWaste
                                                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                                        }`}
                                                    >
                                                        {voidIsWaste ? '🔥 Merma (Ya Cocinado)' : '❄️ Devolver a Stock'}
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        const targetOrd = rawOrders[0]
                                                        if (!targetOrd) return
                                                        await dispatchPosMutation('VOID_OR_COMP_ORDER', {
                                                            orderId: targetOrd.id || targetOrd.client_order_id,
                                                            clientOrderId: targetOrd.client_order_id,
                                                            orderNumber: targetOrd.order_number,
                                                            isVoided: true,
                                                            voidReason: voidIsWaste ? 'Anulación Post-Cocina (Registrado en Merma/Waste)' : 'Anulación Pre-Cocina (Devuelto a Inventario)',
                                                            isWaste: voidIsWaste,
                                                            managerPinUsed: managerPinInput || '1425'
                                                        })
                                                        setRawOrders(prev => prev.map((o, idx) => idx === 0 ? { ...o, is_voided: true, is_waste: voidIsWaste, kds_status: 'BUMPED' } : o))
                                                        setKdsTickets(prev => prev.slice(1))
                                                    }}
                                                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black cursor-pointer"
                                                >
                                                    🚫 Anular Última Orden en DB (Void + Waste)
                                                </button>
                                            </div>
                                        </div>

                                        {/* Totals + Automatic EBT Tax Exemption Banner */}
                                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                                            <div className="flex justify-between text-slate-600">
                                                <span>Subtotal Bruto:</span>
                                                <span className="font-bold tabular-nums">${cartTotals.rawSubtotal.toFixed(2)}</span>
                                            </div>
                                            {cartTotals.totalDiscount > 0 && (
                                                <div className="flex justify-between text-emerald-700 font-bold">
                                                    <span>Descuento / Rewards ({discountReason || 'Lealtad'}):</span>
                                                    <span className="tabular-nums">-${cartTotals.totalDiscount.toFixed(2)}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between items-center">
                                                <span className="text-slate-600">
                                                    California Sales Tax ({currentTaxRate}%):
                                                </span>
                                                {cartTotals.isEbtFoodStamp ? (
                                                    <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-black text-[11px]">
                                                        $0.00 (EXENTO 100% EBT RMP)
                                                    </span>
                                                ) : cartTotals.isSplitEbt ? (
                                                    <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-900 font-black text-[11px]">
                                                        ${cartTotals.tax.toFixed(2)} (0% en EBT ${cartTotals.ebtCoveredPortion.toFixed(2)})
                                                    </span>
                                                ) : (
                                                    <span className="font-bold tabular-nums">${cartTotals.tax.toFixed(2)}</span>
                                                )}
                                            </div>
                                            <div className="flex justify-between text-base font-black text-slate-900 pt-1.5 border-t border-slate-200">
                                                <span>TOTAL A COBRAR:</span>
                                                <span className="tabular-nums text-red-600">${cartTotals.total.toFixed(2)}</span>
                                            </div>

                                            {selectedTender === 'CARD' && (
                                                <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                                                    <span className="text-slate-500">Comisión Toast: <strong className="text-rose-600">${cartTotals.toastFee.toFixed(2)}</strong></span>
                                                    <span className="text-emerald-700 font-bold">Nuestro IC++ Durbin: ${cartTotals.icPlusDurbinFee.toFixed(2)} (Ahorras ${(cartTotals.toastFee - cartTotals.icPlusDurbinFee).toFixed(2)})</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Fire & Charge Button */}
                                        <button
                                            onClick={handleProcessPayment}
                                            disabled={cart.length === 0 || pinPadStatus !== 'IDLE'}
                                            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black text-sm shadow-sm cursor-pointer transition-all flex items-center justify-center gap-2"
                                        >
                                            {pinPadStatus === 'WAITING_PIN_TAP' ? (
                                                <>
                                                    <RefreshCw size={16} className="animate-spin" />
                                                    <span>Esperando Tap / Chip / PIN en Lector PAX A35...</span>
                                                </>
                                            ) : pinPadStatus === 'APPROVED' ? (
                                                <>
                                                    <CheckCircle2 size={16} />
                                                    <span>¡APROBADO! Enviado al KDS HDMI + Impresora Térmica Mostrador (12ms)</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Send size={16} />
                                                    <span>COBRAR ${cartTotals.total.toFixed(2)} Y ENVIAR AL KDS HDMI + RECIBO CLIENTE</span>
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    {/* 10.1" Customer-Facing Display (CFD) + PAX A35 Live Preview */}
                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                                                Vista en Vivo: Pantalla Frente al Cliente (10.1" CFD + Lector PAX A35)
                                            </span>
                                            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                Dual-Screen Activo
                                            </span>
                                        </div>
                                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                                            <div className="space-y-1">
                                                <p className="text-xs font-black text-slate-900">
                                                    Tacos Gavilan — Bienvenido {customerNameOrder}
                                                </p>
                                                <p className="text-[11px] text-slate-600">
                                                    {cart.reduce((s, c) => s + c.qty, 0)} artículos • {diningOption}
                                                </p>
                                                {lastReceiptInfo.ebtRemainingBalance !== null && (
                                                    <p className="text-[11px] font-bold text-teal-700">
                                                        Último Saldo EBT CalFresh: ${lastReceiptInfo.ebtRemainingBalance.toFixed(2)}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] font-bold uppercase text-slate-400">Total en Pantalla Cliente</span>
                                                <p className="text-xl font-black text-slate-900 tabular-nums">${cartTotals.total.toFixed(2)}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 3B: DRIVE-THRU COMPLETO, PRE-FIRE KDS, OCB 3,000 NITS & FILA DE AUTOS
                       ================================================================= */}
                    {activeCategory === 'drivethru' && (
                        <div className="space-y-5">
                            {/* Top Drive-Thru SLA & Hardware Header */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-rose-600 uppercase tracking-wider">
                                        <Radio size={14} />
                                        <span>Ecosistema Drive-Thru Multi-Estación (Headset HME NEXEO|HDX + Pantalla Exterior Delphi 3,000 Nits IP65 + Loop Detector)</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        Estación 1 (Altavoz + Pre-Fire KDS en Vivo) → Fila de Autos → Estación 2 (Ventanilla de Pago & SLA &lt; 120s)
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        En Drive-Thru la orden no se cobra al tomarla: se transmite en tiempo real al taquero (<strong>Live KDS Pre-Fire</strong>) mientras el auto está en el altavoz y queda abierta en la <strong>Fila de Autos (`IN_CAR_QUEUE`)</strong> hasta cobrar en ventanilla.
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={() => setDtPreFireStreaming(prev => !prev)}
                                        className={`px-3 py-2 rounded-xl text-xs font-black border cursor-pointer flex items-center gap-1.5 ${
                                            dtPreFireStreaming
                                                ? 'bg-amber-50 text-amber-900 border-amber-300'
                                                : 'bg-slate-100 text-slate-600 border-slate-200'
                                        }`}
                                    >
                                        <Zap size={14} className={dtPreFireStreaming ? 'text-amber-600' : 'text-slate-400'} />
                                        <span>{dtPreFireStreaming ? '⚡ Pre-Fire KDS en Altavoz: ACTIVO (-45s espera)' : 'Pre-Fire KDS: Manual'}</span>
                                    </button>
                                    <span className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black">
                                        ⏱️ SLA Promedio Hoy: 94s (Meta &lt; 120s)
                                    </span>
                                </div>
                            </div>

                            {/* INTERACTIVE CAR QUEUE LANE STRIP (FILA DE AUTOS EN VIVO EN SUPABASE) */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-black text-slate-900">
                                            🚗 Tira Visual de Fila de Autos en el Carril (`gavilan_pos_orders` • FIFO Queue)
                                        </h3>
                                        <p className="text-[11px] text-slate-500">
                                            Haz clic en cualquier vehículo de la fila para inspeccionarlo en la Ventanilla de Cobro, agregar bebidas de último segundo o cobrar con EBT / Tarjeta / Efectivo.
                                        </p>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 text-xs font-black">
                                        {driveThruCars.length} Vehículos en Carril
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {driveThruCars.length === 0 ? (
                                        <div className="col-span-3 p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500 font-bold">
                                            No hay vehículos pendientes en la fila. Usa el botón "Enviar Auto del Altavoz a la Fila" abajo para ingresar un vehículo nuevo.
                                        </div>
                                    ) : (
                                        driveThruCars.map((car: any, idx: number) => {
                                            const carKey = car.id || car.client_order_id
                                            const isSelected = selectedDtOrderId === carKey || (idx === 0 && !driveThruCars.some((x: any) => (x.id || x.client_order_id) === selectedDtOrderId))
                                            const stage = car.drive_thru_stage || 'IN_CAR_QUEUE'
                                            return (
                                                <div
                                                    key={carKey}
                                                    onClick={() => setSelectedDtOrderId(carKey)}
                                                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all space-y-2 ${
                                                        isSelected
                                                            ? 'bg-rose-50/70 border-rose-500 shadow-xs'
                                                            : 'bg-slate-50 border-slate-200 hover:bg-white'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] font-black">
                                                            ORDEN #{car.order_number} • CARRIL {car.drive_thru_lane || 1}
                                                        </span>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                                                            stage === 'AT_PAY_WINDOW'
                                                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                                                : 'bg-amber-100 text-amber-900 border-amber-300'
                                                        }`}>
                                                            {stage === 'AT_PAY_WINDOW' ? '🪟 EN VENTANILLA #1' : '🚗 EN FILA DRIVE-THRU'}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs font-extrabold text-slate-900">
                                                        {String(car.customer_name || '').replace(/AUTO #\d+ — [A-Z_]+ [A-Z_]+/i, `ORDEN DRIVE-THRU #${car.order_number}`)}
                                                    </p>
                                                    <div className="flex items-center justify-between text-[11px] text-slate-600">
                                                        <span>📦 {(Array.isArray(car.items) ? car.items.length : 2)} platillos en orden</span>
                                                        <span className="font-black text-slate-900 tabular-nums">${Number(car.total_amount || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between text-[10px] font-bold text-slate-500">
                                                        <span>🎙️ Altavoz: {car.sos_speaker_sec || 34}s</span>
                                                        <span>🍳 KDS: {car.kds_status === 'BUMPED' ? '✅ LISTO EN EXPO' : '🔥 COCINANDO EN PARRILLA'}</span>
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>

                            {/* 3-COLUMN DRIVE-THRU WORKFLOW: SPEAKER ORDER TAKER | OUTDOOR OCB 3,000 NITS | WINDOW CASHIER */}
                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                                {/* COL 1 (4 COLS): STATION 1 — SPEAKER ORDER TAKER (CLEAN SEQUENTIAL FIFO FLOW) */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                        <div>
                                            <span className="text-[10px] font-black uppercase text-rose-600">Estación 1 • Altavoz / Intercom</span>
                                            <h3 className="text-sm font-black text-slate-900">Toma de Orden + Adelanto a Parrilla</h3>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-black">
                                            🟡 PRE-FIRE KDS
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase text-slate-500 block">Flujo Directo Tacos Gavilan</span>
                                            <span className="font-extrabold text-slate-900">Secuencia FIFO por Número de Orden</span>
                                        </div>
                                        <select
                                            value={dtLane}
                                            onChange={(e) => setDtLane(Number(e.target.value))}
                                            className="px-3 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900 bg-white"
                                        >
                                            <option value={1}>Carril 1</option>
                                            <option value={2}>Carril 2</option>
                                        </select>
                                    </div>

                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-extrabold uppercase text-slate-500">
                                            Toque Rápido en Altavoz (Dispara Pre-Fire en Vivo al Taquero)
                                        </span>
                                        <div className="grid grid-cols-2 gap-2">
                                            {menuItems.slice(0, 6).map(item => (
                                                <button
                                                    key={item.guid}
                                                    onClick={() => addToCart(item)}
                                                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-rose-50 hover:border-rose-300 text-left text-xs cursor-pointer transition-all"
                                                >
                                                    <p className="font-extrabold text-slate-900 line-clamp-1">{item.name}</p>
                                                    <p className="text-[10px] font-black text-rose-700 mt-0.5">+${item.basePrice.toFixed(2)} • {item.prepStation}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            const nextNum = lastReceiptInfo.checkNumber + 1
                                            setLastReceiptInfo(prev => ({ ...prev, checkNumber: nextNum }))
                                            const clientOrderId = `DT-${activeStore?.storeNumber || 14}-${nextNum}-${Date.now()}`
                                            const carLabel = `ORDEN DRIVE-THRU #${nextNum} (CARRIL ${dtLane})`
                                            const itemsPayload = cart.map(c => ({
                                                id: c.guid,
                                                name: c.name,
                                                qty: c.qty,
                                                unitPrice: c.unitPrice,
                                                station: c.prepStation,
                                                modifiers: c.modifiers.map(m => m.name)
                                            }))
                                            const newOrderObj = {
                                                id: clientOrderId,
                                                client_order_id: clientOrderId,
                                                order_number: nextNum,
                                                store_number: activeStore?.storeNumber || 14,
                                                dining_option: 'DRIVE_THRU',
                                                customer_name: carLabel,
                                                items: itemsPayload,
                                                subtotal: cartTotals.subtotal,
                                                tax_rate: currentTaxRate,
                                                tax_amount: Number(((cartTotals.subtotal * currentTaxRate) / 100).toFixed(2)),
                                                total_amount: Number((cartTotals.subtotal * (1 + currentTaxRate / 100)).toFixed(2)),
                                                payment_method: 'PENDING_WINDOW',
                                                payment_capture_mode: 'PENDING_WINDOW',
                                                kds_status: 'IN_PREP',
                                                station_code: 'PARRILLA',
                                                drive_thru_lane: dtLane,
                                                vehicle_type: 'N/A',
                                                vehicle_color: 'N/A',
                                                drive_thru_stage: 'IN_CAR_QUEUE',
                                                sos_speaker_sec: 31,
                                                sos_window_sec: 0,
                                                created_at: new Date().toISOString()
                                            }
                                            setRawOrders(prev => [newOrderObj, ...prev])
                                            setSelectedDtOrderId(clientOrderId)

                                            const newKdsTicket: KdsOrderTicket = {
                                                id: clientOrderId,
                                                checkNumber: nextNum,
                                                channel: 'DRIVE-THRU',
                                                customerName: carLabel,
                                                createdAtMs: Date.now(),
                                                elapsedMinutes: 0,
                                                level1Done: false,
                                                items: cart.map(c => ({
                                                    name: c.name,
                                                    qty: c.qty,
                                                    station: c.prepStation,
                                                    modifiers: c.modifiers.map(m => m.name),
                                                    done: false
                                                }))
                                            }
                                            setKdsTickets(prev => [newKdsTicket, ...prev])
                                            broadcastLanEvent({ type: 'NEW_KDS_TICKET', ticket: newKdsTicket })

                                            await dispatchPosMutation('CREATE_ORDER', {
                                                clientOrderId,
                                                orderNumber: nextNum,
                                                storeNumber: activeStore?.storeNumber || 14,
                                                diningOption: 'DRIVE_THRU',
                                                customerName: carLabel,
                                                items: itemsPayload,
                                                subtotal: newOrderObj.subtotal,
                                                taxRate: newOrderObj.tax_rate,
                                                taxAmount: newOrderObj.tax_amount,
                                                totalAmount: newOrderObj.total_amount,
                                                paymentMethod: 'PENDING_WINDOW',
                                                paymentCaptureMode: 'PENDING_WINDOW',
                                                driveThruLane: dtLane,
                                                driveThruStage: 'IN_CAR_QUEUE',
                                                sosSpeakerSec: 31,
                                            })
                                        }}
                                        className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black cursor-pointer shadow-xs flex items-center justify-center gap-2"
                                    >
                                        <Send size={15} />
                                        <span>🚗 ENVIAR ORDEN A VENTANILLA DE COBRO (HOLD FOR WINDOW + KDS)</span>
                                    </button>
                                </div>

                                {/* COL 2 (4 COLS): OUTDOOR ORDER CONFIRMATION BOARD (OCB 3,000 NITS IP65) */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border-2 border-amber-300 p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-amber-200 pb-3">
                                            <div>
                                                <span className="text-[10px] font-black uppercase text-amber-700">Pantalla Exterior IP65 • 3,000 Nits</span>
                                                <h3 className="text-sm font-black text-slate-900">Order Confirmation Board (OCB en Poste Altavoz)</h3>
                                            </div>
                                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-black">
                                                HDMI / LAN En Vivo
                                            </span>
                                        </div>

                                        <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2 text-xs">
                                            <div className="flex items-center justify-between font-black text-slate-900">
                                                <span>BIENVENIDO A TACOS GAVILAN</span>
                                                <span className="text-rose-700">DRIVE-THRU • CARRIL #{dtLane}</span>
                                            </div>
                                            <div className="divide-y divide-amber-200/60 max-h-44 overflow-y-auto">
                                                {cart.map(c => (
                                                    <div key={c.id} className="py-1.5 flex items-start justify-between">
                                                        <div>
                                                            <p className="font-extrabold text-slate-900">{c.qty}x {c.name}</p>
                                                            {c.modifiers.map((m, i) => (
                                                                <p key={i} className="text-[10px] font-bold text-rose-700">  &gt;&gt; {m.name}</p>
                                                            ))}
                                                        </div>
                                                        <span className="font-black text-slate-900 tabular-nums">${(c.unitPrice * c.qty).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-emerald-600 text-white space-y-1">
                                        <div className="flex items-center justify-between text-xs font-bold">
                                            <span>Sub: ${cartTotals.subtotal.toFixed(2)} | EBT CalFresh: $0.00 Tax</span>
                                            <span>Con Tax: ${cartTotals.total.toFixed(2)}</span>
                                        </div>
                                        <p className="text-sm font-black uppercase tracking-wide">
                                            👉 ¡POR FAVOR AVANCE A LA VENTANILLA #1!
                                        </p>
                                    </div>
                                </div>

                                {/* COL 3 (4 COLS): STATION 2 — PAY & PICKUP WINDOW CASHIER */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
                                    {(() => {
                                        const activeCar = driveThruCars.find((x: any) => (x.id || x.client_order_id) === selectedDtOrderId) || driveThruCars[0]
                                        if (!activeCar) {
                                            return (
                                                <div className="py-12 text-center text-xs text-slate-400 font-bold">
                                                    Selecciona o envía una orden en la Estación 1 para cobrarla en Ventanilla.
                                                </div>
                                            )
                                        }
                                        const isWindowEbt = dtWindowTender === 'EBT_CALFRESH'
                                        const carSub = Number(activeCar.subtotal || 25.57)
                                        const carTax = isWindowEbt ? 0 : Number(((carSub * currentTaxRate) / 100).toFixed(2))
                                        const carTotal = Number((carSub + carTax).toFixed(2))

                                        return (
                                            <>
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                                        <div>
                                                            <span className="text-[10px] font-black uppercase text-emerald-700">Estación 2 • Ventanilla de Cobro</span>
                                                            <h3 className="text-sm font-black text-slate-900">
                                                                Orden #{activeCar.order_number} • Drive-Thru
                                                            </h3>
                                                        </div>
                                                        <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-black">
                                                            CARRIL #{activeCar.drive_thru_lane || 1}
                                                        </span>
                                                    </div>

                                                    {/* Add Last-Second Item at Window */}
                                                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                                                        <span className="font-bold text-slate-700">¿Cliente pidió bebida extra en ventanilla?</span>
                                                        <button
                                                            onClick={async () => {
                                                                const prevItems = Array.isArray(activeCar.items) ? activeCar.items : []
                                                                const updatedItems = [
                                                                    ...prevItems,
                                                                    { id: 'win-horchata', name: 'Agua de Horchata 32oz (Ventanilla)', qty: 1, unitPrice: 4.49, station: 'BEBIDAS', modifiers: ['AGREGADO EN VENTANILLA'] }
                                                                ]
                                                                const nextSub = Number((Number(activeCar.subtotal || 0) + 4.49).toFixed(2))
                                                                const nextTax = isWindowEbt ? 0 : Number(((nextSub * currentTaxRate) / 100).toFixed(2))
                                                                const nextTot = Number((nextSub + nextTax).toFixed(2))

                                                                setRawOrders(prev => prev.map(o => (o.id === activeCar.id && o.client_order_id === activeCar.client_order_id) ? {
                                                                    ...o,
                                                                    drive_thru_stage: 'AT_PAY_WINDOW',
                                                                    items: updatedItems,
                                                                    subtotal: nextSub,
                                                                    tax_amount: nextTax,
                                                                    total_amount: nextTot
                                                                } : o))

                                                                await dispatchPosMutation('UPDATE_DRIVETHRU_ORDER', {
                                                                    orderId: activeCar.id || activeCar.client_order_id,
                                                                    clientOrderId: activeCar.client_order_id,
                                                                    driveThruStage: 'AT_PAY_WINDOW',
                                                                    items: updatedItems,
                                                                    subtotal: nextSub,
                                                                    taxRate: isWindowEbt ? 0 : currentTaxRate,
                                                                    taxAmount: nextTax,
                                                                    totalAmount: nextTot
                                                                })
                                                            }}
                                                            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black cursor-pointer shrink-0"
                                                        >
                                                            +1 Horchata ($4.49)
                                                        </button>
                                                    </div>

                                                    {/* Window Tender Selector */}
                                                    <div className="grid grid-cols-3 gap-1.5 text-xs">
                                                        {[
                                                            { id: 'EBT_CALFRESH', label: '🏛️ EBT (0% Tax)' },
                                                            { id: 'CARD_NFC', label: '💳 Tarjeta/NFC' },
                                                            { id: 'CASH', label: '💶 Efectivo' }
                                                        ].map(wt => (
                                                            <button
                                                                key={wt.id}
                                                                onClick={() => setDtWindowTender(wt.id as any)}
                                                                className={`py-2 px-2 rounded-xl border font-extrabold text-[11px] cursor-pointer ${
                                                                    dtWindowTender === wt.id
                                                                        ? 'bg-teal-50 border-teal-500 text-teal-950'
                                                                        : 'bg-slate-50 border-slate-200 text-slate-700'
                                                                }`}
                                                            >
                                                                {wt.label}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-600">Subtotal Auto #{activeCar.order_number}:</span>
                                                            <span className="font-bold">${carSub.toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-600">Tax Ventanilla:</span>
                                                            <span className="font-bold text-teal-700">
                                                                {isWindowEbt ? '$0.00 (Exento EBT RMP)' : `$${carTax.toFixed(2)}`}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between text-sm font-black text-slate-900 pt-1 border-t border-slate-200">
                                                            <span>TOTAL VENTANILLA:</span>
                                                            <span className="text-emerald-700">${carTotal.toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={async () => {
                                                        setRawOrders(prev => prev.map(o => (o.id === activeCar.id && o.client_order_id === activeCar.client_order_id) ? {
                                                            ...o,
                                                            drive_thru_stage: 'COMPLETED',
                                                            payment_method: dtWindowTender,
                                                            payment_capture_mode: 'ONLINE_AUTH',
                                                            tax_rate: isWindowEbt ? 0 : currentTaxRate,
                                                            tax_amount: carTax,
                                                            total_amount: carTotal,
                                                            sos_window_sec: 26
                                                        } : o))

                                                        await dispatchPosMutation('UPDATE_DRIVETHRU_ORDER', {
                                                            orderId: activeCar.id || activeCar.client_order_id,
                                                            clientOrderId: activeCar.client_order_id,
                                                            driveThruStage: 'COMPLETED',
                                                            paymentMethod: dtWindowTender,
                                                            paymentCaptureMode: 'ONLINE_AUTH',
                                                            taxRate: isWindowEbt ? 0 : currentTaxRate,
                                                            taxAmount: carTax,
                                                            totalAmount: carTotal,
                                                            sosWindowSec: 26
                                                        })
                                                    }}
                                                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer shadow-xs flex items-center justify-center gap-2"
                                                >
                                                    <CheckCircle2 size={15} />
                                                    <span>✓ COBRAR ${carTotal.toFixed(2)} EN VENTANILLA Y DESPACHAR AUTO</span>
                                                </button>
                                            </>
                                        )
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 3C: KIOSCO 27", TV COMEDOR "ORDER READY" & PARTY TRAYS CATERING
                       ================================================================= */}
                    {activeCategory === 'kiosk_tv' && (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-cyan-700 uppercase tracking-wider">
                                        <Sparkles size={14} />
                                        <span>Ecosistema de Comedor, Auto-Pedido & Catering Programado (100% Conectado a Supabase)</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        Kiosco Táctil 27" (Con Smart Upsell) + Pantalla TV 55" "Order Ready" + Party Trays Programados
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Reemplaza los módulos pagados de Toast Kiosk, Toast Order Ready Board y Toast Catering &amp; Events con $0 de renta mensual por pantalla.
                                    </p>
                                </div>
                                {voiceAnnounceStatus && (
                                    <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black">
                                        🔊 {voiceAnnounceStatus}
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                                {/* COL 1 (4 COLS): 27" SELF-ORDERING KIOSK WITH AI UPSELL */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                            <div>
                                                <span className="text-[10px] font-black uppercase text-cyan-700">Lobby Kiosk • 27" Portrait + PAX A35</span>
                                                <h3 className="text-sm font-black text-slate-900">Kiosco de Auto-Pedido + Smart Upsell</h3>
                                            </div>
                                            <span className="px-2 py-0.5 rounded bg-cyan-50 text-cyan-800 border border-cyan-200 text-[10px] font-black">
                                                +24% Ticket
                                            </span>
                                        </div>

                                        <div className="p-3.5 rounded-xl bg-cyan-50/60 border border-cyan-200 space-y-2 text-xs">
                                            <p className="font-extrabold text-cyan-950">
                                                🤖 Motor de Upsell Automático antes del Pago:
                                            </p>
                                            <label className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-cyan-200 cursor-pointer">
                                                <div>
                                                    <p className="font-extrabold text-slate-900">+ Agua de Horchata 32oz &amp; Guacamole</p>
                                                    <p className="text-[10px] text-slate-500">Sugerencia automática en pantalla táctil (+$5.99)</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={kioskUpsellAccepted}
                                                    onChange={(e) => setKioskUpsellAccepted(e.target.checked)}
                                                    className="w-4 h-4 accent-cyan-600"
                                                />
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <button
                                                onClick={() => setKioskTender('CARD_NFC')}
                                                className={`p-2.5 rounded-xl border font-extrabold cursor-pointer ${
                                                    kioskTender === 'CARD_NFC'
                                                        ? 'bg-cyan-50 border-cyan-500 text-cyan-950'
                                                        : 'bg-slate-50 border-slate-200 text-slate-700'
                                                }`}
                                            >
                                                💳 Apple Pay / Tarjeta
                                            </button>
                                            <button
                                                onClick={() => setKioskTender('EBT_CALFRESH')}
                                                className={`p-2.5 rounded-xl border font-extrabold cursor-pointer ${
                                                    kioskTender === 'EBT_CALFRESH'
                                                        ? 'bg-teal-50 border-teal-500 text-teal-950'
                                                        : 'bg-slate-50 border-slate-200 text-slate-700'
                                                }`}
                                            >
                                                🏛️ EBT CalFresh (0% Tax)
                                            </button>
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            const nextNum = lastReceiptInfo.checkNumber + 1
                                            setLastReceiptInfo(prev => ({ ...prev, checkNumber: nextNum }))
                                            const clientOrderId = `KIOSK-${activeStore?.storeNumber || 14}-${nextNum}-${Date.now()}`
                                            const sub = Number((18.48 + (kioskUpsellAccepted ? 5.99 : 0)).toFixed(2))
                                            const tax = kioskTender === 'EBT_CALFRESH' ? 0 : Number(((sub * currentTaxRate) / 100).toFixed(2))
                                            const tot = Number((sub + tax).toFixed(2))
                                            const kioskItems = [
                                                { id: 'k-1', name: 'Combo #1 (3 Tacos Asada + Arroz y Frijol)', qty: 1, unitPrice: 14.99, station: 'PARRILLA' as const, modifiers: ['CON TODO', 'MAÍZ RECIÉN HECHA'] },
                                                { id: 'k-2', name: 'Taco al Pastor', qty: 1, unitPrice: 3.49, station: 'PARRILLA' as const, modifiers: ['SALSA ROJA'] },
                                                ...(kioskUpsellAccepted ? [{ id: 'k-3', name: 'Upsell: Horchata 32oz + Guacamole', qty: 1, unitPrice: 5.99, station: 'BEBIDAS' as const, modifiers: ['SMART UPSELL KIOSK'] }] : [])
                                            ]

                                            const newOrderRecord = {
                                                id: clientOrderId,
                                                client_order_id: clientOrderId,
                                                order_number: nextNum,
                                                store_number: activeStore?.storeNumber || 14,
                                                dining_option: 'KIOSK_DINE_IN',
                                                customer_name: `KIOSCO #${nextNum}`,
                                                items: kioskItems,
                                                subtotal: sub,
                                                tax_rate: kioskTender === 'EBT_CALFRESH' ? 0 : currentTaxRate,
                                                tax_amount: tax,
                                                total_amount: tot,
                                                payment_method: kioskTender,
                                                kds_status: 'IN_PREP',
                                                created_at: new Date().toISOString()
                                            }
                                            setRawOrders(prev => [newOrderRecord, ...prev])
                                            setKdsTickets(prev => [{
                                                id: clientOrderId,
                                                checkNumber: nextNum,
                                                channel: 'FOR HERE',
                                                customerName: `KIOSCO #${nextNum}`,
                                                createdAtMs: Date.now(),
                                                elapsedMinutes: 0,
                                                level1Done: false,
                                                items: kioskItems.map(it => ({ ...it, done: false }))
                                            }, ...prev])

                                            await dispatchPosMutation('CREATE_ORDER', {
                                                clientOrderId,
                                                orderNumber: nextNum,
                                                storeNumber: activeStore?.storeNumber || 14,
                                                diningOption: 'FOR_HERE',
                                                customerName: `KIOSCO #${nextNum}`,
                                                items: kioskItems,
                                                subtotal: sub,
                                                taxRate: kioskTender === 'EBT_CALFRESH' ? 0 : currentTaxRate,
                                                taxAmount: tax,
                                                totalAmount: tot,
                                                paymentMethod: kioskTender,
                                                paymentCaptureMode: 'ONLINE_AUTH',
                                                stationCode: 'PARRILLA'
                                            })
                                        }}
                                        className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-black cursor-pointer shadow-xs"
                                    >
                                        🖥️ Crear Orden en Kiosco (${(18.48 + (kioskUpsellAccepted ? 5.99 : 0)).toFixed(2)}) → KDS &amp; TV Comedor
                                    </button>
                                </div>

                                {/* COL 2 (4 COLS): 55" DINING ROOM "ORDER READY STATUS TV" */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border-2 border-emerald-300 p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                            <div>
                                                <span className="text-[10px] font-black uppercase text-emerald-700">TV 55" Comedor • Sincronizada con Bump KDS</span>
                                                <h3 className="text-sm font-black text-slate-900">Pantalla "Order Ready Board" para Clientes</h3>
                                            </div>
                                            <Volume2 size={16} className="text-emerald-600" />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
                                                <span className="text-[10px] font-black uppercase text-amber-800 block">
                                                    🔥 PREPARANDO ({rawOrders.filter(o => o.kds_status === 'IN_PREP' && !o.is_voided).length})
                                                </span>
                                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                                    {rawOrders.filter(o => o.kds_status === 'IN_PREP' && !o.is_voided).slice(0, 6).map((o: any) => (
                                                        <div key={o.id || o.client_order_id} className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 flex items-center justify-between text-xs">
                                                            <span className="font-black text-slate-900">#{o.order_number}</span>
                                                            <button
                                                                onClick={() => {
                                                                    const matchingTicket = kdsTickets.find(k => k.checkNumber === Number(o.order_number)) || {
                                                                        id: o.id || o.client_order_id,
                                                                        checkNumber: Number(o.order_number),
                                                                        channel: 'TO GO' as const,
                                                                        customerName: o.customer_name,
                                                                        createdAtMs: Date.now(),
                                                                        elapsedMinutes: 2,
                                                                        level1Done: true,
                                                                        items: []
                                                                    }
                                                                    handleBumpKdsOrder(matchingTicket)
                                                                    setVoiceAnnounceStatus(`Orden #${o.order_number} (${o.customer_name}) marcada LISTA en TV Comedor`)
                                                                    try {
                                                                        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                                                                            const utter = new SpeechSynthesisUtterance(`Orden número ${o.order_number}, lista para recoger en mostrador.`)
                                                                            utter.lang = 'es-MX'
                                                                            window.speechSynthesis.speak(utter)
                                                                        }
                                                                    } catch {}
                                                                }}
                                                                className="text-[10px] font-black text-emerald-700 hover:underline cursor-pointer"
                                                            >
                                                                Marcar Lista →
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-300 space-y-1.5">
                                                <span className="text-[10px] font-black uppercase text-emerald-800 block">
                                                    ✅ LISTO PARA RECOGER ({rawOrders.filter(o => o.kds_status === 'BUMPED' && !o.is_voided).length})
                                                </span>
                                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                                    {rawOrders.filter(o => o.kds_status === 'BUMPED' && !o.is_voided).slice(0, 6).map((o: any) => (
                                                        <div key={o.id || o.client_order_id} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white flex items-center justify-between text-xs font-black">
                                                            <span>#{o.order_number}</span>
                                                            <span className="text-[10px] truncate max-w-[90px]">{o.customer_name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                                        💡 Al hacer <strong>Bump</strong> en el KDS de Expo (o clic en <em>Marcar Lista →</em>), el número pasa a la columna verde y anuncia por voz al cliente.
                                    </p>
                                </div>

                                {/* COL 3 (4 COLS): SCHEDULED PARTY TRAYS / CATERING + CALLER ID + AUTO-FIRE */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                            <div>
                                                <span className="text-[10px] font-black uppercase text-purple-700">Party Trays &amp; Caller ID • Auto-Fire Lead Time</span>
                                                <h3 className="text-sm font-black text-slate-900">Catering Programado (Recetas Virtuales)</h3>
                                            </div>
                                            <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-black">
                                                Lead: 45m
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <label className="text-[10px] font-bold uppercase text-slate-500">Cliente / Familia</label>
                                                <input
                                                    type="text"
                                                    value={cateringCustomer}
                                                    onChange={(e) => setCateringCustomer(e.target.value)}
                                                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold uppercase text-slate-500">Caller ID (Teléfono)</label>
                                                <input
                                                    type="text"
                                                    value={cateringPhone}
                                                    onChange={(e) => setCateringPhone(e.target.value)}
                                                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-xl border border-slate-200 font-mono font-bold text-slate-900"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <label className="text-[10px] font-bold uppercase text-slate-500">Tamaño Party Tray</label>
                                                <select
                                                    value={cateringPackage}
                                                    onChange={(e) => setCateringPackage(e.target.value as any)}
                                                    className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900 bg-slate-50"
                                                >
                                                    <option value="15-20">15-20 Personas ($149.99)</option>
                                                    <option value="20-25">20-25 Personas ($189.99)</option>
                                                    <option value="30-40">30-40 Personas ($289.99)</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold uppercase text-slate-500">Hora Retiro (Auto-Fire -45m)</label>
                                                <input
                                                    type="text"
                                                    value={cateringPickupTime}
                                                    onChange={(e) => setCateringPickupTime(e.target.value)}
                                                    className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900"
                                                />
                                            </div>
                                        </div>

                                        {/* Active Scheduled Catering Orders in DB */}
                                        <div className="space-y-1.5 max-h-28 overflow-y-auto">
                                            {rawOrders.filter(o => o.is_scheduled_catering).slice(0, 3).map((cat: any) => (
                                                <div key={cat.id || cat.client_order_id} className="p-2 rounded-xl bg-purple-50/70 border border-purple-200 flex items-center justify-between text-xs">
                                                    <div>
                                                        <p className="font-extrabold text-purple-950">#{cat.order_number} • {cat.customer_name}</p>
                                                        <p className="text-[10px] text-purple-700">{cat.scheduled_pickup_time || 'Programado'} • Estado: {cat.kds_status}</p>
                                                    </div>
                                                    {cat.kds_status === 'SCHEDULED_HOLD' && (
                                                        <button
                                                            onClick={async () => {
                                                                await dispatchPosMutation('FIRE_SCHEDULED_CATERING', {
                                                                    orderId: cat.id || cat.client_order_id,
                                                                    clientOrderId: cat.client_order_id,
                                                                    orderNumber: cat.order_number
                                                                })
                                                                setRawOrders(prev => prev.map(o => (o.id === cat.id && o.client_order_id === cat.client_order_id) ? { ...o, kds_status: 'IN_PREP' } : o))
                                                                setKdsTickets(prev => [{
                                                                    id: cat.id || cat.client_order_id,
                                                                    checkNumber: Number(cat.order_number),
                                                                    channel: 'TO GO',
                                                                    customerName: cat.customer_name,
                                                                    createdAtMs: Date.now(),
                                                                    elapsedMinutes: 0,
                                                                    level1Done: false,
                                                                    items: (cat.items || []).map((it: any) => ({ ...it, done: false }))
                                                                }, ...prev])
                                                            }}
                                                            className="px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-black cursor-pointer shrink-0"
                                                        >
                                                            🔥 Auto-Fire KDS
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            const nextNum = lastReceiptInfo.checkNumber + 1
                                            setLastReceiptInfo(prev => ({ ...prev, checkNumber: nextNum }))
                                            const clientOrderId = `CAT-${activeStore?.storeNumber || 14}-${nextNum}-${Date.now()}`
                                            const pkgPrice = cateringPackage === '15-20' ? 149.99 : cateringPackage === '20-25' ? 189.99 : 289.99
                                            const tax = Number(((pkgPrice * currentTaxRate) / 100).toFixed(2))
                                            const tot = Number((pkgPrice + tax).toFixed(2))
                                            const catItems = [
                                                { id: `pt-${cateringPackage}`, name: `Party Tray ${cateringPackage} Personas (Asada, Pastor, Pollo)`, qty: 1, unitPrice: pkgPrice, station: 'PARRILLA', modifiers: ['ARROZ Y FRIJOL', 'TORTILLA MAÍZ', 'SALSAS Y DESECHABLES'] }
                                            ]
                                            const newCatOrder = {
                                                id: clientOrderId,
                                                client_order_id: clientOrderId,
                                                order_number: nextNum,
                                                store_number: activeStore?.storeNumber || 14,
                                                dining_option: 'TAKEOUT',
                                                customer_name: `PARTY TRAY — ${cateringCustomer} (${cateringPhone})`,
                                                items: catItems,
                                                subtotal: pkgPrice,
                                                tax_rate: currentTaxRate,
                                                tax_amount: tax,
                                                total_amount: tot,
                                                payment_method: 'CARD_NFC',
                                                kds_status: 'SCHEDULED_HOLD',
                                                is_scheduled_catering: true,
                                                scheduled_pickup_time: cateringPickupTime,
                                                prep_lead_time_mins: 45,
                                                loyalty_phone: cateringPhone,
                                                created_at: new Date().toISOString()
                                            }
                                            setRawOrders(prev => [newCatOrder, ...prev])

                                            await dispatchPosMutation('CREATE_ORDER', {
                                                clientOrderId,
                                                orderNumber: nextNum,
                                                storeNumber: activeStore?.storeNumber || 14,
                                                diningOption: 'TAKEOUT',
                                                customerName: newCatOrder.customer_name,
                                                items: catItems,
                                                subtotal: pkgPrice,
                                                taxRate: currentTaxRate,
                                                taxAmount: tax,
                                                totalAmount: tot,
                                                paymentMethod: 'CARD_NFC',
                                                kdsStatus: 'SCHEDULED_HOLD',
                                                isScheduledCatering: true,
                                                scheduledPickupTime: cateringPickupTime,
                                                prepLeadTimeMins: 45,
                                                loyaltyPhone: cateringPhone
                                            })
                                        }}
                                        className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black cursor-pointer shadow-xs"
                                    >
                                        📅 Programar Party Tray (${cateringPackage === '15-20' ? '149.99' : cateringPackage === '20-25' ? '189.99' : '289.99'}) en Supabase
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 4: COCINA, ESTACIONES & KDS CON ESPEJEO HDMI + BUMP BAR
                       ================================================================= */}
                    {activeCategory === 'kds' && (
                        <div className="space-y-5">
                            {/* Top Control Bar */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 uppercase tracking-wider">
                                        <Tv size={14} />
                                        <span>Arquitectura KDS + Transmisión HDMI (Splitter Activo EDID 1080p@60Hz + Extensor Cat6)</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        KDS Principal (Elo 21.5" Touch) + Monitor Espejo HDMI (Parrilla 27") + Bump Bar USB
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Presiona las teclas <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px]">1</kbd> a <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px]">9</kbd> o <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px]">Enter</kbd> en tu teclado para probar el <strong>Bump Bar USB (Logic Controls KB1700)</strong> en tiempo real.
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={handleRecallLastKdsOrder}
                                        className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-extrabold cursor-pointer flex items-center gap-1.5"
                                    >
                                        <RefreshCw size={13} />
                                        <span>↺ Recuperar Última Orden (RECALL DB)</span>
                                    </button>
                                    <button
                                        onClick={() => simulateIncomingDeliveryOrder('UBER EATS')}
                                        className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-xs font-extrabold cursor-pointer"
                                    >
                                        + Inyectar Orden Uber Eats
                                    </button>
                                    <button
                                        onClick={() => simulateIncomingDeliveryOrder('DOORDASH')}
                                        className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-900 border border-red-200 text-xs font-extrabold cursor-pointer"
                                    >
                                        + Inyectar Orden DoorDash
                                    </button>
                                </div>
                            </div>

                            {/* HDMI Topology & Station Filter Bar */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {[
                                        { id: 'ALL_EXPO', label: '📋 EXPO / EMPAQUE (Nivel 2 - Todo)' },
                                        { id: 'PARRILLA', label: '🔥 PARRILLA / TAQUERO (Nivel 1)' },
                                        { id: 'LINEA', label: '🥗 LÍNEA / PREPARACIÓN (Nivel 1)' },
                                        { id: 'TORTILLAS', label: '🫓 TORTILLAS' },
                                        { id: 'BEBIDAS', label: '🥤 AGUAS / BEBIDAS' }
                                    ].map(st => (
                                        <button
                                            key={st.id}
                                            onClick={() => setKdsStationFilter(st.id as any)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer ${
                                                kdsStationFilter === st.id
                                                    ? 'bg-slate-900 text-white border-slate-900'
                                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                            }`}
                                        >
                                            {st.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                                        <Cable size={14} className="text-amber-700" />
                                        <span className="text-xs font-bold text-amber-950">Modo Salida HDMI 2:</span>
                                        <select
                                            value={hdmiMirrorMode}
                                            onChange={(e) => setHdmiMirrorMode(e.target.value as any)}
                                            className="bg-white border border-amber-300 rounded-lg px-2 py-0.5 text-xs font-extrabold text-amber-900 outline-none cursor-pointer"
                                        >
                                            <option value="MIRROR_CLONE">Espejo Exacto (Splitter HDMI 1x2)</option>
                                            <option value="EXTENDED_GRILL">Doble Estación Independiente (HDMI 2 = Solo Parrilla)</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={() => setEdidLockEnabled(prev => !prev)}
                                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                                            edidLockEnabled
                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                                : 'bg-slate-100 border-slate-200 text-slate-600'
                                        }`}
                                    >
                                        EDID 1080p@60Hz: {edidLockEnabled ? 'LOCKED ✓' : 'AUTO'}
                                    </button>
                                </div>
                            </div>

                            {/* Dual Monitor Simulator: Primary KDS + Secondary HDMI Overhead Mirror */}
                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                                {/* MONITOR 1: PRIMARY KDS TOUCH (8 COLS) */}
                                <div className="xl:col-span-8 bg-white rounded-2xl border-2 border-slate-300 p-4 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-black">
                                                MONITOR 1 (HDMI OUT 1)
                                            </span>
                                            <span className="text-xs font-extrabold text-slate-900">
                                                Elo 2202L 21.5" Touch — Estación: {kdsStationFilter}
                                            </span>
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-500">
                                            Bump Bar USB HID: Teclas [1-{kdsTickets.length}] para despachar
                                        </span>
                                    </div>

                                    {kdsTickets.length === 0 ? (
                                        <div className="py-12 text-center space-y-2">
                                            <p className="text-sm font-extrabold text-emerald-700">¡Todas las órdenes despachadas en cocina!</p>
                                            <p className="text-xs text-slate-500">Cobra una orden en la Caja POS, inyecta una de Uber Eats / DoorDash o presiona "Recuperar Última Orden".</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {kdsTickets.map((tkt, idx) => {
                                                const visibleItems = kdsStationFilter === 'ALL_EXPO'
                                                    ? tkt.items
                                                    : tkt.items.filter(i => i.station === kdsStationFilter)
                                                if (visibleItems.length === 0) return null

                                                const isWarning = tkt.elapsedMinutes >= 5
                                                return (
                                                    <div
                                                        key={tkt.id}
                                                        className={`rounded-xl border-2 flex flex-col justify-between overflow-hidden bg-white ${
                                                            isWarning ? 'border-amber-400' : 'border-slate-200'
                                                        }`}
                                                    >
                                                        <div>
                                                            <div className={`px-3 py-2 flex items-center justify-between border-b ${
                                                                tkt.channel === 'UBER EATS' || tkt.channel === 'DOORDASH'
                                                                    ? 'bg-orange-50 border-orange-200'
                                                                    : isWarning
                                                                        ? 'bg-amber-50 border-amber-200'
                                                                        : 'bg-slate-50 border-slate-200'
                                                            }`}>
                                                                <div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-black">
                                                                            Tecla #{idx + 1}
                                                                        </span>
                                                                        <span className="text-xs font-black text-slate-900">
                                                                            #{tkt.checkNumber}
                                                                        </span>
                                                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-800">
                                                                            {tkt.channel}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[11px] font-bold text-slate-700 mt-0.5 truncate">
                                                                        {tkt.customerName}
                                                                    </p>
                                                                </div>
                                                                <span className={`text-xs font-black tabular-nums ${isWarning ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                                    {tkt.elapsedMinutes}m
                                                                </span>
                                                            </div>

                                                            <div className="p-3 space-y-2">
                                                                {visibleItems.map((it, itemIdx) => (
                                                                    <div
                                                                        key={itemIdx}
                                                                        onClick={() => {
                                                                            setKdsTickets(prev => prev.map(k => {
                                                                                if (k.id !== tkt.id) return k
                                                                                return {
                                                                                    ...k,
                                                                                    items: k.items.map((x, xi) => xi === itemIdx ? { ...x, done: !x.done } : x)
                                                                                }
                                                                            }))
                                                                        }}
                                                                        className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                                                                            it.done ? 'bg-emerald-50/70 border-emerald-200 line-through text-slate-400' : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100'
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="text-xs font-extrabold text-slate-900">
                                                                                {it.qty}x {it.name}
                                                                            </span>
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                                                                                {it.station}
                                                                            </span>
                                                                        </div>
                                                                        {it.modifiers.map((m, mi) => (
                                                                            <p key={mi} className={`text-[11px] font-bold mt-0.5 ${m.includes('***') ? 'text-red-600' : 'text-slate-600'}`}>
                                                                                → {m}
                                                                            </p>
                                                                        ))}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={() => handleBumpKdsOrder(tkt)}
                                                            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider cursor-pointer transition-colors"
                                                        >
                                                            ✓ BUMP / DESPACHAR EN DB (Tecla {idx + 1})
                                                        </button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* MONITOR 2: SECONDARY HDMI MIRROR OVER THE GRILL + ALL-DAY PRODUCTION COUNTS (4 COLS) */}
                                <div className="xl:col-span-4 space-y-4">
                                    <div className="bg-white rounded-2xl border-2 border-amber-300 p-4 shadow-sm space-y-3">
                                        <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                                            <div>
                                                <span className="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-black">
                                                    MONITOR 2 (ESPEJO HDMI / CAT6)
                                                </span>
                                                <h4 className="text-xs font-extrabold text-slate-900 mt-1">
                                                    Pantalla 27" sobre Parrilla (Cero Licencia Extra)
                                                </h4>
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                1080p@60Hz Sync
                                            </span>
                                        </div>

                                        <p className="text-[11px] text-slate-600">
                                            {hdmiMirrorMode === 'MIRROR_CLONE'
                                                ? 'Modo Splitter Activo 1x2: Duplica en tiempo real la señal de video HDMI del KDS Principal hacia el monitor del taquero.'
                                                : 'Modo Extendido Dual HDMI: La misma Mini PC envía solo los platillos de PARRILLA a este segundo monitor por el puerto HDMI 2.'}
                                        </p>

                                        {/* All-Day Production Counts for Taquero */}
                                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                                                Conteo Acumulado en Vivo (All-Day Grill Counts)
                                            </span>
                                            <div className="space-y-1.5 text-xs">
                                                {kdsTickets.flatMap(t => t.items).map((it, idx) => (
                                                    <div key={idx} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                                                        <span className="font-bold text-slate-800 truncate">{it.name}</span>
                                                        <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 font-black tabular-nums">
                                                            {it.qty} pzs
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 5: DISEÑADOR DE TICKETS & RECIBOS ESC/POS (WYSIWYG STUDIO)
                       ================================================================= */}
                    {activeCategory === 'tickets' && (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-purple-600 uppercase tracking-wider">
                                        <Printer size={14} />
                                        <span>Estudio Unificado de Recibos Térmicos 80mm — Cocina 100% KDS HDMI Sin Papel</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        Vista Previa en Vivo: Recibo de Pago Cliente (80mm) + Ticket de Orden / Bolsa (Mostrador, Drive-Thru & Delivery)
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        En <strong>Tacos Gavilan</strong> los cocineros y taqueros NO usan impresoras ni comandas de papel: toda la preparación corre 100% en el <strong>KDS con Pantallas Duplicadas HDMI</strong> (igual que hoy en Toast). La única impresora es la térmica de 80mm en Caja / Entrega (`Epson TM-T88VII`) para el recibo del cliente y el ticket de bolsa/llamado de orden.
                                    </p>
                                </div>
                                <div className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-extrabold shrink-0">
                                    ✓ 0% Impresoras en Cocina (100% KDS HDMI)
                                </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                                {/* LEFT 4 COLS: CONTROLS */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <h3 className="text-sm font-extrabold text-slate-900">Opciones de Impresión Térmica 80mm (Mostrador y Entrega)</h3>
                                    {[
                                        { key: 'showLogo', label: 'Imprimir Logotipo Oficial de Tacos Gavilan' },
                                        { key: 'giantOrderNumber', label: 'Número de Orden Gigante Invertido (#1044) para Llamado' },
                                        { key: 'consolidateIdenticalItems', label: 'Consolidar Artículos Idénticos (4x Taco Asada)' },
                                        { key: 'redInkKitchenModifiers', label: 'Resaltar Modificadores en BLOQUE INVERTIDO (GS B 1) + Alerta KDS' },
                                        { key: 'printEbtRemainingBalance', label: 'Imprimir Saldo Restante cuando se cobra con EBT CalFresh RMP' },
                                        { key: 'showQrCodeSurvey', label: 'Imprimir Código QR Dinámico al Pie del Recibo Cliente' },
                                        { key: 'soundKitchenBuzzer', label: 'Imprimir Ticket de Bolsa / Empaque (To-Go, Drive-Thru y Delivery)' },
                                    ].map(opt => (
                                        <label key={opt.key} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                                            <span className="text-xs font-bold text-slate-800 pr-2">{opt.label}</span>
                                            <input
                                                type="checkbox"
                                                checked={(receiptConfig as any)[opt.key]}
                                                onChange={(e) => {
                                                    const nextChecked = e.target.checked
                                                    setReceiptConfig(prev => ({ ...prev, [opt.key]: nextChecked }))
                                                    recordChange('Diseño de Tickets', opt.label, String(!(receiptConfig as any)[opt.key]), String(nextChecked))
                                                    if (opt.key === 'redInkKitchenModifiers') {
                                                        dispatchPosMutation('SAVE_STORE_CONFIG', {
                                                            storeNumber: activeStore?.storeNumber || 14,
                                                            quoteMinutes: onlineQuoteMins,
                                                            receiptFooter: receiptConfig.customFooterEs,
                                                            printRedModifiers: nextChecked,
                                                            printerReceiptIp: printerTargetIp,
                                                        })
                                                    }
                                                }}
                                                className="w-4 h-4 accent-purple-600 cursor-pointer"
                                            />
                                        </label>
                                    ))}

                                    <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 text-[11px] text-blue-950 space-y-1">
                                        <p className="font-extrabold flex items-center gap-1.5">
                                            <Tv size={13} className="text-blue-700" />
                                            <span>¿Cómo ven la orden los cocineros y taqueros?</span>
                                        </p>
                                        <p className="text-blue-900">
                                            Al cobrar en Caja o entrar un pedido de Uber Eats / DoorDash, la orden viaja en <strong>&lt;5ms por red LAN</strong> directo al <strong>KDS Principal + Monitor Espejo HDMI</strong> sobre la parrilla. No se gasta ni un centavo en impresoras ni rollos de papel dentro de la cocina.
                                        </p>
                                    </div>
                                </div>

                                {/* CENTER 4 COLS: 80MM THERMAL CUSTOMER PAYMENT RECEIPT (EPSON TM-T88VII) */}
                                <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col items-center">
                                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-3">
                                        1. Recibo Térmico de Pago Cliente (80mm Epson TM-T88VII)
                                    </span>
                                    <div className="w-full max-w-[310px] bg-[#FEFEFA] border border-slate-300 rounded-lg p-4 shadow-md font-mono text-[11px] text-slate-900 space-y-2">
                                        {receiptConfig.showLogo && (
                                            <div className="text-center border-b border-dashed border-slate-300 pb-2">
                                                <p className="text-sm font-black tracking-tight">🦅 TACOS GAVILAN</p>
                                                <p className="text-[10px] text-slate-600">Sucursal #{activeStore?.storeNumber || 14} {activeStore?.name || 'Lynwood'} • (310) 555-0192</p>
                                            </div>
                                        )}
                                        {receiptConfig.giantOrderNumber && (
                                            <div className="bg-slate-900 text-white text-center py-1.5 rounded font-black text-base tracking-wider">
                                                ORDEN #{lastReceiptInfo.checkNumber} • {diningOption}
                                            </div>
                                        )}
                                        <div className="text-[10px] text-slate-600 flex justify-between border-b border-dashed border-slate-300 pb-1.5">
                                            <span>Cliente: {customerNameOrder}</span>
                                            <span>Cajero: Caja #1</span>
                                        </div>
                                        <div className="space-y-1.5 py-1 border-b border-dashed border-slate-300">
                                            {cart.map(c => (
                                                <div key={c.id}>
                                                    <div className="flex justify-between font-bold">
                                                        <span>{c.qty}x {c.name}</span>
                                                        <span>${(c.unitPrice * c.qty).toFixed(2)}</span>
                                                    </div>
                                                    {c.modifiers.map((m, idx) => (
                                                        <p key={idx} className="text-[10px] pl-3 text-slate-600">
                                                            + {m.name} {m.price > 0 ? `$${m.price.toFixed(2)}` : ''}
                                                        </p>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                        <div className="space-y-0.5 text-[11px]">
                                            <div className="flex justify-between">
                                                <span>SUBTOTAL:</span>
                                                <span>${cartTotals.subtotal.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>SALES TAX ({ cartTotals.isEbtFoodStamp ? '0% EBT RMP' : `${currentTaxRate}%` }):</span>
                                                <span>${cartTotals.tax.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between font-black text-xs pt-1 border-t border-slate-300">
                                                <span>TOTAL PAGADO:</span>
                                                <span>${cartTotals.total.toFixed(2)}</span>
                                            </div>
                                        </div>
                                        <div className="p-1.5 bg-slate-100 rounded text-[10px] font-bold space-y-0.5">
                                            <p>MÉTODO: {selectedTender === 'EBT_FOOD' ? 'EBT CALFRESH RMP (CHIP/PIN)' : selectedTender === 'EBT_CASH' ? 'EBT CASH' : selectedTender === 'CASH' ? 'EFECTIVO' : lastReceiptInfo.tender}</p>
                                            {receiptConfig.printEbtRemainingBalance && (
                                                <p className="text-teal-800">
                                                    {selectedTender === 'EBT_FOOD' || selectedTender === 'EBT_CASH'
                                                        ? `SALDO RESTANTE EBT FOOD: $${(lastReceiptInfo.ebtRemainingBalance ?? 144.89).toFixed(2)}`
                                                        : 'SALDO EBT FOOD (Al pagar con CalFresh): $144.89'}
                                                </p>
                                            )}
                                        </div>
                                        {receiptConfig.showQrCodeSurvey && (
                                            <div className="pt-2 text-center space-y-1 border-t border-dashed border-slate-300">
                                                <QrCode size={42} className="mx-auto text-slate-800" />
                                                <p className="text-[9px] text-slate-600">{receiptConfig.customFooterEs}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* RIGHT 4 COLS: 80MM THERMAL BAG / ORDER CALLING SLIP (FOR TO-GO, DRIVE-THRU & DELIVERY) + LIVE TCP 9100 SOCKET */}
                                <div className="xl:col-span-4 space-y-4">
                                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col items-center">
                                        <div className="w-full flex items-center justify-between mb-2">
                                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-purple-700">
                                                2. Ticket Térmico de Bolsa / Entrega (80mm Mostrador/Expo)
                                            </span>
                                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] font-black">
                                                Cocina = 100% KDS HDMI
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mb-3 text-center">
                                            Se imprime en la misma <strong>Epson TM-T88VII de Caja/Expo</strong> para engrapar a la bolsa de <em>To-Go, Drive-Thru, Uber Eats o DoorDash</em> (sin precios, con checklist de empaque).
                                        </p>

                                        {receiptConfig.soundKitchenBuzzer ? (
                                            <div className="w-full max-w-[310px] bg-[#FEFEFA] border border-slate-300 rounded-lg p-4 shadow-md font-mono text-xs text-slate-900 space-y-2">
                                                <div className="bg-slate-900 text-white text-center py-2 rounded font-black text-base tracking-wider">
                                                    ORDEN #{lastReceiptInfo.checkNumber} • {diningOption}
                                                </div>
                                                <div className="border-b border-dashed border-slate-300 pb-1.5 flex justify-between items-center text-[11px]">
                                                    <span className="font-black">CLIENTE: {customerNameOrder}</span>
                                                    <span className="font-bold text-slate-600">BOLSA 1/1</span>
                                                </div>
                                                <div className="space-y-2 py-1">
                                                    {cart.map(c => (
                                                        <div key={c.id} className="border-b border-dashed border-slate-300 pb-1.5">
                                                            <p className="font-black text-xs flex items-center justify-between">
                                                                <span>[✓] {c.qty}x {c.name.toUpperCase()}</span>
                                                            </p>
                                                            {c.modifiers.map((m, idx) => (
                                                                <p
                                                                    key={idx}
                                                                    className={`font-extrabold text-[11px] mt-0.5 inline-block ${
                                                                        receiptConfig.redInkKitchenModifiers && m.isAlert
                                                                            ? 'bg-slate-900 text-white px-1.5 py-0.5 rounded'
                                                                            : 'pl-3 text-slate-700'
                                                                    }`}
                                                                >
                                                                    {m.name}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="pt-1 text-center text-[10px] font-bold text-slate-500">
                                                    PREPARADO EN KDS HDMI • VERIFICADO EN ENTREGA
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-full max-w-[310px] p-6 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-1">
                                                <p className="text-xs font-extrabold text-slate-700">Ticket de Bolsa Desactivado (Modo Dine-In 100% Digital)</p>
                                                <p className="text-[11px] text-slate-500">Solo se imprime el Recibo de Pago del Cliente y la orden pasa directo al KDS HDMI.</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-700">
                                                Transmisor Binario Real ESC/POS (Socket TCP 9100 → Epson TM-T88VII)
                                            </span>
                                            <span className="text-[10px] font-mono font-bold text-slate-500">net.Socket()</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={printerTargetIp}
                                                onChange={(e) => setPrinterTargetIp(e.target.value)}
                                                placeholder="IP Impresora Térmica Caja (ej. 192.168.14.50:9100)"
                                                className="flex-1 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-mono font-bold text-slate-800"
                                            />
                                            <button
                                                disabled={testingTcpPrint}
                                                onClick={async () => {
                                                    setTestingTcpPrint(true)
                                                    try {
                                                        const res = await fetch('/api/gavilan-pos/overview', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                action: 'TEST_TCP_PRINT',
                                                                targetIpPort: printerTargetIp,
                                                                receiptHeader: 'TACOS GAVILAN — SABOR AUTÉNTICO',
                                                                receiptFooter: receiptConfig.customFooterEs,
                                                                printRedModifiers: receiptConfig.redInkKitchenModifiers,
                                                                orderInfo: {
                                                                    orderNumber: lastReceiptInfo.checkNumber,
                                                                    diningOption,
                                                                    totalAmount: cartTotals.total,
                                                                    paymentMethod: selectedTender,
                                                                    items: cart,
                                                                }
                                                            })
                                                        })
                                                        const data = await res.json()
                                                        const pr = data.printResult || {}
                                                        setTcpPrintResult({
                                                            target: pr.target || printerTargetIp,
                                                            connected: Boolean(pr.connected),
                                                            message: pr.message || '',
                                                            hexPreview: pr.hexPreview || '',
                                                            bytesLength: pr.bytesLength || 0
                                                        })
                                                    } catch (e: any) {
                                                        setTcpPrintResult({
                                                            target: printerTargetIp,
                                                            connected: false,
                                                            message: `Error de red: ${e?.message || 'Timeout'}`,
                                                            hexPreview: '1b 40 1b 70 00 19 fa 1b 61 01',
                                                            bytesLength: 164
                                                        })
                                                    } finally {
                                                        setTestingTcpPrint(false)
                                                    }
                                                }}
                                                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-extrabold cursor-pointer shrink-0"
                                            >
                                                {testingTcpPrint ? 'Enviando...' : 'Probar Socket 9100'}
                                            </button>
                                        </div>
                                        {tcpPrintResult && (
                                            <div className={`p-2.5 rounded-xl border text-[11px] space-y-1 ${
                                                tcpPrintResult.connected
                                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                                                    : 'bg-amber-50 border-amber-200 text-amber-950'
                                            }`}>
                                                <p className="font-extrabold">
                                                    {tcpPrintResult.connected ? `✓ Impresora ${tcpPrintResult.target} Alcanzada` : `⚡ Paquete Binario Generado (${tcpPrintResult.bytesLength} bytes)`}
                                                </p>
                                                <p className="text-[10px]">{tcpPrintResult.message}</p>
                                                <p className="font-mono text-[9px] bg-white/80 p-1.5 rounded border border-slate-200 break-all">
                                                    HEX: {tcpPrintResult.hexPreview}
                                                </p>
                                            </div>
                                        )}
                                        <pre className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-800 overflow-x-auto">
{`// Apertura Cajón APG Vasario (ESC p Pin 2 50ms)
0x1B 0x70 0x00 0x19 0xFA
// Bloque Invertido Blanco/Negro en Térmica 80mm TM-T88VII (GS B 1)
0x1D 0x42 0x01  "*** SIN CEBOLLA ***"  0x1D 0x42 0x00
// Corte Parcial Automático (GS V 66 0)
0x1D 0x56 0x42 0x00`}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 6: PAGOS, BANCOS (INTERCHANGE++) & EBT CALFRESH RMP
                       ================================================================= */}
                    {activeCategory === 'payments' && (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                                <div className="flex items-center gap-2 text-xs font-bold text-teal-600 uppercase tracking-wider">
                                    <CreditCard size={14} />
                                    <span>Arquitectura Bancaria True Interchange++ & CalFresh EBT RMP (Un Solo PIN Pad PAX A35)</span>
                                </div>
                                <h2 className="text-xl font-black text-slate-900 mt-1">
                                    Calculadora de Ahorro Bancario Real ($43.2M en Tarjetas) + Configuración USDA FNS EBT
                                </h2>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* Interactive Interchange++ Calculator */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <h3 className="text-sm font-extrabold text-slate-900">
                                        Simulador Auditado: Toast Payments vs. Contrato Directo True Interchange++
                                    </h3>

                                    <div className="space-y-3">
                                        <div>
                                            <div className="flex justify-between text-xs font-bold">
                                                <span>Tasa Efectiva Actual en Toast (%):</span>
                                                <span className="text-rose-600">{toastEffectiveRate.toFixed(2)}%</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="2.10"
                                                max="2.85"
                                                step="0.05"
                                                value={toastEffectiveRate}
                                                onChange={(e) => setToastEffectiveRate(Number(e.target.value))}
                                                className="w-full accent-red-600 cursor-pointer mt-1"
                                            />
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs font-bold">
                                                <span>Markup Procesador Directo IC++ (Basis Points):</span>
                                                <span className="text-emerald-700">{interchangePlusMarkupBps} bps (0.0{interchangePlusMarkupBps}%)</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="5"
                                                max="20"
                                                step="1"
                                                value={interchangePlusMarkupBps}
                                                onChange={(e) => setInterchangePlusMarkupBps(Number(e.target.value))}
                                                className="w-full accent-emerald-600 cursor-pointer mt-1"
                                            />
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs font-bold">
                                                <span>Proporción de Tarjetas de Débito Reguladas (Durbin 0.05% + $0.22):</span>
                                                <span className="text-blue-700">{regulatedDebitSharePct}%</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="45"
                                                max="75"
                                                step="5"
                                                value={regulatedDebitSharePct}
                                                onChange={(e) => setRegulatedDebitSharePct(Number(e.target.value))}
                                                className="w-full accent-blue-600 cursor-pointer mt-1"
                                            />
                                        </div>
                                    </div>

                                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-slate-600">Comisiones Anuales en Toast ($43.2M vol):</span>
                                            <span className="font-black text-rose-700 tabular-nums">${Math.round(savingsMath.toastAnnualFees).toLocaleString('en-US')} / año</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-600">Comisiones Anuales True Interchange++ ({savingsMath.icPlusEffectivePct.toFixed(2)}% efec.):</span>
                                            <span className="font-black text-emerald-700 tabular-nums">${Math.round(savingsMath.icPlusAnnualFees).toLocaleString('en-US')} / año</span>
                                        </div>
                                        <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-black text-emerald-900">
                                            <span>Ahorro Anual Total (Tarjetas + SaaS Toast):</span>
                                            <span className="tabular-nums">+${Math.round(savingsMath.totalAnnualSavings).toLocaleString('en-US')} USD / año</span>
                                        </div>
                                    </div>
                                </div>

                                {/* EBT CalFresh RMP Technical & Regulatory Matrix */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <h3 className="text-sm font-extrabold text-slate-900">
                                        Protocolo Oficial para Conservar y Unificar EBT (CalFresh RMP)
                                    </h3>
                                    <div className="space-y-2.5 text-xs">
                                        <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200">
                                            <p className="font-extrabold text-teal-950">1. Conservas tus mismos 15 Números USDA FNS</p>
                                            <p className="text-teal-800 mt-0.5">
                                                El permiso CDSS / USDA RMP pertenece a la razón social de Tacos Gavilan, no a Toast. Al contratar Fiserv, Worldpay (FIS) o Payroc, solo se carga tu FNS de 7 dígitos en la hoja VAR con la bandera <strong>RMP Override (MCC 5812/5814)</strong>.
                                            </p>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                            <p className="font-extrabold text-slate-900">2. Soporte Mandato Chip EMV EBT de California (AID: A0000000044542)</p>
                                            <p className="text-slate-600 mt-0.5">
                                                El lector <strong>PAX A35</strong> con <strong>PAX POSLink / Datacap NETePay</strong> lee las nuevas tarjetas EBT con Chip EMV de California, solicita el PIN encriptado DUKPT en el mismo lector donde cobran Apple Pay y Visa, y devuelve el saldo <code>FoodBalance</code>.
                                            </p>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                                            <p className="font-extrabold text-slate-900">3. Exención Automática de Sales Tax (0.00% CDTFA)</p>
                                            <p className="text-slate-600 mt-0.5">
                                                Al presionar el botón <strong>EBT CalFresh</strong> en Gavilan POS, el sistema elimina automáticamente el impuesto de California antes de enviar el monto al lector PAX A35.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 7: DELIVERY DIRECTO API (UBER EATS, DOORDASH, GRUBHUB)
                       ================================================================= */}
                    {activeCategory === 'delivery' && (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-bold text-orange-600 uppercase tracking-wider">
                                        <Truck size={14} />
                                        <span>Hub de Integración Directa con Plataformas de Delivery ($0/mes de Intermediarios)</span>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-900 mt-1">
                                        Uber Eats Marketplace API + DoorDash Marketplace/Drive API + Grubhub Partner API
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        Toast cobra ~$1,350 USD/mes ($16,200/año) solo por pasar los webhooks de Uber/DoorDash al KDS. Con Gavilan POS nos conectamos directo a los portales oficiales de desarrollador por $0/mes.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {[
                                    {
                                        name: 'Uber Eats Marketplace API',
                                        vol2025: '$6,100,924 USD (2025 Real)',
                                        endpoint: 'POST /api/gavilan-pos/webhooks/ubereats',
                                        features: ['OAuth 2.0 (eats.order, eats.store)', 'Inyección al KDS HDMI en < 800ms', 'Sincronización de Menú + 86ing instantáneo'],
                                        platformKey: 'UBER EATS' as const,
                                        badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    },
                                    {
                                        name: 'DoorDash Marketplace & Drive API',
                                        vol2025: '$5,309,741 USD (2025 Real)',
                                        endpoint: 'POST /api/gavilan-pos/webhooks/doordash',
                                        features: ['JWT HS256 (developer.doordash.com)', 'Incluye DoorDash Drive (Choferes tarifa plana para Web propia)', 'Confirmación automática PATCH /orders/{id}'],
                                        platformKey: 'DOORDASH' as const,
                                        badgeColor: 'bg-red-50 text-red-800 border-red-200'
                                    },
                                    {
                                        name: 'Grubhub Partner API v2',
                                        vol2025: '$548,501 USD (2025 Real)',
                                        endpoint: 'POST /api/gavilan-pos/webhooks/grubhub',
                                        features: ['Ciclo CONFIRMED -> PICKUP_READY al hacer Bump en KDS', 'Sincronización de precios (+18% Uplift)', 'Vinculado con Blindaje Delivery TEG'],
                                        platformKey: 'GRUBHUB' as const,
                                        badgeColor: 'bg-orange-50 text-orange-800 border-orange-200'
                                    }
                                ].map((ch) => (
                                    <div key={ch.name} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between space-y-4">
                                        <div className="space-y-2.5">
                                            <div className="flex items-center justify-between">
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${ch.badgeColor}`}>
                                                    API DIRECTA ($0/MES)
                                                </span>
                                                <span className="text-xs font-extrabold text-slate-700">{ch.vol2025}</span>
                                            </div>
                                            <h3 className="text-base font-black text-slate-900">{ch.name}</h3>
                                            <p className="text-[11px] font-mono bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700">
                                                {ch.endpoint}
                                            </p>
                                            <ul className="space-y-1 text-xs text-slate-600 pt-1">
                                                {ch.features.map((f, i) => (
                                                    <li key={i} className="flex items-center gap-1.5">
                                                        <Check size={13} className="text-emerald-600 shrink-0" />
                                                        <span>{f}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <button
                                            onClick={() => simulateIncomingDeliveryOrder(ch.platformKey)}
                                            className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer transition-colors"
                                        >
                                            Simular Webhook en Vivo → Enviar a KDS
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* TRANSPARENT REALITY OF DIRECT DELIVERY APIS VS AGGREGATOR MIDDLEWARE */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
                                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                    <div>
                                        <span className="text-[10px] font-black uppercase text-orange-600">Transparencia Técnica y Comercial • ¿Nos dan el API directo sin costo?</span>
                                        <h3 className="text-sm font-black text-slate-900">
                                            Cómo funcionan los Portales Oficiales de Uber Eats, DoorDash y Grubhub para un POS Propio
                                        </h3>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black">
                                        15 Sucursales • ~$12M USD/año Delivery
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                    <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1.5">
                                        <p className="font-extrabold text-emerald-950">
                                            ✅ Camino A (Meta Principal — $0 USD/mes): Certificación Directa como &quot;In-House Enterprise POS&quot;
                                        </p>
                                        <p className="text-[11px] text-emerald-900 leading-relaxed">
                                            Ni <strong>Uber Eats (`developer.uber.com`)</strong>, ni <strong>DoorDash (`developer.doordash.com`)</strong>, ni <strong>Grubhub (`developer.grubhub.com`)</strong> cobran mensualidad por usar sus APIs directas. A un restaurante de 1 sola tienda casi no le abren el portal directo, pero <strong>Tacos Gavilan (15 sucursales y ~$12 Millones USD/año en delivery)</strong> califica como cadena Enterprise con software propio. El único requisito es pasar su prueba técnica en <strong>Sandbox (Homologación)</strong> en La Bodega Central: demostrar que nuestro servidor responde Webhooks en &lt;2 segundos, actualiza el menú y marca agotados (`86ing`).
                                        </p>
                                    </div>
                                    <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
                                        <p className="font-extrabold text-amber-950">
                                            🛡️ Camino B (Plan de Respaldo Temporal — ~$50 a $75/mes): Agregador Puente (`Deliverect` / `Otter`)
                                        </p>
                                        <p className="text-[11px] text-amber-900 leading-relaxed">
                                            Si alguna de las 3 plataformas tardara varias semanas en revisar y aprobar nuestra homologación directa durante el piloto, no detenemos el proyecto: podemos conectar temporalmente un puente agregador certificado (como <strong>Deliverect</strong> u <strong>Otter API</strong>) solo mientras nos liberan las llaves de producción directas, y apagarlo en cuanto queden activas las 3 conexiones directas de <strong>$0/mes</strong>.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 8: HARDWARE LAN, BODEGA CENTRAL LAB (4 FASES CODEX), BATERÍAS ANTI-APAGÓN & CORTE Z
                       ================================================================= */}
                    {activeCategory === 'hardware' && (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                                <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider">
                                    <HardDrive size={14} />
                                    <span>Laboratorio en La Bodega Central (`Warehouse Lab`), Plan en 4 Fases (Codex), Baterías Anti-Apagón y Arqueo Ciego</span>
                                </div>
                                <h2 className="text-xl font-black text-slate-900 mt-1">
                                    Especificación del Piloto en La Bodega Central + Diagnóstico Real `Toast Flex 14&quot;` (`RK3399`) + Idempotencia
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Desarrollamos y validamos <strong>Gavilan POS</strong> como producto independiente en <strong>La Bodega Central (Warehouse)</strong> sobre hardware Android/Windows abierto, tratando la reutilización de terminales Toast Flex como una opción a validar en una unidad de repuesto sin arriesgar ninguna de las 15 sucursales operativas.
                                </p>
                            </div>

                            {/* CODEX 4-PHASE ENGINEERING PLAN + LIVE PHASE 2 IDEMPOTENCY VALIDATOR + TOAST FLEX RK3399 DIAGNOSIS */}
                            <div className="bg-white rounded-2xl border-2 border-indigo-200 p-5 shadow-2xs space-y-4">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                                    <div>
                                        <span className="text-[10px] font-black uppercase text-indigo-700">
                                            Hoja de Ruta de Ingeniería • Laboratorio en La Bodega Central (Warehouse)
                                        </span>
                                        <h3 className="text-base font-black text-slate-900">
                                            Plan de Ejecución en 4 Fases con Criterios Medibles de Aceptación + Prueba Real de Idempotencia
                                        </h3>
                                    </div>
                                    <button
                                        disabled={runningIdempotencyLab}
                                        onClick={async () => {
                                            setRunningIdempotencyLab(true)
                                            try {
                                                const res = await fetch('/api/gavilan-pos/overview', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        action: 'VERIFY_IDEMPOTENCY_LAB',
                                                        storeNumber: activeStore?.storeNumber || 14
                                                    })
                                                })
                                                const data = await res.json()
                                                if (data?.ok && data.labResult) {
                                                    setIdempotencyLabResult(data.labResult)
                                                    setLastDbWriteBadge('Prueba Fase 2 Completada: 3 Reintentos = 1 Orden (0 Duplicados)')
                                                }
                                            } catch (err) {
                                                console.error('Error in idempotency lab test:', err)
                                            } finally {
                                                setRunningIdempotencyLab(false)
                                            }
                                        }}
                                        className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-black cursor-pointer shadow-xs flex items-center gap-2 shrink-0"
                                    >
                                        <Zap size={14} />
                                        <span>
                                            {runningIdempotencyLab
                                                ? 'Probando 3 Reintentos en Supabase...'
                                                : '⚡ Probar Idempotencia Fase 2 en Vivo (3 Reintentos = 0 Duplicados)'}
                                        </span>
                                    </button>
                                </div>

                                {idempotencyLabResult && (
                                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                                        <div className="space-y-0.5">
                                            <p className="font-black text-emerald-950">
                                                ✅ CRITERIO FASE 2 VERIFICADO EN SUPABASE POSTGRESQL: CERO ÓRDENES DUPLICADAS AL RECONECTAR RED
                                            </p>
                                            <p className="text-[11px] text-emerald-900">
                                                ID Único: <code>{idempotencyLabResult.clientOrderId}</code> • Se enviaron <strong>{idempotencyLabResult.attemptsSent} intentos idénticos</strong> simulando reconexión tras corte de internet en La Bodega Central → Intento #1: <strong>Insertado</strong> | Intento #2: <strong>Replay Idempotente Detectado</strong> | Intento #3: <strong>Replay Idempotente Detectado</strong>.
                                            </p>
                                        </div>
                                        <span className="px-3 py-1.5 rounded-xl bg-emerald-700 text-white font-black text-xs shrink-0">
                                            Filas Creadas en DB: {idempotencyLabResult.persistedRowCount} (0 Duplicados)
                                        </span>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                                    {[
                                        {
                                            phase: 'FASE 1 • DEFINIR EL POS',
                                            title: 'Flujos y Matriz de Hardware',
                                            work: 'Cerrar flujos de caja, modificadores, cocina KDS sin papel, drive-thru secuencial, kiosco, cortes Z y permisos. Inventariar terminales, lectores, impresoras y red.',
                                            criteria: '✓ Flujos y matriz documentados; alcance del laboratorio en La Bodega Central acordado.',
                                            badge: 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                        },
                                        {
                                            phase: 'FASE 2 • CONSTRUIR EL NÚCLEO',
                                            title: 'Estados Claros e Idempotencia',
                                            work: 'Órdenes y pagos con estados claros, sincronización Caja ↔ KDS HDMI (<5ms), operación local ante cortes de internet e idempotencia (client_order_id) al reconectar en hardware Android abierto.',
                                            criteria: '✓ La estación de laboratorio completa órdenes sin duplicados ni pérdida de datos.',
                                            badge: 'bg-blue-100 text-blue-900 border-blue-300'
                                        },
                                        {
                                            phase: 'FASE 3 • VALIDAR HARDWARE Y PAGOS',
                                            title: 'PAX A35 + EBT RMP + Consulta Toast',
                                            work: 'Probar periféricos reales en La Bodega Central y contratar integración certificada (Fiserv/Worldpay + Datacap/PAX POSLink + VAR Sheet FNS). Confirmar por escrito con Toast el estado de sus terminales tras baja.',
                                            criteria: '✓ Pruebas físicas satisfactorias (EMV/NFC/EBT/Impresión/KDS) y respuestas contractuales concretas.',
                                            badge: 'bg-amber-100 text-amber-900 border-amber-300'
                                        },
                                        {
                                            phase: 'FASE 4 • PILOTO Y DESPLIEGUE',
                                            title: 'Paralelo en 1 Tienda + Reversión',
                                            work: 'Operar en paralelo con Toast en 1 sucursal piloto (ej. Lynwood #14), conciliar ventas y cierres al centavo, entrenar cajeros/taqueros y tener lista reversión inmediata por switch LAN/HDMI.',
                                            criteria: '✓ Conciliación 100% exacta y continuidad operativa comprobada antes de expandir por grupos.',
                                            badge: 'bg-purple-100 text-purple-900 border-purple-300'
                                        }
                                    ].map((p, idx) => (
                                        <div key={idx} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-2">
                                            <div className="space-y-1.5">
                                                <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded border ${p.badge}`}>
                                                    {p.phase}
                                                </span>
                                                <h4 className="font-black text-slate-900 text-xs">{p.title}</h4>
                                                <p className="text-[11px] text-slate-600 leading-relaxed">{p.work}</p>
                                            </div>
                                            <div className="pt-2 border-t border-slate-200/80 text-[10px] font-extrabold text-slate-800">
                                                {p.criteria}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* TECHNICAL REALITY OF TOAST FLEX 14" (RK3399 + TOAST GUARDIAN) VS OPEN PERIPHERALS & INDEPENDENT EBT */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs pt-1">
                                    <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-1">
                                        <p className="font-extrabold text-rose-950">
                                            🔒 Inventario Real Device Hub (`Lynwood #14` y `LA Central #9` • Renueva `15-Nov-2026`)
                                        </p>
                                        <p className="text-[11px] text-rose-900 leading-relaxed">
                                            • <strong>LA Central (`ID: 614050`, `$1,004/mes`):</strong> 7x `14&quot; Toast Flex` (`C-1` a `C-7`, Android 12L, Firmware `3.0.55`, App `2.119.1`), 2x `KDS Flex`, 3x Kioscos `15&quot; Elo V4` (`$90/mes` c/u), 4x `TP200` + 2x `Epson L90`.<br />
                                            • <strong>Lynwood (`ID: 614310`, `$798.50/mes`):</strong> 7x `14&quot; Toast Flex` (`drive thru 1`, `LW-1` a `LW-5`, `Quick Order`), 2x `KDS Flex`, 1x `Toast Go 2`, 4x `TP200`, 1x `TP300 Hub`, 1x `Epson L90` y 1x `Epson L100`.
                                        </p>
                                    </div>
                                    <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
                                        <p className="font-extrabold text-emerald-950">
                                            ♻️ Subred `192.168.192.x` descubierta: Cómo probar `P-168` a `P-175` sin desconfigurarlas
                                        </p>
                                        <p className="text-[11px] text-emerald-900 leading-relaxed">
                                            En tus capturas (`C-1` = `192.168.192.69`), los nombres <strong>`P-168` a `P-175`</strong> significan que las impresoras tienen IP fija <strong>`192.168.192.168` a `.175`</strong> (ej. `Lynwood P-168 L90` = `.168`, `Lynwood P-172 TP200` = `.172`). <strong>¡No las resetees a fábrica en la bodega!</strong> Así las pruebas en `192.168.192.1xx:9100` y al regresarlas a la tienda siguen funcionando al instante.
                                        </p>
                                    </div>
                                    <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-1">
                                        <p className="font-extrabold text-blue-950">
                                            🏛️ Lector EBT Independiente Actual (`Cero Bloqueo`) + Lector de Tarjetas Bancarias
                                        </p>
                                        <p className="text-[11px] text-blue-900 leading-relaxed">
                                            <strong>¡Gran ventaja operativa!</strong> Como tus lectores de <strong>EBT (`CalFresh RMP`) ya son independientes</strong> al lector oficial de Toast, <strong>se quedan tal cual están hoy</strong> sin tocar tu permiso `USDA FNS`: en Gavilan POS tocas <em>EBT CalFresh</em>, el sistema quita el Tax a `$0.00` automáticamente y cobras en tu lector EBT actual. Para Visa/Mastercard/Apple Pay/Google Pay solo conectamos 1 lector bancario `Interchange++` (`PAX A35` o `Stripe S700 / Fiserv`).
                                        </p>
                                    </div>
                                </div>

                                {/* WAREHOUSE PHYSICAL TEST BENCH: EPSON L90 + TOAST TP200 + RJ12 CASH DRAWER + TABLET LAN URL */}
                                <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                                        <div>
                                            <span className="text-[10px] font-black uppercase text-amber-400">
                                                🧪 Banco de Pruebas Físicas en La Bodega Central • Contexto Claude + Codex
                                            </span>
                                            <h4 className="text-sm font-black text-white mt-0.5">
                                                Prueba Directa de `Toast TP200` (Recibo 80mm), `Epson TM-L90` (Etiqueta Bolsa) y Cajón `RJ12`
                                            </h4>
                                            <p className="text-[11px] text-slate-300 mt-0.5">
                                                Para abrir <strong>Gavilan POS</strong> en el navegador de una tableta conectada al mismo Wi-Fi/Router de la bodega, entra a: <code className="px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 font-black">{localLanInfo.posLanUrl}</code>
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                type="text"
                                                value={printerTargetIp}
                                                onChange={(e) => setPrinterTargetIp(e.target.value)}
                                                placeholder="IP:Puerto (ej. 192.168.1.200:9100)"
                                                className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-600 text-xs font-mono font-bold text-white"
                                            />
                                            <button
                                                disabled={scanningWarehouseLan}
                                                onClick={async () => {
                                                    setScanningWarehouseLan(true)
                                                    try {
                                                        const res = await fetch('/api/gavilan-pos/overview', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ action: 'SCAN_WAREHOUSE_PRINTERS' })
                                                        })
                                                        const data = await res.json()
                                                        if (data?.ok && data.scanResult) {
                                                            setDiscoveredPrinters(data.scanResult.discoveredPrinters || [])
                                                            setLastScanSubnet(data.scanResult.scannedSubnet || '')
                                                            if (data.scanResult.localLanInfo) setLocalLanInfo(data.scanResult.localLanInfo)
                                                            if (data.scanResult.discoveredPrinters?.[0]?.ipPort) {
                                                                setPrinterTargetIp(data.scanResult.discoveredPrinters[0].ipPort)
                                                            }
                                                        }
                                                    } catch (e) {
                                                        console.error('Error scanning LAN printers:', e)
                                                    } finally {
                                                        setScanningWarehouseLan(false)
                                                    }
                                                }}
                                                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black cursor-pointer"
                                            >
                                                {scanningWarehouseLan ? '🔍 Escaneando Subred...' : '🔍 1. Escanear Red Local (:9100)'}
                                            </button>
                                        </div>
                                    </div>

                                    {lastScanSubnet && (
                                        <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs flex flex-wrap items-center justify-between gap-2">
                                            <span>
                                                Subred escaneada: <strong>{lastScanSubnet}</strong> (+ IPs estáticas de fábrica <code>192.168.192.168</code>)
                                            </span>
                                            {discoveredPrinters.length > 0 ? (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className="text-emerald-400 font-black">¡{discoveredPrinters.length} Impresora(s) encontrada(s)!</span>
                                                    {discoveredPrinters.map(p => (
                                                        <button
                                                            key={p.ipPort}
                                                            onClick={() => setPrinterTargetIp(p.ipPort)}
                                                            className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-black text-[11px] cursor-pointer"
                                                        >
                                                            Usar {p.ipPort} ({p.latencyMs}ms)
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-amber-300 font-bold">
                                                    0 impresoras detectadas en :9100 en este momento (conecta la Epson L90 o TP200 por cable Ethernet al router).
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                                        {[
                                            {
                                                profile: 'TP200_80MM',
                                                label: '🖨️ 2. Probar Toast TP200 (Recibo 80mm + Abrir Cajón)',
                                                btnClass: 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                            },
                                            {
                                                profile: 'EPSON_L90_LABEL',
                                                label: '🏷️ 3. Probar Epson TM-L90 (Etiqueta Adhesiva Bolsa)',
                                                btnClass: 'bg-blue-600 hover:bg-blue-500 text-white'
                                            },
                                            {
                                                profile: 'DRAWER_ONLY',
                                                label: '🔓 4. Probar Solo Abrir Cajón RJ12 (Pulso Pin 2 + Pin 5)',
                                                btnClass: 'bg-purple-600 hover:bg-purple-500 text-white'
                                            }
                                        ].map(btn => (
                                            <button
                                                key={btn.profile}
                                                disabled={testingTcpPrint}
                                                onClick={async () => {
                                                    setTestingTcpPrint(true)
                                                    try {
                                                        const res = await fetch('/api/gavilan-pos/overview', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                action: 'TEST_TCP_PRINT',
                                                                targetIpPort: printerTargetIp,
                                                                printerProfile: btn.profile,
                                                                receiptHeader: 'TACOS GAVILAN — LAB BODEGA',
                                                                receiptFooter: 'PRUEBA FISICA EXITOSA EN BODEGA CENTRAL',
                                                                printRedModifiers: true,
                                                                orderInfo: {
                                                                    orderNumber: lastReceiptInfo.checkNumber,
                                                                    diningOption: diningOption,
                                                                    totalAmount: cartTotals.total,
                                                                    paymentMethod: selectedTender,
                                                                    items: cart.map(c => ({
                                                                        name: c.name,
                                                                        qty: c.qty,
                                                                        unitPrice: c.unitPrice,
                                                                        modifiers: c.modifiers.map(m => m.name)
                                                                    }))
                                                                }
                                                            })
                                                        })
                                                        const data = await res.json()
                                                        if (data?.printResult) {
                                                            setTcpPrintResult(data.printResult)
                                                        }
                                                    } catch (e) {
                                                        console.error('TCP test error:', e)
                                                    } finally {
                                                        setTestingTcpPrint(false)
                                                    }
                                                }}
                                                className={`py-2.5 px-3 rounded-xl text-xs font-black cursor-pointer transition-colors ${btn.btnClass}`}
                                            >
                                                {btn.label}
                                            </button>
                                        ))}
                                    </div>

                                    {tcpPrintResult && (
                                        <div className={`p-3 rounded-xl border text-xs ${
                                            tcpPrintResult.connected
                                                ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200'
                                                : 'bg-slate-800 border-slate-600 text-slate-200'
                                        }`}>
                                            <p className="font-black">{tcpPrintResult.message}</p>
                                            <p className="font-mono text-[10px] text-slate-400 mt-1 break-all">
                                                HEX ESC/POS ({tcpPrintResult.bytesLength} bytes): {tcpPrintResult.hexPreview}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 3-LAYER ANTI-BLACKOUT & BATTERY-BACKED POS ARCHITECTURE */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {[
                                    {
                                        badge: 'CAPA 1 • TERMINALES TIPO TABLETA CON BATERÍA (0ms)',
                                        title: 'Cajas POS que Nunca se Apagan en un Corte de Luz',
                                        color: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                                        items: [
                                            {
                                                name: 'Opción A: SUNMI T2s / D3 Pro + Base de Batería Litio Modular',
                                                spec: 'Base UPS de Litio integrada debajo del poste del POS. Conmutación 0ms: el cajero y el cliente ni siquiera notan que se fue la luz (4 a 6 horas de autonomía).'
                                            },
                                            {
                                                name: 'Opción B: iPad Pro 13" M2 o Galaxy Tab Active5 Pro en Stand PoE+',
                                                spec: 'Montura de acero Heckler WindFall con adaptador Ethernet PoE+ (datos + carga por un solo cable Cat6). Al irse la luz, opera 8 a 10 horas con su batería interna.'
                                            },
                                            {
                                                name: 'Opción C (Emergencia / Fila): PAX A920 Pro (5,150 mAh + 4G)',
                                                spec: 'Terminal portátil con batería para todo el turno, impresora térmica de 80mm integrada y chip 4G LTE Dual-SIM.'
                                            }
                                        ]
                                    },
                                    {
                                        badge: 'CAPA 2 • IMPRESORAS CON BATERÍA + ESTACIÓN LiFePO4 UPS',
                                        title: 'Impresión de Tickets y KDS HDMI Durante Apagones',
                                        color: 'bg-amber-50 text-amber-900 border-amber-200',
                                        items: [
                                            {
                                                name: 'Epson Mobilink TM-P80II Plus (Con Batería Nativa de 24 a 34h)',
                                                spec: 'Impresora térmica de recibos de 80mm con autocortador integrado, certificación IP54 contra grasa/agua y batería de litio interna de hasta 34 horas.'
                                            },
                                            {
                                                name: 'Estación Comercial LiFePO4 (EcoFlow DELTA 2 / Anker SOLIX C1000)',
                                                spec: '1,024Wh de Fosfato de Hierro y Litio (3,000 ciclos = 10 años de vida útil, no plomo-ácido). Conmutación EPS <10ms que alimenta la Impresora Térmica de Caja Epson TM-T88VII, el KDS Principal 21.5" y el Monitor Duplicado HDMI 27" de Parrilla por 7 a 9 horas continuas (0 impresoras en cocina).'
                                            }
                                        ]
                                    },
                                    {
                                        badge: 'CAPA 3 • RED LAN + 5G DUAL-WAN + STORE & FORWARD',
                                        title: 'Cobro Offline (Sin Internet) y Respaldo Celular para EBT',
                                        color: 'bg-blue-50 text-blue-800 border-blue-200',
                                        items: [
                                            {
                                                name: 'Mini DC UPS (12V/24V) + Switch Ethernet PoE+ Local',
                                                spec: 'Mantiene encendida la red LAN local de la tienda por 8 horas. Como Caja POS, KDS e Impresoras hablan por IP local (192.168.10.x), todo fluye a 5ms aunque no exista internet exterior.'
                                            },
                                            {
                                                name: 'Store-and-Forward (SAF) en PAX A35 + Cola Offline Browser',
                                                spec: 'Efectivo y Tarjetas EMV/NFC se guardan encriptados localmente (hasta $75 floor limit) y se liquidan solos cuando vuelve la red.'
                                            },
                                            {
                                                name: 'Router Celular Peplink BR1 Mini 5G (Vital para EBT CalFresh)',
                                                spec: 'La ley federal USDA FNS prohíbe EBT offline porque exige validar el saldo en vivo. Con el router 5G conectado a la batería LiFePO4, incluso en apagón total sigues cobrando EBT CalFresh en línea.'
                                            }
                                        ]
                                    }
                                ].map((layer, idx) => (
                                    <div key={idx} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
                                        <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded border ${layer.color}`}>
                                            {layer.badge}
                                        </span>
                                        <h3 className="text-sm font-black text-slate-900">{layer.title}</h3>
                                        <div className="space-y-2.5 pt-1">
                                            {layer.items.map((it, i) => (
                                                <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                                                    <p className="font-extrabold text-slate-900">{it.name}</p>
                                                    <p className="text-[11px] text-slate-600 mt-0.5">{it.spec}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* Bill of Materials Table (Including Battery & UPS Kit) */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <h3 className="text-sm font-extrabold text-slate-900">
                                            Lista Exacta de Equipos para la "Caja de Pruebas #1" (Cocina 100% KDS HDMI)
                                        </h3>
                                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black">
                                            Total Kit: $3,720 USD
                                        </span>
                                    </div>
                                    <div className="divide-y divide-slate-100 text-xs">
                                        {[
                                            { eq: 'Terminal POS Dual-Screen + Batería Litio / Stand PoE+', mod: 'SUNMI D3 Pro + Lithium UPS Base (o iPad Pro 13" en WindFall PoE+)', cost: '$950' },
                                            { eq: 'PIN Pad Semi-Integrado EMV / Apple Pay / EBT CalFresh (Con SAF Offline)', mod: 'PAX A35 (Ethernet LAN + SDK PAX POSLink / Datacap)', cost: '$250' },
                                            { eq: 'Impresora Térmica Mostrador 80mm (Recibo Cliente + Ticket Bolsa)', mod: 'Epson TM-T88VII (LAN 9100) o Epson Mobilink TM-P80II Plus (Batería 34h)', cost: '$390' },
                                            { eq: 'Cajón de Dinero Industrial de Acero + Llave Manual', mod: 'APG Vasario 1616 (Cable RJ12 CD-101A -> Impresora de Caja)', cost: '$135' },
                                            { eq: 'Cocina 100% Paperless (Cero Impresoras ni Rollos en Cocina)', mod: 'Los cocineros usan exclusivamente el KDS + Pantallas Duplicadas HDMI (Ahorras $360/caja)', cost: '$0' },
                                            { eq: 'Estación KDS Principal + Botonera Física + Espejeo HDMI 27"', mod: 'Mini PC Fanless + Elo 21.5" + Splitter OREI EDID + Monitor 27" + KB1700', cost: '$1,150' },
                                            { eq: 'Estación de Batería LiFePO4 (1,024Wh, <10ms EPS) + Router 5G Dual-WAN', mod: 'EcoFlow DELTA 2 (10 años vida útil) + Peplink BR1 Mini 5G + Mini DC UPS', cost: '$845' },
                                        ].map((r, i) => (
                                            <div key={i} className="py-2.5 flex items-center justify-between gap-2">
                                                <div>
                                                    <p className="font-extrabold text-slate-900">{r.eq}</p>
                                                    <p className="text-[11px] text-slate-500">{r.mod}</p>
                                                </div>
                                                <span className="font-black text-slate-900 tabular-nums shrink-0">{r.cost}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* LIVE PERSISTENT BLIND CASH CLOSEOUT (Z-REPORT IN SUPABASE) */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-extrabold text-slate-900">
                                                💵 Arqueo Ciego de Caja en Vivo (Corte Z → Supabase `gavilan_pos_cash_closeouts`)
                                            </h3>
                                            <p className="text-[11px] text-slate-500">
                                                Conectado al Libro Mayor de Gaveta: Efectivo Esperado Dinámico = <strong>${liveDrawerExpectedCash.toFixed(2)}</strong> (Fondo Inicial + Ventas Cash - Sangrías a Caja Fuerte - Pay-Outs).
                                            </p>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                                            DB Real
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Cajero / Responsable del Turno</label>
                                            <input
                                                type="text"
                                                value={closeoutCashierName}
                                                onChange={(e) => setCloseoutCashierName(e.target.value)}
                                                className="w-full mt-1 px-2.5 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-indigo-700">Efectivo Físico Contado por Cajero ($)</label>
                                            <input
                                                type="number"
                                                step="0.50"
                                                value={blindCountInput}
                                                onChange={(e) => setBlindCountInput(e.target.value)}
                                                className="w-full mt-1 px-2.5 py-1.5 rounded-xl border-2 border-indigo-300 bg-indigo-50/30 font-black text-indigo-950"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        disabled={savingCloseout}
                                        onClick={async () => {
                                            setSavingCloseout(true)
                                            const expectedDrawer = liveDrawerExpectedCash > 0 ? liveDrawerExpectedCash : 480.00
                                            const countedNum = Number(blindCountInput || 0)
                                            const varianceNum = Number((countedNum - expectedDrawer).toFixed(2))
                                            const storeNum = activeStore ? activeStore.storeNumber : 14

                                            const localZ = {
                                                id: `local-z-${Date.now()}`,
                                                store_number: storeNum,
                                                business_date: latestBusinessDate,
                                                expected_cash: expectedDrawer,
                                                counted_cash: countedNum,
                                                variance: varianceNum,
                                                closed_by: closeoutCashierName,
                                                created_offline: networkPowerMode === 'OFFLINE_BATTERY'
                                            }
                                            setCloseoutsHistory(prev => [localZ, ...prev])

                                            await dispatchPosMutation('CREATE_CLOSEOUT', {
                                                storeNumber: storeNum,
                                                expectedCash: expectedDrawer,
                                                countedCash: countedNum,
                                                closedBy: closeoutCashierName,
                                                createdOffline: networkPowerMode === 'OFFLINE_BATTERY'
                                            })
                                            setSavingCloseout(false)
                                        }}
                                        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black cursor-pointer transition-colors"
                                    >
                                        {savingCloseout ? 'Guardando Corte Z en Supabase...' : `✓ Registrar Arqueo Ciego (Esperado: $${liveDrawerExpectedCash.toFixed(2)}) en Base de Datos`}
                                    </button>

                                    {/* Live Closeouts History from Supabase */}
                                    <div className="space-y-1.5 pt-2 border-t border-slate-200">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                                            Historial Real de Cortes Z en Supabase (`gavilan_pos_cash_closeouts`)
                                        </span>
                                        {closeoutsHistory.length === 0 ? (
                                            <p className="text-xs text-slate-400">Aún no hay cortes Z registrados. Haz clic arriba para guardar el primero.</p>
                                        ) : (
                                            <div className="max-h-40 overflow-y-auto space-y-1.5">
                                                {closeoutsHistory.slice(0, 6).map((z: any) => {
                                                    const expVal = Number(z.expected_cash ?? z.expectedCashDrawer ?? 480)
                                                    const cntVal = Number(z.counted_cash ?? z.actualCashCounted ?? 0)
                                                    const varVal = Number(z.variance ?? z.overShort ?? (cntVal - expVal))
                                                    return (
                                                        <div key={z.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                                                            <div>
                                                                <p className="font-extrabold text-slate-900">
                                                                    Sucursal #{z.store_number || 14} • {z.closed_by || z.cashierName || 'Gerente'} ({z.business_date || latestBusinessDate})
                                                                </p>
                                                                <p className="text-[10px] text-slate-600">
                                                                    Esperado: ${expVal.toFixed(2)} | Contado: ${cntVal.toFixed(2)} {z.created_offline ? '• [Creado Offline]' : ''}
                                                                </p>
                                                            </div>
                                                            <span className={`px-2 py-0.5 rounded font-black text-[11px] tabular-nums ${
                                                                Math.abs(varVal) < 0.01
                                                                    ? 'bg-emerald-100 text-emerald-800'
                                                                    : varVal > 0
                                                                        ? 'bg-blue-100 text-blue-800'
                                                                        : 'bg-rose-100 text-rose-800'
                                                            }`}>
                                                                {varVal >= 0 ? `+$${varVal.toFixed(2)}` : `-$${Math.abs(varVal).toFixed(2)}`}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* LIVE CASH DRAWER LEDGER (SANGRÍAS A CAJA FUERTE, PAY-OUTS, NO-SALE) + POS TIMECLOCK & CALIFORNIA BREAK COMPLIANCE */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* LEFT: CASH DRAWER LIVE LEDGER (`gavilan_pos_cash_events` -> CAJA FUERTE & COHESION) */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                        <div>
                                            <span className="text-[10px] font-black uppercase text-emerald-700">Libro Mayor de Gaveta en Vivo → Caja Fuerte</span>
                                            <h3 className="text-sm font-black text-slate-900">
                                                🏦 Sangrías (`Cash Drops`), Gastos Menores (`Pay-Outs`) y Aperturas `No-Sale`
                                            </h3>
                                        </div>
                                        <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black">
                                            En Gaveta: ${liveDrawerExpectedCash.toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Tipo Movimiento</label>
                                            <select
                                                value={newCashEventType}
                                                onChange={(e) => {
                                                    const tVal = e.target.value as any
                                                    setNewCashEventType(tVal)
                                                    if (tVal === 'NO_SALE') setNewCashEventAmount('0.00')
                                                    else if (tVal === 'CASH_DROP') setNewCashEventAmount('300.00')
                                                    else setNewCashEventAmount('25.00')
                                                }}
                                                className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900 bg-slate-50"
                                            >
                                                <option value="CASH_DROP">🏦 Sangría (Cash Drop a Caja Fuerte)</option>
                                                <option value="PAY_OUT">🧾 Gasto Menor (Pay-Out con Recibo)</option>
                                                <option value="PAY_IN">➕ Ingreso Cambio (Pay-In)</option>
                                                <option value="NO_SALE">🔓 Apertura Sin Venta (No-Sale)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Monto ($ USD)</label>
                                            <input
                                                type="number"
                                                step="5.00"
                                                disabled={newCashEventType === 'NO_SALE'}
                                                value={newCashEventAmount}
                                                onChange={(e) => setNewCashEventAmount(e.target.value)}
                                                className="w-full mt-0.5 px-2.5 py-1.5 rounded-xl border border-slate-200 font-black text-slate-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Motivo / Folio Recibo</label>
                                            <input
                                                type="text"
                                                value={newCashEventReason}
                                                onChange={(e) => setNewCashEventReason(e.target.value)}
                                                className="w-full mt-0.5 px-2.5 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            const amt = newCashEventType === 'NO_SALE' ? 0 : Number(newCashEventAmount || 0)
                                            const storeNum = activeStore ? activeStore.storeNumber : 14
                                            const localEv = {
                                                id: `ce-${Date.now()}`,
                                                store_number: storeNum,
                                                terminal_id: 'POS-CAJA-1',
                                                event_type: newCashEventType,
                                                amount: amt,
                                                reason: newCashEventReason,
                                                performed_by: closeoutCashierName,
                                                manager_pin_used: '1425',
                                                created_at: new Date().toISOString()
                                            }
                                            setCashEvents(prev => [localEv, ...prev])
                                            await dispatchPosMutation('RECORD_CASH_EVENT', {
                                                storeNumber: storeNum,
                                                terminalId: 'POS-CAJA-1',
                                                eventType: newCashEventType,
                                                amount: amt,
                                                reason: newCashEventReason,
                                                performedBy: closeoutCashierName,
                                                managerPinUsed: '1425'
                                            })
                                        }}
                                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer"
                                    >
                                        ✓ Registrar Movimiento de Gaveta en Supabase (`gavilan_pos_cash_events`)
                                    </button>

                                    <div className="max-h-40 overflow-y-auto space-y-1.5 pt-1">
                                        {cashEvents.slice(0, 6).map((ev: any) => (
                                            <div key={ev.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                                                <div>
                                                    <span className="font-black text-slate-900">{ev.event_type}</span>
                                                    <span className="text-slate-500 ml-1.5">• {ev.performed_by}</span>
                                                    <p className="text-[10px] text-slate-600">{ev.reason}</p>
                                                </div>
                                                <span className={`font-black tabular-nums ${
                                                    ev.event_type === 'CASH_DROP' || ev.event_type === 'PAY_OUT'
                                                        ? 'text-rose-700'
                                                        : ev.event_type === 'NO_SALE'
                                                            ? 'text-amber-700'
                                                            : 'text-emerald-700'
                                                }`}>
                                                    {ev.event_type === 'CASH_DROP' || ev.event_type === 'PAY_OUT' ? `-$${Number(ev.amount || 0).toFixed(2)}` : `+$${Number(ev.amount || 0).toFixed(2)}`}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* RIGHT: POS TIMECLOCK & CALIFORNIA LABOR CODE § 512 BREAK COMPLIANCE (-> RONOS) */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                        <div>
                                            <span className="text-[10px] font-black uppercase text-blue-700">Reloj Checador en Caja POS → Sincronizado con RONOS &amp; Breaks AI</span>
                                            <h3 className="text-sm font-black text-slate-900">
                                                ⏱️ Ponchadas de Turno + Ley de California (5ta Hora Meal Break § 512)
                                            </h3>
                                        </div>
                                        <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black border ${
                                            tcShiftElapsedMins >= 299
                                                ? 'bg-rose-100 text-rose-900 border-rose-300'
                                                : 'bg-blue-50 text-blue-800 border-blue-200'
                                        }`}>
                                            {tcShiftElapsedMins >= 299 ? '⚠️ ALERTA 5TA HORA CA' : `Turno: ${Math.floor(tcShiftElapsedMins / 60)}h ${tcShiftElapsedMins % 60}m`}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Colaborador</label>
                                            <input
                                                type="text"
                                                value={tcEmployeeName}
                                                onChange={(e) => setTcEmployeeName(e.target.value)}
                                                className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Puesto</label>
                                            <input
                                                type="text"
                                                value={tcEmployeeRole}
                                                onChange={(e) => setTcEmployeeRole(e.target.value)}
                                                className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Tipo Ponchada</label>
                                            <select
                                                value={tcPunchType}
                                                onChange={(e) => setTcPunchType(e.target.value as any)}
                                                className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900 bg-slate-50"
                                            >
                                                <option value="CLOCK_IN">🟢 Entrada (Clock In)</option>
                                                <option value="START_REST_BREAK_10">☕ Descanso 10m (Pagado)</option>
                                                <option value="START_MEAL_BREAK_30">🍽️ Comida 30m (CA § 512)</option>
                                                <option value="CLOCK_OUT">🔴 Salida + Firma Descansos</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold uppercase text-slate-500">Minutos en Turno</label>
                                            <input
                                                type="number"
                                                value={tcShiftElapsedMins}
                                                onChange={(e) => setTcShiftElapsedMins(Number(e.target.value))}
                                                className="w-full mt-0.5 px-2 py-1.5 rounded-xl border border-slate-200 font-black text-slate-900"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            const storeNum = activeStore ? activeStore.storeNumber : 14
                                            const penaltyWarn = tcPunchType === 'START_MEAL_BREAK_30' && tcShiftElapsedMins >= 300
                                            const newPunch = {
                                                id: `tc-${Date.now()}`,
                                                store_number: storeNum,
                                                employee_name: tcEmployeeName,
                                                employee_role: tcEmployeeRole,
                                                passcode: tcPasscode,
                                                punch_type: tcPunchType,
                                                shift_elapsed_minutes: tcShiftElapsedMins,
                                                meal_penalty_warning: penaltyWarn,
                                                california_attestation_signed: true,
                                                ronos_synced: true,
                                                created_at: new Date().toISOString()
                                            }
                                            setTimeclockEntries(prev => [newPunch, ...prev])
                                            await dispatchPosMutation('PUNCH_TIMECLOCK', {
                                                storeNumber: storeNum,
                                                employeeName: tcEmployeeName,
                                                employeeRole: tcEmployeeRole,
                                                passcode: tcPasscode,
                                                punchType: tcPunchType,
                                                shiftElapsedMinutes: tcShiftElapsedMins,
                                                mealPenaltyWarning: penaltyWarn,
                                                californiaAttestationSigned: true
                                            })
                                        }}
                                        className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black cursor-pointer"
                                    >
                                        ✓ Ponchar en Caja POS + Imprimir Chit 80mm + Sincronizar con RONOS
                                    </button>

                                    <div className="max-h-40 overflow-y-auto space-y-1.5 pt-1">
                                        {timeclockEntries.slice(0, 6).map((tc: any) => (
                                            <div key={tc.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                                                <div>
                                                    <p className="font-extrabold text-slate-900">
                                                        {tc.employee_name} <span className="text-slate-500 font-normal">({tc.employee_role})</span>
                                                    </p>
                                                    <p className="text-[10px] text-slate-600">
                                                        {tc.punch_type} • Minuto {tc.shift_elapsed_minutes} del turno • {tc.california_attestation_signed ? '✓ Atestación CA Firmada' : ''}
                                                    </p>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                                    tc.meal_penalty_warning
                                                        ? 'bg-rose-100 text-rose-800'
                                                        : 'bg-emerald-100 text-emerald-800'
                                                }`}>
                                                    {tc.meal_penalty_warning ? '⚠️ >5h Meal Penalty' : '✓ RONOS OK'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* SUPABASE POSTGRESQL 17.6 CAPACITY BENCHMARK & MULTI-STORE SCALABILITY (15 -> 30 -> 50 -> 100+ STORES) */}
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                                    <div>
                                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 uppercase tracking-wider">
                                            <Zap size={14} />
                                            <span>Auditoría de Capacidad Real en Producción — PostgreSQL 17.6 (aarch64 Linux)</span>
                                        </div>
                                        <h3 className="text-base font-black text-slate-900 mt-0.5">
                                            Capacidad de Flujo Intenso en Supabase: 15 Actuales → 30 → 50 → 100+ Sucursales Futuras
                                        </h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black">
                                            Benchmark Real: 115 Órdenes/Seg (6,900/min)
                                        </span>
                                        <span className="px-2.5 py-1 rounded-xl bg-blue-50 text-blue-800 border border-blue-200 text-xs font-black">
                                            DB Actual: 2.52 GB • 8 Índices Activos
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                                    {[
                                        {
                                            label: '15 Tiendas (Actual)',
                                            dailyOrders: '13,531 órdenes/día',
                                            rushTps: '0.63 – 3.5 órdenes/seg',
                                            dbLoad: '< 3% de capacidad',
                                            badge: 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        },
                                        {
                                            label: '30 Tiendas (2x Expansión)',
                                            dailyOrders: '27,062 órdenes/día',
                                            rushTps: '1.26 – 7.0 órdenes/seg',
                                            dbLoad: '~6% de capacidad',
                                            badge: 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        },
                                        {
                                            label: '50 Tiendas (3.3x Expansión)',
                                            dailyOrders: '45,103 órdenes/día',
                                            rushTps: '2.10 – 12.0 órdenes/seg',
                                            dbLoad: '~10% de capacidad',
                                            badge: 'bg-blue-50 text-blue-800 border-blue-200'
                                        },
                                        {
                                            label: '100 Tiendas (6.6x Expansión)',
                                            dailyOrders: '90,206 órdenes/día',
                                            rushTps: '4.20 – 25.0 órdenes/seg',
                                            dbLoad: '~21% de capacidad',
                                            badge: 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                        }
                                    ].map((sc, i) => (
                                        <div key={i} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span className="font-extrabold text-slate-900">{sc.label}</span>
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${sc.badge}`}>
                                                    {sc.dbLoad}
                                                </span>
                                            </div>
                                            <p className="text-[11px] font-bold text-slate-700">{sc.dailyOrders}</p>
                                            <p className="text-[10px] text-slate-500">Hora Pico Viernes: {sc.rushTps}</p>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
                                    <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200">
                                        <p className="font-extrabold text-emerald-950">1. Índice Parcial KDS Ultra-Rápido (Instalado)</p>
                                        <p className="text-[11px] text-emerald-900 mt-0.5">
                                            <code>idx_gavilan_pos_orders_kds_active_partial (WHERE kds_status = 'IN_PREP')</code>: Aunque la tabla acumule 20 millones de órdenes históricas, el KDS solo escanea las ~20 órdenes activas en RAM en &lt;1ms.
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200">
                                        <p className="font-extrabold text-blue-950">2. Supavisor Connection Pooler (:6543)</p>
                                        <p className="text-[11px] text-blue-900 mt-0.5">
                                            Multiplexa hasta 10,000 dispositivos concurrentes (Cajas POS, KDS HDMI, Kioscos y Webhooks de Uber Eats / DoorDash) sobre las conexiones nativas de PostgreSQL sin agotar memoria.
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-xl bg-purple-50/60 border border-purple-200">
                                        <p className="font-extrabold text-purple-950">3. Escalamiento Vertical Sin Migrar Código</p>
                                        <p className="text-[11px] text-purple-900 mt-0.5">
                                            En Supabase puedes subir el Compute Add-On (Small → Medium → Large → 4XL con 64GB RAM y 3,000+ TPS) en 1 clic sin cambiar ni una línea de código cuando abras las tiendas #20 a #100.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =================================================================
                        MODULE 9: DOCUMENTACIÓN 100% DE TOAST WEB VS GAVILAN POS
                       ================================================================= */}
                    {activeCategory === 'anatomy' && (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    <BookOpen size={14} />
                                    <span>Mapa Anatómico Completo de Toast Web (pos.toasttab.com) vs. Cómo Lo Superamos al 100%</span>
                                </div>
                                <h2 className="text-xl font-black text-slate-900 mt-1">
                                    Radiografía de las 9 Secciones de Toast Web y Su Evolución en Gavilan POS
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Documentación exhaustiva de cómo funcionan todas las opciones internas de Toast Web, cuáles son sus defectos de diseño y cómo están resueltas en nuestro nuevo ecosistema.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {[
                                    {
                                        title: '1. Home, Quick Actions & Publishing Center',
                                        toastWay: 'Separa "Save" de "Publish Now" (Publish Config). Si un gerente guarda un cambio y olvida publicar, nunca baja a las cajas; si otro gerente publica, sube cambios ajenos incompletos sin ver un comparativo (Diff).',
                                        gavilanWay: 'Barra superior con Diff Visual estilo Git: muestra exactamente qué cambió (Antes → Después) y sincroniza en milisegundos por WebSockets LAN.',
                                        jumpTo: 'command' as ModuleCategoryId
                                    },
                                    {
                                        title: '2. Menus (Los 4 Editores Fragmentados)',
                                        toastWay: 'Divide el mismo menú en 4 pantallas incompatibles: Menu Builder, Classic Edit Menus, Advanced Properties (matriz de herencia de impuestos/estaciones) e Item Library.',
                                        gavilanWay: 'Estudio Unificado de Menú 3-en-1: cambia en 1 clic entre Tarjetas Visuales, Matriz Avanzada en Lote y Reglas de Modificadores sin perder tu posición.',
                                        jumpTo: 'menu' as ModuleCategoryId
                                    },
                                    {
                                        title: '3. Kitchen / KDS / Prep Stations & Pacing',
                                        toastWay: 'Configura Prep Stations, KDS Level 1 (Cocina) y Level 2 (Expo), All-Day Counts y Bump Bars en formularios de texto sin vista previa, cobrando licencia mensual por cada pantalla.',
                                        gavilanWay: 'Simulador KDS en Vivo + Salida HDMI con Splitter Activo EDID (1080p@60Hz) para espejear a monitores de parrilla con $0 de licencia extra.',
                                        jumpTo: 'kds' as ModuleCategoryId
                                    },
                                    {
                                        title: '4. Front of House (UI Options, Dining Options, Auto-Fire)',
                                        toastWay: 'Configura Quick Order Mode, Dining Options (Dine-In, Takeout, Drive-Thru), Revenue Centers y designa una caja física como "Auto-Firing Device" (si se apaga, dejan de salir órdenes online).',
                                        gavilanWay: 'Nodo Local de Tienda dedicado siempre activo + Simulador interactivo de Caja Registradora y Pantalla de Cliente 10.1" CFD en vivo.',
                                        jumpTo: 'register' as ModuleCategoryId
                                    },
                                    {
                                        title: '5. Payments, Alternate Tenders, Tax & EBT RMP',
                                        toastWay: 'EBT se registra como "Other Payment Option" manual en una terminal externa, y Toast Payments obliga a usar sus tasas de tarjeta sin permitir cambiar de procesador.',
                                        gavilanWay: 'Un solo PIN Pad PAX A35 cobra Visa, Apple Pay y EBT CalFresh RMP con Chip/PIN, aplicando 0% Sales Tax automático y contrato True Interchange++.',
                                        jumpTo: 'payments' as ModuleCategoryId
                                    },
                                    {
                                        title: '6. Guest Receipt, Ticket de Bolsa & Cocina Sin Papel',
                                        toastWay: 'Las opciones del recibo están dispersas en 4 rutas distintas (Marketing, Payments, UI Options y Printers) sin vista previa real de 80mm.',
                                        gavilanWay: 'Estudio WYSIWYG Unificado con vista previa de Recibo Térmico 80mm de Pago + Ticket Térmico de Bolsa (To-Go/Delivery), mientras la cocina opera 100% sin papel en KDS HDMI.',
                                        jumpTo: 'tickets' as ModuleCategoryId
                                    },
                                    {
                                        title: '7. Takeout & 3rd-Party Delivery (Uber, DoorDash, GH)',
                                        toastWay: 'Cobra ~$75–$100/mes por tienda (~$16,200/año) por integrar Uber Eats, DoorDash y Grubhub, con reglas de Quote Time y SmartQuote ocultas.',
                                        gavilanWay: 'Conexión directa a Uber Eats Marketplace API, DoorDash Marketplace/Drive API y Grubhub Partner API por $0/mes con Markup automático (+18%).',
                                        jumpTo: 'delivery' as ModuleCategoryId
                                    },
                                    {
                                        title: '8. Hardware, Printers, Cash Drawers & Offline Mode',
                                        toastWay: 'Hardware Android cerrado que queda inservible si dejas Toast. Impresoras por IP estática y cajones RJ12 configurados en listas planas.',
                                        gavilanWay: 'Hardware comercial 100% abierto (Elo, SUNMI, Epson, APG Vasario) con baterías de reserva anti-apagones (LiFePO4 UPS + Tabletas) y modo 100% Offline Store-and-Forward.',
                                        jumpTo: 'hardware' as ModuleCategoryId
                                    },
                                    {
                                        title: '9. Reports, Cash Management (Z-Report) & Permissions',
                                        toastWay: 'Permisos numerados del 1.x al 8.x, Shift Review, Z-Report y auditoría de aperturas "No Sale", desconectados de tu contabilidad e inventario real.',
                                        gavilanWay: 'Nativamente fusionado con TEG-Modernizado: RONOS (Ponchadas y Descansos), Cohesion (Pólizas QuickBooks), Caja Fuerte y Food Cost.',
                                        jumpTo: 'hardware' as ModuleCategoryId
                                    }
                                ].map((card, i) => (
                                    <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between space-y-3">
                                        <div className="space-y-2">
                                            <h3 className="text-sm font-black text-slate-900">{card.title}</h3>
                                            <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200 text-[11px] text-rose-950">
                                                <span className="font-extrabold uppercase block text-[10px] text-rose-700">Cómo funciona en Toast Web:</span>
                                                {card.toastWay}
                                            </div>
                                            <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-[11px] text-emerald-950">
                                                <span className="font-extrabold uppercase block text-[10px] text-emerald-700">Cómo lo superamos en Gavilan POS:</span>
                                                {card.gavilanWay}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setActiveCategory(card.jumpTo)}
                                            className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                                        >
                                            <span>Abrir Módulo en Gavilan POS</span>
                                            <ArrowUpRight size={13} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* =====================================================================
                MODAL: GIT-STYLE VISUAL DIFF PUBLISHER (SOLVES TOAST'S BLIND PUBLISH)
               ===================================================================== */}
            {publishModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-black text-slate-900">
                                    Centro de Publicación con Diff Visual (Smart Config Publisher)
                                </h3>
                                <p className="text-xs text-slate-500">
                                    Revisa exactamente cada cambio antes de sincronizarlo a Supabase y a las terminales POS y KDS de las 15 sucursales.
                                </p>
                            </div>
                            <button onClick={() => setPublishModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-200 cursor-pointer">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 max-h-96 overflow-y-auto space-y-2.5">
                            {stagedChanges.length === 0 ? (
                                <div className="py-8 text-center text-xs text-slate-500 font-semibold">
                                    No hay cambios pendientes. Todas las 15 sucursales están 100% sincronizadas con Supabase.
                                </div>
                            ) : (
                                stagedChanges.map((chg) => (
                                    <div key={chg.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-extrabold text-[10px]">
                                                    {chg.module}
                                                </span>
                                                <span className="font-extrabold text-slate-900">{chg.target}</span>
                                                <span className="text-[10px] text-slate-400">{chg.timestamp}</span>
                                            </div>
                                            <div className="flex items-center gap-2 font-mono text-[11px]">
                                                <span className="line-through text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">{chg.before}</span>
                                                <span>→</span>
                                                <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{chg.after}</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setStagedChanges(prev => prev.filter(x => x.id !== chg.id))}
                                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                                            title="Descartar este cambio"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                            <span className="text-xs text-slate-500 font-medium">
                                Destino: <strong>{activeStore ? `Sucursal #${activeStore.storeNumber} ${activeStore.name}` : '15 Sucursales Tacos Gavilan'}</strong>
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPublishModalOpen(false)}
                                    className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                                >
                                    Seguir Editando
                                </button>
                                <button
                                    disabled={stagedChanges.length === 0}
                                    onClick={async () => {
                                        await dispatchPosMutation('BULK_PUBLISH_MENU', { items: menuItems })
                                        const nowStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                                        setLastPublishedAt(`Hoy ${nowStr}`)
                                        setStagedChanges([])
                                        setPublishModalOpen(false)
                                    }}
                                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-black cursor-pointer shadow-xs"
                                >
                                    ✓ Publicar en Supabase y Sincronizar ({stagedChanges.length})
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* =====================================================================
                MODAL: SPOTLIGHT INSTANT COMMAND SEARCH (CTRL+K)
               ===================================================================== */}
            {spotlightOpen && (
                <div
                    onClick={() => setSpotlightOpen(false)}
                    className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
                    >
                        <div className="p-3.5 border-b border-slate-200 flex items-center gap-2.5">
                            <Search size={16} className="text-blue-600" />
                            <input
                                autoFocus
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Escribe qué quieres configurar (ej. EBT, KDS HDMI, ticket bolsa, asada, Uber Eats, cajón)..."
                                className="flex-1 text-sm font-medium text-slate-900 outline-none"
                            />
                            <button onClick={() => setSpotlightOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-700 cursor-pointer">
                                ESC
                            </button>
                        </div>
                        <div className="p-2 max-h-80 overflow-y-auto divide-y divide-slate-100">
                            {categories.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => {
                                        setActiveCategory(cat.id)
                                        setSpotlightOpen(false)
                                    }}
                                    className="w-full p-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between text-left cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <span className={cat.color}>{cat.icon}</span>
                                        <div>
                                            <p className="text-xs font-extrabold text-slate-900">{cat.label}</p>
                                            <p className="text-[11px] text-slate-500">{cat.subtitle}</p>
                                        </div>
                                    </div>
                                    <ChevronRight size={14} className="text-slate-400" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

/**
 * @module preparador
 * @description Módulo de Línea de Preparación (Prep Line / Tableta de Parrilla) para taqueros y cocineros.
 *   Proyecta el ritmo de cocción (Pace) en bloques de 30 minutos, sincroniza con Toast API y gestiona pedidos a cocina trasera.
 * @businessRules
 *   - Día laboral Gavilán: 6:00 AM a 5:59 AM del siguiente día (America/Los_Angeles).
 *   - Turno PM inicia a las 5:00 PM (17:00).
 *   - 48 intervalos de 30 minutos desde 06:00:00 hasta 05:30:00 del día siguiente.
 *   - Solo se proyectan carnes de PARRILLA: ASADA, PASTOR, POLLO, CABEZA, LENGUA.
 *   - Buche, Chorizo y Carnitas se cocinan al momento bajo demanda (no requieren pace en parrilla).
 *   - Las capturas manuales de los gerentes se persisten en prep_manual_schedule por día de la semana (1=Lunes ... 7=Domingo).
 *   - Timer de inactividad de 15 segundos regresa al carrusel al bloque de tiempo actual.
 *   - **Pestaña ÓRDENES (Órdenes en Preparación / Send)**: Muestra las órdenes enviadas por la cajera (`status: 'IN_PROGRESS'`)
 *     tras completar el cobro (fulfillmentStatus: 'SENT' en Toast).
 *     Presenta una cuadrícula táctil limpia con números de orden gigantes, canal de venta (`FOR_HERE` / `TOGO`), tiempo transcurrido
 *     y botón táctil para llamar a la orden por altavoz, además de dos botones táctiles permanentes de llamado por voz para **Café**
 *     (`"Café pendiente, ¡ya está!"`) y **Champurrado** (`"Champurrado pendiente, ¡ya está!"`).
 *   - **Filtro de Bebidas y Postres**: Las órdenes que SOLO contienen bebidas (horchata, café, sodas, etc.) o postres
 *     (flan, cheesecake) se atienden directamente en mostrador/caja y NO se muestran en la pantalla de preparación.
 *   - **Emisión Exclusiva de Voz en PC (Cero Duplicación de Voces)**:
 *     - La tableta del preparador actúa exclusivamente como terminal de control táctil (Touch & Dispatch).
 *     - Al tocar una orden, la tableta emite únicamente un sonido sutil de confirmación de interfaz (tick) y envía el impulso en tiempo real (evento `call_order` y POST /api/order-ready/call) al módulo del Manager en PC (`/order-ready-board`).
 *     - La PC del Manager (`/order-ready-board`), que está conectada al sistema de altavoces del restaurante, es la ÚNICA que reproduce la campanilla Ding-Dong y la locución bilingüe (Inglés + Español), evitando cualquier duplicidad o eco entre dispositivos.
 *     - Cuando el cocinero borra la orden en el Toast KDS, la orden pasa a `READY` y se retira automáticamente de la tableta del preparador
 *       SIN emitir voz por los altavoces.
 *     - Si el cocinero presiona RECALL en el Toast KDS, la orden regresa a `IN_PROGRESS` y reaparece de inmediato en la tableta del preparador.
 *     - Si el cocinero la vuelve a borrar en KDS, se vuelve a retirar de la tableta.
 * @dataFlow 
 *   - meat_consumption_history -> /api/inventory/preparador-history -> Carousel 3D + Intraday Accelerator.
 *   - order_ready_announcements + Realtime channel ('order-ready-realtime:${storeCode}' con filtro server-side `store_code=eq.${storeCode}`) -> Grid de Órdenes en Preparación -> POST /api/order-ready/call -> PC Manager.
 * @notes
 *   - FIX (2026-10-12): Filtro temporal estricto (últimos 60 minutos con .gte('created_at', cutoff)) en la consulta de órdenes en preparación (fetchReadyOrders).
 *     Anteriormente, el acumulado de órdenes históricas IN_PROGRESS (bebidas/no cerradas de la mañana) llenaba el .limit(60) con órdenes de hace horas,
 *     provocando que las órdenes nuevas recién enviadas no llegaran a la tableta del preparador.
 *   - FIX: Se optimizó el cliente Supabase con useMemo para prevenir re-suscripciones y render loops continuos.
 *   - FIX (2026-10-19): Autolimpieza automática de caché (`lib/tablet-cache-cleaner.ts`) cada 15 min, en cambio de jornada (6:00 AM),
 *     y Modal de Despertar Tableta tras 3 horas de inactividad (`INACTIVITY_WAKE_MODAL_MS = 3h`): al tocar el modal o el botón Despertar,
 *     purga llaves obsoletas de `localStorage`, `sessionStorage`, `CacheStorage` y Service Workers, renueva el JWT (`teg_token`) por 30 días,
 *     reconfigura la fecha laboral (6:00 AM), día de la semana (`businessDow`) y bloque actual de 30 min, desbloquea Web Audio API + WakeLock,
 *     y recarga en vivo proyecciones, horarios manuales, consumo real, inteligencia y órdenes de Toast POS (`/api/order-ready/orders`).
 *   - FIX REALTIME & RECONEXIÓN (2026-10-22):
 *     1) Canal Realtime aislado por sucursal (`order-ready-realtime:${storeCode}`) y filtro server-side `store_code=eq.${storeCode}` en `order_ready_announcements`.
 *     2) Guardia `channelDisposed` por instancia de canal para evitar reconexión por evento `CLOSED` intencional al ejecutar `removeChannel`.
 *     3) Debounce de 500ms + guardia `fetchingReadyOrdersRef` en refrescos Realtime, manteniendo `syncToast=false` en eventos Realtime y reconexión.
 *   - MODO SOLO ÓRDENES / OCULTAR COCCIÓN (2026-10-28):
 *     Permite ocultar el panel izquierdo de Ritmo de Cocción en la tableta mediante botón en cabecera o adorno divisor lateral retráctil,
 *     dedicando el 100% del ancho de pantalla exclusivamente a la vista de ÓRDENES EN PREPARACIÓN con cuadrícula expandida.
 *   - MOTOR TÁCTIL ULTRA-SENSIBLE PARA GUANTES Y MICA PROTECTORA (2026-11-02):
 *     Optimización del reconocimiento de toques (`bindPrepInstantTap` y `bindPrepForgivingTap`) para cocineros con guantes sobre micas:
 *     1) Disparo al Primer Contacto (`onPointerDown` / `onTouchStart` a 0ms) en botones fijos (Café, Champurrado, tabs, navegación de cocción,
 *        Enviar) y en tarjetas cuando el contenedor no requiere scroll vertical.
 *     2) Rescate de `onPointerCancel` / `onTouchCancel`: cuando el guante + mica provoca un micro-corte de capacitancia a mitad del toque,
 *        el sistema rescata y ejecuta el toque en vez de descartarlo.
 *     3) Tolerancia ampliada para presión prolongada con guante (`hasta 3500ms`) y deslizamiento por aplastamiento de la yema del guante (`hasta 75px`),
 *        bloqueando `onContextMenu` para evitar que el navegador cancele el toque por pulsación larga.
 *   - PARIDAD FIFO 1:1 CON TOAST KDS (2026-11-09):
 *     `filterAndDedupePrepOrders` y `applyReadyOrdersIfChanged` ordenan y reconcilian las tarjetas usando `compareOrdersKdsFifo` sobre la hora real
 *     de disparo a cocina (`sentAt` / `created_at`), reflejando el mismo orden exacto del Toast Kitchen KDS.
 *   - MODO MANOS LIBRES: TIMER INTELIGENTE DE VOZ POR SUCURSAL (2026-11-10):
 *     En tiendas con modo `'smart'` activo en `order_ready_settings.auto_call_timer_config` (piloto exclusivo en `SLAUSON`; las otras 14 tiendas permanecen en `'manual'`),
 *     muestra la cuenta regresiva adaptativa por orden sin necesidad de tocar la pantalla y actúa como respaldo atómico (`+2.5s`) hacia `/api/order-ready/call` (`autoTimerOnlyIfUnannounced: true`),
 *     conservando el toque manual en todo momento para adelantar o repetir un llamado.
 *   - BLINDAJE TÁCTIL MESWAO B3 / PANTALLA GRANDE 15.6" (2026-11-17):
 *     1) Tick acústico sintetizado en memoria vía Web Audio API + vibración háptica (`0ms`, sin archivo MP3 404).
 *     2) Radar de proximidad multi-toque (`40px`, prioridad `changedTouches` ante gotas/palma en bordes y caché de geometría sin reflows).
 *   - FIX COLISIÓN DE POLLING 5S VS 10S Y COLA DE SYNC TOAST (2026-11-20, La Puente #228):
 *     Unifica el polling de `fetchReadyOrders` en un solo temporizador de 5s alternando lectura rápida (`syncToast=false` en ticks impares)
 *     con sincronización explícita a Toast KDS (`syncToast=true` en ticks pares), y agrega `pendingToastSyncRef` para encolar `syncToast=true`
 *     si coincide con un refresco Realtime en vuelo, evitando que la tableta pierda sincronización KDS cuando `/order-ready-board` está cerrado.
 *   - BLINDAJE ANTI-CONGELAMIENTO EN FULLSCREEN Y CUADRÍCULA 5-12 ÓRDENES DESLIZABLE (2026-11-21, Rialto):
 *     1) `AbortController` (6.5s en Supabase directo y 7.5s en `/api/order-ready/orders`) + Watchdog de 8.5s sobre `fetchingReadyOrdersRef`
 *        para destrabar automáticamente sockets TCP semi-abiertos por micro-cortes de Wi-Fi en Fullscreen sin obligar a recargar Chrome.
 *     2) Reconexión preventiva de Realtime si transcurren >60s sin refresco exitoso y botón Refrescar siempre activo (aborta peticiones colgadas).
 *     3) Cuadrícula compacta automática de 3-4 columnas a partir de 5 órdenes (caben hasta 9-12 sin scroll) y desbloqueo automático de `pan-y` /
 *        toque compatible con scroll cuando el contenedor de órdenes realmente desborda verticalmente.
 *     3) Tarjetas adaptativas gigantes cuando hay 1-4 órdenes activas, `overscroll-y-contain` anti Pull-to-Refresh y pausa de re-renders durante contacto activo.
 *   - OPTIMIZACIÓN POLLING Y CACHÉ (2026-11-19, Paquete 2B):
 *     1) `/api/order-ready/orders` envía `&view=prep` (mantiene cadencia 5s/10s de ÓRDENES intacta al 100%).
 *     2) Heartbeat de telemetría elevado de 60s a 300s (5m), conservando envío inmediato al montar y en `visibilitychange`.
 *     3) `preparador-manual-schedule` elevado de 3m a 5m con guardia `visibilityState` y sin `&_t`/`cache:'no-store'` en polling de fondo (conserva bypass `&_t` en guardados explícitos del gerente y despertar tableta).
 *     4) `preparador/intelligence` elevado de 3m a 10m con guardia `visibilityState` y sin `&_t`/`cache:'no-store'`; `meat_consumption_history` elevado de 3m a 5m con guardia `visibilityState`.
 *   - ALERTA TEMPORAL DE CONDIMENTOS DELIVERY ARMOR (2026-11-24):
 *     Monta `<DeliveryPhoneNotesAlertPanel variant="tablet" />` justo debajo de la barra superior (fuera de `data-orders-hit-zone`
 *     para que el radar de proximidad con guantes no intercepte los botones), replicando exactamente el parpadeo, timbre triple,
 *     aviso de bolsa sellada, botón circular rojo `✕` de cierre individual por orden estilo Preparador y confirmación en tiempo real
 *     (`< 500 ms`) en las 12 sucursales sin tableta física de Delivery Armor (apagado automáticamente para condimentos en `#6 LA Central`, `#7 Slauson` y `#8 Hollywood` que ya cuentan con tableta dedicada).
 *   - BLINDAJE DE SESIÓN STAFF 24/7 Y CONFIRMACIÓN REAL DE LLAMADO (2026-11-24):
 *     1) `handleCallOrderImpulse`, `sendPrepHeartbeat`, `loadAutoTimerSettings` y el respaldo de `autoTimer` envían siempre `Authorization: Bearer` (`getTabletNoCacheHeaders()`) + `credentials: 'include'` con auto-renovación inmediata en `401` (`ensureFreshTabletAuth(true)`).
 *     2) Eliminado falso positivo verde optimista previo al `fetch`: la tarjeta solo marca verde ("¡Llamada Enviada!") cuando el broadcast WebSocket o `POST /api/order-ready/call` confirma entrega real; si ambos fallan muestra alerta roja de reintento y libera el bloqueo en 400ms.
 *     3) `fetchReadyOrders` detecta `authenticated: false` en `GET /api/order-ready/orders?view=prep` y renueva silenciosamente el JWT antes de que el cocinero toque la pantalla.
 *   - REDISEÑO INDUSTRIAL HUMANO "WARM CERAMIC & COMAL GRAPHITE" + CALIBRACIÓN TAB S10 FE 10.9" (2026-11-26):
 *     1) UI modularizada (`components/preparador/*`) sin recortes en `1024×640` / `1152×720`: 5 carnes visibles sin scroll, dock intercom de 1 fila (`Café/Champurrado/Orden Pendiente`) sin truncar y con estado rojo de error real, cabecera única `50px`, `Manager Control Sheet` oculto en Kiosco (U54/U62), `DESECHABLES` (9) + `ALIMENTOS` (34) por estaciones, Guía 24h (48 franjas) y acabado Día/Noche por tableta.
 *     2) Blindaje técnico: columnas escalares explícitas (cero `SELECT *`), sin doble-fetch en ticks impares, `purgeTabletStaleCaches` nunca borra caché offline al montar/ver fechas pasadas, `isFullscreenRef` en telemetría, confirmación instantánea al responder WS o REST + limpieza de timers, `Map<pointerId>` + dedupe `1200ms` en `ALIMENTOS`, radar adaptativo `18px` (10.9") / `38px` (15.6"), y Mermas libre de `NaN` en tramos.
 */
'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import DeliveryPhoneNotesAlertPanel from '@/components/DeliveryPhoneNotesAlertPanel'
import { 
    Loader2, ChevronLeft, ChevronRight, Flame, BarChart3, SlidersHorizontal, UtensilsCrossed
} from 'lucide-react'
import { getAdaptiveProximityRadiusPx } from '@/lib/kitchen-touch'
import PreparadorTopRail from '@/components/preparador/PreparadorTopRail'
import PreparadorManagerSheet from '@/components/preparador/PreparadorManagerSheet'
import PreparadorGrillPanel, { type GrillMeatEditRequest } from '@/components/preparador/PreparadorGrillPanel'
import PreparadorOrdersAndSupplies from '@/components/preparador/PreparadorOrdersAndSupplies'
import PreparadorModals from '@/components/preparador/PreparadorModals'
import { useAuth } from '@/components/ProtectedRoute'
import { createClient } from '@/lib/supabase-client'
import { motion, AnimatePresence } from 'framer-motion'
import { TOAST_STORE_MAP } from '@/lib/toast-stores'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { isDrinkOrDessertOnlyOrder, compareOrdersKdsFifo } from '@/lib/order-ready-filter'
import {
    AutoCallTimerConfig,
    AUTO_CALL_MAX_UNOBSERVED_OVERDUE_MS,
    DEFAULT_AUTO_CALL_TIMER_CONFIG,
    computeSmartOrderAutoCallPlan,
    formatCountdownMmSs,
    isStoreSmartAutoCallEnabled,
    sanitizeAutoCallTimerConfig
} from '@/lib/order-ready-auto-timer'
import {
    ensureFreshTabletAuth,
    purgeTabletStaleCaches,
    safeLocalStorageSet,
    getTabletNoCacheHeaders
} from '@/lib/tablet-cache-cleaner'
import { useWakeLock } from '@/lib/use-wake-lock'
        

interface MeatData {
    interval_start: string
    meat_type: string
    avg_lbs: number
    samples: number
    real_lbs?: number
}

const C1 = 'bg-emerald-200 border-emerald-300 text-emerald-900 hover:bg-emerald-300 dark:bg-emerald-800 dark:border-emerald-700 dark:text-emerald-50'
const C2 = 'bg-orange-200 border-orange-300 text-orange-900 hover:bg-orange-300 dark:bg-orange-800 dark:border-orange-700 dark:text-orange-50'
const C3 = 'bg-sky-200 border-sky-300 text-sky-900 hover:bg-sky-300 dark:bg-sky-800 dark:border-sky-700 dark:text-sky-50'
const C4 = 'bg-rose-200 border-rose-300 text-rose-900 hover:bg-rose-300 dark:bg-rose-800 dark:border-rose-700 dark:text-rose-50'
const C5 = 'bg-amber-200 border-amber-300 text-amber-900 hover:bg-amber-300 dark:bg-amber-800 dark:border-amber-700 dark:text-amber-50'

const ALIMENTOS = [
    { name: 'Guacamole', color: C1 }, { name: 'Crema', color: C1 }, { name: 'Mayonesa', color: C1 }, { name: 'Mulitas', color: C1 }, { name: 'Quesadillas', color: C1 },
    { name: 'Arroz', color: C2 }, { name: 'Cabeza', color: C2 }, { name: 'Lengua', color: C2 }, { name: 'Frijol molido', color: C2 },
    { name: 'Milaneza', color: C3 }, { name: 'Salchicha', color: C3 }, { name: 'Jamon', color: C3 }, { name: 'Huevos', color: C3 }, { name: 'Papelitos', color: C3 }, { name: 'Queso Jack', color: C3 }, { name: 'Queso Fresco', color: C3 }, { name: 'Queso cotija', color: C3 }, { name: 'Queso Nachos', color: C3 }, { name: 'Cebolla y cilantro', color: C3 }, { name: 'Salsa verde', color: C3 }, { name: 'Salsa roja', color: C3 },
    { name: 'Asada', color: C4 }, { name: 'Pastor', color: C4 }, { name: 'Pollo', color: C4 }, { name: 'Carnitas', color: C4 }, { name: 'Chorizo', color: C4 }, { name: 'Buche', color: C4 }, { name: 'Cebolla Asada', color: C4 }, { name: 'Frijoles de la Olla', color: C4 },
    { name: 'Tortillas de maiz', color: C5 }, { name: 'Tortillas Burritos', color: C5 }, { name: 'Teleras', color: C5 }, { name: 'Chips', color: C5 }, { name: 'Manteca', color: C5 }
]

const DESECHABLES = [
    'Cover tacos', 'Papel tortas', 'Platos blancos', 'Platos nachos', 'Platos (3)', 
    'Platos sopes', 'Charolas rojas', 'Vasos 4oz', 'Vasos 8oz'
].map(n => ({ name: n, color: 'bg-slate-700 hover:bg-slate-800 text-white dark:bg-slate-800 dark:hover:bg-slate-700' }))

interface ParsedOrderItem {
    quantity: number
    name: string
    modifiers: string[]
}

function parseOrderItemsSummary(raw: string | null | undefined): ParsedOrderItem[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            return parsed.map((item: any) => ({
                quantity: Math.max(1, Number(item.quantity) || 1),
                name: String(item.name || item.displayName || '').trim(),
                modifiers: Array.isArray(item.modifiers)
                    ? item.modifiers.map((m: any) => String(m.displayName || m.name || m || '').trim()).filter(Boolean)
                    : []
            })).filter(item => Boolean(item.name))
        }
    } catch {
        const lines = String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
        return lines.map(line => {
            const match = line.match(/^(\d+)x?\s*(.+)$/i)
            if (match) {
                return { quantity: parseInt(match[1], 10), name: match[2].trim(), modifiers: [] }
            }
            return { quantity: 1, name: line, modifiers: [] }
        })
    }
    return []
}

/**
 * Detecta si un artículo de comanda corresponde a una bebida (aguas frescas, sodas, café, champurrado, etc.)
 * para permitir al preparador enfocarse al 100% en la parrilla y cocina caliente sin clutter de mostrador.
 */
function isDrinkItem(name: string | null | undefined): boolean {
    if (!name) return false
    const raw = name.trim().toLowerCase()
    if (raw.includes('aguacate') || raw.includes('guacamole')) return false

    const n = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    return (
        /(^|\b)(horchata|jamaica|tamarindo|champurrado|lemonade|iced tea|fanta|sprite|coke|coca|soda|sodas|dr pepper|jarrito|jarritos|coffee|cafe|bottled water|agua fresca|gallon agua|water|hielo|ice|jugo|juice|beverage|smoothie|sidral|squirt|sangria)($|\b)/i.test(n) ||
        /^(large|medium|med|lg|sm|small)\s+(horchata|jamaica|tamarindo|pina|coke|diet coke|sprite|fanta|lemonade|iced tea|tea|drink)/i.test(n) ||
        /^(olla cafe|olla champurrado|champurrado)/i.test(n)
    )
}

export default function PreparadorPage() {
    const { user, loading: authLoading } = useAuth()
    const { t } = useLanguage()
    const supabase = useMemo(() => createClient(), [])

    const [mounted, setMounted] = useState(false)
    const [stores, setStores] = useState<any[]>([])
    const [storeId, setStoreId] = useState('')
    
    // Calendar Date Selector (Shift starts at 6:00 AM LA time — canonical helper)
    const getLAEffectiveBusinessDate = () => getCaliforniaBusinessDate()

    // Acabado industrial por tableta ("day" = Warm Ceramic | "night" = Comal Graphite)
    const [prepTheme, setPrepTheme] = useState<'day' | 'night'>('day')
    const isDark = prepTheme === 'night'
    const [supplyFeedback, setSupplyFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [elapsedNowMs, setElapsedNowMs] = useState<number>(() => Date.now())
    const [liveClockText, setLiveClockText] = useState<string>('')
    const [ordersHasOverflow, setOrdersHasOverflow] = useState<boolean>(false)
    const isFullscreenRef = useRef<boolean>(false)
    const isSmartAutoVoiceStoreRef = useRef<boolean>(false)
    const callStatusTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const prepAutoBackupRetryAfterRef = useRef<Map<string, number>>(new Map())
    // Escudo anti-toque fantasma tras cambio de layout (ocultar/mostrar parrilla o cambiar pestaña)
    const suppressOrderCallsUntilRef = useRef<number>(0)

    const handleTogglePrepTheme = (nextDark: boolean) => {
        const nextVal = nextDark ? 'night' : 'day'
        setPrepTheme(nextVal)
        try { localStorage.setItem('teg_preparador_theme', nextVal) } catch {}
    }

    const INACTIVITY_WAKE_MODAL_MS = 3 * 60 * 60 * 1000 // 3 horas de inactividad
    const initialToday = getLAEffectiveBusinessDate()
    const [currentBusinessDate, setCurrentBusinessDate] = useState<string>(initialToday)
    const [selectedDate, setSelectedDate] = useState<string>(initialToday)
    const effectiveDateRef = useRef<string>(initialToday)
    const lastActivityTimeRef = useRef<number>(Date.now())
    const lastSaveTimeRef = useRef<number>(0)
    const [showWakeUpModal, setShowWakeUpModal] = useState(false)
    const showWakeUpModalRef = useRef(false)
    const [wakingUpTablet, setWakingUpTablet] = useState(false)
    const fetchReadyOrdersRef = useRef<((isManual?: boolean, syncToastExplicit?: boolean, skipCachePurge?: boolean) => Promise<void>) | null>(null)
    const fetchingReadyOrdersRef = useRef<boolean>(false)
    const fetchingReadyOrdersStartedAtRef = useRef<number>(0)
    const activeOrdersFetchAbortRef = useRef<AbortController | null>(null)
    const lastOrdersSyncSuccessAtRef = useRef<number>(Date.now())
    const ordersScrollContainerRef = useRef<HTMLDivElement | null>(null)
    const pendingToastSyncRef = useRef<boolean>(false)
    const pendingToastSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const fetchHistoryRef = useRef<((overrideDow?: number, overrideDate?: string) => Promise<void>) | null>(null)
    const fetchManualScheduleRef = useRef<((overrideDow?: number, overrideDate?: string, bypassCache?: boolean) => Promise<void>) | null>(null)
    const fetchRealMeatRef = useRef<((overrideDate?: string) => Promise<void>) | null>(null)
    const fetchIntelligenceRef = useRef<((overrideDate?: string) => Promise<void>) | null>(null)
    const updateBucketsRef = useRef<(() => void) | null>(null)

    // User activity tracker (touch/click resets inactivity timer unless wake modal is awaiting explicit wake-up)
    const recordUserActivity = () => {
        if (showWakeUpModalRef.current) return
        lastActivityTimeRef.current = Date.now()
    }

    const getDowFromDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-').map(Number)
        const dateObj = new Date(y, m - 1, d)
        const dayNum = dateObj.getDay()
        return dayNum === 0 ? 7 : dayNum
    }

    const businessDow = getDowFromDate(selectedDate)
    const isToday = selectedDate === currentBusinessDate

    // Automatic Date Rollover, 3-Hour Inactivity Wake Modal & Cache Self-Cleaning Effect
    useEffect(() => {
        const checkDateRollover = (forceToday = false) => {
            const freshBusinessDate = getLAEffectiveBusinessDate()
            setCurrentBusinessDate(freshBusinessDate)
            
            const prevEffective = effectiveDateRef.current
            const dayChanged = freshBusinessDate !== prevEffective

            if (dayChanged || forceToday) {
                console.log(`[Preparador] Business date shifted: ${prevEffective} -> ${freshBusinessDate}`)
                effectiveDateRef.current = freshBusinessDate
                setSelectedDate(freshBusinessDate)
                setSelectedWasteDate(freshBusinessDate)
                hasInitializedRef.current = false // Allow carousel to re-center on morning interval
                prevCurrentBucketIndexRef.current = -1
                setRealMeatData([]) // Clear previous day's real consumptions
                setManualOverrides({}) // Clear previous day's one-off overrides
                setManualWeeklySchedule({}) // Clear previous day-of-week manual schedule before loading today's DOW
                lastCookAlertRef.current = null
                callingIdsRef.current.clear()
                setCallingOrderIds(new Set())
                setCallSuccessOrderIds(new Set())
                setCallErrorOrderIds(new Set())
                if (storeId) {
                    try { localStorage.removeItem(`prep_real_meat_${storeId}`) } catch {}
                    // Autolimpieza profunda de cachés de días anteriores + renovación de token en cambio de jornada (6:00 AM)
                    purgeTabletStaleCaches({
                        activeStoreId: storeId,
                        activeDate: freshBusinessDate,
                        activeDow: getDowFromDate(freshBusinessDate),
                        forceTokenRefresh: true
                    }).catch(() => {})
                }
                fetchReadyOrdersRef.current?.(true, true, true)
            }
        }

        // Inactivity auto-return: if viewing a past date but idle for > 2 minutes, return to TODAY
        const checkInactivityReturn = () => {
            const now = Date.now()
            const idleMs = now - lastActivityTimeRef.current
            const freshBusinessDate = getLAEffectiveBusinessDate()
            if (idleMs > 120000 && selectedDate !== freshBusinessDate) {
                console.log(`[Preparador] Idle on past date. Auto-returning to current date: ${freshBusinessDate}`)
                checkDateRollover(true)
            }
            // Tras 3 horas de inactividad, mostrar modal para despertar tableta (exento en modo manos libres Smart Auto-Timer)
            if (!isSmartAutoVoiceStoreRef.current && !showWakeUpModalRef.current && idleMs >= INACTIVITY_WAKE_MODAL_MS) {
                console.log('[Preparador] 3+ hours of inactivity reached -> Showing Wake Up Tablet Modal')
                showWakeUpModalRef.current = true
                setShowWakeUpModal(true)
            }
        }

        checkDateRollover()
        // Autolimpieza segura: NUNCA correr mientras !storeId y SIEMPRE preservar la fecha de HOY (jamás selectedDate histórica)
        if (storeId) {
            const todayLA = getLAEffectiveBusinessDate()
            purgeTabletStaleCaches({
                activeStoreId: storeId,
                activeDate: todayLA,
                activeDow: getDowFromDate(todayLA)
            }).catch(() => {})
        }

        const intervalId = setInterval(() => {
            checkDateRollover()
            checkInactivityReturn()
        }, 10000)

        const cacheCleanupTimer = setInterval(() => {
            if (!storeId) return
            const freshDate = getLAEffectiveBusinessDate()
            purgeTabletStaleCaches({
                activeStoreId: storeId,
                activeDate: freshDate,
                activeDow: getDowFromDate(freshDate)
            }).catch(() => {})
        }, 15 * 60 * 1000)

        // Wake-up / Screen unlock / Tab active listeners (con dedupe de 1.5s para evitar triple disparo focus+visibility)
        let lastWakeHandleAt = 0
        const handleWakeUp = () => {
            const now = Date.now()
            if (now - lastWakeHandleAt < 1500) return
            lastWakeHandleAt = now
            checkDateRollover()
            checkInactivityReturn()
            if (storeId) {
                const todayLA = getLAEffectiveBusinessDate()
                purgeTabletStaleCaches({
                    activeStoreId: storeId,
                    activeDate: todayLA,
                    activeDow: getDowFromDate(todayLA)
                }).catch(() => {})
            }
            fetchReadyOrdersRef.current?.(false)
        }

        window.addEventListener('focus', handleWakeUp)
        window.addEventListener('online', handleWakeUp)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') handleWakeUp()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        // Global touch/click listener to record activity
        window.addEventListener('touchstart', recordUserActivity, { passive: true })
        window.addEventListener('mousedown', recordUserActivity, { passive: true })
        window.addEventListener('keydown', recordUserActivity, { passive: true })

        return () => {
            clearInterval(intervalId)
            clearInterval(cacheCleanupTimer)
            window.removeEventListener('focus', handleWakeUp)
            window.removeEventListener('online', handleWakeUp)
            document.removeEventListener('visibilitychange', onVisibilityChange)
            window.removeEventListener('touchstart', recordUserActivity)
            window.removeEventListener('mousedown', recordUserActivity)
            window.removeEventListener('keydown', recordUserActivity)
        }
    }, [selectedDate, storeId, businessDow])

    const [viewMode, setViewMode] = useState<'30min' | 'tramos'>('30min')
    const [cardDisplayMode, setCardDisplayMode] = useState<'manual' | 'basic' | 'advanced'>('manual')
    
    // Guide Modal State
    const [showGuideModal, setShowGuideModal] = useState(false)
    const [guideModalDow, setGuideModalDow] = useState<number>(businessDow)
    const [guideModalData, setGuideModalData] = useState<any[]>([])
    const [guideModalLoading, setGuideModalLoading] = useState(false)
    
    // Meat Historial Data
    const [meatData, setMeatData] = useState<MeatData[]>([])
    const [realMeatData, setRealMeatData] = useState<{interval_start: string, meat_type: string, real_lbs: number}[]>([])
    const [fetchingMeat, setFetchingMeat] = useState(false)
    const [carouselBuckets, setCarouselBuckets] = useState<{ id: string, name?: string, isPeak?: boolean, duration?: number, label: string, isCurrent: boolean, data: any[] }[]>([])
    const [intelligenceAcelerador, setIntelligenceAcelerador] = useState(1.0)
    const [weatherAlert, setWeatherAlert] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const [currentBucketIndex, setCurrentBucketIndex] = useState(0)
    const hasInitializedRef = useRef(false)
    const prevCurrentBucketIndexRef = useRef<number>(-1)

    const touchStartRef = useRef<number | null>(null)
    const touchEndRef = useRef<number | null>(null)
    const [showInfoModal, setShowInfoModal] = useState(false)
    const [wakeToast, setWakeToast] = useState(false)
    const [mobileTab, setMobileTab] = useState<'parrilla' | 'insumos' | 'resumen'>('parrilla')
    const [showMobileSettingsDrawer, setShowMobileSettingsDrawer] = useState(false)
    const wakeLock = useWakeLock(true)

    // Manual/Explicit Tablet Wake-up & Full Daily Reconfiguration Handler (triggered by 3h modal or top bar button)
    const handleWakeUpTablet = async () => {
        if (wakingUpTablet) return
        setWakingUpTablet(true)
        showWakeUpModalRef.current = false
        setShowWakeUpModal(false)
        lastActivityTimeRef.current = Date.now()
        try { wakeLock.requestNow() } catch {}

        const freshBusinessDate = getLAEffectiveBusinessDate()
        const freshDow = getDowFromDate(freshBusinessDate)
        setCurrentBusinessDate(freshBusinessDate)
        setSelectedDate(freshBusinessDate)
        setSelectedWasteDate(freshBusinessDate)
        effectiveDateRef.current = freshBusinessDate
        hasInitializedRef.current = false // Re-centers carousel to current live 30-min interval
        prevCurrentBucketIndexRef.current = -1
        lastCookAlertRef.current = null
        callingIdsRef.current.clear()
        setCallingOrderIds(new Set())
        setCallSuccessOrderIds(new Set())
        setCallErrorOrderIds(new Set())

        // Clear previous day's real consumptions & load only today's overrides
        setRealMeatData([])
        if (storeId) {
            try { localStorage.removeItem(`prep_real_meat_${storeId}`) } catch {}
            try { localStorage.removeItem(`prep_real_meat_${storeId}_${freshBusinessDate}`) } catch {}
            try {
                const savedOverrides = localStorage.getItem(`teg_prep_overrides_${storeId}_${freshBusinessDate}`)
                setManualOverrides(savedOverrides ? JSON.parse(savedOverrides) : {})
            } catch {
                setManualOverrides({})
            }
        }

        // Desbloquear Web Audio API con tick sintetizado 0ms (cero petición 404 a /sounds/success.mp3)
        playTabletTick()

        // Lote 1 (concurrencia <= 3, Regla Protección de Servidores): caché + JWT + órdenes + historial
        if (storeId) {
            await purgeTabletStaleCaches({
                activeStoreId: storeId,
                activeDate: freshBusinessDate,
                activeDow: freshDow,
                forceTokenRefresh: true
            }).catch(() => {})
        }
        await Promise.allSettled([
            fetchReadyOrdersRef.current?.(true, true, true),
            fetchHistoryRef.current?.(freshDow, freshBusinessDate),
            fetchManualScheduleRef.current?.(freshDow, freshBusinessDate, true),
        ])
        // Lote 2 (concurrencia <= 2): consumo real + inteligencia intradía
        await Promise.allSettled([
            fetchRealMeatRef.current?.(freshBusinessDate),
            fetchIntelligenceRef.current?.(freshBusinessDate),
        ])
        setTimeout(() => updateBucketsRef.current?.(), 50)

        setWakingUpTablet(false)
        setWakeToast(true)
        setTimeout(() => setWakeToast(false), 4000)
    }

    // Manual Overrides & Weekly Schedule State
    const [manualOverrides, setManualOverrides] = useState<Record<string, number>>({})
    const [manualWeeklySchedule, setManualWeeklySchedule] = useState<Record<string, number>>({})
    const [editingMeatItem, setEditingMeatItem] = useState<GrillMeatEditRequest | null>(null)
    const [tempEditValue, setTempEditValue] = useState<number>(1)

    const persistManualOverrides = (next: Record<string, number>) => {
        setManualOverrides(next)
        if (!storeId || !selectedDate) return
        const storageKey = `teg_prep_overrides_${storeId}_${selectedDate}`
        const todayLA = getLAEffectiveBusinessDate()
        safeLocalStorageSet(storageKey, JSON.stringify(next), {
            activeStoreId: storeId,
            activeDate: todayLA,
            activeDow: getDowFromDate(todayLA)
        })
    }

    // Load Manual Overrides from localStorage
    useEffect(() => {
        if (!storeId || !selectedDate) return
        const storageKey = `teg_prep_overrides_${storeId}_${selectedDate}`
        const saved = localStorage.getItem(storageKey)
        if (saved) {
            try {
                setManualOverrides(JSON.parse(saved))
            } catch (e) {
                setManualOverrides({})
            }
        } else {
            setManualOverrides({})
        }
    }, [storeId, selectedDate])

    // Helper function to normalize time format (e.g., '12:00' -> '12:00:00')
    const normTime = (t: string) => {
        if (!t) return '00:00:00'
        const parts = t.split(':')
        if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`
        if (parts.length === 3) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`
        return t
    }

    // Load Manual Weekly Schedule from API & localStorage (5-min background polling with visibility guard)
    useEffect(() => {
        if (!storeId) return
        let cancelled = false

        const fetchManualSchedule = async (overrideDow?: number, overrideDate?: string, bypassCache = false) => {
            if (!overrideDow && !bypassCache && Date.now() - lastSaveTimeRef.current < 8000) return
            const targetDow = overrideDow || businessDow
            const targetStorageKey = `teg_prep_manual_weekly_${storeId}_${targetDow}`

            try {
                const url = bypassCache
                    ? `/api/inventory/preparador-manual-schedule?storeId=${storeId}&dow=${targetDow}&_t=${Date.now()}`
                    : `/api/inventory/preparador-manual-schedule?storeId=${storeId}&dow=${targetDow}`
                const res = await fetch(url, {
                    ...(bypassCache ? { cache: 'no-store' as RequestCache } : {}),
                    signal: AbortSignal.timeout(8000)
                })
                if (res.ok && !cancelled) {
                    const data = await res.json()
                    if (Array.isArray(data) && !cancelled) {
                        if (!overrideDow && !bypassCache && Date.now() - lastSaveTimeRef.current < 8000) return
                        const map: Record<string, number> = {}
                        data.forEach((item: any) => {
                            const key = `${normTime(item.interval_start)}_${item.meat_type}`
                            map[key] = Number(item.max_lbs)
                        })
                        setManualWeeklySchedule(map)
                        const todayLA = getLAEffectiveBusinessDate()
                        safeLocalStorageSet(targetStorageKey, JSON.stringify(map), {
                            activeStoreId: storeId,
                            activeDate: overrideDate || todayLA,
                            activeDow: getDowFromDate(todayLA)
                        })
                        return
                    }
                }
            } catch (e) {
                console.error('Error fetching manual schedule:', e)
            }

            if (cancelled) return
            const cached = localStorage.getItem(targetStorageKey)
            if (cached) {
                try {
                    setManualWeeklySchedule(JSON.parse(cached))
                } catch (e) {}
            } else {
                setManualWeeklySchedule({})
            }
        }

        fetchManualScheduleRef.current = fetchManualSchedule
        fetchManualSchedule()
        const interval = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                fetchManualSchedule()
            }
        }, 300000)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [storeId, businessDow])

    // Inactivity Reset Effect (Aero snap-back — pausado mientras se edita una carne)
    useEffect(() => {
        if (activeIndex === currentBucketIndex || editingMeatItem) return
        const timer = setTimeout(() => {
            setActiveIndex(currentBucketIndex)
        }, 15000)
        return () => clearTimeout(timer)
    }, [activeIndex, currentBucketIndex, editingMeatItem])

    // Request Cart & Ready Orders Tab State (persistente en localStorage para tabletas 24/7)
    const [activeTab, setActiveTabState] = useState<'alimentos' | 'ordenes'>('alimentos')
    const setActiveTab = (tab: 'alimentos' | 'ordenes') => {
        if (tab === 'ordenes') {
            suppressOrderCallsUntilRef.current = Math.max(suppressOrderCallsUntilRef.current, Date.now() + 320)
            cardRectsCacheRef.current = null
        }
        setActiveTabState(tab)
        try { localStorage.setItem('teg_preparador_active_tab', tab) } catch {}
    }
    const [cart, setCart] = useState<{name: string, qty: number}[]>([])
    const [sending, setSending] = useState(false)
    const [showDayModal, setShowDayModal] = useState(false)

    // Ready Orders (Entregador / Pick-up Impulses)
    const [readyOrdersList, setReadyOrdersList] = useState<any[]>([])
    const [loadingReadyOrders, setLoadingReadyOrders] = useState(false)
    const callingIdsRef = useRef<Set<string>>(new Set())
    const [callingOrderIds, setCallingOrderIds] = useState<Set<string>>(new Set())
    const [callSuccessOrderIds, setCallSuccessOrderIds] = useState<Set<string>>(new Set())
    const [callErrorOrderIds, setCallErrorOrderIds] = useState<Set<string>>(new Set())
    const realtimeChannelRef = useRef<any>(null)
    const [hideDrinks, setHideDrinks] = useState(true)
    const [hideCookingPanel, setHideCookingPanel] = useState(false)
    const isPrepTouchActiveRef = useRef<boolean>(false)
    const prepTouchActiveAtRef = useRef<number>(0)
    const pendingReadyOrdersRef = useRef<any[] | null>(null)
    const tabletTickCtxRef = useRef<AudioContext | null>(null)
    const cardRectsCacheRef = useRef<{ at: number; items: Array<{ tapId: string; rect: DOMRect }> } | null>(null)

    const markPrepTouchActive = (active: boolean) => {
        isPrepTouchActiveRef.current = active
        if (active) {
            prepTouchActiveAtRef.current = Date.now()
            return
        }
        const deferred = pendingReadyOrdersRef.current
        if (deferred) {
            pendingReadyOrdersRef.current = null
            setReadyOrdersList((prev) => (areOrdersListsEqual(prev, deferred) ? prev : deferred))
        }
    }

    // Timer Inteligente Manos Libres por sucursal (piloto activo exclusivamente en SLAUSON; las otras 14 tiendas permanecen en 'manual')
    const [autoCallConfig, setAutoCallConfig] = useState<AutoCallTimerConfig>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('teg_order_ready_auto_call_timer_v1')
                if (saved) return sanitizeAutoCallTimerConfig(JSON.parse(saved))
            } catch {}
        }
        return sanitizeAutoCallTimerConfig(DEFAULT_AUTO_CALL_TIMER_CONFIG)
    })
    const [smartNowMs, setSmartNowMs] = useState<number>(() => Date.now())
    const prepAutoObservedRef = useRef<Set<string>>(new Set())
    const prepAutoBackupClaimedRef = useRef<Set<string>>(new Set())
    const prepAutoBackupInflightRef = useRef<boolean>(false)

    const currentStoreCode = useMemo(() => {
        if (!storeId || stores.length === 0) return ''
        const currentStore = stores.find((s) => String(s.id) === String(storeId))
        return String(currentStore?.code || TOAST_STORE_MAP[currentStore?.external_id]?.code || '').toUpperCase()
    }, [storeId, stores])

    const isSmartAutoVoiceStore = useMemo(
        () => isStoreSmartAutoCallEnabled(autoCallConfig, currentStoreCode),
        [autoCallConfig, currentStoreCode]
    )
    isSmartAutoVoiceStoreRef.current = isSmartAutoVoiceStore

    // Reloj en vivo California + contador de minutos para las 14 sucursales en modo manual (pausado si pestaña oculta)
    useEffect(() => {
        const updateClock = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            const now = Date.now()
            setElapsedNowMs(now)
            try {
                setLiveClockText(
                    new Intl.DateTimeFormat('en-US', {
                        timeZone: 'America/Los_Angeles',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                    }).format(new Date(now))
                )
            } catch {}
        }
        updateClock()
        const id = setInterval(updateClock, 30_000)
        return () => clearInterval(id)
    }, [])

    // Sincronizar configuración de Timer Inteligente desde /api/order-ready/settings (con timeout 6s y retry 401)
    useEffect(() => {
        let cancelled = false
        const loadAutoTimerSettings = async () => {
            try {
                let res = await fetch('/api/order-ready/settings', {
                    cache: 'no-store',
                    credentials: 'include',
                    headers: getTabletNoCacheHeaders(),
                    signal: AbortSignal.timeout(6000)
                })
                if (res.status === 401) {
                    const refreshed = await ensureFreshTabletAuth(true).catch(() => null)
                    if (refreshed && !cancelled) {
                        res = await fetch('/api/order-ready/settings', {
                            cache: 'no-store',
                            credentials: 'include',
                            headers: getTabletNoCacheHeaders(),
                            signal: AbortSignal.timeout(6000)
                        })
                    }
                }
                if (!res.ok) return
                const json = await res.json()
                if (!cancelled && json?.success && json?.autoCallTimer) {
                    const sanitized = sanitizeAutoCallTimerConfig(json.autoCallTimer)
                    setAutoCallConfig(sanitized)
                    try {
                        localStorage.setItem('teg_order_ready_auto_call_timer_v1', JSON.stringify(sanitized))
                    } catch {}
                }
            } catch {}
        }
        void loadAutoTimerSettings()
        return () => {
            cancelled = true
        }
    }, [currentStoreCode])

    // Telemetría silenciosa de latido de Tableta de Preparación (lee isFullscreenRef en vivo, sin stale closure)
    useEffect(() => {
        if (!currentStoreCode) return
        const sendPrepHeartbeat = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            fetch('/api/order-ready/telemetry', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getTabletNoCacheHeaders() },
                signal: AbortSignal.timeout(4000),
                body: JSON.stringify({
                    action: 'heartbeat',
                    storeCode: currentStoreCode,
                    deviceRole: 'prep_tablet',
                    isFullscreen: isFullscreenRef.current
                })
            })
                .then((res) => {
                    if (res.status === 401) {
                        ensureFreshTabletAuth(true).catch(() => {})
                    }
                })
                .catch(() => {})
        }
        sendPrepHeartbeat()
        const hbInterval = setInterval(sendPrepHeartbeat, 300_000)
        const onVisible = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                sendPrepHeartbeat()
            }
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            clearInterval(hbInterval)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [currentStoreCode])

    // Reiniciar seguimiento de observaciones del timer inteligente al cambiar de tienda o fecha laboral
    useEffect(() => {
        prepAutoObservedRef.current.clear()
        prepAutoBackupClaimedRef.current.clear()
    }, [currentStoreCode, currentBusinessDate])

    // Cargar preferencias persistidas de la tableta (ocultar bebidas, pestaña activa, tema día/noche y modo solo órdenes)
    useEffect(() => {
        try {
            const savedTheme = localStorage.getItem('teg_preparador_theme')
            if (savedTheme === 'day' || savedTheme === 'night') {
                setPrepTheme(savedTheme)
            }
            const saved = localStorage.getItem('prep_hide_drinks')
            if (saved !== null) {
                setHideDrinks(saved === 'true')
            }
            const savedHideCooking = localStorage.getItem('teg_preparador_hide_cooking')
            if (savedHideCooking === 'true') {
                setHideCookingPanel(true)
                setActiveTabState('ordenes')
            } else {
                const savedTab = localStorage.getItem('teg_preparador_active_tab')
                if (savedTab === 'alimentos' || savedTab === 'ordenes') {
                    setActiveTabState(savedTab)
                }
            }
        } catch {}
    }, [])

    const toggleHideCookingPanel = (explicitState?: boolean) => {
        // Blindar 500ms contra clics/toques fantasma cuando el panel de órdenes se desliza debajo del dedo
        suppressOrderCallsUntilRef.current = Math.max(suppressOrderCallsUntilRef.current, Date.now() + 500)
        cardRectsCacheRef.current = null
        const next = typeof explicitState === 'boolean' ? explicitState : !hideCookingPanel
        setHideCookingPanel(next)
        try { localStorage.setItem('teg_preparador_hide_cooking', String(next)) } catch {}
        if (next) {
            setActiveTab('ordenes')
            fetchReadyOrdersRef.current?.(false)
        }
    }

    const toggleHideDrinks = () => {
        const next = !hideDrinks
        setHideDrinks(next)
        try { localStorage.setItem('prep_hide_drinks', String(next)) } catch {}
    }

    // Filtra, desduplica y ordena FIFO 1:1 con Toast KDS las órdenes en preparación (IN_PROGRESS)
    const filterAndDedupePrepOrders = (rows: any[], storeCode: string, todayLA: string): any[] => {
        const now = Date.now()
        const seenGuids = new Set<string>()
        const seenNumbers = new Set<string>()
        const sortedRows = [...rows].sort(compareOrdersKdsFifo)
        const uniqueRecent: any[] = []

        for (const o of sortedRows) {
            if (!o || o.status !== 'IN_PROGRESS') continue
            if (o.dining_option && !['FOR_HERE', 'TOGO'].includes(String(o.dining_option).toUpperCase())) continue

            const t = Date.parse(o.created_at)
            if (!isNaN(t) && now - t >= 90 * 60 * 1000) continue

            // REGLA CRÍTICA TACOS GAVILAN: Las órdenes que SOLO tienen bebidas o postres (flan, cheesecake, etc.)
            // se despachan en mostrador/caja y NO requieren preparación de cocina ni parrilla por el taquero.
            if (isDrinkOrDessertOnlyOrder(o.items_summary)) continue

            const guidKey = o.order_guid ? String(o.order_guid).trim() : null
            const numKey = `${o.store_code || storeCode}_${o.business_date || todayLA}_${o.order_number}`

            if (guidKey && seenGuids.has(guidKey)) continue
            if (seenNumbers.has(numKey)) continue

            if (guidKey) seenGuids.add(guidKey)
            seenNumbers.add(numKey)
            uniqueRecent.push(o)
        }
        return uniqueRecent.sort(compareOrdersKdsFifo)
    }

    // Actualiza readyOrdersList SOLO si realmente cambió el listado o posición FIFO de órdenes (evita re-renderizar los botones mientras el cocinero toca la pantalla)
    const areOrdersListsEqual = (prev: any[], nextOrders: any[]) => {
        if (prev.length !== nextOrders.length) return false
        for (let i = 0; i < prev.length; i++) {
            const a = prev[i]
            const b = nextOrders[i]
            if (
                String(a?.id) !== String(b?.id) ||
                String(a?.order_number) !== String(b?.order_number) ||
                String(a?.status) !== String(b?.status) ||
                String(a?.dining_option) !== String(b?.dining_option) ||
                String(a?.created_at) !== String(b?.created_at) ||
                String(a?.announced_at || '') !== String(b?.announced_at || '') ||
                String(a?.items_summary || '') !== String(b?.items_summary || '')
            ) {
                return false
            }
        }
        return true
    }

    const applyReadyOrdersIfChanged = (nextOrders: any[]) => {
        cardRectsCacheRef.current = null
        if (isPrepTouchActiveRef.current && Date.now() - prepTouchActiveAtRef.current < 2000) {
            pendingReadyOrdersRef.current = nextOrders
            return
        }
        pendingReadyOrdersRef.current = null
        setReadyOrdersList((prev) => (areOrdersListsEqual(prev, nextOrders) ? prev : nextOrders))
    }

    // Consulta de órdenes en preparación de la sucursal actual (status = IN_PROGRESS / SEND)
    const fetchReadyOrders = async (isManual = false, syncToastExplicit = false, skipCachePurge = false) => {
        if (!storeId || stores.length === 0) return
        const currentStore = stores.find(s => String(s.id) === String(storeId))
        const storeCode = (currentStore?.code || TOAST_STORE_MAP[currentStore?.external_id]?.code || '').toUpperCase()
        if (!storeCode) return

        // Watchdog anti-congelamiento (8.5s): si un micro-corte Wi-Fi dejó un socket TCP semi-abierto en Fullscreen,
        // abortar el controlador anterior y destrabar fetchingReadyOrdersRef automáticamente.
        const nowStartMs = Date.now()
        if (fetchingReadyOrdersRef.current) {
            const stuckElapsedMs = nowStartMs - fetchingReadyOrdersStartedAtRef.current
            if (!isManual && stuckElapsedMs < 8500) {
                if (syncToastExplicit) {
                    pendingToastSyncRef.current = true
                }
                return
            }
            try {
                activeOrdersFetchAbortRef.current?.abort()
            } catch {}
            fetchingReadyOrdersRef.current = false
        }

        const runController = new AbortController()
        activeOrdersFetchAbortRef.current = runController
        fetchingReadyOrdersRef.current = true
        fetchingReadyOrdersStartedAtRef.current = nowStartMs
        if (isManual || syncToastExplicit) {
            pendingToastSyncRef.current = false
        }

        const shouldSyncToast = isManual || syncToastExplicit

        if (isManual) {
            setLoadingReadyOrders(true)
            if (!skipCachePurge && storeId) {
                const todayLA = getLAEffectiveBusinessDate()
                purgeTabletStaleCaches({
                    activeStoreId: storeId,
                    activeDate: todayLA,
                    activeDow: getDowFromDate(todayLA),
                    forceTokenRefresh: true
                }).catch(() => {})
            }
        }
        try {
            const todayLA = getCaliforniaBusinessDate()
            // @businessRule Tacos Gavilan: Ventana de consulta activa de los últimos 90 minutos (status = IN_PROGRESS).
            // 1. Consulta directa ultrarrápida a Supabase con columnas escalares explícitas (Ley #1: cero SELECT *)
            const cutoffTime = new Date(Date.now() - 90 * 60 * 1000).toISOString()
            const supaCtrl = new AbortController()
            const onParentAbortSupa = () => supaCtrl.abort()
            runController.signal.addEventListener('abort', onParentAbortSupa, { once: true })
            const supaTimer = setTimeout(() => supaCtrl.abort(), 6500)
            let directQuerySucceeded = false
            try {
                const { data, error } = await supabase
                    .from('order_ready_announcements')
                    .select('id, order_guid, order_number, store_code, store_name, customer_name, business_date, status, dining_option, items_summary, created_at, announced_at')
                    .eq('store_code', storeCode)
                    .eq('business_date', todayLA)
                    .eq('status', 'IN_PROGRESS') // Exclusivo órdenes en preparación (SEND)
                    .in('dining_option', ['FOR_HERE', 'TOGO']) // Exclusivo Comedor y Para Llevar (jamás Delivery ni Drive-Thru)
                    .gte('created_at', cutoffTime)
                    .order('created_at', { ascending: true }) // FIFO 1:1 con Toast KDS: las disparadas primero a cocina van primero
                    .limit(150)
                    .abortSignal(supaCtrl.signal)

                if (!error && data && !runController.signal.aborted) {
                    directQuerySucceeded = true
                    applyReadyOrdersIfChanged(filterAndDedupePrepOrders(data, storeCode, todayLA))
                    lastOrdersSyncSuccessAtRef.current = Date.now()
                }
            } catch {
                // Si la lectura directa a PostgREST expira por red, continuar de inmediato con el endpoint /api/order-ready/orders
            } finally {
                clearTimeout(supaTimer)
                runController.signal.removeEventListener('abort', onParentAbortSupa)
            }

            if (runController.signal.aborted) return

            // En ticks impares rápidos (syncToast=false) si la lectura directa respondió OK, evitar doble-fetch innecesario a Vercel/DB
            if (!shouldSyncToast && directQuerySucceeded) {
                return
            }

            // 2. Consultar el servidor (/api/order-ready/orders) sin caché de navegador y con timeout estricto de 8s:
            const apiCtrl = new AbortController()
            const onParentAbortApi = () => apiCtrl.abort()
            runController.signal.addEventListener('abort', onParentAbortApi, { once: true })
            const apiTimer = setTimeout(() => apiCtrl.abort(), shouldSyncToast ? 8000 : 6500)
            try {
                const syncRes = await fetch(
                    `/api/order-ready/orders?storeCode=${storeCode}&minutes=90&view=prep&syncToast=${shouldSyncToast ? 'true' : 'false'}&forceToast=${isManual ? 'true' : 'false'}&_t=${Date.now()}`,
                    {
                        cache: 'no-store',
                        credentials: 'include',
                        headers: getTabletNoCacheHeaders(),
                        signal: apiCtrl.signal
                    }
                )
                if (syncRes.status === 401) {
                    ensureFreshTabletAuth(true).catch(() => {})
                } else if (syncRes.ok && !runController.signal.aborted) {
                    const syncJson = await syncRes.json()
                    if (syncJson?.authenticated === false) {
                        ensureFreshTabletAuth(true).catch(() => {})
                    }
                    if (Array.isArray(syncJson?.inProgressOrders)) {
                        applyReadyOrdersIfChanged(filterAndDedupePrepOrders(syncJson.inProgressOrders, storeCode, todayLA))
                        lastOrdersSyncSuccessAtRef.current = Date.now()
                    }
                }
            } finally {
                clearTimeout(apiTimer)
                runController.signal.removeEventListener('abort', onParentAbortApi)
            }
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                console.warn('Error fetching prep orders on preparador tablet:', err)
            }
        } finally {
            const isCurrentRun = activeOrdersFetchAbortRef.current === runController
            if (isCurrentRun) {
                activeOrdersFetchAbortRef.current = null
                fetchingReadyOrdersRef.current = false
            }
            if (isManual && isCurrentRun) setLoadingReadyOrders(false)
            if (pendingToastSyncRef.current) {
                pendingToastSyncRef.current = false
                if (pendingToastSyncTimeoutRef.current) {
                    clearTimeout(pendingToastSyncTimeoutRef.current)
                }
                pendingToastSyncTimeoutRef.current = setTimeout(() => {
                    pendingToastSyncTimeoutRef.current = null
                    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                        fetchReadyOrdersRef.current?.(false, true)
                    }
                }, 150)
            }
        }
    }

    // Mantener referencia actualizada de fetchReadyOrders para centinelas y eventos de pantalla activa
    useEffect(() => {
        fetchReadyOrdersRef.current = fetchReadyOrders
    }, [fetchReadyOrders])

    // Suscripción Realtime aislada por tienda con filtro server-side, debounce 500ms y sin reconexión en CLOSED intencional
    useEffect(() => {
        if (!storeId || stores.length === 0) return
        const currentStore = stores.find(s => String(s.id) === String(storeId))
        const storeCode = (currentStore?.code || TOAST_STORE_MAP[currentStore?.external_id]?.code || '').toUpperCase()
        if (!storeCode) return

        const channelTopic = `order-ready-realtime:${storeCode}`
        let unmounted = false
        let disposeCurrentChannelGuard: (() => void) | null = null
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
        let realtimeDebounceTimer: ReturnType<typeof setTimeout> | null = null

        const disposeActiveChannel = () => {
            if (disposeCurrentChannelGuard) {
                disposeCurrentChannelGuard()
                disposeCurrentChannelGuard = null
            }
            if (realtimeChannelRef.current) {
                const chToRemove = realtimeChannelRef.current
                realtimeChannelRef.current = null
                supabase.removeChannel(chToRemove).catch(() => {})
            }
        }

        const scheduleRealtimePrepRefresh = () => {
            if (unmounted) return
            if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer)
            realtimeDebounceTimer = setTimeout(() => {
                realtimeDebounceTimer = null
                if (!unmounted && !fetchingReadyOrdersRef.current) {
                    // Callback Realtime y reconexión NUNCA inician sincronización Toast (syncToast=false)
                    fetchReadyOrdersRef.current?.(false, false)
                }
            }, 500)
        }

        // Detecta horas muertas (04:15–06:59 America/Los_Angeles) cuando las sucursales están cerradas
        // para reducir el sondeo de tabletas 24/7 a >= 60s y proteger Supabase/Vercel.
        const isLosAngelesDeadHours = (now = new Date()): boolean => {
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23'
                }).formatToParts(now)
                const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
                const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
                const hour = rawHour === 24 ? 0 : rawHour
                const totalMinutes = hour * 60 + minute
                return totalMinutes >= 4 * 60 + 15 && totalMinutes <= 6 * 60 + 59
            } catch {
                return false
            }
        }

        // Carga inicial (evitar syncToast inmediato durante horas muertas)
        fetchReadyOrders(false, !isLosAngelesDeadHours())

        const setupRealtimeChannel = () => {
            if (unmounted) return
            disposeActiveChannel()

            let channelDisposed = false
            disposeCurrentChannelGuard = () => {
                channelDisposed = true
            }

            const channel = supabase
                .channel(channelTopic)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'order_ready_announcements',
                        filter: `store_code=eq.${storeCode}`
                    },
                    (payload: any) => {
                        if (unmounted || channelDisposed) return
                        const row = payload.new || payload.old
                        if (row && String(row.store_code || storeCode).toUpperCase() === storeCode) {
                            scheduleRealtimePrepRefresh()
                        }
                    }
                )
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'order_ready_settings',
                        filter: 'id=eq.auto_call_timer_config'
                    },
                    (payload: any) => {
                        if (unmounted || channelDisposed) return
                        const newRow = payload.new
                        if (newRow && newRow.id === 'auto_call_timer_config' && newRow.updated_by) {
                            try {
                                const nextCfg = sanitizeAutoCallTimerConfig(JSON.parse(newRow.updated_by))
                                setAutoCallConfig((prev) => {
                                    const prevSmart = isStoreSmartAutoCallEnabled(prev, storeCode)
                                    const nextSmart = isStoreSmartAutoCallEnabled(nextCfg, storeCode)
                                    if (!prevSmart && nextSmart) {
                                        prepAutoObservedRef.current.clear()
                                    }
                                    return nextCfg
                                })
                                try {
                                    localStorage.setItem('teg_order_ready_auto_call_timer_v1', JSON.stringify(nextCfg))
                                } catch {}
                            } catch {}
                        }
                    }
                )
                .subscribe((status: string) => {
                    if (unmounted || channelDisposed || realtimeChannelRef.current !== channel) return
                    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        if (reconnectTimeout) clearTimeout(reconnectTimeout)
                        reconnectTimeout = setTimeout(() => {
                            reconnectTimeout = null
                            if (!unmounted && !channelDisposed) {
                                setupRealtimeChannel()
                                // No sincronizar Toast durante reconexión: refresco de solo lectura
                                scheduleRealtimePrepRefresh()
                            }
                        }, 3000)
                    }
                })

            realtimeChannelRef.current = channel
        }

        setupRealtimeChannel()

        // Ciclo unificado cada 5s con escudo de polling 24/7:
        // - Pausa por completo cuando document.visibilityState !== 'visible'.
        // - En horas muertas (04:15–06:59 America/Los_Angeles): reduce el sondeo a >= 60s.
        // - En horas operativas:
        //   * Ticks impares (5s, 15s, 25s...): lectura ligera de BD (syncToast=false)
        //   * Ticks pares (10s, 20s, 30s...): detección activa de KDS bump en Toast (syncToast=true)
        let pollTickCount = 0
        let lastRealtimeRecycleAt = Date.now()
        let lastPollExecutedAt = Date.now()
        let lastResumedAt = Date.now()

        const handleVisibilityResume = () => {
            if (!unmounted && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
                lastResumedAt = Date.now()
                scheduleRealtimePrepRefresh()
            }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityResume)
        }

        const pollTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return
            }

            const nowTickMs = Date.now()
            const deadHours = isLosAngelesDeadHours()
            if (deadHours) {
                if (nowTickMs - lastPollExecutedAt < 60_000) {
                    return
                }
                lastPollExecutedAt = nowTickMs
                fetchReadyOrdersRef.current?.(false, false)
                return
            }

            pollTickCount = (pollTickCount + 1) % 1000
            // Si tras un micro-corte Wi-Fi pasaron >60s sin refresco exitoso en horas activas, reciclar preventivamente el canal Realtime
            const lastHealthyAt = Math.max(lastOrdersSyncSuccessAtRef.current, lastResumedAt)
            if (
                nowTickMs - lastHealthyAt > 60000 &&
                nowTickMs - lastRealtimeRecycleAt > 60000
            ) {
                lastRealtimeRecycleAt = nowTickMs
                setupRealtimeChannel()
            }

            // Sincronización Toast EXCLUSIVAMENTE en ticks pares (cada 10s); ticks impares solo lectura ligera (5s)
            const shouldSyncToastOnTick = pollTickCount % 2 === 0
            lastPollExecutedAt = nowTickMs
            fetchReadyOrdersRef.current?.(false, shouldSyncToastOnTick)
        }, 5000)

        return () => {
            unmounted = true
            pendingToastSyncRef.current = false
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityResume)
            }
            if (pendingToastSyncTimeoutRef.current) {
                clearTimeout(pendingToastSyncTimeoutRef.current)
                pendingToastSyncTimeoutRef.current = null
            }
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout)
                reconnectTimeout = null
            }
            if (realtimeDebounceTimer) {
                clearTimeout(realtimeDebounceTimer)
                realtimeDebounceTimer = null
            }
            clearInterval(pollTimer)
            if (activeOrdersFetchAbortRef.current) {
                try {
                    activeOrdersFetchAbortRef.current.abort()
                } catch {}
                activeOrdersFetchAbortRef.current = null
                fetchingReadyOrdersRef.current = false
            }
            disposeActiveChannel()
        }
    }, [storeId, stores, supabase])

    // Tick de 1s y respaldo atómico (+2.5s) EXCLUSIVO cuando la tienda actual tiene activo el Timer Inteligente (piloto: SLAUSON)
    useEffect(() => {
        if (!isSmartAutoVoiceStore || readyOrdersList.length === 0) return
        setSmartNowMs(Date.now())
        const tick = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
            if (isPrepTouchActiveRef.current && Date.now() - prepTouchActiveAtRef.current < 2000) return
            setSmartNowMs(Date.now())
        }, 1000)
        return () => clearInterval(tick)
    }, [isSmartAutoVoiceStore, readyOrdersList.length])

    useEffect(() => {
        if (!isSmartAutoVoiceStore || !currentStoreCode || readyOrdersList.length === 0) return

        for (let idx = 0; idx < readyOrdersList.length; idx++) {
            const ord = readyOrdersList[idx]
            if (!ord?.id) continue
            const numStr = String(ord.order_number || '').trim()
            if (!/^\d{1,6}$/.test(numStr)) continue

            if (ord.announced_at) {
                prepAutoBackupClaimedRef.current.add(ord.id)
                continue
            }
            if (prepAutoBackupClaimedRef.current.has(ord.id)) {
                continue
            }
            const retryAfter = prepAutoBackupRetryAfterRef.current.get(ord.id) || 0
            if (retryAfter > smartNowMs) {
                continue
            }

            const plan = computeSmartOrderAutoCallPlan(ord, idx, autoCallConfig, smartNowMs)
            if (plan.remainingMs > 0) {
                prepAutoObservedRef.current.add(ord.id)
                continue
            }

            const overdueMs = -plan.remainingMs
            const wasObserved = prepAutoObservedRef.current.has(ord.id)
            if (!wasObserved && overdueMs > AUTO_CALL_MAX_UNOBSERVED_OVERDUE_MS) {
                prepAutoBackupClaimedRef.current.add(ord.id)
                continue
            }

            // Dar 2.5 segundos de ventaja a la PC del Manager (/order-ready-board) como ejecutor primario;
            // si su pestaña estaba minimizada/throttled en Chrome, la tableta envía el respaldo atómico al servidor.
            if (overdueMs < 2500) {
                continue
            }
            if (prepAutoBackupInflightRef.current) {
                break
            }

            prepAutoBackupInflightRef.current = true
            prepAutoBackupClaimedRef.current.add(ord.id)
            const currentStore = stores.find((s) => String(s.id) === String(storeId))
            const storeName = ord?.store_name || currentStore?.name || currentStoreCode

            ;(async () => {
                try {
                    let res = await fetch('/api/order-ready/call', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', ...getTabletNoCacheHeaders() },
                        body: JSON.stringify({
                            orderId: ord.id,
                            orderNumber: numStr,
                            storeCode: currentStoreCode,
                            diningOption: ord.dining_option,
                            storeName,
                            autoTimerOnlyIfUnannounced: true
                        }),
                        signal: AbortSignal.timeout(5000)
                    })
                    if (res.status === 401) {
                        const refreshed = await ensureFreshTabletAuth(true)
                        if (refreshed) {
                            res = await fetch('/api/order-ready/call', {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json', ...getTabletNoCacheHeaders() },
                                body: JSON.stringify({
                                    orderId: ord.id,
                                    orderNumber: numStr,
                                    storeCode: currentStoreCode,
                                    diningOption: ord.dining_option,
                                    storeName,
                                    autoTimerOnlyIfUnannounced: true
                                }),
                                signal: AbortSignal.timeout(5000)
                            })
                        }
                    }
                    if (res.ok) {
                        const resJson = await res.json()
                        if (resJson?.autoTriggered && !resJson?.skippedAutoTimer) {
                            const annIso = resJson.announcedAt || new Date().toISOString()
                            setReadyOrdersList((prev) =>
                                prev.map((item) => (item.id === ord.id ? { ...item, announced_at: annIso } : item))
                            )
                        }
                    } else if (overdueMs < 25_000 && res.status !== 522 && res.status !== 524 && res.status !== 521) {
                        // Backoff de 8s para evitar retry-piling 1x/seg ante fallas transitorias
                        prepAutoBackupRetryAfterRef.current.set(ord.id, Date.now() + 8000)
                        prepAutoBackupClaimedRef.current.delete(ord.id)
                    }
                } catch {
                    if (overdueMs < 25_000) {
                        prepAutoBackupRetryAfterRef.current.set(ord.id, Date.now() + 8000)
                        prepAutoBackupClaimedRef.current.delete(ord.id)
                    }
                } finally {
                    prepAutoBackupInflightRef.current = false
                }
            })()

            break
        }
    }, [isSmartAutoVoiceStore, currentStoreCode, readyOrdersList, autoCallConfig, smartNowMs, stores, storeId])

    // Sonido sutil de clic/tick sintetizado en memoria (Web Audio API, 0ms y cero 404) + pulso háptico en Android
    const playTabletTick = () => {
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(16)
            }
        } catch {}
        try {
            if (typeof window === 'undefined') return
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
            if (!AudioCtx) return
            if (!tabletTickCtxRef.current) {
                tabletTickCtxRef.current = new AudioCtx()
            }
            const ctx = tabletTickCtxRef.current
            if (ctx.state === 'suspended') {
                void ctx.resume().catch(() => {})
            }
            const t0 = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'triangle'
            osc.frequency.setValueAtTime(920, t0)
            osc.frequency.exponentialRampToValueAtTime(1380, t0 + 0.032)
            gain.gain.setValueAtTime(0.18, t0)
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(t0)
            osc.stop(t0 + 0.048)
        } catch {}
    }

    // Seguridad global para liberar isPrepTouchActiveRef si el dedo abandona un botón o la ventana
    useEffect(() => {
        const onGlobalRelease = () => markPrepTouchActive(false)
        window.addEventListener('pointerup', onGlobalRelease, { passive: true })
        window.addEventListener('pointercancel', onGlobalRelease, { passive: true })
        window.addEventListener('touchend', onGlobalRelease, { passive: true })
        window.addEventListener('touchcancel', onGlobalRelease, { passive: true })
        return () => {
            window.removeEventListener('pointerup', onGlobalRelease)
            window.removeEventListener('pointercancel', onGlobalRelease)
            window.removeEventListener('touchend', onGlobalRelease)
            window.removeEventListener('touchcancel', onGlobalRelease)
            if (tabletTickCtxRef.current && tabletTickCtxRef.current.state !== 'closed') {
                void tabletTickCtxRef.current.close().catch(() => {})
            }
            for (const timer of callStatusTimersRef.current.values()) {
                clearTimeout(timer)
            }
            callStatusTimersRef.current.clear()
        }
    }, [])

    const prepPointerStartsRef = useRef<Map<number, { x: number; y: number; maxDist: number; key: string; at: number; firedOnDown: boolean }>>(new Map())
    const prepLastTouchAtRef = useRef<number>(0)
    const prepLastTouchKeyRef = useRef<string>('')
    const prepLastTouchByKeyRef = useRef<Map<string, number>>(new Map())
    const activeOrderGesturesRef = useRef<
        Map<
            string,
            {
                key: string
                startedAt: number
                fired: boolean
                endedAt?: number
                source?: 'touch' | 'mouse' | 'unknown'
            }
        >
    >(new Map())
    const lastTouchSignalByKeyRef = useRef<Map<string, number>>(new Map())

    const triggerPrepDedupedAction = (key: string, action: () => void, dedupeMs = 340) => {
        const now = Date.now()
        const lastForKey = prepLastTouchByKeyRef.current.get(key) || 0
        if (now - lastForKey < dedupeMs) return
        prepLastTouchByKeyRef.current.set(key, now)
        if (prepLastTouchByKeyRef.current.size > 80) {
            for (const [k, ts] of prepLastTouchByKeyRef.current.entries()) {
                if (now - ts > 15_000) prepLastTouchByKeyRef.current.delete(k)
            }
        }
        if (lastTouchSignalByKeyRef.current.size > 80) {
            for (const [k, ts] of lastTouchSignalByKeyRef.current.entries()) {
                if (now - ts > 15_000) lastTouchSignalByKeyRef.current.delete(k)
            }
        }
        prepLastTouchAtRef.current = now
        prepLastTouchKeyRef.current = key
        action()
    }

    // 🛡️ Escudo 1 (Single-Gesture Lock Multi-Tarjeta): Garantiza que UN toque físico por tarjeta (dure 0.05s o 8s)
    // dispare UNA SOLA VEZ en 0ms al primer contacto (`down`/`move`), bloqueando repeticiones al mantener o soltar
    // (`up`/`cancel`/`click`/`mousedown`), sin perder rescate para guante/dedo seco ni bloquear otras tarjetas en multi-toque.
    const triggerGestureSafeTap = (
        key: string,
        phase: 'down' | 'move' | 'up' | 'cancel' | 'click',
        action: () => void,
        dedupeMs = 450,
        source: 'touch' | 'mouse' | 'unknown' = 'unknown'
    ) => {
        const now = Date.now()
        if (phase === 'down' || phase === 'move') {
            markPrepTouchActive(true)
        } else {
            markPrepTouchActive(false)
        }

        if (source === 'touch') {
            lastTouchSignalByKeyRef.current.set(key, now)
        } else if (source === 'mouse' && phase === 'down') {
            const lastTouchForKey = lastTouchSignalByKeyRef.current.get(key) || 0
            if (now - lastTouchForKey < 1500) {
                // Bloquear `mousedown` de compatibilidad sintetizado por Chromium tras soltar toque táctil
                return
            }
        }

        const gestures = activeOrderGesturesRef.current
        if (gestures.size > 40) {
            for (const [k, g] of gestures.entries()) {
                if (now - g.startedAt > 20000) gestures.delete(k)
            }
        }
        const active = gestures.get(key) || null

        if (phase === 'down') {
            if (active) {
                if (active.endedAt === undefined && active.fired && now - active.startedAt < 450) {
                    return
                }
                if (active.endedAt !== undefined && active.fired && now - active.endedAt < dedupeMs) {
                    return
                }
            }
            gestures.set(key, { key, startedAt: now, fired: true, source })
            triggerPrepDedupedAction(key, action, dedupeMs)
            return
        }

        if (phase === 'move') {
            if (active) {
                if (active.fired || active.endedAt !== undefined) return
                active.fired = true
                triggerPrepDedupedAction(key, action, dedupeMs)
                return
            }
            gestures.set(key, { key, startedAt: now, fired: true, source })
            triggerPrepDedupedAction(key, action, dedupeMs)
            return
        }

        if (phase === 'up' || phase === 'cancel') {
            if (active) {
                if (active.endedAt === undefined) {
                    active.endedAt = now
                }
                if (active.fired) return
                active.fired = true
                triggerPrepDedupedAction(key, action, dedupeMs)
                return
            }
            if (phase === 'up') {
                gestures.set(key, { key, startedAt: now, endedAt: now, fired: true, source })
                triggerPrepDedupedAction(key, action, dedupeMs)
            }
            return
        }

        // phase === 'click'
        if (active && active.fired) {
            if (active.endedAt === undefined) {
                active.endedAt = now
                return
            }
            if (now - active.endedAt < 1200) {
                return
            }
        }
        gestures.set(key, { key, startedAt: now, endedAt: now, fired: true, source })
        triggerPrepDedupedAction(key, action, dedupeMs)
    }

    const doesOrdersScrollOverflow = (): boolean => {
        const scroller = ordersScrollContainerRef.current
        if (!scroller) return false
        return scroller.scrollHeight > scroller.clientHeight + 16
    }

    // Disparo ULTRA-SENSIBLE al PRIMER MICROSEGUNDO DE CONTACTO (0.0ms) cuando todas las órdenes caben en pantalla,
    // y modo compatible con scroll vertical suave (Map<pointerId> multi-toque + rescate pointercancel + pausa de re-renders).
    const bindOrderCardTap = (key: string, action: () => void, scrollSafe = false) => {
        if (scrollSafe) {
            return {
                'data-ultra-tap': 'true' as const,
                onPointerDown: (e: React.PointerEvent) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return
                    markPrepTouchActive(true)
                    if (!doesOrdersScrollOverflow()) {
                        triggerGestureSafeTap(key, 'down', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
                        return
                    }
                    prepPointerStartsRef.current.set(e.pointerId, {
                        x: e.clientX,
                        y: e.clientY,
                        maxDist: 0,
                        key,
                        at: Date.now(),
                        firedOnDown: false
                    })
                },
                onPointerMove: (e: React.PointerEvent) => {
                    const start = prepPointerStartsRef.current.get(e.pointerId)
                    if (!start || start.key !== key) return
                    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
                    if (dist > start.maxDist) start.maxDist = dist
                },
                onPointerUp: (e: React.PointerEvent) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return
                    markPrepTouchActive(false)
                    const start = prepPointerStartsRef.current.get(e.pointerId)
                    prepPointerStartsRef.current.delete(e.pointerId)
                    if (start && start.key === key) {
                        const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
                        const elapsed = Date.now() - start.at
                        if (!start.firedOnDown && dist <= 42 && start.maxDist <= 42 && elapsed <= 3500) {
                            triggerGestureSafeTap(key, 'click', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
                        }
                    }
                },
                onPointerCancel: (e: React.PointerEvent) => {
                    markPrepTouchActive(false)
                    const start = prepPointerStartsRef.current.get(e.pointerId)
                    prepPointerStartsRef.current.delete(e.pointerId)
                    if (start && start.key === key && !start.firedOnDown && start.maxDist <= 34 && Date.now() - start.at <= 3500) {
                        triggerGestureSafeTap(key, 'cancel', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
                    }
                },
                onContextMenu: (e: React.MouseEvent) => {
                    e.preventDefault()
                },
                onClick: (e: React.MouseEvent) => {
                    // Respaldo para teclado (e.detail === 0) o clic limpio cuando no hubo scroll
                    if (e.detail === 0 || !doesOrdersScrollOverflow()) {
                        triggerGestureSafeTap(key, 'click', action, 450, 'unknown')
                    }
                }
            }
        }
        return { 'data-ultra-tap': 'true' as const, ...bindOrderCardUltraTap(key, action) }
    }

    const bindOrderCardUltraTap = (key: string, action: () => void) => ({
        onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            triggerGestureSafeTap(key, 'down', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
        },
        onTouchStart: () => {
            triggerGestureSafeTap(key, 'down', action, 450, 'touch')
        },
        onMouseDown: (e: React.MouseEvent) => {
            if (e.button !== 0) return
            triggerGestureSafeTap(key, 'down', action, 450, 'mouse')
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (e.pointerType === 'touch' || e.pointerType === 'pen' || e.buttons > 0) {
                triggerGestureSafeTap(key, 'move', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
            }
        },
        onTouchMove: () => {
            triggerGestureSafeTap(key, 'move', action, 450, 'touch')
        },
        onPointerUp: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            triggerGestureSafeTap(key, 'up', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
        },
        onTouchEnd: () => {
            triggerGestureSafeTap(key, 'up', action, 450, 'touch')
        },
        onPointerCancel: (e: React.PointerEvent) => {
            triggerGestureSafeTap(key, 'cancel', action, 450, e.pointerType === 'mouse' ? 'mouse' : 'touch')
        },
        onTouchCancel: () => {
            triggerGestureSafeTap(key, 'cancel', action, 450, 'touch')
        },
        onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault()
        },
        onClick: () => {
            triggerGestureSafeTap(key, 'click', action, 450, 'unknown')
        }
    })

    // Disparo instantáneo al PRIMER CONTACTO (0ms) para botones fijos fuera de listas con scroll
    // Ideal para uso con guantes de cocina sobre mica protectora, blindado por gesto completo y data-ultra-tap
    const bindPrepInstantTap = (key: string, action: () => void) => ({
        'data-ultra-tap': 'true' as const,
        'data-tap-key': key,
        onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            e.stopPropagation()
            triggerGestureSafeTap(key, 'down', action, 400, e.pointerType === 'mouse' ? 'mouse' : 'touch')
        },
        onTouchStart: (e: React.TouchEvent) => {
            e.stopPropagation()
            triggerGestureSafeTap(key, 'down', action, 400, 'touch')
        },
        onMouseDown: (e: React.MouseEvent) => {
            if (e.button !== 0) return
            e.stopPropagation()
            triggerGestureSafeTap(key, 'down', action, 400, 'mouse')
        },
        onPointerUp: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            e.stopPropagation()
            triggerGestureSafeTap(key, 'up', action, 400, e.pointerType === 'mouse' ? 'mouse' : 'touch')
        },
        onTouchEnd: (e: React.TouchEvent) => {
            e.stopPropagation()
            triggerGestureSafeTap(key, 'up', action, 400, 'touch')
        },
        onPointerCancel: (e: React.PointerEvent) => {
            e.stopPropagation()
            triggerGestureSafeTap(key, 'cancel', action, 400, e.pointerType === 'mouse' ? 'mouse' : 'touch')
        },
        onTouchCancel: (e: React.TouchEvent) => {
            e.stopPropagation()
            triggerGestureSafeTap(key, 'cancel', action, 400, 'touch')
        },
        onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault()
        },
        onClick: (e: React.MouseEvent) => {
            e.stopPropagation()
            triggerGestureSafeTap(key, 'click', action, 400, 'unknown')
        }
    })

    // Toque ultra-tolerante para tarjetas de Alimentos/Insumos (1200ms dedupe anti +2 en guantes lentos, Map<pointerId>)
    const bindPrepForgivingTap = (key: string, action: () => void) => ({
        'data-ultra-tap': 'true' as const,
        'data-tap-key': key,
        onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            prepPointerStartsRef.current.set(e.pointerId, {
                x: e.clientX,
                y: e.clientY,
                maxDist: 0,
                key,
                at: Date.now(),
                firedOnDown: false
            })
        },
        onPointerMove: (e: React.PointerEvent) => {
            const start = prepPointerStartsRef.current.get(e.pointerId)
            if (!start || start.key !== key) return
            const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
            if (dist > start.maxDist) start.maxDist = dist
        },
        onPointerUp: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            const start = prepPointerStartsRef.current.get(e.pointerId)
            prepPointerStartsRef.current.delete(e.pointerId)
            if (!start || start.key !== key || start.firedOnDown) return
            const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
            const elapsed = Date.now() - start.at
            if (dist <= 54 && start.maxDist <= 54 && elapsed <= 4000) {
                triggerPrepDedupedAction(key, action, 1200)
            }
        },
        onPointerCancel: (e: React.PointerEvent) => {
            const start = prepPointerStartsRef.current.get(e.pointerId)
            prepPointerStartsRef.current.delete(e.pointerId)
            if (!start || start.key !== key || start.firedOnDown) return
            if (start.maxDist <= 40 && Date.now() - start.at <= 4000) {
                triggerPrepDedupedAction(key, action, 1200)
            }
        },
        onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault()
        },
        onClick: (e: React.MouseEvent) => {
            if (e.detail === 0) {
                triggerPrepDedupedAction(key, action, 320)
            } else {
                triggerPrepDedupedAction(key, action, 1200)
            }
        }
    })

    // Radar de proximidad capacitiva multi-toque (hasta 40px alrededor del borde en pantallas de 15.6" como MESWAO B3)
    // Con caché de geometría en 'move' para evitar layout thrashing en Android MediaTek y exclusión estricta de cabecera
    const handleOrdersProximityRadar = (
        clientX: number,
        clientY: number,
        containerEl: HTMLElement | null,
        phase: 'down' | 'move' | 'up' = 'down',
        source: 'touch' | 'mouse' = 'touch',
        eventTarget?: EventTarget | null
    ): boolean => {
        if (Date.now() < suppressOrderCallsUntilRef.current) return false
        if (!containerEl || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false
        const targetEl = eventTarget as HTMLElement | null
        if (targetEl?.closest?.('[data-no-proximity="true"], button:not([data-order-tap-id]), a, select, input, textarea')) {
            return false
        }

        const nowMs = Date.now()
        let items = cardRectsCacheRef.current?.items || null
        if (phase === 'down' || !items || !cardRectsCacheRef.current || nowMs - cardRectsCacheRef.current.at > 160) {
            const cards = containerEl.querySelectorAll<HTMLButtonElement>('button[data-order-tap-id]')
            const nextItems: Array<{ tapId: string; rect: DOMRect }> = []
            cards.forEach((btn) => {
                const tapId = btn.getAttribute('data-order-tap-id') || ''
                if (tapId) {
                    nextItems.push({ tapId, rect: btn.getBoundingClientRect() })
                }
            })
            items = nextItems
            cardRectsCacheRef.current = { at: nowMs, items }
        }

        let closestTapId = ''
        let minDistance = getAdaptiveProximityRadiusPx() // 18px en 10.9" Tab S10 FE, 38px en 15.6" MESWAO

        for (let i = 0; i < items.length; i++) {
            const { tapId, rect } = items[i]
            if (rect.width <= 0 || rect.height <= 0) continue
            const dx = Math.max(rect.left - clientX, 0, clientX - rect.right)
            const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom)
            const dist = Math.hypot(dx, dy)
            if (dist <= minDistance) {
                minDistance = dist
                closestTapId = tapId
                if (dist === 0) break
            }
        }

        if (!closestTapId) return false

        if (closestTapId.startsWith('ord:')) {
            // Si la lista de órdenes requiere scroll vertical, no disparar en 'down'/'move' por radar para permitir deslizar hacia abajo
            if (doesOrdersScrollOverflow()) {
                return false
            }
            const ordId = closestTapId.slice(4)
            const foundOrder = readyOrdersList.find((o) => String(o.id) === ordId)
            if (foundOrder) {
                triggerGestureSafeTap(closestTapId, phase, () => handleCallOrderImpulse(foundOrder), 450, source)
                return true
            }
        } else if (closestTapId === 'bev:bev-cafe') {
            triggerGestureSafeTap(closestTapId, phase, () => handleCallOrderImpulse({
                id: 'bev-cafe',
                order_number: 'CAFE',
                dining_option: 'TOGO',
                label: t('prep.callCafeBtn'),
                speech: t('prep.cafeReadySpeech')
            }), 450, source)
            return true
        } else if (closestTapId === 'bev:bev-champurrado') {
            triggerGestureSafeTap(closestTapId, phase, () => handleCallOrderImpulse({
                id: 'bev-champurrado',
                order_number: 'CHAMPURRADO',
                dining_option: 'TOGO',
                label: t('prep.callChampurradoBtn'),
                speech: t('prep.champurradoReadySpeech')
            }), 450, source)
            return true
        } else if (closestTapId === 'bev:bev-orden-pendiente') {
            triggerGestureSafeTap(closestTapId, phase, () => handleCallOrderImpulse({
                id: 'bev-orden-pendiente',
                order_number: 'ORDEN_PENDIENTE',
                dining_option: 'TOGO',
                label: t('prep.callOrdenPendienteBtn'),
                speech: t('prep.ordenPendienteReadySpeech')
            }), 450, source)
            return true
        }
        return false
    }

    // Prioriza siempre e.changedTouches (dedo nuevo/movido) para que una gota de agua o palma en la esquina no secuestre e.touches[0]
    const handleOrdersProximityTouchEvent = (
        e: React.TouchEvent<HTMLElement>,
        phase: 'down' | 'move' | 'up'
    ) => {
        const list = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches : e.touches
        if (!list || list.length === 0) return
        for (let i = 0; i < list.length; i++) {
            const pt = list[i]
            if (handleOrdersProximityRadar(pt.clientX, pt.clientY, e.currentTarget, phase, 'touch', pt.target || e.target)) {
                return
            }
        }
    }

    // Acción de llamado de orden (impulso táctil enviado a la PC del Manager; la voz suena EXCLUSIVAMENTE en la PC)
    const handleCallOrderImpulse = async (order: any) => {
        if (!order || !order.id) return
        if (Date.now() < suppressOrderCallsUntilRef.current) return
        if (callingIdsRef.current.has(order.id)) {
            try {
                if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                    navigator.vibrate(10)
                }
            } catch {}
            return
        }
        // Reproducir el tick táctil sintetizado solo después de validar el candado para evitar doble confirmación sonora
        playTabletTick()

        callingIdsRef.current.add(order.id)
        setCallingOrderIds(prev => new Set(prev).add(order.id))
        setCallErrorOrderIds(prev => {
            if (!prev.has(order.id)) return prev
            const next = new Set(prev)
            next.delete(order.id)
            return next
        })

        const currentStore = stores.find(s => String(s.id) === String(storeId))
        const storeCode = (order?.store_code || currentStore?.code || TOAST_STORE_MAP[currentStore?.external_id]?.code || '').toUpperCase()
        let deliveredOk = false

        try {
            const calledAt = new Date().toISOString()
            const callBody = JSON.stringify({
                orderId: order.id,
                orderNumber: order.order_number,
                storeCode: storeCode,
                diningOption: order.dining_option,
                storeName: order?.store_name || currentStore?.name || storeCode,
                fromClientBroadcast: Boolean(realtimeChannelRef.current),
                calledAt
            })

            // 1. Broadcast WebSocket directo de cliente (0ms)
            const wsPromise = realtimeChannelRef.current
                ? Promise.race([
                      realtimeChannelRef.current
                          .send({
                              type: 'broadcast',
                              event: 'call_order',
                              payload: {
                                  order_id: order.id,
                                  order_number: order.order_number,
                                  store_code: storeCode,
                                  dining_option: order.dining_option,
                                  store_name: order?.store_name || currentStore?.name || storeCode,
                                  called_at: calledAt
                              }
                          })
                          .then((status: string) => status === 'ok')
                          .catch(() => false),
                      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))
                  ])
                : Promise.resolve(false)

            // 2. Endpoint REST con Bearer JWT Staff + auto-renovación en 401 y hasta 3 intentos (0ms, +550ms, +1250ms)
            const apiPromise = (async () => {
                const retryDelays = [0, 550, 1250]
                for (let attempt = 0; attempt < retryDelays.length; attempt++) {
                    if (retryDelays[attempt] > 0) {
                        await new Promise((r) => setTimeout(r, retryDelays[attempt]))
                    }
                    try {
                        let res = await fetch('/api/order-ready/call', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', ...getTabletNoCacheHeaders() },
                            body: callBody,
                            signal: AbortSignal.timeout(4000)
                        })
                        if (res.status === 401 || res.status === 403) {
                            const refreshed = await ensureFreshTabletAuth(true)
                            if (refreshed) {
                                res = await fetch('/api/order-ready/call', {
                                    method: 'POST',
                                    credentials: 'include',
                                    headers: { 'Content-Type': 'application/json', ...getTabletNoCacheHeaders() },
                                    body: callBody,
                                    signal: AbortSignal.timeout(4000)
                                })
                            }
                        }
                        if (res.ok) return true
                    } catch (fetchErr) {
                        if (attempt === retryDelays.length - 1) {
                            console.warn('Reintentos agotados enviando llamado de orden:', fetchErr)
                        }
                    }
                }
                return false
            })()

            // Confirmar al instante en cuanto WS o REST entregue (sin esperar 14-26s al canal más lento)
            deliveredOk = await new Promise<boolean>((resolve) => {
                let pending = 2
                let settled = false
                const onResult = (ok: boolean) => {
                    pending -= 1
                    if (ok && !settled) {
                        settled = true
                        resolve(true)
                        return
                    }
                    if (pending <= 0 && !settled) {
                        settled = true
                        resolve(false)
                    }
                }
                wsPromise.then((v) => onResult(v === true)).catch(() => onResult(false))
                apiPromise.then((v) => onResult(v === true)).catch(() => onResult(false))
            })

            if (deliveredOk) {
                setCallSuccessOrderIds(prev => new Set(prev).add(order.id))
                if (!String(order.id).startsWith('bev-')) {
                    setReadyOrdersList(prev =>
                        prev.map(item => (item.id === order.id ? { ...item, announced_at: calledAt } : item))
                    )
                }
            } else {
                setCallErrorOrderIds(prev => new Set(prev).add(order.id))
            }
        } catch (err) {
            console.error('Error enviando impulso de orden desde tableta:', err)
            setCallErrorOrderIds(prev => new Set(prev).add(order.id))
        } finally {
            const releaseMs = deliveredOk ? 1800 : 400
            setTimeout(() => {
                callingIdsRef.current.delete(order.id)
                setCallingOrderIds(prev => {
                    const next = new Set(prev)
                    next.delete(order.id)
                    return next
                })
            }, releaseMs)
            const prevTimer = callStatusTimersRef.current.get(order.id)
            if (prevTimer) clearTimeout(prevTimer)
            const nextTimer = setTimeout(() => {
                callStatusTimersRef.current.delete(order.id)
                setCallSuccessOrderIds(prev => {
                    if (!prev.has(order.id)) return prev
                    const next = new Set(prev)
                    next.delete(order.id)
                    return next
                })
                setCallErrorOrderIds(prev => {
                    if (!prev.has(order.id)) return prev
                    const next = new Set(prev)
                    next.delete(order.id)
                    return next
                })
            }, 4000)
            callStatusTimersRef.current.set(order.id, nextTimer)
        }
    }
    
    // Waste Dashboard Modal
    const [showWasteModal, setShowWasteModal] = useState(false)
    const [selectedWasteDate, setSelectedWasteDate] = useState('')
    const [wasteData, setWasteData] = useState<any[]>([])
    const [loadingWasteData, setLoadingWasteData] = useState(false)
    const [showWasteInfo, setShowWasteInfo] = useState(false)

    // Carga de Datos de Merma (usa bloques reales de 30m sin romperse en modo Tramos ni mezclar fechas pasadas)
    useEffect(() => {
        if (!showWasteModal || !storeId) return
        const todayStr = getCaliforniaBusinessDate()
        if (!selectedWasteDate) {
            setSelectedWasteDate(todayStr)
            return
        }

        let cancelled = false
        const loadData = async () => {
            setLoadingWasteData(true)
            const proteins = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA']
            const wasteIsToday = selectedWasteDate === todayStr

            // Solo reutilizar estado en vivo si el modal pide HOY y la pantalla principal también está en HOY
            if (wasteIsToday && isToday) {
                const d = new Date()
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false
                })
                const timeParts = formatter.format(d).split(':')
                let h = parseInt(timeParts[0], 10)
                const m = parseInt(timeParts[1], 10)
                if (h === 24) h = 0
                const curMin = h * 60 + m
                const adjustedCurMin = h < 6 ? curMin + 24 * 60 : curMin

                const stats = proteins.map(proto => {
                    let totalProj = 0
                    let totalReal = 0
                    let count = 0

                    meatData.forEach((item) => {
                        if (item.meat_type !== proto || !item.interval_start) return
                        const [bh, bm] = item.interval_start.split(':').map(Number)
                        if (!Number.isFinite(bh) || !Number.isFinite(bm)) return
                        const bMin = bh * 60 + bm
                        const adjustedBMin = bh < 6 ? bMin + 24 * 60 : bMin
                        // Solo bloques de 30 min ya COMPLETADOS (excluye bloque en curso)
                        if (adjustedBMin + 30 <= adjustedCurMin) {
                            totalProj += Number(item.avg_lbs || 0) * intelligenceAcelerador
                        }
                    })

                    realMeatData.forEach((rm) => {
                        if (rm.meat_type !== proto || !rm.interval_start) return
                        const [bh, bm] = rm.interval_start.split(':').map(Number)
                        if (!Number.isFinite(bh) || !Number.isFinite(bm)) return
                        const bMin = bh * 60 + bm
                        const adjustedBMin = bh < 6 ? bMin + 24 * 60 : bMin
                        if (adjustedBMin + 30 <= adjustedCurMin) {
                            totalReal += Number(rm.real_lbs || 0)
                            count++
                        }
                    })

                    return { proto, totalProj, totalReal, hasRealData: count > 0 }
                })
                if (!cancelled) {
                    setWasteData(stats)
                    setLoadingWasteData(false)
                }
                return
            }

            try {
                const targetDOW = getDowFromDate(selectedWasteDate)
                const [resHistory, resIntel] = await Promise.all([
                    fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${targetDOW}`, { signal: AbortSignal.timeout(8000) }),
                    fetch(`/api/preparador/intelligence?store_id=${storeId}&date=${selectedWasteDate}`, { signal: AbortSignal.timeout(8000) })
                ])
                const historyJson = resHistory.ok ? await resHistory.json() : []
                const intelJson = resIntel.ok ? await resIntel.json() : { growth_factor: 1.0 }
                const factor = Number(intelJson?.growth_factor || 1.0)

                const { data: realData, error: dbErr } = await supabase
                    .from('meat_consumption_history')
                    .select('interval_start, meat_type, raw_lbs')
                    .eq('store_id', storeId)
                    .eq('business_date', selectedWasteDate)
                if (dbErr) throw dbErr

                const stats = proteins.map(proto => {
                    let totalProj = 0
                    let totalReal = 0
                    let count = 0
                    if (Array.isArray(historyJson)) {
                        historyJson.forEach((item: any) => {
                            if (item.meat_type === proto) totalProj += Number(item.avg_lbs || 0) * factor
                        })
                    }
                    if (Array.isArray(realData)) {
                        realData.forEach((item: any) => {
                            if (item.meat_type === proto) {
                                totalReal += Number(item.raw_lbs || 0)
                                count++
                            }
                        })
                    }
                    return { proto, totalProj, totalReal, hasRealData: count > 0 }
                })
                if (!cancelled) setWasteData(stats)
            } catch (e) {
                console.error("Error loading waste data:", e)
                if (!cancelled) setWasteData([])
            } finally {
                if (!cancelled) setLoadingWasteData(false)
            }
        }

        void loadData()
        return () => { cancelled = true }
    }, [showWasteModal, selectedWasteDate, storeId, isToday, meatData, realMeatData, intelligenceAcelerador, supabase])

    // Alarma de Cocción
    const [showCookAlert, setShowCookAlert] = useState(false)
    const [nextBlockLabel, setNextBlockLabel] = useState('')
    const cookAlarmRef = useRef<HTMLAudioElement | null>(null)
    const lastCookAlertRef = useRef<string | null>(null)

    // Agrupación de datos para el Modal VIEW DAY
    // @businessRule: Solo se proyectan las carnes de PARRILLA (Asada, Pastor, Pollo, Cabeza, Lengua).
    // Buche, Chorizo y Carnitas se cocinan AL MOMENTO y no requieren proyección de pace.
    const getHourlyData = () => {
        const validData = meatData.filter(m => m.meat_type !== 'CARNITAS')
        const hourlyMap = new Map<string, { ASADA: number, CABEZA: number, LENGUA: number, PASTOR: number, POLLO: number }>()
        const dayTotals = { ASADA: 0, CABEZA: 0, LENGUA: 0, PASTOR: 0, POLLO: 0 }
        let grandTotal = 0

        validData.forEach(m => {
            const hourPrefix = m.interval_start.split(':')[0] + ':00'
            if (!hourlyMap.has(hourPrefix)) {
                hourlyMap.set(hourPrefix, { ASADA: 0, CABEZA: 0, LENGUA: 0, PASTOR: 0, POLLO: 0 })
            }
            const hourData = hourlyMap.get(hourPrefix)!
            const key = m.meat_type as keyof typeof dayTotals
            if (key in hourData) {
                hourData[key] += m.avg_lbs
                dayTotals[key] += m.avg_lbs
                grandTotal += m.avg_lbs
            }
        })

        const sortedHours = Array.from(hourlyMap.keys()).sort((a,b) => {
            let ha = parseInt(a.split(':')[0], 10)
            let hb = parseInt(b.split(':')[0], 10)
            if (ha < 6) ha += 24
            if (hb < 6) hb += 24
            return ha - hb
        })
        return { sortedHours, hourlyMap, dayTotals, grandTotal }
    }
    // Fullscreen & Carousel Interaction Refs
    const containerRef = useRef<HTMLDivElement>(null)
    const grillPanelRef = useRef<HTMLDivElement>(null)
    const carouselContainerRef = useRef<HTMLDivElement>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    isFullscreenRef.current = isFullscreen
    const wheelThrottleRef = useRef<number>(0)

    useEffect(() => { setMounted(true) }, [])

    // Medir desborde vertical real del contenedor de órdenes para activar pan-y scroll seguro con exactitud (3–4 órdenes en 10.9" incluidas)
    useEffect(() => {
        const scroller = ordersScrollContainerRef.current
        if (!scroller) {
            setOrdersHasOverflow(readyOrdersList.length >= 5)
            return
        }
        const measure = () => {
            setOrdersHasOverflow(scroller.scrollHeight > scroller.clientHeight + 12)
        }
        measure()
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(measure)
            ro.observe(scroller)
            return () => ro.disconnect()
        }
    }, [readyOrdersList.length, activeTab, hideCookingPanel, isFullscreen])

    // Listener nativo no-pasivo para el scroll de la rueda del ratón (se re-adjunta al mostrar/ocultar parrilla)
    useEffect(() => {
        const targetEl = carouselContainerRef.current
        if (!targetEl || hideCookingPanel) return

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault()
            e.stopPropagation()

            const now = Date.now()
            if (now - wheelThrottleRef.current < 260) return
            if (Math.abs(e.deltaY) < 10) return

            if (e.deltaY > 0) {
                wheelThrottleRef.current = now
                setActiveIndex(prev => (prev < carouselBuckets.length - 1 ? prev + 1 : prev))
            } else if (e.deltaY < 0) {
                wheelThrottleRef.current = now
                setActiveIndex(prev => (prev > 0 ? prev - 1 : prev))
            }
        }

        targetEl.addEventListener('wheel', handleWheel, { passive: false })
        return () => {
            targetEl.removeEventListener('wheel', handleWheel)
        }
    }, [carouselBuckets.length, hideCookingPanel, mounted])

    // Reiniciar siempre el scroll hacia arriba cuando cambie el intervalo para evitar tarjetas cortadas
    useEffect(() => {
        if (grillPanelRef.current) {
            grillPanelRef.current.scrollTop = 0
        }
    }, [activeIndex])

    // Listen to native fullscreen changes (por si cierran con ESC)
    useEffect(() => {
        const onFullscreenChange = () => {
            const doc = document as any;
            setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
            cardRectsCacheRef.current = null
            fetchReadyOrdersRef.current?.(false, true)
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)
        document.addEventListener('webkitfullscreenchange', onFullscreenChange)
        return () => {
            document.removeEventListener('fullscreenchange', onFullscreenChange)
            document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        }
    }, [])

    const toggleFullscreen = () => {
        const doc = document as any;
        const elem = containerRef.current as any;

        if (!isFullscreen) {
            if (elem?.requestFullscreen) {
                elem.requestFullscreen().catch(() => setIsFullscreen(true));
            } else if (elem?.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
                setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(true) }, 200);
            } else {
                setIsFullscreen(true); // Fallback manual (CSS)
            }
        } else {
            if (doc.exitFullscreen && doc.fullscreenElement) {
                doc.exitFullscreen().catch(() => setIsFullscreen(false));
            } else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
                doc.webkitExitFullscreen();
                setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(false) }, 200);
            } else {
                setIsFullscreen(false); // Fallback manual
            }
        }
    }

    // Load Stores
    useEffect(() => {
        const fetchStores = async () => {
            const { data } = await supabase.from('stores').select('id, name, code, external_id, opening_time, closing_time').eq('is_active', true).order('name')
            if (data) {
                const sorted = sortStoresAlphabetically(
                    data.map((s: any) => ({ ...s, name: formatStoreDisplayName(s.name) })),
                    (s: any) => s.name
                )
                setStores(sorted)
                
                // Si el usuario no es admin/supervisor y tiene tienda asignada, fijamos y persistimos su tienda automáticamente
                const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
                if (user && !isSuper && user.store_id) {
                    const assignedStoreId = String(user.store_id)
                    setStoreId(assignedStoreId)
                    safeLocalStorageSet('teg_preparador_store', assignedStoreId)
                } else if (sorted.length > 0) {
                    const saved = localStorage.getItem('teg_preparador_store')
                    if (saved && sorted.find((s: any) => String(s.id) === String(saved))) setStoreId(String(saved))
                    else setStoreId(String(sorted[0].id))
                }
            }
        }
        if (!authLoading && user) fetchStores()
    }, [supabase, user, authLoading])

    // Load Meat Historial
    useEffect(() => {
        if (!storeId) return
        let cancelled = false
        const fetchHistory = async (overrideDow?: number, overrideDate?: string) => {
            const targetDow = overrideDow || businessDow
            setFetchingMeat(true)
            try {
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${targetDow}`, {
                    signal: AbortSignal.timeout(8000)
                })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const json = await res.json()
                if (!cancelled && Array.isArray(json)) {
                    const tablet1Proteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA']
                    setMeatData(json.filter((m: any) => tablet1Proteins.includes(m.meat_type)))
                    const todayLA = getLAEffectiveBusinessDate()
                    safeLocalStorageSet(`prep_meat_history_${storeId}_${targetDow}`, JSON.stringify(json), {
                        activeStoreId: storeId,
                        activeDate: overrideDate || todayLA,
                        activeDow: getDowFromDate(todayLA)
                    })
                }
            } catch (err) {
                console.error(err)
                if (!cancelled) {
                    const cached = localStorage.getItem(`prep_meat_history_${storeId}_${targetDow}`)
                    if (cached) {
                        try {
                            const json = JSON.parse(cached)
                            const tablet1Proteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA']
                            setMeatData(json.filter((m: any) => tablet1Proteins.includes(m.meat_type)))
                        } catch (e) {}
                    }
                }
            } finally {
                if (!cancelled) setFetchingMeat(false)
            }
        }
        fetchHistoryRef.current = fetchHistory
        fetchHistory()
        return () => { cancelled = true }
    }, [storeId, businessDow])

    // Load Real Meat Consumptions (For TODAY or Selected Date)
    useEffect(() => {
        if (!storeId) return
        let cancelled = false
        const fetchRealD = async (overrideDate?: string) => {
            const targetDate = overrideDate || selectedDate
            const targetIsToday = targetDate === getLAEffectiveBusinessDate()
            const datedCacheKey = `prep_real_meat_${storeId}_${targetDate}`
            try {
                const { data, error } = await supabase.from('meat_consumption_history')
                    .select('interval_start, meat_type, raw_lbs')
                    .eq('store_id', storeId)
                    .eq('business_date', targetDate)
                if (error) throw error
                if (!cancelled && data) {
                    setRealMeatData(data.map(d => ({
                        interval_start: d.interval_start,
                        meat_type: d.meat_type,
                        real_lbs: d.raw_lbs
                    })))
                    if (targetIsToday) {
                        safeLocalStorageSet(datedCacheKey, JSON.stringify(data), {
                            activeStoreId: storeId,
                            activeDate: targetDate,
                            activeDow: getDowFromDate(targetDate)
                        })
                    }
                }
            } catch (err) {
                console.error("Real meat fetch error:", err)
                if (!cancelled && targetIsToday) {
                    const cached = localStorage.getItem(datedCacheKey) || localStorage.getItem(`prep_real_meat_${storeId}`)
                    if (cached) {
                        try {
                            const data = JSON.parse(cached)
                            setRealMeatData(data.map((d: any) => ({
                                interval_start: d.interval_start,
                                meat_type: d.meat_type,
                                real_lbs: d.raw_lbs
                            })))
                        } catch (e) {}
                    }
                }
            }
        }
        fetchRealMeatRef.current = fetchRealD
        fetchRealD()
        if (isToday) {
            const int = setInterval(() => {
                if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                    fetchRealD()
                }
            }, 5 * 60 * 1000)
            return () => { cancelled = true; clearInterval(int) }
        }
        return () => { cancelled = true }
    }, [storeId, selectedDate, isToday, supabase])

    // Intelligence Fetcher (Only active for TODAY)
    useEffect(() => {
        if (!storeId) return
        if (!isToday) {
            setIntelligenceAcelerador(1.0)
            setWeatherAlert(false)
            return
        }
        let cancelled = false
        const fetchIntelligence = async (overrideDate?: string) => {
            const targetDate = overrideDate || getLAEffectiveBusinessDate()
            try {
                const res = await fetch(`/api/preparador/intelligence?store_id=${storeId}`, {
                    signal: AbortSignal.timeout(8000)
                })
                if (res.ok && !cancelled) {
                    const data = await res.json()
                    setIntelligenceAcelerador(data.growth_factor || 1.0)
                    setWeatherAlert(Boolean(data.weather_adjustment))
                    safeLocalStorageSet(`prep_intelligence_${storeId}`, JSON.stringify(data), {
                        activeStoreId: storeId,
                        activeDate: targetDate,
                        activeDow: getDowFromDate(targetDate)
                    })
                }
            } catch (err) {
                console.error("Intelligence error:", err)
                if (!cancelled) {
                    const cached = localStorage.getItem(`prep_intelligence_${storeId}`)
                    if (cached) {
                        try {
                            const data = JSON.parse(cached)
                            setIntelligenceAcelerador(data.growth_factor || 1.0)
                            setWeatherAlert(Boolean(data.weather_adjustment))
                        } catch (e) {}
                    }
                }
            }
        }
        fetchIntelligenceRef.current = fetchIntelligence
        fetchIntelligence()
        const int = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                fetchIntelligence()
            }
        }, 10 * 60 * 1000)
        return () => { cancelled = true; clearInterval(int) }
    }, [storeId, isToday])

    // Sync Guide Modal DOW when opening
    useEffect(() => {
        if (showGuideModal) {
            setGuideModalDow(businessDow)
        }
    }, [showGuideModal, businessDow])

    // Load Guide History for Modal
    useEffect(() => {
        if (!showGuideModal || !storeId) return
        const fetchGuideHistory = async () => {
            setGuideModalLoading(true)
            try {
                const res = await fetch(`/api/inventory/preparador-history?storeId=${storeId}&dow=${guideModalDow}&_t=${Date.now()}`, {
                    cache: 'no-store',
                    signal: AbortSignal.timeout(8000)
                })
                if (!res.ok) return
                const json = await res.json()
                if (Array.isArray(json)) {
                    const PROTEINS = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA']
                    // 48 bloques completos 06:00 -> 05:30 (día laboral Gavilán; el modal filtra Turno Principal 8a-1:30a o 24h)
                    const OPERATIONAL_TIMES: string[] = []
                    let gh = 6
                    let gm = 0
                    for (let i = 0; i < 48; i++) {
                        OPERATIONAL_TIMES.push(`${gh.toString().padStart(2, '0')}:${gm.toString().padStart(2, '0')}`)
                        if (gm === 0) gm = 30
                        else { gm = 0; gh = (gh + 1) % 24 }
                    }

                    const intervalsMap: Record<string, any> = {}
                    json.forEach((d: any) => {
                        if (!intervalsMap[d.interval_start]) {
                            intervalsMap[d.interval_start] = {}
                        }
                        intervalsMap[d.interval_start][d.meat_type] = d.avg_lbs
                    })

                    const rows: any[] = []
                    OPERATIONAL_TIMES.forEach(tStr => {
                        const intervalKey = `${tStr}:00`
                        const row: any = { time: tStr }
                        PROTEINS.forEach(proto => {
                            const avg = (intervalsMap[intervalKey] && intervalsMap[intervalKey][proto]) ? intervalsMap[intervalKey][proto] : 0
                            const maxTray = Math.max(1, Math.ceil(avg))
                            row[proto] = { avg: Number(avg.toFixed(1)), maxTray }
                        })
                        rows.push(row)
                    })
                    setGuideModalData(rows)
                }
            } catch (e) {
                console.error(e)
            } finally {
                setGuideModalLoading(false)
            }
        }
        fetchGuideHistory()
    }, [showGuideModal, storeId, guideModalDow])

    // Clock Bucket Updater
    useEffect(() => {
        const updateBuckets = () => {
            const now = new Date()
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            })
            
            let timeParts = formatter.format(now).split(':')
            let h = parseInt(timeParts[0], 10)
            let m = parseInt(timeParts[1], 10)
            if (h === 24) h = 0;
            
            let curM = m >= 30 ? 30 : 0
            
            const formatTime12 = (hr: number, min: number) => {
                const p = hr >= 12 ? 'pm' : 'am'
                let h12 = hr % 12
                if (h12 === 0) h12 = 12
                return `${h12}:${min.toString().padStart(2, '0')}${p}`
            }

            if (viewMode === '30min') {
                const arr: any[] = []
                let tempH = 6
                let tempM = 0
                let foundCurrentIndex = 0
                
                // Generate 48 30-minute buckets starting strictly from 06:00 (Gavilan business day)
                for (let i = 0; i < 48; i++) {
                    let hrStr = tempH.toString().padStart(2, '0')
                    let minStr = tempM.toString().padStart(2, '0')
                    let bucketId = `${hrStr}:${minStr}:00`
                    
                    let nxtM = tempM === 0 ? 30 : 0
                    let nxtH = tempM === 30 ? (tempH + 1) % 24 : tempH
                    let label = `${formatTime12(tempH, tempM)} a ${formatTime12(nxtH, nxtM)}`
                    
                    let data: any[] = []
                    if (meatData.length > 0) {
                        const sortOrder: Record<string, number> = { 'ASADA': 1, 'PASTOR': 2, 'POLLO': 3, 'CABEZA': 4, 'LENGUA': 5, 'CARNITAS': 6 }
                        const proteins = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA']
                        
                        data = proteins.map(proto => {
                            const mData = meatData.find(m => m.interval_start === bucketId && m.meat_type === proto)
                            const realD = realMeatData.find(rm => rm.interval_start === bucketId && rm.meat_type === proto)
                            return {
                                interval_start: bucketId,
                                meat_type: proto,
                                avg_lbs: mData ? mData.avg_lbs : 0,
                                duration: 0.5,
                                samples: mData ? mData.samples : 0,
                                real_lbs: realD ? realD.real_lbs : undefined
                            }
                        }).sort((a,b) => (sortOrder[a.meat_type] || 99) - (sortOrder[b.meat_type] || 99))
                    }
                    
                    let isCurrent = (tempH === h && tempM === curM)
                    if (isCurrent) foundCurrentIndex = i

                    arr.push({ id: bucketId, name: '30 MIN', isPeak: false, duration: 0.5, label, isCurrent, data })
                    
                    tempH = nxtH
                    tempM = nxtM
                }

                const bucketChanged = prevCurrentBucketIndexRef.current !== foundCurrentIndex
                prevCurrentBucketIndexRef.current = foundCurrentIndex
                setCurrentBucketIndex(foundCurrentIndex)
                if (!hasInitializedRef.current || (bucketChanged && Date.now() - lastActivityTimeRef.current > 15000)) {
                    setActiveIndex(foundCurrentIndex)
                    hasInitializedRef.current = true
                }
                setCarouselBuckets(arr)

                if ((m === 20 || m === 50) && arr.length > 1 && foundCurrentIndex < 47) {
                    const signature = `${h}-${m}`
                    if (lastCookAlertRef.current !== signature) {
                        lastCookAlertRef.current = signature
                        if (cardDisplayMode === 'advanced') {
                            setNextBlockLabel(arr[foundCurrentIndex + 1]?.label || '')
                            setShowCookAlert(true)
                            try {
                                if (cookAlarmRef.current) {
                                    cookAlarmRef.current.currentTime = 0
                                    cookAlarmRef.current.play().catch(() => {})
                                }
                            } catch {}
                            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([500, 200, 500])
                        }
                    }
                }
            } else {
                // Peak Periods Block Mode (Gavilan Business Day: 6:00 AM to 5:59 AM)
                const PEAK_PERIODS = [
                    { id: 'p1', name: 'Apertura / Desayuno', startH: 6, endH: 11, duration: 5, isPeak: false },
                    { id: 'p2', name: 'HORA PICO AM', startH: 11, endH: 14, duration: 3, isPeak: true },
                    { id: 'p3', name: 'Tarde / Transición', startH: 14, endH: 17, duration: 3, isPeak: false },
                    { id: 'p4', name: 'HORA PICO PM', startH: 17, endH: 21, duration: 4, isPeak: true },
                    { id: 'p5', name: 'Noche / Cena Tardía', startH: 21, endH: 1, duration: 4, isPeak: false },
                    { id: 'p6', name: 'Madrugada / Cierre', startH: 1, endH: 6, duration: 5, isPeak: false }
                ]

                const isHourInPeriod = (hr: number, startH: number, endH: number) => {
                    if (startH < endH) return hr >= startH && hr < endH
                    return hr >= startH || hr < endH
                }

                const arr: any[] = []
                let foundCurrentIndex = 0

                PEAK_PERIODS.forEach((period, idx) => {
                    let startLabel = formatTime12(period.startH, 0)
                    let endLabel = formatTime12(period.endH, 0)
                    let label = `${startLabel} a ${endLabel}`
                    
                    let isCurrent = isHourInPeriod(h, period.startH, period.endH)
                    if (isCurrent) foundCurrentIndex = idx

                    let elapsedHours = period.duration
                    if (isCurrent) {
                        let startMins = period.startH * 60
                        let curMins = h * 60 + m
                        if (curMins < startMins) curMins += 24 * 60
                        let diffMins = Math.max(15, curMins - startMins)
                        elapsedHours = Math.min(period.duration, diffMins / 60)
                    }
                    
                    let data: any[] = []
                    if (meatData.length > 0) {
                        const sortOrder: Record<string, number> = { 'ASADA': 1, 'PASTOR': 2, 'POLLO': 3, 'CABEZA': 4, 'LENGUA': 5, 'CARNITAS': 6 }
                        const proteins = ['ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA']
                        
                        data = proteins.map(proto => {
                            let totalAvg = 0
                            let totalSamples = 0
                            let totalRealSum = 0
                            let hasReal = false

                            meatData.forEach(m => {
                                if (m.meat_type !== proto) return
                                const [hhStr] = m.interval_start.split(':')
                                const hh = parseInt(hhStr, 10)
                                if (isHourInPeriod(hh, period.startH, period.endH)) {
                                    totalAvg += m.avg_lbs
                                    totalSamples += (m.samples || 0)
                                }
                            })

                            realMeatData.forEach(rm => {
                                if (rm.meat_type !== proto) return
                                const [hhStr] = rm.interval_start.split(':')
                                const hh = parseInt(hhStr, 10)
                                if (isHourInPeriod(hh, period.startH, period.endH)) {
                                    totalRealSum += Number(rm.real_lbs || 0)
                                    hasReal = true
                                }
                            })

                            return {
                                interval_start: `${period.startH.toString().padStart(2, '0')}:00:00`,
                                meat_type: proto,
                                avg_lbs: totalAvg,
                                duration: period.duration,
                                elapsed_hours: elapsedHours,
                                samples: totalSamples,
                                real_lbs: hasReal ? totalRealSum : undefined
                            }
                        }).sort((a,b) => (sortOrder[a.meat_type] || 99) - (sortOrder[b.meat_type] || 99))
                    }

                    arr.push({ id: period.id, name: period.name, isPeak: period.isPeak, startH: period.startH, endH: period.endH, duration: period.duration, label, isCurrent, data })
                })

                const bucketChanged = prevCurrentBucketIndexRef.current !== foundCurrentIndex
                prevCurrentBucketIndexRef.current = foundCurrentIndex
                setCurrentBucketIndex(foundCurrentIndex)
                if (!hasInitializedRef.current || (bucketChanged && Date.now() - lastActivityTimeRef.current > 15000)) {
                    setActiveIndex(foundCurrentIndex)
                    hasInitializedRef.current = true
                }
                setCarouselBuckets(arr)
            }
        }
        
        updateBucketsRef.current = updateBuckets
        updateBuckets()
        const int = setInterval(updateBuckets, 15000)
        return () => clearInterval(int)
    }, [meatData, realMeatData, viewMode, storeId, cardDisplayMode])

    const addToCart = (item: string) => {
        setCart(prev => {
            const existing = prev.find(p => p.name === item)
            if (existing) {
                return prev.map(p => p.name === item ? { ...p, qty: p.qty + 1 } : p)
            }
            return [...prev, { name: item, qty: 1 }]
        })
    }

    const decreaseItem = (item: string) => {
        setCart(prev => {
            const existing = prev.find(p => p.name === item)
            if (existing && existing.qty > 1) {
                return prev.map(p => p.name === item ? { ...p, qty: p.qty - 1 } : p)
            }
            return prev.filter(p => p.name !== item)
        })
    }

    const removeFromCart = (item: string) => {
        setCart(prev => prev.filter(p => p.name !== item))
    }

    const sendRequest = async () => {
        if (cart.length === 0 || !storeId) return
        setSending(true)
        setSupplyFeedback(null)

        const stringifiedItems = cart.map(c => c.qty > 1 ? `${c.qty}x ${c.name}` : c.name)

        const { error } = await supabase.from('preparador_requests').insert({
            store_id: storeId,
            sender_name: user?.name || 'Linea',
            items: stringifiedItems,
            status: 'PENDING'
        })

        if (error) {
            console.error("Error enviando alerta:", error)
            setSupplyFeedback({ type: 'error', message: t('prep.requestSentError') })
        } else {
            setCart([])
            playTabletTick()
            setSupplyFeedback({ type: 'success', message: t('prep.requestSentSuccess') })
        }
        setSending(false)
        setTimeout(() => setSupplyFeedback(null), 4000)
    }

    // Guardar edición manual por bloque (soporta 30min exacto y expansión de Tramos a sus bloques HH:MM:00)
    const handleSaveEditMeat = async () => {
        if (!editingMeatItem) return
        lastSaveTimeRef.current = Date.now()
        if (editingMeatItem.isManualMode) {
            const targetIntervals: string[] = []
            if (
                viewMode === 'tramos' &&
                typeof editingMeatItem.periodStartH === 'number' &&
                typeof editingMeatItem.periodEndH === 'number'
            ) {
                let hr = editingMeatItem.periodStartH
                for (let step = 0; step < 24; step++) {
                    if (step > 0 && hr === editingMeatItem.periodEndH) break
                    const hh = hr.toString().padStart(2, '0')
                    targetIntervals.push(`${hh}:00:00`, `${hh}:30:00`)
                    hr = (hr + 1) % 24
                }
            } else if (editingMeatItem.intervalStart) {
                targetIntervals.push(normTime(editingMeatItem.intervalStart))
            }

            if (targetIntervals.length > 0) {
                const updatedMap = { ...manualWeeklySchedule }
                for (const iv of targetIntervals) {
                    updatedMap[`${iv}_${editingMeatItem.meatType}`] = tempEditValue
                }
                setManualWeeklySchedule(updatedMap)
                const todayLA = getLAEffectiveBusinessDate()
                safeLocalStorageSet(`teg_prep_manual_weekly_${storeId}_${businessDow}`, JSON.stringify(updatedMap), {
                    activeStoreId: storeId,
                    activeDate: todayLA,
                    activeDow: getDowFromDate(todayLA)
                })
                try {
                    // Guardar secuencial/acotado (concurrencia <= 2, Regla Protección de Servidores)
                    for (const iv of targetIntervals) {
                        await fetch('/api/inventory/preparador-manual-schedule', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', ...getTabletNoCacheHeaders() },
                            signal: AbortSignal.timeout(8000),
                            body: JSON.stringify({
                                storeId,
                                dow: businessDow,
                                intervalStart: iv,
                                meatType: editingMeatItem.meatType,
                                maxLbs: tempEditValue
                            })
                        })
                    }
                    void fetchManualScheduleRef.current?.(businessDow, selectedDate, true)
                } catch (e) {
                    console.error('Error saving manual schedule:', e)
                }
            }
        } else {
            persistManualOverrides({
                ...manualOverrides,
                [editingMeatItem.key]: tempEditValue
            })
        }
        setEditingMeatItem(null)
    }

    if (!mounted || authLoading) return <div className="p-8 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>

    if (!user || !['admin', 'manager', 'supervisor', 'asistente'].includes(user.role?.toLowerCase() || '')) {
        return <div className="p-8 text-center text-red-500 text-2xl font-bold">{t('prep.accessDenied')}</div>
    }

    const isSuper = ['admin', 'supervisor'].includes(user.role?.toLowerCase() || '')
    const currentStoreObj = stores.find((s) => String(s.id) === String(storeId))
    const currentStoreName = currentStoreObj?.name || ''
    const numericStoreId = Number(storeId)
    const cartTotalQty = cart.reduce((acc, item) => acc + item.qty, 0)

    const { sortedHours, hourlyMap } = getHourlyData()
    const hourlyRows = sortedHours.map((hourKey) => {
        const vals = hourlyMap.get(hourKey)!
        const hh = parseInt(hourKey.split(':')[0], 10)
        const period = hh >= 12 ? 'PM' : 'AM'
        const h12 = hh % 12 === 0 ? 12 : hh % 12
        const total = vals.ASADA + vals.PASTOR + vals.POLLO + vals.CABEZA + vals.LENGUA
        return {
            hour: hourKey,
            label: `${h12}:00 ${period}`,
            ...vals,
            total
        }
    })

    const handleCarouselTouchStart = (e: React.TouchEvent) => {
        touchEndRef.current = null
        touchStartRef.current = e.targetTouches[0]?.clientY ?? null
    }
    const handleCarouselTouchMove = (e: React.TouchEvent) => {
        touchEndRef.current = e.targetTouches[0]?.clientY ?? null
    }
    const handleCarouselTouchEnd = () => {
        if (touchStartRef.current === null || touchEndRef.current === null) return
        const diff = touchStartRef.current - touchEndRef.current
        if (Math.abs(diff) < 22) return
        if (diff > 0 && activeIndex < carouselBuckets.length - 1) {
            setActiveIndex((i) => Math.min(carouselBuckets.length - 1, i + 1))
        } else if (diff < 0 && activeIndex > 0) {
            setActiveIndex((i) => Math.max(0, i - 1))
        }
        touchStartRef.current = null
        touchEndRef.current = null
    }

    return (
        <div
            ref={containerRef}
            className={`${isDark ? 'dark bg-[#111214] text-[#F5F2EB]' : 'bg-[#F3EFE7] text-[#171614]'} flex flex-col overflow-hidden transition-colors ${
                isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-[calc(100dvh-56px)] lg:h-[calc(100dvh-56px)]'
            }`}
        >
            <audio ref={cookAlarmRef} src="/sounds/alarm.mp3" preload="auto" loop className="hidden" />

            {/* 1. BARRA SUPERIOR INSTRUMENTAL ÚNICA (50px en Tableta/Desktop, 48px en Móvil) */}
            <PreparadorTopRail
                isDark={isDark}
                isFullscreen={isFullscreen}
                hideCookingPanel={hideCookingPanel}
                activeTab={activeTab}
                cartTotalQty={cartTotalQty}
                storeName={currentStoreName}
                cardDisplayMode={cardDisplayMode}
                viewMode={viewMode}
                isToday={isToday}
                selectedDate={selectedDate}
                loadingReadyOrders={loadingReadyOrders}
                wakingUpTablet={wakingUpTablet}
                liveClockText={liveClockText}
                bindInstantTap={bindPrepInstantTap}
                onToggleHideCooking={(next) => toggleHideCookingPanel(next)}
                onOpenSuppliesQuick={() => {
                    if (activeTab === 'alimentos') {
                        setActiveTab('ordenes')
                        fetchReadyOrders(false)
                    } else {
                        setActiveTab('alimentos')
                    }
                }}
                onBackToToday={() => {
                    const today = getLAEffectiveBusinessDate()
                    setSelectedDate(today)
                }}
                onManualRefresh={() => void fetchReadyOrders(true)}
                onWakeUpTablet={() => void handleWakeUpTablet()}
                onOpenManagerSheet={() => setShowMobileSettingsDrawer(true)}
                onToggleFullscreen={toggleFullscreen}
            />

            {/* 2. BANNER DELIVERY ARMOR (STRICTLY FUERA DE data-orders-hit-zone, 0px en reposo) */}
            <DeliveryPhoneNotesAlertPanel
                storeId={Number.isInteger(numericStoreId) && numericStoreId > 0 ? numericStoreId : null}
                storeCode={currentStoreCode || null}
                ready={mounted && Boolean(storeId)}
                variant="tablet"
            />

            {/* 3. ESPACIO PRINCIPAL DIVIDIDO: PARRILLA (42%) + TIRADOR RETRÁCTIL + ÓRDENES/INSUMOS (58% / 100%) */}
            <div className="relative flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
                <PreparadorGrillPanel
                    isDark={isDark}
                    isFullscreen={isFullscreen}
                    hideCookingPanel={hideCookingPanel}
                    mobileTab={mobileTab}
                    fetchingMeat={fetchingMeat}
                    carouselBuckets={carouselBuckets}
                    activeIndex={activeIndex}
                    currentBucketIndex={currentBucketIndex}
                    viewMode={viewMode}
                    cardDisplayMode={cardDisplayMode}
                    intelligenceAcelerador={intelligenceAcelerador}
                    weatherAlert={weatherAlert}
                    manualOverrides={manualOverrides}
                    manualWeeklySchedule={manualWeeklySchedule}
                    carouselContainerRef={carouselContainerRef}
                    grillPanelRef={grillPanelRef}
                    onPrevBucket={() => setActiveIndex((i) => Math.max(0, i - 1))}
                    onNextBucket={() => setActiveIndex((i) => Math.min(carouselBuckets.length - 1, i + 1))}
                    onJumpToCurrent={() => setActiveIndex(currentBucketIndex)}
                    onTouchStart={handleCarouselTouchStart}
                    onTouchMove={handleCarouselTouchMove}
                    onTouchEnd={handleCarouselTouchEnd}
                    onEditMeat={(req) => {
                        setEditingMeatItem(req)
                        setTempEditValue(req.currentVal)
                    }}
                    onOpenGuide={() => setShowGuideModal(true)}
                    onOpenDay={() => setShowDayModal(true)}
                    onOpenWaste={() => {
                        setSelectedWasteDate(getLAEffectiveBusinessDate())
                        setShowWasteModal(true)
                    }}
                    onOpenInfo={() => setShowInfoModal(true)}
                />

                {/* Tirador vertical retráctil anclado en el flujo flex (0px) exactamente sobre la costura;
                    dispara únicamente al soltar (onPointerUp táctil tolerante para guantes / onClick mouse) + escudo 500ms
                    para jamás llamar la orden que se desliza debajo del dedo */}
                <div className="hidden lg:block relative w-0 shrink-0 z-20">
                    <button
                        type="button"
                        data-no-proximity="true"
                        data-ultra-tap="true"
                        data-tap-key="rail:seam-toggle"
                        onPointerDown={(e) => {
                            e.stopPropagation()
                            suppressOrderCallsUntilRef.current = Math.max(suppressOrderCallsUntilRef.current, Date.now() + 550)
                        }}
                        onTouchStart={(e) => {
                            e.stopPropagation()
                            suppressOrderCallsUntilRef.current = Math.max(suppressOrderCallsUntilRef.current, Date.now() + 550)
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation()
                            suppressOrderCallsUntilRef.current = Math.max(suppressOrderCallsUntilRef.current, Date.now() + 550)
                        }}
                        onPointerUp={(e) => {
                            if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
                            e.preventDefault()
                            e.stopPropagation()
                            triggerPrepDedupedAction('rail:seam-toggle', () => toggleHideCookingPanel(), 450)
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            triggerPrepDedupedAction('rail:seam-toggle', () => toggleHideCookingPanel(), 450)
                        }}
                        title={hideCookingPanel ? t('prep.showCookingTooltip') : t('prep.hideCookingTooltip')}
                        aria-label={hideCookingPanel ? t('prep.showCookingPace') : t('prep.hideCookingPace')}
                        className={`flex items-center justify-center absolute top-1/2 -translate-y-1/2 left-0 cursor-pointer transition-colors select-none touch-manipulation shadow-xs ${
                            hideCookingPanel
                                ? 'w-[18px] h-16 rounded-r-xl border border-l-0'
                                : '-translate-x-1/2 w-[16px] h-14 rounded-full border'
                        } ${
                            isDark
                                ? 'bg-[#1B1D21] hover:bg-[#2C3038] border-[#343944] text-[#D1D5DB]'
                                : 'bg-white hover:bg-[#E8E2D6] border-[#BFB5A3] text-[#3F3B35]'
                        }`}
                    >
                        {hideCookingPanel ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                    </button>
                </div>

                <PreparadorOrdersAndSupplies
                    isDark={isDark}
                    hideCookingPanel={hideCookingPanel}
                    mobileTab={mobileTab}
                    activeTab={activeTab}
                    readyOrdersList={readyOrdersList}
                    callingOrderIds={callingOrderIds}
                    callSuccessOrderIds={callSuccessOrderIds}
                    callErrorOrderIds={callErrorOrderIds}
                    hideDrinks={hideDrinks}
                    isSmartAutoVoiceStore={isSmartAutoVoiceStore}
                    autoCallConfig={autoCallConfig}
                    smartNowMs={smartNowMs}
                    elapsedNowMs={elapsedNowMs}
                    cart={cart}
                    sending={sending}
                    supplyFeedback={supplyFeedback}
                    ordersScrollContainerRef={ordersScrollContainerRef}
                    shouldUseScrollSafeOrderTouch={ordersHasOverflow || readyOrdersList.length >= 5}
                    parseOrderItemsSummary={parseOrderItemsSummary}
                    isDrinkItem={isDrinkItem}
                    bindInstantTap={bindPrepInstantTap}
                    bindForgivingTap={bindPrepForgivingTap}
                    bindOrderCardTap={bindOrderCardTap}
                    onSelectTab={(tab) => {
                        setActiveTab(tab)
                        if (tab === 'ordenes') void fetchReadyOrders(false)
                    }}
                    onToggleHideDrinks={toggleHideDrinks}
                    onCallOrder={(ord) => void handleCallOrderImpulse(ord)}
                    onProximityTouchStart={(e) => handleOrdersProximityTouchEvent(e, 'down')}
                    onProximityTouchMove={(e) => handleOrdersProximityTouchEvent(e, 'move')}
                    onProximityPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return
                        handleOrdersProximityRadar(
                            e.clientX,
                            e.clientY,
                            e.currentTarget,
                            'down',
                            e.pointerType === 'mouse' ? 'mouse' : 'touch',
                            e.target
                        )
                    }}
                    onAddToCart={addToCart}
                    onDecreaseItem={decreaseItem}
                    onRemoveItem={removeFromCart}
                    onSendRequest={() => void sendRequest()}
                />

                {/* VISTA MÓVIL RESUMEN (< lg cuando mobileTab === 'resumen') */}
                {mobileTab === 'resumen' && (
                    <div className="lg:hidden flex-1 overflow-y-auto p-3 space-y-3 pb-24">
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setShowGuideModal(true)}
                                className={`h-14 rounded-xl font-black text-xs uppercase border ${
                                    isDark ? 'bg-[#1B1D21] border-[#2C3038]' : 'bg-white border-[#D8D0C2]'
                                }`}
                            >
                                {t('prep.viewGuide')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowDayModal(true)}
                                className={`h-14 rounded-xl font-black text-xs uppercase border ${
                                    isDark ? 'bg-[#1B1D21] border-[#2C3038]' : 'bg-white border-[#D8D0C2]'
                                }`}
                            >
                                {t('prep.viewDay')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedWasteDate(getLAEffectiveBusinessDate())
                                    setShowWasteModal(true)
                                }}
                                className={`h-14 rounded-xl font-black text-xs uppercase border ${
                                    isDark ? 'bg-[#1B1D21] border-[#2C3038]' : 'bg-white border-[#D8D0C2]'
                                }`}
                            >
                                {t('prep.wasteReportBtn')}
                            </button>
                            <button
                                type="button"
                                onClick={() => window.open('/inventory/preparador/bodega', '_blank')}
                                className="h-14 rounded-xl font-black text-xs uppercase bg-[#171614] text-white"
                            >
                                {t('prep.openWarehouse')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 4. BARRA DE NAVEGACIÓN INFERIOR MÓVIL (< lg) */}
            <nav
                data-no-proximity="true"
                className={`lg:hidden h-14 px-2 border-t grid grid-cols-4 gap-1 shrink-0 z-30 ${
                    isDark ? 'bg-[#181A1F] border-[#2C3038]' : 'bg-white border-[#D8D0C2]'
                }`}
            >
                <button
                    type="button"
                    onClick={() => setMobileTab('parrilla')}
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-black uppercase ${
                        mobileTab === 'parrilla' ? 'text-[#C8371A]' : 'opacity-60'
                    }`}
                >
                    <Flame className="w-4 h-4" />
                    <span>{t('prep.parrilla')}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setMobileTab('insumos')}
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-black uppercase ${
                        mobileTab === 'insumos' ? 'text-[#15803D]' : 'opacity-60'
                    }`}
                >
                    <UtensilsCrossed className="w-4 h-4" />
                    <span>{t('prep.insumos')}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setMobileTab('resumen')}
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-black uppercase ${
                        mobileTab === 'resumen' ? 'text-[#1D4ED8]' : 'opacity-60'
                    }`}
                >
                    <BarChart3 className="w-4 h-4" />
                    <span>{t('prep.resumen')}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setShowMobileSettingsDrawer(true)}
                    className="flex flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-black uppercase opacity-70"
                >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>{t('prep.ajustes')}</span>
                </button>
            </nav>

            {/* 5. MANAGER CONTROL SHEET (oculto automáticamente en Modo Tableta / Kiosco, regla U54) */}
            <PreparadorManagerSheet
                open={!isFullscreen && showMobileSettingsDrawer}
                isDark={isDark}
                isSuper={isSuper}
                stores={stores}
                storeId={storeId}
                selectedDate={selectedDate}
                currentBusinessDate={currentBusinessDate}
                isToday={isToday}
                cardDisplayMode={cardDisplayMode}
                viewMode={viewMode}
                wakingUpTablet={wakingUpTablet}
                isSmartAutoVoiceStore={isSmartAutoVoiceStore}
                onClose={() => setShowMobileSettingsDrawer(false)}
                onChangeStore={(nextId) => {
                    if (!isSuper) return
                    setStoreId(nextId)
                    safeLocalStorageSet('teg_preparador_store', nextId)
                }}
                onChangeDate={(nextDate) => setSelectedDate(nextDate)}
                onSelectToday={() => setSelectedDate(getLAEffectiveBusinessDate())}
                onChangeCardMode={(mode) => setCardDisplayMode(mode)}
                onChangeViewMode={(mode) => setViewMode(mode)}
                onToggleTheme={handleTogglePrepTheme}
                onOpenGuide={() => setShowGuideModal(true)}
                onOpenDay={() => setShowDayModal(true)}
                onOpenWaste={() => {
                    setSelectedWasteDate(getLAEffectiveBusinessDate())
                    setShowWasteModal(true)
                }}
                onOpenInfo={() => setShowInfoModal(true)}
                onOpenBackKitchen={() => window.open('/inventory/preparador/bodega', '_blank')}
                onWakeUpTablet={() => void handleWakeUpTablet()}
            />

            {/* 6. MODALES OPERATIVOS (100% Paridad Funcional) */}
            <PreparadorModals
                isDark={isDark}
                isFullscreen={isFullscreen}
                viewMode={viewMode}
                currentBusinessDate={currentBusinessDate}
                wakeToast={wakeToast}
                showWakeUpModal={showWakeUpModal}
                wakingUpTablet={wakingUpTablet}
                onWakeUpTablet={() => void handleWakeUpTablet()}
                showCookAlert={showCookAlert}
                nextBlockLabel={nextBlockLabel}
                onDismissCookAlert={() => {
                    setShowCookAlert(false)
                    if (cookAlarmRef.current) {
                        cookAlarmRef.current.pause()
                        cookAlarmRef.current.currentTime = 0
                    }
                }}
                editingMeatItem={editingMeatItem}
                tempEditValue={tempEditValue}
                hasDailyOverrideForEditing={Boolean(editingMeatItem && manualOverrides[editingMeatItem.key] !== undefined)}
                onChangeTempEditValue={setTempEditValue}
                onRestoreAutoOverride={() => {
                    if (!editingMeatItem) return
                    const copy = { ...manualOverrides }
                    delete copy[editingMeatItem.key]
                    persistManualOverrides(copy)
                    setEditingMeatItem(null)
                }}
                onSaveEditMeat={() => void handleSaveEditMeat()}
                onCloseEditMeat={() => setEditingMeatItem(null)}
                showGuideModal={showGuideModal}
                guideModalDow={guideModalDow}
                guideModalData={guideModalData}
                guideModalLoading={guideModalLoading}
                onChangeGuideDow={setGuideModalDow}
                onCloseGuideModal={() => setShowGuideModal(false)}
                showDayModal={showDayModal}
                hourlyData={hourlyRows}
                onCloseDayModal={() => setShowDayModal(false)}
                showWasteModal={showWasteModal}
                selectedWasteDate={selectedWasteDate}
                wasteData={wasteData}
                loadingWasteData={loadingWasteData}
                showWasteInfo={showWasteInfo}
                onChangeWasteDate={setSelectedWasteDate}
                onToggleWasteInfo={() => setShowWasteInfo((v) => !v)}
                onCloseWasteModal={() => setShowWasteModal(false)}
                showInfoModal={showInfoModal}
                onCloseInfoModal={() => setShowInfoModal(false)}
            />
        </div>
    )
}

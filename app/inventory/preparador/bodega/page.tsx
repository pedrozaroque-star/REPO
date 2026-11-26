/**
 * @module preparador-bodega
 * @description Tableta 2 de Cocina Trasera / Bodega de Tacos Gavilan (reubicada en MESWAO 15.6") que proyecta
 *   la demanda de carnes lentas y preparaciones (Cabeza, Lengua, Champurrado, Guacamole, Frijol Molido, Arroz),
 *   recibe alertas de insumos en tiempo real e integra de forma permanente el Temporizador Digital Multicanal
 *   Cooper TFS4 para la cocción exacta y bloqueada de Frijoles de la Olla (11:00 min) y Frijoles Enteros (12:00 min).
 *
 * @businessRules
 * - Día laboral de Tacos Gavilan: 6:00 AM a 5:59 AM del siguiente día (`America/Los_Angeles`). Turno PM: 5:00 PM.
 * - Autorización estricta: solo roles `admin`, `manager`, `supervisor` y `asistente`; usuarios no super-admin
 *   quedan bloqueados a su sucursal asignada.
 * - Champurrado: 1 galón = 8 lbs líquido / 20 porciones (horizonte 6 horas acumulado con redondeo hacia arriba).
 * - Guacamole: demanda dividida entre 2 para indicar bolsas estándar de 2 lbs.
 * - Escucha en tiempo real inserciones en `preparador_requests` con estado `PENDING` (proyección escalar explícita).
 * - Alerta de seguridad por silencio: si `isMuted === true`, muestra un banner rojo persistente imposible de ignorar
 *   con botón `REACTIVAR SONIDO` para evitar frijoles quemados o pedidos de línea perdidos.
 * - Temporizador Digital Cooper TFS4 (`BeanCookingTimerTFS4`): montaje continuo bajo `key="persistent-bean-timer-tfs4"`
 *   tanto en vista normal como en alertas de línea (`compactDuringAlert`), conservando audio `Kore` y canal Realtime.
 *
 * @dataFlow
 * - `meat_consumption_history` -> `/api/inventory/preparador-history` -> Carrusel Cocina Trasera & Realtime WebSocket.
 * - `bean_timer_presets` + `bean_cooking_logs` <-> `/api/preparador/bean-timer` + Supabase Realtime -> `BeanCookingTimerTFS4`.
 *
 * @notes
 * - Upgrade 2026-11-26 (Cohesión Industrial Comal Graphite + Blindaje Técnico):
 *   1) Motor táctil `useKitchenTapGuard` (`data-ultra-tap="true"`) en `ENTREGADO` que erradica el auto-cierre fantasma de la Alerta #2.
 *   2) Corrige comparación `String(s.id) === String(storeId)` para horario dinámico `opening_time - 1h`.
 *   3) Aísla `teg_galones_ack_${storeId}_${today}` por sucursal/fecha laboral, agrega rollback si falla `UPDATE`,
 *      elimina `SELECT *`, agrega `AbortSignal.timeout(8000)` + `401` retry, LED Realtime real, banner rojo si está silenciada,
 *      y traduce el Info Modal al 100% ES/EN (removiendo texto obsoleto de "Coffee").
 */
'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudRain,
  HelpCircle,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Store,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import {
  ensureFreshTabletAuth,
  getTabletNoCacheHeaders,
  purgeTabletStaleCaches,
  safeLocalStorageSet,
} from '@/lib/tablet-cache-cleaner'
import { useWakeLock } from '@/lib/use-wake-lock'
import { useKitchenTapGuard } from '@/lib/kitchen-touch'
import BeanCookingTimerTFS4 from '@/components/BeanCookingTimerTFS4'

interface PrepRequest {
  id: string
  store_id: string
  sender_name: string
  items: string[]
  status: string
  created_at: string
}

interface MeatData {
  interval_start: string
  meat_type: string
  avg_lbs: number
  samples: number
}

function isLosAngelesDeadHours(): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12') % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    const mins = h * 60 + m
    return mins >= 255 && mins < 420 // 4:15 AM – 6:59 AM PT
  } catch {
    return false
  }
}

export default function BodegaPWA() {
  const supabase = useMemo(() => createClient(), [])
  const { user, loading: authLoading } = useAuth()
  const { t } = useLanguage()
  const wakeLock = useWakeLock(true)
  const { bindInstantTap } = useKitchenTapGuard()

  const [mounted, setMounted] = useState(false)
  const [systemStarted, setSystemStarted] = useState(false)
  const [stores, setStores] = useState<any[]>([])
  const [storeId, setStoreId] = useState('')

  const getLAEffectiveBusinessDate = () => getCaliforniaBusinessDate()

  const INACTIVITY_WAKE_MODAL_MS = 3 * 60 * 60 * 1000
  const initialToday = getLAEffectiveBusinessDate()
  const [currentBusinessDate, setCurrentBusinessDate] = useState<string>(initialToday)
  const [selectedDate, setSelectedDate] = useState<string>(initialToday)
  const effectiveDateRef = useRef<string>(initialToday)
  const lastActivityTimeRef = useRef<number>(Date.now())
  const [showWakeUpModal, setShowWakeUpModal] = useState(false)
  const showWakeUpModalRef = useRef(false)
  const [wakingUpTablet, setWakingUpTablet] = useState(false)
  const [liveClockText, setLiveClockText] = useState<string>('')
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now())
  const [realtimeStatus, setRealtimeStatus] = useState<'live' | 'reconnecting' | 'offline'>('reconnecting')
  const realtimeStatusRef = useRef<'live' | 'reconnecting' | 'offline'>('reconnecting')
  const [ackErrorToast, setAckErrorToast] = useState<string | null>(null)

  const fetchHistoryRef = useRef<((overrideDow?: number) => Promise<void>) | null>(null)
  const fetchManualScheduleRef = useRef<((overrideDow?: number, overrideDate?: string, bypassCache?: boolean) => Promise<void>) | null>(null)
  const fetchIntelligenceRef = useRef<(() => Promise<void>) | null>(null)
  const fetchPendingRef = useRef<(() => Promise<void>) | null>(null)
  const updateBucketsRef = useRef<(() => void) | null>(null)

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
  const [viewMode, setViewMode] = useState<'30min' | 'tramos'>('30min')
  const [cardDisplayMode, setCardDisplayMode] = useState<'manual' | 'basic' | 'advanced'>('manual')
  const [manualWeeklySchedule, setManualWeeklySchedule] = useState<Record<string, number>>({})
  const [currentBucketIndex, setCurrentBucketIndex] = useState(0)
  const hasInitializedRef = useRef(false)
  const prevCurrentBucketIndexRef = useRef<number>(-1)

  const playSubtleConfirmTick = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(18)
      }
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      if (ctx.state === 'suspended') void ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(980, ctx.currentTime)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.1)
      setTimeout(() => ctx.close().catch(() => {}), 200)
    } catch {}
  }

  const fetchWithAuthRetry = async (url: string, bypassCache = false): Promise<Response> => {
    const doReq = () =>
      fetch(url, {
        credentials: 'include',
        ...(bypassCache ? { cache: 'no-store' as RequestCache } : {}),
        headers: getTabletNoCacheHeaders(),
        signal: AbortSignal.timeout(8000),
      })
    let res = await doReq()
    if (res.status === 401) {
      const refreshed = await ensureFreshTabletAuth(true).catch(() => null)
      if (refreshed) res = await doReq()
    }
    return res
  }

  // Live California clock (pausado si pestaña oculta)
  useEffect(() => {
    const updateClock = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const now = Date.now()
      setNowTickMs(now)
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

  // Automatic Date Rollover, 3-Hour Inactivity Wake Modal & Safe Cache Self-Cleaning
  useEffect(() => {
    const checkDateRollover = (forceToday = false) => {
      const freshBusinessDate = getLAEffectiveBusinessDate()
      setCurrentBusinessDate(freshBusinessDate)

      const prevEffective = effectiveDateRef.current
      const dayChanged = freshBusinessDate !== prevEffective

      if (dayChanged || forceToday) {
        effectiveDateRef.current = freshBusinessDate
        setSelectedDate(freshBusinessDate)
        setManualWeeklySchedule({})
        hasInitializedRef.current = false
        prevCurrentBucketIndexRef.current = -1
        if (storeId) {
          purgeTabletStaleCaches({
            activeStoreId: storeId,
            activeDate: freshBusinessDate,
            activeDow: getDowFromDate(freshBusinessDate),
            forceTokenRefresh: true,
          }).catch(() => {})
        }
      }
    }

    const checkInactivityReturn = () => {
      const now = Date.now()
      const idleMs = now - lastActivityTimeRef.current
      const freshBusinessDate = getLAEffectiveBusinessDate()
      if (idleMs > 120000 && selectedDate !== freshBusinessDate) {
        checkDateRollover(true)
      }
      if (!showWakeUpModalRef.current && idleMs >= INACTIVITY_WAKE_MODAL_MS) {
        showWakeUpModalRef.current = true
        setShowWakeUpModal(true)
      }
    }

    checkDateRollover()
    if (storeId) {
      const todayLA = getLAEffectiveBusinessDate()
      purgeTabletStaleCaches({
        activeStoreId: storeId,
        activeDate: todayLA,
        activeDow: getDowFromDate(todayLA),
      }).catch(() => {})
    }

    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      checkDateRollover()
      checkInactivityReturn()
    }, 10000)

    const cacheCleanupTimer = setInterval(() => {
      if (!storeId) return
      const freshDate = getLAEffectiveBusinessDate()
      purgeTabletStaleCaches({
        activeStoreId: storeId,
        activeDate: freshDate,
        activeDow: getDowFromDate(freshDate),
      }).catch(() => {})
    }, 15 * 60 * 1000)

    let lastWakeAt = 0
    const handleWakeUp = () => {
      const now = Date.now()
      if (now - lastWakeAt < 1500) return
      lastWakeAt = now
      checkDateRollover()
      checkInactivityReturn()
      if (storeId) {
        const todayLA = getLAEffectiveBusinessDate()
        purgeTabletStaleCaches({
          activeStoreId: storeId,
          activeDate: todayLA,
          activeDow: getDowFromDate(todayLA),
        }).catch(() => {})
        fetchPendingRef.current?.()
      }
    }

    window.addEventListener('focus', handleWakeUp)
    window.addEventListener('online', handleWakeUp)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleWakeUp()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

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
  }, [selectedDate, storeId])

  const normTime = (tm: string) => {
    if (!tm) return '00:00:00'
    const parts = tm.split(':')
    if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`
    if (parts.length === 3) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`
    return tm
  }

  // Load Manual Weekly Schedule (5m background polling + visibility guard + timeout + 401 retry)
  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    const fetchManualSchedule = async (overrideDow?: number, overrideDate?: string, bypassCache = false) => {
      const targetDow = overrideDow || businessDow
      const targetStorageKey = `teg_prep_manual_weekly_${storeId}_${targetDow}`
      try {
        const url = bypassCache
          ? `/api/inventory/preparador-manual-schedule?storeId=${storeId}&dow=${targetDow}&_t=${Date.now()}`
          : `/api/inventory/preparador-manual-schedule?storeId=${storeId}&dow=${targetDow}`
        const res = await fetchWithAuthRetry(url, bypassCache)
        if (res.ok && !cancelled) {
          const data = await res.json()
          if (Array.isArray(data) && !cancelled) {
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
              activeDow: getDowFromDate(todayLA),
            })
            return
          }
        }
      } catch (e) {
        console.error('Error fetching manual schedule in bodega:', e)
      }

      if (cancelled) return
      const cached = localStorage.getItem(targetStorageKey)
      if (cached) {
        try {
          setManualWeeklySchedule(JSON.parse(cached))
        } catch {}
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

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isMuted, setIsMuted] = useState(false)

  const [pendingRequests, setPendingRequests] = useState<PrepRequest[]>([])
  const [beverageAlerts, setBeverageAlerts] = useState<any[]>([])
  const allAlerts = useMemo(
    () =>
      [...pendingRequests, ...beverageAlerts].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [pendingRequests, beverageAlerts]
  )
  const hasAlert = allAlerts.length > 0

  const [meatData, setMeatData] = useState<MeatData[]>([])
  const [fetchingMeat, setFetchingMeat] = useState(false)
  const [carouselBuckets, setCarouselBuckets] = useState<
    { id: string; name?: string; isPeak?: boolean; duration?: number; label: string; data: any[]; isCurrent: boolean }[]
  >([])
  const [activeIndex, setActiveIndex] = useState(0)

  const touchStartRef = useRef<number | null>(null)
  const touchEndRef = useRef<number | null>(null)
  const [showInfoModal, setShowInfoModal] = useState(false)

  // Snap back to AHORA after 15s of inactivity
  useEffect(() => {
    if (activeIndex === currentBucketIndex) return
    const timer = setTimeout(() => {
      setActiveIndex(currentBucketIndex)
    }, 15000)
    return () => clearTimeout(timer)
  }, [activeIndex, currentBucketIndex])

  const containerRef = useRef<HTMLDivElement>(null)
  const bodegaPanelRef = useRef<HTMLDivElement>(null)
  const bodegaCarouselRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTimerMaximized, setIsTimerMaximized] = useState(false)
  const wheelThrottleRef = useRef<number>(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Non-passive mouse wheel navigation
  useEffect(() => {
    const targetEl = bodegaCarouselRef.current
    if (!targetEl) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const now = Date.now()
      if (now - wheelThrottleRef.current < 260) return
      if (Math.abs(e.deltaY) < 10) return

      if (e.deltaY > 0) {
        wheelThrottleRef.current = now
        setActiveIndex((prev) => (prev < carouselBuckets.length - 1 ? prev + 1 : prev))
      } else if (e.deltaY < 0) {
        wheelThrottleRef.current = now
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev))
      }
    }

    targetEl.addEventListener('wheel', handleWheel, { passive: false })
    return () => targetEl.removeEventListener('wheel', handleWheel)
  }, [carouselBuckets.length, hasAlert, isTimerMaximized])

  useEffect(() => {
    if (bodegaPanelRef.current) bodegaPanelRef.current.scrollTop = 0
  }, [activeIndex])

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as any
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
    }
  }, [])

  const toggleFullscreen = () => {
    const doc = document as any
    const elem = containerRef.current as any
    if (!isFullscreen) {
      if (elem?.requestFullscreen) {
        elem.requestFullscreen().catch(() => setIsFullscreen(true))
      } else if (elem?.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen()
        setTimeout(() => {
          if (!doc.webkitFullscreenElement) setIsFullscreen(true)
        }, 200)
      } else {
        setIsFullscreen(true)
      }
    } else {
      if (doc.exitFullscreen && doc.fullscreenElement) {
        doc.exitFullscreen().catch(() => setIsFullscreen(false))
      } else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
        doc.webkitExitFullscreen()
        setTimeout(() => {
          if (!doc.webkitFullscreenElement) setIsFullscreen(false)
        }, 200)
      } else {
        setIsFullscreen(false)
      }
    }
  }

  // Fetch Stores (con guardia !authLoading y sorted[0])
  useEffect(() => {
    const fetchStores = async () => {
      const { data } = await supabase
        .from('stores')
        .select('id, name, code, opening_time, closing_time')
        .eq('is_active', true)
        .order('name')
      if (data && data.length > 0) {
        const sorted = sortStoresAlphabetically(
          data.map((s: any) => ({ ...s, name: formatStoreDisplayName(s.name) })),
          (s: any) => s.name
        )
        setStores(sorted)
        const isSuper = ['admin', 'supervisor'].includes(user?.role?.toLowerCase() || '')
        if (user && !isSuper && user.store_id) {
          const assignedStoreId = String(user.store_id)
          setStoreId(assignedStoreId)
          safeLocalStorageSet('teg_bodega_store', assignedStoreId)
          safeLocalStorageSet('teg_preparador_store', assignedStoreId)
        } else {
          const saved = localStorage.getItem('teg_bodega_store') || localStorage.getItem('teg_preparador_store')
          if (saved && sorted.find((s: any) => String(s.id) === String(saved))) setStoreId(String(saved))
          else setStoreId(String(sorted[0].id))
        }
      }
    }
    if (!authLoading && user) fetchStores()
  }, [supabase, user, authLoading])

  // Load Meat Historial (6 preparaciones lentas/bodega, con timeout y 401 retry)
  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    const fetchHistory = async (overrideDow?: number) => {
      const targetDow = overrideDow || businessDow
      setFetchingMeat(true)
      try {
        const res = await fetchWithAuthRetry(
          `/api/inventory/preparador-history?storeId=${storeId}&dow=${targetDow}`,
          false
        )
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && Array.isArray(json)) {
          const allowedTypes = ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
          setMeatData(json.filter((m: any) => allowedTypes.includes(m.meat_type)))
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (!cancelled) setFetchingMeat(false)
      }
    }
    fetchHistoryRef.current = fetchHistory
    fetchHistory()
    return () => {
      cancelled = true
    }
  }, [storeId, businessDow])

  const [intelligenceAcelerador, setIntelligenceAcelerador] = useState(1.0)
  const [weatherAlert, setWeatherAlert] = useState(false)

  useEffect(() => {
    if (!storeId) return
    if (!isToday) {
      setIntelligenceAcelerador(1.0)
      setWeatherAlert(false)
      return
    }
    let cancelled = false
    const fetchIntelligence = async () => {
      try {
        const res = await fetchWithAuthRetry(`/api/preparador/intelligence?store_id=${storeId}`, false)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled && data) {
          if (data.growth_factor) setIntelligenceAcelerador(Number(data.growth_factor) || 1.0)
          if (typeof data.weather_adjustment !== 'undefined') setWeatherAlert(Boolean(data.weather_adjustment))
        }
      } catch (e) {
        console.error('No se pudo obtener la inteligencia predictiva:', e)
      }
    }

    fetchIntelligenceRef.current = fetchIntelligence
    fetchIntelligence()
    const int = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchIntelligence()
      }
    }, 10 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(int)
    }
  }, [storeId, isToday])

  // Clock Bucket Updater (CORREGIDO: String(s.id) === String(storeId) para opening_time dinámico real)
  useEffect(() => {
    const updateBuckets = () => {
      const d = new Date()
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      const timeParts = formatter.format(d).split(':')
      let h = parseInt(timeParts[0], 10)
      const m = parseInt(timeParts[1], 10)
      if (h === 24) h = 0
      const curM = m >= 30 ? 30 : 0

      const formatTime12 = (hr: number, min: number) => {
        const p = hr >= 12 ? 'pm' : 'am'
        const h12 = hr % 12 === 0 ? 12 : hr % 12
        return `${h12}:${min.toString().padStart(2, '0')}${p}`
      }

      const activeStoreObj = stores.find((s) => String(s.id) === String(storeId))
      let openH = 8
      if (activeStoreObj?.opening_time) {
        const parts = String(activeStoreObj.opening_time).split(':').map(Number)
        if (Number.isFinite(parts[0])) {
          openH = Math.max(6, parts[0] - 1)
        }
      }

      if (viewMode === '30min') {
        const arr: any[] = []
        let tempH = openH
        let tempM = 0
        let foundCurrentIndex = 0

        for (let i = 0; i < 48; i++) {
          const hrStr = tempH.toString().padStart(2, '0')
          const minStr = tempM.toString().padStart(2, '0')
          const bucketId = `${hrStr}:${minStr}:00`

          const nxtM = tempM === 0 ? 30 : 0
          const nxtH = tempM === 30 ? (tempH + 1) % 24 : tempH
          const label = `${formatTime12(tempH, tempM)} – ${formatTime12(nxtH, nxtM)}`

          let data: any[] = []
          if (meatData.length > 0) {
            const allowedTypes = ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
            data = allowedTypes.map((type) => {
              const mData = meatData.find((md) => md.interval_start === bucketId && md.meat_type === type)
              return {
                interval_start: bucketId,
                meat_type: type,
                avg_lbs: mData ? mData.avg_lbs : 0,
                duration: 0.5,
                samples: mData ? mData.samples : 0,
              }
            })
          }

          const isCurrent = tempH === h && tempM === curM
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
      } else {
        const PEAK_PERIODS = [
          { id: 'p1', name: 'Apertura / Desayuno', startH: openH, endH: 11, duration: Math.max(1, 11 - openH), isPeak: false },
          { id: 'p2', name: 'HORA PICO AM', startH: 11, endH: 14, duration: 3, isPeak: true },
          { id: 'p3', name: 'Tarde / Transición', startH: 14, endH: 17, duration: 3, isPeak: false },
          { id: 'p4', name: 'HORA PICO PM', startH: 17, endH: 21, duration: 4, isPeak: true },
          { id: 'p5', name: 'Noche / Cena Tardía', startH: 21, endH: 1, duration: 4, isPeak: false },
          { id: 'p6', name: 'Madrugada / Cierre', startH: 1, endH: openH, duration: (24 - 1 + openH) % 24 || 5, isPeak: false },
        ]

        const isHourInPeriod = (hr: number, startH: number, endH: number) => {
          if (startH < endH) return hr >= startH && hr < endH
          return hr >= startH || hr < endH
        }

        const arr: any[] = []
        let foundCurrentIndex = 0

        PEAK_PERIODS.forEach((period, idx) => {
          const label = `${formatTime12(period.startH, 0)} – ${formatTime12(period.endH, 0)}`
          let data: any[] = []
          if (meatData.length > 0) {
            const allowedTypes = ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ']
            data = allowedTypes.map((type) => {
              let totalAvg = 0
              let totalSamples = 0
              meatData.forEach((md) => {
                if (md.meat_type !== type) return
                const [hhStr] = md.interval_start.split(':')
                const hh = parseInt(hhStr, 10)
                if (isHourInPeriod(hh, period.startH, period.endH)) {
                  totalAvg += md.avg_lbs
                  totalSamples += md.samples || 0
                }
              })
              return {
                interval_start: `${period.startH.toString().padStart(2, '0')}:00:00`,
                meat_type: type,
                avg_lbs: totalAvg,
                duration: period.duration,
                samples: totalSamples,
              }
            })
          }

          const isCurrent = isHourInPeriod(h, period.startH, period.endH)
          if (isCurrent) foundCurrentIndex = idx
          arr.push({ id: period.id, name: period.name, isPeak: period.isPeak, duration: period.duration, label, isCurrent, data })
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
    const int = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        updateBuckets()
      }
    }, 15000)
    return () => clearInterval(int)
  }, [meatData, viewMode, storeId, stores])

  const [wakeToast, setWakeToast] = useState(false)

  const startSystem = async () => {
    if (audioRef.current) {
      audioRef.current
        .play()
        .then(() => {
          audioRef.current!.pause()
          audioRef.current!.currentTime = 0
        })
        .catch(() => {})
    }
    try {
      await wakeLock.requestNow()
    } catch {}
    playSubtleConfirmTick()

    const freshDate = getLAEffectiveBusinessDate()
    setCurrentBusinessDate(freshDate)
    setSelectedDate(freshDate)
    effectiveDateRef.current = freshDate
    hasInitializedRef.current = false
    prevCurrentBucketIndexRef.current = -1
    setSystemStarted(true)
  }

  const handleWakeUpTablet = async () => {
    if (wakingUpTablet) return
    setWakingUpTablet(true)
    showWakeUpModalRef.current = false
    setShowWakeUpModal(false)
    lastActivityTimeRef.current = Date.now()
    try {
      await wakeLock.requestNow()
    } catch {}
    playSubtleConfirmTick()

    const freshDate = getLAEffectiveBusinessDate()
    const freshDow = getDowFromDate(freshDate)
    setCurrentBusinessDate(freshDate)
    setSelectedDate(freshDate)
    effectiveDateRef.current = freshDate
    hasInitializedRef.current = false
    prevCurrentBucketIndexRef.current = -1

    if (storeId) {
      await purgeTabletStaleCaches({
        activeStoreId: storeId,
        activeDate: freshDate,
        activeDow: freshDow,
        forceTokenRefresh: true,
      }).catch(() => {})
    }

    // Lotes acotados (concurrencia <= 2, Regla Protección de Servidores)
    await Promise.allSettled([
      fetchPendingRef.current?.(),
      fetchHistoryRef.current?.(freshDow),
    ])
    await Promise.allSettled([
      fetchManualScheduleRef.current?.(freshDow, freshDate, true),
      fetchIntelligenceRef.current?.(),
    ])
    setTimeout(() => updateBucketsRef.current?.(), 50)

    setWakingUpTablet(false)
    setWakeToast(true)
    setTimeout(() => setWakeToast(false), 4000)
  }

  // Cuotas automáticas de Champurrado (llave aislada por sucursal + fecha laboral canónica, sin isMuted en deps)
  useEffect(() => {
    if (!systemStarted || !storeId || meatData.length === 0) return

    const checkBeverages = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const laParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(new Date())
      let evalH = Number(laParts.find((p) => p.type === 'hour')?.value ?? '12') % 24
      const currentM = Number(laParts.find((p) => p.type === 'minute')?.value ?? '0')
      if (evalH < 6) evalH += 24
      const currentTimeInMins = evalH * 60 + currentM

      const bizDate = getCaliforniaBusinessDate()
      const ackKey = `teg_galones_ack_${storeId}_${bizDate}`

      const getCumulativeSales = (meatType: string, offsetMins: number) => {
        let totalExpected = 0
        const evaluateTimeInMins = currentTimeInMins + offsetMins
        meatData.forEach((m) => {
          if (m.meat_type !== meatType) return
          let [hh, mm] = m.interval_start.split(':').map(Number)
          if (hh < 6) hh += 24
          const bucketStartMins = hh * 60 + mm
          if (bucketStartMins + 30 <= evaluateTimeInMins) {
            totalExpected += m.avg_lbs
          } else if (bucketStartMins < evaluateTimeInMins) {
            const passedMins = evaluateTimeInMins - bucketStartMins
            totalExpected += m.avg_lbs * (passedMins / 30)
          }
        })
        return totalExpected
      }

      const baseChamp = getCumulativeSales('CHAMPURRADO', 360)
      const totalChamp = baseChamp * intelligenceAcelerador
      const reqGalones = Math.ceil(totalChamp / 20)
      const ackGalones = parseInt(localStorage.getItem(ackKey) || '0', 10)

      const newAlerts: any[] = []
      if (reqGalones > ackGalones) {
        const diff = reqGalones - ackGalones
        for (let i = 0; i < diff; i++) {
          newAlerts.push({
            id: `SYS_CHAMP_${ackGalones + i + 1}`,
            items: ['1 GALON CHAMPURRADO'],
            type: 'CHAMP',
            number: ackGalones + i + 1,
            created_at: new Date().toISOString(),
            is_sys: true,
          })
        }
      }
      setBeverageAlerts(newAlerts)
    }

    checkBeverages()
    const int = setInterval(checkBeverages, 60000)
    return () => clearInterval(int)
  }, [systemStarted, storeId, meatData, intelligenceAcelerador])

  const handleAcknowledgeBeverage = (alert: any) => {
    if (alert.type === 'CHAMP' && storeId) {
      const bizDate = getCaliforniaBusinessDate()
      safeLocalStorageSet(`teg_galones_ack_${storeId}_${bizDate}`, String(alert.number), {
        activeStoreId: storeId,
        activeDate: bizDate,
        activeDow: getDowFromDate(bizDate),
      })
    }
    setBeverageAlerts((prev) => prev.filter((a) => a.id !== alert.id))
    playSubtleConfirmTick()
  }

  // Solicitudes de línea en vivo (columnas explícitas sin SELECT *, LED Realtime real, backoff en horas cerradas/SUBSCRIBED)
  useEffect(() => {
    if (!storeId || !systemStarted) return
    safeLocalStorageSet('teg_bodega_store', storeId)

    let disposed = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const fetchPending = async () => {
      const { data, error } = await supabase
        .from('preparador_requests')
        .select('id, store_id, sender_name, items, status, created_at')
        .eq('store_id', storeId)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(50)

      if (!disposed && !error && data) {
        setPendingRequests(data as PrepRequest[])
      }
    }

    fetchPendingRef.current = fetchPending
    void fetchPending()

    const scheduleNextPoll = () => {
      if (disposed) return
      const delayMs = isLosAngelesDeadHours()
        ? 120_000
        : realtimeStatusRef.current === 'live'
          ? 90_000
          : 45_000
      pollTimer = setTimeout(() => {
        if (disposed) return
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void fetchPending().finally(scheduleNextPoll)
        } else {
          scheduleNextPoll()
        }
      }, delayMs)
    }
    scheduleNextPoll()

    const channel = supabase
      .channel(`preparador-requests-${storeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'preparador_requests', filter: `store_id=eq.${storeId}` },
        () => {
          if (!disposed) void fetchPending()
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'preparador_requests', filter: `store_id=eq.${storeId}` },
        () => {
          if (!disposed) void fetchPending()
        }
      )
      .subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          realtimeStatusRef.current = 'live'
          setRealtimeStatus('live')
          void fetchPending()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          realtimeStatusRef.current = 'offline'
          setRealtimeStatus('offline')
        } else {
          realtimeStatusRef.current = 'reconnecting'
          setRealtimeStatus('reconnecting')
        }
      })

    return () => {
      disposed = true
      if (pollTimer) clearTimeout(pollTimer)
      void supabase.removeChannel(channel)
      stopAlarm()
    }
  }, [storeId, systemStarted, supabase])

  useEffect(() => {
    if (pendingRequests.length === 0 && beverageAlerts.length === 0) {
      stopAlarm()
    } else if (!isMuted && systemStarted) {
      playAlarm()
    }
  }, [pendingRequests.length, beverageAlerts.length, isMuted, systemStarted])

  const playAlarm = () => {
    if (audioRef.current && (pendingRequests.length > 0 || beverageAlerts.length > 0)) {
      audioRef.current.loop = true
      const playPromise = audioRef.current.play()
      if (playPromise !== undefined) {
        playPromise.catch(() => {})
      }
    }
  }

  const stopAlarm = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }

  // Confirmación con rollback seguro si el UPDATE en DB falla
  const handleAcknowledge = async (id: string) => {
    const targetItem = pendingRequests.find((p) => p.id === id)
    if (!targetItem) return
    playSubtleConfirmTick()
    setPendingRequests((prev) => prev.filter((p) => p.id !== id))

    const { error } = await supabase
      .from('preparador_requests')
      .update({ status: 'ACKNOWLEDGED', acknowledged_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('Error al actualizar estado:', error)
      setPendingRequests((prev) =>
        [targetItem, ...prev.filter((p) => p.id !== id)].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      )
      setAckErrorToast(t('prep.bodegaAckError'))
      setTimeout(() => setAckErrorToast(null), 4000)
    }
  }

  if (!mounted || authLoading) {
    return (
      <div className="h-[calc(100dvh-56px)] bg-[#111214] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#EF4444]" />
      </div>
    )
  }

  if (!user || !['admin', 'manager', 'supervisor', 'asistente'].includes(user.role?.toLowerCase() || '')) {
    return (
      <div className="p-8 text-center text-[#EF4444] text-2xl font-black bg-[#111214] min-h-screen">
        {t('prep.accessDenied')}
      </div>
    )
  }

  const isSuper = ['admin', 'supervisor'].includes(user.role?.toLowerCase() || '')
  const pacePct = Math.round((intelligenceAcelerador - 1) * 100)

  const formatAlertTimeLA = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }

  const formatElapsedShort = (iso: string) => {
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return t('prep.now')
    const mins = Math.max(0, Math.floor((nowTickMs - ms) / 60_000))
    if (mins < 1) return t('prep.now')
    return t('prep.agoMinutes').replace('{m}', String(mins))
  }

  // Pantalla de Standby / Desbloqueo de Audio (Comal Graphite Industrial)
  if (!systemStarted) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-56px)] bg-[#111214] text-[#F5F2EB] p-6">
        <div className="bg-[#181A1F] border-2 border-[#2C3038] p-8 sm:p-10 rounded-2xl max-w-lg w-full text-center shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-[#3A1614] border border-[#7F1D1D] flex items-center justify-center mx-auto mb-5">
            <AlertOctagon className="w-9 h-9 text-[#EF4444]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight mb-2">
            {t('prep.bodegaTitle')}
          </h1>
          <p className="text-[#9CA3AF] font-semibold mb-8 text-sm sm:text-base">
            {t('prep.systemStandbyDesc')}
          </p>

          <button
            type="button"
            onClick={startSystem}
            className="w-full h-16 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] border-b-[4px] border-[#B45309] active:translate-y-[1px] text-lg sm:text-xl font-black text-[#171614] uppercase tracking-wide flex items-center justify-center gap-3 cursor-pointer"
          >
            <Sun className="w-6 h-6" />
            <span>{t('prep.wakeUpTablet')}</span>
          </button>

          <audio ref={audioRef} src="/sounds/alarm.mp3" preload="auto" className="hidden" />
        </div>
      </div>
    )
  }

  const currentBucket = carouselBuckets[activeIndex] || null
  const totalBuckets = Math.max(1, carouselBuckets.length)
  const progressPct = Math.min(100, Math.max(2, ((activeIndex + 1) / totalBuckets) * 100))

  return (
    <div
      ref={containerRef}
      className={`dark flex flex-col overflow-hidden transition-colors ${
        hasAlert ? 'bg-[#2B0C0B]' : 'bg-[#111214]'
      } text-[#F5F2EB] ${
        isFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen' : 'h-[calc(100dvh-56px)]'
      }`}
    >
      <audio ref={audioRef} src="/sounds/alarm.mp3" preload="auto" className="hidden" />

      {/* Toast Confirmación Despertar */}
      <AnimatePresence>
        {wakeToast && (
          <motion.div
            initial={{ opacity: 0, y: -32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -32 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[999999] bg-[#15803D] text-white px-5 py-3 rounded-xl font-black text-xs sm:text-sm shadow-xl flex items-center gap-2.5 border border-[#86EFAC]/40"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{t('prep.tabletAwakeSuccess')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error al confirmar entrega */}
      {ackErrorToast && (
        <div className="px-4 py-2 bg-[#C8371A] text-white text-xs sm:text-sm font-black flex items-center justify-center gap-2 shrink-0 z-40">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{ackErrorToast}</span>
        </div>
      )}

      {/* BANNER ROJO PERSISTENTE SI ESTÁ SILENCIADA (protege ollas de frijoles TFS4 y pedidos de línea) */}
      {isMuted && (
        <div className="px-3 sm:px-4 py-2 bg-[#C8371A] border-b-2 border-[#FCA5A5] text-white flex items-center justify-between gap-3 shrink-0 z-40">
          <div className="flex items-center gap-2 min-w-0">
            <VolumeX className="w-5 h-5 shrink-0" />
            <span className="text-xs sm:text-sm font-black uppercase tracking-wide truncate">
              {t('prep.bodegaMutedDangerBanner')}
            </span>
          </div>
          <button
            type="button"
            {...bindInstantTap('bodega:unmute-banner', () => setIsMuted(false))}
            className="h-9 px-3.5 rounded-lg bg-white text-[#9A2711] font-black text-xs uppercase tracking-wide shrink-0 cursor-pointer active:scale-95"
          >
            {t('prep.bodegaUnmuteBtn')}
          </button>
        </div>
      )}

      {/* Modal Despertar 3h */}
      <AnimatePresence>
        {showWakeUpModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleWakeUpTablet}
            className="fixed inset-0 z-[999998] bg-black/85 flex items-center justify-center p-4 cursor-pointer select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 16 }}
              onClick={(e) => {
                e.stopPropagation()
                void handleWakeUpTablet()
              }}
              className="bg-[#181A1F] border-2 border-[#F59E0B] max-w-xl w-full rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center shadow-2xl"
            >
              <div className="w-16 h-16 rounded-2xl bg-[#33230B] border border-[#6E4912] flex items-center justify-center mb-4">
                <Sun className="w-9 h-9 text-[#F59E0B]" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black uppercase mb-2">{t('prep.wakeModalTitle')}</h2>
              <p className="text-[#9CA3AF] text-xs sm:text-sm font-semibold mb-5">{t('prep.wakeModalSubtitle')}</p>
              <button
                type="button"
                disabled={wakingUpTablet}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleWakeUpTablet()
                }}
                className="w-full h-14 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] border-b-[4px] border-[#B45309] text-[#171614] font-black text-base uppercase flex items-center justify-center gap-2 cursor-pointer"
              >
                {wakingUpTablet ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sun className="w-5 h-5" />}
                <span>{wakingUpTablet ? t('prep.wakingUpTablet') : t('prep.wakeUpTablet')}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BARRA SUPERIOR UNIFICADA (KitchenHardwareTopRail 54px — Fullscreen a la izquierda igual que Tableta 1) */}
      <header
        className={`min-h-[54px] px-3 py-1.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 select-none ${
          hasAlert ? 'bg-[#3A1210] border-[#7F1D1D]' : 'bg-[#181A1F] border-[#2C3038]'
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={toggleFullscreen}
            title={t('prep.tabletMode')}
            className="h-9 px-2.5 rounded-lg bg-[#23272F] hover:bg-[#2C313B] border border-[#343944] border-b-[3px] border-b-[#090A0C] text-[#F5F2EB] text-xs font-black uppercase inline-flex items-center gap-1.5 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? t('prep.shortExitBtn') : t('prep.tablet')}</span>
          </button>

          <span className="w-1 h-5 rounded-full bg-[#C8371A]" />
          <span className="text-xs sm:text-sm font-black uppercase tracking-tight whitespace-nowrap">
            {t('prep.bodegaTitle')}
          </span>

          <div className="inline-flex items-center gap-1.5 bg-[#111214] border border-[#2C3038] rounded-lg px-2 h-9">
            <Store className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
            <select
              value={storeId}
              onChange={(e) => {
                if (!isSuper) return
                setStoreId(e.target.value)
                safeLocalStorageSet('teg_bodega_store', e.target.value)
                safeLocalStorageSet('teg_preparador_store', e.target.value)
              }}
              disabled={!isSuper}
              className="bg-transparent text-xs sm:text-sm font-extrabold text-[#F5F2EB] outline-none disabled:opacity-70"
            >
              {stores.map((s) => (
                <option key={s.id} value={String(s.id)} className="text-slate-900">
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {!isFullscreen && (
            <>
              <div className="inline-flex bg-[#111214] p-0.5 rounded-lg border border-[#2C3038] text-[11px] font-black">
                {(['manual', 'basic', 'advanced'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCardDisplayMode(m)}
                    className={`px-2 py-1 rounded-md cursor-pointer ${
                      cardDisplayMode === m ? 'bg-[#F5F2EB] text-[#111214]' : 'text-[#9CA3AF] hover:text-white'
                    }`}
                  >
                    {m === 'manual' ? t('prep.manualMode') : m === 'basic' ? t('prep.basicMode') : t('prep.advancedMode')}
                  </button>
                ))}
              </div>

              <div className="inline-flex bg-[#111214] p-0.5 rounded-lg border border-[#2C3038] text-[11px] font-black">
                <button
                  type="button"
                  onClick={() => setViewMode('30min')}
                  className={`px-2 py-1 rounded-md cursor-pointer ${
                    viewMode === '30min' ? 'bg-[#F5F2EB] text-[#111214]' : 'text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  {t('prep.view30Min')}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('tramos')}
                  className={`px-2 py-1 rounded-md cursor-pointer ${
                    viewMode === 'tramos' ? 'bg-[#F5F2EB] text-[#111214]' : 'text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  {t('prep.viewTramos')}
                </button>
              </div>

              <div className="inline-flex items-center gap-1.5 bg-[#111214] px-2 h-9 rounded-lg border border-[#2C3038]">
                <Calendar className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                <input
                  type="date"
                  value={selectedDate}
                  max={currentBusinessDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value)
                    recordUserActivity()
                  }}
                  className="bg-transparent font-extrabold text-xs text-[#F5F2EB] outline-none tabular-nums"
                />
                {!isToday && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(currentBusinessDate)
                      recordUserActivity()
                    }}
                    className="px-2 py-0.5 rounded bg-[#C8371A] text-white text-[10px] font-black uppercase cursor-pointer"
                  >
                    {t('prep.today')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {liveClockText && (
            <span className="hidden xl:inline text-xs font-black tabular-nums text-[#9CA3AF]">{liveClockText}</span>
          )}

          {/* LED REALTIME REAL */}
          <span
            className={`h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide border ${
              realtimeStatus === 'live'
                ? 'bg-[#122E1F] text-[#86EFAC] border-[#1E4D33]'
                : realtimeStatus === 'reconnecting'
                  ? 'bg-[#33230B] text-[#FCD34D] border-[#6E4912]'
                  : 'bg-[#3A1614] text-[#FCA5A5] border-[#7F1D1D]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                realtimeStatus === 'live'
                  ? 'bg-[#22C55E]'
                  : realtimeStatus === 'reconnecting'
                    ? 'bg-[#F59E0B]'
                    : 'bg-[#EF4444]'
              }`}
            />
            <span>
              {realtimeStatus === 'live'
                ? t('prep.liveIndicator')
                : realtimeStatus === 'reconnecting'
                  ? t('prep.bodegaReconnecting')
                  : t('prep.bodegaOffline')}
            </span>
          </span>

          <button
            type="button"
            onClick={() => void handleWakeUpTablet()}
            disabled={wakingUpTablet}
            title={t('prep.wakeUpTabletDesc')}
            className="h-9 px-2.5 rounded-lg bg-[#23272F] hover:bg-[#2C313B] border border-[#343944] text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${wakingUpTablet ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('prep.shortWakeBtn')}</span>
          </button>

          <button
            type="button"
            {...bindInstantTap('bodega:mute-toggle', () => setIsMuted((m) => !m))}
            className={`h-9 px-3 rounded-lg text-xs font-black uppercase inline-flex items-center gap-1.5 border cursor-pointer ${
              isMuted
                ? 'bg-[#C8371A] text-white border-[#FCA5A5]'
                : 'bg-[#122E1F] text-[#86EFAC] border-[#1E4D33]'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span>{isMuted ? t('prep.bodegaSoundMuted') : t('prep.bodegaSoundActive')}</span>
          </button>
        </div>
      </header>

      {/* ÁREA OPERATIVA PRINCIPAL */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 flex items-stretch justify-center">
        <div
          className={
            hasAlert
              ? 'w-full max-w-6xl mx-auto flex flex-col gap-4 pb-12'
              : 'w-full h-full flex flex-col lg:flex-row gap-4 items-stretch max-w-[1680px] mx-auto'
          }
        >
          {/* PANEL IZQUIERDO: 6 PREPARACIONES LENTAS (52% en Split) */}
          {!hasAlert && !isTimerMaximized && (
            <section
              key="bodega-cooking-pace-panel"
              ref={bodegaPanelRef}
              className="w-full lg:w-[52%] bg-[#181A1F] border border-[#2C3038] rounded-2xl p-3.5 sm:p-4 flex flex-col min-h-0 overflow-hidden shrink-0 lg:shrink"
            >
              {/* Cabecera-Stepper unificada */}
              <div className="flex items-center justify-between gap-2 pb-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeIndex === 0}
                  aria-label={t('prep.prevBlock')}
                  className="w-11 h-11 rounded-xl bg-[#23272F] hover:bg-[#2C313B] border border-[#343944] border-b-[3px] border-b-[#090A0C] flex items-center justify-center disabled:opacity-30 cursor-pointer shrink-0"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex-1 min-w-0 text-center">
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {currentBucket?.isCurrent ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#3A1614] border border-[#7F1D1D] text-[#FCA5A5] text-[10px] font-black uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                        {t('prep.now')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveIndex(currentBucketIndex)}
                        className="px-2 py-0.5 rounded-md bg-[#23272F] border border-[#343944] text-[10px] font-black uppercase cursor-pointer"
                      >
                        {t('prep.backToNow')}
                      </button>
                    )}

                    {currentBucket?.isPeak && (
                      <span className="px-2 py-0.5 rounded-md bg-[#C8371A] text-white text-[10px] font-black uppercase">
                        {t('prep.peak')}
                      </span>
                    )}

                    {pacePct !== 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-black tabular-nums border ${
                          pacePct > 0
                            ? 'bg-[#3A1614] text-[#FCA5A5] border-[#7F1D1D]'
                            : 'bg-[#142442] text-[#93C5FD] border-[#1E3A8A]'
                        }`}
                      >
                        {t('prep.paceChip')} {pacePct > 0 ? `+${pacePct}%` : `${pacePct}%`}
                      </span>
                    )}

                    {weatherAlert && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#33230B] text-[#FCD34D] border border-[#6E4912] text-[10px] font-black uppercase">
                        <CloudRain className="w-3 h-3" />
                        {t('prep.weatherChip')}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center justify-center gap-1.5">
                    <span className="text-sm sm:text-base font-black tabular-nums truncate">
                      {viewMode === 'tramos' && currentBucket?.name
                        ? `${currentBucket.name} · ${currentBucket.label}`
                        : currentBucket?.label || '—'}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-[#9CA3AF]">
                      ({activeIndex + 1}/{totalBuckets})
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowInfoModal(true)}
                    title={t('prep.calcInfo')}
                    className="w-10 h-11 rounded-xl bg-[#111214] hover:bg-[#23272F] border border-[#2C3038] text-[#9CA3AF] hover:text-white flex items-center justify-center cursor-pointer"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.min(carouselBuckets.length - 1, prev + 1))}
                    disabled={activeIndex >= carouselBuckets.length - 1}
                    aria-label={t('prep.nextBlock')}
                    className="w-11 h-11 rounded-xl bg-[#23272F] hover:bg-[#2C313B] border border-[#343944] border-b-[3px] border-b-[#090A0C] flex items-center justify-center disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Barra progreso 3px */}
              <div className="h-[3px] rounded-full bg-[#23272F] overflow-hidden mb-3 shrink-0">
                <div className="h-full bg-[#C8371A] transition-all duration-200" style={{ width: `${progressPct}%` }} />
              </div>

              {/* Cuadrícula 2×3 de 6 preparaciones lentas (legible a 3–4 metros en 15.6") */}
              {fetchingMeat && carouselBuckets.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#9CA3AF]">
                  <Loader2 className="w-10 h-10 animate-spin text-[#EF4444]" />
                  <p className="font-bold text-sm">{t('prep.calculatingProjections')}</p>
                </div>
              ) : (
                <div
                  ref={bodegaCarouselRef}
                  className="flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 touch-none"
                  onTouchStart={(e) => {
                    touchEndRef.current = null
                    touchStartRef.current = e.targetTouches[0]?.clientY ?? null
                  }}
                  onTouchMove={(e) => {
                    touchEndRef.current = e.targetTouches[0]?.clientY ?? null
                  }}
                  onTouchEnd={() => {
                    if (touchStartRef.current === null || touchEndRef.current === null) return
                    const distance = touchStartRef.current - touchEndRef.current
                    if (distance > 28 && activeIndex < carouselBuckets.length - 1) {
                      setActiveIndex((prev) => prev + 1)
                    } else if (distance < -28 && activeIndex > 0) {
                      setActiveIndex((prev) => prev - 1)
                    }
                    touchStartRef.current = null
                    touchEndRef.current = null
                  }}
                >
                  {currentBucket &&
                    ['CABEZA', 'LENGUA', 'CHAMPURRADO', 'AGUACATE', 'FRIJOL MOLIDO', 'ARROZ'].map((meatKey) => {
                      const m = currentBucket.data.find((d: any) => d.meat_type === meatKey) || {
                        meat_type: meatKey,
                        avg_lbs: 0,
                        interval_start: currentBucket.id,
                      }
                      const dur = viewMode === 'tramos' ? Math.max(1, Number(currentBucket.duration || 3)) : 1
                      let val = (m.avg_lbs * intelligenceAcelerador) / dur
                      let unitLab = viewMode === 'tramos' ? `${t('prep.lbs')}/h` : t('prep.lbs')
                      let typeLab = m.meat_type
                      let accent = '#C8371A'

                      if (m.meat_type === 'CHAMPURRADO') {
                        val = (m.avg_lbs * intelligenceAcelerador) / 20
                        unitLab = t('prep.bodegaUnitGallons')
                        typeLab = 'CHAMPURRADO'
                        accent = '#F59E0B'
                      } else if (m.meat_type === 'AGUACATE') {
                        val = (m.avg_lbs * intelligenceAcelerador) / 2
                        unitLab = t('prep.bodegaUnitBags')
                        typeLab = 'GUACAMOLE'
                        accent = '#22C55E'
                      } else if (m.meat_type === 'FRIJOL MOLIDO') {
                        accent = '#B45309'
                      } else if (m.meat_type === 'ARROZ') {
                        accent = '#3B82F6'
                      }

                      const maxVal = Math.max(1, Math.ceil(val))
                      const intervalStart = normTime(m.interval_start || currentBucket.id || '00:00:00')
                      const manualKey = `${intervalStart}_${m.meat_type}`
                      const manualScheduledLbs =
                        manualWeeklySchedule[manualKey] !== undefined ? manualWeeklySchedule[manualKey] : maxVal

                      const shownNumber =
                        cardDisplayMode === 'manual'
                          ? String(manualScheduledLbs)
                          : cardDisplayMode === 'basic'
                            ? String(maxVal)
                            : val.toFixed(1)

                      return (
                        <div
                          key={m.meat_type}
                          style={{ borderLeftWidth: '4px', borderLeftColor: accent }}
                          className="rounded-2xl bg-[#111214] border border-[#2C3038] border-b-[3px] border-b-[#090A0C] p-3.5 sm:p-4 flex flex-col justify-between min-h-[128px]"
                        >
                          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-[#D1D5DB]">
                            {typeLab}
                          </span>
                          <div className="flex items-baseline gap-1.5 mt-2">
                            <span className="text-4xl xl:text-5xl font-black tabular-nums leading-none text-[#F5F2EB]">
                              {shownNumber}
                            </span>
                            <span className="text-xs sm:text-sm font-extrabold text-[#9CA3AF]">{unitLab}</span>
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </section>
          )}

          {/* PANEL DERECHO (O FRANJA STICKY SUPERIOR DURANTE ALERTAS): COOPER TFS4 PERMANENTE */}
          <div
            key="persistent-bean-timer-tfs4"
            className={
              hasAlert
                ? 'w-full shrink-0 sticky top-0 z-30'
                : isTimerMaximized
                  ? 'w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-[540px]'
                  : 'w-full lg:w-[48%] flex flex-col shrink-0 lg:shrink min-h-[540px]'
            }
          >
            <BeanCookingTimerTFS4
              storeId={storeId}
              isMuted={isMuted}
              userRole={user?.role}
              compactDuringAlert={hasAlert}
              isTimerMaximized={isTimerMaximized}
              onToggleMaximize={() => setIsTimerMaximized((prev) => !prev)}
            />
          </div>

          {/* TARJETAS DE ALERTA DE LÍNEA / PROYECCIÓN CUANDO hasAlert === true (con bindInstantTap anti auto-cierre Alerta #2) */}
          {hasAlert &&
            allAlerts.map((req, idx) => {
              const isSys = Boolean((req as any).is_sys)
              return (
                <div
                  key={`line-alert-${req.id}`}
                  className={`rounded-2xl border-2 flex flex-col lg:flex-row overflow-hidden shadow-2xl shrink-0 ${
                    isSys
                      ? 'bg-[#B45309] border-[#FCD34D]'
                      : 'bg-[#C8371A] border-[#FCA5A5]'
                  } ${idx === 0 ? 'ring-4 ring-white/30' : ''}`}
                >
                  <div className="flex-1 p-5 sm:p-8 flex flex-col justify-center text-white">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="text-xs sm:text-sm font-black tracking-widest uppercase px-2.5 py-1 rounded-md bg-black/30">
                        {isSys ? t('prep.quotaReachedProjection') : t('prep.missingOnLine')}
                      </span>
                      {!isSys && req.sender_name && (
                        <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-white/15">
                          {t('prep.bodegaSentBy')}: {req.sender_name}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {req.items.map((item: string, i: number) => (
                        <span
                          key={i}
                          className="inline-block bg-white text-[#171614] font-black text-2xl sm:text-4xl px-5 py-3 rounded-xl shadow-md uppercase leading-none"
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    <p className="mt-4 text-white/85 font-bold text-sm sm:text-base flex items-center gap-2 tabular-nums">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>
                        {isSys ? t('prep.alertPrefix') : t('prep.orderPrefix')}
                        {formatAlertTimeLA(req.created_at)} · {formatElapsedShort(req.created_at)}
                      </span>
                    </p>
                  </div>

                  <div className="bg-black/25 p-5 sm:p-6 flex items-center justify-center lg:w-[320px] shrink-0">
                    <button
                      type="button"
                      {...bindInstantTap(`bodega-ack-${req.id}`, () => {
                        if (isSys) handleAcknowledgeBeverage(req)
                        else void handleAcknowledge(req.id)
                      })}
                      className="w-full min-h-[120px] lg:h-full rounded-xl bg-[#15803D] hover:bg-[#166534] border-2 border-[#86EFAC] border-b-[5px] border-b-[#0B3B1D] active:translate-y-[2px] flex flex-col items-center justify-center gap-2 text-white cursor-pointer select-none touch-manipulation"
                    >
                      <CheckCircle2 className="w-14 h-14" strokeWidth={2.8} />
                      <span className="font-black text-2xl sm:text-3xl uppercase tracking-tight">
                        {t('prep.acknowledge')}
                      </span>
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* Info Modal 100% Bilingüe ES/EN (sin texto obsoleto "Coffee" ni orbes blur-3xl) */}
      <AnimatePresence>
        {showInfoModal && (
          <div
            className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center p-4"
            onClick={() => setShowInfoModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#181A1F] border border-[#2C3038] w-full max-w-2xl max-h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#F5F2EB]"
            >
              <div className="px-5 py-4 border-b border-[#2C3038] bg-[#141619] flex items-center justify-between">
                <div>
                  <h2 className="text-lg sm:text-xl font-black">{t('prep.bodegaInfoTitle')}</h2>
                  <p className="text-xs text-[#9CA3AF] font-semibold mt-0.5">{t('prep.bodegaInfoDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInfoModal(false)}
                  className="w-9 h-9 rounded-lg bg-[#23272F] hover:bg-[#2C313B] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-3 text-xs sm:text-sm">
                <div className="p-4 rounded-xl bg-[#111214] border border-[#2C3038] space-y-1.5">
                  <h3 className="font-black text-xs uppercase text-[#FCA5A5]">{t('prep.bodegaInfoMeatsTitle')}</h3>
                  <p className="text-[#D1D5DB] leading-relaxed">{t('prep.bodegaInfoMeatsBody')}</p>
                </div>
                <div className="p-4 rounded-xl bg-[#111214] border border-[#2C3038] space-y-1.5">
                  <h3 className="font-black text-xs uppercase text-[#86EFAC]">{t('prep.bodegaInfoSidesTitle')}</h3>
                  <p className="text-[#D1D5DB] leading-relaxed">{t('prep.bodegaInfoSidesBody')}</p>
                </div>
                <div className="p-4 rounded-xl bg-[#111214] border border-[#2C3038] space-y-1.5">
                  <h3 className="font-black text-xs uppercase text-[#FCD34D]">{t('prep.bodegaInfoChampTitle')}</h3>
                  <p className="text-[#D1D5DB] leading-relaxed">{t('prep.bodegaInfoChampBody')}</p>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-[#2C3038] bg-[#141619] flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowInfoModal(false)}
                  className="h-11 px-6 rounded-xl bg-[#F5F2EB] text-[#111214] font-black text-xs uppercase cursor-pointer"
                >
                  {t('prep.understoodBtn')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

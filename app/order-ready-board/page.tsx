/**
 * @module app/order-ready-board/page
 * @description Customer-facing Order Ready Board and Voice Announcer for Tacos Gavilan.
 * Displays live orders in "In Progress" and "Ready for Pickup", and plays an audio chime (Web Audio API) plus a natural high-fidelity neural voice (Gemini Neural TTS via /api/order-ready/tts with 5 selectable voices: 3 female [Kore, Aoede, Zephyr] and 2 male [Puck, Orus]) in English, Spanish or Bilingual.
 * 
 * @businessRules
 * - **Tacos Gavilan Official Branding**: Presenta el nombre canónico y la identidad visual de la marca para displays en sucursal.
 * - **Separación de Estados**:
 *   - 'IN_PROGRESS': Órdenes en cocina recibidas pero aún no despachadas.
 *   - 'READY': Órdenes marcadas con doble tap en KDS Expediter o por API.
 * - **Motor de Audio (Ding-Dong Chime) y Catálogo de 5 Voces Neuronales**:
 *   - Sintetizador armónico de campana (Ding-Dong) con Web Audio API de baja latencia antes del llamado + Locutor(a) de alta fidelidad bilingüe secuencial (Inglés: "Order #141 is ready," + Español: "orden #141 ya está.").
 *   - 5 Voces Neuronales Gemini TTS de alta fidelidad (3 Femeninas: Kore, Aoede, Zephyr; 2 Masculinas: Puck, Orus) con persistencia en LocalStorage (`teg_order_ready_voice`).
 *   - Campanilla Ding-Dong configurable (ON/OFF) con persistencia en LocalStorage.
 *   - Text-to-Speech (TTS) configurable en Español, Inglés o Bilingüe.
 *   - Cola de audio ordenada por HORA REAL DE CIERRE (`ready_at`, el momento del doble tap en el KDS): si se cierran varias órdenes casi al mismo tiempo se anuncian en el orden en que se cerraron, sin superponerse. Un Set de ids evita anunciar dos veces la misma orden.
 *   - Precarga inteligente de audio: los clips de las órdenes en preparación se precargan en segundo plano para que el anuncio al momento de doble tap sea instantáneo. Si la red o TTS falla, se usa la voz del navegador como respaldo automático respetando el género seleccionado.
 *   - Control y Filtro de Canales:
 *     * 'FOR_HERE' (Comedor) y 'TOGO' (Para Llevar): activos por defecto.
 *     * 'DRIVE_THRU' (Auto-Servicio): botón de control maestro (ON/OFF) en encabezado y controles detallados en el panel para activar/desactivar anuncios de voz y/o visualización en pantalla, con persistencia en LocalStorage.
 *     * 'DELIVERY' (Plataformas): silenciado por defecto para no saturar el comedor.
 * - **Gobernanza de Voz Global (Solo Administrador)**:
 *   - Solo los usuarios con rol Administrador (`isAdmin`, `access.all === true`) tienen permiso para cambiar la voz anunciadora del sistema.
 *   - Al seleccionar una voz en cualquier pantalla/tienda, se guarda centralmente en la base de datos Supabase (`order_ready_settings`) y se propaga instantáneamente a todas las 15 sucursales mediante Supabase Realtime sin necesidad de recargar la página.
 *   - Los usuarios supervisores y gerentes tienen los controles bloqueados en modo solo lectura con candado explicativo, pero pueden utilizar el botón "Probar Voz" para escucharla.
 * - **Día Laboral Oficial y Turnos de Tacos Gavilan**:
 *   - El día laboral oficial inicia a las 6:00 AM y termina a las 5:59:59 AM del siguiente día (hora del Pacífico `America/Los_Angeles`).
 *   - Turno AM (Apertura): 6:00 AM - 4:59:59 PM (16:59:59).
 *   - Turno PM: 5:00 PM - 5:59:59 AM.
 *   - Aislamiento estricto por `business_date`: la ventana de consulta nunca busca órdenes antes de las 6:00 AM del día en curso (`Math.max(now - 45m, businessDayStartMs)`), evitando que la apertura de la mañana reciba o anuncie órdenes residuales del turno nocturno anterior.
 *   - Centinela automático en vivo: al dar las 6:00 AM en punto, el tablero detecta el cambio de día laboral, vacía la memoria de órdenes anunciadas y refresca el estado en limpio.
 * - **Idempotencia ante Recall de Cocina en KDS**:
 *   - Cuando los cocineros hacen "Recall" en el KDS Expediter para revisar órdenes ya despachadas y luego hacen doble tap para cerrarlas nuevamente, el sistema no vuelve a reproducir la campanilla ni la voz gracias a la triple barrera de idempotencia (Set de IDs en memoria, persistencia `announced: true` en Supabase y aislamiento por `business_date`).
 * - **Gestión de Vida Útil**: Las órdenes en 'READY' se retiran visualmente tras un tiempo configurable (por defecto 10 minutos).
 * - **Resiliencia de Red (Offline Mode)**: Detección proactiva de conectividad de red con aviso visual y caída suave a audio en caché/síntesis local si se corta la conexión a internet.
 * 
 * @dataFlow
 * - Supabase Realtime channel (`order_ready_announcements`) + Polling cada 4s (cada GET sincroniza con Toast, porque Toast no manda webhook en el doble tap) -> Actualiza estado React -> Chime + clips de voz natural (/api/order-ready/tts) -> PATCH /api/order-ready/orders (announced: true).
 * 
 * @notes
 * - Soporta integración en el panel administrativo del sistema (sidebar visible) y botón nativo para Modo TV / Pantalla Completa.
 * - Incluye selector de idioma en cabecera (ES / EN) para alternar la pantalla en inglés o español al instante.
 * - Los navegadores web requieren un primer toque o clic para desbloquear el AudioContext y SpeechSynthesis (política de autoplay de navegadores). Se incluye un banner sutil de desbloqueo.
 * - Preferencias de canales, voz y visibilidad de controles persisten en `localStorage` del dispositivo.
 * - ACCESO POR TIENDA: el selector solo lista las tiendas permitidas (GET /api/order-ready/my-stores): admin = todas,
 *   supervisor = su alcance, manager/asistente = solo la suya (selector bloqueado). Una tienda guardada/URL no permitida se
 *   reemplaza por la primera permitida y el servidor responde 403 si se intenta consultar otra.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Volume2,
  VolumeX,
  Settings,
  Sliders,
  Play,
  RefreshCw,
  Bell,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Store,
  Car,
  WifiOff,
  Lock,
  Sun,
  Moon,
  Calendar,
  FileText,
  Receipt,
  Timer,
  Utensils,
  ShoppingBag,
  Globe,
  Maximize,
  Minimize,
  X
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@supabase/supabase-js'
import ProtectedRoute from '@/components/ProtectedRoute'
import { AVAILABLE_VOICES, VoiceId, isValidVoice } from '@/lib/order-ready-tts'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { STORE_GUID_BY_CODE } from '@/lib/toast-stores'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseAnonKey)

interface OrderItem {
  id: string
  created_at: string
  business_date?: string
  store_id?: string
  store_code: string
  store_name: string
  order_number: string
  order_guid?: string
  dining_option: 'FOR_HERE' | 'TOGO' | 'DELIVERY' | 'DRIVE_THRU' | string
  customer_name: string | null
  status: 'IN_PROGRESS' | 'READY' | 'COMPLETED'
  ready_at: string | null
  announced: boolean
  items_summary: string | null
  /** Solo cliente: marca un anuncio de recordatorio (no persiste en DB) */
  _reminder?: boolean
  /** Solo cliente: clave de orden en la cola de audio (ms epoch) */
  _sortAt?: number
}

/** Umbrales Speed of Service (SOS) en segundos: 🟢 ≤210s (3:30) | 🟡 211–300s (5:00) | 🔴 >300s */
function getColorForDuration(seconds: number): 'green' | 'yellow' | 'red' {
  if (seconds <= 210) return 'green'
  if (seconds <= 300) return 'yellow'
  return 'red'
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function formatTimeOnly(timestamp: string | null | undefined): string {
  if (!timestamp) return ''
  try {
    const d = new Date(timestamp)
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  } catch {
    return ''
  }
}

/** Veces que se anuncia una orden al cerrarse con doble tap en el expediter */
const ANNOUNCE_REPEATS = 2
/** Recordatorio único (1 vez) si la orden sigue en "Listo para recoger" tras este tiempo */
const REMINDER_DELAY_MS = 90_000

const STORES_LIST = [
  { code: 'LYNWOOD', name: 'Lynwood (#14)' },
  { code: 'AZUSA', name: 'Azusa' },
  { code: 'BELL', name: 'Bell' },
  { code: 'DOWNEY', name: 'Downey' },
  { code: 'HOLLYWOOD', name: 'Hollywood' },
  { code: 'HPARK', name: 'Huntington Park' },
  { code: 'LABROADWY', name: 'LA Broadway' },
  { code: 'LACENTRAL', name: 'LA Central' },
  { code: 'LAPUENTE', name: 'La Puente' },
  { code: 'NORWALK', name: 'Norwalk' },
  { code: 'RIALTO', name: 'Rialto' },
  { code: 'SANTAANA', name: 'Santa Ana' },
  { code: 'SLAUSON', name: 'Slauson' },
  { code: 'SOUTHGATE', name: 'South Gate' },
  { code: 'WCOVINA', name: 'West Covina' }
]

function OrderReadyBoardContent() {
  const { t, language, setLanguage } = useLanguage()

  // Estado general
  const [selectedStore, setSelectedStore] = useState<string>('LYNWOOD')

  // Control de acceso por tienda: admin = todas, supervisor = su alcance, manager/asistente = solo su tienda
  const [access, setAccess] = useState<{ all: boolean; codes: string[] } | null>(null)
  const accessLoaded = access !== null
  const isAdmin = !!access?.all
  const visibleStores = access
    ? access.all
      ? STORES_LIST
      : STORES_LIST.filter((s) => access.codes.includes(s.code))
    : []
  const storeOk = accessLoaded && visibleStores.some((s) => s.code === selectedStore)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/order-ready/my-stores', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) {
          setAccess(res.ok && data.success ? { all: !!data.all, codes: data.codes || [] } : { all: false, codes: [] })
        }
      } catch {
        if (!cancelled) setAccess({ all: false, codes: [] })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Si la tienda guardada/URL no está permitida, se cambia a la primera tienda permitida
  useEffect(() => {
    if (!access) return
    if (visibleStores.length === 0) {
      setIsLoading(false)
      return
    }
    if (!visibleStores.some((s) => s.code === selectedStore)) {
      setSelectedStore(visibleStores[0].code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, selectedStore])
  const [readyOrders, setReadyOrders] = useState<OrderItem[]>([])
  const [inProgressOrders, setInProgressOrders] = useState<OrderItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<string>('')
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [businessDate, setBusinessDate] = useState<string>(() => getCaliforniaBusinessDate())
  const [shift, setShift] = useState<'AM' | 'PM'>(() => getCaliforniaShift())
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [orderDetailData, setOrderDetailData] = useState<{
    loading: boolean
    checkId: string
    storeName: string
    cajeraName: string
    data?: any
    error?: string
  } | null>(null)
  const businessDateRef = useRef<string>(businessDate)
  const fetchOrdersRef = useRef<((syncToast?: boolean) => Promise<void>) | null>(null)

  // Configuración de Audio y Voz
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false)
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [voiceVolume, setVoiceVolume] = useState<number>(1.0)
  const [voiceSpeed, setVoiceSpeed] = useState<number>(0.92)
  const [voiceLanguage, setVoiceLanguage] = useState<'es' | 'en' | 'bilingual'>('bilingual')
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>('Kore')
  const [isSavingVoice, setIsSavingVoice] = useState<boolean>(false)
  const [isTestingVoice, setIsTestingVoice] = useState<boolean>(false)
  const [isOnline, setIsOnline] = useState<boolean>(true)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [announceToGo, setAnnounceToGo] = useState<boolean>(true)
  const [announceForHere, setAnnounceForHere] = useState<boolean>(true)
  const [announceDriveThru, setAnnounceDriveThru] = useState<boolean>(true)
  const [showDriveThru, setShowDriveThru] = useState<boolean>(true)
  const [announceDelivery, setAnnounceDelivery] = useState<boolean>(false)
  const [enableChime, setEnableChime] = useState<boolean>(true)

  // Cargar configuración global de voz desde Supabase (/api/order-ready/settings)
  const fetchGlobalSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/order-ready/settings', { cache: 'no-store' })
      const data = await res.json()
      if (data.success && data.settings?.voice && isValidVoice(data.settings.voice)) {
        setSelectedVoice(data.settings.voice)
        if (typeof window !== 'undefined') {
          localStorage.setItem('teg_order_ready_voice', data.settings.voice)
        }
      }
    } catch (e) {
      console.warn('Error loading global order ready settings:', e)
    }
  }, [])

  useEffect(() => {
    fetchGlobalSettings()
  }, [fetchGlobalSettings])

  // Cargar preferencias locales guardadas en LocalStorage y URL Query Param (?store=...)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const storeParam = params.get('store') || params.get('storeCode')
      if (storeParam) {
        const found = STORES_LIST.find(s => s.code.toUpperCase() === storeParam.toUpperCase())
        if (found) {
          setSelectedStore(found.code)
          localStorage.setItem('teg_order_ready_store', found.code)
        }
      } else {
        const savedStore = localStorage.getItem('teg_order_ready_store')
        if (savedStore) {
          const found = STORES_LIST.find(s => s.code === savedStore)
          if (found) setSelectedStore(found.code)
        }
      }

      const savedVoice = localStorage.getItem('teg_order_ready_voice')
      if (savedVoice && isValidVoice(savedVoice)) {
        setSelectedVoice(savedVoice)
      }

      const savedAnnounceDT = localStorage.getItem('teg_order_ready_announce_dt')
      if (savedAnnounceDT !== null) setAnnounceDriveThru(savedAnnounceDT === 'true')
      const savedShowDT = localStorage.getItem('teg_order_ready_show_dt')
      if (savedShowDT !== null) setShowDriveThru(savedShowDT === 'true')
      const savedAnnounceTG = localStorage.getItem('teg_order_ready_announce_tg')
      if (savedAnnounceTG !== null) setAnnounceToGo(savedAnnounceTG === 'true')
      const savedAnnounceFH = localStorage.getItem('teg_order_ready_announce_fh')
      if (savedAnnounceFH !== null) setAnnounceForHere(savedAnnounceFH === 'true')
      const savedAnnounceDel = localStorage.getItem('teg_order_ready_announce_del')
      if (savedAnnounceDel !== null) setAnnounceDelivery(savedAnnounceDel === 'true')
      const savedChime = localStorage.getItem('teg_order_ready_chime')
      if (savedChime !== null) setEnableChime(savedChime === 'true')
    }
  }, [])

  // Monitorear conectividad a internet para avisar en UI si la red cae
  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsOnline(navigator.onLine)
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const handleStoreChange = (storeCode: string) => {
    setSelectedStore(storeCode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_store', storeCode)
      const url = new URL(window.location.href)
      url.searchParams.set('store', storeCode)
      window.history.replaceState({}, '', url.toString())
    }
  }

  // Cambiar voz: SOLO ADMIN puede cambiarla, y se propaga a todas las tiendas via DB
  const handleVoiceChange = async (voice: VoiceId) => {
    if (!isAdmin) {
      alert(t('orderReadyBoard.voice_admin_only'))
      return
    }

    setSelectedVoice(voice)
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_voice', voice)
    }

    setIsSavingVoice(true)
    try {
      const res = await fetch('/api/order-ready/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al guardar la voz global')
      }
    } catch (err: any) {
      console.error('Error saving global voice:', err)
      alert(err.message || 'Error al actualizar la voz global')
      fetchGlobalSettings()
    } finally {
      setIsSavingVoice(false)
    }
  }

  const updateAnnounceDriveThru = (val: boolean) => {
    setAnnounceDriveThru(val)
    if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_announce_dt', String(val))
  }

  const updateShowDriveThru = (val: boolean) => {
    setShowDriveThru(val)
    if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_show_dt', String(val))
  }

  const updateEnableChime = (val: boolean) => {
    setEnableChime(val)
    if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_chime', String(val))
  }

  const toggleDriveThruMaster = () => {
    const nextVal = !(announceDriveThru || showDriveThru)
    updateAnnounceDriveThru(nextVal)
    updateShowDriveThru(nextVal)
  }

  // Fullscreen container and state (Modo TV)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  // Sincronizar estado con eventos nativos del navegador (F11, ESC)
  useEffect(() => {
    const handleFsChange = () => {
      const doc = document as any
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    document.addEventListener('webkitfullscreenchange', handleFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
      document.removeEventListener('webkitfullscreenchange', handleFsChange)
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
        setTimeout(() => { if (!doc.webkitFullscreenElement) setIsFullscreen(true) }, 200)
      } else {
        setIsFullscreen(true)
      }
      setShowControls(false)
    } else {
      if (doc.exitFullscreen && doc.fullscreenElement) {
        doc.exitFullscreen().catch(() => setIsFullscreen(false))
      } else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
        doc.webkitExitFullscreen()
      } else {
        setIsFullscreen(false)
      }
    }
  }

  // Paneles de control y testing (persistente en localStorage, visible por defecto en dashboard)
  const [showControls, setShowControls] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teg_order_ready_show_controls')
      if (saved !== null) return saved === 'true'
      return window.innerWidth >= 1024
    }
    return true
  })

  const toggleControls = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setShowControls((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('teg_order_ready_show_controls', String(next))
      }
      return next
    })
  }

  const [activeSpeech, setActiveSpeech] = useState<string | null>(null)

  // Referencias para Audio Engine
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<OrderItem[]>([])
  const isPlayingRef = useRef<boolean>(false)
  // Ids ya encolados/anunciados en este dispositivo (evita repetir el anuncio mientras el PATCH aún no llega)
  const announcedIdsRef = useRef<Set<string>>(new Set())
  const readyIdsRef = useRef<Set<string>>(new Set())
  const reminderTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const fetchingRef = useRef<boolean>(false)
  const enqueueReminderRef = useRef<((o: OrderItem) => void) | null>(null)
  // Clips de voz natural ya descargados: "en:141" -> objectURL
  const clipCacheRef = useRef<Map<string, Promise<string | null>>>(new Map())
  const prefetchRunningRef = useRef<boolean>(false)
  const ttsFailUntilRef = useRef<number>(0)

  // Cargar catálogo de voces del navegador y detectar cambios de voces
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        const v = window.speechSynthesis.getVoices()
        if (v && v.length > 0) {
          setAvailableVoices(v)
        }
      }
      loadVoices()
      window.speechSynthesis.onvoiceschanged = loadVoices
      return () => {
        window.speechSynthesis.onvoiceschanged = null
      }
    }
  }, [])

  // Reloj local en vivo con centinela automático de cambio de día laboral (6:00 AM)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setNowMs(now.getTime())
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      )

      // Centinela de cambio de día laboral (corte estricto de las 6:00 AM en punto)
      const currentBDate = getCaliforniaBusinessDate(now)
      const currentShift = getCaliforniaShift(now)
      if (businessDateRef.current && currentBDate !== businessDateRef.current) {
        businessDateRef.current = currentBDate
        setBusinessDate(currentBDate)
        announcedIdsRef.current.clear()
        readyIdsRef.current.clear()
        setReadyOrders([])
        setInProgressOrders([])
        fetchOrdersRef.current?.(true)
      }
      setShift(currentShift)
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  // Inicializar o Desbloquear AudioContext al hacer clic en cualquier lugar
  const unlockAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (AudioContextClass) {
          audioCtxRef.current = new AudioContextClass()
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      setAudioUnlocked(true)
    } catch (e) {
      console.warn('Audio unlock error:', e)
    }
  }, [])

  // Función para sintetizar un Chime de alta fidelidad tipo campanilla ("Ding-Dong")
  const playChime = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      try {
        if (!audioCtxRef.current) {
          unlockAudio()
        }
        const ctx = audioCtxRef.current
        if (!ctx) {
          resolve()
          return
        }
        // Tras horas de inactividad el navegador puede suspender el AudioContext: reintentar reanudarlo
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {})
          if (ctx.state === 'suspended') {
            resolve()
            return
          }
        }

        const now = ctx.currentTime

        // Tono 1: D5 (587.33 Hz)
        const osc1 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(587.33, now)
        gain1.gain.setValueAtTime(0.28 * voiceVolume, now)
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
        osc1.connect(gain1)
        gain1.connect(ctx.destination)
        osc1.start(now)
        osc1.stop(now + 0.6)

        // Tono 2: A5 (880 Hz) con leve retraso
        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(880, now + 0.18)
        gain2.gain.setValueAtTime(0.35 * voiceVolume, now + 0.18)
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9)
        osc2.connect(gain2)
        gain2.connect(ctx.destination)
        osc2.start(now + 0.18)
        osc2.stop(now + 0.9)

        setTimeout(() => {
          resolve()
        }, 850)
      } catch (err) {
        console.warn('Chime error:', err)
        resolve()
      }
    })
  }, [unlockAudio, voiceVolume])

  // Helper para seleccionar la mejor voz del navegador según el género configurado (respaldo)
  const getBestBrowserVoice = useCallback(
    (lang: 'en' | 'es', voices: SpeechSynthesisVoice[], voiceId: VoiceId = selectedVoice): SpeechSynthesisVoice | null => {
      const langPrefix = lang === 'es' ? 'es' : 'en'
      const matchingVoices = voices.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix))
      const isMaleTarget = voiceId === 'Puck' || voiceId === 'Orus'

      if (isMaleTarget) {
        const maleKeywords = ['male', 'hombre', 'david', 'jorge', 'diego', 'pablo', 'raul', 'guy', 'mark', 'george', 'miguel']
        const namedMale = matchingVoices.find(v => {
          const lower = v.name.toLowerCase()
          return maleKeywords.some(kw => lower.includes(kw))
        })
        if (namedMale) return namedMale
        return matchingVoices[0] || null
      }

      // 1. Prioridad absoluta: Voces Neuronales/Naturales Femeninas
      const premiumKeywords = ['natural', 'neural', 'online', 'dalia', 'jenny', 'samantha', 'victoria', 'paulina', 'sabina', 'monica', 'google']
      const premiumFemale = matchingVoices.find(v => {
        const lower = v.name.toLowerCase()
        const isMale = lower.includes('male') || lower.includes('david') || lower.includes('george') || 
                       lower.includes('jorge') || lower.includes('diego') || lower.includes('pablo') ||
                       lower.includes('guy') || lower.includes('raul')
        if (isMale) return false
        return premiumKeywords.some(kw => lower.includes(kw))
      })
      if (premiumFemale) return premiumFemale

      // 2. Voces femeninas identificadas
      const femaleKeywords = [
        'female', 'woman', 'mujer', 'femenina',
        'samantha', 'victoria', 'karen', 'zira', 'jenny', 'monica', 'paulina', 
        'helena', 'sabina', 'dalia', 'laura', 'rosa', 'francisca', 'sofia', 'elena', 
        'maria', 'luciana', 'mia', 'ava', 'allison', 'angie', 'serena', 'susan'
      ]
      const namedFemale = matchingVoices.find(v => {
        const lower = v.name.toLowerCase()
        return femaleKeywords.some(kw => lower.includes(kw))
      })
      if (namedFemale) return namedFemale

      // 3. Descartar cualquier voz con etiqueta masculina
      const nonMale = matchingVoices.find(v => {
        const lower = v.name.toLowerCase()
        const isMale = lower.includes('male') || lower.includes('david') || lower.includes('george') || 
                       lower.includes('jorge') || lower.includes('diego') || lower.includes('pablo') ||
                       lower.includes('guy') || lower.includes('mark') || lower.includes('raul')
        return !isMale
      })
      if (nonMale) return nonMale

      return matchingVoices[0] || null
    },
    [selectedVoice]
  )

  // RESPALDO: voz del navegador (speechSynthesis). Solo se usa si el TTS neuronal no está disponible.
  const speakOrderBrowser = useCallback(
    (order: OrderItem, voiceId: VoiceId = selectedVoice): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          resolve()
          return
        }

        const num = order.order_number
        const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices()
        const enVoice = getBestBrowserVoice('en', voices, voiceId)
        const esVoice = getBestBrowserVoice('es', voices, voiceId)

        if (voiceLanguage === 'bilingual') {
          // Frase exacta: "Order #141 is ready, orden #141 ya está."
          const displayPhrase = `Order #${num} is ready, orden #${num} ya está.`
          setActiveSpeech(displayPhrase)

          // Fase 1: Inglés ("Order 141 is ready,")
          const uttEn = new SpeechSynthesisUtterance(`Order ${num} is ready,`)
          uttEn.rate = voiceSpeed
          uttEn.volume = isMuted ? 0 : voiceVolume
          uttEn.lang = 'en-US'
          if (enVoice) uttEn.voice = enVoice

          // Fase 2: Español ("orden 141 ya está.")
          const uttEs = new SpeechSynthesisUtterance(`orden ${num}, ya está.`)
          uttEs.rate = voiceSpeed
          uttEs.volume = isMuted ? 0 : voiceVolume
          uttEs.lang = 'es-MX'
          if (esVoice) uttEs.voice = esVoice

          uttEn.onend = () => {
            // Pausa fluida entre inglés y español
            setTimeout(() => {
              window.speechSynthesis.speak(uttEs)
            }, 200)
          }

          uttEn.onerror = () => {
            window.speechSynthesis.speak(uttEs)
          }

          uttEs.onend = () => {
            setActiveSpeech(null)
            setTimeout(resolve, 500)
          }

          uttEs.onerror = () => {
            setActiveSpeech(null)
            resolve()
          }

          window.speechSynthesis.speak(uttEn)
        } else if (voiceLanguage === 'en') {
          const phrase = `Order #${num} is ready.`
          setActiveSpeech(phrase)
          const utt = new SpeechSynthesisUtterance(`Order ${num} is ready.`)
          utt.rate = voiceSpeed
          utt.volume = isMuted ? 0 : voiceVolume
          utt.lang = 'en-US'
          if (enVoice) utt.voice = enVoice
          utt.onend = () => {
            setActiveSpeech(null)
            setTimeout(resolve, 500)
          }
          utt.onerror = () => {
            setActiveSpeech(null)
            resolve()
          }
          window.speechSynthesis.speak(utt)
        } else {
          // Solo español
          const phrase = `Orden #${num}, ya está.`
          setActiveSpeech(phrase)
          const utt = new SpeechSynthesisUtterance(`Orden ${num}, ya está.`)
          utt.rate = voiceSpeed
          utt.volume = isMuted ? 0 : voiceVolume
          utt.lang = 'es-MX'
          if (esVoice) utt.voice = esVoice
          utt.onend = () => {
            setActiveSpeech(null)
            setTimeout(resolve, 500)
          }
          utt.onerror = () => {
            setActiveSpeech(null)
            resolve()
          }
          window.speechSynthesis.speak(utt)
        }
      })
    },
    [availableVoices, getBestBrowserVoice, isMuted, voiceVolume, voiceSpeed, voiceLanguage, selectedVoice]
  )

  // ── Voz natural (Gemini TTS con 5 opciones de voces de alta fidelidad) ──
  const getClipUrl = useCallback((lang: 'en' | 'es', num: string, voiceOverride?: VoiceId): Promise<string | null> => {
    if (Date.now() < ttsFailUntilRef.current) return Promise.resolve(null)
    const voice = voiceOverride || selectedVoice
    const key = `${voice}:${lang}:${num}`
    const cached = clipCacheRef.current.get(key)
    if (cached) return cached

    const job = (async (): Promise<string | null> => {
      try {
        const res = await fetch(`/api/order-ready/tts?n=${num}&lang=${lang}&voice=${voice}`)
        if (!res.ok) throw new Error('tts ' + res.status)
        return URL.createObjectURL(await res.blob())
      } catch (e) {
        console.warn('TTS no disponible, se usará la voz del navegador:', e)
        clipCacheRef.current.delete(key)
        ttsFailUntilRef.current = Date.now() + 60000 // no insistir durante 1 min
        return null
      }
    })()
    clipCacheRef.current.set(key, job)

    // Límite de memoria: descartar el clip más antiguo
    if (clipCacheRef.current.size > 300) {
      const oldest = clipCacheRef.current.keys().next().value
      if (oldest) {
        clipCacheRef.current.get(oldest)?.then((u) => { if (u) URL.revokeObjectURL(u) })
        clipCacheRef.current.delete(oldest)
      }
    }
    return job
  }, [selectedVoice])

  const clipLangs = useCallback((): Array<'en' | 'es'> => {
    return voiceLanguage === 'bilingual' ? ['en', 'es'] : [voiceLanguage]
  }, [voiceLanguage])

  const playClip = useCallback(
    (url: string): Promise<boolean> =>
      new Promise((resolve) => {
        const audio = new Audio(url)
        audio.volume = isMuted ? 0 : Math.min(1, Math.max(0, voiceVolume))
        let done = false
        const finish = (ok: boolean) => {
          if (!done) {
            done = true
            // Liberar el elemento de audio (importante en turnos largos / PCs viejas)
            audio.onended = null
            audio.onerror = null
            try {
              audio.removeAttribute('src')
              audio.load()
            } catch {}
            resolve(ok)
          }
        }
        audio.onended = () => finish(true)
        audio.onerror = () => finish(false)
        setTimeout(() => {
          if (!done) audio.pause()
          finish(false)
        }, 15000)
        audio.play().catch(() => finish(false))
      }),
    [isMuted, voiceVolume]
  )

  // Anuncia la orden con la voz natural seleccionada; si no hay TTS, cae a la voz del navegador
  const speakOrder = useCallback(
    async (order: OrderItem, repeats: number = 1, voiceOverride?: VoiceId): Promise<void> => {
      const voice = voiceOverride || selectedVoice
      const isNumeric = /^\d{1,4}$/.test(order.order_number)
      if (!isNumeric) return speakOrderBrowser(order, voice)

      const num = String(parseInt(order.order_number, 10))
      const langs = clipLangs()
      const urls = await Promise.all(langs.map((l) => getClipUrl(l, num, voice)))
      if (urls.some((u) => !u)) return speakOrderBrowser(order, voice)

      const phrase =
        voiceLanguage === 'bilingual'
          ? 'Order #' + num + ' is ready, orden #' + num + ' ya está.'
          : voiceLanguage === 'en'
            ? 'Order #' + num + ' is ready.'
            : 'Orden #' + num + ', ya está.'

      for (let rep = 0; rep < repeats; rep++) {
        setActiveSpeech(phrase)
        for (let i = 0; i < urls.length; i++) {
          const ok = await playClip(urls[i] as string)
          if (!ok) {
            setActiveSpeech(null)
            // Si ni siquiera sonó el primer clip de la primera vuelta, usar el respaldo
            if (i === 0 && rep === 0) return speakOrderBrowser(order, voice)
            return
          }
        }
        setActiveSpeech(null)
        // Pausa entre repeticiones
        if (rep < repeats - 1) await new Promise((r) => setTimeout(r, 700))
      }
      await new Promise((r) => setTimeout(r, 400))
    },
    [clipLangs, getClipUrl, playClip, speakOrderBrowser, voiceLanguage, selectedVoice]
  )

  // Procesador de la cola de audio - Campanilla Ding-Dong + voz natural seleccionada, en orden de cierre
  const processAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || isMuted) {
      return
    }

    isPlayingRef.current = true
    const nextOrder = audioQueueRef.current.shift()

    if (nextOrder) {
      try {
      // Descargar los clips mientras suena la campanilla (si ya están precargados es inmediato)
      if (/^\d{1,4}$/.test(nextOrder.order_number)) {
        const num = String(parseInt(nextOrder.order_number, 10))
        clipLangs().forEach((l) => { void getClipUrl(l, num, selectedVoice) })
      }

      // 1. Tocar campanilla Ding-Dong si está habilitada
      if (enableChime) {
        await playChime()
      }

      // 2. Anunciar con la voz seleccionada: 2 veces al cerrar la orden, 1 vez en el recordatorio
      const isReminder = !!nextOrder._reminder
      await speakOrder(nextOrder, isReminder ? 1 : ANNOUNCE_REPEATS, selectedVoice)

      if (!isReminder) {
        // 3. Marcar como anunciada en backend
        try {
          await fetch('/api/order-ready/orders', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: nextOrder.id, announced: true })
          })
        } catch (e) {
          console.warn('Error marking announced:', e)
        }

      // 4. Programar UN solo recordatorio si la orden sigue en "Listo para recoger".
        // (Toast no informa cuando el cliente la recoge: es solo una regla de tiempo.)
        const orderId = nextOrder.id
        const timer = setTimeout(() => {
          reminderTimersRef.current.delete(timer)
          if (!readyIdsRef.current.has(orderId)) return
          const latest = nextOrder
          enqueueReminderRef.current?.({ ...latest, _reminder: true, _sortAt: Date.now() })
        }, REMINDER_DELAY_MS)
        reminderTimersRef.current.add(timer)
      }
      } catch (e) {
        // Un error de audio NUNCA debe congelar la cola: se registra y se sigue con la siguiente
        console.warn('Error announcing order:', e)
        setActiveSpeech(null)
      }
    }

    isPlayingRef.current = false

    // Continuar procesando si hay más órdenes en la cola
    if (audioQueueRef.current.length > 0) {
      processAudioQueue()
    }
  }, [isMuted, enableChime, playChime, speakOrder, clipLangs, getClipUrl])

  // Encolar una orden lista. La cola se mantiene ORDENADA por hora real de cierre (ready_at ascendente)
  const enqueueAnnouncement = useCallback(
    (order: OrderItem) => {
      // Filtrar según canales habilitados
      if (order.dining_option === 'TOGO' && !announceToGo) return
      if (order.dining_option === 'FOR_HERE' && !announceForHere) return
      if (order.dining_option === 'DRIVE_THRU' && !announceDriveThru) return
      if (order.dining_option === 'DELIVERY' && !announceDelivery) return

      // Una orden se anuncia una sola vez por dispositivo (aunque el PATCH tarde en llegar)
      if (announcedIdsRef.current.has(order.id)) return
      announcedIdsRef.current.add(order.id)

      audioQueueRef.current.push(order)
      audioQueueRef.current.sort(
        (a, b) =>
          (a._sortAt ?? Date.parse(a.ready_at || a.created_at)) -
          (b._sortAt ?? Date.parse(b.ready_at || b.created_at))
      )

      // Microtask: permite que se encolen todas las órdenes del mismo ciclo antes de arrancar la primera
      queueMicrotask(() => {
        processAudioQueue()
      })
    },
    [announceToGo, announceForHere, announceDriveThru, announceDelivery, processAudioQueue]
  )

  // Recordatorio: se encola sin el filtro de "ya anunciada" (se permite una sola vez por orden)
  const enqueueReminder = useCallback(
    (order: OrderItem) => {
      audioQueueRef.current.push(order)
      audioQueueRef.current.sort(
        (a, b) =>
          (a._sortAt ?? Date.parse(a.ready_at || a.created_at)) -
          (b._sortAt ?? Date.parse(b.ready_at || b.created_at))
      )
      queueMicrotask(() => {
        processAudioQueue()
      })
    },
    [processAudioQueue]
  )

  useEffect(() => {
    enqueueReminderRef.current = enqueueReminder
  }, [enqueueReminder])

  // Mantener la pantalla encendida (evita que la PC/tablet se duerma durante el turno)
  useEffect(() => {
    let lock: any = null
    let cancelled = false
    const acquire = async () => {
      try {
        const nav = navigator as any
        if (nav.wakeLock && document.visibilityState === 'visible') {
          lock = await nav.wakeLock.request('screen')
        }
      } catch {
        // No soportado o denegado: no es crítico
      }
    }
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      try { lock?.release?.() } catch {}
    }
  }, [])

  // Recorte de memoria: el set de órdenes ya anunciadas no debe crecer sin límite en turnos de 15+ horas
  useEffect(() => {
    const trim = setInterval(() => {
      const set = announcedIdsRef.current
      if (set.size > 500) {
        const keep = Array.from(set).slice(-250)
        announcedIdsRef.current = new Set(keep)
      }
    }, 10 * 60 * 1000)
    return () => clearInterval(trim)
  }, [])

  // Limpiar timers de recordatorio al salir de la página
  useEffect(() => {
    const timers = reminderTimersRef.current
    return () => {
      timers.forEach((tm) => clearTimeout(tm))
      timers.clear()
    }
  }, [])

  // Cargar órdenes desde el backend
  const fetchOrders = useCallback(async (syncToast = false) => {
    // No consultar hasta confirmar que el usuario tiene permiso para esta tienda
    if (!storeOk) return
    // Evita peticiones encimadas si la red/PC va lenta (una a la vez)
    if (fetchingRef.current && !syncToast) return
    fetchingRef.current = true
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), 15000)
    try {
      if (syncToast) setIsSyncing(true)
      const res = await fetch(`/api/order-ready/orders?storeCode=${selectedStore}&syncToast=${syncToast}&minutes=45`, {
        signal: controller.signal,
        cache: 'no-store'
      })
      const data = await res.json()

      if (data.success) {
        if (data.businessDate) {
          setBusinessDate(data.businessDate)
          businessDateRef.current = data.businessDate
        }
        if (data.shift) {
          setShift(data.shift)
        }

        const ready: OrderItem[] = data.readyOrders || []
        const inProgress: OrderItem[] = data.inProgressOrders || []

        setReadyOrders(ready)
        setInProgressOrders(inProgress)
        readyIdsRef.current = new Set(ready.map(o => o.id))

        // Órdenes listas pendientes de anunciar: en el orden en que se cerraron en el KDS
        ready
          .filter(ord => !ord.announced)
          .sort((a, b) => Date.parse(a.ready_at || a.created_at) - Date.parse(b.ready_at || b.created_at))
          .forEach(ord => enqueueAnnouncement(ord))
      }
    } catch (e) {
      console.error('Error fetching orders:', e)
    } finally {
      clearTimeout(abortTimer)
      fetchingRef.current = false
      setIsLoading(false)
      setIsSyncing(false)
    }
  }, [selectedStore, storeOk, enqueueAnnouncement])

  // Mantener referencia actual de fetchOrders para el centinela de las 6:00 AM
  useEffect(() => {
    fetchOrdersRef.current = fetchOrders
  }, [fetchOrders])

  // Polling cada 4 segundos + Carga inicial
  useEffect(() => {
    fetchOrders(false)
    const interval = setInterval(() => {
      fetchOrders(false)
    }, 4000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  // Precargar la voz de las órdenes en preparación (las más antiguas primero) para que el anuncio sea instantáneo
  useEffect(() => {
    if (prefetchRunningRef.current || inProgressOrders.length === 0) return
    prefetchRunningRef.current = true
    const targets = [...inProgressOrders].reverse().slice(0, 12)
    const langs = clipLangs()
    ;(async () => {
      try {
        for (const o of targets) {
          if (!/^\d{1,4}$/.test(o.order_number)) continue
          const num = String(parseInt(o.order_number, 10))
          for (const l of langs) await getClipUrl(l, num, selectedVoice)
        }
      } finally {
        prefetchRunningRef.current = false
      }
    })()
  }, [inProgressOrders, clipLangs, getClipUrl, selectedVoice])

  // Suscripción a Supabase Realtime (órdenes y configuración global de voz de la cadena)
  useEffect(() => {
    const channel = supabase
      .channel('order-ready-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_ready_announcements'
        },
        (payload) => {
          const row = (payload.new || payload.old) as OrderItem
          if (row && row.store_code === selectedStore) {
            fetchOrders(false)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_ready_settings'
        },
        (payload) => {
          const newRow = payload.new as any
          if (newRow && newRow.voice && isValidVoice(newRow.voice)) {
            setSelectedVoice(newRow.voice)
            if (typeof window !== 'undefined') {
              localStorage.setItem('teg_order_ready_voice', newRow.voice)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedStore, fetchOrders])

  // Probar campanilla Ding-Dong y voz natural con la voz seleccionada
  const handleTestSound = async (voiceToTest?: VoiceId) => {
    unlockAudio()
    const voice = voiceToTest || selectedVoice
    setIsTestingVoice(true)
    try {
      if (enableChime) {
        await playChime()
      }
      const testOrder: OrderItem = {
        id: 'test-' + Date.now(),
        created_at: new Date().toISOString(),
        store_code: selectedStore,
        store_name: selectedStore,
        order_number: '141',
        dining_option: 'TOGO',
        customer_name: 'Cliente Prueba',
        status: 'READY',
        ready_at: new Date().toISOString(),
        announced: false,
        items_summary: '3 Tacos Asada, 1 Coca Cola'
      }
      await speakOrder(testOrder, 1, voice)
    } finally {
      setIsTestingVoice(false)
    }
  }

  // Simular creación de orden de prueba
  const handleSimulateOrder = async (diningOption: 'TOGO' | 'FOR_HERE' | 'DRIVE_THRU' = 'TOGO') => {
    unlockAudio()
    const randomNum = Math.floor(Math.random() * 800) + 100
    try {
      const res = await fetch('/api/order-ready/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode: selectedStore,
          orderNumber: String(randomNum),
          diningOption,
          status: 'READY',
          customer_name: diningOption === 'TOGO' ? 'Para Llevar' : diningOption === 'FOR_HERE' ? 'Comer Aquí' : 'Drive-Thru'
        })
      })
      const data = await res.json()
      if (data.success && data.order) {
        enqueueAnnouncement(data.order)
        fetchOrders(false)
      }
    } catch (e) {
      console.error('Error simulating order:', e)
    }
  }

  // Helper para clases visuales de Speed of Service (SOS)
  const getSosBadgeClasses = (color: 'green' | 'yellow' | 'red') => {
    if (color === 'green') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
    if (color === 'yellow') return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    return 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
  }

  // Abrir modal de ticket idéntico al módulo de Drive-Thru
  const handleOrderClick = useCallback((order: OrderItem) => {
    const storeId = order.store_id || STORE_GUID_BY_CODE[order.store_code] || ''
    const orderGuid = order.order_guid || ''

    setOrderDetailData({
      loading: true,
      checkId: order.order_number,
      storeName: order.store_name || selectedStore,
      cajeraName: order.dining_option === 'DRIVE_THRU' ? 'Drive-Thru' : 'Caja'
    })

    if (!orderGuid || !storeId) {
      setOrderDetailData(prev =>
        prev
          ? {
              ...prev,
              loading: false,
              error:
                language === 'es'
                  ? 'No se encontró el identificador GUID de la orden en Toast'
                  : 'Order GUID identifier not found in Toast POS'
            }
          : null
      )
      return
    }

    fetch(`/api/toast-order-detail?guid=${orderGuid}&storeId=${storeId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setOrderDetailData(prev => (prev ? { ...prev, loading: false, error: data.error } : null))
        } else {
          setOrderDetailData(prev => (prev ? { ...prev, loading: false, data: data.order } : null))
        }
      })
      .catch(err => {
        setOrderDetailData(prev => (prev ? { ...prev, loading: false, error: err.message } : null))
      })
  }, [language, selectedStore])

  // Re-anunciar orden manualmente a solicitud del usuario desde la columna LISTAS PARA RECOGER
  const handleReplayVoice = async (order: OrderItem) => {
    unlockAudio()
    setReplayingId(order.id)
    try {
      if (enableChime) {
        await playChime()
      }
      await speakOrder(order, 1, selectedVoice)
    } catch (err) {
      console.warn('Error replaying voice announcement:', err)
    } finally {
      setReplayingId(null)
    }
  }

  // Helper para el badge de Dining Option con ícono y traducción
  const renderDiningBadge = (dining: string) => {
    if (dining === 'FOR_HERE') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
          <Utensils className="w-3.5 h-3.5" />
          <span>{t('orderReadyBoard.for_here_badge')}</span>
        </span>
      )
    }
    if (dining === 'DRIVE_THRU') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/40">
          <Car className="w-3.5 h-3.5" />
          <span>{t('orderReadyBoard.dt_badge')}</span>
        </span>
      )
    }
    if (dining === 'DELIVERY') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40">
          <span>🛵</span>
          <span>{t('orderReadyBoard.delivery_badge')}</span>
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
        <ShoppingBag className="w-3.5 h-3.5" />
        <span>{t('orderReadyBoard.to_go_badge')}</span>
      </span>
    )
  }

  return (
    <div
      ref={containerRef}
      onClick={unlockAudio}
      className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden relative transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 w-screen h-screen rounded-none border-0' : 'rounded-2xl border border-slate-800/80 shadow-2xl'
      }`}
    >
      {/* Banner de Activación de Audio (si aún no se ha interactuado) */}
      {!audioUnlocked && (
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white px-4 py-2.5 text-center text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg animate-pulse z-50">
          <Bell className="w-4 h-4 animate-bounce" />
          <span>{t('orderReadyBoard.enable_audio_prompt')}</span>
          <span className="underline ml-2 bg-white/20 px-2 py-0.5 rounded text-xs">
            {t('orderReadyBoard.click_to_enable_audio')}
          </span>
        </div>
      )}

      {/* Top Header / Barra Superior */}
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
        {/* Logo e Identidad */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center font-black text-xl text-white shadow-lg border border-amber-500/30 tracking-tight shrink-0">
            TG
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white uppercase">
                Tacos Gavilan
              </h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-widest hidden sm:inline">
                {t('orderReadyBoard.title')}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-emerald-400" />
                {accessLoaded && visibleStores.length === 0 ? (
                  <span className="text-xs font-bold text-amber-400">{t('orderReadyBoard.no_store_assigned')}</span>
                ) : (
                  <select
                    value={selectedStore}
                    onChange={(e) => handleStoreChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={visibleStores.length <= 1}
                    className="bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-white font-bold text-xs rounded-lg px-2.5 py-1 border border-slate-700 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-sm transition disabled:opacity-80 disabled:cursor-default"
                  >
                    {visibleStores.map((s) => (
                      <option key={s.code} value={s.code} className="bg-slate-900 text-white">
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Selector Rápido de Voz en Cabecera (Solo Admin puede cambiarla) */}
              {isAdmin ? (
                <div className="flex items-center gap-1 bg-slate-800/90 hover:bg-slate-800 rounded-lg px-2 py-1 border border-slate-700 shadow-sm transition">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <select
                    value={selectedVoice}
                    onChange={(e) => handleVoiceChange(e.target.value as VoiceId)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={isSavingVoice}
                    title={t('orderReadyBoard.voice_speaker')}
                    className="bg-transparent text-slate-200 hover:text-white font-bold text-xs focus:outline-none cursor-pointer"
                  >
                    {AVAILABLE_VOICES.map((v) => (
                      <option key={v.id} value={v.id} className="bg-slate-900 text-white font-medium">
                        {v.gender === 'female' ? '👩' : '👨'} {v.name} ({v.gender === 'female' ? (language === 'es' ? 'Femenina' : 'Female') : (language === 'es' ? 'Masculina' : 'Male')})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div
                  className="flex items-center gap-1.5 bg-slate-800/60 rounded-lg px-2.5 py-1 border border-slate-700/60 shadow-sm text-slate-300 cursor-help"
                  title={t('orderReadyBoard.voice_locked_hint')}
                >
                  <Lock className="w-3 h-3 text-amber-400/80 shrink-0" />
                  <span className="text-xs font-bold text-slate-300">
                    {AVAILABLE_VOICES.find(v => v.id === selectedVoice)?.gender === 'female' ? '👩' : '👨'} {selectedVoice}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 bg-slate-700/50 px-1 py-0.5 rounded">
                    {language === 'es' ? 'Cadena' : 'Global'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reloj, Idioma, Pantalla Completa y Controles */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Reloj y Turno de California */}
          <div className="hidden lg:flex items-center gap-2.5 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 text-slate-200">
            <div className="flex items-center gap-1.5 font-mono font-bold text-sm tracking-wider">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>{currentTime || '--:--:--'}</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                shift === 'AM'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
              }`}
              title={`${t('orderReadyBoard.business_day')}: ${businessDate} • ${shift === 'AM' ? t('orderReadyBoard.shift_am') : t('orderReadyBoard.shift_pm')}`}
            >
              {shift === 'AM' ? (
                <>
                  <Sun className="w-3 h-3 text-amber-400" />
                  <span>{t('orderReadyBoard.shift_am_short')}</span>
                </>
              ) : (
                <>
                  <Moon className="w-3 h-3 text-indigo-400" />
                  <span>{t('orderReadyBoard.shift_pm_short')}</span>
                </>
              )}
            </div>
          </div>

          {/* Botón Selector de Idioma de Pantalla (ES / EN) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setLanguage(language === 'es' ? 'en' : 'es')
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-black transition shadow-sm"
            title={language === 'es' ? t('orderReadyBoard.switch_to_english') : t('orderReadyBoard.switch_to_spanish')}
          >
            <Globe className="w-4 h-4 text-emerald-400" />
            <span className={language === 'en' ? 'text-emerald-400 font-black' : 'text-slate-400 font-bold'}>EN</span>
            <span className="text-slate-600 font-normal">/</span>
            <span className={language === 'es' ? 'text-emerald-400 font-black' : 'text-slate-400 font-bold'}>ES</span>
          </button>

          {/* Modo TV / Pantalla Completa (Fullscreen) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleFullscreen()
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition shadow-sm"
            title={isFullscreen ? t('orderReadyBoard.exit_tv_mode_tooltip') : t('orderReadyBoard.tv_mode_tooltip')}
          >
            {isFullscreen ? <Minimize className="w-4 h-4 text-amber-400" /> : <Maximize className="w-4 h-4 text-slate-300" />}
            <span className="hidden xl:inline">{isFullscreen ? t('orderReadyBoard.exit_tv_mode') : t('orderReadyBoard.tv_mode')}</span>
          </button>

          {/* Estado de Audio */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsMuted(!isMuted)
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${
              isMuted
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span className="hidden md:inline">
              {isMuted ? t('orderReadyBoard.audio_muted') : t('orderReadyBoard.audio_enabled')}
            </span>
          </button>

          {/* Quick Toggle Drive-Thru */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleDriveThruMaster()
            }}
            title={announceDriveThru || showDriveThru ? t('orderReadyBoard.drive_thru_enabled') : t('orderReadyBoard.drive_thru_disabled')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${
              announceDriveThru || showDriveThru
                ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20'
                : 'bg-slate-800/80 text-slate-500 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <Car className="w-4 h-4" />
            <span className="hidden md:inline">DT</span>
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
              announceDriveThru || showDriveThru
                ? 'bg-orange-500 text-slate-950'
                : 'bg-slate-700 text-slate-400'
            }`}>
              {announceDriveThru || showDriveThru ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Botón de Ajustes / Drawer de Controles */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleControls(e)
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
              showControls
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
            title={showControls ? t('orderReadyBoard.hide_controls') : t('orderReadyBoard.show_controls')}
          >
            <Sliders className="w-4 h-4" />
            <span className="hidden lg:inline">{showControls ? t('orderReadyBoard.hide_controls') : t('orderReadyBoard.show_controls')}</span>
            {showControls ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* Aviso de falta de conexión a Internet (Offline Banner) */}
      {!isOnline && (
        <div className="bg-amber-600 text-white px-4 py-1.5 text-center text-xs font-bold flex items-center justify-center gap-2 shadow-md z-40 animate-pulse">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>{t('orderReadyBoard.offline_warning')}</span>
        </div>
      )}

      {/* Banner de locutor activo (cuando habla la voz) */}
      {activeSpeech && (
        <div className="bg-gradient-to-r from-emerald-500/20 via-teal-500/30 to-emerald-500/20 border-b border-emerald-500/40 px-4 py-2 flex items-center justify-center gap-3 text-emerald-300 font-semibold text-sm animate-pulse">
          <Volume2 className="w-4 h-4 animate-ping text-emerald-400" />
          <span>🗣️ {activeSpeech}</span>
        </div>
      )}

      {/* Panel de Control Plegable (para gerentes / pruebas) */}
      {showControls && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-slate-900 border-b border-slate-800 p-5 shadow-2xl transition-all animate-in slide-in-from-top-4 duration-200"
        >
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Selección de Tienda */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                {t('orderReadyBoard.store')}
              </label>
              <select
                value={selectedStore}
                onChange={(e) => handleStoreChange(e.target.value)}
                disabled={visibleStores.length <= 1}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {visibleStores.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Configuración de Voz */}
            <div>
              {/* Selector de Voces Neuronales (3 Femeninas, 2 Masculinas) */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    {isAdmin ? (
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-400/90" />
                    )}
                    {t('orderReadyBoard.voice_speaker')}
                  </label>
                  <button
                    type="button"
                    onClick={() => handleTestSound(selectedVoice)}
                    disabled={isTestingVoice}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 transition disabled:opacity-50"
                    title={t('orderReadyBoard.test_voice')}
                  >
                    <Play className={`w-2.5 h-2.5 fill-current ${isTestingVoice ? 'animate-spin' : ''}`} />
                    <span>{isTestingVoice ? t('orderReadyBoard.testing_voice') : t('orderReadyBoard.test_voice')}</span>
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {AVAILABLE_VOICES.map((v) => {
                    const isSelected = selectedVoice === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleVoiceChange(v.id)}
                        disabled={!isAdmin || isSavingVoice}
                        className={`py-1.5 px-0.5 rounded-lg text-xs font-bold text-center border transition flex flex-col items-center justify-center gap-0.5 ${
                          !isAdmin
                            ? isSelected
                              ? 'bg-slate-800 text-slate-200 border-amber-500/50 cursor-not-allowed opacity-90'
                              : 'bg-slate-950/60 text-slate-600 border-slate-900 cursor-not-allowed opacity-50'
                            : isSelected
                              ? 'bg-emerald-600 text-white border-emerald-400 shadow-md ring-1 ring-emerald-400'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
                        }`}
                        title={!isAdmin ? t('orderReadyBoard.voice_locked_hint') : (language === 'es' ? v.labelEs : v.labelEn)}
                      >
                        <span className="text-sm">{v.gender === 'female' ? '👩' : '👨'}</span>
                        <span className="text-[11px] leading-tight font-extrabold">{v.name}</span>
                        <span className={`text-[8px] uppercase tracking-wider px-1 rounded font-bold ${
                          !isAdmin
                            ? 'bg-slate-800 text-slate-400'
                            : isSelected
                              ? 'bg-emerald-700 text-emerald-100'
                              : v.gender === 'female'
                                ? 'bg-purple-500/20 text-purple-300'
                                : 'bg-blue-500/20 text-blue-300'
                        }`}>
                          {v.gender === 'female' ? (language === 'es' ? 'Fem' : 'Fem') : (language === 'es' ? 'Masc' : 'Male')}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {!isAdmin ? (
                  <p className="text-[10px] text-amber-400/90 mt-1.5 flex items-center gap-1 font-medium">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>{t('orderReadyBoard.voice_locked_hint')}</span>
                  </p>
                ) : (
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <span className="text-emerald-400 font-semibold flex items-center gap-1 truncate">
                      <Sparkles className="w-3 h-3 shrink-0" />
                      {isSavingVoice ? t('orderReadyBoard.voice_saving') : t('orderReadyBoard.voice_global_badge')}
                    </span>
                    <span className="text-slate-400 italic truncate ml-1">
                      {AVAILABLE_VOICES.find(v => v.id === selectedVoice)?.[language === 'es' ? 'labelEs' : 'labelEn']}
                    </span>
                  </div>
                )}
              </div>

              {/* Idioma de los Anuncios */}
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                {t('orderReadyBoard.voice_language')}
              </label>
              <div className="flex gap-1.5">
                {(['es', 'en', 'bilingual'] as const).map((langOption) => (
                  <button
                    key={langOption}
                    onClick={() => setVoiceLanguage(langOption)}
                    className={`flex-1 py-1 px-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition ${
                      voiceLanguage === langOption
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {langOption === 'es' ? 'ES' : langOption === 'en' ? 'EN' : (language === 'es' ? 'Bilingüe' : 'Bilingual')}
                  </button>
                ))}
              </div>

              {/* Slider de Volumen */}
              <div className="mt-2.5">
                <div className="flex justify-between text-xs text-slate-400 font-semibold mb-1">
                  <span>{t('orderReadyBoard.voice_volume')}</span>
                  <span>{Math.round(voiceVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={voiceVolume}
                  onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Toggle de Campanilla Ding-Dong */}
              <div className="mt-2.5 pt-2 border-t border-slate-800">
                <label className="flex items-center justify-between text-xs font-medium text-slate-300 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-amber-400" />
                    {t('orderReadyBoard.enable_chime')}
                  </span>
                  <input
                    type="checkbox"
                    checked={enableChime}
                    onChange={(e) => updateEnableChime(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                </label>
              </div>
            </div>

            {/* Filtros de Canales y Anuncios */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                {t('orderReadyBoard.channels_settings')}
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={announceToGo}
                    onChange={(e) => {
                      setAnnounceToGo(e.target.checked)
                      if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_announce_tg', String(e.target.checked))
                    }}
                    className="accent-emerald-500 rounded"
                  />
                  <span>{t('orderReadyBoard.announce_togo')}</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={announceForHere}
                    onChange={(e) => {
                      setAnnounceForHere(e.target.checked)
                      if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_announce_fh', String(e.target.checked))
                    }}
                    className="accent-emerald-500 rounded"
                  />
                  <span>{t('orderReadyBoard.announce_for_here')}</span>
                </label>

                {/* Control de Drive-Thru */}
                <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/30 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-orange-300 flex items-center gap-1.5">
                      <Car className="w-3.5 h-3.5" />
                      Drive-Thru
                    </span>
                    <button
                      type="button"
                      onClick={toggleDriveThruMaster}
                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition ${
                        announceDriveThru || showDriveThru
                          ? 'bg-orange-500 text-slate-950'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {announceDriveThru || showDriveThru ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={announceDriveThru}
                      onChange={(e) => updateAnnounceDriveThru(e.target.checked)}
                      className="accent-orange-500 rounded"
                    />
                    <span>{t('orderReadyBoard.announce_drive_thru')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showDriveThru}
                      onChange={(e) => updateShowDriveThru(e.target.checked)}
                      className="accent-orange-500 rounded"
                    />
                    <span>{t('orderReadyBoard.show_drive_thru')}</span>
                  </label>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={announceDelivery}
                    onChange={(e) => {
                      setAnnounceDelivery(e.target.checked)
                      if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_announce_del', String(e.target.checked))
                    }}
                    className="accent-emerald-500 rounded"
                  />
                  <span>{t('orderReadyBoard.announce_delivery')}</span>
                </label>
              </div>
            </div>

            {/* Acciones Rápidas de Prueba */}
            <div className="flex flex-col justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                {language === 'es' ? 'Acciones' : 'Actions'}
              </label>
              <div className="space-y-2">
                <button
                  onClick={() => handleTestSound(selectedVoice)}
                  disabled={isTestingVoice}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs py-2 px-3 rounded-lg shadow transition disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 fill-current ${isTestingVoice ? 'animate-spin' : ''}`} />
                  {isTestingVoice ? t('orderReadyBoard.testing_voice') : `${t('orderReadyBoard.test_voice')} (${selectedVoice} #141)`}
                </button>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => handleSimulateOrder('TOGO')}
                    className="flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 font-semibold text-xs py-1.5 px-1 rounded-lg transition"
                  >
                    + Togo
                  </button>
                  <button
                    onClick={() => handleSimulateOrder('FOR_HERE')}
                    className="flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-semibold text-xs py-1.5 px-1 rounded-lg transition"
                  >
                    + Dine-In
                  </button>
                  <button
                    onClick={() => handleSimulateOrder('DRIVE_THRU')}
                    className="flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 text-orange-300 border border-orange-500/30 font-semibold text-xs py-1.5 px-1 rounded-lg transition"
                  >
                    + DriveThru
                  </button>
                </div>
                <button
                  onClick={() => fetchOrders(true)}
                  disabled={isSyncing}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs py-1.5 px-3 rounded-lg transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? t('orderReadyBoard.syncing') : t('orderReadyBoard.sync_toast')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cuerpo Principal del Tablero: Dos Columnas Gigantes */}
      {(() => {
        const displayedReadyOrders = readyOrders.filter((order) => {
          if (order.dining_option === 'DRIVE_THRU' && !showDriveThru) return false
          return true
        })

        const displayedInProgressOrders = inProgressOrders.filter((order) => {
          if (order.dining_option === 'DRIVE_THRU' && !showDriveThru) return false
          return true
        })

        return (
          <main className="flex-1 p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 max-w-7xl mx-auto w-full">
            {/* COLUMNA IZQUIERDA: LISTAS PARA RECOGER (READY) */}
            <section className="flex flex-col bg-slate-900/60 rounded-3xl border-2 border-emerald-500/50 p-6 shadow-2xl relative overflow-hidden backdrop-blur">
              {/* Luz de fondo en verde */}
              <div className="absolute -top-32 -left-32 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

              {/* Header de la columna */}
              <div className="flex items-center justify-between pb-6 border-b border-emerald-500/30 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-3xl lg:text-4xl font-black text-emerald-400 tracking-tight uppercase flex items-center gap-2">
                      {t('orderReadyBoard.ready_for_pickup')}
                      <span className="text-sm font-bold bg-emerald-500 text-slate-950 px-3 py-0.5 rounded-full ml-2">
                        {displayedReadyOrders.length}
                      </span>
                    </h2>
                    <p className="text-xs text-emerald-300/70 font-medium">
                      {language === 'es' ? 'Pasa al mostrador con tu ticket' : 'Please proceed to the counter'}
                    </p>
                  </div>
                </div>
                <Sparkles className="w-6 h-6 text-emerald-400 animate-pulse hidden sm:block" />
              </div>

              {/* Tarjetas de Órdenes Listas */}
              <div className="flex-1 mt-6 overflow-y-auto space-y-4 pr-1 relative z-10">
                {displayedReadyOrders.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-center">
                    <CheckCircle2 className="w-12 h-12 mb-3 text-slate-700" />
                    <p className="text-lg font-semibold text-slate-400">{t('orderReadyBoard.no_orders_ready')}</p>
                    <p className="text-xs text-emerald-400 font-medium mt-1">
                      {STORES_LIST.find(s => s.code === selectedStore)?.name || selectedStore} • {language === 'es' ? 'Al dar doble tap en el KDS aparecerán aquí' : 'Orders bumped on KDS will appear here'}
                    </p>
                  </div>
                ) : (
                  displayedReadyOrders.map((order) => {
                    const prepSeconds = order.ready_at && order.created_at
                      ? Math.max(0, Math.round((new Date(order.ready_at).getTime() - new Date(order.created_at).getTime()) / 1000))
                      : 0
                    const sosColor = getColorForDuration(prepSeconds)
                    const sosClass = getSosBadgeClasses(sosColor)
                    const readyTimeStr = formatTimeOnly(order.ready_at)

                    return (
                      <div
                        key={order.id}
                        className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-2 border-emerald-500/60 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl shadow-emerald-950/40 transform hover:scale-[1.01] transition-all animate-in fade-in zoom-in-95 duration-300"
                      >
                        <div className="flex items-center gap-5">
                          {/* Número de Orden en Grande */}
                          <button
                            type="button"
                            onClick={() => handleOrderClick(order)}
                            title={t('orderReadyBoard.view_ticket')}
                            className="text-left text-4xl lg:text-6xl font-black tracking-tight text-white font-mono drop-shadow-[0_2px_12px_rgba(16,185,129,0.5)] hover:text-emerald-300 transition-colors cursor-pointer"
                          >
                            #{order.order_number}
                          </button>

                          {/* Nombre, Canal y Tiempo de Preparación SOS */}
                          <div>
                            {order.customer_name && (
                              <div className="text-base lg:text-lg font-bold text-slate-200 truncate max-w-[200px]">
                                {order.customer_name}
                              </div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {renderDiningBadge(order.dining_option)}

                              {prepSeconds > 0 && (
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${sosClass}`}
                                  title={`${t('orderReadyBoard.prep_duration')}: ${formatDuration(prepSeconds)}`}
                                >
                                  <Timer className="w-3 h-3" />
                                  <span>{formatDuration(prepSeconds)}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Info de Cierre / Doble Tap y Acciones */}
                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 pt-3 sm:pt-0 border-emerald-500/20">
                          <div className="text-left sm:text-right">
                            <div className="flex items-center sm:justify-end gap-2">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-500 text-slate-950 shadow-md">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {t('orderReadyBoard.ready_badge')}
                              </span>
                              {readyTimeStr && (
                                <span className="text-xs font-bold text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-500/30">
                                  {readyTimeStr}
                                </span>
                              )}
                            </div>
                            {order.ready_at && (
                              <p className="text-[11px] text-emerald-400/80 font-medium mt-1">
                                {calculateElapsedTime(order.ready_at, language)}
                              </p>
                            )}
                          </div>

                          {/* Botones de Acción: Llamar por voz y Ver Ticket */}
                          <div className="flex items-center gap-1.5 mt-1">
                            <button
                              type="button"
                              onClick={() => handleReplayVoice(order)}
                              disabled={replayingId === order.id}
                              title={t('orderReadyBoard.replay_tooltip').replace('{order}', order.order_number)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm border border-emerald-400/40 transition active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                              <Volume2 className={`w-3.5 h-3.5 ${replayingId === order.id ? 'animate-bounce text-amber-300' : ''}`} />
                              <span>
                                {replayingId === order.id ? t('orderReadyBoard.replaying') : t('orderReadyBoard.replay_voice')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOrderClick(order)}
                              title={t('orderReadyBoard.view_ticket')}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition active:scale-95 cursor-pointer shadow-sm"
                            >
                              <Receipt className="w-3.5 h-3.5 text-amber-400" />
                              <span className="hidden md:inline">{t('orderReadyBoard.view_ticket')}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>

            {/* COLUMNA DERECHA: EN PREPARACIÓN (IN PROGRESS) */}
            <section className="flex flex-col bg-slate-900/40 rounded-3xl border border-slate-800 p-6 shadow-xl backdrop-blur relative">
              {/* Header de la columna */}
              <div className="flex items-center justify-between pb-6 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                    <Clock className="w-6 h-6 text-slate-400" />
                  </div>
                  <div>
                    <h2 className="text-3xl lg:text-4xl font-black text-slate-200 tracking-tight uppercase flex items-center gap-2">
                      {t('orderReadyBoard.in_progress')}
                      <span className="text-sm font-bold bg-slate-800 text-slate-300 px-3 py-0.5 rounded-full ml-2 border border-slate-700">
                        {displayedInProgressOrders.length}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 font-medium">
                      {language === 'es' ? 'Preparando con ingredientes frescos' : 'Preparing fresh on the grill'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tarjetas de Órdenes en Preparación */}
              <div className="flex-1 mt-6 overflow-y-auto space-y-3.5 pr-1">
                {displayedInProgressOrders.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-center">
                    <Clock className="w-12 h-12 mb-3 text-slate-700" />
                    <p className="text-lg font-semibold text-slate-400">{t('orderReadyBoard.no_orders_in_progress')}</p>
                    <p className="text-xs text-slate-400 font-medium mt-1">
                      {STORES_LIST.find(s => s.code === selectedStore)?.name || selectedStore} • {language === 'es' ? 'La cocina está al día' : 'The kitchen is caught up'}
                    </p>
                  </div>
                ) : (
                  displayedInProgressOrders.map((order) => {
                    const elapsedSeconds = order.created_at
                      ? Math.max(0, Math.round((nowMs - new Date(order.created_at).getTime()) / 1000))
                      : 0
                    const sosColor = getColorForDuration(elapsedSeconds)
                    const sosClass = getSosBadgeClasses(sosColor)
                    const sentTimeStr = formatTimeOnly(order.created_at)

                    return (
                      <div
                        key={order.id}
                        className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow transition hover:border-slate-700"
                      >
                        <div className="flex items-center gap-4">
                          {/* Número de Orden */}
                          <button
                            type="button"
                            onClick={() => handleOrderClick(order)}
                            title={t('orderReadyBoard.view_ticket')}
                            className="text-3xl lg:text-5xl font-black tracking-tight text-slate-300 hover:text-white font-mono transition-colors text-left cursor-pointer"
                          >
                            #{order.order_number}
                          </button>

                          {/* Nombre, Canal y Cronómetro en Vivo */}
                          <div>
                            {order.customer_name && (
                              <div className="text-sm lg:text-base font-bold text-slate-300 truncate max-w-[180px]">
                                {order.customer_name}
                              </div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {renderDiningBadge(order.dining_option)}

                              {/* Cronómetro en vivo con colores SOS */}
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${sosClass}`}
                                title={`${t('orderReadyBoard.elapsed')}: ${formatDuration(elapsedSeconds)}`}
                              >
                                <Timer className="w-3 h-3" />
                                <span>{formatDuration(elapsedSeconds)}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Estado y Hora de Envío */}
                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800">
                          <div className="text-left sm:text-right">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-slate-400 bg-slate-800/80 border border-slate-700/60">
                              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                              {t('orderReadyBoard.almost_ready')}
                            </span>
                            {sentTimeStr && (
                              <p className="text-[11px] text-slate-400 font-medium mt-1">
                                {t('orderReadyBoard.sent_at_time').replace('{time}', sentTimeStr)}
                              </p>
                            )}
                          </div>

                          {/* Botón Ver Ticket */}
                          <button
                            type="button"
                            onClick={() => handleOrderClick(order)}
                            title={t('orderReadyBoard.view_ticket')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition active:scale-95 cursor-pointer shadow-sm"
                          >
                            <Receipt className="w-3.5 h-3.5 text-amber-400" />
                            <span>{t('orderReadyBoard.view_ticket')}</span>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          </main>
        )
      })()}

      {/* Footer corporativo */}
      <footer className="bg-slate-950 border-t border-slate-900 px-6 py-3 text-center text-xs text-slate-500 font-medium">
        <span>Tacos Gavilan • {t('orderReadyBoard.subtitle')}</span>
      </footer>

      {/* SECONDARY MODAL: VISOR DE RECIBO / TICKET TOAST POS */}
      {orderDetailData && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in zoom-in-95 duration-200"
          onClick={() => setOrderDetailData(null)}
        >
          <div
            className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col font-mono text-sm border-2 border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header del Ticket */}
            <div className="p-4 border-b-2 border-dashed border-slate-300 font-bold text-center bg-slate-50 shrink-0 relative">
              <button
                type="button"
                onClick={() => setOrderDetailData(null)}
                className="absolute right-3 top-3 p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="text-base tracking-wider uppercase">
                {t('orderReadyBoard.receipt_ticket')} #{orderDetailData.checkId}
              </div>
              {orderDetailData.loading && (
                <p className="text-amber-600 animate-pulse text-xs mt-1">
                  {t('orderReadyBoard.connecting_virtual_cashier')}
                </p>
              )}
            </div>

            {/* Contenido del Ticket */}
            <div className="p-4 overflow-y-auto flex-1 bg-[#fafafa]">
              {orderDetailData.error && (
                <div className="text-rose-600 text-xs break-all bg-rose-50 p-3 rounded-lg border border-rose-200">
                  {orderDetailData.error}
                </div>
              )}

              {orderDetailData.data && (
                <div className="space-y-4 text-slate-800">
                  <div className="text-xs text-center border-b border-slate-200 pb-3">
                    <div className="font-bold text-[14px] uppercase tracking-wider mb-1">
                      {t('orderReadyBoard.receipt_store')}{' '}
                      {orderDetailData.storeName || orderDetailData.data.restaurantService?.name || 'TACOS GAVILAN'}
                    </div>
                    <div>{orderDetailData.data.diningOption?.name || 'Para Llevar / Dine In'}</div>
                    <div>
                      {orderDetailData.data.openedDate
                        ? new Date(orderDetailData.data.openedDate).toLocaleString('en-US', {
                            timeZone: 'America/Los_Angeles'
                          })
                        : ''}
                    </div>
                    <div className="mt-1">
                      {t('orderReadyBoard.cashier')}:{' '}
                      <span className="font-bold">
                        {orderDetailData.cajeraName || orderDetailData.data.server?.name || t('orderReadyBoard.automatic')}
                      </span>
                    </div>
                  </div>

                  <div className="border-b-2 border-dashed border-slate-300 pb-3 space-y-1">
                    <div className="flex justify-between font-bold text-[10px] text-slate-400 mb-2 uppercase tracking-widest">
                      <span>{t('orderReadyBoard.item')}</span>
                      <span>{t('orderReadyBoard.total')}</span>
                    </div>
                    {orderDetailData.data.checks?.map((check: any, idx: number) => (
                      <div key={idx} className="space-y-2">
                        {check.selections
                          ?.filter((s: any) => !s.deleted && !s.voided)
                          .map((sel: any, i: number) => {
                            const qty = sel.quantity || 1
                            const unitPrice = Number(sel.receiptLinePrice || Number(sel.price) / qty || 0)
                            const originalLinePrice = unitPrice * qty
                            const finalLinePrice = Number(sel.price || 0)
                            const inferredDiscount = originalLinePrice - finalLinePrice
                            const validDiscounts =
                              sel.appliedDiscounts?.filter(
                                (d: any) =>
                                  !d.deleted &&
                                  !d.voided &&
                                  d.state !== 'VOIDED' &&
                                  d.state !== 'REMOVED' &&
                                  d.applied !== false &&
                                  Number(d.discountAmount || 0) <= inferredDiscount + 0.05
                              ) || []

                            return (
                              <div key={i} className="flex justify-between items-start text-xs">
                                <span className="flex-1 pr-2">
                                  {qty}x {sel.displayName || sel.item?.name}
                                  {validDiscounts.map((d: any, j: number) => (
                                    <div
                                      key={`expl-${j}`}
                                      className="text-amber-700 text-[10px] ml-4 font-bold border-l-2 border-amber-400 pl-1 mt-0.5"
                                    >
                                      ↳ DESC: {d.name} (-$
                                      {Number(d.discountAmount).toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                      })}
                                      )
                                    </div>
                                  ))}
                                  {validDiscounts.length === 0 && inferredDiscount > 0.009 && (
                                    <div className="text-amber-700 text-[10px] ml-4 font-bold border-l-2 border-amber-400 pl-1 mt-0.5">
                                      ↳ DESC. (-$
                                      {inferredDiscount.toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                      })}
                                      )
                                    </div>
                                  )}
                                </span>
                                <span className="font-bold whitespace-nowrap">
                                  $
                                  {originalLinePrice.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })}
                                </span>
                              </div>
                            )
                          })}

                        {check.appliedDiscounts
                          ?.filter(
                            (d: any) =>
                              !d.deleted &&
                              !d.voided &&
                              d.state !== 'VOIDED' &&
                              d.state !== 'REMOVED' &&
                              d.applied !== false
                          )
                          .map((d: any, j: number) => (
                            <div
                              key={`chk-${j}`}
                              className="flex justify-between items-start text-[11px] text-amber-700 font-bold bg-amber-50 p-1 -mx-1 rounded"
                            >
                              <span>REF TICKET: {d.name}</span>
                              <span>
                                (-$
                                {Number(d.discountAmount).toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                })}
                                )
                              </span>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>

                  <div className="text-right space-y-1 text-xs">
                    {(() => {
                      const checks = orderDetailData.data.checks || []
                      const check = checks[0]
                      if (!check) return null

                      const subtotalBruto =
                        check.selections
                          ?.filter((s: any) => !s.deleted && !s.voided)
                          .reduce((sum: number, sel: any) => {
                            const qty = sel.quantity || 1
                            const unitPrice = Number(sel.receiptLinePrice || Number(sel.price) / qty || 0)
                            return sum + unitPrice * qty
                          }, 0) || 0

                      const subtotalNeto = Number(check.amount || 0)
                      const totalDiscounts = Math.max(0, subtotalBruto - subtotalNeto)

                      return (
                        <>
                          <div className="flex justify-between text-slate-500">
                            <span>{t('orderReadyBoard.gross_subtotal')}</span>{' '}
                            <span>
                              $
                              {subtotalBruto.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}
                            </span>
                          </div>
                          {totalDiscounts > 0.009 && (
                            <div className="flex justify-between font-bold text-amber-700">
                              <span>{t('orderReadyBoard.discounts_applied')}</span>{' '}
                              <span>
                                -$
                                {totalDiscounts.toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                })}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between text-slate-800 font-semibold mt-1">
                            <span>{t('orderReadyBoard.net_subtotal')}</span>{' '}
                            <span>
                              $
                              {subtotalNeto.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-500">
                            <span>{t('orderReadyBoard.tax')}</span>{' '}
                            <span>
                              $
                              {Number(check.taxAmount || 0).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}
                            </span>
                          </div>
                          <div className="flex justify-between font-bold text-lg mt-2 text-slate-900 border-t border-slate-200 pt-2">
                            <span>{t('orderReadyBoard.total')}:</span>{' '}
                            <span>
                              $
                              {Number(check.totalAmount || 0).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}
                            </span>
                          </div>
                        </>
                      )
                    })()}
                  </div>

                  {orderDetailData.data.checks?.[0]?.payments?.length > 0 && (
                    <div className="text-xs pt-3 border-t-2 border-dashed border-slate-300">
                      <div className="font-bold text-slate-500 mb-1">{t('orderReadyBoard.payments_applied')}</div>
                      {orderDetailData.data.checks?.[0]?.payments.map((p: any, pIdx: number) => (
                        <div key={pIdx} className="flex justify-between text-slate-600">
                          <span>
                            {p.type || 'Pago'}{' '}
                            {p.originalPaymentStatus && p.originalPaymentStatus !== 'NONE' ? '(Original)' : ''}{' '}
                            {p.refundStatus && p.refundStatus !== 'NONE' ? '(Reembolsado)' : ''}
                          </span>
                          <span>
                            $
                            {Number(p.amount).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer del Modal */}
            <div className="p-3 text-center border-t-2 border-dashed border-slate-300 bg-slate-50 shrink-0">
              <button
                type="button"
                onClick={() => setOrderDetailData(null)}
                className="text-xs uppercase tracking-widest font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200 px-6 py-2 rounded-xl transition-colors w-full border border-slate-300 cursor-pointer"
              >
                {t('orderReadyBoard.close_receipt')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper para calcular tiempo transcurrido
function calculateElapsedTime(timestamp: string, language: string): string {
  try {
    const elapsedMinutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000)
    if (elapsedMinutes <= 0) {
      return language === 'es' ? 'Justo ahora' : 'Just now'
    }
    return language === 'es' ? `Hace ${elapsedMinutes} min` : `${elapsedMinutes} min ago`
  } catch (e) {
    return ''
  }
}

export default function OrderReadyBoardPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager', 'asistente']}>
      <OrderReadyBoardContent />
    </ProtectedRoute>
  )
}

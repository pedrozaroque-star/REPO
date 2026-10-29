/**
 * @module app/order-ready-board/page
 * @description Customer-facing Order Status Board ("Entregadas" & "En Preparación") and Voice Announcer for Tacos Gavilan.
 * Displays live orders in "En Preparación" ("In Progress") and "Entregadas" ("Delivered"), and plays an audio chime (Web Audio API) plus a natural high-fidelity neural voice (Gemini Neural TTS via /api/order-ready/tts with 5 selectable voices: 3 female [Kore, Aoede, Zephyr] and 2 male [Puck, Orus]) in English and Spanish.
 * 
 * @businessRules
 * - **Tacos Gavilan Official Branding**: Presenta el nombre canónico y la identidad visual de la marca para displays en sucursal.
 * - **Separación de Estados (Nuevo Procedimiento Operativo)**:
 *   - 'IN_PROGRESS' ("En Preparación" / "In Progress"): Órdenes enviadas a cocina desde caja. Mientras están en preparación, el entregador toca la orden en la tableta del Preparador (`/inventory/preparador`) para llamar al cliente por el altavoz al mostrador.
 *   - 'READY' ("Entregadas" / "Delivered"): Órdenes que ya fueron entregadas al cliente y cerradas con doble tap (bump) en el Toast KDS Expediter. Al pasar a 'READY' desde el KDS entran en silencio a la columna "Entregadas".
 * - **Motor de Audio (Ding-Dong Chime) y Catálogo de 5 Voces Neuronales**:
 *   - Sintetizador armónico de campana (Ding-Dong) con Web Audio API de baja latencia antes del llamado + Locutor(a) de alta fidelidad bilingüe secuencial (Inglés: "Order #141 is ready," + Español: "orden #141 ya está.").
 *   - 5 Voces Neuronales Gemini TTS de alta fidelidad (3 Femeninas: Kore, Aoede, Zephyr; 2 Masculinas: Puck, Orus) con persistencia en LocalStorage (`teg_order_ready_voice`).
 *   - Campanilla Ding-Dong configurable (ON/OFF) con persistencia en LocalStorage.
 *   - Text-to-Speech (TTS) siempre bilingüe (Inglés + Español).
 *   - Cola de audio ordenada por timestamp de llamado (`_sortAt` / `ready_at`), sin superponerse.
 *   - Precarga inteligente de audio: los clips de las órdenes en preparación se precargan en segundo plano para que el anuncio al tocar en la tableta sea instantáneo. Si la red o TTS falla, se usa la voz del navegador como respaldo automático respetando el género seleccionado (con prohibición absoluta de Microsoft Raúl).
 *   - Alcance Exclusivo de Canales:
 *     * Operación exclusiva para Comedor ('FOR_HERE') y Para Llevar ('TOGO').
 *     * Drive-Thru y plataformas de delivery quedan completamente excluidos del tablero y anuncios.
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
 * - **Idempotencia ante Recall de Cocina en KDS y Supresión de Avalancha Inicial**:
 *   - Al abrir el módulo, recargar la página o cambiar de sucursal, todas las órdenes preexistentes se renderizan en pantalla en SILENCIO total. Solo se activan el Ding-Dong y la voz cuando el preparador toca una orden en vivo en la tableta (o al pulsar "Llamar" manualmente).
 *   - Cuando los cocineros hacen doble tap (bump) en el KDS Expediter, la orden pasa en silencio a la columna "Entregadas" (`status = 'READY'`).
 * - **Gestión de Vida Útil**: Las órdenes en 'READY' ("Entregadas") se retiran visualmente tras 20 minutos (limpieza automática de pantalla para mantener el tablero ordenado y legible, configurable en 15, 20 o 30 min, 20 min por defecto).
 * - **Anuncios Personalizados al Comedor y Reproducción Periódica**:
 *   - Caja de texto para redactar anuncios libres a comensales (hasta 500 caracteres) con contador de caracteres y botón de limpieza.
 *   - Plantillas rápidas oficiales de Tacos Gavilan: Ticket en mano, Barra de salsas, Aguas frescas y Bienvenida.
 *   - Reproducción inmediata ("Reproducir Ahora") o automática periódica (intervalos de 3, 5, 10, 15, 20, 30, 60 min o campo numérico libre).
 *   - Audio neuronal Gemini TTS vía `/api/order-ready/announcement-tts` con caché permanente en Supabase Storage y fallback seguro al sintetizador del navegador con bloqueo absoluto anti-Raul.
 *   - Prioridad de órdenes: los llamados de pedidos tienen prioridad absoluta; el anuncio espera a que concluyan para no interrumpir el flujo.
 * - **Impulso de Llamada desde Tableta de Preparador (Entregador de Cocina)**:
 *   - La tableta de preparación (`/inventory/preparador`) en la pestaña "ÓRDENES" permite al entregador tocar una orden en preparación con el dedo para llamar al cliente al mostrador, así como tocar los botones permanentes de **Café** (`"Café pendiente ya está listo"`) y **Champurrado** (`"Champurrado pendiente ya está listo"`).
 *   - El tablero del Manager recibe el impulso instantáneo vía Supabase Realtime (evento `call_order`) y reproduce la campanilla Ding-Dong + locutor natural, destacando la tarjeta en la pantalla con un badge ámbar pulsante ("Llamada desde Preparador").
 * - **Resiliencia de Red (Offline Mode)**: Detección proactiva de conectividad de red con aviso visual y caída suave a audio en caché/síntesis local si se corta la conexión a internet.
 * 
 * @dataFlow
 * - Supabase Realtime channel (`order-ready-realtime:${storeCode}`, broadcast `call_order` + postgres_changes `order_ready_announcements` con filtro server-side `store_code=eq.${storeCode}`) + Polling visual de solo lectura (`syncToast=false`) cada 4s + Flujo explícito de sincronización KDS Toast (`syncToast=true`) cada 10s -> Actualiza estado React -> Chime + clips de voz natural (/api/order-ready/tts y /api/order-ready/announcement-tts) -> PATCH /api/order-ready/orders (announced: true).
 * 
 * @notes
 * - Modo Normal (Claro) por defecto integrado con la estética limpia de SM TEG (fondos blancos/slate-50, bordes nítidos y alto contraste), con selector dinámico a Modo Oscuro para pantallas nocturnas (persistente en `localStorage` vía `teg_order_ready_theme`).
 * - Soporta integración en el panel administrativo del sistema (sidebar visible) y botón nativo para Modo TV / Pantalla Completa.
 * - Incluye selector de idioma en cabecera (ES / EN) para alternar la pantalla en inglés o español al instante.
 * - Los navegadores web requieren un primer toque o clic para desbloquear el AudioContext y SpeechSynthesis (política de autoplay de navegadores). Se incluye un banner sutil de desbloqueo.
 * - Preferencias de canales, voz, visibilidad de controles, texto de anuncios, periodicidad y tema visual persisten en `localStorage` del dispositivo.
 * - ACCESO POR TIENDA: el selector solo lista las tiendas permitidas (GET /api/order-ready/my-stores): admin = todas,
 *   supervisor = su alcance, manager/asistente = solo la suya (selector bloqueado). Una tienda guardada/URL no permitida se
 *   reemplaza por la primera permitida y el servidor responde 403 si se intenta consultar otra.
 * - CUÁDRUPLE REDUNDANCIA DE AUDIO (2026-10-13): Blindaje absoluto para llamados desde tableta de preparador:
 *   1) WebSocket Broadcast cliente (canal por tienda 'order-ready-realtime:${storeCode}').
 *   2) Server Broadcast (/api/order-ready/call emite siempre por 'order-ready-realtime:${storeCode}').
 *   3) PostgreSQL Replication (escucha cambios en 'announced_at' vía postgres_changes en order_ready_announcements con filtro server-side).
 *   4) Polling Fallback cada 4s (detecta llamadas con announced_at < 45s en fetchOrders).
 *   Debounce acústico de 6 segundos por orden para evitar duplicidad de sonido entre capas.
 * - FIX REALTIME & RECONEXIÓN (2026-10-22):
 *   1) Filtro server-side `store_code=eq.${selectedStore}` en `order_ready_announcements` y `id=eq.global` en `order_ready_settings`.
 *   2) Topic de canal aislado por sucursal (`order-ready-realtime:${selectedStore}`).
 *   3) Guardia `channelDisposed` por instancia de canal para evitar reconexión infinita ante evento `CLOSED` intencional al ejecutar `removeChannel`.
 *   4) Debounce de 500ms + guardia `fetchingRef` en refrescos por Realtime, usando siempre `syncToast=false` para romper el ciclo Realtime -> fetch -> syncToast -> UPDATE.
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
  X,
  Megaphone,
  Trash2,
  Pencil,
  Save,
  RotateCcw
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@supabase/supabase-js'
import ProtectedRoute from '@/components/ProtectedRoute'
import { AVAILABLE_VOICES, VoiceId, isValidVoice, isForbiddenRaulVoice } from '@/lib/order-ready-tts'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { STORE_GUID_BY_CODE } from '@/lib/toast-stores'
import { isDrinkOrDessertOnlyOrder } from '@/lib/order-ready-filter'
import { purgeTabletStaleCaches, getTabletNoCacheHeaders } from '@/lib/tablet-cache-cleaner'

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
  announced_at?: string | null
  items_summary: string | null
  /** Solo cliente: marca un anuncio de recordatorio (no persiste en DB) */
  _reminder?: boolean
  /** Solo cliente: clave de orden en la cola de audio (ms epoch) */
  _sortAt?: number
  /** Solo cliente: llamado desde la tableta del preparador */
  _fromTablet?: boolean
  /** Solo cliente: re-llamado manual desde el botón del tablero */
  _manualReplay?: boolean
  /** Solo cliente: repeticiones de locución (1 o 2) */
  _repeats?: number
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

/** Veces que se anuncia una orden al cerrarse con doble tap en el expediter / KDS (1 sola vez según instrucción de Carlos) */
const ANNOUNCE_REPEATS = 1
/** Recordatorio único (1 vez) si la orden sigue en "Listo para recoger" tras este tiempo (por defecto 90s) */
const DEFAULT_REMINDER_DELAY_MS = 90_000

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
        const res = await fetch('/api/order-ready/my-stores', {
          cache: 'no-store',
          headers: getTabletNoCacheHeaders()
        })
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
  const [replayingOrderNum, setReplayingOrderNum] = useState<string | null>(null)
  const [tabletCalledOrderId, setTabletCalledOrderId] = useState<string | null>(null)
  const [tabletCalledOrderNum, setTabletCalledOrderNum] = useState<string | null>(null)
  const readyOrdersRef = useRef<OrderItem[]>([])
  const inProgressOrdersRef = useRef<OrderItem[]>([])
  const handleImpulseRef = useRef<((data: any) => void | Promise<void>) | null>(null)
  const [orderDetailData, setOrderDetailData] = useState<{
    loading: boolean
    checkId: string
    storeName: string
    cajeraName: string
    diningOption?: string
    openedAt?: string
    customerName?: string | null
    previewItems?: Array<{ name: string; quantity: number; modifiers?: string[] }>
    data?: any
    error?: string
  } | null>(null)
  const orderDetailCacheRef = useRef<Map<string, any>>(new Map())
  const orderDetailInflightRef = useRef<Map<string, Promise<any>>>(new Map())
  const businessDateRef = useRef<string>(businessDate)
  const fetchOrdersRef = useRef<((syncToast?: boolean, forceToast?: boolean) => Promise<void>) | null>(null)

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
  const [enableChime, setEnableChime] = useState<boolean>(true)

  // Regla de Negocio Tacos Gavilan: Limpieza automática de pantalla para órdenes listas (20 minutos)
  const [readyRetentionMinutes, setReadyRetentionMinutes] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teg_order_ready_retention')
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val > 0) return val
      }
    }
    return 20
  })

  const updateRetentionMinutes = (val: number) => {
    setReadyRetentionMinutes(val)
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_retention', String(val))
    }
  }

  // Regla de Negocio Tacos Gavilan: Tiempo de recordatorio para órdenes en "Listo para recoger" (por defecto 90s, ajustable en controles)
  const [reminderSeconds, setReminderSeconds] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teg_order_ready_reminder_sec')
      if (saved !== null) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 0) return val
      }
    }
    return 90
  })

  const reminderSecondsRef = useRef<number>(reminderSeconds)
  useEffect(() => {
    reminderSecondsRef.current = reminderSeconds
  }, [reminderSeconds])

  const updateReminderSeconds = (val: number) => {
    const clamped = Math.max(0, Math.min(600, val))
    setReminderSeconds(clamped)
    reminderSecondsRef.current = clamped
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_reminder_sec', String(clamped))
    }
  }

  // Regla de Negocio Tacos Gavilan: 5 Plantillas de Anuncios al Comedor (4 oficiales + 1 aviso libre aleatorio) editables y guardables
  type PresetKey = 'ticket' | 'salsas' | 'aguas' | 'welcome' | 'custom'
  interface CustomPresetOverride {
    labelEs?: string
    labelEn?: string
    textEs?: string
    textEn?: string
  }

  const [selectedPresetKey, setSelectedPresetKey] = useState<PresetKey>('ticket')
  const [customPresets, setCustomPresets] = useState<Record<string, CustomPresetOverride>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('teg_order_ready_custom_presets_v1')
        if (raw) return JSON.parse(raw)
      } catch {}
    }
    return {}
  })
  const [isEditingPreset, setIsEditingPreset] = useState<boolean>(false)
  const [editingPresetLabel, setEditingPresetLabel] = useState<string>('')
  const [isSavingPreset, setIsSavingPreset] = useState<boolean>(false)
  const [presetSavedFlash, setPresetSavedFlash] = useState<boolean>(false)

  const getDefaultPresetMeta = useCallback(
    (key: PresetKey): { icon: string; defaultLabel: string; defaultText: string } => {
      switch (key) {
        case 'ticket':
          return {
            icon: '🎫',
            defaultLabel: t('orderReadyBoard.announcement_preset_ticket'),
            defaultText: t('orderReadyBoard.announcement_preset_ticket_text')
          }
        case 'salsas':
          return {
            icon: '🍋',
            defaultLabel: t('orderReadyBoard.announcement_preset_salsas'),
            defaultText: t('orderReadyBoard.announcement_preset_salsas_text')
          }
        case 'aguas':
          return {
            icon: '🥤',
            defaultLabel: t('orderReadyBoard.announcement_preset_aguas'),
            defaultText: t('orderReadyBoard.announcement_preset_aguas_text')
          }
        case 'welcome':
          return {
            icon: '🌮',
            defaultLabel: t('orderReadyBoard.announcement_preset_welcome'),
            defaultText: t('orderReadyBoard.announcement_preset_welcome_text')
          }
        case 'custom':
        default:
          return {
            icon: '📢',
            defaultLabel: t('orderReadyBoard.announcement_preset_custom'),
            defaultText: t('orderReadyBoard.announcement_preset_custom_text')
          }
      }
    },
    [t]
  )

  const getPresetLabel = useCallback(
    (key: PresetKey): string => {
      const ov = customPresets[key]
      const customLbl = language === 'en' ? ov?.labelEn || ov?.labelEs : ov?.labelEs || ov?.labelEn
      return (customLbl && customLbl.trim()) || getDefaultPresetMeta(key).defaultLabel
    },
    [customPresets, language, getDefaultPresetMeta]
  )

  const getPresetText = useCallback(
    (key: PresetKey): string => {
      const ov = customPresets[key]
      const customTxt = language === 'en' ? ov?.textEn || ov?.textEs : ov?.textEs || ov?.textEn
      return (customTxt && customTxt.trim()) || getDefaultPresetMeta(key).defaultText
    },
    [customPresets, language, getDefaultPresetMeta]
  )

  const hasCustomPresetOverride = useCallback(
    (key: PresetKey): boolean => {
      const ov = customPresets[key]
      if (!ov) return false
      return Boolean(ov.labelEs || ov.labelEn || ov.textEs || ov.textEn)
    },
    [customPresets]
  )

  // Regla de Negocio Tacos Gavilan: Anuncios personalizados para el comedor con reproducción periódica automática
  const [announcementText, setAnnouncementText] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teg_order_ready_announcement_text')
      if (saved) return saved
    }
    return 'Favor de tener su ticket a la mano para recoger su orden en el mostrador. ¡Muchas gracias por su visita a Tacos Gavilan!'
  })

  const [announcementEnabled, setAnnouncementEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('teg_order_ready_announcement_enabled') === 'true'
    }
    return false
  })

  const [announcementIntervalMin, setAnnouncementIntervalMin] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teg_order_ready_announcement_interval_min')
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 1) return val
      }
    }
    return 15
  })

  const [isPlayingAnnouncement, setIsPlayingAnnouncement] = useState<boolean>(false)
  const [nextAnnouncementSec, setNextAnnouncementSec] = useState<number | null>(null)

  const announcementTextRef = useRef<string>(announcementText)
  useEffect(() => {
    announcementTextRef.current = announcementText
  }, [announcementText])

  const announcementEnabledRef = useRef<boolean>(announcementEnabled)
  useEffect(() => {
    announcementEnabledRef.current = announcementEnabled
  }, [announcementEnabled])

  const announcementIntervalMinRef = useRef<number>(announcementIntervalMin)
  useEffect(() => {
    announcementIntervalMinRef.current = announcementIntervalMin
  }, [announcementIntervalMin])

  const updateAnnouncementText = (text: string) => {
    const clamped = text.slice(0, 500)
    setAnnouncementText(clamped)
    announcementTextRef.current = clamped
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_announcement_text', clamped)
    }
  }

  const handleSelectPreset = (key: PresetKey) => {
    setSelectedPresetKey(key)
    const txt = getPresetText(key)
    updateAnnouncementText(txt)
    setEditingPresetLabel(getPresetLabel(key))
  }

  const handleSaveCurrentPreset = async () => {
    const cleanText = announcementText.trim().slice(0, 500)
    if (!cleanText) return
    setIsSavingPreset(true)
    try {
      const prev = customPresets[selectedPresetKey] || {}
      const cleanLabel = editingPresetLabel.trim().slice(0, 40)
      const defaultMeta = getDefaultPresetMeta(selectedPresetKey)
      const nextOverride: CustomPresetOverride = {
        ...prev,
        ...(language === 'en'
          ? {
              textEn: cleanText,
              ...(isEditingPreset && cleanLabel ? { labelEn: cleanLabel } : {})
            }
          : {
              textEs: cleanText,
              ...(isEditingPreset && cleanLabel ? { labelEs: cleanLabel } : {})
            })
      }
      // Si el usuario no había guardado el otro idioma aún y editó en modo libre, usar también como respaldo
      if (!nextOverride.textEs && language === 'en' && selectedPresetKey === 'custom') {
        nextOverride.textEs = cleanText
      }
      if (isEditingPreset && cleanLabel && cleanLabel !== defaultMeta.defaultLabel) {
        if (language === 'en') nextOverride.labelEn = cleanLabel
        else nextOverride.labelEs = cleanLabel
      }

      const nextPresets = {
        ...customPresets,
        [selectedPresetKey]: nextOverride
      }
      setCustomPresets(nextPresets)
      if (typeof window !== 'undefined') {
        localStorage.setItem('teg_order_ready_custom_presets_v1', JSON.stringify(nextPresets))
      }

      const detectedLang = cleanText.match(/\b(please|thank you|welcome|remember|enjoy|counter|order)\b/i) && !cleanText.match(/[áéíóúñ¡¿]/i) ? 'en' : 'es'
      await fetch('/api/order-ready/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presets: nextPresets,
          pregenerateText: cleanText,
          pregenerateLang: detectedLang
        })
      }).catch(() => {})

      setIsEditingPreset(false)
      setPresetSavedFlash(true)
      setTimeout(() => setPresetSavedFlash(false), 3000)
    } finally {
      setIsSavingPreset(false)
    }
  }

  const handleResetCurrentPreset = async () => {
    const nextPresets = { ...customPresets }
    delete nextPresets[selectedPresetKey]
    setCustomPresets(nextPresets)
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_custom_presets_v1', JSON.stringify(nextPresets))
    }
    const defMeta = getDefaultPresetMeta(selectedPresetKey)
    updateAnnouncementText(defMeta.defaultText)
    setEditingPresetLabel(defMeta.defaultLabel)
    setIsEditingPreset(false)

    await fetch('/api/order-ready/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presets: nextPresets })
    }).catch(() => {})
  }

  const toggleAnnouncementEnabled = (enabled: boolean) => {
    setAnnouncementEnabled(enabled)
    announcementEnabledRef.current = enabled
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_announcement_enabled', String(enabled))
    }
  }

  const updateAnnouncementIntervalMin = (mins: number) => {
    const clamped = Math.max(1, Math.min(120, mins))
    setAnnouncementIntervalMin(clamped)
    announcementIntervalMinRef.current = clamped
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_announcement_interval_min', String(clamped))
    }
  }

  // Cargar configuración global de voz y plantillas desde Supabase (/api/order-ready/settings)
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
      if (data.success && data.presets && typeof data.presets === 'object') {
        setCustomPresets(data.presets)
        if (typeof window !== 'undefined') {
          localStorage.setItem('teg_order_ready_custom_presets_v1', JSON.stringify(data.presets))
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

      const savedAnnounceTG = localStorage.getItem('teg_order_ready_announce_tg')
      if (savedAnnounceTG !== null) setAnnounceToGo(savedAnnounceTG === 'true')
      const savedAnnounceFH = localStorage.getItem('teg_order_ready_announce_fh')
      if (savedAnnounceFH !== null) setAnnounceForHere(savedAnnounceFH === 'true')
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
    // Limpiar cola de audio y cancelar cualquier síntesis activa para que órdenes de la tienda anterior no sigan sonando
    audioQueueRef.current = []
    activeStoreRef.current = null
    currentlyPlayingOrderRef.current = null
    isPlayingRef.current = false
    setActiveSpeech(null)
    setReplayingId(null)
    setReplayingOrderNum(null)
    setTabletCalledOrderId(null)
    setTabletCalledOrderNum(null)
    lastImpulseTimeRef.current.clear()
    lastAnnouncedAtMsRef.current.clear()
    announcedIdsRef.current.clear()
    readyIdsRef.current.clear()
    readyOrdersRef.current = []
    inProgressOrdersRef.current = []
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {}
    }
    // Cancelar recordatorios pendientes de la tienda previa
    reminderTimersRef.current.forEach((timer) => clearTimeout(timer))
    reminderTimersRef.current.clear()
    remindedOrderIdsRef.current.clear()
    setReadyOrders([])
    setInProgressOrders([])

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
        throw new Error(data.error || t('orderReadyBoard.voice_save_error'))
      }
    } catch (err: any) {
      console.error('Error saving global voice:', err)
      alert(err.message || t('orderReadyBoard.voice_update_error'))
      fetchGlobalSettings()
    } finally {
      setIsSavingVoice(false)
    }
  }

  const updateEnableChime = (val: boolean) => {
    setEnableChime(val)
    if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_chime', String(val))
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

  // Tema visual: 'light' (Normal por defecto en SM TEG) | 'dark' (Oscuro para TV de noche)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teg_order_ready_theme')
      if (saved === 'light' || saved === 'dark') return saved
    }
    return 'light'
  })

  const toggleTheme = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      if (typeof window !== 'undefined') {
        localStorage.setItem('teg_order_ready_theme', next)
      }
      return next
    })
  }

  const isDark = theme === 'dark'

  const [activeSpeech, setActiveSpeech] = useState<string | null>(null)

  // Referencias para Audio Engine
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<OrderItem[]>([])
  const isPlayingRef = useRef<boolean>(false)
  const currentlyPlayingOrderRef = useRef<OrderItem | null>(null)
  const lastImpulseTimeRef = useRef<Map<string, number>>(new Map())
  const lastAnnouncedAtMsRef = useRef<Map<string, number>>(new Map())
  const remindedOrderIdsRef = useRef<Set<string>>(new Set())
  // Ids ya encolados/anunciados en este dispositivo (evita repetir el anuncio mientras el PATCH aún no llega)
  const announcedIdsRef = useRef<Set<string>>(new Set())
  const readyIdsRef = useRef<Set<string>>(new Set())
  // Tienda actualmente sincronizada: si cambia o es la primera carga, se suprimen los anuncios por voz de órdenes preexistentes
  const activeStoreRef = useRef<string | null>(null)
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
          // FILTRO RAÍZ ABSOLUTO: Descartar inmediatamente a Microsoft Raúl y todas sus variantes
          const safeVoices = v.filter((voice) => !isForbiddenRaulVoice(voice.name, voice.voiceURI))
          setAvailableVoices(safeVoices)
        }
      }
      loadVoices()
      window.speechSynthesis.onvoiceschanged = loadVoices
      return () => {
        window.speechSynthesis.onvoiceschanged = null
      }
    }
  }, [])

  // Limpieza integral de estado y referencias al cruzar la frontera de las 6:00 AM (nuevo día laboral)
  const resetForNewBusinessDay = useCallback((newBDate: string) => {
    businessDateRef.current = newBDate
    setBusinessDate(newBDate)
    announcedIdsRef.current.clear()
    readyIdsRef.current.clear()
    lastImpulseTimeRef.current.clear()
    lastAnnouncedAtMsRef.current.clear()
    remindedOrderIdsRef.current.clear()
    reminderTimersRef.current.forEach((timer) => clearTimeout(timer))
    reminderTimersRef.current.clear()
    activeStoreRef.current = null
    audioQueueRef.current = []
    readyOrdersRef.current = []
    inProgressOrdersRef.current = []
    setTabletCalledOrderId(null)
    setTabletCalledOrderNum(null)
    setReadyOrders([])
    setInProgressOrders([])
    purgeTabletStaleCaches({ activeDate: newBDate }).catch(() => {})
  }, [])

  // Reloj local en vivo con centinela automático de cambio de día laboral (6:00 AM)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setNowMs(now.getTime())
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          timeZone: 'America/Los_Angeles',
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
        resetForNewBusinessDay(currentBDate)
        fetchOrdersRef.current?.(true)
      }
      setShift(currentShift)
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [resetForNewBusinessDay])

  // Inicializar o Desbloquear AudioContext al interactuar con la pantalla o teclado
  const unlockAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (AudioContextClass) {
          audioCtxRef.current = new AudioContextClass()
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      setAudioUnlocked(true)
    } catch (e) {
      console.warn('Audio unlock error:', e)
    }
  }, [])

  // Desbloquear AudioContext y permisos de sonido del navegador ante cualquier interacción global
  useEffect(() => {
    const handleGlobalInteraction = () => {
      unlockAudio()
    }
    window.addEventListener('click', handleGlobalInteraction, { passive: true })
    window.addEventListener('keydown', handleGlobalInteraction, { passive: true })
    window.addEventListener('touchstart', handleGlobalInteraction, { passive: true })
    return () => {
      window.removeEventListener('click', handleGlobalInteraction)
      window.removeEventListener('keydown', handleGlobalInteraction)
      window.removeEventListener('touchstart', handleGlobalInteraction)
    }
  }, [unlockAudio])

  // Función para sintetizar un Chime de alta fidelidad tipo campanilla ("Ding-Dong")
  const playChime = useCallback((): Promise<void> => {
    return new Promise(async (resolve) => {
      try {
        if (!audioCtxRef.current) {
          unlockAudio()
        }
        const ctx = audioCtxRef.current
        if (!ctx) {
          resolve()
          return
        }
        // Tras horas de inactividad el navegador puede suspender el AudioContext: reintentar reanudarlo con timeout estricto de 400ms
        // para que nunca congele la cola de audio si Chrome bloquea resume() fuera de un clic directo.
        if (ctx.state === 'suspended') {
          await Promise.race([
            ctx.resume().catch(() => {}),
            new Promise((r) => setTimeout(r, 400))
          ])
        }
        if (ctx.state !== 'running') {
          resolve()
          return
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
  // REGLA CRÍTICA TACOS GAVILAN: MICROSOFT RAÚL (o cualquier voz con 'raul'/'raúl') ESTÁ 100% PROHIBIDO.
  const getBestBrowserVoice = useCallback(
    (lang: 'en' | 'es', voices: SpeechSynthesisVoice[], voiceId: VoiceId = selectedVoice): SpeechSynthesisVoice | null => {
      const langPrefix = lang === 'es' ? 'es' : 'en'
      // 0. Filtro absoluto: descartar cualquier voz que contenga 'raul' o 'raúl' normalizado
      const sanitizedVoices = voices.filter(v => !isForbiddenRaulVoice(v.name))
      const matchingVoices = sanitizedVoices.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix))
      const isMaleTarget = voiceId === 'Puck' || voiceId === 'Orus'

      const isMaleVoice = (name: string) => {
        if (isForbiddenRaulVoice(name)) return true
        const lower = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        return lower.includes('male') || lower.includes('david') || lower.includes('george') || 
               lower.includes('jorge') || lower.includes('diego') || lower.includes('pablo') ||
               lower.includes('guy') || lower.includes('mark') || lower.includes('raul') ||
               lower.includes('hombre') || lower.includes('miguel')
      }

      if (isMaleTarget) {
        const maleKeywords = ['male', 'hombre', 'david', 'jorge', 'diego', 'pablo', 'guy', 'mark', 'george', 'miguel']
        const namedMale = matchingVoices.find(v => {
          if (isForbiddenRaulVoice(v.name)) return false
          const lower = v.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          return maleKeywords.some(kw => lower.includes(kw))
        })
        if (namedMale) return namedMale
        const nonRaulMatch = matchingVoices.find(v => !isForbiddenRaulVoice(v.name))
        if (nonRaulMatch) return nonRaulMatch
        return sanitizedVoices.find(v => !isForbiddenRaulVoice(v.name)) || null
      }

      // 1. Prioridad absoluta: Voces Neuronales/Naturales Femeninas en el idioma solicitado
      const premiumKeywords = ['natural', 'neural', 'online', 'dalia', 'jenny', 'samantha', 'victoria', 'paulina', 'sabina', 'monica', 'google']
      const premiumFemale = matchingVoices.find(v => {
        if (isMaleVoice(v.name) || isForbiddenRaulVoice(v.name)) return false
        const lower = v.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        return premiumKeywords.some(kw => lower.includes(kw))
      })
      if (premiumFemale) return premiumFemale

      // 2. Voces femeninas identificadas en el idioma solicitado
      const femaleKeywords = [
        'female', 'woman', 'mujer', 'femenina',
        'samantha', 'victoria', 'karen', 'zira', 'jenny', 'monica', 'paulina', 
        'helena', 'sabina', 'dalia', 'laura', 'rosa', 'francisca', 'sofia', 'elena', 
        'maria', 'luciana', 'mia', 'ava', 'allison', 'angie', 'serena', 'susan'
      ]
      const namedFemale = matchingVoices.find(v => {
        if (isMaleVoice(v.name) || isForbiddenRaulVoice(v.name)) return false
        const lower = v.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        return femaleKeywords.some(kw => lower.includes(kw))
      })
      if (namedFemale) return namedFemale

      // 3. Cualquier voz en el idioma solicitado que no sea masculina ni Raúl
      const nonMale = matchingVoices.find(v => !isMaleVoice(v.name) && !isForbiddenRaulVoice(v.name))
      if (nonMale) return nonMale

      // 4. Si el objetivo es femenino y NO hay voz femenina en el idioma solicitado (común en Windows stock para español),
      // buscar cualquier voz femenina disponible en el navegador (ej. Microsoft Zira Desktop, Google US English).
      const anyFemale = sanitizedVoices.find(v => {
        if (isMaleVoice(v.name) || isForbiddenRaulVoice(v.name)) return false
        const lower = v.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        return femaleKeywords.some(kw => lower.includes(kw)) || premiumKeywords.some(kw => lower.includes(kw))
      })
      if (anyFemale) return anyFemale

      return null
    },
    [selectedVoice]
  )

  // RESPALDO: voz del navegador (speechSynthesis). Solo se usa si el TTS neuronal no está disponible.
  // PROHIBICIÓN ESTRICTA: RAÚL NUNCA DEBE HABLAR BAJO NINGUNA CIRCUNSTANCIA.
  const speakOrderBrowser = useCallback(
    (order: OrderItem, voiceId: VoiceId = selectedVoice, onlyLang?: 'en' | 'es'): Promise<void> => {
      return new Promise((originalResolve) => {
        let settled = false
        const resolve = () => {
          if (!settled) {
            settled = true
            clearTimeout(watchdogTimer)
            originalResolve()
          }
        }
        // Watchdog de seguridad de 15 segundos: garantiza que la cola nunca quede congelada si el navegador no dispara onend/onerror
        const watchdogTimer = setTimeout(() => {
          console.warn('[order-ready] speakOrderBrowser watchdog timeout alcanzado (15s), liberando cola.')
          setActiveSpeech(null)
          resolve()
        }, 15000)

        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          resolve()
          return
        }

        const num = order.order_number
        const allBrowserVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices()
        // Filtrar permanentemente cualquier rastro de Raúl
        const voices = allBrowserVoices.filter(v => !isForbiddenRaulVoice(v.name))
        const enVoice = getBestBrowserVoice('en', voices, voiceId)
        const esVoice = getBestBrowserVoice('es', voices, voiceId)

        const isFemale = voiceId === 'Kore' || voiceId === 'Aoede' || voiceId === 'Zephyr'
        const safeEmergencyFemale = voices.find(v => {
          if (isForbiddenRaulVoice(v.name)) return false
          const lower = v.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          return !/raul|david|male|hombre|jorge|diego|pablo|miguel|guy|mark|george/i.test(lower)
        }) || null

        // Helper seguro de emisión: Si la voz es Raúl o no tiene voz asignada explícitamente, NUNCA EMITIR
        const safeSpeak = (utt: SpeechSynthesisUtterance, onEndCallback: () => void, cancelExisting = false) => {
          // 1. REGLA CRÍTICA: Bloquear si no hay voz explícita (para evitar que Windows SAPI use la voz default Raúl)
          if (!utt.voice) {
            console.warn('[order-ready] Bloqueo de seguridad: intento de emitir sin voz asignada explícitamente (bloqueado para evitar Raúl).')
            onEndCallback()
            return
          }

          // 2. Bloqueo 100% incondicional de Raúl (REGLA ABSOLUTA TACOS GAVILAN)
          if (isForbiddenRaulVoice(utt.voice.name)) {
            console.warn('[order-ready] Bloqueo absoluto anti-Raúl: voz descartada:', utt.voice.name)
            onEndCallback()
            return
          }

          // 3. Si la voz seleccionada es femenina pero la única disponible en el SO es masculina no-Raúl:
          // Modificar tono (pitch) a 1.25 para darle mayor calidez/agudeza y evitar silencio total
          if (isFemale) {
            const vNameNorm = utt.voice.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            if (/male|david|hombre|jorge|diego|pablo|miguel|guy|mark|george/i.test(vNameNorm)) {
              utt.pitch = 1.22
            }
          }

          let callbackCalled = false
          const finish = () => {
            if (!callbackCalled) {
              callbackCalled = true
              onEndCallback()
            }
          }

          utt.onend = finish
          utt.onerror = finish
          setTimeout(finish, 8000) // Watchdog por locución

          try {
            const synth = window.speechSynthesis
            if (synth.paused) synth.resume()
            if (cancelExisting && (synth.speaking || synth.pending)) {
              synth.cancel()
            }
            synth.speak(utt)
          } catch (e) {
            console.warn('[order-ready] Error en speechSynthesis.speak:', e)
            finish()
          }
        }

        const validEnVoice = enVoice && !isForbiddenRaulVoice(enVoice.name) ? enVoice : null
        const validEsVoice = esVoice && !isForbiddenRaulVoice(esVoice.name) ? esVoice : null
        // Fallback garantizado: cualquier voz disponible que NO sea Raúl
        const anyNonRaulVoice = voices.find(v => !isForbiddenRaulVoice(v.name)) || null

        // REGLA CRÍTICA TACOS GAVILAN: Las órdenes SIEMPRE se anuncian de forma bilingüe (Inglés primero, luego Español)
        const chosenEn = validEnVoice || safeEmergencyFemale || anyNonRaulVoice
        const chosenEs = validEsVoice || chosenEn || anyNonRaulVoice

        // Si no hay ninguna voz garantizada no-Raúl en todo el sistema: SILENCIO ABSOLUTO (CERO RAÚL)
        if (!chosenEn || isForbiddenRaulVoice(chosenEn.name)) {
          console.warn('[order-ready] Bloqueo anti-Raúl: ninguna voz segura disponible en el navegador.')
          resolve()
          return
        }

        // Anuncios especiales de bebidas pendientes listas desde tableta de Preparador (Café / Champurrado)
        const bevKey = String(num || '').toUpperCase()
        const bevSpeech =
          bevKey === 'CAFE'
            ? 'Café pendiente ya está listo'
            : bevKey === 'CHAMPURRADO'
            ? 'Champurrado pendiente ya está listo'
            : null

        if (bevSpeech) {
          setActiveSpeech(`☕ ${bevSpeech}`)
          const uttBev = new SpeechSynthesisUtterance(bevSpeech)
          uttBev.rate = voiceSpeed
          uttBev.volume = isMuted ? 0 : voiceVolume
          if (chosenEs && !isForbiddenRaulVoice(chosenEs.name)) {
            uttBev.voice = chosenEs
            uttBev.lang = chosenEs.lang || 'es-MX'
          } else {
            uttBev.voice = chosenEn
            uttBev.lang = chosenEn.lang || 'en-US'
          }
          safeSpeak(uttBev, () => {
            setActiveSpeech(null)
            setTimeout(resolve, 300)
          }, true)
          return
        }

        const displayPhrase = `Order #${num} is ready, orden #${num}, ¡ya está!`
        setActiveSpeech(displayPhrase)

        // Fase 1: Inglés ("Order 141 is ready,")
        const uttEn = new SpeechSynthesisUtterance(`Order ${num} is ready,`)
        uttEn.rate = voiceSpeed
        uttEn.volume = isMuted ? 0 : voiceVolume
        uttEn.voice = chosenEn
        uttEn.lang = chosenEn.lang || 'en-US'

        // Fase 2: Español ("orden 141, ¡ya está!")
        const uttEs = new SpeechSynthesisUtterance(`orden ${num}, ¡ya está!`)
        uttEs.rate = voiceSpeed
        uttEs.volume = isMuted ? 0 : voiceVolume
        if (chosenEs && !isForbiddenRaulVoice(chosenEs.name)) {
          uttEs.voice = chosenEs
          uttEs.lang = validEsVoice?.lang || 'es-MX'
        } else {
          uttEs.voice = chosenEn
          uttEs.lang = 'es-MX'
        }

        if (onlyLang === 'en') {
          safeSpeak(uttEn, () => {
            setActiveSpeech(null)
            setTimeout(resolve, 300)
          }, true)
          return
        }

        if (onlyLang === 'es') {
          safeSpeak(uttEs, () => {
            setActiveSpeech(null)
            setTimeout(resolve, 300)
          }, true)
          return
        }

        safeSpeak(uttEn, () => {
          setTimeout(() => {
            safeSpeak(uttEs, () => {
              setActiveSpeech(null)
              setTimeout(resolve, 500)
            }, false)
          }, 200)
        }, true)
      })
    },
    [availableVoices, getBestBrowserVoice, isMuted, voiceVolume, voiceSpeed, selectedVoice]
  )

  // ── Voz natural (Gemini TTS con 5 opciones de voces de alta fidelidad) ──
  const getClipUrl = useCallback((lang: 'en' | 'es', num: string, voiceOverride?: VoiceId): Promise<string | null> => {
    const voice = voiceOverride || selectedVoice
    const key = `${voice}:${lang}:${num}`
    const cached = clipCacheRef.current.get(key)
    if (cached) return cached

    const job = (async (): Promise<string | null> => {
      const voicesToTry: VoiceId[] = voice === 'Kore' ? ['Kore'] : [voice, 'Kore']
      for (const candidateVoice of voicesToTry) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(`/api/order-ready/tts?n=${num}&lang=${lang}&voice=${candidateVoice}&v=5`, {
              signal: AbortSignal.timeout(9000)
            })
            if (!res.ok) throw new Error('tts ' + res.status)
            const blob = await res.blob()
            if (blob.size < 1000) throw new Error('tts empty blob')
            return URL.createObjectURL(blob)
          } catch (e) {
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 350))
            } else {
              console.warn(`[order-ready] TTS intento fallido (${candidateVoice}:${lang}:${num}):`, e)
            }
          }
        }
      }
      clipCacheRef.current.delete(key)
      return null
    })()
    clipCacheRef.current.set(key, job)

    // Límite de memoria: descartar el clip más antiguo
    if (clipCacheRef.current.size > 400) {
      const oldest = clipCacheRef.current.keys().next().value
      if (oldest) {
        clipCacheRef.current.get(oldest)?.then((u) => { if (u) URL.revokeObjectURL(u) })
        clipCacheRef.current.delete(oldest)
      }
    }
    return job
  }, [selectedVoice])

  const clipLangs = useCallback((): Array<'en' | 'es'> => {
    // REGLA CRÍTICA TACOS GAVILAN: Las órdenes SIEMPRE se emiten en Inglés primero y luego Español
    return ['en', 'es']
  }, [])

  const playClip = useCallback(
    (url: string): Promise<boolean> =>
      new Promise(async (resolve) => {
        let done = false
        const finish = (ok: boolean) => {
          if (!done) {
            done = true
            resolve(ok)
          }
        }

        const targetVol = isMuted ? 0 : Math.min(1, Math.max(0, voiceVolume))

        // 1. Motor Primario: Web Audio API (usa el mismo AudioContext permanentemente desbloqueado del Chime Ding-Dong).
        // Esto garantiza que el segundo clip (Español) NUNCA sea bloqueado por políticas de autoplay de HTMLAudioElement.
        try {
          if (!audioCtxRef.current) {
            unlockAudio()
          }
          const ctx = audioCtxRef.current
          if (ctx) {
            if (ctx.state === 'suspended') {
              await Promise.race([
                ctx.resume().catch(() => {}),
                new Promise((r) => setTimeout(r, 400))
              ])
            }
            // Solo usar Web Audio API si el AudioContext está efectivamente en estado 'running'.
            // Si sigue 'suspended' (ej. pestaña en segundo plano o ahorro de energía en la noche),
            // pasar de inmediato al motor HTMLAudioElement en 0ms en lugar de esperar 15s en silencio.
            if (ctx.state === 'running') {
              const res = await fetch(url)
              if (res.ok) {
                const arrayBuf = await res.arrayBuffer()
                if (arrayBuf.byteLength > 44) {
                  const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0))
                  const source = ctx.createBufferSource()
                  const gainNode = ctx.createGain()
                  source.buffer = audioBuffer
                  gainNode.gain.setValueAtTime(targetVol, ctx.currentTime)
                  source.connect(gainNode)
                  gainNode.connect(ctx.destination)
                  const timer = setTimeout(() => {
                    try { source.stop() } catch {}
                    finish(false)
                  }, 15000)
                  source.onended = () => {
                    clearTimeout(timer)
                    finish(true)
                  }
                  source.start(0)
                  return
                }
              }
            }
          }
        } catch (webAudioErr) {
          console.warn('[order-ready] Fallback de WebAudio a HTMLAudioElement:', webAudioErr)
        }

        // 2. Motor Secundario de Respaldo: HTMLAudioElement
        try {
          const audio = new Audio(url)
          audio.volume = targetVol
          const cleanupAndFinish = (ok: boolean) => {
            if (!done) {
              audio.onended = null
              audio.onerror = null
              try {
                audio.removeAttribute('src')
                audio.load()
              } catch {}
              finish(ok)
            }
          }
          audio.onended = () => cleanupAndFinish(true)
          audio.onerror = () => cleanupAndFinish(false)
          setTimeout(() => {
            if (!done) audio.pause()
            cleanupAndFinish(false)
          }, 15000)
          audio.play().catch(() => cleanupAndFinish(false))
        } catch {
          finish(false)
        }
      }),
    [isMuted, voiceVolume, unlockAudio]
  )

  // Obtener y cachear en memoria (Blob URL) el clip neuronal de Café / Champurrado pendiente ya está listo
  // Prioriza los archivos WAV estáticos pre-generados en /audio/order-ready/ para latencia de 0ms sin depender de red/compilación.
  const getBeverageClipUrl = useCallback((bevKey: string, phrase: string, voiceOverride?: VoiceId): Promise<string | null> => {
    const voice = voiceOverride || selectedVoice
    const staticUrl =
      bevKey === 'CAFE'
        ? '/audio/order-ready/cafe-listo.wav'
        : bevKey === 'CHAMPURRADO'
        ? '/audio/order-ready/champurrado-listo.wav'
        : null

    const key = `bev:${voice}:es:${bevKey}`
    const cached = clipCacheRef.current.get(key)
    if (cached) return cached

    const job = (async (): Promise<string | null> => {
      // 1. Para voz Kore (por defecto) o como carga primaria ultrarrápida, convertir el WAV estático local a Blob URL en RAM
      if (voice === 'Kore' && staticUrl) {
        try {
          const res = await fetch(staticUrl, { cache: 'force-cache' })
          if (res.ok) {
            const blob = await res.blob()
            if (blob.size >= 1000) {
              return URL.createObjectURL(blob)
            }
          }
        } catch {}
        return staticUrl
      }

      // 2. Si el admin configuró otra voz neuronal, intentar obtener su WAV de Storage/TTS con fallback inmediato al WAV estático
      try {
        const res = await fetch(
          `/api/order-ready/announcement-tts?text=${encodeURIComponent(phrase)}&lang=es&voice=${voice}`,
          { signal: AbortSignal.timeout(4000) }
        )
        if (res.ok) {
          const blob = await res.blob()
          if (blob.size >= 1000) {
            return URL.createObjectURL(blob)
          }
        }
      } catch (e) {
        console.warn(`[order-ready] Beverage TTS fallback a WAV estático (${voice}:${bevKey}):`, e)
      }

      if (staticUrl) {
        try {
          const res = await fetch(staticUrl, { cache: 'force-cache' })
          if (res.ok) {
            const blob = await res.blob()
            if (blob.size >= 1000) {
              return URL.createObjectURL(blob)
            }
          }
        } catch {}
      }
      clipCacheRef.current.delete(key)
      return staticUrl
    })()
    clipCacheRef.current.set(key, job)
    return job
  }, [selectedVoice])

  // Anuncia la orden con la voz natural seleccionada; si falla algún idioma individual, reintenta y respalda ese idioma sin omitir el español
  const speakOrder = useCallback(
    async (order: OrderItem, repeats: number = 1, voiceOverride?: VoiceId): Promise<void> => {
      const voice = voiceOverride || selectedVoice
      const bevKey = String(order.order_number || '').toUpperCase()
      const bevSpeech =
        bevKey === 'CAFE'
          ? 'Café pendiente ya está listo'
          : bevKey === 'CHAMPURRADO'
          ? 'Champurrado pendiente ya está listo'
          : null

      if (bevSpeech) {
        let clipUrl = await getBeverageClipUrl(bevKey, bevSpeech, voice)
        if (!clipUrl) return speakOrderBrowser(order, voice, 'es')

        for (let rep = 0; rep < repeats; rep++) {
          setActiveSpeech(`☕ ${bevSpeech}`)
          let ok = clipUrl ? await playClip(clipUrl) : false
          if (!ok) {
            clipCacheRef.current.delete(`bev:${voice}:es:${bevKey}`)
            clipCacheRef.current.delete(`bev:Kore:es:${bevKey}`)
            clipUrl = await getBeverageClipUrl(bevKey, bevSpeech, 'Kore')
            if (clipUrl) {
              ok = await playClip(clipUrl)
            }
          }
          if (!ok) {
            await speakOrderBrowser(order, voice, 'es')
          }
          setActiveSpeech(null)
          if (rep < repeats - 1) await new Promise((r) => setTimeout(r, 700))
        }
        await new Promise((r) => setTimeout(r, 400))
        return
      }

      const isNumeric = /^\d{1,6}$/.test(order.order_number)
      if (!isNumeric) return speakOrderBrowser(order, voice)

      const num = String(parseInt(order.order_number, 10))
      const langs = clipLangs()
      const urls = await Promise.all(langs.map((l) => getClipUrl(l, num, voice)))
      if (urls.every((u) => !u)) return speakOrderBrowser(order, voice)

      const phrase = 'Order #' + num + ' is ready, orden #' + num + ', ¡ya está!'

      for (let rep = 0; rep < repeats; rep++) {
        setActiveSpeech(phrase)
        for (let i = 0; i < langs.length; i++) {
          const lang = langs[i]
          let clipUrl = urls[i]
          let ok = clipUrl ? await playClip(clipUrl) : false

          // Si el clip de este idioma (ej. Español) falló o su blob URL expiró, limpiar caché y reintentar con Kore oficial
          if (!ok) {
            clipCacheRef.current.delete(`${voice}:${lang}:${num}`)
            clipCacheRef.current.delete(`Kore:${lang}:${num}`)
            clipUrl = await getClipUrl(lang, num, 'Kore')
            if (clipUrl) {
              urls[i] = clipUrl
              ok = await playClip(clipUrl)
            }
          }

          // Si aún así no pudo reproducirse el clip neuronal de este idioma, respaldar ese idioma específico con el navegador (NUNCA dejar mudo el español)
          if (!ok) {
            await speakOrderBrowser(order, voice, lang)
          }
        }
        setActiveSpeech(null)
        // Pausa entre repeticiones
        if (rep < repeats - 1) await new Promise((r) => setTimeout(r, 700))
      }
      await new Promise((r) => setTimeout(r, 400))
    },
    [clipLangs, getClipUrl, getBeverageClipUrl, playClip, speakOrderBrowser, selectedVoice]
  )

  // Procesador de la cola de audio - Campanilla Ding-Dong + voz natural seleccionada, en orden de cierre
  const processAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || isMuted) {
      return
    }

    isPlayingRef.current = true
    const nextOrder = audioQueueRef.current.shift()

    try {
      if (nextOrder) {
        currentlyPlayingOrderRef.current = nextOrder
        if (nextOrder._manualReplay || nextOrder._fromTablet) {
          setReplayingId(nextOrder.id)
          setReplayingOrderNum(String(nextOrder.order_number))
        }

        try {
          // Descargar los clips mientras suena la campanilla (si ya están precargados es inmediato)
          const bevKey = String(nextOrder.order_number || '').toUpperCase()
          if (bevKey === 'CAFE' || bevKey === 'CHAMPURRADO') {
            const bevPhrase = bevKey === 'CAFE' ? 'Café pendiente ya está listo' : 'Champurrado pendiente ya está listo'
            void getBeverageClipUrl(bevKey, bevPhrase, selectedVoice)
          } else if (/^\d{1,6}$/.test(nextOrder.order_number)) {
            const num = String(parseInt(nextOrder.order_number, 10))
            clipLangs().forEach((l) => { void getClipUrl(l, num, selectedVoice) })
          }

          // 1. Tocar campanilla Ding-Dong si está habilitada
          if (enableChime) {
            await playChime()
            await new Promise((r) => setTimeout(r, 150))
          }

          // 2. Anunciar con la voz seleccionada:
          // Anuncio inicial automático, recordatorio o manual -> ANNOUNCE_REPEATS (1 sola vez).
          const repeats = nextOrder._repeats || (nextOrder._reminder || nextOrder._manualReplay || nextOrder._fromTablet ? 1 : ANNOUNCE_REPEATS)
          await speakOrder(nextOrder, repeats, selectedVoice)

          // 3. Marcar como anunciada en backend SOLO para el anuncio automático inicial
          if (!nextOrder._manualReplay && !nextOrder._fromTablet && !nextOrder._reminder) {
            try {
              await fetch('/api/order-ready/orders', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: nextOrder.id, announced: true })
              })
            } catch (e) {
              console.warn('Error marking announced:', e)
            }
          }

          // 4. Programar UN solo recordatorio si tras llamar la orden desde la tableta sigue en "En Preparación" (aún no pasa a "Entregadas").
          if (!nextOrder._manualReplay && !nextOrder._reminder) {
            const currentDelaySec = reminderSecondsRef.current
            const reminderKey = `${String(nextOrder.store_code || selectedStore).toUpperCase()}:${nextOrder.order_number}`
            if (currentDelaySec > 0 && !remindedOrderIdsRef.current.has(reminderKey)) {
              remindedOrderIdsRef.current.add(reminderKey)
              const orderId = nextOrder.id
              const orderNumStr = String(nextOrder.order_number)
              const timer = setTimeout(() => {
                reminderTimersRef.current.delete(timer)
                if (reminderSecondsRef.current <= 0) return
                const alreadyDelivered =
                  readyIdsRef.current.has(orderId) ||
                  readyOrdersRef.current.some((o) => o.id === orderId || String(o.order_number) === orderNumStr)
                if (alreadyDelivered) return
                const stillInProgress = inProgressOrdersRef.current.some(
                  (o) => o.id === orderId || String(o.order_number) === orderNumStr
                )
                if (!stillInProgress) return
                const latest = nextOrder
                enqueueReminderRef.current?.({ ...latest, _reminder: true, _sortAt: Date.now() })
              }, currentDelaySec * 1000)
              reminderTimersRef.current.add(timer)
            }
          }
        } catch (e) {
          // Un error de audio NUNCA debe congelar la cola: se registra y se sigue con la siguiente
          console.warn('Error announcing order:', e)
          setActiveSpeech(null)
        }
      }
    } finally {
      currentlyPlayingOrderRef.current = null
      setReplayingId(null)
      setReplayingOrderNum(null)
      // Breve pausa acústica (400ms) entre órdenes para que el comensal distinga un llamado de otro sin encimarse
      await new Promise((r) => setTimeout(r, 400))
      isPlayingRef.current = false
      // Continuar procesando si hay más órdenes en la cola
      if (audioQueueRef.current.length > 0) {
        processAudioQueue()
      }
    }
  }, [isMuted, enableChime, playChime, speakOrder, clipLangs, getClipUrl, getBeverageClipUrl, selectedVoice])

  // Encolar una orden lista. La cola se mantiene ORDENADA por hora real de cierre (ready_at ascendente)
  const enqueueAnnouncement = useCallback(
    (order: OrderItem) => {
      // Regla de Negocio Tacos Gavilan: El módulo solo opera para FOR_HERE y TOGO
      if (order.dining_option !== 'FOR_HERE' && order.dining_option !== 'TOGO') return
      if (order.dining_option === 'TOGO' && !announceToGo) return
      if (order.dining_option === 'FOR_HERE' && !announceForHere) return

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
    [announceToGo, announceForHere, processAudioQueue]
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

  // Detectar automáticamente el idioma del anuncio (ES vs EN) según su contenido o preferencia
  const detectAnnouncementLang = useCallback(
    (text: string): 'es' | 'en' => {
      const sample = (text || '').trim()
      if (!sample) return voiceLanguage === 'en' ? 'en' : 'es'
      const hasSpanishMarkers = /[áéíóúñ¡¿]/i.test(sample) || /\b(favor|gracias|bienvenidos|recuerde|disfrute|orden|mostrador|nuestra|nuestras|salsas|limones|visita)\b/i.test(sample)
      const hasEnglishMarkers = /\b(please|thank you|welcome|remember|enjoy|picking up|counter|salsa bar|house-made|authentic|visiting|daily)\b/i.test(sample)
      if (hasEnglishMarkers && !hasSpanishMarkers) return 'en'
      if (hasSpanishMarkers && !hasEnglishMarkers) return 'es'
      return voiceLanguage === 'en' ? 'en' : 'es'
    },
    [voiceLanguage]
  )

  // Obtener y cachear en memoria (Blob URL) el clip neuronal de Anuncio al Comedor usando SIEMPRE la voz oficial Kore (la misma de todas las órdenes)
  const getAnnouncementClipUrl = useCallback((text: string, lang: 'es' | 'en'): Promise<string | null> => {
    const clean = text.trim().slice(0, 500)
    if (!clean) return Promise.resolve(null)
    const key = `ann:Kore:${lang}:${clean.toLowerCase()}`
    const cached = clipCacheRef.current.get(key)
    if (cached) return cached

    const job = (async (): Promise<string | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ttsUrl = `/api/order-ready/announcement-tts?text=${encodeURIComponent(clean)}&lang=${lang}&voice=Kore&v=3`
          const res = await fetch(ttsUrl, { signal: AbortSignal.timeout(18000) })
          if (!res.ok) throw new Error('announcement-tts ' + res.status)
          const blob = await res.blob()
          if (blob.size < 1000) throw new Error('announcement-tts empty blob')
          return URL.createObjectURL(blob)
        } catch (e) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 400))
          } else {
            console.warn(`[order-ready] Error al obtener audio neuronal Kore para anuncio (${lang}):`, e)
          }
        }
      }
      clipCacheRef.current.delete(key)
      return null
    })()

    clipCacheRef.current.set(key, job)
    return job
  }, [])

  // Precargar en segundo plano el anuncio activo con la voz Kore para que al presionar "Reproducir Ahora" suene en 0ms
  useEffect(() => {
    const clean = (announcementText || '').trim()
    if (!clean) return
    const timer = setTimeout(() => {
      const lang = detectAnnouncementLang(clean)
      void getAnnouncementClipUrl(clean, lang)
    }, 350)
    return () => clearTimeout(timer)
  }, [announcementText, detectAnnouncementLang, getAnnouncementClipUrl])

  // Regla de Negocio Tacos Gavilan: Reproducción de anuncios personalizados (manual o periódica) usando siempre la voz Kore de las órdenes
  const playCustomAnnouncement = useCallback(
    async (textOverride?: string) => {
      const textToPlay = (textOverride || announcementTextRef.current || '').trim()
      if (!textToPlay) return
      if (isMuted) return

      // Si una orden se está anunciando en este instante o hay órdenes en cola, reprogramar en 6 segundos
      if (isPlayingRef.current || audioQueueRef.current.length > 0) {
        setTimeout(() => {
          playCustomAnnouncement(textToPlay)
        }, 6000)
        return
      }

      unlockAudio()
      isPlayingRef.current = true
      setIsPlayingAnnouncement(true)

      const displayBanner = `${t('orderReadyBoard.announcement_banner_prefix')}: "${textToPlay.length > 55 ? textToPlay.slice(0, 52) + '...' : textToPlay}"`
      setActiveSpeech(displayBanner)

      try {
        // Descargar/obtener de caché el clip de Kore mientras suena la campanilla Ding-Dong
        const lang = detectAnnouncementLang(textToPlay)
        const clipPromise = getAnnouncementClipUrl(textToPlay, lang)

        // 1. Tocar campanilla Ding-Dong si está habilitada
        if (enableChime) {
          await playChime()
          await new Promise((r) => setTimeout(r, 250))
        }

        // 2. Reproducir con la voz neuronal oficial Kore (/api/order-ready/announcement-tts)
        let playedOk = false
        let clipUrl = await clipPromise
        if (clipUrl) {
          playedOk = await playClip(clipUrl)
          if (!playedOk) {
            clipCacheRef.current.delete(`ann:Kore:${lang}:${textToPlay.toLowerCase()}`)
            clipUrl = await getAnnouncementClipUrl(textToPlay, lang)
            if (clipUrl) {
              playedOk = await playClip(clipUrl)
            }
          }
        }

        // 3. Fallback seguro a síntesis del navegador con estricto filtro anti-Raúl
        if (!playedOk && typeof window !== 'undefined' && 'speechSynthesis' in window) {
          await new Promise<void>((resolve) => {
            const rawVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices()
            const voices = rawVoices.filter((v) => !isForbiddenRaulVoice(v.name))
            const targetVoice = getBestBrowserVoice(lang, voices, 'Kore')

            // REGLA CRÍTICA TACOS GAVILAN: Bloquear si no hay voz explícita (para que Windows SAPI no use Raúl)
            if (!targetVoice || isForbiddenRaulVoice(targetVoice.name)) {
              console.warn('[order-ready] Bloqueo anti-Raúl en anuncio: sin voz explícita no-Raúl disponible.')
              resolve()
              return
            }

            const vNameNorm = targetVoice.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            if (/raul|david|male|hombre|jorge|diego|pablo|miguel|guy|mark|george/i.test(vNameNorm)) {
              console.warn('[order-ready] Bloqueo de seguridad en anuncio: voz masculina descartada para meta femenina.')
              resolve()
              return
            }

            const utt = new SpeechSynthesisUtterance(textToPlay)
            utt.rate = voiceSpeed
            utt.volume = isMuted ? 0 : voiceVolume
            utt.voice = targetVoice
            utt.lang = targetVoice.lang || (lang === 'es' ? 'es-MX' : 'en-US')

            utt.onend = () => resolve()
            utt.onerror = () => resolve()
            try {
              window.speechSynthesis.speak(utt)
            } catch {
              resolve()
            }
            setTimeout(resolve, 20000)
          })
        }
      } catch (err) {
        console.error('[order-ready] Error en anuncio:', err)
      } finally {
        // Pausa acústica para evitar encimamiento con el siguiente llamado
        await new Promise((r) => setTimeout(r, 400))
        setActiveSpeech(null)
        setIsPlayingAnnouncement(false)
        isPlayingRef.current = false

        // Si llegaron órdenes a la cola durante el anuncio, anunciarlas respetando el orden
        if (audioQueueRef.current.length > 0) {
          processAudioQueue()
        }
      }
    },
    [
      isMuted,
      enableChime,
      playChime,
      detectAnnouncementLang,
      getAnnouncementClipUrl,
      playClip,
      availableVoices,
      getBestBrowserVoice,
      voiceSpeed,
      voiceVolume,
      processAudioQueue,
      unlockAudio,
      t
    ]
  )

  // Temporizador para la reproducción periódica del anuncio
  useEffect(() => {
    if (!announcementEnabled || announcementIntervalMin <= 0) {
      setNextAnnouncementSec(null)
      return
    }

    const intervalMs = announcementIntervalMin * 60 * 1000
    let targetTime = Date.now() + intervalMs

    const timer = setInterval(() => {
      const now = Date.now()
      const remaining = Math.max(0, Math.ceil((targetTime - now) / 1000))
      setNextAnnouncementSec(remaining)

      if (remaining <= 0) {
        targetTime = Date.now() + intervalMs
        if (!isMuted && announcementTextRef.current.trim().length > 0) {
          playCustomAnnouncement()
        }
      }
    }, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [announcementEnabled, announcementIntervalMin, isMuted, playCustomAnnouncement])

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

  // Recorte de memoria y autolimpieza de caché/token cada 10 minutos para operación 24/7
  useEffect(() => {
    purgeTabletStaleCaches({ activeDate: getCaliforniaBusinessDate() }).catch(() => {})
    const trim = setInterval(() => {
      const set = announcedIdsRef.current
      if (set.size > 500) {
        const keep = Array.from(set).slice(-250)
        announcedIdsRef.current = new Set(keep)
      }
      purgeTabletStaleCaches({ activeDate: getCaliforniaBusinessDate() }).catch(() => {})
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

  // Cargar órdenes desde el backend (por defecto solo lectura de BD: syncToast=false)
  const fetchOrders = useCallback(async (syncToast = false, forceToast = false) => {
    // No consultar hasta confirmar que el usuario tiene permiso para esta tienda
    if (!storeOk) return
    // Evita peticiones encimadas si la red/PC va lenta (una a la vez)
    if (fetchingRef.current && !forceToast) return
    fetchingRef.current = true
    const timeoutMs = syncToast || forceToast ? 35000 : 20000
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      if (syncToast || forceToast) {
        setIsSyncing(true)
        purgeTabletStaleCaches({ activeDate: getCaliforniaBusinessDate() }).catch(() => {})
      }
      const res = await fetch(`/api/order-ready/orders?storeCode=${selectedStore}&syncToast=${syncToast}&forceToast=${forceToast}&minutes=45&_t=${Date.now()}`, {
        signal: controller.signal,
        cache: 'no-store',
        headers: getTabletNoCacheHeaders()
      })
      const data = await res.json()

      if (data.success) {
        if (data.businessDate) {
          if (businessDateRef.current && data.businessDate !== businessDateRef.current) {
            resetForNewBusinessDay(data.businessDate)
          } else {
            setBusinessDate(data.businessDate)
            businessDateRef.current = data.businessDate
          }
        }
        if (data.shift) {
          setShift(data.shift)
        }

        const ready: OrderItem[] = data.readyOrders || []
        const inProgress: OrderItem[] = data.inProgressOrders || []
        const bevCalls: OrderItem[] = Array.isArray(data.beverageCalls) ? data.beverageCalls : []

        setReadyOrders(ready)
        readyOrdersRef.current = ready
        setInProgressOrders(inProgress)
        inProgressOrdersRef.current = inProgress
        readyIdsRef.current = new Set(ready.map(o => o.id))

        const isFirstFetchForStore = activeStoreRef.current !== selectedStore

        if (isFirstFetchForStore) {
          // Primera carga al abrir el módulo o al cambiar de tienda:
          // Se muestran en pantalla todas las órdenes que ya estaban en la fila, pero en SILENCIO.
          // Registramos los IDs en announcedIdsRef y los timestamps preexistentes en lastAnnouncedAtMsRef
          // para que la cola de audio NO anuncie en avalancha órdenes que ya estaban listas o habían sido llamadas antes de ingresar.
          activeStoreRef.current = selectedStore
          ready.forEach(ord => {
            announcedIdsRef.current.add(ord.id)
          })
          ;[...ready, ...inProgress, ...bevCalls].forEach(ord => {
            if (ord.announced_at) {
              const annMs = Date.parse(ord.announced_at)
              if (!isNaN(annMs)) {
                const storeKey = `${String(ord.store_code || selectedStore).toUpperCase()}:${ord.order_number}`
                lastAnnouncedAtMsRef.current.set(storeKey, annMs)
              }
            }
          })
        } else {
          // En ciclos posteriores (pantalla ya abierta y operando en vivo):
          // REGLA CRÍTICA TACOS GAVILAN: El bump del cocinero en Toast KDS NO debe emitir voz por altavoz.
          // La voz se emite exclusivamente cuando el preparador toca la orden en su tableta
          // (evento Realtime broadcast 'call_order') o cuando el usuario hace clic manual para re-anunciar.
          // Por lo tanto, registramos todas las órdenes listas en announcedIdsRef para garantizar silencio ante bumps de KDS.
          ready.forEach(ord => {
            announcedIdsRef.current.add(ord.id)
          })

          // Capa 4 de Redundancia (Polling Fallback):
          // Si el WebSocket y Postgres Changes fallaron o se desconectaron momentáneamente en la noche,
          // el polling periódico detecta si una orden fue llamada en los últimos 45 segundos
          // (cubriendo latencias de Toast sync >10s o throttling de pestaña en segundo plano)
          // y dispara el anuncio ÚNICAMENTE si ese impulso exacto (annMs) no ha sonado ya por las Capas 1-3.
          ;[...ready, ...inProgress, ...bevCalls].forEach(ord => {
            if (ord.announced_at) {
              const annMs = Date.parse(ord.announced_at)
              if (!isNaN(annMs) && (Date.now() - annMs) < 45000) {
                const storeKey = `${String(ord.store_code || selectedStore).toUpperCase()}:${ord.order_number}`
                const lastCall = lastImpulseTimeRef.current.get(storeKey) || 0
                const lastAnnMs = lastAnnouncedAtMsRef.current.get(storeKey) || 0
                const isSameTap = lastAnnMs > 0 && Math.abs(annMs - lastAnnMs) < 2500
                const isRecentCall = lastCall > 0 && (Date.now() - lastCall) < 6000
                if (isSameTap || isRecentCall) {
                  if (isRecentCall && (lastAnnMs === 0 || Math.abs(annMs - lastAnnMs) < 5000)) {
                    lastAnnouncedAtMsRef.current.set(storeKey, annMs)
                  }
                } else {
                  handleImpulseRef.current?.({
                    order_id: ord.id,
                    order_number: ord.order_number,
                    store_code: ord.store_code,
                    dining_option: ord.dining_option,
                    store_name: ord.store_name,
                    called_at: ord.announced_at
                  })
                }
              }
            }
          })
        }
      }
    } catch (e: any) {
      // Ignorar AbortError silenciosamente cuando la petición es cancelada por timeout o refresco
      if (e?.name === 'AbortError' || controller.signal.aborted) {
        return
      }
      console.warn('Error fetching orders:', e)
    } finally {
      clearTimeout(abortTimer)
      fetchingRef.current = false
      setIsLoading(false)
      setIsSyncing(false)
    }
  }, [selectedStore, storeOk, enqueueAnnouncement, resetForNewBusinessDay])

  // Mantener referencia actual de fetchOrders para el centinela de las 6:00 AM
  useEffect(() => {
    fetchOrdersRef.current = fetchOrders
  }, [fetchOrders])

  // FASE 8: Separar el polling visual de solo lectura (cada 4s con syncToast=false)
  // del flujo explícito de detección de KDS bump contra Toast (cada 10s con syncToast=true).
  useEffect(() => {
    if (!storeOk) return
    fetchOrdersRef.current?.(false, false)
    const initialToastSyncTimeout = setTimeout(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchOrdersRef.current?.(true, false)
      }
    }, 500)
    const readOnlyInterval = setInterval(() => {
      fetchOrdersRef.current?.(false, false)
    }, 4000)
    const explicitToastSyncInterval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchOrdersRef.current?.(true, false)
      }
    }, 10000)
    return () => {
      clearTimeout(initialToastSyncTimeout)
      clearInterval(readOnlyInterval)
      clearInterval(explicitToastSyncInterval)
    }
  }, [selectedStore, storeOk])

  // Precargar la voz de las órdenes en preparación (las más antiguas primero) para que el anuncio sea instantáneo
  useEffect(() => {
    if (prefetchRunningRef.current || inProgressOrders.length === 0) return
    prefetchRunningRef.current = true
    const targets = [...inProgressOrders].reverse().slice(0, 12)
    const langs = clipLangs()
    ;(async () => {
      try {
        for (const o of targets) {
          if (!/^\d{1,6}$/.test(o.order_number)) continue
          const num = String(parseInt(o.order_number, 10))
          for (const l of langs) await getClipUrl(l, num, selectedVoice)
        }
      } finally {
        prefetchRunningRef.current = false
      }
    })()
  }, [inProgressOrders, clipLangs, getClipUrl, selectedVoice])

  // Precargar los clips de Café y Champurrado al montar o cambiar de voz para reproducción en 0ms
  useEffect(() => {
    void getBeverageClipUrl('CAFE', 'Café pendiente ya está listo', selectedVoice)
    void getBeverageClipUrl('CHAMPURRADO', 'Champurrado pendiente ya está listo', selectedVoice)
  }, [getBeverageClipUrl, selectedVoice])

  // Suscripción a Supabase Realtime aislada por tienda con filtro server-side, debounce 500ms y sin reconexión en CLOSED intencional
  useEffect(() => {
    const normalizedStore = String(selectedStore || 'LYNWOOD').toUpperCase()
    const channelTopic = `order-ready-realtime:${normalizedStore}`

    let unmounted = false
    let activeChannel: any = null
    let disposeCurrentChannelGuard: (() => void) | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let realtimeDebounceTimer: ReturnType<typeof setTimeout> | null = null

    const disposeActiveChannel = () => {
      if (disposeCurrentChannelGuard) {
        disposeCurrentChannelGuard()
        disposeCurrentChannelGuard = null
      }
      if (activeChannel) {
        const chToRemove = activeChannel
        activeChannel = null
        supabase.removeChannel(chToRemove).catch(() => {})
      }
    }

    const scheduleRealtimeReadOnlyRefresh = () => {
      if (unmounted) return
      if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer)
      realtimeDebounceTimer = setTimeout(() => {
        realtimeDebounceTimer = null
        if (!unmounted && !fetchingRef.current) {
          // Callback Realtime NUNCA inicia sincronización Toast (syncToast=false)
          fetchOrdersRef.current?.(false, false)
        }
      }, 500)
    }

    const setupChannel = () => {
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
            filter: `store_code=eq.${normalizedStore}`
          },
          (payload) => {
            if (unmounted || channelDisposed) return
            const newRow = payload.new as any
            const oldRow = payload.old as any
            const row = (newRow || oldRow) as OrderItem
            const rowStore = String(row?.store_code || normalizedStore).toUpperCase()
            if (row && rowStore === normalizedStore) {
              // Capa 3 de Redundancia (PostgreSQL Replication Fallback):
              // Si la llamada fue persistida en base de datos con un announced_at reciente (<45s)
              // y ese impulso aún no ha sido reproducido por las Capas 1 o 2, activar el llamado.
              if (newRow && newRow.announced_at) {
                const announcedMs = Date.parse(newRow.announced_at)
                if (!isNaN(announcedMs) && (Date.now() - announcedMs) < 45000) {
                  const storeKey = `${rowStore}:${newRow.order_number}`
                  const lastCall = lastImpulseTimeRef.current.get(storeKey) || 0
                  const lastAnnMs = lastAnnouncedAtMsRef.current.get(storeKey) || 0
                  const isSameTap = lastAnnMs > 0 && Math.abs(announcedMs - lastAnnMs) < 2500
                  const isRecentCall = lastCall > 0 && (Date.now() - lastCall) < 6000
                  if (isSameTap || isRecentCall) {
                    if (isRecentCall && (lastAnnMs === 0 || Math.abs(announcedMs - lastAnnMs) < 5000)) {
                      lastAnnouncedAtMsRef.current.set(storeKey, announcedMs)
                    }
                  } else {
                    handleImpulseRef.current?.({
                      order_id: newRow.id,
                      order_number: newRow.order_number,
                      store_code: newRow.store_code,
                      dining_option: newRow.dining_option,
                      store_name: newRow.store_name,
                      called_at: newRow.announced_at
                    })
                  }
                }
              }
              scheduleRealtimeReadOnlyRefresh()
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'order_ready_settings',
            filter: 'id=eq.global'
          },
          (payload) => {
            if (unmounted || channelDisposed) return
            const newRow = payload.new as any
            if (newRow && newRow.id === 'global' && newRow.voice && isValidVoice(newRow.voice)) {
              setSelectedVoice(newRow.voice)
              if (typeof window !== 'undefined') {
                localStorage.setItem('teg_order_ready_voice', newRow.voice)
              }
            }
          }
        )
        .on(
          'broadcast',
          { event: 'call_order' },
          (payload) => {
            if (unmounted || channelDisposed) return
            const data = payload?.payload
            if (!data) return
            if (String(data.store_code || '').toUpperCase() !== normalizedStore) return
            handleImpulseRef.current?.(data)
          }
        )
        .subscribe((status: string) => {
          // No reconectar si el componente se desmontó o el canal fue cerrado intencionalmente
          if (unmounted || channelDisposed || activeChannel !== channel) return
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null
              if (!unmounted && !channelDisposed) {
                setupChannel()
                // No sincronizar Toast durante reconexión: refresco de solo lectura
                scheduleRealtimeReadOnlyRefresh()
              }
            }, 2500)
          }
        })

      activeChannel = channel
    }

    setupChannel()

    const handleResumeConnection = () => {
      if (!unmounted && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        scheduleRealtimeReadOnlyRefresh()
      }
    }
    window.addEventListener('online', handleResumeConnection)
    document.addEventListener('visibilitychange', handleResumeConnection)

    return () => {
      unmounted = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (realtimeDebounceTimer) {
        clearTimeout(realtimeDebounceTimer)
        realtimeDebounceTimer = null
      }
      window.removeEventListener('online', handleResumeConnection)
      document.removeEventListener('visibilitychange', handleResumeConnection)
      disposeActiveChannel()
    }
  }, [selectedStore])

  // Probar campanilla Ding-Dong y voz natural con la voz seleccionada
  const handleTestSound = async (voiceToTest?: VoiceId) => {
    // Si ya hay un audio sonando o en cola, no encimar la prueba de audio
    if (isPlayingRef.current || audioQueueRef.current.length > 0) {
      return
    }
    unlockAudio()
    const voice = voiceToTest || selectedVoice
    setIsTestingVoice(true)
    isPlayingRef.current = true
    try {
      if (enableChime) {
        await playChime()
        await new Promise((r) => setTimeout(r, 150))
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
      await new Promise((r) => setTimeout(r, 400))
      isPlayingRef.current = false
      setIsTestingVoice(false)
      if (audioQueueRef.current.length > 0) {
        processAudioQueue()
      }
    }
  }

  // Simular creación de orden de prueba con números representativos de Toast
  const handleSimulateOrder = async (diningOption: 'TOGO' | 'FOR_HERE' = 'TOGO') => {
    unlockAudio()
    // Números representativos con audio de alta fidelidad garantizado en Storage
    const sampleNumbers = ['141', '50', '61', '12', '15', '18', '20', '24', '25', '30', '35', '40']
    const randomNum = sampleNumbers[Math.floor(Math.random() * sampleNumbers.length)]
    try {
      const res = await fetch('/api/order-ready/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode: selectedStore,
          orderNumber: String(randomNum),
          diningOption,
          status: 'READY',
          customer_name: diningOption === 'TOGO' ? 'Para Llevar' : 'Comer Aquí'
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

  // Clases sobrias y ejecutivas para el indicador de tiempo (sin colores estridentes ni parpadeos)
  const getSosBadgeClasses = (_color: 'green' | 'yellow' | 'red') => {
    if (isDark) {
      return 'bg-slate-800/80 text-slate-300 border-slate-700'
    }
    return 'bg-slate-100 text-slate-600 border-slate-200 font-semibold'
  }

  // Precarga silenciosa del recibo al pasar el cursor (hover) para apertura en 0ms al hacer clic
  const prefetchOrderDetail = useCallback((order: OrderItem) => {
    const storeId = order.store_id || STORE_GUID_BY_CODE[order.store_code] || ''
    const orderGuid = order.order_guid || ''
    if (!orderGuid || !storeId) return
    if (orderDetailCacheRef.current.has(orderGuid) || orderDetailInflightRef.current.has(orderGuid)) return

    const req = fetch(`/api/toast-order-detail?guid=${orderGuid}&storeId=${storeId}`)
      .then(res => res.json())
      .then(data => {
        if (data?.order) {
          orderDetailCacheRef.current.set(orderGuid, data.order)
        }
        return data
      })
      .catch(() => null)
      .finally(() => {
        orderDetailInflightRef.current.delete(orderGuid)
      })

    orderDetailInflightRef.current.set(orderGuid, req)
  }, [])

  // Abrir modal de ticket idéntico al módulo de Drive-Thru con caché instantáneo y vista previa inmediata
  const handleOrderClick = useCallback((order: OrderItem) => {
    const storeId = order.store_id || STORE_GUID_BY_CODE[order.store_code] || ''
    const orderGuid = order.order_guid || ''

    // Extraer platillos de items_summary para mostrarlos al instante (0ms) mientras llegan precios/impuestos
    let previewItems: Array<{ name: string; quantity: number; modifiers?: string[] }> = []
    if (order.items_summary) {
      try {
        const parsed = typeof order.items_summary === 'string' ? JSON.parse(order.items_summary) : order.items_summary
        if (Array.isArray(parsed)) previewItems = parsed
      } catch {
        // Ignorar errores de parseo
      }
    }

    const cachedOrder = orderGuid ? orderDetailCacheRef.current.get(orderGuid) : undefined
    if (cachedOrder) {
      setOrderDetailData({
        loading: false,
        checkId: order.order_number,
        storeName: order.store_name || selectedStore,
        cajeraName: order.dining_option === 'DRIVE_THRU' ? 'Drive-Thru' : t('orderReadyBoard.receipt_cashier_fallback'),
        diningOption: order.dining_option,
        openedAt: order.created_at,
        customerName: order.customer_name,
        previewItems,
        data: cachedOrder
      })
      return
    }

    setOrderDetailData({
      loading: true,
      checkId: order.order_number,
      storeName: order.store_name || selectedStore,
      cajeraName: order.dining_option === 'DRIVE_THRU' ? 'Drive-Thru' : t('orderReadyBoard.receipt_cashier_fallback'),
      diningOption: order.dining_option,
      openedAt: order.created_at,
      customerName: order.customer_name,
      previewItems
    })

    if (!orderGuid || !storeId) {
      setOrderDetailData(prev =>
        prev
          ? {
              ...prev,
              loading: false,
              error: t('orderReadyBoard.guid_not_found')
            }
          : null
      )
      return
    }

    const existingPromise = orderDetailInflightRef.current.get(orderGuid)
    const promise =
      existingPromise ||
      fetch(`/api/toast-order-detail?guid=${orderGuid}&storeId=${storeId}`).then(res => res.json())

    promise
      .then(data => {
        if (!data) return
        if (data.error) {
          setOrderDetailData(prev => (prev ? { ...prev, loading: false, error: data.error } : null))
        } else {
          if (data.order) orderDetailCacheRef.current.set(orderGuid, data.order)
          setOrderDetailData(prev => (prev ? { ...prev, loading: false, data: data.order } : null))
        }
      })
      .catch(err => {
        setOrderDetailData(prev => (prev ? { ...prev, loading: false, error: err.message } : null))
      })
  }, [t, selectedStore])

  // Re-anunciar orden manualmente a solicitud del usuario
  // Regla de Negocio Tacos Gavilan: Encolar de manera unificada para esperar su turno si ya hay otro audio sonando
  const handleReplayVoice = useCallback(
    (order: OrderItem) => {
      unlockAudio()
      const orderNumStr = String(order.order_number)
      if (currentlyPlayingOrderRef.current && (currentlyPlayingOrderRef.current.id === order.id || String(currentlyPlayingOrderRef.current.order_number) === orderNumStr)) {
        return
      }
      const alreadyInQueue = audioQueueRef.current.some(
        (item) => item.id === order.id || String(item.order_number) === orderNumStr
      )
      if (!alreadyInQueue) {
        const replayItem: OrderItem = {
          ...order,
          _manualReplay: true,
          _repeats: 1,
          _sortAt: Date.now()
        }
        audioQueueRef.current.push(replayItem)
        if (!isPlayingRef.current) {
          processAudioQueue()
        }
      }
    },
    [unlockAudio, processAudioQueue]
  )

  // Impulso recibido en tiempo real desde la tableta del preparador (entregador de cocina)
  // Regla de Negocio Tacos Gavilan: Encolar de manera unificada para esperar su turno si ya hay otro audio sonando
  const handleImpulseCallFromTablet = useCallback(
    (data: { order_id?: string; order_number: string; store_code: string; dining_option?: string; store_name?: string; called_at?: string }) => {
      if (data.dining_option && data.dining_option !== 'FOR_HERE' && data.dining_option !== 'TOGO') {
        return
      }
      unlockAudio()

      const now = Date.now()
      const orderNumStr = String(data.order_number)
      const normStore = String(data.store_code || selectedStore).toUpperCase()
      const storeKey = `${normStore}:${orderNumStr}`
      const incomingCalledMs = data.called_at ? Date.parse(data.called_at) : NaN

      // 1. Deduplicación exacta por timestamp de toque (called_at) y debounce acústico de 6 segundos por tienda+orden.
      const lastCallTime = lastImpulseTimeRef.current.get(storeKey) || 0
      const lastAnnMs = lastAnnouncedAtMsRef.current.get(storeKey) || 0
      const isSameTap = !isNaN(incomingCalledMs) && lastAnnMs > 0 && Math.abs(incomingCalledMs - lastAnnMs) < 2500
      const isRecentCall = lastCallTime > 0 && (now - lastCallTime) < 6000
      if (isSameTap || isRecentCall) {
        if (isRecentCall && !isNaN(incomingCalledMs) && (lastAnnMs === 0 || Math.abs(incomingCalledMs - lastAnnMs) < 5000)) {
          lastAnnouncedAtMsRef.current.set(storeKey, incomingCalledMs)
        }
        console.log(`[OrderReadyBoard] Impulso duplicado ignorado por debounce para orden #${orderNumStr}`)
        return
      }

      // 2. Si la orden está sonando activamente en este instante en el altavoz, evitar duplicar el llamado
      if (currentlyPlayingOrderRef.current && String(currentlyPlayingOrderRef.current.order_number) === orderNumStr) {
        console.log(`[OrderReadyBoard] Orden #${orderNumStr} ya está sonando en este instante`)
        return
      }

      // Buscar la orden en el listado actual en memoria (tanto READY como IN_PROGRESS) o construir un objeto representativo
      const found =
        readyOrdersRef.current.find(
          (o) => (data.order_id && o.id === data.order_id) || String(o.order_number) === orderNumStr
        ) ||
        inProgressOrdersRef.current.find(
          (o) => (data.order_id && o.id === data.order_id) || String(o.order_number) === orderNumStr
        )

      const targetOrder: OrderItem = found || {
        id: data.order_id || `tablet-${data.order_number}-${Date.now()}`,
        created_at: new Date().toISOString(),
        store_code: data.store_code,
        store_name: data.store_name || data.store_code,
        order_number: orderNumStr,
        dining_option: (data.dining_option as any) || 'TOGO',
        customer_name: null,
        status: 'READY',
        ready_at: new Date().toISOString(),
        announced: true,
        items_summary: null
      }

      // Destacar visualmente la orden en el tablero del manager
      setTabletCalledOrderId(targetOrder.id)
      setTabletCalledOrderNum(orderNumStr)
      setTimeout(() => {
        setTabletCalledOrderId((prev) => (prev === targetOrder.id ? null : prev))
        setTabletCalledOrderNum((prev) => (prev === orderNumStr ? null : prev))
      }, 7000)

      const alreadyInQueue = audioQueueRef.current.some(
        (item) => item.id === targetOrder.id || (String(item.order_number) === orderNumStr && (item._fromTablet || item._manualReplay))
      )
      if (!alreadyInQueue) {
        lastImpulseTimeRef.current.set(storeKey, now)
        lastAnnouncedAtMsRef.current.set(storeKey, !isNaN(incomingCalledMs) ? incomingCalledMs : now)
        const impulseItem: OrderItem = {
          ...targetOrder,
          _fromTablet: true,
          _repeats: 1,
          _sortAt: Date.now()
        }
        audioQueueRef.current.push(impulseItem)
        if (!isPlayingRef.current) {
          processAudioQueue()
        }
      }
    },
    [unlockAudio, processAudioQueue, selectedStore]
  )

  useEffect(() => {
    handleImpulseRef.current = handleImpulseCallFromTablet
  }, [handleImpulseCallFromTablet])

  // Badge sobrio y profesional para Dining Option: siempre "FOR HERE" o "TO GO"
  const renderDiningBadge = (dining?: string | null) => {
    const baseClasses = `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider border ${
      isDark
        ? 'bg-slate-800 text-slate-300 border-slate-700'
        : 'bg-slate-100 text-slate-700 border-slate-200'
    }`
    if (dining === 'FOR_HERE') {
      return (
        <span className={baseClasses}>
          <Utensils className="w-3 h-3 opacity-70" />
          <span>{t('orderReadyBoard.for_here_badge')}</span>
        </span>
      )
    }
    if (dining === 'DRIVE_THRU') {
      return (
        <span className={baseClasses}>
          <Car className="w-3 h-3 opacity-70" />
          <span>{t('orderReadyBoard.dt_badge')}</span>
        </span>
      )
    }
    if (dining === 'DELIVERY') {
      return (
        <span className={baseClasses}>
          <span>{t('orderReadyBoard.delivery_badge')}</span>
        </span>
      )
    }
    return (
      <span className={baseClasses}>
        <ShoppingBag className="w-3 h-3 opacity-70" />
        <span>{t('orderReadyBoard.to_go_badge')}</span>
      </span>
    )
  }

  return (
    <div
      ref={containerRef}
      onClick={unlockAudio}
      className={`min-h-screen flex flex-col font-sans select-none overflow-x-hidden relative transition-colors duration-200 ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      } ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-screen rounded-none border-0'
          : isDark
            ? 'rounded-2xl border border-slate-800/80 shadow-xl'
            : 'rounded-2xl border border-slate-200 shadow-sm'
      }`}
    >
      {/* Banner de Activación de Audio (si aún no se ha interactuado) */}
      {!audioUnlocked && (
        <div className="bg-slate-900 text-white px-4 py-2.5 text-center text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-md z-50">
          <Bell className="w-4 h-4 text-slate-300" />
          <span>{t('orderReadyBoard.enable_audio_prompt')}</span>
          <span className="underline ml-2 bg-white/15 px-2 py-0.5 rounded text-xs">
            {t('orderReadyBoard.click_to_enable_audio')}
          </span>
        </div>
      )}

      {/* Top Header / Barra Superior */}
      <header className={`px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b transition-colors ${
        isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        {/* Título del Módulo, Selector de Sucursal y Voz */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={`text-lg sm:text-xl font-black tracking-tight uppercase ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {t('orderReadyBoard.title')}
          </h1>

          <div className={`hidden sm:block h-5 w-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Store className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
              {accessLoaded && visibleStores.length === 0 ? (
                <span className="text-xs font-semibold text-slate-500">{t('orderReadyBoard.no_store_assigned')}</span>
              ) : (
                <select
                  value={selectedStore}
                  onChange={(e) => handleStoreChange(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={visibleStores.length <= 1}
                  className={`font-bold text-xs rounded-lg px-2.5 py-1.5 border focus:outline-none cursor-pointer transition disabled:opacity-80 disabled:cursor-default ${
                    isDark
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                  }`}
                >
                  {visibleStores.map((s) => (
                    <option key={s.code} value={s.code} className={isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Selector Rápido de Voz en Cabecera (Solo Admin puede cambiarla) */}
            {isAdmin ? (
              <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border transition ${
                isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
              }`}>
                <Volume2 className={`w-3.5 h-3.5 shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                <select
                  value={selectedVoice}
                  onChange={(e) => handleVoiceChange(e.target.value as VoiceId)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={isSavingVoice}
                  title={t('orderReadyBoard.voice_speaker')}
                  className={`bg-transparent font-semibold text-xs focus:outline-none cursor-pointer ${
                    isDark ? 'text-slate-200 hover:text-white' : 'text-slate-800 hover:text-slate-900'
                  }`}
                >
                  {AVAILABLE_VOICES.map((v) => (
                    <option key={v.id} value={v.id} className={isDark ? 'bg-slate-900 text-white font-medium' : 'bg-white text-slate-900 font-medium'}>
                      {v.name} ({v.gender === 'female' ? t('orderReadyBoard.voice_female_label') : t('orderReadyBoard.voice_male_label')})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border cursor-help ${
                  isDark ? 'bg-slate-800/60 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
                title={t('orderReadyBoard.voice_locked_hint')}
              >
                <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                <span className={`text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {selectedVoice}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Reloj, Idioma, Modo Normal/Oscuro, Pantalla Completa y Controles */}
        <div className="flex items-center gap-2">
          {/* Reloj y Turno de California */}
          <div className={`hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-xl border ${
            isDark ? 'bg-slate-800/60 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}>
            <div className="flex items-center gap-1.5 font-mono font-bold text-sm tracking-wider">
              <Clock className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
              <span>{currentTime || '--:--:--'}</span>
            </div>
            <div className={`h-4 w-px ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                isDark ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-white text-slate-700 border border-slate-200'
              }`}
              title={`${t('orderReadyBoard.business_day')}: ${businessDate} • ${shift === 'AM' ? t('orderReadyBoard.shift_am') : t('orderReadyBoard.shift_pm')}`}
            >
              <span>{shift === 'AM' ? t('orderReadyBoard.shift_am_short') : t('orderReadyBoard.shift_pm_short')}</span>
            </div>
          </div>

          {/* Botón Selector de Idioma de Pantalla (ES / EN) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setLanguage(language === 'es' ? 'en' : 'es')
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
            title={language === 'es' ? t('orderReadyBoard.switch_to_english') : t('orderReadyBoard.switch_to_spanish')}
          >
            <Globe className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
            <span className={language === 'en' ? (isDark ? 'text-white font-black' : 'text-slate-900 font-black') : 'text-slate-400 font-medium'}>EN</span>
            <span className="text-slate-300 dark:text-slate-600 font-normal">/</span>
            <span className={language === 'es' ? (isDark ? 'text-white font-black' : 'text-slate-900 font-black') : 'text-slate-400 font-medium'}>ES</span>
          </button>

          {/* Botón Selector de Tema: Normal (Claro) vs Oscuro */}
          <button
            type="button"
            onClick={(e) => toggleTheme(e)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
            title={isDark ? t('orderReadyBoard.theme_toggle_to_light') : t('orderReadyBoard.theme_toggle_to_dark')}
          >
            {isDark ? (
              <>
                <Sun className="w-3.5 h-3.5 text-slate-300" />
                <span className="hidden sm:inline">{t('orderReadyBoard.theme_normal')}</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">{t('orderReadyBoard.theme_dark')}</span>
              </>
            )}
          </button>

          {/* Modo TV / Pantalla Completa (Fullscreen) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleFullscreen()
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
            title={isFullscreen ? t('orderReadyBoard.exit_tv_mode_tooltip') : t('orderReadyBoard.tv_mode_tooltip')}
          >
            {isFullscreen ? (
              <Minimize className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <Maximize className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
            )}
            <span className="hidden xl:inline">{isFullscreen ? t('orderReadyBoard.exit_tv_mode') : t('orderReadyBoard.tv_mode')}</span>
          </button>

          {/* Estado de Audio */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsMuted(!isMuted)
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all ${
              isMuted
                ? isDark
                  ? 'bg-rose-950/40 text-rose-300 border-rose-800/60'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
                : isDark
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isMuted ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-slate-500" />}
            <span className="hidden md:inline">
              {isMuted ? t('orderReadyBoard.audio_muted') : t('orderReadyBoard.audio_enabled')}
            </span>
          </button>

          {/* Indicador de Anuncios Periódicos en Cabecera */}
          {announcementEnabled && (
            <div
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                isPlayingAnnouncement
                  ? 'bg-slate-900 text-white border-slate-800'
                  : isDark
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title={`${t('orderReadyBoard.announcement_active_pill_tooltip')} ${announcementIntervalMin} min`}
            >
              <Megaphone className="w-3.5 h-3.5 text-slate-500" />
              <span>{announcementIntervalMin}m</span>
              {nextAnnouncementSec !== null && !isPlayingAnnouncement && (
                <span className="text-[10px] opacity-75 font-mono">
                  ({Math.floor(nextAnnouncementSec / 60)}:{String(nextAnnouncementSec % 60).padStart(2, '0')})
                </span>
              )}
            </div>
          )}

          {/* Botón de Ajustes / Drawer de Controles */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleControls(e)
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
              showControls
                ? isDark
                  ? 'bg-slate-100 text-slate-900 border-slate-200'
                  : 'bg-slate-900 text-white border-slate-900'
                : isDark
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
            title={showControls ? t('orderReadyBoard.hide_controls') : t('orderReadyBoard.show_controls')}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{showControls ? t('orderReadyBoard.hide_controls') : t('orderReadyBoard.show_controls')}</span>
            {showControls ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* Aviso de falta de conexión a Internet (Offline Banner) */}
      {!isOnline && (
        <div className="bg-slate-900 text-white px-4 py-1.5 text-center text-xs font-semibold flex items-center justify-center gap-2 z-40">
          <WifiOff className="w-4 h-4 shrink-0 text-amber-400" />
          <span>{t('orderReadyBoard.offline_warning')}</span>
        </div>
      )}

      {/* Banner de locutor activo (cuando habla la voz) */}
      {activeSpeech && (
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-center gap-3 text-white font-bold text-sm sm:text-base tracking-wide shadow-sm">
          <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{activeSpeech}</span>
        </div>
      )}

      {/* Panel de Control Plegable (para gerentes / pruebas) */}
      {showControls && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`border-b p-5 shadow-xl transition-all animate-in slide-in-from-top-4 duration-200 ${
            isDark ? 'bg-slate-900/95 backdrop-blur-md border-slate-800' : 'bg-slate-100/95 backdrop-blur-md border-slate-200'
          }`}
        >
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Tarjeta 1: SUCURSAL Y TABLERO */}
            <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-sm border ${
              isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Store className="w-4 h-4 text-emerald-500" />
                  <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {t('orderReadyBoard.card_store_lifecycle')}
                  </span>
                </div>

                {/* Selección de Tienda */}
                <div className="mb-3.5">
                  <label className={`text-[11px] font-semibold block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {t('orderReadyBoard.store')}
                  </label>
                  <select
                    value={selectedStore}
                    onChange={(e) => handleStoreChange(e.target.value)}
                    disabled={visibleStores.length <= 1}
                    className={`w-full rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 font-medium disabled:opacity-70 disabled:cursor-not-allowed border ${
                      isDark ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    {visibleStores.map((s) => (
                      <option key={s.code} value={s.code} className={isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Retención / Limpieza de Órdenes Listas */}
                <div className={`pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      {t('orderReadyBoard.retention_title')}
                    </label>
                    <span className="text-[11px] font-black text-emerald-500">
                      {readyRetentionMinutes} min
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[15, 20, 30].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => updateRetentionMinutes(mins)}
                        className={`py-1 rounded-lg text-xs font-bold transition border ${
                          readyRetentionMinutes === mins
                            ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                            : isDark
                              ? 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {mins} min {mins === 20 ? '★' : ''}
                      </button>
                    ))}
                  </div>
                  <p className={`text-[10px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    {t('orderReadyBoard.retention_20_min_note')}
                  </p>
                </div>
              </div>

              {/* Botón Sincronizar con Toast */}
              <div className={`mt-3.5 pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => fetchOrders(true, true)}
                  disabled={isSyncing}
                  className={`w-full flex items-center justify-center gap-2 font-semibold text-xs py-2 px-3 rounded-lg transition disabled:opacity-50 border ${
                    isDark
                      ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-slate-700'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300 shadow-sm'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? t('orderReadyBoard.syncing') : t('orderReadyBoard.sync_toast')}</span>
                </button>
              </div>
            </div>

            {/* Tarjeta 2: LOCUTOR Y VOCES */}
            <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-sm border ${
              isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                    isDark ? 'text-slate-300' : 'text-slate-700'
                  }`}>
                    {isAdmin ? (
                      <Sparkles className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-500" />
                    )}
                    {t('orderReadyBoard.card_announcer')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleTestSound(selectedVoice)}
                    disabled={isTestingVoice}
                    className={`text-[11px] font-bold flex items-center gap-1 px-2 py-0.5 rounded border transition disabled:opacity-50 ${
                      isDark
                        ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                        : 'text-emerald-700 hover:text-emerald-800 bg-emerald-50 border-emerald-300 shadow-sm'
                    }`}
                    title={t('orderReadyBoard.test_voice')}
                  >
                    <Play className={`w-2.5 h-2.5 fill-current ${isTestingVoice ? 'animate-spin' : ''}`} />
                    <span>{isTestingVoice ? t('orderReadyBoard.testing_voice') : t('orderReadyBoard.test_voice')}</span>
                  </button>
                </div>

                {/* 5 Botones de Voces */}
                <div className="grid grid-cols-5 gap-1 mb-2">
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
                              ? isDark
                                ? 'bg-slate-800 text-slate-200 border-amber-500/50 cursor-not-allowed opacity-90'
                                : 'bg-slate-100 text-slate-800 border-amber-500/50 cursor-not-allowed opacity-90'
                              : isDark
                                ? 'bg-slate-900/60 text-slate-600 border-slate-900 cursor-not-allowed opacity-50'
                                : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-50'
                            : isSelected
                              ? 'bg-emerald-600 text-white border-emerald-400 shadow-md ring-1 ring-emerald-400'
                              : isDark
                                ? 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                        }`}
                        title={!isAdmin ? t('orderReadyBoard.voice_locked_hint') : (language === 'es' ? v.labelEs : v.labelEn)}
                      >
                        <span className="text-sm">{v.gender === 'female' ? '👩' : '👨'}</span>
                        <span className="text-[11px] leading-tight font-extrabold">{v.name}</span>
                        <span className={`text-[8px] uppercase tracking-wider px-1 rounded font-bold ${
                          !isAdmin
                            ? isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
                            : isSelected
                              ? 'bg-emerald-700 text-emerald-100'
                              : v.gender === 'female'
                                ? isDark ? 'bg-purple-500/20 text-purple-300' : 'bg-purple-100 text-purple-800'
                                : isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {v.gender === 'female' ? t('orderReadyBoard.gender_fem_short') : t('orderReadyBoard.gender_masc_short')}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {!isAdmin ? (
                  <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1 font-medium">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>{t('orderReadyBoard.voice_locked_hint')}</span>
                  </p>
                ) : (
                  <div className={`flex items-center justify-between text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <span className="text-emerald-500 font-semibold flex items-center gap-1 truncate">
                      <Sparkles className="w-3 h-3 shrink-0" />
                      {isSavingVoice ? t('orderReadyBoard.voice_saving') : t('orderReadyBoard.voice_global_badge')}
                    </span>
                  </div>
                )}
              </div>

              {/* Idioma de los Anuncios: Bilingüe Permanente */}
              <div className={`mt-3.5 pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`text-[11px] font-semibold block ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {t('orderReadyBoard.voice_language')}
                  </label>
                  <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    {t('orderReadyBoard.voice_bilingual_always')}
                  </span>
                </div>
                <div className={`text-xs py-2 px-3 rounded-lg font-bold border text-center flex items-center justify-center gap-2 ${
                  isDark ? 'bg-slate-900 border-emerald-500/40 text-emerald-400' : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                }`}>
                  <span>🇺🇸 EN</span>
                  <span className="text-slate-400 font-normal">+</span>
                  <span>🇲🇽 ES</span>
                  <span className="text-[11px] font-medium opacity-80">({t('orderReadyBoard.voice_bilingual_desc')})</span>
                </div>
              </div>
            </div>

            {/* Tarjeta 3: SONIDO Y EFECTOS */}
            <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-sm border ${
              isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Volume2 className="w-4 h-4 text-emerald-500" />
                  <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {t('orderReadyBoard.card_sound_volume')}
                  </span>
                </div>

                {/* Slider de Volumen */}
                <div className="mb-3.5">
                  <div className={`flex justify-between text-xs font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span>{t('orderReadyBoard.voice_volume')}</span>
                    <span className="text-emerald-500 font-black">{Math.round(voiceVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={voiceVolume}
                    onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
                    className={`w-full accent-emerald-500 h-1.5 rounded-lg cursor-pointer ${
                      isDark ? 'bg-slate-800' : 'bg-slate-200'
                    }`}
                  />
                </div>

                {/* Toggle Campanilla Ding-Dong */}
                <div className={`pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                  <label className={`flex items-center justify-between text-xs font-medium cursor-pointer py-1 ${
                    isDark ? 'text-slate-300' : 'text-slate-700'
                  }`}>
                    <span className="flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-amber-500" />
                      {t('orderReadyBoard.enable_chime')}
                    </span>
                    <input
                      type="checkbox"
                      checked={enableChime}
                      onChange={(e) => updateEnableChime(e.target.checked)}
                      className="accent-emerald-500 rounded w-4 h-4 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Configuración de Tiempo de Recordatorio de Orden */}
                <div className={`pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`flex items-center gap-1.5 text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      <Clock className="w-3.5 h-3.5 text-cyan-500" />
                      <span>{t('orderReadyBoard.reminder_title')}</span>
                    </span>
                    <span className="text-xs font-black text-emerald-500">
                      {reminderSeconds === 0
                        ? t('orderReadyBoard.reminder_disabled')
                        : `${reminderSeconds} ${t('orderReadyBoard.seconds_abbr')}`}
                    </span>
                  </div>

                  {/* Presets Rápidos: 30s, 45s, 60s, 90s (★), 120s */}
                  <div className="grid grid-cols-5 gap-1 mb-1.5">
                    {[30, 45, 60, 90, 120].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => updateReminderSeconds(sec)}
                        className={`py-1 rounded-lg text-[11px] font-bold transition border ${
                          reminderSeconds === sec
                            ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                            : isDark
                              ? 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {sec}s {sec === 90 ? '★' : ''}
                      </button>
                    ))}
                  </div>

                  {/* Slider y campo numérico para ajuste fino de segundos */}
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="300"
                      step="5"
                      value={reminderSeconds}
                      onChange={(e) => updateReminderSeconds(parseInt(e.target.value, 10))}
                      className={`flex-1 accent-emerald-500 h-1.5 rounded-lg cursor-pointer ${
                        isDark ? 'bg-slate-800' : 'bg-slate-200'
                      }`}
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="600"
                        value={reminderSeconds}
                        onChange={(e) => updateReminderSeconds(parseInt(e.target.value, 10) || 0)}
                        className={`w-14 text-center font-bold text-xs py-0.5 rounded-md border focus:outline-none focus:border-emerald-500 ${
                          isDark
                            ? 'bg-slate-900 border-slate-700 text-slate-200'
                            : 'bg-white border-slate-300 text-slate-800'
                        }`}
                      />
                      <span className={`text-[10px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {t('orderReadyBoard.seconds_abbr')}
                      </span>
                    </div>
                  </div>
                  <p className={`text-[10px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {t('orderReadyBoard.reminder_note')}
                  </p>
                </div>
              </div>

              {/* Botón Destacado: Probar Anuncio Completo */}
              <div className={`mt-3.5 pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => handleTestSound(selectedVoice)}
                  disabled={isTestingVoice}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs py-2 px-3 rounded-lg shadow transition disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 fill-current ${isTestingVoice ? 'animate-spin' : ''}`} />
                  <span>
                    {isTestingVoice
                      ? t('orderReadyBoard.testing_voice')
                      : `${t('orderReadyBoard.test_announcement_btn')} (${selectedVoice} #141)`}
                  </span>
                </button>
              </div>
            </div>

            {/* Tarjeta 4: CANALES Y SIMULACIÓN */}
            <div className={`rounded-2xl p-4 flex flex-col justify-between shadow-sm border ${
              isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-white border-slate-200'
            }`}>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sliders className="w-4 h-4 text-emerald-500" />
                  <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    {t('orderReadyBoard.card_channels_simulation')}
                  </span>
                </div>

                {/* Checkboxes de Canales: Para Llevar & Comer Aquí */}
                <div className="space-y-2 mb-3">
                  <label className={`flex items-center justify-between p-2 rounded-xl text-xs font-medium cursor-pointer transition border ${
                    isDark
                      ? 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <ShoppingBag className="w-3.5 h-3.5 text-cyan-500" />
                      {t('orderReadyBoard.announce_togo')}
                    </span>
                    <input
                      type="checkbox"
                      checked={announceToGo}
                      onChange={(e) => {
                        setAnnounceToGo(e.target.checked)
                        if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_announce_tg', String(e.target.checked))
                      }}
                      className="accent-emerald-500 rounded w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <label className={`flex items-center justify-between p-2 rounded-xl text-xs font-medium cursor-pointer transition border ${
                    isDark
                      ? 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <Utensils className="w-3.5 h-3.5 text-amber-500" />
                      {t('orderReadyBoard.announce_for_here')}
                    </span>
                    <input
                      type="checkbox"
                      checked={announceForHere}
                      onChange={(e) => {
                        setAnnounceForHere(e.target.checked)
                        if (typeof window !== 'undefined') localStorage.setItem('teg_order_ready_announce_fh', String(e.target.checked))
                      }}
                      className="accent-emerald-500 rounded w-4 h-4 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* Botones de Simulación de Órdenes (Solo Togo y Dine-In) */}
              <div className={`mt-3.5 pt-2.5 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider block mb-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {t('orderReadyBoard.simulate_order_title')}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSimulateOrder('TOGO')}
                    className={`flex items-center justify-center gap-1.5 font-semibold text-xs py-2 px-2 rounded-lg transition border ${
                      isDark
                        ? 'bg-slate-900 hover:bg-slate-800 text-cyan-300 border-cyan-500/30'
                        : 'bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-300 shadow-sm'
                    }`}
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    + {t('orderReadyBoard.to_go')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSimulateOrder('FOR_HERE')}
                    className={`flex items-center justify-center gap-1.5 font-semibold text-xs py-2 px-2 rounded-lg transition border ${
                      isDark
                        ? 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/30'
                        : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 shadow-sm'
                    }`}
                  >
                    <Utensils className="w-3.5 h-3.5" />
                    + {t('orderReadyBoard.for_here')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sección Destacada: ANUNCIOS AL COMEDOR Y REPRODUCCIÓN PERIÓDICA */}
          <div className={`mt-4 max-w-7xl mx-auto rounded-2xl p-4 md:p-5 shadow-sm border transition-colors ${
            isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-white border-slate-200'
          }`}>
            {/* Header de la sección de anuncios */}
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5 pb-3 border-b border-dashed ${
              isDark ? 'border-slate-800' : 'border-slate-200'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-sm">
                  <Megaphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className={`text-xs font-black uppercase tracking-wider ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {t('orderReadyBoard.announcements_card_title')}
                  </h3>
                  <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {t('orderReadyBoard.announcements_card_subtitle')}
                  </p>
                </div>
              </div>

              {/* Badge de estado periódico y temporizador regresivo */}
              <div className="flex items-center gap-2">
                {announcementEnabled ? (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>{t('orderReadyBoard.announcement_active_badge')} ({announcementIntervalMin} min)</span>
                    {nextAnnouncementSec !== null && (
                      <span className="text-slate-400 font-mono text-[11px]">
                        • {t('orderReadyBoard.announcement_next_in')} {Math.floor(nextAnnouncementSec / 60)}:{String(nextAnnouncementSec % 60).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    isDark ? 'bg-slate-900 border-slate-800 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}>
                    {t('orderReadyBoard.announcement_disabled_badge')}
                  </div>
                )}
              </div>
            </div>

            {/* 5 Plantillas Rápidas Editables y Guardables (4 oficiales + 1 aviso libre de comedor) */}
            <div className="mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  {t('orderReadyBoard.announcement_presets_title')}
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                  {presetSavedFlash && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-500 text-[11px] font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{t('orderReadyBoard.announcement_preset_saved')}</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const next = !isEditingPreset
                      setIsEditingPreset(next)
                      if (next) {
                        setEditingPresetLabel(getPresetLabel(selectedPresetKey))
                      }
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition border cursor-pointer ${
                      isEditingPreset
                        ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                        : isDark
                          ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    <Pencil className="w-3 h-3" />
                    <span>{t('orderReadyBoard.announcement_edit_preset_btn')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveCurrentPreset}
                    disabled={isSavingPreset || !announcementText.trim()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition border bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-3 h-3" />
                    <span>
                      {isSavingPreset
                        ? t('orderReadyBoard.announcement_preset_saving')
                        : `${t('orderReadyBoard.announcement_save_preset_btn')} (${getPresetLabel(selectedPresetKey)})`}
                    </span>
                  </button>

                  {hasCustomPresetOverride(selectedPresetKey) && (
                    <button
                      type="button"
                      onClick={handleResetCurrentPreset}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition border cursor-pointer ${
                        isDark
                          ? 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t('orderReadyBoard.announcement_reset_preset_btn')}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(['ticket', 'salsas', 'aguas', 'welcome', 'custom'] as PresetKey[]).map((key) => {
                  const meta = getDefaultPresetMeta(key)
                  const label = getPresetLabel(key)
                  const isSelected = selectedPresetKey === key
                  const isCustomized = hasCustomPresetOverride(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectPreset(key)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition border flex items-center gap-1.5 cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                          : isDark
                            ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                      }`}
                    >
                      <span>{meta.icon}</span>
                      <span>{label}</span>
                      {isCustomized && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSelected ? 'bg-white' : 'bg-emerald-500'
                          }`}
                          title="Personalizada"
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              {isEditingPreset && (
                <div className={`mt-2 p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center gap-2 ${
                  isDark ? 'bg-slate-900/80 border-amber-500/40' : 'bg-amber-50/70 border-amber-300'
                }`}>
                  <span className={`text-[11px] font-bold whitespace-nowrap ${
                    isDark ? 'text-amber-300' : 'text-amber-900'
                  }`}>
                    {t('orderReadyBoard.announcement_preset_title_label')}
                  </span>
                  <input
                    type="text"
                    maxLength={40}
                    value={editingPresetLabel}
                    onChange={(e) => setEditingPresetLabel(e.target.value)}
                    className={`flex-1 rounded-lg px-2.5 py-1 text-xs font-semibold border focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                      isDark
                        ? 'bg-slate-950 border-slate-700 text-slate-100'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              )}
            </div>

            {/* Caja de Texto del Anuncio + Botón de Reproducción Inmediata */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-3.5">
              <div className="lg:col-span-3 relative">
                <textarea
                  rows={3}
                  maxLength={500}
                  value={announcementText}
                  onChange={(e) => updateAnnouncementText(e.target.value)}
                  placeholder={t('orderReadyBoard.announcement_placeholder')}
                  className={`w-full rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-y transition border ${
                    isDark
                      ? 'bg-slate-900/90 border-slate-700 text-slate-100 placeholder-slate-500'
                      : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
                  }`}
                />
                <div className="flex items-center justify-between mt-1 px-1">
                  <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {announcementText.length}/500 {t('orderReadyBoard.announcement_chars_limit')} • {t('orderReadyBoard.announcement_active_preset_label')} <strong>{getPresetLabel(selectedPresetKey)}</strong>
                  </span>
                  <div className="flex items-center gap-3">
                    {announcementText.length > 0 && (
                      <button
                        type="button"
                        onClick={() => updateAnnouncementText('')}
                        className={`text-[10px] flex items-center gap-1 font-semibold hover:underline cursor-pointer ${
                          isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{t('orderReadyBoard.announcement_clear_btn')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Botón Principal: Reproducir Ahora */}
              <div className="flex flex-col justify-between gap-2">
                <button
                  type="button"
                  onClick={() => playCustomAnnouncement()}
                  disabled={isPlayingAnnouncement || !announcementText.trim()}
                  className="w-full h-full min-h-[50px] flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-extrabold text-xs py-2 px-3 rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Play className={`w-4 h-4 fill-current ${isPlayingAnnouncement ? 'animate-spin' : ''}`} />
                    <span>{isPlayingAnnouncement ? t('orderReadyBoard.announcement_playing') : t('orderReadyBoard.announcement_play_now')}</span>
                  </div>
                  <span className="text-[10px] font-normal opacity-90">
                    (Kore • {detectAnnouncementLang(announcementText).toUpperCase()})
                  </span>
                </button>
              </div>
            </div>

            {/* Controles de Reproducción Automática y Frecuencia */}
            <div className={`pt-3 border-t flex flex-col md:flex-row md:items-center justify-between gap-3 ${
              isDark ? 'border-slate-800' : 'border-slate-200'
            }`}>
              {/* Switch de Reproducción Automática */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={announcementEnabled}
                  onChange={(e) => toggleAnnouncementEnabled(e.target.checked)}
                  className="accent-amber-500 rounded w-4 h-4 cursor-pointer"
                />
                <span className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                  {t('orderReadyBoard.announcement_auto_repeat')}
                </span>
              </label>

              {/* Selector de Intervalo (Presets y Campo Numérico) */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {t('orderReadyBoard.announcement_interval_label')}
                </span>

                {/* Presets Rápidos: 3m, 5m, 10m, 15m (★), 20m, 30m, 60m */}
                <div className="flex items-center gap-1">
                  {[3, 5, 10, 15, 20, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => updateAnnouncementIntervalMin(mins)}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition border ${
                        announcementIntervalMin === mins
                          ? 'bg-amber-600 text-white border-amber-400 shadow-sm'
                          : isDark
                            ? 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                            : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {mins}m {mins === 15 ? '★' : ''}
                    </button>
                  ))}
                </div>

                {/* Campo numérico para minutos exactos */}
                <div className="flex items-center gap-1 ml-1">
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={announcementIntervalMin}
                    onChange={(e) => updateAnnouncementIntervalMin(parseInt(e.target.value, 10) || 1)}
                    className={`w-12 text-center font-bold text-xs py-0.5 rounded-md border focus:outline-none focus:border-amber-500 ${
                      isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  />
                  <span className={`text-[10px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {t('orderReadyBoard.announcement_minutes_abbr')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cuerpo Principal del Tablero: Dos Columnas Gigantes */}
      {(() => {
        // Regla de Negocio Tacos Gavilan: Limpieza automática de pantalla a los 20 minutos
        // y filtro estricto: el módulo Order Ready Board solo opera para FOR_HERE y TOGO.
        const maxReadyAgeMs = readyRetentionMinutes * 60 * 1000
        const isAllowedDining = (order: OrderItem) =>
          order.dining_option === 'FOR_HERE' || order.dining_option === 'TOGO'

        const displayedReadyOrders = readyOrders.filter((order) => {
          if (!isAllowedDining(order)) return false
          const readyTimestamp = order.ready_at ? new Date(order.ready_at).getTime() : new Date(order.created_at).getTime()
          if (nowMs - readyTimestamp > maxReadyAgeMs) return false
          return true
        })

        const displayedInProgressOrders = inProgressOrders.filter((order) => {
          if (!isAllowedDining(order)) return false
          if (isDrinkOrDessertOnlyOrder(order.items_summary)) return false
          return true
        })

        return (
          <main className={`flex-1 p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 w-full min-h-0 ${
            isFullscreen ? 'max-w-full px-8 xl:px-12' : 'max-w-7xl mx-auto'
          }`}>
            {/* COLUMNA IZQUIERDA: ENTREGADAS (DELIVERED / READY) */}
            <section className={`flex flex-col rounded-2xl p-6 relative overflow-hidden min-h-0 ${
              isDark
                ? 'bg-slate-900/60 border border-slate-800 shadow-xl'
                : 'bg-white border border-slate-200 shadow-sm'
            }`}>
              {/* Header de la columna */}
              <div className={`flex items-center justify-between pb-5 border-b relative z-10 ${
                isDark ? 'border-slate-800' : 'border-slate-200'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isDark ? 'bg-slate-800 border border-slate-700 text-slate-200' : 'bg-slate-900 text-white'
                  }`}>
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className={`text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-2.5 ${
                      isDark ? 'text-white' : 'text-slate-900'
                    }`}>
                      {t('orderReadyBoard.ready_for_pickup')}
                      <span className={`text-sm font-bold px-3 py-0.5 rounded-full border ${
                        isDark ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-900 text-white border-slate-900'
                      }`}>
                        {displayedReadyOrders.length}
                      </span>
                    </h2>
                    <p className={`text-xs font-medium flex items-center gap-1.5 mt-0.5 ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      <span>{t('orderReadyBoard.proceed_to_counter')}</span>
                      <span className={isDark ? 'text-slate-700' : 'text-slate-300'}>•</span>
                      <span className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {t('orderReadyBoard.retention_note_dynamic').replace('{mins}', String(readyRetentionMinutes))}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Tarjetas de Órdenes Entregadas */}
              <div className="flex-1 mt-5 overflow-y-auto space-y-3.5 pr-1 relative z-10 min-h-0">
                {displayedReadyOrders.length === 0 ? (
                  <div className={`h-64 flex flex-col items-center justify-center text-center ${
                    isDark ? 'text-slate-500' : 'text-slate-400'
                  }`}>
                    <CheckCircle2 className={`w-12 h-12 mb-3 ${isDark ? 'text-slate-700' : 'text-slate-300'}`} />
                    <p className={`text-lg font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{t('orderReadyBoard.no_orders_ready')}</p>
                    <p className={`text-xs font-medium mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      {STORES_LIST.find(s => s.code === selectedStore)?.name || selectedStore} • {t('orderReadyBoard.kds_bump_notice')}
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

                    const isTabletCalled = tabletCalledOrderId === order.id || tabletCalledOrderNum === String(order.order_number)
                    const isOrderReplaying = replayingId === order.id || replayingOrderNum === String(order.order_number)

                    return (
                      <div
                        key={order.id}
                        className={`rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all duration-200 relative ${
                          isTabletCalled
                            ? isDark
                              ? 'ring-2 ring-white bg-slate-800/90 border border-slate-600 shadow-lg text-white'
                              : 'ring-2 ring-slate-900 bg-slate-50 border border-slate-400 shadow-md text-slate-900'
                            : isDark
                              ? 'bg-slate-900/90 border border-slate-800 hover:border-slate-700 shadow-sm text-white'
                              : 'bg-slate-50/70 border border-slate-200 hover:border-slate-300 shadow-sm text-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-5">
                          {/* Número de Orden en Grande */}
                          <button
                            type="button"
                            onMouseEnter={() => prefetchOrderDetail(order)}
                            onClick={() => handleOrderClick(order)}
                            title={t('orderReadyBoard.view_ticket')}
                            className={`text-left text-4xl lg:text-5xl font-black tracking-tight font-mono cursor-pointer transition-colors ${
                              isDark
                                ? 'text-white hover:text-slate-300'
                                : 'text-slate-900 hover:text-slate-600'
                            }`}
                          >
                            #{order.order_number}
                          </button>

                          {/* Nombre, Canal (FOR HERE / TO GO) y Tiempo de Preparación */}
                          <div>
                            {order.customer_name && (
                              <div className={`text-base lg:text-lg font-bold truncate max-w-[200px] ${
                                isDark ? 'text-slate-200' : 'text-slate-900'
                              }`}>
                                {order.customer_name}
                              </div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {renderDiningBadge(order.dining_option)}

                              {prepSeconds > 0 && (
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono border ${sosClass}`}
                                  title={`${t('orderReadyBoard.prep_duration')}: ${formatDuration(prepSeconds)}`}
                                >
                                  <Timer className="w-3 h-3" />
                                  <span>{formatDuration(prepSeconds)}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Info de Cierre y Acciones */}
                        <div className={`flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 pt-3 sm:pt-0 ${
                          isDark ? 'border-slate-800' : 'border-slate-200'
                        }`}>
                          <div className="text-left sm:text-right">
                            <div className="flex items-center sm:justify-end gap-1.5 flex-wrap">
                              {isTabletCalled && (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider ${
                                  isDark ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
                                }`}>
                                  <Megaphone className="w-3 h-3" />
                                  {t('orderReadyBoard.called_from_prep')}
                                </span>
                              )}
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider border ${
                                isDark
                                  ? 'bg-slate-800 text-slate-200 border-slate-700'
                                  : 'bg-slate-200/80 text-slate-800 border-slate-300'
                              }`}>
                                <CheckCircle2 className="w-3 h-3" />
                                {t('orderReadyBoard.ready_badge')}
                              </span>
                              {readyTimeStr && (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
                                  isDark
                                    ? 'text-slate-300 bg-slate-800/60 border-slate-700'
                                    : 'text-slate-700 bg-white border-slate-200'
                                }`}>
                                  {readyTimeStr}
                                </span>
                              )}
                            </div>
                            {order.ready_at && (
                              <p className={`text-[11px] font-medium mt-1 ${
                                isDark ? 'text-slate-400' : 'text-slate-500'
                              }`}>
                                {calculateElapsedTime(order.ready_at, t)}
                              </p>
                            )}
                          </div>

                          {/* Botones de Acción: Llamar por voz y Ver Ticket */}
                          <div className="flex items-center gap-1.5 mt-1">
                            <button
                              type="button"
                              onClick={() => handleReplayVoice(order)}
                              disabled={isOrderReplaying}
                              title={t('orderReadyBoard.replay_tooltip').replace('{order}', order.order_number)}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm border transition active:scale-95 disabled:opacity-50 cursor-pointer ${
                                isDark
                                  ? 'bg-slate-100 hover:bg-white text-slate-900 border-slate-200'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                              }`}
                            >
                              <Volume2 className={`w-3.5 h-3.5 ${isOrderReplaying ? 'animate-pulse' : ''}`} />
                              <span>
                                {isOrderReplaying ? t('orderReadyBoard.replaying') : t('orderReadyBoard.replay_voice')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onMouseEnter={() => prefetchOrderDetail(order)}
                              onClick={() => handleOrderClick(order)}
                              title={t('orderReadyBoard.view_ticket')}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition active:scale-95 cursor-pointer shadow-sm border ${
                                isDark
                                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700'
                                  : 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-300'
                              }`}
                            >
                              <Receipt className="w-3.5 h-3.5 text-slate-500" />
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
            <section className={`flex flex-col rounded-2xl p-6 relative min-h-0 ${
              isDark
                ? 'bg-amber-950/20 border-2 border-amber-500/60 shadow-xl'
                : 'bg-amber-50/40 border-2 border-amber-400 shadow-sm'
            }`}>
              {/* Header de la columna */}
              <div className={`flex items-center justify-between pb-5 border-b ${
                isDark ? 'border-amber-500/30' : 'border-amber-200'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                    isDark ? 'bg-amber-500 text-slate-950' : 'bg-amber-500 text-white'
                  }`}>
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className={`text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-2.5 ${
                      isDark ? 'text-amber-400' : 'text-amber-900'
                    }`}>
                      {t('orderReadyBoard.in_progress')}
                      <span className={`text-sm font-bold px-3 py-0.5 rounded-full border ${
                        isDark ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-amber-500 text-white border-amber-500'
                      }`}>
                        {displayedInProgressOrders.length}
                      </span>
                    </h2>
                    <p className={`text-xs font-medium mt-0.5 ${isDark ? 'text-amber-300/80' : 'text-amber-800/80'}`}>
                      {t('orderReadyBoard.preparing_fresh')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tarjetas de Órdenes en Preparación */}
              <div className="flex-1 mt-5 overflow-y-auto space-y-3.5 pr-1 min-h-0">
                {displayedInProgressOrders.length === 0 ? (
                  <div className={`h-64 flex flex-col items-center justify-center text-center ${
                    isDark ? 'text-slate-500' : 'text-slate-400'
                  }`}>
                    <Clock className={`w-12 h-12 mb-3 ${isDark ? 'text-amber-500/40' : 'text-amber-300'}`} />
                    <p className={`text-lg font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{t('orderReadyBoard.no_orders_in_progress')}</p>
                    <p className={`text-xs font-medium mt-1 ${isDark ? 'text-amber-400/70' : 'text-amber-700'}`}>
                      {STORES_LIST.find(s => s.code === selectedStore)?.name || selectedStore} • {t('orderReadyBoard.kitchen_caught_up')}
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
                    const isInProgressTabletCalled = tabletCalledOrderId === order.id || tabletCalledOrderNum === String(order.order_number)
                    const isOrderReplaying = replayingId === order.id || replayingOrderNum === String(order.order_number)

                    return (
                      <div
                        key={order.id}
                        className={`rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                          isInProgressTabletCalled
                            ? isDark
                              ? 'ring-2 ring-amber-400 bg-slate-800/90 border border-amber-500 shadow-lg text-white'
                              : 'ring-2 ring-amber-500 bg-amber-50 border border-amber-400 shadow-md text-slate-900'
                            : isDark
                              ? 'bg-slate-900/90 border border-amber-500/30 hover:border-amber-500/50 shadow-sm text-slate-200'
                              : 'bg-white border border-amber-200 hover:border-amber-300 shadow-sm text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-5">
                          {/* Número de Orden */}
                          <button
                            type="button"
                            onMouseEnter={() => prefetchOrderDetail(order)}
                            onClick={() => handleOrderClick(order)}
                            title={t('orderReadyBoard.view_ticket')}
                            className={`text-4xl lg:text-5xl font-black tracking-tight font-mono transition-colors text-left cursor-pointer ${
                              isDark ? 'text-slate-200 hover:text-white' : 'text-slate-900 hover:text-amber-700'
                            }`}
                          >
                            #{order.order_number}
                          </button>

                          {/* Nombre, Canal (FOR HERE / TO GO) y Cronómetro en Vivo */}
                          <div>
                            {order.customer_name && (
                              <div className={`text-base lg:text-lg font-bold truncate max-w-[180px] ${
                                isDark ? 'text-slate-300' : 'text-slate-800'
                              }`}>
                                {order.customer_name}
                              </div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {renderDiningBadge(order.dining_option)}

                              {/* Cronómetro en vivo */}
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono border ${sosClass}`}
                                title={`${t('orderReadyBoard.elapsed')}: ${formatDuration(elapsedSeconds)}`}
                              >
                                <Timer className="w-3 h-3" />
                                <span>{formatDuration(elapsedSeconds)}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Estado y Hora de Envío */}
                        <div className={`flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 ${
                          isDark ? 'border-amber-500/20' : 'border-amber-100'
                        }`}>
                          <div className="text-left sm:text-right">
                            <div className="flex items-center sm:justify-end gap-1.5 flex-wrap">
                              {isInProgressTabletCalled && (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider ${
                                  isDark ? 'bg-amber-400 text-slate-950' : 'bg-amber-500 text-white'
                                }`}>
                                  <Megaphone className="w-3 h-3" />
                                  {t('orderReadyBoard.called_from_prep')}
                                </span>
                              )}
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
                                isDark
                                  ? 'text-amber-300 bg-amber-950/60 border-amber-500/40'
                                  : 'text-amber-800 bg-amber-100 border-amber-300'
                              }`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                {t('orderReadyBoard.almost_ready')}
                              </span>
                            </div>
                            {sentTimeStr && (
                              <p className={`text-[11px] font-medium mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                {t('orderReadyBoard.sent_at_time').replace('{time}', sentTimeStr)}
                              </p>
                            )}
                          </div>

                          {/* Botones de Acción: Llamar por voz y Ver Ticket */}
                          <div className="flex items-center gap-1.5 mt-1">
                            <button
                              type="button"
                              onClick={() => handleReplayVoice(order)}
                              disabled={isOrderReplaying}
                              title={t('orderReadyBoard.replay_tooltip').replace('{order}', order.order_number)}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm border transition active:scale-95 disabled:opacity-50 cursor-pointer ${
                                isDark
                                  ? 'bg-slate-100 hover:bg-white text-slate-900 border-slate-200'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                              }`}
                            >
                              <Volume2 className={`w-3.5 h-3.5 ${isOrderReplaying ? 'animate-pulse' : ''}`} />
                              <span>
                                {isOrderReplaying ? t('orderReadyBoard.replaying') : t('orderReadyBoard.replay_voice')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onMouseEnter={() => prefetchOrderDetail(order)}
                              onClick={() => handleOrderClick(order)}
                              title={t('orderReadyBoard.view_ticket')}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition active:scale-95 cursor-pointer shadow-sm border ${
                                isDark
                                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                                  : 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-300'
                              }`}
                            >
                              <Receipt className="w-3.5 h-3.5 text-slate-500" />
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
          </main>
        )
      })()}

      {/* Footer corporativo */}
      <footer className={`border-t px-6 py-3 text-center text-xs font-medium transition-colors ${
        isDark ? 'bg-slate-950 border-slate-900 text-slate-500' : 'bg-white border-slate-200 text-slate-500 shadow-sm'
      }`}>
        <span>{t('orderReadyBoard.subtitle')}</span>
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
                <p className="text-slate-500 animate-pulse text-[11px] mt-1 font-normal">
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

              {/* Vista previa instantánea (0ms) de los platillos mientras cargan precios e impuestos */}
              {!orderDetailData.data && !orderDetailData.error && orderDetailData.previewItems && orderDetailData.previewItems.length > 0 && (
                <div className="space-y-4 text-slate-800">
                  <div className="text-xs text-center border-b border-slate-200 pb-3">
                    <div className="font-bold text-[14px] uppercase tracking-wider mb-1">
                      {t('orderReadyBoard.receipt_store')} {orderDetailData.storeName}
                    </div>
                    <div>
                      {orderDetailData.diningOption === 'FOR_HERE'
                        ? t('orderReadyBoard.for_here_badge')
                        : t('orderReadyBoard.to_go_badge')}
                    </div>
                    {orderDetailData.openedAt && (
                      <div>
                        {new Date(orderDetailData.openedAt).toLocaleString('en-US', {
                          timeZone: 'America/Los_Angeles'
                        })}
                      </div>
                    )}
                  </div>

                  <div className="border-b-2 border-dashed border-slate-300 pb-3 space-y-2">
                    <div className="flex justify-between font-bold text-[10px] text-slate-400 mb-2 uppercase tracking-widest">
                      <span>{t('orderReadyBoard.item')}</span>
                    </div>
                    {orderDetailData.previewItems.map((it, i) => (
                      <div key={i} className="text-xs">
                        <div className="font-semibold">
                          {it.quantity || 1}x {it.name}
                        </div>
                        {Array.isArray(it.modifiers) &&
                          it.modifiers.map((mod, mIdx) => (
                            <div key={mIdx} className="text-slate-500 text-[11px] ml-4">
                              • {mod}
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {orderDetailData.data && (
                <div className="space-y-4 text-slate-800">
                  <div className="text-xs text-center border-b border-slate-200 pb-3">
                    <div className="font-bold text-[14px] uppercase tracking-wider mb-1">
                      {t('orderReadyBoard.receipt_store')}{' '}
                      {orderDetailData.storeName || orderDetailData.data.restaurantService?.name || 'TACOS GAVILAN'}
                    </div>
                    <div>{orderDetailData.data.diningOption?.name || t('orderReadyBoard.receipt_dining_fallback')}</div>
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
                        {orderDetailData.data.server?.name || orderDetailData.cajeraName || t('orderReadyBoard.automatic')}
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
                                      ↳ {t('orderReadyBoard.receipt_discount_abbr')} {d.name} (-$
                                      {Number(d.discountAmount).toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                      })}
                                      )
                                    </div>
                                  ))}
                                  {validDiscounts.length === 0 && inferredDiscount > 0.009 && (
                                    <div className="text-amber-700 text-[10px] ml-4 font-bold border-l-2 border-amber-400 pl-1 mt-0.5">
                                      ↳ {t('orderReadyBoard.receipt_discount_abbr')} (-$
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
                              <span>{t('orderReadyBoard.receipt_discount_ticket')} {d.name}</span>
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
                            {p.type || t('orderReadyBoard.receipt_payment_fallback')}{' '}
                            {p.originalPaymentStatus && p.originalPaymentStatus !== 'NONE' ? t('orderReadyBoard.receipt_status_original') : ''}{' '}
                            {p.refundStatus && p.refundStatus !== 'NONE' ? t('orderReadyBoard.receipt_status_refunded') : ''}
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
function calculateElapsedTime(timestamp: string, t: (key: any, params?: any) => string): string {
  try {
    const elapsedMinutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000)
    if (elapsedMinutes <= 0) {
      return t('orderReadyBoard.just_now')
    }
    return t('orderReadyBoard.minute_ago').replace('{minutes}', String(elapsedMinutes))
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

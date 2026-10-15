/**
 * @module BlindajeDeliveryEmpaque
 * @description Estación vertical Fullscreen de Entrega Blindada para validar el empaque y liberar cada bolsa al chofer correcto identificando por Nombre + Apellido/Inicial y blindando contra nombres duplicados o muy parecidos desde KDS.
 * @businessRules
 *   - Siempre en modo Fullscreen (tanto al pedir PIN, al iniciar sesión con PIN, durante la operación y al cerrarse/expirar la sesión de PIN).
 *   - Acceso de la cajera/empacador con PIN de 4 dígitos de RONOS con cierre automático de sesión tras 10 minutos sin actividad (inactividad). Cualquier interacción real de la cajera reinicia el contador de 10 minutos.
 *   - Identificación principal por Nombre + Apellido/Inicial del cliente (si existe), acompañado de #Check y Clave de Plataforma.
 *   - Blindaje estricto contra colisión de nombres desde que entran por KDS: alerta de alto énfasis si existen dos órdenes con el mismo nombre exacto, el mismo primer nombre con apellido diferente, o nombres fonética/visualmente muy parecidos.
 *   - Mide automáticamente el tiempo de preparación en cocina desde que llega al KDS hasta que el cocinero borra la orden (READY).
 *   - Cuando el cocinero borra la orden delivery del KDS (pasa de IN_KITCHEN a READY para el estante de empaque), la tableta reproduce automáticamente la campana aguda prolongada de Delivery y el aviso de voz ("Order #100, is ready! Please pack. / Orden #100, ¡ya está! Favor de empacar.") usando las voces calibradas de Supabase Storage.
 *   - Flujo directo sin pasos innecesarios: 1. CONFIRMAR ORDEN COMPLETA Y SELLADA -> 2. Blindar la entrega.
 * @dataFlow Toast -> /api/delivery-armor/orders -> tableta fullscreen + locutor KDS (/api/order-ready/tts) -> /api/delivery-armor/audit -> Supabase.
 * @notes Piloto Slauson (#7) y LA Central (#6).
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useLanguage } from '@/lib/i18n'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Delete,
  Globe,
  Lock,
  LogOut,
  Maximize2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  User,
  Volume2,
  VolumeX
} from 'lucide-react'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

const STORES = [
  { id: 7, name: 'Slauson (#7)' },
  { id: 6, name: 'LA Central (#6)' }
]

const PIN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutos sin actividad para cerrar sesión del PIN de la cajera
const PIN_SESSION_DURATION_MS = PIN_INACTIVITY_TIMEOUT_MS
const KDS_POLL_INTERVAL_MS = 8000 // 8 segundos para detectar al instante cuando el cocinero borra del KDS
const UNCLAIMED_DRIVER_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 horas (120 min) sin que ningún chofer recoja la orden

type Platform = 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB' | 'TOAST_ONLINE' | 'OTHER'
type CheckKey = 'foodComplete' | 'drinksComplete' | 'bagCountCorrect' | 'bagSealed'
type Checks = Record<CheckKey, boolean>

const COMPLETED_CHECKS: Checks = {
  foodComplete: true,
  drinksComplete: true,
  bagCountCorrect: true,
  bagSealed: true
}

interface Packer {
  pin: string
  name: string
  title: string
  id: number
  storeId: number
  expiresAt: number
  sessionToken: string
}

interface Item {
  id: string
  name: string
  quantity: number
  price: number
  modifiers: string[]
  isDrink: boolean
}

interface Order {
  guid: string
  ticket: string
  diningOption: string
  platform: Platform
  customer: string
  maskedCustomer: string
  platformOrderKey: string
  shortOrderKey: string
  assignedDriverHint?: string | null
  openedAt: string
  kdsStatus: 'IN_KITCHEN' | 'READY'
  kdsSentAt: string
  kdsReadyAt: string | null
  kdsPrepSeconds: number | null
  isVoided?: boolean
  items: Item[]
  itemCount: number
  hasDrinks: boolean
  audit?: {
    status: 'pending' | 'ready' | 'released' | 'unclaimed'
    bags?: number
    packedBy?: string
    packedAt?: string
    handedBy?: string
    driver?: string
    courierReference?: string
  }
}

const label = (platform: Platform) =>
  platform === 'DOORDASH'
    ? 'DoorDash'
    : platform === 'UBER_EATS'
    ? 'Uber Eats'
    : platform === 'GRUBHUB'
    ? 'Grubhub'
    : platform === 'TOAST_ONLINE'
    ? 'Toast Delivery'
    : 'Delivery'

type OrderStage = 'PREPARACION' | 'EMPACANDO' | 'LISTA' | 'ENTREGADA' | 'NO_RECOGIDA'

function isOrderUnclaimedAfter2Hours(order: Order, now: number = Date.now()): boolean {
  if (order.audit?.status === 'released') return false
  if (order.audit?.status === 'unclaimed') return true
  const openedAgeMs = now - new Date(order.openedAt).getTime()
  return Number.isFinite(openedAgeMs) && openedAgeMs >= UNCLAIMED_DRIVER_TIMEOUT_MS
}

function getOrderStageInfo(
  order: Order,
  t: (key: string, options?: Record<string, unknown>) => string
): {
  stage: OrderStage
  label: string
  badgeClass: string
  dotClass: string
  cardClass: string
  cardSelectedClass: string
} {
  if (order.audit?.status === 'released') {
    return {
      stage: 'ENTREGADA',
      label: t('blindaje_delivery.stage_delivered'),
      badgeClass: 'bg-slate-200 text-slate-700 border border-slate-300',
      dotClass: 'bg-slate-500',
      cardClass: 'border-slate-200 bg-slate-50 text-slate-600',
      cardSelectedClass: 'border-slate-700 bg-slate-100 ring-4 ring-slate-400/30'
    }
  }
  if (isOrderUnclaimedAfter2Hours(order)) {
    return {
      stage: 'NO_RECOGIDA',
      label: t('blindaje_delivery.stage_unclaimed'),
      badgeClass: 'bg-orange-600 text-white border border-orange-700',
      dotClass: 'bg-white',
      cardClass: 'border-orange-400 bg-orange-50/70 text-orange-950',
      cardSelectedClass: 'border-orange-600 bg-orange-100 ring-4 ring-orange-500/30'
    }
  }
  if (order.audit?.status === 'ready') {
    return {
      stage: 'LISTA',
      label: t('blindaje_delivery.stage_ready'),
      badgeClass: 'bg-emerald-600 text-white border border-emerald-700',
      dotClass: 'bg-emerald-200',
      cardClass: 'border-emerald-400 bg-emerald-50/60',
      cardSelectedClass: 'border-emerald-600 bg-emerald-50 ring-4 ring-emerald-500/25'
    }
  }
  if (order.kdsStatus === 'IN_KITCHEN') {
    return {
      stage: 'PREPARACION',
      label: t('blindaje_delivery.stage_prep'),
      badgeClass: 'bg-amber-500 text-slate-950 border border-amber-600',
      dotClass: 'bg-slate-950 animate-pulse',
      cardClass: 'border-amber-400 bg-amber-50/60',
      cardSelectedClass: 'border-amber-600 bg-amber-50 ring-4 ring-amber-500/25'
    }
  }
  return {
    stage: 'EMPACANDO',
    label: t('blindaje_delivery.stage_packing'),
    badgeClass: 'bg-blue-600 text-white border border-blue-700',
    dotClass: 'bg-white animate-pulse',
    cardClass: 'border-blue-400 bg-blue-50/60',
    cardSelectedClass: 'border-blue-600 bg-blue-50 ring-4 ring-blue-500/25'
  }
}

type NameCollisionReason = 'EXACT_NAME' | 'SAME_FIRST_NAME' | 'SIMILAR_NAME'

interface NameCollisionMatch {
  order: Order
  reason: NameCollisionReason
  reasonLabel: string
}

const GENERIC_CUSTOMER_WORDS = new Set(['cliente', 'uber', 'eats', 'doordash', 'grubhub', 'online', 'delivery', 'pickup'])

function normalizeAsciiName(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function phoneticFirstToken(token: string): string {
  return token
    .replace(/ph/g, 'f')
    .replace(/ch/g, 'x')
    .replace(/ll/g, 'i')
    .replace(/qu/g, 'k')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/g([ei])/g, 'j$1')
    .replace(/h/g, '')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1')
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

function areCustomerNamesConfusable(
  nameA: string,
  nameB: string
): { confusable: boolean; reason: NameCollisionReason | null } {
  const normA = normalizeAsciiName(nameA)
  const normB = normalizeAsciiName(nameB)
  if (!normA || !normB) return { confusable: false, reason: null }

  const partsA = normA.split(' ').filter(t => t && !GENERIC_CUSTOMER_WORDS.has(t))
  const partsB = normB.split(' ').filter(t => t && !GENERIC_CUSTOMER_WORDS.has(t))
  const firstA = partsA[0] || ''
  const firstB = partsB[0] || ''

  if (firstA.length < 2 || firstB.length < 2) {
    return { confusable: false, reason: null }
  }

  if (partsA.join(' ') === partsB.join(' ')) {
    return { confusable: true, reason: 'EXACT_NAME' }
  }

  if (firstA === firstB) {
    return { confusable: true, reason: 'SAME_FIRST_NAME' }
  }

  const phonA = phoneticFirstToken(firstA)
  const phonB = phoneticFirstToken(firstB)
  if (phonA.length >= 3 && phonA === phonB) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  const minLen = Math.min(firstA.length, firstB.length)
  if (minLen >= 3 && (firstA.startsWith(firstB) || firstB.startsWith(firstA))) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }
  const minPhonLen = Math.min(phonA.length, phonB.length)
  if (minPhonLen >= 3 && (phonA.startsWith(phonB) || phonB.startsWith(phonA))) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  const rawDist = levenshteinDistance(firstA, firstB)
  const phonDist = levenshteinDistance(phonA, phonB)

  if (minLen >= 4 && (rawDist <= 1 || phonDist <= 1)) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  if (minLen >= 5 && rawDist <= 2 && phonA[0] === phonB[0]) {
    return { confusable: true, reason: 'SIMILAR_NAME' }
  }

  return { confusable: false, reason: null }
}

function getCollisionReasonLabel(
  reason: NameCollisionReason,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (reason === 'EXACT_NAME') return t('blindaje_delivery.collision_exact')
  if (reason === 'SAME_FIRST_NAME') return t('blindaje_delivery.collision_same_first')
  return t('blindaje_delivery.collision_similar')
}

// Determina si una orden sigue activa en el estante (si cumple 2 horas o más sin ser recogida por ningún chofer, cambia automáticamente a NO RECOGIDA (+2H))
function isOrderCurrentlyActive(order: Order, dismissedVoided?: Record<string, boolean>): boolean {
  if (order.isVoided) {
    // Si la orden ya había sido empacada (LISTA) y la plataforma la cancela después, NO esconderla hasta que la cajera confirme que retiró la bolsa física del estante
    if (order.audit?.status === 'ready' && !dismissedVoided?.[order.guid]) {
      return true
    }
    return false
  }
  if (order.audit?.status === 'released' || isOrderUnclaimedAfter2Hours(order)) return false
  const now = Date.now()
  const openedAgeMs = now - new Date(order.openedAt).getTime()
  if (!Number.isFinite(openedAgeMs) || openedAgeMs >= UNCLAIMED_DRIVER_TIMEOUT_MS) return false

  // 1. Si ya fue empacada y sellada en la tableta (LISTA), mantener en estante hasta cumplir 2 horas (120 min) esperando al chofer
  if (order.audit?.status === 'ready') {
    return openedAgeMs < UNCLAIMED_DRIVER_TIMEOUT_MS
  }
  // 2. Si el cocinero aún la tiene en pantalla KDS (PREPARACIÓN), mantener hasta 60 min
  if (order.kdsStatus === 'IN_KITCHEN') {
    return openedAgeMs <= 60 * 60 * 1000
  }
  // 3. Si salió del KDS y no se ha empacado (EMPACANDO), mantener visible en el estante hasta que se empaque/entregue o cumpla las 2 horas (nunca ocultarla a los 20 min)
  return openedAgeMs < UNCLAIMED_DRIVER_TIMEOUT_MS
}

function getOrderOperationalPriority(order: Order): number {
  if (order.isVoided && order.audit?.status === 'ready') return -1 // Alerta crítica arriba de todo: retirar bolsa cancelada del estante
  if (order.audit?.status === 'released') return 4
  if (isOrderUnclaimedAfter2Hours(order)) return 3
  if (order.kdsStatus === 'IN_KITCHEN' && order.audit?.status !== 'ready') return 2 // En cocina KDS va debajo de lo que ya salió
  if (order.audit?.status === 'ready') return 1 // Lista esperando chofer
  return 0 // EMPACANDO (Ya salió de cocina y requiere armar bolsas) va primero arriba
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins === 0) return `${secs}s`
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

function formatRemainingMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function isForbiddenRaulVoice(voiceName: string | null | undefined): boolean {
  if (!voiceName) return false
  const normalized = voiceName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return normalized.includes('raul')
}

export default function BlindajeDeliveryEmpaquePage() {
  const { t, language, setLanguage } = useLanguage()
  const rootRef = useRef<HTMLElement | null>(null)
  const [storeId, setStoreId] = useState(7)
  const [packer, setPacker] = useState<Packer | null>(null)
  const [remainingMs, setRemainingMs] = useState<number>(PIN_SESSION_DURATION_MS)
  const [pin, setPin] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [bags, setBags] = useState<Record<string, number>>({})
  const [editingPacking, setEditingPacking] = useState<Record<string, boolean>>({})
  const [allowEarlyPack, setAllowEarlyPack] = useState<Record<string, boolean>>({})
  const [releaseCooldownUntil, setReleaseCooldownUntil] = useState<Record<string, number>>({})
  const [driverPresentAck, setDriverPresentAck] = useState<Record<string, boolean>>({})
  const [dismissedVoided, setDismissedVoided] = useState<Record<string, boolean>>({})
  const [collisionAck, setCollisionAck] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState<'Kore' | 'Aoede' | 'Zephyr' | 'Puck' | 'Orus'>('Kore')
  const [activeAnnouncement, setActiveAnnouncement] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Referencias del motor de audio, rastreo de KDS e inactividad de sesión PIN (10 min sin actividad)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const clipCacheRef = useRef<Map<string, Promise<ArrayBuffer | null>>>(new Map())
  const audioQueueRef = useRef<Order[]>([])
  const isPlayingAudioRef = useRef<boolean>(false)
  const prevKdsStatusRef = useRef<Map<string, 'IN_KITCHEN' | 'READY'>>(new Map())
  const announcedGuidsRef = useRef<Set<string>>(new Set())
  const initializedStoreRef = useRef<number | null>(null)
  const packerRef = useRef<Packer | null>(null)
  const showHistoryRef = useRef<boolean>(false)
  const searchRef = useRef<string>('')
  const dismissedVoidedRef = useRef<Record<string, boolean>>({})
  const lastActivityAtRef = useRef<number>(Date.now())
  const sessionExpiresAtRef = useRef<number>(0)
  const lastStorageSyncAtRef = useRef<number>(0)

  useEffect(() => {
    packerRef.current = packer
  }, [packer])

  useEffect(() => {
    showHistoryRef.current = showHistory
  }, [showHistory])

  useEffect(() => {
    searchRef.current = search
  }, [search])

  useEffect(() => {
    dismissedVoidedRef.current = dismissedVoided
  }, [dismissedVoided])

  // Sincronizar la voz configurada en Supabase (order_ready_settings) igual que Order Ready Board
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/order-ready/settings', { cache: 'no-store' })
        const data = await res.json()
        const v = data?.settings?.voice
        if (mounted && (v === 'Kore' || v === 'Aoede' || v === 'Zephyr' || v === 'Puck' || v === 'Orus')) {
          setSelectedVoice(v)
        }
      } catch {
        // Mantiene Kore por defecto
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Desbloquear AudioContext en cualquier toque o tecla
  const unlockAudio = useCallback(() => {
    try {
      if (typeof window === 'undefined') return
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (AudioContextClass) {
          audioCtxRef.current = new AudioContextClass()
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
    } catch {
      // ignore
    }
  }, [])

  // Campana aguda y prolongada exclusiva para órdenes Delivery antes de la voz
  const playChime = useCallback((): Promise<void> => {
    return new Promise(async resolve => {
      try {
        unlockAudio()
        const ctx = audioCtxRef.current
        if (!ctx) {
          resolve()
          return
        }
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {})
        }
        const now = ctx.currentTime

        // Helper para crear parciales armónicos de campana cristalina aguda
        const strikeBellPartial = (
          freq: number,
          startOffset: number,
          duration: number,
          peakGain: number,
          type: OscillatorType = 'sine'
        ) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = type
          osc.frequency.setValueAtTime(freq, now + startOffset)
          gain.gain.setValueAtTime(0.0001, now + startOffset)
          gain.gain.linearRampToValueAtTime(peakGain, now + startOffset + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.0008, now + startOffset + duration)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(now + startOffset)
          osc.stop(now + startOffset + duration + 0.02)
        }

        // Toque 1 (Ding agudo brillante - E6 1318.5 Hz + armónicos de campana E7/B7)
        strikeBellPartial(1318.51, 0.0, 1.35, 0.36, 'sine')
        strikeBellPartial(2637.02, 0.0, 0.85, 0.16, 'sine')
        strikeBellPartial(3951.07, 0.0, 0.45, 0.08, 'triangle')

        // Toque 2 (Dong más agudo y prolongado - A6 1760 Hz + resonancia larga de campana A7/E7)
        strikeBellPartial(1760.0, 0.28, 1.85, 0.42, 'sine')
        strikeBellPartial(3520.0, 0.28, 1.25, 0.18, 'sine')
        strikeBellPartial(2637.02, 0.28, 1.55, 0.12, 'triangle')

        setTimeout(resolve, 1950)
      } catch {
        resolve()
      }
    })
  }, [unlockAudio])

  // Descargar y cachear en memoria el ArrayBuffer WAV desde Supabase Storage (evita fallos de fetch a blob:)
  const getCachedAudioBuffer = useCallback((cacheKey: string, endpointUrl: string): Promise<ArrayBuffer | null> => {
    const existing = clipCacheRef.current.get(cacheKey)
    if (existing) return existing

    const job = (async (): Promise<ArrayBuffer | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(endpointUrl, { signal: AbortSignal.timeout(9000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const arrayBuf = await res.arrayBuffer()
          if (arrayBuf.byteLength < 500) throw new Error('Empty audio buffer')
          return arrayBuf
        } catch {
          if (attempt === 0) await new Promise(r => setTimeout(r, 300))
        }
      }
      clipCacheRef.current.delete(cacheKey)
      return null
    })()

    clipCacheRef.current.set(cacheKey, job)
    return job
  }, [])

  // Precargar los 2 clips de sufijo ("Please pack." y "Favor de empacar.") con exactamente la misma voz y timbre de Supabase
  useEffect(() => {
    void getCachedAudioBuffer(
      `suffix:${selectedVoice}:en:please-pack:kds2`,
      `/api/order-ready/announcement-tts?text=Please%20pack.&lang=en&voice=${selectedVoice}&v=kds2`
    )
    void getCachedAudioBuffer(
      `suffix:${selectedVoice}:es:favor-de-empacar:kds2`,
      `/api/order-ready/announcement-tts?text=Favor%20de%20empacar.&lang=es&voice=${selectedVoice}&v=kds2`
    )
  }, [getCachedAudioBuffer, selectedVoice])

  // Reproducir un ArrayBuffer WAV de Supabase usando Web Audio API directamente (o HTMLAudioElement de respaldo)
  const playClipBuffer = useCallback(
    (arrayBuf: ArrayBuffer): Promise<boolean> =>
      new Promise(async resolve => {
        let done = false
        const finish = (ok: boolean) => {
          if (!done) {
            done = true
            resolve(ok)
          }
        }

        try {
          unlockAudio()
          const ctx = audioCtxRef.current
          if (ctx && arrayBuf.byteLength > 44) {
            if (ctx.state === 'suspended') {
              await ctx.resume().catch(() => {})
            }
            const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0))
            const source = ctx.createBufferSource()
            source.buffer = audioBuffer
            source.connect(ctx.destination)
            const timer = setTimeout(() => {
              try {
                source.stop()
              } catch {}
              finish(false)
            }, 12000)
            source.onended = () => {
              clearTimeout(timer)
              finish(true)
            }
            source.start(0)
            return
          }
        } catch {
          // Fallback a HTMLAudioElement
        }

        try {
          const blobUrl = URL.createObjectURL(new Blob([arrayBuf.slice(0)], { type: 'audio/wav' }))
          const audio = new Audio(blobUrl)
          const cleanup = (ok: boolean) => {
            URL.revokeObjectURL(blobUrl)
            finish(ok)
          }
          audio.onended = () => cleanup(true)
          audio.onerror = () => cleanup(false)
          setTimeout(() => {
            if (!done) audio.pause()
            cleanup(false)
          }, 12000)
          audio.play().catch(() => cleanup(false))
        } catch {
          finish(false)
        }
      }),
    [unlockAudio]
  )

  // Respaldo con síntesis del navegador (con filtro anti-Raúl) si no hay red
  const speakBrowserFallback = useCallback((numStr: string, lang: 'en' | 'es'): Promise<void> => {
    return new Promise(resolve => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve()
        return
      }
      const voices = window.speechSynthesis.getVoices().filter(v => !isForbiddenRaulVoice(v.name))
      const targetVoice =
        voices.find(v => v.lang.toLowerCase().startsWith(lang) && /female|samantha|victoria|paulina|monica|dalia|sabina|google/i.test(v.name)) ||
        voices.find(v => v.lang.toLowerCase().startsWith(lang)) ||
        voices[0]
      if (!targetVoice || isForbiddenRaulVoice(targetVoice.name)) {
        resolve()
        return
      }
      const text =
        lang === 'en'
          ? `Order ${numStr} is ready, please pack.`
          : `Orden ${numStr} ya está, favor de empacar.`
      const utt = new SpeechSynthesisUtterance(text)
      utt.voice = targetVoice
      utt.lang = targetVoice.lang || (lang === 'en' ? 'en-US' : 'es-MX')
      utt.rate = 0.95
      const timer = setTimeout(resolve, 7000)
      utt.onend = () => {
        clearTimeout(timer)
        resolve()
      }
      utt.onerror = () => {
        clearTimeout(timer)
        resolve()
      }
      try {
        window.speechSynthesis.speak(utt)
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }, [])

  // Reproducir aviso completo con las mismas voces de Supabase Storage: Campana aguda prolongada + "Order #100, is ready! Please pack." + "Orden #100, ¡ya está! Favor de empacar."
  const speakOrderReadyToPack = useCallback(
    async (targetOrder: Order) => {
      const rawDigits = targetOrder.ticket.replace(/\D/g, '')
      const num = rawDigits && /^\d{1,4}$/.test(rawDigits) ? String(parseInt(rawDigits, 10)) : ''
      const bannerText = `🔊 Order #${targetOrder.ticket} is ready, please pack • Favor de empacar • ${targetOrder.platformOrderKey}`
      setActiveAnnouncement(bannerText)

      try {
        await playChime()

        if (!num) {
          await speakBrowserFallback(targetOrder.ticket, 'en')
          await speakBrowserFallback(targetOrder.ticket, 'es')
          return
        }

        // Descargar en paralelo el audio de la orden en Supabase Storage (v4/{voice}/{lang}/{num}.wav) + los sufijos ("Please pack." / "Favor de empacar.") con la misma voz
        const [orderEnBuf, packEnBuf, orderEsBuf, packEsBuf] = await Promise.all([
          getCachedAudioBuffer(`order:${selectedVoice}:en:${num}`, `/api/order-ready/tts?n=${num}&lang=en&voice=${selectedVoice}`),
          getCachedAudioBuffer(
            `suffix:${selectedVoice}:en:please-pack:kds2`,
            `/api/order-ready/announcement-tts?text=Please%20pack.&lang=en&voice=${selectedVoice}&v=kds2`
          ),
          getCachedAudioBuffer(`order:${selectedVoice}:es:${num}`, `/api/order-ready/tts?n=${num}&lang=es&voice=${selectedVoice}`),
          getCachedAudioBuffer(
            `suffix:${selectedVoice}:es:favor-de-empacar:kds2`,
            `/api/order-ready/announcement-tts?text=Favor%20de%20empacar.&lang=es&voice=${selectedVoice}&v=kds2`
          )
        ])

        // 1. Inglés desde Supabase Storage: "Order #100, is ready!" + "Please pack."
        const okEnOrder = orderEnBuf ? await playClipBuffer(orderEnBuf) : false
        if (okEnOrder) {
          if (packEnBuf) await playClipBuffer(packEnBuf)
        } else {
          await speakBrowserFallback(num, 'en')
        }

        await new Promise(r => setTimeout(r, 150))

        // 2. Español desde Supabase Storage: "Orden #100, ¡ya está!" + "Favor de empacar."
        const okEsOrder = orderEsBuf ? await playClipBuffer(orderEsBuf) : false
        if (okEsOrder) {
          if (packEsBuf) await playClipBuffer(packEsBuf)
        } else {
          await speakBrowserFallback(num, 'es')
        }
      } finally {
        setTimeout(() => {
          setActiveAnnouncement(current => (current === bannerText ? null : current))
        }, 3500)
      }
    },
    [getCachedAudioBuffer, playChime, playClipBuffer, selectedVoice, speakBrowserFallback]
  )

  const processAudioQueue = useCallback(async () => {
    if (isPlayingAudioRef.current || isMuted || audioQueueRef.current.length === 0) return
    isPlayingAudioRef.current = true
    try {
      while (audioQueueRef.current.length > 0 && !isMuted) {
        const nextOrder = audioQueueRef.current.shift()
        if (nextOrder) {
          await speakOrderReadyToPack(nextOrder)
        }
      }
    } finally {
      isPlayingAudioRef.current = false
    }
  }, [isMuted, speakOrderReadyToPack])

  const enqueueOrderAnnouncement = useCallback(
    (targetOrder: Order) => {
      if (isMuted) return
      audioQueueRef.current.push(targetOrder)
      void processAudioQueue()
    },
    [isMuted, processAudioQueue]
  )

  // Función para activar y mantener siempre Pantalla Completa (Fullscreen) en la tableta
  const ensureFullscreen = useCallback(async () => {
    unlockAudio()
    if (typeof document === 'undefined') return
    const doc = document as any
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      setIsFullscreen(true)
      return
    }
    const elem = (document.documentElement || rootRef.current) as any
    try {
      if (elem?.requestFullscreen) {
        await elem.requestFullscreen({ navigationUI: 'hide' }).catch(() => elem.requestFullscreen())
      } else if (elem?.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen()
      }
      setIsFullscreen(true)
    } catch {
      setIsFullscreen(true)
    }
  }, [unlockAudio])

  // Sincronizar estado de fullscreen y activar automáticamente al primer toque en cualquier parte de la pantalla
  useEffect(() => {
    if (typeof document === 'undefined') return
    const doc = document as any
    const onFullscreenChange = () => {
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
    }
    const onUserInteraction = () => {
      unlockAudio()
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        void ensureFullscreen()
      }
    }
    onFullscreenChange()
    void ensureFullscreen()

    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    window.addEventListener('pointerdown', onUserInteraction, { passive: true })
    window.addEventListener('touchstart', onUserInteraction, { passive: true })
    window.addEventListener('keydown', onUserInteraction, { passive: true })
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      window.removeEventListener('pointerdown', onUserInteraction)
      window.removeEventListener('touchstart', onUserInteraction)
      window.removeEventListener('keydown', onUserInteraction)
    }
  }, [ensureFullscreen, unlockAudio])

  // Al cerrar sesión, cumplir 10 minutos sin actividad, o cuando otra persona inicia sesión en la tienda, regresa a la pantalla de PIN manteniendo Fullscreen
  const logout = useCallback(
    (expiredNotice?: string, skipServerDelete?: boolean) => {
      const currentPacker = packerRef.current
      if (currentPacker && !skipServerDelete) {
        fetch('/api/delivery-armor/verify-pin', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: currentPacker.storeId,
            sessionToken: currentPacker.sessionToken
          })
        }).catch(() => {})
      }
      ;[
        'blindaje_packer_pin',
        'blindaje_packer_name',
        'blindaje_packer_title',
        'blindaje_packer_user_id',
        'blindaje_packer_store',
        'blindaje_packer_expires_at',
        'blindaje_packer_last_activity_at',
        'blindaje_packer_session_token'
      ].forEach(key => sessionStorage.removeItem(key))
      sessionExpiresAtRef.current = 0
      lastActivityAtRef.current = 0
      packerRef.current = null
      setPacker(null)
      setSelected(null)
      setPin('')
      if (expiredNotice) {
        setError(expiredNotice)
      }
      void ensureFullscreen()
    },
    [ensureFullscreen]
  )

  const handleSessionReplacedError = useCallback(
    (replacedByName?: string | null) => {
      const cleanName = String(replacedByName || '').trim()
      const msg = cleanName
        ? t('blindaje_delivery.pin_session_replaced', { name: cleanName })
        : t('blindaje_delivery.pin_session_replaced_generic')
      logout(msg, true)
    },
    [logout, t]
  )

  // Reiniciar el contador de 10 minutos sin actividad ante cualquier interacción real de la cajera en la tableta
  const recordCashierActivity = useCallback((): boolean => {
    const activePacker = packerRef.current
    if (!activePacker) return false
    const now = Date.now()
    const currentExpiry = sessionExpiresAtRef.current
    const inactiveMs = lastActivityAtRef.current > 0 ? now - lastActivityAtRef.current : 0
    if ((currentExpiry > 0 && now >= currentExpiry) || inactiveMs >= PIN_INACTIVITY_TIMEOUT_MS) {
      logout(t('blindaje_delivery.pin_session_expired'))
      return false
    }
    const nextExpiresAt = now + PIN_INACTIVITY_TIMEOUT_MS
    const prevSync = lastStorageSyncAtRef.current
    lastActivityAtRef.current = now
    sessionExpiresAtRef.current = nextExpiresAt
    if (now - prevSync >= 500) {
      lastStorageSyncAtRef.current = now
      setRemainingMs(PIN_INACTIVITY_TIMEOUT_MS)
      try {
        sessionStorage.setItem('blindaje_packer_last_activity_at', String(now))
        sessionStorage.setItem('blindaje_packer_expires_at', String(nextExpiresAt))
      } catch {
        // ignore storage quota
      }
    }
    // Sincronizar actividad con el servidor cada 20 segundos y verificar que nadie más haya iniciado sesión en la tienda
    if (now - prevSync >= 20_000 && activePacker.sessionToken) {
      fetch('/api/delivery-armor/verify-pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: activePacker.storeId,
          sessionToken: activePacker.sessionToken
        })
      })
        .then(async res => {
          if (res.status === 409) {
            const payload = await res.json().catch(() => ({}))
            if (payload.replacedBy) {
              handleSessionReplacedError(payload.replacedBy)
            } else if (payload.expired) {
              logout(t('blindaje_delivery.pin_session_expired'), true)
            }
          }
        })
        .catch(() => {})
    }
    return true
  }, [logout, handleSessionReplacedError, t])

  // Restaurar sesión si sigue dentro de los 10 minutos sin actividad y sigue siendo la sesión única activa de la tienda
  useEffect(() => {
    try {
      const savedStore = Number(sessionStorage.getItem('blindaje_packer_store'))
      const savedPin = sessionStorage.getItem('blindaje_packer_pin') || ''
      const name = sessionStorage.getItem('blindaje_packer_name') || ''
      const id = Number(sessionStorage.getItem('blindaje_packer_user_id'))
      const expiresAt = Number(sessionStorage.getItem('blindaje_packer_expires_at'))
      const savedLastActivity = Number(sessionStorage.getItem('blindaje_packer_last_activity_at'))
      const savedSessionToken = sessionStorage.getItem('blindaje_packer_session_token') || ''
      const now = Date.now()
      const lastActivity =
        Number.isFinite(savedLastActivity) && savedLastActivity > 0
          ? savedLastActivity
          : expiresAt - PIN_INACTIVITY_TIMEOUT_MS
      if (
        savedStore === storeId &&
        /^\d{4}$/.test(savedPin) &&
        name &&
        id &&
        savedSessionToken &&
        Number.isFinite(expiresAt) &&
        expiresAt > now &&
        now - lastActivity < PIN_INACTIVITY_TIMEOUT_MS
      ) {
        lastActivityAtRef.current = lastActivity
        sessionExpiresAtRef.current = expiresAt
        const restored: Packer = {
          pin: savedPin,
          name,
          title: sessionStorage.getItem('blindaje_packer_title') || t('blindaje_delivery.default_staff'),
          id,
          storeId,
          expiresAt,
          sessionToken: savedSessionToken
        }
        packerRef.current = restored
        setPacker(restored)
        setRemainingMs(expiresAt - now)
      } else {
        logout(undefined, true)
      }
    } catch {
      setPacker(null)
    }
  }, [storeId, logout, t])

  // Candado de Sesión Única por Tienda (Mismo dispositivo vía BroadcastChannel/localStorage + Entre tabletas vía Supabase Realtime)
  useEffect(() => {
    if (!packer) return

    const onExternalSessionOpened = (incomingStoreId: number, incomingToken: string, incomingName?: string) => {
      const current = packerRef.current
      if (!current) return
      if (Number(incomingStoreId) === current.storeId && incomingToken && incomingToken !== current.sessionToken) {
        handleSessionReplacedError(incomingName)
      }
    }

    // 1. BroadcastChannel + localStorage storage event (pestañas/ventanas en el mismo dispositivo)
    let bc: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('blindaje_delivery_session')
        bc.onmessage = event => {
          const d = event?.data
          if (d?.type === 'SESSION_OPENED') {
            onExternalSessionOpened(Number(d.storeId), String(d.sessionToken || ''), d.employeeName)
          }
        }
      }
    } catch {
      // ignore if BroadcastChannel unsupported
    }

    const onStorageEvent = (event: StorageEvent) => {
      if (event.key === `blindaje_active_session_${storeId}` && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue)
          onExternalSessionOpened(Number(parsed.storeId), String(parsed.sessionToken || ''), parsed.employeeName)
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('storage', onStorageEvent)

    // 2. Supabase Realtime Broadcast (entre distintas tabletas o computadoras en la misma tienda)
    const channel = supabase
      ? supabase
          .channel(`blindaje-delivery-session-${storeId}`)
          .on('broadcast', { event: 'session_opened' }, payload => {
            const p = payload?.payload as any
            if (p) {
              onExternalSessionOpened(Number(p.storeId), String(p.sessionToken || ''), p.employeeName)
            }
          })
          .subscribe()
      : null

    return () => {
      window.removeEventListener('storage', onStorageEvent)
      try {
        bc?.close()
      } catch {}
      if (channel && supabase) {
        supabase.removeChannel(channel)
      }
    }
  }, [packer, storeId, handleSessionReplacedError])

  // Reloj y sensores de inactividad: cierra la sesión del PIN de la cajera tras 10 minutos sin actividad
  useEffect(() => {
    if (!packer) return
    const checkInactivityExpiry = () => {
      const now = Date.now()
      const left = sessionExpiresAtRef.current - now
      const inactiveMs = now - lastActivityAtRef.current
      if (left <= 0 || inactiveMs >= PIN_INACTIVITY_TIMEOUT_MS) {
        logout(t('blindaje_delivery.pin_session_expired'))
      } else {
        setRemainingMs(left)
      }
    }
    const onUserActivity = () => {
      recordCashierActivity()
    }
    const onVisibilityOrFocus = () => {
      checkInactivityExpiry()
    }

    checkInactivityExpiry()
    const interval = window.setInterval(checkInactivityExpiry, 1000)
    window.addEventListener('pointerdown', onUserActivity, { passive: true })
    window.addEventListener('touchstart', onUserActivity, { passive: true })
    window.addEventListener('mousedown', onUserActivity, { passive: true })
    window.addEventListener('keydown', onUserActivity, { passive: true })
    window.addEventListener('scroll', onUserActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibilityOrFocus)
    window.addEventListener('focus', onVisibilityOrFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pointerdown', onUserActivity)
      window.removeEventListener('touchstart', onUserActivity)
      window.removeEventListener('mousedown', onUserActivity)
      window.removeEventListener('keydown', onUserActivity)
      window.removeEventListener('scroll', onUserActivity, true)
      document.removeEventListener('visibilitychange', onVisibilityOrFocus)
      window.removeEventListener('focus', onVisibilityOrFocus)
    }
  }, [packer, logout, recordCashierActivity, t])

  // Cargar historial de órdenes ya anunciadas en esta sesión por sucursal
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`blindaje_kds_announced_${storeId}`)
      const parsed: string[] = raw ? JSON.parse(raw) : []
      announcedGuidsRef.current = new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      announcedGuidsRef.current = new Set()
    }
    prevKdsStatusRef.current = new Map()
    initializedStoreRef.current = null
  }, [storeId])

  const persistAnnouncedGuid = useCallback(
    (guid: string) => {
      announcedGuidsRef.current.add(guid)
      try {
        const list = Array.from(announcedGuidsRef.current).slice(-300)
        sessionStorage.setItem(`blindaje_kds_announced_${storeId}`, JSON.stringify(list))
      } catch {
        // ignore storage quota
      }
    },
    [storeId]
  )

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/delivery-armor/orders?storeId=${storeId}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || t('blindaje_delivery.error_fetch_orders'))

      // Verificar si otra persona inició sesión en esta misma tienda (no puede haber 2 sesiones abiertas)
      const currentPacker = packerRef.current
      if (
        currentPacker &&
        data.activeSession &&
        data.activeSession.sessionToken &&
        data.activeSession.sessionToken !== currentPacker.sessionToken
      ) {
        handleSessionReplacedError(data.activeSession.employeeName)
      }
      const next: Order[] = (data.orders || []).map((raw: any) => ({
        guid: raw.orderGuid,
        ticket: raw.displayNumber,
        diningOption: raw.diningOptionName,
        platform: raw.platform,
        customer: raw.customerName,
        maskedCustomer: raw.maskedCustomerName || 'C•••',
        platformOrderKey: raw.platformOrderKey || `#${raw.displayNumber}`,
        shortOrderKey: raw.shortOrderKey || `#${raw.displayNumber}`,
        assignedDriverHint: raw.assignedDriverHint || null,
        openedAt: raw.openedDate,
        kdsStatus: raw.kdsStatus || 'READY',
        kdsSentAt: raw.kdsSentAt || raw.openedDate,
        kdsReadyAt: raw.kdsReadyAt || null,
        kdsPrepSeconds: raw.kdsPrepSeconds ?? null,
        isVoided: !!raw.isVoided,
        itemCount: raw.totalItemsCount,
        hasDrinks: raw.items?.some((item: any) => item.isHighRiskDrink) || false,
        items: (raw.items || []).map((item: any) => ({
          id: item.id,
          name: item.displayName,
          quantity: item.quantity,
          price: Number(item.price || 0),
          modifiers: item.modifiers || [],
          isDrink: item.isHighRiskDrink
        })),
        audit: raw.audit
          ? {
              status:
                raw.audit.status === 'DELIVERED'
                  ? 'released'
                  : raw.audit.status === 'UNCLAIMED_2H'
                  ? 'unclaimed'
                  : raw.audit.status === 'PACKED_AND_SEALED'
                  ? 'ready'
                  : 'pending',
              bags: raw.audit.confirmedBagCount,
              packedBy: raw.audit.packerName || undefined,
              packedAt: raw.audit.packedAt || undefined,
              handedBy: raw.audit.handedByName,
              driver: raw.audit.driverName,
              courierReference: raw.audit.courierOrderReference
            }
          : undefined
      }))

      // Detectar órdenes que el cocinero acaba de borrar del KDS (IN_KITCHEN -> READY)
      const isInitialFetchForStore = initializedStoreRef.current !== storeId
      const newlyReadyOrders: Order[] = []

      for (const item of next) {
        const prevStatus = prevKdsStatusRef.current.get(item.guid)
        prevKdsStatusRef.current.set(item.guid, item.kdsStatus)

        const isUnpackedDelivery =
          item.kdsStatus === 'READY' &&
          !item.isVoided &&
          item.audit?.status !== 'ready' &&
          item.audit?.status !== 'released' &&
          item.audit?.status !== 'unclaimed' &&
          !isOrderUnclaimedAfter2Hours(item)

        if (!isUnpackedDelivery) {
          if (item.kdsStatus === 'READY') {
            persistAnnouncedGuid(item.guid)
          }
          continue
        }

        if (announcedGuidsRef.current.has(item.guid)) {
          continue
        }

        const readyAgeMs = item.kdsReadyAt ? Date.now() - new Date(item.kdsReadyAt).getTime() : Infinity

        if (isInitialFetchForStore) {
          // En la carga inicial, solo anunciar si el cocinero la acaba de borrar del KDS hace menos de 45 segundos
          if (readyAgeMs >= 0 && readyAgeMs <= 45_000) {
            persistAnnouncedGuid(item.guid)
            newlyReadyOrders.push(item)
          } else {
            persistAnnouncedGuid(item.guid)
          }
        } else {
          // En monitoreo continuo: si pasó de IN_KITCHEN a READY o es nueva orden recién salida del KDS
          if (prevStatus === 'IN_KITCHEN' || (prevStatus === undefined && readyAgeMs <= 180_000)) {
            persistAnnouncedGuid(item.guid)
            newlyReadyOrders.push(item)
          }
        }
      }

      initializedStoreRef.current = storeId

      if (newlyReadyOrders.length > 0) {
        for (const readyOrder of newlyReadyOrders) {
          enqueueOrderAnnouncement(readyOrder)
        }
      }

      setOrders(next)
      setSelected(current => {
        // Nunca seleccionar ninguna orden automáticamente: solo conservar la que la cajera haya seleccionado manualmente
        if (!current) return null
        const currentObj = next.find(o => o.guid === current) || null
        if (!currentObj) return null
        if (showHistoryRef.current || searchRef.current.trim().length > 0) {
          return current
        }
        return isOrderCurrentlyActive(currentObj, dismissedVoidedRef.current) ? current : null
      })
      return next
    } catch (caught: any) {
      if (packer) setError(caught.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [storeId, packer, persistAnnouncedGuid, enqueueOrderAnnouncement, handleSessionReplacedError, t])

  // Monitoreo continuo del KDS cada 8 segundos (incluso cuando está en la pantalla de PIN)
  useEffect(() => {
    void fetchOrders()
    const timer = window.setInterval(fetchOrders, KDS_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [fetchOrders])

  const activeQueueOrders = useMemo(() => {
    const base = showHistory ? [...orders] : orders.filter(o => isOrderCurrentlyActive(o, dismissedVoided))
    return base.sort((a, b) => {
      const prioDiff = getOrderOperationalPriority(a) - getOrderOperationalPriority(b)
      if (prioDiff !== 0) return prioDiff
      return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
    })
  }, [orders, showHistory, dismissedVoided])

  // Detectar colisiones de nombres (mismo nombre exacto, mismo primer nombre con apellido diferente, o nombre muy parecido)
  // entre todas las órdenes que han entrado al sistema desde KDS en las últimas 2 horas (o que siguen activas)
  const collisionsByGuid = useMemo(() => {
    const map = new Map<string, NameCollisionMatch[]>()
    const now = Date.now()
    const recentKdsPool = orders.filter(o => {
      if (o.isVoided) return false
      if (isOrderCurrentlyActive(o, dismissedVoided)) return true
      const openedAgeMs = now - new Date(o.openedAt).getTime()
      const readyAgeMs = o.kdsReadyAt ? now - new Date(o.kdsReadyAt).getTime() : openedAgeMs
      return Math.min(openedAgeMs, readyAgeMs) <= 120 * 60 * 1000
    })

    for (const currentOrder of orders) {
      if (currentOrder.isVoided) continue
      const matches: NameCollisionMatch[] = []
      for (const candidate of recentKdsPool) {
        if (candidate.guid === currentOrder.guid) continue
        const check = areCustomerNamesConfusable(currentOrder.customer, candidate.customer)
        if (check.confusable && check.reason) {
          matches.push({
            order: candidate,
            reason: check.reason,
            reasonLabel: getCollisionReasonLabel(check.reason, t)
          })
        }
      }
      if (matches.length > 0) {
        map.set(currentOrder.guid, matches)
      }
    }
    return map
  }, [orders, t])

  const order = useMemo(() => orders.find(value => value.guid === selected) || null, [orders, selected])
  const bagCount = order ? bags[order.guid] || order.audit?.bags || 1 : 1
  const currentCollisions = useMemo(
    () => (order ? collisionsByGuid.get(order.guid) || [] : []),
    [order, collisionsByGuid]
  )
  const isCollisionConfirmed = order ? currentCollisions.length === 0 || !!collisionAck[order.guid] : true

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activeQueueOrders
    return orders.filter(value =>
      `${value.customer} #${value.ticket} ${value.ticket} ${value.platformOrderKey} ${value.shortOrderKey} ${
        value.assignedDriverHint || ''
      } ${label(value.platform)}`
        .toLowerCase()
        .includes(q)
    )
  }, [orders, activeQueueOrders, search])

  async function login(event: React.FormEvent) {
    event.preventDefault()
    void ensureFullscreen()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/delivery-armor/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, pin })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || t('blindaje_delivery.error_invalid_pin'))
      const now = Date.now()
      const expiresAt = now + PIN_INACTIVITY_TIMEOUT_MS
      const sessionToken = String(data.sessionToken || `${storeId}-${now}`)
      const next: Packer = {
        pin,
        name: data.employee.fullName,
        title: data.employee.jobTitle,
        id: data.employee.id,
        storeId,
        expiresAt,
        sessionToken
      }
      lastActivityAtRef.current = now
      sessionExpiresAtRef.current = expiresAt
      lastStorageSyncAtRef.current = now
      packerRef.current = next
      setPacker(next)
      setRemainingMs(PIN_INACTIVITY_TIMEOUT_MS)
      sessionStorage.setItem('blindaje_packer_pin', pin)
      sessionStorage.setItem('blindaje_packer_name', next.name)
      sessionStorage.setItem('blindaje_packer_title', next.title)
      sessionStorage.setItem('blindaje_packer_user_id', String(next.id))
      sessionStorage.setItem('blindaje_packer_store', String(storeId))
      sessionStorage.setItem('blindaje_packer_last_activity_at', String(now))
      sessionStorage.setItem('blindaje_packer_expires_at', String(expiresAt))
      sessionStorage.setItem('blindaje_packer_session_token', sessionToken)

      // Notificar instantáneamente a cualquier otra pestaña o tableta abierta en esta misma tienda para cerrar su sesión
      try {
        localStorage.setItem(
          `blindaje_active_session_${storeId}`,
          JSON.stringify({
            storeId,
            sessionToken,
            employeeName: next.name,
            ts: now
          })
        )
      } catch {}
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('blindaje_delivery_session')
          bc.postMessage({
            type: 'SESSION_OPENED',
            storeId,
            sessionToken,
            employeeName: next.name
          })
          bc.close()
        }
      } catch {}
      if (supabase) {
        try {
          const ch = supabase.channel(`blindaje-delivery-session-${storeId}`)
          ch.subscribe(status => {
            if (status === 'SUBSCRIBED') {
              void ch
                .send({
                  type: 'broadcast',
                  event: 'session_opened',
                  payload: {
                    storeId,
                    sessionToken,
                    employeeName: next.name
                  }
                })
                .finally(() => {
                  setTimeout(() => {
                    supabase.removeChannel(ch)
                  }, 1500)
                })
            }
          })
        } catch {}
      }

      setPin('')
      void ensureFullscreen()
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  function handleKeypadDigit(digit: string) {
    void ensureFullscreen()
    setError(null)
    setPin(prev => (prev.length < 4 ? `${prev}${digit}` : prev))
  }

  function handleKeypadBackspace() {
    void ensureFullscreen()
    setError(null)
    setPin(prev => prev.slice(0, -1))
  }

  async function savePackingRecord(targetOrder: Order) {
    if (!packer) return
    const targetCollisions = collisionsByGuid.get(targetOrder.guid) || []
    const currentBags = bags[targetOrder.guid] || targetOrder.audit?.bags || 1
    const currentReasons = [
      targetOrder.hasDrinks ? 'con bebidas' : '',
      targetOrder.itemCount >= 8 ? '8+ artículos' : '',
      currentBags > 1 ? 'múltiples bolsas' : '',
      targetCollisions.length > 0
        ? `nombre repetido/parecido (${targetCollisions.map(c => `${c.order.customer} #${c.order.ticket}`).join(', ')})`
        : ''
    ].filter(Boolean)
    const isHighRisk = currentReasons.length > 0

    const response = await fetch('/api/delivery-armor/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: storeId,
        order_guid: targetOrder.guid,
        ticket_number: targetOrder.ticket,
        platform: targetOrder.platform,
        dining_option_name: targetOrder.diningOption,
        customer_name: targetOrder.customer,
        opened_at: targetOrder.openedAt,
        items_ordered: targetOrder.items.map(i => ({
          id: i.id,
          displayName: i.name,
          quantity: i.quantity,
          price: i.price,
          modifiers: i.modifiers,
          isHighRiskDrink: i.isDrink
        })),
        matchedItems: ['CONTROL:foodComplete', 'CONTROL:drinksComplete', 'CONTROL:bagCountCorrect', 'CONTROL:bagSealed'],
        matchCompleted: true,
        packer_pin: packer.pin,
        session_token: packer.sessionToken,
        quick_checks: {
          ...COMPLETED_CHECKS,
          platformOrderKey: targetOrder.platformOrderKey,
          shortOrderKey: targetOrder.shortOrderKey,
          kdsStatus: targetOrder.kdsStatus,
          kdsSentAt: targetOrder.kdsSentAt,
          kdsReadyAt: targetOrder.kdsReadyAt,
          kdsPrepSeconds: targetOrder.kdsPrepSeconds
        },
        expected_bag_count: currentBags,
        confirmed_bag_count: currentBags,
        risk_level: isHighRisk ? 'HIGH' : 'NORMAL',
        risk_reasons: currentReasons,
        evidence_policy: 'NONE'
      })
    })
    const data = await response.json()
    if (!response.ok || !data.ok) {
      const errMsg = String(data.error || '')
      if (errMsg.startsWith('SESSION_REPLACED:')) {
        handleSessionReplacedError(errMsg.replace('SESSION_REPLACED:', ''))
        return
      }
      if (errMsg === 'SESSION_EXPIRED') {
        logout(t('blindaje_delivery.pin_session_expired'), true)
        return
      }
      throw new Error(errMsg || t('blindaje_delivery.error_save_packing'))
    }
  }

  async function markReady() {
    if (!order || !packer) return
    if (!recordCashierActivity()) return
    void ensureFullscreen()
    const targetGuid = order.guid
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await savePackingRecord(order)
      if (!packerRef.current) return
      setEditingPacking(prev => ({ ...prev, [targetGuid]: false }))
      setDriverPresentAck(prev => ({ ...prev, [targetGuid]: false }))
      const cooldownUntil = Date.now() + 2500
      setReleaseCooldownUntil(prev => ({ ...prev, [targetGuid]: cooldownUntil }))
      window.setTimeout(() => {
        setReleaseCooldownUntil(prev => {
          if (!prev[targetGuid] || prev[targetGuid] > Date.now()) return prev
          const next = { ...prev }
          delete next[targetGuid]
          return next
        })
      }, 2600)
      setSuccess(`${t('blindaje_delivery.success_packed')}: ${order.customer} (Check #${order.ticket})`)
      await fetchOrders()
      // Regresar a "Selecciona una orden" para que toda selección sea estrictamente manual y evitar equivocaciones
      setSelected(null)
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function undoPacking() {
    if (!order || !packer) return
    if (!recordCashierActivity()) return
    void ensureFullscreen()
    const targetGuid = order.guid
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/delivery-armor/audit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UNDO_PACKING',
          order_guid: targetGuid,
          store_id: storeId,
          pin: packer.pin,
          session_token: packer.sessionToken
        })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        const errMsg = String(data.error || '')
        if (errMsg.startsWith('SESSION_REPLACED:')) {
          handleSessionReplacedError(errMsg.replace('SESSION_REPLACED:', ''))
          return
        }
        if (errMsg === 'SESSION_EXPIRED') {
          logout(t('blindaje_delivery.pin_session_expired'), true)
          return
        }
        throw new Error(errMsg || t('blindaje_delivery.error_reopen_order'))
      }
      setEditingPacking(prev => ({ ...prev, [targetGuid]: false }))
      setDriverPresentAck(prev => ({ ...prev, [targetGuid]: false }))
      setSuccess(`${t('blindaje_delivery.undo_packing_success')}: ${order.customer} (Check #${order.ticket})`)
      await fetchOrders()
      setSelected(targetGuid)
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function reopenOrder() {
    if (!order || !packer) return
    if (!recordCashierActivity()) return
    void ensureFullscreen()
    const targetGuid = order.guid
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/delivery-armor/audit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'REOPEN_DELIVERED',
          order_guid: targetGuid,
          store_id: storeId,
          pin: packer.pin,
          session_token: packer.sessionToken
        })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        const errMsg = String(data.error || '')
        if (errMsg.startsWith('SESSION_REPLACED:')) {
          handleSessionReplacedError(errMsg.replace('SESSION_REPLACED:', ''))
          return
        }
        if (errMsg === 'SESSION_EXPIRED') {
          logout(t('blindaje_delivery.pin_session_expired'), true)
          return
        }
        throw new Error(errMsg || t('blindaje_delivery.error_reopen_order'))
      }
      setDriverPresentAck(prev => ({ ...prev, [targetGuid]: false }))
      setSuccess(`${t('blindaje_delivery.reopen_success')}: ${order.customer} (Check #${order.ticket})`)
      await fetchOrders()
      setSelected(targetGuid)
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    if (!order || !packer) return
    if (!recordCashierActivity()) return
    void ensureFullscreen()
    if ((releaseCooldownUntil[order.guid] || 0) > Date.now()) {
      return
    }
    const isPackedForRelease =
      order.audit?.status === 'ready' || (order.audit?.status === 'unclaimed' && order.audit?.bags != null)
    if (!isPackedForRelease) {
      setError(t('blindaje_delivery.error_confirm_before_release'))
      return
    }
    if (!driverPresentAck[order.guid]) {
      setError(t('blindaje_delivery.btn_confirm_driver_present_first'))
      return
    }
    if (currentCollisions.length > 0 && !collisionAck[order.guid]) {
      setError(t('blindaje_delivery.error_collision_ack_required'))
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/delivery-armor/audit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_guid: order.guid,
          store_id: storeId,
          handoff_pin: packer.pin,
          session_token: packer.sessionToken,
          courier_name: order.assignedDriverHint || t('blindaje_delivery.verified_driver'),
          courier_verified: true,
          verification_method: 'PLATFORM_ORDER_ID',
          courier_order_reference: `${order.customer} (#${order.ticket} • ${order.platformOrderKey})`,
          live_pickup_confirmed: true
        })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        const errMsg = String(data.error || '')
        if (errMsg.startsWith('SESSION_REPLACED:')) {
          handleSessionReplacedError(errMsg.replace('SESSION_REPLACED:', ''))
          return
        }
        if (errMsg === 'SESSION_EXPIRED') {
          logout(t('blindaje_delivery.pin_session_expired'), true)
          return
        }
        throw new Error(errMsg || t('blindaje_delivery.error_release_order'))
      }
      setSuccess(
        `${t('blindaje_delivery.order_of')} ${order.customer} (#${order.ticket}) ${t('blindaje_delivery.success_released')} ${data.audit.handed_by_ronos_name}.`
      )
      setSelected(null)
      await fetchOrders()
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  // PANTALLA DE PIN EN FULLSCREEN (AL INICIAR Y AL CERRAR/EXPIRAR SESIÓN)
  if (!packer) {
    return (
      <main
        ref={rootRef}
        onClick={() => void ensureFullscreen()}
        className="fixed inset-0 z-[100] w-screen h-screen overflow-y-auto bg-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 select-none"
      >
        <form
          onSubmit={login}
          className="w-full max-w-3xl bg-white border border-slate-200 shadow-2xl rounded-[2.5rem] p-6 sm:p-10"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider text-slate-400">
              {t('blindaje_delivery.tablet_station_header')}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-black"
              >
                <Globe className="w-4 h-4 text-red-600" />
                <span>{language === 'es' ? 'ES | EN' : 'EN | ES'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMuted(prev => !prev)}
                title={isMuted ? t('blindaje_delivery.voice_unmute_title') : t('blindaje_delivery.voice_mute_title')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs sm:text-sm font-black"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-red-600" /> : <Volume2 className="w-4 h-4 text-emerald-600" />}
                <span>{isMuted ? t('blindaje_delivery.voice_muted') : t('blindaje_delivery.voice_active')}</span>
              </button>
              <button
                type="button"
                onClick={() => void ensureFullscreen()}
                title={t('blindaje_delivery.fullscreen_title')}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs sm:text-sm font-black"
              >
                <Maximize2 className="w-4 h-4" />
                <span>
                  {isFullscreen ? t('blindaje_delivery.fullscreen_active') : t('blindaje_delivery.fullscreen_btn')}
                </span>
              </button>
            </div>
          </div>

          {activeAnnouncement && (
            <div className="mb-4 p-4 rounded-2xl bg-slate-900 text-white text-center text-lg font-black animate-pulse">
              {activeAnnouncement}
            </div>
          )}

          <ShieldCheck className="w-16 h-16 sm:w-20 sm:h-20 text-red-600 mx-auto" />
          <h1 className="text-4xl sm:text-5xl font-black text-center mt-2">{t('blindaje_delivery.station_title')}</h1>
          <p className="text-center text-base sm:text-lg text-slate-500 font-semibold mt-1">
            {t('blindaje_delivery.pin_subtitle')}
          </p>

          <select
            value={storeId}
            onChange={event => {
              void ensureFullscreen()
              setStoreId(Number(event.target.value))
            }}
            className="w-full h-16 rounded-2xl border-2 border-slate-200 px-5 text-xl sm:text-2xl font-black mt-6 bg-slate-50"
          >
            {STORES.map(store => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>

          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={event => {
              void ensureFullscreen()
              setPin(event.target.value.replace(/\D/g, ''))
            }}
            placeholder="• • • •"
            className="w-full h-20 sm:h-24 rounded-2xl border-2 border-slate-300 mt-4 text-center text-5xl sm:text-6xl font-black tracking-[.55em] bg-white"
          />

          {/* TECLADO NUMÉRICO TÁCTIL DE GRAN TAMAÑO PARA TABLETA EN FULLSCREEN */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
              <button
                key={digit}
                type="button"
                onClick={() => handleKeypadDigit(digit)}
                className="h-16 sm:h-20 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-3xl sm:text-4xl font-black text-slate-900 transition-colors"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                void ensureFullscreen()
                setPin('')
              }}
              className="h-16 sm:h-20 rounded-2xl bg-slate-200 hover:bg-slate-300 text-base sm:text-lg font-black text-slate-700"
            >
              {t('blindaje_delivery.keypad_clear')}
            </button>
            <button
              key="0"
              type="button"
              onClick={() => handleKeypadDigit('0')}
              className="h-16 sm:h-20 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-3xl sm:text-4xl font-black text-slate-900 transition-colors"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleKeypadBackspace}
              className="h-16 sm:h-20 rounded-2xl bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-700"
              title={t('blindaje_delivery.keypad_delete')}
            >
              <Delete className="w-8 h-8" />
            </button>
          </div>

          {error && <p className="text-red-600 text-lg font-black mt-4 text-center">{error}</p>}

          <button
            type="submit"
            disabled={busy || pin.length !== 4}
            className="w-full h-20 rounded-2xl bg-red-600 text-white text-2xl sm:text-3xl font-black mt-5 disabled:opacity-30 shadow-lg"
          >
            {busy ? t('blindaje_delivery.pin_validating') : t('blindaje_delivery.pin_enter')}
          </button>
        </form>
      </main>
    )
  }

  // ESTACIÓN DE EMPAQUE Y ENTREGA EN FULLSCREEN A ANCHO COMPLETO DE TABLETA
  return (
    <main
      ref={rootRef}
      onClick={event => {
        void ensureFullscreen()
        const target = event.target as HTMLElement | null
        if (!target) return
        if (
          target.closest(
            '[data-order-detail="true"], [data-order-card="true"], button, input, select, textarea, a, label'
          )
        ) {
          return
        }
        if (selected) {
          setSelected(null)
          setError(null)
        }
      }}
      className="fixed inset-0 z-[100] w-screen h-screen overflow-y-auto bg-slate-100 text-slate-950 pb-8"
    >
      <header className="sticky top-0 z-30 bg-white border-b px-5 py-3.5 shadow-sm">
        <div className="w-full flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-10 h-10 text-red-600 flex-shrink-0" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-black leading-none">{t('blindaje_delivery.station_title')}</h1>
              <p className="text-sm sm:text-base font-bold text-slate-500 mt-0.5">
                {STORES.find(store => store.id === storeId)?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black"
            >
              <Globe className="w-5 h-5 text-red-600" />
              <span>{language === 'es' ? 'ES | EN' : 'EN | ES'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsMuted(prev => !prev)}
              title={isMuted ? t('blindaje_delivery.voice_unmute_title') : t('blindaje_delivery.voice_mute_title')}
              className={`p-3 rounded-xl ${isMuted ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-emerald-700'}`}
            >
              {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <button
              type="button"
              onClick={() => void ensureFullscreen()}
              title={t('blindaje_delivery.fullscreen_title')}
              className="p-3 rounded-xl bg-slate-100 text-slate-700"
            >
              <Maximize2 className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={fetchOrders}
              title={t('blindaje_delivery.refresh_btn')}
              className="p-3 rounded-xl bg-slate-100"
            >
              <RefreshCw className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => logout()}
              title={t('blindaje_delivery.logout_pin_title')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm sm:text-base font-black transition-colors"
            >
              <User className="w-5 h-5 text-emerald-400" />
              <span>{packer.name}</span>
              <small className="text-slate-300 font-mono text-xs sm:text-sm">
                ({formatRemainingMs(remainingMs)})
              </small>
              <span className="ml-1 px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-black flex items-center gap-1">
                <LogOut className="w-3.5 h-3.5" />
                {t('blindaje_delivery.switch_cashier_btn')}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* DISEÑO ADAPTATIVO FULLSCREEN: VERTICAL (APILADO) Y HORIZONTAL (ÓRDENES A LA IZQUIERDA + DETALLE A LA DERECHA) */}
      <div className="w-full px-4 sm:px-6 py-4 space-y-4">
        {activeAnnouncement && (
          <div className="p-4 rounded-2xl bg-slate-900 text-white text-lg sm:text-xl font-black flex items-center justify-between gap-3 shadow-md">
            <span>{activeAnnouncement}</span>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-lg font-bold flex gap-3 items-center">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-lg font-bold flex gap-3 items-center">
            <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="space-y-4 landscape:space-y-0 lg:space-y-0 landscape:grid landscape:grid-cols-[370px_1fr] lg:grid lg:grid-cols-[410px_1fr] landscape:gap-4 lg:gap-5 landscape:items-start lg:items-start">
          {/* COLUMNA IZQUIERDA EN HORIZONTAL / SUPERIOR EN VERTICAL: TODAS LAS ÓRDENES */}
          <section className="bg-white border rounded-3xl p-4 sm:p-5 shadow-sm space-y-3.5 landscape:sticky landscape:top-[76px] lg:sticky lg:top-[76px]">
            <div className="relative">
              <Search className="w-6 h-6 absolute left-4 top-4 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('blindaje_delivery.tablet_search_placeholder')}
                className="w-full h-14 rounded-2xl bg-slate-100 pl-12 pr-4 text-base sm:text-lg font-black placeholder:normal-case"
              />
            </div>

            {/* LEYENDA Y CONTADORES POR ESTATUS CON COLORES */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs font-black">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-100 text-amber-950 border border-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {t('blindaje_delivery.stage_prep')}:{' '}
                  {activeQueueOrders.filter(o => getOrderStageInfo(o, t).stage === 'PREPARACION').length}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-100 text-blue-900 border border-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  {t('blindaje_delivery.stage_packing')}:{' '}
                  {activeQueueOrders.filter(o => getOrderStageInfo(o, t).stage === 'EMPACANDO').length}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  {t('blindaje_delivery.stage_ready')}:{' '}
                  {activeQueueOrders.filter(o => getOrderStageInfo(o, t).stage === 'LISTA').length}
                </span>
                {orders.some(o => getOrderStageInfo(o, t).stage === 'NO_RECOGIDA') && (
                  <button
                    type="button"
                    onClick={() => setShowHistory(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-orange-100 text-orange-950 border border-orange-400 hover:bg-orange-200 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full bg-orange-600" />
                    {t('blindaje_delivery.stage_unclaimed')}:{' '}
                    {orders.filter(o => getOrderStageInfo(o, t).stage === 'NO_RECOGIDA').length}
                  </button>
                )}
              </div>

              {orders.length > activeQueueOrders.length || showHistory ? (
                <button
                  type="button"
                  onClick={() => setShowHistory(prev => !prev)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-black transition-colors ${
                    showHistory
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {showHistory
                    ? t('blindaje_delivery.hide_past_orders')
                    : `${t('blindaje_delivery.show_past_orders')} (${Math.max(0, orders.length - activeQueueOrders.length)})`}
                </button>
              ) : null}
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1 landscape:flex-col landscape:overflow-x-hidden landscape:overflow-y-auto landscape:max-h-[calc(100vh-250px)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:max-h-[calc(100vh-250px)]">
              {visible.map(value => {
                const stageInfo = getOrderStageInfo(value, t)
                const isSelected = selected === value.guid
                const cardCollisions = collisionsByGuid.get(value.guid) || []
                const hasCollision = cardCollisions.length > 0
                return (
                  <button
                    key={value.guid}
                    type="button"
                    data-order-card="true"
                    onClick={() => {
                      void ensureFullscreen()
                      setSelected(prev => (prev === value.guid ? null : value.guid))
                      setError(null)
                      setSuccess(null)
                    }}
                    className={`min-w-[245px] sm:min-w-[275px] landscape:min-w-0 landscape:w-full lg:min-w-0 lg:w-full p-4 rounded-2xl border-2 text-left flex-shrink-0 transition-all ${
                      isSelected ? stageInfo.cardSelectedClass : stageInfo.cardClass
                    } ${hasCollision ? 'ring-4 ring-red-600/80 border-red-600' : ''}`}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-700">{label(value.platform)}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-black px-2.5 py-1 rounded-lg ${stageInfo.badgeClass}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${stageInfo.dotClass}`} />
                        {stageInfo.label}
                      </span>
                    </div>
                    <strong className="block text-2xl font-black mt-1.5 truncate text-slate-950">
                      {value.customer}
                    </strong>
                    <small className="text-slate-700 text-sm font-bold block mt-1 truncate">
                      #{value.ticket} • {t('blindaje_delivery.key_label')}: {value.platformOrderKey}
                      {value.hasDrinks ? ` • ${t('blindaje_delivery.with_drinks_badge')}` : ''}
                    </small>
                    {value.audit?.packedBy && value.audit?.status !== 'released' && (
                      <small className="text-emerald-800 text-xs font-black block mt-1 truncate">
                        ✓ {t('blindaje_delivery.packed_by_staff')} {value.audit.packedBy} • {value.audit.bags || 1}{' '}
                        {(value.audit.bags || 1) === 1
                          ? t('blindaje_delivery.bag_singular')
                          : t('blindaje_delivery.bag_plural')}
                      </small>
                    )}
                    {hasCollision && (
                      <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-black flex items-center gap-1.5 animate-pulse">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">
                          {t('blindaje_delivery.card_collision_warning')} (
                          {cardCollisions.map(c => `${c.order.customer} #${c.order.ticket}`).join(', ')})
                        </span>
                      </div>
                    )}
                  </button>
                )
              })}
              {!loading && visible.length === 0 && (
                <p className="text-center text-slate-500 py-4 text-base font-semibold w-full">
                  {t('blindaje_delivery.no_active_orders')}
                </p>
              )}
            </div>
          </section>

          {/* COLUMNA DERECHA EN HORIZONTAL / INFERIOR EN VERTICAL: PANEL DE ACCIÓN DE LA ORDEN */}
          <div className="min-w-0">
            {!order ? (
              <div className="h-96 bg-white rounded-3xl border grid place-items-center text-center p-8">
                <div>
                  <ShoppingBag className="w-20 h-20 mx-auto text-slate-300" />
                  <h2 className="text-3xl font-black mt-3">{t('blindaje_delivery.select_order_prompt')}</h2>
                </div>
              </div>
            ) : (
              <div data-order-detail="true" className="space-y-4">
                {/* ALERTA DE ALTO ÉNFASIS SI HAY COLISIÓN DE NOMBRE DUPLICADO O MUY PARECIDO DESDE KDS */}
                {currentCollisions.length > 0 && (
                  <section className="rounded-3xl border-4 border-red-600 bg-red-50 overflow-hidden shadow-lg">
                    <div className="bg-red-600 text-white px-5 py-4 flex items-center gap-3">
                      <AlertTriangle className="w-9 h-9 flex-shrink-0 animate-bounce" />
                      <div>
                        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-tight">
                          {t('blindaje_delivery.collision_banner_title')}
                        </h2>
                        <p className="text-sm sm:text-base font-bold text-red-100 mt-0.5">
                          {t('blindaje_delivery.collision_banner_desc')}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-white border-2 border-slate-900">
                        <span className="inline-block text-xs font-black uppercase px-2.5 py-0.5 rounded-md bg-slate-900 text-white">
                          {t('blindaje_delivery.this_selected_order')}
                        </span>
                        <p className="text-2xl sm:text-3xl font-black text-slate-950 mt-1.5">{order.customer}</p>
                        <p className="text-base font-extrabold text-slate-700 mt-1">
                          Check #{order.ticket} • {label(order.platform)} • {t('blindaje_delivery.key_label')}:{' '}
                          {order.platformOrderKey}
                        </p>
                      </div>

                      {currentCollisions.map(match => {
                        const otherStage = getOrderStageInfo(match.order, t)
                        return (
                          <div key={match.order.guid} className="p-4 rounded-2xl bg-red-100/90 border-2 border-red-500">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-block text-xs font-black uppercase px-2.5 py-0.5 rounded-md bg-red-700 text-white">
                                {t('blindaje_delivery.do_not_confuse_with')} ({match.reasonLabel})
                              </span>
                              <span className={`text-xs font-black px-2 py-0.5 rounded-md ${otherStage.badgeClass}`}>
                                {otherStage.label}
                              </span>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-red-950 mt-1.5">{match.order.customer}</p>
                            <p className="text-base font-extrabold text-red-900 mt-1">
                              Check #{match.order.ticket} • {label(match.order.platform)} •{' '}
                              {t('blindaje_delivery.key_label')}: {match.order.platformOrderKey}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )}

                {/* 2. CABEZAL CON NOMBRE + APELLIDO/INICIAL, ESTATUS POR COLOR Y TIEMPO KDS (SIN CONTENIDO DEL TICKET) */}
                <section className="bg-white border rounded-3xl p-6 sm:p-7 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xl sm:text-2xl font-black text-red-600">{label(order.platform)}</p>
                      {(() => {
                        const currentStage = getOrderStageInfo(order, t)
                        return (
                          <span
                            className={`inline-flex items-center gap-2 text-sm sm:text-base font-black px-3.5 py-1.5 rounded-xl ${currentStage.badgeClass}`}
                          >
                            <span className={`w-2.5 h-2.5 rounded-full ${currentStage.dotClass}`} />
                            {currentStage.label}
                          </span>
                        )
                      })()}
                      {order.assignedDriverHint && (
                        <span className="inline-flex items-center gap-1.5 text-sm sm:text-base font-black px-3.5 py-1.5 rounded-xl bg-slate-100 text-slate-800 border border-slate-300">
                          <Truck className="w-4 h-4 text-slate-600" />
                          {t('blindaje_delivery.assigned_driver_label')}: {order.assignedDriverHint}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 text-sm sm:text-base font-bold text-slate-700 bg-slate-100 px-4 py-1.5 rounded-xl">
                        <Clock className="w-4 h-4" />
                        {order.kdsStatus === 'IN_KITCHEN'
                          ? t('blindaje_delivery.in_kds_kitchen')
                          : `${t('blindaje_delivery.kds_prep_time')}: ${formatDuration(order.kdsPrepSeconds)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => enqueueOrderAnnouncement(order)}
                        title={t('blindaje_delivery.repeat_voice_title')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>
                          {t('blindaje_delivery.announce_btn')} #{order.ticket}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
                    <div>
                      <span className="text-sm font-black uppercase tracking-wider text-slate-400 block">
                        {t('blindaje_delivery.customer_full_name_label')}
                      </span>
                      <h2 className="text-5xl sm:text-6xl font-black tracking-tight mt-0.5 text-slate-950">
                        {order.customer}
                      </h2>
                    </div>
                    <div className="text-right">
                      <span className="text-3xl sm:text-4xl font-black font-mono text-slate-900 block">
                        Check #{order.ticket}
                      </span>
                      <span className="text-lg sm:text-xl text-slate-600 font-black font-mono block mt-0.5">
                        {t('blindaje_delivery.key_label')}: {order.platformOrderKey}
                      </span>
                    </div>
                  </div>

                  {order.isVoided && (
                    <div className="mt-4 p-4 rounded-2xl bg-red-600 text-white border-2 border-red-800 space-y-2 animate-pulse">
                      <strong className="block text-lg sm:text-xl font-black">
                        {order.audit?.status === 'ready'
                          ? t('blindaje_delivery.voided_packed_banner_title')
                          : t('blindaje_delivery.order_voided_alert')}
                      </strong>
                      {order.audit?.status === 'ready' && (
                        <>
                          <p className="text-sm sm:text-base font-bold text-red-100">
                            {t('blindaje_delivery.voided_packed_banner_desc')}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setDismissedVoided(prev => ({ ...prev, [order.guid]: true }))
                            }
                            className="px-4 py-2 rounded-xl bg-white text-red-700 text-sm font-black"
                          >
                            {t('blindaje_delivery.voided_ack_remove_bag_btn')}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {getOrderStageInfo(order, t).stage === 'NO_RECOGIDA' && (
                    <div className="mt-4 p-4 rounded-2xl bg-orange-50 border-2 border-orange-500 text-orange-950 text-base sm:text-lg font-black">
                      {t('blindaje_delivery.unclaimed_2h_alert')}
                    </div>
                  )}

                  {order.hasDrinks && (
                    <div className="mt-4 inline-block px-4 py-2 rounded-xl bg-slate-100 border-2 border-slate-300 text-slate-900 text-base font-black">
                      {t('blindaje_delivery.with_drinks_badge')}
                    </div>
                  )}
                </section>

                {/* 3. CONFIRMAR ORDEN COMPLETA Y SELLADA + BLINDAR LA ENTREGA */}
                {(() => {
                  const isOrderPacked =
                    order.audit?.status === 'ready' ||
                    (order.audit?.status === 'unclaimed' && order.audit?.bags != null)
                  const hasBagCountChanged =
                    isOrderPacked && order.audit?.bags != null && bagCount !== order.audit.bags
                  const isEditingStep1 = !!editingPacking[order.guid] || hasBagCountChanged
                  const isInKitchenBlocked =
                    order.kdsStatus === 'IN_KITCHEN' && !isOrderPacked && !allowEarlyPack[order.guid]
                  const isReleaseInCooldown = (releaseCooldownUntil[order.guid] || 0) > Date.now()
                  const isDriverPresentConfirmed = !!driverPresentAck[order.guid]
                  const cashierShortName = packer.name.split(' ')[0]

                  return (
                    <section className="bg-white border rounded-3xl p-6 sm:p-7 shadow-sm space-y-6">
                      {/* PASO 1: CONFIRMAR ORDEN COMPLETA Y SELLADA (OBLIGATORIO) */}
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <h3 className="text-2xl font-black">{t('blindaje_delivery.step1_title')}</h3>
                            <p className="text-base text-slate-500 font-medium">{t('blindaje_delivery.step1_desc')}</p>
                          </div>

                          <div className="flex items-center gap-3">
                            <strong className="text-lg font-black">{t('blindaje_delivery.bags_label')}</strong>
                            <button
                              type="button"
                              disabled={order.audit?.status === 'released' || order.isVoided}
                              onClick={() =>
                                setBags(previous => ({ ...previous, [order.guid]: Math.max(1, bagCount - 1) }))
                              }
                              className="w-14 h-14 rounded-2xl bg-slate-200 text-2xl font-black disabled:opacity-30"
                            >
                              −
                            </button>
                            <span className="text-3xl font-black w-10 text-center">{bagCount}</span>
                            <button
                              type="button"
                              disabled={order.audit?.status === 'released' || order.isVoided}
                              onClick={() =>
                                setBags(previous => ({ ...previous, [order.guid]: Math.min(20, bagCount + 1) }))
                              }
                              className="w-14 h-14 rounded-2xl bg-slate-950 text-white text-2xl font-black disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* CANDADO PREVENTIVO SI LA ORDEN AÚN ESTÁ EN PREPARACIÓN EN EL KDS DE COCINA */}
                        {order.kdsStatus === 'IN_KITCHEN' && !isOrderPacked && order.audit?.status !== 'released' && (
                          <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <strong className="block text-base sm:text-lg font-black">
                                {t('blindaje_delivery.in_kitchen_pack_warning_title')}
                              </strong>
                              <p className="text-sm font-bold text-amber-900">
                                {t('blindaje_delivery.in_kitchen_pack_warning_desc')}
                              </p>
                            </div>
                            {!allowEarlyPack[order.guid] && (
                              <button
                                type="button"
                                onClick={() => setAllowEarlyPack(prev => ({ ...prev, [order.guid]: true }))}
                                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-black whitespace-nowrap"
                              >
                                {t('blindaje_delivery.in_kitchen_allow_pack_btn')}
                              </button>
                            )}
                          </div>
                        )}

                        {order.audit?.status !== 'released' && !order.isVoided && (!isOrderPacked || isEditingStep1) && (
                          <button
                            type="button"
                            onClick={markReady}
                            disabled={busy || isInKitchenBlocked}
                            className="w-full h-16 sm:h-20 rounded-2xl bg-slate-950 text-white text-xl sm:text-2xl font-black disabled:opacity-30"
                          >
                            {isOrderPacked
                              ? `${t('blindaje_delivery.update_bags_and_reconfirm_btn')} (${cashierShortName})`
                              : `${t('blindaje_delivery.confirm_complete_sealed_btn')} (${cashierShortName})`}
                          </button>
                        )}

                        {isOrderPacked && (
                          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <strong className="block text-lg font-black">
                                {t('blindaje_delivery.order_complete_sealed_done')} ({order.customer})
                              </strong>
                              {order.audit?.packedBy && (
                                <span className="block text-sm font-bold text-emerald-700 mt-0.5">
                                  {t('blindaje_delivery.packed_by_staff')} {order.audit.packedBy}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-lg font-black px-3 py-1 rounded-xl bg-emerald-100 text-emerald-950">
                                {order.audit?.bags || bagCount}{' '}
                                {(order.audit?.bags || bagCount) === 1
                                  ? t('blindaje_delivery.bag_singular')
                                  : t('blindaje_delivery.bag_plural')}
                              </span>
                              {!isEditingStep1 && !order.isVoided && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setEditingPacking(prev => ({ ...prev, [order.guid]: true }))}
                                    className="px-3.5 py-2 rounded-xl bg-white border border-emerald-400 hover:bg-emerald-100 text-emerald-900 text-xs sm:text-sm font-black"
                                  >
                                    {t('blindaje_delivery.reconfirm_packing_btn')}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={undoPacking}
                                    className="px-3.5 py-2 rounded-xl bg-amber-100 border border-amber-400 hover:bg-amber-200 text-amber-950 text-xs sm:text-sm font-black"
                                  >
                                    {t('blindaje_delivery.undo_packing_btn')}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* PASO 2: BLINDAR ENTREGA AL CHOFER */}
                      <div className="pt-6 border-t space-y-4">
                        <div>
                          <h3 className="text-2xl font-black">{t('blindaje_delivery.step2_title')}</h3>
                          <p className="text-base text-slate-600 font-medium mt-0.5">
                            {order.platform === 'DOORDASH'
                              ? t('blindaje_delivery.step2_desc_doordash', {
                                  customer: order.customer,
                                  ticket: order.ticket,
                                  key: order.platformOrderKey
                                })
                              : t('blindaje_delivery.step2_desc_other', {
                                  customer: order.customer,
                                  ticket: order.ticket,
                                  key: order.platformOrderKey
                                })}
                          </p>
                        </div>

                        {/* CASILLA DE VERIFICACIÓN DE CHOFER PRESENTE (EVITA MARCAR ENTREGADA MIENTRAS SOLO SE ARMAN BOLSAS) */}
                        {isOrderPacked && !hasBagCountChanged && order.audit?.status !== 'released' && !order.isVoided && (
                          <button
                            type="button"
                            onClick={() =>
                              setDriverPresentAck(prev => ({ ...prev, [order.guid]: !prev[order.guid] }))
                            }
                            className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-3 ${
                              isDriverPresentConfirmed
                                ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                                : 'bg-slate-50 border-slate-300 text-slate-900 hover:bg-slate-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isDriverPresentConfirmed}
                              readOnly
                              className="w-7 h-7 accent-emerald-600 flex-shrink-0"
                            />
                            <span className="text-base sm:text-lg font-black leading-snug">
                              {t('blindaje_delivery.driver_present_checkbox')} — {order.customer} (Check #{order.ticket})
                            </span>
                          </button>
                        )}

                        {/* DOBLE CANDADO OBLIGATORIO CUANDO EXISTE OTRO CLIENTE CON EL MISMO NOMBRE O MUY PARECIDO */}
                        {currentCollisions.length > 0 && order.audit?.status !== 'released' && (
                          <button
                            type="button"
                            onClick={() =>
                              setCollisionAck(prev => ({ ...prev, [order.guid]: !prev[order.guid] }))
                            }
                            className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-start gap-3 ${
                              isCollisionConfirmed
                                ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                                : 'bg-red-50 border-red-600 text-red-950 animate-pulse'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isCollisionConfirmed}
                              readOnly
                              className="w-7 h-7 mt-0.5 accent-emerald-600 flex-shrink-0"
                            />
                            <div className="text-base sm:text-lg font-black leading-snug">
                              {t('blindaje_delivery.collision_checkbox_prefix')} &ldquo;{order.customer}&rdquo; (CHECK #{order.ticket} •{' '}
                              {order.platformOrderKey}) {t('blindaje_delivery.collision_checkbox_middle')}{' '}
                              {currentCollisions.map(c => `"${c.order.customer}" (CHECK #${c.order.ticket})`).join(', ')}
                            </div>
                          </button>
                        )}

                        {order.audit?.status === 'released' ? (
                          <div className="p-5 rounded-2xl bg-slate-100 border border-slate-300 flex flex-wrap items-center justify-between gap-4">
                            <div>
                              <strong className="block text-xl font-black text-slate-900">
                                {t('blindaje_delivery.delivered_status_prefix')}: {order.customer} (Check #{order.ticket})
                              </strong>
                              <p className="text-base text-slate-600 font-semibold mt-1">
                                {order.audit.packedBy ? `${t('blindaje_delivery.packed_by_staff')} ${order.audit.packedBy} • ` : ''}
                                {t('blindaje_delivery.by_staff')} {order.audit.handedBy} •{' '}
                                {order.audit.driver || t('blindaje_delivery.verified_driver')}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={reopenOrder}
                              className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-black disabled:opacity-40"
                            >
                              {t('blindaje_delivery.reopen_delivered_btn')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={release}
                            disabled={
                              busy ||
                              order.isVoided ||
                              !isOrderPacked ||
                              hasBagCountChanged ||
                              isReleaseInCooldown ||
                              !isDriverPresentConfirmed ||
                              !isCollisionConfirmed
                            }
                            className="w-full h-16 sm:h-20 rounded-2xl bg-red-600 text-white text-xl sm:text-2xl font-black disabled:bg-slate-300 disabled:text-slate-600 flex items-center justify-center gap-3"
                          >
                            {isOrderPacked &&
                            !hasBagCountChanged &&
                            !isReleaseInCooldown &&
                            isDriverPresentConfirmed &&
                            isCollisionConfirmed &&
                            !order.isVoided ? (
                              <Truck className="w-7 h-7" />
                            ) : (
                              <Lock className="w-7 h-7" />
                            )}
                            <span>
                              {busy
                                ? t('blindaje_delivery.btn_processing')
                                : !isOrderPacked || hasBagCountChanged
                                ? t('blindaje_delivery.btn_confirm_step1_first')
                                : isReleaseInCooldown
                                ? t('blindaje_delivery.cooldown_before_release_btn')
                                : !isDriverPresentConfirmed
                                ? t('blindaje_delivery.btn_confirm_driver_present_first')
                                : !isCollisionConfirmed
                                ? t('blindaje_delivery.btn_check_collision_box')
                                : `${t('blindaje_delivery.btn_release_order_prefix')} ${order.customer.toUpperCase()} (#${order.ticket}) (${cashierShortName})`}
                            </span>
                          </button>
                        )}
                      </div>
                    </section>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}


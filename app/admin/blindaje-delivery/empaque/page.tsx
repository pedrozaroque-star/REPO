/**
 * @module BlindajeDeliveryEmpaque
 * @description Estación vertical Fullscreen de Entrega Blindada para validar el empaque y liberar cada bolsa al chofer correcto identificando por Nombre + Apellido/Inicial y blindando contra nombres duplicados o muy parecidos desde KDS.
 * @businessRules
 *   - Siempre en modo Fullscreen (tanto al pedir PIN, al iniciar sesión con PIN, durante la operación y al cerrarse/expirar la sesión de PIN).
 *   - Acceso con PIN de 4 dígitos de RONOS con cierre automático de sesión cada 10 minutos.
 *   - Identificación principal por Nombre + Apellido/Inicial del cliente (si existe), acompañado de #Check y Clave de Plataforma.
 *   - Blindaje estricto contra colisión de nombres desde que entran por KDS: alerta de alto énfasis si existen dos órdenes con el mismo nombre exacto, el mismo primer nombre con apellido diferente, o nombres fonética/visualmente muy parecidos.
 *   - Mide automáticamente el tiempo de preparación en cocina desde que llega al KDS hasta que el cocinero borra la orden (READY).
 *   - Cuando el cocinero borra la orden delivery del KDS (pasa de IN_KITCHEN a READY para el estante de empaque), la tableta reproduce automáticamente el aviso de voz ("Order #100, is ready! Please pack. / Orden #100, ¡ya está! Por favor empacar.") reutilizando los audios de órdenes precargados en Supabase Storage.
 *   - Flujo directo sin pasos innecesarios: 1. CONFIRMAR ORDEN COMPLETA Y SELLADA -> 2. Blindar la entrega.
 * @dataFlow Toast -> /api/delivery-armor/orders -> tableta vertical fullscreen + locutor KDS (/api/order-ready/tts + /api/order-ready/announcement-tts) -> /api/delivery-armor/audit -> Supabase.
 * @notes Piloto Slauson (#7) y LA Central (#6).
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Delete,
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

const STORES = [
  { id: 7, name: 'Slauson (#7)' },
  { id: 6, name: 'LA Central (#6)' }
]

const PIN_SESSION_DURATION_MS = 10 * 60 * 1000 // 10 minutos
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

function getOrderStageInfo(order: Order): {
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
      label: 'ENTREGADA',
      badgeClass: 'bg-slate-200 text-slate-700 border border-slate-300',
      dotClass: 'bg-slate-500',
      cardClass: 'border-slate-200 bg-slate-50 text-slate-600',
      cardSelectedClass: 'border-slate-700 bg-slate-100 ring-4 ring-slate-400/30'
    }
  }
  if (isOrderUnclaimedAfter2Hours(order)) {
    return {
      stage: 'NO_RECOGIDA',
      label: 'NO RECOGIDA (+2H)',
      badgeClass: 'bg-orange-600 text-white border border-orange-700',
      dotClass: 'bg-white',
      cardClass: 'border-orange-400 bg-orange-50/70 text-orange-950',
      cardSelectedClass: 'border-orange-600 bg-orange-100 ring-4 ring-orange-500/30'
    }
  }
  if (order.audit?.status === 'ready') {
    return {
      stage: 'LISTA',
      label: 'LISTA',
      badgeClass: 'bg-emerald-600 text-white border border-emerald-700',
      dotClass: 'bg-emerald-200',
      cardClass: 'border-emerald-400 bg-emerald-50/60',
      cardSelectedClass: 'border-emerald-600 bg-emerald-50 ring-4 ring-emerald-500/25'
    }
  }
  if (order.kdsStatus === 'IN_KITCHEN') {
    return {
      stage: 'PREPARACION',
      label: 'PREPARACIÓN',
      badgeClass: 'bg-amber-500 text-slate-950 border border-amber-600',
      dotClass: 'bg-slate-950 animate-pulse',
      cardClass: 'border-amber-400 bg-amber-50/60',
      cardSelectedClass: 'border-amber-600 bg-amber-50 ring-4 ring-amber-500/25'
    }
  }
  return {
    stage: 'EMPACANDO',
    label: 'EMPACANDO',
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

function getCollisionReasonLabel(reason: NameCollisionReason): string {
  if (reason === 'EXACT_NAME') return 'MISMO NOMBRE EXACTO'
  if (reason === 'SAME_FIRST_NAME') return 'MISMO NOMBRE (APELLIDO DIFERENTE)'
  return 'NOMBRE MUY PARECIDO'
}

// Determina si una orden sigue activa en el estante (si cumple 2 horas o más sin ser recogida por ningún chofer, cambia automáticamente a NO RECOGIDA (+2H))
function isOrderCurrentlyActive(order: Order): boolean {
  if (order.audit?.status === 'released' || isOrderUnclaimedAfter2Hours(order)) return false
  const now = Date.now()
  const openedAgeMs = now - new Date(order.openedAt).getTime()
  if (!Number.isFinite(openedAgeMs) || openedAgeMs >= UNCLAIMED_DRIVER_TIMEOUT_MS) return false
  const readyAgeMs = order.kdsReadyAt ? now - new Date(order.kdsReadyAt).getTime() : openedAgeMs

  // 1. Si ya fue empacada y sellada en la tableta (LISTA), mantener en estante hasta cumplir 2 horas (120 min) esperando al chofer; a las 2 horas cambia automáticamente a NO RECOGIDA (+2H)
  if (order.audit?.status === 'ready') {
    return openedAgeMs < UNCLAIMED_DRIVER_TIMEOUT_MS
  }
  // 2. Si el cocinero aún la tiene en pantalla KDS (PREPARACIÓN), mantener hasta 60 min
  if (order.kdsStatus === 'IN_KITCHEN') {
    return openedAgeMs <= 60 * 60 * 1000
  }
  // 3. Si salió del KDS y no se ha empacado (EMPACANDO), ventana activa de 20 minutos en el estante
  return readyAgeMs <= 20 * 60 * 1000
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
  const rootRef = useRef<HTMLElement | null>(null)
  const [storeId, setStoreId] = useState(7)
  const [packer, setPacker] = useState<Packer | null>(null)
  const [remainingMs, setRemainingMs] = useState<number>(PIN_SESSION_DURATION_MS)
  const [pin, setPin] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [bags, setBags] = useState<Record<string, number>>({})
  const [collisionAck, setCollisionAck] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [activeAnnouncement, setActiveAnnouncement] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Referencias del motor de audio y rastreo de KDS
  const audioCtxRef = useRef<AudioContext | null>(null)
  const clipCacheRef = useRef<Map<string, Promise<string | null>>>(new Map())
  const audioQueueRef = useRef<Order[]>([])
  const isPlayingAudioRef = useRef<boolean>(false)
  const prevKdsStatusRef = useRef<Map<string, 'IN_KITCHEN' | 'READY'>>(new Map())
  const announcedGuidsRef = useRef<Set<string>>(new Set())
  const initializedStoreRef = useRef<number | null>(null)

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

  // Campanilla Ding-Dong de dos tonos antes de la voz
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

        const osc1 = ctx.createOscillator()
        const gain1 = ctx.createGain()
        osc1.type = 'sine'
        osc1.frequency.setValueAtTime(587.33, now)
        gain1.gain.setValueAtTime(0.3, now)
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
        osc1.connect(gain1)
        gain1.connect(ctx.destination)
        osc1.start(now)
        osc1.stop(now + 0.55)

        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.type = 'sine'
        osc2.frequency.setValueAtTime(880, now + 0.16)
        gain2.gain.setValueAtTime(0.38, now + 0.16)
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85)
        osc2.connect(gain2)
        gain2.connect(ctx.destination)
        osc2.start(now + 0.16)
        osc2.stop(now + 0.85)

        setTimeout(resolve, 800)
      } catch {
        resolve()
      }
    })
  }, [unlockAudio])

  // Descargar y cachear en memoria un clip de audio (orden precargada o frase complementaria)
  const getCachedAudioUrl = useCallback((cacheKey: string, endpointUrl: string): Promise<string | null> => {
    const existing = clipCacheRef.current.get(cacheKey)
    if (existing) return existing

    const job = (async (): Promise<string | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(endpointUrl, { signal: AbortSignal.timeout(9000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          if (blob.size < 500) throw new Error('Empty audio blob')
          return URL.createObjectURL(blob)
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

  // Precargar los 2 clips de sufijo ("Please pack." y "Por favor empacar.") al montar
  useEffect(() => {
    void getCachedAudioUrl(
      'suffix:en:please-pack',
      '/api/order-ready/announcement-tts?text=Please%20pack.&lang=en&voice=Kore'
    )
    void getCachedAudioUrl(
      'suffix:es:por-favor-empacar',
      '/api/order-ready/announcement-tts?text=Por%20favor%20empacar.&lang=es&voice=Kore'
    )
  }, [getCachedAudioUrl])

  // Reproducir un Blob URL usando Web Audio API (primario) o HTMLAudioElement (respaldo)
  const playClipUrl = useCallback(
    (url: string): Promise<boolean> =>
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
          if (ctx) {
            if (ctx.state === 'suspended') {
              await ctx.resume().catch(() => {})
            }
            const res = await fetch(url)
            if (res.ok) {
              const arrayBuf = await res.arrayBuffer()
              if (arrayBuf.byteLength > 44) {
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
            }
          }
        } catch {
          // Fallback a HTMLAudioElement
        }

        try {
          const audio = new Audio(url)
          audio.onended = () => finish(true)
          audio.onerror = () => finish(false)
          setTimeout(() => {
            if (!done) audio.pause()
            finish(false)
          }, 12000)
          audio.play().catch(() => finish(false))
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
          : `Orden ${numStr} ya está, por favor empacar.`
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

  // Reproducir aviso completo: Ding-Dong + "Order #100, is ready! Please pack." + "Orden #100, ¡ya está! Por favor empacar."
  const speakOrderReadyToPack = useCallback(
    async (targetOrder: Order) => {
      const rawDigits = targetOrder.ticket.replace(/\D/g, '')
      const num = rawDigits && /^\d{1,4}$/.test(rawDigits) ? String(parseInt(rawDigits, 10)) : ''
      const bannerText = `🔊 Order #${targetOrder.ticket} is ready, please pack • ${targetOrder.platformOrderKey}`
      setActiveAnnouncement(bannerText)

      try {
        await playChime()

        if (!num) {
          await speakBrowserFallback(targetOrder.ticket, 'en')
          await speakBrowserFallback(targetOrder.ticket, 'es')
          return
        }

        // Descargar en paralelo el audio pregrabado de la orden (#num) en EN y ES + los sufijos de empaque
        const [orderEnUrl, packEnUrl, orderEsUrl, packEsUrl] = await Promise.all([
          getCachedAudioUrl(`order:en:${num}`, `/api/order-ready/tts?n=${num}&lang=en&voice=Kore`),
          getCachedAudioUrl(
            'suffix:en:please-pack',
            '/api/order-ready/announcement-tts?text=Please%20pack.&lang=en&voice=Kore'
          ),
          getCachedAudioUrl(`order:es:${num}`, `/api/order-ready/tts?n=${num}&lang=es&voice=Kore`),
          getCachedAudioUrl(
            'suffix:es:por-favor-empacar',
            '/api/order-ready/announcement-tts?text=Por%20favor%20empacar.&lang=es&voice=Kore'
          )
        ])

        // 1. Inglés: "Order #100, is ready!" + "Please pack."
        const okEnOrder = orderEnUrl ? await playClipUrl(orderEnUrl) : false
        if (okEnOrder) {
          if (packEnUrl) await playClipUrl(packEnUrl)
        } else {
          await speakBrowserFallback(num, 'en')
        }

        await new Promise(r => setTimeout(r, 180))

        // 2. Español: "Orden #100, ¡ya está!" + "Por favor empacar."
        const okEsOrder = orderEsUrl ? await playClipUrl(orderEsUrl) : false
        if (okEsOrder) {
          if (packEsUrl) await playClipUrl(packEsUrl)
        } else {
          await speakBrowserFallback(num, 'es')
        }
      } finally {
        setTimeout(() => {
          setActiveAnnouncement(current => (current === bannerText ? null : current))
        }, 3500)
      }
    },
    [getCachedAudioUrl, playChime, playClipUrl, speakBrowserFallback]
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

  // Al cerrar sesión o terminar los 10 minutos, regresa a la pantalla de PIN manteniendo Fullscreen
  const logout = useCallback(
    (expiredNotice?: string) => {
      ;[
        'blindaje_packer_pin',
        'blindaje_packer_name',
        'blindaje_packer_title',
        'blindaje_packer_user_id',
        'blindaje_packer_store',
        'blindaje_packer_expires_at'
      ].forEach(key => sessionStorage.removeItem(key))
      setPacker(null)
      setPin('')
      if (expiredNotice) {
        setError(expiredNotice)
      }
      void ensureFullscreen()
    },
    [ensureFullscreen]
  )

  // Restaurar sesión si sigue dentro de los 10 minutos
  useEffect(() => {
    try {
      const savedStore = Number(sessionStorage.getItem('blindaje_packer_store'))
      const savedPin = sessionStorage.getItem('blindaje_packer_pin') || ''
      const name = sessionStorage.getItem('blindaje_packer_name') || ''
      const id = Number(sessionStorage.getItem('blindaje_packer_user_id'))
      const expiresAt = Number(sessionStorage.getItem('blindaje_packer_expires_at'))
      if (
        savedStore === storeId &&
        /^\d{4}$/.test(savedPin) &&
        name &&
        id &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now()
      ) {
        setPacker({
          pin: savedPin,
          name,
          title: sessionStorage.getItem('blindaje_packer_title') || 'Colaborador',
          id,
          storeId,
          expiresAt
        })
        setRemainingMs(expiresAt - Date.now())
      } else {
        logout()
      }
    } catch {
      setPacker(null)
    }
  }, [storeId, logout])

  // Reloj de cierre automático de sesión de PIN cada 10 minutos
  useEffect(() => {
    if (!packer) return
    const checkExpiry = () => {
      const left = packer.expiresAt - Date.now()
      if (left <= 0) {
        logout('La sesión del PIN se cerró automáticamente tras 10 minutos.')
      } else {
        setRemainingMs(left)
      }
    }
    checkExpiry()
    const interval = window.setInterval(checkExpiry, 1000)
    return () => window.clearInterval(interval)
  }, [packer, logout])

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
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar las órdenes.')
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
        if (newlyReadyOrders.length > 0) {
          const currentObj = next.find(o => o.guid === current)
          if (!currentObj || currentObj.audit?.status === 'released' || !isOrderCurrentlyActive(currentObj)) {
            return newlyReadyOrders[0].guid
          }
        }
        const currentObj = current ? next.find(o => o.guid === current) : null
        if (currentObj && isOrderCurrentlyActive(currentObj)) return current
        const firstActive = next.find(o => isOrderCurrentlyActive(o))
        return firstActive?.guid || null
      })
    } catch (caught: any) {
      if (packer) setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [storeId, packer, persistAnnouncedGuid, enqueueOrderAnnouncement])

  // Monitoreo continuo del KDS cada 8 segundos (incluso cuando está en la pantalla de PIN)
  useEffect(() => {
    void fetchOrders()
    const timer = window.setInterval(fetchOrders, KDS_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [fetchOrders])

  const activeQueueOrders = useMemo(
    () => (showHistory ? orders : orders.filter(isOrderCurrentlyActive)),
    [orders, showHistory]
  )

  // Detectar colisiones de nombres (mismo nombre exacto, mismo primer nombre con apellido diferente, o nombre muy parecido)
  // entre todas las órdenes que han entrado al sistema desde KDS en las últimas 2 horas (o que siguen activas)
  const collisionsByGuid = useMemo(() => {
    const map = new Map<string, NameCollisionMatch[]>()
    const now = Date.now()
    const recentKdsPool = orders.filter(o => {
      if (o.isVoided) return false
      if (isOrderCurrentlyActive(o)) return true
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
            reasonLabel: getCollisionReasonLabel(check.reason)
          })
        }
      }
      if (matches.length > 0) {
        map.set(currentOrder.guid, matches)
      }
    }
    return map
  }, [orders])

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
      if (!response.ok || !data.ok) throw new Error(data.error || 'PIN no válido.')
      const expiresAt = Date.now() + PIN_SESSION_DURATION_MS
      const next: Packer = {
        pin,
        name: data.employee.fullName,
        title: data.employee.jobTitle,
        id: data.employee.id,
        storeId,
        expiresAt
      }
      setPacker(next)
      setRemainingMs(PIN_SESSION_DURATION_MS)
      sessionStorage.setItem('blindaje_packer_pin', pin)
      sessionStorage.setItem('blindaje_packer_name', next.name)
      sessionStorage.setItem('blindaje_packer_title', next.title)
      sessionStorage.setItem('blindaje_packer_user_id', String(next.id))
      sessionStorage.setItem('blindaje_packer_store', String(storeId))
      sessionStorage.setItem('blindaje_packer_expires_at', String(expiresAt))
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
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo confirmar la orden completa y sellada.')
  }

  async function markReady() {
    if (!order || !packer) return
    void ensureFullscreen()
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await savePackingRecord(order)
      setSuccess(`Orden completa y sellada: ${order.customer} (Check #${order.ticket})`)
      await fetchOrders()
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    if (!order || !packer) return
    void ensureFullscreen()
    const isPackedForRelease =
      order.audit?.status === 'ready' || (order.audit?.status === 'unclaimed' && order.audit?.bags != null)
    if (!isPackedForRelease) {
      setError('Primero debes confirmar que la orden esté completa y sellada antes de entregarla.')
      return
    }
    if (currentCollisions.length > 0 && !collisionAck[order.guid]) {
      setError(
        `¡ALERTA DE NOMBRE REPETIDO/PARECIDO! Debes tocar la casilla de verificación confirmando que diferenciaste a "${order.customer}" (#${order.ticket}) antes de entregar.`
      )
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
          courier_name: order.assignedDriverHint || 'Chofer verificado',
          courier_verified: true,
          verification_method: order.platform === 'DOORDASH' ? 'DOORDASH_QR' : 'PLATFORM_ORDER_ID',
          courier_order_reference: `${order.customer} (#${order.ticket} • ${order.platformOrderKey})`,
          live_pickup_confirmed: true
        })
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo liberar la bolsa.')
      setSuccess(`Orden de ${order.customer} (#${order.ticket}) entregada por ${data.audit.handed_by_ronos_name}.`)
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
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider text-slate-400">
              Tacos Gavilan • Estación de Tableta
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMuted(prev => !prev)}
                title={isMuted ? 'Activar voz KDS' : 'Silenciar voz KDS'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs sm:text-sm font-black"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-red-600" /> : <Volume2 className="w-4 h-4 text-emerald-600" />}
                <span>{isMuted ? 'MUDO' : 'VOZ KDS ACTIVA'}</span>
              </button>
              <button
                type="button"
                onClick={() => void ensureFullscreen()}
                title="Pantalla Completa"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs sm:text-sm font-black"
              >
                <Maximize2 className="w-4 h-4" />
                <span>{isFullscreen ? 'FULLSCREEN ACTIVO' : 'PANTALLA COMPLETA'}</span>
              </button>
            </div>
          </div>

          {activeAnnouncement && (
            <div className="mb-4 p-4 rounded-2xl bg-slate-900 text-white text-center text-lg font-black animate-pulse">
              {activeAnnouncement}
            </div>
          )}

          <ShieldCheck className="w-16 h-16 sm:w-20 sm:h-20 text-red-600 mx-auto" />
          <h1 className="text-4xl sm:text-5xl font-black text-center mt-2">Entrega Blindada</h1>
          <p className="text-center text-base sm:text-lg text-slate-500 font-semibold mt-1">
            Acceso con PIN de RONOS (cierre automático cada 10 min)
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
              LIMPIAR
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
              title="Borrar"
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
            {busy ? 'VALIDANDO…' : 'ENTRAR'}
          </button>
        </form>
      </main>
    )
  }

  // ESTACIÓN DE EMPAQUE Y ENTREGA EN FULLSCREEN A ANCHO COMPLETO DE TABLETA
  return (
    <main
      ref={rootRef}
      onClick={() => void ensureFullscreen()}
      className="fixed inset-0 z-[100] w-screen h-screen overflow-y-auto bg-slate-100 text-slate-950 pb-8"
    >
      <header className="sticky top-0 z-30 bg-white border-b px-5 py-3.5 shadow-sm">
        <div className="w-full flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-10 h-10 text-red-600 flex-shrink-0" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-black leading-none">Entrega Blindada</h1>
              <p className="text-sm sm:text-base font-bold text-slate-500 mt-0.5">
                {STORES.find(store => store.id === storeId)?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsMuted(prev => !prev)}
              title={isMuted ? 'Activar aviso de voz KDS' : 'Silenciar aviso de voz KDS'}
              className={`p-3 rounded-xl ${isMuted ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-emerald-700'}`}
            >
              {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <button
              type="button"
              onClick={() => void ensureFullscreen()}
              title="Pantalla Completa"
              className="p-3 rounded-xl bg-slate-100 text-slate-700"
            >
              <Maximize2 className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={fetchOrders}
              title="Actualizar"
              className="p-3 rounded-xl bg-slate-100"
            >
              <RefreshCw className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-base font-black">
              <User className="w-5 h-5" />
              <span className="hidden sm:inline">{packer.name}</span>
              <small className="text-slate-500 font-mono text-sm">
                PIN •••• ({formatRemainingMs(remainingMs)})
              </small>
            </span>
            <button
              type="button"
              onClick={() => logout()}
              title="Cerrar sesión PIN (regresa a PIN Fullscreen)"
              className="p-3 rounded-xl bg-slate-100 text-red-600"
            >
              <LogOut className="w-6 h-6" />
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
                placeholder="Buscar Nombre + Apellido, #Check o clave"
                className="w-full h-14 rounded-2xl bg-slate-100 pl-12 pr-4 text-base sm:text-lg font-black placeholder:normal-case"
              />
            </div>

            {/* LEYENDA Y CONTADORES POR ESTATUS CON COLORES */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs font-black">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-100 text-amber-950 border border-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  PREPARACIÓN:{' '}
                  {activeQueueOrders.filter(o => getOrderStageInfo(o).stage === 'PREPARACION').length}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-100 text-blue-900 border border-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  EMPACANDO:{' '}
                  {activeQueueOrders.filter(o => getOrderStageInfo(o).stage === 'EMPACANDO').length}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  LISTA:{' '}
                  {activeQueueOrders.filter(o => getOrderStageInfo(o).stage === 'LISTA').length}
                </span>
                {orders.some(o => getOrderStageInfo(o).stage === 'NO_RECOGIDA') && (
                  <button
                    type="button"
                    onClick={() => setShowHistory(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-orange-100 text-orange-950 border border-orange-400 hover:bg-orange-200 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full bg-orange-600" />
                    NO RECOGIDA (+2H):{' '}
                    {orders.filter(o => getOrderStageInfo(o).stage === 'NO_RECOGIDA').length}
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
                    ? 'Ocultar pasadas'
                    : `Pasadas (${Math.max(0, orders.length - activeQueueOrders.length)})`}
                </button>
              ) : null}
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1 landscape:flex-col landscape:overflow-x-hidden landscape:overflow-y-auto landscape:max-h-[calc(100vh-250px)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:max-h-[calc(100vh-250px)]">
              {visible.map(value => {
                const stageInfo = getOrderStageInfo(value)
                const isSelected = selected === value.guid
                const cardCollisions = collisionsByGuid.get(value.guid) || []
                const hasCollision = cardCollisions.length > 0
                return (
                  <button
                    key={value.guid}
                    type="button"
                    onClick={() => {
                      void ensureFullscreen()
                      setSelected(value.guid)
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
                      #{value.ticket} • Clave: {value.platformOrderKey}
                      {value.hasDrinks ? ' • CON BEBIDAS' : ''}
                    </small>
                    {hasCollision && (
                      <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-black flex items-center gap-1.5 animate-pulse">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">
                          ¡OJO NOMBRE IGUAL/PARECIDO! ({cardCollisions.map(c => `${c.order.customer} #${c.order.ticket}`).join(', ')})
                        </span>
                      </div>
                    )}
                  </button>
                )
              })}
              {!loading && visible.length === 0 && (
                <p className="text-center text-slate-500 py-4 text-base font-semibold w-full">
                  No hay órdenes delivery activas en este momento.
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
                  <h2 className="text-3xl font-black mt-3">Selecciona una orden</h2>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* ALERTA DE ALTO ÉNFASIS SI HAY COLISIÓN DE NOMBRE DUPLICADO O MUY PARECIDO DESDE KDS */}
                {currentCollisions.length > 0 && (
                  <section className="rounded-3xl border-4 border-red-600 bg-red-50 overflow-hidden shadow-lg">
                    <div className="bg-red-600 text-white px-5 py-4 flex items-center gap-3">
                      <AlertTriangle className="w-9 h-9 flex-shrink-0 animate-bounce" />
                      <div>
                        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-tight">
                          🚨 ¡CUIDADO! NOMBRE REPETIDO O MUY PARECIDO EN KDS
                        </h2>
                        <p className="text-sm sm:text-base font-bold text-red-100 mt-0.5">
                          Entró otra orden al sistema con el mismo nombre (aunque el apellido sea distinto) o un nombre muy parecido. ¡Verifica APELLIDO, #CHECK y PLATAFORMA!
                        </p>
                      </div>
                    </div>

                    <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-white border-2 border-slate-900">
                        <span className="inline-block text-xs font-black uppercase px-2.5 py-0.5 rounded-md bg-slate-900 text-white">
                          ESTA ORDEN SELECCIONADA
                        </span>
                        <p className="text-2xl sm:text-3xl font-black text-slate-950 mt-1.5">{order.customer}</p>
                        <p className="text-base font-extrabold text-slate-700 mt-1">
                          Check #{order.ticket} • {label(order.platform)} • Clave: {order.platformOrderKey}
                        </p>
                      </div>

                      {currentCollisions.map(match => {
                        const otherStage = getOrderStageInfo(match.order)
                        return (
                          <div key={match.order.guid} className="p-4 rounded-2xl bg-red-100/90 border-2 border-red-500">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-block text-xs font-black uppercase px-2.5 py-0.5 rounded-md bg-red-700 text-white">
                                ⚠️ NO CONFUNDIR CON ({match.reasonLabel})
                              </span>
                              <span className={`text-xs font-black px-2 py-0.5 rounded-md ${otherStage.badgeClass}`}>
                                {otherStage.label}
                              </span>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-red-950 mt-1.5">{match.order.customer}</p>
                            <p className="text-base font-extrabold text-red-900 mt-1">
                              Check #{match.order.ticket} • {label(match.order.platform)} • Clave: {match.order.platformOrderKey}
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
                        const currentStage = getOrderStageInfo(order)
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
                          Chofer asignado: {order.assignedDriverHint}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 text-sm sm:text-base font-bold text-slate-700 bg-slate-100 px-4 py-1.5 rounded-xl">
                        <Clock className="w-4 h-4" />
                        {order.kdsStatus === 'IN_KITCHEN'
                          ? 'En cocina KDS'
                          : `Preparación KDS: ${formatDuration(order.kdsPrepSeconds)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => enqueueOrderAnnouncement(order)}
                        title="Repetir anuncio de voz de esta orden"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-black"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>Anunciar #{order.ticket}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
                    <div>
                      <span className="text-sm font-black uppercase tracking-wider text-slate-400 block">
                        Cliente (Nombre + Apellido)
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
                        Clave: {order.platformOrderKey}
                      </span>
                    </div>
                  </div>

                  {order.isVoided && (
                    <div className="mt-4 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-base sm:text-lg font-black">
                      ⚠️ ORDEN CANCELADA (VOIDED) EN TOAST
                    </div>
                  )}

                  {getOrderStageInfo(order).stage === 'NO_RECOGIDA' && (
                    <div className="mt-4 p-4 rounded-2xl bg-orange-50 border-2 border-orange-500 text-orange-950 text-base sm:text-lg font-black">
                      ⏱️ ESTATUS AUTOMÁTICO: NO RECOGIDA POR NINGÚN CHOFER EN 2 HORAS O MÁS (+2H)
                    </div>
                  )}

                  {order.hasDrinks && (
                    <div className="mt-4 inline-block px-4 py-2 rounded-xl bg-slate-100 border-2 border-slate-300 text-slate-900 text-base font-black">
                      CON BEBIDAS
                    </div>
                  )}
                </section>

                {/* 3. CONFIRMAR ORDEN COMPLETA Y SELLADA + BLINDAR LA ENTREGA */}
                <section className="bg-white border rounded-3xl p-6 sm:p-7 shadow-sm space-y-6">
                  {/* PASO 1: CONFIRMAR ORDEN COMPLETA Y SELLADA (OBLIGATORIO) */}
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h3 className="text-2xl font-black">1. Confirmar orden completa y sellada</h3>
                        <p className="text-base text-slate-500 font-medium">
                          Confirma cantidad de bolsas, que la orden esté completa y sellada.
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <strong className="text-lg font-black">Bolsas:</strong>
                        <button
                          type="button"
                          disabled={order.audit?.status === 'released'}
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
                          disabled={order.audit?.status === 'released'}
                          onClick={() =>
                            setBags(previous => ({ ...previous, [order.guid]: Math.min(20, bagCount + 1) }))
                          }
                          className="w-14 h-14 rounded-2xl bg-slate-950 text-white text-2xl font-black disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {order.audit?.status !== 'released' &&
                      order.audit?.status !== 'ready' &&
                      !(order.audit?.status === 'unclaimed' && order.audit?.bags != null) && (
                        <button
                          type="button"
                          onClick={markReady}
                          disabled={busy}
                          className="w-full h-16 sm:h-20 rounded-2xl bg-slate-950 text-white text-xl sm:text-2xl font-black disabled:opacity-30"
                        >
                          CONFIRMAR ORDEN COMPLETA Y SELLADA
                        </button>
                      )}

                    {(order.audit?.status === 'ready' ||
                      (order.audit?.status === 'unclaimed' && order.audit?.bags != null)) && (
                      <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-lg font-black flex items-center justify-between">
                        <span>✓ Orden completa y sellada ({order.customer})</span>
                        <span>
                          {bagCount} bolsa{bagCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* PASO 2: BLINDAR ENTREGA AL CHOFER */}
                  <div className="pt-6 border-t space-y-4">
                    <div>
                      <h3 className="text-2xl font-black">2. Blindar la entrega</h3>
                      <p className="text-base text-slate-600 font-medium mt-0.5">
                        {order.platform === 'DOORDASH'
                          ? `Verifica Nombre + Apellido (${order.customer}), Check #${order.ticket} y que el Dasher escanee el QR en vivo.`
                          : `Verifica Nombre + Apellido (${order.customer}), Check #${order.ticket} y Clave ${order.platformOrderKey} en la pantalla del chofer.`}
                      </p>
                    </div>

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
                          ⚠️ CONFIRMO QUE VERIFIQUÉ APELLIDO E INICIAL DE &ldquo;{order.customer}&rdquo; (CHECK #{order.ticket} • {order.platformOrderKey}) Y NO LA ESTOY CONFUNDIENDO CON{' '}
                          {currentCollisions.map(c => `"${c.order.customer}" (CHECK #${c.order.ticket})`).join(', ')}
                        </div>
                      </button>
                    )}

                    {order.audit?.status === 'released' ? (
                      <div className="p-5 rounded-2xl bg-slate-100 border border-slate-300">
                        <strong className="block text-xl font-black text-slate-900">
                          ✓ ENTREGADA: {order.customer} (Check #{order.ticket})
                        </strong>
                        <p className="text-base text-slate-600 font-semibold mt-1">
                          Por {order.audit.handedBy} • {order.audit.driver || 'Chofer verificado'}
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={release}
                        disabled={
                          busy ||
                          (order.audit?.status !== 'ready' &&
                            !(order.audit?.status === 'unclaimed' && order.audit?.bags != null)) ||
                          !isCollisionConfirmed
                        }
                        className="w-full h-16 sm:h-20 rounded-2xl bg-red-600 text-white text-xl sm:text-2xl font-black disabled:bg-slate-300 disabled:text-slate-600 flex items-center justify-center gap-3"
                      >
                        {(order.audit?.status === 'ready' ||
                          (order.audit?.status === 'unclaimed' && order.audit?.bags != null)) &&
                        isCollisionConfirmed ? (
                          <Truck className="w-7 h-7" />
                        ) : (
                          <Lock className="w-7 h-7" />
                        )}
                        <span>
                          {busy
                            ? 'PROCESANDO…'
                            : order.audit?.status !== 'ready' &&
                              !(order.audit?.status === 'unclaimed' && order.audit?.bags != null)
                            ? 'PRIMERO CONFIRMA ORDEN COMPLETA Y SELLADA'
                            : !isCollisionConfirmed
                            ? 'TOCA LA CASILLA DE ARRIBA PARA CONFIRMAR APELLIDO Y #CHECK'
                            : `ENTREGAR ORDEN DE ${order.customer.toUpperCase()} (#${order.ticket})`}
                        </span>
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

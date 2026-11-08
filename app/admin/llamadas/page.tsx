/**
 * @module app/admin/llamadas/page
 * @description Centro de Control de la Contestadora IA Multi-Sucursal (15 Tiendas) de Tacos Gavilan (`/admin/llamadas`).
 * Incluye:
 * 1. Simulador Interactivo de Llamada en Vivo con micrófono y voz neuronal `Kore` para demostración ejecutiva sin requerir Twilio.
 * 2. Base de Conocimiento Editable en tiempo real (`phone_knowledge_base`) global o por sucursal + Detector Automático de Preguntas Nuevas + Días Festivos (`phone_special_hours`).
 * 3. Configuración de las 15 Sucursales y Asistente de Desvío Condicional para las 4 líneas fijas Spectrum Business (Rialto, Downey, Hollywood, Lynwood) y los 11 celulares Android con AT&T.
 * 4. Bitácora de Llamadas (`phone_calls`) y Panel de Recados Prioritarios para Gerentes (`phone_callback_requests`) con sincronización en vivo vía Supabase Realtime.
 *
 * @businessRules
 * - Un solo módulo unificado atiende a las 15 sucursales de Tacos Gavilan.
 * - Cumple 100% con el protocolo bilingüe `useLanguage()` (`es` y `en`).
 * - Permite agregar, editar o desactivar cualquier regla operativa o respuesta frecuente en caliente sin tocar código.
 *
 * @dataFlow
 * - UI `/admin/llamadas` -> `/api/phone/dashboard` (GET/POST/PATCH/DELETE) & `/api/phone/simulate` (POST) & `/api/phone/tts` (GET WAV) + Supabase Realtime (`phone_callback_requests`, `phone_calls`).
 *
 * @notes
 * - Incluye respaldo automático de síntesis de voz del navegador (con filtro estricto anti-Raul) si el navegador bloquea autoplay antes de interacción.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@supabase/supabase-js'
import { AVAILABLE_VOICES, VoiceId, isForbiddenRaulVoice } from '@/lib/order-ready-tts'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  Send,
  BookOpen,
  Store,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Radio,
  MessageSquare,
  Bell,
  Copy,
  Check,
  Calendar,
  HelpCircle,
  UserCheck
} from 'lucide-react'

interface StoreRow {
  id: number
  name: string
  address: string
  phone: string
  has_drive_thru: boolean
  config: {
    store_id: number
    is_enabled: boolean
    routing_mode: string
    carrier_type: 'spectrum_landline' | 'att_wireless'
    twilio_phone_number: string | null
    forwarding_status: string
    ring_timeout_seconds: number
    voice_id: VoiceId
    default_language: 'es' | 'en'
    custom_greeting_es: string | null
    custom_greeting_en: string | null
    manager_transfer_phone: string | null
    allow_live_transfer: boolean
    accepts_ebt: boolean
    parking_notes_es: string | null
    parking_notes_en: string | null
  }
  scheduleEval: {
    isOpenNow: boolean
    activeDayLabelEs: string
    activeDayLabelEn: string
    todayOpenFormattedEs: string
    todayCloseFormattedEs: string
    todayOpenFormattedEn: string
    todayCloseFormattedEn: string
    statusMessageEs: string
    statusMessageEn: string
    weeklySummaryEs: string
    weeklySummaryEn: string
  }
  forwardingGuide: {
    carrierLabelEs: string
    carrierLabelEn: string
    activateNoAnswerCode: string
    deactivateNoAnswerCode: string
    activateBusyCode: string
    deactivateBusyCode: string
    activateUnreachableCode?: string
    deactivateAllCode: string
    stepsEs: string[]
    stepsEn: string[]
    gotchaEs: string
    gotchaEn: string
  }
}

interface KnowledgeRule {
  id: string
  store_id: number | null
  category: string
  title: string
  question_keywords: string | null
  answer_es: string
  answer_en: string
  is_active: boolean
  priority: number
  stores?: { id: number; name: string } | null
}

interface SpecialHourRow {
  id: string
  store_id: number | null
  event_date: string
  holiday_name: string
  is_closed: boolean
  open_time: string | null
  close_time: string | null
  stores?: { id: number; name: string } | null
}

interface CallRow {
  id: string
  call_sid: string
  store_id: number
  source: string
  caller_number: string | null
  language: string
  caller_category: string
  primary_intent: string
  status: string
  resolved_by_ai: boolean
  duration_seconds: number
  turns_count: number
  summary: string | null
  unanswered_question: string | null
  transcript: Array<{ role: string; text: string; timestamp: string; toolName?: string }>
  started_at: string
  stores?: { id: number; name: string } | null
}

interface CallbackRow {
  id: string
  call_id: string | null
  store_id: number
  caller_name: string
  caller_phone: string
  caller_type: string
  urgency: string
  reason_category: string
  reason_summary: string
  ticket_or_order_number: string | null
  status: string
  resolved_by: string | null
  resolution_notes: string | null
  created_at: string
  stores?: { id: number; name: string } | null
}

const QUICK_SCENARIOS = [
  {
    id: 'hours_dt',
    labelEs: '🕐 ¿Están abiertos, a qué hora cierran y tienen Drive-Thru?',
    labelEn: '🕐 Are you open, what time do you close & do you have Drive-Thru?',
    textEs: 'Hola, ¿están abiertos ahorita, a qué hora cierran hoy y tienen Drive-Thru en esta sucursal?',
    textEn: 'Hi, are you open right now, what time do you close today, and does this location have a Drive-Thru?'
  },
  {
    id: 'prices',
    labelEs: '🌮 Precios: Taco de Asada, Super Burrito y Horchata Grande',
    labelEn: '🌮 Prices: Asada Taco, Super Burrito & Large Horchata',
    textEs: '¿Me puedes decir cuánto cuesta el taco de carne asada, el super burrito de asada y un agua de horchata grande?',
    textEn: 'Can you tell me how much a Carne Asada taco, an Asada Super Burrito, and a large Horchata cost?'
  },
  {
    id: 'platters',
    labelEs: '🍱 Charola Fiesta Platter para 30 personas',
    labelEn: '🍱 Fiesta Platter for 30 guests',
    textEs: 'Tengo una reunión para 30 personas hoy en la tarde. ¿Cuánto cuesta la charola Fiesta Platter, qué incluye y con cuánta anticipación se pide?',
    textEn: 'I have a party for 30 people this afternoon. How much is the Fiesta Platter, what does it include, and how much advance notice is needed?'
  },
  {
    id: 'phone_order',
    labelEs: '🛍️ Quiero hacer un pedido por teléfono para recoger',
    labelEn: '🛍️ I want to place an order over the phone for pickup',
    textEs: 'Hola, quiero hacer un pedido de 10 tacos y 2 mulitas por teléfono para pasar a recoger en 15 minutos.',
    textEn: 'Hi, I would like to place an order over the phone for 10 tacos and 2 mulitas to pick up in 15 minutes.'
  },
  {
    id: 'ebt_payment',
    labelEs: '💳 ¿Aceptan tarjeta EBT CalFresh y Apple Pay en caja?',
    labelEn: '💳 Do you accept CalFresh EBT & Apple Pay at the register?',
    textEs: 'Hola, quería preguntar si en esta sucursal aceptan la tarjeta EBT de CalFresh y pagos con Apple Pay.',
    textEn: 'Hi, I wanted to ask if this location accepts the CalFresh EBT card and Apple Pay at the register.'
  },
  {
    id: 'meats_menu',
    labelEs: '🥩 ¿Qué variedad de carnes tienen y hacen tortillas frescas?',
    labelEn: '🥩 What meat options do you serve & are tortillas fresh?',
    textEs: '¿Qué variedad de carnes tienen para los tacos y burritos, y sus tortillas y salsas son recién hechas?',
    textEn: 'What types of meat do you have for tacos and burritos, and are your tortillas and salsas freshly made?'
  },
  {
    id: 'delivery_driver',
    labelEs: '🛵 Chofer de DoorDash / Uber Eats: recolección nocturna',
    labelEn: '🛵 DoorDash / Uber Eats driver: late-night pickup',
    textEs: 'Hola, soy repartidor de DoorDash y vengo por una orden, ¿si ya cerraron las puertas del comedor puedo recoger por el Drive-Thru?',
    textEn: 'Hi, I am a DoorDash driver picking up an order. If the dining room doors are closed, can I pick up at the Drive-Thru window?'
  },
  {
    id: 'missing_item',
    labelEs: '🚨 Reclamo: Me faltaron 3 tacos en mi orden (Alerta Manager)',
    labelEn: '🚨 Issue: Missing 3 tacos in my order (Manager Alert)',
    textEs: 'Acabo de pasar hace 10 minutos por mi orden ticket #148 y al llegar a mi casa vi que me faltaron 3 tacos de asada. Me llamo Roberto Gómez y mi teléfono es 323-555-0144, necesito que me llame el gerente.',
    textEn: 'I just picked up my order ticket #148 10 minutes ago and when I got home I noticed 3 Carne Asada tacos were missing. My name is Roberto Gomez and my phone is 323-555-0144, please have the manager call me.'
  },
  {
    id: 'staff_callout',
    labelEs: '👷 Empleado reportando retardo al turno (Alerta Manager)',
    labelEn: '👷 Employee reporting late arrival (Manager Alert)',
    textEs: 'Hola, soy Juan Hernández de la estación de parrilla, voy a llegar 20 minutos tarde al turno porque hay un accidente en el freeway. Mi celular es 562-555-0188, avísale al gerente por favor.',
    textEn: 'Hi, this is Juan Hernandez from the grill station, I am going to be 20 minutes late for my shift due to a freeway accident. My cell is 562-555-0188, please notify the manager.'
  },
  {
    id: 'jobs',
    labelEs: '💼 Bolsa de Trabajo / ¿Están contratando personal?',
    labelEn: '💼 Job Inquiry / Are you hiring?',
    textEs: 'Hola, buenas tardes, quería saber si están contratando cajeros o taqueros y dónde puedo entregar mi solicitud de empleo.',
    textEn: 'Hello, I wanted to ask if you are hiring cashiers or cooks and how I can submit a job application.'
  }
]

const CATEGORIES = [
  { id: 'policies', labelEs: 'Políticas de Tienda', labelEn: 'Store Policies' },
  { id: 'menu', labelEs: 'Menú, Carnes e Ingredientes', labelEn: 'Menu, Meats & Ingredients' },
  { id: 'catering', labelEs: 'Charolas / Fiesta Platters', labelEn: 'Catering / Fiesta Platters' },
  { id: 'payments', labelEs: 'Pagos y EBT CalFresh', labelEn: 'Payments & CalFresh EBT' },
  { id: 'delivery', labelEs: 'Repartidores (Uber / DoorDash)', labelEn: 'Delivery Drivers (Uber / DoorDash)' },
  { id: 'staff', labelEs: 'Empleados (Retardos / Turnos)', labelEn: 'Staff (Call-outs / Shifts)' },
  { id: 'employment', labelEs: 'Bolsa de Trabajo / Empleo', labelEn: 'Careers / Employment' },
  { id: 'vendors', labelEs: 'Proveedores y Mantenimiento', labelEn: 'Vendors & Maintenance' },
  { id: 'general', labelEs: 'Información General', labelEn: 'General Information' }
]

export default function ContestadoraIaPage() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'

  const [activeTab, setActiveTab] = useState<'simulator' | 'knowledge' | 'stores' | 'calls'>('simulator')
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeRule[]>([])
  const [specialHours, setSpecialHours] = useState<SpecialHourRow[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([])
  const [unansweredQuestions, setUnansweredQuestions] = useState<any[]>([])
  const [kpis, setKpis] = useState({
    totalCalls: 0,
    resolvedByAiCount: 0,
    resolvedByAiPct: 100,
    pendingCallbacksCount: 0,
    estimatedCashierMinutesSaved: 0,
    activeStoresCount: 15,
    verifiedForwardingCount: 0
  })

  // Simulator state
  const [simStoreId, setSimStoreId] = useState<number>(14)
  const [simLang, setSimLang] = useState<'es' | 'en'>('es')
  const [simVoiceMode, setSimVoiceMode] = useState<'neural_turbo' | 'instant_local'>('neural_turbo')
  const [simActive, setSimActive] = useState(false)
  const [simCallSid, setSimCallSid] = useState<string | null>(null)
  const [simBusy, setSimBusy] = useState(false)
  const [simSpeaking, setSimSpeaking] = useState(false)
  const [simListening, setSimListening] = useState(false)
  const [simInput, setSimInput] = useState('')
  const [simTranscript, setSimTranscript] = useState<Array<{
    role: string
    text: string
    timestamp: string
    toolName?: string
    audioUrl?: string
    audioDataUrl?: string
  }>>([])
  const [simLastTools, setSimLastTools] = useState<string[]>([])
  const [simLastCallback, setSimLastCallback] = useState<any | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const nextAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const recognitionRef = useRef<any>(null)

  // Knowledge Base Editor state
  const [editingRule, setEditingRule] = useState<Partial<KnowledgeRule> | null>(null)
  const [resolveCallIdForRule, setResolveCallIdForRule] = useState<string | null>(null)
  const [kbFilterCategory, setKbFilterCategory] = useState<string>('all')
  const [savingRule, setSavingRule] = useState(false)

  // Special Holiday form state
  const [newHoliday, setNewHoliday] = useState({
    store_id: '' as string,
    event_date: '',
    holiday_name: '',
    is_closed: true,
    open_time: '08:00',
    close_time: '20:00'
  })

  // Store Config & Forwarding Guide Modal
  const [selectedStoreForForwarding, setSelectedStoreForForwarding] = useState<StoreRow | null>(null)
  const [savingStoreId, setSavingStoreId] = useState<number | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Calls & Callbacks filter
  const [callsFilterStoreId, setCallsFilterStoreId] = useState<string>('all')
  const [selectedCallDetail, setSelectedCallDetail] = useState<CallRow | null>(null)

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, [])

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/phone/dashboard?storeId=${callsFilterStoreId}`, {
        headers: getAuthHeaders()
      })
      if (!res.ok) return
      const data = await res.json()
      setStores(data.stores || [])
      setKnowledgeBase(data.knowledgeBase || [])
      setSpecialHours(data.specialHours || [])
      setCalls(data.calls || [])
      setCallbacks(data.callbacks || [])
      setUnansweredQuestions(data.unansweredQuestions || [])
      if (data.kpis) setKpis(data.kpis)
    } catch (e) {
      console.error('[ContestadoraIA] Error cargando datos:', e)
    } finally {
      setLoading(false)
    }
  }, [callsFilterStoreId, getAuthHeaders])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  // Realtime subscription to phone_callback_requests and phone_calls
  useEffect(() => {
    const channel = supabase
      .channel('admin-phone-agent-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'phone_callback_requests' },
        () => {
          fetchDashboard()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'phone_calls' },
        () => {
          fetchDashboard()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchDashboard])

  // Desbloquea y reutiliza un único AudioContext igual que en /order-ready-board para que Chrome/Safari nunca bloqueen Kore tras un fetch asíncrono
  const ensureUnlockedAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (typeof window === 'undefined') return null
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return null
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx()
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])

  // Ring tone synthesizer (Web Audio API) - ejecuta en paralelo con la petición al servidor
  const playPhoneRingTone = useCallback(async () => {
    try {
      const ctx = ensureUnlockedAudioCtx()
      if (!ctx) return
      const playBurst = (startTime: number, duration: number) => {
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gain = ctx.createGain()
        osc1.frequency.value = 440
        osc2.frequency.value = 480
        gain.gain.setValueAtTime(0.08, startTime)
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
        osc1.connect(gain)
        osc2.connect(gain)
        gain.connect(ctx.destination)
        osc1.start(startTime)
        osc2.start(startTime)
        osc1.stop(startTime + duration)
        osc2.stop(startTime + duration)
      }
      playBurst(ctx.currentTime, 0.28)
      await new Promise((r) => setTimeout(r, 340))
    } catch {
      // Ignore audio context restrictions
    }
  }, [ensureUnlockedAudioCtx])

  const speakWithFemaleBrowserVoice = useCallback((text: string, lang: 'es' | 'en') => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSimSpeaking(false)
      return
    }
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = lang === 'en' ? 'en-US' : 'es-MX'
    utter.rate = 1.04
    const voices = window.speechSynthesis.getVoices().filter((v) => !isForbiddenRaulVoice(v.name, v.voiceURI))
    const langPrefix = lang === 'en' ? 'en' : 'es'
    const preferredFemale = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith(langPrefix) &&
        /sabina|paulina|dalia|elena|paloma|helena|laura|monica|francisca|google|aria|jenny|zira|samantha|victoria|female|natural/i.test(
          v.name
        )
    ) || voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix))
    if (preferredFemale) {
      utter.voice = preferredFemale
    }
    setSimSpeaking(true)
    utter.onend = () => setSimSpeaking(false)
    utter.onerror = () => setSimSpeaking(false)
    window.speechSynthesis.speak(utter)
  }, [])

  // Reproductor idéntico al de /order-ready-board: usa Web Audio API (decodeAudioData) sobre el AudioContext desbloqueado
  const playVoiceUrl = useCallback(
    async (
      primarySrc: string,
      fallbackText: string,
      lang: 'es' | 'en',
      nextAudioUrl?: string | null
    ) => {
      try {
        if (activeSourceRef.current) {
          try {
            activeSourceRef.current.onended = null
            activeSourceRef.current.stop()
          } catch {}
          activeSourceRef.current = null
        }
        if (audioRef.current) {
          audioRef.current.pause()
        }
        if (nextAudioRef.current) {
          nextAudioRef.current.pause()
          nextAudioRef.current = null
        }

        setSimSpeaking(true)
        const ctx = ensureUnlockedAudioCtx()

        const fetchAndDecode = async (src: string): Promise<AudioBuffer | null> => {
          if (!ctx) return null
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const res = await fetch(src)
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const arrayBuf = await res.arrayBuffer()
              if (arrayBuf.byteLength <= 44) throw new Error('WAV vacío')
              return await ctx.decodeAudioData(arrayBuf.slice(0))
            } catch {
              if (attempt === 0) await new Promise((r) => setTimeout(r, 250))
            }
          }
          return null
        }

        if (ctx) {
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {})
          }
          // Iniciar descarga/decodificación de la segunda parte en paralelo mientras se decodifica y suena la primera
          const nextBufferPromise = nextAudioUrl ? fetchAndDecode(nextAudioUrl) : Promise.resolve(null)
          const firstBuffer = await fetchAndDecode(primarySrc)

          if (firstBuffer && ctx.state === 'running') {
            const playBuffer = (buf: AudioBuffer): Promise<void> =>
              new Promise((resolve) => {
                const source = ctx.createBufferSource()
                source.buffer = buf
                source.connect(ctx.destination)
                activeSourceRef.current = source
                source.onended = () => {
                  if (activeSourceRef.current === source) {
                    activeSourceRef.current = null
                  }
                  resolve()
                }
                source.start(0)
              })

            await playBuffer(firstBuffer)
            const nextBuffer = await nextBufferPromise
            if (nextBuffer) {
              await playBuffer(nextBuffer)
            }
            setSimSpeaking(false)
            return
          }
        }

        // Respaldo secundario con HTMLAudioElement (si AudioContext no estuvo disponible)
        const audio = new Audio(primarySrc)
        audioRef.current = audio
        let preloadedNext: HTMLAudioElement | null = null
        if (nextAudioUrl) {
          preloadedNext = new Audio(nextAudioUrl)
          preloadedNext.preload = 'auto'
          nextAudioRef.current = preloadedNext
        }

        audio.onended = () => {
          if (preloadedNext) {
            audioRef.current = preloadedNext
            preloadedNext.onended = () => setSimSpeaking(false)
            preloadedNext.onerror = () => setSimSpeaking(false)
            preloadedNext.play().catch(() => setSimSpeaking(false))
          } else {
            setSimSpeaking(false)
          }
        }
        audio.onerror = () => speakWithFemaleBrowserVoice(fallbackText, lang)
        audio.play().catch(() => speakWithFemaleBrowserVoice(fallbackText, lang))
      } catch {
        setSimSpeaking(false)
      }
    },
    [ensureUnlockedAudioCtx, speakWithFemaleBrowserVoice]
  )

  const handleStartSimCall = async () => {
    ensureUnlockedAudioCtx()
    setSimBusy(true)
    setSimLastTools([])
    setSimLastCallback(null)
    try {
      // Ejecutar tono de timbre y obtención del saludo pre-cacheado EN PARALELO para contestar al instante
      const [, res] = await Promise.all([
        playPhoneRingTone(),
        fetch('/api/phone/simulate', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            action: 'start',
            storeId: simStoreId,
            lang: simLang,
            voiceMode: 'neural_turbo'
          })
        })
      ])
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al iniciar llamada')

      setSimCallSid(data.callSid)
      setSimActive(true)
      setSimTranscript([
        {
          role: 'assistant',
          text: data.greetingText,
          timestamp: new Date().toISOString(),
          audioUrl: data.audioUrl,
          audioDataUrl: data.audioDataUrl
        }
      ])
      void playVoiceUrl(data.audioDataUrl || data.audioUrl, data.greetingText, data.language, null)
      fetchDashboard()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSimBusy(false)
    }
  }

  const handleEndSimCall = async () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null
        activeSourceRef.current.stop()
      } catch {}
      activeSourceRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
    if (nextAudioRef.current) {
      nextAudioRef.current.pause()
      nextAudioRef.current = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSimSpeaking(false)
    setSimListening(false)
    if (simCallSid) {
      await fetch('/api/phone/simulate', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'end',
          callSid: simCallSid,
          storeId: simStoreId
        })
      }).catch(() => null)
    }
    setSimActive(false)
    setSimCallSid(null)
    fetchDashboard()
  }

  const handleSendSimTurn = async (textOverride?: string) => {
    const message = (textOverride ?? simInput).trim()
    if (!message || simBusy) return

    ensureUnlockedAudioCtx()
    setSimInput('')
    setSimBusy(true)

    // Si aún no había iniciado la llamada y presionó un escenario rápido, la iniciamos en automático
    let activeSid = simCallSid
    if (!simActive || !activeSid) {
      activeSid = `SIM_${simStoreId}_${Date.now()}`
      setSimCallSid(activeSid)
      setSimActive(true)
    }

    setSimTranscript((prev) => [
      ...prev,
      { role: 'user', text: message, timestamp: new Date().toISOString() }
    ])

    try {
      const res = await fetch('/api/phone/simulate', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'turn',
          callSid: activeSid,
          storeId: simStoreId,
          lang: simLang,
          userText: message,
          voiceMode: 'neural_turbo'
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error procesando respuesta')

      setSimLastTools(data.toolsUsed || [])
      if (data.callbackCreated) {
        setSimLastCallback(data.callbackCreated)
      }

      setSimTranscript((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.replyText,
          timestamp: new Date().toISOString(),
          audioUrl: data.audioUrl,
          audioDataUrl: data.audioDataUrl
        }
      ])

      void playVoiceUrl(
        data.audioDataUrl || data.audioUrl,
        data.replyText,
        data.language,
        data.nextAudioUrl
      )
      fetchDashboard()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSimBusy(false)
    }
  }

  const toggleMicrophone = () => {
    if (simListening && recognitionRef.current) {
      recognitionRef.current.stop()
      setSimListening(false)
      return
    }

    const SpeechRec =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null

    if (!SpeechRec) {
      alert(
        isEn
          ? 'Your browser does not support SpeechRecognition. Please use Chrome/Edge or type your question below.'
          : 'Tu navegador no soporta reconocimiento de voz directo. Usa Chrome/Edge o escribe tu pregunta abajo.'
      )
      return
    }

    const rec = new SpeechRec()
    rec.lang = simLang === 'en' ? 'en-US' : 'es-MX'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onstart = () => setSimListening(true)
    rec.onend = () => setSimListening(false)
    rec.onerror = () => setSimListening(false)
    rec.onresult = (event: any) => {
      const transcriptText = event?.results?.[0]?.[0]?.transcript
      if (transcriptText) {
        handleSendSimTurn(transcriptText)
      }
    }

    recognitionRef.current = rec
    rec.start()
  }

  // Knowledge Base handlers
  const handleSaveKnowledgeRule = async () => {
    if (!editingRule?.title || !editingRule?.answer_es) return
    setSavingRule(true)
    try {
      const isEdit = Boolean(editingRule.id)
      const res = await fetch('/api/phone/dashboard', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'knowledge_base',
          ...editingRule,
          resolveCallId: resolveCallIdForRule
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al guardar regla')
      }
      setEditingRule(null)
      setResolveCallIdForRule(null)
      await fetchDashboard()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSavingRule(false)
    }
  }

  const handleToggleRuleActive = async (rule: KnowledgeRule) => {
    await fetch('/api/phone/dashboard', {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        entity: 'knowledge_base',
        id: rule.id,
        is_active: !rule.is_active
      })
    })
    fetchDashboard()
  }

  const handleDeleteRule = async (id: string) => {
    await fetch(`/api/phone/dashboard?entity=knowledge_base&id=${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    fetchDashboard()
  }

  const handleAddHoliday = async () => {
    if (!newHoliday.event_date || !newHoliday.holiday_name) return
    await fetch('/api/phone/dashboard', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        entity: 'special_hours',
        store_id: newHoliday.store_id ? Number(newHoliday.store_id) : null,
        event_date: newHoliday.event_date,
        holiday_name: newHoliday.holiday_name,
        is_closed: newHoliday.is_closed,
        open_time: newHoliday.open_time,
        close_time: newHoliday.close_time
      })
    })
    setNewHoliday({
      store_id: '',
      event_date: '',
      holiday_name: '',
      is_closed: true,
      open_time: '08:00',
      close_time: '20:00'
    })
    fetchDashboard()
  }

  const handleDeleteHoliday = async (id: string) => {
    await fetch(`/api/phone/dashboard?entity=special_hours&id=${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    fetchDashboard()
  }

  // Store Config handler
  const handleSaveStoreConfig = async (storeRow: StoreRow, customUpdates?: Record<string, any>) => {
    setSavingStoreId(storeRow.id)
    try {
      const payload = {
        entity: 'store_config',
        ...storeRow.config,
        store_id: storeRow.id,
        ...(customUpdates || {})
      }
      await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      })
      await fetchDashboard()
    } finally {
      setSavingStoreId(null)
    }
  }

  const updateLocalStoreConfig = (storeId: number, field: string, value: any) => {
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, config: { ...s.config, [field]: value } } : s))
    )
  }

  const handleResolveCallback = async (cb: CallbackRow) => {
    await fetch('/api/phone/dashboard', {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        entity: 'callback_request',
        id: cb.id,
        status: 'resolved'
      })
    })
    fetchDashboard()
  }

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const currentSimStore = stores.find((s) => s.id === simStoreId) || stores[0]
  const filteredKnowledge = knowledgeBase.filter(
    (k) => kbFilterCategory === 'all' || k.category === kbFilterCategory
  )

  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager']}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-6 space-y-6">
        {/* HEADER */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md">
              <PhoneCall size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                  {t('phone_agent.title')}
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-extrabold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  KORE NEURAL VOICE
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {t('phone_agent.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end lg:self-center">
            <button
              onClick={fetchDashboard}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              {isEn ? 'Refresh' : 'Actualizar'}
            </button>
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_active_stores')}
              </span>
              <Store size={18} className="text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {kpis.activeStoresCount} / 15
              </span>
              <span className="text-xs text-slate-500">
                (4 Spectrum • 11 AT&T)
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_resolved_ai')}
              </span>
              <Sparkles size={18} className="text-blue-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {kpis.resolvedByAiPct}%
              </span>
              <span className="text-xs text-slate-500">
                ({kpis.resolvedByAiCount} / {kpis.totalCalls} {isEn ? 'calls' : 'llamadas'})
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_minutes_saved')}
              </span>
              <Clock size={18} className="text-purple-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {kpis.estimatedCashierMinutesSaved} min
              </span>
              <span className="text-xs text-slate-500">
                {isEn ? 'register time saved' : 'tiempo libre en caja'}
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_pending_callbacks')}
              </span>
              <Bell size={18} className={kpis.pendingCallbacksCount > 0 ? 'text-rose-600 animate-bounce' : 'text-slate-400'} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-black ${kpis.pendingCallbacksCount > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
                {kpis.pendingCallbacksCount}
              </span>
              <span className="text-xs text-slate-500">
                {isEn ? 'live on Manager PC' : 'en vivo en PC Manager'}
              </span>
            </div>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'simulator'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <PhoneCall size={17} />
            {t('phone_agent.tab_simulator')}
          </button>

          <button
            onClick={() => setActiveTab('knowledge')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'knowledge'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <BookOpen size={17} />
            {t('phone_agent.tab_knowledge')}
            <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              {knowledgeBase.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('stores')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'stores'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Store size={17} />
            {t('phone_agent.tab_stores')}
          </button>

          <button
            onClick={() => setActiveTab('calls')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'calls'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <MessageSquare size={17} />
            {t('phone_agent.tab_calls')}
            {kpis.pendingCallbacksCount > 0 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-rose-600 text-white font-black">
                {kpis.pendingCallbacksCount}
              </span>
            )}
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: SIMULADOR EN VIVO (DEMO JEFE)                              */}
        {/* ================================================================= */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT PANEL: Store Selector + Live Store Facts + Quick Scenarios */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      {t('phone_agent.sim_select_store')}
                    </label>
                    <select
                      value={simStoreId}
                      onChange={(e) => {
                        const nextId = Number(e.target.value)
                        if (simActive) {
                          void handleEndSimCall()
                        }
                        setSimTranscript([])
                        setSimLastTools([])
                        setSimLastCallback(null)
                        setSimStoreId(nextId)
                      }}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white"
                    >
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} - {s.name} ({s.phone})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      {t('phone_agent.sim_select_lang')}
                    </label>
                    <select
                      value={simLang}
                      onChange={(e) => {
                        const nextLang = e.target.value as 'es' | 'en'
                        if (simActive) {
                          void handleEndSimCall()
                        }
                        setSimTranscript([])
                        setSimLastTools([])
                        setSimLastCallback(null)
                        setSimLang(nextLang)
                      }}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white"
                    >
                      <option value="es">🇲🇽 Español (Voz Kore)</option>
                      <option value="en">🇺🇸 English (Kore Voice)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      <span className="inline-flex items-center gap-1.5">
                        <Volume2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                        {t('phone_agent.sim_voice_badge')}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black">
                        KORE 3.8
                      </span>
                    </div>
                  </div>
                </div>

                {currentSimStore && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold uppercase text-slate-500">
                        {t('phone_agent.sim_live_store_info')}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                          currentSimStore.scheduleEval.isOpenNow
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {currentSimStore.scheduleEval.isOpenNow
                          ? t('phone_agent.sim_open_now')
                          : t('phone_agent.sim_closed_now')}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      Tacos Gavilan — {currentSimStore.name} ({currentSimStore.phone})
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      📍 {currentSimStore.address}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      🕐 {isEn ? currentSimStore.scheduleEval.statusMessageEn : currentSimStore.scheduleEval.statusMessageEs}
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          currentSimStore.has_drive_thru
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        🚗 {currentSimStore.has_drive_thru ? t('phone_agent.sim_drive_thru_yes') : t('phone_agent.sim_drive_thru_no')}
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          currentSimStore.config.accepts_ebt
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        💳 {currentSimStore.config.accepts_ebt ? t('phone_agent.sim_ebt_yes') : t('phone_agent.sim_ebt_no')}
                      </span>

                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        📡 {currentSimStore.config.carrier_type === 'spectrum_landline'
                          ? t('phone_agent.stores_carrier_spectrum')
                          : t('phone_agent.stores_carrier_att')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Call Start / Hangup Buttons */}
                <div className="flex flex-wrap gap-3 pt-1">
                  {!simActive ? (
                    <button
                      onClick={handleStartSimCall}
                      disabled={simBusy}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm shadow-md transition"
                    >
                      <PhoneCall size={18} />
                      {t('phone_agent.sim_start_call')}
                    </button>
                  ) : (
                    <button
                      onClick={handleEndSimCall}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-sm shadow-md transition"
                    >
                      <PhoneOff size={18} />
                      {t('phone_agent.sim_end_call')}
                    </button>
                  )}

                  <button
                    onClick={toggleMicrophone}
                    disabled={simBusy}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-sm transition ${
                      simListening
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {simListening ? <MicOff size={18} /> : <Mic size={18} />}
                    {simListening ? t('phone_agent.sim_mic_listening') : t('phone_agent.sim_mic_speak')}
                  </button>
                </div>
              </div>

              {/* QUICK 1-CLICK SCENARIOS */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-sm">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                  {t('phone_agent.sim_quick_scenarios')}
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {QUICK_SCENARIOS.map((sc) => (
                    <button
                      key={sc.id}
                      onClick={() => handleSendSimTurn(simLang === 'en' ? sc.textEn : sc.textEs)}
                      disabled={simBusy}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 transition text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between gap-2"
                    >
                      <span>{simLang === 'en' ? sc.labelEn : sc.labelEs}</span>
                      <Send size={13} className="text-emerald-600 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: Live Conversation Transcript & Tool Telemetry */}
            <div className="lg:col-span-7 flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden min-h-[560px]">
              {/* Phone Call Top Bar */}
              <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      simActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
                    }`}
                  />
                  <div>
                    <div className="text-sm font-black">
                      {currentSimStore ? `Tacos Gavilan — ${currentSimStore.name}` : 'Tacos Gavilan'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {simActive
                        ? isEn
                          ? 'Call in progress • Neural Voice Kore'
                          : 'Llamada en curso • Voz Neuronal Kore'
                        : isEn
                          ? 'Ready to call (Click Start or any quick scenario)'
                          : 'Listo para llamar (Pulsa Iniciar o cualquier escenario rápido)'}
                    </div>
                  </div>
                </div>

                {simSpeaking && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold">
                    <Volume2 size={14} className="animate-bounce" />
                    {isEn ? 'Kore speaking...' : 'Kore hablando...'}
                  </span>
                )}
              </div>

              {/* Messages Container */}
              <div className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[430px]">
                {simTranscript.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-16 text-slate-400 space-y-3">
                    <Phone size={40} className="text-slate-300 dark:text-slate-700" />
                    <p className="text-sm font-bold max-w-md">
                      {isEn
                        ? 'Select any of the 15 stores on the left and click "Start Simulated Call" or click any test scenario to hear Kore answer live.'
                        : 'Elige cualquiera de las 15 sucursales a la izquierda y presiona "Iniciar Llamada Simulada" o toca un escenario de prueba para escuchar a Kore contestar en vivo.'}
                    </p>
                  </div>
                ) : (
                  simTranscript.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                          msg.role === 'user'
                            ? 'bg-emerald-600 text-white font-medium'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="text-[11px] font-black uppercase opacity-75">
                            {msg.role === 'user'
                              ? isEn
                                ? 'Caller'
                                : 'Persona que llama'
                              : `Tacos Gavilan IA (${currentSimStore?.name || ''})`}
                          </span>
                          {(msg.audioDataUrl || msg.audioUrl) && (
                            <button
                              onClick={() => playVoiceUrl((msg.audioDataUrl || msg.audioUrl)!, msg.text, simLang)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                              <Volume2 size={13} />
                              {isEn ? 'Replay' : 'Escuchar'}
                            </button>
                          )}
                        </div>
                        <p className="leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ))
                )}

                {simBusy && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-4 py-3 bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-500 flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin text-emerald-600" />
                      {isEn
                        ? 'Consulting real-time database & generating Kore voice...'
                        : 'Consultando base de datos en vivo y generando voz Kore...'}
                    </div>
                  </div>
                )}
              </div>

              {/* Tools & Callback Banner */}
              {(simLastTools.length > 0 || simLastCallback) && (
                <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  {simLastTools.map((tool, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                    >
                      ⚡ Tool: {tool}
                    </span>
                  ))}
                  {simLastCallback && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                      🔔 {isEn ? 'Live Alert sent to Manager PC!' : '¡Alerta en vivo enviada a la PC del Manager!'}
                    </span>
                  )}
                </div>
              )}

              {/* Bottom Input Bar */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={simInput}
                  onChange={(e) => setSimInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendSimTurn()
                  }}
                  placeholder={t('phone_agent.sim_type_placeholder')}
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-white"
                />
                <button
                  onClick={() => handleSendSimTurn()}
                  disabled={simBusy || !simInput.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold transition"
                >
                  <Send size={16} />
                  {t('phone_agent.sim_send')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: BASE DE CONOCIMIENTO EDITABLE + PREGUNTAS NUEVAS + FESTIVOS */}
        {/* ================================================================= */}
        {activeTab === 'knowledge' && (
          <div className="space-y-6">
            {/* Unanswered Questions Detector */}
            {unansweredQuestions.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 font-black text-base">
                  <HelpCircle size={20} />
                  {t('phone_agent.kb_unanswered_title')} ({unansweredQuestions.length})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {unansweredQuestions.map((uq) => (
                    <div
                      key={uq.callId}
                      className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-500">
                          {uq.storeName} • {new Date(uq.startedAt).toLocaleString()}
                        </div>
                        <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                          “{uq.question}”
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setResolveCallIdForRule(uq.callId)
                          setEditingRule({
                            store_id: null,
                            category: 'general',
                            title: uq.question.slice(0, 60),
                            question_keywords: '',
                            answer_es: '',
                            answer_en: '',
                            priority: 80
                          })
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0"
                      >
                        {t('phone_agent.kb_convert_to_rule')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Knowledge Base Header & Filter */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">
                    {t('phone_agent.kb_title')}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('phone_agent.kb_subtitle')}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={kbFilterCategory}
                    onChange={(e) => setKbFilterCategory(e.target.value)}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  >
                    <option value="all">{isEn ? 'All Categories' : 'Todas las categorías'}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isEn ? c.labelEn : c.labelEs}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => {
                      setResolveCallIdForRule(null)
                      setEditingRule({
                        store_id: null,
                        category: 'general',
                        title: '',
                        question_keywords: '',
                        answer_es: '',
                        answer_en: '',
                        priority: 80
                      })
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm"
                  >
                    <Plus size={16} />
                    {t('phone_agent.kb_add_rule')}
                  </button>
                </div>
              </div>

              {/* Rule Editor Form */}
              {editingRule && (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border-2 border-emerald-500 p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {isEn ? 'Scope' : 'Alcance'}
                      </label>
                      <select
                        value={editingRule.store_id ?? ''}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            store_id: e.target.value ? Number(e.target.value) : null
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      >
                        <option value="">{t('phone_agent.kb_scope_global')}</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            #{s.id} - {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_category')}
                      </label>
                      <select
                        value={editingRule.category || 'general'}
                        onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {isEn ? c.labelEn : c.labelEs}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_rule_title')}
                      </label>
                      <input
                        type="text"
                        value={editingRule.title || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, title: e.target.value })}
                        placeholder="Ej. Estacionamiento, Frijoles, Bebidas..."
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_keywords')}
                      </label>
                      <input
                        type="text"
                        value={editingRule.question_keywords || ''}
                        onChange={(e) =>
                          setEditingRule({ ...editingRule, question_keywords: e.target.value })
                        }
                        placeholder="estacionamiento, parking, entrada..."
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        🇲🇽 {t('phone_agent.kb_answer_es')}
                      </label>
                      <textarea
                        rows={3}
                        value={editingRule.answer_es || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, answer_es: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        🇺🇸 {t('phone_agent.kb_answer_en')}
                      </label>
                      <textarea
                        rows={3}
                        value={editingRule.answer_en || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, answer_en: e.target.value })}
                        placeholder={isEn ? 'Optional (defaults to Spanish if left blank)' : 'Opcional (si se deja vacío la IA traduce automáticamente)'}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingRule(null)
                        setResolveCallIdForRule(null)
                      }}
                      className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold"
                    >
                      {t('phone_agent.kb_cancel')}
                    </button>
                    <button
                      onClick={handleSaveKnowledgeRule}
                      disabled={savingRule || !editingRule.title || !editingRule.answer_es}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black"
                    >
                      <Save size={14} />
                      {t('phone_agent.kb_save')}
                    </button>
                  </div>
                </div>
              )}

              {/* Rules List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredKnowledge.map((rule) => {
                  const catObj = CATEGORIES.find((c) => c.id === rule.category)
                  return (
                    <div
                      key={rule.id}
                      className={`rounded-2xl border p-4 space-y-2 transition ${
                        rule.is_active
                          ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                          : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200/60 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              {rule.store_id
                                ? `${rule.stores?.name || `#${rule.store_id}`}`
                                : t('phone_agent.kb_scope_global')}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {catObj ? (isEn ? catObj.labelEn : catObj.labelEs) : rule.category}
                            </span>
                          </div>
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">
                            {rule.title}
                          </h4>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleToggleRuleActive(rule)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-black ${
                              rule.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {rule.is_active ? 'ON' : 'OFF'}
                          </button>
                          <button
                            onClick={() => setEditingRule(rule)}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        🇲🇽 {rule.answer_es}
                      </p>
                      {rule.answer_en && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          🇺🇸 {rule.answer_en}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Special Holiday Hours Section */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-emerald-600" />
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  {isEn ? 'Holiday & Special Hours Overrides' : 'Horarios Especiales y Días Festivos'}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {isEn ? 'Store' : 'Sucursal'}
                  </label>
                  <select
                    value={newHoliday.store_id}
                    onChange={(e) => setNewHoliday({ ...newHoliday, store_id: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  >
                    <option value="">{t('phone_agent.kb_scope_global')}</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.id} - {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {isEn ? 'Date' : 'Fecha'}
                  </label>
                  <input
                    type="date"
                    value={newHoliday.event_date}
                    onChange={(e) => setNewHoliday({ ...newHoliday, event_date: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {isEn ? 'Holiday Name' : 'Festivo / Motivo'}
                  </label>
                  <input
                    type="text"
                    value={newHoliday.holiday_name}
                    onChange={(e) => setNewHoliday({ ...newHoliday, holiday_name: e.target.value })}
                    placeholder="Thanksgiving / Navidad"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {isEn ? 'Status' : 'Estado'}
                  </label>
                  <select
                    value={newHoliday.is_closed ? 'closed' : 'open'}
                    onChange={(e) =>
                      setNewHoliday({ ...newHoliday, is_closed: e.target.value === 'closed' })
                    }
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  >
                    <option value="closed">{isEn ? 'Closed All Day' : 'Cerrado Todo el Día'}</option>
                    <option value="open">{isEn ? 'Special Hours' : 'Horario Especial'}</option>
                  </select>
                </div>

                {!newHoliday.is_closed && (
                  <div className="flex gap-1.5">
                    <input
                      type="time"
                      value={newHoliday.open_time}
                      onChange={(e) => setNewHoliday({ ...newHoliday, open_time: e.target.value })}
                      className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs"
                    />
                    <input
                      type="time"
                      value={newHoliday.close_time}
                      onChange={(e) => setNewHoliday({ ...newHoliday, close_time: e.target.value })}
                      className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs"
                    />
                  </div>
                )}

                <button
                  onClick={handleAddHoliday}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black"
                >
                  <Plus size={15} />
                  {isEn ? 'Add Date' : 'Agregar Fecha'}
                </button>
              </div>

              {specialHours.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {specialHours.map((sh) => (
                    <div
                      key={sh.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold"
                    >
                      <span>
                        📅 {sh.event_date} • {sh.holiday_name} (
                        {sh.store_id ? sh.stores?.name || `#${sh.store_id}` : '15 Tiendas'}):{' '}
                        {sh.is_closed ? (isEn ? 'CLOSED' : 'CERRADO') : `${sh.open_time} - ${sh.close_time}`}
                      </span>
                      <button
                        onClick={() => handleDeleteHoliday(sh.id)}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: 15 SUCURSALES & DESVÍO CONDICIONAL (SPECTRUM / AT&T)       */}
        {/* ================================================================= */}
        {activeTab === 'stores' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {stores.map((s) => (
                <div
                  key={s.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-slate-900 dark:text-white">
                          #{s.id} {s.name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            s.config.carrier_type === 'spectrum_landline'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                          }`}
                        >
                          {s.config.carrier_type === 'spectrum_landline'
                            ? t('phone_agent.stores_carrier_spectrum')
                            : t('phone_agent.stores_carrier_att')}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        📞 {s.phone} • {s.has_drive_thru ? '🚗 Drive-Thru' : '🍽️ Comedor/Takeout'}
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        handleSaveStoreConfig(s, { is_enabled: !s.config.is_enabled })
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs font-black ${
                        s.config.is_enabled
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {s.config.is_enabled ? 'ACTIVA' : 'APAGADA'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        {t('phone_agent.stores_twilio_number')}
                      </label>
                      <input
                        type="text"
                        value={s.config.twilio_phone_number || ''}
                        onChange={(e) =>
                          updateLocalStoreConfig(s.id, 'twilio_phone_number', e.target.value)
                        }
                        placeholder="+13235550100"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        {t('phone_agent.stores_manager_phone')}
                      </label>
                      <input
                        type="text"
                        value={s.config.manager_transfer_phone || ''}
                        onChange={(e) =>
                          updateLocalStoreConfig(s.id, 'manager_transfer_phone', e.target.value)
                        }
                        placeholder="Ej. 3235550199"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        {isEn ? 'Line Type' : 'Tipo de Línea'}
                      </label>
                      <select
                        value={s.config.carrier_type}
                        onChange={(e) =>
                          updateLocalStoreConfig(s.id, 'carrier_type', e.target.value)
                        }
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                      >
                        <option value="spectrum_landline">Spectrum Business</option>
                        <option value="att_wireless">AT&T Android</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        {isEn ? 'Voice & EBT' : 'Voz & EBT'}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={s.config.voice_id || 'Kore'}
                          onChange={(e) =>
                            updateLocalStoreConfig(s.id, 'voice_id', e.target.value)
                          }
                          className="w-2/3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                        >
                          {AVAILABLE_VOICES.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            updateLocalStoreConfig(s.id, 'accepts_ebt', !s.config.accepts_ebt)
                          }
                          className={`w-1/3 py-1.5 rounded-xl text-[10px] font-black border ${
                            s.config.accepts_ebt
                              ? 'bg-amber-100 border-amber-300 text-amber-900'
                              : 'bg-slate-100 border-slate-300 text-slate-500'
                          }`}
                        >
                          EBT: {s.config.accepts_ebt ? 'SÍ' : 'NO'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => setSelectedStoreForForwarding(s)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200"
                    >
                      <Smartphone size={14} />
                      {t('phone_agent.stores_view_forwarding')}
                    </button>

                    <button
                      onClick={() => handleSaveStoreConfig(s)}
                      disabled={savingStoreId === s.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                    >
                      <Save size={14} />
                      {savingStoreId === s.id ? '...' : t('phone_agent.stores_save_config')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Forwarding Instructions Modal */}
            {selectedStoreForForwarding && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 space-y-4 border border-slate-200 dark:border-slate-800 shadow-2xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800">
                        {isEn
                          ? selectedStoreForForwarding.forwardingGuide.carrierLabelEn
                          : selectedStoreForForwarding.forwardingGuide.carrierLabelEs}
                      </span>
                      <h3 className="text-lg font-black text-slate-900 dark:text-white mt-1">
                        #{selectedStoreForForwarding.id} {selectedStoreForForwarding.name} —{' '}
                        {isEn ? 'Call Forwarding Setup' : 'Activación de Desvío Condicional'}
                      </h3>
                    </div>
                    <button
                      onClick={() => setSelectedStoreForForwarding(null)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  {/* Quick Copy Codes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          {isEn ? 'If No Answer' : 'Si Nadie Contesta'}
                        </div>
                        <div className="text-sm font-black font-mono text-emerald-600">
                          {selectedStoreForForwarding.forwardingGuide.activateNoAnswerCode}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          copyToClipboard(selectedStoreForForwarding.forwardingGuide.activateNoAnswerCode)
                        }
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        {copiedCode === selectedStoreForForwarding.forwardingGuide.activateNoAnswerCode ? (
                          <Check size={14} className="text-emerald-600" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          {isEn ? 'If Line Busy' : 'Si Está Ocupado'}
                        </div>
                        <div className="text-sm font-black font-mono text-blue-600">
                          {selectedStoreForForwarding.forwardingGuide.activateBusyCode}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          copyToClipboard(selectedStoreForForwarding.forwardingGuide.activateBusyCode)
                        }
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        {copiedCode === selectedStoreForForwarding.forwardingGuide.activateBusyCode ? (
                          <Check size={14} className="text-emerald-600" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Step by step list */}
                  <ol className="space-y-2 text-xs text-slate-700 dark:text-slate-300 list-decimal list-inside">
                    {(isEn
                      ? selectedStoreForForwarding.forwardingGuide.stepsEn
                      : selectedStoreForForwarding.forwardingGuide.stepsEs
                    ).map((step, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {step}
                      </li>
                    ))}
                  </ol>

                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-300">
                    ⚠️{' '}
                    {isEn
                      ? selectedStoreForForwarding.forwardingGuide.gotchaEn
                      : selectedStoreForForwarding.forwardingGuide.gotchaEs}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={async () => {
                        await handleSaveStoreConfig(selectedStoreForForwarding, {
                          forwarding_status: 'verified'
                        })
                        setSelectedStoreForForwarding(null)
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black"
                    >
                      <CheckCircle2 size={15} />
                      {t('phone_agent.stores_mark_verified')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: BITÁCORA DE LLAMADAS & RECADOS PRIORITARIOS                */}
        {/* ================================================================= */}
        {activeTab === 'calls' && (
          <div className="space-y-6">
            {/* Store Filter */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase text-slate-500">
                  {isEn ? 'Filter by Store:' : 'Filtrar por Sucursal:'}
                </span>
                <select
                  value={callsFilterStoreId}
                  onChange={(e) => setCallsFilterStoreId(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                >
                  <option value="all">{isEn ? 'All 15 Stores' : 'Todas las 15 Sucursales'}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      #{s.id} - {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Priority Callbacks Section */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Bell size={18} className="text-rose-600" />
                {t('phone_agent.callbacks_title')} ({callbacks.filter((c) => c.status === 'pending').length})
              </h3>

              {callbacks.length === 0 ? (
                <p className="text-xs text-slate-500">{t('phone_agent.callbacks_empty')}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {callbacks.map((cb) => (
                    <div
                      key={cb.id}
                      className={`rounded-xl border p-4 space-y-2 ${
                        cb.status === 'pending'
                          ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-600 text-white">
                            {cb.stores?.name || `#${cb.store_id}`} • {cb.caller_type}
                          </span>
                          <div className="text-sm font-black text-slate-900 dark:text-white mt-1">
                            {cb.caller_name} — 📞 {cb.caller_phone}
                          </div>
                        </div>

                        {cb.status === 'pending' ? (
                          <button
                            onClick={() => handleResolveCallback(cb)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black"
                          >
                            <CheckCircle2 size={13} />
                            {t('phone_agent.callbacks_mark_resolved')}
                          </button>
                        ) : (
                          <span className="text-xs font-bold text-emerald-600">
                            ✅ {isEn ? 'Resolved' : 'Atendido'}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                        {cb.reason_summary}
                      </p>
                      <div className="text-[11px] text-slate-400">
                        {new Date(cb.created_at).toLocaleString()}
                        {cb.ticket_or_order_number ? ` • Ticket: ${cb.ticket_or_order_number}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Call Logs Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {t('phone_agent.calls_history_title')} ({calls.length})
              </h3>

              {calls.length === 0 ? (
                <p className="text-xs text-slate-500">{t('phone_agent.calls_empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                        <th className="py-2.5 px-3">{isEn ? 'Time' : 'Fecha/Hora'}</th>
                        <th className="py-2.5 px-3">{isEn ? 'Store' : 'Sucursal'}</th>
                        <th className="py-2.5 px-3">{isEn ? 'Source' : 'Origen'}</th>
                        <th className="py-2.5 px-3">{isEn ? 'Intent' : 'Motivo'}</th>
                        <th className="py-2.5 px-3">{isEn ? 'Summary' : 'Resumen'}</th>
                        <th className="py-2.5 px-3">{isEn ? 'Outcome' : 'Resultado'}</th>
                        <th className="py-2.5 px-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {calls.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium">
                            {new Date(c.started_at).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-bold">
                            {c.stores?.name || `#${c.store_id}`}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800">
                              {c.source.toUpperCase()} ({c.language.toUpperCase()})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">
                            {c.primary_intent}
                          </td>
                          <td className="py-2.5 px-3 max-w-md truncate text-slate-600 dark:text-slate-400">
                            {c.summary || '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            {c.resolved_by_ai ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                                {isEn ? 'Resolved by AI' : 'Resuelta por IA'}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                                {isEn ? 'Manager Callback' : 'Recado a Manager'}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => setSelectedCallDetail(c)}
                              className="text-emerald-600 font-bold hover:underline"
                            >
                              {isEn ? 'Transcript' : 'Ver Conversación'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Call Transcript Modal */}
            {selectedCallDetail && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 space-y-4 border border-slate-200 dark:border-slate-800 max-h-[85vh] flex flex-col">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-black text-slate-900 dark:text-white">
                        {selectedCallDetail.stores?.name || `#${selectedCallDetail.store_id}`} —{' '}
                        {new Date(selectedCallDetail.started_at).toLocaleString()}
                      </h4>
                      <p className="text-xs text-slate-500">
                        SID: {selectedCallDetail.call_sid} • {selectedCallDetail.primary_intent}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedCallDetail(null)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {(selectedCallDetail.transcript || []).map((tItem, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl text-xs ${
                          tItem.role === 'user'
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800'
                            : tItem.role === 'tool'
                              ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 font-mono text-[11px]'
                              : 'bg-slate-100 dark:bg-slate-800'
                        }`}
                      >
                        <div className="font-black uppercase text-[10px] opacity-70 mb-0.5">
                          {tItem.role} {tItem.toolName ? `(${tItem.toolName})` : ''}
                        </div>
                        <div>{tItem.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}

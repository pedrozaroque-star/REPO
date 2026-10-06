/**
 * @module app/order-ready-board/page
 * @description Customer-facing Order Ready Board and Voice Announcer for Tacos Gavilan.
 * Displays live orders in "In Progress" and "Ready for Pickup", and synthesizes audio chimes and voice announcements via Web Audio API and SpeechSynthesis.
 * 
 * @businessRules
 * - **Tacos Gavilan Official Branding**: Presenta el nombre canónico y la identidad visual de la marca para displays en sucursal.
 * - **Separación de Estados**:
 *   - 'IN_PROGRESS': Órdenes en cocina recibidas pero aún no despachadas.
 *   - 'READY': Órdenes marcadas con doble tap en KDS Expediter o por API.
 * - **Motor de Audio (Ding-Dong Chime) y Locución Femenina**:
 *   - Sintetizador armónico de campana (Ding-Dong) con Web Audio API de baja latencia antes del llamado + Locutora de alta fidelidad bilingüe secuencial (Inglés: "Order #141 is ready," + Español: "orden #141 ya está.").
 *   - Campanilla Ding-Dong configurable (ON/OFF) con persistencia en LocalStorage.
 *   - Text-to-Speech (TTS) configurable en Español, Inglés o Bilingüe.
 *   - Cola de audio FIFO (First-In, First-Out) para evitar superposición de anuncios en horas pico.
 *   - Control y Filtro de Canales:
 *     * 'FOR_HERE' (Comedor) y 'TOGO' (Para Llevar): activos por defecto.
 *     * 'DRIVE_THRU' (Auto-Servicio): botón de control maestro (ON/OFF) en encabezado y controles detallados en el panel para activar/desactivar anuncios de voz y/o visualización en pantalla, con persistencia en LocalStorage.
 *     * 'DELIVERY' (Plataformas): silenciado por defecto para no saturar el comedor.
 * - **Gestión de Vida Útil**: Las órdenes en 'READY' se retiran visualmente tras un tiempo configurable (por defecto 10 minutos).
 * 
 * @dataFlow
 * - Supabase Realtime channel (`order_ready_announcements`) + Polling cada 4s -> Actualiza estado React -> Dispara SpeechSynthesis femenino bilingüe -> PATCH /api/order-ready/orders (announced: true).
 * 
 * @notes
 * - Los navegadores web requieren un primer toque o clic para desbloquear el AudioContext y SpeechSynthesis (política de autoplay de navegadores). Se incluye un banner sutil de desbloqueo.
 * - Preferencias de canales (Drive-Thru, To Go, For Here, Delivery) persisten en `localStorage` del dispositivo.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Volume2, VolumeX, Settings, Play, RefreshCw, Bell, CheckCircle2, Clock, Sparkles, ChevronDown, ChevronUp, Store, Car } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseAnonKey)

interface OrderItem {
  id: string
  created_at: string
  store_code: string
  store_name: string
  order_number: string
  dining_option: 'FOR_HERE' | 'TOGO' | 'DELIVERY' | 'DRIVE_THRU' | string
  customer_name: string | null
  status: 'IN_PROGRESS' | 'READY' | 'COMPLETED'
  ready_at: string | null
  announced: boolean
  items_summary: string | null
}

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

export default function OrderReadyBoardPage() {
  const { t, language } = useLanguage()

  // Estado general
  const [selectedStore, setSelectedStore] = useState<string>('LYNWOOD')
  const [readyOrders, setReadyOrders] = useState<OrderItem[]>([])
  const [inProgressOrders, setInProgressOrders] = useState<OrderItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<string>('')

  // Configuración de Audio y Voz
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false)
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [voiceVolume, setVoiceVolume] = useState<number>(1.0)
  const [voiceSpeed, setVoiceSpeed] = useState<number>(0.92)
  const [voiceLanguage, setVoiceLanguage] = useState<'es' | 'en' | 'bilingual'>('bilingual')
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [announceToGo, setAnnounceToGo] = useState<boolean>(true)
  const [announceForHere, setAnnounceForHere] = useState<boolean>(true)
  const [announceDriveThru, setAnnounceDriveThru] = useState<boolean>(true)
  const [showDriveThru, setShowDriveThru] = useState<boolean>(true)
  const [announceDelivery, setAnnounceDelivery] = useState<boolean>(false)
  const [enableChime, setEnableChime] = useState<boolean>(true)

  // Cargar preferencias guardadas en LocalStorage y URL Query Param (?store=...)
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

  const handleStoreChange = (storeCode: string) => {
    setSelectedStore(storeCode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('teg_order_ready_store', storeCode)
      const url = new URL(window.location.href)
      url.searchParams.set('store', storeCode)
      window.history.replaceState({}, '', url.toString())
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

  // Paneles de control y testing
  const [showControls, setShowControls] = useState<boolean>(false)
  const [activeSpeech, setActiveSpeech] = useState<string | null>(null)

  // Referencias para Audio Engine
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<OrderItem[]>([])
  const isPlayingRef = useRef<boolean>(false)

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

  // Reloj local en vivo
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      )
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
        if (!ctx || ctx.state === 'suspended') {
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

  // Helper para seleccionar la mejor voz femenina de alta fidelidad (no robotizada)
  const getBestFemaleVoice = useCallback(
    (lang: 'en' | 'es', voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
      const langPrefix = lang === 'es' ? 'es' : 'en'
      const matchingVoices = voices.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix))

      // 1. Prioridad absoluta: Voces Neuronales/Naturales Femeninas (cero robotizadas)
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
    []
  )

  // Función para reproducir el mensaje con voz de mujer (SIN DING-DONG)
  const speakOrder = useCallback(
    (order: OrderItem): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          resolve()
          return
        }

        const num = order.order_number
        const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices()
        const enVoice = getBestFemaleVoice('en', voices)
        const esVoice = getBestFemaleVoice('es', voices)

        if (voiceLanguage === 'bilingual') {
          // Frase exacta solicitada: "Order #141 is ready, orden #141 ya está."
          const displayPhrase = `Order #${num} is ready, orden #${num} ya está.`
          setActiveSpeech(displayPhrase)

          // Fase 1: Inglés ("Order 141 is ready,") con voz de mujer
          const uttEn = new SpeechSynthesisUtterance(`Order ${num} is ready,`)
          uttEn.rate = voiceSpeed
          uttEn.volume = isMuted ? 0 : voiceVolume
          uttEn.lang = 'en-US'
          if (enVoice) uttEn.voice = enVoice

          // Fase 2: Español ("orden 141 ya está.") con voz de mujer
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
    [availableVoices, getBestFemaleVoice, isMuted, voiceVolume, voiceSpeed, voiceLanguage]
  )

  // Procesador de la cola de audio (FIFO Audio Queue) - Con Campanilla Ding-Dong y Voz Femenina
  const processAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || isMuted) {
      return
    }

    isPlayingRef.current = true
    const nextOrder = audioQueueRef.current.shift()

    if (nextOrder) {
      // 1. Tocar campanilla Ding-Dong si está habilitada
      if (enableChime) {
        await playChime()
      }

      // 2. Anunciar con la voz femenina
      await speakOrder(nextOrder)

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
    }

    isPlayingRef.current = false

    // Continuar procesando si hay más órdenes en la cola
    if (audioQueueRef.current.length > 0) {
      processAudioQueue()
    }
  }, [isMuted, enableChime, playChime, speakOrder])

  // Encolar una orden lista para ser anunciada
  const enqueueAnnouncement = useCallback(
    (order: OrderItem) => {
      // Filtrar según canales habilitados
      if (order.dining_option === 'TOGO' && !announceToGo) return
      if (order.dining_option === 'FOR_HERE' && !announceForHere) return
      if (order.dining_option === 'DRIVE_THRU' && !announceDriveThru) return
      if (order.dining_option === 'DELIVERY' && !announceDelivery) return

      // Evitar meter a la cola si ya está en ella
      if (audioQueueRef.current.some(item => item.id === order.id)) return

      audioQueueRef.current.push(order)
      processAudioQueue()
    },
    [announceToGo, announceForHere, announceDriveThru, announceDelivery, processAudioQueue]
  )

  // Cargar órdenes desde el backend
  const fetchOrders = useCallback(async (syncToast = false) => {
    try {
      if (syncToast) setIsSyncing(true)
      const res = await fetch(`/api/order-ready/orders?storeCode=${selectedStore}&syncToast=${syncToast}&minutes=45`)
      const data = await res.json()

      if (data.success) {
        const ready: OrderItem[] = data.readyOrders || []
        const inProgress: OrderItem[] = data.inProgressOrders || []

        setReadyOrders(ready)
        setInProgressOrders(inProgress)

        // Verificar si hay órdenes listas pendientes de anunciar
        ready.forEach(ord => {
          if (!ord.announced) {
            enqueueAnnouncement(ord)
          }
        })
      }
    } catch (e) {
      console.error('Error fetching orders:', e)
    } finally {
      setIsLoading(false)
      setIsSyncing(false)
    }
  }, [selectedStore, enqueueAnnouncement])

  // Polling cada 4 segundos + Carga inicial
  useEffect(() => {
    fetchOrders(false)
    const interval = setInterval(() => {
      fetchOrders(false)
    }, 4000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  // Suscripción a Supabase Realtime
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedStore, fetchOrders])

  // Probar campanilla Ding-Dong y voz femenina
  const handleTestSound = async () => {
    unlockAudio()
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
    await speakOrder(testOrder)
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

  // Helper para el badge de Dining Option
  const renderDiningBadge = (dining: string) => {
    if (dining === 'FOR_HERE') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
          🍽️ {t('orderReadyBoard.for_here')}
        </span>
      )
    }
    if (dining === 'DRIVE_THRU') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/40">
          🚗 {t('orderReadyBoard.drive_thru')}
        </span>
      )
    }
    if (dining === 'DELIVERY') {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40">
          🛵 {t('orderReadyBoard.delivery')}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
        🛍️ {t('orderReadyBoard.to_go')}
      </span>
    )
  }

  return (
    <div
      onClick={unlockAudio}
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden relative"
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
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-md">
        {/* Logo e Identidad */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center font-black text-2xl text-white shadow-lg border border-amber-500/30 tracking-tight">
            TG
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white uppercase">
                Tacos Gavilan
              </h1>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-widest">
                {t('orderReadyBoard.title')}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-emerald-400" />
              <select
                value={selectedStore}
                onChange={(e) => handleStoreChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-white font-bold text-xs rounded-lg px-2.5 py-1 border border-slate-700 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-sm transition"
              >
                {STORES_LIST.map((s) => (
                  <option key={s.code} value={s.code} className="bg-slate-900 text-white">
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Reloj y Estado en Vivo */}
        <div className="flex items-center gap-4">
          {/* Reloj en vivo */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-950/80 px-4 py-2 rounded-xl border border-slate-800 text-slate-200">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span className="text-base font-mono font-bold tracking-wider">{currentTime || '--:--:--'}</span>
          </div>

          {/* Estado de Audio */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsMuted(!isMuted)
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${
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
            onClick={(e) => {
              e.stopPropagation()
              toggleDriveThruMaster()
            }}
            title={announceDriveThru || showDriveThru ? t('orderReadyBoard.drive_thru_enabled') : t('orderReadyBoard.drive_thru_disabled')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${
              announceDriveThru || showDriveThru
                ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20'
                : 'bg-slate-800/80 text-slate-500 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <Car className="w-4 h-4" />
            <span className="hidden md:inline">Drive-Thru</span>
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
              announceDriveThru || showDriveThru
                ? 'bg-orange-500 text-slate-950'
                : 'bg-slate-700 text-slate-400'
            }`}>
              {announceDriveThru || showDriveThru ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Botón de Ajustes / Drawer */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowControls(!showControls)
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden lg:inline">{showControls ? t('orderReadyBoard.hide_controls') : t('orderReadyBoard.show_controls')}</span>
            {showControls ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

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
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 font-medium"
              >
                {STORES_LIST.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Configuración de Voz */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                {t('orderReadyBoard.voice_language')}
              </label>
              <div className="flex gap-2">
                {(['es', 'en', 'bilingual'] as const).map((langOption) => (
                  <button
                    key={langOption}
                    onClick={() => setVoiceLanguage(langOption)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition ${
                      voiceLanguage === langOption
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {langOption === 'es' ? 'ES' : langOption === 'en' ? 'EN' : 'Bilingüe'}
                  </button>
                ))}
              </div>

              {/* Slider de Volumen */}
              <div className="mt-3">
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
              <div className="mt-3 pt-3 border-t border-slate-800">
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
                Acciones
              </label>
              <div className="space-y-2">
                <button
                  onClick={handleTestSound}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs py-2 px-3 rounded-lg shadow transition"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {t('orderReadyBoard.test_sound')}
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
                  displayedReadyOrders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-2 border-emerald-500/60 rounded-2xl p-5 flex items-center justify-between shadow-xl shadow-emerald-950/40 transform hover:scale-[1.01] transition-all animate-in fade-in zoom-in-95 duration-300"
                    >
                      <div className="flex items-center gap-5">
                        {/* Número de Orden en Grande */}
                        <div className="text-4xl lg:text-6xl font-black tracking-tight text-white font-mono drop-shadow-[0_2px_12px_rgba(16,185,129,0.5)]">
                          #{order.order_number}
                        </div>

                        {/* Nombre y Canal */}
                        <div>
                          {order.customer_name && (
                            <div className="text-base lg:text-lg font-bold text-slate-200 truncate max-w-[200px]">
                              {order.customer_name}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            {renderDiningBadge(order.dining_option)}
                          </div>
                        </div>
                      </div>

                      {/* Badge de Listo y Tiempo */}
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-500 text-slate-950 shadow-md">
                          <CheckCircle2 className="w-4 h-4" />
                          {t('orderReadyBoard.ready_badge')}
                        </span>
                        {order.ready_at && (
                          <p className="text-[11px] text-emerald-400/80 font-medium mt-1.5">
                            {calculateElapsedTime(order.ready_at, language)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
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
                  displayedInProgressOrders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between shadow transition hover:border-slate-700"
                    >
                      <div className="flex items-center gap-4">
                        {/* Número de Orden */}
                        <div className="text-3xl lg:text-5xl font-black tracking-tight text-slate-300 font-mono">
                          #{order.order_number}
                        </div>

                        {/* Nombre y Canal */}
                        <div>
                          {order.customer_name && (
                            <div className="text-sm lg:text-base font-bold text-slate-300 truncate max-w-[180px]">
                              {order.customer_name}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            {renderDiningBadge(order.dining_option)}
                          </div>
                        </div>
                      </div>

                      {/* Estado Casi Listo */}
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-slate-400 bg-slate-800/80 border border-slate-700/60">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                          {t('orderReadyBoard.almost_ready')}
                        </span>
                      </div>
                    </div>
                  ))
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

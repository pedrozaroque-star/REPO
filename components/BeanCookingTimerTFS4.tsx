'use client'

/**
 * @module components/BeanCookingTimerTFS4
 * @description Temporizador Digital Multicanal (réplica evolucionada del Cooper-Atkins TFS4) integrado en la
 *   Tableta 2 de Cocina Trasera (`/inventory/preparador/bodega`) para la cocción exacta de Frijoles de la Olla
 *   (11:00 min) y Frijoles Enteros (12:00 min).
 *
 * @businessRules
 * - Reemplaza el temporizador físico Cooper TFS4 conservando la memoria visual de sus 4 canales por color
 *   (`T1` Azul, `T2` Verde, `T3` Amarillo, `T4` Rojo) y su botón rojo superior de paro de alarma.
 * - Elimina al 100% los botones manuales `+ H / M / S -` para cocineros y encargados: únicamente presenta
 *   los 2 botones oficiales preconfigurados y bloqueados (`Frijoles de la Olla = 11 min` y `Frijoles Enteros = 12 min`).
 * - Solo usuarios con rol `admin` ven el botón de calibración para ajustar los tiempos globales en `bean_timer_presets`.
 * - Permanece montado incluso cuando entran alertas de línea (`compactDuringAlert = true`), permitiendo apagar
 *   inmediatamente una olla lista sin esperar a cerrar avisos de carne de línea.
 * - Al llegar a `00:00:00`, reproduce la misma alarma urgente de solicitudes de Tableta 1 (`/sounds/alarm.mp3`)
 *   con etapa de potencia Web Audio API (`GainNode` 3.4x + filtro presencia 2.5 kHz + limitador `DynamicsCompressorNode`)
 *   y anuncia directamente `"Apagar Frijoles de la Olla"` o `"Apagar Frijoles Enteros"` con la voz neuronal femenina
 *   oficial **`Kore`** (la misma usada para llamar órdenes de clientes en `Order Ready Board`), haciendo atenuación
 *   automática (*sidechain ducking*) de la sirena mientras habla `Kore` para inteligibilidad total en cocina.
 * - Registra cada tanda completada en `bean_cooking_logs` con sus segundos exactos de sobrecocción (`overtime_seconds`).
 * - Prohibición absoluta de voces masculinas/robóticas (`Microsoft Raul`, `Jorge`, `David`) en el respaldo offline.
 *
 * @dataFlow
 * - Estado local instantáneo (`localStorage`: `teg_bean_timer_active_${storeId}`) + sincronización REST (`/api/preparador/bean-timer`)
 *   + suscripción Supabase Realtime (`bean_cooking_logs` por `store_id` y `bean_timer_presets`).
 * - Audio precargado en RAM (`AudioBuffer`): `/sounds/alarm.mp3` + 4 clips WAV masterizados de `Kore` (`/audio/bean-timer/*.wav`
 *   con respaldo automático a `/api/order-ready/announcement-tts?voice=Kore`).
 *
 * @notes
 * - Toque instantáneo para guantes húmedos (`onPointerDown` con deduplicación anti-doble disparo de 450ms)
 *   y cancelación protegida a 2 toques para evitar paros accidentales.
 * - Ciclo de alarma 100% independiente del `audioRef` de `bodega/page.tsx`: confirmar un pedido de carne de línea
 *   nunca silencia una olla de frijoles sonando ni viceversa.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Lock,
  History,
  Settings2,
  X,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Maximize2,
  Minimize2,
  Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import { createClient } from '@/lib/supabase-client'
import { getTabletNoCacheHeaders, safeLocalStorageSet } from '@/lib/tablet-cache-cleaner'
import { pickStrictFemaleBrowserVoice } from '@/lib/phone-speech-format'
import {
  BEAN_PRODUCT_KEYS,
  BEAN_TIMER_ALARM_BOOST_GAIN,
  BEAN_TIMER_ALARM_DUCKED_GAIN,
  BEAN_TIMER_ALARM_SOUND_URL,
  BEAN_TIMER_CHANNELS,
  BEAN_TIMER_KORE_VOICE_BOOST_GAIN,
  BEAN_TIMER_OFFICIAL_VOICE,
  BeanTimerChannelId,
  BeanProductKey,
  BeanTimerPresetMap,
  BeanChannelsStateMap,
  BeanCookingHistoryEntry,
  COOPER_TFS4_CHANNEL_SPECS,
  DEFAULT_BEAN_TIMER_PRESETS,
  MAX_ACTIVE_BEAN_TIMER_AGE_MS,
  createEmptyBeanChannelsMap,
  dbLogRowToActiveSession,
  evaluateChannelLiveSnapshot,
  formatOvertimeLabel,
  formatPresetDurationCompact,
  getAlarmingChannelsOrdered,
  getBeanTimerKorePhrase,
  getBeanTimerStaticKoreWavUrl,
  isValidBeanChannelId,
  isValidBeanProductKey,
  pickTargetChannelForStart,
  resolveBeanBusinessContext,
  sanitizeBeanPresetMap,
} from '@/lib/bean-timer'

interface BeanCookingTimerTFS4Props {
  storeId: string
  isMuted: boolean
  userRole?: string
  compactDuringAlert?: boolean
  isTimerMaximized?: boolean
  onToggleMaximize?: () => void
}

export default function BeanCookingTimerTFS4({
  storeId,
  isMuted,
  userRole,
  compactDuringAlert = false,
  isTimerMaximized = false,
  onToggleMaximize,
}: BeanCookingTimerTFS4Props) {
  const { t, language } = useLanguage()
  const supabase = useMemo(() => createClient(), [])

  const isAdmin = (userRole || '').trim().toLowerCase() === 'admin'

  const [presets, setPresets] = useState<BeanTimerPresetMap>({
    ...DEFAULT_BEAN_TIMER_PRESETS,
  })
  const [channels, setChannels] = useState<BeanChannelsStateMap>(() => createEmptyBeanChannelsMap())
  const [selectedChannel, setSelectedChannel] = useState<BeanTimerChannelId>('T1')
  const [todayHistory, setTodayHistory] = useState<BeanCookingHistoryEntry[]>([])
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  // Protección de 2 toques para cancelar un canal activo sin accidentes con guante
  const [confirmCancelChannel, setConfirmCancelChannel] = useState<BeanTimerChannelId | null>(null)
  const cancelResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Avisos visuales breves y modales
  const [busyWarning, setBusyWarning] = useState<boolean>(false)
  const [adminSavedBanner, setAdminSavedBanner] = useState<boolean>(false)
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false)
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false)

  // Campos del modal Admin (Minutos y Segundos exactos)
  const [adminOllaMin, setAdminOllaMin] = useState<number>(11)
  const [adminOllaSec, setAdminOllaSec] = useState<number>(0)
  const [adminEnterosMin, setAdminEnterosMin] = useState<number>(12)
  const [adminEnterosSec, setAdminEnterosSec] = useState<number>(0)
  const [savingAdminPresets, setSavingAdminPresets] = useState<boolean>(false)

  // Motor de Audio de Alta Potencia en Cocina (`/sounds/alarm.mp3` amplificado + Voz Neuronal Oficial `Kore`)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const alarmGainNodeRef = useRef<GainNode | null>(null)
  const voiceGainNodeRef = useRef<GainNode | null>(null)
  const alarmRawBytesRef = useRef<ArrayBuffer | null>(null)
  const alarmBufferRef = useRef<AudioBuffer | null>(null)
  const activeAlarmSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const activeVoiceSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const activeFallbackVoiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const koreBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map())
  const koreBlobUrlCacheRef = useRef<Map<string, string>>(new Map())
  const koreInflightFetchRef = useRef<Map<string, Promise<ArrayBuffer | null>>>(new Map())
  const backupAudioRef = useRef<HTMLAudioElement | null>(null)
  const alarmSessionGenRef = useRef<number>(0)
  const isVoiceSpeakingRef = useRef<boolean>(false)
  const calloutRotationRef = useRef<number>(0)
  const announcedSessionKeysRef = useRef<Set<string>>(new Set())
  const alarmNotifiedDbSetRef = useRef<Set<string>>(new Set())
  const lastGloveTapMsRef = useRef<number>(0)

  const getProductLabel = useCallback(
    (key: BeanProductKey) =>
      key === 'FRIJOLES_OLLA'
        ? t('prep.beanTimer.frijolesOlla')
        : t('prep.beanTimer.frijolesEnteros'),
    [t]
  )

  /**
   * Construye y desbloquea la cadena de amplificación acústica para cocina industrial:
   * - `alarmGainNode` (3.4x, +10.6 dB; se atenúa a 0.22x mientras habla Kore)
   * - `voiceGainNode` (2.8x, +8.9 dB sobre WAV Kore ya masterizado a -0.18 dBFS)
   * - `highpassNode` (110 Hz): elimina sub-graves inaudibles que saturan bocinas de tableta
   * - `presenceNode` (+4 dB @ 2500 Hz): máxima proyección sobre campanas extractoras y ollas hirviendo
   * - `compressorNode` (brick-wall limiter -2 dB, ratio 20:1, attack 1ms): volumen máximo sin distorsión
   */
  const ensureAudioContextUnlocked = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return null

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const ctx: AudioContext = new AudioCtx()
        const alarmGain = ctx.createGain()
        const voiceGain = ctx.createGain()
        const highpass = ctx.createBiquadFilter()
        const presence = ctx.createBiquadFilter()
        const limiter = ctx.createDynamicsCompressor()

        alarmGain.gain.setValueAtTime(BEAN_TIMER_ALARM_BOOST_GAIN, ctx.currentTime)
        voiceGain.gain.setValueAtTime(BEAN_TIMER_KORE_VOICE_BOOST_GAIN, ctx.currentTime)

        highpass.type = 'highpass'
        highpass.frequency.setValueAtTime(110, ctx.currentTime)
        highpass.Q.setValueAtTime(0.707, ctx.currentTime)

        presence.type = 'peaking'
        presence.frequency.setValueAtTime(2500, ctx.currentTime)
        presence.Q.setValueAtTime(1.0, ctx.currentTime)
        presence.gain.setValueAtTime(4.0, ctx.currentTime)

        limiter.threshold.setValueAtTime(-2.0, ctx.currentTime)
        limiter.knee.setValueAtTime(4.0, ctx.currentTime)
        limiter.ratio.setValueAtTime(20.0, ctx.currentTime)
        limiter.attack.setValueAtTime(0.001, ctx.currentTime)
        limiter.release.setValueAtTime(0.09, ctx.currentTime)

        alarmGain.connect(highpass)
        voiceGain.connect(highpass)
        highpass.connect(presence)
        presence.connect(limiter)
        limiter.connect(ctx.destination)

        audioCtxRef.current = ctx
        alarmGainNodeRef.current = alarmGain
        voiceGainNodeRef.current = voiceGain
      }

      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])

  /**
   * Precarga `/sounds/alarm.mp3` en RAM (`AudioBuffer`) para disparo instantáneo a 0ms con volumen amplificado.
   */
  const preloadAlarmAudioBuffer = useCallback(async (): Promise<AudioBuffer | null> => {
    if (alarmBufferRef.current) return alarmBufferRef.current
    if (typeof window === 'undefined') return null
    try {
      if (!alarmRawBytesRef.current) {
        const res = await fetch(BEAN_TIMER_ALARM_SOUND_URL, { cache: 'force-cache' })
        if (!res.ok) return null
        const buf = await res.arrayBuffer()
        if (buf.byteLength < 1000) return null
        alarmRawBytesRef.current = buf
      }
      const ctx = ensureAudioContextUnlocked()
      if (!ctx) return null
      const decoded = await ctx.decodeAudioData(alarmRawBytesRef.current.slice(0))
      alarmBufferRef.current = decoded
      return decoded
    } catch {
      return null
    }
  }, [ensureAudioContextUnlocked])

  /**
   * Obtiene y decodifica el clip WAV oficial de la voz femenina `Kore` (primero desde `/audio/bean-timer/*.wav`
   * masterizado localmente a 0ms, y como respaldo desde `/api/order-ready/announcement-tts?voice=Kore`).
   */
  const loadKoreVoiceClip = useCallback(
    async (
      productKey: BeanProductKey,
      targetLang: 'es' | 'en'
    ): Promise<{ audioBuffer: AudioBuffer | null; blobUrl: string | null }> => {
      if (typeof window === 'undefined') return { audioBuffer: null, blobUrl: null }
      const cacheKey = `${productKey}:${targetLang}`
      const existingBuf = koreBufferCacheRef.current.get(cacheKey) || null
      const existingBlob = koreBlobUrlCacheRef.current.get(cacheKey) || null
      if (existingBuf && existingBlob) {
        return { audioBuffer: existingBuf, blobUrl: existingBlob }
      }

      let rawFetchJob = koreInflightFetchRef.current.get(cacheKey)
      if (!rawFetchJob) {
        rawFetchJob = (async (): Promise<ArrayBuffer | null> => {
          const staticUrl = getBeanTimerStaticKoreWavUrl(productKey, targetLang)
          try {
            const staticRes = await fetch(staticUrl, { cache: 'no-cache' })
            if (staticRes.ok) {
              const bytes = await staticRes.arrayBuffer()
              if (bytes.byteLength > 1000) return bytes
            }
          } catch {}

          // Respaldo dinámico al endpoint oficial de anuncios con voz Kore
          try {
            const phrase = getBeanTimerKorePhrase(productKey, targetLang)
            const apiUrl = `/api/order-ready/announcement-tts?text=${encodeURIComponent(phrase)}&lang=${targetLang}&voice=${BEAN_TIMER_OFFICIAL_VOICE}`
            const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
            if (apiRes.ok) {
              const bytes = await apiRes.arrayBuffer()
              if (bytes.byteLength > 1000) return bytes
            }
          } catch {}

          return null
        })()
        koreInflightFetchRef.current.set(cacheKey, rawFetchJob)
      }

      const rawBytes = await rawFetchJob.finally(() => {
        koreInflightFetchRef.current.delete(cacheKey)
      })
      if (!rawBytes) return { audioBuffer: existingBuf, blobUrl: existingBlob }

      let blobUrl = existingBlob
      if (!blobUrl) {
        blobUrl = URL.createObjectURL(new Blob([rawBytes], { type: 'audio/wav' }))
        koreBlobUrlCacheRef.current.set(cacheKey, blobUrl)
      }

      let audioBuffer = existingBuf
      if (!audioBuffer) {
        try {
          const ctx = ensureAudioContextUnlocked()
          if (ctx) {
            audioBuffer = await ctx.decodeAudioData(rawBytes.slice(0))
            koreBufferCacheRef.current.set(cacheKey, audioBuffer)
          }
        } catch {}
      }

      return { audioBuffer, blobUrl }
    },
    [ensureAudioContextUnlocked]
  )

  // Desbloquear AudioContext y precargar `/sounds/alarm.mp3` + clips `Kore` al montar e interactuar
  useEffect(() => {
    const activeLang: 'es' | 'en' = language === 'en' ? 'en' : 'es'

    const warmAudioAssets = () => {
      ensureAudioContextUnlocked()
      void preloadAlarmAudioBuffer()
      for (const prod of BEAN_PRODUCT_KEYS) {
        void loadKoreVoiceClip(prod, activeLang)
      }
    }

    warmAudioAssets()
    window.addEventListener('pointerdown', warmAudioAssets, { passive: true })
    window.addEventListener('touchstart', warmAudioAssets, { passive: true })
    window.addEventListener('click', warmAudioAssets, { passive: true })
    window.addEventListener('keydown', warmAudioAssets, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', warmAudioAssets)
      window.removeEventListener('touchstart', warmAudioAssets)
      window.removeEventListener('click', warmAudioAssets)
      window.removeEventListener('keydown', warmAudioAssets)
    }
  }, [ensureAudioContextUnlocked, language, loadKoreVoiceClip, preloadAlarmAudioBuffer])

  /**
   * Atenúa temporalmente `/sounds/alarm.mp3` mientras habla `Kore` y restaura el volumen máximo al terminar.
   */
  const setAlarmDuckingState = useCallback((ducked: boolean) => {
    const targetGain = ducked ? BEAN_TIMER_ALARM_DUCKED_GAIN : BEAN_TIMER_ALARM_BOOST_GAIN
    const ctx = audioCtxRef.current
    const gainNode = alarmGainNodeRef.current
    if (ctx && gainNode) {
      try {
        gainNode.gain.cancelScheduledValues(ctx.currentTime)
        gainNode.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.04)
      } catch {
        gainNode.gain.value = targetGain
      }
    }
    if (backupAudioRef.current) {
      backupAudioRef.current.volume = ducked ? 0.18 : 1.0
    }
  }, [])

  /**
   * Detiene instantáneamente (0ms) cualquier bucle de `/sounds/alarm.mp3` y locución activa del temporizador
   * sin tocar el `audioRef` de solicitudes de línea de `bodega/page.tsx`.
   */
  const stopAllBeanAlarmAudio = useCallback(() => {
    alarmSessionGenRef.current += 1
    isVoiceSpeakingRef.current = false

    if (activeAlarmSourceRef.current) {
      try {
        activeAlarmSourceRef.current.onended = null
        activeAlarmSourceRef.current.stop()
        activeAlarmSourceRef.current.disconnect()
      } catch {}
      activeAlarmSourceRef.current = null
    }

    if (backupAudioRef.current) {
      try {
        backupAudioRef.current.pause()
        backupAudioRef.current.currentTime = 0
        backupAudioRef.current.volume = 1.0
      } catch {}
    }

    if (activeVoiceSourceRef.current) {
      try {
        activeVoiceSourceRef.current.onended = null
        activeVoiceSourceRef.current.stop()
        activeVoiceSourceRef.current.disconnect()
      } catch {}
      activeVoiceSourceRef.current = null
    }

    if (activeFallbackVoiceAudioRef.current) {
      try {
        activeFallbackVoiceAudioRef.current.onended = null
        activeFallbackVoiceAudioRef.current.onerror = null
        activeFallbackVoiceAudioRef.current.pause()
        activeFallbackVoiceAudioRef.current.removeAttribute('src')
      } catch {}
      activeFallbackVoiceAudioRef.current = null
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {}
    }
  }, [])

  // Limpieza total al desmontar el componente
  useEffect(() => {
    const blobCache = koreBlobUrlCacheRef.current
    return () => {
      stopAllBeanAlarmAudio()
      blobCache.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {}
      })
      blobCache.clear()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [stopAllBeanAlarmAudio])

  /**
   * Reproduce un bip corto táctil al iniciar o apagar un canal (feedback inmediato con guantes).
   */
  const playTactileBeep = useCallback(
    (freq = 1046, durationMs = 75) => {
      if (isMuted) return
      const ctx = ensureAudioContextUnlocked()
      if (!ctx) return
      try {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, ctx.currentTime)
        gain.gain.setValueAtTime(0.32, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + durationMs / 1000 + 0.01)
      } catch {
        // Ignorar si el navegador aún no desbloquea audio
      }
    },
    [ensureAudioContextUnlocked, isMuted]
  )

  /**
   * Activa el bucle continuo de `/sounds/alarm.mp3` (exactamente el mismo sonido urgente de pedidos
   * desde Tableta 1) amplificado a alta potencia (`3.4x` -> compresor/limitador) hasta que se apague la olla.
   */
  const startContinuousLoudAlarmLoop = useCallback(
    async (expectedGen: number) => {
      if (isMuted || alarmSessionGenRef.current !== expectedGen) return
      if (activeAlarmSourceRef.current) return

      const ctx = ensureAudioContextUnlocked()
      let buffer = alarmBufferRef.current

      if (ctx) {
        if (ctx.state === 'suspended') {
          await Promise.race([
            ctx.resume().catch(() => {}),
            new Promise((r) => setTimeout(r, 350)),
          ])
        }
        if (!buffer) {
          buffer = await preloadAlarmAudioBuffer()
        }
      }

      if (alarmSessionGenRef.current !== expectedGen || isMuted) return

      // 1. Motor Primario: Web Audio API con amplificación 3.4x + filtro presencia + compresor brick-wall
      if (ctx && ctx.state === 'running' && buffer && alarmGainNodeRef.current) {
        try {
          if (backupAudioRef.current && !backupAudioRef.current.paused) {
            backupAudioRef.current.pause()
            backupAudioRef.current.currentTime = 0
          }
          setAlarmDuckingState(isVoiceSpeakingRef.current)
          const src = ctx.createBufferSource()
          src.buffer = buffer
          src.loop = true
          src.connect(alarmGainNodeRef.current)
          src.start(0)
          activeAlarmSourceRef.current = src
          return
        } catch (err) {
          console.warn('[BeanCookingTimerTFS4] Fallback de WebAudio a HTMLAudioElement para alarm.mp3:', err)
        }
      }

      // 2. Motor Secundario de Respaldo: HTMLAudioElement con `/sounds/alarm.mp3` en bucle
      if (backupAudioRef.current) {
        backupAudioRef.current.loop = true
        backupAudioRef.current.volume = isVoiceSpeakingRef.current ? 0.18 : 1.0
        backupAudioRef.current.play().catch(() => {})
      }
    },
    [ensureAudioContextUnlocked, isMuted, preloadAlarmAudioBuffer, setAlarmDuckingState]
  )

  /**
   * Emite el anuncio de frijoles listos con la voz neuronal femenina oficial **`Kore`** (idéntica a las
   * órdenes de clientes en `Order Ready Board`), aplicando *sidechain ducking* sobre `/sounds/alarm.mp3`
   * para que cada palabra se escuche fuerte y cristalina en la cocina trasera.
   */
  const playKoreKitchenCallout = useCallback(
    async (productKey: BeanProductKey, expectedGen: number) => {
      if (isMuted || isVoiceSpeakingRef.current || alarmSessionGenRef.current !== expectedGen) {
        return
      }

      const activeLang: 'es' | 'en' = language === 'en' ? 'en' : 'es'
      isVoiceSpeakingRef.current = true
      setAlarmDuckingState(true)

      const finishSpeech = () => {
        isVoiceSpeakingRef.current = false
        if (alarmSessionGenRef.current === expectedGen && !isMuted) {
          setAlarmDuckingState(false)
          // Si el AudioContext despertó mientras tanto y seguíamos en backupAudioRef, promover al amplificador 3.4x
          if (!activeAlarmSourceRef.current) {
            void startContinuousLoudAlarmLoop(expectedGen)
          }
        }
      }

      try {
        const { audioBuffer, blobUrl } = await loadKoreVoiceClip(productKey, activeLang)
        if (alarmSessionGenRef.current !== expectedGen || isMuted) {
          finishSpeech()
          return
        }

        const ctx = ensureAudioContextUnlocked()
        if (ctx && ctx.state === 'suspended') {
          await Promise.race([
            ctx.resume().catch(() => {}),
            new Promise((r) => setTimeout(r, 350)),
          ])
        }

        // 1. Motor Primario: Voz oficial `Kore` amplificada por Web Audio API (`2.8x` sobre WAV masterizado)
        if (ctx && ctx.state === 'running' && audioBuffer && voiceGainNodeRef.current) {
          await new Promise<void>((resolve) => {
            let settled = false
            const done = () => {
              if (!settled) {
                settled = true
                clearTimeout(watchdog)
                if (activeVoiceSourceRef.current === source) {
                  activeVoiceSourceRef.current = null
                }
                resolve()
              }
            }
            const source = ctx.createBufferSource()
            source.buffer = audioBuffer
            source.connect(voiceGainNodeRef.current!)
            const watchdog = setTimeout(() => {
              try {
                source.stop()
              } catch {}
              done()
            }, 9500)
            source.onended = done
            activeVoiceSourceRef.current = source
            source.start(0)
          })
          finishSpeech()
          return
        }

        // 2. Motor Secundario: HTMLAudioElement reproduciendo el WAV masterizado (-0.18 dBFS) de `Kore`
        if (blobUrl) {
          const playedOk = await new Promise<boolean>((resolve) => {
            let settled = false
            const audio = new Audio(blobUrl)
            audio.volume = 1.0
            activeFallbackVoiceAudioRef.current = audio
            const done = (ok: boolean) => {
              if (!settled) {
                settled = true
                clearTimeout(watchdog)
                audio.onended = null
                audio.onerror = null
                if (activeFallbackVoiceAudioRef.current === audio) {
                  activeFallbackVoiceAudioRef.current = null
                }
                resolve(ok)
              }
            }
            const watchdog = setTimeout(() => {
              try {
                audio.pause()
              } catch {}
              done(false)
            }, 9500)
            audio.onended = () => done(true)
            audio.onerror = () => done(false)
            audio.play().catch(() => done(false))
          })
          if (playedOk) {
            finishSpeech()
            return
          }
        }

        // 3. Respaldo de Emergencia Offline: solo voz femenina verificada del navegador (CERO voces masculinas)
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const voices = window.speechSynthesis.getVoices() || []
          const safeFemale = pickStrictFemaleBrowserVoice(voices, activeLang)
          if (safeFemale) {
            const phrase = getBeanTimerKorePhrase(productKey, activeLang)
            await new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (!settled) {
                  settled = true
                  clearTimeout(watchdog)
                  resolve()
                }
              }
              const utter = new SpeechSynthesisUtterance(phrase)
              utter.voice = safeFemale
              utter.lang = safeFemale.lang || (activeLang === 'en' ? 'en-US' : 'es-MX')
              utter.rate = 0.96
              utter.volume = 1.0
              const watchdog = setTimeout(done, 8500)
              utter.onend = done
              utter.onerror = done
              window.speechSynthesis.cancel()
              window.speechSynthesis.speak(utter)
            })
          }
        }
      } catch {
        // Garantizar siempre restauración de alarma
      } finally {
        finishSpeech()
      }
    },
    [
      ensureAudioContextUnlocked,
      isMuted,
      language,
      loadKoreVoiceClip,
      setAlarmDuckingState,
      startContinuousLoudAlarmLoop,
    ]
  )

  // Persistencia local instantánea por sucursal
  const persistLocalChannels = useCallback(
    (nextChannels: BeanChannelsStateMap) => {
      if (!storeId || typeof window === 'undefined') return
      safeLocalStorageSet(`teg_bean_timer_active_${storeId}`, JSON.stringify(nextChannels), {
        activeStoreId: storeId,
      })
    },
    [storeId]
  )

  // Carga inicial desde localStorage + sincronización autoritativa con el servidor
  const syncFromServer = useCallback(async () => {
    if (!storeId) return
    try {
      const res = await fetch(
        `/api/preparador/bean-timer?storeId=${encodeURIComponent(storeId)}&_t=${Date.now()}`,
        {
          cache: 'no-store',
          headers: getTabletNoCacheHeaders(),
        }
      )
      if (!res.ok) return
      const data = await res.json()
      if (!data?.success) return

      if (data.presets) {
        setPresets(sanitizeBeanPresetMap(data.presets))
      }
      if (Array.isArray(data.todayHistory)) {
        const currentBizDate = resolveBeanBusinessContext().businessDate
        setTodayHistory(
          data.todayHistory.filter((h: any) => String(h.business_date) === currentBizDate)
        )
      }
      if (data.activeChannels) {
        setChannels((prev) => {
          const merged = createEmptyBeanChannelsMap()
          const currentNow = Date.now()
          for (const ch of BEAN_TIMER_CHANNELS) {
            const serverSession = data.activeChannels[ch] || null
            const localSession = prev[ch] || null
            if (serverSession) {
              merged[ch] = serverSession
            } else if (
              localSession &&
              !localSession.logId &&
              currentNow - localSession.startedAtMs < 15_000
            ) {
              // Conservar sesión local recién iniciada (<15s) mientras termina su POST en vuelo
              merged[ch] = localSession
            } else {
              merged[ch] = null
            }
          }
          persistLocalChannels(merged)
          return merged
        })
      }
    } catch (err) {
      console.warn('[BeanCookingTimerTFS4] Usando estado local mientras regresa conexión:', err)
    }
  }, [persistLocalChannels, storeId])

  // Hidratar de inmediato desde localStorage al cambiar/cargar sucursal y luego sincronizar con Supabase
  useEffect(() => {
    if (!storeId || typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(`teg_bean_timer_active_${storeId}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        const restored = createEmptyBeanChannelsMap()
        const currentNow = Date.now()
        for (const ch of BEAN_TIMER_CHANNELS) {
          const candidate = parsed?.[ch]
          if (
            candidate &&
            isValidBeanChannelId(candidate.channelId) &&
            isValidBeanProductKey(candidate.productKey) &&
            Number.isFinite(Number(candidate.expectedEndAtMs)) &&
            currentNow - Number(candidate.startedAtMs || currentNow) <= MAX_ACTIVE_BEAN_TIMER_AGE_MS
          ) {
            restored[ch] = candidate
          }
        }
        setChannels(restored)
      } else {
        setChannels(createEmptyBeanChannelsMap())
      }
    } catch {
      setChannels(createEmptyBeanChannelsMap())
    }

    syncFromServer()
    const pollId = setInterval(syncFromServer, 20_000)
    return () => clearInterval(pollId)
  }, [storeId, syncFromServer])

  // Suscripción Supabase Realtime para reflejar al instante cambios de presets de Admin o cierres desde otra pantalla
  useEffect(() => {
    if (!storeId) return
    const numericId = Number(storeId)
    if (!Number.isFinite(numericId) || numericId <= 0) return

    const channel = supabase
      .channel(`bean-timer-sync-${numericId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bean_cooking_logs',
          filter: `store_id=eq.${numericId}`,
        },
        () => {
          syncFromServer()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bean_timer_presets',
        },
        () => {
          syncFromServer()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId, supabase, syncFromServer])

  // Reloj de alta precisión (250ms) para cuenta regresiva exacta y detección instantánea de 00:00:00
  useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now())
    }, 250)
    return () => clearInterval(tick)
  }, [])

  // Evaluar snapshots en vivo de los 4 canales
  const channelSnapshots = useMemo(
    () => BEAN_TIMER_CHANNELS.map((ch) => evaluateChannelLiveSnapshot(ch, channels[ch], nowMs)),
    [channels, nowMs]
  )

  const alarmingSnapshots = useMemo(
    () => getAlarmingChannelsOrdered(channels, nowMs),
    [channels, nowMs]
  )

  const anyActiveOrAlarming = useMemo(
    () => channelSnapshots.some((s) => s.state !== 'IDLE'),
    [channelSnapshots]
  )

  // Notificar al servidor cuando un canal cruza a ALARMING (00:00:00) una sola vez por sesión
  useEffect(() => {
    if (!storeId || alarmingSnapshots.length === 0) return
    for (const snap of alarmingSnapshots) {
      const sess = snap.session
      if (!sess) continue
      const uniqueKey = sess.logId || `${sess.channelId}_${sess.startedAtMs}`
      if (alarmNotifiedDbSetRef.current.has(uniqueKey)) continue
      alarmNotifiedDbSetRef.current.add(uniqueKey)

      fetch('/api/preparador/bean-timer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getTabletNoCacheHeaders(),
        },
        body: JSON.stringify({
          storeId,
          action: 'ALARM_TRIGGERED',
          channelId: sess.channelId,
          logId: sess.logId,
        }),
      }).catch(() => {})
    }
  }, [alarmingSnapshots, storeId])

  // Motor acústico continuo (`/sounds/alarm.mp3` amplificado + Voz Oficial `Kore`) mientras exista >= 1 canal en ALARMING
  const primaryAlarmChannel = alarmingSnapshots[0] || null
  const latestAlarmingRef = useRef(alarmingSnapshots)
  latestAlarmingRef.current = alarmingSnapshots

  const alarmingSignature = useMemo(
    () =>
      alarmingSnapshots
        .map((s) => `${s.channelId}:${s.session?.productKey || ''}:${s.session?.startedAtMs || 0}`)
        .join('|'),
    [alarmingSnapshots]
  )

  useEffect(() => {
    if (!alarmingSignature || isMuted) {
      if (!alarmingSignature) {
        announcedSessionKeysRef.current.clear()
      }
      stopAllBeanAlarmAudio()
      return
    }

    const currentGen = alarmSessionGenRef.current
    void startContinuousLoudAlarmLoop(currentGen)

    const pickNextCalloutTarget = () => {
      const list = latestAlarmingRef.current
      if (!list || list.length === 0) return null

      // Priorizar cualquier olla recién llegada a 00:00:00 que aún no haya sido anunciada por Kore
      for (const snap of list) {
        if (!snap.session) continue
        const sKey = `${snap.channelId}:${snap.session.startedAtMs}`
        if (!announcedSessionKeysRef.current.has(sKey)) {
          announcedSessionKeysRef.current.add(sKey)
          return snap
        }
      }

      const idx = calloutRotationRef.current % list.length
      calloutRotationRef.current += 1
      return list[idx] || list[0]
    }

    // Dejar sonar 1.4s la alarma urgente de Tableta 1 al 100% y enseguida anunciar con voz Kore
    const initialVoiceTimer = setTimeout(() => {
      const target = pickNextCalloutTarget()
      if (target?.session) {
        void playKoreKitchenCallout(target.session.productKey, currentGen)
      }
    }, 1400)

    // Repetir el llamado directo de Kore cada 6.5s intercalado con la alarma a volumen máximo hasta que apaguen la olla
    const repeatVoiceInterval = setInterval(() => {
      if (isVoiceSpeakingRef.current) return
      const target = pickNextCalloutTarget()
      if (target?.session) {
        void playKoreKitchenCallout(target.session.productKey, currentGen)
      }
    }, 6500)

    return () => {
      clearTimeout(initialVoiceTimer)
      clearInterval(repeatVoiceInterval)
    }
  }, [
    alarmingSignature,
    isMuted,
    playKoreKitchenCallout,
    startContinuousLoudAlarmLoop,
    stopAllBeanAlarmAudio,
  ])

  // Limpiar confirmación de cancelación tras 4 segundos
  const armCancelConfirmation = useCallback((ch: BeanTimerChannelId) => {
    if (cancelResetTimeoutRef.current) clearTimeout(cancelResetTimeoutRef.current)
    setConfirmCancelChannel(ch)
    cancelResetTimeoutRef.current = setTimeout(() => {
      setConfirmCancelChannel(null)
    }, 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (cancelResetTimeoutRef.current) clearTimeout(cancelResetTimeoutRef.current)
    }
  }, [])

  /**
   * Inicia la cocción exacta en el canal libre seleccionado (o auto-asigna T1 -> T4).
   */
  const handleStartBeanCooking = useCallback(
    async (productKey: BeanProductKey, explicitChannel?: BeanTimerChannelId) => {
      ensureAudioContextUnlocked()
      const targetChannel = pickTargetChannelForStart(
        channels,
        explicitChannel || selectedChannel
      )

      if (!targetChannel) {
        playTactileBeep(320, 140)
        setBusyWarning(true)
        setTimeout(() => setBusyWarning(false), 3200)
        return
      }

      playTactileBeep(1175, 85)
      const startMs = Date.now()
      const durationSec = presets[productKey]
      const { businessDate, shiftPeriod } = resolveBeanBusinessContext(startMs)

      const optimisticSession = {
        logId: null,
        channelId: targetChannel,
        productKey,
        targetSeconds: durationSec,
        startedAtMs: startMs,
        expectedEndAtMs: startMs + durationSec * 1000,
        alarmTriggeredAtMs: null,
        businessDate,
        shiftPeriod,
      }

      setChannels((prev) => {
        const next = { ...prev, [targetChannel]: optimisticSession }
        persistLocalChannels(next)
        // Avanzar selector automático al siguiente canal libre para agilizar una segunda olla seguida
        const nextFree = pickTargetChannelForStart(next, null)
        if (nextFree) setSelectedChannel(nextFree)
        return next
      })
      setNowMs(startMs)

      try {
        const res = await fetch('/api/preparador/bean-timer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getTabletNoCacheHeaders(),
          },
          body: JSON.stringify({
            storeId,
            action: 'START',
            channelId: targetChannel,
            productKey,
            clientStartedAtMs: startMs,
          }),
        })

        const data = await res.json()
        if (res.ok && data?.session) {
          setChannels((prev) => {
            const cur = prev[targetChannel]
            if (!cur || cur.startedAtMs !== startMs) return prev
            const next = { ...prev, [targetChannel]: data.session }
            persistLocalChannels(next)
            return next
          })
        } else if (res.status === 409 && data?.existingSession) {
          setChannels((prev) => {
            const next = { ...prev, [targetChannel]: data.existingSession }
            persistLocalChannels(next)
            return next
          })
        }
      } catch (err) {
        console.warn('[BeanCookingTimerTFS4] Inicio guardado localmente; sincronizará al reconectar:', err)
      }
    },
    [
      channels,
      ensureAudioContextUnlocked,
      persistLocalChannels,
      playTactileBeep,
      presets,
      selectedChannel,
      storeId,
    ]
  )

  /**
   * Apaga un canal en alarma (`COMPLETE`) o cancela un canal en curso (`CANCEL`).
   */
  const handleCloseChannel = useCallback(
    async (channelId: BeanTimerChannelId, mode: 'COMPLETE' | 'CANCEL') => {
      ensureAudioContextUnlocked()
      const activeSession = channels[channelId]
      if (!activeSession) return

      const nextChannelsSnapshot = { ...channels, [channelId]: null }
      const remainingAlarming = getAlarmingChannelsOrdered(nextChannelsSnapshot, Date.now())
      if (remainingAlarming.length === 0) {
        stopAllBeanAlarmAudio()
      }
      playTactileBeep(mode === 'COMPLETE' ? 880 : 520, 100)

      setConfirmCancelChannel(null)
      setChannels((prev) => {
        const next = { ...prev, [channelId]: null }
        persistLocalChannels(next)
        return next
      })
      setSelectedChannel(channelId)

      try {
        const res = await fetch('/api/preparador/bean-timer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getTabletNoCacheHeaders(),
          },
          body: JSON.stringify({
            storeId,
            action: mode,
            channelId,
            logId: activeSession.logId,
          }),
        })
        const data = await res.json()
        if (res.ok && data?.log) {
          setTodayHistory((prev) => [
            data.log,
            ...prev.filter((item) => item.id !== data.log.id),
          ])
        } else {
          syncFromServer()
        }
      } catch {
        // Sincronizará al recuperar red
      }
    },
    [
      channels,
      ensureAudioContextUnlocked,
      persistLocalChannels,
      playTactileBeep,
      stopAllBeanAlarmAudio,
      storeId,
      syncFromServer,
    ]
  )

  // Abrir modal de calibración exclusiva de Admin
  const openAdminCalibration = useCallback(() => {
    setAdminOllaMin(Math.floor(presets.FRIJOLES_OLLA / 60))
    setAdminOllaSec(presets.FRIJOLES_OLLA % 60)
    setAdminEnterosMin(Math.floor(presets.FRIJOLES_ENTEROS / 60))
    setAdminEnterosSec(presets.FRIJOLES_ENTEROS % 60)
    setShowAdminModal(true)
  }, [presets])

  const handleSaveAdminPresets = async () => {
    if (!isAdmin || savingAdminPresets) return
    const ollaTotal = Math.max(10, Math.round(adminOllaMin) * 60 + Math.round(adminOllaSec))
    const enterosTotal = Math.max(10, Math.round(adminEnterosMin) * 60 + Math.round(adminEnterosSec))

    setSavingAdminPresets(true)
    try {
      const res = await fetch('/api/preparador/bean-timer', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getTabletNoCacheHeaders(),
        },
        body: JSON.stringify({
          FRIJOLES_OLLA: ollaTotal,
          FRIJOLES_ENTEROS: enterosTotal,
        }),
      })
      const data = await res.json()
      if (res.ok && data?.presets) {
        setPresets(sanitizeBeanPresetMap(data.presets))
        setShowAdminModal(false)
        setAdminSavedBanner(true)
        setTimeout(() => setAdminSavedBanner(false), 3500)
      }
    } finally {
      setSavingAdminPresets(false)
    }
  }

  /**
   * Helper táctil para guantes húmedos y mica protectora: disparo inmediato en `onPointerDown`
   * con bloqueo de 450ms en `onClick` sintético para impedir dobles toques involuntarios.
   */
  const bindGloveTap = (action: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault()
        e.stopPropagation()
        lastGloveTapMsRef.current = Date.now()
        action()
      }
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation()
      if (Date.now() - lastGloveTapMsRef.current < 450) return
      action()
    },
  })

  // Contadores rápidos de tandas completadas hoy
  const completedTodayCounts = useMemo(() => {
    let olla = 0
    let enteros = 0
    for (const row of todayHistory) {
      if (row.status !== 'COMPLETED') continue
      if (row.product_key === 'FRIJOLES_OLLA') olla++
      if (row.product_key === 'FRIJOLES_ENTEROS') enteros++
    }
    return { olla, enteros, totalCompleted: olla + enteros }
  }, [todayHistory])

  // Si hay alertas de línea activas en pantalla completa, mostrar barra flotante prioritaria solo si hay canales corriendo o sonando
  if (compactDuringAlert) {
    if (!anyActiveOrAlarming) {
      return <audio ref={backupAudioRef} src={BEAN_TIMER_ALARM_SOUND_URL} loop preload="auto" className="hidden" />
    }

    return (
      <div className="w-full max-w-6xl mx-auto mb-4 shrink-0 z-30">
        <audio ref={backupAudioRef} src={BEAN_TIMER_ALARM_SOUND_URL} loop preload="auto" className="hidden" />
        <div
          className={`rounded-3xl border-2 p-3 sm:p-4 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-3 ${
            primaryAlarmChannel
              ? 'bg-red-950 border-red-400 ring-4 ring-red-500/50 animate-pulse'
              : 'bg-slate-900/95 border-slate-700'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-black/40 text-amber-300 border border-amber-500/30">
              {t('prep.beanTimer.activeBannerDuringLineAlert')}
            </span>
            {channelSnapshots
              .filter((s) => s.state !== 'IDLE')
              .map((snap) => {
                const spec = COOPER_TFS4_CHANNEL_SPECS[snap.channelId]
                const prodName = snap.session ? getProductLabel(snap.session.productKey) : ''
                return (
                  <div
                    key={snap.channelId}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${
                      snap.state === 'ALARMING'
                        ? 'bg-red-600 border-white text-white font-black'
                        : 'bg-slate-800 border-slate-600 text-white'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black border ${spec.badgeBg} ${spec.badgeBorder} ${spec.badgeText}`}
                    >
                      {snap.channelId}
                    </span>
                    <span className="text-xs sm:text-sm font-bold">{prodName}</span>
                    <span className="font-mono font-black text-sm sm:text-base [font-feature-settings:'tnum']">
                      {snap.state === 'ALARMING'
                        ? snap.formattedOvertime
                        : snap.formattedMain}
                    </span>
                    {snap.state === 'ALARMING' && (
                      <button
                        type="button"
                        {...bindGloveTap(() => handleCloseChannel(snap.channelId, 'COMPLETE'))}
                        className="ml-1 px-3 py-1 rounded-lg bg-white text-red-700 font-black text-xs uppercase shadow-md cursor-pointer touch-manipulation"
                      >
                        {t('prep.beanTimer.stopChannelBtn')}
                      </button>
                    )}
                  </div>
                )
              })}
          </div>

          {primaryAlarmChannel && primaryAlarmChannel.session && (
            <button
              type="button"
              {...bindGloveTap(() => handleCloseChannel(primaryAlarmChannel.channelId, 'COMPLETE'))}
              className="w-full md:w-auto px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-500 border-2 border-red-200 text-white font-black text-sm sm:text-base uppercase tracking-wider shadow-[0_0_30px_rgba(239,68,68,0.8)] cursor-pointer touch-manipulation"
            >
              {t('prep.beanTimer.stopAlarmTopBtn', {
                channel: primaryAlarmChannel.channelId,
                product: getProductLabel(primaryAlarmChannel.session.productKey),
              })}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col select-none relative">
      <audio ref={backupAudioRef} src={BEAN_TIMER_ALARM_SOUND_URL} loop preload="auto" className="hidden" />

      {/* BOTÓN ROJO SUPERIOR CORONA (Idéntico al botón físico superior del Cooper-Atkins TFS4) */}
      <div className="flex justify-center -mb-2.5 z-10 px-6 shrink-0">
        <button
          type="button"
          disabled={!primaryAlarmChannel}
          {...(primaryAlarmChannel
            ? bindGloveTap(() => handleCloseChannel(primaryAlarmChannel.channelId, 'COMPLETE'))
            : {})}
          className={`w-full max-w-md rounded-t-[28px] px-5 py-2.5 sm:py-3 border-t-2 border-x-2 font-black uppercase tracking-wider text-xs sm:text-sm md:text-base transition-all touch-manipulation flex items-center justify-center gap-2.5 ${
            primaryAlarmChannel && primaryAlarmChannel.session
              ? 'bg-gradient-to-b from-red-500 to-red-700 border-red-200 text-white shadow-[0_-6px_35px_rgba(239,68,68,0.85)] animate-bounce cursor-pointer active:scale-95'
              : 'bg-gradient-to-b from-red-950/90 to-slate-900 border-red-900/60 text-red-300/50 cursor-default'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-full ${
              primaryAlarmChannel ? 'bg-white animate-ping' : 'bg-red-900/70'
            }`}
          />
          <span className="truncate">
            {primaryAlarmChannel && primaryAlarmChannel.session
              ? t('prep.beanTimer.stopAlarmTopBtn', {
                  channel: primaryAlarmChannel.channelId,
                  product: getProductLabel(primaryAlarmChannel.session.productKey),
                })
              : t('prep.beanTimer.stopAlarmIdleTopBtn')}
          </span>
        </button>
      </div>

      {/* CARCASA PRINCIPAL ESTILO INDUSTRIAL COOPER TFS4 */}
      <div
        className={`flex-1 bg-slate-900 rounded-3xl border-2 p-4 sm:p-5 xl:p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden transition-colors ${
          primaryAlarmChannel
            ? 'border-red-500 shadow-[0_0_60px_rgba(239,68,68,0.35)]'
            : 'border-slate-700/90'
        }`}
      >
        {/* Cabecera del Temporizador */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-black text-xs tracking-widest border border-red-400/60 shrink-0">
              TFS4
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg xl:text-xl font-black text-white tracking-wide uppercase leading-tight truncate">
                {t('prep.beanTimer.title')}
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 font-semibold truncate">
                {t('prep.beanTimer.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[10px] sm:text-xs font-black tracking-wider">
              <Lock size={12} className="shrink-0" />
              <span className="hidden sm:inline">{t('prep.beanTimer.lockedBadge')}</span>
            </span>

            {isAdmin && (
              <button
                type="button"
                onClick={openAdminCalibration}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 text-xs font-black cursor-pointer transition-colors"
                title={t('prep.beanTimer.adminModalTitle')}
              >
                <Settings2 size={14} />
                <span>{t('prep.beanTimer.adminSettingsBtn')}</span>
              </button>
            )}

            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-bold cursor-pointer transition-colors"
              >
                {isTimerMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                <span className="hidden xl:inline">
                  {isTimerMaximized
                    ? t('prep.beanTimer.showSplitView')
                    : t('prep.beanTimer.expandTimerOnly')}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Avisos emergentes (4 canales ocupados o confirmación Admin) */}
        <AnimatePresence>
          {busyWarning && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-2.5 px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-400 text-amber-200 text-xs sm:text-sm font-black flex items-center gap-2 shrink-0"
            >
              <AlertTriangle size={16} className="text-amber-400 shrink-0" />
              <span>{t('prep.beanTimer.allChannelsBusy')}</span>
            </motion.div>
          )}
          {adminSavedBanner && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-2.5 px-3.5 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400 text-emerald-200 text-xs sm:text-sm font-black flex items-center gap-2 shrink-0"
            >
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>{t('prep.beanTimer.adminSavedToast')}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PANTALLA DIGITAL DE 4 CANALES (T1 AZUL, T2 VERDE, T3 AMARILLO, T4 ROJO) */}
        <div className="flex-1 flex flex-col gap-2 sm:gap-2.5 my-1 min-h-0 justify-center">
          {channelSnapshots.map((snap) => {
            const spec = COOPER_TFS4_CHANNEL_SPECS[snap.channelId]
            const isSelectedIdle = snap.state === 'IDLE' && selectedChannel === snap.channelId
            const isAlarm = snap.state === 'ALARMING'
            const isRunning = snap.state === 'RUNNING'
            const isConfirmingCancel = confirmCancelChannel === snap.channelId
            const productTitle = snap.session ? getProductLabel(snap.session.productKey) : ''

            return (
              <div
                key={snap.channelId}
                {...(snap.state === 'IDLE'
                  ? bindGloveTap(() => {
                      playTactileBeep(900, 45)
                      setSelectedChannel(snap.channelId)
                    })
                  : {})}
                className={`relative rounded-2xl border-2 px-3 py-2 sm:px-4 sm:py-2.5 transition-all overflow-hidden flex items-center justify-between gap-2 sm:gap-3 ${
                  isAlarm
                    ? 'bg-red-950/90 border-red-400 shadow-[0_0_25px_rgba(239,68,68,0.5)]'
                    : isRunning
                      ? `bg-slate-950/90 ${spec.rowActiveBorder}`
                      : isSelectedIdle
                        ? 'bg-slate-800/90 border-slate-500 cursor-pointer'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 cursor-pointer'
                }`}
              >
                {/* Barra de progreso inferior en canales activos */}
                {isRunning && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
                    <div
                      className={`h-full transition-all duration-300 ${spec.progressBar}`}
                      style={{ width: `${snap.progressPct}%` }}
                    />
                  </div>
                )}

                {/* Izquierda: Botón circular T1 / T2 / T3 / T4 + Flecha selectora ◀ */}
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 flex items-center justify-center font-black text-sm sm:text-base shadow-md ${spec.badgeBg} ${spec.badgeBorder} ${spec.badgeText}`}
                  >
                    {snap.channelId}
                  </div>
                  <span
                    className={`text-xs font-black transition-opacity ${
                      isSelectedIdle ? 'text-amber-400 opacity-100' : 'opacity-0'
                    }`}
                    aria-hidden="true"
                  >
                    ◀
                  </span>
                </div>

                {/* Centro: Display Digital LCD HH : MM : SS + Etiqueta de Estado/Producto */}
                <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
                  <div
                    className={`font-mono font-black tracking-tight leading-none flex items-baseline gap-1 [font-feature-settings:'tnum'] ${
                      isTimerMaximized
                        ? 'text-3xl sm:text-5xl xl:text-6xl'
                        : 'text-2xl sm:text-3xl xl:text-4xl'
                    } ${
                      isAlarm
                        ? 'text-red-200 animate-pulse'
                        : isRunning
                          ? 'text-emerald-50'
                          : 'text-slate-500'
                    }`}
                  >
                    <span>{snap.hoursPart}</span>
                    <sup className="text-[10px] sm:text-xs font-bold opacity-60 mr-0.5">
                      {t('prep.beanTimer.hoursUnit')}
                    </sup>
                    <span>{snap.minutesPart}</span>
                    <sup className="text-[10px] sm:text-xs font-bold opacity-60 mr-0.5">
                      {t('prep.beanTimer.minutesUnit')}
                    </sup>
                    <span>{snap.secondsPart}</span>
                    <sup className="text-[10px] sm:text-xs font-bold opacity-60">
                      {t('prep.beanTimer.secondsUnit')}
                    </sup>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                    {isAlarm ? (
                      <>
                        <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-black text-[10px] sm:text-xs uppercase tracking-wider">
                          {productTitle} • {t('prep.beanTimer.readyTurnOff')}
                        </span>
                        {snap.formattedOvertime && (
                          <span className="px-2 py-0.5 rounded-md bg-black/60 border border-red-300 text-red-200 font-mono font-black text-[10px] sm:text-xs [font-feature-settings:'tnum']">
                            {t('prep.beanTimer.overtimeBadge', { time: snap.formattedOvertime })}
                          </span>
                        )}
                      </>
                    ) : isRunning ? (
                      <span className="px-2.5 py-0.5 rounded-md bg-slate-800 border border-slate-600 text-amber-300 font-black text-[11px] sm:text-xs uppercase tracking-wide truncate max-w-[240px]">
                        🫘 {productTitle}
                      </span>
                    ) : (
                      <span
                        className={`text-[10px] sm:text-xs font-extrabold uppercase tracking-widest ${
                          isSelectedIdle ? 'text-amber-300' : 'text-slate-600'
                        }`}
                      >
                        {isSelectedIdle
                          ? t('prep.beanTimer.channelSelected')
                          : t('prep.beanTimer.channelIdle')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Derecha: Acción rápida (APAGAR / Cancelar 2 pasos) + LED físico del canal */}
                <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                  {isAlarm && (
                    <button
                      type="button"
                      {...bindGloveTap(() => handleCloseChannel(snap.channelId, 'COMPLETE'))}
                      className="px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 border-2 border-white text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-lg cursor-pointer touch-manipulation"
                    >
                      {t('prep.beanTimer.stopChannelBtn')}
                    </button>
                  )}

                  {isRunning && (
                    <button
                      type="button"
                      {...bindGloveTap(() => {
                        if (isConfirmingCancel) {
                          handleCloseChannel(snap.channelId, 'CANCEL')
                        } else {
                          playTactileBeep(600, 50)
                          armCancelConfirmation(snap.channelId)
                        }
                      })}
                      className={`px-2.5 py-1.5 rounded-xl border text-[11px] sm:text-xs font-black transition-all cursor-pointer touch-manipulation ${
                        isConfirmingCancel
                          ? 'bg-red-600 border-red-300 text-white shadow-md'
                          : 'bg-slate-800/90 hover:bg-slate-700 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {isConfirmingCancel
                        ? t('prep.beanTimer.cancelConfirm')
                        : t('prep.beanTimer.cancelTap1')}
                    </button>
                  )}

                  {/* LED circular derecho idéntico al Cooper TFS4 */}
                  <div
                    className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 transition-all ${
                      isAlarm
                        ? `${spec.ledAlarm} animate-ping`
                        : isRunning
                          ? `${spec.ledRunning} animate-pulse`
                          : spec.ledIdle
                    }`}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* PANEL INFERIOR: ÚNICAMENTE LOS 2 BOTONES OFICIALES CON TIEMPOS EXACTOS BLOQUEADOS (SIN + H / M / S -) */}
        <div className="mt-3 pt-3 border-t border-slate-800 shrink-0">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {/* BOTÓN 1: FRIJOLES DE LA OLLA (11:00 MIN) */}
            <button
              type="button"
              {...bindGloveTap(() => handleStartBeanCooking('FRIJOLES_OLLA'))}
              className="group rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-red-700 hover:from-amber-500 hover:to-red-600 active:scale-[0.97] border-2 border-amber-300/60 p-3.5 sm:p-4 xl:p-5 text-white shadow-[0_8px_25px_rgba(234,88,12,0.35)] transition-all flex flex-col items-center justify-center text-center cursor-pointer touch-manipulation"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Flame size={18} className="text-amber-200 shrink-0" />
                <span className="font-black text-sm sm:text-base xl:text-lg uppercase tracking-tight leading-tight">
                  {t('prep.beanTimer.frijolesOlla')}
                </span>
              </div>
              <div className="font-mono font-black text-2xl sm:text-3xl xl:text-4xl tracking-tight text-amber-100 [font-feature-settings:'tnum'] leading-none my-0.5">
                {formatPresetDurationCompact(presets.FRIJOLES_OLLA)}{' '}
                <span className="text-xs sm:text-sm font-extrabold opacity-85">
                  {t('prep.beanTimer.minutesLabel')}
                </span>
              </div>
              <span className="text-[10px] sm:text-[11px] font-bold text-amber-100/80 mt-1">
                {t('prep.beanTimer.presetButtonHint')}
              </span>
            </button>

            {/* BOTÓN 2: FRIJOLES ENTEROS (12:00 MIN) */}
            <button
              type="button"
              {...bindGloveTap(() => handleStartBeanCooking('FRIJOLES_ENTEROS'))}
              className="group rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-800 hover:from-emerald-500 hover:to-teal-600 active:scale-[0.97] border-2 border-emerald-300/60 p-3.5 sm:p-4 xl:p-5 text-white shadow-[0_8px_25px_rgba(16,185,129,0.35)] transition-all flex flex-col items-center justify-center text-center cursor-pointer touch-manipulation"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Flame size={18} className="text-emerald-200 shrink-0" />
                <span className="font-black text-sm sm:text-base xl:text-lg uppercase tracking-tight leading-tight">
                  {t('prep.beanTimer.frijolesEnteros')}
                </span>
              </div>
              <div className="font-mono font-black text-2xl sm:text-3xl xl:text-4xl tracking-tight text-emerald-100 [font-feature-settings:'tnum'] leading-none my-0.5">
                {formatPresetDurationCompact(presets.FRIJOLES_ENTEROS)}{' '}
                <span className="text-xs sm:text-sm font-extrabold opacity-85">
                  {t('prep.beanTimer.minutesLabel')}
                </span>
              </div>
              <span className="text-[10px] sm:text-[11px] font-bold text-emerald-100/80 mt-1">
                {t('prep.beanTimer.presetButtonHint')}
              </span>
            </button>
          </div>

          {/* Barra resumen inferior de tandas de hoy + Bitácora */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-bold">
              <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700 text-amber-300">
                {t('prep.beanTimer.summaryOlla', { count: completedTodayCounts.olla })}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700 text-emerald-300">
                {t('prep.beanTimer.summaryEnteros', { count: completedTodayCounts.enteros })}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold cursor-pointer transition-colors"
            >
              <History size={14} className="text-blue-400" />
              <span>
                {t('prep.beanTimer.historyBtn', { count: completedTodayCounts.totalCompleted })}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL DE BITÁCORA DIARIA DE COCCIÓN */}
      <AnimatePresence>
        {showHistoryModal && (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistoryModal(false)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative z-10 w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl flex flex-col text-white"
            >
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-800 shrink-0">
                <h3 className="text-xl sm:text-2xl font-black tracking-tight">
                  {t('prep.beanTimer.historyTitle')}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4">
                {todayHistory.length === 0 ? (
                  <p className="text-center text-slate-400 py-12 font-semibold">
                    {t('prep.beanTimer.historyEmpty')}
                  </p>
                ) : (
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                        <th className="py-2.5 pr-3">{t('prep.beanTimer.colChannel')}</th>
                        <th className="py-2.5 px-3">{t('prep.beanTimer.colProduct')}</th>
                        <th className="py-2.5 px-3">{t('prep.beanTimer.colStart')}</th>
                        <th className="py-2.5 px-3">{t('prep.beanTimer.colEnd')}</th>
                        <th className="py-2.5 pl-3 text-right">{t('prep.beanTimer.colResult')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {todayHistory.map((row) => {
                        const spec =
                          COOPER_TFS4_CHANNEL_SPECS[row.channel_id] || COOPER_TFS4_CHANNEL_SPECS.T1
                        const startFmt = new Date(row.started_at).toLocaleTimeString('en-US', {
                          timeZone: 'America/Los_Angeles',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                        const endFmt = row.completed_at
                          ? new Date(row.completed_at).toLocaleTimeString('en-US', {
                              timeZone: 'America/Los_Angeles',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'
                        const overtime = Number(row.overtime_seconds) || 0

                        return (
                          <tr key={row.id} className="hover:bg-slate-800/40">
                            <td className="py-3 pr-3">
                              <span
                                className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-black border ${spec.badgeBg} ${spec.badgeBorder} ${spec.badgeText}`}
                              >
                                {row.channel_id}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-bold text-slate-100">
                              {getProductLabel(row.product_key)}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-300">{startFmt}</td>
                            <td className="py-3 px-3 font-mono text-slate-300">{endFmt}</td>
                            <td className="py-3 pl-3 text-right">
                              {row.status === 'CANCELLED' ? (
                                <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 font-bold text-xs">
                                  {t('prep.beanTimer.statusCancelled')}
                                </span>
                              ) : overtime > 30 ? (
                                <span className="px-2.5 py-1 rounded-lg bg-red-950 border border-red-700 text-red-300 font-mono font-black text-xs">
                                  {t('prep.beanTimer.statusOvertime', {
                                    time: formatOvertimeLabel(overtime),
                                  })}
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-950 border border-emerald-700 text-emerald-300 font-bold text-xs">
                                  {t('prep.beanTimer.statusOnTime')}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="pt-4 border-t border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-black uppercase tracking-wider cursor-pointer"
                >
                  {t('prep.beanTimer.closeBtn')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL EXCLUSIVO ADMIN: CALIBRACIÓN DE TIEMPOS OFICIALES */}
      <AnimatePresence>
        {showAdminModal && isAdmin && (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminModal(false)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="relative z-10 w-full max-w-lg bg-slate-900 border-2 border-amber-500/60 rounded-3xl p-6 shadow-2xl text-white"
            >
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <h3 className="text-lg sm:text-xl font-black text-amber-300">
                  {t('prep.beanTimer.adminModalTitle')}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs sm:text-sm text-slate-300 mt-3 mb-5 leading-relaxed">
                {t('prep.beanTimer.adminModalDesc')}
              </p>

              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700">
                  <div className="font-black text-amber-300 uppercase text-sm mb-2">
                    🫘 {t('prep.beanTimer.frijolesOlla')}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-xs font-bold text-slate-400">
                      <span>{t('prep.beanTimer.adminMinInput')}</span>
                      <input
                        type="number"
                        min={0}
                        max={720}
                        value={adminOllaMin}
                        onChange={(e) => setAdminOllaMin(Math.max(0, Number(e.target.value) || 0))}
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-600 text-white font-mono font-black text-lg"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-bold text-slate-400">
                      <span>{t('prep.beanTimer.adminSecInput')}</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={adminOllaSec}
                        onChange={(e) =>
                          setAdminOllaSec(Math.min(59, Math.max(0, Number(e.target.value) || 0)))
                        }
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-600 text-white font-mono font-black text-lg"
                      />
                    </label>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700">
                  <div className="font-black text-emerald-300 uppercase text-sm mb-2">
                    🫘 {t('prep.beanTimer.frijolesEnteros')}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-xs font-bold text-slate-400">
                      <span>{t('prep.beanTimer.adminMinInput')}</span>
                      <input
                        type="number"
                        min={0}
                        max={720}
                        value={adminEnterosMin}
                        onChange={(e) =>
                          setAdminEnterosMin(Math.max(0, Number(e.target.value) || 0))
                        }
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-600 text-white font-mono font-black text-lg"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-bold text-slate-400">
                      <span>{t('prep.beanTimer.adminSecInput')}</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={adminEnterosSec}
                        onChange={(e) =>
                          setAdminEnterosSec(
                            Math.min(59, Math.max(0, Number(e.target.value) || 0))
                          )
                        }
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-600 text-white font-mono font-black text-lg"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-black uppercase text-xs sm:text-sm cursor-pointer"
                >
                  {t('prep.beanTimer.closeBtn')}
                </button>
                <button
                  type="button"
                  disabled={savingAdminPresets}
                  onClick={handleSaveAdminPresets}
                  className="flex-[2] py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black uppercase text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {savingAdminPresets ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{t('prep.beanTimer.adminSaving')}</span>
                    </>
                  ) : (
                    <span>{t('prep.beanTimer.adminSaveBtn')}</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

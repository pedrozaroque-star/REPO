'use client'

/**
 * @module components/phone/KorePhoneLiveSimulator
 * @description Simulador Telefónico en Vivo (`gemini-3.8-live`) para `/admin/llamadas` de Tacos Gavilan.
 * Replica 1 a 1 la arquitectura de voz bidireccional nativa (`AudioWorklet` 16 kHz -> WebSocket `BidiGenerateContentConstrained` ->
 * `KorePlaybackQueue` 24 kHz + *barge-in* instantáneo `< 50 ms`) del módulo HME Drive-Thru (`KoreDriveThruSimulator.tsx`),
 * conectada al cerebro y herramientas oficiales de Recepcionista Telefónica de las 15 sucursales.
 *
 * @businessRules
 * - Soporta tanto conversación por micrófono manos libres (`VAD 320 ms` o `Push-to-Talk`) como envío por chat escrito y
 *   los 35 escenarios rápidos de 1 clic (`sendScenarioOrText`), respondiendo siempre con la voz viva de `Kore 3.8 Live`.
 * - Cualquier recado creado durante la simulación se guarda con `source = 'simulator'` (aislado de las pantallas de tienda).
 * - 100% bilingüe (`es` / `en`) vía `useLanguage()` (`lib/i18n.tsx`).
 *
 * @dataFlow
 * - Inicio -> `POST /api/phone/live-session` -> Token efímero bloqueado + saludo pre-calentado -> WebSocket `gemini-3.8-live`.
 * - `toolCall` -> `POST /api/phone/live-tool` -> `toolResponse` + refresco inmediato de KPIs/Bitácora.
 * - Fin / Cuelgue -> `POST /api/phone/live-end` -> persistencia completa en `public.phone_calls`.
 *
 * @notes
 * - Espera `playbackQueue.remainingMs` al recibir `end_call` para jamás cortar la frase final de despedida de Kore.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Radio,
  Send,
  Volume2,
  VolumeX,
  Zap
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
  KORE_CAPTURE_PROCESSOR,
  KORE_DEFAULT_NOISE_GATE_RMS,
  KORE_NOISE_GATE_HOLD_CHUNKS,
  KoreNoiseGate,
  KorePlaybackQueue,
  base64ToBytes,
  bytesToBase64,
  computeKoreLatencyStats,
  decodePcm16ToFloat32,
  loadKoreCaptureWorklet,
  parsePcmRate
} from '@/components/drive-thru/kore-audio'

export interface KorePhoneLiveSimulatorHandle {
  sendScenarioOrText: (text: string) => Promise<void>
  endCall: () => Promise<void>
  isActive: boolean
}

export interface KorePhoneLiveSimulatorProps {
  storeId: number
  storeDisplayName: string
  lang: 'es' | 'en'
  onLangChange?: (next: 'es' | 'en') => void
  disabled?: boolean
  getAuthHeaders: () => Record<string, string>
  onDashboardRefresh: () => void
}

interface LiveTranscriptBubble {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
  latencyMs?: number
  open?: boolean
}

const WS_BACKPRESSURE_BYTES = 512 * 1024
const SETUP_TIMEOUT_MS = 10000

export const KorePhoneLiveSimulator = forwardRef<
  KorePhoneLiveSimulatorHandle,
  KorePhoneLiveSimulatorProps
>(function KorePhoneLiveSimulator(
  {
    storeId,
    storeDisplayName,
    lang,
    onLangChange,
    disabled = false,
    getAuthHeaders,
    onDashboardRefresh
  },
  ref
) {
  const { t } = useLanguage()

  const [status, setStatus] = useState<'idle' | 'connecting' | 'live'>('idle')
  const [koreSpeaking, setKoreSpeaking] = useState(false)
  const [speakerMuted, setSpeakerMuted] = useState(false)
  const [micMode, setMicMode] = useState<'vad' | 'ptt'>('vad')
  const [pttPressed, setPttPressed] = useState(false)
  const [micPaused, setMicPaused] = useState(false)
  const [hasMicStream, setHasMicStream] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [bubbles, setBubbles] = useState<LiveTranscriptBubble[]>([])
  const [toolsUsed, setToolsUsed] = useState<string[]>([])
  const [lastCallback, setLastCallback] = useState<{ caller_name?: string; caller_phone?: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [endedNotice, setEndedNotice] = useState<string | null>(null)
  const [latencySamples, setLatencySamples] = useState<number[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const outGainRef = useRef<GainNode | null>(null)
  const playbackRef = useRef<KorePlaybackQueue | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const noiseGateRef = useRef<KoreNoiseGate>(
    new KoreNoiseGate({
      enabled: true,
      threshold: KORE_DEFAULT_NOISE_GATE_RMS,
      holdChunks: KORE_NOISE_GATE_HOLD_CHUNKS
    })
  )
  const rmsBarRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const callSidRef = useRef<string | null>(null)
  const activeStoreIdRef = useRef<number>(storeId)
  const activeLangRef = useRef<'es' | 'en'>(lang)
  const startedAtRef = useRef<number>(0)
  const statusRef = useRef<'idle' | 'connecting' | 'live'>('idle')
  const micModeRef = useRef<'vad' | 'ptt'>('vad')
  const pttPressedRef = useRef(false)
  const micPausedRef = useRef(false)
  const lastSpeechEndAtRef = useRef<number | null>(null)
  const awaitingFirstModelAudioRef = useRef(false)
  const pendingAutoHangupRef = useRef(false)
  const toolQueueRef = useRef<Promise<void>>(Promise.resolve())
  const bubblesRef = useRef<LiveTranscriptBubble[]>([])
  const toolsLogRef = useRef<Array<{ role: 'tool'; text: string; timestamp: string; toolName: string }>>([])
  const queuedInitialTextRef = useRef<string | null>(null)
  const closingSessionRef = useRef(false)
  const sessionGenRef = useRef(0)
  const setupTimerRef = useRef<number | null>(null)
  const autoHangupTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const getAuthHeadersRef = useRef(getAuthHeaders)
  getAuthHeadersRef.current = getAuthHeaders
  const onDashboardRefreshRef = useRef(onDashboardRefresh)
  onDashboardRefreshRef.current = onDashboardRefresh
  const onLangChangeRef = useRef(onLangChange)
  onLangChangeRef.current = onLangChange
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    activeLangRef.current = lang
  }, [lang])

  useEffect(() => {
    micModeRef.current = micMode
  }, [micMode])

  useEffect(() => {
    pttPressedRef.current = pttPressed
  }, [pttPressed])

  useEffect(() => {
    micPausedRef.current = micPaused
  }, [micPaused])

  useEffect(() => {
    if (outGainRef.current) {
      outGainRef.current.gain.value = speakerMuted ? 0 : 1
    }
  }, [speakerMuted])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [bubbles, interimText, endedNotice])

  const syncBubbles = useCallback(
    (updater: (prev: LiveTranscriptBubble[]) => LiveTranscriptBubble[]) => {
      setBubbles((prev) => {
        const next = updater(prev)
        bubblesRef.current = next
        return next
      })
    },
    []
  )

  const appendOrExtendBubble = useCallback(
    (role: 'user' | 'assistant', deltaText: string, latencyMs?: number) => {
      if (!deltaText) return
      syncBubbles((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === role && last.open) {
          copy[copy.length - 1] = {
            ...last,
            text: `${last.text}${deltaText}`,
            ...(latencyMs !== undefined && last.latencyMs === undefined ? { latencyMs } : {})
          }
          return copy
        }
        copy.push({
          id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          role,
          text: deltaText,
          timestamp: new Date().toISOString(),
          latencyMs,
          open: true
        })
        return copy
      })
    },
    [syncBubbles]
  )

  const closeOpenBubbles = useCallback(
    (roleFilter?: 'user' | 'assistant') => {
      syncBubbles((prev) =>
        prev.map((b) => (b.open && (!roleFilter || b.role === roleFilter) ? { ...b, open: false } : b))
      )
    },
    [syncBubbles]
  )

  const teardownMediaAndSocket = useCallback(() => {
    sessionGenRef.current += 1
    if (setupTimerRef.current !== null) {
      window.clearTimeout(setupTimerRef.current)
      setupTimerRef.current = null
    }
    if (autoHangupTimerRef.current !== null) {
      window.clearTimeout(autoHangupTimerRef.current)
      autoHangupTimerRef.current = null
    }

    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'client_end')
        }
      } catch {}
    }

    if (playbackRef.current) {
      playbackRef.current.clear()
      playbackRef.current = null
    }

    if (workletRef.current) {
      workletRef.current.port.onmessage = null
      try {
        workletRef.current.disconnect()
      } catch {}
      workletRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((tr) => {
        try {
          tr.stop()
        } catch {}
      })
      mediaStreamRef.current = null
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => undefined)
    }
    audioCtxRef.current = null
    outGainRef.current = null
    noiseGateRef.current.reset()
    setKoreSpeaking(false)
    setHasMicStream(false)
    setInterimText('')
    if (rmsBarRef.current) rmsBarRef.current.style.width = '0%'
  }, [])

  const buildFinalTranscriptPayload = useCallback(() => {
    const cleanTurns = bubblesRef.current
      .map((b) => ({
        role: b.role,
        text: b.text.replace(/\s+/g, ' ').trim(),
        timestamp: b.timestamp
      }))
      .filter((b) => b.text.length > 0)
    return [...cleanTurns, ...toolsLogRef.current].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    )
  }, [])

  const endCall = useCallback(
    async (opts?: { keepalive?: boolean; showEndedBanner?: boolean }) => {
      if (closingSessionRef.current) return
      const sid = callSidRef.current
      const sId = activeStoreIdRef.current
      const lg = activeLangRef.current
      const dur = startedAtRef.current > 0 ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)) : 0
      const transcriptPayload = buildFinalTranscriptPayload()

      closingSessionRef.current = true
      callSidRef.current = null
      startedAtRef.current = 0
      pendingAutoHangupRef.current = false
      statusRef.current = 'idle'
      if (mountedRef.current) setStatus('idle')
      teardownMediaAndSocket()

      try {
        if (sid) {
          const endRes = await fetch('/api/phone/live-end', {
            method: 'POST',
            headers: getAuthHeadersRef.current(),
            keepalive: Boolean(opts?.keepalive),
            body: JSON.stringify({
              callSid: sid,
              storeId: sId,
              lang: lg,
              durationSeconds: dur,
              transcript: transcriptPayload
            })
          }).catch(() => null)
          if (opts?.showEndedBanner && mountedRef.current) {
            if (endRes?.ok) {
              setEndedNotice(tRef.current('phone_agent.live_ended_cleanly'))
            } else {
              setErrorMsg(`HTTP ${endRes?.status || 'NET'} al guardar llamada en Bitácora.`)
            }
          }
          if (mountedRef.current) {
            onDashboardRefreshRef.current()
          }
        } else if (opts?.showEndedBanner && mountedRef.current) {
          setEndedNotice(tRef.current('phone_agent.live_ended_cleanly'))
        }
      } finally {
        closingSessionRef.current = false
      }
    },
    [buildFinalTranscriptPayload, teardownMediaAndSocket]
  )

  const endCallRef = useRef(endCall)
  endCallRef.current = endCall
  const teardownRef = useRef(teardownMediaAndSocket)
  teardownRef.current = teardownMediaAndSocket

  // Si cambia la tienda estando en llamada, cerrar limpiamente sin desmontar
  useEffect(() => {
    if (statusRef.current !== 'idle' && activeStoreIdRef.current !== storeId) {
      void endCallRef.current()
    }
    activeStoreIdRef.current = storeId
  }, [storeId])

  // Cierre limpio ÚNICAMENTE al cerrar pestaña o desmontar realmente el componente (`[]`)
  useEffect(() => {
    mountedRef.current = true
    const onPageHide = () => {
      if (callSidRef.current) {
        void endCallRef.current({ keepalive: true })
      } else {
        teardownRef.current()
      }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', onPageHide)
      if (callSidRef.current) {
        void endCallRef.current({ keepalive: true })
      } else {
        teardownRef.current()
      }
    }
  }, [])

  // Barra espaciadora para Push-to-Talk cuando micMode === 'ptt'
  useEffect(() => {
    if (status !== 'live' || micMode !== 'ptt') return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setPttPressed(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setPttPressed(false)
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
          lastSpeechEndAtRef.current = performance.now()
          awaitingFirstModelAudioRef.current = true
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [status, micMode])

  const sendTextTurnOverWs = useCallback(
    (rawText: string) => {
      const text = rawText.trim()
      if (!text) return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return

      // Interrumpir cualquier audio previo de Kore al enviar pregunta nueva
      playbackRef.current?.clear()
      closeOpenBubbles()
      setInterimText('')

      syncBubbles((prev) => [
        ...prev,
        {
          id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text,
          timestamp: new Date().toISOString(),
          open: false
        }
      ])

      lastSpeechEndAtRef.current = performance.now()
      awaitingFirstModelAudioRef.current = true
      ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true
          }
        })
      )
    },
    [closeOpenBubbles, syncBubbles]
  )

  const startCall = useCallback(
    async (initialTextToQueue?: string, connectAttempt = 0) => {
      if (statusRef.current !== 'idle' || disabled) return
      const myGen = ++sessionGenRef.current
      let setupCompletedForThisSocket = false
      setErrorMsg(null)
      setEndedNotice(null)
      setToolsUsed([])
      setLastCallback(null)
      setLatencySamples([])
      toolsLogRef.current = []
      bubblesRef.current = []
      setBubbles([])
      pendingAutoHangupRef.current = false
      queuedInitialTextRef.current = initialTextToQueue?.trim() || null

      statusRef.current = 'connecting'
      setStatus('connecting')
      activeStoreIdRef.current = storeId

      try {
        // 1. Inicializar AudioContext + solicitar micrófono en paralelo con token efímero del servidor
        const AudioCtx =
          window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!
        const ctx: AudioContext = new AudioCtx({ latencyHint: 'interactive' })
        audioCtxRef.current = ctx
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => undefined)
        }

        const outGain = ctx.createGain()
        outGain.gain.value = speakerMuted ? 0 : 1
        outGain.connect(ctx.destination)
        outGainRef.current = outGain

        const playback = new KorePlaybackQueue(ctx, outGain, (active) => {
          setKoreSpeaking(active)
        })
        playbackRef.current = playback

        const micPromise =
          typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
            ? navigator.mediaDevices
                .getUserMedia({
                  audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                  }
                })
                .catch(() => null)
            : Promise.resolve(null)

        const sessionResPromise = fetch('/api/phone/live-session', {
          method: 'POST',
          headers: getAuthHeadersRef.current(),
          body: JSON.stringify({ storeId, lang })
        })

        const [micStream, sessionRes] = await Promise.all([micPromise, sessionResPromise])
        if (myGen !== sessionGenRef.current || !mountedRef.current) {
          micStream?.getTracks().forEach((tr) => tr.stop())
          return
        }

        const sessionData = await sessionRes.json().catch(() => null)
        if (!sessionRes.ok || !sessionData?.ok || !sessionData?.wsUrl) {
          throw new Error(sessionData?.error || `HTTP ${sessionRes.status}`)
        }

        callSidRef.current = sessionData.callSid
        startedAtRef.current = Date.now()

        // 2. Conectar AudioWorklet de micrófono si el navegador concedió acceso
        if (micStream && ctx.state !== 'closed') {
          mediaStreamRef.current = micStream
          setHasMicStream(true)
          await loadKoreCaptureWorklet(ctx)
          if (myGen !== sessionGenRef.current || !mountedRef.current) return

          const srcNode = ctx.createMediaStreamSource(micStream)
          const worklet = new AudioWorkletNode(ctx, KORE_CAPTURE_PROCESSOR)
          const mutedSink = ctx.createGain()
          mutedSink.gain.value = 0
          srcNode.connect(worklet)
          worklet.connect(mutedSink)
          mutedSink.connect(ctx.destination)
          workletRef.current = worklet

          worklet.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
            if (myGen !== sessionGenRef.current) return
            const { pcm, rms } = ev.data
            const pct = Math.min(100, Math.round(Math.sqrt(Math.max(0, rms)) * 280))
            if (rmsBarRef.current) rmsBarRef.current.style.width = `${pct}%`

            const ws = wsRef.current
            if (!ws || ws.readyState !== WebSocket.OPEN || micPausedRef.current) return
            if (ws.bufferedAmount > WS_BACKPRESSURE_BYTES) return

            if (micModeRef.current === 'ptt') {
              if (!pttPressedRef.current) return
              const b64 = bytesToBase64(new Uint8Array(pcm))
              ws.send(
                JSON.stringify({
                  realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }
                })
              )
              return
            }

            const gateRes = noiseGateRef.current.process(pcm, rms)
            if (gateRes.speechJustEnded) {
              lastSpeechEndAtRef.current = performance.now()
              awaitingFirstModelAudioRef.current = true
            }
            for (const chunkBuf of gateRes.chunksToSend) {
              const b64 = bytesToBase64(new Uint8Array(chunkBuf))
              ws.send(
                JSON.stringify({
                  realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }
                })
              )
            }
          }
        } else {
          setHasMicStream(false)
        }

        // 3. Abrir WebSocket directo a Gemini 3.8 Live con token efímero bloqueado
        const ws = new WebSocket(sessionData.wsUrl)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        setupTimerRef.current = window.setTimeout(() => {
          if (myGen === sessionGenRef.current && statusRef.current === 'connecting') {
            setErrorMsg('Tiempo de espera agotado conectando con Kore 3.8 Live. Intenta de nuevo.')
            void endCallRef.current()
          }
        }, SETUP_TIMEOUT_MS)

        ws.onopen = () => {
          if (myGen !== sessionGenRef.current) return
          ws.send(JSON.stringify({ setup: sessionData.setup }))
        }

        ws.onmessage = async (ev) => {
          if (myGen !== sessionGenRef.current) return
          interface GeminiLiveServerMsg {
            setupComplete?: unknown
            serverContent?: {
              interrupted?: boolean
              interimInputTranscription?: { text?: string }
              inputTranscription?: { text?: string }
              outputTranscription?: { text?: string }
              turnComplete?: boolean
              modelTurn?: {
                parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>
              }
            }
            toolCall?: {
              functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>
            }
          }
          let msg: GeminiLiveServerMsg
          try {
            const raw =
              typeof ev.data === 'string'
                ? ev.data
                : ev.data instanceof ArrayBuffer
                  ? new TextDecoder('utf-8').decode(ev.data)
                  : new TextDecoder('utf-8').decode(await (ev.data as Blob).arrayBuffer())
            msg = JSON.parse(raw) as GeminiLiveServerMsg
          } catch {
            return
          }

          if ('setupComplete' in msg) {
            setupCompletedForThisSocket = true
            if (setupTimerRef.current !== null) {
              window.clearTimeout(setupTimerRef.current)
              setupTimerRef.current = null
            }
            statusRef.current = 'live'
            setStatus('live')

            const greetingText = String(sessionData.greetingText || '').trim()
            if (greetingText) {
              syncBubbles(() => [
                {
                  id: `greet_${Date.now()}`,
                  role: 'assistant',
                  text: greetingText,
                  timestamp: new Date().toISOString(),
                  latencyMs: sessionData.greetingFromCache ? 35 : undefined,
                  open: false
                }
              ])
            }

            // Si el usuario inició la llamada haciendo clic directo en un escenario rápido, enviarlo tras sembrar el saludo
            const initialScenario = queuedInitialTextRef.current
            queuedInitialTextRef.current = null

            if (sessionData.greetingPcmBase64 && !initialScenario) {
              const pcmBytes = base64ToBytes(sessionData.greetingPcmBase64)
              const floatSamples = decodePcm16ToFloat32(pcmBytes)
              playbackRef.current?.enqueue(floatSamples, Number(sessionData.greetingSampleRate) || 24000)
            }

            if (greetingText) {
              ws.send(
                JSON.stringify({
                  clientContent: {
                    turns: [
                      { role: 'user', parts: [{ text: '[TELEPHONE CALL CONNECTED]' }] },
                      { role: 'model', parts: [{ text: greetingText }] }
                    ],
                    turnComplete: false
                  }
                })
              )
            }

            if (initialScenario) {
              sendTextTurnOverWs(initialScenario)
            }
          }

          const sc = msg?.serverContent
          if (sc) {
            if (sc.interrupted === true) {
              playbackRef.current?.clear()
              pendingAutoHangupRef.current = false
              if (autoHangupTimerRef.current !== null) {
                window.clearTimeout(autoHangupTimerRef.current)
                autoHangupTimerRef.current = null
              }
              closeOpenBubbles('assistant')
            }

            if (sc.interimInputTranscription?.text) {
              setInterimText(String(sc.interimInputTranscription.text))
            }

            if (sc.inputTranscription?.text) {
              setInterimText('')
              appendOrExtendBubble('user', String(sc.inputTranscription.text))
              if (!awaitingFirstModelAudioRef.current) {
                lastSpeechEndAtRef.current = performance.now()
                awaitingFirstModelAudioRef.current = true
              }
            }

            let turnLatencyMs: number | undefined
            const parts = sc.modelTurn?.parts
            if (Array.isArray(parts)) {
              for (const part of parts) {
                const b64 = part?.inlineData?.data
                const mime = String(part?.inlineData?.mimeType || '')
                if (b64 && (!mime || mime.toLowerCase().startsWith('audio/pcm'))) {
                  if (awaitingFirstModelAudioRef.current && lastSpeechEndAtRef.current !== null) {
                    const measured = Math.max(45, Math.round(performance.now() - lastSpeechEndAtRef.current))
                    turnLatencyMs = measured
                    awaitingFirstModelAudioRef.current = false
                    setLatencySamples((prev) => [...prev, measured])
                  }
                  const rate = parsePcmRate(mime, 24000)
                  const samples = decodePcm16ToFloat32(base64ToBytes(b64))
                  playbackRef.current?.enqueue(samples, rate)
                }
              }
            }

            if (sc.outputTranscription?.text) {
              closeOpenBubbles('user')
              appendOrExtendBubble('assistant', String(sc.outputTranscription.text), turnLatencyMs)
            }

            if (sc.turnComplete === true) {
              setInterimText('')
              const lastBubble = bubblesRef.current[bubblesRef.current.length - 1]
              const lastAssistantText = lastBubble?.role === 'assistant' ? lastBubble.text.trim() : ''
              closeOpenBubbles()

              const concluded =
                pendingAutoHangupRef.current ||
                (!lastAssistantText.includes('?') &&
                  /\b(que tengas un excelente d[ií]a|have a wonderful day|gracias por llamar a tacos gavilan|thank you for calling tacos gavilan)\b/i.test(
                    lastAssistantText
                  ))

              if (concluded) {
                const waitMs = Math.min(8000, (playbackRef.current?.remainingMs || 0) + 320)
                if (autoHangupTimerRef.current !== null) window.clearTimeout(autoHangupTimerRef.current)
                autoHangupTimerRef.current = window.setTimeout(() => {
                  if (myGen === sessionGenRef.current && statusRef.current === 'live') {
                    void endCallRef.current({ showEndedBanner: true })
                  }
                }, waitMs)
              }
            }
          }

          const fCalls = msg?.toolCall?.functionCalls
          if (Array.isArray(fCalls) && fCalls.length > 0) {
            closeOpenBubbles('user')
            toolQueueRef.current = toolQueueRef.current.then(async () => {
              if (myGen !== sessionGenRef.current) return
              const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = []
              const recentUser = bubblesRef.current
                .filter((b) => b.role === 'user')
                .slice(-4)
                .map((b) => b.text)
                .join(' | ')

              for (const fc of fCalls) {
                const toolName = String(fc?.name || '')
                const toolArgs = fc?.args && typeof fc.args === 'object' ? fc.args : {}
                setToolsUsed((prev) => (prev.includes(toolName) ? prev : [...prev, toolName]))

                let toolResPayload: Record<string, unknown> = { ok: false }
                try {
                  const res = await fetch('/api/phone/live-tool', {
                    method: 'POST',
                    headers: getAuthHeadersRef.current(),
                    body: JSON.stringify({
                      callSid: callSidRef.current,
                      storeId: activeStoreIdRef.current,
                      lang: activeLangRef.current,
                      toolName,
                      toolArgs,
                      recentUserTranscript: recentUser
                    })
                  })
                  const j = await res.json().catch(() => null)
                  if (j?.response) toolResPayload = j.response
                  if (j?.callbackCreated) {
                    setLastCallback(j.callbackCreated)
                    onDashboardRefreshRef.current()
                  }
                  if (j?.shouldEndCall) {
                    pendingAutoHangupRef.current = true
                  }
                } catch (err: unknown) {
                  toolResPayload = {
                    ok: false,
                    error: err instanceof Error ? err.message : 'tool_error'
                  }
                }

                toolsLogRef.current.push({
                  role: 'tool',
                  toolName,
                  text: JSON.stringify(toolResPayload),
                  timestamp: new Date().toISOString()
                })

                functionResponses.push({
                  id: fc.id,
                  name: toolName,
                  response: toolResPayload
                })
              }

              if (myGen === sessionGenRef.current && wsRef.current === ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ toolResponse: { functionResponses } }))
              }
            })
          }
        }

        ws.onerror = () => {
          console.warn('[KorePhoneLive] WebSocket error during live session')
        }

        ws.onclose = (ev) => {
          if (myGen !== sessionGenRef.current) return
          if (statusRef.current !== 'idle' && !closingSessionRef.current) {
            // Si Gemini cerró antes de completar el handshake (ej. llave 402/1011 o token expirado), reintentar 1 vez en silencio
            if (!setupCompletedForThisSocket && ev.code !== 1000 && connectAttempt < 1) {
              const queuedTxt = queuedInitialTextRef.current || undefined
              void endCallRef.current().then(() => {
                if (mountedRef.current && statusRef.current === 'idle' && sessionGenRef.current === myGen) {
                  void startCall(queuedTxt, connectAttempt + 1)
                }
              })
              return
            }
            if (ev.code !== 1000) {
              setErrorMsg(
                ev.reason
                  ? `Sesión cerrada (${ev.code}): ${ev.reason.slice(0, 120)}`
                  : `La línea en vivo se cerró (${ev.code}).`
              )
            }
            void endCallRef.current()
          }
        }
      } catch (err: unknown) {
        if (myGen !== sessionGenRef.current) return
        statusRef.current = 'idle'
        setStatus('idle')
        teardownMediaAndSocket()
        setErrorMsg(
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo conectar con Kore 3.8 Live.'
        )
      }
    },
    [
      appendOrExtendBubble,
      closeOpenBubbles,
      disabled,
      lang,
      sendTextTurnOverWs,
      speakerMuted,
      storeId,
      syncBubbles,
      teardownMediaAndSocket
    ]
  )

  const handlePressKey9 = useCallback(() => {
    const nextLang: 'es' | 'en' = activeLangRef.current === 'en' ? 'es' : 'en'
    activeLangRef.current = nextLang
    onLangChangeRef.current?.(nextLang)
    const ws = wsRef.current
    if (statusRef.current === 'live' && ws && ws.readyState === WebSocket.OPEN) {
      playbackRef.current?.clear()
      closeOpenBubbles()
      syncBubbles((prev) => [
        ...prev,
        {
          id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text: nextLang === 'en' ? '[Key 9 -> English]' : '[Tecla 9 -> Español]',
          timestamp: new Date().toISOString(),
          open: false
        }
      ])
      const cue =
        nextLang === 'en'
          ? '[CALLER PRESSED 9 TO SWITCH TO ENGLISH] Switch to warm American English immediately and say warmly: Of course, we can continue in English! How can I help you today?'
          : '[EL CLIENTE PRESIONÓ 9 PARA ESPAÑOL] Cambia a español de inmediato y di con calidez: Con gusto continuamos en español. ¿En qué te ayudo hoy?'
      lastSpeechEndAtRef.current = performance.now()
      awaitingFirstModelAudioRef.current = true
      ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: cue }] }],
            turnComplete: true
          }
        })
      )
    }
  }, [closeOpenBubbles, syncBubbles])

  const sendScenarioOrText = useCallback(
    async (text: string) => {
      const clean = text.trim()
      if (!clean) return
      if (statusRef.current === 'live') {
        sendTextTurnOverWs(clean)
        return
      }
      if (statusRef.current === 'idle') {
        await startCall(clean)
      }
    },
    [sendTextTurnOverWs, startCall]
  )

  useImperativeHandle(
    ref,
    () => ({
      sendScenarioOrText,
      endCall: () => endCall({ showEndedBanner: false }),
      isActive: status !== 'idle'
    }),
    [endCall, sendScenarioOrText, status]
  )

  const handleChatSubmit = () => {
    const clean = chatInput.trim()
    if (!clean) return
    setChatInput('')
    void sendScenarioOrText(clean)
  }

  const latencyStats = computeKoreLatencyStats(latencySamples)

  return (
    <div className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden min-h-[580px]">
      {/* Barra superior estilo llamada en vivo Kore 3.8 Live */}
      <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              status === 'live'
                ? 'bg-emerald-400 animate-ping'
                : status === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-slate-500'
            }`}
          />
          <div>
            <div className="text-sm font-black flex items-center gap-2">
              <span>Tacos Gavilan — {storeDisplayName}</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-black tracking-wide">
                KORE 3.8 LIVE
              </span>
            </div>
            <div className="text-xs text-slate-400">
              {status === 'live'
                ? koreSpeaking
                  ? t('phone_agent.live_kore_speaking')
                  : t('phone_agent.live_kore_listening')
                : t('phone_agent.live_engine_subtitle')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {latencyStats.avgLatencyMs !== null && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-black">
              <Zap size={12} />
              {t('phone_agent.live_avg_latency').replace('{ms}', String(latencyStats.avgLatencyMs))}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSpeakerMuted((m) => !m)}
            className={`p-2 rounded-xl border transition ${
              speakerMuted
                ? 'border-rose-500/50 bg-rose-500/20 text-rose-300'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title={speakerMuted ? 'Unmute' : 'Mute'}
          >
            {speakerMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Barra de controles de llamada, micrófono en vivo y medidor acústico RMS */}
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {status === 'idle' ? (
            <button
              type="button"
              onClick={() => void startCall()}
              disabled={disabled}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs shadow-sm transition"
            >
              <PhoneCall size={16} />
              {t('phone_agent.live_start_call_btn')}
            </button>
          ) : status === 'connecting' ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-black text-xs opacity-90"
            >
              <Radio size={16} className="animate-spin" />
              {t('phone_agent.live_connecting_btn')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void endCall({ showEndedBanner: true })}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs shadow-sm transition"
            >
              <PhoneOff size={16} />
              {t('phone_agent.live_hangup_btn')}
            </button>
          )}

          {status === 'live' && hasMicStream && (
            <>
              <button
                type="button"
                onClick={() => setMicPaused((p) => !p)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition ${
                  micPaused
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                }`}
              >
                {micPaused ? <MicOff size={14} /> : <Mic size={14} />}
                {micPaused ? t('phone_agent.live_mic_muted_label') : t('phone_agent.live_barge_in_badge')}
              </button>

              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setMicMode('vad')}
                  className={`px-2.5 py-1.5 transition ${
                    micMode === 'vad'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('phone_agent.live_vad_handsfree')}
                </button>
                <button
                  type="button"
                  onClick={() => setMicMode('ptt')}
                  className={`px-2.5 py-1.5 transition ${
                    micMode === 'ptt'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('phone_agent.live_ptt_mode')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Medidor RMS en vivo */}
        {status === 'live' && hasMicStream && (
          <div className="flex items-center gap-2 min-w-[140px]">
            <Mic size={13} className={micPaused ? 'text-slate-400' : 'text-emerald-600'} />
            <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                ref={rmsBarRef}
                className="h-full bg-emerald-500 transition-[width] duration-75"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        )}
      </div>

      {status === 'live' && micMode === 'ptt' && hasMicStream && (
        <div className="px-5 py-2.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900">
          <button
            type="button"
            onMouseDown={() => setPttPressed(true)}
            onMouseUp={() => {
              setPttPressed(false)
              wsRef.current?.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
              lastSpeechEndAtRef.current = performance.now()
              awaitingFirstModelAudioRef.current = true
            }}
            onTouchStart={() => setPttPressed(true)}
            onTouchEnd={() => {
              setPttPressed(false)
              wsRef.current?.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
              lastSpeechEndAtRef.current = performance.now()
              awaitingFirstModelAudioRef.current = true
            }}
            className={`w-full py-2 rounded-xl font-black text-xs transition ${
              pttPressed
                ? 'bg-rose-600 text-white shadow-inner'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {t('phone_agent.live_ptt_hold_btn')}
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="mx-5 mt-3 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            {errorMsg}
          </span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-rose-600 font-black">
            ×
          </button>
        </div>
      )}

      {/* Transcripción en tiempo real */}
      <div
        ref={scrollContainerRef}
        data-testid="kore-phone-live-transcript"
        className="flex-1 p-5 space-y-3 overflow-y-auto max-h-[430px] bg-slate-50/40 dark:bg-slate-950/20"
      >
        {bubbles.length === 0 && status === 'idle' && (
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
              <PhoneCall size={26} />
            </div>
            <div className="text-sm font-black text-slate-800 dark:text-slate-100 mb-1">
              {t('phone_agent.live_idle_title')}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
              {t('phone_agent.live_idle_desc')}
            </p>
          </div>
        )}

        {bubbles.map((b) => (
          <div
            key={b.id}
            className={`flex ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                b.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-sm'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    b.role === 'user' ? 'text-emerald-100' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {b.role === 'user' ? t('phone_agent.caller_label') : 'Kore 3.8 Live'}
                </span>
                {b.latencyMs !== undefined && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-black">
                    ⚡ {b.latencyMs} ms
                  </span>
                )}
              </div>
              <div className="leading-relaxed whitespace-pre-wrap">{b.text}</div>
            </div>
          </div>
        ))}

        {interimText && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl px-3.5 py-2 text-xs italic bg-emerald-600/70 text-white">
              {interimText}...
            </div>
          </div>
        )}

        {endedNotice && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={14} />
            {endedNotice}
          </div>
        )}
      </div>

      {/* Telemetría de herramientas ejecutadas y recado aislado */}
      {(toolsUsed.length > 0 || lastCallback) && (
        <div className="px-5 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex flex-wrap items-center gap-2 text-xs">
          {toolsUsed.map((tl) => (
            <span
              key={tl}
              className="px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono text-[11px] font-bold"
            >
              🔧 {tl}
            </span>
          ))}
          {lastCallback && (
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[11px]">
              🧪 {t('phone_agent.sim_callback_isolated_badge')} ({lastCallback.caller_name} • {lastCallback.caller_phone})
            </span>
          )}
        </div>
      )}

      {/* Barra inferior de Tecla 9 + Chat escrito directo a Kore 3.8 Live */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePressKey9}
          disabled={disabled}
          className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:border-emerald-500 text-xs font-black text-slate-700 dark:text-slate-200 transition shrink-0"
        >
          #9 • {t('phone_agent.live_press_9_btn')}
        </button>

        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleChatSubmit()
          }}
          placeholder={t('phone_agent.live_text_placeholder')}
          className="flex-1 min-w-[180px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-white"
        />

        <button
          type="button"
          onClick={handleChatSubmit}
          disabled={disabled || !chatInput.trim() || status === 'connecting'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold transition shrink-0"
        >
          <Send size={16} />
          {t('phone_agent.live_send_btn')}
        </button>
      </div>
    </div>
  )
})

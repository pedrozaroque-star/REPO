/**
 * @module components/drive-thru/kore-audio
 * @description Utilidades de audio y señales físicas del navegador (browser audio & HME J1 hardware utilities)
 *   para el simulador "Kore Drive-Thru": captura del micrófono a PCM16 mono 16 kHz vía AudioWorklet, reproducción
 *   sin cortes (gapless playback) del audio PCM16 24 kHz de Gemini Live API, monitoreo secundario de voz de cajera
 *   (`KoreCashierChannelMonitor`) y puente de señales físicas `HME EOS|HD J1` vía Web Serial / USB HID (`KoreHeadsetSignalMonitor`).
 *
 * @businessRules
 * - Entrada hacia Gemini Live: PCM 16-bit signed, mono, 16 000 Hz, little-endian
 *   (`audio/pcm;rate=16000`), en bloques de 512 muestras (= 32 ms) para baja latencia, con
 *   Noise Gate opcional por umbral RMS (con pre-roll de 1 bloque y hangover de ~224 ms) para
 *   silenciar TV/radio o voces lejanas sin recortar consonantes.
 * - Salida de Gemini Live: PCM 16-bit signed, mono, little-endian a 24 000 Hz (se respeta el
 *   `rate=` del mimeType si el servidor manda otro valor), con colchón inicial reducido de 25 ms
 *   (`KORE_INITIAL_JITTER_SEC`) para arranque ultrarrápido sin cortes.
 * - Barge-in y Takeover inmediato: `KorePlaybackQueue.clear()` / `.stop()` detienen TODAS las fuentes
 *   programadas al instante (<1 ms) cuando el cliente interrumpe o cuando la cajera abre su línea `A1`.
 * - Cierre automático sin corte: `KorePlaybackQueue.remainingMs` expone los milisegundos restantes
 *   agendados en `AudioContext` para no cortar jamás la despedida de Kore al cerrar la sesión del auto.
 * - Auto-detección de Cajera en Headset (`A1` — Fase 15):
 *   1. `KoreCashierVadTracker` / `KoreCashierChannelMonitor`: detecta voz sostenida (`RMS >= 0.022` por
 *      `>= 100 ms`, con `600 ms` de hangover) en un micrófono secundario (`cashierDeviceId`) o en el Canal 2
 *      (`Right`, `inputs[0][1]`) de una interfaz USB estéreo (`Behringer UCA202`), mezclando el PCM16 a 16 kHz
 *      sin duplicar muestras cuando es el mismo dispositivo.
 *   2. `KoreHeadsetSignalMonitor`: lee en tienda física el puerto `J1` de la estación base `HME EOS|HD` vía
 *      Web Serial API (`navigator.serial` -> `getSignals().clearToSend` para `J1,2 /A1 Talk` en `<15 ms`, y
 *      `dataSetReady` con debounce para `J1,3–4 Relay 1` detección de vehículo) más respaldo USB HID (`F9`
 *      ignorando inputs editables).
 *
 * @dataFlow
 * - getUserMedia → MediaStreamSource → AudioWorkletNode('kore-pcm16-capture') → port.postMessage
 *   ({ pcm: ArrayBuffer LE, rms, rightRms? }) → componente → base64 → WebSocket `realtimeInput.audio`.
 * - Mic secundario de cajera → `KoreCashierChannelMonitor` → `mixPcm16Buffers` (cuando mic primario transmite)
 *   o `onCashierPcmChunk` directo (cuando mic primario está en pausa) → transcripción continua en Gemini Live.
 * - WebSocket `serverContent.modelTurn.parts[].inlineData` (base64) → `decodePcm16ToFloat32`
 *   → `KorePlaybackQueue.enqueue()` → AudioBufferSourceNode agendado en `AudioContext.currentTime`.
 *
 * @notes
 * - El AudioContext corre a la tasa nativa del dispositivo (44.1/48 kHz). NO se fuerza
 *   `sampleRate: 16000` porque Firefox rechaza conectar un MediaStream de otra tasa; el
 *   downsampling se hace dentro del worklet con un filtro de promedio (box filter / decimación
 *   con anti-aliasing básico) que soporta razones no enteras (44100/16000 = 2.75625) acarreando
 *   la posición fraccional entre bloques.
 * - `loadKoreCaptureWorklet` memoriza cada `AudioContext` en un `WeakSet` para permitir múltiples
 *   nodos `AudioWorkletNode` en el mismo contexto sin relanzar `registerProcessor`.
 * - Little-endian garantizado con `DataView.setInt16(..., true)` / `getInt16(..., true)`.
 */

/** Nombre registrado del procesador AudioWorklet. */
export const KORE_CAPTURE_PROCESSOR = 'kore-pcm16-capture'

/** Tasa objetivo de entrada exigida por Gemini Live API. */
export const KORE_INPUT_SAMPLE_RATE = 16000

/** Tasa por defecto de la salida de audio de Gemini Live API. */
export const KORE_OUTPUT_SAMPLE_RATE = 24000

/** Muestras por bloque enviado (512 @ 16 kHz = 32 ms). */
export const KORE_CHUNK_SAMPLES = 512

/** Colchón inicial (jitter buffer) de reproducción en segundos: 25 ms para respuesta rápida. */
export const KORE_INITIAL_JITTER_SEC = 0.025

/** Umbral RMS por defecto del Noise Gate para bloquear TV/radio de fondo (~ -36 dBFS). */
export const KORE_DEFAULT_NOISE_GATE_RMS = 0.016

/** Bloques de retención (hangover) al bajar del umbral (7 × 32 ms = 224 ms) para no cortar finales de palabra. */
export const KORE_NOISE_GATE_HOLD_CHUNKS = 7

/** Umbral RMS para detección automática de voz en el canal/micrófono secundario de cajera. */
export const KORE_CASHIER_VAD_RMS_THRESHOLD = 0.022

/** Duración mínima sostenida (ms) sobre el umbral RMS para disparar takeover por voz de cajera. */
export const KORE_CASHIER_VAD_MIN_SPEECH_MS = 100

/** Retención (hangover en ms) tras dejar de hablar la cajera para no cortar sílabas finales. */
export const KORE_CASHIER_VAD_HANGOVER_MS = 600

/** Intervalo de sondeo (ms) de señales EIA-232 (`CTS` / `DSR`) sobre Web Serial para respuesta <15 ms. */
export const KORE_SERIAL_POLL_MS = 15

/** Debounce (ms) de llegada de vehículo en `J1,3–4` (`Relay 1` / `DSR`). */
export const KORE_VEHICLE_ARRIVE_DEBOUNCE_MS = 400

/** Debounce (ms) de salida de vehículo en `J1,3–4` (`Relay 1` / `DSR`). */
export const KORE_VEHICLE_DEPART_DEBOUNCE_MS = 1500

/**
 * Código fuente del AudioWorkletProcessor. Se ejecuta en el AudioWorkletGlobalScope, donde
 * `sampleRate` es una variable global con la tasa real del AudioContext. Exportado para pruebas
 * de simulación (se evalúa en Node con un AudioWorkletProcessor falso).
 *
 * Opciones soportadas en `processorOptions`:
 * - `targetRate` (default 16000)
 * - `chunkSamples` (default 512)
 * - `channelMode`: `'mix'` (default, promedia todos los canales), `'left'` (`input[0]`), `'right'` (`input[1]`)
 * - `emitChannelRms`: `boolean` (cuando es `true`, adjunta `rightRms` calculado sobre `input[1]` si hay >=2 canales)
 */
export const KORE_CAPTURE_WORKLET_SOURCE = `
class KorePcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.outRate = opts.targetRate || ${KORE_INPUT_SAMPLE_RATE};
    this.chunkSamples = opts.chunkSamples || ${KORE_CHUNK_SAMPLES};
    this.channelMode = opts.channelMode || 'mix';
    this.emitChannelRms = Boolean(opts.emitChannelRms);
    // Razón de decimación (ej. 48000/16000 = 3, 44100/16000 = 2.75625)
    this.ratio = sampleRate / this.outRate;
    this.acc = 0;
    this.rightAcc = 0;
    this.accCount = 0;
    this.pos = 0;
    this.buffer = new ArrayBuffer(this.chunkSamples * 2);
    this.view = new DataView(this.buffer);
    this.outIdx = 0;
    this.sumSquares = 0;
    this.rightSumSquares = 0;
  }

  emit(sample, rightSample) {
    // Clamp a [-1, 1] y conversión a Int16 con signo (little-endian explícito)
    const s = sample > 1 ? 1 : (sample < -1 ? -1 : sample);
    const rs = rightSample > 1 ? 1 : (rightSample < -1 ? -1 : rightSample);
    const int16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    this.view.setInt16(this.outIdx * 2, int16, true);
    this.sumSquares += s * s;
    this.rightSumSquares += rs * rs;
    this.outIdx++;
    if (this.outIdx >= this.chunkSamples) {
      const rms = Math.sqrt(this.sumSquares / this.chunkSamples);
      const full = this.buffer;
      if (this.emitChannelRms) {
        const rightRms = Math.sqrt(this.rightSumSquares / this.chunkSamples);
        this.port.postMessage({ pcm: full, rms: rms, rightRms: rightRms }, [full]);
      } else {
        this.port.postMessage({ pcm: full, rms: rms }, [full]);
      }
      this.buffer = new ArrayBuffer(this.chunkSamples * 2);
      this.view = new DataView(this.buffer);
      this.outIdx = 0;
      this.sumSquares = 0;
      this.rightSumSquares = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let s = 0;
      if (this.channelMode === 'right') {
        s = channels > 1 && input[1] ? input[1][i] : 0;
      } else if (this.channelMode === 'left') {
        s = input[0][i];
      } else {
        s = input[0][i];
        if (channels > 1) {
          let sum = 0;
          for (let c = 0; c < channels; c++) sum += input[c][i];
          s = sum / channels;
        }
      }
      let r = channels > 1 && input[1] ? input[1][i] : 0;
      if (s !== s) s = 0; // NaN guard
      if (r !== r) r = 0;
      this.acc += s;
      this.rightAcc += r;
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        const avg = this.accCount > 0 ? this.acc / this.accCount : s;
        const rightAvg = this.accCount > 0 ? this.rightAcc / this.accCount : r;
        this.acc = 0;
        this.rightAcc = 0;
        this.accCount = 0;
        while (this.pos >= this.ratio) {
          this.pos -= this.ratio;
          this.emit(avg, rightAvg);
        }
      }
    }
    return true;
  }
}
registerProcessor('${KORE_CAPTURE_PROCESSOR}', KorePcm16Capture);
`

const registeredWorkletContexts = new WeakSet<AudioContext>()

/** Registra el worklet de captura en el AudioContext indicado (idempotente por contexto, Blob URL revocada). */
export async function loadKoreCaptureWorklet(ctx: AudioContext): Promise<void> {
    if (registeredWorkletContexts.has(ctx)) return
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
        throw new Error('AUDIO_WORKLET_UNSUPPORTED')
    }
    const blob = new Blob([KORE_CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
        await ctx.audioWorklet.addModule(url)
        registeredWorkletContexts.add(ctx)
    } finally {
        URL.revokeObjectURL(url)
    }
}

/** Codifica bytes a base64 en bloques (evita `Maximum call stack` con buffers grandes). */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    const step = 0x2000
    for (let i = 0; i < bytes.length; i += step) {
        const slice = bytes.subarray(i, Math.min(i + step, bytes.length))
        binary += String.fromCharCode.apply(null, Array.from(slice))
    }
    return btoa(binary)
}

/** Decodifica base64 a bytes. Devuelve arreglo vacío si el texto es inválido. */
export function base64ToBytes(b64: string): Uint8Array {
    try {
        const binary = atob(b64)
        const out = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
        return out
    } catch {
        return new Uint8Array(0)
    }
}

/** Convierte PCM16 little-endian a Float32 [-1, 1). Ignora un byte final impar. */
export function decodePcm16ToFloat32(bytes: Uint8Array): Float32Array {
    const samples = Math.floor(bytes.byteLength / 2)
    const out = new Float32Array(samples)
    const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2)
    for (let i = 0; i < samples; i++) {
        out[i] = view.getInt16(i * 2, true) / 32768
    }
    return out
}

/**
 * Mezcla dos bloques PCM16 little-endian a 16 kHz muestra por muestra con saturación suave
 * (`[-32768, 32767]`), manteniendo intacta la cadencia de reloj de `realtimeInput.audio`.
 */
export function mixPcm16Buffers(primary: ArrayBuffer, secondary: ArrayBuffer): ArrayBuffer {
    if (secondary.byteLength === 0) return primary
    if (primary.byteLength === 0) return secondary
    const samples = Math.floor(Math.max(primary.byteLength, secondary.byteLength) / 2)
    const pSamples = Math.floor(primary.byteLength / 2)
    const sSamples = Math.floor(secondary.byteLength / 2)
    const out = new ArrayBuffer(samples * 2)
    const pView = new DataView(primary)
    const sView = new DataView(secondary)
    const oView = new DataView(out)
    for (let i = 0; i < samples; i++) {
        const a = i < pSamples ? pView.getInt16(i * 2, true) : 0
        const b = i < sSamples ? sView.getInt16(i * 2, true) : 0
        const sum = a + b
        const clamped = sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum
        oView.setInt16(i * 2, clamped, true)
    }
    return out
}

/** Extrae la tasa de muestreo de un mimeType tipo `audio/pcm;rate=24000`. */
export function parsePcmRate(mimeType: string | undefined | null, fallback = KORE_OUTPUT_SAMPLE_RATE): number {
    if (!mimeType) return fallback
    const match = /rate=(\d+)/i.exec(mimeType)
    const rate = match ? Number(match[1]) : NaN
    return Number.isFinite(rate) && rate >= 3000 && rate <= 192000 ? rate : fallback
}

/**
 * Cola de reproducción sin cortes: agenda cada bloque exactamente al terminar el anterior
 * usando el reloj del AudioContext. `clear()` / `stop()` implementan barge-in y silenciamiento instantáneo.
 */
export class KorePlaybackQueue {
    private ctx: AudioContext
    private output: AudioNode
    private playHead = 0
    private sources = new Set<AudioBufferSourceNode>()
    private onActiveChange: (active: boolean) => void

    constructor(ctx: AudioContext, output: AudioNode, onActiveChange: (active: boolean) => void) {
        this.ctx = ctx
        this.output = output
        this.onActiveChange = onActiveChange
    }

    get isActive(): boolean {
        return this.sources.size > 0
    }

    /** Milisegundos restantes de audio agendado en el reloj del AudioContext (0 si no hay reproducción). */
    get remainingMs(): number {
        return this.ctx.state === 'closed' || this.sources.size === 0
            ? 0
            : Math.max(0, Math.round((this.playHead - this.ctx.currentTime) * 1000))
    }

    enqueue(samples: Float32Array, sampleRate: number): void {
        if (samples.length === 0 || this.ctx.state === 'closed') return
        const buffer = this.ctx.createBuffer(1, samples.length, sampleRate)
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
        const src = this.ctx.createBufferSource()
        src.buffer = buffer
        src.connect(this.output)
        const now = this.ctx.currentTime
        // Colchón inicial reducido de 25 ms cuando la cola estaba vacía
        if (this.playHead < now + 0.008) this.playHead = now + KORE_INITIAL_JITTER_SEC
        src.start(this.playHead)
        this.playHead += buffer.duration
        const wasActive = this.sources.size > 0
        this.sources.add(src)
        if (!wasActive) this.onActiveChange(true)
        src.onended = () => {
            src.disconnect()
            if (this.sources.delete(src) && this.sources.size === 0) this.onActiveChange(false)
        }
    }

    /** Detiene y vacía todo lo programado (barge-in / takeover de cajera / fin de sesión). */
    clear(): void {
        const hadSources = this.sources.size > 0
        for (const src of this.sources) {
            src.onended = null
            try { src.stop() } catch { /* ya detenida */ }
            try { src.disconnect() } catch { /* ya desconectada */ }
        }
        this.sources.clear()
        this.playHead = 0
        if (hadSources) this.onActiveChange(false)
    }

    /** Alias semántico de `clear()` para silenciar de inmediato la voz de Kore al abrir línea `A1`. */
    stop(): void {
        this.clear()
    }
}

export interface KoreNoiseGateResult {
    chunksToSend: ArrayBuffer[]
    effectiveRms: number
    gated: boolean
    speechActive: boolean
    speechJustEnded: boolean
}

/**
 * Filtro anti-ruido (Noise Gate) por umbral RMS con 1 bloque de pre-roll (32 ms) y retención
 * (hangover) para ignorar TV/radio/conversaciones lejanas enviando silencio digital puro (0 PCM16)
 * cuando el entorno está por debajo del umbral de voz cercana.
 */
export class KoreNoiseGate {
    private enabled: boolean
    private threshold: number
    private holdChunks: number
    private holdRemaining = 0
    private open = false
    private preRoll: ArrayBuffer | null = null
    private silenceCache = new Map<number, ArrayBuffer>()

    constructor(opts?: { enabled?: boolean; threshold?: number; holdChunks?: number }) {
        this.enabled = opts?.enabled !== false
        this.threshold =
            typeof opts?.threshold === 'number' && Number.isFinite(opts.threshold) && opts.threshold >= 0
                ? opts.threshold
                : KORE_DEFAULT_NOISE_GATE_RMS
        this.holdChunks =
            typeof opts?.holdChunks === 'number' && Number.isInteger(opts.holdChunks) && opts.holdChunks >= 0
                ? opts.holdChunks
                : KORE_NOISE_GATE_HOLD_CHUNKS
    }

    get isEnabled(): boolean {
        return this.enabled
    }

    get isOpen(): boolean {
        return this.open
    }

    get thresholdRms(): number {
        return this.threshold
    }

    setEnabled(enabled: boolean): void {
        this.enabled = Boolean(enabled)
        if (!this.enabled) {
            this.preRoll = null
            this.holdRemaining = 0
        }
    }

    setThreshold(rms: number): void {
        if (Number.isFinite(rms) && rms >= 0 && rms <= 0.5) {
            this.threshold = rms
        }
    }

    reset(): void {
        this.open = false
        this.holdRemaining = 0
        this.preRoll = null
    }

    private getSilence(byteLength: number): ArrayBuffer {
        let buf = this.silenceCache.get(byteLength)
        if (!buf) {
            buf = new ArrayBuffer(byteLength)
            this.silenceCache.set(byteLength, buf)
        }
        return buf
    }

    process(pcm: ArrayBuffer, rms: number): KoreNoiseGateResult {
        const safeRms = Number.isFinite(rms) && rms >= 0 ? rms : 0
        if (!this.enabled || this.threshold <= 0) {
            const active = safeRms >= KORE_DEFAULT_NOISE_GATE_RMS
            const speechJustEnded = this.open && !active
            this.open = active
            return {
                chunksToSend: [pcm],
                effectiveRms: safeRms,
                gated: false,
                speechActive: active,
                speechJustEnded,
            }
        }

        if (safeRms >= this.threshold) {
            const chunksToSend = !this.open && this.preRoll ? [this.preRoll, pcm] : [pcm]
            this.preRoll = null
            this.open = true
            this.holdRemaining = this.holdChunks
            return {
                chunksToSend,
                effectiveRms: safeRms,
                gated: false,
                speechActive: true,
                speechJustEnded: false,
            }
        }

        if (this.open && this.holdRemaining > 0) {
            this.holdRemaining -= 1
            return {
                chunksToSend: [pcm],
                effectiveRms: safeRms,
                gated: false,
                speechActive: true,
                speechJustEnded: false,
            }
        }

        const speechJustEnded = this.open
        this.open = false
        this.preRoll = pcm.slice(0)
        return {
            chunksToSend: [this.getSilence(pcm.byteLength)],
            effectiveRms: 0,
            gated: true,
            speechActive: false,
            speechJustEnded,
        }
    }
}

export interface KoreCashierVadStep {
    speaking: boolean
    changed: boolean
    rms: number
}

/**
 * Detector determinista de actividad de voz (VAD) para el canal dedicado de cajera:
 * exige `RMS >= 0.022` sostenido por `>= 100 ms` antes de activar `speaking = true`, y mantiene
 * `600 ms` de hangover al caer debajo del umbral para no truncar finales de frase.
 */
export class KoreCashierVadTracker {
    private threshold: number
    private minSpeechMs: number
    private hangoverMs: number
    private sustainedAboveMs = 0
    private hangoverRemainingMs = 0
    private speaking = false

    constructor(opts?: { threshold?: number; minSpeechMs?: number; hangoverMs?: number }) {
        this.threshold =
            typeof opts?.threshold === 'number' && Number.isFinite(opts.threshold) && opts.threshold > 0
                ? opts.threshold
                : KORE_CASHIER_VAD_RMS_THRESHOLD
        this.minSpeechMs =
            typeof opts?.minSpeechMs === 'number' && Number.isFinite(opts.minSpeechMs) && opts.minSpeechMs >= 0
                ? opts.minSpeechMs
                : KORE_CASHIER_VAD_MIN_SPEECH_MS
        this.hangoverMs =
            typeof opts?.hangoverMs === 'number' && Number.isFinite(opts.hangoverMs) && opts.hangoverMs >= 0
                ? opts.hangoverMs
                : KORE_CASHIER_VAD_HANGOVER_MS
    }

    get isSpeaking(): boolean {
        return this.speaking
    }

    reset(): void {
        this.sustainedAboveMs = 0
        this.hangoverRemainingMs = 0
        this.speaking = false
    }

    process(rms: number, chunkDurationMs = (KORE_CHUNK_SAMPLES / KORE_INPUT_SAMPLE_RATE) * 1000): KoreCashierVadStep {
        const safeRms = Number.isFinite(rms) && rms >= 0 ? rms : 0
        const dt = Number.isFinite(chunkDurationMs) && chunkDurationMs > 0 ? chunkDurationMs : 32

        if (safeRms >= this.threshold) {
            this.sustainedAboveMs += dt
            if (!this.speaking) {
                if (this.sustainedAboveMs >= this.minSpeechMs) {
                    this.speaking = true
                    this.hangoverRemainingMs = this.hangoverMs
                    return { speaking: true, changed: true, rms: safeRms }
                }
                return { speaking: false, changed: false, rms: safeRms }
            }
            this.hangoverRemainingMs = this.hangoverMs
            return { speaking: true, changed: false, rms: safeRms }
        }

        this.sustainedAboveMs = 0
        if (this.speaking) {
            this.hangoverRemainingMs = Math.max(0, this.hangoverRemainingMs - dt)
            if (this.hangoverRemainingMs <= 0) {
                this.speaking = false
                return { speaking: false, changed: true, rms: safeRms }
            }
            return { speaking: true, changed: false, rms: safeRms }
        }

        return { speaking: false, changed: false, rms: safeRms }
    }
}

export type KoreCashierMonitorMode = 'device' | 'stereo_right'

export interface KoreCashierChannelMonitorOptions {
    mode: KoreCashierMonitorMode
    /** ID del micrófono secundario de cajera cuando `mode === 'device'`. */
    cashierDeviceId?: string
    /** ID del micrófono primario para impedir duplicar el audio si ambos apuntan al mismo dispositivo. */
    primaryDeviceId?: string | null
    /** AudioContext compartido de la sesión viva (necesario cuando `mode === 'device'` o se adjunta `stereoStream`). */
    ctx?: AudioContext
    /** Stream estéreo opcional si se desea abrir un nodo `channelMode: 'right'` independiente sobre `inputs[0][1]`. */
    stereoStream?: MediaStream | null
    threshold?: number
    minSpeechMs?: number
    hangoverMs?: number
    onCashierVoiceState?: (speaking: boolean, rms: number) => void
    /** Recibe bloques PCM16 16 kHz únicamente cuando provienen de un micrófono separado (`!isSameDevice`). */
    onCashierPcmChunk?: (pcm: ArrayBuffer, rms: number) => void
}

const MAX_CASHIER_PREROLL_CHUNKS = 4
const MAX_CASHIER_PENDING_MIX_CHUNKS = 10

/**
 * Monitor del canal secundario de cajera (micrófono dedicado en PC/tienda o Canal 2 `Right` de interfaz USB estéreo):
 * - Detecta voz sostenida (`RMS >= 0.022` por `>= 100 ms`, `600 ms` hangover) y dispara `onCashierVoiceState` automáticamente.
 * - Cuando proviene de un micrófono separado (`mode === 'device'` y `cashierDeviceId !== primaryDeviceId`),
 *   convierte su audio a `16 kHz PCM16` con pre-roll de ~128 ms y lo expone tanto vía cola de mezcla (`popPendingPcm`)
 *   como vía callback `onCashierPcmChunk` para que Gemini transcriba toda la intervención sin duplicar canales.
 */
export class KoreCashierChannelMonitor {
    private opts: KoreCashierChannelMonitorOptions
    private vad: KoreCashierVadTracker
    private stream: MediaStream | null = null
    private sourceNode: MediaStreamAudioSourceNode | null = null
    private workletNode: AudioWorkletNode | null = null
    private sinkNode: GainNode | null = null
    private preRollQueue: ArrayBuffer[] = []
    private pendingMixQueue: ArrayBuffer[] = []
    private duplicateDevice = false
    private stopped = false

    constructor(opts: KoreCashierChannelMonitorOptions) {
        this.opts = opts
        this.vad = new KoreCashierVadTracker({
            threshold: opts.threshold,
            minSpeechMs: opts.minSpeechMs,
            hangoverMs: opts.hangoverMs,
        })
    }

    get isSpeaking(): boolean {
        return this.vad.isSpeaking
    }

    get isDuplicateDevice(): boolean {
        return this.duplicateDevice
    }

    get pendingMixChunksCount(): number {
        return this.pendingMixQueue.length
    }

    /** Inicia la captura secundaria si `mode === 'device'` o si se pasa un `stereoStream` explícito. */
    async start(): Promise<void> {
        this.stopped = false
        this.vad.reset()
        this.preRollQueue = []
        this.pendingMixQueue = []

        if (this.opts.mode === 'stereo_right') {
            this.duplicateDevice = true // El canal Right ya entra al mix principal o se mide por separado
            if (this.opts.ctx && this.opts.stereoStream) {
                await loadKoreCaptureWorklet(this.opts.ctx)
                if (this.stopped) return
                const source = this.opts.ctx.createMediaStreamSource(this.opts.stereoStream)
                const node = new AudioWorkletNode(this.opts.ctx, KORE_CAPTURE_PROCESSOR, {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'speakers',
                    processorOptions: {
                        targetRate: KORE_INPUT_SAMPLE_RATE,
                        chunkSamples: KORE_CHUNK_SAMPLES,
                        channelMode: 'right',
                    },
                })
                const sink = this.opts.ctx.createGain()
                sink.gain.value = 0
                node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
                    if (this.stopped || !ev.data) return
                    const samples = Math.max(1, Math.floor((ev.data.pcm?.byteLength ?? KORE_CHUNK_SAMPLES * 2) / 2))
                    const durationMs = (samples / KORE_INPUT_SAMPLE_RATE) * 1000
                    this.feedRightChannelRms(ev.data.rms, durationMs)
                }
                source.connect(node)
                node.connect(sink)
                sink.connect(this.opts.ctx.destination)
                this.sourceNode = source
                this.workletNode = node
                this.sinkNode = sink
            }
            return
        }

        const deviceId = (this.opts.cashierDeviceId ?? '').trim()
        if (!deviceId || !this.opts.ctx) return
        if (this.opts.primaryDeviceId && this.opts.primaryDeviceId === deviceId) {
            this.duplicateDevice = true
            return
        }
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('MEDIA_DEVICES_UNSUPPORTED')
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
            },
        })
        if (this.stopped) {
            stream.getTracks().forEach(t => t.stop())
            return
        }
        const openedTrackId = stream.getAudioTracks()[0]?.getSettings?.()?.deviceId ?? null
        this.duplicateDevice = Boolean(this.opts.primaryDeviceId && openedTrackId && openedTrackId === this.opts.primaryDeviceId)
        this.stream = stream

        await loadKoreCaptureWorklet(this.opts.ctx)
        if (this.stopped) {
            stream.getTracks().forEach(t => t.stop())
            this.stream = null
            return
        }

        const source = this.opts.ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(this.opts.ctx, KORE_CAPTURE_PROCESSOR, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
            processorOptions: { targetRate: KORE_INPUT_SAMPLE_RATE, chunkSamples: KORE_CHUNK_SAMPLES },
        })
        const sink = this.opts.ctx.createGain()
        sink.gain.value = 0
        node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
            if (this.stopped || !ev.data || !(ev.data.pcm instanceof ArrayBuffer)) return
            this.ingestDeviceChunk(ev.data.pcm, ev.data.rms)
        }
        source.connect(node)
        node.connect(sink)
        sink.connect(this.opts.ctx.destination)
        this.sourceNode = source
        this.workletNode = node
        this.sinkNode = sink
    }

    /** Procesa RMS del Canal 2 (`Right`, `inputs[0][1]`) reportado por una interfaz USB estéreo. */
    feedRightChannelRms(rms: number, chunkDurationMs = (KORE_CHUNK_SAMPLES / KORE_INPUT_SAMPLE_RATE) * 1000): KoreCashierVadStep {
        const step = this.vad.process(rms, chunkDurationMs)
        if (step.changed) {
            this.opts.onCashierVoiceState?.(step.speaking, step.rms)
        }
        return step
    }

    /** Inyecta un bloque PCM16 16 kHz proveniente del micrófono secundario de cajera (usable directo en pruebas). */
    ingestDeviceChunk(pcm: ArrayBuffer, rms: number): KoreCashierVadStep {
        const samples = Math.max(1, Math.floor(pcm.byteLength / 2))
        const durationMs = (samples / KORE_INPUT_SAMPLE_RATE) * 1000
        const wasSpeaking = this.vad.isSpeaking
        const step = this.vad.process(rms, durationMs)

        if (step.changed) {
            this.opts.onCashierVoiceState?.(step.speaking, step.rms)
        }

        if (this.duplicateDevice) {
            this.preRollQueue = []
            return step
        }

        if (step.speaking) {
            if (!wasSpeaking && this.preRollQueue.length > 0) {
                for (const pre of this.preRollQueue) {
                    this.enqueueCashierPcm(pre, step.rms)
                }
                this.preRollQueue = []
            }
            this.enqueueCashierPcm(pcm, step.rms)
        } else if (rms >= (this.opts.threshold ?? KORE_CASHIER_VAD_RMS_THRESHOLD)) {
            this.preRollQueue.push(pcm.slice(0))
            if (this.preRollQueue.length > MAX_CASHIER_PREROLL_CHUNKS) {
                this.preRollQueue.shift()
            }
        } else {
            this.preRollQueue = []
        }

        return step
    }

    private enqueueCashierPcm(pcm: ArrayBuffer, rms: number): void {
        const copy = pcm.slice(0)
        this.pendingMixQueue.push(copy)
        if (this.pendingMixQueue.length > MAX_CASHIER_PENDING_MIX_CHUNKS) {
            this.pendingMixQueue.shift()
        }
        this.opts.onCashierPcmChunk?.(copy, rms)
    }

    /** Extrae el siguiente bloque PCM16 16 kHz pendiente para mezclarlo con el reloj del mic primario. */
    popPendingPcm(): ArrayBuffer | null {
        return this.pendingMixQueue.shift() ?? null
    }

    /** Vacía la cola de mezcla (p. ej. cuando el mic primario está en pausa y se envía directo por `onCashierPcmChunk`). */
    clearPendingPcm(): void {
        this.pendingMixQueue = []
    }

    stop(): void {
        this.stopped = true
        const wasSpeaking = this.vad.isSpeaking
        this.vad.reset()
        this.preRollQueue = []
        this.pendingMixQueue = []
        if (this.workletNode) {
            this.workletNode.port.onmessage = null
            try { this.workletNode.disconnect() } catch { /* noop */ }
            this.workletNode = null
        }
        if (this.sourceNode) {
            try { this.sourceNode.disconnect() } catch { /* noop */ }
            this.sourceNode = null
        }
        if (this.sinkNode) {
            try { this.sinkNode.disconnect() } catch { /* noop */ }
            this.sinkNode = null
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop())
            this.stream = null
        }
        if (wasSpeaking) {
            this.opts.onCashierVoiceState?.(false, 0)
        }
    }
}

export interface KoreSerialInputSignals {
    clearToSend?: boolean
    dataSetReady?: boolean
    ringIndicator?: boolean
    dataCarrierDetect?: boolean
}

export interface KoreSerialPortLike {
    open(options: { baudRate: number }): Promise<void>
    close(): Promise<void>
    getSignals(): Promise<KoreSerialInputSignals>
}

export type KoreHeadsetSignalOrigin = 'serial_cts' | 'hid_key'

export interface KoreHeadsetSignalMonitorOptions {
    /** Código/tecla HID para disparo físico o respaldo de teclado (por defecto `'F9'`). */
    shortcutKey?: string
    /** Invierte la lectura lógica de `CTS` (`J1,2 /A1 Talk`) para adaptadores TTL sin inversor EIA-232. */
    invertCts?: boolean
    /** Invierte la lectura lógica de `DSR` (`J1,3–4 Relay 1` presencia de auto). */
    invertDsr?: boolean
    pollIntervalMs?: number
    vehicleArriveDebounceMs?: number
    vehicleDepartDebounceMs?: number
    onHeadsetTalkChange?: (active: boolean, origin: KoreHeadsetSignalOrigin) => void
    onVehiclePresenceChange?: (present: boolean) => void
    onSerialStatusChange?: (connected: boolean, errorMessage?: string) => void
}

/** Verifica si el navegador actual expone Web Serial API (`navigator.serial`, Chrome/Edge en contexto seguro). */
export function isKoreWebSerialSupported(): boolean {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as unknown as { serial?: { requestPort?: unknown } }
    return Boolean(nav.serial && typeof nav.serial.requestPort === 'function')
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object') return false
    const el = target as { tagName?: unknown; isContentEditable?: unknown }
    if (el.isContentEditable === true) return true
    const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Puente físico ligero para el conector `J1` de la estación base `HME EOS|HD`:
 * - **Web Serial (`navigator.serial`)**: sondea `getSignals()` cada 15 ms leyendo `clearToSend` (`J1,2 /A1 Talk`)
 *   para silenciar a Kore en `<15 ms` al hablar la cajera, y `dataSetReady` (`J1,3–4 Relay 1`) con debounce
 *   de llegada (`400 ms`) y salida (`1500 ms`) de vehículo.
 * - **Teclado / Pedal USB HID (`F9`)**: detecta cierre de contacto mapeado a `F9` (o pulsación de respaldo)
 *   siempre que el foco no esté en un `input`/`textarea`/`select`.
 */
export class KoreHeadsetSignalMonitor {
    private opts: KoreHeadsetSignalMonitorOptions
    private port: KoreSerialPortLike | null = null
    private pollTimer: ReturnType<typeof setInterval> | null = null
    private pollInFlight = false
    private serialTalkActive = false
    private keyTalkActive = false
    private combinedTalkActive = false
    private vehiclePresent: boolean | null = null
    private vehicleCandidate: boolean | null = null
    private vehicleCandidateSinceMs = 0
    private keyTarget: EventTarget | null = null
    private boundKeyDown: ((ev: Event) => void) | null = null
    private boundKeyUp: ((ev: Event) => void) | null = null
    private boundBlur: (() => void) | null = null

    constructor(opts?: KoreHeadsetSignalMonitorOptions) {
        this.opts = opts ?? {}
    }

    get isSerialConnected(): boolean {
        return this.port !== null
    }

    get isHeadsetTalkActive(): boolean {
        return this.combinedTalkActive
    }

    get isVehiclePresent(): boolean {
        return this.vehiclePresent === true
    }

    private get shortcutKey(): string {
        return this.opts.shortcutKey || 'F9'
    }

    private updateCombinedTalk(origin: KoreHeadsetSignalOrigin): void {
        const next = this.serialTalkActive || this.keyTalkActive
        if (next === this.combinedTalkActive) return
        this.combinedTalkActive = next
        this.opts.onHeadsetTalkChange?.(next, origin)
    }

    /** Adjunta escuchas de teclado/HID (`F9` por defecto) sobre `window` o el `EventTarget` indicado. */
    attachKeyboard(target?: EventTarget | null): void {
        this.detachKeyboard()
        const tgt = target ?? (typeof window !== 'undefined' ? window : null)
        if (!tgt || typeof tgt.addEventListener !== 'function') return

        this.boundKeyDown = (rawEv: Event) => {
            const ev = rawEv as KeyboardEvent
            if (ev.key !== this.shortcutKey && ev.code !== this.shortcutKey) return
            if (isEditableKeyboardTarget(ev.target)) return
            if (typeof ev.preventDefault === 'function') ev.preventDefault()
            if (ev.repeat) return
            this.keyTalkActive = true
            this.updateCombinedTalk('hid_key')
        }

        this.boundKeyUp = (rawEv: Event) => {
            const ev = rawEv as KeyboardEvent
            if (ev.key !== this.shortcutKey && ev.code !== this.shortcutKey) return
            if (!this.keyTalkActive) return
            if (typeof ev.preventDefault === 'function') ev.preventDefault()
            this.keyTalkActive = false
            this.updateCombinedTalk('hid_key')
        }

        this.boundBlur = () => {
            if (!this.keyTalkActive) return
            this.keyTalkActive = false
            this.updateCombinedTalk('hid_key')
        }

        tgt.addEventListener('keydown', this.boundKeyDown)
        tgt.addEventListener('keyup', this.boundKeyUp)
        tgt.addEventListener('blur', this.boundBlur)
        this.keyTarget = tgt
    }

    detachKeyboard(): void {
        if (this.keyTarget) {
            if (this.boundKeyDown) this.keyTarget.removeEventListener('keydown', this.boundKeyDown)
            if (this.boundKeyUp) this.keyTarget.removeEventListener('keyup', this.boundKeyUp)
            if (this.boundBlur) this.keyTarget.removeEventListener('blur', this.boundBlur)
        }
        this.keyTarget = null
        this.boundKeyDown = null
        this.boundKeyUp = null
        this.boundBlur = null
        if (this.keyTalkActive) {
            this.keyTalkActive = false
            this.updateCombinedTalk('hid_key')
        }
    }

    /** Abre un puerto Web Serial (o usa `portOverride` en pruebas) e inicia el sondeo de `CTS` y `DSR`. */
    async connectSerialPort(portOverride?: KoreSerialPortLike): Promise<void> {
        await this.disconnectSerialPort()
        let selectedPort = portOverride ?? null
        if (!selectedPort) {
            if (!isKoreWebSerialSupported()) {
                throw new Error('WEB_SERIAL_UNSUPPORTED')
            }
            const nav = navigator as unknown as { serial: { requestPort: () => Promise<KoreSerialPortLike> } }
            selectedPort = await nav.serial.requestPort()
        }
        await selectedPort.open({ baudRate: 9600 })
        this.port = selectedPort
        this.vehiclePresent = null
        this.vehicleCandidate = null
        this.vehicleCandidateSinceMs = 0
        this.opts.onSerialStatusChange?.(true)

        const intervalMs = Math.max(8, this.opts.pollIntervalMs ?? KORE_SERIAL_POLL_MS)
        await this.pollSerialOnce(Date.now())
        this.pollTimer = setInterval(() => {
            void this.pollSerialOnce(Date.now())
        }, intervalMs)
    }

    /** Ejecuta una lectura puntual de `getSignals()` (expuesta también para simulación determinista con reloj). */
    async pollSerialOnce(nowMs = Date.now()): Promise<void> {
        if (!this.port || this.pollInFlight) return
        this.pollInFlight = true
        try {
            const sig = await this.port.getSignals()
            this.applySerialSignals(sig, nowMs)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            await this.disconnectSerialPort()
            this.opts.onSerialStatusChange?.(false, msg)
        } finally {
            this.pollInFlight = false
        }
    }

    /** Procesa directamente una muestra de señales `CTS`/`DSR` con reloj explícito (`nowMs`). */
    applySerialSignals(sig: KoreSerialInputSignals, nowMs = Date.now()): void {
        const rawCts = Boolean(sig.clearToSend)
        const talkActive = this.opts.invertCts ? !rawCts : rawCts
        if (talkActive !== this.serialTalkActive) {
            this.serialTalkActive = talkActive
            this.updateCombinedTalk('serial_cts')
        }

        if (typeof sig.dataSetReady === 'boolean') {
            const rawDsr = Boolean(sig.dataSetReady)
            const presentSample = this.opts.invertDsr ? !rawDsr : rawDsr
            if (this.vehiclePresent === null) {
                this.vehiclePresent = presentSample
                this.vehicleCandidate = null
                this.vehicleCandidateSinceMs = 0
                if (presentSample) {
                    this.opts.onVehiclePresenceChange?.(true)
                }
                return
            }
            if (presentSample === this.vehiclePresent) {
                this.vehicleCandidate = null
                this.vehicleCandidateSinceMs = 0
                return
            }
            if (this.vehicleCandidate !== presentSample) {
                this.vehicleCandidate = presentSample
                this.vehicleCandidateSinceMs = nowMs
                return
            }
            const requiredMs = presentSample
                ? (this.opts.vehicleArriveDebounceMs ?? KORE_VEHICLE_ARRIVE_DEBOUNCE_MS)
                : (this.opts.vehicleDepartDebounceMs ?? KORE_VEHICLE_DEPART_DEBOUNCE_MS)
            if (nowMs - this.vehicleCandidateSinceMs >= requiredMs) {
                this.vehiclePresent = presentSample
                this.vehicleCandidate = null
                this.vehicleCandidateSinceMs = 0
                this.opts.onVehiclePresenceChange?.(presentSample)
            }
        }
    }

    async disconnectSerialPort(): Promise<void> {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer)
            this.pollTimer = null
        }
        const activePort = this.port
        this.port = null
        const hadSerialTalk = this.serialTalkActive
        this.serialTalkActive = false
        this.vehiclePresent = null
        this.vehicleCandidate = null
        this.vehicleCandidateSinceMs = 0
        if (hadSerialTalk) {
            this.updateCombinedTalk('serial_cts')
        }
        if (activePort) {
            try { await activePort.close() } catch { /* noop */ }
            this.opts.onSerialStatusChange?.(false)
        }
    }

    /** Limpieza total síncrona/asíncrona al desmontar el simulador. */
    stop(): void {
        this.detachKeyboard()
        void this.disconnectSerialPort()
    }
}

export interface KoreLatencyStats {
    lastMs: number | null
    avgLatencyMs: number | null
    p95LatencyMs: number | null
    turnCount: number
}

/** Calcula promedio y percentil 95 (nearest-rank) de latencias de turno en milisegundos enteros. */
export function computeKoreLatencyStats(samplesMs: number[]): KoreLatencyStats {
    const clean = samplesMs
        .filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
        .map(n => Math.round(n))
    if (clean.length === 0) {
        return { lastMs: null, avgLatencyMs: null, p95LatencyMs: null, turnCount: 0 }
    }
    const sum = clean.reduce((acc, v) => acc + v, 0)
    const sorted = [...clean].sort((a, b) => a - b)
    const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))
    return {
        lastMs: clean[clean.length - 1],
        avgLatencyMs: Math.round(sum / clean.length),
        p95LatencyMs: sorted[p95Idx],
        turnCount: clean.length,
    }
}

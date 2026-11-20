/**
 * @module components/drive-thru/kore-audio
 * @description Utilidades de audio del navegador (browser audio utilities) para el simulador
 *   "Kore Drive-Thru": captura del micrófono a PCM16 mono 16 kHz vía AudioWorklet y reproducción
 *   sin cortes (gapless playback) del audio PCM16 24 kHz que devuelve Gemini Live API.
 *
 * @businessRules
 * - Entrada hacia Gemini Live: PCM 16-bit signed, mono, 16 000 Hz, little-endian
 *   (`audio/pcm;rate=16000`), en bloques de 512 muestras (= 32 ms) para baja latencia, con
 *   Noise Gate opcional por umbral RMS (con pre-roll de 1 bloque y hangover de ~224 ms) para
 *   silenciar TV/radio o voces lejanas sin recortar consonantes.
 * - Salida de Gemini Live: PCM 16-bit signed, mono, little-endian a 24 000 Hz (se respeta el
 *   `rate=` del mimeType si el servidor manda otro valor), con colchón inicial reducido de 25 ms
 *   (`KORE_INITIAL_JITTER_SEC`) para arranque ultrarrápido sin cortes.
 * - Barge-in (interrupción): al recibir `serverContent.interrupted` se detienen TODAS las fuentes
 *   programadas al instante y se reinicia la agenda de reproducción.
 * - Cierre automático sin corte: `KorePlaybackQueue.remainingMs` expone los milisegundos restantes
 *   agendados en `AudioContext` para no cortar jamás la despedida de Kore al cerrar la sesión del auto.
 *
 * @dataFlow
 * - getUserMedia → MediaStreamSource → AudioWorkletNode('kore-pcm16-capture') → port.postMessage
 *   ({ pcm: ArrayBuffer LE, rms }) → componente → base64 → WebSocket `realtimeInput.audio`.
 * - WebSocket `serverContent.modelTurn.parts[].inlineData` (base64) → `decodePcm16ToFloat32`
 *   → `KorePlaybackQueue.enqueue()` → AudioBufferSourceNode agendado en `AudioContext.currentTime`.
 *
 * @notes
 * - El AudioContext corre a la tasa nativa del dispositivo (44.1/48 kHz). NO se fuerza
 *   `sampleRate: 16000` porque Firefox rechaza conectar un MediaStream de otra tasa; el
 *   downsampling se hace dentro del worklet con un filtro de promedio (box filter / decimación
 *   con anti-aliasing básico) que soporta razones no enteras (44100/16000 = 2.75625) acarreando
 *   la posición fraccional entre bloques.
 * - El worklet se carga como Blob URL (sin archivo en /public) para evitar caché obsoleta.
 * - Little-endian garantizado con `DataView.setInt16(..., true)` / `getInt16(..., true)`
 *   (no depende del endianness de la plataforma).
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

/**
 * Código fuente del AudioWorkletProcessor. Se ejecuta en el AudioWorkletGlobalScope, donde
 * `sampleRate` es una variable global con la tasa real del AudioContext. Exportado para pruebas
 * de simulación (se evalúa en Node con un AudioWorkletProcessor falso).
 */
export const KORE_CAPTURE_WORKLET_SOURCE = `
class KorePcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.outRate = opts.targetRate || ${KORE_INPUT_SAMPLE_RATE};
    this.chunkSamples = opts.chunkSamples || ${KORE_CHUNK_SAMPLES};
    // Razón de decimación (ej. 48000/16000 = 3, 44100/16000 = 2.75625)
    this.ratio = sampleRate / this.outRate;
    this.acc = 0;
    this.accCount = 0;
    this.pos = 0;
    this.buffer = new ArrayBuffer(this.chunkSamples * 2);
    this.view = new DataView(this.buffer);
    this.outIdx = 0;
    this.sumSquares = 0;
  }

  emit(sample) {
    // Clamp a [-1, 1] y conversión a Int16 con signo (little-endian explícito)
    const s = sample > 1 ? 1 : (sample < -1 ? -1 : sample);
    const int16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    this.view.setInt16(this.outIdx * 2, int16, true);
    this.sumSquares += s * s;
    this.outIdx++;
    if (this.outIdx >= this.chunkSamples) {
      const rms = Math.sqrt(this.sumSquares / this.chunkSamples);
      const full = this.buffer;
      this.port.postMessage({ pcm: full, rms: rms }, [full]);
      this.buffer = new ArrayBuffer(this.chunkSamples * 2);
      this.view = new DataView(this.buffer);
      this.outIdx = 0;
      this.sumSquares = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channels = input.length;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let s = input[0][i];
      if (channels > 1) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i];
        s = sum / channels;
      }
      if (s !== s) s = 0; // NaN guard
      this.acc += s;
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        const avg = this.accCount > 0 ? this.acc / this.accCount : s;
        this.acc = 0;
        this.accCount = 0;
        while (this.pos >= this.ratio) {
          this.pos -= this.ratio;
          this.emit(avg);
        }
      }
    }
    return true;
  }
}
registerProcessor('${KORE_CAPTURE_PROCESSOR}', KorePcm16Capture);
`

/** Registra el worklet de captura en el AudioContext indicado (Blob URL, revocada al terminar). */
export async function loadKoreCaptureWorklet(ctx: AudioContext): Promise<void> {
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
        throw new Error('AUDIO_WORKLET_UNSUPPORTED')
    }
    const blob = new Blob([KORE_CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
        await ctx.audioWorklet.addModule(url)
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

/** Extrae la tasa de muestreo de un mimeType tipo `audio/pcm;rate=24000`. */
export function parsePcmRate(mimeType: string | undefined | null, fallback = KORE_OUTPUT_SAMPLE_RATE): number {
    if (!mimeType) return fallback
    const match = /rate=(\d+)/i.exec(mimeType)
    const rate = match ? Number(match[1]) : NaN
    return Number.isFinite(rate) && rate >= 3000 && rate <= 192000 ? rate : fallback
}

/**
 * Cola de reproducción sin cortes: agenda cada bloque exactamente al terminar el anterior
 * usando el reloj del AudioContext. `clear()` implementa el barge-in.
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

    /** Detiene y vacía todo lo programado (barge-in / fin de sesión). */
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

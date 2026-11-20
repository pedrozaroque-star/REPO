/**
 * @module lib/phone-live-mulaw
 * @description Codificador, decodificador y remuestreador acústico con estado (stateful DSP) para flujos telefónicos
 * bidireccionales en tiempo real entre Twilio Media Streams (`G.711 μ-law` a `8,000 Hz`) y `gemini-3.8-live`
 * (`PCM16 LE` entrada a `16,000 Hz` / salida a `24,000 Hz`).
 *
 * @businessRules
 * - **100% Puro e Isomórfico**: CERO imports de `node:*`, compatible idénticamente con Next.js (Node/Edge),
 *   navegador y Supabase Edge Functions (Deno).
 * - **Continuidad de Fase entre Paquetes (Cero Clics/Chasquidos)**:
 *   1) Entrada (`8 kHz μ-law -> 16 kHz PCM16`): interpola linealmente 2x conservando la última muestra (`prevSample`)
 *      entre tramas de 20 ms (`160` bytes -> `640` bytes PCM16) para evitar saltos de amplitud cada 50 Hz.
 *   2) Salida (`24 kHz PCM16 -> 8 kHz μ-law`): aplica el mismo filtro antialiasing FIR simétrico de 9 etapas
 *      (`[-0.015, 0.0, 0.085, 0.24, 0.38, 0.24, 0.085, 0.0, -0.015]`, corte ~3.7 kHz) de `lib/order-ready-tts.ts`,
 *      preservando la ventana histórica de muestras y el residuo módulo 3 entre chunks de WebSocket.
 *   3) Al ocurrir *barge-in* (`interrupted`), `reset()` limpia instantáneamente el estado del filtro de salida.
 *
 * @dataFlow
 * - Twilio `media.payload` (base64 μ-law 8 kHz) -> `StatefulMulaw8kToPcm16k` -> `audio/pcm;rate=16000` (Gemini Live).
 * - Gemini Live `inlineData` (base64 PCM16 24 kHz) -> `StatefulPcm24kToMulaw8k` -> tramas de `160` bytes (20 ms) μ-law 8 kHz -> Twilio `media`.
 *
 * @notes
 * - Implementa el estándar exacto ITU-T G.711 μ-law (`BIAS = 0x84`, `CLIP = 32635`).
 */

const MULAW_BIAS = 0x84
const MULAW_CLIP = 32635

const MULAW_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256)
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff
    const sign = u & 0x80
    const exponent = (u >> 4) & 0x07
    const mantissa = u & 0x0f
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent
    sample -= MULAW_BIAS
    table[i] = sign !== 0 ? -sample : sample
  }
  return table
})()

const FIR_24K_TO_8K_TAPS = [-0.015, 0.0, 0.085, 0.24, 0.38, 0.24, 0.085, 0.0, -0.015] as const

/** Convierte una muestra lineal PCM16 con signo (`-32768..32767`) a un byte `G.711 μ-law` (`0..255`). */
export function encodeSamplePcm16ToMulaw(sampleRaw: number): number {
  let sample = sampleRaw | 0
  let sign = 0
  if (sample < 0) {
    sign = 0x80
    sample = -sample
  }
  if (sample > MULAW_CLIP) sample = MULAW_CLIP
  sample += MULAW_BIAS

  let exponent = 7
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // búsqueda de segmento logarítmico ITU-T G.711
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

/** Decodifica un byte `G.711 μ-law` (`0..255`) a muestra lineal PCM16 (`-32768..32767`). */
export function decodeSampleMulawToPcm16(mulawByte: number): number {
  return MULAW_DECODE_TABLE[mulawByte & 0xff]
}

/** Decodifica un arreglo de bytes `G.711 μ-law` (`8 kHz`) a `Int16Array` (`8 kHz`). */
export function decodeMulawBytesToInt16(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length)
  for (let i = 0; i < mulaw.length; i++) {
    out[i] = MULAW_DECODE_TABLE[mulaw[i]]
  }
  return out
}

/** Codifica un `Int16Array` (`8 kHz`) a bytes `G.711 μ-law` (`8 kHz`). */
export function encodeInt16ToMulawBytes(pcm8k: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm8k.length)
  for (let i = 0; i < pcm8k.length; i++) {
    out[i] = encodeSamplePcm16ToMulaw(pcm8k[i])
  }
  return out
}

/**
 * Convierte paquetes entrantes de Twilio (`8 kHz μ-law`) a `16 kHz PCM16 LE` (`Uint8Array`)
 * manteniendo continuidad de fase entre paquetes consecutivos de 20 ms.
 */
export class StatefulMulaw8kToPcm16k {
  private hasPrev = false
  private prevSample = 0

  reset(): void {
    this.hasPrev = false
    this.prevSample = 0
  }

  process(mulawBytes: Uint8Array): Uint8Array {
    const n = mulawBytes.length
    if (n === 0) return new Uint8Array(0)

    const outBytes = new Uint8Array(n * 4)
    const view = new DataView(outBytes.buffer)

    let prev = this.hasPrev ? this.prevSample : MULAW_DECODE_TABLE[mulawBytes[0]]
    for (let i = 0; i < n; i++) {
      const curr = MULAW_DECODE_TABLE[mulawBytes[i]]
      const mid = (prev + curr) >> 1
      const byteOffset = i * 4
      view.setInt16(byteOffset, mid, true)
      view.setInt16(byteOffset + 2, curr, true)
      prev = curr
    }

    this.prevSample = prev
    this.hasPrev = true
    return outBytes
  }
}

/**
 * Convierte chunks salientes de Gemini Live (`24 kHz PCM16 LE`) a `8 kHz G.711 μ-law`
 * usando el filtro antialiasing FIR de 9 etapas con estado continuo entre chunks.
 */
export class StatefulPcm24kToMulaw8k {
  private carryByte: number | null = null
  private sampleBuffer: Int16Array = new Int16Array(0)
  private readPos = 4
  private initialized = false

  reset(): void {
    this.carryByte = null
    this.sampleBuffer = new Int16Array(0)
    this.readPos = 4
    this.initialized = false
  }

  process(pcm24kBytes: Uint8Array): Uint8Array {
    if (pcm24kBytes.length === 0) return new Uint8Array(0)

    let bytes = pcm24kBytes
    if (this.carryByte !== null) {
      const merged = new Uint8Array(1 + bytes.length)
      merged[0] = this.carryByte
      merged.set(bytes, 1)
      bytes = merged
      this.carryByte = null
    }

    if ((bytes.length & 1) === 1) {
      this.carryByte = bytes[bytes.length - 1]
      bytes = bytes.subarray(0, bytes.length - 1)
    }

    const newSampleCount = bytes.length >> 1
    if (newSampleCount === 0) return new Uint8Array(0)

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const firstSample = view.getInt16(0, true)

    let combined: Int16Array
    if (!this.initialized) {
      // Pre-llenar 4 muestras de borde izquierdo para centrar el primer tap FIR sin salto en cero
      combined = new Int16Array(4 + newSampleCount)
      combined.fill(firstSample, 0, 4)
      for (let i = 0; i < newSampleCount; i++) {
        combined[4 + i] = view.getInt16(i * 2, true)
      }
      this.readPos = 4
      this.initialized = true
    } else {
      combined = new Int16Array(this.sampleBuffer.length + newSampleCount)
      combined.set(this.sampleBuffer, 0)
      const base = this.sampleBuffer.length
      for (let i = 0; i < newSampleCount; i++) {
        combined[base + i] = view.getInt16(i * 2, true)
      }
    }

    // Cada muestra de salida centrada en `pos` requiere hasta `pos + 4` disponible en `combined`
    const maxCenter = combined.length - 5
    if (this.readPos > maxCenter) {
      this.sampleBuffer = combined
      return new Uint8Array(0)
    }

    const outCount = Math.floor((maxCenter - this.readPos) / 3) + 1
    const outMulaw = new Uint8Array(outCount)

    let center = this.readPos
    for (let o = 0; o < outCount; o++, center += 3) {
      let acc = 0
      for (let k = 0; k < 9; k++) {
        acc += combined[center + k - 4] * FIR_24K_TO_8K_TAPS[k]
      }
      let rounded = Math.round(acc)
      if (rounded > 32767) rounded = 32767
      else if (rounded < -32768) rounded = -32768
      outMulaw[o] = encodeSamplePcm16ToMulaw(rounded)
    }

    // Conservar únicamente las muestras desde `center - 4` en adelante para el siguiente chunk
    const keepFrom = Math.max(0, center - 4)
    this.sampleBuffer = combined.slice(keepFrom)
    this.readPos = center - keepFrom

    return outMulaw
  }

  /** Drena las últimas muestras remanentes al terminar un turno completo de voz. */
  flush(): Uint8Array {
    if (!this.initialized || this.sampleBuffer.length <= this.readPos) {
      return new Uint8Array(0)
    }
    const lastSample = this.sampleBuffer[this.sampleBuffer.length - 1]
    const padBytes = new Uint8Array(8)
    const padView = new DataView(padBytes.buffer)
    for (let i = 0; i < 4; i++) padView.setInt16(i * 2, lastSample, true)
    const tail = this.process(padBytes)
    this.reset()
    return tail
  }
}

/**
 * Convierte un archivo WAV PCM16 mono (`8,000 Hz` o `24,000 Hz`, ej. saludo cacheado en `order-ready-tts`)
 * directamente a bytes `8 kHz G.711 μ-law` listos para enviar por Twilio Media Streams.
 */
export function convertWavBytesToMulaw8k(wavBytes: Uint8Array): Uint8Array {
  if (wavBytes.length <= 44) return new Uint8Array(0)
  const headerView = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
  const isRiff =
    wavBytes[0] === 0x52 && // R
    wavBytes[1] === 0x49 && // I
    wavBytes[2] === 0x46 && // F
    wavBytes[3] === 0x46 // F

  if (!isRiff) {
    const resampler = new StatefulPcm24kToMulaw8k()
    const body = resampler.process(wavBytes)
    const tail = resampler.flush()
    const merged = new Uint8Array(body.length + tail.length)
    merged.set(body, 0)
    merged.set(tail, body.length)
    return merged
  }

  const sampleRate = headerView.getUint32(24, true)
  // Localizar el subchunk 'data' por si el WAV trae metadatos adicionales antes de 44 bytes
  let dataOffset = 44
  let dataLength = wavBytes.length - 44
  let cursor = 12
  while (cursor + 8 <= wavBytes.length) {
    const c0 = wavBytes[cursor]
    const c1 = wavBytes[cursor + 1]
    const c2 = wavBytes[cursor + 2]
    const c3 = wavBytes[cursor + 3]
    const chunkSize = headerView.getUint32(cursor + 4, true)
    if (c0 === 0x64 && c1 === 0x61 && c2 === 0x74 && c3 === 0x61) {
      dataOffset = cursor + 8
      dataLength = Math.min(chunkSize, wavBytes.length - dataOffset)
      break
    }
    cursor += 8 + chunkSize + (chunkSize & 1)
  }

  const pcmSlice = wavBytes.subarray(dataOffset, dataOffset + dataLength)
  if (sampleRate === 8000) {
    const sampleCount = pcmSlice.length >> 1
    const view = new DataView(pcmSlice.buffer, pcmSlice.byteOffset, sampleCount * 2)
    const out = new Uint8Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      out[i] = encodeSamplePcm16ToMulaw(view.getInt16(i * 2, true))
    }
    return out
  }

  const resampler = new StatefulPcm24kToMulaw8k()
  const body = resampler.process(pcmSlice)
  const tail = resampler.flush()
  const merged = new Uint8Array(body.length + tail.length)
  merged.set(body, 0)
  merged.set(tail, body.length)
  return merged
}

/** Codifica `Uint8Array` a Base64 estándar sin desbordar el stack en buffers grandes. */
export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }
  const CHUNK = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK)
    let s = ''
    for (let j = 0; j < sub.length; j++) s += String.fromCharCode(sub[j])
    parts.push(s)
  }
  return btoa(parts.join(''))
}

/** Decodifica Base64 estándar a `Uint8Array`. */
export function base64ToUint8(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0)
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

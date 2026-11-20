/**
 * @module supabase/functions/phone-live-bridge/dsp
 * @description Codificador, decodificador y remuestreador acústico con estado (stateful DSP) 100% Web-Standard
 * para el puente bidireccional Twilio Media Streams (`8 kHz G.711 μ-law`) <-> `gemini-3.8-live` (`16 kHz / 24 kHz PCM16`).
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

function computeMulawByteFromPcm16(sampleRaw: number): number {
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
    // segmento ITU-T G.711
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

// Tabla O(1) de 64 KB pre-calculada al iniciar el módulo (elimina bucles por muestra en tiempo real y ahorra ~80% de CPU)
const PCM16_TO_MULAW_TABLE: Uint8Array = (() => {
  const t = new Uint8Array(65536)
  for (let i = 0; i < 65536; i++) {
    t[i] = computeMulawByteFromPcm16(i - 32768)
  }
  return t
})()

const FIR_24K_TO_8K_TAPS = [-0.015, 0.0, 0.085, 0.24, 0.38, 0.24, 0.085, 0.0, -0.015] as const

export function encodeSamplePcm16ToMulaw(sampleRaw: number): number {
  let clamped = sampleRaw | 0
  if (clamped > 32767) clamped = 32767
  else if (clamped < -32768) clamped = -32768
  return PCM16_TO_MULAW_TABLE[clamped + 32768]
}

// Lookup ultra rápido Base64 para evitar btoa/atob + strings intermedios por cada trama de 20 ms
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_DECODE = (() => {
  const arr = new Int16Array(256).fill(-1)
  for (let i = 0; i < 64; i++) arr[B64_CHARS.charCodeAt(i)] = i
  return arr
})()

export class StatefulMulaw8kToPcm16k {
  private hasPrev = false
  private s0 = 0
  private s1 = 0
  private s2 = 0
  private hpPrevX = 0
  private hpPrevY = 0
  private noiseFloor = 0.008
  private gateOpen = false
  private holdChunks = 0
  private gain = 1.0
  private preRoll: Int16Array[] = []
  private cleanBuf = new Float32Array(320)
  private outSilence640 = new Uint8Array(640)

  reset(): void {
    this.hasPrev = false
    this.s0 = 0
    this.s1 = 0
    this.s2 = 0
    this.hpPrevX = 0
    this.hpPrevY = 0
    this.noiseFloor = 0.008
    this.gateOpen = false
    this.holdChunks = 0
    this.gain = 1.0
    this.preRoll = []
  }

  /**
   * Decodifica G.711 μ-law 8 kHz a PCM16 16 kHz aplicando:
   * 1) Filtro paso alto (~90 Hz) para eliminar offset DC y zumbido eléctrico de línea PSTN.
   * 2) Compuerta de ruido calibrada (sin amputar /s/ de "Super" y con hangover breve de 80 ms).
   * 3) Soft AGC con cero asignaciones GC en silencio para minimizar CPU en Edge Functions.
   */
  process(
    mulawBytes: Uint8Array,
    opts?: { inPlaybackWindow?: boolean }
  ): { pcmBytes: Uint8Array; speechActive: boolean; rms: number } {
    const n = mulawBytes.length
    if (n === 0) return { pcmBytes: new Uint8Array(0), speechActive: this.gateOpen, rms: 0 }

    if (this.cleanBuf.length < n) this.cleanBuf = new Float32Array(n)
    const clean8k = this.cleanBuf
    let hpX = this.hpPrevX
    let hpY = this.hpPrevY
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const x = MULAW_DECODE_TABLE[mulawBytes[i]] * (1 / 32768)
      const y = 0.93 * (hpY + x - hpX)
      hpX = x
      hpY = y
      clean8k[i] = y
      sumSq += y * y
    }
    this.hpPrevX = hpX
    this.hpPrevY = hpY
    const rawRms = Math.sqrt(sumSq / n)

    // 2. Actualizar piso de ruido solo cuando la señal está baja y fuera de ráfagas de eco
    const inEchoWindow = Boolean(opts?.inPlaybackWindow)
    if (!this.gateOpen && !inEchoWindow && rawRms < 0.04) {
      this.noiseFloor = this.noiseFloor * 0.94 + (rawRms > 0.002 ? rawRms : 0.002) * 0.06
    }
    let baseOpenThreshold = this.noiseFloor * 2.1
    if (baseOpenThreshold < 0.011) baseOpenThreshold = 0.011
    else if (baseOpenThreshold > 0.032) baseOpenThreshold = 0.032

    let openThreshold = baseOpenThreshold
    if (inEchoWindow) {
      openThreshold = this.noiseFloor * 2.8
      if (openThreshold < 0.023) openThreshold = 0.023
      else if (openThreshold > 0.04) openThreshold = 0.04
    }
    const sustainThreshold = openThreshold * 0.65

    const aboveSpeechThreshold = rawRms >= openThreshold || (this.gateOpen && rawRms >= sustainThreshold)
    let activeThisFrame = false
    if (aboveSpeechThreshold) {
      this.gateOpen = true
      this.holdChunks = 4 // 4 * 20 ms = 80 ms hangover breve
      activeThisFrame = true
    } else if (this.gateOpen && this.holdChunks > 0) {
      this.holdChunks--
      activeThisFrame = true
      if (this.holdChunks === 0) this.gateOpen = false
    } else {
      this.gateOpen = false
    }

    const scaleToFrame = (mode: 'speech' | 'decay' | 'preroll'): Int16Array => {
      if (mode === 'speech') {
        let targetGain = 1.0
        if (rawRms > 0.008) {
          targetGain = 0.16 / rawRms
          if (targetGain > 2.8) targetGain = 2.8
          else if (targetGain < 1.0) targetGain = 1.0
        }
        this.gain = this.gain * 0.72 + targetGain * 0.28
      } else if (mode === 'decay') {
        this.gain *= 0.45
      }
      let frameGain = this.gain
      if (mode === 'preroll') {
        frameGain = 0.12 / (rawRms > 0.025 ? rawRms : 0.025)
        if (frameGain > 1.6) frameGain = 1.6
        else if (frameGain < 1.0) frameGain = 1.0
      }
      const out = new Int16Array(n)
      for (let i = 0; i < n; i++) {
        const amplified = clean8k[i] * frameGain
        let shaped = amplified
        const absA = amplified < 0 ? -amplified : amplified
        if (absA > 0.85) {
          const z = (absA - 0.85) / 0.15
          const sat = 0.85 + 0.15 * (z / (1 + 0.35 * z * z))
          shaped = amplified < 0 ? -sat : sat
        }
        let val = Math.round(shaped * 32767)
        if (val > 32767) val = 32767
        else if (val < -32768) val = -32768
        out[i] = val
      }
      return out
    }

    if (!activeThisFrame) {
      const frame = scaleToFrame('preroll')
      this.preRoll.push(frame)
      if (this.preRoll.length > 3) this.preRoll.shift()
      this.gain = this.gain * 0.88 + 0.12
      this.s0 = 0
      this.s1 = 0
      this.s2 = 0
      const silence = n === 160 ? this.outSilence640 : new Uint8Array(n * 4)
      return { pcmBytes: silence, speechActive: false, rms: rawRms }
    }

    const activeFrames: Int16Array[] = []
    if (this.preRoll.length > 0) {
      for (let p = 0; p < this.preRoll.length; p++) activeFrames.push(this.preRoll[p])
      this.preRoll = []
    }
    activeFrames.push(scaleToFrame(aboveSpeechThreshold ? 'speech' : 'decay'))

    let totalOutBytes = 0
    for (let f = 0; f < activeFrames.length; f++) totalOutBytes += activeFrames[f].length * 4
    const out = new Uint8Array(totalOutBytes)
    let byteOff = 0

    for (let f = 0; f < activeFrames.length; f++) {
      const fr = activeFrames[f]
      const m = fr.length
      if (!this.hasPrev && m > 0) {
        this.s0 = fr[0]
        this.s1 = fr[0]
        this.s2 = fr[0]
        this.hasPrev = true
      }
      for (let i = 0; i < m; i++) {
        const s3 = fr[i]
        let mid = ((-this.s0 + 9 * this.s1 + 9 * this.s2 - s3 + 8) >> 4)
        if (mid > 32767) mid = 32767
        else if (mid < -32768) mid = -32768
        const s2v = this.s2
        out[byteOff] = mid & 0xff
        out[byteOff + 1] = (mid >> 8) & 0xff
        out[byteOff + 2] = s2v & 0xff
        out[byteOff + 3] = (s2v >> 8) & 0xff
        byteOff += 4
        this.s0 = this.s1
        this.s1 = this.s2
        this.s2 = s3
      }
    }
    return { pcmBytes: out, speechActive: true, rms: rawRms }
  }
}

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

    const firstLo = bytes[0]
    const firstHi = bytes[1]
    const firstSample = ((firstLo | (firstHi << 8)) << 16) >> 16

    let combined: Int16Array
    if (!this.initialized) {
      combined = new Int16Array(4 + newSampleCount)
      combined[0] = firstSample
      combined[1] = firstSample
      combined[2] = firstSample
      combined[3] = firstSample
      for (let i = 0, b = 0; i < newSampleCount; i++, b += 2) {
        combined[4 + i] = ((bytes[b] | (bytes[b + 1] << 8)) << 16) >> 16
      }
      this.readPos = 4
      this.initialized = true
    } else {
      const prevLen = this.sampleBuffer.length
      combined = new Int16Array(prevLen + newSampleCount)
      combined.set(this.sampleBuffer, 0)
      for (let i = 0, b = 0; i < newSampleCount; i++, b += 2) {
        combined[prevLen + i] = ((bytes[b] | (bytes[b + 1] << 8)) << 16) >> 16
      }
    }

    const maxCenter = combined.length - 5
    if (this.readPos > maxCenter) {
      this.sampleBuffer = combined
      return new Uint8Array(0)
    }

    const outCount = Math.floor((maxCenter - this.readPos) / 3) + 1
    const outMulaw = new Uint8Array(outCount)

    let center = this.readPos
    for (let o = 0; o < outCount; o++, center += 3) {
      // Filtro FIR simétrico desenrollado (omitidos taps 0.0 en ±3) + lookup O(1) μ-law
      const acc =
        (combined[center - 4] + combined[center + 4]) * -0.015 +
        (combined[center - 2] + combined[center + 2]) * 0.085 +
        (combined[center - 1] + combined[center + 1]) * 0.24 +
        combined[center] * 0.38
      let rounded = Math.round(acc)
      if (rounded > 32767) rounded = 32767
      else if (rounded < -32768) rounded = -32768
      outMulaw[o] = PCM16_TO_MULAW_TABLE[rounded + 32768]
    }

    const keepFrom = center > 4 ? center - 4 : 0
    this.sampleBuffer = combined.subarray(keepFrom).slice()
    this.readPos = center - keepFrom
    return outMulaw
  }

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

export function convertWavBytesToMulaw8k(wavBytes: Uint8Array): Uint8Array {
  if (wavBytes.length <= 44) return new Uint8Array(0)
  const headerView = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
  const isRiff =
    wavBytes[0] === 0x52 &&
    wavBytes[1] === 0x49 &&
    wavBytes[2] === 0x46 &&
    wavBytes[3] === 0x46

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

export function uint8ToBase64(bytes: Uint8Array): string {
  const len = bytes.length
  if (len === 0) return ''
  const out: string[] = []
  let i = 0
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out.push(B64_CHARS[(n >> 18) & 63], B64_CHARS[(n >> 12) & 63], B64_CHARS[(n >> 6) & 63], B64_CHARS[n & 63])
  }
  if (i < len) {
    const b0 = bytes[i]
    const b1 = i + 1 < len ? bytes[i + 1] : 0
    const n = (b0 << 16) | (b1 << 8)
    out.push(B64_CHARS[(n >> 18) & 63], B64_CHARS[(n >> 12) & 63], i + 1 < len ? B64_CHARS[(n >> 6) & 63] : '=', '=')
  }
  return out.join('')
}

export function base64ToUint8(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0)
  const cleanLen = b64.length
  let pad = 0
  if (b64.charCodeAt(cleanLen - 1) === 61) pad++
  if (cleanLen > 1 && b64.charCodeAt(cleanLen - 2) === 61) pad++
  const outLen = ((cleanLen * 3) >> 2) - pad
  const out = new Uint8Array(outLen)
  let outIdx = 0
  for (let i = 0; i < cleanLen; i += 4) {
    const c0 = B64_DECODE[b64.charCodeAt(i)]
    const c1 = B64_DECODE[b64.charCodeAt(i + 1)]
    const c2 = i + 2 < cleanLen ? B64_DECODE[b64.charCodeAt(i + 2)] : -1
    const c3 = i + 3 < cleanLen ? B64_DECODE[b64.charCodeAt(i + 3)] : -1
    if (c0 < 0 || c1 < 0) continue
    const n = (c0 << 18) | (c1 << 12) | ((c2 >= 0 ? c2 : 0) << 6) | (c3 >= 0 ? c3 : 0)
    if (outIdx < outLen) out[outIdx++] = (n >> 16) & 0xff
    if (c2 >= 0 && outIdx < outLen) out[outIdx++] = (n >> 8) & 0xff
    if (c3 >= 0 && outIdx < outLen) out[outIdx++] = n & 0xff
  }
  return out
}

export const SILENCE_60MS_PCM16_GEMINI_JSON = JSON.stringify({
  realtimeInput: { audio: { data: 'A'.repeat(2560), mimeType: 'audio/pcm;rate=16000' } }
})

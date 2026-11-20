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

const FIR_24K_TO_8K_TAPS = [-0.015, 0.0, 0.085, 0.24, 0.38, 0.24, 0.085, 0.0, -0.015] as const

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
    // segmento ITU-T G.711
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

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
   * 2) Calibración de piso de ruido μ-law + puerta de ruido con pre-roll (160 ms) y retención (360 ms).
   * 3) Control automático de ganancia (Soft AGC) para levantar voz celular baja sin saturar ni amplificar silencio.
   * 4) Interpolación cúbica Catmull-Rom 8 kHz -> 16 kHz para conservar consonantes telefónicas (`/s/`, `/t/`, `/k/`).
   */
  process(
    mulawBytes: Uint8Array,
    opts?: { inPlaybackWindow?: boolean }
  ): { pcmBytes: Uint8Array; speechActive: boolean; rms: number } {
    const n = mulawBytes.length
    if (n === 0) return { pcmBytes: new Uint8Array(0), speechActive: this.gateOpen, rms: 0 }

    // 1. Decodificar 8 kHz + filtro paso alto 90 Hz (α ≈ 0.93 @ 8 kHz)
    const clean8k = new Float32Array(n)
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const x = MULAW_DECODE_TABLE[mulawBytes[i]] / 32768
      const y = 0.93 * (this.hpPrevY + x - this.hpPrevX)
      this.hpPrevX = x
      this.hpPrevY = y
      clean8k[i] = y
      sumSq += y * y
    }
    const rawRms = Math.sqrt(sumSq / n)

    // 2. Actualizar piso de ruido solo cuando la señal está baja y fuera de ráfagas de eco
    const inEchoWindow = Boolean(opts?.inPlaybackWindow)
    if (!this.gateOpen && !inEchoWindow && rawRms < 0.035) {
      this.noiseFloor = this.noiseFloor * 0.94 + rawRms * 0.06
    }
    const baseOpenThreshold = Math.max(0.014, Math.min(0.04, this.noiseFloor * 2.5))
    // Durante el audio saliente de Kore exigir voz cercana clara para evitar que el eco del auricular abra la compuerta
    const openThreshold = inEchoWindow ? Math.max(0.055, this.noiseFloor * 4.2) : baseOpenThreshold
    const sustainThreshold = openThreshold * 0.72

    let activeThisFrame = false
    if (rawRms >= openThreshold || (this.gateOpen && rawRms >= sustainThreshold)) {
      this.gateOpen = true
      this.holdChunks = 18 // 18 * 20 ms = 360 ms hangover para respiraciones breves
      activeThisFrame = true
    } else if (this.gateOpen && this.holdChunks > 0) {
      this.holdChunks--
      activeThisFrame = true
      if (this.holdChunks === 0) this.gateOpen = false
    } else {
      this.gateOpen = false
    }

    // 3. Soft AGC únicamente sobre frames activos (jamás amplifica ruido en silencio)
    const upsampleTo16k = (frame8k: Int16Array): Uint8Array => {
      const m = frame8k.length
      const out = new Uint8Array(m * 4)
      const view = new DataView(out.buffer)
      if (!this.hasPrev && m > 0) {
        this.s0 = frame8k[0]
        this.s1 = frame8k[0]
        this.s2 = frame8k[0]
        this.hasPrev = true
      }
      for (let i = 0; i < m; i++) {
        const s3 = frame8k[i]
        // Interpolación cúbica Catmull-Rom en t=0.5 entre s1 y s2 usando (s0, s1, s2, s3)
        let mid = Math.round((-this.s0 + 9 * this.s1 + 9 * this.s2 - s3) / 16)
        if (mid > 32767) mid = 32767
        else if (mid < -32768) mid = -32768
        const off = i * 4
        view.setInt16(off, mid, true)
        view.setInt16(off + 2, this.s2, true)
        this.s0 = this.s1
        this.s1 = this.s2
        this.s2 = s3
      }
      return out
    }

    const toScaledInt16Frame = (): Int16Array => {
      const targetGain = rawRms > 0.008 ? Math.min(3.5, Math.max(1.0, 0.16 / rawRms)) : 1.0
      this.gain = this.gain * 0.75 + targetGain * 0.25
      const out = new Int16Array(n)
      for (let i = 0; i < n; i++) {
        const amplified = clean8k[i] * this.gain
        // Limitador suave (soft clip tanh aproximado arriba de ±0.85) para cero distorsión armónica en picos
        const absA = Math.abs(amplified)
        const shaped = absA <= 0.85 ? amplified : Math.sign(amplified) * (0.85 + 0.15 * Math.tanh((absA - 0.85) / 0.15))
        let val = Math.round(shaped * 32767)
        if (val > 32767) val = 32767
        else if (val < -32768) val = -32768
        out[i] = val
      }
      return out
    }

    if (!activeThisFrame) {
      const frame = toScaledInt16Frame()
      this.preRoll.push(frame)
      if (this.preRoll.length > 8) this.preRoll.shift() // 8 * 20 ms = 160 ms pre-roll antes del ataque
      this.gain = this.gain * 0.92 + 1.0 * 0.08
      // Devolver silencio digital puro cuando la línea está en reposo (evita alucinaciones por ruido μ-law)
      this.s0 = 0
      this.s1 = 0
      this.s2 = 0
      return { pcmBytes: new Uint8Array(n * 4), speechActive: false, rms: rawRms }
    }

    const activeFrames: Int16Array[] = []
    if (this.preRoll.length > 0) {
      for (const pf of this.preRoll) activeFrames.push(pf)
      this.preRoll = []
    }
    activeFrames.push(toScaledInt16Frame())

    if (activeFrames.length === 1) {
      return { pcmBytes: upsampleTo16k(activeFrames[0]), speechActive: true, rms: rawRms }
    }

    const parts = activeFrames.map((fr) => upsampleTo16k(fr))
    const totalLen = parts.reduce((acc, p) => acc + p.length, 0)
    const merged = new Uint8Array(totalLen)
    let pos = 0
    for (const p of parts) {
      merged.set(p, pos)
      pos += p.length
    }
    return { pcmBytes: merged, speechActive: true, rms: rawRms }
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

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const firstSample = view.getInt16(0, true)

    let combined: Int16Array
    if (!this.initialized) {
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

    const keepFrom = Math.max(0, center - 4)
    this.sampleBuffer = combined.slice(keepFrom)
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

export function base64ToUint8(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

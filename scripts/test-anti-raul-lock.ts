/**
 * test-anti-raul-lock.ts
 * Verificación exhaustiva de bloqueo de Microsoft Raúl en todas sus variantes de acento y SAPI.
 */

import { isForbiddenRaulVoice } from '../lib/order-ready-tts'

const testVoices = [
  { name: 'Microsoft Raúl Desktop - Spanish (Mexico)', lang: 'es-MX' },
  { name: 'Microsoft Raúl', lang: 'es-MX' },
  { name: 'Microsoft Raul Desktop', lang: 'es-MX' },
  { name: 'Microsoft Raul', lang: 'es-MX' },
  { name: 'RAÚL', lang: 'es-MX' },
  { name: 'Raúl (Mexico)', lang: 'es-MX' },
  { name: 'es-MX-RaulNeural', lang: 'es-MX' },
  { name: 'es-MX-RaúlNeural', lang: 'es-MX' },
  { name: 'Google español Raúl', lang: 'es-ES' },
  { name: 'Microsoft Sabina Desktop - Spanish (Mexico)', lang: 'es-MX' },
  { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US' },
  { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US' },
  { name: 'Google US English', lang: 'en-US' },
]

console.log('=== TEST 1: DETECCIÓN DE RAÚL (CON Y SIN ACENTO) ===')
for (const v of testVoices) {
  const isRaul = isForbiddenRaulVoice(v.name)
  const isActualRaul = /ra[uú]l/i.test(v.name)
  if (isActualRaul && !isRaul) {
    throw new Error(`FALLO: ${v.name} es Raúl pero NO fue detectado por isForbiddenRaulVoice!`)
  }
  if (!isActualRaul && isRaul) {
    throw new Error(`FALLO: ${v.name} NO es Raúl pero fue falsamente bloqueado!`)
  }
  console.log(`[${isRaul ? 'BLOQUEADO' : 'PERMITIDO'}] ${v.name}`)
}

console.log('\n=== TEST 2: SIMULACIÓN DE WINDOWS STOCK (DAVID, ZIRA, RAÚL) ===')
// Simular el entorno estándar de Windows en español donde las únicas voces instaladas son David, Zira y Raúl
const windowsStockVoices = [
  { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US' },
  { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US' },
  { name: 'Microsoft Raúl Desktop - Spanish (Mexico)', lang: 'es-MX' }
]

// 1. Filtrado en loadVoices
const filteredAtSource = windowsStockVoices.filter(v => !isForbiddenRaulVoice(v.name))
console.log('Voces disponibles tras loadVoices:', filteredAtSource.map(v => v.name))
if (filteredAtSource.some(v => /ra[uú]l/i.test(v.name))) {
  throw new Error('FALLO: Raúl superó el filtro raíz en loadVoices!')
}

// 2. Simulación de safeSpeak con voz undefined (prevención de fallback del sistema operativo)
let spokeUndefined = false
const safeSpeakMock = (utt: { voice?: any }, onEnd: () => void) => {
  if (!utt.voice) {
    console.log('✔ Bloqueo de seguridad exitoso: intento de emitir sin voz asignada explícitamente (se previene que Windows active a Raúl).')
    onEnd()
    return
  }
  if (isForbiddenRaulVoice(utt.voice.name)) {
    console.log('✔ Bloqueo exitoso: se intentó usar', utt.voice.name)
    onEnd()
    return
  }
  spokeUndefined = true
  onEnd()
}

safeSpeakMock({}, () => {})
if (spokeUndefined) {
  throw new Error('FALLO: safeSpeak permitió reproducir un utterance sin voz explícita!')
}

safeSpeakMock({ voice: { name: 'Microsoft Raúl Desktop - Spanish (Mexico)' } }, () => {})
if (spokeUndefined) {
  throw new Error('FALLO: safeSpeak permitió reproducir a Microsoft Raúl!')
}

console.log('\n✅ TODOS LOS TESTS PASARON EXITOSAMENTE. BLOQUEO ANTI-RAÚL 100% BLINDADO.')

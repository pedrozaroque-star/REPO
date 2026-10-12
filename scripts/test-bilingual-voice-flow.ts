/**
 * Simulation Test: Bilingual Voice Flow (English + Spanish ALWAYS)
 * Tests TTS audio generation and storage retrieval for numbers in both EN and ES.
 */

import { getOrderReadySpeech, isValidTtsRequest } from '../lib/order-ready-tts'

async function runTest() {
  console.log('--- Iniciando prueba de flujo de voz bilingüe (Inglés + Español) ---')

  const testNumbers = ['1', '25', '141']

  for (const num of testNumbers) {
    console.log(`\nProbando Orden #${num}:`)

    // Validar request
    if (!isValidTtsRequest(num, 'en', 'Kore') || !isValidTtsRequest(num, 'es', 'Kore')) {
      throw new Error(`Validación de TTS falló para #${num}`)
    }
    console.log(`  [OK] Validación de parámetros correcta para EN y ES`)

    // Obtener clip en inglés
    const startEn = Date.now()
    const enWav = await getOrderReadySpeech(num, 'en', 'Kore')
    const timeEn = Date.now() - startEn
    console.log(`  [OK] Clip EN obtenido: ${enWav.length} bytes (WAV RIFF: ${enWav.subarray(0, 4).toString('ascii')}) en ${timeEn}ms`)

    // Obtener clip en español
    const startEs = Date.now()
    const esWav = await getOrderReadySpeech(num, 'es', 'Kore')
    const timeEs = Date.now() - startEs
    console.log(`  [OK] Clip ES obtenido: ${esWav.length} bytes (WAV RIFF: ${esWav.subarray(0, 4).toString('ascii')}) en ${timeEs}ms`)

    if (enWav.length < 1000 || esWav.length < 1000) {
      throw new Error(`El tamaño del archivo de audio es sospechosamente pequeño`)
    }
  }

  console.log('\n=============================================')
  console.log(' SIMULACIÓN EXITOSA: Ambos idiomas (EN + ES) generados y verificados')
  console.log('=============================================\n')
}

runTest().catch((err) => {
  console.error('Error en prueba:', err)
  process.exit(1)
})

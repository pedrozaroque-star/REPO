/**
 * @module scripts/pregenerate-voices
 * @description Generador y precargador por lotes de audios de voz femenina natural (Gemini TTS) para Supabase Storage.
 * 
 * Reglas de Negocio Tacos Gavilan:
 * - Voz por defecto: 'Kore' (Voz femenina oficial natural y alegre con el slogan "¡ya está!").
 * - Caché permanente en Supabase Storage (bucket 'order-ready-tts' en 'v4/{voice}/{lang}/{n}.wav').
 * - Si el clip ya existe en Supabase, se salta inmediatamente sin consumir cuota de Gemini.
 * - Pausa de seguridad (throttle) configurable entre llamadas y rotación multi-key para evitar errores 429 de cuota.
 * 
 * Uso:
 *   npx tsx scripts/pregenerate-voices.ts --start=1 --end=100 --lang=both --voice=Kore
 *   npx tsx scripts/pregenerate-voices.ts --missing --max=500 --batch=50
 */

import { supabaseAdmin } from '../lib/supabase'
import { getOrderReadySpeech, VoiceId, AVAILABLE_VOICES, TtsLang } from '../lib/order-ready-tts'

// Parsear argumentos de línea de comandos
const args = process.argv.slice(2)
function getArg(name: string, fallback: string): string {
  const found = args.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=')[1] : fallback
}
const hasFlag = (name: string) => args.includes(`--${name}`)

const voice = (getArg('voice', 'Kore')) as VoiceId
const langArg = getArg('lang', 'es') // 'es', 'en', 'both'
const startNum = parseInt(getArg('start', '1'), 10)
const endNum = parseInt(getArg('end', '2000'), 10)
const batchLimit = parseInt(getArg('batch', '50'), 10)
const delayMs = parseInt(getArg('delay', '1800'), 10) // 1.8s entre llamadas para cuidar cuota
const onlyAudit = hasFlag('audit')

async function getExistingNumbers(voiceId: string, lang: string): Promise<Set<number>> {
  const set = new Set<number>()
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from('order-ready-tts')
      .list(`v4/${voiceId}/${lang}`, { limit, offset })

    if (error || !data || data.length === 0) break
    for (const item of data) {
      const num = parseInt(item.name.replace('.wav', ''), 10)
      if (!isNaN(num)) set.add(num)
    }
    if (data.length < limit) break
    offset += limit
  }
  return set
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function run() {
  console.log('=================================================================')
  console.log('🎙️ PRECARGADOR DE AUDIOS DE VOZ FEMENINA (SUPABASE STORAGE)')
  console.log('   Tacos Gavilan — Gemini Neural TTS')
  console.log('=================================================================')
  console.log(`• Voz seleccionada: ${voice} (Femenina Oficial)`)
  console.log(`• Idioma(s): ${langArg}`)
  console.log(`• Rango objetivo: Órdenes #${startNum} a #${endNum}`)
  console.log(`• Límite por ejecución: ${batchLimit} audios nuevos`)
  console.log(`• Intervalo entre llamadas: ${delayMs}ms\n`)

  const langs: TtsLang[] = langArg === 'both' ? ['es', 'en'] : [langArg as TtsLang]

  if (langArg === 'both') {
    console.log(`\n🔍 Verificando existencia de audios en Supabase para Español e Inglés...`)
    const existingEs = await getExistingNumbers(voice, 'es')
    const existingEn = await getExistingNumbers(voice, 'en')

    console.log(`  -> Ya existen en Supabase (ES): ${existingEs.size} audios`)
    console.log(`  -> Ya existen en Supabase (EN): ${existingEn.size} audios`)

    // Identificar números que requieran al menos un idioma en el rango
    const candidates: number[] = []
    let fullyCompleteCount = 0

    for (let i = startNum; i <= endNum; i++) {
      const hasEs = existingEs.has(i)
      const hasEn = existingEn.has(i)
      if (hasEs && hasEn) {
        fullyCompleteCount++
      } else {
        candidates.push(i)
      }
    }

    const totalInRange = (endNum - startNum + 1)
    const pct = ((fullyCompleteCount / totalInRange) * 100).toFixed(1)

    console.log(`  -> Órdenes completas en ambos idiomas (#${startNum}-#${endNum}): ${fullyCompleteCount}/${totalInRange} (${pct}%)`)
    console.log(`  -> Órdenes pendientes por completar: ${candidates.length}`)

    if (onlyAudit) {
      console.log(`  -> Modo solo auditoría. Primeros 20 números pendientes:`, candidates.slice(0, 20))
      return
    }

    if (candidates.length === 0) {
      console.log(`  ✨ ¡Todas las órdenes del rango #${startNum}-#${endNum} ya están 100% grabadas en ambos idiomas!`)
      return
    }

    const toProcess = candidates.slice(0, batchLimit)
    console.log(`\n🚀 Iniciando lote bilingüe para ${toProcess.length} órdenes (Voz Femenina: ${voice})...\n`)

    let totalAudioSuccess = 0
    let totalAudioFailed = 0
    let consecutiveErrors = 0
    let shouldStop = false

    for (let idx = 0; idx < toProcess.length; idx++) {
      if (shouldStop) break
      const num = toProcess[idx]
      const progressPrefix = `[Orden ${idx + 1}/${toProcess.length} (#${num})]`

      // 1. Procesar Español si falta
      if (!existingEs.has(num)) {
        try {
          process.stdout.write(`  ${progressPrefix} Generando ES... `)
          const startT = Date.now()
          const buf = await getOrderReadySpeech(String(num), 'es', voice)
          const duration = Date.now() - startT
          console.log(`✅ Guardado (${(buf.length / 1024).toFixed(1)} KB en ${duration}ms)`)
          totalAudioSuccess++
          consecutiveErrors = 0
          existingEs.add(num)
        } catch (err: any) {
          console.log(`❌ Error: ${err.message}`)
          totalAudioFailed++
          consecutiveErrors++
          if (consecutiveErrors >= 3) {
            console.warn(`\n⚠️ 3 errores consecutivos. Pausando el lote de forma segura para proteger la cuota.`)
            shouldStop = true
            break
          }
          await sleep(3500)
        }
        await sleep(delayMs)
      } else {
        console.log(`  ${progressPrefix} ES ya existe en Supabase -> Saltado ✅`)
      }

      if (shouldStop) break

      // 2. Procesar Inglés si falta
      if (!existingEn.has(num)) {
        try {
          process.stdout.write(`  ${progressPrefix} Generando EN... `)
          const startT = Date.now()
          const buf = await getOrderReadySpeech(String(num), 'en', voice)
          const duration = Date.now() - startT
          console.log(`✅ Guardado (${(buf.length / 1024).toFixed(1)} KB en ${duration}ms)`)
          totalAudioSuccess++
          consecutiveErrors = 0
          existingEn.add(num)
        } catch (err: any) {
          console.log(`❌ Error: ${err.message}`)
          totalAudioFailed++
          consecutiveErrors++
          if (consecutiveErrors >= 3) {
            console.warn(`\n⚠️ 3 errores consecutivos. Pausando el lote de forma segura para proteger la cuota.`)
            shouldStop = true
            break
          }
          await sleep(3500)
        }
        await sleep(delayMs)
      } else {
        console.log(`  ${progressPrefix} EN ya existe en Supabase -> Saltado ✅`)
      }
    }

    console.log(`\n📊 Resumen de lote bilingüe: ${totalAudioSuccess} audios guardados | ${totalAudioFailed} fallidos`)
  } else {
    const lang = langArg as TtsLang
    console.log(`\n🔍 Verificando existencia de audios en Supabase: v4/${voice}/${lang}...`)
    const existing = await getExistingNumbers(voice, lang)
    console.log(`  -> Ya existen en Supabase: ${existing.size} audios para esta voz e idioma.`)

    const missing: number[] = []
    for (let i = startNum; i <= endNum; i++) {
      if (!existing.has(i)) {
        missing.push(i)
      }
    }

    const totalInRange = (endNum - startNum + 1)
    const completedInRange = totalInRange - missing.length
    const pct = ((completedInRange / totalInRange) * 100).toFixed(1)

    console.log(`  -> Progreso en rango #${startNum}-#${endNum}: ${completedInRange}/${totalInRange} (${pct}%)`)
    console.log(`  -> Faltantes por generar: ${missing.length}`)

    if (onlyAudit) {
      console.log(`  -> Modo solo auditoría. Primeros 20 faltantes:`, missing.slice(0, 20))
      return
    }

    if (missing.length === 0) {
      console.log(`  ✨ ¡El rango #${startNum}-#${endNum} está 100% completo en Supabase para ${lang}!`)
      return
    }

    const toProcess = missing.slice(0, batchLimit)
    console.log(`\n🚀 Iniciando generación de lote de ${toProcess.length} audios para ${lang}...`)

    let generatedCount = 0
    let failedCount = 0

    for (let idx = 0; idx < toProcess.length; idx++) {
      const num = toProcess[idx]
      const currentProgress = `[${idx + 1}/${toProcess.length}]`

      try {
        process.stdout.write(`  ${currentProgress} Generando #${num} (${lang})... `)
        const startT = Date.now()
        const buf = await getOrderReadySpeech(String(num), lang, voice)
        const duration = Date.now() - startT
        console.log(`✅ Guardado (${(buf.length / 1024).toFixed(1)} KB en ${duration}ms)`)
        generatedCount++
      } catch (err: any) {
        console.log(`❌ Error: ${err.message}`)
        failedCount++

        if (/quota|429|exhausted/i.test(err.message)) {
          console.warn(`\n⚠️ Límite de cuota alcanzado de Google Gemini. Deteniendo lote de forma segura.`)
          break
        }
      }

      if (idx < toProcess.length - 1) {
        await sleep(delayMs)
      }
    }

    console.log(`\n📊 Resumen de lote ${lang}: ${generatedCount} generados exitosamente | ${failedCount} fallidos`)
  }

  console.log('\n=================================================================')
  console.log('🏁 Proceso finalizado. Los audios están listos en Supabase Storage.')
  console.log('=================================================================\n')
}

run().catch(console.error)

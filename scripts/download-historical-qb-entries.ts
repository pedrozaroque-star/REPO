import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import QuickBooks from 'node-quickbooks'

async function downloadAllHistoricalQB() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('📥 DESCARGA COMPLETA DE PÓLIZAS QB ONLINE (01-ENE-2026 AL 31-JUL-2026)')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: i, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  if (error || !i) {
    console.error('No integration:', error)
    return
  }

  const qbo = new QuickBooks(
    process.env.QUICKBOOKS_CLIENT_ID,
    process.env.QUICKBOOKS_CLIENT_SECRET,
    i.access_token,
    false,
    i.realm_id,
    false,
    false,
    null,
    '2.0',
    i.refresh_token
  )

  const dataDir = path.join(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  const cacheFile = path.join(dataDir, 'qb_historical_entries_2026.json')

  let allEntries: any[] = []
  if (fs.existsSync(cacheFile)) {
    try {
      allEntries = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
      console.log(`Cargadas ${allEntries.length} pólizas existentes en caché local.`)
    } catch (e) {
      allEntries = []
    }
  }

  // Generate 7-day intervals from 2026-01-01 to 2026-07-31
  const intervals: { start: string, end: string }[] = []
  let curr = new Date('2026-01-01T00:00:00Z')
  const maxDate = new Date('2026-07-31T23:59:59Z')

  while (curr <= maxDate) {
    const startStr = curr.toISOString().split('T')[0]
    const next = new Date(curr)
    next.setDate(next.getDate() + 6)
    if (next > maxDate) next.setTime(maxDate.getTime())
    const endStr = next.toISOString().split('T')[0]
    
    intervals.push({ start: startStr, end: endStr })
    
    curr.setDate(curr.getDate() + 7)
  }

  console.log(`Total de intervalos de 7 días a procesar: ${intervals.length}\n`)

  for (let idx = 0; idx < intervals.length; idx++) {
    const span = intervals[idx]
    console.log(`[${idx + 1}/${intervals.length}] Descargando ${span.start} al ${span.end}...`)

    try {
      const result: any = await new Promise((resolve, reject) => {
        qbo.findJournalEntries([
          { field: 'TxnDate', value: span.start, operator: '>=' },
          { field: 'TxnDate', value: span.end, operator: '<=' },
          { field: 'fetchAll', value: true }
        ], (err: any, data: any) => {
          if (err) reject(err)
          else resolve(data)
        })
      })

      const entries = result?.QueryResponse?.JournalEntry || []
      const posEntries = entries.filter((e: any) => e.DocNumber && e.DocNumber.startsWith('POS2026'))

      let added = 0
      for (const pe of posEntries) {
        const existingIdx = allEntries.findIndex(e => e.Id === pe.Id)
        if (existingIdx === -1) {
          allEntries.push(pe)
          added++
        } else {
          allEntries[existingIdx] = pe // update
        }
      }

      console.log(`   ✓ Recibidas: ${entries.length} | Pólizas POS Cohesion: ${posEntries.length} (Nuevas agregadas: ${added}) | Total acumulado: ${allEntries.length}`)

      // Persist periodically
      if ((idx + 1) % 5 === 0 || idx === intervals.length - 1) {
        fs.writeFileSync(cacheFile, JSON.stringify(allEntries, null, 2))
        console.log(`   💾 Guardado progreso en ${cacheFile}`)
      }

      // Small pause to be polite to QBO API
      await new Promise(r => setTimeout(r, 600))
    } catch (err: any) {
      console.error(`❌ Error en intervalo ${span.start} - ${span.end}:`, err.Fault || err.message)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════')
  console.log(`🎉 DESCARGA COMPLETA: ${allEntries.length} pólizas POS descargadas de QuickBooks!`)
  console.log('═══════════════════════════════════════════════════════════════════════')
}

downloadAllHistoricalQB()

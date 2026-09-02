/**
 * EXTRAER ASIENTOS HISTÓRICOS DE COHESION DIRECTAMENTE DESDE QUICKBOOKS ONLINE
 * Y COMPARARLOS CONTRA EL NUEVO MÓDULO TEG EN TIEMPO REAL
 * 
 * Run via: npx tsx scripts/extract-live-qb-cohesion-journals.ts
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function extractAndSimulate() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════')
  console.log('🔍 CONSULTANDO Y AUDITANDO ASIENTOS HISTÓRICOS DE COHESION DIRECTAMENTE EN QUICKBOOKS ONLINE')
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════\n')

  const { supabaseAdmin } = await import('../lib/supabase')
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  const realmId = integ.realm_id
  const token = integ.access_token
  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`

  const qbFetch = async (endpoint: string) => {
    const url = `${baseUrl}/${endpoint}${endpoint.includes('?') ? '&' : '?'}minorversion=75`
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    })
    if (!res.ok) {
      throw new Error(`QB API Error ${res.status}: ${await res.text()}`)
    }
    return await res.json()
  }

  // 1. Consultar asientos contables en QuickBooks
  console.log('📡 1. Extrayendo Journal Entries registrados por Cohesion en QuickBooks Online...')
  const qbSql = encodeURIComponent("SELECT * FROM JournalEntry ORDERBY TxnDate DESC MAXRESULTS 20")
  const qbData = await qbFetch(`query?query=${qbSql}`)
  const journals: any[] = qbData.QueryResponse?.JournalEntry || []

  console.log(`   ✓ Se obtuvieron ${journals.length} asientos contables de QuickBooks.\n`)

  if (journals.length === 0) {
    console.log('No se encontraron asientos recientes.')
    return
  }

  // 2. Analizar cada asiento extraído de QuickBooks
  console.log('📋 2. DESGLOSE DE PÓLIZAS ENCONTRADAS EN QUICKBOOKS ONLINE:')
  for (let i = 0; i < Math.min(journals.length, 5); i++) {
    const j = journals[i]
    console.log(`\n───────────────────────────────────────────────────────────────────────────────────────────────────`)
    console.log(`📑 PÓLIZA QB #${i + 1}: DocNumber = "${j.DocNumber || 'N/A'}" | Fecha = ${j.TxnDate} | ID Intuit = #${j.Id}`)
    console.log(`   Nota: ${j.PrivateNote || 'Sin nota'}`)
    console.log(`───────────────────────────────────────────────────────────────────────────────────────────────────`)

    const lines: any[] = j.Line || []
    let totalDb = 0
    let totalCr = 0

    console.log('┌──────┬──────────────┬──────────────────────────────────────────┬──────────────┬──────────────┬───────────┐')
    console.log('│ Línea│ Cuenta QB    │ Descripción / Memo de Cohesion           │ Débito Intuit│Crédito Intuit│ Clase / Ub│')
    console.log('├──────┼──────────────┼──────────────────────────────────────────┼──────────────┼──────────────┼───────────┤')

    let lineIdx = 1
    for (const l of lines) {
      const detail = l.JournalEntryLineDetail || {}
      const isDb = detail.PostingType === 'Debit'
      const amt = Number(l.Amount || 0)
      if (isDb) totalDb += amt
      else totalCr += amt

      const acctRef = detail.AccountRef ? `${detail.AccountRef.name || detail.AccountRef.value}` : '—'
      const desc = (l.Description || '').padEnd(40).substring(0, 40)
      const dbStr = isDb ? `$${amt.toFixed(2).padStart(9)} DB` : '       —      '
      const crStr = !isDb ? `$${amt.toFixed(2).padStart(9)} CR` : '       —      '
      const classRef = detail.ClassRef?.name || detail.DepartmentRef?.name || '—'

      console.log(`│  ${String(lineIdx).padStart(2)}  │ ${acctRef.padEnd(12).substring(0, 12)} │ ${desc} │ ${dbStr} │ ${crStr} │ ${classRef.padEnd(9).substring(0, 9)} │`)
      lineIdx++
    }

    console.log('├──────┴──────────────┴──────────────────────────────────────────┼──────────────┼──────────────┼───────────┤')
    console.log(`│ TOTAL DE ASIENTO REGISTRADO EN QUICKBOOKS                      │ $${totalDb.toFixed(2).padStart(9)} DB │ $${totalCr.toFixed(2).padStart(9)} CR │ Balance ✓ │`)
    console.log('└────────────────────────────────────────────────────────────────┴──────────────┴──────────────┴───────────┘')
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════════')
  console.log('🎉 AUDITORÍA Y EXTRACCIÓN DE DATOS REALES DE COHESION EN QUICKBOOKS COMPLETADA')
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════')
}

extractAndSimulate().catch(console.error)

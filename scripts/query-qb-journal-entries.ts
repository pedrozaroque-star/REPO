import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { getQuickBooksClient } from '../lib/quickbooks'

async function queryQBEntries() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔍 CONSULTA DE SÓLO LECTURA EN QUICKBOOKS ONLINE (JOURNAL ENTRIES)')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  try {
    const qbo = await getQuickBooksClient()
    
    // Query recent journal entries from QB
    const query = "SELECT * FROM JournalEntry WHERE TxnDate >= '2026-08-25' ORDERBY TxnDate DESC MAXRESULTS 20"
    console.log(`Ejecutando consulta en QB: ${query} ...`)

    const result: any = await new Promise((resolve, reject) => {
      qbo.query(query, (err: any, data: any) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    const entries = result?.QueryResponse?.JournalEntry || []
    console.log(`\nEncontradas ${entries.length} pólizas en QuickBooks Online:\n`)

    for (const entry of entries) {
      console.log(`─────────────────────────────────────────────────────────────────`)
      console.log(`ID: ${entry.Id} | Fecha: ${entry.TxnDate} | DocNumber: ${entry.DocNumber}`)
      console.log(`PrivateNote: ${entry.PrivateNote || '—'}`)
      console.log(`Total Líneas: ${entry.Line?.length || 0}`)
      
      // Calculate total debits / credits
      let totalDebit = 0
      let totalCredit = 0
      for (const line of entry.Line || []) {
        const detail = line.JournalEntryLineDetail
        if (detail?.PostingType === 'Debit') totalDebit += line.Amount || 0
        if (detail?.PostingType === 'Credit') totalCredit += line.Amount || 0
      }
      console.log(`Total Débito: $${totalDebit.toFixed(2)} | Total Crédito: $${totalCredit.toFixed(2)}`)
    }

  } catch (err: any) {
    console.error('Error consultando QuickBooks:', err)
  }
}

queryQBEntries()

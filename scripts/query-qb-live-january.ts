import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import QuickBooks from 'node-quickbooks'

async function queryQBLive() {
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

  console.log('Access token expires at:', i.expires_at)
  console.log('Realm ID:', i.realm_id)

  const qbo = new QuickBooks(
    process.env.QUICKBOOKS_CLIENT_ID,
    process.env.QUICKBOOKS_CLIENT_SECRET,
    i.access_token,
    false,
    i.realm_id,
    false, // production
    false, // debug
    null,
    '2.0',
    i.refresh_token
  )

  console.log('\nConsultando QuickBooks para Enero 2026 con findJournalEntries...')
  qbo.findJournalEntries([
    { field: 'TxnDate', value: '2026-01-01', operator: '>=' },
    { field: 'TxnDate', value: '2026-01-03', operator: '<=' },
    { field: 'limit', value: 10 }
  ], (err: any, data: any) => {
    if (err) {
      console.error('Error de consulta:', err.Fault || err)
    } else {
      const list = data?.QueryResponse?.JournalEntry || []
      console.log(`✅ ¡CONEXIÓN EXITOSA CON QUICKBOOKS ONLINE! Encontradas ${list.length} pólizas:\n`)
      for (const entry of list) {
        console.log(`• Doc: ${entry.DocNumber} | Fecha: ${entry.TxnDate} | ID: ${entry.Id}`)
        console.log(`  Líneas contables: ${entry.Line?.length || 0}`)
        let debits = 0
        let credits = 0
        for (const line of entry.Line || []) {
          const dt = line.JournalEntryLineDetail
          if (dt?.PostingType === 'Debit') debits += line.Amount || 0
          if (dt?.PostingType === 'Credit') credits += line.Amount || 0
        }
        console.log(`  Débitos: $${debits.toFixed(2)} | Créditos: $${credits.toFixed(2)}\n`)
      }
    }
  })
}

queryQBLive()

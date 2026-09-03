import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import OAuthClient from 'intuit-oauth'
import QuickBooks from 'node-quickbooks'

async function checkQBLive() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🔍 CONSULTA DIRECTA DE SÓLO LECTURA A QUICKBOOKS ONLINE')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: integration, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  if (error || !integration) {
    console.error('No integration found:', error)
    return
  }

  console.log(`Integration encontrada: RealmId ${integration.realm_id}`)
  console.log(`Token expires at: ${integration.expires_at}`)

  const oauthClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment: 'production',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
  })

  let accessToken = integration.access_token

  // Refresh if needed
  if (new Date(integration.expires_at) <= new Date()) {
    console.log('Refrescando token con Intuit OAuth en entorno PRODUCTION...')
    try {
      const authResponse = await oauthClient.refreshUsingToken(integration.refresh_token)
      const tokens = authResponse.getJson()
      accessToken = tokens.access_token

      await supabase
        .from('integrations')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', integration.id)

      console.log('✅ Token refrescado exitosamente en Supabase!')
    } catch (e: any) {
      console.error('Error refrescando token:', e.originalMessage || e.message || e)
      console.error('Body:', e.authResponse?.body || e.authResponse?.json)
      return
    }
  }

  const qbo = new QuickBooks(
    process.env.QUICKBOOKS_CLIENT_ID,
    process.env.QUICKBOOKS_CLIENT_SECRET,
    accessToken,
    false,
    integration.realm_id,
    false, // useSandbox = false (PRODUCTION)
    false, // debug
    null,
    '2.0',
    integration.refresh_token
  )

  // Query recent journal entries
  console.log('\nConsultando pólizas recientes en QuickBooks Online (TxnDate >= 2026-08-25)...')
  const query = "SELECT * FROM JournalEntry WHERE TxnDate >= '2026-08-25' ORDERBY TxnDate DESC MAXRESULTS 10"

  const result: any = await new Promise((resolve, reject) => {
    qbo.query(query, (err: any, data: any) => {
      if (err) reject(err)
      else resolve(data)
    })
  })

  const entries = result?.QueryResponse?.JournalEntry || []
  console.log(`\nEncontradas ${entries.length} pólizas publicadas en QuickBooks Online:`)

  for (const entry of entries) {
    console.log(`\n─────────────────────────────────────────────────────────────────`)
    console.log(`📌 DocNumber: ${entry.DocNumber} | Fecha: ${entry.TxnDate} | ID QB: ${entry.Id}`)
    console.log(`Nota: ${entry.PrivateNote || '—'}`)
    
    // Line summary
    let debits = 0
    let credits = 0
    for (const l of entry.Line || []) {
      const p = l.JournalEntryLineDetail?.PostingType
      if (p === 'Debit') debits += l.Amount || 0
      if (p === 'Credit') credits += l.Amount || 0
    }
    console.log(`Total Débito: $${debits.toFixed(2)} | Total Crédito: $${credits.toFixed(2)} (Cuadrada: ${Math.abs(debits - credits) < 0.01 ? 'SÍ' : 'NO'})`)
  }
}

checkQBLive()

import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import OAuthClient from 'intuit-oauth'
import QuickBooks from 'node-quickbooks'

async function testProperRefresh() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: integration } = await supabase
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  console.log('Integration realmId:', integration.realm_id)

  const oauthClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment: 'production',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
  })

  oauthClient.setToken(integration)

  try {
    console.log('Llamando a oauthClient.refresh()...')
    const res = await oauthClient.refresh()
    const tokens = res.getJson()
    console.log('✅ REFRESH EXITOSO! Nuevo access_token recibido.')
    
    // Update Supabase
    await supabase.from('integrations').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', integration.id)

    // Now test a query to QuickBooks for January 2026!
    const qbo = new QuickBooks(
      process.env.QUICKBOOKS_CLIENT_ID,
      process.env.QUICKBOOKS_CLIENT_SECRET,
      tokens.access_token,
      false,
      integration.realm_id,
      false,
      false,
      null,
      '2.0',
      tokens.refresh_token
    )

    console.log('\nConsultando Journal Entries de ENERO 2026 en QuickBooks Online...')
    const qry = "SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-01-05' MAXRESULTS 5"
    qbo.query(qry, (err: any, data: any) => {
      if (err) {
        console.error('Error en query:', err)
      } else {
        const entries = data?.QueryResponse?.JournalEntry || []
        console.log(`Encontradas ${entries.length} pólizas en QB para Enero 2026:`)
        entries.forEach((e: any) => console.log(`• ID: ${e.Id} | DocNumber: ${e.DocNumber} | Fecha: ${e.TxnDate} | Líneas: ${e.Line?.length}`))
      }
    })

  } catch (e: any) {
    console.error('Error en refresh:', e.originalMessage || e.message)
    if (e.authResponse) {
      console.error('Response data:', e.authResponse.response?.data || e.authResponse.body)
    }
  }
}

testProperRefresh()

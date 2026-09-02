/**
 * READ-ONLY script: Direct HTTPS query to QuickBooks Online API with automatic token refresh
 * Reads Journal Entries by pagination index.
 * 
 * Run via: npx tsx scripts/read-qb-journal-entries.ts
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import axios from 'axios'
import { createClient } from '@supabase/supabase-js'
import OAuthClient from 'intuit-oauth'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

const authClient = new OAuthClient({
  clientId: process.env.QUICKBOOKS_CLIENT_ID!,
  clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
  environment: process.env.QUICKBOOKS_ENVIRONMENT || 'production',
  redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || '',
})

async function main() {
  console.log('=== READ-ONLY: Direct Query to QuickBooks Online API ===')
  console.log('⚠️  Este script SOLO LEE datos reales de QuickBooks, NO modifica nada.\n')

  try {
    const { data: integration, error: intErr } = await supabase
      .from('integrations')
      .select('*')
      .eq('service_name', 'quickbooks')
      .single()

    if (intErr || !integration) {
      throw new Error(`No se encontró integración de QuickBooks: ${intErr?.message}`)
    }

    const realmId = integration.realm_id
    console.log(`🏢 Conectando a QuickBooks Company ID: ${realmId}`)

    // Refrescar token con intuit-oauth
    console.log('🔄 Autenticando y renovando token con Intuit OAuth2...')
    const authResponse = await authClient.refreshUsingToken(integration.refresh_token)
    const tokens = authResponse.getJson()
    const accessToken = tokens.access_token

    await supabase
      .from('integrations')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)

    console.log('✅ Autenticación exitosa\n')

    // Query 5 entries using fast pagination
    const sql = "SELECT * FROM JournalEntry STARTPOSITION 1 MAXRESULTS 5"
    console.log(`📡 Consultando QBO: ${sql}`)

    const qbRes = await axios.get(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/query`,
      {
        params: {
          query: sql,
          minorversion: '75',
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        timeout: 20000,
      }
    )

    const entries = qbRes.data?.QueryResponse?.JournalEntry || []
    console.log(`\n🎉 Se encontraron ${entries.length} Journal Entries en QuickBooks:\n`)

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log(`📋 [Póliza #${i + 1}] ID QBO: ${entry.Id}  |  DocNumber: ${entry.DocNumber || '(sin doc #)'}  |  Fecha: ${entry.TxnDate}`)
      console.log(`   Nota:   ${entry.PrivateNote || '(sin nota)'}`)
      console.log(`   Total:  $${Number(entry.TotalAmt || 0).toFixed(2)}  |  Creado: ${entry.MetaData?.CreateTime}`)
      console.log(`   Líneas: ${entry.Line?.length || 0}`)
      
      if (entry.Line) {
        console.log('')
        console.log('   # | Cuenta ID | Nombre Cuenta                       | Tipo    | Monto       | Descripción')
        console.log('   --|---------- | ----------------------------------- | ------- | ----------- | ----------------------------------------')
        
        let totalDebit = 0
        let totalCredit = 0
        
        entry.Line.forEach((line: any, idx: number) => {
          if (line.DetailType === 'JournalEntryLineDetail') {
            const d = line.JournalEntryLineDetail
            const acctId = String(d?.AccountRef?.value || '?').padEnd(9)
            const acctName = (d?.AccountRef?.name || '?').substring(0, 35).padEnd(35)
            const posting = (d?.PostingType || '?').padEnd(7)
            const amount = Number(line.Amount || 0)
            const desc = (line.Description || '').substring(0, 40)
            
            if (d?.PostingType === 'Debit') totalDebit += amount
            else totalCredit += amount
            
            console.log(`   ${String(idx+1).padStart(2)}| ${acctId} | ${acctName} | ${posting} | $${amount.toFixed(2).padStart(10)} | ${desc}`)
          }
        })
        
        console.log('   --|---------- | ----------------------------------- | ------- | ----------- | ----------------------------------------')
        console.log(`     |           |                                     | DÉBITO  | $${totalDebit.toFixed(2).padStart(10)} |`)
        console.log(`     |           |                                     | CRÉDITO | $${totalCredit.toFixed(2).padStart(10)} |`)
        console.log(`     |           |                                     | BALANCE | ${Math.abs(totalDebit - totalCredit) < 0.01 ? '✅ CUADRADA AL CENTAVO' : '❌ DESBALANCEADA'}\n`)
      }
    }

  } catch (err: any) {
    console.error('\n❌ Error:', err.response?.data || err.message)
  }
}

main().catch(console.error)

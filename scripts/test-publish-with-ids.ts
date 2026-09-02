/**
 * Probar la publicación de Azusa con ClassRef.value y DepartmentRef.value
 * Run via: npx tsx scripts/test-publish-with-ids.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testPublishWithIds() {
  const packetId = '83fd5b90-3a06-4723-9843-30b3e2883e7b'
  const { data: packet } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('*, stores!inner(id, name)')
    .eq('id', packetId)
    .single()

  const { data: glAccounts } = await supabaseAdmin
    .from('accounting_gl_accounts')
    .select('*')

  const accountMap = new Map<string, { qbId: string; name: string }>()
  for (const gl of glAccounts || []) {
    if (gl.qb_account_id) {
      accountMap.set(gl.account_number, { qbId: gl.qb_account_id, name: gl.account_name })
    }
  }

  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${integ.realm_id}`
  const token = integ.access_token

  // Azusa Class ID = '2200000000000075341', Department ID = '12'
  const classId = '2200000000000075341'
  const locationId = '12'

  const qbLines = packet.journal_lines.map((line: any) => {
    const acct = accountMap.get(line.account)
    const amount = line.debit > 0 ? line.debit : line.credit
    const postingType = line.debit > 0 ? 'Debit' : 'Credit'

    return {
      Amount: amount,
      DetailType: 'JournalEntryLineDetail',
      Description: line.sourceMemo,
      JournalEntryLineDetail: {
        PostingType: postingType,
        AccountRef: {
          value: acct?.qbId || '0',
          name: `${line.account} - ${acct?.name || ''}`
        },
        ClassRef: {
          value: classId,
          name: 'Azusa'
        },
        DepartmentRef: {
          value: locationId,
          name: 'Azusa'
        }
      }
    }
  })

  const payload = {
    TxnDate: packet.business_date,
    DocNumber: packet.qb_doc_number,
    PrivateNote: `Daily Sales - Azusa - ${packet.business_date}`,
    Line: qbLines
  }

  console.log('Sending payload to QuickBooks...')
  const res = await fetch(`${baseUrl}/journalentry?minorversion=75`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  console.log('HTTP Status:', res.status, res.statusText)
  const data = await res.json()
  console.log('Response:', JSON.stringify(data, null, 2))
}

testPublishWithIds().catch(console.error)

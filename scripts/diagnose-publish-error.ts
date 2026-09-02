/**
 * Diagnosticar el error 400 al publicar la póliza 83fd5b90-3a06-4723-9843-30b3e2883e7b
 * Run via: npx tsx scripts/diagnose-publish-error.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function diagnosePacket() {
  const packetId = '83fd5b90-3a06-4723-9843-30b3e2883e7b'
  console.log(`Diagnosing packet: ${packetId}`)

  const { data: packet, error } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('*, stores!inner(id, name)')
    .eq('id', packetId)
    .single()

  if (error || !packet) {
    console.error('Packet not found:', error?.message)
    return
  }

  console.log('Packet Store:', packet.stores?.name)
  console.log('Packet Date:', packet.business_date)
  console.log('Packet DocNumber:', packet.qb_doc_number)
  console.log('Packet Status:', packet.status)
  console.log('Journal Lines count:', packet.journal_lines?.length)

  // Fetch GL accounts
  const accountNumbers = Array.from(new Set(packet.journal_lines.map((l: any) => l.account)))
  const { data: glAccounts } = await supabaseAdmin
    .from('accounting_gl_accounts')
    .select('account_number, account_name, qb_account_id')
    .in('account_number', accountNumbers)

  console.log('\nAccount mappings:')
  for (const l of packet.journal_lines) {
    const gl = glAccounts?.find(g => g.account_number === l.account)
    console.log(`  • Acct ${l.account.padEnd(6)} | Memo: ${l.memo.padEnd(30)} | Debit: ${l.debit} | Credit: ${l.credit} | QB ID: #${gl?.qb_account_id}`)
  }

  // Check site mappings
  const { data: siteMapping } = await supabaseAdmin
    .from('accounting_site_mappings')
    .select('*')
    .eq('store_id', packet.store_id)
    .maybeSingle()

  console.log('\nSite Mapping:', siteMapping)

  // Test building payload and sending to QuickBooks in validation/dry-run mode
  const { data: integ } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${integ.realm_id}`
  const token = integ.access_token

  // Build the exact payload
  const accountMap = new Map<string, { qbId: string; name: string }>()
  for (const gl of glAccounts || []) {
    if (gl.qb_account_id) {
      accountMap.set(gl.account_number, { qbId: gl.qb_account_id, name: gl.account_name })
    }
  }

  const qbLines = packet.journal_lines.map((line: any) => {
    const acct = accountMap.get(line.account)
    const amount = line.debit > 0 ? line.debit : line.credit
    const postingType = line.debit > 0 ? 'Debit' : 'Credit'

    const lineDetail: any = {
      PostingType: postingType,
      AccountRef: {
        value: acct?.qbId || '0',
        name: `${line.account} - ${acct?.name || ''}`
      }
    }

    if (siteMapping?.qb_class) {
      lineDetail.ClassRef = { name: siteMapping.qb_class }
    }
    if (siteMapping?.qb_location) {
      lineDetail.DepartmentRef = { name: siteMapping.qb_location }
    }

    return {
      Amount: amount,
      DetailType: 'JournalEntryLineDetail',
      Description: line.sourceMemo,
      JournalEntryLineDetail: lineDetail
    }
  })

  const payload = {
    TxnDate: packet.business_date,
    DocNumber: packet.qb_doc_number,
    PrivateNote: `Daily Sales - ${packet.stores?.name} - ${packet.business_date}`,
    Line: qbLines
  }

  console.log('\nPayload to send:', JSON.stringify(payload, null, 2).substring(0, 1500))

  console.log('\nSimulating POST to QuickBooks API...')
  const res = await fetch(`${baseUrl}/journalentry?minorversion=75`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  console.log('QB Response HTTP Status:', res.status, res.statusText)
  const resBody = await res.text()
  console.log('QB Response Body:\n', resBody)
}

diagnosePacket().catch(console.error)

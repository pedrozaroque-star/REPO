/**
 * @module api/accounting/packets/[id]/publish
 * @description Publishes a packet's journal entry to QuickBooks Online.
 * POST: Builds a QBO JournalEntry from the packet's journal_lines, sends it via
 * the node-quickbooks SDK, and updates the packet status to 'published'.
 *
 * @businessRules
 * - Only packets with status 'ready' or 'reviewed' can be published.
 * - A packet that is already 'published' cannot be re-published (returns 409).
 * - Each journal line's account number is resolved to a QB internal ID from
 *   the accounting_gl_accounts table.
 * - The JournalEntry uses the packet's business_date as TxnDate and qb_doc_number as DocNumber.
 * - On success: status → 'published', stores qb_journal_entry_id and qb_sync_response.
 * - On failure: status remains unchanged, error is logged to accounting_sync_logs.
 *
 * @dataFlow
 * Frontend "Publish" button → POST this route → fetch packet → resolve GL accounts →
 * build QBO JournalEntry → createJournalEntry via SDK → update packet + log
 *
 * @notes
 * - The node-quickbooks SDK uses callback pattern; we wrap calls in Promise.
 * - The QuickBooks client is obtained via getQuickBooksClient() which handles
 *   token refresh automatically.
 * - AccountRef.value must be the QB internal account ID (not our account number).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getQuickBooksClient } from '@/lib/quickbooks'
import type { JournalLine } from '@/lib/accounting-journal'

/** Publishable statuses — packets must be in one of these to proceed */
const PUBLISHABLE_STATUSES = ['ready', 'reviewed']

interface QBJournalEntryLine {
  Amount: number
  DetailType: 'JournalEntryLineDetail'
  Description?: string
  JournalEntryLineDetail: {
    PostingType: 'Debit' | 'Credit'
    AccountRef: { value: string; name: string }
    ClassRef?: { name: string }
    DepartmentRef?: { name: string }
  }
}

interface QBJournalEntry {
  TxnDate: string
  DocNumber: string
  PrivateNote: string
  Line: QBJournalEntryLine[]
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  let body: { performed_by?: string } = {}

  try {
    body = await request.json().catch(() => ({})) as { performed_by?: string }

    // 1. Fetch the packet with store info
    const { data: packet, error: fetchErr } = await supabaseAdmin
      .from('accounting_sales_packets')
      .select('*, stores!inner(id, name)')
      .eq('id', id)
      .single()

    if (fetchErr || !packet) {
      const status = fetchErr?.code === 'PGRST116' ? 404 : 500
      return NextResponse.json(
        { error: status === 404 ? 'Packet not found' : fetchErr?.message },
        { status }
      )
    }

    // 2. Verify the packet is publishable
    if (packet.status === 'published') {
      return NextResponse.json(
        {
          error: 'Packet is already published',
          qb_journal_entry_id: packet.qb_journal_entry_id,
        },
        { status: 409 }
      )
    }

    if (!PUBLISHABLE_STATUSES.includes(packet.status)) {
      return NextResponse.json(
        { error: `Packet status '${packet.status}' is not publishable. Must be: ${PUBLISHABLE_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    const journalLines: JournalLine[] = packet.journal_lines || []
    if (journalLines.length === 0) {
      return NextResponse.json(
        { error: 'Packet has no journal lines. Regenerate the packet first.' },
        { status: 400 }
      )
    }

    // 3. Fetch GL account mappings to resolve QB internal IDs
    const accountNumbers = Array.from(new Set(journalLines.map((l) => l.account)))
    const { data: glAccounts, error: glErr } = await supabaseAdmin
      .from('accounting_gl_accounts')
      .select('account_number, account_name, qb_account_id')
      .in('account_number', accountNumbers)

    if (glErr) {
      console.error('[Accounting] GL accounts lookup error:', glErr)
      return NextResponse.json(
        { error: 'Failed to look up GL accounts', details: glErr.message },
        { status: 500 }
      )
    }

    // Build a lookup map: account_number → { qb_account_id, account_name }
    const accountMap = new Map<string, { qbId: string; name: string }>()
    for (const gl of glAccounts || []) {
      if (gl.qb_account_id) {
        accountMap.set(gl.account_number, {
          qbId: gl.qb_account_id,
          name: gl.account_name,
        })
      }
    }

    // Verify all accounts have QB IDs
    const missingAccounts = accountNumbers.filter((num) => !accountMap.has(num))
    if (missingAccounts.length > 0) {
      return NextResponse.json(
        {
          error: 'Some GL accounts are missing QuickBooks IDs. Sync accounts first.',
          missingAccounts,
        },
        { status: 400 }
      )
    }

    // 4. Build the QBO JournalEntry object
    const storeName = (packet.stores as { name: string })?.name || `Store ${packet.store_id}`
    const formattedDate = new Date(packet.business_date + 'T12:00:00').toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })

    // Fetch site mapping for Class and Location
    const { data: siteMapping } = await supabaseAdmin
      .from('accounting_site_mappings')
      .select('qb_location, qb_class')
      .eq('store_id', packet.store_id)
      .maybeSingle()

    const qbLines: QBJournalEntryLine[] = journalLines.map((line) => {
      const acct = accountMap.get(line.account)!
      const amount = line.debit > 0 ? line.debit : line.credit
      const postingType: 'Debit' | 'Credit' = line.debit > 0 ? 'Debit' : 'Credit'

      const lineDetail: QBJournalEntryLine['JournalEntryLineDetail'] = {
        PostingType: postingType,
        AccountRef: {
          value: acct.qbId,
          name: `${line.account} - ${acct.name}`,
        },
      }

      const qbClass = siteMapping?.qb_class || line.className || (line as any).class
      if (qbClass) {
        lineDetail.ClassRef = { name: qbClass }
      }

      const qbLocation = siteMapping?.qb_location || line.location
      if (qbLocation) {
        lineDetail.DepartmentRef = { name: qbLocation }
      }

      return {
        Amount: amount,
        DetailType: 'JournalEntryLineDetail' as const,
        Description: line.sourceMemo,
        JournalEntryLineDetail: lineDetail,
      }
    })

    const journalEntry: QBJournalEntry = {
      TxnDate: packet.business_date,
      DocNumber: packet.qb_doc_number || '',
      PrivateNote: `Daily Sales - ${storeName} - ${formattedDate}`,
      Line: qbLines,
    }

    // 5. Get QuickBooks client and publish
    const qbo = await getQuickBooksClient()

    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      qbo.createJournalEntry(journalEntry, (err: unknown, data: Record<string, unknown>) => {
        if (err) reject(err)
        else resolve(data)
      })
    })

    // 6. Update packet with QB response
    const qbEntryId = (result as { Id?: string })?.Id || null

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('accounting_sales_packets')
      .update({
        status: 'published',
        qb_journal_entry_id: qbEntryId,
        qb_sync_response: result,
        published_at: new Date().toISOString(),
        published_by: body.performed_by || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[Accounting] Failed to update packet after publish:', updateErr)
      // The JE was created in QB — log the issue but still return success
    }

    // 7. Log success to accounting_sync_logs
    await supabaseAdmin.from('accounting_sync_logs').insert({
      packet_id: id,
      store_id: packet.store_id,
      business_date: packet.business_date,
      action: 'publish',
      performed_by: body.performed_by || null,
      details: {
        qb_journal_entry_id: qbEntryId,
        doc_number: packet.qb_doc_number,
        line_count: qbLines.length,
      },
      qb_response: result,
    })

    return NextResponse.json({
      success: true,
      packet: updated || { id, status: 'published', qb_journal_entry_id: qbEntryId },
      qb_journal_entry_id: qbEntryId,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const details = err instanceof Error ? err.stack : String(err)
    console.error('[Accounting] Publish error:', details)

    // Log failure — id is available from the outer scope
    try {
      await supabaseAdmin.from('accounting_sync_logs').insert({
        packet_id: id,
        action: 'publish',
        error_message: message,
        details: { error: message, stack: details },
      })
    } catch {
      // Best-effort logging — don't mask the original error
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}

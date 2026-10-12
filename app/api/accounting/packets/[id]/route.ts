/**
 * @module api/accounting/packets/[id]
 * @description API route for viewing and updating a single accounting sales packet.
 * GET: Returns detailed packet data including journal lines and store info.
 * PATCH: Updates packet status (review, reject, reopen), cash_deposit, and notes.
 *
 * @businessRules
 * - Status transitions: ready → reviewed → published (forward flow).
 * - A packet can be rejected from 'ready' or 'reviewed' → 'rejected'.
 * - A rejected or reviewed packet can be reopened back to 'ready'.
 * - When status changes to 'reviewed', sets reviewed_at and reviewed_by.
 * - Updating cash_deposit recalculates cash_over_short (cash_deposit - expected_cash).
 * - Every status change or meaningful update is logged to accounting_sync_logs.
 *
 * @dataFlow
 * Frontend packet detail → GET this route → display journal lines
 * Frontend review/reject action → PATCH this route → update status + log
 *
 * @notes
 * - Only packets with status 'ready' or 'reviewed' can be published (handled by publish route).
 * - The cash_over_short generated column is NOT written directly; we compute it manually.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateJournalLines } from '@/lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '@/lib/accounting-journal'

/** Valid status transitions map: current status → allowed next statuses */
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['ready'],
  ready: ['reviewed', 'rejected'],
  reviewed: ['rejected', 'ready'], // Publishing is done via /publish endpoint
  rejected: ['ready'],
  published: [], // Cannot change from published
}

/** Actions that map to sync log action names */
const STATUS_TO_ACTION: Record<string, string> = {
  reviewed: 'review',
  rejected: 'reject',
  ready: 'reopen',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data, error } = await supabaseAdmin
      .from('accounting_sales_packets')
      .select('*, stores!inner(id, name)')
      .eq('id', id)
      .single()

    if (error) {
      console.error('[Accounting] GET packet detail error:', error)
      const status = error.code === 'PGRST116' ? 404 : 500
      return NextResponse.json(
        { error: status === 404 ? 'Packet not found' : error.message },
        { status }
      )
    }

    return NextResponse.json({ packet: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Accounting] GET packet detail error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

interface PatchBody {
  status?: string
  cash_deposit?: number
  notes?: string
  performed_by?: string
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: PatchBody = await request.json()
    const { status: newStatus, cash_deposit, notes, performed_by } = body

    const isUuid = (val?: string) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val))

    // 1. Fetch the current packet with store details
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

    // 2. Build the update payload
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    // 3. Handle status change
    if (newStatus && newStatus !== packet.status) {
      const allowed = VALID_TRANSITIONS[packet.status as string] || []
      if (!allowed.includes(newStatus)) {
        return NextResponse.json(
          {
            error: `Invalid status transition: '${packet.status}' → '${newStatus}'. Allowed: ${allowed.join(', ') || 'none'}`,
          },
          { status: 400 }
        )
      }

      updatePayload.status = newStatus

      // Set review metadata
      if (newStatus === 'reviewed') {
        updatePayload.reviewed_at = new Date().toISOString()
        updatePayload.reviewed_by = isUuid(performed_by) ? performed_by : null
      }

      // Clear review metadata on reopen
      if (newStatus === 'ready' && packet.status === 'reviewed') {
        updatePayload.reviewed_at = null
        updatePayload.reviewed_by = null
      }
    }

    // 4. Handle cash_deposit update
    if (cash_deposit !== undefined && cash_deposit !== null) {
      if (packet.status === 'published') {
        return NextResponse.json(
          { error: 'No se puede modificar el depósito de una póliza ya publicada a QuickBooks Online.' },
          { status: 400 }
        )
      }
      const newDeposit = Math.round(Number(cash_deposit) * 100) / 100
      const expectedCash = Number(packet.expected_cash || 0)
      const cashDiff = Math.round((newDeposit - expectedCash) * 100) / 100

      // Rebalancear journal_lines
      const currentLines: any[] = [...(packet.journal_lines || [])]

      // Actualizar o agregar línea 13200 (Deposit To Bank)
      const depositLineIdx = currentLines.findIndex((l: any) => l.memo === 'Deposit To Bank' || l.sourceMemo === 'Cash Deposits')
      if (newDeposit > 0) {
        if (depositLineIdx >= 0) {
          currentLines[depositLineIdx].debit = newDeposit
        } else {
          currentLines.push({
            account: '13200',
            memo: 'Deposit To Bank',
            debit: newDeposit,
            credit: 0,
            sourceMemo: 'Cash Deposits',
            location: currentLines[0]?.location || '',
            className: currentLines[0]?.className || '',
          })
        }
      } else if (depositLineIdx >= 0) {
        currentLines.splice(depositLineIdx, 1)
      }

      // Actualizar o agregar línea 51050 (Cash Over/(Short))
      const overShortIdx = currentLines.findIndex((l: any) =>
        (l.account === '51050' || l.memo?.toLowerCase().includes('over') || l.memo?.toLowerCase().includes('short')) &&
        !l.memo?.toLowerCase().includes('paid in')
      )

      if (cashDiff > 0) {
        // Sobrante: Credit
        if (overShortIdx >= 0) {
          currentLines[overShortIdx].memo = 'Cash Over/(Short)'
          currentLines[overShortIdx].credit = cashDiff
          currentLines[overShortIdx].debit = 0
          currentLines[overShortIdx].sourceMemo = 'Cash Overage'
        } else {
          currentLines.push({
            account: '51050',
            memo: 'Cash Over/(Short)',
            debit: 0,
            credit: cashDiff,
            sourceMemo: 'Cash Overage',
            location: currentLines[0]?.location || '',
            className: currentLines[0]?.className || '',
          })
        }
      } else if (cashDiff < 0) {
        // Faltante: Debit
        if (overShortIdx >= 0) {
          currentLines[overShortIdx].memo = 'Over/(Short)'
          currentLines[overShortIdx].debit = Math.abs(cashDiff)
          currentLines[overShortIdx].credit = 0
          currentLines[overShortIdx].sourceMemo = 'Calculated'
        } else {
          currentLines.push({
            account: '51050',
            memo: 'Over/(Short)',
            debit: Math.abs(cashDiff),
            credit: 0,
            sourceMemo: 'Calculated',
            location: currentLines[0]?.location || '',
            className: currentLines[0]?.className || '',
          })
        }
      } else if (overShortIdx >= 0) {
        currentLines.splice(overShortIdx, 1)
      }

      const totalDebits = Math.round(currentLines.reduce((sum: number, l: any) => sum + (Number(l.debit) || 0), 0) * 100) / 100
      const totalCredits = Math.round(currentLines.reduce((sum: number, l: any) => sum + (Number(l.credit) || 0), 0) * 100) / 100

      updatePayload.cash_deposit = newDeposit
      updatePayload.cash_over_short = cashDiff
      updatePayload.journal_lines = currentLines
      updatePayload.journal_total_debits = totalDebits
      updatePayload.journal_total_credits = totalCredits
      if (totalDebits === totalCredits && packet.status === 'pending') {
        updatePayload.status = 'ready'
      }
    }

    // 5. Handle notes update
    if (notes !== undefined) {
      updatePayload.notes = notes
    }

    // 6. Apply the update
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('accounting_sales_packets')
      .update(updatePayload)
      .eq('id', id)
      .select('*, stores!inner(id, name)')
      .single()

    if (updateErr) {
      console.error('[Accounting] PATCH packet error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // 7. Log action to accounting_sync_logs
    const logAction = newStatus
      ? STATUS_TO_ACTION[newStatus] || 'review'
      : 'recalculate'

    await supabaseAdmin.from('accounting_sync_logs').insert({
      packet_id: id,
      store_id: packet.store_id,
      business_date: packet.business_date,
      action: logAction,
      performed_by: performed_by || null,
      details: {
        previous_status: packet.status,
        new_status: newStatus || packet.status,
        ...(cash_deposit !== undefined ? { cash_deposit, previous_cash_deposit: packet.cash_deposit } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
    })

    return NextResponse.json({ packet: updated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Accounting] PATCH packet error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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

    // 4. El depósito en banco es estrictamente de solo lectura desde Toast POS Cash Management
    if (cash_deposit !== undefined && cash_deposit !== null) {
      return NextResponse.json(
        { error: 'El depósito bancario no es editable manualmente. Debe registrarse directamente en la terminal de Toast POS por el gerente de la sucursal.' },
        { status: 400 }
      )
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

/**
 * @module api/accounting/packets/publish-batch
 * @description Batch publish all ready/reviewed packets for a specific date to QuickBooks Online.
 * Allows Raquel to publish all 15 stores' journal entries for a day with one click.
 * 
 * @businessRules
 * - Only publishes packets with status 'ready' or 'reviewed'.
 * - Skips packets that are already 'published' or 'rejected'.
 * - Each packet is published independently — failure of one doesn't block others.
 * - All results are logged to accounting_sync_logs.
 * 
 * @dataFlow
 * POST { businessDate } → fetch packets → publish each to QB → update statuses → return summary
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { businessDate } = body as { businessDate: string }

    if (!businessDate) {
      return NextResponse.json({ error: 'businessDate is required' }, { status: 400 })
    }

    // Get all publishable packets for the date
    const { data: packets, error: fetchErr } = await supabaseAdmin
      .from('accounting_sales_packets')
      .select('*, stores!inner(name)')
      .eq('business_date', businessDate)
      .in('status', ['ready', 'reviewed'])

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    if (!packets || packets.length === 0) {
      return NextResponse.json({ 
        error: 'No publishable packets found for this date',
        businessDate 
      }, { status: 404 })
    }

    // Publish each packet individually
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const results: { store: string; id: string; success: boolean; error?: string }[] = []

    for (const packet of packets) {
      const storeName = (packet as any).stores?.name || `Store ${packet.store_id}`
      try {
        const res = await fetch(`${baseUrl}/api/accounting/packets/${packet.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        const result = await res.json()

        if (res.ok) {
          results.push({ store: storeName, id: packet.id, success: true })
        } else {
          results.push({ store: storeName, id: packet.id, success: false, error: result.error })
        }
      } catch (err: any) {
        results.push({ store: storeName, id: packet.id, success: false, error: err.message })
      }
    }

    const published = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    // Log batch action
    await supabaseAdmin.from('accounting_sync_logs').insert({
      business_date: businessDate,
      action: 'publish',
      details: { batch: true, published, failed, results },
    })

    return NextResponse.json({
      success: true,
      businessDate,
      published,
      failed,
      total: packets.length,
      results,
    })
  } catch (err: any) {
    console.error('[Accounting] Batch publish error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

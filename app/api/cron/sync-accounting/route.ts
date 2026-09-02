/**
 * @module api/cron/sync-accounting
 * @description Cron job that automatically generates accounting sales packets for the previous business day.
 * Runs daily at 7:00 AM PST (14:00 UTC) — after the business day closes at 5:59 AM.
 * 
 * @businessRules
 * - Business day starts at 6:00 AM and ends at 5:59 AM next day (America/Los_Angeles).
 * - Only generates packets for dates that don't already have a 'published' packet.
 * - Uses sales_daily_cache as the data source (populated by the existing sync-sales cron).
 * - Packets are created with status 'ready' for Raquel to review and publish.
 * 
 * @dataFlow
 * Cron trigger → read sales_daily_cache → generate journal lines → upsert accounting_sales_packets
 * 
 * @notes
 * - This cron should run AFTER the sync-sales cron finishes (which populates sales_daily_cache).
 * - Vercel cron schedule: "0 14 * * *" (14:00 UTC = 7:00 AM PST)
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    // Calculate yesterday's business date in LA timezone
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const laHour = laTime.getHours()

    // If before 6 AM, the business "yesterday" is actually 2 days ago
    const daysBack = laHour < 6 ? 2 : 1
    const targetDate = new Date(laTime)
    targetDate.setDate(targetDate.getDate() - daysBack)
    const businessDate = targetDate.toISOString().split('T')[0]

    console.log(`[sync-accounting] Generating packets for business date: ${businessDate}`)

    // Call the generate endpoint internally
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const res = await fetch(`${baseUrl}/api/accounting/packets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: businessDate,
        endDate: businessDate,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      console.error('[sync-accounting] Error:', result)
      return NextResponse.json({ error: result.error, businessDate }, { status: 500 })
    }

    console.log(`[sync-accounting] ✅ Generated ${result.generated} packets for ${businessDate}`)

    // Log the sync
    await supabaseAdmin.from('accounting_sync_logs').insert({
      business_date: businessDate,
      action: 'generate',
      details: {
        generated: result.generated,
        errors: result.errors,
        trigger: 'cron',
      },
    })

    return NextResponse.json({
      success: true,
      businessDate,
      generated: result.generated,
      errors: result.errors,
    })
  } catch (err: any) {
    console.error('[sync-accounting] Cron error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

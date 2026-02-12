import { NextResponse } from 'next/server'
import { syncMenuFromToast } from '@/lib/inventory/toast-sync'

// CRON JOB ENDPOINT
// Can be called via Vercel Cron or Manually
export async function GET(request: Request) {
    try {
        // Optional: Check for Cron Secret if needed
        const authHeader = request.headers.get('authorization')
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // return new NextResponse('Unauthorized', { status: 401 })
            // For dev/testing, we might allow it.
        }

        const result = await syncMenuFromToast()

        if (result.success) {
            return NextResponse.json({ message: 'Menu Synced Successfully', count: result.count })
        } else {
            return NextResponse.json({ error: result.error }, { status: 500 })
        }

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

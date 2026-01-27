
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic' // Siempre fresco

export async function GET() {
    return NextResponse.json({
        // Vercel inyecta esto automáticamente. En local será 'dev'.
        version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
        timestamp: Date.now()
    })
}

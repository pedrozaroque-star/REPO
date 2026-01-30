
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic' // Siempre fresco

export async function GET() {
    return NextResponse.json({
        version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
        message: process.env.VERCEL_GIT_COMMIT_MESSAGE || 'Mejoras generales y optimización',
        timestamp: Date.now()
    })
}

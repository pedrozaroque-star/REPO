/**
 * @module api/intelligence/staffing-guidance
 * @description Endpoint autenticado que genera pronósticos inteligentes de ventas, tickets y dotación recomendada (FOH/BOH) por sucursal y fecha.
 *
 * @businessRules
 * - Exige autenticación de personal interno (`verifyStaffAuth`, con soporte de respaldo para `CRON_SECRET` cuando esté configurado).
 *
 * @dataFlow
 * - GET `/api/intelligence/staffing-guidance?storeId=...&date=YYYY-MM-DD` -> `verifyStaffAuth` -> `generateSmartForecast()` -> JSON.
 *
 * @notes
 * - Endurecido 2026-11-20: agregada protección obligatoria `verifyStaffAuth`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'
import { verifyStaffAuth } from '@/lib/auth-server'

export async function GET(req: NextRequest) {
    const auth = verifyStaffAuth(req)
    if (!auth.authorized) {
        return auth.response!
    }

    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')
    const date = searchParams.get('date')

    if (!storeId || !date) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    try {
        const forecast = await generateSmartForecast(storeId, date)
        return NextResponse.json(forecast)
    } catch (e) {
        console.error(e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

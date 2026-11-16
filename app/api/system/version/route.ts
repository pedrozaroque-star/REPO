
/**
 * @module api/system/version
 * @description Devuelve el identificador del despliegue actual (`VERCEL_GIT_COMMIT_SHA`) para detección de actualizaciones en clientes.
 * @businessRules
 * - Cacheado 60 segundos en Vercel CDN (`s-maxage=60`) porque el SHA de compilación es inmutable dentro de un mismo despliegue,
 *   eliminando más de 1.1 millones de invocaciones mensuales de funciones Serverless sin retrasar avisos de actualización.
 * @dataFlow
 * - GET /api/system/version -> Vercel Edge CDN Cache (60s) -> SystemUpdateDetector.
 * @notes
 * - Optimizado el 2026-11-16 para reducir consumo de Function Invocations en Vercel Pro.
 */
import { NextResponse } from 'next/server'

export async function GET() {
    return NextResponse.json(
        {
            version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
            message: process.env.VERCEL_GIT_COMMIT_MESSAGE || 'Mejoras generales y optimización',
            timestamp: Date.now()
        },
        {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60'
            }
        }
    )
}

/**
 * @module api/cron/audit-grubhub/route
 * @description Endpoint de cron de Vercel y ejecución bajo demanda para auditar la integración de Grubhub con Toast POS en las 15 sucursales de Tacos Gavilan.
 * 
 * @businessRules
 * - Horario laboral del negocio: 6:00 AM a 5:59 AM del siguiente día (Turno PM inicia a las 5:00 PM).
 * - Audita el día de negocio cerrado inmediato anterior en la zona horaria de Los Ángeles (America/Los_Angeles).
 * - En la fecha de revisión oficial (30 de septiembre de 2026, auditando el 29/09), envía el reporte completo automáticamente por correo a carlos@tacosgavilan.com.
 * - En ejecuciones diarias subsecuentes, envía alerta inmediata si la diferencia contable (drift) supera $0.50 o si se solicitó con ?forceEmail=true.
 * 
 * @dataFlow
 * - Vercel Cron (07:30 AM PDT) -> GET /api/cron/audit-grubhub -> lib/grubhub-audit-sentinel.ts -> Toast API + Supabase -> Nodemailer -> carlos@tacosgavilan.com.
 * 
 * @notes
 * - Soporta autenticación por Bearer token CRON_SECRET y parámetro de consulta ?date=YYYY-MM-DD para auditorías históricas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeGrubhubAudit, sendGrubhubAuditEmail } from '@/lib/grubhub-audit-sentinel'

export const maxDuration = 300 // 5 minutos máximo para procesar 15 tiendas vía Toast API
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization')
        if (process.env.CRON_SECRET) {
            const isBearerValid = authHeader === `Bearer ${process.env.CRON_SECRET}`
            const hasSecretQuery = req.nextUrl.searchParams.get('secret') === process.env.CRON_SECRET
            if (!isBearerValid && !hasSecretQuery) {
                // Permitir en local si no hay token o validar
                if (process.env.NODE_ENV === 'production') {
                    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
                }
            }
        }

        const { searchParams } = new URL(req.url)
        const customDate = searchParams.get('date') // Formato YYYY-MM-DD
        const forceEmail = searchParams.get('forceEmail') === 'true'

        // Calcular fecha objetivo (por defecto ayer en hora de Los Ángeles)
        let targetDateYMD = customDate
        if (!targetDateYMD) {
            const now = new Date()
            const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
            if (laNow.getHours() < 6) {
                laNow.setDate(laNow.getDate() - 1)
            }
            const yesterday = new Date(laNow)
            yesterday.setDate(yesterday.getDate() - 1)
            const y = yesterday.getFullYear()
            const m = String(yesterday.getMonth() + 1).padStart(2, '0')
            const d = String(yesterday.getDate()).padStart(2, '0')
            targetDateYMD = `${y}-${m}-${d}`
        }

        console.log(`🛡️ [CRON AUDIT GRUBHUB] Iniciando auditoría para fecha de negocio: ${targetDateYMD}`)

        const report = await executeGrubhubAudit(targetDateYMD)

        if (!report) {
            return NextResponse.json({ error: 'Audit returned empty report', targetDate: targetDateYMD }, { status: 500 })
        }

        // Reglas de envío de correo:
        // 1. Si forceEmail=true.
        // 2. Si la fecha auditada es el día del cambio (2026-09-29).
        // 3. Si hay descuadre contable (drift > $0.50).
        // 4. Si se detectaron promociones en caja (ordersWithDiscountsCount > 0).
        const isLaunchDayAudit = targetDateYMD === '2026-09-29'
        const shouldSendEmail = forceEmail || isLaunchDayAudit || !report.isBalanced || report.ordersWithDiscountsCount > 0

        let emailSent = false
        if (shouldSendEmail) {
            emailSent = await sendGrubhubAuditEmail(report)
        }

        return NextResponse.json({
            success: true,
            targetDate: targetDateYMD,
            isBalanced: report.isBalanced,
            totalOrders: report.totalOrders,
            totalNetSales: report.totalNetSales,
            totalDiscounts: report.totalDiscounts,
            totalTax: report.totalTax,
            totalPayments: report.totalPayments,
            totalDrift: report.totalDrift,
            emailSent,
            report
        })

    } catch (e: any) {
        console.error('❌ [CRON AUDIT GRUBHUB] Error fatal:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

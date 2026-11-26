/**
 * @module api/cron/report-breaks
 * @description Cron semanal recurrente ejecutado todos los lunes a las 5:00 AM PST (12:00 UTC) para auditar
 * las infracciones de descansos (Breaks de 10 min) y almuerzos (Lunches de 30 min) en todas las sucursales de Tacos Gavilan
 * durante la semana anterior (lunes a domingo), despachando un reporte ejecutivo consolidado a Dirección General
 * (Raquel Velazquez, Roberto Velazquez), Carlos y Supervisores de Zona desde `noreply@tacosgavilan.com`.
 *
 * @businessRules
 * - Período evaluado: Semana completa inmediata anterior (lunes a domingo, `America/Los_Angeles`).
 * - Tiempos oficiales autorizados: 10 minutos exactos para Rest Break pagado y 30 minutos exactos para Meal Lunch no pagado.
 * - Evaluación unificada mediante `evaluatePunchBreakViolation` (`lib/break-violations-policy.ts`: Break >= 12m, Lunch >= 33m).
 * - REGLA ESTRICTA: Cero mención de márgenes de tolerancia en el cuerpo del correo o encabezados.
 * - Destinatarios: Dirección General (`raquel@tacosgavilan.com`, `roberto@tacosgavilan.com`), `carlos@tacosgavilan.com`
 *   y Supervisores de Zona asignados en `stores` (`ricardo@tacosgavilan.com`, `javier@tacosgavilan.com`, etc.).
 * - Envío institucional desde `noreply@tacosgavilan.com` vía `sendSystemEmail` (`lib/system-mailer.ts`).
 *
 * @dataFlow
 * - Vercel Cron (`0 12 * * 1`) -> `stores` + `punches` + `toast_employees` -> `evaluatePunchBreakViolation` ->
 *   HTML ejecutivo con KPIs y agrupación por Supervisor -> `sendSystemEmail`.
 *
 * @notes
 * - Especifica explícitamente en encabezado y asunto que audita `PLANIFICADOR (EXCLUSIVO TOAST POS)`,
 *   diferenciándolo de las tarjetas de nómina de RONOS (Cingular HR).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
    escapeHtmlSafe,
    evaluatePunchBreakViolation,
    formatBusinessDateEs,
    formatTimeLA,
    INTERNAL_BREAK_MIN_VIOLATION_MINUTES,
    INTERNAL_LUNCH_MIN_VIOLATION_MINUTES,
} from '@/lib/break-violations-policy'
import { sendSystemEmail } from '@/lib/system-mailer'
import { compareStoreNamesAlphabetically, formatStoreDisplayName } from '@/lib/store-display'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CORPORATE_TEST_EMAIL_REGEX = /^[a-z0-9._%+-]+@tacosgavilan\.com$/i

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(req: Request) {
    const auth = verifyStaffAuth(req, {
        allowedRoles: ['admin', 'supervisor'],
        allowCron: true,
    })
    if (!auth.authorized) return auth.response!

    try {
        const url = new URL(req.url)
        const isDryRun = url.searchParams.get('dry_run') === 'true'
        const testToParam = (url.searchParams.get('test_to') || '').trim()

        if (testToParam && testToParam !== 'all' && !CORPORATE_TEST_EMAIL_REGEX.test(testToParam)) {
            return NextResponse.json(
                { error: 'Destinatario test_to restringido exclusivamente a cuentas @tacosgavilan.com' },
                { status: 403 }
            )
        }

        // Rango de la semana anterior completa (lunes a domingo) en hora de California
        const laTime = new Date(
            new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
        )
        const pastSunday = new Date(laTime)
        pastSunday.setDate(laTime.getDate() - (laTime.getDay() === 0 ? 7 : laTime.getDay()))

        const pastMonday = new Date(pastSunday)
        pastMonday.setDate(pastSunday.getDate() - 6)

        const formatDate = (date: Date) => {
            const y = date.getFullYear()
            const m = String(date.getMonth() + 1).padStart(2, '0')
            const d = String(date.getDate()).padStart(2, '0')
            return `${y}-${m}-${d}`
        }

        const mondayStr = url.searchParams.get('start_date') || formatDate(pastMonday)
        const sundayStr = url.searchParams.get('end_date') || formatDate(pastSunday)

        // 1. Consultar sucursales y supervisores
        const { data: stores } = await supabase
            .from('stores')
            .select('id, name, supervisor_name, external_id, supervisor_id, users!stores_supervisor_id_fkey(email)')
            .eq('is_active', true)

        // 2. Consultar ponchadas paginadas
        const punches: any[] = []
        let currentOffset = 0
        const pageSize = 1000
        while (true) {
            const { data: chunk, error } = await supabase
                .from('punches')
                .select('store_id, employee_toast_guid, business_date, breaks')
                .gte('business_date', mondayStr)
                .lte('business_date', sundayStr)
                .order('toast_id', { ascending: true })
                .range(currentOffset, currentOffset + pageSize - 1)

            if (error) {
                console.error('Punches fetch error:', error)
                break
            }
            if (!chunk || chunk.length === 0) break
            punches.push(...chunk)
            if (chunk.length < pageSize) break
            currentOffset += pageSize
        }

        if (punches.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No punches found for the previous week',
                period: `${mondayStr} to ${sundayStr}`,
            })
        }

        // 3. Consultar empleados
        const uniqueEmpIds = Array.from(
            new Set(punches.map((p: any) => p.employee_toast_guid))
        ).filter(Boolean)
        const emps: any[] = []
        for (let i = 0; i < uniqueEmpIds.length; i += 500) {
            const chunk = uniqueEmpIds.slice(i, i + 500)
            const { data } = await supabase
                .from('toast_employees')
                .select('toast_guid, first_name, last_name, chosen_name')
                .in('toast_guid', chunk)
            if (data) emps.push(...data)
        }

        // 4. Evaluar infracciones con la política unificada
        interface Violation {
            supervisor: string
            storeName: string
            empName: string
            type: 'BRK' | 'LUN'
            allowedMins: number
            date: string
            inTime: string
            outTime: string
            diffMins: number
            excessMins: number
        }

        const violations: Violation[] = []

        for (const p of punches) {
            if (!Array.isArray(p.breaks)) continue
            const store = stores?.find(
                (s) => s.external_id === p.store_id || String(s.id) === String(p.store_id)
            )
            if (!store) continue

            for (const b of p.breaks) {
                const evalRes = evaluatePunchBreakViolation({
                    paid: b.paid,
                    inDate: b.inDate,
                    outDate: b.outDate,
                })
                if (!evalRes || !evalRes.isViolation) continue
                const minViolationThreshold =
                    evalRes.type === 'BRK'
                        ? INTERNAL_BREAK_MIN_VIOLATION_MINUTES
                        : INTERNAL_LUNCH_MIN_VIOLATION_MINUTES
                if (evalRes.actualMinutes < minViolationThreshold) continue

                const emp = emps.find((e) => e.toast_guid === p.employee_toast_guid)
                violations.push({
                    supervisor: store.supervisor_name || 'Sin Asignar',
                    storeName: formatStoreDisplayName({ id: store.id, name: store.name ? store.name.replace(/toast/i, '').trim() : '' }) || 'Tienda',
                    empName: emp
                        ? `${emp.chosen_name || emp.first_name || ''} ${emp.last_name || ''}`.trim()
                        : 'Desconocido',
                    type: evalRes.type,
                    allowedMins: evalRes.allowedMinutes,
                    date: p.business_date,
                    inTime: b.inDate,
                    outTime: b.outDate,
                    diffMins: evalRes.actualMinutes,
                    excessMins: evalRes.excessMinutes,
                })
            }
        }

        if (violations.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No break or lunch violations detected for the week. 100% compliance!',
                period: `${mondayStr} to ${sundayStr}`,
            })
        }

        // 5. Ordenar por Supervisor -> Sucursal -> Empleado -> Fecha
        violations.sort((a, b) => {
            if (a.supervisor !== b.supervisor) return a.supervisor.localeCompare(b.supervisor, 'es', { sensitivity: 'base' })
            const storeCmp = compareStoreNamesAlphabetically(a.storeName, b.storeName)
            if (storeCmp !== 0) return storeCmp
            if (a.empName !== b.empName) return a.empName.localeCompare(b.empName, 'es', { sensitivity: 'base' })
            return a.date.localeCompare(b.date)
        })

        const totalViolations = violations.length
        const totalBreaks = violations.filter((v) => v.type === 'BRK').length
        const totalLunches = violations.filter((v) => v.type === 'LUN').length
        const affectedStoresCount = new Set(violations.map((v) => v.storeName)).size

        let tableRows = ''
        let currentSupervisor = ''

        for (const v of violations) {
            if (currentSupervisor !== v.supervisor) {
                currentSupervisor = v.supervisor
                tableRows += `
                    <tr>
                        <td colspan="8" style="background-color: #f1f5f9; font-weight: bold; padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #1e293b; text-transform: uppercase; font-size: 13px;">
                            👔 SUPERVISOR(A): ${escapeHtmlSafe(currentSupervisor)}
                        </td>
                    </tr>
                `
            }

            const typeBadge =
                v.type === 'BRK'
                    ? '<span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 9999px; font-weight: 600; font-size: 11px; display: inline-block; white-space: nowrap;">☕ Break (10m)</span>'
                    : '<span style="background-color: #ede9fe; color: #5b21b6; padding: 3px 8px; border-radius: 9999px; font-weight: 600; font-size: 11px; display: inline-block; white-space: nowrap;">🍽️ Lunch (30m)</span>'

            tableRows += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #1f2937;">${escapeHtmlSafe(v.storeName)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #374151;">${escapeHtmlSafe(v.empName)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; color: #4b5563; font-size: 12px;">${escapeHtmlSafe(formatBusinessDateEs(v.date))}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${typeBadge}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 12px;">${v.allowedMins}m</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: bold; font-size: 13px;">${v.diffMins} min</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #b91c1c; font-weight: 600; font-size: 12px;">+${v.excessMins}m</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #4b5563; white-space: nowrap;">${escapeHtmlSafe(formatTimeLA(v.inTime))} ➔ ${escapeHtmlSafe(formatTimeLA(v.outTime))}</td>
                </tr>
            `
        }

        const htmlBody = `
            <div style="font-family: Arial, Helvetica, sans-serif; color: #333; max-width: 860px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
                <div style="background-color: #b91c1c; color: #ffffff; padding: 24px 20px; text-align: center;">
                    <div style="font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">TACOS GAVILAN • PLANIFICADOR (EXCLUSIVO TOAST POS)</div>
                    <h1 style="margin: 0; font-size: 22px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Reporte Semanal de Infracciones: Breaks y Lunches (Toast POS)</h1>
                    <p style="margin: 8px 0 0 0; opacity: 0.95; font-size: 14px;">Semana del ${escapeHtmlSafe(formatBusinessDateEs(mondayStr))} al ${escapeHtmlSafe(formatBusinessDateEs(sundayStr))}</p>
                </div>

                <div style="padding: 24px;">
                    <div style="display: table; width: 100%; table-layout: fixed; margin-bottom: 20px;">
                        <div style="display: table-row;">
                            <div style="display: table-cell; width: 25%; padding: 4px;">
                                <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 8px; text-align: center;">
                                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #991b1b; letter-spacing: 0.5px;">Total Infracciones</div>
                                    <div style="font-size: 26px; font-weight: 800; color: #b91c1c; margin-top: 4px;">${totalViolations}</div>
                                </div>
                            </div>
                            <div style="display: table-cell; width: 25%; padding: 4px;">
                                <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 8px; text-align: center;">
                                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #92400e; letter-spacing: 0.5px;">Breaks Excedidos (10m)</div>
                                    <div style="font-size: 26px; font-weight: 800; color: #d97706; margin-top: 4px;">${totalBreaks}</div>
                                </div>
                            </div>
                            <div style="display: table-cell; width: 25%; padding: 4px;">
                                <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 14px 8px; text-align: center;">
                                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b21a8; letter-spacing: 0.5px;">Lunches Excedidos (30m)</div>
                                    <div style="font-size: 26px; font-weight: 800; color: #7c3aed; margin-top: 4px;">${totalLunches}</div>
                                </div>
                            </div>
                            <div style="display: table-cell; width: 25%; padding: 4px;">
                                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 8px; text-align: center;">
                                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #334155; letter-spacing: 0.5px;">Tiendas con Excesos</div>
                                    <div style="font-size: 26px; font-weight: 800; color: #475569; margin-top: 4px;">${affectedStoresCount}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Official Policy Info Box -->
                    <div style="background-color: #f8fafc; border-left: 4px solid #b91c1c; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px; font-size: 13px; color: #475569; line-height: 1.6;">
                        ⚖️ <strong>Estándar Oficial de Disciplina Operativa — Tacos Gavilan:</strong><br/>
                        • <strong>Rest Break pagado:</strong> Duración oficial autorizada de <strong>10 minutos exactos</strong>.<br/>
                        • <strong>Meal Lunch no pagado:</strong> Duración oficial autorizada de <strong>30 minutos exactos</strong>.<br/>
                        • Cada Gerente de Tienda recibe diariamente el reporte individual de su sucursal con la instrucción obligatoria de supervisar en piso y tomar acción inmediata con cada colaborador reincidente.
                    </div>

                    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; text-align: left;">
                        <thead>
                            <tr style="background-color: #1e293b; color: #ffffff;">
                                <th style="padding: 10px; font-weight: 600;">Locación</th>
                                <th style="padding: 10px; font-weight: 600;">Empleado</th>
                                <th style="padding: 10px; font-weight: 600;">Día</th>
                                <th style="padding: 10px; font-weight: 600;">Tipo</th>
                                <th style="padding: 10px; font-weight: 600; text-align: center;">Autorizado</th>
                                <th style="padding: 10px; font-weight: 600; text-align: center;">T. Real</th>
                                <th style="padding: 10px; font-weight: 600; text-align: center;">Exceso</th>
                                <th style="padding: 10px; font-weight: 600;">Horario (Salida ➔ Regreso)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>

                    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 28px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.6;">
                        <p style="margin: 0; font-weight: 600; color: #475569;">
                            Destinatarios: Dirección General y Supervisores de Zona.
                        </p>
                        <p style="margin: 4px 0 0 0;">
                            Reporte confidencial generado automáticamente todos los lunes a las 5:00 AM PST.<br/>
                            <strong>Sistema de Monitoreo</strong> — Tacos Gavilan
                        </p>
                    </div>
                </div>
            </div>
        `

        const executiveEmails = [
            'raquel@tacosgavilan.com',
            'roberto@tacosgavilan.com',
        ]

        const supervisorEmails = Array.from(
            new Set(
                stores
                    ?.map((s: any) => {
                        const email = s.users?.email
                        if (!email) return null
                        const cleanEmail = email.trim().toLowerCase()
                        if (cleanEmail.includes('ricardo')) return 'ricardo@tacosgavilan.com'
                        if (cleanEmail.includes('javier')) return 'javier@tacosgavilan.com'
                        return cleanEmail
                    })
                    .filter(Boolean) as string[]
            )
        )

        const allRecipients = Array.from(new Set([...executiveEmails, ...supervisorEmails]))

        if (isDryRun) {
            return NextResponse.json({
                success: true,
                dry_run: true,
                recipients: allRecipients,
                counts: {
                    total: totalViolations,
                    breaks: totalBreaks,
                    lunches: totalLunches,
                    storesAffected: affectedStoresCount,
                },
                sample_violations: violations.slice(0, 10),
                period: `${mondayStr} to ${sundayStr}`,
            })
        }

        const testTo = testToParam || null
        const isTest = Boolean(testTo)
        const recipientsToSend = testTo && testTo !== 'all' ? [testTo] : allRecipients
        const subjectPrefix = isTest ? '[PRUEBA] ' : ''

        const mailRes = await sendSystemEmail({
            fromName: 'Sistema de Monitoreo',
            to: recipientsToSend.join(', '),
            bcc: isTest ? undefined : 'carlos@tacosgavilan.com',
            subject: `${subjectPrefix}📊 Planificador (Toast POS): Reporte Semanal de Breaks y Lunches (${mondayStr} a ${sundayStr})`,
            html: htmlBody,
        })

        return NextResponse.json({
            success: true,
            isTest,
            senderUsed: mailRes.fromEmail,
            providerUsed: mailRes.providerUsed,
            recipients: recipientsToSend,
            count: violations.length,
            breaks: totalBreaks,
            lunches: totalLunches,
            emailsSent: 1,
            period: `${mondayStr} to ${sundayStr}`,
        })
    } catch (e: any) {
        console.error('Fatal API error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

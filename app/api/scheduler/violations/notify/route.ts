/**
 * @module api/scheduler/violations/notify
 * @description Endpoint oficial de despacho manual inmediato de infracciones de descansos (Breaks de 10 min)
 * y almuerzos (Lunches de 30 min) desde el detector del Planificador (`/planificador`).
 *
 * @businessRules
 * - Autentica al usuario en servidor vía `getServerUser` y verifica permisos (`admin`, `supervisor`, `manager`).
 * - Revalida en servidor cada infracción mediante `evaluatePunchBreakViolation` (`lib/break-violations-policy.ts`: Break >= 12m, Lunch >= 33m).
 * - CERO mención de tolerancia en correos; envía desde `noreply@tacosgavilan.com` vía `sendSystemEmail`
 *   tanto a cada empleado con correo entregable como al Gerente de Tienda activo (con CC al Supervisor de Zona),
 *   recordándole sus responsabilidades gerenciales obligatorias.
 *
 * @dataFlow
 * - POST `/api/scheduler/violations/notify` -> `stores` + `users` + `toast_employees` -> `sendSystemEmail` -> `punch_violations`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
    buildEmployeeBreakViolationEmailHtml,
    buildManagerDailyViolationReportHtml,
    evaluatePunchBreakViolation,
    INTERNAL_BREAK_MIN_VIOLATION_MINUTES,
    INTERNAL_LUNCH_MIN_VIOLATION_MINUTES,
    ManagerDailyViolationItem,
    validateEmployeeViolationEmail,
} from '@/lib/break-violations-policy'
import { sendSystemEmail } from '@/lib/system-mailer'
import { authorizeStoreScope, getServerUser } from '@/lib/auth-server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

function normalizeCorporateEmail(raw?: string | null): string | null {
    if (!raw) return null
    const clean = raw.trim().toLowerCase()
    if (!clean) return null
    if (clean === 'roque@tacosgavilan.com') return 'carlos@tacosgavilan.com'
    if (clean.includes('ricardo') && clean.endsWith('@tacosgavilan.com')) {
        return 'ricardo@tacosgavilan.com'
    }
    if (clean.includes('javier') && clean.endsWith('@tacosgavilan.com')) {
        return 'javier@tacosgavilan.com'
    }
    return clean
}

export async function POST(req: Request) {
    try {
        const authUser = await getServerUser(req)
        if (!authUser) {
            return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
        }

        const body = await req.json()
        const { violations, storeId } = body

        if (!violations || !Array.isArray(violations) || violations.length === 0) {
            return NextResponse.json({ error: 'No violations provided' }, { status: 400 })
        }
        if (!storeId) {
            return NextResponse.json({ error: 'Missing storeId' }, { status: 400 })
        }

        const scopeCheck = await authorizeStoreScope(authUser, storeId, supabase, {
            requireWrite: true,
            allowedRoles: ['admin', 'supervisor', 'manager'],
        })
        if (!scopeCheck.authorized) {
            return NextResponse.json(
                { error: scopeCheck.error || 'Sin autorización para esta sucursal.' },
                { status: scopeCheck.status || 403 }
            )
        }

        const cleanStoreParam = String(storeId).trim()
        const isNumericStore = /^\d+$/.test(cleanStoreParam)
        const storeQuery = supabase
            .from('stores')
            .select('id, name, external_id, supervisor_id, users!stores_supervisor_id_fkey(email)')

        const { data: storeData } = isNumericStore
            ? await storeQuery.eq('id', Number(cleanStoreParam)).maybeSingle()
            : await storeQuery.eq('external_id', cleanStoreParam).maybeSingle()

        if (!storeData) {
            return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 })
        }

        const resolvedStoreGuid = storeData.external_id
        const storeName = (storeData.name || 'Tacos Gavilan').replace(/toast/i, '').trim()
        const supervisorEmail = normalizeCorporateEmail((storeData.users as any)?.email || null)

        const [{ data: allUsers }, { data: emps }, { data: existingViolations }] = await Promise.all([
            supabase
                .from('users')
                .select('id, full_name, email, role, store_id, is_active, google_email_connected'),
            supabase
                .from('toast_employees')
                .select('toast_guid, email, first_name, last_name, chosen_name')
                .in(
                    'toast_guid',
                    Array.from(new Set(violations.map((v: any) => v.employeeRef).filter(Boolean)))
                ),
            supabase
                .from('punch_violations')
                .select('employee_toast_guid, business_date, in_time')
                .eq('store_id', resolvedStoreGuid),
        ])

        const registeredCorporateEmails = new Set<string>()
        for (const u of allUsers || []) {
            if (u.email) registeredCorporateEmails.add(String(u.email).trim().toLowerCase())
            if (u.google_email_connected) {
                registeredCorporateEmails.add(String(u.google_email_connected).trim().toLowerCase())
            }
        }

        const activeManagers = (allUsers || []).filter((u: any) => {
            if (!u.is_active) return false
            if (Number(u.store_id) !== Number(storeData.id)) return false
            const r = String(u.role || '').toLowerCase()
            return (
                (r.includes('manager') || r.includes('gerente')) &&
                !r.includes('asst') &&
                !r.includes('assist') &&
                !r.includes('asistente') &&
                !r.includes('shift')
            )
        })

        const managerEmails = Array.from(
            new Set(
                activeManagers
                    .map((m: any) => normalizeCorporateEmail(m.google_email_connected || m.email))
                    .filter(
                        (e): e is string =>
                            Boolean(e) &&
                            e !== 'carlos@tacosgavilan.com' &&
                            e !== 'roque@tacosgavilan.com'
                    )
            )
        )
        const safeSupervisorEmail =
            supervisorEmail &&
            supervisorEmail !== 'carlos@tacosgavilan.com' &&
            supervisorEmail !== 'roque@tacosgavilan.com'
                ? supervisorEmail
                : null
        const primaryManagerEmail = managerEmails[0] || safeSupervisorEmail || null

        // Filtrar y revalidar en servidor evitando duplicados
        const validatedList: Array<{
            employeeRef: string
            employeeName: string
            rawEmail: string | null
            validEmail: string | null
            type: 'BRK' | 'LUN'
            allowed: number
            actualMinutes: number
            date: string
            inDate: string
            outDate: string
            isAnomaly: boolean
        }> = []

        for (const v of violations) {
            const evalRes = evaluatePunchBreakViolation({
                paid: v.type === 'BRK' ? true : v.type === 'LUN' ? false : Boolean(v.paid),
                inDate: v.inDate,
                outDate: v.outDate,
            })
            if (!evalRes || !evalRes.isViolation) continue
            const minRequiredMins =
                evalRes.type === 'BRK'
                    ? INTERNAL_BREAK_MIN_VIOLATION_MINUTES
                    : INTERNAL_LUNCH_MIN_VIOLATION_MINUTES
            if (evalRes.actualMinutes < minRequiredMins) continue

            const alreadySaved = existingViolations?.some(
                (dbV: any) =>
                    dbV.employee_toast_guid === v.employeeRef &&
                    dbV.business_date === v.date &&
                    new Date(dbV.in_time).getTime() === new Date(v.inDate).getTime()
            )
            if (alreadySaved) continue

            const empDb = emps?.find((e: any) => e.toast_guid === v.employeeRef)
            const empName =
                v.name ||
                (empDb
                    ? `${empDb.chosen_name || empDb.first_name || ''} ${empDb.last_name || ''}`.trim()
                    : 'Empleado')
            const emailValidation = validateEmployeeViolationEmail(
                empDb?.email,
                registeredCorporateEmails
            )

            validatedList.push({
                employeeRef: v.employeeRef,
                employeeName: empName || 'Empleado',
                rawEmail: empDb?.email || null,
                validEmail: emailValidation.cleanEmail,
                type: evalRes.type,
                allowed: evalRes.allowedMinutes,
                actualMinutes: evalRes.actualMinutes,
                date: String(v.date).slice(0, 10),
                inDate: v.inDate,
                outDate: v.outDate,
                isAnomaly: evalRes.isAnomaly,
            })
        }

        if (validatedList.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'Todas las infracciones seleccionadas ya habían sido notificadas previamente.',
            })
        }

        let senderUsed = 'noreply@tacosgavilan.com'
        const managerTableItems: ManagerDailyViolationItem[] = []
        const sentFlags = new Map<number, boolean>()

        for (let idx = 0; idx < validatedList.length; idx++) {
            const v = validatedList[idx]
            let sent = false
            let statusLabel = '⚠️ Sin correo en Toast POS (Notificar en persona)'

            if (v.validEmail) {
                const { subject, html } = buildEmployeeBreakViolationEmailHtml({
                    storeName,
                    employeeName: v.employeeName,
                    type: v.type,
                    businessDate: v.date,
                    inDate: v.inDate,
                    outDate: v.outDate,
                    allowedMinutes: v.allowed,
                    actualMinutes: v.actualMinutes,
                    managerContactEmail: primaryManagerEmail,
                })

                try {
                    const mailRes = await sendSystemEmail({
                        fromName: 'Sistema de Monitoreo',
                        to: v.validEmail,
                        replyTo: primaryManagerEmail || undefined,
                        subject,
                        html,
                    })
                    senderUsed = mailRes.fromEmail
                    sent = true
                    statusLabel = `✓ Enviado (${v.validEmail})`
                } catch (empErr) {
                    console.error('Failed employee violation email:', empErr)
                    statusLabel = `⚠️ Error al enviar (${v.validEmail})`
                }
            } else if (v.rawEmail) {
                statusLabel = `⚠️ Correo inválido en Toast (${v.rawEmail})`
            }

            sentFlags.set(idx, sent)
            managerTableItems.push({
                employeeName: v.employeeName,
                type: v.type,
                allowedMinutes: v.allowed,
                actualMinutes: v.actualMinutes,
                inDate: v.inDate,
                outDate: v.outDate,
                isAnomaly: v.isAnomaly,
                deliveryStatusLabel: statusLabel,
                emailDelivered: sent,
            })
        }

        // Enviar siempre el reporte oficial al Gerente de Tienda activo (y CC Supervisor; jamás exponer buzones ejecutivos protegidos en CC/To)
        const initiatorEmail = normalizeCorporateEmail(authUser.email)
        const isProtectedInitiator =
            initiatorEmail === 'carlos@tacosgavilan.com' || initiatorEmail === 'roque@tacosgavilan.com'
        const managerTo =
            managerEmails.length > 0
                ? managerEmails
                : safeSupervisorEmail
                  ? [safeSupervisorEmail]
                  : initiatorEmail && !isProtectedInitiator
                    ? [initiatorEmail]
                    : ['noreply@tacosgavilan.com']

        const ccSet = new Set<string>()
        if (safeSupervisorEmail && !managerTo.includes(safeSupervisorEmail)) ccSet.add(safeSupervisorEmail)
        if (initiatorEmail && !isProtectedInitiator && !managerTo.includes(initiatorEmail)) {
            ccSet.add(initiatorEmail)
        }

        const targetDateLabel = validatedList[0].date
        const { subject: mgrSubject, html: mgrHtml } = buildManagerDailyViolationReportHtml({
            storeName,
            businessDate: targetDateLabel,
            items: managerTableItems,
            isManualDispatch: true,
        })

        const mgrRes = await sendSystemEmail({
            fromName: 'Sistema de Monitoreo',
            to: managerTo,
            cc: ccSet.size > 0 ? Array.from(ccSet) : undefined,
            bcc: isProtectedInitiator ? 'carlos@tacosgavilan.com' : undefined,
            subject: mgrSubject,
            html: mgrHtml,
        })
        senderUsed = mgrRes.fromEmail

        const recordsToInsert = validatedList.map((v, idx) => ({
            store_id: resolvedStoreGuid,
            employee_toast_guid: v.employeeRef,
            business_date: v.date,
            violation_type: v.type,
            in_time: v.inDate,
            out_time: v.outDate,
            allowed_minutes: v.allowed,
            actual_minutes: v.actualMinutes,
            status: 'Avisado',
            notified_recipients: {
                initiator: isProtectedInitiator ? 'Sistema de Monitoreo' : authUser.email,
                initiator_role: authUser.role,
                email_sent: Boolean(sentFlags.get(idx)),
                employee_email: v.validEmail,
                manager_emails: managerTo,
                from_email: senderUsed,
                dispatched_at: new Date().toISOString(),
            },
        }))

        const { error: dbError } = await supabase.from('punch_violations').insert(recordsToInsert)
        if (dbError) {
            console.error('Error inserting punch violations:', dbError)
            return NextResponse.json({ error: 'Failed to record violations' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            senderUsed,
            notifiedCount: validatedList.length,
            message: 'Notificaciones enviadas a empleados y Gerente de Tienda exitosamente.',
        })
    } catch (error: any) {
        console.error('Error in violations notify endpoint:', error)
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        )
    }
}

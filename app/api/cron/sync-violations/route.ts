/**
 * @module api/cron/sync-violations
 * @description Cron diario automatizado (11:59 AM hora California, PST/PDT) que audita las ponchadas de descansos (Breaks)
 * y almuerzos (Lunches) de la jornada anterior en las 15 sucursales activas de Tacos Gavilan:
 * 1) Registra las infracciones en `punch_violations` evitando duplicados.
 * 2) Envía correo individual a cada empleado con correo válido exigiéndole puntualidad sobre los 10m / 30m autorizados.
 * 3) Envía diariamente al Gerente de Tienda activo (con CC al Supervisor de Zona) el reporte de su sucursal
 *    recordándole sus funciones obligatorias de supervisión en piso y acción inmediata con cada colaborador.
 *
 * @businessRules
 * - Tiempos oficiales autorizados: 10 minutos exactos (Rest Break pagado) y 30 minutos exactos (Meal Lunch no pagado).
 * - Evaluación vía `evaluatePunchBreakViolation` (`lib/break-violations-policy.ts`): Break 10m oficial (+1m tolerancia confidencial hasta 11m 59s -> infracción desde >= 12m cumplidos) y Lunch 30m oficial (+2m tolerancia confidencial hasta 32m 59s -> infracción desde >= 33m cumplidos).
 * - PROHIBICIÓN ESTRICTA: Jamás mencionar ni insinuar tolerancia en correos ni en interfaz.
 * - Envío institucional desde `noreply@tacosgavilan.com` vía `sendSystemEmail` (`lib/system-mailer.ts`).
 * - Filtra la hora local de `America/Los_Angeles` (`laHour === 11`) para que el par de crons UTC (`59 18 * * *` y `59 19 * * *`)
 *   dispare exactamente una sola vez al día a las 11:59 AM tanto en invierno (PST) como en verano (PDT).
 *
 * @dataFlow
 * - Vercel Cron (11:59 AM LA) -> `stores` (`is_active = true`) + `users` (`is_active = true`) + `punches` ->
 *   `evaluatePunchBreakViolation` -> `sendSystemEmail` (Empleado + Manager Diario) -> `punch_violations`.
 *
 * @notes
 * - Corregidos bugs críticos de producción: `stores.is_active` (antes `stores.active` error 42703),
 *   cruce numérico `users.store_id = store.id` con `is_active = true` (antes UUID contra BIGINT error 22P02),
 *   separación estricta entre remitente (`noreply@tacosgavilan.com`) y destinatario real del Manager (`managerEmails`),
 *   y sanitización de correos placeholder de Toast POS (`@toasttab.com`, `@example.com`, `@tryotter.com`).
 * - Blindaje de seguridad Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor` incluso en `?dry_run=true`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
    buildEmployeeBreakViolationEmailHtml,
    buildManagerDailyViolationReportHtml,
    evaluatePunchBreakViolation,
    ManagerDailyViolationItem,
    validateEmployeeViolationEmail,
} from '@/lib/break-violations-policy'
import { sendSystemEmail } from '@/lib/system-mailer'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

function getCaliforniaNowParts(refDate = new Date()): {
    yesterdayIso: string
    hour: number
    minute: number
    totalMinutes: number
} {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(refDate)
    const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
    const hour = rawHour === 24 ? 0 : rawHour

    const laDateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(refDate)

    const todayNoon = new Date(`${laDateParts}T12:00:00`)
    todayNoon.setDate(todayNoon.getDate() - 1)
    const y = todayNoon.getFullYear()
    const m = String(todayNoon.getMonth() + 1).padStart(2, '0')
    const d = String(todayNoon.getDate()).padStart(2, '0')
    return {
        yesterdayIso: `${y}-${m}-${d}`,
        hour,
        minute,
        totalMinutes: hour * 60 + minute,
    }
}

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

export async function GET(req: Request) {
    return handleSyncViolations(req)
}

export async function POST(req: Request) {
    return handleSyncViolations(req)
}

async function handleSyncViolations(req: Request) {
    const auth = await verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const startTime = Date.now()
    const url = new URL(req.url)
    const isDryRun = url.searchParams.get('dry_run') === 'true'
    const forceRun = url.searchParams.get('force') === 'true'
    const testTo = url.searchParams.get('test_to')?.trim() || null

    const { yesterdayIso, hour: laHour, minute: laMinute, totalMinutes: laTotalMinutes } =
        getCaliforniaNowParts()
    const hasExplicitOverride =
        forceRun || isDryRun || Boolean(testTo) || url.searchParams.has('date')

    // Evitar disparo prematuro a las 10:59 AM PST en invierno o doble corrida a las 12:59 PM PDT en verano,
    // absorbiendo hasta 56 min de jitter de despacho de Vercel tras las 11:59 AM (11:55 AM – 12:55 PM LA).
    const inScheduledWindow = laTotalMinutes >= 11 * 60 + 55 && laTotalMinutes <= 12 * 60 + 55
    if (!hasExplicitOverride && !inScheduledWindow) {
        return NextResponse.json({
            success: true,
            skipped: true,
            la_hour: laHour,
            la_minute: laMinute,
            reason: 'Waiting for 11:55 AM–12:55 PM America/Los_Angeles execution window',
        })
    }

    const targetDate = url.searchParams.get('date') || yesterdayIso
    const targetStoreParam = url.searchParams.get('store_id')?.trim() || null

    console.log(
        `🚀 [CRON 11:59 AM] Starting Daily Violations Sync for Business Date: ${targetDate} (dryRun=${isDryRun})`
    )

    try {
        // 1. Consultar sucursales activas (`is_active = true`) y usuarios activos
        let storeQuery = supabase
            .from('stores')
            .select('id, name, external_id, supervisor_id, is_active, users!stores_supervisor_id_fkey(email)')
            .eq('is_active', true)

        if (targetStoreParam) {
            if (/^\d+$/.test(targetStoreParam)) {
                storeQuery = storeQuery.eq('id', Number(targetStoreParam))
            } else {
                storeQuery = storeQuery.eq('external_id', targetStoreParam)
            }
        }

        const [{ data: stores, error: storesError }, { data: allUsers, error: usersError }] =
            await Promise.all([
                storeQuery,
                supabase
                    .from('users')
                    .select('id, full_name, email, role, store_id, is_active, google_email_connected'),
            ])

        if (storesError) {
            console.error('Error fetching stores:', storesError)
            return NextResponse.json(
                { error: 'Failed to fetch stores: ' + storesError.message },
                { status: 500 }
            )
        }
        if (usersError) {
            console.error('Error fetching users:', usersError)
        }

        if (!stores || stores.length === 0) {
            return NextResponse.json({ message: 'No active stores found', targetDate })
        }

        // Conjunto de correos corporativos válidos en `public.users`
        const registeredCorporateEmails = new Set<string>()
        for (const u of allUsers || []) {
            if (u.email) registeredCorporateEmails.add(String(u.email).trim().toLowerCase())
            if (u.google_email_connected) {
                registeredCorporateEmails.add(String(u.google_email_connected).trim().toLowerCase())
            }
        }

        const allowedStoreGuids = stores.map((s) => s.external_id).filter(Boolean)

        // 2. Consultar ponchadas paginadas para `targetDate` (PK en `public.punches` es `toast_id`)
        let punches: any[] = []
        let currentOffset = 0
        const pageSize = 1000

        while (true) {
            let punchQuery = supabase
                .from('punches')
                .select('toast_id, store_id, employee_toast_guid, business_date, breaks')
                .eq('business_date', targetDate)
                .order('toast_id', { ascending: true })
                .range(currentOffset, currentOffset + pageSize - 1)

            if (targetStoreParam && allowedStoreGuids.length > 0) {
                punchQuery = punchQuery.in('store_id', allowedStoreGuids)
            }

            const { data: chunk, error } = await punchQuery
            if (error) {
                console.error('Error fetching punches:', error)
                return NextResponse.json(
                    { error: 'Failed to fetch punches: ' + error.message },
                    { status: 500 }
                )
            }
            if (!chunk || chunk.length === 0) break
            punches.push(...chunk)
            if (chunk.length < pageSize) break
            currentOffset += pageSize
        }

        if (punches.length === 0) {
            return NextResponse.json({
                success: true,
                message: `No punches found for business date ${targetDate}`,
                business_date: targetDate,
                total_violations: 0,
                emails_sent: 0,
            })
        }

        // 3. Consultar empleados en `toast_employees`
        const uniqueEmpIds = Array.from(
            new Set(punches.map((p: any) => p.employee_toast_guid))
        ).filter(Boolean)
        const toastEmployees: any[] = []

        for (let i = 0; i < uniqueEmpIds.length; i += 500) {
            const chunk = uniqueEmpIds.slice(i, i + 500)
            const { data } = await supabase
                .from('toast_employees')
                .select('toast_guid, email, first_name, last_name, chosen_name')
                .in('toast_guid', chunk)
            if (data) toastEmployees.push(...data)
        }

        // 4. Consultar infracciones ya notificadas para prevenir envíos duplicados
        const { data: existingViolations } = await supabase
            .from('punch_violations')
            .select('store_id, employee_toast_guid, business_date, in_time')
            .eq('business_date', targetDate)

        interface DetectedViolation {
            storeGuid: string
            storeNumericId: number
            storeName: string
            supervisorEmail: string | null
            employeeRef: string
            employeeName: string
            rawEmployeeEmail: string | null
            validEmployeeEmail: string | null
            emailInvalidReason: string
            type: 'BRK' | 'LUN'
            allowed: number
            actualMinutes: number
            date: string
            inDate: string
            outDate: string
            isAnomaly: boolean
        }

        const newViolations: DetectedViolation[] = []

        for (const p of punches) {
            const store = stores.find(
                (s) => s.external_id === p.store_id || String(s.id) === String(p.store_id)
            )
            if (!store) continue
            if (!Array.isArray(p.breaks)) continue

            for (const b of p.breaks) {
                const evalResult = evaluatePunchBreakViolation({
                    paid: b.paid,
                    inDate: b.inDate,
                    outDate: b.outDate,
                })
                if (!evalResult || !evalResult.isViolation) continue

                const isAlreadyRecorded =
                    !testTo &&
                    Boolean(
                        existingViolations?.some(
                            (dbV: any) =>
                                dbV.store_id === p.store_id &&
                                dbV.employee_toast_guid === p.employee_toast_guid &&
                                dbV.business_date === p.business_date &&
                                new Date(dbV.in_time).getTime() === new Date(b.inDate).getTime()
                        )
                    )

                if (isAlreadyRecorded) continue

                const emp = toastEmployees.find((e) => e.toast_guid === p.employee_toast_guid)
                const empName = emp
                    ? `${emp.chosen_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() ||
                      'Empleado'
                    : 'Empleado'

                const emailCheck = validateEmployeeViolationEmail(
                    emp?.email,
                    registeredCorporateEmails
                )
                const rawSupEmail = (store.users as any)?.email || null

                newViolations.push({
                    storeGuid: p.store_id,
                    storeNumericId: Number(store.id),
                    storeName: store.name.replace(/toast/i, '').trim() || 'Tacos Gavilan',
                    supervisorEmail: normalizeCorporateEmail(rawSupEmail),
                    employeeRef: p.employee_toast_guid,
                    employeeName: empName,
                    rawEmployeeEmail: emp?.email || null,
                    validEmployeeEmail: emailCheck.cleanEmail,
                    emailInvalidReason: emailCheck.reason,
                    type: evalResult.type,
                    allowed: evalResult.allowedMinutes,
                    actualMinutes: evalResult.actualMinutes,
                    date: p.business_date,
                    inDate: b.inDate,
                    outDate: b.outDate,
                    isAnomaly: evalResult.isAnomaly,
                })
            }
        }

        if (newViolations.length === 0) {
            return NextResponse.json({
                success: true,
                dry_run: isDryRun,
                message: `All punches for ${targetDate} are compliant or already notified.`,
                business_date: targetDate,
                total_violations: 0,
                emails_sent: 0,
                duration_ms: Date.now() - startTime,
            })
        }

        // 5. Agrupar por sucursal
        const violationsByStore: Record<string, DetectedViolation[]> = {}
        for (const v of newViolations) {
            if (!violationsByStore[v.storeGuid]) violationsByStore[v.storeGuid] = []
            violationsByStore[v.storeGuid].push(v)
        }

        let totalEmailsSent = 0
        let totalRecordsInserted = 0
        const storeResults: any[] = []

        for (const [storeGuid, storeViolations] of Object.entries(violationsByStore)) {
            const first = storeViolations[0]
            const storeName = first.storeName
            const storeNumericId = first.storeNumericId
            const supervisorEmail = first.supervisorEmail

            // Resolver Gerente(s) de Tienda ACTIVO(S) en `public.users` (`store_id` numérico + `is_active = true`)
            const activeManagers = (allUsers || []).filter((u: any) => {
                if (!u.is_active) return false
                if (Number(u.store_id) !== storeNumericId) return false
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

            if (isDryRun) {
                storeResults.push({
                    storeGuid,
                    storeName,
                    managerRecipients: managerEmails,
                    supervisorCc: supervisorEmail,
                    violationsCount: storeViolations.length,
                    sample: storeViolations.slice(0, 5).map((v) => ({
                        employee: v.employeeName,
                        type: v.type,
                        allowed: v.allowed,
                        actual: v.actualMinutes,
                        deliverableEmail: v.validEmployeeEmail,
                        emailReason: v.emailInvalidReason,
                    })),
                })
                continue
            }

            let storeEmailsSent = 0
            let senderUsed = 'noreply@tacosgavilan.com'
            const managerTableItems: ManagerDailyViolationItem[] = []
            const perViolationDispatched = new Map<number, boolean>()

            // 6a. Despachar correos individuales a cada empleado infractor en lotes controlados de 4
            const BATCH_SIZE = 4
            for (let startIdx = 0; startIdx < storeViolations.length; startIdx += BATCH_SIZE) {
                const batch = storeViolations.slice(startIdx, startIdx + BATCH_SIZE)
                const batchResults = await Promise.all(
                    batch.map(async (v, offset) => {
                        const idx = startIdx + offset
                        let employeeSent = false
                        let statusLabel = '⚠️ Sin correo en Toast POS (Notificar en persona)'

                        if (v.validEmployeeEmail) {
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

                            const targetRecipient = testTo || v.validEmployeeEmail
                            try {
                                const res = await sendSystemEmail({
                                    fromName: 'Sistema de Monitoreo',
                                    to: targetRecipient,
                                    replyTo: primaryManagerEmail || undefined,
                                    subject: testTo ? `[PRUEBA EMPLEADO] ${subject}` : subject,
                                    html,
                                })
                                senderUsed = res.fromEmail
                                employeeSent = true
                                statusLabel = `✓ Enviado (${v.validEmployeeEmail})`
                            } catch (empErr: any) {
                                console.error(
                                    `Failed to send employee violation email (${v.validEmployeeEmail}):`,
                                    empErr?.message || empErr
                                )
                                statusLabel = `⚠️ Error al enviar (${v.validEmployeeEmail})`
                            }
                        } else if (v.rawEmployeeEmail) {
                            statusLabel = `⚠️ Correo inválido en Toast (${v.rawEmployeeEmail})`
                        }

                        return {
                            idx,
                            employeeSent,
                            item: {
                                employeeName: v.employeeName,
                                type: v.type,
                                allowedMinutes: v.allowed,
                                actualMinutes: v.actualMinutes,
                                inDate: v.inDate,
                                outDate: v.outDate,
                                isAnomaly: v.isAnomaly,
                                deliveryStatusLabel: statusLabel,
                                emailDelivered: employeeSent,
                            } as ManagerDailyViolationItem,
                        }
                    })
                )

                for (const br of batchResults) {
                    perViolationDispatched.set(br.idx, br.employeeSent)
                    if (br.employeeSent) {
                        storeEmailsSent++
                        totalEmailsSent++
                    }
                    managerTableItems.push(br.item)
                }
            }

            // 6b. Despachar reporte DIARIO obligatorio al Gerente de Tienda (CC Supervisor de Zona)
            const effectiveManagerTo = testTo
                ? [testTo]
                : managerEmails.length > 0
                  ? managerEmails
                  : safeSupervisorEmail
                    ? [safeSupervisorEmail]
                    : ['noreply@tacosgavilan.com']

            const effectiveManagerCc =
                !testTo && safeSupervisorEmail && !effectiveManagerTo.includes(safeSupervisorEmail)
                    ? safeSupervisorEmail
                    : undefined

            let managerSummarySent = false
            try {
                const { subject: mgrSubject, html: mgrHtml } = buildManagerDailyViolationReportHtml({
                    storeName,
                    businessDate: targetDate,
                    items: managerTableItems,
                    isManualDispatch: false,
                })

                const mgrRes = await sendSystemEmail({
                    fromName: 'Sistema de Monitoreo',
                    to: effectiveManagerTo,
                    cc: effectiveManagerCc,
                    subject: testTo ? `[PRUEBA GERENTE] ${mgrSubject}` : mgrSubject,
                    html: mgrHtml,
                })
                senderUsed = mgrRes.fromEmail
                managerSummarySent = true
                storeEmailsSent++
                totalEmailsSent++
            } catch (mgrErr: any) {
                console.error(
                    `Failed to send daily manager report for ${storeName}:`,
                    mgrErr?.message || mgrErr
                )
            }

            // 6c. Insertar registros oficiales en `punch_violations` (salvo modo `test_to`)
            if (!testTo && (managerSummarySent || storeEmailsSent > 0)) {
                const recordsToInsert = storeViolations.map((v, idx) => ({
                    store_id: v.storeGuid,
                    employee_toast_guid: v.employeeRef,
                    business_date: v.date,
                    violation_type: v.type,
                    in_time: v.inDate,
                    out_time: v.outDate,
                    allowed_minutes: v.allowed,
                    actual_minutes: v.actualMinutes,
                    status: 'Avisado',
                    notified_recipients: {
                        initiator: 'Cron Automático (11:59 AM)',
                        initiator_role: 'system_cron',
                        email_sent: Boolean(perViolationDispatched.get(idx)),
                        employee_email: v.validEmployeeEmail,
                        manager_emails: effectiveManagerTo,
                        supervisor_cc: effectiveManagerCc || null,
                        from_email: senderUsed,
                        dispatched_at: new Date().toISOString(),
                    },
                }))

                const { error: insertError } = await supabase
                    .from('punch_violations')
                    .insert(recordsToInsert)
                if (insertError) {
                    console.error(
                        `❌ Error inserting punch violations for store ${storeName}:`,
                        insertError
                    )
                } else {
                    totalRecordsInserted += recordsToInsert.length
                }
            }

            storeResults.push({
                storeGuid,
                storeName,
                managerRecipients: effectiveManagerTo,
                supervisorCc: effectiveManagerCc || null,
                senderUsed,
                violationsCount: storeViolations.length,
                emailsSent: storeEmailsSent,
            })
        }

        return NextResponse.json({
            success: true,
            dry_run: isDryRun,
            is_test: Boolean(testTo),
            business_date: targetDate,
            total_violations: isDryRun ? newViolations.length : totalRecordsInserted,
            emails_sent: totalEmailsSent,
            stores_processed: storeResults,
            duration_ms: Date.now() - startTime,
        })
    } catch (error: any) {
        console.error('Fatal error in daily violations cron:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

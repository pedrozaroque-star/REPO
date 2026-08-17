/**
 * @module api/cron/sync-violations
 * @description Automated daily cron job executing at 11:59 AM PST to audit yesterday's employee punches,
 * record break/lunch violations in the database, dispatch official notification emails to employees,
 * and send consolidated reports to Store Managers and Supervisors.
 * 
 * @businessRules
 * - Audits yesterday's business date (allows managers from 6:00 AM to 11:59 AM to correct punch mistakes in Toast POS).
 * - Break violations: Paid rest breaks >= 13 minutes (allowed: 10 minutes).
 * - Lunch violations: Unpaid meal breaks >= 33 minutes (allowed: 30 minutes).
 * - Prevents duplicate notifications by checking existing records in `punch_violations`.
 * - Uses the Store Manager's connected Gmail OAuth account, falling back to corporate admin account.
 * 
 * @dataFlow
 * - Cron Trigger (11:59 AM PST) -> Fetch Stores & Yesterday Punches -> Detect Violations ->
 *   Insert into `punch_violations` -> Dispatch Employee Warning Emails -> Dispatch Store Manager Summary Email.
 * 
 * @notes
 * - Supports manual execution via GET/POST query parameters `?date=YYYY-MM-DD` and `?store_id=UUID`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max duration for Vercel Cron

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

// Helper to obtain yesterday's business date in California timezone
function getYesterdayBusinessDate(): string {
    const nowLA = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const yesterday = new Date(nowLA)
    yesterday.setDate(nowLA.getDate() - 1)

    const y = yesterday.getFullYear()
    const m = String(yesterday.getMonth() + 1).padStart(2, '0')
    const d = String(yesterday.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

// Helpers for formatting
function formatTime(isoString?: string) {
    if (!isoString) return '--'
    return new Date(isoString).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    })
}

function formatDateNice(isoString: string) {
    if (!isoString) return ''
    const date = new Date(isoString + 'T12:00:00')
    return date.toLocaleDateString('es-ES', {
        timeZone: 'America/Los_Angeles',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        weekday: 'short'
    })
}

// Helper to get Google Transporter for a specific store manager or fallback to Carlos
async function getStoreTransporter(storeExternalId: string, storeUuid?: string) {
    // 1. Try to find a Store Manager with connected Google OAuth
    const { data: storeManagers } = await supabase
        .from('users')
        .select('id, email, google_refresh_token, google_email_connected, store_id, role')
        .or(`store_id.eq.${storeExternalId}${storeUuid ? `,store_id.eq.${storeUuid}` : ''}`)
        .ilike('role', '%manager%')

    const connectedManager = storeManagers?.find(m => m.google_refresh_token && m.google_email_connected)

    let userToUse: any = connectedManager || null

    // 2. If no connected manager, fallback to Carlos
    if (!userToUse) {
        const { data: fallbackUser } = await supabase
            .from('users')
            .select('id, email, google_refresh_token, google_email_connected, store_id, role')
            .eq('email', 'carlos@tacosgavilan.com')
            .single()

        if (fallbackUser?.google_refresh_token) {
            userToUse = fallbackUser
        }
    }

    if (!userToUse || !userToUse.google_refresh_token) {
        throw new Error('No active Gmail OAuth account found for store or fallback (carlos@tacosgavilan.com).')
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token'
    const params = new URLSearchParams()
    params.append('client_id', process.env.GOOGLE_CLIENT_ID!)
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!)
    params.append('refresh_token', userToUse.google_refresh_token)
    params.append('grant_type', 'refresh_token')

    const refreshRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    })

    if (!refreshRes.ok) {
        const errData = await refreshRes.json()
        throw new Error(`Gmail Token Refresh Failed: ${errData.error_description || errData.error}`)
    }

    const tokens = await refreshRes.json()
    const accessToken = tokens.access_token

    const fromEmail = userToUse.google_email_connected || userToUse.email || 'carlos@tacosgavilan.com'

    return {
        accessToken,
        fromEmail,
        managerUserId: userToUse.id,
        isFallback: userToUse.email === 'carlos@tacosgavilan.com'
    }
}

// Function to send email via Gmail REST API raw buffer
async function sendViaGmail(accessToken: string, mailOptions: any) {
    const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' })
    const info = await compiler.sendMail(mailOptions)

    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
        const message = info.message as any
        if (Buffer.isBuffer(message)) return resolve(message)
        if (typeof message.pipe === 'function') {
            const chunks: Buffer[] = []
            message.on('data', (chunk: Buffer) => chunks.push(chunk))
            message.on('end', () => resolve(Buffer.concat(chunks)))
            message.on('error', (err: Error) => reject(err))
            return
        }
        reject(new Error('Nodemailer returned unknown format'))
    })

    const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
    })

    if (!sendRes.ok) {
        const err = await sendRes.json()
        throw new Error(JSON.stringify(err))
    }

    return await sendRes.json()
}

export async function GET(req: Request) {
    return handleSyncViolations(req)
}

export async function POST(req: Request) {
    return handleSyncViolations(req)
}

async function handleSyncViolations(req: Request) {
    const startTime = Date.now()
    const url = new URL(req.url)

    // Optional query overrides for manual testing
    const targetDate = url.searchParams.get('date') || getYesterdayBusinessDate()
    const targetStoreId = url.searchParams.get('store_id') || null

    console.log(`🚀 [CRON 11:59 AM] Starting Daily Violations Sync for Business Date: ${targetDate}`)

    try {
        // 1. Fetch Stores
        let storeQuery = supabase
            .from('stores')
            .select('id, name, external_id, supervisor_id, users!stores_supervisor_id_fkey(email)')
            .eq('active', true)

        if (targetStoreId) {
            storeQuery = storeQuery.or(`external_id.eq.${targetStoreId},id.eq.${targetStoreId}`)
        }

        const { data: stores, error: storesError } = await storeQuery

        if (storesError) {
            console.error('Error fetching stores:', storesError)
            return NextResponse.json({ error: 'Failed to fetch stores: ' + storesError.message }, { status: 500 })
        }

        if (!stores || stores.length === 0) {
            return NextResponse.json({ message: 'No active stores found', targetDate })
        }

        // 2. Fetch Punches for Target Date
        let punchQuery = supabase
            .from('punches')
            .select('id, store_id, employee_toast_guid, business_date, breaks')
            .eq('business_date', targetDate)

        if (targetStoreId) {
            punchQuery = punchQuery.eq('store_id', targetStoreId)
        }

        let punches: any[] = []
        let currentOffset = 0
        const pageSize = 1000

        while (true) {
            const { data: chunk, error } = await punchQuery.range(currentOffset, currentOffset + pageSize - 1)
            if (error) {
                console.error('Error fetching punches:', error)
                break
            }
            if (!chunk || chunk.length === 0) break
            punches.push(...chunk)
            if (chunk.length < pageSize) break
            currentOffset += pageSize
        }

        console.log(`📊 [CRON 11:59 AM] Found ${punches.length} punches for ${targetDate}`)

        if (punches.length === 0) {
            return NextResponse.json({
                success: true,
                message: `No punches found for business date ${targetDate}`,
                business_date: targetDate,
                total_violations: 0,
                emails_sent: 0
            })
        }

        // 3. Fetch Toast Employees for Names and Emails
        const uniqueEmpIds = Array.from(new Set(punches.map((p: any) => p.employee_toast_guid))).filter(Boolean)
        const toastEmployees: any[] = []

        for (let i = 0; i < uniqueEmpIds.length; i += 500) {
            const chunk = uniqueEmpIds.slice(i, i + 500)
            const { data } = await supabase
                .from('toast_employees')
                .select('toast_guid, email, first_name, last_name, chosen_name')
                .in('toast_guid', chunk)

            if (data) toastEmployees.push(...data)
        }

        // 4. Fetch Existing Violations in DB to prevent duplicate emails
        const { data: existingViolations } = await supabase
            .from('punch_violations')
            .select('store_id, employee_toast_guid, business_date, in_time')
            .eq('business_date', targetDate)

        // 5. Analyze Violations
        interface DetectedViolation {
            storeId: string;
            storeName: string;
            storeUuid?: string;
            supervisorEmail?: string;
            employeeRef: string;
            employeeName: string;
            employeeEmail?: string;
            type: 'BRK' | 'LUN';
            allowed: number;
            actual: number;
            date: string;
            inDate: string;
            outDate: string;
            isAnomaly: boolean;
        }

        const newViolations: DetectedViolation[] = []

        punches.forEach((p: any) => {
            if (p.breaks && Array.isArray(p.breaks)) {
                p.breaks.forEach((b: any) => {
                    if (!b.inDate || !b.outDate) return

                    const start = new Date(b.inDate).getTime()
                    const end = new Date(b.outDate).getTime()
                    const diffMins = (end - start) / 60000

                    let isViolation = false
                    let violationType: 'BRK' | 'LUN' = 'BRK'
                    let allowedMins = 10

                    if (b.paid) {
                        // Break (10m) -> violation if >= 13 min
                        if (diffMins >= 13) {
                            isViolation = true
                            violationType = 'BRK'
                            allowedMins = 10
                        }
                    } else {
                        // Lunch (30m) -> violation if >= 33 min
                        if (diffMins >= 33) {
                            isViolation = true
                            violationType = 'LUN'
                            allowedMins = 30
                        }
                    }

                    if (isViolation) {
                        // Check if already notified in DB
                        const isAlreadyRecorded = existingViolations?.some((dbV: any) =>
                            dbV.store_id === p.store_id &&
                            dbV.employee_toast_guid === p.employee_toast_guid &&
                            dbV.business_date === p.business_date &&
                            new Date(dbV.in_time).getTime() === new Date(b.inDate).getTime()
                        )

                        if (!isAlreadyRecorded) {
                            const store = stores.find(s => s.external_id === p.store_id || s.id === p.store_id)
                            const emp = toastEmployees.find(e => e.toast_guid === p.employee_toast_guid)

                            const storeSupervisorUser = store?.users as any
                            const supervisorEmail = storeSupervisorUser?.email || undefined

                            const empName = emp ? `${emp.chosen_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() : 'Empleado'

                            newViolations.push({
                                storeId: p.store_id,
                                storeName: store?.name || 'Tacos Gavilan',
                                storeUuid: store?.id,
                                supervisorEmail,
                                employeeRef: p.employee_toast_guid,
                                employeeName: empName,
                                employeeEmail: emp?.email || undefined,
                                type: violationType,
                                allowed: allowedMins,
                                actual: diffMins,
                                date: p.business_date,
                                inDate: b.inDate,
                                outDate: b.outDate,
                                isAnomaly: diffMins >= 60 // Mark severe punches over 60 min as anomalies
                            })
                        }
                    }
                })
            }
        })

        console.log(`🚨 [CRON 11:59 AM] Detected ${newViolations.length} new un-notified violations`)

        if (newViolations.length === 0) {
            return NextResponse.json({
                success: true,
                message: `All punches for ${targetDate} are compliant or already notified.`,
                business_date: targetDate,
                total_violations: 0,
                emails_sent: 0,
                duration_ms: Date.now() - startTime
            })
        }

        // 6. Group Violations by Store
        const violationsByStore: Record<string, DetectedViolation[]> = {}
        newViolations.forEach(v => {
            if (!violationsByStore[v.storeId]) {
                violationsByStore[v.storeId] = []
            }
            violationsByStore[v.storeId].push(v)
        })

        let totalEmailsSent = 0
        let totalRecordsInserted = 0
        const storeResults: any[] = []

        // 7. Process Each Store
        for (const [storeId, storeViolations] of Object.entries(violationsByStore)) {
            const store = stores.find(s => s.external_id === storeId || s.id === storeId)
            const storeName = store?.name || 'Tacos Gavilan'

            let transporterObj = null
            try {
                transporterObj = await getStoreTransporter(storeId, store?.id)
            } catch (err: any) {
                console.error(`⚠️ [CRON 11:59 AM] Transporter failed for store ${storeName}:`, err.message)
            }

            // 7a. Insert Records into DB `punch_violations`
            const recordsToInsert = storeViolations.map(v => ({
                store_id: v.storeId,
                employee_toast_guid: v.employeeRef,
                business_date: v.date,
                violation_type: v.type,
                in_time: v.inDate,
                out_time: v.outDate,
                allowed_minutes: v.allowed,
                actual_minutes: Math.round(v.actual),
                status: 'Avisado',
                notified_recipients: {
                    initiator: 'Cron Automático (11:59 AM)',
                    initiator_role: 'system_cron',
                    email_sent: !!v.employeeEmail,
                    from_email: transporterObj?.fromEmail || 'system',
                    dispatched_at: new Date().toISOString()
                }
            }))

            const { error: insertError } = await supabase.from('punch_violations').insert(recordsToInsert)
            if (insertError) {
                console.error(`❌ Error inserting punch violations for store ${storeName}:`, insertError)
            } else {
                totalRecordsInserted += recordsToInsert.length
            }

            // 7b. If Transporter Available, Dispatch Emails
            let storeEmailsSent = 0

            if (transporterObj) {
                const { accessToken, fromEmail } = transporterObj

                // Send Individual Emails to Employees
                for (const v of storeViolations) {
                    if (v.employeeEmail) {
                        const typeName = v.type === 'BRK' ? 'Break de 10 minutos' : 'Lunch de 30 minutos'
                        const subject = `⚠️ Aviso de Tiempo Excedido: ${typeName}`
                        const bodyHtml = `
                            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                                <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center;">
                                    <h2 style="margin: 0; font-size: 20px; font-weight: 800;">ALERTA DE TIEMPO EXCEDIDO</h2>
                                    <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 13px;">${storeName}</p>
                                </div>
                                <div style="padding: 24px;">
                                    <p style="font-size: 16px;">Hola <strong>${v.employeeName}</strong>,</p>
                                    <p style="font-size: 14px; line-height: 1.5; color: #4b5563;">
                                        El sistema automatizado registró un tiempo excedido en tu <strong>${typeName}</strong> del día <strong>${formatDateNice(v.date)}</strong>.
                                    </p>
                                    
                                    <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                        <p style="margin: 0 0 8px 0; font-weight: 700; color: #991b1b;">Detalles del registro:</p>
                                        <ul style="margin: 0; padding-left: 20px; color: #374151; font-size: 14px; line-height: 1.6;">
                                            <li>Hora de salida: <strong>${formatTime(v.inDate)}</strong></li>
                                            <li>Hora de regreso: <strong>${formatTime(v.outDate)}</strong></li>
                                            <li>Tiempo permitido: <strong>${v.allowed} minutos</strong></li>
                                            <li>Tiempo real tomado: <strong style="color: #b91c1c;">${Math.round(v.actual)} minutos</strong></li>
                                        </ul>
                                    </div>
                                    
                                    <p style="font-size: 13px; color: #475569; line-height: 1.5;">
                                        Te invitamos a respetar tus tiempos de descanso para mantener una óptima operación en el equipo. Si consideras que este registro es un error (por ejemplo, olvidaste punchar a tiempo), comunícate con tu gerente de tienda.
                                    </p>
                                    <br/>
                                    <p style="font-size: 13px; color: #6b7280; border-top: 1px solid #f3f4f6; pt: 16px;">
                                        Atte,<br/>
                                        <strong>El Equipo Gerencial (${fromEmail})</strong><br/>
                                        Sistema de Monitoreo Tacos Gavilan
                                    </p>
                                </div>
                            </div>
                        `
                        try {
                            await sendViaGmail(accessToken, {
                                from: `"${storeName} Gerencia" <${fromEmail}>`,
                                to: v.employeeEmail,
                                subject: subject,
                                html: bodyHtml
                            })
                            storeEmailsSent++
                            totalEmailsSent++
                        } catch (emailErr) {
                            console.error(`Failed to send violation email to ${v.employeeEmail}:`, emailErr)
                        }
                    }
                }

                // Send Consolidated Summary Email to Store Manager and Supervisor
                let summaryTableRows = ''
                storeViolations.forEach(v => {
                    const typeName = v.type === 'BRK' ? 'Break (10m)' : 'Lunch (30m)'
                    const anomalyBadge = v.isAnomaly ? '<span style="color: #dc2626; font-weight: bold; font-size: 10px; background: #fee2e2; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">⚠️ ANOMALÍA</span>' : ''
                    summaryTableRows += `
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${v.employeeName}${anomalyBadge}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${typeName}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${v.allowed} min</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: bold; text-align: center;">${Math.round(v.actual)} min</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${formatTime(v.inDate)} ➔ ${formatTime(v.outDate)}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: ${v.employeeEmail ? '#059669' : '#9ca3af'};">
                                ${v.employeeEmail ? `✓ Enviado (${v.employeeEmail})` : 'Sin Correo Registrado'}
                            </td>
                        </tr>
                    `
                })

                const summaryHtml = `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 750px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                        <div style="background-color: #1e293b; color: white; padding: 20px; text-align: center;">
                            <h2 style="margin: 0; text-transform: uppercase; font-size: 18px;">📋 Reporte Diario Automático de Infracciones</h2>
                            <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">${storeName} — Día auditado: <strong>${formatDateNice(targetDate)}</strong></p>
                            <p style="margin: 3px 0 0 0; font-size: 11px; opacity: 0.7;">Despachado automáticamente a las 11:59 AM tras la ventana matutina de revisión.</p>
                        </div>
                        <div style="padding: 24px;">
                            <p><strong>Estimado(a) Gerente / Supervisor(a):</strong></p>
                            <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">
                                Se ha completado la auditoría diaria automática de ponchadas correspondiente al día de ayer (<strong>${formatDateNice(targetDate)}</strong>). A continuación se detallan las infracciones registradas y notificadas al personal:
                            </p>
                            
                            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; text-align: left;">
                                <thead>
                                    <tr style="background-color: #f8fafc; color: #475569; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 10px;">Empleado</th>
                                        <th style="padding: 10px;">Tipo</th>
                                        <th style="padding: 10px; text-align: center;">Permitido</th>
                                        <th style="padding: 10px; text-align: center;">Real</th>
                                        <th style="padding: 10px; text-align: center;">Horario</th>
                                        <th style="padding: 10px;">Estado Notificación</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${summaryTableRows}
                                </tbody>
                            </table>
                            
                            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #166534; margin-top: 20px;">
                                💡 <strong>Aviso del Sistema:</strong> Las infracciones notificadas han quedado registradas en el historial oficial del sistema.
                            </div>
                            
                            <p style="font-size: 12px; color: #9ca3af; margin-top: 24px; text-align: center;">
                                Sistema de Monitoreo Automatizado — Tacos Gavilan
                            </p>
                        </div>
                    </div>
                `

                const supervisorEmail = storeViolations[0]?.supervisorEmail

                try {
                    const managerMailOptions: any = {
                        from: `"${storeName} Auditoría" <${fromEmail}>`,
                        to: fromEmail,
                        subject: `📋 [Auto 11:59 AM] Reporte Diario de Infracciones - ${storeName} (${targetDate})`,
                        html: summaryHtml
                    }

                    if (supervisorEmail && supervisorEmail !== fromEmail) {
                        managerMailOptions.cc = supervisorEmail
                    }

                    await sendViaGmail(accessToken, managerMailOptions)
                } catch (summaryErr) {
                    console.error(`Failed to send manager summary email for store ${storeName}:`, summaryErr)
                }
            }

            storeResults.push({
                storeId,
                storeName,
                violationsCount: storeViolations.length,
                emailsSent: storeEmailsSent
            })
        }

        console.log(`✅ [CRON 11:59 AM] Completed: ${totalRecordsInserted} violations recorded, ${totalEmailsSent} emails sent.`)

        return NextResponse.json({
            success: true,
            business_date: targetDate,
            total_violations: totalRecordsInserted,
            emails_sent: totalEmailsSent,
            stores_processed: storeResults,
            duration_ms: Date.now() - startTime
        })

    } catch (error: any) {
        console.error('Fatal error in daily violations cron:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

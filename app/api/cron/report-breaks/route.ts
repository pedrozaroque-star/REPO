/**
 * @module api/cron/report-breaks
 * @description Cron semanal recurrente ejecutado todos los lunes a las 5:00 AM PST (12:00 UTC) para auditar
 * las infracciones de descansos (breaks) y almuerzos (lunches) de los empleados en todas las sucursales de Tacos Gavilan
 * durante la semana anterior (lunes a domingo), despachando un reporte ejecutivo consolidado por correo a Dirección General
 * (Raquel Velazquez, Roberto Velazquez), Carlos y Supervisores de Zona (incluyendo Ricardo y Javier).
 * 
 * @businessRules
 * - Período evaluado: Semana completa inmediata anterior (lunes a domingo, Los Ángeles timezone).
 * - Rest Breaks (Descansos pagados): 10 minutos autorizados. Se marca infracción con diffMins >= 13 (tolerancia de 3 min).
 * - Meal Lunches (Almuerzos no pagados): 30 minutos autorizados. Se marca infracción con diffMins >= 33 (tolerancia de 3 min).
 * - Agrupación y jerarquía: Ordenado por Supervisor de Zona -> Sucursal -> Nombre del Empleado -> Fecha.
 * - Destinatarios: Dirección General (raquel@tacosgavilan.com, roberto@tacosgavilan.com), carlos@tacosgavilan.com
 *   y todos los supervisores asignados en la tabla `stores` (ricardo@tacosgavilan.com, javier@tacosgavilan.com, etc.).
 * - Autenticación de envío: Google OAuth de Carlos (carlos@tacosgavilan.com) vía Gmail API para garantizar entrega 100% confiable.
 * 
 * @dataFlow
 * - Vercel Cron (Lunes 12:00 UTC / 5:00 AM PST) -> Consulta de sucursales y supervisores -> Paginación de `punches`
 *   (semana lunes-domingo) -> Consulta de nombres de empleados en `toast_employees` -> Detección de excesos en `breaks`
 *   (pagados vs no pagados) -> Generación de HTML ejecutivo con tarjetas KPI y tabla agrupada -> Envío vía Gmail API.
 * 
 * @notes
 * - Configurado en `vercel.json` con programación "0 12 * * 1" (Lunes 5:00 AM PST).
 * - Audita tanto Breaks pagados (10m) como Lunches no pagados (30m).
 * - Incluye desglose de exceso (+X min), tarjetas KPI de resumen ejecutivo y badges estilizados.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes so Vercel does not kill it in the middle of fetching/emailing 

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

// Función para obtener transporte (ESTRICTO: Solo Carlos)
async function getCarlosTransporter() {
    const { data: user, error } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('email', 'carlos@tacosgavilan.com')
        .single()

    if (error) {
        throw new Error('No se encontro a Carlos en la BD o no tiene token configurado.')
    }

    if (user?.google_refresh_token && user?.google_email_connected) {
        try {
            const tokenUrl = 'https://oauth2.googleapis.com/token'
            const params = new URLSearchParams()
            params.append('client_id', process.env.GOOGLE_CLIENT_ID!)
            params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!)
            params.append('refresh_token', user.google_refresh_token)
            params.append('grant_type', 'refresh_token')

            const refreshRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            })

            if (!refreshRes.ok) {
                const errData = await refreshRes.json()
                throw new Error(`Token Refresh Failed: ${errData.error_description || errData.error}`)
            }

            const tokens = await refreshRes.json()
            const accessToken = tokens.access_token

            const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
            const profile = await profileRes.json()

            return {
                accessToken,
                fromEmail: profile.email
            }
        } catch (e) {
            throw new Error('GMAIL_AUTH_FAILED: ' + (e as Error).message)
        }
    }

    throw new Error('CARLOS_GMAIL_NOT_CONNECTED')
}

// Helpers format
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

export async function GET(req: Request) {
    try {
        const url = new URL(req.url)
        const authHeader = req.headers.get('authorization')
        const isDryRun = url.searchParams.get('dry_run') === 'true'
        const isManual = url.searchParams.get('manual') === 'true'

        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isManual && !isDryRun) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Compute Previous Week Range (Monday to Sunday) LA Time
        const laTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

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

        const mondayStr = formatDate(pastMonday)
        const sundayStr = formatDate(pastSunday)

        // 1. Authenticate with Google (Skip if dry run)
        let authObj = null
        if (!isDryRun) {
            try {
                authObj = await getCarlosTransporter()
            } catch (e: any) {
                console.error('Email failed to init Carlos account:', e)
                return NextResponse.json({ error: 'Auth failed: ' + e.message }, { status: 500 })
            }
        }
        const accessToken = authObj?.accessToken || ''
        const fromEmail = authObj?.fromEmail || 'carlos@tacosgavilan.com'

        // 2. Fetch Stores & Supervisors
        const { data: stores } = await supabase
            .from('stores')
            .select('id, name, supervisor_name, external_id, supervisor_id, users!stores_supervisor_id_fkey(email)')

        // 3. Fetch Punches with pagination
        let punches: any[] = []
        let currentOffset = 0
        const pageSize = 1000
        while (true) {
            const { data: chunk, error } = await supabase.from('punches')
                .select('store_id, employee_toast_guid, business_date, breaks')
                .gte('business_date', mondayStr)
                .lte('business_date', sundayStr)
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
                period: `${mondayStr} to ${sundayStr}`
            })
        }

        // 4. Fetch Employees
        const uniqueEmpIds = Array.from(new Set(punches.map((p: any) => p.employee_toast_guid))).filter(Boolean)
        const emps: any[] = []
        for (let i = 0; i < uniqueEmpIds.length; i += 500) {
            const chunk = uniqueEmpIds.slice(i, i + 500)
            const { data } = await supabase
                .from('toast_employees')
                .select('toast_guid, first_name, last_name, chosen_name')
                .in('toast_guid', chunk)
            if (data) emps.push(...data)
        }

        // 5. Detect Violations (Both Paid Breaks & Unpaid Lunches)
        interface Violation {
            supervisor: string;
            storeName: string;
            empName: string;
            type: 'BRK' | 'LUN';
            typeLabel: string;
            allowedMins: number;
            date: string;
            inTime: string;
            outTime: string;
            diffMins: number;
            excessMins: number;
        }

        const violations: Violation[] = []

        punches.forEach((p: any) => {
            if (p.breaks && Array.isArray(p.breaks)) {
                p.breaks.forEach((b: any) => {
                    if (!b.inDate || !b.outDate) return

                    const start = new Date(b.inDate).getTime()
                    const end = new Date(b.outDate).getTime()
                    const diffMins = (end - start) / 60000

                    let isViolation = false
                    let violationType: 'BRK' | 'LUN' = 'BRK'
                    let typeLabel = 'Break (10m)'
                    let allowedMins = 10

                    if (b.paid) {
                        // Rest Break: 10m autorizados. Infracción si diffMins >= 13 (tolerancia de 3 min)
                        if (diffMins >= 13) {
                            isViolation = true
                            violationType = 'BRK'
                            typeLabel = 'Break (10m)'
                            allowedMins = 10
                        }
                    } else {
                        // Meal Lunch: 30m autorizados. Infracción si diffMins >= 33 (tolerancia de 3 min)
                        if (diffMins >= 33) {
                            isViolation = true
                            violationType = 'LUN'
                            typeLabel = 'Lunch (30m)'
                            allowedMins = 30
                        }
                    }

                    if (isViolation) {
                        const store = stores?.find(s => s.external_id === p.store_id || s.id === p.store_id)
                        const emp = emps?.find(e => e.toast_guid === p.employee_toast_guid)

                        violations.push({
                            supervisor: store?.supervisor_name || 'Sin Asignar',
                            storeName: store?.name ? store.name.replace(/toast/i, '').trim() : 'Tienda Desconocida',
                            empName: emp ? `${emp.chosen_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() : 'Desconocido',
                            type: violationType,
                            typeLabel,
                            allowedMins,
                            date: p.business_date,
                            inTime: b.inDate,
                            outTime: b.outDate,
                            diffMins: Math.round(diffMins),
                            excessMins: Math.max(0, Math.round(diffMins) - allowedMins)
                        })
                    }
                })
            }
        })

        if (violations.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No break or lunch violations detected for the week. 100% compliance!',
                period: `${mondayStr} to ${sundayStr}`
            })
        }

        // 6. Order By Supervisor -> StoreName -> EmpName -> Date
        violations.sort((a, b) => {
            if (a.supervisor !== b.supervisor) return a.supervisor.localeCompare(b.supervisor)
            if (a.storeName !== b.storeName) return a.storeName.localeCompare(b.storeName)
            if (a.empName !== b.empName) return a.empName.localeCompare(b.empName)
            return a.date.localeCompare(b.date)
        })

        // 7. Calculate KPI metrics
        const totalViolations = violations.length
        const totalBreaks = violations.filter(v => v.type === 'BRK').length
        const totalLunches = violations.filter(v => v.type === 'LUN').length
        const affectedStoresCount = new Set(violations.map(v => v.storeName)).size

        // 8. Generate Email HTML
        let tableRows = ''
        let currentSupervisor = ''

        violations.forEach(v => {
            if (currentSupervisor !== v.supervisor) {
                currentSupervisor = v.supervisor
                tableRows += `
                    <tr>
                        <td colspan="8" style="background-color: #f1f5f9; font-weight: bold; padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #1e293b; text-transform: uppercase; font-size: 13px;">
                            👔 SUPERVISOR(A): ${currentSupervisor}
                        </td>
                    </tr>
                `
            }

            const isBreak = v.type === 'BRK'
            const typeBadge = isBreak
                ? `<span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 9999px; font-weight: 600; font-size: 11px; display: inline-block; white-space: nowrap;">☕ Break (10m)</span>`
                : `<span style="background-color: #ede9fe; color: #5b21b6; padding: 3px 8px; border-radius: 9999px; font-weight: 600; font-size: 11px; display: inline-block; white-space: nowrap;">🍽️ Lunch (30m)</span>`

            tableRows += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #1f2937;">${v.storeName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #374151;">${v.empName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; color: #4b5563; font-size: 12px;">${formatDateNice(v.date)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${typeBadge}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 12px;">${v.allowedMins}m</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: bold; font-size: 13px;">${v.diffMins} min</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #b91c1c; font-weight: 600; font-size: 12px;">+${v.excessMins}m</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #4b5563; white-space: nowrap;">${formatTime(v.inTime)} ➔ ${formatTime(v.outTime)}</td>
                </tr>
            `
        })

        const htmlBody = `
            <div style="font-family: Arial, Helvetica, sans-serif; color: #333; max-width: 860px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
                <!-- Header Banner -->
                <div style="background-color: #b91c1c; color: #ffffff; padding: 24px 20px; text-align: center;">
                    <div style="font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.9; margin-bottom: 4px;">TACOS GAVILAN</div>
                    <h1 style="margin: 0; font-size: 22px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Reporte Semanal de Infracciones: Breaks y Lunches</h1>
                    <p style="margin: 8px 0 0 0; opacity: 0.95; font-size: 14px;">Semana del ${formatDateNice(mondayStr)} al ${formatDateNice(sundayStr)}</p>
                </div>

                <div style="padding: 24px;">
                    <!-- Executive KPI Cards -->
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
                                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #334155; letter-spacing: 0.5px;">Tiendas Afectadas</div>
                                    <div style="font-size: 26px; font-weight: 800; color: #475569; margin-top: 4px;">${affectedStoresCount}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Policy Info Box -->
                    <div style="background-color: #f8fafc; border-left: 4px solid #b91c1c; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px; font-size: 13px; color: #475569;">
                        ⚖️ <strong>Reglas de Auditoría Laboral (California):</strong><br/>
                        • <strong>Rest Break pagado (10 min autorizados):</strong> Se reporta si el registro supera los <strong>13 minutos</strong> (tolerancia de 3 min).<br/>
                        • <strong>Meal Lunch no pagado (30 min autorizados):</strong> Se reporta si el registro supera los <strong>33 minutos</strong> (tolerancia de 3 min).
                    </div>

                    <!-- Violations Table -->
                    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; text-align: left;">
                        <thead>
                            <tr style="background-color: #1e293b; color: #ffffff;">
                                <th style="padding: 10px; font-weight: 600;">Locación</th>
                                <th style="padding: 10px; font-weight: 600;">Empleado</th>
                                <th style="padding: 10px; font-weight: 600;">Día</th>
                                <th style="padding: 10px; font-weight: 600;">Tipo</th>
                                <th style="padding: 10px; font-weight: 600; text-align: center;">Permitido</th>
                                <th style="padding: 10px; font-weight: 600; text-align: center;">T. Real</th>
                                <th style="padding: 10px; font-weight: 600; text-align: center;">Exceso</th>
                                <th style="padding: 10px; font-weight: 600;">Horario (Salida ➔ Regreso)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>

                    <!-- Footer Details -->
                    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 28px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.6;">
                        <p style="margin: 0; font-weight: 600; color: #475569;">
                            Destinatarios: Dirección General (Raquel Velazquez, Roberto Velazquez), Carlos y Supervisores de Zona.
                        </p>
                        <p style="margin: 4px 0 0 0;">
                            Reporte confidencial generado automáticamente todos los lunes a las 5:00 AM PST.<br/>
                            Sistema de Monitoreo y Auditoría Laboral — <strong>Tacos Gavilan</strong>
                        </p>
                    </div>
                </div>
            </div>
        `

        // 9. Send the Email using Transporter
        const sendViaGmail = async (mailOptions: any) => {
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
        }

        // Executive Recipients: Raquel Velazquez, Roberto Velazquez & Carlos
        const executiveEmails = [
            'raquel@tacosgavilan.com',
            'roberto@tacosgavilan.com',
            'carlos@tacosgavilan.com'
        ]

        // Zone Supervisors from stores table (normalizing Ricardo and Javier)
        const supervisorEmails = Array.from(
            new Set(
                stores?.map((s: any) => {
                    const email = s.users?.email
                    if (!email) return null
                    const cleanEmail = email.trim().toLowerCase()
                    if (cleanEmail.includes('ricardo')) return 'ricardo@tacosgavilan.com'
                    if (cleanEmail.includes('javier')) return 'javier@tacosgavilan.com'
                    return cleanEmail
                }).filter(Boolean)
            )
        )

        // Combined Unique Recipient List
        const allRecipients = Array.from(
            new Set([...executiveEmails, ...supervisorEmails])
        )

        if (isDryRun) {
            return NextResponse.json({
                success: true,
                dry_run: true,
                recipients: allRecipients,
                counts: {
                    total: totalViolations,
                    breaks: totalBreaks,
                    lunches: totalLunches,
                    storesAffected: affectedStoresCount
                },
                sample_violations: violations.slice(0, 10),
                period: `${mondayStr} to ${sundayStr}`
            })
        }

        // Test Mode or Production Dispatch
        const testTo = url.searchParams.get('test_to')
        const isTest = Boolean(testTo)
        const recipientsToSend = (testTo && testTo !== 'all') ? [testTo] : allRecipients
        const subjectPrefix = isTest ? '[PRUEBA] ' : ''

        await sendViaGmail({
            from: `"Tacos Gavilan - Auditoría" <${fromEmail}>`,
            to: recipientsToSend.join(', '),
            subject: `${subjectPrefix}📊 Reporte Semanal de Infracciones de Break y Lunch (${mondayStr} a ${sundayStr})`,
            html: htmlBody
        })

        return NextResponse.json({
            success: true,
            isTest,
            recipients: recipientsToSend,
            count: violations.length,
            breaks: totalBreaks,
            lunches: totalLunches,
            emailsSent: 1,
            period: `${mondayStr} to ${sundayStr}`
        })

    } catch (e: any) {
        console.error('Fatal API error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
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
        hour: 'numeric', minute: '2-digit', hour12: true
    })
}

function formatDateNice(isoString: string) {
    if (!isoString) return ''
    const date = new Date(isoString + 'T12:00:00')
    return date.toLocaleDateString('es-ES', {
        timeZone: 'America/Los_Angeles',
        day: '2-digit', month: 'short', year: 'numeric', weekday: 'short'
    })
}

export async function GET(req: Request) {
    try {
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

        // 1. Authenticate with Google
        let authObj = null;
        try {
            authObj = await getCarlosTransporter()
        } catch (e: any) {
            console.error('Email failed to init Carlos account:', e)
            return NextResponse.json({ error: 'Auth failed: ' + e.message }, { status: 500 })
        }
        const { accessToken, fromEmail } = authObj;

        // 2. Fetch Data
        const { data: stores } = await supabase.from('stores').select('id, name, supervisor_name')
        const { data: emps } = await supabase.from('toast_employees').select('toast_guid, first_name, last_name, chosen_name')
        const { data: punches } = await supabase.from('punches')
            .select('store_id, employee_toast_guid, business_date, breaks')
            .gte('business_date', mondayStr)
            .lte('business_date', sundayStr)

        if (!punches || punches.length === 0) {
            return NextResponse.json({ message: 'No punches found for the week' })
        }

        // 3. Process Violations
        interface Violation {
            supervisor: string;
            storeName: string;
            empName: string;
            date: string;
            inTime: string;
            outTime: string;
            diffMins: number;
        }

        const violations: Violation[] = [];

        punches.forEach((p: any) => {
            if (p.breaks && Array.isArray(p.breaks)) {
                p.breaks.forEach((b: any) => {
                    if (!b.inDate || !b.outDate) return;

                    const start = new Date(b.inDate).getTime();
                    const end = new Date(b.outDate).getTime();
                    const diffMins = (end - start) / 60000;

                    // SOLO BREAKS (b.paid === true)
                    // Tolerancia de 3 minutos, asi que cuenta si diffMins es >= 13
                    if (b.paid && diffMins >= 13) {
                        const store = stores?.find(s => s.id === p.store_id)
                        const emp = emps?.find(e => e.toast_guid === p.employee_toast_guid)

                        violations.push({
                            supervisor: store?.supervisor_name || 'Sin Asignar',
                            storeName: store?.name || 'Tienda Desconocida',
                            empName: emp ? `${emp.chosen_name || emp.first_name} ${emp.last_name}` : 'Unknown',
                            date: p.business_date,
                            inTime: b.inDate,
                            outTime: b.outDate,
                            diffMins: Math.round(diffMins)
                        })
                    }
                })
            }
        })

        if (violations.length === 0) {
            return NextResponse.json({ message: 'No violations found correctly' })
        }

        // 4. Order By Supervisor -> StoreName -> EmpName -> Date
        violations.sort((a, b) => {
            if (a.supervisor !== b.supervisor) return a.supervisor.localeCompare(b.supervisor)
            if (a.storeName !== b.storeName) return a.storeName.localeCompare(b.storeName)
            if (a.empName !== b.empName) return a.empName.localeCompare(b.empName)
            return a.date.localeCompare(b.date)
        })

        // 5. Generate Email HTML
        let tableRows = ''
        let currentSupervisor = ''

        violations.forEach(v => {
            if (currentSupervisor !== v.supervisor) {
                currentSupervisor = v.supervisor
                tableRows += `
                    <tr>
                        <td colspan="5" style="background-color: #f1f5f9; font-weight: bold; padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #1e293b; text-transform: uppercase;">
                            SUPERVISOR(A): ${currentSupervisor}
                        </td>
                    </tr>
                `
            }

            tableRows += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${v.storeName.replace(/toast/i, '').trim()}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${v.empName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap;">${formatDateNice(v.date)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: bold;">${v.diffMins} min</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${formatTime(v.inTime)} ➔ ${formatTime(v.outTime)}</td>
                </tr>
            `
        })

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 800px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #b91c1c; color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0; text-transform: uppercase;">Reporte Semanal de Infracciones de Break</h2>
                    <p style="margin: 5px 0 0 0; opacity: 0.9;">Tolerancia maxima permitida: 13 minutos</p>
                    <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Semana del ${formatDateNice(mondayStr)} al ${formatDateNice(sundayStr)}</p>
                </div>
                <div style="padding: 20px;">
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; text-align: left;">
                        <thead>
                            <tr style="background-color: #1e293b; color: white;">
                                <th style="padding: 10px;">Locacion</th>
                                <th style="padding: 10px;">Empleado</th>
                                <th style="padding: 10px;">Dia</th>
                                <th style="padding: 10px;">T. Real</th>
                                <th style="padding: 10px;">Registro (Salida a Entrada)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                    <p style="font-size: 12px; color: #64748b; margin-top: 30px; text-align: center;">
                        Reporte automatico generado el ${laTime.toLocaleString('es-ES', { timeZone: 'America/Los_Angeles' })} <br/>
                        Desde la cuenta de Sistema de Monitoreo - Tacos Gavilan
                    </p>
                </div>
            </div>
        `

        // 6. Send the Email using Transporter
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

        await sendViaGmail({
            from: `"Sistema Gavilan" <${fromEmail}>`,
            to: 'jennifer@cingularhr.com',
            subject: `📊 Reporte Semanal de Infracciones de Break (${mondayStr} a ${sundayStr})`,
            html: htmlBody
        })

        return NextResponse.json({ success: true, count: violations.length, emailsSent: 1 })

    } catch (e: any) {
        console.error('Fatal API error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

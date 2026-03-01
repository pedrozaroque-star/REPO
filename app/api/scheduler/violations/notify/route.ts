import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Función para obtener transporte (ESTRICTO: Solo OAuth por Usuario)
async function getTransporter(userId?: string) {
    if (!userId) {
        throw new Error('Usuario no identificado. No se pueden enviar correos anónimos.')
    }

    const { data: user, error } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('id', userId)
        .single()

    if (error) {
        console.error('❌ [API] DB Error fetching user:', error)
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

    throw new Error('GMAIL_NOT_CONNECTED')
}

// Helpers format
function formatTime(isoString?: string) {
    if (!isoString) return '--'
    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDateNice(isoString: string) {
    if (!isoString) return ''
    const date = new Date(isoString)
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function POST(req: Request) {
    try {
        const { violations, userEmail, userRole, userId, storeId } = await req.json()

        if (!violations || !Array.isArray(violations) || violations.length === 0) {
            return NextResponse.json({ error: 'No violations provided' }, { status: 400 })
        }

        const isManagerOrSupervisor = userRole?.toLowerCase().includes('manager') || userRole?.toLowerCase().includes('supervisor')
        const isAdmin = userRole?.toLowerCase().includes('admin')

        // 1. Si es Admin, abortamos.
        if (isAdmin) {
            return NextResponse.json({ success: true, message: 'Modal closed purely. No emails sent and no DB records made (Admin rule).' })
        }

        // 2. Load Google Transporter to verify connectivity FIRST
        let authObj = null;
        try {
            authObj = await getTransporter(userId)
        } catch (e: any) {
            console.error('Email failed to init:', e)
            if (e.message.includes('NOT_CONNECTED')) {
                return NextResponse.json({ error: 'Debes conectar tu cuenta de Gmail en tu perfil para mandar avisos.' }, { status: 403 })
            }
            return NextResponse.json({ error: 'Fallo al autenticar correo: ' + e.message }, { status: 500 })
        }
        const { accessToken, fromEmail } = authObj;

        // 3. Guardar en Base de Datos (punch_violations) para managers/supervisores
        const recordsToInsert = violations.map((v: any) => ({
            store_id: storeId,
            employee_toast_guid: v.employeeRef,
            business_date: v.date,
            violation_type: v.type,
            in_time: v.inDate,
            out_time: v.outDate,
            allowed_minutes: v.allowed,
            actual_minutes: Math.round(v.actual),
            status: 'Avisado',
            notified_recipients: {
                initiator: userEmail,
                initiator_role: userRole,
                email_sent: true
            }
        }))

        const { error: dbError } = await supabase.from('punch_violations').insert(recordsToInsert)
        if (dbError) {
            console.error('Error inserting punch violations:', dbError)
            return NextResponse.json({ error: 'Failed to record violations' }, { status: 500 })
        }

        // 4. Preparar Send() Function (vía Gmail API RAW Buffer)
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

        // 5. Enviar Correos a Empleados
        const emailsToFetch = violations.map((v: any) => v.employeeRef)
        const { data: emps } = await supabase.from('toast_employees').select('toast_guid, email, first_name').in('toast_guid', emailsToFetch)

        for (const v of violations) {
            const empDb = emps?.find((e: any) => e.toast_guid === v.employeeRef)
            const empEmail = empDb?.email
            const empName = v.name || empDb?.first_name || 'Empleado'

            if (empEmail) {
                const typeName = v.type === 'BRK' ? 'Break de 10 minutos' : 'Lunch de 30 minutos'
                const subject = `⚠️ Aviso de Tiempo Excedido: ${typeName}`
                const bodyHtml = `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                        <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center;">
                            <h2 style="margin: 0;">ALERTA DE TIEMPO EXCEDIDO</h2>
                        </div>
                        <div style="padding: 20px;">
                            <p>Hola <strong>${empName}</strong>,</p>
                            <p>Te escribimos para informarte que el sistema registró un tiempo excedido en tu <strong>${typeName}</strong> del día <strong>${formatDateNice(v.date)}</strong>.</p>
                            
                            <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                                <p style="margin: 0; padding-bottom: 5px;"><strong>Detalles del registro:</strong></p>
                                <ul style="margin: 0; padding-left: 20px;">
                                    <li>Hora de salida: <strong>${formatTime(v.inDate)}</strong></li>
                                    <li>Hora de regreso: <strong>${formatTime(v.outDate)}</strong></li>
                                    <li>Tiempo permitido: <strong>${v.allowed} minutos</strong></li>
                                    <li>Tiempo real tomado: <strong style="color: #b91c1c;">${Math.round(v.actual)} minutos</strong></li>
                                </ul>
                            </div>
                            
                            <p style="font-size: 14px; color: #475569;">
                                Recuerda que por políticas de la empresa, acumular <strong>más de 3 infracciones</strong> de tiempo en un mismo mes puede resultar en una suspensión temporal, hasta que se emita una resolución disciplinaria formal.
                            </p>
                            <p style="font-size: 14px; color: #475569;">
                                Te invitamos a respetar tus tiempos de descanso para mantener una buena operación en equipo. Si crees que este registro es un error (por ejemplo, olvidaste punchar tu regreso), comunícate inmediatamente con este correo respondíendole a tu gerente.
                            </p>
                            <br/>
                            <p>Atte,<br/><strong>El Equipo Gerencial (${fromEmail})</strong><br/>Sistema de Monitoreo Tacos Gavilan</p>
                        </div>
                    </div>
                `
                try {
                    await sendViaGmail({
                        from: `"Gerencia" <${fromEmail}>`,
                        to: empEmail,
                        subject: subject,
                        html: bodyHtml
                    })
                } catch (e) { console.error('Failed employee email:', e) }
            }
        }

        // 6. Enviar Correo Resumen a Gerencia
        if (isManagerOrSupervisor) {
            let tableRows = ''
            violations.forEach((v: any) => {
                const empDb = emps?.find((e: any) => e.toast_guid === v.employeeRef)
                const typeName = v.type === 'BRK' ? 'Break (10m)' : 'Lunch (30m)'
                const empName = v.name || empDb?.first_name || 'Desconocido'
                tableRows += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${empName}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${typeName}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${v.allowed} min</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: bold;">${Math.round(v.actual)} min</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${formatTime(v.inDate)} ➔ ${formatTime(v.outDate)}</td>
                    </tr>
                `
            })

            const summaryHtml = `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 700px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #1e293b; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0; text-transform: uppercase;">Resumen de Infracciones de Break/Lunch</h2>
                    </div>
                    <div style="padding: 20px;">
                        <p><strong>Hola,</strong></p>
                        <p>A continuación te presentamos el resumen de las infracciones de tiempo de descanso (Break/Lunch) que acabas de avalar y notificar al personal:</p>
                        
                        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; text-align: left;">
                            <thead>
                                <tr style="background-color: #f8fafc; color: #475569; border-bottom: 2px solid #cbd5e1;">
                                    <th style="padding: 10px;">Empleado</th>
                                    <th style="padding: 10px;">Tipo</th>
                                    <th style="padding: 10px;">Permitido</th>
                                    <th style="padding: 10px;">Real</th>
                                    <th style="padding: 10px;">Hora</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                        </table>
                        
                        <p style="font-size: 13px; color: #64748b; font-style: italic;">
                            Nota: Los empleados con correo electrónico registrado han sido notificados individualmente de forma automática usando tu cuenta Google vinculada.
                        </p>
                        
                        <p>Atte,<br/><strong>Sistema de Monitoreo Tacos Gavilan</strong></p>
                    </div>
                </div>
            `

            let supervisorEmail = undefined;
            try {
                // Obtenemos el correo del supervisor de la tienda asignada
                const { data: storeData } = await supabase
                    .from('stores')
                    .select('users!stores_supervisor_id_fkey(email)')
                    .eq('external_id', storeId)
                    .single()

                if (storeData && storeData.users) {
                    const u = storeData.users as any;
                    supervisorEmail = u.email;
                }
            } catch (e) {
                console.error('No se pudo encontrar el correo del supervisor de la tienda', e);
            }

            try {
                const mailOptions: any = {
                    from: `"Sistema de Reportes V5" <${fromEmail}>`,
                    to: fromEmail,
                    subject: `📋 Resumen de Infracciones Avaladas`,
                    html: summaryHtml
                };

                // Si se encontró el supervisor y no es la misma persona que el manager actual
                if (supervisorEmail && supervisorEmail !== fromEmail) {
                    mailOptions.cc = supervisorEmail;
                }

                await sendViaGmail(mailOptions)
            } catch (e) { console.error('Failed summary email:', e) }
        }

        return NextResponse.json({ success: true, message: 'Violations recorded and official notifications dispatched via Gmail OAuth.' })

    } catch (error: any) {
        console.error('Error in violations notify endpoint:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import path from 'path'
import fs from 'fs'

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Fallback: Obtain Gmail API access using Carlos's master account.
 */
async function getSystemTransporter(inspectorId?: string) {
    let userToUse = null;

    if (inspectorId) {
        const { data: inspector } = await supabase.from('users')
            .select('id, google_refresh_token, google_email_connected')
            .eq('id', inspectorId)
            .single();

        if (inspector?.google_refresh_token && inspector?.google_email_connected) {
            userToUse = inspector;
        }
    }

    if (!userToUse) {
        const { data: fallbackUser, error } = await supabase.from('users')
            .select('id, google_refresh_token, google_email_connected')
            .eq('email', 'carlos@tacosgavilan.com')
            .single();

        if (error || !fallbackUser?.google_refresh_token) {
            throw new Error('No se encontró la cuenta de respaldo (carlos@tacosgavilan.com) o no tiene token configurado.');
        }
        userToUse = fallbackUser;
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams();
    params.append('client_id', process.env.GOOGLE_CLIENT_ID!);
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!);
    params.append('refresh_token', userToUse.google_refresh_token);
    params.append('grant_type', 'refresh_token');

    const refreshRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!refreshRes.ok) throw new Error('Falló la actualización del token de correo.');

    const tokens = await refreshRes.json();
    return { accessToken: tokens.access_token, fromEmail: userToUse.google_email_connected };
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { inspection_id } = body

        if (!inspection_id) {
            return NextResponse.json({ error: 'Missing inspection_id' }, { status: 400 })
        }

        // 1. Fetch Inspection Details
        const { data: inspection, error: inspError } = await supabase
            .from('supervisor_inspections')
            .select('*, store:stores(name), inspector:users(full_name, email)')
            .eq('id', inspection_id)
            .single()

        if (inspError || !inspection) {
            console.error('❌ [API] Error fetching inspection:', inspError)
            return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
        }

        // 2. Extract Comments
        const answers = inspection.answers || {}
        const comments: { question: string, comment: string }[] = []

        // Iterate through sections to find comments
        Object.entries(answers).forEach(([sectionTitle, sectionData]: [string, any]) => {
            if (sectionData && sectionData.items) {
                Object.values(sectionData.items).forEach((item: any) => {
                    if (item.comment && item.comment.trim() !== '') {
                        comments.push({
                            question: item.label || 'Pregunta',
                            comment: item.comment
                        })
                    }
                })
            }
        })

        if (comments.length === 0) {
            return NextResponse.json({ message: 'No comments to notify' })
        }

        // 3. Find Managers for this store
        // Usamos una lógica robusta para encontrar managers por store_id o store_scope
        const { data: allUsers, error: usersError } = await supabase
            .from('users')
            .select('id, email, full_name, role, store_id, store_scope')
            .in('role', ['manager', 'gerente', 'admin'])

        if (usersError || !allUsers || allUsers.length === 0) {
            console.error('❌ [API] Error fetching users for notifications:', usersError)
            return NextResponse.json({ error: 'No users found to notify' }, { status: 500 })
        }

        const managers = allUsers.filter(u => 
            u.store_id === inspection.store_id || 
            (Array.isArray(u.store_scope) && u.store_scope.includes(inspection.store_id)) ||
            (typeof u.store_scope === 'string' && u.store_scope.includes(String(inspection.store_id)))
        )

        if (managers.length === 0) {
            console.warn('⚠️ [API] No managers found for store:', inspection.store_id)
            return NextResponse.json({ message: 'No managers found to notify' })
        }

        const managerEmails = managers.map(m => m.email).filter(Boolean)
        if (managerEmails.length === 0) {
            return NextResponse.json({ message: 'Managers found but they lack email' })
        }

        // 4. Authenticate System Transporter
        // Uses supervisor's email if connected, otherwise falls back to system account
        const { accessToken, fromEmail } = await getSystemTransporter(inspection.inspector_id)

        // 5. Build HTML Email
        const storeName = inspection.store?.name || 'Tienda Gavilán'
        const inspectorName = inspection.inspector?.full_name || inspection.supervisor_name || 'Supervisor'
        const score = inspection.overall_score || 0
        const inspectionDate = new Date(inspection.inspection_date || inspection.created_at).toLocaleDateString('es-MX', {
            day: 'numeric', month: 'long', year: 'numeric'
        })

        const commentRows = comments.map(c => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; font-weight: bold;">
                    ${c.question}
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #1f2937; background: #fdf2f2; border-left: 4px solid #ef4444;">
                    "${c.comment}"
                </td>
            </tr>
        `).join('')

        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Comentarios de Inspección</title>
            </head>
            <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; background: #f3f4f6; padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; shadow: 0 10px 25px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: #1e293b; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800;">📝 Comentarios de Supervisión</h1>
                            <p style="margin: 10px 0 0 0; color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em;">${storeName}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 25px;">
                                <table style="width: 100%;">
                                    <tr>
                                        <td style="font-size: 13px; color: #64748b; font-weight: bold;">SUPERVISOR</td>
                                        <td style="font-size: 13px; color: #64748b; font-weight: bold; text-align: right;">FECHA</td>
                                    </tr>
                                    <tr>
                                        <td style="font-size: 16px; color: #1e293b; font-weight: 800;">${inspectorName}</td>
                                        <td style="font-size: 16px; color: #1e293b; font-weight: 800; text-align: right;">${inspectionDate}</td>
                                    </tr>
                                    <tr>
                                        <td colspan="2" style="padding-top: 15px;">
                                            <div style="display: inline-block; background: ${score >= 87 ? '#dcfce7' : '#fee2e2'}; color: ${score >= 87 ? '#166534' : '#991b1b'}; padding: 4px 12px; border-radius: 99px; font-weight: 900; font-size: 14px;">
                                                Puntaje: ${score}%
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <h3 style="margin: 0 0 15px 0; color: #1e293b; font-size: 18px; font-weight: 800;">Comentarios Detallados:</h3>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <thead style="background: #f1f5f9;">
                                    <tr>
                                        <th style="padding: 10px; text-align: left; font-size: 12px; color: #475569; text-transform: uppercase;">Pregunta</th>
                                        <th style="padding: 10px; text-align: left; font-size: 12px; color: #475569; text-transform: uppercase;">Observación</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${commentRows}
                                </tbody>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                            <p style="margin: 0; color: #94a3b8; font-size: 12px;">Este es un mensaje automático generado por el Sistema de Monitoreo TEG.</p>
                            <div style="margin-top: 15px;">
                                <a href="https://tacosgavilan.vercel.app/inspecciones?id=${inspection_id}" style="display: inline-block; background: #4f46e5; color: #ffffff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">Ver Inspección Completa</a>
                            </div>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `

        // 6. Send Emails via Gmail API
        let successCount = 0
        const errors: string[] = []

        for (const toEmail of managerEmails) {
            try {
                const mailOptions = {
                    from: `"Supervisión TEG" <${fromEmail}>`,
                    to: toEmail,
                    subject: `📝 Comentarios de Inspección: ${storeName} (${inspectionDate})`,
                    html: fullHtml
                }

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
                    reject(new Error('Unknown message format'))
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
                    throw new Error(`Gmail API status ${sendRes.status}`)
                }

                successCount++
            } catch (err: any) {
                console.error(`❌ [API] Email failed for ${toEmail}:`, err.message)
                errors.push(`${toEmail}: ${err.message}`)
            }
        }

        // 7. Insert Bell Notifications (TopNav)
        // Esto se hace en la API para evitar problemas de RLS que el Supervisor pueda tener al buscar Managers
        if (managers.length > 0) {
            const combinedMessage = `Se dejaron ${comments.length} comentarios detallados en la inspección de ${storeName}.`
            
            const bellNotifs = managers.map(m => ({
                user_id: m.id,
                title: `Comentarios en Inspección: ${storeName}`,
                message: combinedMessage,
                type: 'warning',
                link: `/inspecciones?id=${inspection_id}`,
                reference_id: inspection_id,
                reference_type: 'supervisor_inspection'
            }))

            const { error: bellError } = await supabase.from('notifications').insert(bellNotifs)
            if (bellError) console.error('❌ [API] Error inserting bell notifications:', bellError)
        }

        return NextResponse.json({
            success: true,
            sent_to: managerEmails.length,
            delivered: successCount,
            bell_notifications: managers.length,
            errors: errors.length > 0 ? errors : undefined
        })

    } catch (error: any) {
        console.error('❌ [API] Critical error in inspection-comments route:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

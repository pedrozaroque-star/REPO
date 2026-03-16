
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import path from 'path'
import fs from 'fs'

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Función para obtener transporte (ESTRICTO: Solo OAuth por Usuario)
async function getTransporter(userId?: string) {
    if (!userId) {
        throw new Error('Usuario no identificado. No se pueden enviar correos anónimos.')
    }

    // DEBUG: Check Service Role Key presence (Safe log)
    const isServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
    console.log('🔍 [API] Fetching creds for:', userId, 'Using ServiceKey:', isServiceKey)

    // 1. Intentar obtener credenciales OAuth del usuario
    const { data: user, error } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('id', userId)
        .single()

    if (error) {
        console.error('❌ [API] DB Error fetching user:', error)
    }

    // AUTO-HEALING: If user not found in public.users but exists in auth.users, create it.
    if (!user) {
        console.warn('⚠️ [API] User record missing in public.users. Checking auth.users...')
        // We can't query auth.users directly via client easily without service role admin magic 
        // OR we just fail here because if public.users is empty, they haven't run the OAuth flow correctly anyway.
        // But let's log explicitly.
    }

    if (user?.google_refresh_token && user?.google_email_connected) {
        console.log(`✅ [API] Found OAuth2 for user ${user.google_email_connected}`)

        // MANUAL TOKEN REFRESH (To fix 535 errors)
        try {
            const tokenUrl = 'https://oauth2.googleapis.com/token'
            const params = new URLSearchParams()
            params.append('client_id', process.env.GOOGLE_CLIENT_ID!)
            params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!)
            params.append('refresh_token', user.google_refresh_token)
            params.append('grant_type', 'refresh_token')

            console.log('🔄 [API] Refreshing Access Token manually...')
            const refreshRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            })

            if (!refreshRes.ok) {
                const errData = await refreshRes.json()
                console.error('❌ [API] Failed to refresh token:', errData)
                throw new Error(`Token Refresh Failed: ${errData.error_description || errData.error}`)
            }

            const tokens = await refreshRes.json()
            const accessToken = tokens.access_token
            console.log('✅ [API] Access Token refreshed successfully!')

            // FETCH REAL USER PROFILE (To ensure 'user' matches the token owner)
            const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
            const profile = await profileRes.json()
            const realEmail = profile.email
            console.log(`✅ [API] Authenticated as Google User: ${realEmail} (Expected: ${user.google_email_connected})`)

            return {
                accessToken, // EXPOSE TOKEN
                fromEmail: realEmail
            }
        } catch (e) {
            console.error('❌ [API] Critical Auth Error during refresh:', e)
            throw new Error('GMAIL_AUTH_FAILED: ' + (e as Error).message)
        }
    } else {
        console.warn('⚠️ [API] User found but missing tokens:', JSON.stringify(user))
    }

    // SI LLEGAMOS AQUI: El usuario no tiene credenciales conectadas.
    // YA NO HACEMOS FALLBACK a la cuenta global por seguridad y política de empresa.
    throw new Error('GMAIL_NOT_CONNECTED')
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { store_id, start_date, end_date, sender_user_id } = body

        if (!store_id || (!start_date && !body.shift_ids)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // 1. Init Credentials
        let accessToken;
        let fromEmail;

        let fallbackUsed = false;

        try {
            const creds = await getTransporter(sender_user_id)
            accessToken = creds.accessToken
            fromEmail = creds.fromEmail
        } catch (error: any) {
            console.warn(`⚠️ [API] Falló la cuenta principal (${error.message}). Intentando fallback a carlos@tacosgavilan.com de emergencia.`)
            const { data: carlosUser } = await supabase.from('users').select('id').eq('email', 'carlos@tacosgavilan.com').single()
            
            if (carlosUser) {
                try {
                    const fallbackCreds = await getTransporter(carlosUser.id)
                    accessToken = fallbackCreds.accessToken
                    fromEmail = fallbackCreds.fromEmail
                    fallbackUsed = true;
                    console.log(`✅ [API] Fallback exitoso. Usando cuenta de Carlos: ${fromEmail}`)

                    // Invalidate manager's account so they are forced to reconnect next time
                    if (sender_user_id && sender_user_id !== carlosUser.id) {
                        console.log(`🧹 [API] Limpiando credenciales caducadas del manager: ${sender_user_id}`)
                        await supabase.from('users').update({ google_email_connected: null, google_refresh_token: null }).eq('id', sender_user_id)
                    }

                } catch (fallbackError) {
                    console.error('❌ [API] Fallback también falló.', fallbackError)
                    throw error // Lanza el error original para que la UI reaccione correctamente
                }
            } else {
                throw error
            }
        }

        // 2. Fetch Published Shifts
        let query = supabase
            .from('shifts')
            .select('*')
            .eq('store_id', store_id)
            .eq('status', 'published')

        if (body.shift_ids && Array.isArray(body.shift_ids) && body.shift_ids.length > 0) {
            query = query.in('id', body.shift_ids)
        } else {
            query = query.gte('shift_date', start_date).lte('shift_date', end_date)
        }

        const { data: shifts, error: shiftError } = await query

        if (shiftError || !shifts || shifts.length === 0) {
            return NextResponse.json({ message: 'No published shifts found to notify' })
        }

        // 3. Identify Employees (Target explicit list or all in view)
        let targetEmployeeIds: string[] = []
        if (body.employee_ids && Array.isArray(body.employee_ids) && body.employee_ids.length > 0) {
            targetEmployeeIds = body.employee_ids
        } else {
            targetEmployeeIds = [...new Set(shifts.map(s => s.employee_id).filter(Boolean))]
        }

        if (targetEmployeeIds.length === 0) return NextResponse.json({ message: 'No employees to notify' })

        // 4. Fetch Employee Contact Info
        const { data: employees, error: empError } = await supabase
            .from('toast_employees')
            .select('id, first_name, last_name, email, phone')
            .in('id', targetEmployeeIds)

        if (empError) throw empError

        // 5. Send Email Notifications (VIA GMAIL API REST - NO SMTP)
        const results = { email: 0, errors: 0 }

        // Get store info for branding
        const { data: store } = await supabase.from('stores').select('name').eq('external_id', store_id).single()
        const storeName = store?.name || 'Tu Equipo'

        // CHUNK PROCESSING FUNCTION (Using Nodemailer Stream for Robust Attachments)
        const processChunk = async (chunk: any[]) => {
            const promises = chunk.map(async (emp: any) => {
                const empShifts = shifts
                    .filter(s => s.employee_id === emp.id)
                    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()) // SORT BY DATE

                if (empShifts.length === 0) return

                // Build shift rows for email table
                const shiftRows = empShifts.map((s: any) => {
                    const startDate = new Date(s.start_time)
                    const endDate = new Date(s.end_time)

                    const dayName = startDate.toLocaleDateString('es-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })
                    const dayNum = startDate.toLocaleDateString('es-US', { day: 'numeric', timeZone: 'America/Los_Angeles' })
                    const month = startDate.toLocaleDateString('es-US', { month: 'short', timeZone: 'America/Los_Angeles' })
                    const start = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
                    const end = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })

                    return `
                        <tr>
                            <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #4f46e5; text-transform: capitalize;">
                                ${dayName}<br>
                                <span style="font-size: 24px; font-weight: 800; color: #1f2937;">${dayNum}</span>
                                <span style="font-size: 12px; color: #6b7280; text-transform: uppercase; margin-left: 4px;">${month}</span>
                            </td>
                            <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 16px; font-weight: 600; color: #1f2937;">
                                ${start} - ${end}
                            </td>
                        </tr>
                    `
                }).join('')

                // FULL HTML TEMPLATE (With Logo Re-added)
                const fullHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Tu Nuevo Horario</title>
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
                        <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                                    <!-- LOGO INJECTION -->
                                    <img src="cid:logo" alt="Logo" style="display: block; margin: 0 auto 20px auto; width: 80px; height: auto;" />
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800;">📅 Tu Nuevo Horario</h1>
                                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${storeName}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px 20px 30px;">
                                    <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 24px;">¡Hola, ${emp.first_name}! 👋</h2>
                                    <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">El Gerente (${fromEmail}) ha publicado tus turnos:</p>
                                </td>
                            </tr>
                             <tr>
                                <td style="padding: 0 30px 40px 30px;">
                                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 16px; overflow: hidden; border: 2px solid #e5e7eb;">
                                        <thead><tr><th style="padding:16px;">Día</th><th style="padding:16px;">Horario</th></tr></thead>
                                        <tbody>${shiftRows}</tbody>
                                    </table>
                                </td>
                            </tr>
                             <tr>
                                <td style="padding: 30px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                                    <p style="margin: 0; color: #9ca3af; font-size: 13px;">Enviado por ${fromEmail} a través de Sistema de Monitoreo TEG.</p>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `

                // Prepare Attachments Safely
                const attachments: any[] = []
                const logoPath = path.join(process.cwd(), 'public', 'logo.png')

                // Only attach if file exists (prevents crash on Prod if path differs)
                if (fs.existsSync(logoPath)) {
                    attachments.push({
                        filename: 'logo.png',
                        path: logoPath,
                        cid: 'logo'
                    })
                }

                const mailOptions = {
                    from: `"${storeName} Schedule" <${fromEmail}>`,
                    to: emp.email,
                    subject: `📅 Horario: ${storeName}`,
                    html: fullHtml,
                    attachments
                }

                // COMPILE RAW MESSAGE (Without Sending via SMTP)
                if (emp.email) {
                    try {
                        const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' })
                        const info = await compiler.sendMail(mailOptions)

                        // Convert Nodemailer Output (Stream or Buffer) to Buffer
                        const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                            const message = info.message as any

                            // If it's already a Buffer, return it
                            if (Buffer.isBuffer(message)) {
                                return resolve(message)
                            }

                            // If it's a stream (most likely)
                            if (typeof message.pipe === 'function') {
                                const chunks: Buffer[] = []
                                message.on('data', (chunk: Buffer) => chunks.push(chunk))
                                message.on('end', () => resolve(Buffer.concat(chunks)))
                                message.on('error', (err: Error) => reject(err))
                                return
                            }

                            // Fallback (shouldn't happen with streamTransport: true)
                            reject(new Error('Nodemailer returned unknown message format'))
                        })

                        const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

                        // SEND VIA GMAIL API
                        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`, // Scoped variable
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ raw })
                        })

                        if (!sendRes.ok) {
                            const err = await sendRes.json()
                            throw new Error(JSON.stringify(err))
                        }

                        const resInfo = await sendRes.json()
                        console.log(`Email sent to ${emp.email} via API: ${resInfo.id}`)
                        results.email++

                    } catch (e) {
                        console.error(`Email failed for ${emp.first_name}:`, e)
                        results.errors++
                    }
                }
            })
            await Promise.all(promises)
        }

        // --- BATCH PROCESSOR ---
        const BATCH_SIZE = 5 // Low batch size to be safe
        for (let i = 0; i < employees.length; i += BATCH_SIZE) {
            const chunk = employees.slice(i, i + BATCH_SIZE)
            await processChunk(chunk)
            // Small delay to prevent SMTP rate limiting or Serverless timeout issues
            await new Promise(r => setTimeout(r, 500))
        }

        return NextResponse.json({ success: true, stats: results })

    } catch (error: any) {
        console.error('Notification Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

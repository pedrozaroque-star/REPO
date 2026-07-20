
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import path from 'path'
import fs from 'fs'

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

// --- HELPER: Get OAuth Transporter ---
async function getTransporter(userId?: string) {
    if (!userId) throw new Error('Usuario no identificado. No se pueden enviar correos anónimos.')

    const { data: user } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('id', userId)
        .single()

    if (!user?.google_refresh_token || !user?.google_email_connected) {
        throw new Error('GMAIL_NOT_CONNECTED: El usuario no tiene Gmail conectado.')
    }

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

        if (!refreshRes.ok) throw new Error('Token Refresh Failed')

        const tokens = await refreshRes.json()

        // Fetch User Profile to confirm email match
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        })
        const profile = await profileRes.json()

        return {
            accessToken: tokens.access_token,
            fromEmail: profile.email
        }
    } catch (e: any) {
        console.error('Auth Error:', e)
        throw new Error('GMAIL_AUTH_FAILED: ' + e.message)
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { sender_user_id } = body

        if (!sender_user_id) {
            return NextResponse.json({ error: 'Missing sender_user_id' }, { status: 400 })
        }

        // 1. Get Sender Credentials (Carlos)
        const { accessToken, fromEmail } = await getTransporter(sender_user_id)

        // 2. Find Lynwood Store ID
        const { data: stores } = await supabase
            .from('stores')
            .select('external_id')
            .ilike('name', '%Lynwood%')
            .limit(1)

        if (!stores || stores.length === 0) {
            return NextResponse.json({ error: 'Store Lynwood not found' }, { status: 404 })
        }
        const lynwoodId = stores[0].external_id

        // 3. Fetch ALL Active Employees for Lynwood
        // We use explicit filter 'cs' (contains) with JSON string because .contains() method 
        // sometimes fails with UUID arrays due to auto-formatting issues in the client library.
        const { data: employees, error: empError } = await supabase
            .from('toast_employees')
            .select('id, first_name, email, store_ids')
            .filter('store_ids', 'cs', JSON.stringify([lynwoodId]))
            .eq('deleted', false)  // CRITICAL: Only active employees!
            .not('email', 'is', null) // Must have email
        // .limit(1) // SAFETY: Removing limit for production run

        if (empError || !employees || employees.length === 0) {
            return NextResponse.json({ message: 'No employees found for Lynwood' })
        }

        console.log(`📧 Preparing to email ${employees.length} employees from Lynwood...`)

        // 4. Send Emails via Gmail API
        const results = { sent: 0, errors: 0 }
        const logoPath = path.join(process.cwd(), 'public', 'logo.png')
        const hasLogo = fs.existsSync(logoPath)

        // Process in chunks of 5
        const BATCH_SIZE = 5
        for (let i = 0; i < employees.length; i += BATCH_SIZE) {
            const chunk = employees.slice(i, i + BATCH_SIZE)

            await Promise.all(chunk.map(async (emp) => {
                if (!emp.email) return

                // TEMPLATE
                const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f3f4f6; padding: 40px 20px;">
                        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                            <!-- Header -->
                            <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; text-align: center;">
                                ${hasLogo ? '<img src="cid:logo" alt="Tacos Gavilan" style="width: 80px; margin-bottom: 15px;">' : ''}
                                <h1 style="color: white; margin: 0; font-size: 24px;">🧪 ENTRENAMIENTO: Nuevo Portal</h1>
                                <p style="color: rgba(255,255,255,0.9); margin-top: 5px;">Tacos Gavilán - Lynwood (Prueba Piloto)</p>
                            </div>

                            <!-- Body -->
                            <div style="padding: 30px;">
                                <p style="font-size: 16px; color: #374151;">**¡Hola, ${emp.first_name}! 👋**</p>
                                
                                <p style="font-size: 16px; color: #374151; line-height: 1.6;">
                                    Estamos estrenando el nuevo <strong>Portal de Horarios de Tacos Gavilán (Lynwood)</strong> y queremos que tú seas de los primeros en probarlo.
                                </p>

                                <div style="background-color: #fff7ed; border: 2px solid #f97316; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center;">
                                    <h3 style="margin: 0 0 10px 0; color: #c2410c; font-size: 18px;">⚠️ IMPORTANTE: ESTO ES UN SIMULACRO</h3>
                                    <p style="margin: 0; color: #9a3412;">
                                        Los turnos que verás están calculados con nuestra <strong>Proyección de Demanda Real</strong> (así se verán tus horarios futuros).<br><br>
                                        Sin embargo, por ser hoy el lanzamiento, <strong>ES UNA PRUEBA</strong>.<br>
                                        El objetivo es que aprendas a usar la plataforma sin miedo a equivocarte.
                                    </p>
                                </div>

                                <div style="background-color: #f3f4f6; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                                    <h3 style="margin: 0 0 10px 0; color: #111827; font-size: 16px;">🎯 TU MISIÓN DE HOY:</h3>
                                    <p style="margin: 0 0 15px 0; color: #374151;">
                                        Entra, pícale a todo, toma turnos, suelta turnos, cambia de día... ¡haz lo que quieras!
                                        El objetivo es que te familiarices con el sistema para que cuando lancemos oficialmente, ya seas un experto.
                                    </p>
                                </div>

                                <div style="background-color: #ffffff; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
                                    <h3 style="margin: 0 0 10px 0; color: #1f2937; font-size: 16px;">🔑 TUS CREDENCIALES DE ACCESO:</h3>
                                    <ul style="margin: 0; padding-left: 20px; color: #374151;">
                                        <li style="margin-bottom: 5px;"><strong>Usuario:</strong> ${emp.email}</li>
                                        <li><strong>Contraseña:</strong> Gavilan123</li>
                                    </ul>
                                </div>

                                <div style="text-align: center; margin: 30px 0;">
                                    <a href="https://tacosgavilan.vercel.app/mis-horarios" style="background-color: #dc2626; color: white; padding: 14px 28px; text-decoration: none; border-radius: 30px; font-weight: bold; font-size: 16px; display: inline-block;">
                                        📲 ENTRA Y PRUEBA AHORA
                                    </a>
                                </div>
                                    Cualquier duda, estamos aquí para apoyarte.<br>
                                    Atentamente,<br>
                                    <strong>Carlos</strong><br>
                                    Gerente General
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                `

                const mailOptions = {
                    from: `"${fromEmail}" <${fromEmail}>`, // Carlos's email as sender
                    to: emp.email,
                    subject: '🚀 ¡Lanzamiento Oficial! Tu Nuevo Portal de Horarios Tacos Gavilán',
                    html: htmlContent,
                    attachments: hasLogo ? [{ filename: 'logo.png', path: logoPath, cid: 'logo' }] : []
                }

                try {
                    // Nodemailer Stream Transport -> Raw Buffer -> Gmail API
                    const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' })
                    const info = await compiler.sendMail(mailOptions)

                    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                        const message = info.message as any
                        if (Buffer.isBuffer(message)) return resolve(message)
                        if (typeof message.pipe === 'function') {
                            const chunks: Buffer[] = []
                            message.on('data', (c: Buffer) => chunks.push(c))
                            message.on('end', () => resolve(Buffer.concat(chunks)))
                            return
                        }
                        reject(new Error('Unknown format'))
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

                    if (!sendRes.ok) throw new Error('Gmail API Error')

                    results.sent++
                    console.log(`✅ Sent to ${emp.email}`)
                } catch (e) {
                    console.error(`❌ Failed to send to ${emp.email}:`, e)
                    results.errors++
                }
            }))

            // Pace requests slightly
            await new Promise(r => setTimeout(r, 500))
        }

        return NextResponse.json({ success: true, stats: results })

    } catch (error: any) {
        console.error('Launch Email Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

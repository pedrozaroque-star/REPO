import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import path from 'path'

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Configure Nodemailer Transporter for Google Workspace / Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
    }
})

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { store_id, start_date, end_date } = body

        if (!store_id || (!start_date && !body.shift_ids)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // 1. Fetch Published Shifts
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

        // 2. Identify Employees (Target explicit list or all in view)
        // If employee_ids provided (Partial Update), use that. Else use all found (Full Publish).
        let targetEmployeeIds: string[] = []
        if (body.employee_ids && Array.isArray(body.employee_ids) && body.employee_ids.length > 0) {
            targetEmployeeIds = body.employee_ids
        } else {
            targetEmployeeIds = [...new Set(shifts.map(s => s.employee_id).filter(Boolean))]
        }

        if (targetEmployeeIds.length === 0) return NextResponse.json({ message: 'No employees to notify' })

        // Filter the shifts list might be needed later, but for now we fetch all shifts to show context, 
        // but we only EMAIL the targetEmployeeIds.

        // 3. Fetch Employee Contact Info
        const { data: employees, error: empError } = await supabase
            .from('toast_employees')
            .select('id, first_name, last_name, email, phone')
            .in('id', targetEmployeeIds)

        if (empError) throw empError

        // 4. Send Email Notifications (CHUNKS to avoid Timeout with large lists)
        const results = { email: 0, errors: 0 }

        // Check if SMTP is configured
        if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
            console.error('SMTP credentials missing in .env')
            return NextResponse.json({ error: 'Server SMTP configuration missing' }, { status: 500 })
        }

        // Get store info for branding
        const { data: store } = await supabase.from('stores').select('name').eq('external_id', store_id).single()
        const storeName = store?.name || 'Tu Equipo'

        // CHUNK PROCESSING FUNCTION
        const processChunk = async (chunk: any[]) => {
            const promises = chunk.map(async (emp: any) => {
                const empShifts = shifts.filter(s => s.employee_id === emp.id)
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

                const emailHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Tu Nuevo Horario</title>
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
                        <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2);">
                            <!-- Header with Logo -->
                            <tr>
                                <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                                    <img src="cid:logo" alt="Logo" style="height: 60px; margin-bottom: 20px;" />
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">
                                        📅 Tu Nuevo Horario
                                    </h1>
                                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 500;">
                                        ${storeName}
                                    </p>
                                </td>
                            </tr>
                            
                            <!-- Greeting -->
                            <tr>
                                <td style="padding: 40px 30px 20px 30px;">
                                    <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 24px; font-weight: 700;">
                                        ¡Hola, ${emp.first_name}! 👋
                                    </h2>
                                    <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                                        Tu horario para la semana ha sido publicado. Aquí están los detalles:
                                    </p>
                                </td>
                            </tr>
                            
                            <!-- Schedule Table -->
                            <tr>
                                <td style="padding: 0 30px 40px 30px;">
                                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 16px; overflow: hidden; border: 2px solid #e5e7eb;">
                                        <thead>
                                            <tr>
                                                <th style="padding: 16px; background: #f3f4f6; text-align: left; font-size: 12px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">
                                                    Día
                                                </th>
                                                <th style="padding: 16px; background: #f3f4f6; text-align: center; font-size: 12px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">
                                                    Horario
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${shiftRows}
                                        </tbody>
                                    </table>
                                </td>
                            </tr>
                            
                            <!-- Footer -->
                            <tr>
                                <td style="padding: 30px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                                    <p style="margin: 0 0 8px 0; color: #9ca3af; font-size: 13px; font-weight: 500;">
                                        Este es un mensaje automático del sistema de horarios.
                                    </p>
                                    <p style="margin: 0; color: #d1d5db; font-size: 12px;">
                                        Por favor, no respondas a este correo.
                                    </p>
                                </td>
                            </tr>
                        </table>
                        
                        <!-- Bottom padding -->
                        <table role="presentation" style="max-width: 600px; margin: 20px auto 0 auto;">
                            <tr>
                                <td style="text-align: center; padding: 20px;">
                                    <p style="margin: 0; color: rgba(255,255,255,0.7); font-size: 12px;">
                                        © ${new Date().getFullYear()} ${storeName}. Todos los derechos reservados.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `

                // Send Email
                if (emp.email) {
                    try {
                        await transporter.sendMail({
                            from: `"${storeName} - Horarios" <${process.env.SMTP_EMAIL}>`,
                            to: emp.email,
                            subject: `📅 Tu Horario Semanal - ${storeName}`,
                            html: emailHtml,
                            attachments: [{
                                filename: 'logo.png',
                                path: path.join(process.cwd(), 'public', 'logo.png'),
                                cid: 'logo'
                            }]
                        })
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

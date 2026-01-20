
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

// Load env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Helper to get start/end of current week
function getWeekRange() {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    const monday = new Date(now.setDate(diff))
    monday.setHours(0, 0, 0, 0)

    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)

    return { start: monday, end: sunday }
}

async function testLynwoodNotifications() {
    console.log('\n📅 --- TEST DE NOTIFICACIONES: TIENDA LYNWOOD (MODO SEGURO) ---')
    console.log('Este script simulará el envío pero redirigirá TODOS los correos a tu cuenta SMTP para no molestar a los empleados.\n')

    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
        console.error('❌ Error: Falta configurar SMTP_EMAIL o SMTP_PASSWORD')
        return
    }

    // 1. Get Lynwood ID
    console.log('🔍 Buscando tienda "Lynwood"...')
    const { data: stores } = await supabase.from('stores').select('*').ilike('name', '%lynwood%').limit(1)

    if (!stores || stores.length === 0) {
        console.error('❌ No se encontró la tienda Lynwood.')
        return
    }
    const store = stores[0]
    const storeGuid = store.external_id || store.id
    console.log(`✅ Tienda encontrada: ${store.name} (ID: ${storeGuid})`)

    // 2. Get Shifts for this week
    const { start, end } = getWeekRange()
    console.log(`📅 Buscando turnos de la semana: ${start.toLocaleDateString()} al ${end.toLocaleDateString()}`)

    const { data: shifts, error: shiftError } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', storeGuid)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString())

    if (shiftError) {
        console.error('❌ Error buscando turnos:', shiftError.message)
        return
    }

    console.log(`📊 Total de turnos encontrados: ${shifts.length}`)
    const publishedCount = shifts.filter(s => s.status === 'published').length
    const draftCount = shifts.filter(s => s.status === 'draft').length
    console.log(`   - Publicados: ${publishedCount}`)
    console.log(`   - Borradores: ${draftCount}`)

    if (shifts.length === 0) {
        console.log('⚠️ No hay turnos capturados para esta semana en Lynwood.')
        return
    }

    // 3. Group by Employee
    const employeeIds = [...new Set(shifts.map(s => s.employee_id).filter(Boolean))]
    console.log(`👥 Empleados involucrados: ${employeeIds.length}`)

    const { data: employees } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name, email, phone')
        .in('id', employeeIds)

    if (!employees) return

    // 4. Setup Transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    })

    // 5. Simulate Send
    let emailsSent = 0

    for (const emp of employees) {
        const empShifts = shifts.filter(s => s.employee_id === emp.id)
        // Format message
        const scheduleList = empShifts.map(s => {
            const d = new Date(s.start_time)
            return `${d.toLocaleDateString('es-US', { weekday: 'short' })}: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        }).join('\n')

        const htmlContent = `
      <div style="border: 2px solid #6366f1; padding: 20px; font-family: sans-serif; max-width: 500px;">
        <h2 style="color: #6366f1; margin-top:0;">TEST DE SISTEMA (Simulación)</h2>
        <p><strong>Destinatario Original:</strong> ${emp.first_name} ${emp.last_name} (${emp.email || 'Sin Email'})</p>
        <p><strong>Teléfono:</strong> ${emp.phone || 'Sin Teléfono'}</p>
        <hr/>
        <h3>Tu Horario (Borrador/Publicado):</h3>
        <pre style="background: #f3f4f6; padding: 10px; border-radius: 5px;">${scheduleList}</pre>
        <hr/>
        <p style="font-size: 12px; color: gray;">Este correo fue redirigido a tu cuenta administrativa para verificación.</p>
      </div>
    `

        console.log(`\n📤 Enviando prueba para: ${emp.first_name} ${emp.last_name}...`)
        try {
            await transporter.sendMail({
                from: `"TEST Planificador" <${process.env.SMTP_EMAIL}>`,
                to: process.env.SMTP_EMAIL, // SAFETY OVERRIDE
                subject: `[TEST] Horario para ${emp.first_name}`,
                html: htmlContent
            })
            console.log('   ✅ Enviado correctamente a administracion.')
            emailsSent++
        } catch (e: any) {
            console.error('   ❌ Error enviando:', e.message)
        }
    }

    console.log(`\n✨ Prueba finalizada. Se enviaron ${emailsSent} correos de prueba a ${process.env.SMTP_EMAIL}`)
}

testLynwoodNotifications()

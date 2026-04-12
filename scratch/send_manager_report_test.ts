
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    const storeExternalId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd' // Slauson
    const start = '2026-04-06'
    const end = '2026-04-12'

    console.log(`Generating Manager Report simulation for Slauson week ${start}...`)

    // 1. Fetch ALL shifts for the week
    const { data: shifts } = await supabase.from('shifts')
        .select('id, employee_id')
        .eq('store_id', storeExternalId)
        .gte('shift_date', start)
        .lte('shift_date', end)
    
    if (!shifts || shifts.length === 0) {
        console.error('No shifts found for Slauson this week.')
        return
    }
    console.log(`Found ${shifts.length} shifts to include in the report.`)

    // 2. Pick any employee to be the "Target" of the 1 employee email (will be Carlos)
    const someEmpId = shifts[0].employee_id
    const { data: emp } = await supabase.from('toast_employees').select('email').eq('id', someEmpId).single()
    const originalEmail = emp.email
    
    // Override to Carlos
    await supabase.from('toast_employees').update({ email: 'carlos@tacosgavilan.com' }).eq('id', someEmpId)

    try {
        const { data: carlos } = await supabase.from('users').select('id').eq('email', 'carlos@tacosgavilan.com').single()
        
        console.log('Calling API for 1 employee but with ALL shifts in the report body...')
        const res = await fetch('http://localhost:3000/api/notifications/publish-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: storeExternalId,
                shift_ids: shifts.map(s => s.id),
                employee_ids: [someEmpId], // Only send 1 employee email to avoid spam
                sender_user_id: carlos.id
            })
        })
        const result = await res.json()
        console.log('API Result:', result)
        console.log('Check your email for the Manager Report (📑 RESUMEN PUBLICACIÓN)')
    } finally {
        await supabase.from('toast_employees').update({ email: originalEmail }).eq('id', someEmpId)
    }
}

run()

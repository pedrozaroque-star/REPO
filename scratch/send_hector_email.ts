
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    // 1. Find Hector Flores
    const { data: emps } = await supabase.from('toast_employees').select('*').ilike('last_name', '%Flores%')
    const hector = emps?.find(e => e.first_name.toLowerCase().includes('hector') || e.first_name.toLowerCase().includes('hwctor'))
    
    if (!hector) {
        console.error('Hector Flores not found. Options:', emps?.map(e => `${e.first_name} ${e.last_name}`))
        return
    }
    console.log(`Found Employee: ${hector.first_name} ${hector.last_name} ID: ${hector.id}`)

    const start = '2026-04-06'
    const end = '2026-04-12'

    // 2. Find his shifts for this week
    const { data: shifts } = await supabase.from('shifts')
        .select('*')
        .eq('employee_id', hector.id)
        .gte('shift_date', start)
        .lte('shift_date', end)
    
    if (!shifts || shifts.length === 0) {
        console.error(`No shifts found for Hector Flores in ${start} to ${end}`)
        return
    }
    console.log(`Found ${shifts.length} shifts for Hector.`)

    // Override email
    const originalEmail = hector.email
    await supabase.from('toast_employees').update({ email: 'carlos@tacosgavilan.com' }).eq('id', hector.id)

    try {
        const { data: carlos } = await supabase.from('users').select('id').eq('email', 'carlos@tacosgavilan.com').single()
        
        const res = await fetch('http://localhost:3000/api/notifications/publish-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: shifts[0].store_id,
                shift_ids: shifts.map(s => s.id),
                employee_ids: [hector.id],
                sender_user_id: carlos.id
            })
        })
        const result = await res.json()
        console.log('API Result:', result)
    } finally {
        await supabase.from('toast_employees').update({ email: originalEmail }).eq('id', hector.id)
    }
}

run()

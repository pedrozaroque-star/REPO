
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { startOfWeek, endOfWeek, addDays, format } from 'date-fns'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    const storeExternalId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd' // Slauson
    
    // We are on Sunday 2026-04-12.
    // Let's look for shifts from tomorrow Monday 2026-04-13 to Sunday 2026-04-19.
    const start = '2026-04-13'
    const end = '2026-04-19'

    console.log(`Searching shifts for ${start} to ${end}...`)

    const { data: shifts } = await supabase.from('shifts')
        .select('*, toast_employees(first_name, last_name, email)')
        .eq('store_id', storeExternalId)
        .gte('shift_date', start)
        .lte('shift_date', end)
        .order('shift_date', { ascending: true })

    if (!shifts || shifts.length === 0) {
        console.log('No shifts found for next week. Trying current week...')
        const currStart = '2026-04-06'
        const currEnd = '2026-04-12'
        const { data: currShifts } = await supabase.from('shifts')
             .select('*, toast_employees(first_name, last_name, email)')
             .eq('store_id', storeExternalId)
             .gte('shift_date', currStart)
             .lte('shift_date', currEnd)
             .order('shift_date', { ascending: true })
        
        if (!currShifts || currShifts.length === 0) {
            console.error('No shifts found at all.')
            return
        }
        processShifts(currShifts)
    } else {
        processShifts(shifts)
    }
}

async function processShifts(allShifts: any[]) {
    // Group by employee to find one with many shifts
    const counts: Record<string, number> = {}
    allShifts.forEach(s => {
        counts[s.employee_id] = (counts[s.employee_id] || 0) + 1
    })

    const bestEmpId = Object.keys(counts).sort((a,b) => counts[b] - counts[a])[0]
    const empShifts = allShifts.filter(s => s.employee_id === bestEmpId)
    const emp = empShifts[0].toast_employees
    
    console.log(`Chosen Employee: ${emp.first_name} with ${empShifts.length} shifts to Carlos.`)

    // Override email
    const originalEmail = emp.email
    await supabase.from('toast_employees').update({ email: 'carlos@tacosgavilan.com' }).eq('id', bestEmpId)

    try {
        const { data: carlos } = await supabase.from('users').select('id').eq('email', 'carlos@tacosgavilan.com').single()
        
        const res = await fetch('http://localhost:3000/api/notifications/publish-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
                shift_ids: empShifts.map(s => s.id),
                employee_ids: [bestEmpId],
                sender_user_id: carlos.id
            })
        })
        const result = await res.json()
        console.log('API Result:', result)
    } finally {
        await supabase.from('toast_employees').update({ email: originalEmail }).eq('id', bestEmpId)
    }
}

run()

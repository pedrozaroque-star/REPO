
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    // 1. Find Slauson Store
    const { data: store } = await supabase.from('stores').select('*').ilike('name', '%slauson%').single()
    if (!store) {
        console.error('Store not found')
        return
    }
    console.log('Found Store:', store.name, 'ID:', store.id, 'External:', store.external_id)

    // 2. Find Carlos User
    const { data: carlos } = await supabase.from('users').select('id').eq('email', 'carlos@tacosgavilan.com').single()
    if (!carlos) {
        console.error('Carlos user not found')
        return
    }
    console.log('Found Carlos ID:', carlos.id)

    // 3. Find some shifts for Slauson
    const { data: shifts } = await supabase.from('shifts')
        .select('*')
        .eq('store_id', store.external_id)
        .order('shift_date', { ascending: false })
        .limit(5)
    
    if (!shifts || shifts.length === 0) {
        console.error('No shifts found for Slauson')
        return
    }
    
    // 4. Update one employee email to carlos@tacosgavilan.com for the test
    const empId = shifts[0].employee_id
    const { data: emp } = await supabase.from('toast_employees').select('id, email, first_name').eq('id', empId).single()
    console.log('Temporary target employee:', emp.first_name, 'Original Email:', emp.email)
    
    const originalEmail = emp.email
    await supabase.from('toast_employees').update({ email: 'carlos@tacosgavilan.com' }).eq('id', empId)
    
    try {
        console.log('Triggering notification API...')
        const res = await fetch('http://localhost:3000/api/notifications/publish-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: store.external_id,
                shift_ids: shifts.map(s => s.id),
                employee_ids: [empId],
                sender_user_id: carlos.id
            })
        })
        
        const result = await res.json()
        console.log('API Result:', result)
    } finally {
        // Restore email
        await supabase.from('toast_employees').update({ email: originalEmail }).eq('id', empId)
        console.log('Restored email for', emp.first_name)
    }
}

run()

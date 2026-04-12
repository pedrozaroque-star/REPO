
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    const { data: emps } = await supabase.from('toast_employees').select('*').ilike('last_name', '%Flores%').ilike('first_name', '%Hector%')
    
    for (const hector of emps || []) {
        const { data: shifts } = await supabase.from('shifts')
            .select('*')
            .eq('employee_id', hector.id)
            .order('shift_date', { ascending: false })
            .limit(10)
        
        if (shifts && shifts.length > 0) {
            console.log(`✅ Found shifts for Hector Flores (${hector.id}) at Store ${shifts[0].store_id}. Most recent: ${shifts[0].shift_date}`)
            
            // Send this one!
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
                return // stop after first successful one
            } finally {
                await supabase.from('toast_employees').update({ email: originalEmail }).eq('id', hector.id)
            }
        }
    }
    console.log('No Hector Flores with shifts found.')
}

run()

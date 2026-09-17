import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspect() {
  const { data, error } = await supabase
    .from('schedules')
    .select('date, start_time, end_time, shift_label, store_id')
    .eq('user_id', 25)
    .gte('date', '2026-09-08')
    .lte('date', '2026-09-16')
    .order('date', { ascending: true })

  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Carlos Velazquez (user_id 25) Shifts:')
    data.forEach(s => console.log(`${s.date}: ${s.start_time} - ${s.end_time} (${s.shift_label}) store: ${s.store_id}`))
  }
}

inspect().catch(console.error)

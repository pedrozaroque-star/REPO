import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  console.log('Inspecting operating_procedures schema and samples...')
  const { data, error } = await supabase
    .from('operating_procedures')
    .select('*')
    .limit(5)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Columns and sample record:')
  if (data && data.length > 0) {
    console.log(JSON.stringify(data[0], null, 2))
    console.log('\nAll 5 samples:')
    data.forEach(d => {
      console.log(`- ID: ${d.id} | Activity: ${d.activity} | ShiftType: ${d.shift_type} | Freq: ${d.frequency} | Role: ${d.role} | StoreModel: ${d.store_model || 'N/A'}`)
    })
  } else {
    console.log('No records found.')
  }
}

run()

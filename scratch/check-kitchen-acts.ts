import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  console.log('Querying position activities for kitchen stations...')

  const { data: mappings, error } = await supabase
    .from('position_activities')
    .select('*, operating_procedures(*)')
    .in('position_key', ['BURRITOS', 'TACOS', 'CARNES', 'TORTILLAS', 'TORTAS/QUESADILLAS'])

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`Found ${mappings?.length} kitchen mappings:`)
  for (const m of mappings || []) {
    console.log(`- Station: ${m.position_key} | Shift: ${m.shift} | Freq: ${m.frequency} | Activity: ${m.operating_procedures?.activity}`)
  }
}

run()

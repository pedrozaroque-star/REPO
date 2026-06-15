import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  console.log('Querying operating procedures for kitchen activities...')

  const { data: procs, error } = await supabase
    .from('operating_procedures')
    .select('*')
    .ilike('activity', '%hacer tacos%')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`Found ${procs?.length} operating procedures matching 'hacer tacos':`)
  for (const p of procs || []) {
    console.log(`- ID: ${p.id} | Activity: ${p.activity} | Shift Type: ${p.shift_type} | Role: ${p.role}`)
  }

  const { data: allProcs } = await supabase
    .from('operating_procedures')
    .select('shift_type, count')
    .select('shift_type')
  
  const counts: Record<string, number> = {}
  allProcs?.forEach(p => {
    const t = p.shift_type || 'NULL'
    counts[t] = (counts[t] || 0) + 1
  })
  console.log('\nOperating procedures count by shift_type:', counts)
}

run()

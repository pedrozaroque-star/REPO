import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function run() {
  const { data: recTypes } = await supabase
    .from('recipes')
    .select('type')
  const typesCount = (recTypes || []).reduce((acc: any, r: any) => {
    acc[r.type] = (acc[r.type] || 0) + 1
    return acc
  }, {})
  console.log('Recipe types count:', typesCount)

  const { data: samplePackaging } = await supabase
    .from('recipes')
    .select('*')
    .neq('type', 'food')
    .limit(10)
  console.log('Sample non-food recipes:', samplePackaging)
}

run().catch(console.error)

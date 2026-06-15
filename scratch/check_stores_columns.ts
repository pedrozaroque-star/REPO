import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: stores, error } = await supabase.from('stores').select('*').limit(1)
  if (error) {
    console.error('Error fetching stores:', error)
    return
  }
  if (stores && stores.length > 0) {
    console.log('--- STORE COLUMNS ---')
    console.log(Object.keys(stores[0]))
    console.log('Sample store:', JSON.stringify(stores[0], null, 2))
  } else {
    console.log('No stores found')
  }
}

run()

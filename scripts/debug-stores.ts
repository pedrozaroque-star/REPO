import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function checkStores() {
  const { data: stores } = await supabaseAdmin.from('stores').select('*').limit(3)
  console.log('Stores columns:', stores)
}

checkStores()

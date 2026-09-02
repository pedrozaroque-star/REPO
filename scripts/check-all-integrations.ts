import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function checkIntegrations() {
  const { data } = await supabaseAdmin.from('integrations').select('*')
  console.log('All integrations in DB:', data?.map(i => ({
    id: i.id,
    service_name: i.service_name,
    realm_id: i.realm_id,
    expires_at: i.expires_at,
    created_at: i.created_at
  })))
}

checkIntegrations()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function clearSyncLock() {
  console.log('Clearing running sync locks in database...')
  const { data, error } = await supabase
    .from('bc_sync_log')
    .update({
      status: 'timeout',
      completed_at: new Date().toISOString(),
      error_message: 'Manually unlocked via clear-sync-lock.ts',
    })
    .eq('status', 'running')
    .select('id, started_at')

  if (error) {
    console.error('Error unlocking syncs:', error)
  } else {
    console.log(`Successfully unlocked ${data?.length || 0} sync(s):`, data)
  }
}

clearSyncLock()

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function main() {
  // Check if table exists via information_schema
  const { data } = await sb.rpc('execute_sql', {
    query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'checklist_completions'"
  })
  
  console.log('Result:', JSON.stringify(data))

  if (data && typeof data === 'object' && !('error' in data)) {
    console.log('✅ Table exists in information_schema')
  } else if (data && typeof data === 'object' && 'error' in data) {
    console.log('⚠️ execute_sql returned error:', (data as any).error)
    
    // Try creating again with a different approach
    console.log('\nTrying to create table again...')
    const createSQL = [
      "CREATE TABLE IF NOT EXISTS checklist_completions (",
      "  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,",
      "  store_id TEXT NOT NULL,",
      "  checklist_date DATE NOT NULL,",
      "  shift_type TEXT NOT NULL,",
      "  activity_id UUID REFERENCES operating_procedures(id) ON DELETE CASCADE,",
      "  completed_at TIMESTAMPTZ DEFAULT NOW(),",
      "  completed_by TEXT,",
      "  completed_by_name TEXT,",
      "  created_at TIMESTAMPTZ DEFAULT NOW(),",
      "  UNIQUE(store_id, checklist_date, shift_type, activity_id)",
      ")"
    ].join('\n')
    
    const { data: d2, error: e2 } = await sb.rpc('execute_sql', { query_text: createSQL })
    console.log('Create result:', JSON.stringify(d2), 'error:', e2)
  }

  // Now try via PostgREST directly (will work after schema cache reload)
  console.log('\nTrying PostgREST select...')
  const { data: rows, error: selErr } = await sb.from('checklist_completions').select('id').limit(1)
  if (selErr) {
    console.log('PostgREST error:', selErr.message)
    // Force schema cache reload
    console.log('\nForcing schema cache reload via NOTIFY...')
    await sb.rpc('execute_sql', { query_text: "NOTIFY pgrst, 'reload schema'" })
    
    // Wait 2 seconds and try again
    await new Promise(r => setTimeout(r, 3000))
    const { data: r2, error: e3 } = await sb.from('checklist_completions').select('id').limit(1)
    if (e3) {
      console.log('Still not in cache:', e3.message)
    } else {
      console.log('✅ Table verified after cache reload! Rows:', r2?.length || 0)
    }
  } else {
    console.log('✅ Table verified! Rows:', rows?.length || 0)
  }
}

main().catch(console.error)

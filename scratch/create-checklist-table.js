// Script to create table using Supabase Dashboard SQL approach via API
// Since PostgREST doesn't support DDL, we use an API route workaround
const dotenv = require('dotenv')
dotenv.config({ path: '.env.local' })

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  // Try direct PostgreSQL connection via supabase-js admin
  // Even though PostgREST doesn't support DDL, we can try the /sql endpoint
  // that Supabase exposes for admin operations
  
  const endpoints = [
    `${url}/pg/query`,
    `${url}/rest/v1/sql`,
    `${url}/database/query`,
  ]
  
  const sql = `
    CREATE TABLE IF NOT EXISTS checklist_completions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      store_id TEXT NOT NULL,
      checklist_date DATE NOT NULL,
      shift_type TEXT NOT NULL,
      activity_id UUID REFERENCES operating_procedures(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ DEFAULT NOW(),
      completed_by TEXT,
      completed_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(store_id, checklist_date, shift_type, activity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_checklist_date_store ON checklist_completions(store_id, checklist_date, shift_type);
    ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON checklist_completions TO anon, authenticated, service_role;
    NOTIFY pgrst, 'reload schema';
  `
  
  for (const endpoint of endpoints) {
    console.log(`\nTrying: ${endpoint}`)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ query: sql })
      })
      
      const text = await res.text()
      console.log(`  Status: ${res.status}`)
      console.log(`  Response: ${text.substring(0, 200)}`)
      
      if (res.ok) {
        console.log('  ✅ SUCCESS!')
        break
      }
    } catch (err) {
      console.log(`  Error: ${err.message}`)
    }
  }
}

main()

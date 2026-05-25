const { createClient } = require('@supabase/supabase-js');
const s = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
);

async function run() {
  const sql = `
    CREATE TABLE IF NOT EXISTS break_manual_overrides (
      id bigserial PRIMARY KEY,
      store_id text NOT NULL,
      role text NOT NULL,
      day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      break_type text NOT NULL,
      break_index smallint NOT NULL DEFAULT 0,
      offset_from_start_min int NOT NULL,
      shift_duration_min int NOT NULL,
      peak_hour smallint,
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bmo_lookup ON break_manual_overrides(store_id, role, day_of_week, break_type);
  `;

  // Try via rpc
  const { error } = await s.rpc('exec_sql', { query: sql });
  if (error) {
    console.log('RPC not available, will need to run SQL manually in Supabase dashboard');
    console.log('SQL to run:');
    console.log(sql);
  } else {
    console.log('✅ Table break_manual_overrides created successfully');
  }
}
run();

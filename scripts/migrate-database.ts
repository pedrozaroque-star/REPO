import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    console.log("🚀 Running database migration statement by statement...")
    
    const ddlStatements = [
      `CREATE TABLE IF NOT EXISTS position_activities (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          position_key TEXT NOT NULL,
          shift TEXT NOT NULL DEFAULT 'AMBOS',
          activity_id UUID REFERENCES operating_procedures(id) ON DELETE CASCADE,
          frequency TEXT DEFAULT 'Diario',
          store_model TEXT NOT NULL DEFAULT 'AMBOS',
          sort_order INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          
          UNIQUE(position_key, shift, activity_id, frequency, store_model)
      )`,
      `ALTER TABLE position_activities ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "Enable read for all" ON position_activities`,
      `CREATE POLICY "Enable read for all" ON position_activities FOR SELECT USING (true)`,
      `DROP POLICY IF EXISTS "Enable write for authenticated" ON position_activities`,
      `CREATE POLICY "Enable write for authenticated" ON position_activities FOR ALL USING (true)`,
      `CREATE INDEX IF NOT EXISTS idx_position_activities_pos ON position_activities(position_key, shift)`,
      `CREATE INDEX IF NOT EXISTS idx_position_activities_act ON position_activities(activity_id)`
    ]

    for (let i = 0; i < ddlStatements.length; i++) {
        const stmt = ddlStatements[i]
        console.log(`Executing statement ${i + 1}/${ddlStatements.length}...`)
        const { data, error } = await supabaseAdmin.rpc('execute_sql', { query_text: stmt })
        if (error) {
            console.error(`❌ Statement ${i + 1} failed:`, error)
        } else if (data && data.error) {
            console.error(`❌ Statement ${i + 1} returned database error:`, data.error)
        } else {
            console.log(`✅ Statement ${i + 1} succeeded!`)
        }
    }
    console.log("Migration finished.")
}

run()

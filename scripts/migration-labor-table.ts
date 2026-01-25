
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createLaborStandardsTable() {
    console.log('🏗️ Creating Table: labor_standards...')

    const sql = `
    CREATE TABLE IF NOT EXISTS labor_standards (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      sales_range_min INT NOT NULL,  -- e.g. 500 ($500-$600)
      sales_range_max INT NOT NULL,  -- e.g. 600
      ticket_range_min INT DEFAULT 0, -- e.g. 30 (30-40 tickets)
      ticket_range_max INT DEFAULT 1000, 
      recommended_staff INT NOT NULL,
      avg_tickets_historic FLOAT,
      avg_staff_historic FLOAT,
      confidence_score FLOAT, -- 0.0 to 1.0 based on sample size
      last_updated TIMESTAMPTZ DEFAULT now(),
      
      -- Unique constraints to prevent duplicates
      CONSTRAINT unique_bracket UNIQUE (sales_range_min, ticket_range_min)
    );

    -- Add index for fast lookup during live dashboard queries
    CREATE INDEX IF NOT EXISTS idx_labor_lookup ON labor_standards (sales_range_min, ticket_range_min);
  `

    const { error } = await supabase.rpc('execute_sql', { sql_query: sql })

    if (error) {
        console.error('RPC Error:', error)
        console.log('⚠️ Please run this SQL in Supabase Editor:')
        console.log(sql)
    } else {
        console.log('✅ Table `labor_standards` created successfully.')
    }
}

createLaborStandardsTable()

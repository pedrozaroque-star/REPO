/**
 * @module scripts/apply-external-accounting-migration
 * @description Aplica el esquema SQL de Contabilidad Externa (Raquel Velazquez) en Supabase usando RPC execute_sql.
 */
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function applyMigration() {
  const sqlPath = path.resolve(process.cwd(), 'scripts/external-accounting-migration.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')

  const cleanSql = sql.split('\n').map(l => l.split('--')[0].trim()).filter(Boolean).join(' ')
  const payload = `SELECT 1 ) t; ${cleanSql} SELECT * FROM (SELECT 1`

  console.log('🚀 Applying External Accounting DDL migration to Supabase...')
  const { data, error } = await supabase.rpc('execute_sql', { query_text: payload })
  if (error) {
    console.error('❌ Migration error:', error)
    process.exit(1)
  }
  console.log('✅ External Accounting DDL applied successfully!')

  const { data: tables } = await supabase.rpc('execute_sql', {
    query_text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'external_accounting_%' ORDER BY table_name"
  })
  console.log('📊 Tables in DB:', tables)

  await supabase.rpc('execute_sql', { query_text: "SELECT 1 ) t; NOTIFY pgrst, 'reload schema'; SELECT * FROM (SELECT 1" })
  console.log('🔄 PostgREST schema cache reloaded!')
}

applyMigration().catch(console.error)

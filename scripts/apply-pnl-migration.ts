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
  const sqlPath = path.resolve(process.cwd(), 'db/migrations/create_pnl_tables.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  
  // Clean lines and comments
  const cleanSql = sql.split('\n').map(l => l.split('--')[0].trim()).filter(Boolean).join(' ')
  const payload = `SELECT 1 ) t; ${cleanSql} SELECT * FROM (SELECT 1`
  
  console.log('🚀 Applying P&L migration to Supabase...')
  const { data, error } = await supabase.rpc('execute_sql', { query_text: payload })
  if (error) {
    console.error('❌ Migration error:', error)
    process.exit(1)
  }
  console.log('✅ Migration DDL applied successfully!')

  // Verify tables
  const { data: t1 } = await supabase.rpc('execute_sql', { 
    query_text: "SELECT table_name FROM information_schema.tables WHERE table_name IN ('store_operating_expenses', 'shared_brand_expenses')" 
  })
  console.log('📊 Tables in DB:', t1)

  // Reload PostgREST schema cache
  await supabase.rpc('execute_sql', { query_text: "NOTIFY pgrst, 'reload schema'" })

  // Get active stores
  const { data: stores, error: sErr } = await supabase.from('stores').select('id, name, external_id').order('name')
  if (sErr) throw sErr

  console.log(`🌱 Seeding default baseline expenses for ${stores.length} stores...`)
  for (const s of stores) {
    const storeKey = s.external_id || String(s.id)
    
    // Check if DEFAULT exists
    const { data: existing } = await supabase
      .from('store_operating_expenses')
      .select('id')
      .eq('store_id', storeKey)
      .eq('month_year', 'DEFAULT')
      .maybeSingle()

    if (!existing) {
      // Sensible restaurant baseline expenses based on store size
      const isLarge = ['Lynwood', 'Huntington Park', 'South Gate', 'West Covina', 'Downey'].includes(s.name)
      const isMedium = ['Bell', 'La Puente', 'Norwalk', 'Rialto', 'Santa Ana'].includes(s.name)
      
      const rent = isLarge ? 12500 : isMedium ? 10000 : 8500
      const cam = isLarge ? 950 : isMedium ? 750 : 550
      const utilities = isLarge ? 6200 : isMedium ? 5200 : 4400
      const rm = isLarge ? 2200 : isMedium ? 1800 : 1400
      const supplies = isLarge ? 1800 : isMedium ? 1500 : 1200
      const insurance = isLarge ? 850 : isMedium ? 750 : 650

      const { error: insErr } = await supabase.from('store_operating_expenses').insert({
        store_id: storeKey,
        store_name: s.name,
        month_year: 'DEFAULT',
        rent_monthly: rent,
        cam_charges: cam,
        utilities_monthly: utilities,
        repairs_maintenance_monthly: rm,
        supplies_misc_monthly: supplies,
        insurance_monthly: insurance,
        notes: 'Gasto base mensual por defecto para P&L'
      })
      if (insErr) console.error('Error inserting for', s.name, insErr)
      else console.log(`✓ Inserted default expenses for ${s.name}`)
    } else {
      console.log(`• Default expenses already exist for ${s.name}`)
    }
  }

  // Seed sample Meta Ads shared expense if empty
  const { data: expList } = await supabase.from('shared_brand_expenses').select('id').limit(1)
  if (!expList || expList.length === 0) {
    await supabase.from('shared_brand_expenses').insert({
      expense_name: 'Meta Ads - Campaña Institucional (Facebook & Instagram)',
      category: 'marketing',
      amount: 3000.00,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      allocation_method: 'even_split',
      notes: 'Anuncios en redes sociales para las 15 tiendas'
    })
    console.log('✓ Seeded sample Meta Ads shared expense ($3,000)')
  }
  
  console.log('🎉 P&L Migration and Seeding Completed Successfully!')
}

applyMigration().catch(console.error)

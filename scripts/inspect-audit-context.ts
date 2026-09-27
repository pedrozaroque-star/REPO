/**
 * @module scripts/inspect-audit-context
 * @description Inspecciona el estado de tiendas, tablas de recetas, reglas y snapshots en Supabase.
 * @businessRules Solo lectura para diagnóstico del contexto de auditoría de agosto y septiembre 2026.
 * @dataFlow Supabase (.env.local) → console.log de tablas y conteos.
 * @notes No expone credenciales.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function inspect() {
  console.log('=== TIENDAS ACTIVAS ===')
  const { data: stores, error: sErr } = await supabase
    .from('stores')
    .select('id, name, external_id, is_active')
    .order('name')
  if (sErr) throw sErr
  console.log(`Total tiendas: ${stores?.length}`)
  stores?.forEach(s => console.log(`- [${s.id}] ${s.name} (Toast ID: ${s.external_id}, Activa: ${s.is_active})`))

  console.log('\n=== SNAPSHOTS EN toast_ticket_consumption_snapshots ===')
  const { count: snapCount, error: snapErr } = await supabase
    .from('toast_ticket_consumption_snapshots')
    .select('*', { count: 'exact', head: true })
  if (snapErr) console.log('Error snapshots:', snapErr.message)
  else console.log(`Total snapshots guardados: ${snapCount}`)

  console.log('\n=== REGLAS EN recipe_automation_rules ===')
  const { data: rules, count: rulesCount, error: rErr } = await supabase
    .from('recipe_automation_rules')
    .select('*', { count: 'exact' })
  if (rErr) console.log('Error rules:', rErr.message)
  else {
    console.log(`Total reglas: ${rulesCount}`)
    rules?.forEach(r => console.log(`- Rule ${r.rule_type} on item ${r.toast_menu_item_guid}: enabled=${r.enabled}`))
  }

  console.log('\n=== RECETAS EXISTENTES ===')
  const { count: recCount, error: recErr } = await supabase
    .from('recipes')
    .select('*', { count: 'exact', head: true })
  if (recErr) console.log('Error recipes:', recErr.message)
  else console.log(`Total recetas en recipes: ${recCount}`)

  console.log('\n=== ITEMS DE MENÚ TOAST EN toast_menu_items ===')
  const { count: menuCount, error: menuErr } = await supabase
    .from('toast_menu_items')
    .select('*', { count: 'exact', head: true })
  if (menuErr) console.log('Error toast_menu_items:', menuErr.message)
  else console.log(`Total menu items en toast_menu_items: ${menuCount}`)

  console.log('\n=== FECHAS DISPONIBLES EN sales_daily_cache (AGOSTO-SEPTIEMBRE 2026) ===')
  const { data: salesDates, error: salesErr } = await supabase
    .from('sales_daily_cache')
    .select('business_date')
    .gte('business_date', '2026-08-01')
    .lte('business_date', '2026-09-24')
    .order('business_date')
  if (salesErr) console.log('Error sales_daily_cache:', salesErr.message)
  else {
    const dates = Array.from(new Set(salesDates?.map(d => d.business_date)))
    console.log(`Días con ventas en sales_daily_cache: ${dates.length}`)
    console.log(`Primer día: ${dates[0]}, Último día: ${dates[dates.length - 1]}`)
  }

  console.log('\n=== PMIX DAILY CACHE (AGOSTO-SEPTIEMBRE 2026) ===')
  const { data: pmixDates, error: pmixErr } = await supabase
    .from('pmix_daily_cache')
    .select('business_date')
    .gte('business_date', '2026-08-01')
    .lte('business_date', '2026-09-24')
    .order('business_date')
  if (pmixErr) console.log('Error pmix_daily_cache:', pmixErr.message)
  else {
    const dates = Array.from(new Set(pmixDates?.map(d => d.business_date)))
    console.log(`Días con datos en pmix_daily_cache: ${dates.length}`)
    console.log(`Primer día: ${dates[0]}, Último día: ${dates[dates.length - 1]}`)
  }
}

inspect().catch(err => {
  console.error('Error fatal:', err)
  process.exitCode = 1
})

/**
 * @module scripts/inspect-pmix-and-recipes
 * @description Inspecciona la estructura de PMIX, recipes, recipe_ingredients y toast_menu_items.
 * @businessRules Solo lectura para entender relaciones de datos.
 * @dataFlow Supabase (.env.local) → console.log.
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

async function main() {
  console.log('=== PMIX DAILY CACHE SAMPLE ===')
  const { data: pmixData, error: pmixErr } = await supabase
    .from('pmix_daily_cache')
    .select('store_id, business_date, items')
    .limit(1)

  if (pmixErr) console.error('PMIX error:', pmixErr.message)
  else if (pmixData && pmixData.length > 0) {
    const row = pmixData[0]
    console.log(`Store: ${row.store_id}, Date: ${row.business_date}, Total items: ${row.items?.length || 0}`)
    if (row.items && row.items.length > 0) {
      console.log('Primeros 2 items:', JSON.stringify(row.items.slice(0, 2), null, 2))
    }
  }

  console.log('\n=== RECIPES SAMPLE ===')
  const { data: recData, error: recErr } = await supabase
    .from('recipes')
    .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')
    .limit(5)
  if (recErr) console.error('Recipes error:', recErr.message)
  else console.log('Recipes sample:', JSON.stringify(recData, null, 2))

  console.log('\n=== TOAST MENU ITEMS SAMPLE ===')
  const { data: menuData, error: menuErr } = await supabase
    .from('toast_menu_items')
    .select('guid, name, price, category, is_active')
    .limit(5)
  if (menuErr) console.error('Menu items error:', menuErr.message)
  else console.log('Menu items sample:', JSON.stringify(menuData, null, 2))

  console.log('\n=== INVENTORY ITEMS SAMPLE ===')
  const { data: invData, error: invErr } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit, is_bodega, type')
    .limit(5)
  if (invErr) console.error('Inventory items error:', invErr.message)
  else console.log('Inventory items sample:', JSON.stringify(invData, null, 2))

  console.log('\n=== TOAST TICKET CONSUMPTION SNAPSHOTS SAMPLE ===')
  const { data: snapData, error: snapErr } = await supabase
    .from('toast_ticket_consumption_snapshots')
    .select('id, store_id, business_date, toast_order_guid, dining_option_name, channel_metadata, selections')
    .limit(1)
  if (snapErr) console.error('Snapshots error:', snapErr.message)
  else if (snapData && snapData.length > 0) {
    console.log('Snapshot metadata:', JSON.stringify(snapData[0].channel_metadata, null, 2))
    console.log('Snapshot dining option:', snapData[0].dining_option_name)
    console.log('Snapshot selections count:', snapData[0].selections?.length)
    console.log('Sample selection:', JSON.stringify(snapData[0].selections?.slice(0, 2), null, 2))
  }
}

main().catch(err => {
  console.error('Error fatal:', err)
  process.exitCode = 1
})

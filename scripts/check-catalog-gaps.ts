/**
 * @module scripts/check-catalog-gaps
 * @description Verifica el estado actual de los items faltantes en Supabase antes de mutaciones.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function run() {
  console.log('--- 1. INVENTORY ITEMS CHECK ---')
  const { data: invItems, error: invErr } = await supabase
    .from('inventory_items')
    .select('*')
    .in('id', [
      '8ba55664-5ca9-4886-8ac8-acf1fd070713', // Cheesecake
      '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      '085ecb0d-c711-4134-ae1a-f7630a22759c', // Horchata liquid
    ])
  if (invErr) console.error('Error inv:', invErr)
  else console.log('Found inventory items:', invItems)

  console.log('\n--- 2. TOAST MENU ITEMS CHECK ---')
  const { data: menuItems, error: menuErr } = await supabase
    .from('toast_menu_items')
    .select('*')
    .or(`guid.eq.717ae4d3-04a7-4a24-83f7-e89111102a1e,name.ilike.%cheesecake%,name.ilike.%gallon%`)
  if (menuErr) console.error('Error menu:', menuErr)
  else console.log('Found menu items:', menuItems)

  console.log('\n--- 3. RECIPES FOR THESE ITEMS ---')
  const guids = (menuItems || []).map(m => m.guid).concat(['717ae4d3-04a7-4a24-83f7-e89111102a1e'])
  const { data: existingRecipes, error: recErr } = await supabase
    .from('recipes')
    .select('*')
    .in('toast_menu_item_guid', guids)
  if (recErr) console.error('Error rec:', recErr)
  else console.log('Found existing recipes:', existingRecipes)
}

run().catch(console.error)

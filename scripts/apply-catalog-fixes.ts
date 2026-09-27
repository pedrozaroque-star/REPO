/**
 * @module scripts/apply-catalog-fixes
 * @description Aplica las inserciones de recetas y menu items confirmados en Supabase.
 * @businessRules Inserta Large Horchata (LA Central), Cheesecake, y empaque Galones Vacios.
 * @dataFlow Supabase (.env.local) → toast_menu_items & recipes.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function applyFixes() {
  console.log('=== APPLYING CATALOG FIXES ===\n')

  // 1. toast_menu_items: Large Horchata LA Central
  const horchataGuid = '717ae4d3-04a7-4a24-83f7-e89111102a1e'
  const { data: existingHorchata } = await supabase
    .from('toast_menu_items')
    .select('guid, name')
    .eq('guid', horchataGuid)
    .single()

  if (!existingHorchata) {
    console.log('Inserting Large Horchata (LA Central) into toast_menu_items...')
    const { data: insMenu, error: insMenuErr } = await supabase
      .from('toast_menu_items')
      .insert([{
        guid: horchataGuid,
        name: 'Large Horchata',
        sku: null,
        price: 4.09,
        group_name: 'In Store Drinks > Lg. Fountain Drinks (In Store)',
        is_modifier: false,
        active: true,
        last_synced_at: new Date().toISOString(),
        recipe_na: false,
      }])
      .select()
    if (insMenuErr) throw insMenuErr
    console.log('✅ Inserted toast_menu_item:', insMenu)
  } else {
    console.log('ℹ️ Large Horchata already exists in toast_menu_items:', existingHorchata)
  }

  // 2. recipes to ensure
  const recipesToEnsure = [
    // Large Horchata LA Central: 32 oz Horchata liquid
    {
      toast_menu_item_guid: horchataGuid,
      inventory_item_id: '085ecb0d-c711-4134-ae1a-f7630a22759c', // Horchata liquid
      quantity: 32,
      unit: 'oz',
      type: 'food',
      label: 'Large Horchata (32 oz liquid)'
    },
    // Cheesecake: 1 pza
    {
      toast_menu_item_guid: '03e71aca-a566-425e-bf6a-31ae9148b7b2', // Cheesecake menu item
      inventory_item_id: '8ba55664-5ca9-4886-8ac8-acf1fd070713', // Cheesecake inv item
      quantity: 1,
      unit: 'pza',
      type: 'food',
      label: 'Cheesecake (1 pza)'
    },
    // Gallon Agua: 1 pza Galones Vacios (Dine in, Takeout, Delivery)
    {
      toast_menu_item_guid: '213d3816-21f2-4297-9d79-82c9a79069d9', // Gallon Agua
      inventory_item_id: '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      quantity: 1,
      unit: 'pza',
      type: 'cogs_dine_in',
      label: 'Gallon Agua - Galon Vacio (Dine In)'
    },
    {
      toast_menu_item_guid: '213d3816-21f2-4297-9d79-82c9a79069d9', // Gallon Agua
      inventory_item_id: '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      quantity: 1,
      unit: 'pza',
      type: 'cogs_takeout',
      label: 'Gallon Agua - Galon Vacio (Takeout)'
    },
    {
      toast_menu_item_guid: '213d3816-21f2-4297-9d79-82c9a79069d9', // Gallon Agua
      inventory_item_id: '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      quantity: 1,
      unit: 'pza',
      type: 'cogs_delivery',
      label: 'Gallon Agua - Galon Vacio (Delivery)'
    },
    // Gallon Agua Fresca: 1 pza Galones Vacios (Dine in, Takeout, Delivery)
    {
      toast_menu_item_guid: '439d0ba1-cbca-4f78-a1db-122e26ee26ee', // Gallon Agua Fresca
      inventory_item_id: '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      quantity: 1,
      unit: 'pza',
      type: 'cogs_dine_in',
      label: 'Gallon Agua Fresca - Galon Vacio (Dine In)'
    },
    {
      toast_menu_item_guid: '439d0ba1-cbca-4f78-a1db-122e26ee26ee', // Gallon Agua Fresca
      inventory_item_id: '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      quantity: 1,
      unit: 'pza',
      type: 'cogs_takeout',
      label: 'Gallon Agua Fresca - Galon Vacio (Takeout)'
    },
    {
      toast_menu_item_guid: '439d0ba1-cbca-4f78-a1db-122e26ee26ee', // Gallon Agua Fresca
      inventory_item_id: '2fba5d5d-2af8-437d-8eae-844ed531dd8d', // Galones Vacios
      quantity: 1,
      unit: 'pza',
      type: 'cogs_delivery',
      label: 'Gallon Agua Fresca - Galon Vacio (Delivery)'
    },
  ]

  for (const item of recipesToEnsure) {
    const { data: existingRec } = await supabase
      .from('recipes')
      .select('id')
      .eq('toast_menu_item_guid', item.toast_menu_item_guid)
      .eq('inventory_item_id', item.inventory_item_id)
      .eq('type', item.type)

    if (existingRec && existingRec.length > 0) {
      console.log(`ℹ️ Recipe already exists: ${item.label} (ID: ${existingRec[0].id})`)
    } else {
      const { data: insRec, error: insRecErr } = await supabase
        .from('recipes')
        .insert([{
          toast_menu_item_guid: item.toast_menu_item_guid,
          inventory_item_id: item.inventory_item_id,
          quantity: item.quantity,
          unit: item.unit,
          type: item.type,
        }])
        .select()
      if (insRecErr) {
        console.error(`❌ Error inserting recipe ${item.label}:`, insRecErr.message)
      } else {
        console.log(`✅ Inserted recipe: ${item.label}`, insRec)
      }
    }
  }

  console.log('\n=== CATALOG FIXES COMPLETED SUCCESSFULLY ===')
}

applyFixes().catch(console.error)

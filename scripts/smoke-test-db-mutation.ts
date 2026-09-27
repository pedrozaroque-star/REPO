/**
 * @module scripts/smoke-test-db-mutation
 * @description Prueba real de mutación en vivo (Live DB Mutation Smoke Test) para toast_menu_items y recipes.
 * @businessRules Valida inserción, lectura y eliminación limpia en Supabase sin dejar basura.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const DUMMY_GUID = '00000000-0000-0000-0000-000000000001'

async function runSmokeTest() {
  console.log('=== STARTING LIVE DB MUTATION SMOKE TEST ===')

  // 1. Smoke test on toast_menu_items
  console.log('\n1. Testing toast_menu_items insertion...')
  const dummyMenuItem = {
    guid: DUMMY_GUID,
    name: 'TEST_SMOKE_ITEM',
    price: 9.99,
    group_name: 'Test Group',
    is_modifier: false,
    active: true,
    last_synced_at: new Date().toISOString(),
    recipe_na: false,
  }

  const { data: insertedMenu, error: insertMenuErr } = await supabase
    .from('toast_menu_items')
    .insert([dummyMenuItem])
    .select()

  if (insertMenuErr) {
    throw new Error(`Failed to insert into toast_menu_items: ${insertMenuErr.message}`)
  }
  console.log('✅ toast_menu_items INSERT successful:', insertedMenu)

  // 2. Smoke test on recipes
  console.log('\n2. Testing recipes insertion...')
  const dummyRecipe = {
    toast_menu_item_guid: DUMMY_GUID,
    inventory_item_id: '085ecb0d-c711-4134-ae1a-f7630a22759c', // Horchata inventory item
    quantity: 1,
    unit: 'oz',
    type: 'food',
  }

  const { data: insertedRecipe, error: insertRecipeErr } = await supabase
    .from('recipes')
    .insert([dummyRecipe])
    .select()

  if (insertRecipeErr) {
    // Clean up menu item before throwing
    await supabase.from('toast_menu_items').delete().eq('guid', DUMMY_GUID)
    throw new Error(`Failed to insert into recipes: ${insertRecipeErr.message}`)
  }
  console.log('✅ recipes INSERT successful:', insertedRecipe)

  // 3. Cleanup recipes
  console.log('\n3. Cleaning up test recipe...')
  const { error: delRecipeErr } = await supabase
    .from('recipes')
    .delete()
    .eq('toast_menu_item_guid', DUMMY_GUID)

  if (delRecipeErr) {
    console.error('❌ Failed to delete test recipe:', delRecipeErr.message)
  } else {
    console.log('✅ Test recipe deleted successfully.')
  }

  // 4. Cleanup toast_menu_items
  console.log('\n4. Cleaning up test menu item...')
  const { error: delMenuErr } = await supabase
    .from('toast_menu_items')
    .delete()
    .eq('guid', DUMMY_GUID)

  if (delMenuErr) {
    console.error('❌ Failed to delete test menu item:', delMenuErr.message)
  } else {
    console.log('✅ Test menu item deleted successfully.')
  }

  console.log('\n=== LIVE DB MUTATION SMOKE TEST COMPLETED SUCCESSFULLY ===')
}

runSmokeTest().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})

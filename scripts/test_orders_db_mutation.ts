/**
 * Live DB Mutation Smoke Test for Daily Orders & Counts
 * Uses exact schema: inventory_counts.quantity_on_hand
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runLiveMutationTest() {
    console.log('=== LIVE DB MUTATION SMOKE TEST (Supabase) ===\n')

    // 1. Get an active store
    const { data: stores, error: storeErr } = await supabase
        .from('stores')
        .select('id, name')
        .eq('is_active', true)
        .limit(1)

    if (storeErr || !stores || stores.length === 0) {
        console.error('Failed to fetch stores:', storeErr)
        process.exit(1)
    }

    const testStoreId = String(stores[0].id)
    console.log(`Using Store: ${stores[0].name} (${testStoreId})`)

    // 2. Get an inventory item
    const { data: items, error: itemErr } = await supabase
        .from('inventory_items')
        .select('id, name')
        .limit(1)

    if (itemErr || !items || items.length === 0) {
        console.error('Failed to fetch items:', itemErr)
        process.exit(1)
    }

    const testItemId = items[0].id
    const dummyDate = '2099-12-31' // Safe future date for testing
    console.log(`Using Item: ${items[0].name} (${testItemId}) with dummy date ${dummyDate}`)

    // 3. Test INSERT/UPSERT on inventory_counts using quantity_on_hand
    const testCountRecord = {
        store_id: testStoreId,
        inventory_item_id: testItemId,
        count_date: dummyDate,
        quantity_on_hand: 7
    }

    console.log('Attempting upsert into inventory_counts...')
    const { data: upsertData, error: upsertErr } = await supabase
        .from('inventory_counts')
        .upsert(testCountRecord, { onConflict: 'store_id, inventory_item_id, count_date' })
        .select()

    if (upsertErr) {
        console.error('❌ [FAIL] Upsert into inventory_counts failed:', upsertErr)
        process.exit(1)
    }
    console.log('✅ [PASS] Upsert into inventory_counts succeeded:', upsertData)

    // 4. Verify record exists
    const { data: verifyData, error: verifyErr } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', testStoreId)
        .eq('inventory_item_id', testItemId)
        .eq('count_date', dummyDate)
        .single()

    if (verifyErr || !verifyData || Number(verifyData.quantity_on_hand) !== 7) {
        console.error('❌ [FAIL] Verification of inserted record failed:', verifyErr)
        process.exit(1)
    }
    console.log('✅ [PASS] Record verified in DB with quantity_on_hand: 7')

    // 5. Cleanup (DELETE)
    const { error: deleteErr } = await supabase
        .from('inventory_counts')
        .delete()
        .eq('store_id', testStoreId)
        .eq('inventory_item_id', testItemId)
        .eq('count_date', dummyDate)

    if (deleteErr) {
        console.error('❌ [FAIL] Cleanup failed:', deleteErr)
        process.exit(1)
    }
    console.log('✅ [PASS] Test record cleaned up successfully (DELETE).\n')

    console.log('🎉 Live DB Mutation Smoke Test Passed with 0 errors.')
}

runLiveMutationTest()

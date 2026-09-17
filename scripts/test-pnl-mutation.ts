/**
 * Live DB Mutation Smoke Test for P&L Tables
 * Validates real INSERT, SELECT, UPDATE, and DELETE operations on:
 * - store_operating_expenses
 * - shared_brand_expenses
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function runLiveMutationSmokeTest() {
  console.log('🧪 Starting Live DB Mutation Smoke Test for P&L tables...')

  // 1. Test store_operating_expenses
  const probeStoreId = 'PROBE_TEST_STORE_UUID'
  const probeMonthYear = '2099-12'

  console.log('1️⃣ Testing store_operating_expenses INSERT...')
  const { data: insertedExp, error: insErr } = await supabase
    .from('store_operating_expenses')
    .insert({
      store_id: probeStoreId,
      store_name: 'Probe Store Smoke Test',
      month_year: probeMonthYear,
      rent_monthly: 9999.99,
      cam_charges: 888.88,
      utilities_monthly: 777.77,
      repairs_maintenance_monthly: 666.66,
      supplies_misc_monthly: 555.55,
      insurance_monthly: 444.44,
      notes: 'Smoke test probe record'
    })
    .select()
    .single()

  if (insErr) {
    throw new Error(`INSERT failed on store_operating_expenses: ${insErr.message}`)
  }
  console.log('  ✓ INSERT successful:', insertedExp.id, 'Rent:', insertedExp.rent_monthly)

  // Verify SELECT
  const { data: fetchedExp, error: fetchErr } = await supabase
    .from('store_operating_expenses')
    .select('*')
    .eq('id', insertedExp.id)
    .single()

  if (fetchErr || !fetchedExp) {
    throw new Error(`SELECT failed on store_operating_expenses: ${fetchErr?.message}`)
  }
  console.log('  ✓ SELECT verified:', fetchedExp.store_name)

  // Test UPDATE
  const { data: updatedExp, error: updErr } = await supabase
    .from('store_operating_expenses')
    .update({ rent_monthly: 11111.11 })
    .eq('id', insertedExp.id)
    .select()
    .single()

  if (updErr || updatedExp.rent_monthly !== 11111.11) {
    throw new Error(`UPDATE failed on store_operating_expenses: ${updErr?.message}`)
  }
  console.log('  ✓ UPDATE verified. New rent:', updatedExp.rent_monthly)

  // Test DELETE cleanup
  const { error: delErr } = await supabase
    .from('store_operating_expenses')
    .delete()
    .eq('id', insertedExp.id)

  if (delErr) {
    throw new Error(`DELETE failed on store_operating_expenses: ${delErr.message}`)
  }
  console.log('  ✓ DELETE cleanup successful.')

  // 2. Test shared_brand_expenses
  console.log('\n2️⃣ Testing shared_brand_expenses INSERT...')
  const { data: insertedShared, error: sharedInsErr } = await supabase
    .from('shared_brand_expenses')
    .insert({
      expense_name: 'Smoke Test Brand Campaign',
      category: 'marketing',
      amount: 1234.56,
      period_start: '2099-12-01',
      period_end: '2099-12-31',
      allocation_method: 'sales_weighted',
      notes: 'Probe shared expense'
    })
    .select()
    .single()

  if (sharedInsErr) {
    throw new Error(`INSERT failed on shared_brand_expenses: ${sharedInsErr.message}`)
  }
  console.log('  ✓ INSERT successful:', insertedShared.id, 'Amount:', insertedShared.amount)

  // Test DELETE cleanup
  const { error: sharedDelErr } = await supabase
    .from('shared_brand_expenses')
    .delete()
    .eq('id', insertedShared.id)

  if (sharedDelErr) {
    throw new Error(`DELETE failed on shared_brand_expenses: ${sharedDelErr.message}`)
  }
  console.log('  ✓ DELETE cleanup successful.')

  console.log('\n🎉 ALL LIVE DB MUTATION SMOKE TESTS PASSED (100% CLEAN)!')
}

runLiveMutationSmokeTest().catch(err => {
  console.error('❌ SMOKE TEST FAILED:', err)
  process.exit(1)
})

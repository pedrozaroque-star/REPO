/**
 * @module smoke-test-delivery-audits-mutation
 * @description Prueba real INSERT/UPDATE/SELECT/DELETE del esquema de Entrega Blindada.
 * @businessRules No envía columnas generadas; nunca persiste PINs; siempre limpia en finally.
 * @dataFlow Script TSX -> Supabase delivery_packing_audits -> verificación -> DELETE.
 * @notes Usa un GUID único y confirma que la limpieza deje cero filas.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import assert from 'node:assert/strict'
import { supabaseAdmin } from '../lib/supabase'

async function main() {
  const guid = `delivery-armor-smoke-${Date.now()}`
  let id: string | null = null
  try {
    const { data: generated, error: generatedError } = await supabaseAdmin.rpc('execute_sql', {
      query_text: "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_packing_audits' AND is_generated='ALWAYS'"
    })
    if (generatedError) throw generatedError
    console.log('Generated columns inspected:', generated?.length || 0)

    const { data: inserted, error: insertError } = await supabaseAdmin.from('delivery_packing_audits').insert({
      store_id: 6,
      toast_order_guid: guid,
      toast_display_number: 'SMOKE-999',
      platform: 'DOORDASH',
      customer_name: 'Delivery Smoke Test',
      items_json: [{ id: 'item-1', displayName: 'Taco Asada', quantity: 1, price: 3.5, modifiers: [], isHighRiskDrink: false }],
      matched_items: ['CONTROL:foodComplete', 'CONTROL:drinksComplete', 'CONTROL:bagCountCorrect', 'CONTROL:bagSealed'],
      match_completed: true,
      quick_checks: { foodComplete: true, drinksComplete: true, bagCountCorrect: true, bagSealed: true },
      expected_bag_count: 1,
      confirmed_bag_count: 1,
      risk_level: 'NORMAL',
      risk_reasons: [],
      evidence_policy: 'NONE',
      packer_ronos_user_id: 999999,
      packer_ronos_name: 'Smoke Test',
      packer_pin: null,
      packed_at: new Date().toISOString(),
      status: 'PACKED_AND_SEALED'
    }).select('id, status, quick_checks, packer_pin').single()
    if (insertError) throw insertError
    id = inserted.id
    assert.equal(inserted.status, 'PACKED_AND_SEALED')
    assert.equal(inserted.packer_pin, null)

    const { data: updated, error: updateError } = await supabaseAdmin.from('delivery_packing_audits').update({
      handed_by_ronos_user_id: 999999,
      handed_by_ronos_name: 'Smoke Test',
      handed_pin: null,
      handed_at: new Date().toISOString(),
      driver_name: 'Smoke Courier',
      driver_confirmed: true,
      courier_verification_method: 'DOORDASH_QR',
      courier_order_reference: 'QR-999',
      live_pickup_confirmed: true,
      status: 'DELIVERED'
    }).eq('id', id).eq('status', 'PACKED_AND_SEALED').select('status, handed_pin, live_pickup_confirmed').single()
    if (updateError) throw updateError
    assert.equal(updated.status, 'DELIVERED')
    assert.equal(updated.handed_pin, null)
    assert.equal(updated.live_pickup_confirmed, true)
    console.log('Live DB mutation smoke test: PASS')
  } finally {
    if (id) {
      const { error } = await supabaseAdmin.from('delivery_packing_audits').delete().eq('id', id)
      if (error) throw error
    }
    const { count, error } = await supabaseAdmin.from('delivery_packing_audits').select('id', { count: 'exact', head: true }).eq('toast_order_guid', guid)
    if (error) throw error
    assert.equal(count, 0)
    console.log('Smoke row cleanup verified.')
  }
}

main().catch(error => { console.error(error); process.exit(1) })

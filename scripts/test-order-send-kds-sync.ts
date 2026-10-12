/**
 * Test de simulación y mutación en vivo para el flujo de Órdenes en Preparación (SEND)
 * y sincronización bidireccional KDS (Bump silencioso & Recall).
 */

import { supabaseAdmin } from '../lib/supabase'
import { evaluateToastOrder, classifyDiningName } from '../lib/order-ready-sync'
import { getCaliforniaBusinessDate } from '../lib/business-date'

async function runSimulation() {
  console.log('🚀 Iniciando Simulación de Órdenes SEND y Sincronización KDS...')

  // 1. Prueba unitaria de evaluación de órdenes Toast
  console.log('\n--- 1. Evaluación de estados Toast (SENT -> READY -> RECALL) ---')
  
  // Orden recién cobrada por cajera (items en SENT)
  const orderSent = {
    guid: 'test-guid-1',
    displayNumber: '888',
    checks: [
      {
        selections: [
          { displayName: '3x Taco Asada', fulfillmentStatus: 'SENT', sentDate: new Date().toISOString() },
          { displayName: '1x Burrito Pastor', fulfillmentStatus: 'SENT', sentDate: new Date().toISOString() }
        ]
      }
    ]
  }
  const evalSent = evaluateToastOrder(orderSent)
  console.log('Orden recién cobrada (SENT):', evalSent.status, '✓ (esperado: IN_PROGRESS)')
  if (evalSent.status !== 'IN_PROGRESS') throw new Error('Fallo en evaluación SENT')

  // Cocinero hace bump en KDS (items en READY)
  const orderBumped = {
    ...orderSent,
    checks: [
      {
        selections: [
          { displayName: '3x Taco Asada', fulfillmentStatus: 'READY', modifiedDate: new Date().toISOString() },
          { displayName: '1x Burrito Pastor', fulfillmentStatus: 'READY', modifiedDate: new Date().toISOString() }
        ]
      }
    ]
  }
  const evalBumped = evaluateToastOrder(orderBumped)
  console.log('Cocinero hace bump en KDS (READY):', evalBumped.status, '✓ (esperado: READY)')
  if (evalBumped.status !== 'READY') throw new Error('Fallo en evaluación READY')

  // Cocinero hace RECALL en KDS (items regresan a SENT)
  const orderRecalled = {
    ...orderSent,
    checks: [
      {
        selections: [
          { displayName: '3x Taco Asada', fulfillmentStatus: 'SENT', sentDate: new Date().toISOString() },
          { displayName: '1x Burrito Pastor', fulfillmentStatus: 'SENT', sentDate: new Date().toISOString() }
        ]
      }
    ]
  }
  const evalRecalled = evaluateToastOrder(orderRecalled)
  console.log('Cocinero hace RECALL en KDS:', evalRecalled.status, '✓ (esperado: IN_PROGRESS)')
  if (evalRecalled.status !== 'IN_PROGRESS') throw new Error('Fallo en evaluación RECALL')

  // 2. Prueba de mutación real en Base de Datos Supabase (Live DB Mutation Smoke Test)
  console.log('\n--- 2. Live DB Mutation Smoke Test en order_ready_announcements ---')
  const testGuid = `test-smoke-${Date.now()}`
  const todayLA = getCaliforniaBusinessDate()
  const testOrderNum = '9999'

  // Paso A: Inserción de orden cobrada por cajera (status = IN_PROGRESS)
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .insert({
      store_code: 'TEST_STORE',
      store_id: 'test-store-guid',
      store_name: 'Test Store',
      order_number: testOrderNum,
      order_guid: testGuid,
      dining_option: 'FOR_HERE',
      customer_name: 'Cliente Prueba',
      status: 'IN_PROGRESS',
      business_date: todayLA,
      announced: false,
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  if (insertErr || !inserted) {
    throw new Error(`Error insertando orden de prueba: ${insertErr?.message}`)
  }
  console.log('✓ Orden de prueba insertada con status IN_PROGRESS, ID:', inserted.id)

  // Paso B: Verificar que la consulta de la tableta del preparador (.eq(status, IN_PROGRESS)) la encuentra
  const { data: prepQuery1 } = await supabaseAdmin
    .from('order_ready_announcements')
    .select('*')
    .eq('store_code', 'TEST_STORE')
    .eq('status', 'IN_PROGRESS')
    .eq('order_guid', testGuid)

  if (!prepQuery1 || prepQuery1.length === 0) {
    throw new Error('La tableta del preparador no encontró la orden IN_PROGRESS')
  }
  console.log('✓ Tableta preparador detecta orden en preparación (#9999)')

  // Paso C: Simular KDS Bump (status = READY, announced = true)
  const nowIso = new Date().toISOString()
  const { error: bumpErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .update({
      status: 'READY',
      ready_at: nowIso,
      announced: true // Silencio ante KDS bump
    })
    .eq('id', inserted.id)

  if (bumpErr) throw new Error(`Error en bump: ${bumpErr.message}`)
  console.log('✓ KDS Bump aplicado: status = READY, announced = true (silencioso)')

  // Paso D: Verificar que desapareció de la tableta del preparador
  const { data: prepQuery2 } = await supabaseAdmin
    .from('order_ready_announcements')
    .select('*')
    .eq('store_code', 'TEST_STORE')
    .eq('status', 'IN_PROGRESS')
    .eq('order_guid', testGuid)

  if (prepQuery2 && prepQuery2.length > 0) {
    throw new Error('La orden debió removerse de la tableta del preparador tras el bump de KDS')
  }
  console.log('✓ La orden se removió correctamente de la tableta del preparador')

  // Paso E: Simular KDS RECALL (status = IN_PROGRESS, ready_at = null, announced = false)
  const { error: recallErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .update({
      status: 'IN_PROGRESS',
      ready_at: null,
      announced: false
    })
    .eq('id', inserted.id)

  if (recallErr) throw new Error(`Error en recall: ${recallErr.message}`)
  console.log('✓ KDS RECALL aplicado: status = IN_PROGRESS, ready_at = null, announced = false')

  // Paso F: Verificar que REAPARECIÓ en la tableta del preparador
  const { data: prepQuery3 } = await supabaseAdmin
    .from('order_ready_announcements')
    .select('*')
    .eq('store_code', 'TEST_STORE')
    .eq('status', 'IN_PROGRESS')
    .eq('order_guid', testGuid)

  if (!prepQuery3 || prepQuery3.length === 0) {
    throw new Error('La orden debió reaparecer en la tableta del preparador tras el recall')
  }
  console.log('✓ La orden REAPARECIÓ exitosamente en la tableta del preparador tras el RECALL')

  // Paso G: Simular segundo KDS bump (volver a borrar)
  const { error: bumpErr2 } = await supabaseAdmin
    .from('order_ready_announcements')
    .update({
      status: 'READY',
      ready_at: new Date().toISOString(),
      announced: true
    })
    .eq('id', inserted.id)

  if (bumpErr2) throw new Error(`Error en segundo bump: ${bumpErr2.message}`)
  const { data: prepQuery4 } = await supabaseAdmin
    .from('order_ready_announcements')
    .select('*')
    .eq('store_code', 'TEST_STORE')
    .eq('status', 'IN_PROGRESS')
    .eq('order_guid', testGuid)

  if (prepQuery4 && prepQuery4.length > 0) {
    throw new Error('La orden debió removerse tras el segundo bump')
  }
  console.log('✓ La orden se volvió a remover exitosamente tras el segundo bump')

  // Paso H: Limpieza inmediata
  await supabaseAdmin
    .from('order_ready_announcements')
    .delete()
    .eq('id', inserted.id)

  console.log('✓ Registro de prueba eliminado limpiamente de la base de datos')
  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE SIMULACIÓN Y MUTACIÓN PASARON AL 100%!')
}

runSimulation().catch((err) => {
  console.error('❌ Error en simulación:', err)
  process.exit(1)
})

/**
 * Smoke test for DRIVE_THRU order creation, mutation, and query in order_ready_announcements
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runTest() {
  console.log('🧪 Iniciando prueba de orden DRIVE_THRU en order_ready_announcements...')

  const testOrderNumber = 'DT-999'
  const storeCode = 'LYNWOOD'

  // 1. Insertar orden de prueba con DRIVE_THRU
  const { data: inserted, error: insertErr } = await supabase
    .from('order_ready_announcements')
    .insert({
      store_code: storeCode,
      store_id: 'test-store-dt',
      store_name: 'Lynwood (#14)',
      order_number: testOrderNumber,
      dining_option: 'DRIVE_THRU',
      customer_name: 'Drive-Thru Auto #1',
      status: 'IN_PROGRESS',
      announced: false
    })
    .select()
    .single()

  if (insertErr) {
    console.error('❌ Error al insertar orden DRIVE_THRU:', insertErr)
    process.exit(1)
  }

  console.log('✅ Orden DRIVE_THRU creada con éxito:', {
    id: inserted.id,
    order_number: inserted.order_number,
    dining_option: inserted.dining_option,
    status: inserted.status
  })

  // 2. Transición a READY (simula el doble tap / bump del expediter)
  const { data: updated, error: updateErr } = await supabase
    .from('order_ready_announcements')
    .update({
      status: 'READY',
      ready_at: new Date().toISOString()
    })
    .eq('id', inserted.id)
    .select()
    .single()

  if (updateErr) {
    console.error('❌ Error al actualizar orden DRIVE_THRU a READY:', updateErr)
    process.exit(1)
  }

  console.log('✅ Orden actualizada a READY:', {
    id: updated.id,
    order_number: updated.order_number,
    status: updated.status,
    ready_at: updated.ready_at
  })

  // 3. Limpiar registro de prueba
  const { error: deleteErr } = await supabase
    .from('order_ready_announcements')
    .delete()
    .eq('id', inserted.id)

  if (deleteErr) {
    console.error('❌ Error al limpiar registro de prueba:', deleteErr)
    process.exit(1)
  }

  console.log('✅ Registro de prueba DRIVE_THRU limpiado exitosamente.')
  console.log('🎉 Smoke test DRIVE_THRU superado con éxito!')
}

runTest().catch((err) => {
  console.error('Error no controlado:', err)
  process.exit(1)
})

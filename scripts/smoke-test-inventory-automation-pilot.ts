/**
 * @module scripts/smoke-test-inventory-automation-pilot
 * @description Prueba real de inserción, lectura y limpieza para las tablas del piloto Lynwood/Slauson.
 * @businessRules Usa fechas futuras reservadas, no modifica conteos ni pedidos reales y elimina cada sesión al terminar.
 * @dataFlow Supabase service role -> pilot session -> pilot line -> lectura -> delete cascade.
 * @notes Ejecutar solo despues de aplicar 202609250001_inventory_automation_pilot.sql.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function run() {
  const { data: stores, error: storeError } = await db.from('stores')
    .select('id,name').or('name.ilike.%Lynwood%,name.ilike.%Slauson%')
  if (storeError) throw new Error(storeError.message)

  for (const expectedName of ['Lynwood', 'Slauson']) {
    const store = stores?.find(row => new RegExp(expectedName, 'i').test(row.name || ''))
    if (!store) throw new Error(`${expectedName} no encontrada`)
    await smokeStore(store, expectedName)
  }
}

async function smokeStore(store: { id: string | number; name: string }, expectedName: string) {
  const { data: template, error: templateError } = await db.from('store_order_template')
    .select('inventory_item_id,inventory_items:inventory_item_id(name)')
    .eq('store_id', store.id).eq('order_type', 'daily').limit(1).single()
  if (templateError || !template) throw new Error(templateError?.message || `Template ${expectedName} vacío`)

  let sessionId: string | null = null
  try {
    const { data: session, error: sessionError } = await db.from('inventory_automation_pilot_sessions')
      .insert({
        store_id: store.id,
        business_date: expectedName === 'Lynwood' ? '2099-01-01' : '2099-01-02',
        order_type: 'daily',
        status: 'revealed',
        model_version: 'smoke-test',
        completed_by_user_id: 'smoke-test',
        completed_by_name: 'Smoke Test',
        completed_at: new Date().toISOString(),
      }).select('id').single()
    if (sessionError || !session) throw new Error(sessionError?.message || 'No se inserto sesion')
    sessionId = session.id

    const itemName = (template.inventory_items as unknown as { name?: string } | null)?.name || 'Smoke Item'
    const { error: lineError } = await db.from('inventory_automation_pilot_lines').insert({
      session_id: sessionId,
      inventory_item_id: template.inventory_item_id,
      item_name: itemName,
      physical_leftover: 5,
      automatic_leftover: 4,
      variance: 1,
      tolerance_value: 1,
      within_tolerance: true,
      par_value: 10,
      automatic_order_qty: 6,
      official_order_qty: 5,
    })
    if (lineError) throw new Error(lineError.message)

    const { data: verified, error: readError } = await db.from('inventory_automation_pilot_sessions')
      .select('id,inventory_automation_pilot_lines(id,official_order_qty)')
      .eq('id', sessionId).single()
    if (readError || !verified || (verified.inventory_automation_pilot_lines as any[])?.length !== 1) {
      throw new Error(readError?.message || 'La lectura no confirmo la linea insertada')
    }
    console.log(`PASS live DB pilot mutation (${expectedName}): session + line inserted and verified`)
  } finally {
    if (sessionId) {
      const { error } = await db.from('inventory_automation_pilot_sessions').delete().eq('id', sessionId)
      if (error) throw new Error(`No se pudo limpiar la sesion de prueba: ${error.message}`)
      console.log(`PASS cleanup (${expectedName}): pilot smoke session removed by cascade`)
    }
  }
}

run().catch(error => {
  console.error(`FAIL live DB pilot mutation: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

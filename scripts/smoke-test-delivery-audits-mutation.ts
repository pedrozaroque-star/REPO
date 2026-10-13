import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabaseAdmin } from '../lib/supabase';

async function smokeTest() {
  console.log('🧪 Iniciando Smoke Test de mutación real en delivery_packing_audits...');

  // 1. Insert test audit
  const testPayload = {
    store_id: 6, // Central
    toast_order_guid: 'smoke_test_guid_123',
    toast_display_number: '999',
    platform: 'DOORDASH',
    dining_option_guid: 'e65c4baf-53be-4562-ada4-e85bfd7391cd',
    dining_option_name: 'DoorDash - Delivery',
    customer_name: 'Smoke Test Customer',
    order_opened_at: new Date().toISOString(),
    items_json: [
      { id: 'item_1', name: 'Taco Asada', quantity: 3, price: 9.75, modifiers: ['Con Todo'] },
      { id: 'item_2', name: 'Horchata 32oz', quantity: 1, price: 4.50, modifiers: [] }
    ],
    matched_items: ['item_1'],
    match_completed: false,
    packer_ronos_user_id: 28406,
    packer_ronos_name: 'Cesar Martinez',
    packer_pin: '2534',
    packed_at: new Date().toISOString(),
    status: 'PENDING_MATCH'
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('delivery_packing_audits')
    .insert(testPayload)
    .select('*')
    .single();

  if (insErr || !inserted) {
    console.error('❌ Falló inserción en delivery_packing_audits:', insErr);
    process.exit(1);
  }
  console.log('✅ Inserción real exitosa en DB:', inserted.id);

  // 2. Update test audit (match completed and sealed)
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('delivery_packing_audits')
    .update({
      matched_items: ['item_1', 'item_2'],
      match_completed: true,
      photo_open_url: 'https://placeholder.supabase.co/storage/v1/object/public/delivery-evidence/open_test.jpg',
      photo_sealed_url: 'https://placeholder.supabase.co/storage/v1/object/public/delivery-evidence/sealed_test.jpg',
      status: 'PACKED_AND_SEALED'
    })
    .eq('id', inserted.id)
    .select('*')
    .single();

  if (updErr || !updated) {
    console.error('❌ Falló actualización en delivery_packing_audits:', updErr);
    process.exit(1);
  }
  console.log('✅ Actualización real exitosa (Match 100% y fotos):', updated.status);

  // 3. Clean up (delete smoke test row)
  const { error: delErr } = await supabaseAdmin
    .from('delivery_packing_audits')
    .delete()
    .eq('id', inserted.id);

  if (delErr) {
    console.error('❌ Falló limpieza de fila de prueba:', delErr);
    process.exit(1);
  }
  console.log('✅ Limpieza exitosa. Tabla delivery_packing_audits 100% verificada en DB real!');
  process.exit(0);
}

smokeTest().catch(err => {
  console.error(err);
  process.exit(1);
});

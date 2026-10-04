/**
 * Limpia borradores duplicados de Viele: misma tienda + misma fecha de entrega (ship_date) => conserva el MÁS RECIENTE.
 * No toca órdenes vivas (status <> 'draft') ni borradores únicos por tienda/fecha.
 * Uso: node scripts/cleanup-viele-duplicate-drafts.cjs [--apply]   (sin --apply solo muestra el plan)
 */
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
};
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
const APPLY = process.argv.includes('--apply');

async function main() {
  const { data: drafts, error } = await sb.from('viele_orders')
    .select('id,store_id,ship_date,order_number,created_at,total_cases,subtotal_amount')
    .eq('status', 'draft').order('created_at', { ascending: false }).range(0, 999);
  if (error) throw error;
  const { count: liveBefore } = await sb.from('viele_orders').select('*', { count: 'exact', head: true }).neq('status', 'draft');
  console.log(`MODO: ${APPLY ? 'APLICAR (borra)' : 'SOLO LECTURA'} | borradores totales: ${drafts.length} | ordenes vivas: ${liveBefore}\n`);

  const groups = new Map();
  for (const d of drafts) {
    const k = `${d.store_id}|${d.ship_date}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d); // ya vienen de más reciente a más antiguo
  }
  const toDelete = [];
  for (const [k, arr] of groups) {
    const [keep, ...dups] = arr;
    if (dups.length) {
      console.log(`Tienda ${arr[0].store_id} entrega ${arr[0].ship_date}: CONSERVA id=${keep.id} (${keep.created_at.slice(0, 16)}Z, ${keep.total_cases} cajas, $${keep.subtotal_amount})`);
      for (const d of dups) { console.log(`    BORRA    id=${d.id} (${d.created_at.slice(0, 16)}Z, ${d.total_cases} cajas, $${d.subtotal_amount})`); toDelete.push(d.id); }
    }
  }
  if (!toDelete.length) { console.log('No hay borradores duplicados.'); return; }
  console.log(`\nTotal a borrar: ${toDelete.length} -> ids ${toDelete.join(', ')}`);
  if (!APPLY) { console.log('(usa --apply para borrar)'); return; }

  // Seguridad: re-verifica que todos sigan siendo 'draft' justo antes de borrar.
  const { data: still } = await sb.from('viele_orders').select('id,status').in('id', toDelete);
  if (still.length !== toDelete.length || still.some((s) => s.status !== 'draft')) throw new Error('Algun id ya no es draft; abortado.');

  const di = await sb.from('viele_order_items').delete().in('order_id', toDelete);
  if (di.error) throw new Error('items: ' + di.error.message);
  const dr = await sb.from('viele_orders').delete().in('id', toDelete).eq('status', 'draft');
  if (dr.error) throw new Error('ordenes: ' + dr.error.message);

  const { data: left } = await sb.from('viele_orders').select('id').in('id', toDelete);
  const { data: leftItems } = await sb.from('viele_order_items').select('order_id').in('order_id', toDelete);
  const { count: liveAfter } = await sb.from('viele_orders').select('*', { count: 'exact', head: true }).neq('status', 'draft');
  console.log(`\nVerificacion: borradores restantes de la lista=${left.length}, renglones huerfanos=${leftItems.length}, ordenes vivas antes=${liveBefore} despues=${liveAfter}`);
  if (left.length || leftItems.length || liveAfter !== liveBefore) throw new Error('Verificacion fallida');
  console.log('OK: duplicados borrados y ordenes vivas intactas.');
}
main().catch((e) => { console.error('ERROR', e.message || e); process.exit(1); });

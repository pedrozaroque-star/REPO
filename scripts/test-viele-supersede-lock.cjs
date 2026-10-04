const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
};
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

const STORE = 1;
const P = 'TEST_SUPERSEDE_';
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? 'OK   ' : 'FALLA'), name, extra ?? ''); };

async function cleanup() {
  await sb.from('viele_checkout_requests').delete().like('request_key', STORE + ':' + P + '%');
}

async function main() {
  await cleanup();
  const before = await sb.from('viele_checkout_requests').select('state').eq('store_id', STORE).in('state', ['processing', 'recovery_required']);
  check('Tienda ' + STORE + ' libre antes de probar', before.data.length === 0, 'activos=' + before.data.length);

  // 1) El CHECK acepta 'superseded' (migracion aplicada)
  const t1 = await sb.from('viele_checkout_requests').insert({ request_key: STORE + ':' + P + 'chk', store_id: STORE, payload_hash: 'x', state: 'superseded' });
  check("CHECK acepta estado 'superseded'", !t1.error, t1.error?.message);
  await cleanup();

  // 2) recovery_required VIEJO (48h) NO bloquea
  const old = await sb.from('viele_checkout_requests').insert({ request_key: STORE + ':' + P + 'old', store_id: STORE, payload_hash: 'x', state: 'recovery_required', updated_at: hoursAgo(48) });
  check('Insertar fila vieja de prueba', !old.error, old.error?.message);
  const c1 = await sb.rpc('claim_viele_checkout', { p_key: STORE + ':' + P + 'new1', p_store_id: STORE, p_hash: 'h1' });
  check('Claim con bloqueo de 48h => claimed:true', c1.data?.claimed === true, JSON.stringify(c1.data) + ' ' + (c1.error?.message ?? ''));
  const oldRow = await sb.from('viele_checkout_requests').select('state').eq('request_key', STORE + ':' + P + 'old').single();
  check("Fila vieja quedo 'superseded' (auditoria conservada)", oldRow.data?.state === 'superseded', oldRow.data?.state);
  await cleanup();

  // 3) recovery_required RECIENTE (1h) SI bloquea
  const rec = await sb.from('viele_checkout_requests').insert({ request_key: STORE + ':' + P + 'recent', store_id: STORE, payload_hash: 'x', state: 'recovery_required', updated_at: hoursAgo(1) });
  check('Insertar fila reciente de prueba', !rec.error, rec.error?.message);
  const c2 = await sb.rpc('claim_viele_checkout', { p_key: STORE + ':' + P + 'new2', p_store_id: STORE, p_hash: 'h2' });
  check('Claim con bloqueo de 1h => claimed:false (sigue protegiendo)', c2.data?.claimed === false, JSON.stringify(c2.data));
  const recRow = await sb.from('viele_checkout_requests').select('state').eq('request_key', STORE + ':' + P + 'recent').single();
  check('Fila reciente intacta en recovery_required', recRow.data?.state === 'recovery_required', recRow.data?.state);
  await cleanup();

  // 4) 'processing' NO se toca aunque sea viejo (podria estar en vuelo)
  const proc = await sb.from('viele_checkout_requests').insert({ request_key: STORE + ':' + P + 'proc', store_id: STORE, payload_hash: 'x', state: 'processing', updated_at: hoursAgo(48) });
  check('Insertar fila processing de prueba', !proc.error, proc.error?.message);
  const c3 = await sb.rpc('claim_viele_checkout', { p_key: STORE + ':' + P + 'new3', p_store_id: STORE, p_hash: 'h3' });
  check("Claim con 'processing' viejo => claimed:false (no se toca)", c3.data?.claimed === false, JSON.stringify(c3.data));
  await cleanup();

  const after = await sb.from('viele_checkout_requests').select('request_key').like('request_key', STORE + ':' + P + '%');
  check('Sin filas de prueba residuales', after.data.length === 0, 'residuales=' + after.data.length);

  // 5) Estado real de candados
  const real = await sb.from('viele_checkout_requests').select('store_id,state').in('state', ['processing', 'recovery_required']);
  console.log('\nCandados reales activos:', JSON.stringify(real.data));
  console.log(failed === 0 ? '\nRESULTADO: TODAS LAS PRUEBAS PASARON' : '\nRESULTADO: ' + failed + ' PRUEBA(S) FALLARON');
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await cleanup(); process.exit(2); });

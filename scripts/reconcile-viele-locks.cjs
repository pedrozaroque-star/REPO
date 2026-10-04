const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
};
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
const accounts = JSON.parse(getEnv('VIELE_STORE_ACCOUNTS_JSON'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const clean = (v) => (v == null ? '' : String(v).replace(/<[^>]+>/g, '').trim());
const money = (s) => (s ? parseFloat(s.replace(/,/g, '')) : null);
const APPLY = process.argv.includes('--apply');

async function login(storeId) {
  const acc = accounts[storeId];
  const p = new URLSearchParams({ UserID: acc.email, Password: acc.password, RememberMe: 'RememberMe', submit: 'User Login' });
  const r = await fetch('https://shop.vieleandsons.com/login/', { method: 'POST', body: p.toString(), redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Origin: 'https://shop.vieleandsons.com', Referer: 'https://shop.vieleandsons.com/login/' } });
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
}

async function verifyOrder(cookie, dbOrder) {
  const H = { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const no = dbOrder.order_number;
  const det = await (await fetch(`https://shop.vieleandsons.com/api/salesOrderDetail_dt?orderNo=${no}&sEcho=1&iDisplayStart=0&iDisplayLength=200`, { headers: H })).json();
  const doc = await (await fetch(`https://shop.vieleandsons.com/api/salesOrder_doc?orderNo=${no}`, { headers: H })).json();
  const html = doc.HTMLDoc || '';
  const net = money((html.match(/Net Order:\s*<\/strong><\/td><td[^>]*><strong>\$?([\d,]+\.\d{2})/i) || [])[1]);
  const taxRaw = money((html.match(/Sales Tax:\s*<\/strong><\/td><td[^>]*><strong>\$?([\d,]+\.\d{2})/i) || [])[1]);
  const tot = money((html.match(/Order Total:\s*<\/strong><\/td><td[^>]*><strong>\$?([\d,]+\.\d{2})/i) || [])[1]);
  const tax = taxRaw == null ? 0 : taxRaw;
  const sage = new Map();
  for (const row of det.aaData || []) {
    const code = (clean(row[11]) || clean(row[0])).toUpperCase();
    const qty = parseFloat(clean(row[2])) || 0;
    if (qty > 0) sage.set(code, qty);
  }
  const { data: items } = await sb.from('viele_order_items').select('item_code,order_quantity').eq('order_id', dbOrder.id);
  const diffs = [];
  for (const it of items) {
    const q = sage.get(it.item_code.toUpperCase());
    if (q === undefined) diffs.push(`${it.item_code}: nosotros ${it.order_quantity}, V&S no lo tiene`);
    else if (q !== Number(it.order_quantity)) diffs.push(`${it.item_code}: nosotros ${it.order_quantity}, V&S ${q}`);
  }
  for (const [code, q] of sage) if (!items.find((i) => i.item_code.toUpperCase() === code)) diffs.push(`${code}: V&S ${q}, nosotros no`);
  const finOk = net != null && tot != null && Math.abs(net - Number(dbOrder.subtotal_amount)) <= 0.011 && Math.abs(net + tax - tot) <= 0.011;
  const ok = diffs.length === 0 && sage.size === items.length && sage.size > 0 && finOk;
  return { no, ok, sage: sage.size, db: items.length, net, tax, tot, diffs, finOk };
}

async function main() {
  const { data: locks } = await sb.from('viele_checkout_requests').select('*').in('state', ['processing', 'recovery_required']);
  console.log(APPLY ? 'MODO: APLICAR' : 'MODO: SOLO LECTURA (usar --apply para liberar)', '| candados:', locks.map((l) => l.store_id).join(','));
  for (const lock of locks) {
    const nums = lock.result?.orderNumbers || [];
    console.log(`\n=== Tienda ${lock.store_id} (${lock.state}) ordenes ${nums.join(', ')} ===`);
    if (!nums.length || lock.state !== 'recovery_required') { console.log('  Sin ordenes emitidas o estado distinto: NO se toca.'); continue; }
    const cookie = await login(lock.store_id);
    const { data: dbOrders } = await sb.from('viele_orders').select('id,order_number,subtotal_amount,status').in('order_number', nums);
    const results = [];
    for (const o of dbOrders) results.push({ o, v: await verifyOrder(cookie, o) });
    for (const { v } of results) console.log(`  ${v.no}: V&S ${v.sage} renglones / DB ${v.db} | net ${v.net} tax ${v.tax} total ${v.tot} | ${v.ok ? 'COINCIDE' : 'NO COINCIDE ' + JSON.stringify(v.diffs)}`);
    const allOk = results.length === nums.length && results.every((r) => r.v.ok);
    console.log(allOk ? '  => VERIFICADA al 100% contra V&S' : '  => NO se libera (hay diferencias o falta alguna orden)');
    if (allOk && APPLY) {
      for (const { o, v } of results) {
        const { error } = await sb.from('viele_orders').update({ status: 'confirmed', subtotal_amount: v.net, tax_amount: v.tax, total_amount: v.tot }).eq('id', o.id);
        if (error) throw new Error('update viele_orders ' + o.order_number + ': ' + error.message);
      }
      const newResult = { ...lock.result, success: true, recoveryRequired: false, reconciledAt: new Date().toISOString(), reconciledBy: 'verificacion manual contra portal V&S (renglones y totales 1:1)' };
      const { error } = await sb.from('viele_checkout_requests').update({ state: 'completed', result: newResult, updated_at: new Date().toISOString() }).eq('request_key', lock.request_key);
      if (error) throw new Error('update request: ' + error.message);
      console.log('  => LIBERADA: request completed, ordenes confirmed con totales oficiales');
    }
  }
  const { data: after } = await sb.from('viele_checkout_requests').select('store_id,state').in('state', ['processing', 'recovery_required']);
  console.log('\nCandados activos al terminar:', JSON.stringify(after));
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });

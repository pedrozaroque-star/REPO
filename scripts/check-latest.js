const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve('.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
    const idx = l.indexOf('=');
    if (idx > 0 && !l.trim().startsWith('#')) {
      env[l.substring(0, idx).trim()] = l.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  });
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkLatest() {
  const { data: latest } = await supabase
    .from('supplier_price_history')
    .select('id, supplier_sku, case_price, created_at, source_type, created_by')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('=== 10 LATEST IN supplier_price_history ===');
  console.log(JSON.stringify(latest, null, 2));
}

checkLatest().catch(console.error);

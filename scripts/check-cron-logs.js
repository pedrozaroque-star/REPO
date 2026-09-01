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

async function checkCronLogs() {
  console.log('=== SUPPLIER SYNC LOGS ===');
  const { data: syncLogs } = await supabase
    .from('supplier_sync_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  console.log(JSON.stringify(syncLogs, null, 2));

  console.log('=== SUPPLIER PRICE HISTORY RECENT (AUG 30-31) ===');
  const { data: history } = await supabase
    .from('supplier_price_history')
    .select('*')
    .gte('created_at', '2026-08-30T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(20);
  console.log(JSON.stringify(history, null, 2));
}

checkCronLogs().catch(console.error);

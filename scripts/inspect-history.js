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

async function inspectHistory() {
  const { data: invHist } = await supabase
    .from('inventory_price_history')
    .select('*')
    .eq('inventory_item_id', 'd7d3d6f5-7426-49b0-8567-9d3b4f3c196f')
    .order('created_at', { ascending: false });
  console.log('=== INVENTORY PRICE HISTORY ===');
  console.log(JSON.stringify(invHist, null, 2));

  // Check quickbooks_mappings or sync logs
  const { data: qbMappings } = await supabase
    .from('quickbooks_mappings')
    .select('*')
    .eq('inventory_item_id', 'd7d3d6f5-7426-49b0-8567-9d3b4f3c196f');
  console.log('=== QB MAPPINGS ===');
  console.log(JSON.stringify(qbMappings, null, 2));
}

inspectHistory().catch(console.error);

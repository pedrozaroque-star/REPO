import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Querying position_activities...');
  const { data, error } = await supabase
    .from('position_activities')
    .select(`
      *,
      operating_procedures (
        activity,
        frequency,
        shift_type
      )
    `)
    .in('position_key', ['Caja 1 / Salón', 'Caja 2', 'Caja 3']);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${data.length} total mappings for Cajas:`);
  
  const byPosition: Record<string, any[]> = {};
  data.forEach((pa: any) => {
    if (!byPosition[pa.position_key]) byPosition[pa.position_key] = [];
    byPosition[pa.position_key].push({
      activity: pa.operating_procedures?.activity,
      frequency: pa.frequency,
      shift: pa.shift,
      model: pa.store_model
    });
  });

  Object.entries(byPosition).forEach(([pos, acts]) => {
    console.log(`\n--- Position: ${pos} (${acts.length} activities) ---`);
    acts.forEach((a, i) => {
      console.log(`  ${i+1}. [${a.frequency}][Shift: ${a.shift}][Model: ${a.model}] -> ${a.activity}`);
    });
  });
}

test();

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const { data, error } = await supabaseAdmin
    .from('operating_procedures')
    .select('*');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total activities: ${data.length}`);
  
  // Group activities by shift_type
  const groups: Record<string, any[]> = {};
  data.forEach(act => {
    if (!groups[act.shift_type]) groups[act.shift_type] = [];
    groups[act.shift_type].push(act);
  });

  for (const [type, list] of Object.entries(groups)) {
    console.log(`\nShift type: ${type} (count: ${list.length})`);
    console.log(list.slice(0, 5).map(a => `- ${a.activity} (Freq: ${a.frequency}, Shift: ${a.shift})`));
  }
}

test();

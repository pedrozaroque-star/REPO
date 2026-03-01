import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function test() {
    const { data } = await supabase.from('punches').select('breaks').not('breaks', 'is', 'null');
    const b = data.filter(d => Array.isArray(d.breaks));
    console.log(JSON.stringify(b[0], null, 2));
}
test();

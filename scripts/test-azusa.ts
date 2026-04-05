import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const {data: store} = await supabase.from('stores').select('id, name').ilike('name', '%azusa%').single();
    const {data} = await supabase.rpc('get_meat_history_avg', { p_store_id: store.id, p_dow: 6 });
    console.log('Azusa id:', store.id);
    console.log(data?.filter((d: any) => d.meat_type === 'ASADA' && d.interval_start === '18:00:00'));
}
run();

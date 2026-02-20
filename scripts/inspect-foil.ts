
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function inspectFoilItem() {
    const { data: item } = await supabase.from('inventory_items').select('*').eq('id', 'c037c42a-8ad9-4aed-a6da-5143ecdee737').single();
    console.log('--- FOIL DATA ---');
    console.log(JSON.stringify(item, null, 2));
}

inspectFoilItem();

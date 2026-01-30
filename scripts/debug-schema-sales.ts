
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkSchema() {
    // Fetch one row to see keys
    const { data } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .limit(1);

    if (data && data.length > 0) {
        console.log('Claves disponibles:', Object.keys(data[0]));
    } else {
        console.log('Tabla vacía o error.');
    }
}
checkSchema();

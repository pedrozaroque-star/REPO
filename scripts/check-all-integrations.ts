
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkAllIntegrations() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data } = await supabase.from('integrations').select('*');
    console.log('--- ALL INTEGRATIONS ---');
    console.log(JSON.stringify(data, null, 2));
}

checkAllIntegrations();

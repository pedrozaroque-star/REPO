
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkToken() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: integration } = await supabase
        .from('integrations')
        .select('updated_at, service_name')
        .eq('service_name', 'quickbooks')
        .single();

    console.log('Last token update:', integration?.updated_at);
}

checkToken();


import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkIntegrations() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
        .from('integrations')
        .select('*');

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('Integrations found:', data.length);
        console.log(JSON.stringify(data, null, 2));
    }
}

checkIntegrations();

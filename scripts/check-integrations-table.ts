
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkTable() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
        .from('integrations')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching from integrations:', error.message);
        if (error.message.includes('does not exist')) {
            console.log('The "integrations" table does not exist.');
        }
    } else {
        console.log('Integrations table exists. Found rows:', data.length);
    }
}

checkTable();

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkMappingSchema() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: sample } = await supabase
        .from('quickbooks_mappings')
        .select('*')
        .limit(1);
    
    if (sample?.length) {
        console.log('COLUMNS:', Object.keys(sample[0]).join(', '));
        console.log('SAMPLE:', JSON.stringify(sample[0], null, 2));
    }

    // Count total mappings
    const { count } = await supabase
        .from('quickbooks_mappings')
        .select('id', { count: 'exact', head: true });
    console.log(`\nTotal mappings: ${count}`);
}

checkMappingSchema();

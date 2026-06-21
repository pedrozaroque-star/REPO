import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findLettuce() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: items } = await supabase
        .from('inventory_items')
        .select('*')
        .or('name.ilike.%lettuce%,name.ilike.%lechuga%');
    
    console.log('=== LETTUCE ITEMS IN DB ===');
    console.log(items);
}

findLettuce();

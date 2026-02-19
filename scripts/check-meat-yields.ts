
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role key for admin access

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Missing Supabase URL or Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMeatYields() {
    console.log('Checking yield percentages for meat items...');

    try {
        const { data, error } = await supabase
            .from('inventory_items')
            .select('id, name, yield_percent, unit_measure')
            .or('name.ilike.%asada%,name.ilike.%beef%,name.ilike.%carne%,name.ilike.%diezmillo%')
            .order('name');

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            console.log('No meat items found matching criteria.');
            return;
        }

        console.log('\n--- Meat Inventory Items & Yields ---');
        console.table(data.map(item => ({
            Name: item.name,
            Yield: `${item.yield_percent}%`,
            'Is Yield Applied?': item.yield_percent < 100 ? 'YES (Cost increased)' : 'NO (Raw cost used)',
            Unit: item.unit_measure
        })));

    } catch (err: any) {
        console.error('Error fetching data:', err.message);
    }
}

checkMeatYields();

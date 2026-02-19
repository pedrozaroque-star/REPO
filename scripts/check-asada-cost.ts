
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Missing Supabase URL or Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAsadaCost() {
    console.log('--- COST ANALYSIS: ASADA ---');

    try {
        const { data, error } = await supabase
            .from('inventory_items')
            .select('name, purchase_unit_cost, quantity_per_unit, unit_measure')
            .or('name.ilike.%Carne Asada%')
            .maybeSingle();

        if (error) throw error;

        if (data) {
            console.log(`Product: ${data.name}`);
            console.log(`Purchase Unit Cost: $${data.purchase_unit_cost}`);
            console.log(`Quantity per Unit: ${data.quantity_per_unit} ${data.unit_measure}`);

            const costPerOzRaw = data.purchase_unit_cost / (data.quantity_per_unit * 16); // Assuming lb
            const costPerOzCooked = costPerOzRaw / 0.615; // 61.5% Yield

            console.log(`\nCost per Oz (RAW): $${costPerOzRaw.toFixed(4)}`);
            console.log(`Cost per Oz (COOKED): $${costPerOzCooked.toFixed(4)}`);
        } else {
            console.log('Item not found');
        }

    } catch (err: any) {
        console.error('Error:', err.message);
    }
}

checkAsadaCost();

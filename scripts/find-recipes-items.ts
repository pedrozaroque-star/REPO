
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function findRecipesUsingItems() {
    const itemIds = [
        'f73fe7a6-105c-4624-a87b-07d5f78c09ea', // Lima Bolsita
        'c037c42a-8ad9-4aed-a6da-5143ecdee737'  // Foil Sheets
    ];

    const { data: recipes } = await supabase.from('recipes').select('*').in('inventory_item_id', itemIds);

    console.log('Recipes using those items:');
    recipes?.forEach(r => {
        console.log(`Recipe ID: ${r.toast_menu_item_guid}`);
        console.log(` - Item: ${r.inventory_item_id === itemIds[0] ? 'Lima' : 'Foil'}`);
        console.log(` - Quantity: ${r.quantity}`);
        console.log(` - Unit: ${r.unit}`);
        console.log('------------------');
    });
}

findRecipesUsingItems();

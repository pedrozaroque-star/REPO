
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function createImportCategory() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: existing } = await supabase.from('inventory_categories').select('*').eq('name', 'QuickBooks Import').single();
    if (existing) {
        console.log('Category already exists:', existing.id);
        return;
    }

    const { data, error } = await supabase.from('inventory_categories').insert({
        name: 'QuickBooks Import',
        description: 'Items automatically imported from QuickBooks'
    }).select().single();

    if (error) {
        console.error('Error creating category:', error.message);
    } else {
        console.log('Category created:', data.id);
    }
}
createImportCategory();

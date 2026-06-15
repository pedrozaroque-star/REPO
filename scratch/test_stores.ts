import { supabase } from '../lib/supabase';

async function testStores() {
    console.log('Fetching stores...');
    try {
        const { data, error } = await supabase.from('stores').select('*').order('name');
        if (error) {
            console.error('❌ Query failed:', error.message);
        } else {
            console.log('✅ Stores retrieved successfully:', data?.length, 'stores found');
            console.log('First store:', data?.[0]);
            console.log('All stores:', data?.map(s => ({ id: s.id, name: s.name, external_id: s.external_id })));
        }
    } catch (err) {
        console.error('❌ Unexpected error:', err);
    }
}

testStores();

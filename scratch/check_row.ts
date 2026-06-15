import { supabaseAdmin } from '../lib/supabase';

async function checkRow() {
    console.log('Querying raw row...');
    try {
        const { data, error } = await supabaseAdmin
            .from('station_templates')
            .select('*')
            .eq('id', '1a1bcf35-a3da-4b12-855a-365bea871dd4')
            .single();

        if (error) {
            console.error('Error:', error);
        } else {
            console.log('Row keys:', Object.keys(data));
            console.log('Full row data:', data);
        }
    } catch (e) {
        console.error(e);
    }
}

checkRow();

import { supabaseAdmin } from '../lib/supabase';

async function checkSlausonMapping() {
    console.log('Fetching Slauson config template details...');
    try {
        const { data, error } = await supabaseAdmin
            .from('station_templates')
            .select('*')
            .eq('id', '1a1bcf35-a3da-4b12-855a-365bea871dd4')
            .single();

        if (error) {
            console.error('❌ Error:', error.message);
        } else {
            console.log('Template details:');
            console.log('ID:', data.id);
            console.log('Store ID:', data.store_id);
            console.log('Template Name:', data.template_name);
            console.log('Station Mappings type:', typeof data.station_mappings);
            console.log('Station Mappings value:', JSON.stringify(data.station_mappings, null, 2));
        }
    } catch (e) {
        console.error('Unexpected error:', e);
    }
}

checkSlausonMapping();

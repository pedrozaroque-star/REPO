import { supabaseAdmin } from '../lib/supabase';

async function viewSlausonMappings() {
    console.log('Fetching Slauson station mappings...');
    try {
        const { data, error } = await supabaseAdmin
            .from('station_templates')
            .select('*')
            .eq('id', '1a1bcf35-a3da-4b12-855a-365bea871dd4')
            .single();

        if (error) {
            console.error('Error:', error);
        } else {
            const mappings = data.data?.station_mappings || {};
            console.log('Slauson Mappings:');
            for (const [key, list] of Object.entries(mappings)) {
                console.log(`\n=== ${key} ===`);
                console.log(list);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

viewSlausonMappings();

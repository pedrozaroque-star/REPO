import { supabaseAdmin } from '../lib/supabase';

async function checkTemplates() {
    console.log('Querying station_templates...');
    try {
        const { data, error } = await supabaseAdmin
            .from('station_templates')
            .select('*');

        if (error) {
            console.error('❌ Error:', error.message);
        } else {
            console.log('✅ Retrieved', data?.length, 'templates');
            console.log('Templates summary:');
            data?.forEach(t => {
                console.log(`- ID: ${t.id}, Store: ${t.store_id}, Name: ${t.template_name}, Length: ${JSON.stringify(t.station_mappings)?.length || 0}`);
            });
            const configTemplate = data?.find(t => t.template_name === '__CONFIG_ACTIVITIES__');
            if (configTemplate) {
                console.log('Found __CONFIG_ACTIVITIES__ template! Keys in station_mappings:');
                console.log(Object.keys(configTemplate.station_mappings || {}));
            }
        }
    } catch (e) {
        console.error('Unexpected error:', e);
    }
}

checkTemplates();

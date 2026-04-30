import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function clone() {
    const SOURCE_STORE_ID = '7'; // Slauson
    
    // 1. Fetch all stores
    const { data: stores } = await supabase.from('stores').select('id, name').neq('id', SOURCE_STORE_ID);
    
    if (!stores) return console.log("No se encontraron tiendas");

    // 2. Fetch Source Mappings
    const { data: sourceData } = await supabase.from('station_templates')
        .select('data')
        .eq('store_id', SOURCE_STORE_ID)
        .eq('template_name', '__CONFIG_ACTIVITIES__')
        .maybeSingle();

    const sourceMappings = sourceData?.data?.station_mappings;
    
    if (!sourceMappings || Object.keys(sourceMappings).length === 0) {
        console.log("Slauson no tiene plantillas configuradas!");
        return;
    }

    console.log(`Clonando ${Object.keys(sourceMappings).length} plantillas de Slauson a ${stores.length} tiendas...`);

    // 3. Loop through all stores and overwrite their mappings
    for (const store of stores) {
        console.log(`- Sincronizando: ${store.name} (ID: ${store.id})`);
        
        // Obtenemos su data actual por si tienen un "master_activities" local legado
        const { data: currentData } = await supabase.from('station_templates')
            .select('data')
            .eq('store_id', store.id)
            .eq('template_name', '__CONFIG_ACTIVITIES__')
            .maybeSingle();

        const currentMaster = currentData?.data?.master_activities || [];
        
        const newConfigData = {
            master_activities: currentMaster,
            station_mappings: sourceMappings
        };

        // Upsert
        await supabase.from('station_templates').delete().eq('store_id', store.id).eq('template_name', '__CONFIG_ACTIVITIES__');
        await supabase.from('station_templates').insert([{
            store_id: store.id,
            template_name: '__CONFIG_ACTIVITIES__',
            data: newConfigData
        }]);
    }

    console.log("\n¡CLONACIÓN EXITOSA A TODA LA CADENA!");
}

clone();

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const CONFIG_NAME = '__CONFIG_ACTIVITIES__';

export async function POST(req: Request) {
    try {
        const { source_store_id, mappings } = await req.json();

        if (!source_store_id || !mappings) {
            return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 });
        }

        // Obtener todas las tiendas excepto la de origen y la "GLOBAL"
        const { data: stores, error: storesError } = await supabaseAdmin
            .from('stores')
            .select('id')
            .neq('id', source_store_id);

        if (storesError) throw storesError;

        if (!stores || stores.length === 0) {
            return NextResponse.json({ success: true, message: 'No hay otras tiendas para clonar' });
        }

        // Para cada tienda, mantener sus master_activities locales (si tuviera) y sobrescribir sus mappings
        for (const store of stores) {
            // Obtenemos data actual
            const { data: currentData } = await supabaseAdmin
                .from('station_templates')
                .select('data')
                .eq('store_id', store.id)
                .eq('template_name', CONFIG_NAME)
                .maybeSingle();

            const currentMaster = currentData?.data?.master_activities || [];

            const newConfigData = {
                master_activities: currentMaster,
                station_mappings: mappings
            };

            // Upsert eliminando primero
            await supabaseAdmin
                .from('station_templates')
                .delete()
                .eq('store_id', store.id)
                .eq('template_name', CONFIG_NAME);

            await supabaseAdmin
                .from('station_templates')
                .insert([{
                    store_id: store.id,
                    template_name: CONFIG_NAME,
                    data: newConfigData
                }]);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('CLONE MAPPINGS ERROR:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

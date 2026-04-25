import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const CONFIG_NAME = '__CONFIG_ACTIVITIES__';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const store_id = searchParams.get('store_id');

    if (!store_id) {
        return NextResponse.json({ error: 'Store ID is required' }, { status: 400 });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('station_templates')
            .select('data')
            .eq('store_id', store_id)
            .eq('template_name', CONFIG_NAME)
            .maybeSingle();

        if (error) throw error;

        // Si no existe, devolvemos estructura vacía
        if (!data) {
            return NextResponse.json({ master_activities: [], station_mappings: {} });
        }

        return NextResponse.json(data.data);
    } catch (error: any) {
        console.error('FETCH ACTIVITIES ERROR:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { store_id, master_activities, station_mappings } = await req.json();

        if (!store_id) {
            return NextResponse.json({ error: 'Store ID is required' }, { status: 400 });
        }

        const configData = { master_activities, station_mappings };

        // Intentamos upsert basado en store_id y template_name especial
        // Primero buscamos si existe para obtener el ID o simplemente borramos e insertamos (limpio)
        await supabaseAdmin
            .from('station_templates')
            .delete()
            .eq('store_id', store_id)
            .eq('template_name', CONFIG_NAME);

        const { error } = await supabaseAdmin
            .from('station_templates')
            .insert([{
                store_id,
                template_name: CONFIG_NAME,
                data: configData
            }]);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('SAVE ACTIVITIES ERROR:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

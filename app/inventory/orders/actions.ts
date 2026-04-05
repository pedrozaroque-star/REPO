'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// Función auxiliar para obtener el Lunes de una fecha dada
function getMonday(d: Date) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff)).toISOString().split('T')[0];
}

export async function fetchWeeklyOrdersData(storeId: number | string, dateStr: string) {
    const mondayStr = getMonday(new Date(dateStr));
    
    // Obtener los Items (Ordenados por display_order)
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type, display_order, excel_reference')
        .order('name', { ascending: true });

    // Obtener las Bases (PARES) de esta semana
    const { data: bases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr);

    // Obtener las Bases (PARES) de la semana pasada (por si clonamos)
    const lastWeekMonday = new Date(new Date(mondayStr).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Obtener Sobrantes (Counts) de la semana (Lunes a Domingo)
    // El domingo de esta semana es monday + 6 days
    const thisSunday = new Date(new Date(mondayStr).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const { data: counts } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId.toString())
        .gte('count_date', lastWeekMonday) // Traer desde la semana pasada (para obtener sobrante de domingos anteriores)
        .lte('count_date', thisSunday);

    return {
        items: items || [],
        bases: bases || [],
        counts: counts || [],
        currentMonday: mondayStr,
        lastWeekMonday
    };
}

// Acción para clonar las bases de la semana anterior a la actual
export async function clonePreviousWeekBases(storeId: number | string, targetMonday: string) {
    const lastWeekMonday = new Date(new Date(targetMonday).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Traer la de la semana pasada
    const { data: oldBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', lastWeekMonday);

    if (!oldBases || oldBases.length === 0) {
        return { error: 'No se encontraron bases de la semana anterior para copiar.' };
    }

    // Insertar para la nueva semana
    const newBases = oldBases.map((b) => ({
        store_id: storeId,
        inventory_item_id: b.inventory_item_id,
        week_start_date: targetMonday,
        mon_par: b.mon_par, tue_par: b.tue_par, wed_par: b.wed_par,
        thu_par: b.thu_par, fri_par: b.fri_par, sat_par: b.sat_par, sun_par: b.sun_par
    }));

    const { error } = await supabase.from('inventory_weekly_bases').upsert(newBases, { onConflict: 'store_id, inventory_item_id, week_start_date' });
    
    if (error) return { error: error.message };
    
    revalidatePath('/inventory/orders');
    return { success: true };
}

// Guardar o actualizar Bases Individuales
export async function updateWeeklyBase(storeId: number | string, itemId: string, mondayStr: string, field: string, value: number) {
    const payload: any = {
        store_id: storeId,
        inventory_item_id: itemId,
        week_start_date: mondayStr
    };
    payload[field] = value;

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(payload, { onConflict: 'store_id, inventory_item_id, week_start_date' });
        
    if (error) console.error("Error update base", error);
}

// Guardar o actualizar Sobrante Diario
export async function updateDailyLeftover(storeId: string, itemId: string, dateStr: string, value: number) {
    const { error } = await supabase
        .from('inventory_counts')
        .upsert({
            store_id: storeId,
            inventory_item_id: itemId,
            count_date: dateStr,
            quantity_on_hand: value
        }, { onConflict: 'store_id, inventory_item_id, count_date' });

    if (error) console.error("Error update count", error);
}

// Vincular Item del Excel con Item de BD
export async function linkExcelItem(itemId: string, excelName: string) {
    // Primero, limpiamos si algún otro item ya tenía este nombre
    await supabase.from('inventory_items').update({ excel_reference: null }).eq('excel_reference', excelName);
    // Asignamos al item elegido
    const { error } = await supabase.from('inventory_items').update({ excel_reference: excelName }).eq('id', itemId);
    if (error) return { error: error.message };
    revalidatePath('/inventory/orders');
    return { success: true };
}

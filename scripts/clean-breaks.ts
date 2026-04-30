import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function cleanBreaks() {
    console.log("Limpiando breaks_schedule de esta semana...");
    
    // Suponemos la semana actual, desde hoy hasta los próximos 7 días
    const today = new Date();
    const startStr = today.toISOString().split('T')[0];
    
    const end = new Date();
    end.setDate(end.getDate() + 7);
    const endStr = end.toISOString().split('T')[0];

    let allShifts: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('shifts')
            .select('id, store_id')
            .gte('shift_date', startStr)
            .lte('shift_date', endStr)
            .range(from, from + pageSize - 1);
            
        if (error) {
            console.error('Error fetching shifts:', error);
            break;
        }
        
        if (data) allShifts = [...allShifts, ...data];
        if (!data || data.length < pageSize) {
            hasMore = false;
        } else {
            from += pageSize;
        }
    }
    
    const shifts = allShifts;
    console.log(`Se encontraron ${shifts.length} turnos totales en esta fecha.`);

    console.log(`Borrando breaks_schedule para ${shifts.length} turnos...`);
    
    // Update in chunks of 500 to avoid limits
    let updatedCount = 0;
    const chunkSize = 500;
    for (let i = 0; i < shifts.length; i += chunkSize) {
        const chunk = shifts.slice(i, i + chunkSize);
        const ids = chunk.map(s => s.id);
        
        const { error: err } = await supabase
            .from('shifts')
            .update({ breaks_schedule: [] })
            .in('id', ids);
            
        if (err) {
            console.error('Error al limpiar:', err);
        } else {
            updatedCount += chunk.length;
            console.log(`Limpio ${updatedCount} / ${shifts.length}`);
        }
    }
    
    console.log("¡Limpieza de la semana actual terminada exitosamente!");
}

cleanBreaks();

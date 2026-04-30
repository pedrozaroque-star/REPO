import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function run() {
    const startDate = '2026-04-27'; // Lunes
    const endDate = '2026-05-03';   // Domingo

    console.log(`Buscando turnos calculados entre ${startDate} y ${endDate}...`)

    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('id, store_id, shift_date, breaks_schedule, start_time, end_time')
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)

    if (error) {
        console.error('Error:', error)
        return
    }

    const calculatedShifts = shifts.filter(s => s.breaks_schedule && Array.isArray(s.breaks_schedule) && s.breaks_schedule.length > 0)
    
    console.log(`Se encontraron ${calculatedShifts.length} turnos con descansos ya calculados en esta semana.`);

    const storesSet = new Set<string>();
    calculatedShifts.forEach(s => storesSet.add(s.store_id));

    console.log(`Tiendas afectadas: ${Array.from(storesSet).join(', ')}`);

    if (calculatedShifts.length === 0) {
        console.log("No hay nada que limpiar.");
        return;
    }

    // Limpiar los breaks en chunks de 100
    console.log("\nLimpiando breaks en la base de datos...");
    const idsToClean = calculatedShifts.map(s => s.id);
    const chunkSize = 100;
    
    for (let i = 0; i < idsToClean.length; i += chunkSize) {
        const chunk = idsToClean.slice(i, i + chunkSize);
        console.log(`Limpiando chunk ${i / chunkSize + 1} de ${Math.ceil(idsToClean.length / chunkSize)}...`);
        const { error: updateError } = await supabase
            .from('shifts')
            .update({ breaks_schedule: [] })
            .in('id', chunk);

        if (updateError) {
            console.error("Error al limpiar el chunk:", updateError);
            return;
        }
    }

    console.log("¡Limpieza completada! Todos los breaks han sido reiniciados a [].");
    console.log("\nPara el recálculo, al visitar la página de cada tienda en la Tableta, el motor regenerará los descansos automáticamente con la nueva regla priorizando turnos cortos.");
}

run();

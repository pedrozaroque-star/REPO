import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { scheduleBreaksWithDemand } from '../lib/breaks-engine'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

// Dummy operating hours for the engine (El engine actual de breaks_engine solo usa esto para "calificar" los slots, si le pasamos dummy funciona perfecto usando la lógica interna)
const dummyOpHours = Array.from({ length: 24 }).map((_, i) => ({
    hour: i,
    projectedSales: 1000,
    projectedTickets: 100
}))

async function run() {
    const startDate = '2026-04-27'; // Lunes
    const endDate = '2026-05-03';   // Domingo

    console.log(`Buscando todos los turnos entre ${startDate} y ${endDate}...`)

    let allShifts: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)
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
    console.log(`Se descargaron ${shifts.length} turnos.`);

    const { data: jobs } = await supabase.from('toast_jobs').select('id, guid, title');
    const jobsMap = new Map();
    jobs?.forEach(j => {
        jobsMap.set(j.guid, j.title);
        jobsMap.set(String(j.id), j.title);
    });

    shifts.forEach(s => {
        if (s.job_id && jobsMap.has(s.job_id)) {
            s.job_title = jobsMap.get(s.job_id);
        } else {
            s.job_title = 'cook'; // Failsafe (Cook = boh)
        }
    });

    // Filtramos solo para las 12 tiendas que afectamos antes (sacadas del log de limpieza)
    const affectedStores = new Set([
        'acf15327-54c8-4da4-8d0d-3ac0544dc422', '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
        '42ed15a6-106b-466a-9076-1e8f72451f6b', 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
        '8685e942-3f07-403a-afb6-faec697cd2cb', '3a803939-eb13-4def-a1a4-462df8e90623',
        '47256ade-2cd4-4073-9632-84567ad9e2c8', 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
        '9625621e-1b5e-48d7-87ae-7094fab5a4fd', '5fbb58f5-283c-4ea4-9415-04100ee6978b',
        '80a1ec95-bc73-402e-8884-e5abbe9343e6', '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'
    ]);

    // Agrupar por tienda y por fecha para procesarlos por dia como lo hace la UI
    const grouped = new Map<string, any[]>();
    shifts.forEach(s => {
        if (!s.store_id || !s.shift_date) return;
        if (!affectedStores.has(s.store_id)) return; // Solo procesar las que limpiamos
        
        const key = `${s.store_id}_${s.shift_date}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(s);
    });

    console.log(`Se encontraron ${grouped.size} combinaciones de Tienda/Día para recalcular.`);

    let totalUpdated = 0;

    for (const [key, dayShifts] of grouped.entries()) {
        const [storeId, shiftDate] = key.split('_');
        console.log(`Procesando Tienda ${storeId} para el día ${shiftDate} (${dayShifts.length} turnos)...`);
        
        // Ejecutar el motor localmente
        const calculatedShifts = scheduleBreaksWithDemand(dayShifts, dummyOpHours as any);
        
        // Guardar en la bd
        for (const s of calculatedShifts) {
            if (s.id === '49dff2ff-c785-4283-8bfd-41d2d57eaf24') {
                console.log("SHIFT DE MARINA ENCONTRADO EN", key);
                console.log("BREAKS CALCULADOS:", s.breaks_schedule);
            }
            if (s.breaks_schedule && s.breaks_schedule.length > 0) {
                const { error } = await supabase.from('shifts').update({ breaks_schedule: s.breaks_schedule }).eq('id', s.id);
                if (error) {
                    console.error("Update error:", error);
                }
                totalUpdated++;
            }
        }
    }
    
    console.log(`¡Recálculo exitoso! Se actualizaron ${totalUpdated} turnos con las nuevas reglas de breaks en la base de datos.`);
}

run();

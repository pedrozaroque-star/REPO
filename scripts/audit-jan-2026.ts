
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';

// 1. Cargar Entorno
const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Palabras clave para detectar roles
const KITCHEN_ROLES = ['COOK', 'PREP', 'COCINA', 'PARRILLA', 'TAQUERO', 'DISH', 'LAVALOZA'];
const FOH_ROLES = ['CASHIER', 'CAJERA', 'FRONT', 'SERVER', 'MESERA', 'MOSTRADOR', 'FOH'];
const LEADERSHIP_ROLES = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO'];

async function validateMonth() {
    console.log('🔍 INICIANDO AUDITORÍA MASIVA DE DATOS DESCARGADOS\n');
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood ID

    // Pre-cargar Jobs map
    const { data: allJobs } = await supabase.from('toast_jobs').select('guid, title');
    const jobMap = new Map<string, string>();
    allJobs?.forEach(j => {
        jobMap.set(j.guid, j.title);
    });

    // Encabezados de Tabla
    console.log(
        '| Fecha | Hora Pico | Venta Real | IA (Sug) | Math (Req) | Staff (Cocina + Líderes) | Carga/Persona | Est |'
    );
    console.log('|---|---|---|---|---|---|---|---|');

    // Escanear Enero 1-31
    for (let d = 1; d <= 31; d++) {
        const dayStr = d.toString().padStart(2, '0');
        const dateStr = `2026-01-${dayStr}`;

        // 1. Verificar si tenemos Punches (Si no, saltar)
        const { data: punches } = await supabase
            .from('punches')
            .select('*')
            .eq('store_id', storeId)
            .eq('business_date', dateStr);

        if (!punches || punches.length === 0) continue;

        // 2. Traer Ventas Reales (Solo si hay punches)
        const { data: realData } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, hourly_data, hourly_tickets')
            .eq('store_id', storeId)
            .eq('business_date', dateStr)
            .maybeSingle();

        if (!realData) continue;

        // 3. Identificar Hora Pico
        let peakHour = 18; // Default
        let maxSales = 0;
        const hourly = realData.hourly_data || {};
        Object.entries(hourly).forEach(([h, val]) => {
            if (Number(val) > maxSales) {
                maxSales = Number(val);
                peakHour = Number(h);
            }
        });

        // D. CENSOS REALES
        let pureCooks = 0;
        let pureCashiers = 0;
        let supportStaff = 0; // Leaders + Managers

        const isPresent = (p: any) => {
            const inTime = new Date(p.clock_in).getTime();
            const outTime = p.clock_out ? new Date(p.clock_out).getTime() : inTime + (8 * 3600 * 1000);
            // UTC Logic
            const baseDate = new Date(dateStr);
            const peakTimeUTC = baseDate.getTime() + ((peakHour + 8) * 60 * 60 * 1000) + (30 * 60 * 1000);
            const overlapStart = Math.max(inTime, peakTimeUTC - 1800000);
            const overlapEnd = Math.min(outTime, peakTimeUTC + 1800000);
            return overlapEnd > overlapStart;
        };

        if (punches) {
            pureCooks = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return KITCHEN_ROLES.some(k => title.includes(k)) && isPresent(p);
            }).length;

            pureCashiers = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                // Excluimos líderes explícitos de aquí si cayeran en ambos, pero los arrays son disjuntos
                return FOH_ROLES.some(k => title.includes(k)) && isPresent(p);
            }).length;

            supportStaff = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return LEADERSHIP_ROLES.some(k => title.includes(k)) && isPresent(p);
            }).length;
        }

        // ASIGNACIÓN LÓGICA DE SOPORTE (La regla que me diste: 2 y 2)
        // Asumimos que el soporte se divide proporcionalmente o 50/50 si no sabemos.
        // Dado que dijiste "2 FOH, 2 BOH", asignaremos mitad y mitad del soporte encontrado.
        const supportKitchen = Math.round(supportStaff / 2);
        const supportFOH = supportStaff - supportKitchen;

        const totalKitchen = pureCooks + supportKitchen;
        const totalFOH = pureCashiers + supportFOH;

        // CÁLCULO DE EFICIENCIA
        // Cocina: Meta $211
        const kitchenLoad = totalKitchen > 0 ? Math.round(maxSales / totalKitchen) : 0;
        let kIcon = '🟢';
        if (kitchenLoad > 225) kIcon = '🟡';
        if (kitchenLoad > 260) kIcon = '🔴';
        if (kitchenLoad < 150) kIcon = '�'; // Desperdicio ($150 es muy bajo para cocina)

        // Cajas: Meta 18.3 tix
        // Usamos maxTickets que calculamos mentalmente o sacamos de sales data si existe
        // Necesito maxTickets... lo sacaré de hourly_tickets
        let maxTickets = 0;
        const hourlyTx = realData.hourly_tickets || {};
        Object.values(hourlyTx).forEach(v => maxTickets = Math.max(maxTickets, Number(v)));

        const fohLoad = totalFOH > 0 ? (maxTickets / totalFOH).toFixed(1) : "0";
        let fIcon = '🟢';
        if (Number(fohLoad) > 20) fIcon = '🟡';
        if (Number(fohLoad) > 25) fIcon = '🔴';
        if (Number(fohLoad) < 10) fIcon = '🔵'; // Desperdicio (< 10 tickets/hora es nada)

        console.log(
            `| ${dateStr.slice(5)} | Kitch: ${totalKitchen} ($${kitchenLoad}) ${kIcon} | FOH: ${totalFOH} (${fohLoad} tix) ${fIcon} | Soporte Total: ${supportStaff} |`
        );
    }
}

validateMonth().catch(console.error);

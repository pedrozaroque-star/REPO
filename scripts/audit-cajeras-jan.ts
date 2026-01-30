
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

// CAPACIDAD (Desde intelligence.ts)
const TICKETS_PER_CASHIER = 18.3;

// ROLES DE FOH (Front of House)
const FOH_ROLES = ['CASHIER', 'CAJERA', 'FRONT', 'SERVER', 'MESERA', 'MOSTRADOR', 'FOH'];
// Nota: Excluyo Managers aquí, a menos que quieras ver "Soporte" también. 
// Por ahora auditamos Cajeras puras.

async function auditCashiers() {
    console.log('🔍 INICIANDO AUDITORÍA DE CAJERAS (Enero 2026)\n');
    console.log(`ℹ️  Regla de Capacidad: ${TICKETS_PER_CASHIER} tickets/hora por cajera.\n`);

    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood ID

    // Pre-cargar Jobs map
    const { data: allJobs } = await supabase.from('toast_jobs').select('guid, title');
    const jobMap = new Map<string, string>();
    allJobs?.forEach(j => {
        jobMap.set(j.guid, j.title);
    });

    console.log(
        '| Fecha | Hora | Tickets | IA (Sug) | Math (Req) | Cajeras (Real) | Carga/Cajera | Est |'
    );
    console.log('|---|---|---|---|---|---|---|---|');

    // Escanear Enero 1-31
    for (let d = 1; d <= 31; d++) {
        const dayStr = d.toString().padStart(2, '0');
        const dateStr = `2026-01-${dayStr}`;

        // 1. Verificar si tenemos Punches 
        const { data: punches } = await supabase
            .from('punches')
            .select('*')
            .eq('store_id', storeId)
            .eq('business_date', dateStr);

        if (!punches || punches.length === 0) continue;

        // 2. Traer Datos Reales (Inc. Tickets)
        const { data: realData } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, hourly_data, hourly_tickets') // <-- hourly_tickets IMPORTANTE
            .eq('store_id', storeId)
            .eq('business_date', dateStr)
            .maybeSingle();

        if (!realData || !realData.hourly_tickets) continue;

        // 3. Identificar Hora Pico de TICKETS (Puede ser diferente a Venta)
        let peakHour = 18;
        let maxTickets = 0;
        const hourlyTx = realData.hourly_tickets || {};

        // Buscar el pico máximo de transacciones
        Object.entries(hourlyTx).forEach(([h, val]) => {
            if (Number(val) > maxTickets) {
                maxTickets = Number(val);
                peakHour = Number(h);
            }
        });

        // 4. Pronóstico IA (Front of House)
        const forecast = await generateSmartForecast(storeId, dateStr);
        const iaSuggestion = forecast ? (forecast.hours.find(h => h.hour === peakHour)?.required_foh || 0) : 0;

        // 5. Math Requerimiento (Realidad)
        const mathRequirement = Math.ceil(maxTickets / TICKETS_PER_CASHIER);

        // 6. Contar Cajeras Reales en Hora Pico
        let cashiersOnFloor = 0;

        const isPresent = (p: any) => {
            const inTime = new Date(p.clock_in).getTime();
            const outTime = p.clock_out ? new Date(p.clock_out).getTime() : inTime + (8 * 3600 * 1000);
            // UTC Logic (PST +8h offset)
            const baseDate = new Date(dateStr);
            const peakTimeUTC = baseDate.getTime() + ((peakHour + 8) * 60 * 60 * 1000) + (30 * 60 * 1000);

            const overlapStart = Math.max(inTime, peakTimeUTC - 1800000);
            const overlapEnd = Math.min(outTime, peakTimeUTC + 1800000);
            return overlapEnd > overlapStart;
        };

        if (punches) {
            cashiersOnFloor = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return FOH_ROLES.some(k => title.includes(k)) && isPresent(p);
            }).length;
        }

        const realLoad = cashiersOnFloor > 0 ? (maxTickets / cashiersOnFloor).toFixed(1) : "0";

        let loadIcon = '🟢';
        if (Number(realLoad) > 20) loadIcon = '🟡'; // > 20 tix/hr (Pesado)
        if (Number(realLoad) > 25) loadIcon = '🔴'; // > 25 tix/hr (Crítico)

        console.log(
            `| ${dateStr.slice(5)} | ${peakHour}:00 | ${maxTickets} tix | ${iaSuggestion} | ${mathRequirement} | **${cashiersOnFloor}** | ${realLoad} tix/hr | ${loadIcon} |`
        );
    }
}

auditCashiers().catch(console.error);

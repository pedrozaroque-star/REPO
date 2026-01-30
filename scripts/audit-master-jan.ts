
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// 1. Cargar Entorno
const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// CONSTANTES DE CAPACIDAD
const KITCHEN_LIMIT = 211; // $/hora ideal
const FOH_LIMIT = 18.3;    // tickets/hora ideal

// ROLES
const KITCHEN_ROLES = ['COOK', 'PREP', 'COCINA', 'PARRILLA', 'TAQUERO', 'DISH', 'LAVALOZA'];
const FOH_ROLES = ['CASHIER', 'CAJERA', 'FRONT', 'SERVER', 'MESERA', 'MOSTRADOR', 'FOH'];
const LEADERSHIP_ROLES = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO'];

async function masterAudit() {
    console.log('🔍 AUDITORÍA MAESTRA DE EFICIENCIA (Enero 2026)\n');
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

    // Pre-cargar Jobs map
    const { data: allJobs } = await supabase.from('toast_jobs').select('guid, title');
    const jobMap = new Map<string, string>();
    allJobs?.forEach(j => {
        jobMap.set(j.guid, j.title);
    });

    console.log(
        '| Fecha | Cocina (Real+Soporte) | Carga | Est | Cajas (Real+Soporte) | Carga | Est | Soporte Total |'
    );
    console.log('|---|---|---|---|---|---|---|---|');

    // Escanear Enero 1-31
    for (let d = 1; d <= 31; d++) {
        const dayStr = d.toString().padStart(2, '0');
        const dateStr = `2026-01-${dayStr}`;

        // 1. Verificar Punches
        const { data: punches } = await supabase
            .from('punches')
            .select('*')
            .eq('store_id', storeId)
            .eq('business_date', dateStr);

        if (!punches || punches.length === 0) continue;

        // 2. Traer Ventas (Incluir hourly_tickets)
        const { data: realData } = await supabase
            .from('sales_daily_cache')
            .select('net_sales, hourly_data, hourly_tickets')
            .eq('store_id', storeId)
            .eq('business_date', dateStr)
            .maybeSingle();

        if (!realData) continue;

        // 3. Hallar horas pico independientes (Cocina vs Cajas)
        // Cocina -> Pico de Ventas ($)
        let peakHourSales = 18;
        let maxSales = 0;
        const hSales = realData.hourly_data || {};
        Object.entries(hSales).forEach(([h, val]) => {
            if (Number(val) > maxSales) {
                maxSales = Number(val);
                peakHourSales = Number(h);
            }
        });

        // Cajas -> Pico de Tickets (#)
        let peakHourTix = 18;
        let maxTickets = 0;
        const hTx = realData.hourly_tickets || {};
        Object.entries(hTx).forEach(([h, val]) => {
            if (Number(val) > maxTickets) {
                maxTickets = Number(val);
                peakHourTix = Number(h);
            }
        });

        // 4. Contar Personal (Distribuir Soporte)
        const isPresent = (p: any, targetHour: number) => {
            const inTime = new Date(p.clock_in).getTime();
            const outTime = p.clock_out ? new Date(p.clock_out).getTime() : inTime + (8 * 3600 * 1000);

            // UTC Logic
            const baseDate = new Date(dateStr);
            const peakTimeUTC = baseDate.getTime() + ((targetHour + 8) * 60 * 60 * 1000) + (30 * 60 * 1000);
            const overlapStart = Math.max(inTime, peakTimeUTC - 1800000);
            const overlapEnd = Math.min(outTime, peakTimeUTC + 1800000);
            return overlapEnd > overlapStart;
        };

        let pureCooks = 0;
        let pureCashiers = 0;
        let leadersSalesPeak = 0;
        let leadersTixPeak = 0;

        if (punches) {
            pureCooks = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return KITCHEN_ROLES.some(k => title.includes(k)) && isPresent(p, peakHourSales);
            }).length;

            pureCashiers = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return FOH_ROLES.some(k => title.includes(k)) && isPresent(p, peakHourTix);
            }).length;

            // Líderes presentes en cada pico (pueden ser los mismos o cambiar si horas son diferentes)
            leadersSalesPeak = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return LEADERSHIP_ROLES.some(k => title.includes(k)) && isPresent(p, peakHourSales);
            }).length;

            leadersTixPeak = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return LEADERSHIP_ROLES.some(k => title.includes(k)) && isPresent(p, peakHourTix);
            }).length;
        }

        // REPARTO DE SOPORTE (50/50 o mitades enteras)
        const supportKitchen = Math.round(leadersSalesPeak / 2); // 5 -> 3
        const totalKitchen = pureCooks + supportKitchen;

        // Soporte Cajas (el resto de los líderes presentes a esa hora)
        // Nota: Si pico de ventas != pico tickets, "leadersSalesPeak" != "leadersTixPeak".
        // Asumimos mismas reglas de reparto.
        const supportFOH = Math.round(leadersTixPeak / 2);
        const totalFOH = pureCashiers + supportFOH;

        // CÁLCULO CARGA
        const kLoad = totalKitchen > 0 ? Math.round(maxSales / totalKitchen) : 0;
        let kIcon = '🟢';
        if (kLoad > 230) kIcon = '🟡';
        if (kLoad > 260) kIcon = '🔴';
        if (kLoad < 150) kIcon = '🔵'; // < $150/per = WASTE

        const fLoad = totalFOH > 0 ? (maxTickets / totalFOH).toFixed(1) : "0";
        let fIcon = '🟢';
        if (Number(fLoad) > 20) fIcon = '🟡';
        if (Number(fLoad) > 25) fIcon = '🔴';
        if (Number(fLoad) < 10) fIcon = '🔵'; // < 10 tix/per = WASTE

        console.log(
            `| ${dateStr.slice(5)} | ${pureCooks} + ${supportKitchen} = **${totalKitchen}** | $${kLoad} | ${kIcon} | ${pureCashiers} + ${supportFOH} = **${totalFOH}** | ${fLoad} tix | ${fIcon} | ${Math.max(leadersSalesPeak, leadersTixPeak)} Líderes |`
        );
    }
}

masterAudit().catch(console.error);

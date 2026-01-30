
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const KITCHEN_ROLES = ['COOK', 'PREP', 'COCINA', 'PARRILLA', 'TAQUERO', 'DISH', 'LAVALOZA'];
const FOH_ROLES = ['CASHIER', 'CAJERA', 'FRONT', 'SERVER', 'MESERA', 'MOSTRADOR', 'FOH'];
const LEADERSHIP_ROLES = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO'];

async function auditHourlyDetail() {
    const targetDate = '2026-01-18'; // DOMINGO 18
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood

    console.log(`🔍 DETALLE HORARIO CORREGIDO: ${targetDate} (Domingo)\n`);

    // 1. Cargar Jobs
    const { data: allJobs } = await supabase.from('toast_jobs').select('guid, title');
    const jobMap = new Map<string, string>();
    allJobs?.forEach(j => jobMap.set(j.guid, j.title));

    // 2. Cargar Ventas/Tickets
    const { data: realData } = await supabase
        .from('sales_daily_cache')
        .select('hourly_data, hourly_tickets')
        .eq('store_id', storeId)
        .eq('business_date', targetDate)
        .single();

    if (!realData) { console.log("No data"); return; }

    // 3. Cargar Staff (Punches de ese Business Date)
    const { data: punches } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', storeId)
        .eq('business_date', targetDate);

    console.log('| Hora | Ventas | Staff (Coc+Caj+Lid) | Carga Cocina | Carga Cajas | Eficiencia |');
    console.log('|---|---|---|---|---|---|');

    // Analizar desde 8:00 AM hasta 2:00 AM del día siguiente (Horas 8 a 26)
    for (let h = 8; h <= 26; h++) {
        // Manejo de horas > 23 (Madrugada)
        const hourLabel = h < 12 ? `${h}am` : h === 12 ? `12pm` : h < 24 ? `${h - 12}pm` : `${h - 24}am`;

        // Ventas: Toast suele guardar 00, 01, 02... si pertenece al business date, hay que ver el mapping.
        // Si h >= 24, buscamos h-24. 
        // IMPORTANTE: sales_daily_cache suele tener llaves "0", "1"... "23". 
        // Las ventas de madrugada a veces caen en el día siguiente o en "0", "1" de este business date.
        // Asumiremos h % 24 para buscar en el objeto json.
        const headerKey = (h % 24).toString();
        const sales = Number(realData.hourly_data?.[headerKey] || 0);
        const tix = Number(realData.hourly_tickets?.[headerKey] || 0);

        // CALCULO DEL TIEMPO EXACTO PARA STAFF (UTC-8 Fijo)
        // Si h >= 24, sumamos 1 día a la fecha base
        const datePart = h < 24 ? targetDate : addDay(targetDate);
        const hourPart = h % 24;

        // Construimos ISO string con Offset Fijo de California
        const timeStr = `${datePart}T${hourPart.toString().padStart(2, '0')}:30:00-08:00`;
        const checkTimeUTC = new Date(timeStr).getTime();

        let cooks = 0, cashiers = 0, leaders = 0;

        if (punches) {
            cooks = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return KITCHEN_ROLES.some(k => title.includes(k)) && isWorking(p, checkTimeUTC);
            }).length;

            cashiers = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return FOH_ROLES.some(k => title.includes(k)) && isWorking(p, checkTimeUTC);
            }).length;

            leaders = punches.filter(p => {
                const title = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return LEADERSHIP_ROLES.some(k => title.includes(k)) && isWorking(p, checkTimeUTC);
            }).length;
        }

        // Reparto Soporte
        const supportK = Math.round(leaders / 2);
        const supportF = leaders - supportK;
        const totalK = cooks + supportK;
        const totalF = cashiers + supportF;

        // Metricas
        const kLoad = totalK > 0 ? Math.round(sales / totalK) : 0;
        const fLoad = totalF > 0 ? (tix / totalF).toFixed(1) : "0";

        let icon = '🟢';
        if ((kLoad < 150 && totalK > 2) && (Number(fLoad) < 10 && totalF > 2)) icon = '🔵'; // Desperdicio (Si hay >2 staff)
        if (kLoad > 260 || Number(fLoad) > 25) icon = '🔴'; // Crisis

        // Formato para mostrar
        if (cooks + cashiers + leaders > 0 || sales > 0) {
            console.log(`| ${hourLabel} | $${sales} (${tix}tx) | ${cooks}+${cashiers}+${leaders} = **${cooks + cashiers + leaders}** | $${kLoad} | ${fLoad} tix | ${icon} |`);
        }
    }
}

function addDay(dateStr: string) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

function isWorking(p: any, timeUTC: number) {
    const inTime = new Date(p.clock_in).getTime();
    // Si no hay clock_out, asumimos 10 horas de turno para seguridad, o hasta el final del dia
    const outTime = p.clock_out ? new Date(p.clock_out).getTime() : inTime + (12 * 3600 * 1000);
    return timeUTC >= inTime && timeUTC <= outTime;
}

auditHourlyDetail().catch(console.error);

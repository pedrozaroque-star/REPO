
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// DEFINICIÓN DE STAFF
// El modelo Smart calcula "Cabezas Totales" necesarias.
// Asumimos que dentro de ese número YA se incluye el soporte necesario (1 líder por cada area si es complejo).

const KITCHEN_ROLES = ['COOK', 'PREP', 'COCINA', 'PARRILLA', 'TAQUERO', 'DISH', 'LAVALOZA'];
const FOH_ROLES = ['CASHIER', 'CAJERA', 'FRONT', 'SERVER', 'MESERA', 'MOSTRADOR', 'FOH'];
const LEADERSHIP_ROLES = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO'];

async function optimizationReport() {
    const targetDate = '2026-01-18'; // Domingo
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6';

    console.log(`⚖️  COMPARATIVA OPTIMIZACIÓN: ${targetDate} (Domingo)\n`);

    // 1. Obtener Recomendación Inteligente
    const forecast = await generateSmartForecast(storeId, targetDate);

    // 2. Obtener Realidad (Punches)
    const { data: punches } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', storeId)
        .eq('business_date', targetDate);

    const { data: allJobs } = await supabase.from('toast_jobs').select('guid, title');
    const jobMap = new Map();
    allJobs?.forEach(j => jobMap.set(j.guid, j.title));

    console.log('| Hora | Venta Proy | COCINA: Ideal vs Real | CAJAS: Ideal vs Real | Diferencia Total | Ahorro Potencial |');
    console.log('|---|---|---|---|---|---|');

    let totalOverstaffHours = 0;
    let totalUnderstaffHours = 0;

    for (const hourObj of forecast.hours) {
        const h = hourObj.hour;
        if (h < 8 && h > 2) continue; // Ignorar madrugada inactiva si quieres, o ajustar rango

        // Ajuste visual hora
        const hLabel = h > 12 ? `${h - 12}pm` : h === 12 ? `12pm` : h === 0 ? `12am` : h < 0 ? `Undef` : `${h}am`;

        // --- REALIDAD ---
        // Calcular Staff Real en el punto medio de la hora
        // Ajuste UTC-8
        // Si hora es 0, 1, 2 (madrugada siguiente dia)
        // NOTA: forecast.hours va de 0 a 23. 
        // El script anterior usaba 24, 25, 26.
        // Mapearemos 0, 1, 2 del forecast al cierre real.

        let checkDateStr = targetDate;
        if (h < 4) { // Madrugada (0am, 1am, 2am, 3am) se considera "cierre" del día negocio
            // En business_date '2026-01-18', la hora 0 es 00:00 del 19.
            // checkDateStr = nextDay; 
            // PERO: generateSmartForecast devuelve 0-23 del día calendario normal?? 
            // REVISAR LIB INTELLIGENCE.
            // Standard business hours logic usually maps 0-23.
            // Asumiremos que h=0 es medianoche al INICIO del día?? No, usually end.
            // Vamos a usar la lógica simple: h es hora reloj.
        }

        // Corrección Rápida: Usaremos logic de Staff Real idéntica al script anterior
        let searchDate = targetDate;
        let searchHour = h;
        if (h < 6) {
            // Si es madrugada (0-5am), es *siguiente dia* calendario, pero mismo business date
            const d = new Date(targetDate);
            d.setDate(d.getDate() + 1);
            searchDate = d.toISOString().split('T')[0];
        }

        const timeStr = `${searchDate}T${searchHour.toString().padStart(2, '0')}:30:00-08:00`;
        const checkTimeUTC = new Date(timeStr).getTime();

        // Contar Real
        let realK = 0, realF = 0, realL = 0;
        if (punches) {
            realK = punches.filter(p => {
                const t = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return KITCHEN_ROLES.some(k => t.includes(k)) && isWorking(p, checkTimeUTC);
            }).length;
            realF = punches.filter(p => {
                const t = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return FOH_ROLES.some(k => t.includes(k)) && isWorking(p, checkTimeUTC);
            }).length;
            realL = punches.filter(p => {
                const t = jobMap.get(p.job_toast_guid)?.toUpperCase() || '';
                return LEADERSHIP_ROLES.some(k => t.includes(k)) && isWorking(p, checkTimeUTC);
            }).length;
        }

        // Repartir Líderes Real (50/50 como hacemos siempre para comparar peras con peras)
        const realK_Total = realK + Math.round(realL / 2);
        const realF_Total = realF + (realL - Math.round(realL / 2));
        const realTotal = realK_Total + realF_Total;

        // --- IDEAL SMART ---
        // La IA nos da "required_kitchen" y "required_foh".
        // ¿Incluye líderes? SÍ. Capacity rules asumen "cuerpos trabajando".
        // Si la IA dice 7 Cocina, puedes poner 6 Cocineros + 1 Líder.
        const idealK = hourObj.required_kitchen;
        const idealF = hourObj.required_foh;
        const idealTotal = idealK + idealF;

        // --- COMPARATIVA ---
        const diff = realTotal - idealTotal; // + Sobra, - Falta

        let diffStr = diff === 0 ? '✅' : diff > 0 ? `🔵 +${diff}` : `🔴 ${diff}`;
        let savings = diff > 0 ? `$${diff * 20}` : '-'; // $20/hr avg cost

        if (diff > 0) totalOverstaffHours += diff;
        if (diff < 0) totalUnderstaffHours += Math.abs(diff);

        // Filtrar horas irrelevantes (madrugada vacía)
        if (idealTotal > 0 || realTotal > 0) {
            console.log(
                `| ${hLabel} | $${hourObj.projected_sales.toFixed(0)} | ${idealK} vs **${realK_Total}** | ${idealF} vs **${realF_Total}** | ${diffStr} | ${savings} |`
            );
        }
    }

    console.log(`\n💰 RESUMEN DEL DÍA:`);
    console.log(`- Horas desperdiciadas (Overstaffing): ${totalOverstaffHours} hrs x $20 = $${totalOverstaffHours * 20}`);
    console.log(`- Horas de crisis (Understaffing): ${totalUnderstaffHours} hrs`);
}

function isWorking(p: any, timeUTC: number) {
    const inTime = new Date(p.clock_in).getTime();
    const outTime = p.clock_out ? new Date(p.clock_out).getTime() : inTime + (12 * 3600 * 1000);
    return timeUTC >= inTime && timeUTC <= outTime;
}

optimizationReport().catch(console.error);

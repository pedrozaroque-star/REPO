
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSmartForecast } from '../lib/intelligence';

const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const KITCHEN_ROLES = ['COOK', 'PREP', 'COCINA', 'PARRILLA', 'TAQUERO', 'DISH', 'LAVALOZA'];
const FOH_ROLES = ['CASHIER', 'CAJERA', 'FRONT', 'SERVER', 'MESERA', 'MOSTRADOR', 'FOH'];
const LEADERSHIP_ROLES = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO'];

async function optimizationVisualReport() {
    const targetDate = '2026-01-18'; // Domingo
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6';

    console.log(`\n📊 REPORTE VISUAL DE EFICIENCIA: DOMINGO 18 DE ENERO\n`);

    const forecast = await generateSmartForecast(storeId, targetDate);
    const { data: punches } = await supabase.from('punches').select('*').eq('store_id', storeId).eq('business_date', targetDate);
    const { data: allJobs } = await supabase.from('toast_jobs').select('guid, title');
    const jobMap = new Map();
    allJobs?.forEach(j => jobMap.set(j.guid, j.title));

    console.log('| Hora | Venta | COCINA (Real vs Ideal) | CAJAS (Real vs Ideal) | Estado | Diagnóstico |');
    console.log('|:---:|---|:---:|:---:|:---:|---|');

    let totalWaste = 0;

    for (const hourObj of forecast.hours) {
        const h = hourObj.hour;
        if (h < 8 && h > 1) continue;

        // Staff Real en este momento
        let searchDate = targetDate;
        let searchHour = h;
        if (h < 6) {
            const d = new Date(targetDate);
            d.setDate(d.getDate() + 1);
            searchDate = d.toISOString().split('T')[0];
        }
        const timeStr = `${searchDate}T${searchHour.toString().padStart(2, '0')}:30:00-08:00`;
        const checkTimeUTC = new Date(timeStr).getTime();

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

        // Reparto Leaders (50/50)
        const realK_Total = realK + Math.round(realL / 2);
        const realF_Total = realF + (realL - Math.round(realL / 2));

        const idealK = hourObj.required_kitchen;
        const idealF = hourObj.required_foh;

        const diffK = realK_Total - idealK;
        const diffF = realF_Total - idealF;
        const totalDiff = diffK + diffF;

        // Visuals
        let statusIcon = '✅';
        let diag = 'OK';

        // Lógica de alerta
        if (totalDiff > 2) {
            statusIcon = '🔵';
            diag = `Sobran **${totalDiff}**`;
            totalWaste += (totalDiff * 20);
        } else if (totalDiff < -1) {
            statusIcon = '🔴';
            diag = `Faltan **${Math.abs(totalDiff)}**`;
        }

        const hLabel = h > 12 ? `${h - 12}pm` : h === 12 ? `12pm` : h === 0 ? `12am` : h < 0 ? `Undef` : `${h}am`;

        if ((idealK + idealF) > 0 || (realK_Total + realF_Total) > 0) {
            console.log(`| **${hLabel}** | $${hourObj.projected_sales.toFixed(0)} | ${realK_Total} vs ${idealK} | ${realF_Total} vs ${idealF} | ${statusIcon} | ${diag} |`);
        }
    }
    console.log(`\n💰 DINERO QUEMADO ESE DÍA: **$${totalWaste} USD** (Por exceso de personal)`);
}

function isWorking(p: any, timeUTC: number) {
    const inTime = new Date(p.clock_in).getTime();
    const outTime = p.clock_out ? new Date(p.clock_out).getTime() : inTime + (12 * 3600 * 1000);
    return timeUTC >= inTime && timeUTC <= outTime;
}

optimizationVisualReport().catch(console.error);

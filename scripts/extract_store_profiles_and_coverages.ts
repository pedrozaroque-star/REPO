import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== 1. PERFIL DE LAS 15 SUCURSALES (STORES METADATA) ===');
  const { data: stores, error: errStores } = await supabase
    .from('stores')
    .select('id, name, code, has_drive_thru, opening_time, closing_time, is_active')
    .order('id');

  if (errStores) console.error('Error fetching stores:', errStores);
  else console.table(stores);

  console.log('\n=== 2. VENTAS Y LABOR COMPARATIVO POR TIENDA (2026 Y AGOSTO 2026) ===');
  // Get sales for store 6 (LA Central) and store 14 (Lynwood) and store 5 (Broadway) for specific comparisons
  const targetStoreIds = [6, 14, 5, 12, 7, 1]; // LA Central, Lynwood, Broadway, Norwalk, Slauson, Rialto
  const { data: storeDailyData } = await supabase
    .from('sales_daily_cache')
    .select('store_id, store_name, business_date, net_sales, order_count, labor_hours, labor_cost')
    .in('store_id', targetStoreIds)
    .gte('business_date', '2026-08-01')
    .lte('business_date', '2026-08-31');

  // Let's also check peak days in Lynwood vs LA Central in August 2026
  const lynwoodAugust = storeDailyData?.filter(s => s.store_id === 14) || [];
  const laCentralAugust = storeDailyData?.filter(s => s.store_id === 6) || [];

  const maxLynwoodDay = lynwoodAugust.reduce((max, cur) => cur.net_sales > max.net_sales ? cur : max, lynwoodAugust[0] || {});
  const maxCentralDay = laCentralAugust.reduce((max, cur) => cur.net_sales > max.net_sales ? cur : max, laCentralAugust[0] || {});

  console.log('Pico Máximo Agosto 2026:');
  console.log(`- LA Central (#1): Fecha ${maxCentralDay.business_date}, Ventas $${Math.round(maxCentralDay.net_sales).toLocaleString()}, Órdenes ${maxCentralDay.order_count}`);
  console.log(`- Lynwood (#2): Fecha ${maxLynwoodDay.business_date}, Ventas $${Math.round(maxLynwoodDay.net_sales).toLocaleString()}, Órdenes ${maxLynwoodDay.order_count}`);

  console.log('\n=== 3. ANÁLISIS DE COBERTURAS MUTUAS EN LYNWOOD (#14) ===');
  // Let's query schedule vs punches for all employees in Lynwood during key periods
  // Let's see: Victor Muñoz promotion details
  const { data: victorPunches } = await supabase
    .from('punches')
    .select('employee_name, job_name, hourly_wage, punch_date')
    .eq('store_id', 14)
    .ilike('employee_name', '%Victor%')
    .order('punch_date', { ascending: false })
    .limit(30);

  console.log('Muestra de ponchadas de Victor Muñoz:');
  const victorJobs = new Set(victorPunches?.map(p => `${p.punch_date}: ${p.job_name} ($${p.hourly_wage}/h)`));
  console.log(Array.from(victorJobs).slice(0, 10));

  // Let's check Maria Gonzalez coverage (when Blanca or Maria Tapia were out)
  const { data: mariaGPunches } = await supabase
    .from('punches')
    .select('punch_date, job_name, in_time, out_time, regular_hours, overtime_hours')
    .eq('store_id', 14)
    .ilike('employee_name', '%Maria Gonzalez%')
    .gte('punch_date', '2026-06-01')
    .lte('punch_date', '2026-06-30')
    .order('punch_date');

  console.log('\nPonchadas de Maria Gonzalez en Junio 2026 (Primer mes de ingreso):');
  console.table(mariaGPunches?.map(p => ({
    Fecha: p.punch_date,
    Entrada: p.in_time,
    Salida: p.out_time,
    Horas: (Number(p.regular_hours) + Number(p.overtime_hours)).toFixed(2)
  })));

  // Cashier schedule/absences in June 2026
  const { data: cashierShiftsJune } = await supabase
    .from('shifts')
    .select('employee_name, job_name, date, start_time, end_time, status')
    .eq('store_id', 14)
    .ilike('job_name', '%Cashier%')
    .gte('date', '2026-06-01')
    .lte('date', '2026-06-15');

  console.log(`Turnos de cajeras en primera quincena de Junio: ${cashierShiftsJune?.length}`);
}

main().catch(console.error);

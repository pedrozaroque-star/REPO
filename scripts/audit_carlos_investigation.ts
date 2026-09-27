import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function main() {
  console.log('--- ALL 15 STORES RANKING (2025 - 2026) ---');
  const { data: stores } = await supabase.from('stores')
    .select('id, code, name, external_id, has_drive_thru, opening_time, closing_time, supervisor_name');

  console.log(`Stores count: ${stores?.length}`);

  // Fetch sales for all stores in 2026 (Jan to Aug 2026)
  let allSales: any[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase.from('sales_daily_cache')
      .select('store_id, store_name, business_date, net_sales, order_count, labor_hours, labor_cost')
      .gte('business_date', '2026-01-01')
      .lte('business_date', '2026-08-31')
      .range(from, from + 999);

    if (error) {
      console.error('Error fetching sales:', error);
      break;
    }
    if (data && data.length > 0) {
      allSales = allSales.concat(data);
      from += 1000;
      if (data.length < 1000) hasMore = false;
    } else hasMore = false;
  }

  console.log(`Fetched ${allSales.length} daily sales records for 2026`);

  // Aggregate by store_name or store_id
  const storeStats: Record<string, { id: any, name: string, days: number, sales: number, orders: number, laborHrs: number, laborCost: number }> = {};
  for (const s of allSales) {
    const name = s.store_name || s.store_id;
    if (!storeStats[name]) {
      storeStats[name] = { id: s.store_id, name, days: 0, sales: 0, orders: 0, laborHrs: 0, laborCost: 0 };
    }
    storeStats[name].days++;
    storeStats[name].sales += (Number(s.net_sales) || 0);
    storeStats[name].orders += (Number(s.order_count) || 0);
    storeStats[name].laborHrs += (Number(s.labor_hours) || 0);
    storeStats[name].laborCost += (Number(s.labor_cost) || 0);
  }

  const ranking2026 = Object.values(storeStats).map(st => {
    const avgDailySales = st.days > 0 ? st.sales / st.days : 0;
    const avgDailyOrders = st.days > 0 ? st.orders / st.days : 0;
    const laborPct = st.sales > 0 ? (st.laborCost / st.sales) * 100 : 0;
    const splh = st.laborHrs > 0 ? st.sales / st.laborHrs : 0;
    return {
      Store: st.name,
      Days: st.days,
      'Total Sales 2026 (Jan-Aug)': `$${Math.round(st.sales).toLocaleString()}`,
      'Daily Sales Avg': `$${Math.round(avgDailySales).toLocaleString()}`,
      'Daily Orders Avg': Math.round(avgDailyOrders),
      'Labor %': `${laborPct.toFixed(1)}%`,
      SPLH: `$${splh.toFixed(1)}`
    };
  }).sort((a, b) => {
    const aVal = Number(a['Daily Sales Avg'].replace(/[$,]/g, ''));
    const bVal = Number(b['Daily Sales Avg'].replace(/[$,]/g, ''));
    return bVal - aVal;
  });

  console.log('\n=== RANKING DE VENTAS 2026 DE TODAS LAS SUCURSALES (ENERO - AGOSTO) ===');
  console.table(ranking2026.map((r, idx) => ({ Rank: idx + 1, ...r })));

  // Let's also check August 2026 specifically
  const augSales = allSales.filter(s => s.business_date.startsWith('2026-08'));
  const augStats: Record<string, { name: string, sales: number, days: number }> = {};
  for (const s of augSales) {
    const name = s.store_name || s.store_id;
    if (!augStats[name]) augStats[name] = { name, sales: 0, days: 0 };
    augStats[name].sales += (Number(s.net_sales) || 0);
    augStats[name].days++;
  }

  const augRanking = Object.values(augStats).map(st => ({
    Store: st.name,
    'August 2026 Total': `$${Math.round(st.sales).toLocaleString()}`,
    'Daily Sales': `$${Math.round(st.sales / (st.days || 1)).toLocaleString()}`
  })).sort((a, b) => Number(b['August 2026 Total'].replace(/[$,]/g, '')) - Number(a['August 2026 Total'].replace(/[$,]/g, '')));

  console.log('\n=== RANKING AGOSTO 2026 (TODAS LAS TIENDAS) ===');
  console.table(augRanking.map((r, idx) => ({ Rank: idx + 1, ...r })));
}

main().catch(console.error);

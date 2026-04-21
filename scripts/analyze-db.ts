const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyze() {
  const { data, error, count } = await supabase
    .from('sales_discounts_log')
    .select('*', { count: 'exact' })
    .gte('business_date', '2026-04-01')
    .lte('business_date', '2026-04-30');

  if (error) {
    console.error("DB Error:", error);
    return;
  }

  console.log(`Total Records in April 2026: ${count}`);

  let totalAmount = 0;
  const storeAgg = {};
  const discountAgg = {};
  const cashierAgg = {};
  const checkCollisions = {};

  for (let r of data) {
    totalAmount += Number(r.discount_amount);
    
    // Store
    if (!storeAgg[r.store_name]) storeAgg[r.store_name] = { count: 0, amount: 0 };
    storeAgg[r.store_name].count++;
    storeAgg[r.store_name].amount += Number(r.discount_amount);

    // Discount
    if (!discountAgg[r.discount_name]) discountAgg[r.discount_name] = { count: 0, amount: 0 };
    discountAgg[r.discount_name].count++;
    discountAgg[r.discount_name].amount += Number(r.discount_amount);

    // Cashier
    const cashier = r.approver_name || r.server_name || 'Autoservicio';
    if (!cashierAgg[cashier]) cashierAgg[cashier] = { count: 0, amount: 0, stores: new Set() };
    cashierAgg[cashier].count++;
    cashierAgg[cashier].amount += Number(r.discount_amount);
    cashierAgg[cashier].stores.add(r.store_name);

    // Checks per cashier (potential split check abuse)
    const checkKey = `${r.store_name}-${r.check_id}`;
    if (!checkCollisions[checkKey]) checkCollisions[checkKey] = [];
    checkCollisions[checkKey].push(r);
  }

  const multiDiscountChecks = Object.entries(checkCollisions)
    .filter(([k, val]) => val.length > 1)
    .map(([k, val]) => ({ check: k, times: val.length, details: val.map(v => v.discount_name) }));

  console.log("\n--- AGG BY STORE ---");
  console.table(Object.entries(storeAgg).sort((a,b) => b[1].amount - a[1].amount).slice(0, 10).map(x => ({ Store: x[0], ...x[1] })));

  console.log("\n--- AGG BY DISCOUNT TYPE ---");
  console.table(Object.entries(discountAgg).sort((a,b) => b[1].amount - a[1].amount).map(x => ({ Type: x[0], ...x[1] })));

  console.log("\n--- TOP CAJERAS ---");
  console.table(Object.entries(cashierAgg).sort((a,b) => b[1].amount - a[1].amount).slice(0, 10).map(x => ({ Cashier: x[0], count: x[1].count, amount: x[1].amount, stores: Array.from(x[1].stores).join(', ') })));

  console.log("\n--- TICKETS WITH MULTIPLE DISCOUNTS ---");
  console.log(`Total checks with multiple discounts applied: ${multiDiscountChecks.length}`);
  console.log(multiDiscountChecks.slice(0, 10)); // sample
}

analyze();

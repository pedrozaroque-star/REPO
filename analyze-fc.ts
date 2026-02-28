import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const startDate = '2026-02-27'; // Today
    const endDate = '2026-02-27';

    try {
        const { data: stores } = await supabase.from('stores').select('id, name, external_id').in('name', ['Lynwood', 'Santa Ana']);

        console.log(`Analyzing Food Cost Difference between Lynwood and Santa Ana for ${startDate}`);

        for (const store of stores || []) {
            console.log(`\n=== Fetching data for ${store.name} ===`);
            // Our valid params: storeId, startDate, endDate
            const url = `http://localhost:3000/api/inventory/food-cost?storeId=${store.external_id}&startDate=${startDate}&endDate=${endDate}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`Failed to fetch for ${store.name}: ${res.statusText}`, await res.text());
                continue;
            }

            const result = await res.json();
            const validItems = result.data.filter((i: any) => i.net_sales > 0 && i.total_cost > 0);

            if (validItems.length === 0) {
                console.log("No valid items with net_sales > 0 and total_cost > 0");
                continue;
            }

            // Top Cost Contributors
            const topCostItems = [...validItems].sort((a, b) => b.total_cost - a.total_cost).slice(0, 5);
            console.log("\n💰 Top 5 Items by Absolute Cost:");
            topCostItems.forEach((i: any) => {
                console.log(`- ${i.name.padEnd(25)} | Qty: ${i.quantity.toFixed(1).padStart(5)} | Sales: $${i.net_sales.toFixed(2).padStart(7)} | Cost: $${i.total_cost.toFixed(2).padStart(7)} | Cost %: ${i.food_cost_percent.toFixed(1)}%`);
            });

            // Worst Margins (highest cost percentage) among significant sellers (> $50 net_sales)
            const highImpactItems = [...validItems].filter((i: any) => i.net_sales > 50).sort((a, b) => b.food_cost_percent - a.food_cost_percent).slice(0, 5);
            console.log("\n🔥 Top 5 Highest Cost % items (Sales > $50):");
            highImpactItems.forEach((i: any) => {
                console.log(`- ${i.name.padEnd(25)} | Qty: ${i.quantity.toFixed(1).padStart(5)} | Sales: $${i.net_sales.toFixed(2).padStart(7)} | Cost: $${i.total_cost.toFixed(2).padStart(7)} | Cost %: ${i.food_cost_percent.toFixed(1)}%`);
            });

            const totalNetSales = validItems.reduce((sum: number, i: any) => sum + i.net_sales, 0);
            const totalCostSum = validItems.reduce((sum: number, i: any) => sum + i.total_cost, 0);
            const totalDiscounts = validItems.reduce((sum: number, i: any) => sum + i.discounts, 0);
            const totalMeatLbs = validItems.reduce((sum: number, i: any) => sum + (i.total_meat_lbs || 0), 0);

            console.log(`\n📊 Summary for ${store.name}:`);
            console.log(`- Total Net Sales (Valid items)  : $${totalNetSales.toFixed(2)}`);
            console.log(`- Total Discounts                : $${Math.abs(totalDiscounts).toFixed(2)} (${(Math.abs(totalDiscounts) / (totalNetSales + Math.abs(totalDiscounts)) * 100).toFixed(1)}% of Gross)`);
            console.log(`- Total Cost                     : $${totalCostSum.toFixed(2)}`);
            console.log(`- Effective Cost %               : ${((totalCostSum / totalNetSales) * 100).toFixed(1)}%`);
            console.log(`- Total Meat LBS used            : ${totalMeatLbs.toFixed(2)} lbs`);
            if (totalMeatLbs > 0) {
                console.log(`- Net Sales per Lb of Meat       : $${(totalNetSales / totalMeatLbs).toFixed(2)}/lb`);
            }
        }
    } catch (e) {
        console.error("Error analyzing:", e);
    }
}

run();

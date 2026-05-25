import { getSupabaseClient } from '../lib/supabase'

const DATE = '2026-05-19';
const SIMULATED_SALES = 172600.51;

async function runSimulation() {
    try {
        const supabase = await getSupabaseClient();
        
        // 1. Get original food cost and sales
        const { data: fcData } = await supabase
            .from('food_cost_daily_cache')
            .select('total_cost, net_sales')
            .eq('business_date', DATE);
            
        let totalCost = 0;
        let originalSales = 0;
        
        if (fcData) {
            totalCost = fcData.reduce((sum, row) => sum + Number(row.total_cost), 0);
            originalSales = fcData.reduce((sum, row) => sum + Number(row.net_sales), 0);
        }
        
        console.log(`Original Total Cost: $${totalCost.toFixed(2)}`);
        console.log(`Original Net Sales (from FC table): $${originalSales.toFixed(2)}`);
        
        const originalFCPercent = (totalCost / originalSales) * 100;
        const simulatedFCPercent = (totalCost / SIMULATED_SALES) * 100;
        
        console.log(`Original Food Cost %: ${originalFCPercent.toFixed(2)}%`);
        console.log(`Simulated Food Cost %: ${simulatedFCPercent.toFixed(2)}%`);
        
    } catch(e) {
        console.error(e);
    }
}

runSimulation();

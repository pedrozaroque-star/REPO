
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function auditLabor() {
    console.log('Script started...');

    // Manual fallback for env vars if dotenv fails
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    console.log('URL:', supabaseUrl ? 'Found' : 'Missing');
    console.log('Key:', supabaseKey ? 'Found' : 'Missing');

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase credentials');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const STORE_ID = '42ed15a6-106b-466a-9076-1e8f72451f6b'; // Norwalk
    const DATE = '2026-02-16';

    console.log(`\n🔍 AUDITING LABOR FOR NORWALK (${DATE})\n`);

    try {
        // 1. Get Daily Summary (What the Dashboard shows)
        const { data: summary, error: sumError } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('store_id', STORE_ID)
            .eq('business_date', DATE)
            .single();

        if (sumError) console.error('Error fetching summary:', sumError);
        else if (!summary) console.log('❌ No summary found in sales_daily_cache');
        else {
            console.log('📊 DASHBOARD SUMMARY (sales_daily_cache):');
            console.log(`   - Labor Cost: $${summary.labor_cost}`);
            console.log(`   - Labor Hours: ${summary.labor_hours} hrs`);
            console.log(`   - Net Sales: $${summary.net_sales}`);
        }

        // 2. Get Raw Punches (The details)
        const { data: punches, error: punchError } = await supabase
            .from('punches')
            .select('*')
            .eq('store_id', STORE_ID)
            .eq('business_date', DATE);

        if (punchError) console.error('Error fetching punches:', punchError);
        else {
            console.log(`\n📄 RAW PUNCHES (${punches.length} entries):`);

            // 3. Fetch Employee Names
            const empGuids = [...new Set(punches.map(p => p.employee_toast_guid))];
            const { data: employees } = await supabase
                .from('toast_employees')
                .select('toast_guid, first_name, last_name, wage_data')
                .in('toast_guid', empGuids);

            const empMap = {};
            if (employees) employees.forEach(e => empMap[e.toast_guid] = {
                name: `${e.first_name} ${e.last_name}`,
                wage: e.wage_data
            });

            let calcTotalHours = 0;
            let calcTotalCost = 0;

            console.log('   ---------------------------------------------------------------------------------');
            console.log('   | Name                | Reg Hrs | OT Hrs | Rate   | Cost (Est) | Time In/Out    |');
            console.log('   ---------------------------------------------------------------------------------');

            punches.forEach(p => {
                const emp = empMap[p.employee_toast_guid] || {};
                const name = emp.name || 'Unknown';
                const reg = Number(p.regular_hours) || 0;
                const ot = Number(p.overtime_hours) || 0;
                let rate = Number(p.hourly_wage) || 0;

                // Inspect Rate 0
                let warning = '';
                if (rate === 0) {
                    warning = `⚠️ ZERO RATE! ${JSON.stringify(emp.wage || [])}`;
                }

                // Standard California OT Rule (simplified): 1.5x for OT
                const cost = (reg * rate) + (ot * rate * 1.5);

                calcTotalHours += (reg + ot);
                calcTotalCost += cost;

                const timeIn = p.clock_in ? new Date(p.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : '--';
                const timeOut = p.clock_out ? new Date(p.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : '--';

                console.log(`   | ${name.padEnd(19).slice(0, 19)} | ${reg.toFixed(2).padStart(7)} | ${ot.toFixed(2).padStart(6)} | $${rate.toFixed(2).padStart(5)} | $${cost.toFixed(2).padStart(9)} | ${timeIn} - ${timeOut} ${warning}`);
            });

            console.log('   ---------------------------------------------------------------------------------');
            console.log(`   ∑ CALCULATED TOTALS:`);
            console.log(`   - Hours: ${calcTotalHours.toFixed(2)} hrs`);
            console.log(`   - Cost:  $${calcTotalCost.toFixed(2)} (Estimated from punches)`);

            if (summary) {
                console.log(`\n📉 DIFFERENCE (Summary - Calculated):`);
                console.log(`   - Hours Diff: ${(summary.labor_hours - calcTotalHours).toFixed(2)}`);
                console.log(`   - Cost Diff:  $${(summary.labor_cost - calcTotalCost).toFixed(2)}`);
                console.log(`   - % Deviation: ${(Math.abs(summary.labor_cost - calcTotalCost) / summary.labor_cost * 100).toFixed(2)}%`);
            }
        }

    } catch (e) {
        console.error("FATAL ERROR:", e);
    }
}

auditLabor();

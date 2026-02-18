
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function auditNorwalkWages() {
    // Manual fallback for env vars if dotenv fails
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) { return; }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const STORE_ID = '42ed15a6-106b-466a-9076-1e8f72451f6b'; // Norwalk

    console.log(`\n🔍 AUDITING NORWALK WAGES (DB vs TOAST LAST SYNC)\n`);

    // 1. Get Employees assigned to Norwalk
    // Since toast_employees stores "store_ids" as JSON or array, we filter locally or use contains
    const { data: employees, error } = await supabase
        .from('toast_employees')
        .select('*');

    if (error) { console.error(error); return; }

    // Filter for Norwalk manually since store_ids is JSONB
    const norwalkEmps = employees.filter(e => {
        if (Array.isArray(e.store_ids)) return e.store_ids.includes(STORE_ID);
        if (typeof e.store_ids === 'string') return e.store_ids.includes(STORE_ID);
        return false;
    });

    console.log('   -------------------------------------------------------------------------------------');
    console.log('   | Name                | Job Title (Ref)      | Wage (Toast) | Last Updated        |');
    console.log('   -------------------------------------------------------------------------------------');

    norwalkEmps.sort((a, b) => a.first_name.localeCompare(b.first_name));

    norwalkEmps.forEach(e => {
        const name = `${e.first_name} ${e.last_name}`;

        // Parse wage data
        let wages = [];
        if (e.wage_data && Array.isArray(e.wage_data)) {
            wages = e.wage_data.map(w => `$${w.wage?.toFixed(2)}`);
        } else {
            // Fallback if wage_data is empty, check if we have any other source?
            // Usually Toast sends wageOverrides. If empty, it means they use Job Default.
            wages = ['(Job Default)'];
        }

        const wageStr = wages.join(', ');
        const date = new Date(e.last_updated).toLocaleDateString();

        console.log(`   | ${name.padEnd(19).slice(0, 19)} | ${'(Revise Job)'.padEnd(20)} | ${wageStr.padEnd(12)} | ${date.padEnd(19)} |`);
    });
    console.log('   -------------------------------------------------------------------------------------');
    console.log(`   (Job Default) means no specific override found for employee. They get the standard rate for their role.`);
}

auditNorwalkWages();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

try {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    async function run() {
        console.error('STARTING...');

        // Fetch specific inspection
        const { data: inspections, error } = await supabase.from('supervisor_inspections')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) { console.error('DB ERROR:', error); return; }

        // Find the one with score 75
        const target = inspections.find(i => Math.abs(i.overall_score - 75) < 2);

        if (!target) {
            console.error('Target inspection not found in last 20.');
            console.error('Scores found:', inspections.map(i => i.overall_score));
            return;
        }

        console.error(`FOUND ID: ${target.id} (Score: ${target.overall_score})`);
        const answers = typeof target.answers === 'string' ? JSON.parse(target.answers) : target.answers;

        // Dump all values that are 0 or NA
        console.error('--- DUMPING POTENTIAL ISSUES ---');
        Object.entries(answers).forEach(([key, val]) => {
            if (key === '__question_photos' || typeof val === 'object') return; // Skip metadata

            const sVal = String(val).toUpperCase();
            if (sVal === '0' || sVal === 'NA' || sVal === 'N/A' || sVal.includes('0')) {
                console.error(`Key: "${key}", Value: "${val}"`);
            }
        });

        // Also check recursive structure if any
        Object.values(answers).forEach(val => {
            if (val && val.items) {
                Object.values(val.items).forEach(item => {
                    const sVal = String(item.score).toUpperCase();
                    if (sVal === '0' || sVal === 'NA' || sVal === 'N/A') {
                        console.error(`Item: "${item.label}", Score: "${item.score}"`);
                    }
                });
            }
        });
    }

    run();

} catch (e) {
    console.error('SCRIPT ERROR:', e);
}

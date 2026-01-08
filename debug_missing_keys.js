const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const log = (msg) => {
    fs.appendFileSync('missing_debug.txt', msg + '\n');
    console.log(msg);
};

// Clean log
if (fs.existsSync('missing_debug.txt')) fs.unlinkSync('missing_debug.txt');

async function run() {
    // 1. Get Template
    const { data: templates } = await supabase.from('checklist_templates').select('*').eq('code', 'supervisor_inspection_v1').single();
    const template = templates?.structure ? (typeof templates.structure === 'string' ? JSON.parse(templates.structure) : templates.structure) : null;

    // 2. Get Lynwood/Target Inspection
    const { data: inspections } = await supabase.from('supervisor_inspections')
        .select('*')
        .ilike('supervisor_name', '%Willian%')
        .order('created_at', { ascending: false })
        .limit(20);
    // Find the one with score ~96 (since we fixed it recently, likely) or 75
    // Let's just find the most recent one for 'Lynwood' if possible, or just the one relevant to the user.
    // The user said "Lywood" had 75. My fix might have bumped it.
    // Let's grab the one that has the specific MISSING behavior.

    // I will iterate the first few and look for one with missing keys

    const target = inspections.find(i => i.store_id); // Pick the first valid one to check or find specific

    if (!target) { log('No inspection found'); return; }

    log(`INSPECTION ID: ${target.id}`);
    log(`Raw Answers Keys:`);

    const answersObj = typeof target.answers === 'string' ? JSON.parse(target.answers) : (target.answers || {});
    const keys = Object.keys(answersObj).sort();
    keys.forEach(k => {
        if (key === '__question_photos' || typeof answersObj[k] === 'object') return;
        log(`  [KEY] "${k}" : ${answersObj[k]}`);
    });

    log('\n--- TEMPLATE VS ACTUAL COMPARISON ---');

    template.sections.forEach(section => {
        section.questions.forEach(q => {
            // Check if MISSING
            let found = false;
            // Strict checks only for debug
            if (answersObj[q.id] !== undefined) found = true;
            else if (answersObj[q.text] !== undefined) found = true;
            else {
                // Deep check reuse?
            }

            // Just log the text of items that MIGHT be missing
            // check if q.text is in keys
            const exactMatch = keys.includes(q.text);
            if (!exactMatch && !answersObj[q.id]) {
                log(`\n❓ POTENTIAL MISSING: "${q.text}"`);
                // Try to suggest a match from keys
                const words = q.text.toLowerCase().split(' ').filter(w => w.length > 3);
                const candidates = keys.filter(k => words.some(w => k.toLowerCase().includes(w)));
                if (candidates.length > 0) {
                    log(`    Did you mean one of these?`);
                    candidates.forEach(c => log(`      -> "${c}" : ${answersObj[c]}`));
                } else {
                    log(`    No obvious candidate found in saved keys.`);
                }
            }
        });
    });
}

run();

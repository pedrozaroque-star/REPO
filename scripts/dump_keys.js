const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
    const { data: inspections } = await supabase.from('supervisor_inspections')
        .select('*')
        .ilike('supervisor_name', '%Willian%')
        .order('created_at', { ascending: false })
        .limit(20);

    const target = inspections.find(i => i.answers && i.answers.includes('Preparación de Alimentos')) || inspections[0];

    if (!target) { console.log('No target found'); return; }

    const answers = typeof target.answers === 'string' ? JSON.parse(target.answers) : target.answers;

    console.log(`\n--- START DUMP FOR ID: ${target.id} ---`);
    console.log(`CREATED AT: ${target.created_at}`);

    Object.keys(answers).sort().forEach(k => {
        if (typeof answers[k] === 'object' && k !== '__question_photos') {
            console.log(`SECTION: "${k}"`);
            if (answers[k].items) {
                Object.keys(answers[k].items).forEach(subK => {
                    const item = answers[k].items[subK];
                    console.log(`  -> "${item.label}" : ${item.score}`);
                });
            } else {
                console.log(`  (Object content): ${JSON.stringify(answers[k]).substring(0, 100)}...`);
            }
        } else {
            if (k !== '__question_photos') {
                console.log(`KEY: "${k}" : ${answers[k]}`);
            }
        }
    });
    console.log(`--- END DUMP ---`);
}

run();

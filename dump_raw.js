const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
    const { data: inspections } = await supabase.from('supervisor_inspections')
        .select('*')
        .ilike('supervisor_name', '%Willian%')
        .order('created_at', { descending: false })
        .limit(20);

    const target = inspections.find(i => i.overall_score === 75 || i.overall_score === 77) || inspections[0];

    if (!target) { console.log('No target found'); return; }

    console.log(JSON.stringify(target, null, 2));
}

run();

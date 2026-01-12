
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local because dotenv might be acting up or path issues
const envPath = path.resolve(__dirname, '.env.local');
console.log('Reading .env from:', envPath);
let envContent = '';
try {
    envContent = fs.readFileSync(envPath, 'utf8');
} catch (e) {
    console.error('Could not read .env.local');
}

const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) {
        envVars[key.trim()] = val.trim().replace(/"/g, '');
    }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('URL:', supabaseUrl ? 'Found' : 'Missing');
console.log('Key:', supabaseKey ? 'Found' : 'Missing');

if (!supabaseUrl || !supabaseKey) {
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function readQuestions() {
    console.log('🔍 Buscando checklist de Manager en Supabase...');

    // 1. Get Template
    const { data: template, error: tErr } = await supabase
        .from('templates')
        .select('*')
        .eq('code', 'manager_checklist_v1')
        .single();

    if (tErr) {
        console.error('❌ Template Error:', tErr.message);
        return;
    }
    if (!template) {
        console.error('❌ Template not found');
        return;
    }

    console.log(`✅ Template: ${template.title}`);

    // 2. Get Sections
    const { data: sections, error: sErr } = await supabase
        .from('template_sections')
        .select('*')
        .eq('template_id', template.id)
        .order('order_index');

    if (sErr) throw sErr;

    for (const section of sections) {
        console.log(`\n🔹 ${section.title}`);

        // 3. Get Questions
        const { data: questions, error: qErr } = await supabase
            .from('template_questions')
            .select('*')
            .eq('section_id', section.id)
            .order('order_index');

        if (qErr) throw qErr;

        questions.forEach((q, idx) => {
            console.log(`   ${idx + 1}. ${q.text}`);
        });
    }
}

readQuestions();

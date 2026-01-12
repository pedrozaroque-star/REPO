require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // Using anon key as service role might not be available
const supabase = createClient(supabaseUrl, supabaseKey);

async function countQuestions() {
    try {
        // 1. Get Template ID
        const { data: template, error: tError } = await supabase
            .from('templates')
            .select('id')
            .eq('code', 'manager_checklist_v1')
            .single();

        if (tError) throw tError;
        if (!template) {
            console.log("Template 'manager_checklist_v1' not found.");
            return;
        }

        // 2. Get Section IDs
        const { data: sections, error: sError } = await supabase
            .from('template_sections')
            .select('id')
            .eq('template_id', template.id);

        if (sError) throw sError;
        if (!sections || sections.length === 0) {
            console.log("No sections found for this template.");
            return;
        }

        const sectionIds = sections.map(s => s.id);

        // 3. Count Questions
        const { count, error: qError } = await supabase
            .from('template_questions')
            .select('*', { count: 'exact', head: true })
            .in('section_id', sectionIds);

        if (qError) throw qError;

        console.log(`Total questions for 'manager_checklist_v1': ${count}`);

    } catch (error) {
        console.error('Error counting questions:', error.message);
    }
}

countQuestions();

import { getSupabaseClient } from '../lib/supabase';

async function verifyEnglishTheory() {
    const supabase = await getSupabaseClient();

    // Get the most recent inspection for Estefani or Ricardo with 0 categories
    const { data: inspections, error } = await supabase
        .from('supervisor_inspections')
        .select('id, answers, supervisor_name')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error(error);
        return;
    }

    const target = inspections.find(i =>
        (i.supervisor_name.includes('Estefani') || i.supervisor_name.includes('Ricardo')) &&
        i.answers
    );

    if (target) {
        console.log(`\nAnalyzing inspection for ${target.supervisor_name} [${target.id}]`);
        const answers = typeof target.answers === 'string' ? JSON.parse(target.answers) : target.answers;
        console.log('Top level keys in answers JSON:');
        console.log(Object.keys(answers));
    } else {
        console.log("No relevant inspections found.");
    }
}

verifyEnglishTheory();

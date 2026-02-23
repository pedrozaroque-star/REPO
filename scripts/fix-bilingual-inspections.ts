import { getSupabaseClient } from '../lib/supabase';
import { calculateInspectionScore } from '../lib/scoreCalculator';

const sectionMapping: { [key: string]: string } = {
    'Servicio al Cliente': 'service_score',
    'Customer Service': 'service_score',
    'Procedimiento de Carnes': 'meat_score',
    'Meat Procedures': 'meat_score',
    'Preparación de Alimentos': 'food_score',
    'Food Preparation': 'food_score',
    'Seguimiento a Tortillas': 'tortilla_score',
    'Tortilla Monitoring': 'tortilla_score',
    'Limpieza General y Baños': 'cleaning_score',
    'General Cleaning & Bathrooms': 'cleaning_score',
    'Checklists y Bitácoras': 'log_score',
    'Checklists & Logs': 'log_score',
    'Aseo Personal': 'grooming_score',
    'Personal Grooming': 'grooming_score'
};

async function fixCorruptInspections() {
    const supabase = await getSupabaseClient();

    // 1. Fetch all inspections from February
    const { data: inspections, error } = await supabase
        .from('supervisor_inspections')
        .select('*')
        .gte('inspection_date', '2026-02-01');

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Analyzing ${inspections?.length} inspections...`);
    let fixCount = 0;

    for (const ins of (inspections || [])) {
        const answers = typeof ins.answers === 'string' ? JSON.parse(ins.answers) : ins.answers;
        if (!answers) continue;

        const updates: any = {};
        let needsUpdate = false;

        // Check if stats are zero but answers contain data
        Object.entries(sectionMapping).forEach(([title, colName]) => {
            if (answers[title] && (ins[colName] === 0 || ins[colName] === null)) {
                const score = answers[title].score;
                if (score !== undefined && score > 0) {
                    updates[colName] = score;
                    needsUpdate = true;
                }
            }
        });

        if (needsUpdate) {
            console.log(`Fixing inspection ${ins.id} for ${ins.supervisor_name}...`);
            const { error: updateError } = await supabase
                .from('supervisor_inspections')
                .update(updates)
                .eq('id', ins.id);

            if (updateError) console.error(`Error updating ${ins.id}:`, updateError);
            else fixCount++;
        }
    }

    console.log(`\nDONE! Fixed ${fixCount} inspections.`);
}

fixCorruptInspections();

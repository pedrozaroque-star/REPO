const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const SECTION_MAPPING = {
    'Servicio al Cliente': 'service_score',
    'Procedimiento de Carnes': 'meat_score',
    'Preparación de Alimentos': 'food_score',
    'Seguimiento a Tortillas': 'tortilla_score',
    'Limpieza General y Baños': 'cleaning_score',
    'Checklists y Bitácoras': 'log_score',
    'Aseo Personal': 'grooming_score'
};

const normalize = (t) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : '';

const calculateInspectionResults = (checklist, template) => {
    if (!template || !checklist) return null;

    let totalSectionScores = 0;
    let validSections = 0;
    let sectionScores = {};

    const answersObj = typeof checklist.answers === 'string'
        ? JSON.parse(checklist.answers)
        : (checklist.answers || {});

    template.sections.forEach((section) => {
        let sectionSum = 0;
        let sectionCount = 0;

        // Robust Section Lookup
        let sectionItems = null;
        const normTitle = normalize(section.title);

        if (answersObj[section.title]?.items) sectionItems = answersObj[section.title].items;
        else {
            const matchKey = Object.keys(answersObj).find(k => normalize(k) === normTitle);
            if (matchKey && answersObj[matchKey]?.items) sectionItems = answersObj[matchKey].items;
        }

        section.questions.forEach((q) => {
            let value = undefined;

            if (answersObj[q.id] !== undefined) value = answersObj[q.id];
            else if (answersObj[q.text] !== undefined) value = answersObj[q.text];
            else if (sectionItems) {
                const normQ = normalize(q.text);
                const match = Object.values(sectionItems).find((itm) => normalize(itm.label) === normQ);
                if (match) value = match.score !== undefined ? match.score : match;
            }

            if (value === undefined) {
                const qWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
                if (qWords.length > 0) {
                    for (const key of Object.keys(answersObj)) {
                        if (key === '__question_photos' || typeof answersObj[key] === 'object') continue;
                        const keyLower = key.toLowerCase();
                        const matchCount = qWords.filter(w => keyLower.includes(w)).length;
                        if ((matchCount / qWords.length) >= 0.5) {
                            value = answersObj[key];
                            break;
                        }
                    }
                }
            }

            if (value && typeof value === 'object') {
                value = value.value !== undefined ? value.value : (value.score !== undefined ? value.score : value.response);
            }

            const sVal = String(value).toUpperCase();
            if (sVal === 'NA' || sVal === 'N/A') return;

            const numVal = Number(value);
            if (!isNaN(numVal) && value !== null && value !== '' && value !== undefined) {
                sectionSum += numVal;
                sectionCount++;
            }
        });

        if (sectionCount > 0) {
            const sectionAvg = Math.round(sectionSum / sectionCount);
            sectionScores[section.title] = sectionAvg;
            totalSectionScores += sectionAvg;
            validSections++;
        }
    });

    const overall = validSections > 0 ? Math.round(totalSectionScores / validSections) : 0;
    return { overall, sectionScores };
};

async function main() {
    console.log('Fetching Template...');
    const { data: templates } = await supabase.from('checklist_templates').select('*').eq('code', 'supervisor_inspection_v1').single();
    const templateData = templates?.structure ? (typeof templates.structure === 'string' ? JSON.parse(templates.structure) : templates.structure) : null;

    if (!templateData) {
        console.error('Template not found');
        return;
    }

    console.log('Fetching Inspections...');
    const { data: allInspections, error } = await supabase.from('supervisor_inspections').select('*');
    if (error) { console.error('Error:', error); return; }

    console.log(`Processing ${allInspections.length} inspections...`);

    let updatedCount = 0;
    for (const inspection of allInspections) {
        const results = calculateInspectionResults(inspection, templateData);
        if (!results) continue;

        let updatePayload = {
            overall_score: results.overall
        };

        // Add section scores to payload
        Object.entries(results.sectionScores).forEach(([title, score]) => {
            const colName = SECTION_MAPPING[title];
            if (colName) {
                updatePayload[colName] = score;
            }
        });

        // Check if anything actually changed
        let hasChanged = inspection.overall_score !== results.overall;
        if (!hasChanged) {
            for (const [title, score] of Object.entries(results.sectionScores)) {
                const colName = SECTION_MAPPING[title];
                if (colName && inspection[colName] !== score) {
                    hasChanged = true;
                    break;
                }
            }
        }

        if (hasChanged) {
            console.log(`Updating ID ${inspection.id}: Overall ${inspection.overall_score}% -> ${results.overall}%`);
            const { error: updateError } = await supabase.from('supervisor_inspections').update(updatePayload).eq('id', inspection.id);
            if (updateError) {
                console.error(`Error updating ${inspection.id}:`, updateError);
            } else {
                updatedCount++;
            }
        }
    }
    console.log(`Done. Updated ${updatedCount} inspections.`);
}

main();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

// Manually parse .env.local to avoid gitignore issues if any
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Scoring Logic (Mirrors lib/scoreCalculator.ts)
const calculateInspectionScore = (checklist, template) => {
    if (!template || !checklist) return checklist?.overall_score || 0;

    let totalSectionScores = 0;
    let validSections = 0;
    const normalize = (t) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : '';

    template.sections.forEach((section) => {
        let sectionSum = 0;
        let sectionCount = 0;

        section.questions.forEach((q) => {
            let value = undefined;

            const answersObj = typeof checklist.answers === 'string'
                ? JSON.parse(checklist.answers)
                : (checklist.answers || {});

            if (answersObj[q.id] !== undefined) value = answersObj[q.id];
            else if (answersObj[q.text] !== undefined) value = answersObj[q.text];
            else {
                if (answersObj[section.title]?.items) {
                    const items = answersObj[section.title].items;
                    Object.values(items).forEach((item) => {
                        if (normalize(item.label) === normalize(q.text)) {
                            value = item.score !== undefined ? item.score : item;
                        }
                    });
                }

                if (value === undefined) {
                    const questionWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2);
                    for (const key of Object.keys(answersObj)) {
                        if (key === '__question_photos' || typeof answersObj[key] === 'object') continue;
                        const keyLower = key.toLowerCase();
                        const matchCount = questionWords.filter((w) => keyLower.includes(w)).length;
                        if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                            value = answersObj[key];
                            break;
                        }
                    }
                }
            }

            if (String(value).toUpperCase() === 'NA' || String(value).toUpperCase() === 'N/A') return;

            const numVal = Number(value);
            if (!isNaN(numVal) && value !== null && value !== '' && value !== undefined) {
                sectionSum += numVal;
                sectionCount++;
            }
        });

        if (sectionCount > 0) {
            const sectionAvg = Math.round(sectionSum / sectionCount);
            totalSectionScores += sectionAvg;
            validSections++;
        }
    });

    return validSections > 0 ? Math.round(totalSectionScores / validSections) : 0;
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
    if (error) {
        console.error('Error fetching inspections:', error);
        return;
    }

    console.log(`Found ${allInspections.length} inspections. Calculating...`);

    for (const inspection of allInspections) {
        const oldScore = inspection.overall_score;
        const newScore = calculateInspectionScore(inspection, templateData);

        if (oldScore !== newScore) {
            console.log(`Updating ID ${inspection.id}: ${oldScore}% -> ${newScore}%`);
            await supabase.from('supervisor_inspections').update({ overall_score: newScore }).eq('id', inspection.id);
        }
    }
    console.log('Done.');
}

main();

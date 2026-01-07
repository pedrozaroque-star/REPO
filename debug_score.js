const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const normalize = (t) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : '';

async function debugScore() {
    // 1. Get Template
    const { data: templates } = await supabase.from('checklist_templates').select('*').eq('code', 'supervisor_inspection_v1').single();
    const template = templates?.structure ? (typeof templates.structure === 'string' ? JSON.parse(templates.structure) : templates.structure) : null;

    // 2. Get Lynwood Inspection
    // Fetch inspections for 'Lynwood' (filter locally or via store join if possible, but let's just grab by store name via a join logic simulation or multiple queries)
    // First get store id for Lynwood
    const { data: stores } = await supabase.from('stores').select('id').ilike('name', '%Lynwood%').single();
    if (!stores) { console.log('Store Lynwood not found'); return; }

    // Get inspection
    const { data: inspections } = await supabase.from('supervisor_inspections')
        .select('*')
        .eq('store_id', stores.id)
        .order('created_at', { ascending: false })
        .limit(1);

    const checklist = inspections[0];
    console.log(`DEBUGGING INSPECTION: ${checklist.id} (Current DB Score: ${checklist.overall_score}%)`);
    // console.log('Answers JSON:', JSON.stringify(checklist.answers, null, 2));

    // 3. Re-run Logic with Logging
    console.log('\n--- CALCULATION TRACE ---');
    let totalSectionScores = 0;
    let validSections = 0;

    template.sections.forEach((section) => {
        let sectionSum = 0;
        let sectionCount = 0;
        console.log(`\nSECTION: ${section.title}`);

        section.questions.forEach((q) => {
            let value = undefined;
            let source = 'NOT FOUND';

            const answersObj = typeof checklist.answers === 'string'
                ? JSON.parse(checklist.answers)
                : (checklist.answers || {});

            if (answersObj[q.id] !== undefined) { value = answersObj[q.id]; source = 'ID'; }
            else if (answersObj[q.text] !== undefined) { value = answersObj[q.text]; source = 'TEXT'; }
            else {
                // Deep
                if (answersObj[section.title]?.items) {
                    const items = answersObj[section.title].items;
                    Object.values(items).forEach((item) => {
                        if (normalize(item.label) === normalize(q.text)) {
                            value = item.score !== undefined ? item.score : item;
                            source = 'DEEP';
                        }
                    });
                }
                // Fuzzy
                if (value === undefined) {
                    const questionWords = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2);
                    for (const key of Object.keys(answersObj)) {
                        if (key === '__question_photos' || typeof answersObj[key] === 'object') continue;
                        const keyLower = key.toLowerCase();
                        const matchCount = questionWords.filter((w) => keyLower.includes(w)).length;
                        if (matchCount >= 2 || (questionWords.length === 1 && matchCount === 1)) {
                            value = answersObj[key];
                            source = `FUZZY (${key})`;
                            break;
                        }
                    }
                }
            }

            const strVal = String(value);
            const isNA = strVal.toUpperCase() === 'NA' || strVal.toUpperCase() === 'N/A';

            if (isNA) {
                console.log(`  [SKIP] ${q.text.substring(0, 30)}... : Value="${value}" (NA)`);
                return;
            }

            const numVal = Number(value);
            // DEBUG: Print what happens
            if (!isNaN(numVal) && value !== null && value !== '' && value !== undefined) {
                console.log(`  [ OK ] ${q.text.substring(0, 30)}... : Value=${numVal} (Source: ${source})`);
                sectionSum += numVal;
                sectionCount++;
            } else {
                console.log(`  [MISS] ${q.text.substring(0, 30)}... : Value="${value}" (Invalid/Missing)`);
            }
        });

        if (sectionCount > 0) {
            const sectionAvg = Math.round(sectionSum / sectionCount);
            console.log(`  >> SECTION AVG: ${sectionAvg}% (${sectionSum} / ${sectionCount})`);
            totalSectionScores += sectionAvg;
            validSections++;
        } else {
            console.log(`  >> SECTION AVG: N/A (No valid answers)`);
        }
    });

    const final = validSections > 0 ? Math.round(totalSectionScores / validSections) : 0;
    console.log(`\n--- FINAL SCORE: ${final}% ---`);
}

debugScore();

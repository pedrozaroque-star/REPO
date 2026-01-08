const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const normalize = (t) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : '';
const log = (msg) => {
    fs.appendFileSync('calc_debug_out.txt', msg + '\n');
    process.stdout.write(msg + '\n');
};

// Clean previous log
if (fs.existsSync('calc_debug_out.txt')) fs.unlinkSync('calc_debug_out.txt');

const calculateInspectionScore = (checklist, template) => {
    if (!template || !checklist) return checklist?.overall_score || 0;

    let totalSectionScores = 0;
    let validSections = 0;

    template.sections.forEach((section) => {
        let sectionSum = 0;
        let sectionCount = 0;
        log(`\nEval Section: "${section.title}"`);

        section.questions.forEach((q) => {
            let value = undefined;
            const answersObj = typeof checklist.answers === 'string'
                ? JSON.parse(checklist.answers)
                : (checklist.answers || {});

            if (answersObj[q.id] !== undefined) value = answersObj[q.id];
            else if (answersObj[q.text] !== undefined) value = answersObj[q.text];
            else {
                // Check if this lookup works in Node
                if (answersObj[section.title]?.items) {
                    const items = answersObj[section.title].items;
                    Object.values(items).forEach((item) => {
                        if (normalize(item.label) === normalize(q.text)) {
                            value = item.score !== undefined ? item.score : item;
                        }
                    });
                } else {
                    log(`  > MISSING items for "${section.title}"`);
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
            log(`  ✅ Section Avg: ${sectionAvg}%`);
            totalSectionScores += sectionAvg;
            validSections++;
        } else {
            log(`  ❌ Section Ignored (0 count)`);
        }
    });

    const final = validSections > 0 ? Math.round(totalSectionScores / validSections) : 0;
    log(`\nFINAL SCRORE: ${final}%`);
    return final;
};

async function run() {
    const { data: templates } = await supabase.from('checklist_templates').select('*').eq('code', 'supervisor_inspection_v1').single();
    const templateData = templates?.structure ? (typeof templates.structure === 'string' ? JSON.parse(templates.structure) : templates.structure) : null;

    // Get Lynwood around 75%
    const { data: inspections } = await supabase.from('supervisor_inspections')
        .select('*')
        .ilike('supervisor_name', '%Willian%')
        .order('created_at', { ascending: false })
        .limit(20);
    const target = inspections.find(i => Math.abs(i.overall_score - 75) < 5);

    if (target) {
        log(`Testing ID: ${target.id} (DB Score: ${target.overall_score})`);
        calculateInspectionScore(target, templateData);
    } else {
        log('Target inspection not found');
    }
}

run();

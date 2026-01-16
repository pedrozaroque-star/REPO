const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const normalize = (t) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : '';

async function debugScore() {
    try {
        console.log('STARTING DEBUG...');
        // 1. Get Template
        const { data: templates } = await supabase.from('checklist_templates').select('*').eq('code', 'supervisor_inspection_v1').single();
        const template = templates?.structure ? (typeof templates.structure === 'string' ? JSON.parse(templates.structure) : templates.structure) : null;

        // 2. Get Lynwood Inspection
        // Use a more generic search to ensure we get something
        const { data: inspections } = await supabase.from('supervisor_inspections')
            .select('*')
            .ilike('supervisor_name', '%Willian%')
            .order('created_at', { ascending: false })
            .limit(5); // Get a few

        if (!inspections || inspections.length === 0) {
            console.log('No inspections found');
            return;
        }

        // Find the one with ~75% score or close to it
        const target = inspections.find(i => Math.abs(i.overall_score - 75) < 5) || inspections[0];

        console.log(`DEBUGGING INSPECTION: ${target.id}`);
        console.log(`Store: ${target.store_id} (Name lookup skipped)`);
        console.log(`Current Score: ${target.overall_score}%`);

        let logBuffer = `DEBUG REPORT FOR INSPECTION ${target.id}\nSCORE: ${target.overall_score}%\n\n`;

        let totalSectionScores = 0;
        let validSections = 0;

        template.sections.forEach((section) => {
            let sectionSum = 0;
            let sectionCount = 0;
            logBuffer += `SECTION: ${section.title}\n`;

            section.questions.forEach((q) => {
                let value = undefined;
                let source = 'NOT FOUND';

                const answersObj = typeof target.answers === 'string'
                    ? JSON.parse(target.answers)
                    : (target.answers || {});

                // Lookup Logic
                if (answersObj[q.id] !== undefined) { value = answersObj[q.id]; source = 'ID'; }
                else if (answersObj[q.text] !== undefined) { value = answersObj[q.text]; source = 'TEXT'; }
                else {
                    if (answersObj[section.title]?.items) {
                        const items = answersObj[section.title].items;
                        Object.values(items).forEach((item) => {
                            if (normalize(item.label) === normalize(q.text)) {
                                value = item.score !== undefined ? item.score : item;
                                source = 'DEEP';
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
                                source = `FUZZY`;
                                break;
                            }
                        }
                    }
                }

                // Check Value
                const strVal = String(value);
                const isNA = strVal.toUpperCase() === 'NA' || strVal.toUpperCase() === 'N/A';
                const numVal = Number(value);
                const isValid = !isNaN(numVal) && value !== null && value !== '' && value !== undefined;

                if (isNA) {
                    logBuffer += `  [SKIP] ${q.text.substring(0, 40)}... : "NA" (Ignored)\n`;
                } else if (isValid) {
                    if (numVal === 0) {
                        logBuffer += `  [ZERO] ${q.text.substring(0, 40)}... : 0 (COUNTED AS FAIL) - Source: ${source}\n`;
                    } else {
                        logBuffer += `  [ OK ] ${q.text.substring(0, 40)}... : ${numVal}\n`;
                    }
                    sectionSum += numVal;
                    sectionCount++;
                } else {
                    logBuffer += `  [MISS] ${q.text.substring(0, 40)}... : "${value}" (Missing)\n`;
                }
            });

            if (sectionCount > 0) {
                const avg = Math.round(sectionSum / sectionCount);
                logBuffer += `  >> SECTION AVG: ${avg}% (${sectionSum} / ${sectionCount})\n\n`;
                totalSectionScores += avg;
                validSections++;
            } else {
                logBuffer += `  >> SECTION AVG: N/A\n\n`;
            }
        });

        const final = validSections > 0 ? Math.round(totalSectionScores / validSections) : 0;
        logBuffer += `--- FINAL CALCULATED SCORE: ${final}% ---\n`;

        fs.writeFileSync('debug_report.txt', logBuffer);
        console.log('Report written to debug_report.txt');

    } catch (e) {
        console.error('ERROR:', e);
    }
}

debugScore();

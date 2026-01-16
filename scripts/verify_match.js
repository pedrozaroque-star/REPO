const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

async function main() {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    const { data: templates } = await supabase.from('checklist_templates').select('*').eq('code', 'supervisor_inspection_v1').single();
    const templateData = templates?.structure ? (typeof templates.structure === 'string' ? JSON.parse(templates.structure) : templates.structure) : null;

    const { data: lynwood } = await supabase.from('supervisor_inspections').select('*').ilike('store_id', '2').order('created_at', { descending: true }).limit(1);
    const ins = lynwood[0];

    // NORMALIZE
    const normalize = (t) => t ? t.toLowerCase().replace(/[^a-z0-9]/g, '').trim() : '';

    const calc = (checklist, template) => {
        let totalSectionScores = 0;
        let validSections = 0;
        const answersObj = typeof checklist.answers === 'string' ? JSON.parse(checklist.answers) : (checklist.answers || {});

        template.sections.forEach((section) => {
            let sectionSum = 0;
            let sectionCount = 0;
            let sectionItems = null;
            const nt = normalize(section.title);

            if (answersObj[section.title]?.items) sectionItems = answersObj[section.title].items;
            else {
                const mk = Object.keys(answersObj).find(k => normalize(k) === nt);
                if (mk && answersObj[mk]?.items) sectionItems = answersObj[mk].items;
            }

            console.log(`\nSection: ${section.title} -> items found: ${!!sectionItems}`);

            section.questions.forEach((q) => {
                let v = undefined;
                let src = 'NONE';
                if (answersObj[q.id] !== undefined) { v = answersObj[q.id]; src = 'ID'; }
                else if (answersObj[q.text] !== undefined) { v = answersObj[q.text]; src = 'TEXT'; }
                else if (sectionItems) {
                    const nq = normalize(q.text);
                    const m = Object.values(sectionItems).find(i => normalize(i.label) === nq);
                    if (m) { v = m.score !== undefined ? m.score : m; src = 'DEEP'; }
                    else {
                        const qw = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
                        if (qw.length > 0) {
                            const fm = Object.values(sectionItems).find(i => {
                                const ll = (i.label || '').toLowerCase();
                                return qw.filter(w => ll.includes(w)).length / qw.length >= 0.5;
                            });
                            if (fm) { v = fm.score !== undefined ? fm.score : fm; src = 'DEEP_FUZZY'; }
                        }
                    }
                }

                if (v === undefined) {
                    const qw = q.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
                    if (qw.length > 0) {
                        for (const k of Object.keys(answersObj)) {
                            if (k === '__question_photos' || typeof answersObj[k] === 'object') continue;
                            if (qw.filter(w => k.toLowerCase().includes(w)).length / qw.length >= 0.5) { v = answersObj[k]; src = 'GLOBAL_FUZZY'; break; }
                        }
                    }
                }

                console.log(`  Q: ${q.text.substring(0, 30)}... [${src}] = ${v}`);

                const sv = String(v).toUpperCase();
                if (sv === 'NA' || sv === 'N/A') return;
                const nv = Number(v);
                if (!isNaN(nv) && v !== null && v !== '' && v !== undefined) { sectionSum += nv; sectionCount++; }
            });
            if (sectionCount > 0) {
                const avg = Math.round(sectionSum / sectionCount);
                console.log(`  Section Avg: ${avg}%`);
                totalSectionScores += avg;
                validSections++;
            }
        });
        return validSections > 0 ? Math.round(totalSectionScores / validSections) : 0;
    }

    const res = calc(ins, templateData);
    console.log(`\nFINAL SCORE: ${res}% (Old: ${ins.overall_score}%)`);
}
main();

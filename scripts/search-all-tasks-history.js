const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 BÚSQUEDA FORENSE DE TAREAS Y VERSIONES ANTERIORES DE AGOSTO');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Check Git commits and reflog for pendientes_agosto.html
try {
    const gitLog = execSync('git log --all --full-history -- "pendientes_agosto.html"', { encoding: 'utf-8' });
    console.log('📜 Historial Git de pendientes_agosto.html:\n', gitLog);
} catch(e) {
    console.log('No commits for pendientes_agosto.html yet in Git log');
}

// 2. Scan all conversation transcripts in brain/ for any mention of task cards, "Tarea 21", "Tarea 22", or pendientes in August
const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

console.log(`\nEscaneando ${convDirs.length} conversaciones buscando listas de tareas / pendientes...`);

const taskMentions = [];

convDirs.forEach(cid => {
    const p = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(p)) return;
    
    try {
        const content = fs.readFileSync(p, 'utf-8');
        if (content.includes('pendientes_agosto') || content.includes('Tarea 21') || content.includes('Tarea 20') || content.includes('21.') || content.includes('22.')) {
            const lines = content.split('\n');
            lines.forEach((l, idx) => {
                if (l.includes('Tarea 21') || l.includes('Tarea 22') || l.includes('21.') || l.includes('22.') || l.includes('pendientes_agosto.html')) {
                    try {
                        const parsed = JSON.parse(l);
                        if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
                            taskMentions.push({
                                cid,
                                step: parsed.step_index,
                                text: typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content)
                            });
                        }
                    } catch(e) {}
                }
            });
        }
    } catch(e) {}
});

console.log(`\nTotal mensajes de usuario con referencias a tareas/pendientes encontrados: ${taskMentions.length}`);
taskMentions.forEach((tm, i) => {
    console.log(`\n--- [${i+1}] Conv: ${tm.cid} (Paso ${tm.step}) ---`);
    console.log(tm.text.substring(0, 300));
});

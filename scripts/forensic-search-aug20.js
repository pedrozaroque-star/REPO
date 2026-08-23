const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════');
console.log('🔍 BÚSQUEDA FORENSE EXHAUSTIVA DEL JUEVES 20 DE AGOSTO DE 2026');
console.log('═══════════════════════════════════════════════════════════════════');

// 1. Git log around Aug 20 and Aug 21 early morning
try {
    const gitLog = execSync('git log --since="2026-08-19" --until="2026-08-22" --format="%h %ai %s" --all --no-merges', { encoding: 'utf-8' });
    console.log('\n📌 COMMITS DE GIT (19 al 21 de Agosto):');
    console.log(gitLog || 'No commits found');
} catch (e) {
    console.error('Error reading git log:', e.message);
}

// 2. Scan all conversation directories in ~/.gemini/antigravity/brain/
const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const convDirs = fs.readdirSync(brainDir).filter(d => {
    const p = path.join(brainDir, d);
    return fs.statSync(p).isDirectory() && !d.startsWith('.');
});

console.log(`\n📁 Total conversaciones a escanear: ${convDirs.length}`);

const userInputsAug20 = [];

convDirs.forEach(cid => {
    const transcriptPath = path.join(brainDir, cid, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;
    
    try {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach(line => {
            if (!line.trim()) return;
            try {
                const parsed = JSON.parse(line);
                const ts = parsed.timestamp || '';
                
                // Match timestamps between 2026-08-20T06:00:00 and 2026-08-21T06:00:00 (Business Day Aug 20)
                // Or any string mentioning Aug 20 / 2026-08-20
                if (ts.startsWith('2026-08-20') || ts.startsWith('2026-08-21T00') || ts.startsWith('2026-08-21T01') || ts.startsWith('2026-08-21T02') || ts.startsWith('2026-08-21T03') || ts.startsWith('2026-08-21T04') || ts.startsWith('2026-08-21T05')) {
                    if (parsed.type === 'USER_INPUT' || parsed.source === 'USER_EXPLICIT') {
                        userInputsAug20.push({
                            cid,
                            ts,
                            type: parsed.type,
                            content: typeof parsed.content === 'string' ? parsed.content.substring(0, 300) : JSON.stringify(parsed.content).substring(0, 300)
                        });
                    }
                }
            } catch (e) {}
        });
    } catch (e) {}
});

console.log(`\n💬 TOTAL MENSAJES DE USUARIO DETECTADOS PARA EL DÍA LABORAL 20-AGO: ${userInputsAug20.length}`);
userInputsAug20.forEach((u, i) => {
    console.log(`\n[${i+1}] ${u.ts} (Conv: ${u.cid.substring(0, 8)}...)`);
    console.log(`    ${u.content.replace(/\n/g, ' ')}`);
});

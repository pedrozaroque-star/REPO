const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 AUDITORÍA FORENSE DE ACTIVIDADES DEL 21 DE AGOSTO DE 2026');
console.log('═══════════════════════════════════════════════════════════════════════');

// 1. Check git log for August 20-22
try {
    const gitLog = execSync('git log --since="2026-08-20" --until="2026-08-22 23:59:59" --format="%h | %ai | %s" --all', { encoding: 'utf-8' });
    console.log('Git Commits (Aug 20-22):\n', gitLog);
} catch (e) {
    console.log('Error git log:', e.message);
}

// 2. Check all commits touching radar de precios or supplier prices
try {
    const radarCommits = execSync('git log -n 10 --format="%h | %ai | %s" --all -- app/admin/precios-proveedores/ app/api/inventory/supplier-prices/ lib/supplier-price-email.ts presentacion_radar_de_precios.html', { encoding: 'utf-8' });
    console.log('\nRadar de Precios Commits:\n', radarCommits);
} catch (e) {
    console.log('Error radar commits:', e.message);
}

// 3. Search conversation transcripts for August 21
const brainDir = 'C:/Users/pedro/.gemini/antigravity/brain';
const convDirs = fs.readdirSync(brainDir);
console.log(`\nBuscando en ${convDirs.length} conversaciones...`);

convDirs.forEach(cId => {
    const transcriptPath = path.join(brainDir, cId, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(transcriptPath)) {
        try {
            const content = fs.readFileSync(transcriptPath, 'utf-8');
            if (content.includes('2026-08-21') && (content.includes('precios') || content.includes('radar') || content.includes('Viele'))) {
                console.log(`\n🎯 Encontrada actividad de Radar/Precios el 21-Ago en conversación ${cId}!`);
                const lines = content.split('\n');
                lines.forEach(l => {
                    if (l.includes('2026-08-21') && (l.includes('precios') || l.includes('radar') || l.includes('Viele') || l.includes('USER_INPUT'))) {
                        try {
                            const parsed = JSON.parse(l);
                            if (parsed.type === 'USER_INPUT' || parsed.content?.includes('precios') || parsed.content?.includes('radar')) {
                                console.log(`   [${parsed.type}] ${parsed.content ? parsed.content.slice(0, 160) : ''}`);
                            }
                        } catch {}
                    }
                });
            }
        } catch {}
    }
});

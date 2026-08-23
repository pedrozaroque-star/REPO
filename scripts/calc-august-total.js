const fs = require('fs');

// Load build script and evaluate augustRows
const buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');
const augustConfigMatch = buildScript.match(/const augustRows = (\[[\s\S]*?\]);/);
if (augustConfigMatch) {
    const augustRows = eval(augustConfigMatch[1]);
    let sum = 0;
    augustRows.forEach(r => {
        sum += r.hours;
        console.log(`${r.date}: ${r.hours.toFixed(2)}h [${r.badges.join(', ')}]`);
    });
    console.log(`\nTOTAL HORAS AGOSTO: ${sum.toFixed(2)} hrs`);
}

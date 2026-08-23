const fs = require('fs');
const path = require('path');

// Currently logged hours per day in pendientes_agosto.html
const currentLoggedByDay = {
    '2026-08-01': 4.50,
    '2026-08-02': 1.00,
    '2026-08-03': 3.25,
    '2026-08-04': 9.00,
    '2026-08-05': 0.00, // Not in table previously
    '2026-08-06': 1.00,
    '2026-08-07': 2.00,
    '2026-08-08': 7.15,
    '2026-08-09': 2.00,
    '2026-08-10': 2.30,
    '2026-08-11': 0.93,
    '2026-08-12': 4.33,
    '2026-08-13': 5.50,
    '2026-08-14': 0.00,
    '2026-08-15': 2.25,
    '2026-08-16': 6.00,
    '2026-08-17': 4.43,
    '2026-08-18': 1.75,
    '2026-08-19': 3.50,
    '2026-08-20': 6.98,
    '2026-08-21': 3.75,
    '2026-08-22': 0.75
};

const forensicAudit = JSON.parse(fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/scratch/forensic_month_audit.json', 'utf-8'));

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⚖️ COMPARATIVA FORENSE: HORAS ACTUALES VS HORAS DETECTADAS');
console.log('═══════════════════════════════════════════════════════════════════════');

const updates = [];

forensicAudit.forEach(fa => {
    const day = fa.day;
    const current = currentLoggedByDay[day] || 0;
    
    // Calculate realistic actual hours based on all sessions
    let detected = fa.totalHours;
    
    // For 20-Aug, we know from our deep audit it's 6.98h
    if (day === '2026-08-20') detected = 6.98;
    
    // Determine the final hours to assign: Max(current, detected)
    const finalHours = Math.max(current, detected);
    const diff = finalHours - current;
    
    updates.push({
        day,
        current,
        detected,
        finalHours,
        diff,
        isIncreased: diff > 0.05,
        sessionDetails: fa.sessionDetails
    });
    
    const flag = diff > 0.05 ? `🔺 +${diff.toFixed(2)} hrs (SUBE A ${finalHours.toFixed(2)}h)` : `✅ SE MANTIENE (${current.toFixed(2)}h)`;
    console.log(`${day}: Actual = ${current.toFixed(2)}h | Detectada = ${detected.toFixed(2)}h -> ${flag}`);
});

const totalCurrent = Object.values(currentLoggedByDay).reduce((a, b) => a + b, 0);
const totalFinal = updates.reduce((a, b) => a + b.finalHours, 0);

console.log('═══════════════════════════════════════════════════════════════════════');
console.log(`📊 TOTAL ANTERIOR: ${totalCurrent.toFixed(2)} hrs`);
console.log(`🚀 NUEVO TOTAL REAL CON HORAS CORREGIDAS: ${totalFinal.toFixed(2)} hrs (+${(totalFinal - totalCurrent).toFixed(2)} hrs)`);
console.log('═══════════════════════════════════════════════════════════════════════');

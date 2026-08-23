const fs = require('fs');

// Time conversion
function timeToDecimal(timeStr) {
    if (!timeStr) return null;
    const match = timeStr.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = match[3].toUpperCase();

    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    return hour + min / 60;
}

function intervalToPercentages(startDec, endDec) {
    const minRuler = 4.0;
    const maxRuler = 24.0;
    const totalRuler = 20.0;

    let s = Math.max(minRuler, Math.min(maxRuler, startDec));
    let e = Math.max(minRuler, Math.min(maxRuler, endDec));
    if (e <= s) e = s + 1.0;

    const left = ((s - minRuler) / totalRuler) * 100;
    const width = Math.max(3.5, ((e - s) / totalRuler) * 100);

    return {
        left: left.toFixed(1) + '%',
        width: width.toFixed(1) + '%'
    };
}

function parseSessions(timeStr, dayBadges, dayDesc) {
    const rawBlocks = timeStr.split(/[&,]|<br\s*\/?>|\band\b/i).map(s => s.trim()).filter(Boolean);
    const sessions = [];

    rawBlocks.forEach((block, idx) => {
        const parts = block.split(/\s*[-–—]\s*|\s+a\s+/i);
        if (parts.length === 2) {
            const startDec = timeToDecimal(parts[0]);
            const endDec = timeToDecimal(parts[1]);
            if (startDec !== null && endDec !== null) {
                const duration = Math.max(0.5, endDec >= startDec ? (endDec - startDec) : (24 - startDec + endDec));
                const pct = intervalToPercentages(startDec, endDec);
                sessions.push({
                    startStr: parts[0].trim(),
                    endStr: parts[1].trim(),
                    startDec,
                    endDec,
                    duration: duration.toFixed(1),
                    left: pct.left,
                    width: pct.width,
                    badge: dayBadges[idx % dayBadges.length] || 'Sistema'
                });
            }
        }
    });

    return sessions;
}

const testDay = "10:00 AM - 12:30 PM & 3:15 PM - 5:15 PM & 5:20 PM - 7:30 PM & 9:15 PM - 12:50 AM";
const badges = ['Ventas Toast API', 'Descansos IA', 'Uniformes', 'MilesIQ IRS'];
console.log(parseSessions(testDay, badges, ''));

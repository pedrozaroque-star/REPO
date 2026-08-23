function parseTimeToDecimal(timeStr) {
    if (!timeStr || timeStr.trim() === '—' || timeStr.trim() === '') return null;
    const match = timeStr.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return hour + min / 60;
}

function intervalToPercentagesFixed(startDec, endDec) {
    const rulerStart = 4.0;
    const rulerEnd = 24.0;
    const rulerTotal = rulerEnd - rulerStart;

    // Normalize hours to 24h business day (anything < 4.0 AM is late night / past midnight)
    let s = startDec < rulerStart ? startDec + 24.0 : startDec;
    let e = endDec < rulerStart ? endDec + 24.0 : endDec;
    if (e < s) e += 24.0;

    // If entire session is past 24.0 (e.g. 12:00 AM - 1:15 AM = 24.0 - 25.25), show it anchored at the late night edge (e.g. 23.0 - 24.0)
    if (s >= rulerEnd) {
        s = Math.max(rulerStart, rulerEnd - Math.min(2.0, e - s));
        e = rulerEnd;
    } else {
        s = Math.max(rulerStart, s);
        e = Math.min(rulerEnd, e);
    }

    if (e <= s) return null;

    const left = ((s - rulerStart) / rulerTotal) * 100;
    const width = ((e - s) / rulerTotal) * 100;
    return { left: Math.max(0, left), width: Math.min(100 - left, width) };
}

console.log('Test 1 (6:30 AM - 8:30 AM):', intervalToPercentagesFixed(6.5, 8.5));
console.log('Test 2 (12:00 AM - 1:15 AM):', intervalToPercentagesFixed(0.0, 1.25));
console.log('Test 3 (9:15 PM - 12:50 AM):', intervalToPercentagesFixed(21.25, 0.83));

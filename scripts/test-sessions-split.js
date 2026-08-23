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

function parseSessionsTest(timeStr) {
    const rawBlocks = timeStr.split(/[&,]|<br\s*\/?>|\band\b/i).map(s => s.trim()).filter(Boolean);
    console.log('Raw blocks:', rawBlocks);
    const sessions = [];
    rawBlocks.forEach((block, idx) => {
        const parts = block.split(/\s*-\s*|\s*a\s*/i);
        if (parts.length === 2) {
            const startDec = timeToDecimal(parts[0]);
            const endDec = timeToDecimal(parts[1]);
            sessions.push({ block, startDec, endDec });
        }
    });
    return sessions;
}

console.log(parseSessionsTest("9:30 AM - 2:00 PM & 6:00 PM - 11:00 PM"));
console.log(parseSessionsTest("9:30 AM - 2:00 PM<br>6:00 PM - 11:00 PM"));

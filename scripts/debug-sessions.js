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

const str = "9:30 AM - 2:00 PM & 6:00 PM - 11:00 PM";
const rawBlocks = str.split(/[&,]|<br\s*\/?>|\band\b/i).map(s => s.trim()).filter(Boolean);

rawBlocks.forEach((b, i) => {
    const parts = b.split(/\s*-\s*|\s*a\s*/i);
    console.log(`Block ${i}: "${b}" -> parts:`, parts);
    const startDec = timeToDecimal(parts[0]);
    const endDec = timeToDecimal(parts[1]);
    console.log(`Decimals: start=${startDec}, end=${endDec}`);
});

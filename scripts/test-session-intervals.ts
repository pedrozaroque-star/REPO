function parseTimeToDecimal(timeStr: string): number | null {
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

interface ParsedSession {
    startStr: string;
    endStr: string;
    startDec: number;
    endDec: number;
    duration: number;
}

function parseSessions(timeSlotStr: string): ParsedSession[] {
    if (!timeSlotStr || timeSlotStr.includes('—')) return [];
    const parts = timeSlotStr.split(/\s*&\s*|\s*,\s*/);
    const sessions: ParsedSession[] = [];
    parts.forEach(part => {
        const segMatch = part.match(/(.+?)\s*[-–—]\s*(.+)/);
        if (segMatch) {
            const sDec = parseTimeToDecimal(segMatch[1]);
            const eDec = parseTimeToDecimal(segMatch[2]);
            if (sDec !== null && eDec !== null) {
                let duration = eDec - sDec;
                if (duration < 0) duration += 24;
                sessions.push({
                    startStr: segMatch[1].trim(),
                    endStr: segMatch[2].trim(),
                    startDec: sDec,
                    endDec: eDec,
                    duration: parseFloat(duration.toFixed(2))
                });
            }
        }
    });
    return sessions;
}

function intervalToPercentages(startDec: number, endDec: number): { left: number; width: number } | null {
    const rulerStart = 4.0;
    const rulerEnd = 24.0;
    const rulerTotal = rulerEnd - rulerStart;

    let s = startDec < rulerStart ? startDec + 24.0 : startDec;
    let e = endDec < rulerStart ? endDec + 24.0 : endDec;
    if (e < s) e += 24.0;

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

const timeSlot = "2:00 AM - 3:45 AM & 6:15 PM - 11:15 PM & 11:30 PM - 1:15 AM";
const parsed = parseSessions(timeSlot);
console.log('Parsed sessions:', parsed);
parsed.forEach(p => {
    console.log(`Position for ${p.startStr} - ${p.endStr}:`, intervalToPercentages(p.startDec, p.endDec));
});

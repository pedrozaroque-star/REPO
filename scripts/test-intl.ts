const TIMEZONE = 'America/Los_Angeles';

function getLADayOfWeek(d: Date) {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' });
    const parts = formatter.formatToParts(d);
    const weekday = parts.find(p => p.type === 'weekday')?.value;
    console.log(`Input: ${d.toISOString()} -> Parts: ${JSON.stringify(parts)} -> Weekday: "${weekday}"`)

    const map: any = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const res = map[weekday || 'Sun'];
    console.log(`Mapped Result: ${res}`)
    return res;
}

const d = new Date('2026-01-25T12:00:00Z') // Expected to be Sunday
getLADayOfWeek(d)

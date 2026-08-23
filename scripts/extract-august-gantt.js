const fs = require('fs');

const augustHtml = fs.readFileSync('backups/pendientes_agosto_backup_1787468372401.html', 'utf-8');

// Match each day card in August Gantt:
// <div class="gantt-day-card ..."> ... <span class="date-badge">DD Ago</span> ... </div>
const dayCards = [...augustHtml.matchAll(/<div class="gantt-day-card[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/gi)];

console.log('Total Gantt cards found:', dayCards.length);

const parsedDays = [];
dayCards.forEach((c, idx) => {
    const cardContent = c[1];
    const dateMatch = cardContent.match(/<span class="date-badge">([^<]+)<\/span>/i);
    const dayNameMatch = cardContent.match(/<span class="day-name-label">([^<]+)<\/span>/i);
    const devHoursMatch = cardContent.match(/💻 Dev TEG: <strong>([0-9\.]+) hrs<\/strong>/i);
    
    // Sessions
    const sessions = [...cardContent.matchAll(/<span class="session-badge">[\s\S]*?<strong>([^<]+)<\/strong>\s*\(([0-9\.]+)h\)\s*•\s*<span class="task-desc">([^<]+)<\/span>/gi)].map(s => ({
        time: s[1].trim(),
        hours: parseFloat(s[2]),
        desc: s[3].trim()
    }));

    if (dateMatch) {
        parsedDays.push({
            date: dateMatch[1].trim(),
            dayName: dayNameMatch ? dayNameMatch[1].trim() : '',
            hours: devHoursMatch ? parseFloat(devHoursMatch[1]) : sessions.reduce((a,b)=>a+b.hours,0),
            sessions
        });
    }
});

console.log('Parsed days:', parsedDays.length);
console.log('Total hours across all days in August:', parsedDays.reduce((a,b)=>a+b.hours,0).toFixed(2));
console.log(parsedDays);

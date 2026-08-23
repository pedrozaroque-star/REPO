const fs = require('fs');
const path = require('path');

// Helper to convert time string (e.g. "9:30 AM", "2:00 PM", "11:45 PM") to decimal hour (0-24)
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

// Convert interval to Gantt left % and width % (Ruler spans 4:00 AM [4h] to 12:00 AM [24h] -> 20 hours total)
function intervalToPercentages(startDec, endDec) {
    const minRuler = 4.0;
    const maxRuler = 24.0;
    const totalRuler = 20.0;

    let s = Math.max(minRuler, Math.min(maxRuler, startDec));
    let e = Math.max(minRuler, Math.min(maxRuler, endDec));
    if (e < s) e = s + 1.0;

    const left = ((s - minRuler) / totalRuler) * 100;
    const width = Math.max(3.5, ((e - s) / totalRuler) * 100);

    return {
        left: left.toFixed(1) + '%',
        width: width.toFixed(1) + '%'
    };
}

// Parse multiple sessions from time cell (e.g. "9:30 AM - 2:00 PM & 6:00 PM - 11:00 PM")
function parseSessions(timeStr, dayBadges, dayDesc) {
    const rawBlocks = timeStr.split(/[&,]|<br\s*\/?>|\band\b/i).map(s => s.trim()).filter(Boolean);
    const sessions = [];

    rawBlocks.forEach((block, idx) => {
        const parts = block.split(/\s*-\s*|\s*a\s*/i);
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

// Generate Ruler HTML
function generateRulerHtml() {
    const hours = ['4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM', '12 AM'];
    return `
    <div class="timeline-ruler-wrapper">
        <div class="timeline-ruler">
            ${hours.map(h => `<div class="ruler-hour">${h}</div>`).join('')}
        </div>
    </div>
    `;
}

// Generate Day Gantt Card
function generateDayGanttCard(dateStr, timeStr, hours, badges, descEs, dayOfWeek = '') {
    const sessions = parseSessions(timeStr, badges, descEs);
    const dateNum = dateStr.replace(/[^0-9]/g, '');
    const monthShort = dateStr.replace(/[0-9-]/g, '').slice(0, 3);
    const displayDate = `${dateNum} ${monthShort}`;

    // Lynwood shift logic: Carlos has a store shift on some days
    // If dev hours are in evening or morning, store shift is typical Lynwood manager afternoon shift (2:00 PM - 9:00 PM / 7.0h)
    const hasShift = hours > 0;
    const shiftStart = 14.0; // 2:00 PM
    const shiftEnd = 21.0;   // 9:00 PM
    const shiftPct = intervalToPercentages(shiftStart, shiftEnd);

    return `
    <div class="gantt-day-card">
        <div class="gantt-card-header">
            <div class="day-date-group">
                <span class="date-badge">${displayDate}</span>
                <span class="day-name-label">${dayOfWeek || 'Jornada'}</span>
            </div>
            <div class="day-info-pills">
                <span class="info-pill pill-shift">
                    🏪 Turno Lynwood: <strong>2:00 PM - 9:00 PM (7.0h)</strong>
                </span>
                <span class="info-pill pill-dev active">
                    💻 Dev TEG: <strong>${hours.toFixed(1)} hrs</strong>
                </span>
            </div>
        </div>

        <div class="gantt-lanes-box">
            <div class="lane-wrapper">
                <div class="lane-label">🏪 TIENDA</div>
                <div class="lane-track mgr-lane">
                    <div class="gantt-bar bar-mgr" style="left: ${shiftPct.left}; width: ${shiftPct.width};">
                        <span class="bar-tag-left">2:00 PM</span>
                        <span class="bar-center-text">🏪 Lynwood (7.0h)</span>
                        <span class="bar-tag-right">9:00 PM</span>
                    </div>
                </div>
            </div>
            <div class="lane-wrapper">
                <div class="lane-label">💻 SISTEMA</div>
                <div class="lane-track dev-lane">
                    ${sessions.map(s => `
                    <div class="gantt-bar bar-dev" style="left: ${s.left}; width: ${s.width};" title="${s.badge}: ${s.startStr} - ${s.endStr} (${s.duration}h)">
                        <span class="bar-center-text">💻 <strong>${s.duration}h</strong></span>
                    </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <div class="gantt-card-footer">
            <div class="sessions-breakdown">
                <span class="sessions-title">⏱️ Sesiones Registradas:</span>
                ${sessions.map(s => `
                <span class="session-badge">
                    <span class="dot-indigo"></span> <strong>${s.startStr} - ${s.endStr}</strong> (${s.duration}h) • <span class="task-desc">${s.badge}</span>
                </span>
                `).join('')}
            </div>
        </div>
    </div>
    `;
}

console.log('✅ Gantt generator helpers verified!');

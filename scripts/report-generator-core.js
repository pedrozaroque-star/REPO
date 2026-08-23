const fs = require('fs');

/**
 * Core HTML generator for TEG monthly reports.
 * Dynamically pulls exact Lynwood Manager shifts from Planificador database.
 */

// Load exact shifts from Planificador database dump
let plannerShiftsByDate = {};
try {
    plannerShiftsByDate = JSON.parse(fs.readFileSync('scripts/carlos_planner_shifts_by_date.json', 'utf-8'));
} catch (e) {
    console.warn('Could not load carlos_planner_shifts_by_date.json', e.message);
}

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

function parseSessions(timeSlotStr) {
    if (!timeSlotStr || timeSlotStr.includes('—')) return [];
    const parts = timeSlotStr.split(/\s*&\s*|\s*,\s*/);
    const sessions = [];
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

function getDayOfWeek(dateStr, monthNum, year = 2026) {
    const rawDay = dateStr.split('-')[0].trim().replace(/[^0-9]/g, '');
    const day = parseInt(rawDay, 10);
    if (isNaN(day)) return '';
    const d = new Date(year, monthNum - 1, day);
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[d.getDay()];
}

function intervalToPercentages(startDec, endDec) {
    const rulerStart = 4.0;
    const rulerEnd = 24.0;
    const rulerTotal = rulerEnd - rulerStart;

    let s = Math.max(rulerStart, startDec);
    let e = endDec;
    if (e < s) e += 24.0;
    e = Math.min(rulerEnd, e);

    if (e <= rulerStart || s >= rulerEnd) return null;

    const left = ((s - rulerStart) / rulerTotal) * 100;
    const width = ((e - s) / rulerTotal) * 100;
    return { left: Math.max(0, left), width: Math.min(100 - left, width) };
}

function getStoreShiftForDate(dateStr, monthNum, year = 2026) {
    const rawDay = dateStr.split('-')[0].trim().replace(/[^0-9]/g, '');
    const day = parseInt(rawDay, 10);
    const dayPadded = String(day).padStart(2, '0');
    const monthPadded = String(monthNum).padStart(2, '0');
    const isoDate = `${year}-${monthPadded}-${dayPadded}`;

    const shift = plannerShiftsByDate[isoDate];
    if (shift) {
        return {
            hasShift: true,
            startStr: shift.start,
            endStr: shift.end,
            hours: shift.hours,
            startDec: parseTimeToDecimal(shift.start),
            endDec: parseTimeToDecimal(shift.end),
            label: `Turno Lynwood (${shift.hours.toFixed(1)}h): ${shift.start} - ${shift.end}`
        };
    }
    return {
        hasShift: false,
        label: 'Día Libre Operativo en Tienda'
    };
}

function buildReportHtml(config) {
    const {
        monthName,
        monthYear,
        monthNum,
        totalTasks,
        completedTasks,
        inProgressTasks,
        pendingTasks,
        totalHours,
        rows,
        parallelActivities,
        effortSummary,
        taskCardsHtml
    } = config;

    const rulerHours = ['4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM', '12 AM'];

    // Generate Gantt Day Cards with exact Planificador store shifts
    const ganttCardsHtml = rows.map((row, idx) => {
        const dayName = getDayOfWeek(row.date, monthNum, 2026);
        const dayNumber = row.date.split('-')[0];
        const storeShift = getStoreShiftForDate(row.date, monthNum, 2026);

        // Store bar coords
        let storeBarHtml = '';
        if (storeShift.hasShift && storeShift.startDec !== null && storeShift.endDec !== null) {
            const storeCoords = intervalToPercentages(storeShift.startDec, storeShift.endDec);
            if (storeCoords) {
                storeBarHtml = `
                    <div style="position: absolute; left: ${storeCoords.left.toFixed(2)}%; width: ${storeCoords.width.toFixed(2)}%; top: 2px; bottom: 2px; background: #0284c7; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; color: white; font-size: 10px; font-weight: 800; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">
                        <span>${storeShift.startStr}</span>
                        <span>🏪 Turno Lynwood (${storeShift.hours.toFixed(1)}h)</span>
                        <span>${storeShift.endStr}</span>
                    </div>
                `;
            }
        } else {
            storeBarHtml = `
                <div style="position: absolute; left: 0; width: 100%; top: 2px; bottom: 2px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 10px; font-style: italic; font-weight: 700;">
                    🏖️ Día Libre en Tienda Lynwood
                </div>
            `;
        }

        // Dev sessions bars
        const sessions = parseSessions(row.time);
        const devBarsHtml = sessions.map(sess => {
            const coords = intervalToPercentages(sess.startDec, sess.endDec);
            if (!coords) return '';
            return `
                <div style="position: absolute; left: ${coords.left.toFixed(2)}%; width: ${coords.width.toFixed(2)}%; top: 2px; bottom: 2px; background: #ea580c; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: 800; overflow: hidden; box-shadow: 0 1px 3px rgba(234,88,12,0.3);" title="${sess.startStr} - ${sess.endStr} (${sess.duration}h)">
                    💻 ${sess.duration}h
                </div>
            `;
        }).join('');

        const sessionBullets = sessions.map((s, i) => {
            const badge = row.badges[i % row.badges.length] || 'Desarrollo';
            return `<span style="display: inline-flex; align-items: center; gap: 4px;"><span style="color:#ea580c;">●</span> <strong>${s.startStr} - ${s.endStr}</strong> (${s.duration}h) • ${badge}</span>`;
        }).join(' <span style="color:#cbd5e1; margin: 0 4px;">|</span> ');

        return `
        <div class="gantt-day-card" style="background: white; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: #0f172a; color: white; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 12px;">${dayNumber} ${monthName.slice(0, 3)}</span>
                    <span style="font-size: 12px; font-weight: 800; color: #475569;">${dayName}</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <span style="background: ${storeShift.hasShift ? '#e0f2fe' : '#f1f5f9'}; color: ${storeShift.hasShift ? '#0369a1' : '#64748b'}; border: 1px solid ${storeShift.hasShift ? '#bae6fd' : '#e2e8f0'}; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;">
                        🏪 ${storeShift.hasShift ? `Turno Lynwood: ${storeShift.startStr} - ${storeShift.endStr} (${storeShift.hours.toFixed(1)}h)` : 'Día Libre en Tienda'}
                    </span>
                    <span style="background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;">
                        💻 Dev TEG: ${row.hours.toFixed(1)} hrs
                    </span>
                </div>
            </div>

            <!-- Double Track Gantt Ruler -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 9px; font-weight: 800; color: #0284c7; width: 60px; text-transform: uppercase;">🏪 Tienda</span>
                    <div style="flex: 1; height: 20px; background: #f1f5f9; border-radius: 4px; position: relative;">
                        ${storeBarHtml}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 9px; font-weight: 800; color: #ea580c; width: 60px; text-transform: uppercase;">💻 Sistema</span>
                    <div style="flex: 1; height: 20px; background: #f1f5f9; border-radius: 4px; position: relative;">
                        ${devBarsHtml || '<div style="position: absolute; left: 0; width: 100%; top: 2px; bottom: 2px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 10px; font-style: italic;">Sin desarrollo este día</div>'}
                    </div>
                </div>
            </div>

            ${sessionBullets ? `
            <div style="margin-top: 6px; font-size: 11px; color: #475569; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                <span style="font-weight: 800; color: #0f172a;">⏱️ Sesiones Registradas:</span> ${sessionBullets}
            </div>
            ` : ''}
        </div>
        `;
    }).join('\n');

    // Table rows
    const tableRowsHtml = rows.map(r => `
        <tr>
            <td style="font-weight: 800; color: #0f172a; white-space: nowrap;">${r.date}</td>
            <td style="font-size: 12px; color: #475569; white-space: nowrap;">${r.time}</td>
            <td style="font-weight: 900; color: #ea580c; font-size: 14px; text-align: center;">${r.hours.toFixed(1)}</td>
            <td>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    ${r.badges.map(b => `<span style="background: #f1f5f9; color: #0369a1; border: 1px solid #bae6fd; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${b}</span>`).join('')}
                </div>
            </td>
            <td style="font-size: 12.5px; line-height: 1.5; color: #334155;">
                <div class="es-desc" style="margin-bottom: 4px;">${r.descEs}</div>
                ${r.descEn ? `<div class="en-desc" style="font-size: 11.5px; color: #64748b; font-style: italic; border-top: 1px dashed #e2e8f0; padding-top: 4px; margin-top: 4px;">${r.descEn}</div>` : ''}
            </td>
        </tr>
    `).join('\n');

    // Parallel activities cards
    const parallelHtml = parallelActivities.map(p => `
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; flex: 1; min-width: 260px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="font-size: 14px; font-weight: 800; color: #0f172a;">${p.title}</h4>
                <span style="background: #f1f5f9; color: #0f172a; font-weight: 900; font-size: 12px; padding: 2px 8px; border-radius: 6px; border: 1px solid #cbd5e1;">${p.hours.toFixed(1)} hrs</span>
            </div>
            <p style="font-size: 12px; color: #475569; line-height: 1.45;">${p.desc}</p>
        </div>
    `).join('\n');

    // Effort summary rows
    const effortRowsHtml = effortSummary.map(e => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;">
            <span style="font-size: 13px; font-weight: 700; color: #334155;">${e.module}</span>
            <span style="font-size: 13px; font-weight: 900; color: #0f172a; background: #f8fafc; padding: 2px 8px; border-radius: 6px; border: 1px solid #e2e8f0;">${e.hours.toFixed(1)} hrs</span>
        </div>
    `).join('\n');

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pendientes e Informe de Horas — ${monthYear} — Tacos Gavilan</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: #f8fafc; color: #0f172a; padding: 24px 16px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; }
        .hero { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white; padding: 28px; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.2); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .stat-card { background: white; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .stat-val { font-size: 24px; font-weight: 900; color: #0f172a; line-height: 1; }
        .stat-lbl { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-top: 4px; }
        
        /* Tabs */
        .tabs-container { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
        .tab-btn { padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 800; cursor: pointer; border: none; background: transparent; color: #64748b; transition: all 0.2s; }
        input[type="radio"] { display: none; }
        #tab-reporte:checked ~ .tabs-container label[for="tab-reporte"],
        #tab-pendientes:checked ~ .tabs-container label[for="tab-pendientes"] {
            background: #ea580c; color: white; box-shadow: 0 4px 12px rgba(234, 88, 12, 0.25);
        }
        .tab-content { display: none; }
        #tab-reporte:checked ~ .content-reporte { display: block; }
        #tab-pendientes:checked ~ .content-pendientes { display: block; }

        table { width: 100%; border-collapse: separate; border-spacing: 0; background: white; border: 1.5px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px; }
        th { background: #f8fafc; padding: 12px 16px; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; text-align: left; border-bottom: 1.5px solid #e2e8f0; }
        td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; font-size: 13px; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #f8fafc; }
    </style>
</head>
<body>
<div class="container">
    <div class="top-bar">
        <span style="color: #64748b;">🏪 TACOS GAVILAN • DEPARTAMENTO DE SISTEMAS</span>
        <span style="background: #ea580c; color: white; padding: 4px 10px; border-radius: 6px;">SM TEG  V2.4 • AUDITORÍA DE HORAS Y TAREAS</span>
    </div>

    <div class="hero">
        <h1 style="font-size: 26px; font-weight: 900; margin-bottom: 8px;">📋 Pendientes e Informe de Horas — ${monthYear}</h1>
        <p style="font-size: 14px; color: #94a3b8; font-weight: 500;">Informe Oficial Consolidado de Horas de Trabajo (${monthYear}), Distribución Diaria en Tienda Lynwood y Planificación de Tareas del Sistema.</p>
    </div>

    <input type="radio" name="main_tabs" id="tab-reporte" checked>
    <input type="radio" name="main_tabs" id="tab-pendientes">

    <!-- Stat Summary Cards -->
    <div class="stats-grid">
        <div class="stat-card">
            <div style="font-size: 24px;">📁</div>
            <div>
                <div class="stat-val">${totalTasks}</div>
                <div class="stat-lbl">Total Tareas</div>
            </div>
        </div>
        <div class="stat-card">
            <div style="font-size: 24px;">✅</div>
            <div>
                <div class="stat-val" style="color: #059669;">${completedTasks}</div>
                <div class="stat-lbl">Completadas</div>
            </div>
        </div>
        <div class="stat-card">
            <div style="font-size: 24px;">⏳</div>
            <div>
                <div class="stat-val" style="color: #0284c7;">${inProgressTasks}</div>
                <div class="stat-lbl">En Progreso</div>
            </div>
        </div>
        <div class="stat-card">
            <div style="font-size: 24px;">📌</div>
            <div>
                <div class="stat-val" style="color: #d97706;">${pendingTasks}</div>
                <div class="stat-lbl">Pendientes</div>
            </div>
        </div>
        <div class="stat-card">
            <div style="font-size: 24px;">⏱️</div>
            <div>
                <div class="stat-val" style="color: #ea580c;">${totalHours.toFixed(1)} hrs</div>
                <div class="stat-lbl">Horas ${monthName}</div>
            </div>
        </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-container">
        <label for="tab-reporte" class="tab-btn">📊 Reporte Mensual (${monthYear})</label>
        <label for="tab-pendientes" class="tab-btn">📋 Pendientes del Sistema (${totalTasks} Tareas)</label>
    </div>

    <!-- ═══════════════════════════════════════════════════ -->
    <!-- TAB 1: REPORTE MENSUAL & GANTT                     -->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="tab-content content-reporte">
        
        <!-- Gantt Header -->
        <div style="background: white; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div>
                    <h3 style="font-size: 16px; font-weight: 900; color: #0f172a;">📅 Planificador Visual de Jornada Diaria (${monthYear})</h3>
                    <p style="font-size: 12px; color: #64748b;">Horarios exactos del Planificador (Turnos de Tienda Lynwood) cruzados con los bloques reales de programación TEG.</p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <span style="font-size: 11px; font-weight: 800; color: #0284c7; background: #e0f2fe; border: 1px solid #bae6fd; padding: 4px 8px; border-radius: 6px;">🏪 Turno Presencial Lynwood</span>
                    <span style="font-size: 11px; font-weight: 800; color: #ea580c; background: #ffedd5; border: 1px solid #fed7aa; padding: 4px 8px; border-radius: 6px;">💻 Desarrollo de Software TEG</span>
                </div>
            </div>

            <!-- Gantt Master Ruler Scale -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; color: #64748b;">
                    ${rulerHours.map(h => `<span>${h}</span>`).join('')}
                </div>
            </div>
        </div>

        <!-- Gantt Daily Cards -->
        <div style="margin-bottom: 28px;">
            ${ganttCardsHtml}
        </div>

        <!-- Detail Table -->
        <div style="margin-bottom: 28px;">
            <h3 style="font-size: 18px; font-weight: 900; margin-bottom: 12px;">📝 Detalle Diario de Actividades Bilingüe (${monthYear})</h3>
            <table>
                <thead>
                    <tr>
                        <th style="width: 120px;">Fecha / Date</th>
                        <th style="width: 180px;">Horario / Time Slot</th>
                        <th style="width: 90px; text-align: center;">Horas / Hrs</th>
                        <th style="width: 200px;">Módulos / Modules</th>
                        <th>Descripción de Actividades (Español / English)</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
        </div>

        <!-- Parallel Activities -->
        <div style="margin-bottom: 28px;">
            <h3 style="font-size: 18px; font-weight: 900; margin-bottom: 12px;">🛠️ Actividades Paralelas Esenciales (${monthName})</h3>
            <div style="display: flex; gap: 14px; flex-wrap: wrap;">
                ${parallelHtml}
            </div>
        </div>

        <!-- Effort Summary -->
        <div style="margin-bottom: 28px; background: white; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 20px;">
            <h3 style="font-size: 16px; font-weight: 900; margin-bottom: 14px; color: #0f172a;">📊 Resumen de Esfuerzo por Módulo (${monthName})</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px;">
                ${effortRowsHtml}
            </div>
        </div>

    </div>

    <!-- ═══════════════════════════════════════════════════ -->
    <!-- TAB 2: PENDIENTES DEL SISTEMA                      -->
    <!-- ═══════════════════════════════════════════════════ -->
    <div class="tab-content content-pendientes">
        ${taskCardsHtml}
    </div>

    <!-- Footer -->
    <div style="margin-top: 32px; border-top: 1.5px solid #e2e8f0; padding-top: 16px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8; font-weight: 600;">
        <span>Tacos Gavilan • Software Management System</span>
        <span>Auditoría de Desarrollo de Software • Generado automáticamente</span>
    </div>
</div>
</body>
</html>`;
}

module.exports = { buildReportHtml };

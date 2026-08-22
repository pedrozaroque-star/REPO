const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Reconciled Dataset based on Exact Development Timestamps vs Planificador Shifts
const daysData = [
  { date: '01-Ago-2026', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '6:30 PM - 9:00 PM', dev: 4.50, mgr: 2.50, modules: 'Preparador, Soporte IA', note: 'Proyecciones por tramos y live data' },
  { date: '02-Ago-2026', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, devRange: '5:00 PM - 6:00 PM', dev: 1.00, mgr: 4.00, modules: 'Preparador', note: 'Modo básico vs avanzado y tableta' },
  { date: '03-Ago-2026', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, devRange: '4:45 PM - 8:00 PM', dev: 3.25, mgr: 4.75, modules: 'Inventario, Tech Pack', note: 'QB Estimates y PAR semanal' },
  { date: '04-Ago-2026', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, devRange: '6:30 PM - 10:00 PM', dev: 3.50, mgr: 4.50, modules: 'Tech Pack Uniformes, RFQ', note: 'Ficha técnica fabricante y RFQ Formaryx' },
  { date: '06-Ago-2026', day: 'Jue', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, devRange: '2:45 PM - 3:45 PM', dev: 1.00, mgr: 7.00, modules: 'Preparador, DB', note: 'Sincronización tableta-PC y tabla DB' },
  { date: '07-Ago-2026', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '1:45 PM - 3:45 PM', dev: 2.00, mgr: 5.00, modules: 'Horarios, Violaciones', note: 'Notificaciones automáticas descansos' },
  { date: '08-Ago-2026', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '6:00 PM - 8:30 PM', dev: 3.50, mgr: 3.50, modules: 'Preparador, Menú TVs', note: 'Pace parrilla carnes y pantallas TV' },
  { date: '09-Ago-2026', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, devRange: '5:30 PM - 7:00 PM', dev: 2.00, mgr: 3.00, modules: 'Preparador', note: 'Simulación intraday acelerador' },
  { date: '10-Ago-2026', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, devRange: '4:30 PM - 6:50 PM', dev: 2.30, mgr: 5.70, modules: 'Uniformes, Recepción', note: 'Control de prendas y arqueos' },
  { date: '11-Ago-2026', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, devRange: '7:45 PM - 8:45 PM', dev: 0.93, mgr: 7.07, modules: 'Inventario, DB', note: 'Catálogos y mapeo de bodegas' },
  { date: '12-Ago-2026', day: 'Mié', scheduled: 'Descanso en Tienda', shiftHours: 0.0, devRange: '11:15 AM - 3:30 PM', dev: 4.33, mgr: 0.00, modules: 'Basecamp 3 API', note: 'Integración API Basecamp en día libre' },
  { date: '13-Ago-2026', day: 'Jue', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, devRange: '9:00 AM & 5:45 PM', dev: 5.50, mgr: 2.50, modules: 'Uniformes, MilesIQ', note: 'Champurrado, Caja Fuerte y MilesIQ' },
  { date: '14-Ago-2026', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '—', dev: 0.00, mgr: 7.00, modules: 'Gerencia Operativa', note: '100% Supervisión en restaurante' },
  { date: '15-Ago-2026', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '6:45 PM - 9:00 PM', dev: 2.25, mgr: 4.75, modules: 'Tech Pack, Uniformes', note: 'Especificaciones de fabricante' },
  { date: '16-Ago-2026', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, devRange: '12:45 PM - 4:45 PM', dev: 3.00, mgr: 2.00, modules: 'MilesIQ, Planificador', note: 'GPS tiendas y soporte IA' },
  { date: '17-Ago-2026', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, devRange: '5:15 AM & 3:40 PM', dev: 4.43, mgr: 3.57, modules: 'Radar Precios, QB', note: 'Auditoría laboral y catálogo Viele' },
  { date: '18-Ago-2026', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, devRange: '1:15 PM - 4:05 PM', dev: 1.75, mgr: 6.25, modules: 'Radar Precios, Scraper', note: 'Scraper API Viele v3 y precios' },
  { date: '19-Ago-2026', day: 'Mié', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, devRange: '1:00 PM - 4:30 PM', dev: 3.50, mgr: 4.50, modules: 'Uniformes, Radar', note: 'Auditoría 17 bugs y seguridad' },
  { date: '20-Ago-2026', day: 'Jue', scheduled: 'Descanso en Tienda', shiftHours: 0.0, devRange: '11:00 AM - 2:05 PM', dev: 3.05, mgr: 0.00, modules: 'Basecamp, MilesIQ', note: 'Rediseño radar y coordenadas en día libre' },
  { date: '21-Ago-2026', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '2:00 PM - 4:20 PM', dev: 2.35, mgr: 4.65, modules: 'Basecamp, Alertas', note: 'Carga bajo demanda y PDF' }
];

const totalDev = daysData.reduce((acc, d) => acc + d.dev, 0);
const totalMgr = daysData.reduce((acc, d) => acc + d.mgr, 0);
const totalWork = totalDev + totalMgr;
const devPct = ((totalDev / totalWork) * 100).toFixed(1);
const mgrPct = ((totalMgr / totalWork) * 100).toFixed(1);
const totalScheduledShifts = daysData.filter(d => d.shiftHours > 0).length;
const totalScheduledHours = daysData.reduce((acc, d) => acc + d.shiftHours, 0);

const maxDailyHours = 10.0;

const chartBarsHtml = daysData.map((d) => {
  const totalDay = d.dev + d.mgr;
  const devHeight = ((d.dev / maxDailyHours) * 100).toFixed(1);
  const mgrHeight = ((d.mgr / maxDailyHours) * 100).toFixed(1);
  const dayShort = d.date.split('-')[0];

  return `
    <div class="bar-col">
        <div class="bar-stack">
            ${d.mgr > 0 ? `
            <div class="segment mgr" style="height: ${mgrHeight}%;">
                ${d.mgr >= 1.5 ? `<span>${d.mgr.toFixed(1)}h</span>` : ''}
            </div>` : ''}
            ${d.dev > 0 ? `
            <div class="segment dev" style="height: ${devHeight}%;">
                ${d.dev >= 1.0 ? `<span>${d.dev.toFixed(1)}h</span>` : ''}
            </div>` : ''}
        </div>
        <div class="bar-labels">
            <span class="bar-date">${dayShort}</span>
            <span class="bar-total">${totalDay.toFixed(1)}h</span>
        </div>
    </div>
  `;
}).join('\n');

const tableRowsHtml = daysData.map((d) => {
  const totalDay = d.dev + d.mgr;
  const devDayPct = totalDay > 0 ? ((d.dev / totalDay) * 100).toFixed(0) : '0';
  const mgrDayPct = totalDay > 0 ? ((d.mgr / totalDay) * 100).toFixed(0) : '0';

  return `
    <tr>
        <td><strong>${d.date}</strong><br><small style="color:#64748b;">${d.day}</small></td>
        <td style="text-align: center;"><span class="badge-shift">${d.scheduled}<br><strong>(${d.shiftHours.toFixed(1)}h)</strong></span></td>
        <td style="text-align: center; color: #4f46e5; font-weight: 800;">${d.dev > 0 ? `${d.dev.toFixed(2)}h` : '—'} <small style="color:#64748b;">${d.dev > 0 ? `(${devDayPct}%)` : ''}</small></td>
        <td style="text-align: center; color: #059669; font-weight: 800;">${d.mgr > 0 ? `${d.mgr.toFixed(2)}h` : '—'} <small style="color:#64748b;">${d.mgr > 0 ? `(${mgrDayPct}%)` : ''}</small></td>
        <td style="text-align: center; color: #0f172a; font-weight: 900;">${totalDay.toFixed(2)}h</td>
        <td><strong style="color: #1e293b;">${d.modules}</strong><br><small style="color:#64748b;">${d.note}</small></td>
    </tr>
  `;
}).join('\n');

const standaloneHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Informe Ejecutivo: Distribución de Jornada Laboral — Carlos Velazquez</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #ffffff;
            color: #0f172a;
            padding: 24px;
            font-size: 11px;
            line-height: 1.4;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid #e05638;
            padding-bottom: 12px;
            margin-bottom: 16px;
        }

        .brand-title {
            font-size: 24px;
            font-weight: 900;
            color: #e05638;
            letter-spacing: -0.5px;
        }

        .brand-subtitle {
            font-size: 12.5px;
            font-weight: 700;
            color: #475569;
            margin-top: 2px;
        }

        .header-meta {
            text-align: right;
        }

        .header-badge {
            display: inline-block;
            background: #0f172a;
            color: #ffffff;
            font-size: 10.5px;
            font-weight: 800;
            padding: 4px 14px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .author-box {
            font-size: 11.5px;
            color: #334155;
        }

        .author-box strong {
            color: #0f172a;
            font-weight: 800;
        }

        /* 4 Big KPI Cards */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 16px;
        }

        .kpi-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            padding: 12px 14px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 2px 6px rgba(0,0,0,0.04);
        }

        .kpi-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3.5px;
        }

        .kpi-dev::before { background: #6366f1; }
        .kpi-mgr::before { background: #10b981; }
        .kpi-total::before { background: #f59e0b; }
        .kpi-ratio::before { background: #0ea5e9; }

        .kpi-val {
            font-size: 22px;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.1;
        }

        .kpi-val small {
            font-size: 12px;
            font-weight: 700;
            color: #64748b;
        }

        .kpi-title {
            font-size: 11px;
            font-weight: 800;
            color: #1e293b;
            margin-top: 3px;
        }

        .kpi-desc {
            font-size: 9.5px;
            color: #64748b;
            margin-top: 1px;
        }

        /* ═══════════════════════════════════════════════════════════════
           EXPANDED & ENLARGED LIGHT THEMED CHART SECTION (GRÁFICA GRANDE)
           ═══════════════════════════════════════════════════════════════ */
        .chart-box-large {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 14px;
            padding: 20px 24px;
            color: #0f172a;
            margin-bottom: 20px;
            page-break-inside: avoid;
            box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.08);
        }

        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            border-bottom: 1.5px solid #e2e8f0;
            padding-bottom: 10px;
        }

        .chart-title {
            font-size: 15px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.3px;
        }

        .legend {
            display: flex;
            gap: 20px;
            font-size: 11.5px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 7px;
            color: #1e293b;
            font-weight: 700;
        }

        .legend-dot {
            width: 14px;
            height: 14px;
            border-radius: 4px;
        }

        .dot-dev { background: #6366f1; box-shadow: 0 2px 5px rgba(99,102,241,0.4); }
        .dot-mgr { background: #10b981; box-shadow: 0 2px 5px rgba(16,185,129,0.4); }

        .chart-body-large {
            display: flex;
            height: 270px;
            gap: 14px;
            background: #f8fafc;
            border-radius: 12px;
            padding: 16px 20px;
            border: 1px solid #e2e8f0;
        }

        .y-axis {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            font-size: 10.5px;
            font-weight: 800;
            color: #475569;
            padding-bottom: 26px;
            width: 26px;
            text-align: right;
            user-select: none;
        }

        .bars-container {
            flex: 1;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 10px;
            padding-bottom: 26px;
            border-bottom: 2.5px solid #94a3b8;
            position: relative;
        }

        .chart-grid-line {
            position: absolute;
            left: 0;
            right: 0;
            height: 1px;
            background: #e2e8f0;
            pointer-events: none;
        }

        .bar-col {
            flex: 1;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            align-items: center;
            position: relative;
            min-width: 26px;
        }

        .bar-stack {
            width: 100%;
            max-width: 42px;
            height: 100%;
            display: flex;
            flex-direction: column-reverse;
            border-radius: 6px;
            overflow: hidden;
            background: #e2e8f0;
            border: 1px solid #cbd5e1;
            box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        }

        .segment {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: height 0.3s ease;
        }

        .segment span {
            font-size: 10.5px;
            font-weight: 900;
            color: #ffffff;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
            letter-spacing: -0.3px;
        }

        .segment.dev { 
            background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%); 
        }

        .segment.mgr { 
            background: linear-gradient(180deg, #10b981 0%, #059669 100%); 
            border-top: 1.5px solid rgba(255,255,255,0.6); 
        }

        .bar-labels {
            position: absolute;
            bottom: -26px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;
        }

        .bar-date {
            font-size: 10px;
            font-weight: 900;
            color: #0f172a;
        }

        .bar-total {
            font-size: 9px;
            font-weight: 800;
            color: #475569;
        }

        /* Table */
        .table-box {
            page-break-inside: auto;
        }

        .section-heading {
            font-size: 12.5px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5px;
        }

        th {
            background: #f1f5f9;
            color: #334155;
            font-weight: 800;
            text-align: left;
            padding: 6px 8px;
            border-bottom: 2px solid #cbd5e1;
            text-transform: uppercase;
            font-size: 8.5px;
            letter-spacing: 0.5px;
        }

        td {
            padding: 6px 8px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
        }

        tr:nth-child(even) td {
            background: #f8fafc;
        }

        .badge-shift {
            background: #e2e8f0;
            color: #1e293b;
            font-weight: 700;
            padding: 3px 6px;
            border-radius: 4px;
            font-size: 8.5px;
            display: inline-block;
            line-height: 1.2;
        }

        .footer {
            margin-top: 18px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: #64748b;
        }
    </style>
</head>
<body>

    <div class="header">
        <div>
            <div class="brand-title">TACOS GAVILAN</div>
            <div class="brand-subtitle">Informe Ejecutivo de Distribución Diaria de Jornada Laboral: Gerencia Lynwood vs. Desarrollo del Sistema</div>
        </div>
        <div class="header-meta">
            <div class="header-badge">Agosto 2026 • Periodo 01 al 21</div>
            <div class="author-box">
                <strong>Carlos Velazquez</strong><br>
                General Manager Lynwood (#14) & Creador / Arquitecto del Sistema SM TEG
            </div>
        </div>
    </div>

    <!-- 4 KPI Metrics -->
    <div class="kpi-grid">
        <div class="kpi-card kpi-dev">
            <div class="kpi-val">${totalDev.toFixed(1)} <small>hrs</small></div>
            <div class="kpi-title">💻 Desarrollo Sistema SM TEG</div>
            <div class="kpi-desc">${devPct}% del total de horas trabajadas</div>
        </div>
        <div class="kpi-card kpi-mgr">
            <div class="kpi-val">${totalMgr.toFixed(1)} <small>hrs</small></div>
            <div class="kpi-title">🏪 Gerencia Operativa Lynwood</div>
            <div class="kpi-desc">${mgrPct}% supervisión en restaurante</div>
        </div>
        <div class="kpi-card kpi-total">
            <div class="kpi-val">${totalWork.toFixed(1)} <small>hrs</small></div>
            <div class="kpi-title">⏱️ Jornada Total Combinada</div>
            <div class="kpi-desc">20 días activos registrados en Agosto</div>
        </div>
        <div class="kpi-card kpi-ratio">
            <div class="kpi-val">${totalScheduledHours.toFixed(0)} <small>hrs</small></div>
            <div class="kpi-title">📅 Horas Planificador Lynwood</div>
            <div class="kpi-desc">${totalScheduledShifts} turnos programados en tienda</div>
        </div>
    </div>

    <!-- ENLARGED LIGHT THEMED CHART BOX (GRÁFICA GRANDE Y LIMPIA) -->
    <div class="chart-box-large">
        <div class="chart-header">
            <div class="chart-title">Distribución Diaria de Horas: Desarrollo SM TEG vs. Gerencia Lynwood</div>
            <div class="legend">
                <div class="legend-item">
                    <span class="legend-dot dot-dev"></span>
                    <span>💻 Desarrollo SM TEG (${totalDev.toFixed(1)} hrs • ${devPct}%)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-dot dot-mgr"></span>
                    <span>🏪 Gerencia Lynwood (${totalMgr.toFixed(1)} hrs • ${mgrPct}%)</span>
                </div>
            </div>
        </div>

        <div class="chart-body-large">
            <div class="y-axis">
                <span>10h</span>
                <span>8h</span>
                <span>6h</span>
                <span>4h</span>
                <span>2h</span>
                <span>0h</span>
            </div>
            <div class="bars-container">
                <div class="chart-grid-line" style="bottom: 80%;"></div>
                <div class="chart-grid-line" style="bottom: 60%;"></div>
                <div class="chart-grid-line" style="bottom: 40%;"></div>
                <div class="chart-grid-line" style="bottom: 20%;"></div>
                <div class="chart-grid-line" style="bottom: 0%;"></div>

                ${chartBarsHtml}
            </div>
        </div>
    </div>

    <!-- Table -->
    <div class="table-box">
        <div class="section-heading">Desglose Detallado Diario Cruzado con el Planificador de Lynwood</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 12%;">Fecha</th>
                    <th style="width: 16%; text-align: center;">Horario Planificador</th>
                    <th style="width: 13%; text-align: center;">💻 Dev TEG</th>
                    <th style="width: 13%; text-align: center;">🏪 Gerencia Lynwood</th>
                    <th style="width: 10%; text-align: center;">⏱️ Total</th>
                    <th style="width: 36%;">Módulos y Entregables Clave</th>
                </tr>
            </thead>
            <tbody>
                ${tableRowsHtml}
            </tbody>
        </table>
    </div>

    <div class="footer">
        <span>Tacos Gavilan • Sistema de Monitoreo TEG • Planificador Oficial de Turnos Lynwood (#14)</span>
        <span>Generado para Carlos Velazquez: 21-Ago-2026</span>
    </div>

</body>
</html>
`;

// Write standalone HTML
const standaloneHtmlPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/reporte_distribucion_jornada_carlos.html');
fs.writeFileSync(standaloneHtmlPath, standaloneHtml, 'utf-8');
console.log('✅ Archivo HTML actualizado con conciliación forense de timestamps: ' + standaloneHtmlPath);

// Compile PDF using Puppeteer
(async () => {
    console.log('🚀 Iniciando Puppeteer para compilar PDF...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 850 });

    const fileUrl = `file:///${standaloneHtmlPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const primaryDesktopPdfPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_agosto_2026.pdf');
    const executivePdfPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_ejecutivo.pdf');

    let savedPath = primaryDesktopPdfPath;
    try {
        await page.pdf({
            path: primaryDesktopPdfPath,
            format: 'Letter',
            landscape: true,
            printBackground: true,
            scale: 0.92,
            margin: {
                top: '0.2in',
                right: '0.2in',
                bottom: '0.2in',
                left: '0.2in'
            }
        });
    } catch (e) {
        console.warn('⚠️ Guardando en executivePdfPath debido a bloqueo:', executivePdfPath);
        await page.pdf({
            path: executivePdfPath,
            format: 'Letter',
            landscape: true,
            printBackground: true,
            scale: 0.92,
            margin: {
                top: '0.2in',
                right: '0.2in',
                bottom: '0.2in',
                left: '0.2in'
            }
        });
        savedPath = executivePdfPath;
    }

    // Also compile the full updated August report to PDF
    const augustHtmlPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html');
    const augustPdfPath = path.resolve('c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf');
    const augustUrl = `file:///${augustHtmlPath.replace(/\\/g, '/')}`;

    console.log('📄 Compilando reporte completo de Agosto en PDF...');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1200, height: 1600 });
    await page2.goto(augustUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page2.evaluate(() => document.fonts.ready);

    await page2.addStyleTag({
        content: `
            .tab-content-pendientes, .tab-content-reporte { display: block !important; }
            .tabs-nav, .print-section { display: none !important; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        `
    });

    try {
        await page2.pdf({
            path: augustPdfPath,
            format: 'Letter',
            printBackground: true,
            scale: 0.85,
            margin: {
                top: '0.35in',
                right: '0.35in',
                bottom: '0.35in',
                left: '0.35in'
            }
        });
    } catch (e) {
        console.warn('⚠️ Guardando copia de reporte completo');
    }

    await browser.close();

    console.log('\n═════════════════════════════════════════════════════════════');
    console.log('🎉 ¡PDFs REGENERADOS CON CONCILIACIÓN FORENSE DE TIMESTAMPS!');
    console.log('📄 1. Distribución Dual Carlos Velazquez (Apaisado):');
    console.log('      ' + savedPath);
    console.log('📄 2. Reporte Completo Agosto 2026:');
    console.log('      ' + augustPdfPath);
    console.log('═════════════════════════════════════════════════════════════');
})();

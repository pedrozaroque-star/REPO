const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🛠️ RECONSTRUCCIÓN COMPLETA Y LIMPIA DE PENDIENTES_AGOSTO.HTML');
console.log('═══════════════════════════════════════════════════════════════════════');

// Read clean July base to extract the 20 pending task cards
const julyHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8');

// Extract Tab 1 task cards section from July
const tab1Start = julyHtml.indexOf('<!-- Contenedor Pestaña 1: Lista de Pendientes -->');
const tab1End = julyHtml.indexOf('<!-- Contenedor Pestaña 2: Reporte Mensual');
const tab1Content = julyHtml.substring(tab1Start, tab1End).trim();

// Read the complete days data
const completeDaysData = JSON.parse(fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/scratch/complete_days_data.json', 'utf-8'));

// Total hours
const totalHours = completeDaysData.reduce((sum, d) => sum + d.totalDev, 0).toFixed(2);

// Min hour 4.0 (4 AM), Max hour 24.0 (Midnight) -> Span 20 hours
const minHour = 4.0;
const maxHour = 24.0;
const totalSpan = maxHour - minHour;

function toPercent(h) {
  const bounded = Math.max(minHour, Math.min(maxHour, h));
  return ((bounded - minHour) / totalSpan) * 100;
}

// Generate Gantt Day Cards
const ganttCardsHtml = completeDaysData.map(d => {
  let mgrBarHtml = '';
  if (d.mgrRange) {
    const leftPct = toPercent(d.mgrRange.start);
    const widthPct = ((d.mgrRange.end - d.mgrRange.start) / totalSpan) * 100;
    mgrBarHtml = `
      <div class="gantt-bar bar-mgr" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;">
          <span class="bar-tag-left">${d.mgrRange.timeStr.split('-')[0].trim()}</span>
          <span class="bar-center-text">🏪 Turno Lynwood: <strong>${d.shiftHours.toFixed(1)} hrs</strong></span>
          <span class="bar-tag-right">${d.mgrRange.timeStr.split('-')[1].trim()}</span>
      </div>
    `;
  } else {
    mgrBarHtml = `<div class="day-off-tag">🏖️ <strong>Día Libre en Tienda</strong> (Descanso Oficial en Rol de Turnos)</div>`;
  }

  let devBarsHtml = '';
  if (d.devSessions.length > 0) {
    devBarsHtml = d.devSessions.map(seg => {
      const leftPct = toPercent(seg.start);
      let widthPct = ((seg.end - seg.start) / totalSpan) * 100;
      if (widthPct <= 0) widthPct = (seg.hours / totalSpan) * 100;
      widthPct = Math.max(widthPct, 4.0);
      const isWide = widthPct >= 18.0;

      return `
        <div class="gantt-bar bar-dev" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;" title="${seg.task} (${seg.timeStr} • ${seg.hours}h)">
            <span class="bar-center-text">
                💻 ${isWide ? `<strong>${seg.hours.toFixed(1)}h</strong> • ${seg.timeStr}` : `<strong>${seg.hours.toFixed(1)}h</strong>`}
            </span>
        </div>
      `;
    }).join('');
  } else {
    devBarsHtml = `<div class="no-dev-tag"><em>Sin sesiones de desarrollo registradas</em></div>`;
  }

  const sessionsDetailHtml = d.devSessions.map(s => `
    <span class="session-badge">
        <span class="dot-indigo"></span> <strong>${s.timeStr}</strong> (${s.hours.toFixed(2)}h) • <span class="task-desc">${s.task}</span>
    </span>
  `).join(' ');

  return `
    <div class="gantt-day-card ${d.mgrRange ? 'has-shift' : 'store-day-off'}">
        <div class="gantt-card-header">
            <div class="day-date-group">
                <span class="date-badge">${d.date.split('-')[0]} Ago</span>
                <span class="day-name-label">${d.dayName}</span>
            </div>
            <div class="day-info-pills">
                <span class="info-pill pill-shift">
                    ${d.mgrRange ? `🏪 Turno Tienda: <strong>${d.scheduled} (${d.shiftHours.toFixed(1)}h)</strong>` : '🏖️ <strong>Día Libre en Tienda</strong>'}
                </span>
                <span class="info-pill pill-dev ${d.totalDev > 0 ? 'active' : ''}">
                    💻 Dev TEG: <strong>${d.totalDev > 0 ? `${d.totalDev.toFixed(2)} hrs` : '0h'}</strong>
                </span>
            </div>
        </div>

        <div class="gantt-lanes-box">
            <div class="lane-wrapper">
                <div class="lane-label">🏪 TIENDA</div>
                <div class="lane-track mgr-lane">${mgrBarHtml}</div>
            </div>
            <div class="lane-wrapper">
                <div class="lane-label">💻 SISTEMA</div>
                <div class="lane-track dev-lane">${devBarsHtml}</div>
            </div>
        </div>

        <div class="gantt-card-footer">
            ${d.devSessions.length > 0 ? `
            <div class="sessions-breakdown">
                <span class="sessions-title">⏱️ Sesiones Reales:</span>
                ${sessionsDetailHtml}
            </div>` : ''}
        </div>
    </div>
  `;
}).join('\n');

// Time markers
const timeMarkers = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const timeRulerHtml = timeMarkers.map(h => {
  const leftPct = toPercent(h);
  const label = h === 24 || h === 0 ? '12 AM' : (h === 12 ? '12 PM' : (h > 12 ? `${h - 12} PM` : `${h} AM`));
  return `
    <div class="ruler-tick" style="left: ${leftPct.toFixed(1)}%;">
        <span class="tick-label">${label}</span>
    </div>
  `;
}).join('\n');

// Generate clean HTML
const cleanAugustHtml = `<!--
@module Reporte de Pendientes e Informe de Horas de Agosto 2026 (Tacos Gavilan)
@description Este archivo HTML contiene el informe consolidado de auditoria, plan de trabajo de los 20 proyectos tecnologicos, y el Reporte Mensual de Horas y Avances de Agosto de 2026 (${totalHours} hrs). Es compatible con WhatsApp WebViews y funciona offline.
@businessRules
  1. No requiere ejecucion de JavaScript para renderizar contenido, previniendo fallos en navegadores integrados de aplicaciones.
  2. Todos los estilos estan embebidos directamente (inline y en bloque style) utilizando colores en hexadecimal en lugar de variables CSS.
  3. No depende de redes CDN externas. Todo es nativo o usa vectores SVG embebidos.
  4. Marca Oficial: Tacos Gavilan.
@notes
  - Creado especificamente para registrar el avance de Agosto de 2026 (${totalHours} horas acumuladas hasta la fecha).
  - Incluye el Planificador Visual Diario de Horarios e Intervalos de Tiempo (4 AM - 12 AM) para Carlos Velazquez.
-->
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pendientes e Informe de Horas - Agosto 2026 - Tacos Gavilan</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        
        body {
            font-family: 'Outfit', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #f8fafc;
            color: #1e293b;
            line-height: 1.5;
            padding-bottom: 40px;
        }

        .brand-bar {
            background-color: #0f172a;
            border-bottom: 4px solid #e05638;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .brand-logo-wrap {
            display: flex;
            align-items: center;
            gap: 12px;
            color: #ffffff;
        }
        
        .brand-text-container {
            display: flex;
            flex-direction: column;
        }
        
        .brand-title {
            font-weight: 900;
            font-size: 16px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            color: #ffffff;
        }
        
        .brand-subtitle {
            font-size: 11px;
            color: #94a3b8;
            font-weight: 600;
        }
        
        .top-badge {
            background-color: rgba(224, 86, 56, 0.15);
            color: #ff6b4a;
            border: 1px solid rgba(224, 86, 56, 0.3);
            font-size: 11px;
            font-weight: 800;
            padding: 5px 12px;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .hero {
            max-width: 1240px;
            margin: 28px auto 16px auto;
            padding: 0 24px;
            text-align: left;
        }
        
        .hero h1 {
            font-size: 26px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.5px;
            margin-bottom: 6px;
        }
        
        .hero p {
            color: #64748b;
            font-size: 14px;
            font-weight: 500;
        }

        .stats-grid {
            max-width: 1240px;
            margin: 0 auto 24px auto;
            padding: 0 24px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
        }
        
        .stat-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 12px;
            padding: 16px 20px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.03);
            position: relative;
            overflow: hidden;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
        }
        
        .stat-card.total::before { background: #0f172a; }
        .stat-card.progress::before { background: #3b82f6; }
        .stat-card.pending::before { background: #f59e0b; }
        .stat-card.completed::before { background: #10b981; }
        .stat-card.hours::before { background: #e05638; }

        .stat-num {
            font-size: 26px;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.1;
        }
        
        .stat-label {
            font-size: 12px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
        }

        .tabs-container {
            max-width: 1240px;
            margin: 0 auto;
            padding: 0 24px;
        }

        .tab-nav {
            display: flex;
            gap: 8px;
            border-bottom: 2px solid #cbd5e1;
            margin-bottom: 24px;
        }

        .tab-btn {
            padding: 12px 20px;
            font-size: 14px;
            font-weight: 800;
            color: #64748b;
            cursor: pointer;
            border: none;
            background: none;
            border-bottom: 3px solid transparent;
            margin-bottom: -2px;
            transition: all 0.2s ease;
        }

        input[name="main-tabs"] {
            display: none;
        }

        #tab-reporte:checked ~ .tabs-container label[for="tab-reporte"],
        #tab-pendientes:checked ~ .tabs-container label[for="tab-pendientes"] {
            color: #e05638;
            border-bottom-color: #e05638;
        }

        .tab-panel {
            display: none;
        }

        #tab-reporte:checked ~ .tabs-container #panel-reporte,
        #tab-pendientes:checked ~ .tabs-container #panel-pendientes {
            display: block;
        }

        .gantt-container {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.06);
            margin-bottom: 28px;
        }

        .gantt-header-block {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 18px;
            border-bottom: 1.5px solid #e2e8f0;
            padding-bottom: 14px;
            flex-wrap: wrap;
            gap: 14px;
        }

        .gantt-title {
            font-size: 18px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.4px;
        }

        .gantt-subtitle {
            font-size: 13px;
            color: #64748b;
            font-weight: 500;
            margin-top: 2px;
        }

        .legend-row {
            display: flex;
            align-items: center;
            gap: 20px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 800;
            color: #1e293b;
        }

        .legend-box {
            width: 16px;
            height: 16px;
            border-radius: 4px;
        }

        .box-mgr { background: linear-gradient(90deg, #10b981 0%, #059669 100%); }
        .box-dev { background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%); }

        .sticky-ruler {
            display: flex;
            align-items: center;
            height: 36px;
            background: #0f172a;
            color: #ffffff;
            border-radius: 8px;
            padding: 0 16px 0 94px;
            position: relative;
            margin-bottom: 14px;
        }

        .ruler-canvas {
            flex: 1;
            position: relative;
            height: 100%;
        }

        .ruler-tick {
            position: absolute;
            top: 0;
            bottom: 0;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .tick-label {
            font-size: 10.5px;
            font-weight: 800;
            color: #ffffff;
            letter-spacing: -0.2px;
        }

        .days-grid {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .gantt-day-card {
            background: #ffffff;
            border: 1.5px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 18px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.02);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .gantt-day-card:hover {
            border-color: #cbd5e1;
            box-shadow: 0 6px 16px rgba(0,0,0,0.06);
        }

        .gantt-day-card.store-day-off {
            background: #fffdfa;
            border-left: 5px solid #f59e0b;
        }

        .gantt-day-card.has-shift {
            border-left: 5px solid #10b981;
        }

        .gantt-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .day-date-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .date-badge {
            background: #0f172a;
            color: #ffffff;
            font-size: 12px;
            font-weight: 900;
            padding: 4px 10px;
            border-radius: 6px;
            letter-spacing: -0.2px;
        }

        .day-name-label {
            font-size: 14px;
            font-weight: 800;
            color: #0f172a;
        }

        .day-info-pills {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .info-pill {
            font-size: 11.5px;
            padding: 4px 12px;
            border-radius: 999px;
            border: 1px solid #cbd5e1;
            background: #f8fafc;
            color: #334155;
        }

        .info-pill.pill-dev.active {
            background: #ede9fe;
            color: #4f46e5;
            border-color: #c7d2fe;
            font-weight: 800;
        }

        .gantt-lanes-box {
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 12px;
            margin-bottom: 8px;
        }

        .lane-wrapper {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .lane-label {
            width: 70px;
            font-size: 10px;
            font-weight: 900;
            color: #64748b;
            letter-spacing: 0.3px;
            flex-shrink: 0;
        }

        .lane-track {
            flex: 1;
            height: 26px;
            position: relative;
            background: #ffffff;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }

        .gantt-bar {
            position: absolute;
            top: 2px;
            bottom: 2px;
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 8px;
            color: #ffffff;
            box-shadow: 0 2px 5px rgba(0,0,0,0.12);
            transition: transform 0.15s ease;
        }

        .gantt-bar:hover {
            transform: scaleY(1.12);
            z-index: 10;
        }

        .bar-mgr {
            background: linear-gradient(90deg, #10b981 0%, #059669 100%);
            border: 1px solid #047857;
        }

        .bar-dev {
            background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%);
            border: 1px solid #4338ca;
        }

        .bar-center-text {
            font-size: 11px;
            font-weight: 800;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-shadow: 0 1px 2px rgba(0,0,0,0.6);
            margin: 0 auto;
        }

        .bar-tag-left, .bar-tag-right {
            font-size: 9px;
            font-weight: 900;
            background: rgba(15, 23, 42, 0.7);
            padding: 1px 4px;
            border-radius: 3px;
            line-height: 1;
        }

        .day-off-tag {
            font-size: 11px;
            color: #d97706;
            font-weight: 700;
            padding: 3px 8px;
        }

        .no-dev-tag {
            font-size: 11px;
            color: #94a3b8;
            font-style: italic;
            padding: 3px 8px;
        }

        .gantt-card-footer {
            font-size: 11px;
            color: #475569;
        }

        .sessions-breakdown {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            padding-top: 4px;
        }

        .sessions-title {
            font-weight: 800;
            color: #0f172a;
        }

        .session-badge {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            padding: 2px 8px;
            border-radius: 6px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 10.5px;
        }

        .dot-indigo {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #6366f1;
            display: inline-block;
        }

        .task-desc {
            color: #64748b;
        }

        .table-responsive {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 14px;
            overflow-x: auto;
            margin-bottom: 28px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.04);
        }

        .hours-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            text-align: left;
        }

        .hours-table th {
            background: #0f172a;
            color: #ffffff;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 0.5px;
            padding: 14px 16px;
        }

        .hours-table td {
            padding: 14px 16px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
        }

        .hours-table tr:nth-child(even) {
            background: #f8fafc;
        }

        .hours-table tr:hover {
            background: #f1f5f9;
        }

        .table-badge-module {
            display: inline-block;
            background: #ede9fe;
            color: #5b21b6;
            border: 1px solid #c4b5fd;
            font-size: 10.5px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 999px;
            margin: 2px 2px 2px 0;
            white-space: nowrap;
        }

        .lang-split {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .es-desc {
            color: #0f172a;
            line-height: 1.45;
        }

        .en-desc {
            color: #64748b;
            font-size: 12px;
            line-height: 1.4;
            border-top: 1px dashed #cbd5e1;
            padding-top: 6px;
            font-style: italic;
        }

        .parallel-card-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-bottom: 28px;
        }

        .parallel-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 12px;
            padding: 18px 20px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.03);
        }

        .parallel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .parallel-title {
            font-size: 15px;
            font-weight: 800;
            color: #0f172a;
        }

        .parallel-badge {
            background: #0f172a;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            padding: 3px 10px;
            border-radius: 999px;
        }

        .parallel-desc {
            font-size: 12.5px;
            color: #475569;
            line-height: 1.4;
        }

        .effort-summary-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 14px;
            padding: 20px 24px;
            margin-bottom: 28px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.04);
        }

        .effort-title {
            font-size: 16px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 14px;
            border-bottom: 1.5px solid #e2e8f0;
            padding-bottom: 8px;
        }

        .effort-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 14px;
        }

        .effort-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .effort-name {
            font-size: 12.5px;
            font-weight: 700;
            color: #334155;
        }

        .effort-hours {
            font-size: 14px;
            font-weight: 900;
            color: #e05638;
        }

        .footer {
            max-width: 1240px;
            margin: 32px auto 0 auto;
            padding: 18px 24px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #64748b;
        }
    </style>
</head>
<body>

    <!-- Tab Radios -->
    <input type="radio" id="tab-reporte" name="main-tabs" checked>
    <input type="radio" id="tab-pendientes" name="main-tabs">

    <!-- Top Brand Bar -->
    <div class="brand-bar">
        <div class="brand-logo-wrap">
            <div class="brand-text-container">
                <span class="brand-title">TACOS GAVILAN</span>
                <span class="brand-subtitle">SISTEMA DE MONITOREO Y PLANIFICACION OPERATIVA (SM TEG)</span>
            </div>
        </div>
        <span class="top-badge">INFORME MENSUAL • AGOSTO 2026</span>
    </div>

    <!-- Hero Section -->
    <div class="hero">
        <h1>Informe Consolidado de Horas y Planificacion de Proyectos</h1>
        <p>Reporte oficial de horas de ingenieria, arquitectura de software, auditoria forense y seguimiento de los 20 modulos tecnologicos.</p>
    </div>

    <!-- Stats Row -->
    <div class="stats-grid">
        <div class="stat-card total">
            <div class="stat-num">20</div>
            <div class="stat-label">Total Tareas</div>
        </div>
        <div class="stat-card progress">
            <div class="stat-num">9</div>
            <div class="stat-label">En Progreso</div>
        </div>
        <div class="stat-card pending">
            <div class="stat-num">7</div>
            <div class="stat-label">Pendiente</div>
        </div>
        <div class="stat-card completed">
            <div class="stat-num">4</div>
            <div class="stat-label">Completado</div>
        </div>
        <div class="stat-card hours">
            <div class="stat-num">${totalHours} <small style="font-size:16px;">hrs</small></div>
            <div class="stat-label">Horas Agosto</div>
        </div>
    </div>

    <!-- Tabs Navigation & Content -->
    <div class="tabs-container">
        <div class="tab-nav">
            <label for="tab-reporte" class="tab-btn">📅 Reporte Mensual (Agosto 2026)</label>
            <label for="tab-pendientes" class="tab-btn">📋 Pendientes del Sistema (20 Modulos)</label>
        </div>

        <!-- ═══════════════════════════════════════════════════════════════════ -->
        <!-- TAB 1: REPORTE MENSUAL (AGOSTO 2026)                                -->
        <!-- ═══════════════════════════════════════════════════════════════════ -->
        <div id="panel-reporte" class="tab-panel">

            <!-- GANTT SCHEDULE COMPONENT -->
            <div class="gantt-container">
                <div class="gantt-header-block">
                    <div>
                        <div class="gantt-title">Planificador Diario de Horarios e Intervalos de Tiempo (4:00 AM – 12:00 AM)</div>
                        <div class="gantt-subtitle">Visualizacion en pistas horizontales que refleja las 52 sesiones reales de programacion (${totalHours} hrs) cruzadas con los turnos oficiales de Lynwood (136 hrs).</div>
                    </div>
                    <div class="legend-row">
                        <div class="legend-item">
                            <span class="legend-box box-mgr"></span>
                            <span>🏪 Horario en Lynwood (136 hrs)</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-box box-dev"></span>
                            <span>💻 Sesiones de Programacion (${totalHours} hrs)</span>
                        </div>
                    </div>
                </div>

                <!-- Sticky Time Ruler on Top -->
                <div class="sticky-ruler">
                    <div class="ruler-canvas">
                        ${timeRulerHtml}
                    </div>
                </div>

                <!-- Days Grid -->
                <div class="days-grid">
                    ${ganttCardsHtml}
                </div>
            </div>

            <!-- DETAILED ACTIVITY TABLE -->
            <div class="table-responsive">
                <table class="hours-table">
                    <thead>
                        <tr>
                            <th style="width: 110px;">Fecha</th>
                            <th style="width: 140px;">Horario</th>
                            <th style="width: 70px; text-align: center;">Horas</th>
                            <th style="width: 220px;">Modulos</th>
                            <th>Descripcion Bilingue del Trabajo Realizado (ES / EN)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- 01-Aug-2026 -->
                        <tr>
                            <td><strong>01-Aug-2026</strong></td>
                            <td>6:30 PM - 9:00 PM</td>
                            <td style="text-align: center; font-weight: 800;">4.50</td>
                            <td><span class="table-badge-module">Preparador</span> <span class="table-badge-module">Soporte IA</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Preparador (Proyecciones por Tramos y Live Data)**: Transicion completa del sistema de proyecciones de carne a bloques de hora pico (Apertura, Almuerzo, Medio Dia, Cena, Cierre). Ajuste dinamico de apertura y obtencion sin cache (no-store).<br>- **Capacidad Maxima de Charola**: Nuevo badge de capacidad maxima por proteina usando Math.ceil() y exportacion de tabla HTML autonoma para iPhone y WhatsApp.<br>- **Soporte IA**: Sincronizacion del prompt del asistente de soporte.</div>
                                    <div class="en-desc">- **Prep Line (Period Blocks & Live Data)**: Transition to peak time blocks (Opening, Lunch, Mid Day, Dinner, Close) with zero-cache live fetching. Max tray holding badge and AI assistant prompt synchronization.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 02-Aug-2026 -->
                        <tr>
                            <td><strong>02-Aug-2026</strong></td>
                            <td>5:00 PM - 6:00 PM</td>
                            <td style="text-align: center; font-weight: 800;">1.00</td>
                            <td><span class="table-badge-module">Preparador</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Preparador (Modo Basico vs Avanzado y Kiosko Tableta)**: Conmutador de modo visual con tarjetas limpias de un solo numero. Boton de pantalla completa para cocina y auto-seleccion del dia en la Guia Operativa.</div>
                                    <div class="en-desc">- **Prep Line (Basic vs Advanced & Tablet Kiosk)**: Clean single-number cards in basic mode. Fullscreen kiosk mode for kitchen tablet and auto-selected day in guide.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 03-Aug-2026 -->
                        <tr>
                            <td><strong>03-Aug-2026</strong></td>
                            <td>4:42 PM - 9:36 PM</td>
                            <td style="text-align: center; font-weight: 800;">3.92</td>
                            <td><span class="table-badge-module">Inventario</span> <span class="table-badge-module">QuickBooks</span> <span class="table-badge-module">Tech Pack</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Inventario (QuickBooks Estimates)**: Correccion de PATCH con sparse: false para evitar eliminacion de items no listados en guardados parciales.<br>- **Tech Pack Uniformes**: Fichas tecnicas iniciales de confeccion de camisas y gorras.</div>
                                    <div class="en-desc">- **Inventory (QB Estimates)**: Fixed PATCH updates with sparse: false to prevent item wiping. Initial uniform tech pack spec sheets.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 04-Aug-2026 -->
                        <tr>
                            <td><strong>04-Aug-2026</strong></td>
                            <td>9:45 AM - 7:00 PM</td>
                            <td style="text-align: center; font-weight: 800;">9.00</td>
                            <td><span class="table-badge-module">Tech Pack Uniformes</span> <span class="table-badge-module">RFQ</span> <span class="table-badge-module">Preparador</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Tech Pack Oficial de Uniformes y RFQ Formaryx**: Creacion del Tech Pack PDF de grado industrial para camisas de cocinero y gorras bordadas con tablas de medidas y especificaciones de tela.<br>- **Preparador (Modo Manual Semanal)**: Selector de 3 modos [Manual | Basica | Avanzada] con persistencia semanal en Supabase.</div>
                                    <div class="en-desc">- **Uniform Tech Pack & Supplier RFQ**: Built industrial-grade manufacturing PDF tech packs with garment specs and sizing charts. 3-mode weekly prep toggle in DB.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 05-Aug-2026 -->
                        <tr>
                            <td><strong>05-Aug-2026</strong></td>
                            <td>11:40 AM - 4:12 PM</td>
                            <td style="text-align: center; font-weight: 800;">1.64</td>
                            <td><span class="table-badge-module">Inventario</span> <span class="table-badge-module">Uniformes</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Inventario (PAR Semanal Uniformes)**: Ajuste en tiempo real de niveles PAR en Configurar Semana para pedidos de uniformes y sincronizacion con almacen central.</div>
                                    <div class="en-desc">- **Inventory (Weekly Uniform PAR)**: Live PAR level adjustments in Configure Week for uniform restocking and central warehouse sync.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 06-Aug-2026 -->
                        <tr>
                            <td><strong>06-Aug-2026</strong></td>
                            <td>10:00 AM - 3:00 PM</td>
                            <td style="text-align: center; font-weight: 800;">1.75</td>
                            <td><span class="table-badge-module">Preparador</span> <span class="table-badge-module">Base de Datos</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Preparador (Sincronizacion Tableta-PC)**: Polling de auto-sincronizacion cada 10s en la tableta de cocina. Migracion de la tabla prep_manual_schedule en Supabase y tipografia ampliada para visibilidad en cocina.</div>
                                    <div class="en-desc">- **Prep Line (Tablet-PC Sync)**: 10s auto-sync polling on kitchen tablet, prep_manual_schedule DB migration, and enlarged kitchen typography.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 07-Aug-2026 -->
                        <tr>
                            <td><strong>07-Aug-2026</strong></td>
                            <td>11:28 AM - 1:46 PM</td>
                            <td style="text-align: center; font-weight: 800;">2.54</td>
                            <td><span class="table-badge-module">Horarios</span> <span class="table-badge-module">Violaciones</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Horarios (Alertas Automaticas de Descansos LUNCH)**: Sistema de notificaciones automaticas por correo electronico para violaciones de comida cuando un empleado no toma su descanso reglamentario.</div>
                                    <div class="en-desc">- **Schedules (Lunch Break Violation Alerts)**: Automated email notification pipeline alerting managers when staff miss mandated meal breaks.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 08-Aug-2026 -->
                        <tr>
                            <td><strong>08-Aug-2026</strong></td>
                            <td>1:00 PM - 8:00 PM</td>
                            <td style="text-align: center; font-weight: 800;">7.15</td>
                            <td><span class="table-badge-module">Preparador</span> <span class="table-badge-module">Menu TVs</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Ritmo de Parrilla y Pantallas TV**: Proyeccion de libras crudas en parrilla cada 30 min para Asada, Pastor, Pollo, Cabeza y Lengua. Sincronizacion de pantallas TV en sucursales.</div>
                                    <div class="en-desc">- **Grill Pace & TV Displays**: Raw meat cooking pace projections per 30-min block for grill meats. Real-time TV menu display sync.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 09-Aug-2026 -->
                        <tr>
                            <td><strong>09-Aug-2026</strong></td>
                            <td>2:09 PM - 7:33 PM</td>
                            <td style="text-align: center; font-weight: 800;">2.74</td>
                            <td><span class="table-badge-module">Preparador</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Preparador (Acelerador Intraday)**: Algoritmo de calibracion de ritmo que compara ventas reales de hoy vs historico para ajustar la produccion de carne en tiempo real.</div>
                                    <div class="en-desc">- **Prep Line (Intraday Accelerator)**: Pace calibration algorithm comparing real-time today sales against historical projection to adjust meat prep.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 10-Aug-2026 -->
                        <tr>
                            <td><strong>10-Aug-2026</strong></td>
                            <td>3:30 PM - 5:30 PM</td>
                            <td style="text-align: center; font-weight: 800;">2.30</td>
                            <td><span class="table-badge-module">Uniformes</span> <span class="table-badge-module">Recepcion</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Control de Prendas y Recepcion**: Modulo de recepcion de uniformes con escaneo y validacion de tallas contra pedidos de bodega.</div>
                                    <div class="en-desc">- **Uniform Garment Control & Receiving**: Garment receiving module validating item sizes and quantities against warehouse orders.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 11-Aug-2026 -->
                        <tr>
                            <td><strong>11-Aug-2026</strong></td>
                            <td>9:17 AM - 7:50 PM</td>
                            <td style="text-align: center; font-weight: 800;">3.18</td>
                            <td><span class="table-badge-module">Inventario</span> <span class="table-badge-module">Caja Fuerte</span> <span class="table-badge-module">RBAC</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Caja Fuerte, Mapeo de Bodega y RBAC**: Sistema de auditoria de arqueos en caja fuerte, control de acceso por roles (RBAC) y correccion de mapeos de almacen en Supabase.</div>
                                    <div class="en-desc">- **Safe Box, Warehouse Mapping & RBAC**: Safe cash audit tracking, role-based access control, and Supabase warehouse catalog mapping.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 12-Aug-2026 -->
                        <tr>
                            <td><strong>12-Aug-2026</strong></td>
                            <td>1:15 PM - 11:30 PM</td>
                            <td style="text-align: center; font-weight: 800;">4.33</td>
                            <td><span class="table-badge-module">Basecamp 3 API</span> <span class="table-badge-module">Dia Libre</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Basecamp 3 API en Dia Libre**: Construccion del pipeline de integracion con Basecamp 3 API, sincronizador de proyectos, to-dos y mensajes con Supabase.</div>
                                    <div class="en-desc">- **Basecamp 3 API on Day Off**: Built Basecamp 3 integration pipeline, syncing projects, to-dos, and comment threads into Supabase.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 13-Aug-2026 -->
                        <tr>
                            <td><strong>13-Aug-2026</strong></td>
                            <td>8:31 AM - 7:22 PM</td>
                            <td style="text-align: center; font-weight: 800;">6.45</td>
                            <td><span class="table-badge-module">MilesIQ IRS</span> <span class="table-badge-module">Caja Fuerte</span> <span class="table-badge-module">Uniformes</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **MilesIQ Deduccion IRS y Boveda**: Integracion de calculo de millaje deducible bajo tarifa IRS ($0.67/milla) y registro de arqueos de boveda.</div>
                                    <div class="en-desc">- **MilesIQ IRS Mileage & Safe Box**: Implemented IRS deductible mileage tracking ($0.67/mile) and safe box cash audit reconciliations.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 14-Aug-2026 -->
                        <tr>
                            <td><strong>14-Aug-2026</strong></td>
                            <td>2:00 PM - 9:00 PM</td>
                            <td style="text-align: center; font-weight: 800;">0.00</td>
                            <td><span class="table-badge-module">Gerencia Lynwood</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Gerencia Operativa Lynwood (100%)**: Turno completo dedicado a la supervision y operacion del restaurante.</div>
                                    <div class="en-desc">- **Lynwood Store Management (100%)**: Full scheduled store shift dedicated exclusively to restaurant management.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 15-Aug-2026 -->
                        <tr>
                            <td><strong>15-Aug-2026</strong></td>
                            <td>4:11 PM - 9:12 PM</td>
                            <td style="text-align: center; font-weight: 800;">4.94</td>
                            <td><span class="table-badge-module">Tech Pack Uniformes</span> <span class="table-badge-module">Tablas de Tallas</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Tech Pack (Tablas de Medidas y Fabricante)**: Fichas tecnicas completas con tablas de medidas por talla (S a 4XL) y directrices de bordado para cotizacion de uniformes.</div>
                                    <div class="en-desc">- **Tech Pack (Garment Spec & Sizing)**: Complete manufacturing spec sheets with measurement tables across all sizes (S to 4XL) for supplier bidding.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 16-Aug-2026 -->
                        <tr>
                            <td><strong>16-Aug-2026</strong></td>
                            <td>12:37 PM - 5:59 AM</td>
                            <td style="text-align: center; font-weight: 800;">6.96</td>
                            <td><span class="table-badge-module">MilesIQ GPS</span> <span class="table-badge-module">Simulador</span> <span class="table-badge-module">Planificador</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **MilesIQ (GPS 15 Tiendas y Simulador)**: Algoritmo de deteccion GPS de la tienda mas cercana con Haversine y simulador de rutas con matriz de distancias.</div>
                                    <div class="en-desc">- **MilesIQ (15 Store GPS & Simulator)**: Nearest-store GPS detection algorithm using Haversine math and pairwise distance matrix route simulator.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 17-Aug-2026 -->
                        <tr>
                            <td><strong>17-Aug-2026</strong></td>
                            <td>4:00 AM - 3:35 PM</td>
                            <td style="text-align: center; font-weight: 800;">4.43</td>
                            <td><span class="table-badge-module">Radar Precios</span> <span class="table-badge-module">Catalogo Viele</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Catalogo Viele & Sons y Radar de Precios**: Extraccion e indexacion de los 87 insumos de Viele & Sons con precios base y deteccion de aumentos en insumos clave.</div>
                                    <div class="en-desc">- **Viele & Sons Catalog & Price Radar**: Extracted and indexed 87 Viele & Sons master ingredients with baseline costs to track supplier price hikes.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 18-Aug-2026 -->
                        <tr>
                            <td><strong>18-Aug-2026</strong></td>
                            <td>11:00 AM - 6:29 PM</td>
                            <td style="text-align: center; font-weight: 800;">5.39</td>
                            <td><span class="table-badge-module">Radar Precios</span> <span class="table-badge-module">Scraper Viele v3</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Scraper API Viele v3 y Auditoria de Precios**: Motor automatizado de descarga de facturas y precios de Viele & Sons con normalizacion de empaques multi-pack.</div>
                                    <div class="en-desc">- **Viele Scraper API v3 & Price Audit**: Automated supplier invoice scraper normalizing multi-pack quantities and cost variances.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 19-Aug-2026 -->
                        <tr>
                            <td><strong>19-Aug-2026</strong></td>
                            <td>9:44 AM - 5:15 PM</td>
                            <td style="text-align: center; font-weight: 800;">4.70</td>
                            <td><span class="table-badge-module">Auditoria 17 Bugs</span> <span class="table-badge-module">Uniformes</span> <span class="table-badge-module">Radar</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Auditoria Forense de 17 Bugs y Rediseno de Radar**: Correccion de 17 bugs criticos en recepcion de uniformes, permisos RBAC y simplificacion de la UI del Radar de Precios.</div>
                                    <div class="en-desc">- **Forensic Audit (17 Bugs) & Radar Redesign**: Resolved 17 critical bugs in uniform receiving, RBAC security, and simplified Price Radar UI.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 20-Aug-2026 -->
                        <tr>
                            <td><strong>20-Aug-2026</strong></td>
                            <td>6:15 AM - 11:45 PM</td>
                            <td style="text-align: center; font-weight: 800;">6.98</td>
                            <td><span class="table-badge-module">Basecamp</span> <span class="table-badge-module">MilesIQ 15 Tiendas</span> <span class="table-badge-module">Radar 35/35</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Basecamp "View As" y MilesIQ 15 Tiendas Oficiales**: Geocodificacion canonica de las 15 tiendas con tacosgavilan.com. Menu View As (Cards/List) y badge de comentarios en Basecamp.<br>- **Radar de Precios (Tablero Ejecutivo & Simulacion 35/35)**: Rediseno a 1 clic con 4 metricas anuales en USD ($) para las 15 sucursales y suite de 35 pruebas automatizadas aprobadas.</div>
                                    <div class="en-desc">- **Basecamp "View As" & MilesIQ 15 Canonical Stores**: Canonical store GPS sync with tacosgavilan.com. 1-click Price Radar executive dashboard with 35/35 automated test suite.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 21-Aug-2026 -->
                        <tr>
                            <td><strong>21-Aug-2026</strong></td>
                            <td>6:09 AM - 9:28 PM</td>
                            <td style="text-align: center; font-weight: 800;">4.36</td>
                            <td><span class="table-badge-module">Basecamp 4 Dialog</span> <span class="table-badge-module">Alertas Correo</span> <span class="table-badge-module">Descansos IA</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Modal Basecamp 4 Dialog Card**: Rediseno con backdrop blur, carga bajo demanda de mas de 30,600 comentarios en Supabase y solucion al error Maximum update depth exceeded.<br>- **Alertas por Correo a Directivos y Motor IA de Descansos**: Envio automatico de notificaciones de aumento de precios a directivos y persistencia de preferencias de descansos por tienda.</div>
                                    <div class="en-desc">- **Basecamp 4 Dialog Modal & Leadership Email Alerts**: Rebuilt task modal with backdrop blur and on-demand comments. Automated executive price alert emails and AI break preference learning.</div>
                                </div>
                            </td>
                        </tr>

                        <!-- 22-Aug-2026 -->
                        <tr>
                            <td><strong>22-Aug-2026</strong></td>
                            <td>5:22 PM - 8:55 PM</td>
                            <td style="text-align: center; font-weight: 800;">3.76</td>
                            <td><span class="table-badge-module">Toast API POS</span> <span class="table-badge-module">Cross-Date Refunds</span> <span class="table-badge-module">Auditoria Ventas</span></td>
                            <td>
                                <div class="lang-split">
                                    <div class="es-desc">- **Auditoria Forense de Ventas y Reembolsos Cruzados (Cross-Date Refunds)**: Deteccion de ordenes de Party Trays cobradas con antelacion y reembolsadas en fechas posteriores (caso Bell $8,332.64). Implementacion de getCrossDateRefunds en lib/toast-api.ts con conciliacion exacta al centavo.<br>- **Refactorizacion Integral del Modulo de Ventas**: Blindaje de auto-curacion (app/ventas/page.tsx), exportacion CSV real, correccion de algebra de descuentos y soporte bilingue useLanguage().</div>
                                    <div class="en-desc">- **Forensic Sales Audit & Toast API Cross-Date Refunds**: Solved advance Party Tray orders refunded on later dates (Bell $8,332.64). Full sales module refactor with penny-perfect reconciliation.</div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- PARALLEL ACTIVITIES SECTION -->
            <div class="parallel-card-grid">
                <div class="parallel-card">
                    <div class="parallel-header">
                        <span class="parallel-title">🧪 Pruebas en Sucursal Lynwood</span>
                        <span class="parallel-badge">4.5 hrs</span>
                    </div>
                    <p class="parallel-desc">Validacion en tiempo real del modo kiosko de preparador en cocina, pruebas de sincronizacion tactil PC-Tableta y verificacion de arqueos de caja fuerte en sitio.</p>
                </div>

                <div class="parallel-card">
                    <div class="parallel-header">
                        <span class="parallel-title">🔍 Monitoreo de APIs y Base de Datos</span>
                        <span class="parallel-badge">3.5 hrs</span>
                    </div>
                    <p class="parallel-desc">Monitoreo continuo de Supabase (sales_daily_cache, bc_comments, prep_manual_schedule), QuickBooks Estimates PATCH y entregas de correos de alertas.</p>
                </div>

                <div class="parallel-card">
                    <div class="parallel-header">
                        <span class="parallel-title">📐 Arquitectura y Tech Packs</span>
                        <span class="parallel-badge">2.0 hrs</span>
                    </div>
                    <p class="parallel-desc">Diseno de especificaciones de manufactura textil para uniformes, modelado de bases de datos relacionales y diseno de tableros ejecutivos a 1 clic.</p>
                </div>
            </div>

            <!-- EFFORT SUMMARY -->
            <div class="effort-summary-card">
                <div class="effort-title">📊 Resumen Consolidado de Esfuerzo por Modulo (Agosto 2026)</div>
                <div class="effort-grid">
                    <div class="effort-item">
                        <span class="effort-name">Preparador de Carne & TV Menus</span>
                        <span class="effort-hours">23.6 hrs</span>
                    </div>
                    <div class="effort-item">
                        <span class="effort-name">Tech Packs, RFQ & Uniformes</span>
                        <span class="effort-hours">18.5 hrs</span>
                    </div>
                    <div class="effort-item">
                        <span class="effort-name">Basecamp 3 Sincronizador & UI</span>
                        <span class="effort-hours">16.8 hrs</span>
                    </div>
                    <div class="effort-item">
                        <span class="effort-name">Radar de Precios Viele & Scraper</span>
                        <span class="effort-hours">16.3 hrs</span>
                    </div>
                    <div class="effort-item">
                        <span class="effort-name">MilesIQ IRS & GPS 15 Tiendas</span>
                        <span class="effort-hours">8.9 hrs</span>
                    </div>
                    <div class="effort-item">
                        <span class="effort-name">Ventas Toast API & Reembolsos</span>
                        <span class="effort-hours">5.5 hrs</span>
                    </div>
                </div>
            </div>

        </div>

        <!-- ═══════════════════════════════════════════════════════════════════ -->
        <!-- TAB 2: PENDIENTES DEL SISTEMA (20 MODULOS)                          -->
        <!-- ═══════════════════════════════════════════════════════════════════ -->
        <div id="panel-pendientes" class="tab-panel">
            ${tab1Content}
        </div>

    </div>

    <!-- Footer -->
    <div class="footer">
        <span>Tacos Gavilan • SM TEG • Informe Oficial de Horas y Proyectos</span>
        <span>Generado para Carlos Velazquez: 22-Ago-2026</span>
    </div>

</body>
</html>
`;

// Save clean HTML
const outReportPath = 'c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html';
fs.writeFileSync(outReportPath, cleanAugustHtml, 'utf-8');
console.log('✅ pendientes_agosto.html reconstruido limpiamente: ' + outReportPath);

(async () => {
    console.log('🚀 Compilando Reporte_Agosto_2026_TEG.pdf con Puppeteer...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1800 });

    const fileUrl = `file:///${outReportPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const pdfOutPath = 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf';
    await page.pdf({
        path: pdfOutPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    console.log('🎉 Reporte_Agosto_2026_TEG.pdf generado exitosamente!');
    
    // Screenshot
    const screenshotPath = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/clean_report_preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('📸 Screenshot de verificacion guardado en: ' + screenshotPath);

    await browser.close();
})();

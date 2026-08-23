const fs = require('fs');
const path = require('path');

// Master CSS styles to share identically across all 3 reports
const SHARED_CSS = `
        :root {
            --primary: #e05638;
            --primary-hover: #c84528;
            --primary-light: #fff5f2;
            --dark: #0f172a;
            --slate-800: #1e293b;
            --slate-700: #334155;
            --slate-600: #475569;
            --slate-500: #64748b;
            --slate-400: #94a3b8;
            --slate-200: #e2e8f0;
            --slate-100: #f1f5f9;
            --slate-50: #f8fafc;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --info: #3b82f6;
            --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--font);
            background-color: #f8fafc;
            color: var(--slate-700);
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        /* Top Brand Bar */
        .top-brand-bar {
            background-color: var(--dark);
            color: white;
            padding: 8px 24px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .brand-pill {
            background-color: var(--primary);
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: 800;
        }

        /* Container */
        .container {
            max-width: 1300px;
            margin: 0 auto;
            padding: 24px 20px;
        }

        /* Hero */
        .hero {
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border-radius: 16px;
            padding: 28px 32px;
            color: white;
            margin-bottom: 24px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .hero::after {
            content: '';
            position: absolute;
            top: -50%;
            right: -10%;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, rgba(224, 86, 56, 0.15) 0%, rgba(0,0,0,0) 70%);
            border-radius: 50%;
        }

        .hero-title {
            font-size: 26px;
            font-weight: 800;
            letter-spacing: -0.5px;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .hero-subtitle {
            font-size: 14px;
            color: var(--slate-400);
            max-width: 800px;
        }

        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .stat-card {
            background: white;
            padding: 16px 20px;
            border-radius: 12px;
            border: 1px solid var(--slate-200);
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .stat-icon {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            flex-shrink: 0;
        }

        .stat-info {
            overflow: hidden;
        }

        .stat-num {
            font-size: 22px;
            font-weight: 800;
            color: var(--dark);
            line-height: 1.1;
        }

        .stat-label {
            font-size: 11px;
            font-weight: 700;
            color: var(--slate-500);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 2px;
        }

        /* Tabs System */
        .tabs-nav {
            display: flex;
            gap: 8px;
            border-bottom: 2px solid var(--slate-200);
            margin-bottom: 24px;
            background: white;
            padding: 8px 12px 0 12px;
            border-radius: 12px 12px 0 0;
            border: 1px solid var(--slate-200);
            border-bottom: 2px solid var(--slate-200);
        }

        .tab-btn {
            padding: 12px 20px;
            font-size: 14px;
            font-weight: 700;
            color: var(--slate-500);
            cursor: pointer;
            border-radius: 8px 8px 0 0;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            user-select: none;
            border-bottom: 3px solid transparent;
            margin-bottom: -2px;
        }

        .tab-btn:hover {
            color: var(--primary);
            background-color: var(--primary-light);
        }

        input[type="radio"].tab-control {
            display: none;
        }

        #tab-reporte:checked ~ .tabs-nav label[for="tab-reporte"],
        #tab-pendientes:checked ~ .tabs-nav label[for="tab-pendientes"] {
            color: var(--primary);
            border-bottom-color: var(--primary);
            background-color: transparent;
        }

        .tab-content {
            display: none;
        }

        #tab-reporte:checked ~ .tab-content-reporte,
        #tab-pendientes:checked ~ .tab-content-pendientes {
            display: block;
        }

        /* Gantt Container */
        .gantt-section {
            background: white;
            border-radius: 14px;
            border: 1px solid var(--slate-200);
            padding: 24px;
            margin-bottom: 28px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }

        .gantt-section-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 12px;
        }

        .gantt-section-title {
            font-size: 18px;
            font-weight: 800;
            color: var(--dark);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .gantt-section-subtitle {
            font-size: 13px;
            color: var(--slate-500);
            margin-top: 2px;
        }

        .gantt-legend {
            display: flex;
            gap: 16px;
            align-items: center;
            background: var(--slate-50);
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid var(--slate-200);
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 700;
            color: var(--slate-700);
        }

        .legend-box {
            width: 12px;
            height: 12px;
            border-radius: 3px;
        }

        .box-mgr { background-color: #0284c7; }
        .box-dev { background-color: #e05638; }

        /* Timeline Header Ruler (Sticky) */
        .timeline-ruler-wrapper {
            position: sticky;
            top: 0;
            z-index: 20;
            background: white;
            padding: 10px 0 6px 0;
            border-bottom: 2px solid var(--slate-200);
            margin-bottom: 12px;
        }

        .timeline-ruler {
            display: flex;
            width: 100%;
            padding-left: 110px; /* offset for day title column */
        }

        .ruler-hour {
            flex: 1;
            font-size: 10px;
            font-weight: 700;
            color: var(--slate-400);
            text-align: center;
            border-left: 1px dashed #cbd5e1;
            padding-bottom: 2px;
            user-select: none;
        }

        /* Gantt Days Cards List */
        .gantt-days-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .gantt-day-card {
            background: white;
            border: 1px solid var(--slate-200);
            border-radius: 10px;
            padding: 12px 14px;
            transition: all 0.15s ease;
        }

        .gantt-day-card:hover {
            border-color: #cbd5e1;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
        }

        .gantt-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--slate-100);
        }

        .day-date-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .date-badge {
            background: var(--dark);
            color: white;
            font-size: 12px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 6px;
            letter-spacing: 0.3px;
        }

        .day-name-label {
            font-size: 12px;
            font-weight: 700;
            color: var(--slate-600);
            text-transform: capitalize;
        }

        .day-info-pills {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .info-pill {
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .pill-shift {
            background-color: #f0f9ff;
            color: #0369a1;
            border: 1px solid #bae6fd;
        }

        .pill-dev {
            background-color: #f8fafc;
            color: #64748b;
            border: 1px solid var(--slate-200);
        }

        .pill-dev.active {
            background-color: #fff7ed;
            color: #c2410c;
            border-color: #fed7aa;
            font-weight: 800;
        }

        /* Lane Tracks */
        .gantt-lanes-box {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .lane-wrapper {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .lane-label {
            width: 100px;
            font-size: 10px;
            font-weight: 800;
            color: var(--slate-500);
            letter-spacing: 0.5px;
            flex-shrink: 0;
            text-align: right;
            padding-right: 4px;
        }

        .lane-track {
            flex: 1;
            height: 24px;
            background: #f1f5f9;
            border-radius: 6px;
            position: relative;
            overflow: hidden;
            border: 1px solid #e2e8f0;
        }

        .gantt-bar {
            position: absolute;
            top: 2px;
            bottom: 2px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 6px;
            color: white;
            font-size: 10px;
            font-weight: 700;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            overflow: hidden;
            white-space: nowrap;
        }

        .bar-mgr {
            background: linear-gradient(90deg, #0284c7 0%, #0369a1 100%);
            border: 1px solid #075985;
        }

        .bar-dev {
            background: linear-gradient(90deg, #f97316 0%, #ea580c 100%);
            border: 1px solid #c2410c;
        }

        .bar-tag-left, .bar-tag-right {
            font-size: 9px;
            opacity: 0.9;
        }

        .bar-center-text {
            margin: 0 auto;
            font-weight: 800;
        }

        .gantt-card-footer {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px dashed var(--slate-200);
        }

        .sessions-breakdown {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
        }

        .sessions-title {
            font-size: 11px;
            font-weight: 800;
            color: var(--slate-500);
            margin-right: 4px;
        }

        .session-badge {
            font-size: 11px;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            padding: 2px 8px;
            border-radius: 6px;
            color: var(--slate-700);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .dot-indigo {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: var(--primary);
        }

        /* Activity Table Section */
        .table-section {
            background: white;
            border-radius: 14px;
            border: 1px solid var(--slate-200);
            padding: 24px;
            margin-bottom: 28px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }

        .table-title {
            font-size: 18px;
            font-weight: 800;
            color: var(--dark);
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .activity-table-wrapper {
            overflow-x: auto;
            border-radius: 10px;
            border: 1px solid var(--slate-200);
        }

        .activity-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            text-align: left;
        }

        .activity-table th {
            background: #f8fafc;
            color: var(--slate-600);
            font-weight: 800;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 0.5px;
            padding: 12px 14px;
            border-bottom: 2px solid var(--slate-200);
        }

        .activity-table td {
            padding: 12px 14px;
            border-bottom: 1px solid var(--slate-100);
            vertical-align: top;
        }

        .activity-table tbody tr:hover {
            background-color: #fbfcfe;
        }

        .date-cell {
            font-weight: 800;
            color: var(--dark);
            white-space: nowrap;
        }

        .time-cell {
            font-size: 12px;
            color: var(--slate-600);
            white-space: nowrap;
        }

        .hours-cell {
            font-weight: 800;
            color: var(--primary);
            text-align: center;
            font-size: 14px;
        }

        .mod-badge {
            display: inline-block;
            background: #eff6ff;
            color: #1d4ed8;
            border: 1px solid #bfdbfe;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            margin: 2px 4px 2px 0;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .desc-es {
            color: var(--slate-800);
            margin-bottom: 6px;
            font-size: 12.5px;
            line-height: 1.5;
        }

        .desc-en {
            color: var(--slate-500);
            font-size: 11.5px;
            font-style: italic;
            line-height: 1.4;
        }

        /* Parallel Activities & Effort Summary */
        .parallel-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .p-card {
            background: white;
            border: 1px solid var(--slate-200);
            border-radius: 12px;
            padding: 16px 20px;
        }

        .p-card-title {
            font-size: 14px;
            font-weight: 800;
            color: var(--dark);
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .p-card-hours {
            background: #f1f5f9;
            color: var(--slate-700);
            font-size: 12px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 6px;
        }

        .p-card-desc {
            font-size: 12px;
            color: var(--slate-600);
            line-height: 1.5;
        }

        /* Tasks Grid (Tab 2) */
        .tasks-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
            gap: 20px;
        }

        .task-card {
            background: white;
            border: 1px solid var(--slate-200);
            border-radius: 14px;
            padding: 20px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
            transition: all 0.15s ease;
        }

        .task-card:hover {
            border-color: #cbd5e1;
            box-shadow: 0 6px 12px -2px rgba(0,0,0,0.06);
        }

        .task-card-header {
            margin-bottom: 12px;
        }

        .task-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 10px;
        }

        .badge-cat {
            font-size: 10px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 4px;
            text-transform: uppercase;
        }

        .badge-status {
            font-size: 10px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 4px;
            text-transform: uppercase;
        }

        .status-complete { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
        .status-progress { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
        .status-pending { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }

        .task-card-title {
            font-size: 16px;
            font-weight: 800;
            color: var(--dark);
            line-height: 1.3;
        }

        .task-card-body {
            font-size: 13px;
            color: var(--slate-600);
            margin-bottom: 14px;
            flex: 1;
        }

        .task-steps-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 10px;
        }

        .task-step-item {
            font-size: 12px;
            color: var(--slate-700);
            display: flex;
            align-items: flex-start;
            gap: 6px;
        }

        .step-icon {
            font-size: 12px;
            margin-top: 1px;
        }

        .task-card-footer {
            border-top: 1px solid var(--slate-100);
            padding-top: 12px;
            font-size: 11px;
            color: var(--slate-400);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        /* Footer */
        .main-footer {
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: var(--slate-400);
            padding: 20px 0;
            border-top: 1px solid var(--slate-200);
        }
`;

console.log('Shared CSS defined successfully!');

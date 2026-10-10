const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Evaluate the base data from build-authentic-accurate-reports.js
const buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');

// Create a sandbox execution to obtain all variables
const moduleObj = { exports: {} };
const context = {
    require,
    console,
    process,
    fs,
    path,
    __dirname,
    Buffer,
    setTimeout,
    clearTimeout,
    module: moduleObj,
    exports: moduleObj.exports
};
vm.createContext(context);

vm.runInContext(`
${buildScript}

// October 2026 data ingestion
const octoberData = JSON.parse(fs.readFileSync('scripts/october_full_data.json', 'utf-8'));

// Build October Tasks (Progression from September)
const octoberTasks = septemberTasks.map(t => {
    const task = { ...t };
    if (t.num === 1) {
        task.status = 'completado';
        task.statusLabel = 'Completado';
        task.audit = '<strong>✓ Completado y Optimizado en Producción (Octubre 2026).</strong> Captura ultrarrápida de sobrantes con interfaz optimista (Optimistic UI) y auto-guardado en segundo plano, cálculo automatizado de pedidos y sincronización continua con QuickBooks.';
    } else if (t.num === 2) {
        task.status = 'completado';
        task.statusLabel = 'Completado';
        task.audit = '<strong>✓ Completado y Resuelto (Octubre 2026).</strong> Desbloqueo operativo de sucursales en Viele & Sons (Sage 100), corrección de regla de tasa 0 en sodas, sondeo de verificación de 40s y transición a estado superseded.';
    } else if (t.num === 7) {
        task.status = 'completado';
        task.statusLabel = 'Completado';
        task.audit = '<strong>✓ Completado y Desplegado en Producción (Octubre 2026).</strong> Paridad contable 1:1 con Cohesion ($450/mes de ahorro), integración directa de depósitos de Toast Cash Management, tratamiento de Paid In, y bloqueo automático si falta el depósito en efectivo.';
    } else if (t.num === 21) {
        task.status = 'completado';
        task.statusLabel = 'Completado';
        task.title = '21. Order Ready Board & Pantalla de Pedidos';
        task.audit = '<strong>✓ Completado y Lanzado (Octubre 2026).</strong> Sistema de llamado de órdenes listas con voz neuronal femenina ultra-realista Gemini TTS (Español/Inglés) con eslogan \"¡Ya está!\", sincronización de bump en KDS expediter y modo TV pantalla completa.';
    } else if (t.num === 24) {
        task.status = 'completado';
        task.statusLabel = 'Completado';
        task.title = '24. Registro de Proveedores y Mantenimiento';
        task.audit = '<strong>✓ Completado e Integrado (Octubre 2026).</strong> Módulo integral de bitácora para técnicos externos con captura obligatoria de fotos antes/después, firma digital de gerentes y semáforo preventivo de estatus.';
    } else if (t.num === 25) {
        task.status = 'completado';
        task.statusLabel = 'Completado';
        task.title = '25. Módulo Crear Bills en QuickBooks (/admin/crear-bills)';
        task.audit = '<strong>✓ Completado y Operativo (Octubre 2026).</strong> Herramienta financiera para transformar facturas de bodega central en Bills oficiales de QuickBooks Online con ordenamiento dinámico y validación de costos.';
    } else if (t.num === 26) {
        task.status = 'progreso';
        task.statusLabel = 'En Progreso';
        task.title = '26. App Móvil de Clientes (/app) & tacosgavilan.com';
        task.audit = '<strong>⚡ En Progreso Activo (Fase de Producción - Octubre 2026).</strong> Rutas de pedido móvil con checkout Toast Local, splash animado 3D a 60 FPS en Framer Motion, tasas oficiales CDTFA e integración de temas de Google Maps para el sitio web corporativo.';
    }
    return task;
});

const octCompleted = octoberTasks.filter(t => t.status === 'completado').length;
const octInProgress = octoberTasks.filter(t => t.status === 'progreso').length;
const octPending = octoberTasks.filter(t => t.status === 'pendiente').length;

extractedData = {
    octoberConfig: {
        id: 'octubre',
        monthName: 'Octubre',
        monthYear: 'Octubre 2026',
        totalHours: octoberData.totalHours,
        totalTasks: octoberTasks.length,
        completedTasks: octCompleted,
        inProgressTasks: octInProgress,
        pendingTasks: octPending,
        rows: octoberData.rows,
        effortSummary: octoberData.effort || [],
        parallelActivities: (octoberData.parallelActivities || []).map(p => ({
            title: p.title,
            hours: p.hours,
            desc: p.descEs || p.desc
        })),
        tasks: octoberTasks
    },
    septemberConfig: {
        id: 'septiembre',
        monthName: septemberConfig.monthName,
        monthYear: septemberConfig.monthYear,
        totalHours: septemberConfig.totalHours,
        totalTasks: septemberConfig.totalTasks,
        completedTasks: septemberConfig.completedTasks,
        inProgressTasks: septemberConfig.inProgressTasks,
        pendingTasks: septemberConfig.pendingTasks,
        rows: septemberConfig.rows,
        effortSummary: septemberData.effort || [],
        parallelActivities: septemberConfig.parallelActivities || [],
        tasks: septemberTasks
    },
    augustConfig: {
        id: 'agosto',
        monthName: augustConfig.monthName,
        monthYear: augustConfig.monthYear,
        totalHours: augustConfig.totalHours,
        totalTasks: augustConfig.totalTasks,
        completedTasks: augustConfig.completedTasks,
        inProgressTasks: augustConfig.inProgressTasks,
        pendingTasks: augustConfig.pendingTasks,
        rows: augustConfig.rows,
        effortSummary: augustConfig.effortSummary,
        parallelActivities: augustConfig.parallelActivities,
        tasks: augustTasks
    },
    julyConfig: {
        id: 'julio',
        monthName: julyConfig.monthName,
        monthYear: julyConfig.monthYear,
        totalHours: julyConfig.totalHours,
        totalTasks: julyConfig.totalTasks,
        completedTasks: julyConfig.completedTasks,
        inProgressTasks: julyConfig.inProgressTasks,
        pendingTasks: julyConfig.pendingTasks,
        rows: julyConfig.rows,
        effortSummary: julyConfig.effortSummary,
        parallelActivities: julyConfig.parallelActivities,
        tasks: julyTasks
    },
    juneConfig: {
        id: 'junio',
        monthName: juneConfig.monthName,
        monthYear: juneConfig.monthYear,
        totalHours: juneConfig.totalHours,
        totalTasks: juneConfig.totalTasks,
        completedTasks: juneConfig.completedTasks,
        inProgressTasks: juneConfig.inProgressTasks,
        pendingTasks: juneConfig.pendingTasks,
        rows: juneConfig.rows,
        effortSummary: juneConfig.effortSummary,
        parallelActivities: juneConfig.parallelActivities,
        tasks: juneTasks
    }
};
`, context);

const data = context.extractedData;
const shiftsMap = JSON.parse(fs.readFileSync('scripts/carlos_planner_shifts_by_date.json', 'utf-8'));

const tsContent = `/**
 * @module reports-data
 * @description Master typed data repository for all monthly activity, development roadmaps, and audited tasks (SM TEG).
 * @businessRules
 * - Provides 100% authentic, historical data for October, September, August, July, and June 2026.
 * - Single source of truth for the native Next.js / React / TSX reports dashboard at /admin/reporte-actividades.
 * - Tracks 27 canonical system tasks with month-by-month audit status progression.
 */

export interface AuditedTask {
    num: number;
    title: string;
    category: string;
    badgeDept: string;
    badgePriority: string;
    status: 'completado' | 'progreso' | 'pendiente';
    statusLabel: string;
    audit: string;
    steps: string[];
    auditJune?: string;
    auditJuly?: string;
    auditAugust?: string;
    auditSeptember?: string;
    auditOctober?: string;
}

export interface DailyReportRow {
    date: string;
    time: string;
    hours: number;
    badges: string[];
    descEs: string;
    descEn: string;
}

export interface ParallelActivity {
    title: string;
    hours: number;
    desc: string;
}

export interface ModuleEffort {
    module?: string;
    name?: string;
    hours: number;
    percent?: number;
}

export interface MonthlyReportData {
    id: 'octubre' | 'septiembre' | 'agosto' | 'julio' | 'junio';
    monthName: string;
    monthYear: string;
    totalHours: number;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    pendingTasks: number;
    rows: DailyReportRow[];
    effortSummary: ModuleEffort[];
    parallelActivities: ParallelActivity[];
    tasks: AuditedTask[];
}

export interface PlannerShift {
    start: string;
    end: string;
    hours: number;
    label?: string;
    store?: string;
    rawStart?: string;
    rawEnd?: string;
}

export const PLANNER_SHIFTS_MAP: Record<string, PlannerShift> = ${JSON.stringify(shiftsMap, null, 4)};

export const MONTHLY_REPORTS: Record<'octubre' | 'septiembre' | 'agosto' | 'julio' | 'junio', MonthlyReportData> = {
    octubre: ${JSON.stringify(data.octoberConfig, null, 4)},
    septiembre: ${JSON.stringify(data.septemberConfig, null, 4)},
    agosto: ${JSON.stringify(data.augustConfig, null, 4)},
    julio: ${JSON.stringify(data.julyConfig, null, 4)},
    junio: ${JSON.stringify(data.juneConfig, null, 4)}
};
`;

fs.writeFileSync('lib/reports-data.ts', tsContent, 'utf-8');
console.log('✅ lib/reports-data.ts generated successfully with October data and shifts!');

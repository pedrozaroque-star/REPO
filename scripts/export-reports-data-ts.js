const fs = require('fs');
const path = require('path');

// Evaluate the base data from build-authentic-accurate-reports.js
const buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');

// Create a sandbox execution to obtain all variables
const vm = require('vm');
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

extractedData = {
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
    }
};
`, context);

const data = context.extractedData;
const shiftsMap = JSON.parse(fs.readFileSync('scripts/carlos_planner_shifts_by_date.json', 'utf-8'));

const tsContent = `/**
 * @module reports-data
 * @description Master typed data repository for all monthly activity, development roadmaps, and audited tasks (SM TEG).
 * @businessRules
 * - Provides 100% authentic, historical data for September, August, July, and June 2026.
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
    module: string;
    hours: number;
}

export interface MonthlyReportData {
    id: 'septiembre' | 'agosto' | 'julio' | 'junio';
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

export const MONTHLY_REPORTS: Record<'septiembre' | 'agosto' | 'julio' | 'junio', MonthlyReportData> = {
    septiembre: ${JSON.stringify(data.septemberConfig, null, 4)},
    agosto: ${JSON.stringify(data.augustConfig, null, 4)},
    julio: ${JSON.stringify(data.julyConfig, null, 4)},
    junio: ${JSON.stringify(data.juneConfig, null, 4)}
};
`;

fs.writeFileSync('lib/reports-data.ts', tsContent, 'utf-8');
console.log('✅ lib/reports-data.ts generated successfully with all shifts!');

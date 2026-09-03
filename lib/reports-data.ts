/**
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

export const PLANNER_SHIFTS_MAP: Record<string, PlannerShift> = {
    "2026-06-01": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-02": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-06-03": {
        "start": "10:00 AM",
        "end": "5:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-05": {
        "start": "11:00 AM",
        "end": "9:00 PM",
        "hours": 10,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-06": {
        "start": "11:00 AM",
        "end": "9:00 PM",
        "hours": 10,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-07": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-08": {
        "start": "10:00 AM",
        "end": "5:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-09": {
        "start": "12:00 PM",
        "end": "9:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-10": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "rawStart": "2026-06-10T16:00:00+00:00",
        "rawEnd": "2026-06-11T00:00:00+00:00"
    },
    "2026-06-12": {
        "start": "9:00 AM",
        "end": "4:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-13": {
        "start": "4:00 PM",
        "end": "11:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-14": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-15": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-16": {
        "start": "10:00 AM",
        "end": "5:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-17": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-06-19": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-20": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-21": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-22": {
        "start": "10:00 AM",
        "end": "5:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-23": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-06-24": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-06-26": {
        "start": "11:00 AM",
        "end": "7:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-27": {
        "start": "11:00 AM",
        "end": "7:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-28": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-29": {
        "start": "10:00 AM",
        "end": "5:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-06-30": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-01": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-07-03": {
        "start": "11:00 AM",
        "end": "9:00 PM",
        "hours": 10,
        "rawStart": "2026-07-03T18:00:00+00:00",
        "rawEnd": "2026-07-04T04:00:00+00:00"
    },
    "2026-07-04": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-05": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-06": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-07": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-08": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-07-10": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-11": {
        "start": "9:00 AM",
        "end": "2:00 PM",
        "hours": 5,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-12": {
        "start": "2:00 PM",
        "end": "8:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-13": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-14": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-15": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-07-17": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-18": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-19": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-20": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-21": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-22": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-07-24": {
        "start": "2:00 PM",
        "end": "9:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-25": {
        "start": "2:00 PM",
        "end": "9:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-26": {
        "start": "2:00 PM",
        "end": "9:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-27": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-07-28": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-29": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-07-31": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-08-01": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-08-02": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-03": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-04": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-08-06": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-08-07": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-08": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-09": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-10": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-11": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-08-13": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "rawStart": "2026-08-13T16:00:00+00:00",
        "rawEnd": "2026-08-14T00:00:00+00:00"
    },
    "2026-08-14": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-15": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-16": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-17": {
        "start": "11:00 AM",
        "end": "6:00 PM",
        "hours": 7,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-18": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-08-19": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-08-21": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-22": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-23": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-24": {
        "start": "12:00 PM",
        "end": "8:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-08-25": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-08-26": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2025-12-29": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2025-12-30": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2025-12-31": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-02": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-01-03": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-04": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-05": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-06": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-07": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-09": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-10": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-11": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-12": {
        "start": "6:00 AM",
        "end": "7:00 PM",
        "hours": 13,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-13": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-14": {
        "start": "12:00 PM",
        "end": "8:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-16": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-17": {
        "start": "1:30 PM",
        "end": "11:00 PM",
        "hours": 9.5,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-18": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-19": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-01-20": {
        "start": "2:00 PM",
        "end": "1:00 AM",
        "hours": 11,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-21": {
        "start": "12:00 AM",
        "end": "8:00 PM",
        "hours": 20,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-23": {
        "start": "8:00 AM",
        "end": "6:00 PM",
        "hours": 10,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-24": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-25": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-26": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-01-27": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-01-28": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-01-29": {
        "start": "6:00 PM",
        "end": "12:00 AM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-30": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-01-31": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-01": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-02": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-03": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-02-04": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-02-06": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-07": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-08": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-09": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-10": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-02-11": {
        "start": "9:00 AM",
        "end": "8:00 PM",
        "hours": 11,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-13": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-15": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-16": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-17": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-02-18": {
        "start": "8:00 AM",
        "end": "6:00 PM",
        "hours": 10,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-19": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-02-20": {
        "start": "9:00 AM",
        "end": "8:00 PM",
        "hours": 11,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-21": {
        "start": "12:00 PM",
        "end": "11:00 PM",
        "hours": 11,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-22": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-24": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-02-25": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-02-26": {
        "start": "10:00 AM",
        "end": "10:00 PM",
        "hours": 12,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-27": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-02-28": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-01": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-02": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-03": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-04": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-06": {
        "start": "11:00 AM",
        "end": "8:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-07": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-08": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-09": {
        "start": "9:00 AM",
        "end": "1:00 AM",
        "hours": 16,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-10": {
        "start": "2:00 PM",
        "end": "3:00 AM",
        "hours": 13,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-11": {
        "start": "9:00 AM",
        "end": "11:00 PM",
        "hours": 14,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-12": {
        "start": "9:00 AM",
        "end": "2:00 PM",
        "hours": 5,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-13": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-14": {
        "start": "11:00 AM",
        "end": "11:00 PM",
        "hours": 12,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-15": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-16": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-17": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-03-18": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-03-19": {
        "start": "7:00 PM",
        "end": "12:00 AM",
        "hours": 5,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-20": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-21": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-22": {
        "start": "9:00 AM",
        "end": "8:00 PM",
        "hours": 11,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-23": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-24": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-03-25": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-03-27": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-28": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-29": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-30": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-03-31": {
        "start": "4:00 PM",
        "end": "12:00 AM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-01": {
        "start": "9:00 AM",
        "end": "10:00 PM",
        "hours": 13,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-02": {
        "start": "11:30 AM",
        "end": "4:00 PM",
        "hours": 4.5,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-03": {
        "start": "12:00 PM",
        "end": "8:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-04": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-05": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-06": {
        "start": "9:00 AM",
        "end": "10:30 PM",
        "hours": 13.5,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-07": {
        "start": "10:00 AM",
        "end": "10:00 PM",
        "hours": 12,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-08": {
        "start": "12:00 PM",
        "end": "11:00 PM",
        "hours": 11,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-10": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-11": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-12": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-13": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-14": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-04-15": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-04-17": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-18": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-19": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-20": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-21": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-04-22": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-04-24": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-25": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-26": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-27": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-04-28": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-04-29": {
        "start": "12:00 PM",
        "end": "10:00 PM",
        "hours": 10,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-01": {
        "start": "12:00 PM",
        "end": "9:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-02": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-03": {
        "start": "1:00 PM",
        "end": "11:00 PM",
        "hours": 10,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-04": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-05": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-06": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-08": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-09": {
        "start": "10:00 AM",
        "end": "6:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-10": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-11": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-12": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-05-13": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-05-15": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-16": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-17": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-18": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-19": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-05-20": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-05-22": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-23": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-24": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-25": {
        "start": "8:00 AM",
        "end": "10:00 PM",
        "hours": 14,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-26": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-05-27": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-05-29": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-30": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-05-31": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-06-11": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-07-30": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-08-12": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-08-31": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-01": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-09-02": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-09-04": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-05": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-06": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-07": {
        "start": "8:00 AM",
        "end": "5:00 PM",
        "hours": 9,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-08": {
        "start": "2:00 PM",
        "end": "10:00 PM",
        "hours": 8,
        "label": "Intermedio",
        "store": "Lynwood"
    },
    "2026-09-09": {
        "start": "9:00 AM",
        "end": "5:00 PM",
        "hours": 8,
        "label": "Mañana",
        "store": "Lynwood"
    },
    "2026-09-11": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-12": {
        "start": "3:00 PM",
        "end": "11:00 PM",
        "hours": 8,
        "label": "Custom",
        "store": "Lynwood"
    },
    "2026-09-13": {
        "start": "1:00 PM",
        "end": "7:00 PM",
        "hours": 6,
        "label": "Custom",
        "store": "Lynwood"
    }
};

export const MONTHLY_REPORTS: Record<'septiembre' | 'agosto' | 'julio' | 'junio', MonthlyReportData> = {
    septiembre: {
    "id": "septiembre",
    "monthName": "Septiembre",
    "monthYear": "Septiembre 2026",
    "totalHours": 16,
    "totalTasks": 27,
    "completedTasks": 19,
    "inProgressTasks": 4,
    "pendingTasks": 4,
    "rows": [
        {
            "date": "01-Sep-2026",
            "time": "9:12 AM - 1:45 PM & 6:15 PM - 10:15 PM & 10:45 PM - 1:15 AM",
            "hours": 11,
            "badges": [
                "Contabilidad (Cohesion)",
                "QuickBooks OAuth2",
                "Auditoría Forense Tareas",
                "Reportes TSX Nativo",
                "Planificador Lynwood #14",
                "Versionado v2.6.1",
                "Soporte IA Natural"
            ],
            "descEs": "• <strong>Módulo de Contabilidad (Génesis & Replicación de Cohesion)</strong>: En sesión matutina dedicada (chat específico 3ca1503c), exploración profunda y extracción forense con Puppeteer de la plataforma Cohesion (cohesion4restaurants.com) de Raquel Velázquez. Ingeniería inversa del mapeo de 17 cuentas contables (For Here, To Go, Uber, DoorDash, Delivery, Propinas, Impuestos, Faltantes/Sobrantes cuenta 51050), creación de lib/accounting-journal.ts, interfaz interactiva /contabilidad, /contabilidad/[packetId] y 7 endpoints API para transformar pólizas de Toast POS a QuickBooks Online sin costos de suscripción ($450/mes de ahorro).<br>• <strong>Simulaciones Duales QuickBooks & Diagnóstico de Tokens</strong>: Pruebas multi-sucursal en paralelo contra los libros reales de QBO en colaboración con Raquel Velázquez. Análisis comparativo de tokens OAuth2 entre Orden Diaria y Contabilidad, certificando que el catálogo maestro de 30 cuentas GL (#2326, #2335, etc.) y los mapeos de las 15 tiendas operan con total autonomía y blindaje en Supabase.<br>• <strong>Migración a Dashboard TSX Nativo & Rediseño Ejecutivo PRO</strong>: Conversión integral del módulo /admin/reporte-actividades de un iframe embebido a un componente 100% nativo en React/Next.js/TypeScript. Rediseño Ejecutivo PRO sin emojis decorativos, con 4 tarjetas KPI avanzadas, carrusel de filtros por módulo y botón de exportación instantánea a CSV.<br>• <strong>Vinculación con el Planificador (Turnos Lynwood #14 de Carlos Velázquez)</strong>: Sincronización dinámica de los 226 turnos reales del Planificador de Supabase (tabla schedules, user_id: 25), integrando el carril de tienda oficial (Turno Lynwood 2:00 PM - 10:00 PM, 8.0h • Intermedio) en el cronograma visual Gantt 24h.<br>• <strong>Soporte IA & Versionado UI (v2.6.1)</strong>: Reestructuración del asistente conversacional con tono natural y humano para gerentes, centralización en lib/version.ts y despliegue del parche oficial SM TEG v2.6.1.",
            "descEn": "• <strong>Accounting Module (Cohesion Genesis & Architecture Replication)</strong>: In a dedicated morning session (conversation 3ca1503c), performed deep forensic Puppeteer crawling of Raquel Velázquez's Cohesion platform (cohesion4restaurants.com). Reverse-engineered the 17 GL accounting accounts mapping (For Here, To Go, Uber, DoorDash, Delivery, Tips, Taxes, Short/Over 51050), engineered core business logic in lib/accounting-journal.ts, built interactive UI in /contabilidad and /contabilidad/[packetId], and created 7 API endpoints to stream Toast POS daily journals directly to QuickBooks Online ($450/month cost savings).<br>• <strong>QuickBooks Dual-Run Simulations & Token Diagnosis</strong>: Ran parallel multi-store journal simulations against real QBO ledgers in coordination with Raquel Velázquez. Performed comparative OAuth2 token diagnostic between Daily Orders and Accounting, verifying that the 30 GL accounts master catalog (#2326, #2335, etc.) and 15 store mappings operate with 100% autonomy in Supabase.<br>• <strong>Native TSX Dashboard Migration & Executive PRO Redesign</strong>: Fully migrated /admin/reporte-actividades from an embedded iframe to a 100% native Next.js / React / TypeScript dashboard. Applied sleek Executive PRO design with zero emojis, 4 advanced KPI metrics cards, module filter chips, and instant CSV export.<br>• <strong>Planner Schedule Linking (Carlos Velázquez Lynwood #14 Shifts)</strong>: Dynamically connected all 226 real Planner schedules from Supabase (schedules table, user_id: 25), rendering Carlos's official store shift (Lynwood 2:00 PM - 10:00 PM, 8.0h • Intermedio) on the 24h visual Gantt timeline.<br>• <strong>AI Support & UI Versioning (v2.6.1)</strong>: Overhauled chatbot persona to natural human tone for store managers, centralized versioning in lib/version.ts, and rolled out official SM TEG v2.6.1 patch release."
        },
        {
            "date": "02-Sep-2026",
            "time": "1:15 AM - 1:35 AM & 11:00 AM - 11:30 AM",
            "hours": 1,
            "badges": [
                "Finanzas y Contabilidad",
                "Barra Lateral",
                "Auditoría de Fechas",
                "Filtro Mensual",
                "Acceso Raquel (Miles)"
            ],
            "descEs": "• <strong>Reorganización de Barra Lateral (Nuevo Grupo 'Finanzas y Contabilidad')</strong>: Creación del nuevo grupo de navegación exclusivo para usuarios con rol Admin (Carlos y Raquel). Se reubicaron de forma centralizada los módulos de Contabilidad (/contabilidad), Auditoría RONOS (/admin/ronos), Reporte de Actividades (/admin/reporte-actividades) y se generó el acceso directo corporativo 'Miles' para gestión ágil de kilometraje y reembolsos de supervisores.<br>• <strong>Blindaje de Filtros Mensuales en Reportes</strong>: Auditoría y corrección del motor de extracción para filtrar estrictamente los registros por mes calendario, erradicando filtraciones cruzadas de fechas entre Julio y Agosto en todas las vistas ejecutivas.",
            "descEn": "• <strong>Sidebar Navigation Reorganization (New 'Finance & Accounting' Group)</strong>: Created a new dedicated navigation section exclusively visible to Admin role users (Carlos & Raquel). Centralized Contabilidad (/contabilidad), RONOS Audit (/admin/ronos), Activity Reports (/admin/reporte-actividades), and created the corporate 'Miles' direct shortcut for supervisor mileage & payroll reimbursement audits.<br>• <strong>Monthly Report Filter Hardening</strong>: Audited and patched data extraction logic to strictly enforce month boundaries per calendar period, eliminating cross-month date leaks between July and August in all executive views."
        },
        {
            "date": "03-Sep-2026",
            "time": "7:00 AM - 11:00 AM",
            "hours": 4,
            "badges": [
                "Auditoría Cohesion",
                "Mapeos GL por Sucursal",
                "Editor Modal Cohesion",
                "Validación Step 11",
                "Auditoría Ene-Jul 2026 (3,171 Pólizas)",
                "Conciliación 53,907 Líneas Contables",
                "Certificación Forense $32.7M",
                "Centinela 6:15 AM",
                "Auditoría Rodante 7 Días",
                "Opción A Semiautomática"
            ],
            "descEs": "• <strong>Auditoría Forense e Inspección Profunda de Cohesion (cohesion4restaurants.com)</strong>: Extracción exhaustiva con Puppeteer de los 12 pasos de configuración del Wizard de Cohesion, administración de empresas (CompanyId=1866) y sistemas conectados. Mapeo minucioso de parámetros contables: ventas por opción de comedor (For Here, To Go, Uber, DoorDash, GrubHub), cuentas por cobrar, tasas de impuestos y reglas de validación.<br>• <strong>Centro de Configuración Contable Interactivo (/contabilidad/configuracion)</strong>: Reemplazo de la vista estática por un panel interactivo con modal deslizable de edición para las 15 sucursales. Incorporación de 5 pestañas de configuración (QuickBooks & Ubicación, Bancos y Efectivo, Ventas GL, Impuestos & Pasivos, CxC & Comisiones), selector oficial de cuentas bancarias y botón de restauración a valores canónicos de Cohesion con persistencia inmediata en Supabase.<br>• <strong>Regla de Bloqueo por Órdenes Abiertas (Step 11 de Cohesion) & Validación Dual</strong>: Implementación y verificación del bloqueo estricto en publicación ante tickets desbalanceados o abiertos en Toast POS con tabla detallada de causas y advertencias en el dashboard.<br>• <strong>Auditoría Masiva Exhaustiva Enero a Julio 2026 (3,171 Pólizas y 53,907 Líneas Contables)</strong>: Descarga y auditoría forense memo por memo y cuenta por cuenta de todas las pólizas de ventas diarias publicadas en QuickBooks Online ($32,711,507.01 USD) contrastadas contra el motor nativo de Toast POS de la app TEG para las 15 sucursales a lo largo de 211 días. Certificación de paridad contable masiva (diferencia global menor al 0.15% en $32.7M atribuible únicamente a reembolsos fuera de corte y tickets desbalanceados del Step 11), confirmando la capacidad total de la aplicación para sustituir y apagar Cohesion ($450/mes de ahorro).<br>• <strong>Centinela Automático de las 6:15 AM & Conciliación Continua de 7 Días (Opción A)</strong>: Creación del cron job diario de las 6:15 AM PST (/api/cron/sync-accounting) que procesa el cierre laboral de ayer (5:59 AM) y audita de forma rodante los últimos 7 días. Recalcula automáticamente días no publicados ante ajustes de tickets en Toast POS, detecta reembolsos posteriores en días ya publicados en QuickBooks (como los $7.98 de Downey) y despliega banderas de advertencia en el dashboard de Raquel para generar asientos de ajuste en 1 clic.",
            "descEn": "• <strong>Forensic Audit & Deep Crawl of Cohesion (cohesion4restaurants.com)</strong>: Exhaustive Puppeteer extraction across all 12 setup wizard steps, company management (CompanyId=1866), and connected systems in Cohesion. Extracted dining option mappings (For Here, To Go, Uber, DoorDash, GrubHub), receivables, tax accounts, and validation rules.<br>• <strong>Interactive Store Configuration Center (/contabilidad/configuracion)</strong>: Replaced static read-only table with an interactive drawer modal for all 15 stores. Built 5 dedicated configuration tabs (QuickBooks & Location, Banking & Cash, Sales GL, Taxes & Liabilities, Receivables & Fees), official bank account selector, and instant Cohesion defaults restore button with live Supabase persistence.<br>• <strong>Open Orders Publication Blocking (Cohesion Step 11) & Dual Verification</strong>: Enforced strict blocking on QuickBooks publishing when unclosed/out-of-balance Toast POS checks exist, accompanied by visual breakdown alerts.<br>• <strong>Exhaustive Historical Audit Jan to Jul 2026 (3,171 Packets & 53,907 Journal Lines)</strong>: Downloaded and forensically audited memo-by-memo and account-by-account all daily sales journal entries published in QuickBooks Online ($32,711,507.01 USD) against native Toast POS calculations across all 15 branches over 211 calendar days. Certified massive accounting parity (global variance under 0.15% over $32.7M attributable strictly to cross-date refunds and Step 11 unclosed tickets), validating complete readiness to permanently decommission Cohesion ($450/mo savings).<br>• <strong>6:15 AM Automated Sentinel & 7-Day Rolling Reconciliation (Option A)</strong>: Developed daily 6:15 AM PST cron job (/api/cron/sync-accounting) running right after the 5:59 AM business cutoff, executing a 7-day continuous audit window. Silently recalculates unpublished days when Toast tickets update, detects post-publish refunds on already-published days (such as the $7.98 Downey void), and alerts Raquel with 1-click adjusting entry banners on the dashboard."
        }
    ],
    "effortSummary": [
        {
            "module": "Módulo de Contabilidad (Reemplazo Cohesion) & QuickBooks",
            "hours": 9.5
        },
        {
            "module": "Reporte de Actividades TSX, Gantt & Planificador Lynwood",
            "hours": 3.5
        },
        {
            "module": "Barra Lateral, Finanzas & Módulo Miles Raquel",
            "hours": 0.5
        },
        {
            "module": "Auditoría Forense de Tareas y Roadmap Canónico",
            "hours": 1.25
        },
        {
            "module": "Soporte IA Conversacional & Versionado UI (v2.6.1)",
            "hours": 1.25
        }
    ],
    "parallelActivities": [
        {
            "title": "Pruebas en Sucursal/Local",
            "hours": 0,
            "desc": "Pruebas operativas programadas para septiembre en cocina KDS y reloj checador de tienda."
        },
        {
            "title": "Monitoreo DB y APIs",
            "hours": 0.5,
            "desc": "Auditoría matutina de cron Viele & Sons (6:00 AM PST) y monitoreo de conexión de paystubs en RONOS."
        },
        {
            "title": "Planificación y Diseño",
            "hours": 0.5,
            "desc": "Planificación del ciclo de septiembre y arquitectura de la versión SM TEG v2.6.0."
        }
    ],
    "tasks": [
        {
            "num": 1,
            "title": "1. Inventario con reposición automática",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas analizando el consumo histórico de las últimas 4 semanas y las existencias actuales capturadas por el gerente.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas con soporte preliminar de QuickBooks.",
            "auditAugust": "<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes.",
            "steps": [
                "Configurado el motor de órdenes semanales por sucursal hacia la bodega central.",
                "Integrada la API de QuickBooks Online con guardado seguro.",
                "Pruebas y validación en sucursales operando al 100%."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes."
        },
        {
            "num": 2,
            "title": "2. Inventario para Bodega y COGS (Viele & Sons)",
            "category": "Costos & Proveedores",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran al proveedor Viele & Sons.",
            "auditJuly": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran a Viele & Sons.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos.",
            "steps": [
                "Scraper automatizado de facturas con normalización de empaques.",
                "Dashboard ejecutivo de Radar de Precios con 4 métricas anuales.",
                "Alertas por correo electrónico enviadas automáticamente ante aumentos."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos."
        },
        {
            "num": 3,
            "title": "3. Configuración local de TVs de Menús",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda y la página pública que muestra el menú rotativo en las pantallas.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda.",
            "auditAugust": "<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche.",
            "steps": [
                "Diseño responsive en alta resolución para pantallas de TV.",
                "Conexión en tiempo real con la base de datos de precios.",
                "Despliegue y verificación en pantallas locales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche."
        },
        {
            "num": 4,
            "title": "4. Logotipo de marca en correos electrónicos",
            "category": "Comunicaciones / Comms",
            "badgeDept": "✉️ Comunicaciones",
            "badgePriority": "🔵 Baja",
            "auditJune": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales utilizando el servidor de tacosgavilan.com con texto plano y firma básica.",
            "auditJuly": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales con firma básica.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios.",
            "steps": [
                "Plantilla HTML responsiva con logotipo oficial de Tacos Gavilan.",
                "Integración con el servicio de envío de correos (Resend/SMTP).",
                "Verificado en clientes de correo móvil y escritorio."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios."
        },
        {
            "num": 5,
            "title": "5. Descripciones de procedimientos en página de ACTIVIDADES",
            "category": "Operaciones / Operations",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo. Contiene el listado de 31 procedimientos operativos estandarizados.",
            "auditJuly": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo.",
            "auditAugust": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal.",
            "steps": [
                "Base de datos de procedimientos y actividades estructurada.",
                "Interfaz de consulta rápida y búsqueda por palabra clave.",
                "Sincronización con el Asistente de Soporte IA."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal."
        },
        {
            "num": 6,
            "title": "6. Verificar tabletas piloto en Slauson",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>En Pruebas (En Progreso).</strong> Hay 4 tabletas instaladas físicamente en la cocina piloto de Slauson corriendo software de telemetría.",
            "auditJuly": "<strong>✓ Completado e Integrado (Julio 2026).</strong> Se verificaron físicamente las 4 tabletas piloto en la cocina de Slauson durante las pruebas de campo.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad.",
            "steps": [
                "Desarrollo del modo pantalla completa exclusivo para cocina.",
                "Polling de sincronización bidireccional cada 10s en Supabase.",
                "Pruebas y validación en sitio en tableta de cocina."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad."
        },
        {
            "num": 7,
            "title": "7. App de Tacos Gavilán (Imitar King Taco)",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Creado el sistema de base de datos para la aplicación móvil (carritos de compra, puntos de fidelidad, selector de sucursal y menú interactivo).",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Base de datos de la app móvil y catálogo digital de productos estructurado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast.",
            "steps": [
                "Estructura de catálogo móvil y carrito de compras.",
                "Integración con la pasarela de pagos y menú en línea.",
                "Pruebas de pedidos móviles en sucursales piloto."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast."
        },
        {
            "num": 8,
            "title": "8. Sincronizador y clon de Basecamp",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Altamente Avanzado (En Progreso).</strong> El sistema web está integrado con Basecamp. Las tablas internas sincronizan automáticamente proyectos, mensajes y listas de tareas pendientes.",
            "auditJuly": "<strong>Altamente Avanzado (En Progreso).</strong> Sincronización continua con Basecamp y descarga asíncrona de adjuntos.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos.",
            "steps": [
                "Integración OAuth2 y sincronización local-first en Supabase.",
                "Buscador universal Shift+J con búsqueda paralela.",
                "Rediseño moderno con modal Dialog Card y carga bajo demanda de comentarios."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos."
        },
        {
            "num": 9,
            "title": "9. Página Web Oficial de Tacos El Gavilán",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Avanzado (En Progreso).</strong> Toda la estructura visual y de contenidos del sitio web oficial está finalizada (exhibición de platillos, historia, mapa de sucursales).",
            "auditJuly": "<strong>Avanzado (En Progreso).</strong> Estructura visual y mapa de sucursales completado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO.",
            "steps": [
                "Diseño responsivo móvil y de escritorio.",
                "Integración del directorio oficial de 15 tiendas.",
                "Despliegue y configuración de dominio."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO."
        },
        {
            "num": 10,
            "title": "10. Determinar gasto en Salsa Bar",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Existe registro de mermas e ingredientes de la barra de salsas en los checklists históricos, pero no se ha desarrollado el módulo de cálculo de costo por porción.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo pendiente de desarrollo para calcular el costo por porción del salsa bar.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal.",
            "steps": [
                "Estandarizar recetas y pesos de preparación de salsas.",
                "Registrar rendimiento por tanda y costo de insumos.",
                "Integrar en la matriz de Food Cost de la cadena."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal."
        },
        {
            "num": 11,
            "title": "11. Fotos y verificación Apple Business Connect (Slauson)",
            "category": "Dispositivos / Marketing",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Tarea operativa consistente en registrar la sucursal de Slauson, subir fotografías en alta resolución del interior/exterior y verificar la ficha del negocio en Apple Maps.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Verificación en Apple Maps pendiente de sesión de fotografía.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales.",
            "steps": [
                "Fotografía profesional de exteriores e interiores de tiendas.",
                "Carga de assets en portal Apple Business Connect.",
                "Validación de pin y horarios en Apple Maps."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales."
        },
        {
            "num": 12,
            "title": "12. Registro de proveedores y técnicos sin contraseña",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Planificado un portal simplificado de acceso rápido con códigos temporales para que técnicos de refrigeración y proveedores registren sus visitas sin requerir cuenta.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Portal de acceso con código QR temporal para proveedores pendiente.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas.",
            "steps": [
                "Generador de códigos QR y links temporales para contratistas.",
                "Bitácora digital de entradas y salidas de técnicos.",
                "Alertas al gerente de tienda al arribar personal externo."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas."
        },
        {
            "num": 13,
            "title": "13. Control de uniformes, gorras e inventario de ropa",
            "category": "Inventario / Merchandise",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo operativo pendiente de desarrollo para controlar las existencias de uniformes, gorras y chamarras.",
            "auditJuly": "<strong>▶ En Progreso (Julio 2026).</strong> Se implementó y desplegó en producción el tipo de orden de Uniformes en el módulo de Pedidos de Bodega.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte.",
            "steps": [
                "Catálogo de precios y reglas de exención implementadas.",
                "Tabla de stock mínimo (660 registros en BD) blindada.",
                "Conciliación automática con la bóveda de Caja Fuerte."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte."
        },
        {
            "num": 14,
            "title": "14. Manuales, videos y certificación de cocina",
            "category": "Operaciones / Training",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> El sistema cuenta con exámenes rápidos de desempeño para gerentes, pero falta crear la biblioteca de videos demostrativos y el flujo de certificación para personal de línea.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Biblioteca de videos demostrativos de recetas y cocina pendiente de producción.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros.",
            "steps": [
                "Producción de videos cortos demostrativos por estación.",
                "Cuestionarios de evaluación interactivos en tableta.",
                "Certificados digitales de aprobación por empleado."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros."
        },
        {
            "num": 15,
            "title": "15. Sección de Cultura Empresarial",
            "category": "Operaciones / HR",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Sección informativa planificada para capacitar y familiarizar a los nuevos empleados con los valores, historia y visión de Tacos Gavilan.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo de onboarding y valores de empresa pendiente.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte.",
            "steps": [
                "Documento de valores, misión y estándares de servicio.",
                "Módulo visual de inducción para nuevos empleados.",
                "Integración en el flujo de bienvenida de la app."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte."
        },
        {
            "num": 16,
            "title": "16. CLONAR Cohesion (app de contabilidad)",
            "category": "Sistemas / Finance",
            "badgeDept": "💻 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Desarrollo e integración de un clon contable de la plataforma Cohesión a medida para procesar pólizas de ventas y conciliar cuentas bancarias.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo contable integral en fase de especificación y análisis de viabilidad.",
            "auditAugust": "<strong>⚡ En Progreso (80% en Agosto 2026).</strong> Extracción forense de la estructura de Cohesion ($450/mes) con Puppeteer, mapeo de 17 cuentas contables (canales de venta, impuestos, propinas y pagos) y diseño de la base de datos.",
            "auditSeptember": "<strong>⚡ En Progreso Activo (Fase de Desarrollo y Validación Dual con Raquel Velázquez).</strong> Desarrollo del módulo nativo de Contabilidad para reemplazar Cohesion ($450/mes / $5,400/año de ahorro). Construcción de la librería central lib/accounting-journal.ts, panel interactivo /contabilidad, 7 endpoints API de pólizas diarias Toast POS → QuickBooks Online con cuenta 51050 de faltantes/sobrantes y simulaciones multi-sucursal; en proceso de pruebas paralelas contra los libros reales de QBO antes de la migración final.",
            "steps": [
                "Extracción forense de reglas contables, catálogos de cuentas y mapeos GL de Cohesion.",
                "Librería central lib/accounting-journal.ts (17 cuentas, canales For Here/To Go/Uber/DoorDash/GrubHub y efectivo).",
                "Endpoints de generación automática, panel de revisión y publicación a QuickBooks Online.",
                "Validación dual en paralelo contra Cohesion y visto bueno de Raquel Velázquez."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso Activo (Fase de Desarrollo y Validación Dual con Raquel Velázquez).</strong> Desarrollo del módulo nativo de Contabilidad para reemplazar Cohesion ($450/mes / $5,400/año de ahorro). Construcción de la librería central lib/accounting-journal.ts, panel interactivo /contabilidad, 7 endpoints API de pólizas diarias Toast POS → QuickBooks Online con cuenta 51050 de faltantes/sobrantes y simulaciones multi-sucursal; en proceso de pruebas paralelas contra los libros reales de QBO antes de la migración final."
        },
        {
            "num": 17,
            "title": "17. Módulo de Rendimiento y Telemetría de Drive-Thru (HME Zoom Nitro)",
            "category": "Sistemas / Hardware",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>✓ Completado e Integrado (Junio 2026).</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru en las sucursales con ventanilla.",
            "auditJuly": "<strong>✓ Completado e Integrado.</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real de tiempos de espera, cobro y despacho de ventanilla con alertas por cuello de botella.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real activa en sucursales con ventanilla.",
            "steps": [
                "Conexión con la API/controlador de HME Zoom Nitro.",
                "Métricas en vivo de segundos por vehículo en ventanilla.",
                "Historial de rendimiento y benchmarks entre sucursales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real activa en sucursales con ventanilla."
        },
        {
            "num": 18,
            "title": "18. Actualizar y Descargar Videos Musicales Regional Mexicano",
            "category": "Operaciones / Marketing",
            "badgeDept": "🎵 Tienda",
            "badgePriority": "🟢 Normal",
            "auditJune": "",
            "auditJuly": "<strong>⏳ Pendiente (Julio 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano para las pantallas de las sucursales.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano en formato MP4 HD organizados en unidades USB para reproducción en los televisores de los restaurantes.",
            "auditSeptember": "<strong>✓ Completado y Distribuido.</strong> Biblioteca musical de videos MP4 HD entregada a sucursales.",
            "steps": [
                "Definir lista de canciones y artistas populares para el ambiente de los restaurantes.",
                "Descargar videos en alta definición compatibles con las pantallas de las sucursales.",
                "Organizar archivos y distribuirlos a las sucursales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado y Distribuido.</strong> Biblioteca musical de videos MP4 HD entregada a sucursales."
        },
        {
            "num": 19,
            "title": "19. Módulo de Caja Fuerte (Conteo de Efectivo por Sucursal)",
            "category": "Finanzas / Treasury",
            "badgeDept": "💰 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "<strong>✓ Completado e Integrado (10-Jul-2026).</strong> Módulo completo para que los gerentes registren el conteo de efectivo semanal de la caja fuerte con desglose de billetes, monedas y total.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Registro semanal de billetes, monedas sueltas, rollos y gavetas con cálculo automático de gran total, conciliación de ventas de uniformes y control de ediciones pasadas.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Registro y conciliación semanal de caja fuerte en producción.",
            "steps": [
                "Formulario estructurado de desglose de efectivo.",
                "Conciliación automática con ventas de uniformes en efectivo.",
                "Historial auditable con control de modificaciones por rol."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Registro y conciliación semanal de caja fuerte en producción."
        },
        {
            "num": 20,
            "title": "20. Módulo de Tiendas (Integración Dinámica, Geocodificación y Mapas de Google)",
            "category": "Sistemas / Locations",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "<strong>✓ Completado e Integrado (14-Jul-2026).</strong> Vinculación dinámica de sucursales con el resto de los módulos del sistema y mapas de Google.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de las 15 sucursales oficiales + Bodega Central con coordenadas GPS exactas, teléfonos y horarios de operación.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de 15 sucursales oficiales y Bodega Central.",
            "steps": [
                "Tabla canónica de tiendas en base de datos.",
                "Geocodificación de coordenadas GPS para integración con MilesIQ.",
                "Selector global de sucursales en cabecera del sistema."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de 15 sucursales oficiales y Bodega Central."
        },
        {
            "num": 21,
            "title": "21. Radar de Precios Viele v3 y Auditoría de Impacto Anual COGS",
            "category": "Costos & Proveedores",
            "badgeDept": "📊 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (90% de avance).</strong> Ingesta automática de API REST v3 de Viele & Sons (86 insumos en 1.3s), cron semanal los lunes 6:00 AM, cálculo de impacto anual en USD ($) para 15 tiendas y aprobación de cambios a Food Cost.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Cron diario matutino 6:00 AM PST con telemetría en activity_logs, alerta ejecutiva por email con cálculo de impacto anual en USD y badge de estado en tiempo real.",
            "steps": [
                "Conexión API REST v3 y scraper automatizado.",
                "Cálculo de impacto inflacionario en dólares para la cadena.",
                "Integración con Sysco y US Foods para comparativas de mercado."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Cron diario matutino 6:00 AM PST con telemetría en activity_logs, alerta ejecutiva por email con cálculo de impacto anual en USD y badge de estado en tiempo real."
        },
        {
            "num": 22,
            "title": "22. Control de Descansos Laborales (Labor Compliance AI & Alertas CA)",
            "category": "Recursos Humanos",
            "badgeDept": "⚖️ Legal & RRHH",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (85% de avance).</strong> Algoritmo de sugerencias inteligentes de comida respetando la regla del Manager Jesús (salida temprana primero), alertas por correo de violaciones y auditoría según California Labor Law.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Algoritmo inteligente de descansos, notificaciones automáticas de violaciones por correo electrónico y cumplimiento estricto de California Labor Law.",
            "steps": [
                "Motor de asignación dinámica de horarios de comida.",
                "Alertas de violaciones despachadas a supervisores y directivos.",
                "Afinación de la interfaz móvil y reporte mensual consolidado de multas."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Algoritmo inteligente de descansos, notificaciones automáticas de violaciones por correo electrónico y cumplimiento estricto de California Labor Law."
        },
        {
            "num": 23,
            "title": "23. Conciliación Multitienda Toast API (Cross-Date Refunds & EBT)",
            "category": "Ventas & Contabilidad",
            "badgeDept": "💰 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (90% de avance).</strong> Algoritmo de conciliación de reembolsos de fechas cruzadas (Party Trays) y ventas EBT para cuadre al centavo con reportes contables oficiales en las 15 tiendas.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Algoritmo de conciliación de Party Trays (cross-date refunds), ventas EBT, mapa dinámico de dining options y auto-sanación de caché.",
            "steps": [
                "Fórmula unificada: Sum(Items) - Discounts - Refunds - CrossDateRefunds.",
                "Diagnóstico y resolución de discrepancias en tiendas (Bell $8,332.64).",
                "Automatización del cron de auto-sanación de caché de ventas."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Algoritmo de conciliación de Party Trays (cross-date refunds), ventas EBT, mapa dinámico de dining options y auto-sanación de caché."
        },
        {
            "num": 24,
            "title": "24. Módulo de Control de Millas y Desplazamientos MilesIQ (Geofencing GPS e IRS)",
            "category": "Supervisión & RRHH",
            "badgeDept": "🚗 Supervisión",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (85% de avance).</strong> Geofencing perimetral en las 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), lanzador rápido QuickDriveModal con apertura de Google/Apple Maps y sincronización automática desde inspecciones.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Geofencing GPS en 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), modal QuickDrive y tabla supervisor_mileage_trips.",
            "steps": [
                "Detección GPS pasiva por geofencing en tiendas oficiales.",
                "Cálculo automático de distancias y montos de reembolso IRS.",
                "Concluir exportación formal de nómina para despacho a RRHH."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Geofencing GPS en 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), modal QuickDrive y tabla supervisor_mileage_trips."
        },
        {
            "num": 25,
            "title": "25. Tech Packs y Fichas Técnicas de Uniformes (Licitación RFQ)",
            "category": "Compras & Proveedores",
            "badgeDept": "👕 Mercancía",
            "badgePriority": "🟡 Media",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (75% de avance).</strong> Especificaciones técnicas de confección (telas, gramajes, costuras, bordados, pantones) y volúmenes de licitación anual (15 tiendas) para negociación directa con fabricantes.",
            "auditSeptember": "<strong>✓ Completado e Implementado (Septiembre 2026).</strong> Fichas técnicas completas de Playeras Rojas, Polos Gerenciales y Chamarras, especificaciones de telas, pantones y volúmenes de licitación anual.",
            "steps": [
                "Fichas técnicas de Playeras Rojas, Polos Gerenciales y Chamarras.",
                "Volúmenes de compra anual calculados para licitación RFQ.",
                "Generación de documentos ejecutivos de negociación con proveedores."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado (Septiembre 2026).</strong> Fichas técnicas completas de Playeras Rojas, Polos Gerenciales y Chamarras, especificaciones de telas, pantones y volúmenes de licitación anual."
        },
        {
            "num": 26,
            "title": "26. Predicción Estacional de Galones de Champurrado a 5 Años",
            "category": "Cocina & Temporadas",
            "badgeDept": "☕ Operaciones",
            "badgePriority": "🟡 Media",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Modelo de proyección estacional en /api/inventory/champurrado-forecast con 5 años de historial de semanas ISO, conversión de 8 lbs/galón y sugerencia automática de galones diarios para la orden de bodega.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Motor predictivo estacional de champurrado activo en producción para la temporada invernal.",
            "steps": [
                "Extracción histórica de galones y vasos vendidos en Toast.",
                "Fórmula de sugerencia con niveles de confianza (HIGH/MED/LOW) y 8 lbs/gal.",
                "Integración visual informativa en la Orden Diaria de Bodega."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Motor predictivo estacional de champurrado activo en producción para la temporada invernal."
        },
        {
            "num": 27,
            "title": "27. Módulo RONOS HR, Auditoría de Nóminas Simplify & Paystubs",
            "category": "Recursos Humanos / Payroll",
            "badgeDept": "👥 RRHH & Nóminas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Sistema de extracción, auditoría y cruce de nóminas Simplify vs RONOS, motor de cálculo de billing PEO para 15 empresas/sucursales, visor de paystubs y detección automática de discrepancias salariales y horas extra.",
            "auditSeptember": "<strong>✓ Completado e Integrado en Producción.</strong> Auditoría quincenal continua de nóminas y conciliación de costos de personal.",
            "steps": [
                "Extracción forense de nóminas y timbrados de Simplify y RONOS.",
                "Motor de conciliación PEO con cálculo de cargas sociales y fees.",
                "Visor interactivo de paystubs y reporte de discrepancias para gerencia."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado en Producción.</strong> Auditoría quincenal continua de nóminas y conciliación de costos de personal."
        }
    ]
},
    agosto: {
    "id": "agosto",
    "monthName": "Agosto",
    "monthYear": "Agosto 2026",
    "totalHours": 169.49,
    "totalTasks": 27,
    "completedTasks": 13,
    "inProgressTasks": 10,
    "pendingTasks": 4,
    "rows": [
        {
            "date": "01-Ago-2026",
            "time": "6:30 PM - 11:00 PM",
            "hours": 4.5,
            "badges": [
                "Preparador",
                "Soporte IA"
            ],
            "descEs": "• <strong>Preparador (Proyecciones por Tramos & Live Data)</strong>: Transición completa de las proyecciones de carne de intervalos de 30 min a bloques de tramos de hora pico. Forzado de HTTP no-store para refresco en tiempo real.<br>• <strong>Preparador (🔥 Máx. Charola & Guía Operativa)</strong>: Nuevo badge de capacidad máxima de charola por tarjeta de proteína y modal interactivo de guía operativa.<br>• <strong>Soporte IA</strong>: Sincronización del prompt del asistente con las capacidades del preparador.",
            "descEn": "• <strong>Prep Line (Period Blocks & Live Data)</strong>: Full transition of meat projections to peak period blocks. Zero-cache HTTP fetching for real-time sync.<br>• <strong>Prep Line (🔥 Max Tray & Operational Guide)</strong>: Max holding tray capacity badge and interactive operational guide modal.<br>• <strong>AI Support</strong>: Synced assistant prompt with new prep line capabilities."
        },
        {
            "date": "02-Ago-2026",
            "time": "5:00 PM - 6:00 PM",
            "hours": 1,
            "badges": [
                "Preparador"
            ],
            "descEs": "• <strong>Preparador (Modo Básico vs Avanzado)</strong>: Conmutador de visualización para tarjetas limpias de un solo número.<br>• <strong>Preparador (Modo Tableta Kiosko)</strong>: Badge TABLETA prominente y ocultamiento de botones no operativos en pantalla completa.",
            "descEn": "• <strong>Prep Line (Basic vs Advanced Mode)</strong>: Display switch for clean single-number cards.<br>• <strong>Prep Line (Tablet Kiosk Mode)</strong>: Prominent TABLETA badge and hidden non-operational buttons in fullscreen."
        },
        {
            "date": "03-Ago-2026",
            "time": "4:42 PM - 7:04 PM & 8:32 PM - 9:46 PM",
            "hours": 4.6,
            "badges": [
                "Inventario",
                "QuickBooks"
            ],
            "descEs": "• <strong>Inventario (QuickBooks Estimates)</strong>: Corrección crítica en la actualización de presupuestos configurando sparse: false para prevenir que QBO elimine ítems no enviados durante guardados parciales diarios.<br>• <strong>Preservación de Estado</strong>: Soporte para ítems extraordinarios en el estado local de React.",
            "descEn": "• <strong>Inventory (QuickBooks Estimates)</strong>: Critical fix for QBO Estimate updates with sparse: false to prevent item truncation during partial daily saves.<br>• <strong>State Preservation</strong>: Retained extraordinary items in React local state."
        },
        {
            "date": "04-Ago-2026",
            "time": "9:45 AM - 2:00 PM & 6:30 PM - 11:15 PM",
            "hours": 9,
            "badges": [
                "Preparador",
                "Inventario",
                "Reportes"
            ],
            "descEs": "• <strong>Reporte Julio</strong>: Consolidación final del informe de julio con 117.80 hrs.<br>• <strong>Preparador (Edición Táctil & Modo Semanal)</strong>: Modo de sobreescritura manual tap-to-edit y selector de 3 modos [Manual | Básica | Avanzada] persistente en base de datos.<br>• <strong>Inventario (PAR Semanal)</strong>: Corrección de actualizaciones inmediatas de PAR para tipos de orden de Líquidos y Uniformes.",
            "descEn": "• <strong>July Report</strong>: Finalized July report at 117.80 hrs.<br>• <strong>Prep Line (Touch Edit & Weekly Mode)</strong>: Tap-to-edit manual overrides and 3-mode toggle [Manual | Basic | Advanced] persisted to database.<br>• <strong>Inventory (Weekly PAR)</strong>: Fixed immediate PAR updates for Liquids and Uniforms orders."
        },
        {
            "date": "05-Ago-2026",
            "time": "11:40 AM - 12:51 PM & 3:58 PM - 4:14 PM",
            "hours": 2.45,
            "badges": [
                "Preparador",
                "Reportes"
            ],
            "descEs": "• <strong>Preparador (Optimización Gráfica)</strong>: Ajuste de contraste y tipografía para legibilidad a larga distancia en cocina.<br>• <strong>Reportes de Rendimiento</strong>: Estabilización de cálculos de rendimiento de carne por hora.",
            "descEn": "• <strong>Prep Line (Visual Optimization)</strong>: High-contrast typography adjustments for long-distance kitchen readability.<br>• <strong>Yield Reports</strong>: Stabilized meat yield hourly calculations."
        },
        {
            "date": "06-Ago-2026",
            "time": "9:58 AM - 11:38 AM & 2:44 PM - 2:45 PM",
            "hours": 2.69,
            "badges": [
                "Preparador",
                "Base de Datos"
            ],
            "descEs": "• <strong>Preparador (Sincronización Tableta-PC)</strong>: Integración de polling cada 10s para paridad de cocina con PC del gerente.<br>• <strong>Base de Datos</strong>: Migración de tabla prep_manual_schedule a producción y compatibilidad de IDs numéricos/texto.",
            "descEn": "• <strong>Prep Line (Tablet-PC Sync)</strong>: 10s polling for manager PC parity.<br>• <strong>Database</strong>: Migrated prep_manual_schedule table to production and normalized storeId parsing."
        },
        {
            "date": "07-Ago-2026",
            "time": "11:28 AM - 1:48 PM",
            "hours": 2.83,
            "badges": [
                "Horarios",
                "Descansos IA"
            ],
            "descEs": "• <strong>Horarios (Notificaciones de Violaciones)</strong>: Habilitación de alertas por correo para violaciones de descansos de comida (Lunch Breaks) bajo normativa laboral de California.<br>• <strong>Descansos IA</strong>: Calibración del motor predictivo para asignar descansos antes de la 5ta hora de trabajo.",
            "descEn": "• <strong>Schedules (Violation Notifications)</strong>: Automated email alerts for CA lunch break violations.<br>• <strong>Breaks AI</strong>: Calibrated engine to assign breaks before the 5th working hour."
        },
        {
            "date": "08-Ago-2026",
            "time": "10:00 AM - 1:30 PM & 6:00 PM - 9:45 PM",
            "hours": 7.15,
            "badges": [
                "Ventas Toast API",
                "Descansos IA"
            ],
            "descEs": "• <strong>Ventas (Toast API & Conciliación Neta)</strong>: Conciliación de ventas netas, soporte de descuentos prorrateados y Party Trays a escala.<br>• <strong>Descansos Laborales (Regla de Salida Temprana)</strong>: Implementación de la prioridad de descansos para turnos con salida anticipada.",
            "descEn": "• <strong>Sales (Toast API Reconciliation)</strong>: Reconciled net sales, prorated discount handling, and scaled Party Trays.<br>• <strong>Breaks (Early Exit Rule)</strong>: Prioritized breaks for early departure shifts."
        },
        {
            "date": "09-Ago-2026",
            "time": "2:07 PM - 3:12 PM & 5:38 PM - 6:30 PM & 7:30 PM - 7:33 PM",
            "hours": 3.5,
            "badges": [
                "Preparador",
                "Telemetría"
            ],
            "descEs": "• <strong>Preparador (Auto-Refresh & Acelerador)</strong>: Ajuste del acelerador intradía de carne contra curvas de ventas históricas.<br>• <strong>Telemetría de Cocina</strong>: Diagnóstico de tiempos de respuesta en tablets de cocina.",
            "descEn": "• <strong>Prep Line (Auto-Refresh & Accelerator)</strong>: Adjusted intraday meat pace against historical curves.<br>• <strong>Kitchen Telemetry</strong>: Diagnosed kitchen tablet response times."
        },
        {
            "date": "10-Ago-2026",
            "time": "4:01 PM - 5:31 PM & 6:37 PM - 6:52 PM",
            "hours": 2.75,
            "badges": [
                "Actividades",
                "Descansos IA",
                "Tech Packs RFQ"
            ],
            "descEs": "• <strong>Actividades (Asignación Diaria)</strong>: Filtrado de empleados en combos por sucursal activa en AsignacionDiariaTab, excluyendo perfiles directivos y respetando empleados en vacaciones.<br>• <strong>Descansos IA</strong>: Soporte para adición y eliminación manual de descansos en turnos menores o iguales a 6 horas.<br>• <strong>Tech Packs RFQ</strong>: Planificación de fichas técnicas para menudeo y comercialización de insumos.",
            "descEn": "• <strong>Activities (Daily Assignment)</strong>: Filtered employee dropdowns strictly by store, hiding corporate users while retaining returning vacation staff.<br>• <strong>Breaks AI</strong>: Manual break add/remove for shifts <= 6h.<br>• <strong>Tech Packs RFQ</strong>: Initial specs for wholesale and retail items."
        },
        {
            "date": "11-Ago-2026",
            "time": "9:17 AM - 9:26 AM & 11:10 AM - 11:21 AM & 3:17 PM - 3:17 PM & 4:56 PM - 5:44 PM & 6:48 PM - 7:51 PM",
            "hours": 4.68,
            "badges": [
                "Caja Fuerte",
                "Uniformes",
                "Tech Packs Viele"
            ],
            "descEs": "• <strong>Caja Fuerte (Edición de Historial)</strong>: Habilitación de edición de registros históricos de corte para supervisores y admins en pestaña Historial para corrección de capturas erróneas.<br>• <strong>Uniformes & Sidebar</strong>: Asignación de badge NEW en barra lateral al módulo de Control de Uniformes.<br>• <strong>Tech Packs & Proveedores</strong>: Redacción de especificaciones de 21 productos desechables y solicitud formal a Viele & Sons.",
            "descEn": "• <strong>Safe Counts (History Edit)</strong>: Permitted supervisors/admins to edit past cash count logs to fix entry mistakes.<br>• <strong>Uniforms & Sidebar</strong>: Assigned NEW badge to Uniforms module in sidebar.<br>• <strong>Tech Packs & Vendors</strong>: Drafted 21 disposables spec sheets and formal request to Viele & Sons."
        },
        {
            "date": "12-Ago-2026",
            "time": "10:57 AM - 11:14 AM & 1:08 PM - 1:24 PM & 5:10 PM - 5:39 PM & 7:24 PM - 8:24 PM & 10:35 PM - 11:32 PM",
            "hours": 5.48,
            "badges": [
                "Uniformes Bodega",
                "Tech Packs Desechables"
            ],
            "descEs": "• <strong>Inventario & Uniformes</strong>: Sincronización automática de PAR de uniformes con stock mínimo de tienda y Sobrante en tiempo real en Pedidos de Bodega.<br>• <strong>i18n Bilingüe</strong>: Corrección de clave de traducción faltante bodegaOrders.inStock.<br>• <strong>Tech Packs</strong>: Investigación técnica exhaustiva de materiales, dimensiones y empaques para 22 insumos desechables.",
            "descEn": "• <strong>Inventory & Uniforms</strong>: Auto-synced uniform PAR with minimum stock and real-time on-hand inventory in Bodega Orders.<br>• <strong>Bilingual i18n</strong>: Fixed missing bodegaOrders.inStock translation key.<br>• <strong>Tech Packs</strong>: Technical research on materials, dimensions, and packaging for 22 disposable products."
        },
        {
            "date": "13-Ago-2026",
            "time": "8:31 AM - 9:41 AM & 11:01 AM - 12:40 PM & 2:17 PM - 2:27 PM & 4:06 PM - 4:43 PM & 5:43 PM - 7:22 PM",
            "hours": 7.76,
            "badges": [
                "MilesIQ Supervisores",
                "Champurrado Forecast"
            ],
            "descEs": "• <strong>MilesIQ (Módulo de Millas Supervisores)</strong>: Creación completa del módulo MilesIQ: registro de viajes, geocodificación de sucursales, despacho consolidado a RRHH, control de acceso por rol y edición de viajes pendientes.<br>• <strong>Champurrado Forecast</strong>: Motor de pronóstico estacional a 5 años en /api/inventory/champurrado-forecast, carrusel de cocina trasera y corrección de conversión (1 galón = 8 lbs).",
            "descEn": "• <strong>MilesIQ (Supervisor Mileage)</strong>: Complete MilesIQ module build: trip logging, store geocoding, HR payroll dispatch, role access, and pending trip editing.<br>• <strong>Champurrado Forecast</strong>: 5-year seasonal forecasting engine at /api/inventory/champurrado-forecast, back kitchen carousel, and gallon conversion fix (1 gal = 8 lbs)."
        },
        {
            "date": "14-Ago-2026",
            "time": "—",
            "hours": 0,
            "badges": [
                "Descanso Operativo"
            ],
            "descEs": "• <strong>Día de Descanso Operativo</strong>: Sin actividad de desarrollo en el sistema.",
            "descEn": "• <strong>Operational Rest Day</strong>: No development activity recorded."
        },
        {
            "date": "15-Ago-2026",
            "time": "4:11 PM - 9:15 PM",
            "hours": 5.57,
            "badges": [
                "Uniformes Stock",
                "Análisis Viele 87 CSV"
            ],
            "descEs": "• <strong>Control de Uniformes</strong>: Editor individual de stock por prenda/talla (EditItemStockModal), deducción resiliente en intercambios por daño y bloqueo de doble recepción de órdenes.<br>• <strong>Análisis de Costos Viele & Sons</strong>: Auditoría exhaustiva de la guía de órdenes (87 productos) con histórico de fluctuaciones de precios 2025.",
            "descEn": "• <strong>Uniforms Stock</strong>: Individual item stock editor per size/garment, resilient damage exchange deductions, and duplicate reception locking.<br>• <strong>Viele Cost Analysis</strong>: Comprehensive audit of 87-item Viele Order Guide with 2025 price fluctuation history."
        },
        {
            "date": "16-Ago-2026",
            "time": "12:37 PM - 3:50 PM & 4:37 PM - 5:04 PM & 7:07 PM - 7:18 PM & 8:24 PM - 8:40 PM & 4:14 AM - 5:59 AM",
            "hours": 8.37,
            "badges": [
                "MilesIQ GPS",
                "Uniformes Store Lock",
                "Planificador Calendar Sync"
            ],
            "descEs": "• <strong>MilesIQ (Navegación GPS de 1 Toque)</strong>: Lanzadores móviles directos para Google Maps, Apple Maps y Waze con autoguardado de viaje, autoselección de sucursal origen y tarifa fiscal IRS ($0.760/milla).<br>• <strong>Uniformes</strong>: Bloqueo de sesión para gerentes de tienda a su sucursal asignada.<br>• <strong>Planificador</strong>: Sincronización móvil a calendarios (.ics / Google Calendar / Apple Calendar) para turnos de empleados.<br>• <strong>Preparador</strong>: Throttle de rueda de mouse/trackpad (400ms) para laptops.",
            "descEn": "• <strong>MilesIQ (1-Tap GPS Navigation)</strong>: Direct mobile launchers for Google Maps, Apple Maps, Waze with trip auto-save, origin autodetect, and IRS rate ($0.760/mi).<br>• <strong>Uniforms</strong>: Locked store manager sessions strictly to assigned store.<br>• <strong>Planner</strong>: Mobile calendar sync (.ics / Google / Apple Calendar) for employee shifts.<br>• <strong>Prep Line</strong>: 400ms mouse wheel throttle for laptop trackpads."
        },
        {
            "date": "17-Ago-2026",
            "time": "6:00 AM - 6:11 AM & 12:52 PM - 3:41 PM & 8:04 PM - 8:13 PM",
            "hours": 4.65,
            "badges": [
                "Radar de Precios Viele 87",
                "Planificador Violaciones Cron",
                "Tech Packs Insumos"
            ],
            "descEs": "• <strong>Radar de Precios de Proveedores</strong>: Lanzamiento del módulo /admin/precios-proveedores con catálogo de 87 insumos Viele & Sons y cálculo de impacto COGS anual a nivel cadena.<br>• <strong>Planificador (Cron de Violaciones)</strong>: Cron automatizado de las 11:59 AM (/api/cron/sync-daily-violations) para detección de anomalías de asistencia en Toast.<br>• <strong>Tech Packs de Insumos</strong>: Generación de reportes PDF desglosados de compras por categoría (Beef, Milk, Desechables).",
            "descEn": "• <strong>Supplier Price Radar</strong>: Launched /admin/precios-proveedores with 87-item Viele catalog and annual COGS chain impact calculator.<br>• <strong>Planner (Violations Cron)</strong>: Automated 11:59 AM cron (/api/cron/sync-daily-violations) for Toast attendance anomaly detection.<br>• <strong>Item Tech Packs</strong>: Generated category-specific PDF purchasing reports (Beef, Milk, Packaging)."
        },
        {
            "date": "18-Ago-2026",
            "time": "11:00 AM - 11:07 AM & 12:58 PM - 1:19 PM & 2:24 PM - 6:32 PM",
            "hours": 6.1,
            "badges": [
                "Radar de Precios Scraper Viele v3",
                "Cron Semanal",
                "Tech Pack Calibración",
                "Uniformes Orders"
            ],
            "descEs": "• <strong>Radar de Precios (Scraper Viele v3 & Cron)</strong>: Scraper automático en vivo (/api/inventory/supplier-prices/sync) y cron semanal de detección de inflación.<br>• <strong>Radar de Precios (Nuevos Proveedores)</strong>: Modal para registro y mapeo de distribuidores alternativos.<br>• <strong>Calibración de Precios</strong>: Ajuste de precios base Dic 2025 del Tech Pack oficial.<br>• <strong>Pedidos & Uniformes</strong>: Eliminación de race conditions en edición de PAR y blindaje contra concatenación de texto en recepción.",
            "descEn": "• <strong>Price Radar (Viele v3 Scraper & Cron)</strong>: Live automated scraper (/api/inventory/supplier-prices/sync) and weekly inflation detection cron.<br>• <strong>Price Radar (New Vendors)</strong>: Modal for registering and mapping alternative suppliers.<br>• <strong>Price Calibration</strong>: Calibrated Dec 2025 baseline prices from official Tech Pack.<br>• <strong>Orders & Uniforms</strong>: Eliminated PAR edit race conditions and guarded against string concatenation on order reception."
        },
        {
            "date": "19-Ago-2026",
            "time": "9:44 AM - 12:52 PM & 2:54 PM - 3:34 PM & 4:20 PM - 5:22 PM",
            "hours": 6.33,
            "badges": [
                "Actividades & Checklists",
                "Control de Uniformes & Caja Fuerte",
                "Radar de Precios COGS",
                "Basecamp Sync"
            ],
            "descEs": "• <strong>Actividades & Checklists (Auditoría Integral)</strong>: Auditoría exhaustiva paso a paso de AsignacionDiariaTab.tsx, ChecklistMode.tsx y ReportesChecklistTab.tsx, corrigiendo estados de carga y selectores de empleados.<br>• <strong>Control de Uniformes & Caja Fuerte</strong>: Conciliación de ventas en efectivo de uniformes con la bóveda de Caja Fuerte y reversión física en anulaciones.<br>• <strong>Radar de Precios & Food Cost</strong>: Conexión de precios de insumos con el cálculo automático de Food Cost y resolución de 17 observaciones de auditoría.<br>• <strong>Basecamp Sync</strong>: Estabilización de la sincronización de comentarios y documentos.",
            "descEn": "• <strong>Activities & Checklists (Full Audit)</strong>: Step-by-step audit of AsignacionDiariaTab.tsx, ChecklistMode.tsx, ReportesChecklistTab.tsx, fixing loading states and employee selectors.<br>• <strong>Uniforms & Safe Box</strong>: Reconciled cash uniform sales with Safe vault and automated stock reversal on voided transactions.<br>• <strong>Price Radar & Food Cost</strong>: Linked vendor ingredient prices to dynamic Food Cost recalculation and resolved 17 audit items.<br>• <strong>Basecamp Sync</strong>: Stabilized comments and documents synchronization."
        },
        {
            "date": "20-Ago-2026",
            "time": "6:15 AM - 9:30 AM & 8:00 PM - 11:44 PM",
            "hours": 6.98,
            "badges": [
                "Basecamp UX (Cards/List)",
                "MilesIQ (Gap Detector & Canonical Maps)",
                "Procedimientos Sorting"
            ],
            "descEs": "• <strong>Basecamp (Selector View as Cards / List)</strong>: Visualización de to-dos en cuadrícula moderna o lista compacta con avatares y conteo de comentarios.<br>• <strong>MilesIQ (Detector de Rutas Faltantes & Geofencing)</strong>: Banner inteligente \"Gap Detector\" que resalta viajes omitidos y sincronización canónica de coordenadas de las 15 tiendas con tacosgavilan.com.<br>• <strong>Procedimientos</strong>: Ordenamiento cronológico de fotos e inspecciones.<br>• <strong>Radar de Precios</strong>: Auditoría exhaustiva 35/35 de todas las recetas maestras de la cadena.",
            "descEn": "• <strong>Basecamp (Cards / List View Switcher)</strong>: Modern grid/list task views with avatars and comment counts.<br>• <strong>MilesIQ (Gap Detector & Canonical Maps)</strong>: Smart banner detecting missed trips and canonical geofence synchronization of all 15 stores from tacosgavilan.com.<br>• <strong>Procedures</strong>: Chronological sorting of inspection photos.<br>• <strong>Price Radar</strong>: 35/35 exhaustive audit on all master recipes."
        },
        {
            "date": "21-Ago-2026",
            "time": "6:09 AM - 8:30 AM & 11:30 AM - 1:45 PM & 4:30 PM - 5:30 PM & 7:15 PM - 9:30 PM",
            "hours": 7.85,
            "badges": [
                "Radar de Precios (Alertas & Scraper Viele v3)",
                "MilesIQ & Chatbot Overlap",
                "Descansos IA",
                "Basecamp 4"
            ],
            "descEs": "• <strong>Radar de Precios (Alertas Ejecutivas & Despacho a Directivos)</strong>: Diseño y programación de la plantilla HTML ejecutiva para alertas de fluctuaciones de precios de Viele & Sons. Despacho por correo a los 4 directivos (Roberto, Raquel, Gonzalo y Carlos) con métricas de impacto anual a nivel cadena ($ USD), enlaces directos a /admin/precios-proveedores y envío de correo oficial de presentación con PDF adjunto.<br>• <strong>Radar de Precios (Scraper Viele & Sons v3)</strong>: Blindaje del scraper de la API REST de Viele y manejo seguro de credenciales con fallback preventivo.<br>• <strong>MilesIQ & UI Chatbot</strong>: Reubicación del toast de actualizaciones a la parte inferior-central para evitar solapamientos con el botón flotante del asistente.<br>• <strong>Descansos IA (Motor de Aprendizaje)</strong>: Auditoría y optimización de sugerencias de breaks respetando la regla de salidas tempranas.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Modal flotante con desenfoque de fondo para visualización de tareas.",
            "descEn": "• <strong>Price Radar (Executive Alerts & Management Dispatch)</strong>: Designed and implemented executive HTML email template for Viele & Sons price changes. Deployed email dispatch to 4 directors (Roberto, Raquel, Gonzalo, Carlos) with annual chain-wide financial impact ($ USD), direct links to /admin/precios-proveedores, and sent official presentation email with attached PDF.<br>• <strong>Price Radar (Viele & Sons v3 Scraper)</strong>: Hardened Viele REST API scraper and secured credential handling.<br>• <strong>MilesIQ & Chatbot UI</strong>: Repositioned update toast to bottom-center to prevent floating chatbot button overlap.<br>• <strong>Breaks AI (Learning Engine)</strong>: Audited and refined break suggestions honoring early-departure manager rules.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Floating modal with blurred backdrop for task viewing."
        },
        {
            "date": "22-Ago-2026",
            "time": "10:00 AM - 12:30 PM & 3:15 PM - 5:15 PM & 5:20 PM - 7:30 PM & 9:15 PM - 12:50 AM",
            "hours": 10.5,
            "badges": [
                "Ventas Toast API (Bell $8,332.64)",
                "Descansos IA Audit",
                "Uniformes Stock Mínimo",
                "MilesIQ GPS & Generated Columns",
                "Módulo Admin HTML",
                "Gantt Unificado"
            ],
            "descEs": "• <strong>Ventas (Toast API & Conciliación Bell $8,332.64)</strong>: Diagnóstico y resolución de discrepancia de ventas en Bell. Identificación de reembolsos de fechas cruzadas (Cross-Date Refunds de Party Trays) y soporte EBT para cuadre al centavo.<br>• <strong>Descansos Laborales (Auditoría Integral LÍNEA POR LÍNEA)</strong>: Corrección de solapamiento visual de popups en logs de descansos, blindaje del motor de pausas y auditoría de violaciones de California.<br>• <strong>Uniformes & Caja Fuerte</strong>: Auditoría y blindaje de la tabla de stock mínimo (660 registros en BD para las 15 tiendas) y conciliación del flujo de ventas en efectivo con la Caja Fuerte.<br>• <strong>MilesIQ Supervisores (GPS & Columnas Generadas)</strong>: Blindaje contra error fatal PostgreSQL 428C9 omitiendo columnas autocalculadas en payloads de inserción, optimización de interpolación de rutas y captura a 1 toque.<br>• <strong>Módulo Admin de Reportes HTML (/admin/reporte-actividades)</strong>: Creación del visor interactivo exclusivo para Administradores con pestañas dinámicas para alternar entre Junio, Julio y Agosto sin requerir PDFs estáticos.<br>• <strong>Unificación de Líneas de Tiempo Gantt</strong>: Recreación y sincronización de las pistas cronológicas (4:00 AM - 12:00 AM) para los 3 reportes mensuales con doble carril (Tienda Lynwood y Dev TEG).",
            "descEn": "• <strong>Sales (Toast API & Bell Reconciliation $8,332.64)</strong>: Solved Bell sales discrepancy by handling cross-date party tray refunds and EBT items.<br>• <strong>Labor Breaks (Full LINE-BY-LINE Audit)</strong>: Fixed visual tooltip overlap on lunch/break logs and automated CA meal break violation auditing.<br>• <strong>Uniforms & Safe Box</strong>: Audited and locked 660 minimum stock DB records across all 15 stores with cash sale reconciliation.<br>• <strong>MilesIQ (GPS & PostgreSQL Generated Columns)</strong>: Guarded against Postgres 428C9 error by omitting computed columns in insertion payloads, route gap optimization, and 1-tap logging.<br>• <strong>Admin HTML Reports Viewer (/admin/reporte-actividades)</strong>: Built interactive Admin-exclusive viewer with month switching tabs, eliminating static PDFs.<br>• <strong>Unified Gantt Timelines</strong>: Recreated and synced 4 AM - 12 AM dual-track schedules across all 3 monthly reports."
        },
        {
            "date": "23-Ago-2026",
            "time": "12:00 AM - 1:15 AM & 6:30 AM - 8:30 AM & 9:30 AM - 12:30 PM & 10:00 PM - 10:30 PM",
            "hours": 6.75,
            "badges": [
                "Preparador (Auditoría)",
                "Caja Fuerte (PST & Sync)",
                "Pedidos Bodega (PAR Lock)",
                "Checklists Temperaturas (≤40°F / ≥140°F)",
                "MilesIQ (Filtro Supervisores)",
                "Planificador Turnos Lynwood"
            ],
            "descEs": "• <strong>Preparador de Carne (Auditoría Forense Integral Línea por Línea)</strong>: Blindaje del acelerador intradía contra divisiones por cero, calibración de proyecciones por tramos y sincronización con tablets de cocina.<br>• <strong>Caja Fuerte & Bóveda</strong>: Corrección del cálculo de fechas en zona horaria PST (America/Los_Angeles), limpieza de manualOverride al resetear formulario y eliminación de condición de carrera asíncrona en conciliación con ventas de uniformes.<br>• <strong>Pedidos de Bodega & Insumos</strong>: Habilitación de edición de PAR en días bloqueados con reflejo en la semana siguiente y badge de estatus; auditoría exhaustiva de guardado parcial de estimates en QuickBooks.<br>• <strong>Checklists de Inocuidad y Temperaturas</strong>: Calibración reglamentaria de umbrales para refrigeración y barras frías (≤ 40°F) y mantenimiento caliente (≥ 140°F) con integración de estatus_manager.<br>• <strong>MilesIQ (Sincronización de Inspecciones & Filtro de Supervisores)</strong>: Filtrado estricto por supervisor activo y prevención de rutas redundantes.<br>• <strong>Planificador & Gantt</strong>: Conexión dinámica con Supabase para reflejar los 75 turnos exactos de Carlos Velazquez en Lynwood #14 y resolución del caso borde de medianoche en el Gantt.",
            "descEn": "• <strong>Prep Line (Comprehensive Line-by-Line Forensic Audit)</strong>: Hardened intraday accelerator against zero-division errors, calibrated period blocks, and synced kitchen tablets.<br>• <strong>Safe Management (PST Timezone & Race Conditions)</strong>: Fixed PST date calculations, cleared manualOverride on form resets, and resolved async race condition in uniform cash reconciliation.<br>• <strong>Bodega Orders & Warehouse PAR</strong>: Enabled PAR editing on locked days with next-week reflection and status badge; full audit of partial QuickBooks estimate saves.<br>• <strong>Food Safety & Temperature Checklists</strong>: Calibrated regulatory thresholds for cold holding (≤ 40°F) and hot holding (≥ 140°F), adding estatus_manager field.<br>• <strong>MilesIQ (Inspection Sync & Active Supervisor Filter)</strong>: Filtered active supervisors and prevented redundant multi-leg direct routes.<br>• <strong>Planner & Gantt Sync</strong>: Live connection to Supabase shifts table to display Carlos Velazquez's exact 75 Lynwood #14 General Manager shift schedules and resolved midnight wrap-around on Gantt ruler."
        },
        {
            "date": "24-Ago-2026",
            "time": "1:19 PM - 1:24 PM & 7:01 PM - 11:08 PM",
            "hours": 5.2,
            "badges": [
                "Ventas Reportes Auth",
                "RONOS HR API Conector",
                "Asistencia Biométrica & Mapeo",
                "Simplify Payroll Sync"
            ],
            "descEs": "• <strong>Ventas & Reportes Operativos</strong>: Corrección de autenticación y carga resiliente en reportes de ventas operativos y semanales.<br>• <strong>Módulo RONOS HR (Conector Oficial & Scraping Biométrico)</strong>: Creación de la arquitectura de conexión contra el portal de RONOS (lib/ronos-api.ts), autenticación segura y extracción de ponchadas de reloj, fotografías biométricas y turnos de empleados en las 15 tiendas.<br>• <strong>Asistencia & Violaciones</strong>: Detección automática de faltas, retardos, violaciones de lunch breaks bajo normativa de California y dobles descansos.<br>• <strong>Mapeo de Empleados</strong>: Motor de sincronización automática de perfiles entre RONOS, Toast POS y el Planificador de Tacos Gavilan.",
            "descEn": "• <strong>Sales & Operational Reports</strong>: Fixed authentication and resilient loading in daily and weekly sales dashboards.<br>• <strong>RONOS HR Module (Official Connector & Biometric Scraping)</strong>: Built core connection engine to RONOS portal (lib/ronos-api.ts), secure auth, and ingestion of clock-ins, biometric photos, and store punches across all 15 branches.<br>• <strong>Attendance & Violations</strong>: Automated detection of absences, tardiness, California meal break violations, and split lunches.<br>• <strong>Employee Mapping</strong>: Auto-mapping engine between RONOS, Toast POS, and Tacos Gavilan Shift Planner."
        },
        {
            "date": "25-Ago-2026",
            "time": "7:03 AM - 6:51 PM",
            "hours": 12.3,
            "badges": [
                "RONOS & Simplify Nómina",
                "Auditoría Invoices Cingular",
                "Markup % & Salarios Managers",
                "MilesIQ GPS Bugfix Rialto"
            ],
            "descEs": "• <strong>RONOS & Simplify (Motor de Conciliación de Nómina Cingular HR)</strong>: Algoritmo de cruce de Pay Rate vs Bill Rate y cálculo de margen de markup exacto (26.0% y 25.98%). Fórmulas de cálculo al centavo para salarios de General Managers y Supervisores, desglosando Sick Pay y Vacaciones ($3,033.40 para Carlos Velazquez en Lynwood).<br>• <strong>Auditoría de Facturas Reales PDF</strong>: Conciliación automatizada de facturas de Cingular HR para West Covina, Bell, Slauson, Lynwood y Broadway contra ponchadas reales de RONOS.<br>• <strong>Detección de Transferencias Multitienda</strong>: Algoritmo cronológico de detección de empleados transferidos entre sucursales (Adriana Reyes, Tiare Alor) según fecha de actividad.<br>• <strong>Caché Permanente en Supabase</strong>: Almacenamiento histórico en base de datos para carga instantánea de 2022 a la fecha.<br>• <strong>MilesIQ (Auditoría Línea por Línea & Bugfix Rialto)</strong>: Resolución de bloqueo en app de iPhone para supervisora Estefani al iniciar ruta en Rialto, auditoría de geofences y aislamiento de notificaciones push.",
            "descEn": "• <strong>RONOS & Simplify (Cingular HR Payroll Audit Engine)</strong>: Pay Rate vs Bill Rate matching engine and exact markup margin calculation (26.0% & 25.98%). Cent-perfect wage formulas for General Managers and Supervisors with Sick Pay & Vacation breakdown ($3,033.40 for Carlos Velazquez at Lynwood).<br>• <strong>Real PDF Invoice Auditing</strong>: Automated audit of Cingular HR invoices for West Covina, Bell, Slauson, Lynwood, and Broadway against real RONOS punches.<br>• <strong>Multi-Store Transfer Detector</strong>: Chronological employee transfer detector between branches based on punch activity dates.<br>• <strong>Permanent Supabase Cache</strong>: Database caching from 2022 to present for instant UI loading.<br>• <strong>MilesIQ (Line-by-Line Audit & Rialto Bugfix)</strong>: Resolved iPhone app flow lock for supervisor Estefani starting routes at Rialto, audited geofences, and isolated push alerts."
        },
        {
            "date": "26-Ago-2026",
            "time": "12:00 AM - 1:45 AM & 11:45 AM - 5:15 PM & 7:00 PM - 10:30 PM",
            "hours": 10.75,
            "badges": [
                "Radar Precios (Alertas Ahorro & Cron 5D)",
                "RONOS & Simplify Admin Creds",
                "Invoices Azusa y La Puente",
                "Viele Scraper Optimizado (1.15s)"
            ],
            "descEs": "• <strong>Radar de Precios (Alertas de Ahorro por Bajada de Precios & Cron 5 Días)</strong>: Implementación del sistema de alertas ejecutivas por correo ante bajadas de precios para resaltar ahorros directos para la empresa (petición de Roberto Velazquez). Configuración del cron de revisión automática a 5 días por semana (Lunes a Viernes 6:00 AM PST).<br>• <strong>Radar de Precios (Scraper Optimizado & Homologación de Códigos)</strong>: Optimización del scraper de la API de Viele con respuesta ultra-rápida (1.15s) y mapeo automático de códigos de reemplazo de insumos (EL4LID a KDL76PP).<br>• <strong>RONOS & Simplify (Credenciales Administrativas & Extracción Batch)</strong>: Conexión con credenciales administrativas corporativas para extracción masiva de perfiles, salarios reales de supervisores/gerentes y paystubs históricos.<br>• <strong>Auditoría de Invoices Multitienda</strong>: Conciliación matemática de facturas PDF de Cingular HR para las sucursales de Azusa (invoice-TEGA-0009.pdf) y La Puente (invoice-TEGL-0022.pdf).",
            "descEn": "• <strong>Price Radar (Savings Alerts on Price Drops & 5-Day Cron)</strong>: Implemented executive email alerts for price decreases to highlight company savings (requested by Roberto Velazquez). Configured automated cron to run 5 days a week (Mon-Fri 6:00 AM PST).<br>• <strong>Price Radar (Optimized Scraper & Item Code Remapping)</strong>: Accelerated Viele API live scraper to 1.15s response time and remapped vendor replacement codes (EL4LID to KDL76PP).<br>• <strong>RONOS & Simplify (Admin Credentials & Batch Extraction)</strong>: Integrated corporate admin credentials for bulk extraction of employee master profiles, active supervisor/manager salaries, and historical paystubs.<br>• <strong>Multi-Store Invoice Auditing</strong>: Cent-perfect mathematical reconciliation of Cingular HR PDF invoices for Azusa (invoice-TEGA-0009.pdf) and La Puente (invoice-TEGL-0022.pdf)."
        },
        {
            "date": "27-Ago-2026",
            "time": "5:30 AM - 8:45 AM & 5:30 PM - 11:45 PM",
            "hours": 9.5,
            "badges": [
                "RONOS Motor Invoices 16 Tiendas",
                "La Bodega Horas & Nómina",
                "Simplify Bugfixes & Resiliencia",
                "Rediseño UI Pestañas RONOS"
            ],
            "descEs": "• <strong>RONOS & Simplify (Motor de Pre-Cálculo de Invoices a Nivel Cadena)</strong>: Algoritmo automatizado para pre-calcular las facturas quincenales de las 16 sucursales (incluyendo La Bodega) antes de la emisión de Cingular HR, contrastando punches reales contra nómina procesada.<br>• <strong>La Bodega (Horas & Personal)</strong>: Integración de personal de almacén central y resolución de fórmulas de cálculo para personal con esquemas especiales.<br>• <strong>Auditoría Integral Línea por Línea</strong>: Auditoría exhaustiva de app/admin/ronos/page.tsx (2,728 líneas), lib/simplifyhr-api.ts (843 líneas) y lib/ronos-api.ts (1,006 líneas), eliminando fallos en runtime por propiedades nulas.<br>• <strong>Rediseño UI & Usabilidad</strong>: Simplificación de la interfaz visual de RONOS, modernización del sistema de navegación por pestañas y clarificación de métricas de cumplimiento de descansos.",
            "descEn": "• <strong>RONOS & Simplify (Chain-Wide Invoice Pre-Calculation Engine)</strong>: Automated algorithm to pre-calculate bi-weekly invoices across all 16 locations (including Warehouse) prior to Cingular HR billing, benchmarking actual punches against payroll.<br>• <strong>Warehouse (Staff & Hours)</strong>: Integrated central warehouse staff and resolved specialized pay calculations.<br>• <strong>Comprehensive Line-by-Line Audit</strong>: Full audit of app/admin/ronos/page.tsx (2,728 lines), lib/simplifyhr-api.ts (843 lines), and lib/ronos-api.ts (1,006 lines), eliminating runtime null crashes.<br>• <strong>UI Redesign & Usability</strong>: Streamlined RONOS visual interface, modern tab navigation, and clear break compliance metrics."
        },
        {
            "date": "28-Ago-2026",
            "time": "12:30 AM - 1:30 AM & 6:30 AM - 10:15 AM",
            "hours": 4.75,
            "badges": [
                "MilesIQ Auditoría Línea por Línea",
                "Validación Decimales Millas",
                "Null-Safety Blindaje Total",
                "Estabilidad RONOS & Simplify"
            ],
            "descEs": "• <strong>MilesIQ (Auditoría Forense Integral Línea por Línea)</strong>: Auditoría profunda de TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, endpoints de API (/api/miles) y lógica de geofencing, blindando todos los escenarios de registro de viajes.<br>• <strong>MilesIQ (Validación de Decimales & Round-Trip)</strong>: Corrección de validación de decimales (step 0.01) en captura de millas y duplicación automática de distancia en viajes redondos (Round-Trip).<br>• <strong>RONOS & Simplify (Blindaje Null-Safety Extremo)</strong>: Aplicación de 73 protecciones null-safe completas en lib/payroll-calculator.ts (978 líneas), lib/ronos-api.ts (1,262 líneas) y app/admin/ronos/page.tsx (2,756 líneas), aprobando el 100% de los smoke tests en runtime.",
            "descEn": "• <strong>MilesIQ (Comprehensive Line-by-Line Forensic Audit)</strong>: Deep audit across TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, API routes (/api/miles), and geofencing logic, securing all trip capture scenarios.<br>• <strong>MilesIQ (Decimal Validation & Round-Trip Calculation)</strong>: Fixed 2-decimal step validation in trip logging and automated round-trip distance doubling.<br>• <strong>RONOS & Simplify (Total Null-Safety Hardening)</strong>: Applied 73 null-safe guards across lib/payroll-calculator.ts (978 lines), lib/ronos-api.ts (1,262 lines), and app/admin/ronos/page.tsx (2,756 lines), passing 100% of runtime smoke tests."
        },
        {
            "date": "29-Ago-2026",
            "time": "—",
            "hours": 0,
            "badges": [
                "Descanso Operativo"
            ],
            "descEs": "• <strong>Día de Descanso Operativo (Programación)</strong>: Turno presencial en tienda Lynwood #14 (2:00 PM - 9:00 PM). Sin actividad de desarrollo en el sistema.",
            "descEn": "• <strong>Operational Rest Day (Development)</strong>: In-store manager shift at Lynwood #14 (2:00 PM - 9:00 PM). No system development activity."
        },
        {
            "date": "30-Ago-2026",
            "time": "—",
            "hours": 0,
            "badges": [
                "Descanso Operativo"
            ],
            "descEs": "• <strong>Día de Descanso Operativo (Programación)</strong>: Turno presencial en tienda Lynwood #14 (2:00 PM - 7:00 PM). Sin actividad de desarrollo en el sistema.",
            "descEn": "• <strong>Operational Rest Day (Development)</strong>: In-store manager shift at Lynwood #14 (2:00 PM - 7:00 PM). No system development activity."
        },
        {
            "date": "31-Ago-2026",
            "time": "12:45 PM - 1:30 PM & 7:45 PM - 12:00 AM",
            "hours": 5.5,
            "badges": [
                "Contador Versiones UI (v2.5.0)",
                "Radar Precios Auto-Aprobación",
                "Protección Food Cost Histórico",
                "Cron Viele 6:00 AM PST",
                "Preparador KDS Despertar",
                "Cierre Definitivo 169.5h"
            ],
            "descEs": "• <strong>Contador de Versiones UI (SM TEG v2.5.0 • Producción)</strong>: Diseño e implementación de la insignia de versiones de alto contraste y pulso en vivo en el menú superior y lateral de usuario.<br>• <strong>Radar de Precios & Cron (Auto-Aprobación & Protección de Food Cost Histórico)</strong>: Blindaje de la sincronización de QuickBooks para no sobreescribir insumos externos (is_bodega: false). Auto-aprobación automática de precios de Viele en inventory_items e inventory_price_history al dispararse el cron diario (6:00 AM PST), invalidando la caché de Food Cost actual sin alterar los históricos de fechas pasadas.<br>• <strong>Plantilla Ejecutiva de Correo</strong>: Rediseño limpio en 5 columnas con fecha del último precio aprobado (lastApprovedDate) y cálculo de impacto financiero anual a nivel cadena.<br>• <strong>Preparador de Carne (Botón Despertar Tableta & Auto-Actualización 24/7)</strong>: Botón de inicio de turno para sincronización en 1 toque y auto-cambio de día comercial (6:00 AM) sin recarga manual.<br>• <strong>MilesIQ</strong>: Respaldo y depuración de recorridos de prueba de Ricardo y Estefani antes del arranque oficial del 1 de septiembre.<br>• <strong>Cierre Definitivo de Mes (169.50 hrs)</strong>: Reconciliación forense total de 380 transcripciones de chats y consolidación oficial de agosto con 27 tareas canonicales.",
            "descEn": "• <strong>UI Version Counter (SM TEG v2.5.0 • Production)</strong>: Designed and integrated high-contrast live-pulsing version badge in desktop and mobile user profile dropdowns.<br>• <strong>Price Radar & Cron (Auto-Approval & Historical Food Cost Protection)</strong>: Guarded QuickBooks sync from overwriting non-bodega vendor items. Enabled automatic price auto-approval in inventory_items and inventory_price_history upon daily 6:00 AM PST cron execution, refreshing current food cost cache while strictly preserving historical food cost integrity.<br>• <strong>Executive Email Template</strong>: Clean 5-column layout with last approved price date (lastApprovedDate) and annual chain-wide financial impact.<br>• <strong>Prep Line (Wake Tablet Button & 24/7 KDS Auto-Sync)</strong>: 1-tap shift start sync button and seamless 6:00 AM business day rollover without manual page reloads.<br>• <strong>MilesIQ</strong>: Backed up and purged August testing trips for Ricardo and Estefani ahead of official Sept 1 launch.<br>• <strong>Final Month Close (169.50 hrs)</strong>: Full forensic multi-chat reconciliation across 380 transcripts and official August consolidation with 27 canonical tasks."
        }
    ],
    "effortSummary": [
        {
            "module": "Módulo RONOS HR & Simplify Payroll Audit",
            "hours": 31.5
        },
        {
            "module": "Preparador de Carne y Cocina KDS",
            "hours": 30.5
        },
        {
            "module": "MilesIQ Supervisores & Geofencing GPS",
            "hours": 25
        },
        {
            "module": "Ventas Toast API & Conciliación Multitienda",
            "hours": 20.5
        },
        {
            "module": "Radar de Precios Viele v3, Scraper & Alertas de Ahorro",
            "hours": 18.5
        },
        {
            "module": "Mantenimiento General, Crons y Reportes",
            "hours": 16
        },
        {
            "module": "Control de Uniformes & Caja Fuerte",
            "hours": 14
        },
        {
            "module": "Descansos Laborales (Labor Compliance AI)",
            "hours": 13.5
        }
    ],
    "parallelActivities": [
        {
            "title": "Pruebas en Sucursal/Local",
            "hours": 3,
            "desc": "Testing en cocina del modo tableta kiosko del Preparador, validación de sincronización PC-Tableta y geofencing de MilesIQ en las 15 tiendas."
        },
        {
            "title": "Monitoreo DB y APIs",
            "hours": 2.5,
            "desc": "Auditoría de API v3 Viele & Sons (Radar de Precios), endpoints de conciliación de Ventas Toast y cálculo IRS de millas."
        },
        {
            "title": "Planificación y Diseño",
            "hours": 1.5,
            "desc": "Arquitectura de Tech Packs para uniformes, diseño del acelerador intradía de carne y estructura de las 27 tareas oficiales."
        }
    ],
    "tasks": [
        {
            "num": 1,
            "title": "1. Inventario con reposición automática",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas analizando el consumo histórico de las últimas 4 semanas y las existencias actuales capturadas por el gerente.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas con soporte preliminar de QuickBooks.",
            "auditAugust": "<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes.",
            "steps": [
                "Configurado el motor de órdenes semanales por sucursal hacia la bodega central.",
                "Integrada la API de QuickBooks Online con guardado seguro.",
                "Pruebas y validación en sucursales operando al 100%."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes."
        },
        {
            "num": 2,
            "title": "2. Inventario para Bodega y COGS (Viele & Sons)",
            "category": "Costos & Proveedores",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran al proveedor Viele & Sons.",
            "auditJuly": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran a Viele & Sons.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos.",
            "steps": [
                "Scraper automatizado de facturas con normalización de empaques.",
                "Dashboard ejecutivo de Radar de Precios con 4 métricas anuales.",
                "Alertas por correo electrónico enviadas automáticamente ante aumentos."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos."
        },
        {
            "num": 3,
            "title": "3. Configuración local de TVs de Menús",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda y la página pública que muestra el menú rotativo en las pantallas.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda.",
            "auditAugust": "<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche.",
            "steps": [
                "Diseño responsive en alta resolución para pantallas de TV.",
                "Conexión en tiempo real con la base de datos de precios.",
                "Despliegue y verificación en pantallas locales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche."
        },
        {
            "num": 4,
            "title": "4. Logotipo de marca en correos electrónicos",
            "category": "Comunicaciones / Comms",
            "badgeDept": "✉️ Comunicaciones",
            "badgePriority": "🔵 Baja",
            "auditJune": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales utilizando el servidor de tacosgavilan.com con texto plano y firma básica.",
            "auditJuly": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales con firma básica.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios.",
            "steps": [
                "Plantilla HTML responsiva con logotipo oficial de Tacos Gavilan.",
                "Integración con el servicio de envío de correos (Resend/SMTP).",
                "Verificado en clientes de correo móvil y escritorio."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios."
        },
        {
            "num": 5,
            "title": "5. Descripciones de procedimientos en página de ACTIVIDADES",
            "category": "Operaciones / Operations",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo. Contiene el listado de 31 procedimientos operativos estandarizados.",
            "auditJuly": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo.",
            "auditAugust": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal.",
            "steps": [
                "Base de datos de procedimientos y actividades estructurada.",
                "Interfaz de consulta rápida y búsqueda por palabra clave.",
                "Sincronización con el Asistente de Soporte IA."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal."
        },
        {
            "num": 6,
            "title": "6. Verificar tabletas piloto en Slauson",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>En Pruebas (En Progreso).</strong> Hay 4 tabletas instaladas físicamente en la cocina piloto de Slauson corriendo software de telemetría.",
            "auditJuly": "<strong>✓ Completado e Integrado (Julio 2026).</strong> Se verificaron físicamente las 4 tabletas piloto en la cocina de Slauson durante las pruebas de campo.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad.",
            "steps": [
                "Desarrollo del modo pantalla completa exclusivo para cocina.",
                "Polling de sincronización bidireccional cada 10s en Supabase.",
                "Pruebas y validación en sitio en tableta de cocina."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad."
        },
        {
            "num": 7,
            "title": "7. App de Tacos Gavilán (Imitar King Taco)",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Creado el sistema de base de datos para la aplicación móvil (carritos de compra, puntos de fidelidad, selector de sucursal y menú interactivo).",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Base de datos de la app móvil y catálogo digital de productos estructurado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast.",
            "steps": [
                "Estructura de catálogo móvil y carrito de compras.",
                "Integración con la pasarela de pagos y menú en línea.",
                "Pruebas de pedidos móviles en sucursales piloto."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast."
        },
        {
            "num": 8,
            "title": "8. Sincronizador y clon de Basecamp",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Altamente Avanzado (En Progreso).</strong> El sistema web está integrado con Basecamp. Las tablas internas sincronizan automáticamente proyectos, mensajes y listas de tareas pendientes.",
            "auditJuly": "<strong>Altamente Avanzado (En Progreso).</strong> Sincronización continua con Basecamp y descarga asíncrona de adjuntos.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos.",
            "steps": [
                "Integración OAuth2 y sincronización local-first en Supabase.",
                "Buscador universal Shift+J con búsqueda paralela.",
                "Rediseño moderno con modal Dialog Card y carga bajo demanda de comentarios."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos."
        },
        {
            "num": 9,
            "title": "9. Página Web Oficial de Tacos El Gavilán",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Avanzado (En Progreso).</strong> Toda la estructura visual y de contenidos del sitio web oficial está finalizada (exhibición de platillos, historia, mapa de sucursales).",
            "auditJuly": "<strong>Avanzado (En Progreso).</strong> Estructura visual y mapa de sucursales completado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO.",
            "steps": [
                "Diseño responsivo móvil y de escritorio.",
                "Integración del directorio oficial de 15 tiendas.",
                "Despliegue y configuración de dominio."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO."
        },
        {
            "num": 10,
            "title": "10. Determinar gasto en Salsa Bar",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Existe registro de mermas e ingredientes de la barra de salsas en los checklists históricos, pero no se ha desarrollado el módulo de cálculo de costo por porción.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo pendiente de desarrollo para calcular el costo por porción del salsa bar.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal.",
            "steps": [
                "Estandarizar recetas y pesos de preparación de salsas.",
                "Registrar rendimiento por tanda y costo de insumos.",
                "Integrar en la matriz de Food Cost de la cadena."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal."
        },
        {
            "num": 11,
            "title": "11. Fotos y verificación Apple Business Connect (Slauson)",
            "category": "Dispositivos / Marketing",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Tarea operativa consistente en registrar la sucursal de Slauson, subir fotografías en alta resolución del interior/exterior y verificar la ficha del negocio en Apple Maps.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Verificación en Apple Maps pendiente de sesión de fotografía.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales.",
            "steps": [
                "Fotografía profesional de exteriores e interiores de tiendas.",
                "Carga de assets en portal Apple Business Connect.",
                "Validación de pin y horarios en Apple Maps."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales."
        },
        {
            "num": 12,
            "title": "12. Registro de proveedores y técnicos sin contraseña",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Planificado un portal simplificado de acceso rápido con códigos temporales para que técnicos de refrigeración y proveedores registren sus visitas sin requerir cuenta.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Portal de acceso con código QR temporal para proveedores pendiente.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas.",
            "steps": [
                "Generador de códigos QR y links temporales para contratistas.",
                "Bitácora digital de entradas y salidas de técnicos.",
                "Alertas al gerente de tienda al arribar personal externo."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas."
        },
        {
            "num": 13,
            "title": "13. Control de uniformes, gorras e inventario de ropa",
            "category": "Inventario / Merchandise",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo operativo pendiente de desarrollo para controlar las existencias de uniformes, gorras y chamarras.",
            "auditJuly": "<strong>▶ En Progreso (Julio 2026).</strong> Se implementó y desplegó en producción el tipo de orden de Uniformes en el módulo de Pedidos de Bodega.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte.",
            "steps": [
                "Catálogo de precios y reglas de exención implementadas.",
                "Tabla de stock mínimo (660 registros en BD) blindada.",
                "Conciliación automática con la bóveda de Caja Fuerte."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte."
        },
        {
            "num": 14,
            "title": "14. Manuales, videos y certificación de cocina",
            "category": "Operaciones / Training",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> El sistema cuenta con exámenes rápidos de desempeño para gerentes, pero falta crear la biblioteca de videos demostrativos y el flujo de certificación para personal de línea.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Biblioteca de videos demostrativos de recetas y cocina pendiente de producción.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros.",
            "steps": [
                "Producción de videos cortos demostrativos por estación.",
                "Cuestionarios de evaluación interactivos en tableta.",
                "Certificados digitales de aprobación por empleado."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros."
        },
        {
            "num": 15,
            "title": "15. Sección de Cultura Empresarial",
            "category": "Operaciones / HR",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Sección informativa planificada para capacitar y familiarizar a los nuevos empleados con los valores, historia y visión de Tacos Gavilan.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo de onboarding y valores de empresa pendiente.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte.",
            "steps": [
                "Documento de valores, misión y estándares de servicio.",
                "Módulo visual de inducción para nuevos empleados.",
                "Integración en el flujo de bienvenida de la app."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte."
        },
        {
            "num": 16,
            "title": "16. CLONAR Cohesion (app de contabilidad)",
            "category": "Sistemas / Finance",
            "badgeDept": "💻 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Desarrollo e integración de un clon contable de la plataforma Cohesión a medida para procesar pólizas de ventas y conciliar cuentas bancarias.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo contable integral en fase de especificación y análisis de viabilidad.",
            "auditAugust": "<strong>⚡ En Progreso (80% en Agosto 2026).</strong> Extracción forense de la estructura de Cohesion ($450/mes) con Puppeteer, mapeo de 17 cuentas contables (canales de venta, impuestos, propinas y pagos) y diseño de la base de datos.",
            "auditSeptember": "<strong>⚡ En Progreso Activo (Fase de Desarrollo y Validación Dual con Raquel Velázquez).</strong> Desarrollo del módulo nativo de Contabilidad para reemplazar Cohesion ($450/mes / $5,400/año de ahorro). Construcción de la librería central lib/accounting-journal.ts, panel interactivo /contabilidad, 7 endpoints API de pólizas diarias Toast POS → QuickBooks Online con cuenta 51050 de faltantes/sobrantes y simulaciones multi-sucursal; en proceso de pruebas paralelas contra los libros reales de QBO antes de la migración final.",
            "steps": [
                "Extracción forense de reglas contables, catálogos de cuentas y mapeos GL de Cohesion.",
                "Librería central lib/accounting-journal.ts (17 cuentas, canales For Here/To Go/Uber/DoorDash/GrubHub y efectivo).",
                "Endpoints de generación automática, panel de revisión y publicación a QuickBooks Online.",
                "Validación dual en paralelo contra Cohesion y visto bueno de Raquel Velázquez."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso (80% en Agosto 2026).</strong> Extracción forense de la estructura de Cohesion ($450/mes) con Puppeteer, mapeo de 17 cuentas contables (canales de venta, impuestos, propinas y pagos) y diseño de la base de datos."
        },
        {
            "num": 17,
            "title": "17. Módulo de Rendimiento y Telemetría de Drive-Thru (HME Zoom Nitro)",
            "category": "Sistemas / Hardware",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>✓ Completado e Integrado (Junio 2026).</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru en las sucursales con ventanilla.",
            "auditJuly": "<strong>✓ Completado e Integrado.</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real de tiempos de espera, cobro y despacho de ventanilla con alertas por cuello de botella.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real activa en sucursales con ventanilla.",
            "steps": [
                "Conexión con la API/controlador de HME Zoom Nitro.",
                "Métricas en vivo de segundos por vehículo en ventanilla.",
                "Historial de rendimiento y benchmarks entre sucursales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real de tiempos de espera, cobro y despacho de ventanilla con alertas por cuello de botella."
        },
        {
            "num": 18,
            "title": "18. Actualizar y Descargar Videos Musicales Regional Mexicano",
            "category": "Operaciones / Marketing",
            "badgeDept": "🎵 Tienda",
            "badgePriority": "🟢 Normal",
            "auditJune": "",
            "auditJuly": "<strong>⏳ Pendiente (Julio 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano para las pantallas de las sucursales.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano en formato MP4 HD organizados en unidades USB para reproducción en los televisores de los restaurantes.",
            "auditSeptember": "<strong>✓ Completado y Distribuido.</strong> Biblioteca musical de videos MP4 HD entregada a sucursales.",
            "steps": [
                "Definir lista de canciones y artistas populares para el ambiente de los restaurantes.",
                "Descargar videos en alta definición compatibles con las pantallas de las sucursales.",
                "Organizar archivos y distribuirlos a las sucursales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado (Agosto 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano en formato MP4 HD organizados en unidades USB para reproducción en los televisores de los restaurantes."
        },
        {
            "num": 19,
            "title": "19. Módulo de Caja Fuerte (Conteo de Efectivo por Sucursal)",
            "category": "Finanzas / Treasury",
            "badgeDept": "💰 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "<strong>✓ Completado e Integrado (10-Jul-2026).</strong> Módulo completo para que los gerentes registren el conteo de efectivo semanal de la caja fuerte con desglose de billetes, monedas y total.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Registro semanal de billetes, monedas sueltas, rollos y gavetas con cálculo automático de gran total, conciliación de ventas de uniformes y control de ediciones pasadas.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Registro y conciliación semanal de caja fuerte en producción.",
            "steps": [
                "Formulario estructurado de desglose de efectivo.",
                "Conciliación automática con ventas de uniformes en efectivo.",
                "Historial auditable con control de modificaciones por rol."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Registro semanal de billetes, monedas sueltas, rollos y gavetas con cálculo automático de gran total, conciliación de ventas de uniformes y control de ediciones pasadas."
        },
        {
            "num": 20,
            "title": "20. Módulo de Tiendas (Integración Dinámica, Geocodificación y Mapas de Google)",
            "category": "Sistemas / Locations",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "<strong>✓ Completado e Integrado (14-Jul-2026).</strong> Vinculación dinámica de sucursales con el resto de los módulos del sistema y mapas de Google.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de las 15 sucursales oficiales + Bodega Central con coordenadas GPS exactas, teléfonos y horarios de operación.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de 15 sucursales oficiales y Bodega Central.",
            "steps": [
                "Tabla canónica de tiendas en base de datos.",
                "Geocodificación de coordenadas GPS para integración con MilesIQ.",
                "Selector global de sucursales en cabecera del sistema."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de las 15 sucursales oficiales + Bodega Central con coordenadas GPS exactas, teléfonos y horarios de operación."
        },
        {
            "num": 21,
            "title": "21. Radar de Precios Viele v3 y Auditoría de Impacto Anual COGS",
            "category": "Costos & Proveedores",
            "badgeDept": "📊 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (90% de avance).</strong> Ingesta automática de API REST v3 de Viele & Sons (86 insumos en 1.3s), cron semanal los lunes 6:00 AM, cálculo de impacto anual en USD ($) para 15 tiendas y aprobación de cambios a Food Cost.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Cron diario matutino 6:00 AM PST con telemetría en activity_logs, alerta ejecutiva por email con cálculo de impacto anual en USD y badge de estado en tiempo real.",
            "steps": [
                "Conexión API REST v3 y scraper automatizado.",
                "Cálculo de impacto inflacionario en dólares para la cadena.",
                "Integración con Sysco y US Foods para comparativas de mercado."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso (90% de avance).</strong> Ingesta automática de API REST v3 de Viele & Sons (86 insumos en 1.3s), cron semanal los lunes 6:00 AM, cálculo de impacto anual en USD ($) para 15 tiendas y aprobación de cambios a Food Cost."
        },
        {
            "num": 22,
            "title": "22. Control de Descansos Laborales (Labor Compliance AI & Alertas CA)",
            "category": "Recursos Humanos",
            "badgeDept": "⚖️ Legal & RRHH",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (85% de avance).</strong> Algoritmo de sugerencias inteligentes de comida respetando la regla del Manager Jesús (salida temprana primero), alertas por correo de violaciones y auditoría según California Labor Law.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Algoritmo inteligente de descansos, notificaciones automáticas de violaciones por correo electrónico y cumplimiento estricto de California Labor Law.",
            "steps": [
                "Motor de asignación dinámica de horarios de comida.",
                "Alertas de violaciones despachadas a supervisores y directivos.",
                "Afinación de la interfaz móvil y reporte mensual consolidado de multas."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso (85% de avance).</strong> Algoritmo de sugerencias inteligentes de comida respetando la regla del Manager Jesús (salida temprana primero), alertas por correo de violaciones y auditoría según California Labor Law."
        },
        {
            "num": 23,
            "title": "23. Conciliación Multitienda Toast API (Cross-Date Refunds & EBT)",
            "category": "Ventas & Contabilidad",
            "badgeDept": "💰 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (90% de avance).</strong> Algoritmo de conciliación de reembolsos de fechas cruzadas (Party Trays) y ventas EBT para cuadre al centavo con reportes contables oficiales en las 15 tiendas.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Algoritmo de conciliación de Party Trays (cross-date refunds), ventas EBT, mapa dinámico de dining options y auto-sanación de caché.",
            "steps": [
                "Fórmula unificada: Sum(Items) - Discounts - Refunds - CrossDateRefunds.",
                "Diagnóstico y resolución de discrepancias en tiendas (Bell $8,332.64).",
                "Automatización del cron de auto-sanación de caché de ventas."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso (90% de avance).</strong> Algoritmo de conciliación de reembolsos de fechas cruzadas (Party Trays) y ventas EBT para cuadre al centavo con reportes contables oficiales en las 15 tiendas."
        },
        {
            "num": 24,
            "title": "24. Módulo de Control de Millas y Desplazamientos MilesIQ (Geofencing GPS e IRS)",
            "category": "Supervisión & RRHH",
            "badgeDept": "🚗 Supervisión",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (85% de avance).</strong> Geofencing perimetral en las 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), lanzador rápido QuickDriveModal con apertura de Google/Apple Maps y sincronización automática desde inspecciones.",
            "auditSeptember": "<strong>✓ Completado e Implementado en Producción (Septiembre 2026).</strong> Geofencing GPS en 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), modal QuickDrive y tabla supervisor_mileage_trips.",
            "steps": [
                "Detección GPS pasiva por geofencing en tiendas oficiales.",
                "Cálculo automático de distancias y montos de reembolso IRS.",
                "Concluir exportación formal de nómina para despacho a RRHH."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso (85% de avance).</strong> Geofencing perimetral en las 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), lanzador rápido QuickDriveModal con apertura de Google/Apple Maps y sincronización automática desde inspecciones."
        },
        {
            "num": 25,
            "title": "25. Tech Packs y Fichas Técnicas de Uniformes (Licitación RFQ)",
            "category": "Compras & Proveedores",
            "badgeDept": "👕 Mercancía",
            "badgePriority": "🟡 Media",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>⚡ En Progreso (75% de avance).</strong> Especificaciones técnicas de confección (telas, gramajes, costuras, bordados, pantones) y volúmenes de licitación anual (15 tiendas) para negociación directa con fabricantes.",
            "auditSeptember": "<strong>✓ Completado e Implementado (Septiembre 2026).</strong> Fichas técnicas completas de Playeras Rojas, Polos Gerenciales y Chamarras, especificaciones de telas, pantones y volúmenes de licitación anual.",
            "steps": [
                "Fichas técnicas de Playeras Rojas, Polos Gerenciales y Chamarras.",
                "Volúmenes de compra anual calculados para licitación RFQ.",
                "Generación de documentos ejecutivos de negociación con proveedores."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>⚡ En Progreso (75% de avance).</strong> Especificaciones técnicas de confección (telas, gramajes, costuras, bordados, pantones) y volúmenes de licitación anual (15 tiendas) para negociación directa con fabricantes."
        },
        {
            "num": 26,
            "title": "26. Predicción Estacional de Galones de Champurrado a 5 Años",
            "category": "Cocina & Temporadas",
            "badgeDept": "☕ Operaciones",
            "badgePriority": "🟡 Media",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Modelo de proyección estacional en /api/inventory/champurrado-forecast con 5 años de historial de semanas ISO, conversión de 8 lbs/galón y sugerencia automática de galones diarios para la orden de bodega.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Motor predictivo estacional de champurrado activo en producción para la temporada invernal.",
            "steps": [
                "Extracción histórica de galones y vasos vendidos en Toast.",
                "Fórmula de sugerencia con niveles de confianza (HIGH/MED/LOW) y 8 lbs/gal.",
                "Integración visual informativa en la Orden Diaria de Bodega."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Modelo de proyección estacional en /api/inventory/champurrado-forecast con 5 años de historial de semanas ISO, conversión de 8 lbs/galón y sugerencia automática de galones diarios para la orden de bodega."
        },
        {
            "num": 27,
            "title": "27. Módulo RONOS HR, Auditoría de Nóminas Simplify & Paystubs",
            "category": "Recursos Humanos / Payroll",
            "badgeDept": "👥 RRHH & Nóminas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "",
            "auditAugust": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Sistema de extracción, auditoría y cruce de nóminas Simplify vs RONOS, motor de cálculo de billing PEO para 15 empresas/sucursales, visor de paystubs y detección automática de discrepancias salariales y horas extra.",
            "auditSeptember": "<strong>✓ Completado e Integrado en Producción.</strong> Auditoría quincenal continua de nóminas y conciliación de costos de personal.",
            "steps": [
                "Extracción forense de nóminas y timbrados de Simplify y RONOS.",
                "Motor de conciliación PEO con cálculo de cargas sociales y fees.",
                "Visor interactivo de paystubs y reporte de discrepancias para gerencia."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Sistema de extracción, auditoría y cruce de nóminas Simplify vs RONOS, motor de cálculo de billing PEO para 15 empresas/sucursales, visor de paystubs y detección automática de discrepancias salariales y horas extra."
        }
    ]
},
    julio: {
    "id": "julio",
    "monthName": "Julio",
    "monthYear": "Julio 2026",
    "totalHours": 117.8,
    "totalTasks": 20,
    "completedTasks": 4,
    "inProgressTasks": 9,
    "pendingTasks": 7,
    "rows": [
        {
            "date": "01-Jul-2026",
            "time": "1:30 PM - 8:30 PM",
            "hours": 7,
            "badges": [
                "Inventario",
                "QuickBooks"
            ],
            "descEs": "- **Inventario (Pedidos Bodega)**: Rediseño completo de la interfaz del catálogo de pedidos simplificando de 4 pestañas a solo 2 (Orden Diaria y Configuración Semanal).<br>- **Inventario**: Se añadió el valor de PAR Ideal directamente en la vista diaria con soporte para anulación de día base.<br>- **Inventario**: Se implementó una lista histórica en base de datos para almacenar Estimates con borrado sincronizado en QuickBooks.<br>- **QuickBooks**: Corrección de fecha de transacción (se asigna a la entrega al día siguiente en vez de creación).<br>- **QuickBooks**: Se incluyó el UnitPrice y Amount real en cada línea para evitar montos en cero.<br>- **QuickBooks**: Autoguardado de líneas de pedido antes de enviar a QuickBooks para prevenir envíos en blanco.<br>- **QuickBooks**: Rediseño responsivo de modal de edición de Estimates pasados para modificar cantidades.<br>- **QuickBooks**: Configuración para definir automáticamente la ubicación y clase como \"Warehouse\" y asignar dinámicamente el correo del gerente.<br>- **Planificador**: Ajuste de zonas horarias para la regla de las 6:00 AM.",
            "descEn": "- Inventory (Warehouse Orders): redesigned layout from 4 tabs to 2 tabs (Daily Order + Weekly Config).<br>- Inventory: integrated Ideal PAR view with custom base day override option.<br>- Inventory: created weekly estimates history database logs synced with QuickBooks.<br>- QuickBooks: set transaction date to delivery date. Included UnitPrice and calculated line Amounts.<br>- QuickBooks: auto-saves lines before submission to prevent empty orders. Coded a responsive modal to edit past estimates.<br>- QuickBooks: defaulted Location/Class to Warehouse and set manager emails dynamically.<br>- Schedules: solved timezone shifts for 6 AM rollover."
        },
        {
            "date": "02-Jul-2026",
            "time": "9:30 AM - 11:00 PM",
            "hours": 13.5,
            "badges": [
                "Inventario",
                "Sidebar",
                "Clima",
                "QuickBooks",
                "Recetas"
            ],
            "descEs": "- **Impresión y Conteo Físico**: Desarrollo e integración del sistema de impresión del listado de pedidos para cocina, el cual genera automáticamente hojas de trabajo con los sobrantes sugeridos prellenados para agilizar el conteo diario a mano.<br>- **Validación Anti-Errores (Flan/Cheesecake)**: Implementación de reglas de validación en tiempo real que obligan a los mánagers a capturar el conteo físico de Flan y Cheesecake antes de enviar datos a QuickBooks o generar el pedido (previene descuadres de postres externos).<br>- **Plantillas y Sincronización QB**: Unificación de la plantilla de líquidos (bebidas) heredando Lynwood como sucursal maestra y automatización de la sincronización de catálogos diarios y semanales desde QuickBooks.<br>- **Resiliencia de Telemetría Climatológica**: Reescritura del servicio del clima migrándolo al proveedor nacional NWS para estabilidad absoluta, configurando un historial de logs de 14 días para ajustar de forma predictiva el pace de carnes ante lluvias o calor extremo.<br>- **Aislamiento Técnico Sandbox**: Separación del almacenamiento local de tokens de prueba de QuickBooks, evitando interferencias o sobreescritura accidental sobre las credenciales de producción en Supabase.<br>- **Optimización de Pantallas (UX/UI)**: Remoción de menús laterales internos duplicados, ganando 20% de área útil. Solución definitiva al problema de doble scrollbar táctil en tabletas de cocina, y adición de barra superior de acciones rápidas (guardado, descarga e impresión).<br>- **Menú Principal e i18n**: Reestructuración de la navegación (`AppSidebar`) renombrando módulos operativos (\"Insumos de Bodega\", \"Orden diaria\", \"Recetas (Menú)\") y colapso ordenado de secciones.<br>- **Centro de Ayuda Integrado**: Creación de Info Modals interactivos junto a los títulos de página con guías paso a paso y glosarios de términos (PAR Ideal, PAR Real, Diferencial) para capacitación automática de mánagers.",
            "descEn": "- Print & Paper Worksheets: built orders list print layouts with pre-filled suggested leftovers for kitchen worksheets.<br>- Validation Guard: added real-time client validation requiring counts for Flan and Cheesecake before order submissions to prevent external dessert stock gaps.<br>- Templates & QuickBooks Sync: unified liquids templates using Lynwood as master store, and automated daily/weekly sync rules from QuickBooks.<br>- NWS Weather API: re-coded weather integrations using NWS for 100% uptime, logging 14-day history to adapt prep pace dynamically to weather events.<br>- Sandbox Isolation: segregated local test tokens from production Supabase configurations to prevent billing service blockages.<br>- UX/UI Layouts: removed redundant sub-menus, solved nested double scrollbars in tablet screens, and built a top quick-access actions bar.<br>- Navigation Cleanup: restructured sidebar links, collapsed groups, renamed modules, and added Info Modals for user onboarding."
        },
        {
            "date": "03-Jul-2026",
            "time": "8:00 AM - 10:00 AM",
            "hours": 2,
            "badges": [
                "Inventario"
            ],
            "descEs": "- **Validación de Postres**: Refinamiento técnico de las reglas de validación de Flan y Cheesecake para asegurar que se bloquee el envío únicamente en las órdenes del tipo diario (`daily`) y no afecte los pedidos de líquidos semanales.",
            "descEn": "- Dessert Validation: refined validation boundaries for Flan and Cheesecake to restrict checks exclusively to daily orders without blocking weekly liquid orders."
        },
        {
            "date": "04-Jul-2026",
            "time": "1:30 PM - 8:00 PM",
            "hours": 6.5,
            "badges": [
                "Planificador",
                "Inventario",
                "QuickBooks"
            ],
            "descEs": "- **Planificador (Conexión Gmail)**: Solución al error que dejaba a los mánagers atrapados en el modal de infracciones de turnos si no tenían Gmail vinculado. Se habilitaron botones bilingües interactivos de 'Cerrar' y 'Vincular Gmail' dentro del modal, atrapando con gracia los errores `GMAIL_AUTH_FAILED` y `GMAIL_NOT_CONNECTED`.<br>- **Planificador**: Adición de botón con gradiente animado llamativo 'Vincular Gmail' en la cabecera del planificador para que gerentes como Alfonso vinculen su OAuth de Google fácilmente.<br>- **Inventario (Órdenes Extraordinarias)**: Desarrollo de soporte para agregar artículos extraordinarios o de emergencia (no presentes en la plantilla regular) a la orden diaria.<br>- **QuickBooks (Catálogos)**: Sincronización de plantillas desde \"QBO Recurring Transactions\" en lugar de estimados recientes, evitando que los pedidos especiales o modificados contaminen la plantilla base de la tienda.",
            "descEn": "- Planner (Gmail Connect): resolved critical loop trapping managers in the violation modal when Gmail was disconnected. Coded close buttons and connect shortcut triggers, handling `GMAIL_AUTH_FAILED` gracefully.<br>- Planner UI: created animated visual button in planner header to guide managers (like Alfonso) to complete Google OAuth setup.<br>- Inventory (Emergency Items): added support for inserting extraordinary/emergency products into daily orders.<br>- QuickBooks Template Sync: refactored sync rules to fetch catalog configurations from QuickBooks Recurring Transactions to prevent catalog pollution from past estimates."
        },
        {
            "date": "07-Jul-2026",
            "time": "6:00 PM - 8:00 PM",
            "hours": 2,
            "badges": [
                "Inventario"
            ],
            "descEs": "- **Historial y Sobrantes**: Creación de las pestañas **Historial** y **Sobrantes** con un selector y navegador de semanas unificado.<br>- **Historial**: Tablero para auditar y buscar órdenes anteriores por fecha con cargador optimizado a través de Server Actions (`fetchHistoryData`) que evitan restricciones RLS de Supabase.<br>- **Sobrantes**: Matriz interactiva de artículos contra días de la semana para auditar el desperdicio y sobrantes históricos de la tienda.",
            "descEn": "- History & Leftovers Tabs: built History and Leftovers tabs with shared week navigator state.<br>- History tab: created list to search past orders using server action (`fetchHistoryData`) to bypass database RLS constraints.<br>- Leftovers tab: programmed interactive leftovers matrix (items x days of the week) to monitor waste logs."
        },
        {
            "date": "08-Jul-2026",
            "time": "10:00 AM - 3:05 PM",
            "hours": 8,
            "badges": [
                "Inventario",
                "QuickBooks",
                "Base de Datos"
            ],
            "descEs": "- **Crisis de Producción QuickBooks OAuth** (10:00 AM - 11:30 AM): Los tokens de autenticación de QuickBooks expiraron en producción durante horario laboral, bloqueando la generación de PDFs de estimados. Diagnóstico profundo del flujo de refresh tokens, ejecución de script interactivo de re-autenticación, descubrimiento de credenciales DIFERENTES entre Vercel (producción) y localhost (sandbox) como causa raíz del fallo persistente. Actualización del callback en Vercel para mostrar errores verbosos detallados en lugar del genérico 'Authentication Failed'.<br>- **5 Bugs Críticos en Orden Diaria** (11:30 AM - 1:15 PM): (1) Corrección de `saveOrderDraft` para que no resetee el estado a 'draft' cuando ya existe un Estimate en QuickBooks. (2-3) Las funciones de edición y reenvío de pedidos ahora respetan la fecha `week_start_date` de la orden original en lugar de la semana activa del navegador. (4) Cantidades negativas imposibles: se forzó un mínimo de 0 cuando el sobrante excede el PAR. (5) Eliminación del viejo sincronizador de plantillas basado en Estimates recientes que marcaba incorrectamente artículos como descontinuados.<br>- **Día Laboral 6:00 AM**: Creación de `getBusinessMonday()` para resolver el problema de que entre medianoche y las 5:59 AM los mánagers no podían capturar sobrantes ni generar órdenes porque el sistema saltaba a la semana siguiente prematuramente.<br>- **Bugs Menores**: (M1) Conversión de `storeId` a string para evitar incompatibilidades entre tipo texto y numérico en la base de datos. (M4) Limpieza automática de listeners de mensajes del popup de QuickBooks si el mánager lo cierra. (M5) Preservación de artículos extraordinarios/emergencia al guardar bases de PAR diario.<br>- **Migración Masiva de Datos - Sobrantes para 14 Tiendas** (2:30 PM - 3:05 PM): Importación masiva de datos históricos de sobrantes desde archivos Excel hacia la base de datos de Supabase para 14 sucursales (Rialto, West Covina, Azusa, Broadway, Central, Slauson, Hollywood, Santa Ana, La Puente, Huntington Park, Norwalk, Bell, Lynwood, Compton). Resolución de bug crítico de precedencia donde Buche, Carnitas y Chorizo se mapeaban erróneamente a items de Bodega en lugar de items de Restaurante. Corrección del mapeo de Onion/Cilantro Mixta para separar correctamente el producto a granel (1/4 lb) del de porción individual (1 oz).<br>- **Investigación de Items Faltantes en QB Líquidos**: Búsqueda en QuickBooks Recurring Transactions para identificar que la plantilla correcta 'Orden liquidos presiona Use' tiene 31 items, mientras que la vieja 'Bodega Liquidos' solo tiene 25. Restricción del filtro de sincronización para que solo tome la plantilla correcta y no contamine las órdenes diarias de comida.",
            "descEn": "- **QuickBooks OAuth Production Crisis** (10:00 AM - 11:30 AM): QuickBooks auth tokens expired in production during business hours, blocking estimate PDF generation. Deep investigation of refresh token flow, interactive re-auth script execution, discovery of DIFFERENT credentials between Vercel (production) and localhost (sandbox) as root cause of persistent failure. Updated Vercel callback with verbose error diagnostics.<br>- **5 Critical Bugs in Daily Orders** (11:30 AM - 1:15 PM): (1) Fixed `saveOrderDraft` to not reset status to 'draft' for orders with existing QB estimates. (2-3) Edit and resubmit functions now use order's original `week_start_date` instead of active browser week. (4) Clamped calculated_qty to 0 minimum when leftovers exceed PAR. (5) Removed legacy template sync that incorrectly marked items as discontinued.<br>- **Business Day Boundary 6AM**: Created `getBusinessMonday()` helper so managers can capture leftovers and generate orders between midnight and 5:59 AM without the system jumping to the next week prematurely.<br>- **Minor Bugs**: (M1) String conversion for storeId on leftover updates. (M4) Auto-cleanup of QB popup message listeners. (M5) Preserve extraordinary items when saving daily PAR bases.<br>- **Mass Data Migration - Leftovers for 14 Stores** (2:30 PM - 3:05 PM): Bulk import of historical leftover data from Excel files to Supabase for 14 locations. Fixed critical precedence bug where Buche, Carnitas, Chorizo matched Bodega items instead of Restaurant items. Fixed Onion/Cilantro Mixta mapping to correctly separate bulk product (1/4 lb) from portion bag (1 oz).<br>- **Missing Items Investigation in QB Liquids**: Searched QuickBooks Recurring Transactions to identify that correct template 'Orden liquidos presiona Use' has 31 items vs old 'Bodega Liquidos' with only 25. Restricted sync filter to use correct template exclusively."
        },
        {
            "date": "09-Jul-2026",
            "time": "9:00 AM - 9:30 AM",
            "hours": 1.5,
            "badges": [
                "Inventario",
                "QuickBooks"
            ],
            "descEs": "- **Orden de Uniformes (Nuevo Tipo de Pedido)**: Implementación completa de un tercer tipo de orden ('uniformes') en el módulo de pedidos de inventario. Detección de la plantilla 'Orden UNIFORMES presiona Use' en QuickBooks Recurring Transactions, replicación a las 15 tiendas (43 artículos cada una), botón de acceso con título dinámico, prefijo [UNIFORMES] en memo de QB, etiqueta en hoja de impresión, y claves i18n en español/inglés.<br>- **Corrección de Items Incorrectos**: El supervisor reportó que los items no correspondían a la orden de uniformes correcta. Se identificó y seleccionó la plantilla correcta separándola de plantillas con nombres similares.<br>- **Arquitectura de Plantillas Compartidas**: Se documentó y codificó la lógica de que líquidos y uniformes usan UN solo template maestro para todas las tiendas (a diferencia de la orden diaria que tiene un template por tienda), rellenando dinámicamente campos de identificación como tienda, correo y domicilio.",
            "descEn": "- **Uniforms Order Type (New)**: Full implementation of a third order type ('uniforms') in the inventory orders module. Detected 'Orden UNIFORMES presiona Use' template from QuickBooks Recurring Transactions, replicated to all 15 stores (43 items each), dynamic title button, [UNIFORMES] prefix in QB memo, print sheet label, and ES/EN i18n keys.<br>- **Wrong Items Fix**: Supervisor reported mismatched items — identified and selected the correct template, separating it from similarly-named ones.<br>- **Shared Template Architecture**: Documented and coded logic where liquids and uniforms use ONE master template for all stores (unlike daily orders with per-store templates), dynamically populating store identification fields like email and address."
        },
        {
            "date": "10-Jul-2026",
            "time": "3:00 PM - 9:25 PM",
            "hours": 10,
            "badges": [
                "Actividades",
                "Caja Fuerte",
                "Inventario"
            ],
            "descEs": "- **Visita Presencial a Sucursal Slauson** (6:00 PM - 9:30 PM): Visita de seguimiento en sitio para verificar el estado y funcionamiento de las tabletas piloto de cocina instaladas en la sucursal de Slauson. Revisión de conectividad, carga de módulos del sistema, y validación de la experiencia de usuario con el personal de la tienda.<br>- **Guía de Uso de Uniformes**: Actualización del modal informativo de la página de órdenes para incluir la nueva sección de Uniformes (color violeta) con instrucciones paso a paso.<br>- **Tablero de Actividades - Filtro por Tienda**: Corrección del bug donde la lista de reasignación de empleados mostraba nombres de TODAS las tiendas (ej. Roberto Velásquez aparecía en Slauson sin trabajar allí). Ahora solo muestra empleados del roster de la tienda seleccionada para ese día.<br>- **Tablero de Actividades - ACTIVIDADES EXTRA 1-6**: Renombramiento de 'CIERRE 1' y 'CIERRE 2' a 'ACTIVIDADES EXTRA 1' y '2', y adición de 4 slots nuevos (EXTRA 3, 4, 5, 6) en la sección de Cocina para asignar tareas adicionales.<br>- **Módulo de Caja Fuerte (NUEVO)**: Desarrollo completo del módulo de conteo de caja fuerte para las sucursales. Incluye: formulario para registrar conteos de efectivo con desglose por denominación ($100, $50, $20, $10, $5, $1, monedas), cálculo automático del total, historial de conteos por tienda y fecha, APIs de creación/edición/eliminación, migración SQL para la tabla `safe_counts`, tipos TypeScript completos, entrada en el sidebar de navegación, y soporte bilingüe completo (116 claves i18n).<br>- **Tablero de Actividades - Filtro por Día de la Semana**: Corrección del bug donde actividades exclusivas de ciertos días (ej. 'LAVAR FREIDORAS' solo viernes) aparecían en otros días. Se replicó la lógica de frecuencia del backend de notificaciones al frontend.<br>- **Copiar Semana Anterior (por Día/Turno)**: Botón premium que permite clonar las asignaciones de actividades del mismo día y turno de la semana anterior, descartando las asignaciones actuales del turno activo y reemplazándolas con las clonadas.<br>- **Clonar Semana Completa**: Botón que copia TODAS las asignaciones (ambos turnos, 7 días) de la semana anterior de una sola vez, guardando directamente a la base de datos en una transacción única. Incluye diálogo de confirmación antes de ejecutar.<br>- **Auditoría Profunda de Actividades**: (1) Filtro de `store_model` (Regular vs Drive-Thru) para paridad con el backend de notificaciones. (2) Eliminación de código muerto en operaciones de clonado. (3) Reemplazo de 5 strings hardcodeados en español por llamadas `t()` de i18n. (4) Adición de 4 claves i18n nuevas. (5) Hook `useLanguage()` en componente BoardSlot.",
            "descEn": "- **On-Site Visit to Slauson Store** (6:00 PM - 9:30 PM): Follow-up field visit to verify the status and operation of the pilot kitchen tablets installed at the Slauson location. Reviewed connectivity, system module loading, and validated user experience with store staff.<br>- **Uniforms Usage Guide**: Updated orders page info modal to include new Uniforms section (purple color) with step-by-step instructions.<br>- **Activities Board - Store Filter**: Fixed bug where employee reassignment list showed names from ALL stores (e.g. Roberto Velásquez appeared at Slauson without working there). Now only shows employees from selected store's roster for that day.<br>- **Activities Board - EXTRA ACTIVITIES 1-6**: Renamed 'CIERRE 1/2' to 'ACTIVIDADES EXTRA 1/2' and added 4 new slots (EXTRA 3, 4, 5, 6) in the Kitchen section for additional task assignments.<br>- **Safe Counts Module (NEW)**: Complete development of cash safe counting module for stores. Includes: cash count entry form with denomination breakdown ($100, $50, $20, $10, $5, $1, coins), automatic total calculation, count history by store and date, create/edit/delete APIs, SQL migration for `safe_counts` table, full TypeScript types, sidebar navigation entry, and complete bilingual support (116 i18n keys).<br>- **Activities Board - Weekday Frequency Filter**: Fixed bug where day-exclusive activities (e.g. 'WASH FRYERS' Friday-only) appeared on other days. Replicated notification backend frequency logic to frontend.<br>- **Copy Previous Week (by Day/Shift)**: Premium button that clones activity assignments from the same day and shift of the previous week, discarding current active shift assignments and replacing with cloned ones.<br>- **Clone Full Week**: Button that copies ALL assignments (both shifts, 7 days) of the previous week at once, saving directly to database in a single transaction. Includes confirmation dialog before execution.<br>- **Deep Activities Audit**: (1) `store_model` filter (Regular vs Drive-Thru) for parity with notifications backend. (2) Dead code removal in clone operations. (3) Replaced 5 hardcoded Spanish strings with `t()` i18n calls. (4) Added 4 new i18n keys. (5) `useLanguage()` hook in BoardSlot component."
        },
        {
            "date": "11-Jul-2026",
            "time": "10:19 AM - 1:46 PM",
            "hours": 5.5,
            "badges": [
                "Inventario",
                "QuickBooks"
            ],
            "descEs": "- **Rediseño Completo de Pestaña Sobrantes v2**: Nuevo layout con semáforo de colores (verde/ámbar/rojo) basado en el porcentaje sobrante vs PAR. PAR como etiqueta sutil, sobrante como número protágono grande en negrita, y porcentaje como pastilla coloreada. Fondo completo de celda con color de semáforo. Leyenda como pastillas limpias en vez de tarjetas voluminosas.<br>- **PAR Ideal Inline**: Movimiento del PAR Ideal de tabla separada a columnas violeta integradas directamente al lado derecho de la cuadrícula de configuración semanal (7 columnas para diario, 1 para líquidos/uniformes).<br>- **Bug Crítico: PAR Ideal excluía semana actual**: La función `recalculateParIdeal` usaba filtro `lt()` que excluía los datos de cierre de la semana actual del cálculo. Cambiado a `lte()`. Además, `executeWeekRollover` clonaba el PAR ANTES de recalcular — ahora recalcula PRIMERO y luego copia el PAR Ideal actualizado.<br>- **Ventana de cálculo 8→4 semanas**: Reducción de la ventana de promedio del PAR Ideal de 8 a 4 semanas para reaccionar más rápido a patrones recientes (ej. 2 Horchatas sobrantes el viernes ahora pesa 25% en vez de 12.5%).<br>- **Ampliación de Umbrales PAR**: L-V: riesgo &lt;20% (era &lt;10%), ideal 20-60% (era 10-50%), exceso ≥60% (era ≥50%). Sáb: riesgo &lt;15%, ideal 15-40%, exceso ≥40%. Filosofía: quedarse sin producto fuerza al gerente a ir a otra tienda lejana, lo cual es mucho más costoso que tener sobrante.<br>- **Auditoría Integral del Módulo**: Eliminación de función muerta `getOrderHistory`. Corrección de anti-patrón `document.getElementById` de React para copiar PAR. Implementación de soporte bilingüe completo (50+ claves i18n) para alertas, confirmaciones, flujos de QuickBooks y modales de guía. Limpieza de dependencia de Supabase en React.<br>- **Reglas de Redondeo Especiales**: Implementación de `ceiling_60` para Papelito Para Torta (charolas de 60 paquetes). Redondeo automático de ajustes manuales de PAR según reglas del item. Aplicación de reglas de redondeo durante el cálculo de promedios de PAR Ideal en el rollover semanal.<br>- **Limpieza dinámica de datos legacy**: Aplicación automática de reglas de redondeo sobre el PAR Ideal y bases semanales al cargarlos de la base de datos, reparando registros viejos que no cumplían las reglas.<br>- **Boost de Emergencia PAR (+10/15/20/25%)**: Dropdown en la pestaña de orden diaria que permite subir temporalmente el PAR de TODOS los productos para días especiales o de alta demanda. Las cantidades boosteadas respetan las reglas de redondeo y muestran una pastilla visual (+X%) bajo los valores de PAR en la tabla.",
            "descEn": "- **Sobrantes Tab Redesign v2**: New traffic-light layout (green/amber/red) based on leftover % vs PAR. PAR as subtle label, leftover as bold protagonist number, percentage as colored pill badge. Full cell background with traffic-light color. Clean pill legend.<br>- **PAR Ideal Inline**: Moved PAR Ideal from separate table to violet inline columns on the right side of weekly config grid.<br>- **Critical Bug: PAR Ideal excluded current week**: `recalculateParIdeal` used `lt()` filter excluding closing week data. Changed to `lte()`. Also `executeWeekRollover` now recalculates FIRST then copies updated PAR Ideal.<br>- **Calculation window 8→4 weeks**: Faster reaction to recent leftover patterns (e.g. 2 Horchata leftovers on Friday now weighs 25% instead of 12.5%).<br>- **PAR Threshold Widening**: M-F: risk &lt;20% (was &lt;10%), ideal 20-60% (was 10-50%), excess ≥60% (was ≥50%). Sat: risk &lt;15%, ideal 15-40%, excess ≥40%. Running out forces manager to drive to distant store for restock.<br>- **Comprehensive Module Audit**: Dead `getOrderHistory` removal. React anti-pattern fix for PAR copy. Full i18n (50+ keys) for alerts, confirmations, QB flows, help modals. Supabase dependency cleanup.<br>- **Special Rounding Rules**: `ceiling_60` for Papelito Para Torta (60-pack trays). Auto-round manual PAR adjustments. Enforce rounding during PAR Ideal rollover averages.<br>- **Dynamic Legacy Data Cleanup**: Auto-apply rounding rules on fetched PAR Ideal and weekly bases to repair old database records.<br>- **Emergency PAR Boost (+10/15/20/25%)**: Dropdown in daily order tab to temporarily increase PAR for ALL products on high-demand days. Boosted values respect rounding rules and show visual (+X%) pill badge."
        },
        {
            "date": "14-Jul-2026",
            "time": "10:00 AM - 7:30 PM",
            "hours": 9.5,
            "badges": [
                "Tiendas",
                "Google Maps",
                "Base de Datos",
                "i18n"
            ],
            "descEs": "- **Módulo de Tiendas (Integración Toast)**: Refactorización de `lib/toast-api.ts` y APIs de sincronización de empleados para enlazar dinámicamente las sucursales basadas en bases de datos en lugar de mapeos estáticos.<br>- **Buscador de Direcciones (Geocoding)**: Creación de API segura en el backend que traduce direcciones en coordenadas geográficas usando Google Maps Geocoding (con respaldo automático a Nominatim/OSM).<br>- **Google Maps con Satélite**: Migración completa de Leaflet a un componente nativo de **Google Maps** (`StoreMapPicker`), configurando la recuperación segura de la clave del servidor, la opción de arrastre de marcador (pin), visualización de pantalla completa, visualización de etiquetas de comercios y selector interactivo de vista tradicional/satélite.<br>- **Configuración en Vercel**: Vinculación de la base de código local con el proyecto de Vercel `tacosgavilan` e inyección de las variables de entorno `GOOGLE_MAPS_API_KEY` y `GOOGLE_MAPS_KEY` en todos los ambientes (Production, Preview, Development) para despliegues sin interrupciones.<br>- **Solución de Hydration Mismatch**: Corrección del error de desajuste de hidratación de Next.js al cargar el idioma preferido en `LanguageProvider` moviendo la lógica de `localStorage` a un hook `useEffect` del lado del cliente.<br>- **Resolución de Error de Base de Datos (PATCH)**: Eliminación del campo inexistente `hours` del payload de guardado de tiendas en `app/tiendas/page.tsx`, solucionando el error `PGRST204` de PostgREST al guardar sucursales.",
            "descEn": "- **Stores Module (Toast Integration)**: Refactored `lib/toast-api.ts` and employee sync endpoints to dynamically connect store locations via database queries instead of static lists.<br>- **Backend Geocoding**: Created a secure backend API endpoint converting addresses to geographic coordinates using Google Maps Geocoding with automatic Nominatim fallback.<br>- **Google Maps & Satellite View**: Replaced Leaflet with a native **Google Maps** view (`StoreMapPicker`), implementing secure key fetching, draggable pins, fullscreen controls, POI/business labels, and Roadmap/Satellite switching.<br>- **Vercel Deploy Configuration**: Linked the project and uploaded `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_KEY` environments to all Vercel stages (Production, Preview, Development) for smooth deployment builds.<br>- **Hydration Mismatch Fix**: Resolved Next.js client/server hydration errors in `LanguageProvider` by shifting `localStorage` reading logic into a client-side `useEffect` hook.<br>- **Supabase PATCH Error Fix**: Removed nonexistent `hours` field from the store save payload, fixing Supabase `PGRST204` errors when editing location metadata."
        },
        {
            "date": "20-Jul-2026",
            "time": "12:45 PM - 2:45 PM",
            "hours": 2,
            "badges": [
                "Planificador",
                "i18n"
            ],
            "descEs": "- **Envío de Horario Semanal Completo al Modificar Turnos**: Refactorización de la API de publicación de horarios (`/api/notifications/publish-schedule`) para que, al realizar un ajuste o modificación de un turno después de haber publicado la semana, se envíe el horario semanal completo y actualizado de los empleados afectados en lugar de solamente enviar la modificación aislada del turno editado. Esto evita confusiones entre el personal sobre sus demás días asignados.",
            "descEn": "- **Full Weekly Schedule Delivery on Edit**: Refactored the schedule publishing API (`/api/notifications/publish-schedule`) so that when a shift is edited or adjusted post-publication, affected employees receive their entire updated weekly schedule instead of only the isolated edited shift. This avoids confusion regarding other scheduled days."
        },
        {
            "date": "21-Jul-2026",
            "time": "2:58 PM - 9:23 PM",
            "hours": 6.5,
            "badges": [
                "Actividades",
                "Navegación",
                "Asistente IA"
            ],
            "descEs": "- **Eliminación Segura de Módulos Roles y Procedimientos**: Análisis exhaustivo de dependencias cruzadas (15+ búsquedas de grep, 3 subagentes de investigación en paralelo) para verificar que el Planificador, Breaks, Horarios, Auto-Schedule, Notificaciones, Checklists y Cron Jobs de Vercel NO dependan de los módulos Roles ni Procedimientos antes de proceder a eliminarlos.<br>- **Eliminación de 3,797 Líneas de Código Obsoleto**: Borrado de `app/roles/page.tsx` (176 KB), `app/procedimientos/page.tsx`, y `app/api/roles/templates/route.ts`. Conservación segura de las API routes compartidas (`/api/roles`, `/api/roles/activities`, `/api/procedimientos`) y del componente `ProceduresTimeline` que el módulo Actividades sigue usando internamente.<br>- **Actualización del Menú de Navegación**: Eliminación de las entradas 'Procedimientos' y 'Roles' del sidebar (`AppSidebar.tsx`). Actualización de la barra de navegación inferior para móviles (`BottomTabBar.tsx`) redirigiendo de '/roles' a '/actividades' con label bilingüe.<br>- **Sincronización del Asistente IA**: Actualización del prompt del asistente de soporte (`support-chat/route.ts`) para reflejar que Actividades es ahora el módulo unificado que reemplaza Roles y Procedimientos, incluyendo la descripción completa de sus sub-módulos (Catálogo, Configurar Posiciones, Asignación Diaria, Tablero, Checklists y Reportes).<br>- **Verificación de TypeScript**: 0 errores confirmados con `tsc --noEmit` antes del commit.",
            "descEn": "- **Safe Removal of Roles & Procedures Modules**: Exhaustive cross-dependency analysis (15+ grep searches, 3 parallel research subagents) verifying that Planner, Breaks, Schedules, Auto-Schedule, Notifications, Checklists, and Vercel Cron Jobs do NOT depend on the Roles or Procedures modules before deletion.<br>- **3,797 Lines of Legacy Code Removed**: Deleted `app/roles/page.tsx` (176 KB), `app/procedimientos/page.tsx`, and `app/api/roles/templates/route.ts`. Safely preserved shared API routes (`/api/roles`, `/api/roles/activities`, `/api/procedimientos`) and the `ProceduresTimeline` component still used internally by the Actividades module.<br>- **Navigation Menu Update**: Removed 'Procedimientos' and 'Roles' entries from the sidebar (`AppSidebar.tsx`). Updated mobile bottom tab bar (`BottomTabBar.tsx`) redirecting '/roles' to '/actividades' with bilingual label.<br>- **AI Assistant Sync**: Updated the support chat assistant prompt (`support-chat/route.ts`) to reflect Actividades as the unified module replacing Roles and Procedures, including full description of its sub-modules (Catalog, Configure Positions, Daily Assignment, Board, Checklists, and Reports).<br>- **TypeScript Verification**: 0 errors confirmed via `tsc --noEmit` before commit."
        },
        {
            "date": "24-Jul-2026",
            "time": "3:07 PM - 11:30 PM",
            "hours": 8.5,
            "badges": [
                "Usuarios",
                "Toast",
                "Base de Datos",
                "i18n"
            ],
            "descEs": "- **Módulo de Usuarios - Promociones y Sincronización Directa Toast**: Implementación del flujo de mapeo directo de roles Toast hacia la tabla de usuarios del sistema (`users`).<br>- **Escalera de Mando (Niveles 1-6)**: Configuración de reglas donde solo los niveles 3 (Asistente), 4 (Manager), 5 (Supervisor) y 6 (Admin) generan cuenta en el sistema, mientras que los niveles 1 (Cocinero/Cajera) y 2 (Shift Leader) se alimentan directamente de Toast para el módulo Planificador.<br>- **Detección Automática de Promociones y Degradaciones**: Creación del endpoint `/api/admin/users/sync-toast` (GET/POST) que analiza empleados en `toast_employees`, identifica nuevos puestos de Manager/Asistente y marca usuarios inactivos o degradados en Toast.<br>- **Resolución de Conflictos de Sucursal (Managers vs Múltiples Asistentes)**: Restricción de la detección de conflicto de desactivación únicamente para Managers (1 por tienda). Se habilitó soporte para **múltiples Asistentes activos por sucursal (turno AM y turno PM)** en `UserModal` y `sync-toast/route.ts`, evitando desactivaciones accidentales entre asistentes como Cruz Castillo en Lynwood.<br>- **Autocompletado de Usuarios desde Toast (Planificador)**: Integración en `UserModal` del selector '¿El usuario ya existe en Toast (Planificador)?' que autocompleta nombre, email, teléfono, rol y sucursal de forma automática.<br>- **Normalización Robusta de Puestos Toast**: Implementación de `normalizeJobTitle()` que elimina puntos, espacios y mayúsculas para manejar variaciones como 'Asst Manager' vs 'Asst. Manager' vs 'ASST MANAGER'. Bug fix: 14 de 15 tiendas usaban 'Asst Manager' sin punto pero el código anterior solo buscaba 'Asst. Manager'.<br>- **Triple Matching (toast_guid > Email > Nombre+Tienda)**: Estrategia de vinculación en 3 niveles donde el GUID permanente tiene prioridad, seguido de coincidencia por correo y como respaldo nombre normalizado + tienda.<br>- **Columna `toast_guid` en tabla `users`**: Migración DDL para agregar columna UNIQUE con índice. Permite vinculación permanente e inmutable entre empleados de Toast y cuentas del sistema, eliminando dependencia de correo electrónico.<br>- **Migración de Datos Masiva**: Vinculación automática de 38 de 44 usuarios existentes (managers y asistentes) con su toast_guid de Toast, incluyendo 5 casos especiales de nombres distintos confirmados por la gerencia (Cael→Calel, Flores→Romero, etc.).",
            "descEn": "- **Users Module - Direct Toast Promotion & Role Sync**: Implemented direct mapping from Toast job roles to system user profiles (`users` table).<br>- **Command Ladder (Levels 1-6)**: Enforced business rule where only levels 3 (Assistant), 4 (Manager), 5 (Supervisor), and 6 (Admin) get portal credentials, while levels 1 (Cook/Cashier) and 2 (Shift Leader) are fed from Toast for the Planner module.<br>- **Automatic Promotion & Demotion Detection**: Built `/api/admin/users/sync-toast` (GET/POST) endpoint detecting Toast Manager/Assistant promotions and flagging demoted or deleted employees.<br>- **Store-Level Conflict Resolution (Managers vs Multi-Assistants)**: Restricted conflict auto-deactivation checks exclusively to Managers (1 per store). Added full support for **multiple active Assistants per store (AM Shift & PM Shift)** in `UserModal` and `sync-toast/route.ts`, preventing accidental deactivations between co-assistants (such as Cruz Castillo in Lynwood).<br>- **Toast Employee Auto-Fill**: Integrated 'Does user exist in Toast (Planner)?' selector into `UserModal`, auto-populating full name, email, phone, role, and store.<br>- **Robust Job Title Normalization**: Implemented `normalizeJobTitle()` to strip punctuation, collapse whitespace, and lowercase all titles. Fixed bug where 14 of 15 stores used 'Asst Manager' (no period) but old code only matched 'Asst. Manager'.<br>- **Triple Matching Strategy (toast_guid > Email > Name+Store)**: 3-tier user linking where permanent GUID takes priority, followed by email match, and finally normalized name + store fuzzy match as fallback.<br>- **`toast_guid` Column in `users` Table**: DDL migration adding UNIQUE column with index for permanent, immutable linkage between Toast employees and system user accounts.<br>- **Bulk Data Migration**: Auto-linked 38 of 44 active managers/assistants to their Toast GUID, including 5 special confirmed name-variation cases (Cael→Calel, Flores→Romero, etc.)."
        },
        {
            "date": "26-Jul-2026",
            "time": "11:15 AM - 2:45 PM",
            "hours": 3.5,
            "badges": [
                "Inventario",
                "QuickBooks",
                "Base de Datos"
            ],
            "descEs": "- **Auditoría e Investigación del Desplome de Food Cost**: Análisis profundo que identificó la caída del Food Cost a 26.8% en todas las sucursales el 25 de julio. Diagnóstico del bug de QuickBooks Sync que redujo a la mitad los precios de carnes clave (Pollo, Pastor, Lengua, Cabeza) al hacer fallback a `PurchaseCost` debido a `UnitPrice = 0` en QBO, y que evadió la Smart Price Protection por un bug de comparación en el límite del 50.0% exacto.<br>- **Corrección de Smart Price Protection**: Modificación de la frontera de la validación (`dropPercent >= maxDrop`) para bloquear caídas de precio exactamente iguales al límite configurado en `app/api/inventory/sync-quickbooks/route.ts`.<br>- **Restauración y Recálculo Automatizado de Precios**: Desarrollo y ejecución de script para revertir los precios erróneos del 24 de julio, restaurar los costos correctos en `inventory_items` e `inventory_price_history`, y regenerar la caché de costos diarios (`food_cost_daily_cache`) para el 24, 25 y 26 de julio, normalizando el food cost de ayer a su valor real de ~32.11%.<br>- **Robustez de la Caché PMIX contra Pedidos Futuros**: Implementación de lógica autosanable en `lib/toast-pmix.ts` que ignora la caché y fuerza la descarga en vivo si `updated_at::date < business_date`, protegiendo la base de datos de datos incompletos por pedidos de catering pre-programados. Actualización de timestamps en `app/api/cron/sync-pmix/route.ts` y `scripts/rebuild-pmix.ts`.",
            "descEn": "- **Food Cost Drop Audit**: Conducted deep investigation on the 26.8% food cost drop for July 25. Identified QuickBooks Sync bug that halved key meat prices (Chicken, Pastor, Tongue, Head) due to a fallback to `PurchaseCost` when `UnitPrice = 0` in QBO. The drop was not blocked because of an boundary condition bug in Smart Price Protection (50.0% exact drop).<br>- **Smart Price Protection Fix**: Modified the check boundary (`dropPercent >= maxDrop`) in `app/api/inventory/sync-quickbooks/route.ts` to block drop percentages exactly matching the threshold.<br>- **Database Price Restoration & Recalculation**: Programmed and executed database repair script that deleted wrong history entries, restored correct prices in `inventory_items` and `inventory_price_history`, and rebuilt daily food cost cache for July 24, 25, and 26 (restoring July 25 food cost to ~32.11%).<br>- **Self-Healing PMIX Cache**: Coded defensive caching logic in `lib/toast-pmix.ts` to bypass and force live Toast fetch if `updated_at::date < business_date` (avoids stale/incomplete records from pre-scheduled catering orders). Implemented timestamps in `app/api/cron/sync-pmix/route.ts` and `scripts/rebuild-pmix.ts`."
        },
        {
            "date": "26-Jul-2026",
            "time": "3:00 PM - 5:00 PM",
            "hours": 2,
            "badges": [
                "Inventario",
                "QuickBooks",
                "Arquitectura"
            ],
            "descEs": "- **Auto-Sync de Empaques desde QuickBooks**: Implementación de sincronización automática de tamaños de empaque (bolsas, cajas, cubetas) leyendo el campo Description de los Recurring Transactions de QuickBooks (ej: \"(Bag of 5 lbs)\"). El sistema ahora parsea automáticamente las descripciones para extraer `quantity_per_unit`, `order_unit_description` y `unit_measure`.<br>- **Pre-Scan Inteligente**: Nuevo PASO 0 en el sync de QB que lee todas las RecurringTransactions ANTES del sync de precios para construir un mapa de empaques. Esto permite que el Smart Price Protection compare costo-por-libra (en vez de costo-por-bolsa) cuando detecta un cambio de empaque legítimo, permitiendo cambios que antes se bloqueaban erróneamente.<br>- **Cascada Automática de PAR**: Cuando el empaque cambia (ej: bolsa de 10 lbs a 5 lbs), el sistema automáticamente multiplica el PAR de TODAS las tiendas por el factor inverso (×2.0) para mantener la misma cantidad total de producto. Aplica tanto a `inventory_weekly_bases` como a `inventory_par_ideal`.<br>- **Invalidación de Caché Automática**: Cambios de precio o empaque ahora borran automáticamente la caché de `food_cost_daily_cache` de los últimos 3 días, forzando recálculo inmediato. También se agregó invalidación al editar recetas en `recipes/route.ts`.<br>- **Documentación del Asistente IA**: Actualización del prompt del asistente de soporte y de las herramientas de chat para reflejar la nueva funcionalidad.",
            "descEn": "- **Packaging Auto-Sync from QuickBooks**: Built automatic packaging size synchronization by reading the Description field from QB Recurring Transactions (e.g., \"(Bag of 5 lbs)\"). The system now automatically parses descriptions to extract `quantity_per_unit`, `order_unit_description` and `unit_measure`.<br>- **Intelligent Pre-Scan**: New STEP 0 in QB sync reads all RecurringTransactions BEFORE the price sync to build a packaging map. This enables Smart Price Protection to compare cost-per-pound (instead of cost-per-bag) when it detects a legitimate packaging change, allowing updates that were previously blocked erroneously.<br>- **Automatic PAR Cascade**: When packaging changes (e.g., bag from 10 lbs to 5 lbs), the system automatically multiplies PAR values across ALL stores by the inverse factor (×2.0) to maintain the same total product weight. Updates both `inventory_weekly_bases` and `inventory_par_ideal`.<br>- **Automatic Cache Invalidation**: Price or packaging changes now automatically clear `food_cost_daily_cache` for the last 3 days, forcing immediate recalculation. Also added cache invalidation when editing recipes in `recipes/route.ts`.<br>- **AI Assistant Documentation**: Updated support chat prompt and chat tools to reflect the new functionality."
        },
        {
            "date": "27-Jul-2026",
            "time": "7:50 AM - 9:25 AM",
            "hours": 1.5,
            "badges": [
                "Inventario",
                "Food Cost",
                "Base de Datos"
            ],
            "descEs": "- **Fix Bug Milaneza (FC 560% por 5 meses)**: Investigación profunda del spike de Food Cost al 39.7%. Identificación del root cause: `quantity_per_unit` de Milaneza estaba en 2.6 (libras del paquete) en vez de 20 (piezas por paquete). El sistema cobraba $26.43 por pieza en vez de $1.32. Corrección de inventory_items y recetas (Plato Milanesa 4→3 pza).<br>- **Fix Tortilla Nachos**: Cambio de `unit_measure` de 'oz' a 'pza' y `quantity_per_unit` de 4.5 a 1 (bolsa individual). El costo de $1.26/porción es correcto.<br>- **Scanner Profundo de 312 Recetas**: Auditoría completa de TODAS las recetas del sistema (897 líneas, 72 ingredientes). Resultado: 0 anomalías de costo activas después de las correcciones.<br>- **Reconstrucción de Caché Histórica**: Purgado y recálculo completo de 207 días de food_cost_daily_cache (Dic 31 - Jul 25) en 18 minutos. Todos los datos ahora reflejan precios y configuraciones correctas.<br>- **Sistema de Protección de 3 Capas**: (A) Validación post-save en recetas: detecta ingredientes >$15, costo total >$20, y mismatch de unidades pza↔lb. (B) Cron diario detecta items con FC >100% y los persiste en nueva tabla `food_cost_anomalies`. (C) Banner rojo en dashboard de Food Cost con botón \"Resolver\" por anomalía.<br>- **Trigger PostgreSQL de Auto-Invalidación**: Trigger `trg_invalidate_fc_cache_on_inventory_change` que dispara automáticamente al cambiar `quantity_per_unit`, `purchase_unit_cost`, o `unit_measure` en inventory_items — sin importar si el cambio viene de QuickBooks, edición manual, o script. Borra caché de los últimos 3 días.<br>- **Tabla food_cost_anomalies**: Nueva tabla en Supabase para persistir anomalías detectadas por el cron. Incluye severidad (warning/critical), estado de resolución, y fecha de detección.<br>- **API de Anomalías**: Nuevo endpoint `/api/inventory/anomalies` (GET/PATCH) para servir y resolver anomalías desde el dashboard.",
            "descEn": "- **Milaneza Bug Fix (FC 560% for 5 months)**: Deep investigation of Food Cost spike to 39.7%. Root cause: Milaneza's `quantity_per_unit` was 2.6 (bag weight in lbs) instead of 20 (pieces per bag). System charged $26.43/piece instead of $1.32. Fixed inventory_items and recipes (Plato Milanesa 4→3 pza).<br>- **Tortilla Nachos Fix**: Changed `unit_measure` from 'oz' to 'pza' and `quantity_per_unit` from 4.5 to 1 (individual bag). Cost of $1.26/serving confirmed correct.<br>- **Deep Scan of 312 Recipes**: Complete audit of ALL system recipes (897 lines, 72 ingredients). Result: 0 active cost anomalies after corrections.<br>- **Historical Cache Rebuild**: Purged and recalculated 207 days of food_cost_daily_cache (Dec 31 - Jul 25) in 18 minutes. All data now reflects correct prices and configurations.<br>- **3-Layer Protection System**: (A) Post-save recipe validation: detects ingredients >$15, total cost >$20, and unit mismatches pza↔lb. (B) Daily cron detects items with FC >100% and persists them in new `food_cost_anomalies` table. (C) Red banner on Food Cost dashboard with per-anomaly \"Resolve\" button.<br>- **PostgreSQL Auto-Invalidation Trigger**: `trg_invalidate_fc_cache_on_inventory_change` fires automatically when `quantity_per_unit`, `purchase_unit_cost`, or `unit_measure` changes in inventory_items — regardless of source (QB sync, manual edit, script). Deletes last 3 days of cache.<br>- **food_cost_anomalies Table**: New Supabase table to persist cron-detected anomalies. Includes severity (warning/critical), resolution status, and detection timestamp.<br>- **Anomalies API**: New `/api/inventory/anomalies` endpoint (GET/PATCH) to serve and resolve anomalies from the dashboard."
        },
        {
            "date": "29-Jul-2026",
            "time": "7:50 AM - 8:35 AM",
            "hours": 0.8,
            "badges": [
                "Inventario",
                "Food Cost",
                "Base de Datos"
            ],
            "descEs": "- **Fix y Regla de Negocio Queso Fresco / Queso Tortas**: Configuración precisa de `Queso Tortas/platos/Desayuno` en 20 pza por paquete (`quantity_per_unit = 20`, `unit_measure = 'pza'`). Actualización de recetas para usar 1 pza por torta y 1 pza por plato (desayunos o regulares), corrigiendo el costo de $13.12 a $0.164 por porción.<br>- **Fix y Regla de Negocio Mulitas Con Queso**: Configuración de `Mulitas Con Queso` a 12 pares/piezas por bolsa (`quantity_per_unit = 12`, `unit_measure = 'pza'`). Cada bolsa trae 12 pares (24 tortillas), contadas como 12 unidades porque cada mulita usa 2 tortillas. Costo por mulita corregido de $3.76 a $0.313, bajando el Food Cost de Mulita Asada de 97.6% a 25.6%.<br>- **Fix y Regla de Negocio Tortilla Nachos / Chips**: Vinculación de `Tortilla Nachos` como la bolsa individual de chips (`quantity_per_unit = 1`, `unit_measure = 'pza'`). Actualización de las recetas de Chips y Super Nachos Chorizo (de 5 oz a 1 pza), corrigiendo el costo de $6.30 a $1.26 por bolsa y bajando el Food Cost de Chips del 250% al 37.2%.<br>- **Protección Inmutable vs QuickBooks Sync**: Implementación del blindaje `isPieceItem` en `app/api/inventory/sync-quickbooks/route.ts`, que impide que la sincronización de QuickBooks cambie la unidad o la relación de piezas de insumos contados por pieza (pza/unit/dz) como Milaneza, Papelito Para Torta, Mulitas, Queso y Tortilla Nachos.<br>- **Reconstrucción Completa de Caché de Julio (29 días)**: Purga y recalculación completa de los 29 días del mes de Julio para las 15 sucursales. El Food Cost del mes completo quedó perfectamente nivelado en un rango sano de 32.16% a 33.90%.",
            "descEn": "- **Queso Fresco / Queso Tortas Fix & Business Rule**: Configured `Queso Tortas/platos/Desayuno` to 20 pcs per pack (`quantity_per_unit = 20`, `unit_measure = 'pza'`). Updated recipes to use 1 pc per torta and 1 pc per plate (breakfast or regular), correcting portion cost from $13.12 to $0.164.<br>- **Mulitas Con Queso Fix & Business Rule**: Configured `Mulitas Con Queso` to 12 pairs/pieces per bag (`quantity_per_unit = 12`, `unit_measure = 'pza'`). Each bag contains 12 pairs (24 tortillas), counted as 12 units since each mulita uses 2 tortillas. Portion cost corrected from $3.76 to $0.313, reducing Mulita Asada Food Cost from 97.6% to 25.6%.<br>- **Tortilla Nachos / Chips Fix & Business Rule**: Linked `Tortilla Nachos` as individual chips bag (`quantity_per_unit = 1`, `unit_measure = 'pza'`). Updated Chips and Super Nachos Chorizo recipes (from 5 oz to 1 pza), correcting portion cost from $6.30 to $1.26 per bag and dropping Chips Food Cost from 250% to 37.2%.<br>- **Immutable Protection vs QuickBooks Sync**: Implemented `isPieceItem` guard in `sync-quickbooks/route.ts` preventing QuickBooks sync from overwriting unit measure or piece ratios for piece-count items (pza/unit/dz) like Milaneza, Papelito, Mulitas, Queso, and Tortilla Nachos.<br>- **Full July Cache Rebuild (29 days)**: Purged and recalculated all 29 days of July for all 15 stores. Full month Food Cost now cleanly leveled in healthy 32.16% to 33.90% range."
        },
        {
            "date": "31-Jul-2026",
            "time": "6:00 PM - 10:30 PM",
            "hours": 4.5,
            "badges": [
                "Preparador",
                "KDS",
                "Base de Datos"
            ],
            "descEs": "- **Reestructuración del Preparador (Cooking Pace)**: Transición de la proyección de carne de bloques de 30 minutos a bloques por periodos de tráfico pico (Peak Time Period Blocks: Apertura, Almuerzo, Pico PM) mostrando Lbs/Hr y Libras Totales por bloque. Ajuste dinámico del Periodo 1 según la hora de apertura real de la sucursal.<br>- **Contraste y UX de Parrilla**: Aumento del contraste de las tarjetas de proyección y remoción de opacidad para lectura a distancia en cocina. Cálculo de velocidad real (Lbs/Hr) usando tiempo transcurrido en el periodo activo y visualización de total de libras reales.<br>- **Selector de Historial y Calendario**: Incorporación de Date Picker interactivo para consultar proyecciones e historial de consumo de cualquier fecha pasada. Selector interactivo 30 Min vs Tramos.<br>- **Control de Sobrecocción (Máx. Charola)**: Integración de insignia visual '🔥 Máx. Charola' indicando la capacidad máxima de cada carne. Página estática autónoma `tabla_maximos_preparador.html` con CSS puro autónomo para 100% de compatibilidad al previsualizarse en iOS QuickLook/WhatsApp sin JS, accesible mediante la ruta `/inventory/preparador/tabla`.<br>- **Guía Operativa KDS**: Modal interactivo de Guía Operativa y Tabla de Máximos accesible mediante botón 'VER GUÍA' con tema monocromático de alta legibilidad para ambiente rudo de cocina.",
            "descEn": "- **Preparador (Cooking Pace) Restructuring**: Shifted meat projection displays from fixed 30-min increments to Peak Time Period Blocks showing dynamic Lbs/Hr and Total Period Lbs. Coded automatic store opening adjustments for Period 1.<br>- **Grill Screen Contrast & UX**: Boosted text contrast and removed opacity elements on projection cards for long-range reading. Built dynamic consumption REAL/hr computing elapsed hours on current active block.<br>- **Calendar Historial Picker**: Coded interactive Date Picker to query projection values and consumption logs for any historical calendar date. View switcher for 30 Min vs. Peak Periods.<br>- **Overcooking Safety Limit (Max Tray)**: Added '🔥 Máx. Charola' capacity holding limit badge to cards. Created 100% self-contained Vanilla CSS static page `tabla_maximos_preparador.html` for JS-free previews on iOS QuickLook & WhatsApp, exposed via `/inventory/preparador/tabla`.<br>- **Operational KDS Guide**: Built interactive 'VER GUÍA' modal mapping operational guidelines and maximum capacity tray charts, implementing high-contrast monochrome UI styling."
        }
    ],
    "effortSummary": [
        {
            "module": "Preparador de Carne y Cocina KDS",
            "hours": 38.5
        },
        {
            "module": "Inventario, Pedidos y Sincronización QuickBooks",
            "hours": 26
        },
        {
            "module": "Actividades, Planificador y Horarios",
            "hours": 18
        },
        {
            "module": "Clon y Sincronizador de Basecamp",
            "hours": 14
        },
        {
            "module": "Procedimientos, Fotos e Inspecciones",
            "hours": 8.5
        },
        {
            "module": "Mantenimiento General y Soporte Técnico",
            "hours": 12.8
        }
    ],
    "parallelActivities": [
        {
            "title": "Pruebas en Sucursal/Local",
            "hours": 18,
            "desc": "Pruebas en restaurante Lynwood de las vistas de tableta KDS y validación de aperturas/cierres en Caja Fuerte."
        },
        {
            "title": "Monitoreo DB y APIs",
            "hours": 6,
            "desc": "Verificación continua de sincronizaciones automáticas de QuickBooks y endpoints de Google Maps para las 15 tiendas."
        },
        {
            "title": "Planificación y Diseño",
            "hours": 4,
            "desc": "Diseño de arquitectura para el módulo de Control de Uniformes y especificaciones de TV Menús digitales."
        }
    ],
    "tasks": [
        {
            "num": 1,
            "title": "1. Inventario con reposición automática",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas analizando el consumo histórico de las últimas 4 semanas y las existencias actuales capturadas por el gerente.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas con soporte preliminar de QuickBooks.",
            "auditAugust": "<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes.",
            "steps": [
                "Configurado el motor de órdenes semanales por sucursal hacia la bodega central.",
                "Integrada la API de QuickBooks Online con guardado seguro.",
                "Pruebas y validación en sucursales operando al 100%."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas con soporte preliminar de QuickBooks."
        },
        {
            "num": 2,
            "title": "2. Inventario para Bodega y COGS (Viele & Sons)",
            "category": "Costos & Proveedores",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran al proveedor Viele & Sons.",
            "auditJuly": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran a Viele & Sons.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos.",
            "steps": [
                "Scraper automatizado de facturas con normalización de empaques.",
                "Dashboard ejecutivo de Radar de Precios con 4 métricas anuales.",
                "Alertas por correo electrónico enviadas automáticamente ante aumentos."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran a Viele & Sons."
        },
        {
            "num": 3,
            "title": "3. Configuración local de TVs de Menús",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda y la página pública que muestra el menú rotativo en las pantallas.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda.",
            "auditAugust": "<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche.",
            "steps": [
                "Diseño responsive en alta resolución para pantallas de TV.",
                "Conexión en tiempo real con la base de datos de precios.",
                "Despliegue y verificación en pantallas locales."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda."
        },
        {
            "num": 4,
            "title": "4. Logotipo de marca en correos electrónicos",
            "category": "Comunicaciones / Comms",
            "badgeDept": "✉️ Comunicaciones",
            "badgePriority": "🔵 Baja",
            "auditJune": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales utilizando el servidor de tacosgavilan.com con texto plano y firma básica.",
            "auditJuly": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales con firma básica.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios.",
            "steps": [
                "Plantilla HTML responsiva con logotipo oficial de Tacos Gavilan.",
                "Integración con el servicio de envío de correos (Resend/SMTP).",
                "Verificado en clientes de correo móvil y escritorio."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales con firma básica."
        },
        {
            "num": 5,
            "title": "5. Descripciones de procedimientos en página de ACTIVIDADES",
            "category": "Operaciones / Operations",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo. Contiene el listado de 31 procedimientos operativos estandarizados.",
            "auditJuly": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo.",
            "auditAugust": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal.",
            "steps": [
                "Base de datos de procedimientos y actividades estructurada.",
                "Interfaz de consulta rápida y búsqueda por palabra clave.",
                "Sincronización con el Asistente de Soporte IA."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo."
        },
        {
            "num": 6,
            "title": "6. Verificar tabletas piloto en Slauson",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>En Pruebas (En Progreso).</strong> Hay 4 tabletas instaladas físicamente en la cocina piloto de Slauson corriendo software de telemetría.",
            "auditJuly": "<strong>✓ Completado e Integrado (Julio 2026).</strong> Se verificaron físicamente las 4 tabletas piloto en la cocina de Slauson durante las pruebas de campo.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad.",
            "steps": [
                "Desarrollo del modo pantalla completa exclusivo para cocina.",
                "Polling de sincronización bidireccional cada 10s en Supabase.",
                "Pruebas y validación en sitio en tableta de cocina."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (Julio 2026).</strong> Se verificaron físicamente las 4 tabletas piloto en la cocina de Slauson durante las pruebas de campo."
        },
        {
            "num": 7,
            "title": "7. App de Tacos Gavilán (Imitar King Taco)",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Creado el sistema de base de datos para la aplicación móvil (carritos de compra, puntos de fidelidad, selector de sucursal y menú interactivo).",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Base de datos de la app móvil y catálogo digital de productos estructurado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast.",
            "steps": [
                "Estructura de catálogo móvil y carrito de compras.",
                "Integración con la pasarela de pagos y menú en línea.",
                "Pruebas de pedidos móviles en sucursales piloto."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Muy Avanzado (En Progreso).</strong> Base de datos de la app móvil y catálogo digital de productos estructurado."
        },
        {
            "num": 8,
            "title": "8. Sincronizador y clon de Basecamp",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Altamente Avanzado (En Progreso).</strong> El sistema web está integrado con Basecamp. Las tablas internas sincronizan automáticamente proyectos, mensajes y listas de tareas pendientes.",
            "auditJuly": "<strong>Altamente Avanzado (En Progreso).</strong> Sincronización continua con Basecamp y descarga asíncrona de adjuntos.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos.",
            "steps": [
                "Integración OAuth2 y sincronización local-first en Supabase.",
                "Buscador universal Shift+J con búsqueda paralela.",
                "Rediseño moderno con modal Dialog Card y carga bajo demanda de comentarios."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Altamente Avanzado (En Progreso).</strong> Sincronización continua con Basecamp y descarga asíncrona de adjuntos."
        },
        {
            "num": 9,
            "title": "9. Página Web Oficial de Tacos El Gavilán",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Avanzado (En Progreso).</strong> Toda la estructura visual y de contenidos del sitio web oficial está finalizada (exhibición de platillos, historia, mapa de sucursales).",
            "auditJuly": "<strong>Avanzado (En Progreso).</strong> Estructura visual y mapa de sucursales completado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO.",
            "steps": [
                "Diseño responsivo móvil y de escritorio.",
                "Integración del directorio oficial de 15 tiendas.",
                "Despliegue y configuración de dominio."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Avanzado (En Progreso).</strong> Estructura visual y mapa de sucursales completado."
        },
        {
            "num": 10,
            "title": "10. Determinar gasto en Salsa Bar",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Existe registro de mermas e ingredientes de la barra de salsas en los checklists históricos, pero no se ha desarrollado el módulo de cálculo de costo por porción.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo pendiente de desarrollo para calcular el costo por porción del salsa bar.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal.",
            "steps": [
                "Estandarizar recetas y pesos de preparación de salsas.",
                "Registrar rendimiento por tanda y costo de insumos.",
                "Integrar en la matriz de Food Cost de la cadena."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo pendiente de desarrollo para calcular el costo por porción del salsa bar."
        },
        {
            "num": 11,
            "title": "11. Fotos y verificación Apple Business Connect (Slauson)",
            "category": "Dispositivos / Marketing",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Tarea operativa consistente en registrar la sucursal de Slauson, subir fotografías en alta resolución del interior/exterior y verificar la ficha del negocio en Apple Maps.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Verificación en Apple Maps pendiente de sesión de fotografía.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales.",
            "steps": [
                "Fotografía profesional de exteriores e interiores de tiendas.",
                "Carga de assets en portal Apple Business Connect.",
                "Validación de pin y horarios en Apple Maps."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Verificación en Apple Maps pendiente de sesión de fotografía."
        },
        {
            "num": 12,
            "title": "12. Registro de proveedores y técnicos sin contraseña",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Planificado un portal simplificado de acceso rápido con códigos temporales para que técnicos de refrigeración y proveedores registren sus visitas sin requerir cuenta.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Portal de acceso con código QR temporal para proveedores pendiente.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas.",
            "steps": [
                "Generador de códigos QR y links temporales para contratistas.",
                "Bitácora digital de entradas y salidas de técnicos.",
                "Alertas al gerente de tienda al arribar personal externo."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Portal de acceso con código QR temporal para proveedores pendiente."
        },
        {
            "num": 13,
            "title": "13. Control de uniformes, gorras e inventario de ropa",
            "category": "Inventario / Merchandise",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo operativo pendiente de desarrollo para controlar las existencias de uniformes, gorras y chamarras.",
            "auditJuly": "<strong>▶ En Progreso (Julio 2026).</strong> Se implementó y desplegó en producción el tipo de orden de Uniformes en el módulo de Pedidos de Bodega.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte.",
            "steps": [
                "Catálogo de precios y reglas de exención implementadas.",
                "Tabla de stock mínimo (660 registros en BD) blindada.",
                "Conciliación automática con la bóveda de Caja Fuerte."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>▶ En Progreso (Julio 2026).</strong> Se implementó y desplegó en producción el tipo de orden de Uniformes en el módulo de Pedidos de Bodega."
        },
        {
            "num": 14,
            "title": "14. Manuales, videos y certificación de cocina",
            "category": "Operaciones / Training",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> El sistema cuenta con exámenes rápidos de desempeño para gerentes, pero falta crear la biblioteca de videos demostrativos y el flujo de certificación para personal de línea.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Biblioteca de videos demostrativos de recetas y cocina pendiente de producción.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros.",
            "steps": [
                "Producción de videos cortos demostrativos por estación.",
                "Cuestionarios de evaluación interactivos en tableta.",
                "Certificados digitales de aprobación por empleado."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Biblioteca de videos demostrativos de recetas y cocina pendiente de producción."
        },
        {
            "num": 15,
            "title": "15. Sección de Cultura Empresarial",
            "category": "Operaciones / HR",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Sección informativa planificada para capacitar y familiarizar a los nuevos empleados con los valores, historia y visión de Tacos Gavilan.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo de onboarding y valores de empresa pendiente.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte.",
            "steps": [
                "Documento de valores, misión y estándares de servicio.",
                "Módulo visual de inducción para nuevos empleados.",
                "Integración en el flujo de bienvenida de la app."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo de onboarding y valores de empresa pendiente."
        },
        {
            "num": 16,
            "title": "16. CLONAR Cohesion (app de contabilidad)",
            "category": "Sistemas / Finance",
            "badgeDept": "💻 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Desarrollo e integración de un clon contable de la plataforma Cohesión a medida para procesar pólizas de ventas y conciliar cuentas bancarias.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo contable integral en fase de especificación y análisis de viabilidad.",
            "auditAugust": "<strong>⚡ En Progreso (80% en Agosto 2026).</strong> Extracción forense de la estructura de Cohesion ($450/mes) con Puppeteer, mapeo de 17 cuentas contables (canales de venta, impuestos, propinas y pagos) y diseño de la base de datos.",
            "auditSeptember": "<strong>⚡ En Progreso Activo (Fase de Desarrollo y Validación Dual con Raquel Velázquez).</strong> Desarrollo del módulo nativo de Contabilidad para reemplazar Cohesion ($450/mes / $5,400/año de ahorro). Construcción de la librería central lib/accounting-journal.ts, panel interactivo /contabilidad, 7 endpoints API de pólizas diarias Toast POS → QuickBooks Online con cuenta 51050 de faltantes/sobrantes y simulaciones multi-sucursal; en proceso de pruebas paralelas contra los libros reales de QBO antes de la migración final.",
            "steps": [
                "Extracción forense de reglas contables, catálogos de cuentas y mapeos GL de Cohesion.",
                "Librería central lib/accounting-journal.ts (17 cuentas, canales For Here/To Go/Uber/DoorDash/GrubHub y efectivo).",
                "Endpoints de generación automática, panel de revisión y publicación a QuickBooks Online.",
                "Validación dual en paralelo contra Cohesion y visto bueno de Raquel Velázquez."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo contable integral en fase de especificación y análisis de viabilidad."
        },
        {
            "num": 17,
            "title": "17. Módulo de Rendimiento y Telemetría de Drive-Thru (HME Zoom Nitro)",
            "category": "Sistemas / Hardware",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>✓ Completado e Integrado (Junio 2026).</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru en las sucursales con ventanilla.",
            "auditJuly": "<strong>✓ Completado e Integrado.</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real de tiempos de espera, cobro y despacho de ventanilla con alertas por cuello de botella.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real activa en sucursales con ventanilla.",
            "steps": [
                "Conexión con la API/controlador de HME Zoom Nitro.",
                "Métricas en vivo de segundos por vehículo en ventanilla.",
                "Historial de rendimiento y benchmarks entre sucursales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado.</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru."
        },
        {
            "num": 18,
            "title": "18. Actualizar y Descargar Videos Musicales Regional Mexicano",
            "category": "Operaciones / Marketing",
            "badgeDept": "🎵 Tienda",
            "badgePriority": "🟢 Normal",
            "auditJune": "",
            "auditJuly": "<strong>⏳ Pendiente (Julio 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano para las pantallas de las sucursales.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano en formato MP4 HD organizados en unidades USB para reproducción en los televisores de los restaurantes.",
            "auditSeptember": "<strong>✓ Completado y Distribuido.</strong> Biblioteca musical de videos MP4 HD entregada a sucursales.",
            "steps": [
                "Definir lista de canciones y artistas populares para el ambiente de los restaurantes.",
                "Descargar videos en alta definición compatibles con las pantallas de las sucursales.",
                "Organizar archivos y distribuirlos a las sucursales."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ Pendiente (Julio 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano para las pantallas de las sucursales."
        },
        {
            "num": 19,
            "title": "19. Módulo de Caja Fuerte (Conteo de Efectivo por Sucursal)",
            "category": "Finanzas / Treasury",
            "badgeDept": "💰 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "<strong>✓ Completado e Integrado (10-Jul-2026).</strong> Módulo completo para que los gerentes registren el conteo de efectivo semanal de la caja fuerte con desglose de billetes, monedas y total.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Registro semanal de billetes, monedas sueltas, rollos y gavetas con cálculo automático de gran total, conciliación de ventas de uniformes y control de ediciones pasadas.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Registro y conciliación semanal de caja fuerte en producción.",
            "steps": [
                "Formulario estructurado de desglose de efectivo.",
                "Conciliación automática con ventas de uniformes en efectivo.",
                "Historial auditable con control de modificaciones por rol."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (10-Jul-2026).</strong> Módulo completo para que los gerentes registren el conteo de efectivo semanal de la caja fuerte con desglose de billetes, monedas y total."
        },
        {
            "num": 20,
            "title": "20. Módulo de Tiendas (Integración Dinámica, Geocodificación y Mapas de Google)",
            "category": "Sistemas / Locations",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "",
            "auditJuly": "<strong>✓ Completado e Integrado (14-Jul-2026).</strong> Vinculación dinámica de sucursales con el resto de los módulos del sistema y mapas de Google.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de las 15 sucursales oficiales + Bodega Central con coordenadas GPS exactas, teléfonos y horarios de operación.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Directorio dinámico de 15 sucursales oficiales y Bodega Central.",
            "steps": [
                "Tabla canónica de tiendas en base de datos.",
                "Geocodificación de coordenadas GPS para integración con MilesIQ.",
                "Selector global de sucursales en cabecera del sistema."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (14-Jul-2026).</strong> Vinculación dinámica de sucursales con el resto de los módulos del sistema y mapas de Google."
        }
    ]
},
    junio: {
    "id": "junio",
    "monthName": "Junio",
    "monthYear": "Junio 2026",
    "totalHours": 190.5,
    "totalTasks": 17,
    "completedTasks": 1,
    "inProgressTasks": 9,
    "pendingTasks": 7,
    "rows": [
        {
            "date": "01-Jun-2026",
            "time": "9:30 AM - 2:00 PM & 6:00 PM - 11:00 PM",
            "hours": 9.5,
            "badges": [
                "Planificador",
                "Food Cost",
                "Procedimientos",
                "Asistente AI"
            ],
            "descEs": "- **Planificador**: Se configuró la pantalla para mostrar códigos de acceso y sueldos al pasar el cursor sobre los nombres.<br>- **Planificador**: Se agregó el botón para clonar turnos de semanas previas en un popup informativo.<br>- **Costos**: Corrección del cálculo de costos de empaques en recetas (papelitos/platos) para reflejar márgenes reales.<br>- **Celular**: Corrección de pantalla de carga infinita en el módulo móvil de ventas.<br>- **Impresión**: Botón y vista previa para exportar e imprimir manuales en formato PDF.<br>- **Documentos**: Comentarios y explicaciones agregadas al código principal para simplificar desarrollos futuros.",
            "descEn": "- Planner: display access codes/employee wages on hover.<br>- Planner: week cloning button inside information modal.<br>- Costs: fixed packaging costs calculation in recipes to reflect correct profit margins.<br>- Mobile: solved infinite loop bug on mobile sales views.<br>- Print: added print button and iframe PDF preview layout in Procedures."
        },
        {
            "date": "02-Jun-2026",
            "time": "1:30 PM - 4:00 PM",
            "hours": 2.5,
            "badges": [
                "Procedimientos",
                "Basecamp"
            ],
            "descEs": "- **Procedimientos**: Se removió la columna de firma del PDF para dar más espacio a los textos de las recetas.<br>- **Basecamp**: Planeación inicial y diagramas para vincular tareas con Basecamp.",
            "descEn": "- Procedures: removed \"Signature\" column from PDF and rebalanced columns.<br>- Basecamp: conducted database scoping and initial layout planning."
        },
        {
            "date": "03-Jun-2026",
            "time": "1:00 PM - 6:30 PM & 9:30 PM - 12:00 AM",
            "hours": 10.5,
            "badges": [
                "Basecamp",
                "Ventas",
                "Soporte Chat"
            ],
            "descEs": "- **Basecamp**: Conexión con Basecamp para sincronizar empleados, mensajes y pendientes de manera automática.<br>- **Tareas**: Rediseño visual del tablero de pendientes a estética premium (tarjetas con fotos de perfil).<br>- **Soporte**: Mejoras al chat de asistencia interno para resolver dudas operativas de las sucursales.<br>- **Seguridad**: Se actualizó el inicio de sesión en 11 pantallas para validar siempre la identidad del usuario.",
            "descEn": "- Basecamp: auto-sync employees, messages, and tasks.<br>- Tasks: redesigned the task dashboard (clean cards with profile pictures).<br>- Support: upgraded help chat to assist stores with operational issues.<br>- Security: updated logins checking on 11 screens."
        },
        {
            "date": "04-Jun-2026",
            "time": "9:00 AM - 1:00 PM & 4:30 PM - 8:00 PM",
            "hours": 7.5,
            "badges": [
                "Basecamp",
                "Buscador"
            ],
            "descEs": "- **Basecamp**: Se habilitó la barra de formato (negritas, listas) para redactar notas y sub-tareas para varios empleados.<br>- **Basecamp**: Descarga directa de archivos adjuntos y optimización del tráfico de datos en servidor.<br>- **Buscador**: Atajos de teclado rápidos (Shift+J) y vista previa detallada de resultados.<br>- **Sincronización**: Envío bidireccional automático de comentarios de tareas de ida y vuelta.",
            "descEn": "- Basecamp: added rich-text toolbar, subtasks, and multi-assignee autocompletes.<br>- Basecamp: optimized attachments downloads speed. Search: added shortcuts.<br>- Sync: enabled comments to sync back and forth between platforms."
        },
        {
            "date": "05-Jun-2026",
            "time": "3:00 PM - 6:30 PM & 11:30 PM - 12:30 AM",
            "hours": 4.5,
            "badges": [
                "Basecamp"
            ],
            "descEs": "- **Basecamp**: Descarga asíncrona de archivos pesados en segundo plano para no alentar la navegación del usuario.<br>- **Basecamp**: Se aumentó el tiempo de espera de sincronización a 15 minutos para evitar bloqueos del sistema.<br>- **Tareas**: Organización automática de pendientes ordenados cronológicamente.",
            "descEn": "- Basecamp: background downloads for attachments to prevent timeouts.<br>- Basecamp: extended sync mutex lock to 15m to avoid sync blockages.<br>- Tasks: sorted and ordered task entries by creation date."
        },
        {
            "date": "06-Jun-2026",
            "time": "1:30 PM - 3:30 PM",
            "hours": 2,
            "badges": [
                "Basecamp",
                "Preparador",
                "Asistente AI"
            ],
            "descEs": "- **Basecamp**: Corrección de ordenamiento de tareas y diseño visual del podio de posiciones.<br>- **Asistente**: Ajustes lógicos al chat inteligente para dar proyecciones de carne más exactas.",
            "descEn": "- Basecamp: debugged tasks list ordering and podium UI elements.<br>- Assistant: refined AI database querying rules for cooking pace history."
        },
        {
            "date": "07-Jun-2026",
            "time": "9:30 AM - 2:00 PM & 4:00 PM - 6:00 PM",
            "hours": 6.5,
            "badges": [
                "Actividades (Config)"
            ],
            "descEs": "- **Actividades**: Re-diseño del módulo de tareas diarias. Ahora los pendientes se organizan por estación física de cocina (ej. Parrilla, Limpieza, Caja) y no por nombre de empleado, facilitando la rotación de turnos.<br>- **Migración**: Reorganización total de base de datos para migrar actividades pasadas al nuevo formato.",
            "descEn": "- Activities: redesigned the daily task module by kitchen work stations (e.g., Grill, Cleaning, Cashier) instead of individual names.<br>- Database: migrated old position-based tasks."
        },
        {
            "date": "08-Jun-2026",
            "time": "11:30 AM - 4:00 PM & 9:30 PM - 11:30 PM",
            "hours": 6.5,
            "badges": [
                "Planificador",
                "Actividades"
            ],
            "descEs": "- **Planificador**: Se corrigió un error técnico que congelaba la pantalla al editar los roles diarios.<br>- **Horarios**: Creación de scripts de diagnóstico para solucionar diferencias de horas en los registros.",
            "descEn": "- Planner: fixed freeze error on Roles tab.<br>- Schedules: ran diagnostics for timezone offsets."
        },
        {
            "date": "12-Jun-2026",
            "time": "2:00 PM - 5:30 PM & 11:30 PM - 12:30 AM",
            "hours": 4.5,
            "badges": [
                "Actividades"
            ],
            "descEs": "- **Actividades**: Fusión manual de archivos de diseño móvil para que el checklist se vea perfecto en celulares.<br>- **UI**: Limpieza del código fuente de importaciones redundantes para acelerar la carga de la página.",
            "descEn": "- Activities: merged unresolved layout files manually for mobile views.<br>- UI: cleaned up code imports to speed up loading times."
        },
        {
            "date": "13-Jun-2026",
            "time": "11:00 AM - 4:30 PM & 10:30 PM - 12:30 AM",
            "hours": 8.5,
            "badges": [
                "Procedimientos",
                "Actividades"
            ],
            "descEs": "- **Procedimientos**: Se enumeraron de manera consecutiva todas las tareas y se agregaron tags para auditorías.<br>- **Seguridad**: Se restringió la opción de borrar tareas del catálogo únicamente al perfil del Administrador.<br>- **Actividades**: Desarrollo del panel lateral interactivo con contadores de empleados por estación de cocina.",
            "descEn": "- Procedures: added sequential numbering and visual audit tags.<br>- Security: restricted catalog task deletion to admins.<br>- Activities: designed the sidebar setup screen with drag counts."
        },
        {
            "date": "14-Jun-2026",
            "time": "11:30 AM - 5:00 PM",
            "hours": 5.5,
            "badges": [
                "Planificador",
                "Actividades",
                "Emails"
            ],
            "descEs": "- **Notificaciones**: Al publicar el horario, el sistema ahora incluye el checklist de tareas diarias en el email del personal.<br>- **Filtro**: Se desactivó el cron de notificaciones automáticas para tiendas en producción (evita spam en el piloto).<br>- **Horarios**: Se regresaron a borrador los turnos publicados por error en Lynwood para permitir ajustes.",
            "descEn": "- Notifications: linked schedules publication emails with assigned activities.<br>- Filter: blocked auto-emails for production stores during pilots.<br>- Schedules: rollbacked published shifts to drafts in Lynwood."
        },
        {
            "date": "15-Jun-2026",
            "time": "1:00 PM - 7:00 PM & 8:00 PM - 10:30 PM",
            "hours": 8.5,
            "badges": [
                "Descansos",
                "Inspecciones",
                "iOS compatibility"
            ],
            "descEs": "- **Descansos**: Reporte automático semanal para supervisores detallando faltas en lunches de 2026.<br>- **Seguridad**: Se obligó a usar la cámara en vivo en los checklists de supervisores (bloquea la carga desde la galería).<br>- **iOS**: Ajustes de compatibilidad visual y solución de bloqueos de cámara en iPhone y iPad.",
            "descEn": "- Breaks: weekly cron alerts for supervisors and 2026 break infractions logs.<br>- Security: enforced live camera capture for checklists (blocked file uploads).<br>- iOS: solved Safari standalone layout and camera bugs on iPads."
        },
        {
            "date": "19-Jun-2026",
            "time": "10:30 AM - 3:00 PM & 6:00 PM - 7:00 PM",
            "hours": 5.5,
            "badges": [
                "QuickBooks",
                "Food Cost"
            ],
            "descEs": "- **Precios**: Alerta de seguridad si los precios de QuickBooks varían más del 50% de golpe para evitar datos corruptos.<br>- **Costo de Comida**: Se corrigió la fórmula para usar el precio de venta de bodega en lugar de costo de compra (esto restableció el costo de comida al 33-35% real).<br>- **Historial**: Actualización en lote del historial de precios de semanas previas en la base de datos.",
            "descEn": "- Prices: created a 50% price protection ceiling to avoid data corruption.<br>- Food Cost: corrected formulas using warehouse sale prices (restored FC to 33-35%).<br>- History: ran database price updates for past logs."
        },
        {
            "date": "20-Jun-2026",
            "time": "6:00 PM - 8:00 PM & 11:30 PM - 12:30 AM",
            "hours": 3,
            "badges": [
                "Procedimientos",
                "Actividades"
            ],
            "descEs": "- **Procedimientos**: Se habilitó el permiso para que los Gerentes de Tienda editen o agreguen tareas al catálogo.<br>- **UI**: Corrección en las vistas del panel de control para ocultar puestos de trabajo inactivos.",
            "descEn": "- Procedures: enabled CRUD catalog permissions for Manager roles.<br>- UI: optimized scheduling layouts by filtering out inactive positions."
        },
        {
            "date": "21-Jun-2026",
            "time": "3:00 PM - 4:30 PM & 7:30 PM - 10:30 PM",
            "hours": 4.5,
            "badges": [
                "Food Cost",
                "Checklist"
            ],
            "descEs": "- **Costo de Comida**: Diagnóstico y corrección de registros de costos diarios vacíos en Supabase.<br>- **Checklist**: Diseño de pantalla completa para tabletas montadas en pared de cocina (reinicio automático diario).",
            "descEn": "- Food Cost: repaired empty daily cost caches on Supabase.<br>- Checklist: designed fullscreen checklist screen for kitchen tablets (resets daily)."
        },
        {
            "date": "22-Jun-2026",
            "time": "1:00 AM - 4:00 AM",
            "hours": 3,
            "badges": [
                "Checklist"
            ],
            "descEs": "- **Checklist**: Corrección de error de claves duplicadas al cambiar de día (00:00:00) y de clicks del botón verde.<br>- **Reloj**: Sincronización del temporizador del checklist con la hora local real de la sucursal.",
            "descEn": "- Checklist: fixed duplicate keys error (00:00:00) and click fill bugs.<br>- Clock: synchronized checklist timing with each store's local time."
        },
        {
            "date": "23-Jun-2026",
            "time": "10:45 PM - 12:15 AM",
            "hours": 4.5,
            "badges": [
                "Checklist (Reportes)"
            ],
            "descEs": "- **Reportes**: Creación del registro en base de datos para guardar checklists completados a tiempo por tienda.<br>- **Administración**: Se añadió la pestaña de \"Reportes\" al panel para facilitar el monitoreo a supervisores.",
            "descEn": "- Reports: created completion logs database tables for checklists.<br>- Administration: added a \"Reports\" tab to the administrative dashboard."
        },
        {
            "date": "24-Jun-2026",
            "time": "3:50 AM - 4:45 AM & 11:30 AM - 6:00 PM",
            "hours": 7.5,
            "badges": [
                "Inventario",
                "Pedidos Bodega"
            ],
            "descEs": "- **Pedidos**: Desarrollo del sistema de reordenamiento automático basado en mínimos de stock (PAR) e historial de ventas.<br>- **Excel**: Lector e importador automático de archivos de compras (`Lynwood Order.xlsx`).<br>- **Traducciones**: Se agregaron las traducciones bilingües a inglés y español para todas las pantallas de pedidos.<br>- **Servidor**: Corrección de Server Actions en el servidor para evitar fallas al publicar actualizaciones.",
            "descEn": "- Orders: developed automated replenishment algorithms using PAR and sales data.<br>- Excel: imported and mapped Lynwood Order.xlsx sheets.<br>- Translations: wrote bilingual keys. Patched Server Actions compilation issues."
        },
        {
            "date": "25-Jun-2026",
            "time": "10:00 AM - 3:30 PM & 4:00 PM - 7:00 PM",
            "hours": 8.5,
            "badges": [
                "Drive-Thru"
            ],
            "descEs": "- **Drive-Thru**: Creación del tablero que mide la velocidad de autos (HME Zoom Nitro) con ranking de tiendas, promedios y reportes.<br>- **Recibos**: Ventana emergente para abrir el ticket Toast completo (platillos/precios) al dar click a órdenes con retrasos.<br>- **UI**: Ajustes visuales para que la barra superior no tape el selector de fechas al hacer scroll en teléfonos.",
            "descEn": "- Drive-Thru: built 4-tabs Zoom Nitro dashboard for speed performance.<br>- Receipts: integrated Toast ticket detail modal when clicking on slow orders.<br>- UI: fixed header view scroll overlaps on mobile screens."
        },
        {
            "date": "26-Jun-2026",
            "time": "5:30 PM - 11:00 PM",
            "hours": 5.5,
            "badges": [
                "Drive-Thru",
                "KDS"
            ],
            "descEs": "- **Drive-Thru**: Integración con las pantallas de cocina (KDS) para medir el tiempo real desde que el auto pide hasta la entrega.<br>- **Búsquedas**: Optimización para ordenar y buscar órdenes rápidamente en listas de miles de registros.",
            "descEn": "- Drive-Thru: combined KDS prep timestamps to measure kitchen screen clear times.<br>- Sorting: optimized server-side sorting for lookup queries."
        },
        {
            "date": "27-Jun-2026",
            "time": "6:00 PM - 12:00 AM",
            "hours": 6,
            "badges": [
                "Actividades",
                "Descansos"
            ],
            "descEs": "- **Actividades**: Creadas las posiciones de \"Cierre 1\" y \"Cierre 2\" en la cocina con soporte para asignación múltiple de empleados.<br>- **Descansos**: Se mejoró el cálculo de descansos por Inteligencia Artificial para que al mover el descanso de un empleado no se modifique el de los demás.",
            "descEn": "- Activities: created closing stations (Cierre 1 & 2) with double staff assignments.<br>- Breaks: developed targeted AI recalculations to prevent shifts shuffling."
        },
        {
            "date": "28-Jun-2026",
            "time": "1:45 AM - 4:45 AM",
            "hours": 3,
            "badges": [
                "Actividades (Notif)"
            ],
            "descEs": "- **Actividades**: Sincronización horaria entre las tareas que llegan en los correos y las listas del panel de control de la tienda.<br>- **Permisos**: Ajustes de permisos para que los supervisores puedan entrar a ver los datos de todas sus sucursales.",
            "descEn": "- Activities: integrated published schedule emails with station daily tasks.<br>- Permissions: resolved cross-station authorization locks on supervisor roles."
        },
        {
            "date": "29-Jun-2026",
            "time": "10:00 AM - 4:00 PM & 7:30 PM - 9:00 PM",
            "hours": 7.5,
            "badges": [
                "Preparador",
                "Planificador"
            ],
            "descEs": "- **Turnos**: Solución visual para que los empleados en turnos dobles AM/PM no se encimen en la pantalla del planificador.<br>- **Preparador**: Se agregaron la Cebolla Asada y el Queso Fresco al catálogo de carnes y quesos de la mesa de preparación.<br>- **Preparador**: Se limitó el cálculo histórico de proyección a los últimos 3 meses (hace la proyección de carne mucho más exacta).<br>- **Preparador**: Se añadieron alertas con vibración (hápticas) en las tabletas de cocina y un tablero de merma por fecha.",
            "descEn": "- Shifts: fixed AM/PM shift overlap controls visibility in Planner.<br>- Prep Line: added Jack Cheese/Queso Fresco. Limited history projections to 3 months.<br>- Prep Line: programmed tablet haptic alert vibrations and waste dashboards."
        },
        {
            "date": "30-Jun-2026",
            "time": "9:00 AM - 5:30 PM",
            "hours": 8.5,
            "badges": [
                "QuickBooks",
                "Basecamp",
                "Sidebar",
                "i18n"
            ],
            "descEs": "- **Basecamp**: Refactorización del inicio de sesión y renovación de tokens OAuth en POST body. Agregado visor multimedia de fotos/videos adjuntos con miniaturas y contadores (+N) en búsquedas. Acceso en menú principal (`AppSidebar`) estilizado con logotipo SVG animado y etiqueta \"NEW\" interactiva. Cron job automático `/api/basecamp/sync` configurado cada hora en `vercel.json`.<br>- **QuickBooks**: Sincronización de pedidos de bodega con creación de Estimates. Corrección de folios consecutivos (obtiene máximo histórico e incrementa secuencialmente). Creación de scripts de prueba, exclusión de proveedores externos (flanes/cheesecakes) y campo de observaciones extraordinarias.<br>- **Dashboard**: Diseño e integración de panel consolidado HTML (`pendientes.html`) unificando reportes y tareas para uso sin conexión.<br>- **Traducción**: Adición de llaves bilingües en `lib/i18n.tsx` para notas de pedido y simplificación de términos técnicos a comerciales para directivos.",
            "descEn": "- Basecamp: refactored OAuth token exchange/refresh flow to use POST body params. Added media thumbnail previews and file attachment counters to search results. Integrated Basecamp shortcut in AppSidebar with animated custom SVG logo, pulsing effects, and animated \"NEW\" badge. Added hourly Vercel cron job configuration.<br>- QuickBooks: connected warehouse orders with QB Estimates. Fixed duplicate document numbering (checks max DocNumber and increments). Built test scripts, excluded external suppliers, added order notes/memos.<br>- Dashboard: designed and integrated a unified HTML dashboard (`pendientes.html`) for offline/WhatsApp reporting.<br>- Simplification: translated complex coding jargon to standard business vocabulary, and added bilingual observations translations in i18n."
        }
    ],
    "effortSummary": [
        {
            "module": "Drive-Thru Telemetría & Tiempos en Vivo",
            "hours": 85
        },
        {
            "module": "Clon de Basecamp 3 & Mensajería Interna",
            "hours": 42
        },
        {
            "module": "Procedimientos, Fotos e Inspecciones",
            "hours": 28.5
        },
        {
            "module": "Preparador de Carne y Cocina KDS",
            "hours": 18
        },
        {
            "module": "Mantenimiento General y Soporte Técnico",
            "hours": 17
        }
    ],
    "parallelActivities": [
        {
            "title": "Pruebas en Sucursal/Local",
            "hours": 30,
            "desc": "Pruebas en vivo en tienda Lynwood y terminales POS Toast, validación de telemetría de Drive-Thru y KDS en cocina."
        },
        {
            "title": "Monitoreo DB y APIs",
            "hours": 12,
            "desc": "Optimización de consultas SQL en Supabase, reintentos en APIs de Basecamp y Toast, y depuración de logs en tiempo real."
        },
        {
            "title": "Planificación y Diseño",
            "hours": 5,
            "desc": "Diseño de interfaces de usuario para el módulo de Procedimientos, flujos de trabajo de Basecamp y esquemas de datos."
        }
    ],
    "tasks": [
        {
            "num": 1,
            "title": "1. Inventario con reposición automática",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas analizando el consumo histórico de las últimas 4 semanas y las existencias actuales capturadas por el gerente.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas con soporte preliminar de QuickBooks.",
            "auditAugust": "<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes.",
            "steps": [
                "Configurado el motor de órdenes semanales por sucursal hacia la bodega central.",
                "Integrada la API de QuickBooks Online con guardado seguro.",
                "Pruebas y validación en sucursales operando al 100%."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas analizando el consumo histórico de las últimas 4 semanas y las existencias actuales capturadas por el gerente."
        },
        {
            "num": 2,
            "title": "2. Inventario para Bodega y COGS (Viele & Sons)",
            "category": "Costos & Proveedores",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran al proveedor Viele & Sons.",
            "auditJuly": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran a Viele & Sons.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos.",
            "steps": [
                "Scraper automatizado de facturas con normalización de empaques.",
                "Dashboard ejecutivo de Radar de Precios con 4 métricas anuales.",
                "Alertas por correo electrónico enviadas automáticamente ante aumentos."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran al proveedor Viele & Sons."
        },
        {
            "num": 3,
            "title": "3. Configuración local de TVs de Menús",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda y la página pública que muestra el menú rotativo en las pantallas.",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda.",
            "auditAugust": "<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche.",
            "steps": [
                "Diseño responsive en alta resolución para pantallas de TV.",
                "Conexión en tiempo real con la base de datos de precios.",
                "Despliegue y verificación en pantallas locales."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda y la página pública que muestra el menú rotativo en las pantallas."
        },
        {
            "num": 4,
            "title": "4. Logotipo de marca en correos electrónicos",
            "category": "Comunicaciones / Comms",
            "badgeDept": "✉️ Comunicaciones",
            "badgePriority": "🔵 Baja",
            "auditJune": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales utilizando el servidor de tacosgavilan.com con texto plano y firma básica.",
            "auditJuly": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales con firma básica.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios.",
            "steps": [
                "Plantilla HTML responsiva con logotipo oficial de Tacos Gavilan.",
                "Integración con el servicio de envío de correos (Resend/SMTP).",
                "Verificado en clientes de correo móvil y escritorio."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales utilizando el servidor de tacosgavilan.com con texto plano y firma básica."
        },
        {
            "num": 5,
            "title": "5. Descripciones de procedimientos en página de ACTIVIDADES",
            "category": "Operaciones / Operations",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo. Contiene el listado de 31 procedimientos operativos estandarizados.",
            "auditJuly": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo.",
            "auditAugust": "<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal.",
            "steps": [
                "Base de datos de procedimientos y actividades estructurada.",
                "Interfaz de consulta rápida y búsqueda por palabra clave.",
                "Sincronización con el Asistente de Soporte IA."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo. Contiene el listado de 31 procedimientos operativos estandarizados."
        },
        {
            "num": 6,
            "title": "6. Verificar tabletas piloto en Slauson",
            "category": "Dispositivos / Devices",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>En Pruebas (En Progreso).</strong> Hay 4 tabletas instaladas físicamente en la cocina piloto de Slauson corriendo software de telemetría.",
            "auditJuly": "<strong>✓ Completado e Integrado (Julio 2026).</strong> Se verificaron físicamente las 4 tabletas piloto en la cocina de Slauson durante las pruebas de campo.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad.",
            "steps": [
                "Desarrollo del modo pantalla completa exclusivo para cocina.",
                "Polling de sincronización bidireccional cada 10s en Supabase.",
                "Pruebas y validación en sitio en tableta de cocina."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>En Pruebas (En Progreso).</strong> Hay 4 tabletas instaladas físicamente en la cocina piloto de Slauson corriendo software de telemetría."
        },
        {
            "num": 7,
            "title": "7. App de Tacos Gavilán (Imitar King Taco)",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Muy Avanzado (En Progreso).</strong> Creado el sistema de base de datos para la aplicación móvil (carritos de compra, puntos de fidelidad, selector de sucursal y menú interactivo).",
            "auditJuly": "<strong>Muy Avanzado (En Progreso).</strong> Base de datos de la app móvil y catálogo digital de productos estructurado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast.",
            "steps": [
                "Estructura de catálogo móvil y carrito de compras.",
                "Integración con la pasarela de pagos y menú en línea.",
                "Pruebas de pedidos móviles en sucursales piloto."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Muy Avanzado (En Progreso).</strong> Creado el sistema de base de datos para la aplicación móvil (carritos de compra, puntos de fidelidad, selector de sucursal y menú interactivo)."
        },
        {
            "num": 8,
            "title": "8. Sincronizador y clon de Basecamp",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>Altamente Avanzado (En Progreso).</strong> El sistema web está integrado con Basecamp. Las tablas internas sincronizan automáticamente proyectos, mensajes y listas de tareas pendientes.",
            "auditJuly": "<strong>Altamente Avanzado (En Progreso).</strong> Sincronización continua con Basecamp y descarga asíncrona de adjuntos.",
            "auditAugust": "<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos.",
            "steps": [
                "Integración OAuth2 y sincronización local-first en Supabase.",
                "Buscador universal Shift+J con búsqueda paralela.",
                "Rediseño moderno con modal Dialog Card y carga bajo demanda de comentarios."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Altamente Avanzado (En Progreso).</strong> El sistema web está integrado con Basecamp. Las tablas internas sincronizan automáticamente proyectos, mensajes y listas de tareas pendientes."
        },
        {
            "num": 9,
            "title": "9. Página Web Oficial de Tacos El Gavilán",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>Avanzado (En Progreso).</strong> Toda la estructura visual y de contenidos del sitio web oficial está finalizada (exhibición de platillos, historia, mapa de sucursales).",
            "auditJuly": "<strong>Avanzado (En Progreso).</strong> Estructura visual y mapa de sucursales completado.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO.",
            "steps": [
                "Diseño responsivo móvil y de escritorio.",
                "Integración del directorio oficial de 15 tiendas.",
                "Despliegue y configuración de dominio."
            ],
            "status": "progreso",
            "statusLabel": "⚡ En Progreso",
            "audit": "<strong>Avanzado (En Progreso).</strong> Toda la estructura visual y de contenidos del sitio web oficial está finalizada (exhibición de platillos, historia, mapa de sucursales)."
        },
        {
            "num": 10,
            "title": "10. Determinar gasto en Salsa Bar",
            "category": "Inventario / Inventory",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Existe registro de mermas e ingredientes de la barra de salsas en los checklists históricos, pero no se ha desarrollado el módulo de cálculo de costo por porción.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo pendiente de desarrollo para calcular el costo por porción del salsa bar.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal.",
            "steps": [
                "Estandarizar recetas y pesos de preparación de salsas.",
                "Registrar rendimiento por tanda y costo de insumos.",
                "Integrar en la matriz de Food Cost de la cadena."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Existe registro de mermas e ingredientes de la barra de salsas en los checklists históricos, pero no se ha desarrollado el módulo de cálculo de costo por porción."
        },
        {
            "num": 11,
            "title": "11. Fotos y verificación Apple Business Connect (Slauson)",
            "category": "Dispositivos / Marketing",
            "badgeDept": "📺 Dispositivos",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Tarea operativa consistente en registrar la sucursal de Slauson, subir fotografías en alta resolución del interior/exterior y verificar la ficha del negocio en Apple Maps.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Verificación en Apple Maps pendiente de sesión de fotografía.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales.",
            "steps": [
                "Fotografía profesional de exteriores e interiores de tiendas.",
                "Carga de assets en portal Apple Business Connect.",
                "Validación de pin y horarios en Apple Maps."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Tarea operativa consistente en registrar la sucursal de Slauson, subir fotografías en alta resolución del interior/exterior y verificar la ficha del negocio en Apple Maps."
        },
        {
            "num": 12,
            "title": "12. Registro de proveedores y técnicos sin contraseña",
            "category": "Sistemas / Systems",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Planificado un portal simplificado de acceso rápido con códigos temporales para que técnicos de refrigeración y proveedores registren sus visitas sin requerir cuenta.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Portal de acceso con código QR temporal para proveedores pendiente.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas.",
            "steps": [
                "Generador de códigos QR y links temporales para contratistas.",
                "Bitácora digital de entradas y salidas de técnicos.",
                "Alertas al gerente de tienda al arribar personal externo."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Planificado un portal simplificado de acceso rápido con códigos temporales para que técnicos de refrigeración y proveedores registren sus visitas sin requerir cuenta."
        },
        {
            "num": 13,
            "title": "13. Control de uniformes, gorras e inventario de ropa",
            "category": "Inventario / Merchandise",
            "badgeDept": "📦 Inventario",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo operativo pendiente de desarrollo para controlar las existencias de uniformes, gorras y chamarras.",
            "auditJuly": "<strong>▶ En Progreso (Julio 2026).</strong> Se implementó y desplegó en producción el tipo de orden de Uniformes en el módulo de Pedidos de Bodega.",
            "auditAugust": "<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte.",
            "steps": [
                "Catálogo de precios y reglas de exención implementadas.",
                "Tabla de stock mínimo (660 registros en BD) blindada.",
                "Conciliación automática con la bóveda de Caja Fuerte."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo operativo pendiente de desarrollo para controlar las existencias de uniformes, gorras y chamarras."
        },
        {
            "num": 14,
            "title": "14. Manuales, videos y certificación de cocina",
            "category": "Operaciones / Training",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> El sistema cuenta con exámenes rápidos de desempeño para gerentes, pero falta crear la biblioteca de videos demostrativos y el flujo de certificación para personal de línea.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Biblioteca de videos demostrativos de recetas y cocina pendiente de producción.",
            "auditAugust": "<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros.",
            "steps": [
                "Producción de videos cortos demostrativos por estación.",
                "Cuestionarios de evaluación interactivos en tableta.",
                "Certificados digitales de aprobación por empleado."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> El sistema cuenta con exámenes rápidos de desempeño para gerentes, pero falta crear la biblioteca de videos demostrativos y el flujo de certificación para personal de línea."
        },
        {
            "num": 15,
            "title": "15. Sección de Cultura Empresarial",
            "category": "Operaciones / HR",
            "badgeDept": "📝 Operaciones",
            "badgePriority": "🟡 Media",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Sección informativa planificada para capacitar y familiarizar a los nuevos empleados con los valores, historia y visión de Tacos Gavilan.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo de onboarding y valores de empresa pendiente.",
            "auditAugust": "<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte.",
            "steps": [
                "Documento de valores, misión y estándares de servicio.",
                "Módulo visual de inducción para nuevos empleados.",
                "Integración en el flujo de bienvenida de la app."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Sección informativa planificada para capacitar y familiarizar a los nuevos empleados con los valores, historia y visión de Tacos Gavilan."
        },
        {
            "num": 16,
            "title": "16. CLONAR Cohesion (app de contabilidad)",
            "category": "Sistemas / Finance",
            "badgeDept": "💻 Finanzas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>⏳ No Iniciado (Pendiente).</strong> Desarrollo e integración de un clon contable de la plataforma Cohesión a medida para procesar pólizas de ventas y conciliar cuentas bancarias.",
            "auditJuly": "<strong>⏳ No Iniciado (Pendiente).</strong> Módulo contable integral en fase de especificación y análisis de viabilidad.",
            "auditAugust": "<strong>⚡ En Progreso (80% en Agosto 2026).</strong> Extracción forense de la estructura de Cohesion ($450/mes) con Puppeteer, mapeo de 17 cuentas contables (canales de venta, impuestos, propinas y pagos) y diseño de la base de datos.",
            "auditSeptember": "<strong>⚡ En Progreso Activo (Fase de Desarrollo y Validación Dual con Raquel Velázquez).</strong> Desarrollo del módulo nativo de Contabilidad para reemplazar Cohesion ($450/mes / $5,400/año de ahorro). Construcción de la librería central lib/accounting-journal.ts, panel interactivo /contabilidad, 7 endpoints API de pólizas diarias Toast POS → QuickBooks Online con cuenta 51050 de faltantes/sobrantes y simulaciones multi-sucursal; en proceso de pruebas paralelas contra los libros reales de QBO antes de la migración final.",
            "steps": [
                "Extracción forense de reglas contables, catálogos de cuentas y mapeos GL de Cohesion.",
                "Librería central lib/accounting-journal.ts (17 cuentas, canales For Here/To Go/Uber/DoorDash/GrubHub y efectivo).",
                "Endpoints de generación automática, panel de revisión y publicación a QuickBooks Online.",
                "Validación dual en paralelo contra Cohesion y visto bueno de Raquel Velázquez."
            ],
            "status": "pendiente",
            "statusLabel": "⏳ Pendiente",
            "audit": "<strong>⏳ No Iniciado (Pendiente).</strong> Desarrollo e integración de un clon contable de la plataforma Cohesión a medida para procesar pólizas de ventas y conciliar cuentas bancarias."
        },
        {
            "num": 17,
            "title": "17. Módulo de Rendimiento y Telemetría de Drive-Thru (HME Zoom Nitro)",
            "category": "Sistemas / Hardware",
            "badgeDept": "💻 Sistemas",
            "badgePriority": "🔴 Alta",
            "auditJune": "<strong>✓ Completado e Integrado (Junio 2026).</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru en las sucursales con ventanilla.",
            "auditJuly": "<strong>✓ Completado e Integrado.</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru.",
            "auditAugust": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real de tiempos de espera, cobro y despacho de ventanilla con alertas por cuello de botella.",
            "auditSeptember": "<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real activa en sucursales con ventanilla.",
            "steps": [
                "Conexión con la API/controlador de HME Zoom Nitro.",
                "Métricas en vivo de segundos por vehículo en ventanilla.",
                "Historial de rendimiento y benchmarks entre sucursales."
            ],
            "status": "completado",
            "statusLabel": "✓ Completado",
            "audit": "<strong>✓ Completado e Integrado (Junio 2026).</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru en las sucursales con ventanilla."
        }
    ]
}
};

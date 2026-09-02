/**
 * @module admin/reporte-actividades
 * @description Dashboard 100% nativo en React/Next.js/TypeScript para la visualización interactiva
 * de los informes mensuales de desarrollo, horas trabajadas, cronograma Gantt y auditoría de las 27 tareas canónicas del sistema SM TEG.
 * 
 * @businessRules
 * - Acceso exclusivo para usuarios con rol 'admin' mediante ProtectedRoute.
 * - Fuente única de verdad tipada en TypeScript (lib/reports-data.ts) para Septiembre, Agosto, Julio y Junio 2026.
 * - Reemplaza los archivos HTML estáticos y los PDFs externos por un visor nativo interactivo de alto rendimiento.
 * - Soporta alternancia fluida entre meses y dos pestañas operativas principales:
 *   1. 📊 Reporte Mensual & Cronograma Gantt (jornadas de tienda Lynwood vs desarrollo TEG, tabla bilingüe y desglose de esfuerzo).
 *   2. 📋 Auditoría de las 27 Tareas (filtros por estatus, notas de auditoría del mes y checklist de verificación).
 * - Imprime directamente con estilos limpios para papel Carta sin requerir dependencias externas de PDF.
 * 
 * @dataFlow
 * lib/reports-data.ts (MONTHLY_REPORTS) → este componente → renderizado nativo TSX
 */

'use client';

import React, { useState, useMemo } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useLanguage } from '@/lib/i18n';
import {
    MONTHLY_REPORTS,
    PLANNER_SHIFTS_MAP,
    MonthlyReportData,
    DailyReportRow,
    AuditedTask,
    ModuleEffort,
    ParallelActivity
} from '@/lib/reports-data';
import {
    Calendar,
    Clock,
    Printer,
    Search,
    Shield,
    CheckCircle2,
    Layers,
    Sparkles,
    Filter,
    BarChart3,
    FileText,
    Check,
    AlertTriangle,
    Hourglass,
    Briefcase,
    Building2,
    Laptop,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

type MonthKey = 'septiembre' | 'agosto' | 'julio' | 'junio';
type TabKey = 'reporte' | 'tareas';
type TaskFilter = 'todas' | 'completado' | 'progreso' | 'pendiente';

export default function AdminReporteActividadesPage() {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <ReporteActividadesDashboard />
        </ProtectedRoute>
    );
}

// Helper functions for Gantt calculation
function parseTimeToDecimal(timeStr: string): number | null {
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

interface ParsedSession {
    startStr: string;
    endStr: string;
    startDec: number;
    endDec: number;
    duration: number;
}

function parseSessions(timeSlotStr: string): ParsedSession[] {
    if (!timeSlotStr || timeSlotStr.includes('—')) return [];
    const parts = timeSlotStr.split(/\s*&\s*|\s*,\s*/);
    const sessions: ParsedSession[] = [];
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

function intervalToPercentages(startDec: number, endDec: number): { left: number; width: number } | null {
    const rulerStart = 4.0;
    const rulerEnd = 24.0;
    const rulerTotal = rulerEnd - rulerStart;

    let s = startDec < rulerStart ? startDec + 24.0 : startDec;
    let e = endDec < rulerStart ? endDec + 24.0 : endDec;
    if (e < s) e += 24.0;

    if (s >= rulerEnd) {
        s = Math.max(rulerStart, rulerEnd - Math.min(2.0, e - s));
        e = rulerEnd;
    } else {
        s = Math.max(rulerStart, s);
        e = Math.min(rulerEnd, e);
    }

    if (e <= s) return null;

    const left = ((s - rulerStart) / rulerTotal) * 100;
    const width = ((e - s) / rulerTotal) * 100;
    return { left: Math.max(0, left), width: Math.min(100 - left, width) };
}

function getDayOfWeek(dateStr: string, monthNum: number, year = 2026): string {
    const rawDay = dateStr.split('-')[0].trim().replace(/[^0-9]/g, '');
    const day = parseInt(rawDay, 10);
    if (isNaN(day)) return '';
    const d = new Date(year, monthNum - 1, day);
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[d.getDay()];
}

function getStoreShiftForDate(dateStr: string, monthNum: number, year = 2026): {
    hasShift: boolean;
    startStr?: string;
    endStr?: string;
    hours?: number;
    startDec?: number | null;
    endDec?: number | null;
    label: string;
    badgeText: string;
} {
    const rawDay = dateStr.split('-')[0].trim().replace(/[^0-9]/g, '');
    const day = parseInt(rawDay, 10);
    if (isNaN(day)) return { hasShift: false, label: '🏖️ Día Libre en Tienda Lynwood', badgeText: '🏪 Día Libre en Tienda' };
    const dayPadded = String(day).padStart(2, '0');
    const monthPadded = String(monthNum).padStart(2, '0');
    const isoDate = `${year}-${monthPadded}-${dayPadded}`;

    const shift = PLANNER_SHIFTS_MAP[isoDate];
    if (shift) {
        return {
            hasShift: true,
            startStr: shift.start,
            endStr: shift.end,
            hours: shift.hours,
            startDec: parseTimeToDecimal(shift.start),
            endDec: parseTimeToDecimal(shift.end),
            label: `Turno Lynwood (${shift.hours.toFixed(1)}h): ${shift.start} - ${shift.end} • ${shift.label || 'General Manager'}`,
            badgeText: `🏪 Turno Lynwood: ${shift.start} - ${shift.end} (${shift.hours.toFixed(1)}h)`
        };
    }
    return {
        hasShift: false,
        label: '🏖️ Día Libre en Tienda Lynwood',
        badgeText: '🏪 Día Libre en Tienda'
    };
}

function getMonthNumber(monthId: MonthKey): number {
    switch (monthId) {
        case 'septiembre': return 9;
        case 'agosto': return 8;
        case 'julio': return 7;
        case 'junio': return 6;
        default: return 9;
    }
}

function ReporteActividadesDashboard() {
    const { language } = useLanguage();
    const [selectedMonth, setSelectedMonth] = useState<MonthKey>('septiembre');
    const [activeTab, setActiveTab] = useState<TabKey>('reporte');
    const [searchQuery, setSearchQuery] = useState('');
    const [taskFilter, setTaskFilter] = useState<TaskFilter>('todas');
    const [selectedCategory, setSelectedCategory] = useState<string>('todas');

    const reportData: MonthlyReportData = MONTHLY_REPORTS[selectedMonth] || MONTHLY_REPORTS.septiembre;
    const monthNum = getMonthNumber(selectedMonth);

    // Filtered daily rows
    const filteredRows = useMemo(() => {
        if (!searchQuery.trim()) return reportData.rows;
        const q = searchQuery.toLowerCase();
        return reportData.rows.filter(row =>
            row.date.toLowerCase().includes(q) ||
            row.badges.some(b => b.toLowerCase().includes(q)) ||
            row.descEs.toLowerCase().includes(q) ||
            row.descEn.toLowerCase().includes(q) ||
            row.time.toLowerCase().includes(q)
        );
    }, [reportData.rows, searchQuery]);

    // Filtered tasks
    const filteredTasks = useMemo(() => {
        return reportData.tasks.filter(t => {
            const matchesStatus = taskFilter === 'todas' || t.status === taskFilter;
            const matchesCategory = selectedCategory === 'todas' || t.category === selectedCategory;
            const q = searchQuery.toLowerCase().trim();
            const matchesSearch = !q ||
                t.title.toLowerCase().includes(q) ||
                t.category.toLowerCase().includes(q) ||
                t.badgeDept.toLowerCase().includes(q) ||
                t.audit.toLowerCase().includes(q) ||
                t.steps.some(s => s.toLowerCase().includes(q));

            return matchesStatus && matchesCategory && matchesSearch;
        });
    }, [reportData.tasks, taskFilter, selectedCategory, searchQuery]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-16">
            {/* Top Navigation & Brand Header */}
            <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm print:hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-md shadow-orange-600/20 font-black text-lg">
                                🌮
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black tracking-wider text-slate-500 dark:text-slate-400 uppercase">
                                        Tacos Gavilan • Departamento de Sistemas
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-100 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-700">
                                        SM TEG v2.6.1
                                    </span>
                                </div>
                                <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                                    {language === 'en' ? 'Activity Reports & Task Roadmap' : 'Reporte de Actividades y Auditoría de Tareas'}
                                </h1>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                            <button
                                onClick={handlePrint}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 shadow-sm transition-all"
                            >
                                <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                                <span>{language === 'en' ? 'Print Report' : 'Imprimir'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Month Selection Bar */}
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                        {(['septiembre', 'agosto', 'julio', 'junio'] as MonthKey[]).map(key => {
                            const data = MONTHLY_REPORTS[key];
                            const isActive = selectedMonth === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setSelectedMonth(key)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                                        isActive
                                            ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-500 text-orange-900 dark:text-orange-200 shadow-sm ring-1 ring-orange-500/20'
                                            : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                                    }`}
                                >
                                    <Calendar className={`w-3.5 h-3.5 ${isActive ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400'}`} />
                                    <span>{data.monthYear}</span>
                                    <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                            isActive
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                        }`}
                                    >
                                        {data.totalHours.toFixed(1)}h
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </header>

            {/* Main Content Body */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
                {/* Hero Banner */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="relative z-10 max-w-3xl">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-orange-600/30 text-orange-300 border border-orange-500/30 mb-3">
                            <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                            <span>Informe Oficial de Desarrollo • {reportData.monthYear}</span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
                            📋 Pendientes e Informe de Horas — {reportData.monthYear}
                        </h2>
                        <p className="text-sm sm:text-base text-slate-300 font-medium leading-relaxed">
                            Consolidado de horas de trabajo, distribución de jornadas en Tienda Lynwood y avance de desarrollo sobre las {reportData.totalTasks} tareas del sistema SM TEG.
                        </p>
                    </div>
                </div>

                {/* 5 Stats Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl shrink-0">
                            📁
                        </div>
                        <div>
                            <div className="text-2xl font-black text-slate-900 dark:text-white leading-none">
                                {reportData.totalTasks}
                            </div>
                            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase mt-1">
                                Total Tareas
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-xl shrink-0">
                            ✅
                        </div>
                        <div>
                            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 leading-none">
                                {reportData.completedTasks}
                            </div>
                            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase mt-1">
                                Completadas
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-xl shrink-0">
                            ⚡
                        </div>
                        <div>
                            <div className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none">
                                {reportData.inProgressTasks}
                            </div>
                            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase mt-1">
                                En Progreso
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center text-xl shrink-0">
                            ⏳
                        </div>
                        <div>
                            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 leading-none">
                                {reportData.pendingTasks}
                            </div>
                            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase mt-1">
                                Pendientes
                            </div>
                        </div>
                    </div>

                    <div className="col-span-2 sm:col-span-1 lg:col-span-1 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-orange-50 dark:bg-orange-950/60 flex items-center justify-center text-xl shrink-0">
                            ⏱️
                        </div>
                        <div>
                            <div className="text-2xl font-black text-orange-600 dark:text-orange-400 leading-none">
                                {reportData.totalHours.toFixed(1)}h
                            </div>
                            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase mt-1">
                                Horas {reportData.monthName}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sub-Navigation Tabs */}
                <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('reporte')}
                        className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 ${
                            activeTab === 'reporte'
                                ? 'bg-orange-600 text-white shadow-md shadow-orange-600/25'
                                : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
                        }`}
                    >
                        <BarChart3 className="w-4 h-4" />
                        <span>📊 Reporte Mensual ({reportData.monthYear})</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('tareas')}
                        className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 ${
                            activeTab === 'tareas'
                                ? 'bg-orange-600 text-white shadow-md shadow-orange-600/25'
                                : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
                        }`}
                    >
                        <Layers className="w-4 h-4" />
                        <span>📋 Pendientes del Sistema ({reportData.totalTasks} Tareas)</span>
                    </button>
                </div>

                {/* TAB 1: REPORTE MENSUAL & GANTT */}
                {activeTab === 'reporte' && (
                    <div className="space-y-6">
                        {/* Gantt Header & Master Scale */}
                        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                                        📅 Planificador Visual de Jornada Diaria ({reportData.monthYear})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Horarios exactos del Planificador (Turnos de Tienda Lynwood) cruzados con los bloques reales de programación TEG.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/80 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-lg">
                                        🏪 Turno Presencial Lynwood
                                    </span>
                                    <span className="text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/80 border border-orange-200 dark:border-orange-800 px-2.5 py-1 rounded-lg">
                                        💻 Desarrollo de Software TEG
                                    </span>
                                </div>
                            </div>

                            {/* Ruler Scale */}
                            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 overflow-x-auto">
                                <div className="flex justify-between text-[10px] font-extrabold text-slate-400 dark:text-slate-500 min-w-[600px]">
                                    <span>4 AM</span><span>5 AM</span><span>6 AM</span><span>7 AM</span><span>8 AM</span>
                                    <span>9 AM</span><span>10 AM</span><span>11 AM</span><span>12 PM</span><span>1 PM</span>
                                    <span>2 PM</span><span>3 PM</span><span>4 PM</span><span>5 PM</span><span>6 PM</span>
                                    <span>7 PM</span><span>8 PM</span><span>9 PM</span><span>10 PM</span><span>11 PM</span><span>12 AM</span>
                                </div>
                            </div>
                        </div>

                        {/* Gantt Daily Cards */}
                        <div className="space-y-3">
                            {reportData.rows.map((row, idx) => {
                                const dayName = getDayOfWeek(row.date, monthNum);
                                const sessions = parseSessions(row.time);
                                const shiftInfo = getStoreShiftForDate(row.date, monthNum);

                                return (
                                    <div
                                        key={idx}
                                        className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="bg-slate-900 dark:bg-slate-800 text-white px-2.5 py-1 rounded-lg font-black text-xs">
                                                    {row.date}
                                                </span>
                                                <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400">
                                                    {dayName}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
                                                        shiftInfo.hasShift
                                                            ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                                    }`}
                                                >
                                                    {shiftInfo.badgeText}
                                                </span>
                                                <span className="bg-orange-50 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-900/60 px-2.5 py-0.5 rounded-lg text-xs font-black">
                                                    💻 Dev TEG: {row.hours.toFixed(1)} hrs
                                                </span>
                                            </div>
                                        </div>

                                        {/* Double Track Timeline Bar */}
                                        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 space-y-2">
                                            {/* Store Track */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 w-16 uppercase shrink-0">
                                                    🏪 Tienda
                                                </span>
                                                <div className="flex-1 h-5 bg-slate-200/60 dark:bg-slate-800 rounded-md relative overflow-hidden flex items-center justify-center">
                                                    {shiftInfo.hasShift && shiftInfo.startDec !== null && shiftInfo.startDec !== undefined && shiftInfo.endDec !== null && shiftInfo.endDec !== undefined ? (
                                                        (() => {
                                                            const pos = intervalToPercentages(shiftInfo.startDec, shiftInfo.endDec);
                                                            if (!pos) return null;
                                                            return (
                                                                <div
                                                                    style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                                                                    className="absolute top-0.5 bottom-0.5 bg-blue-600 text-white rounded font-black text-[9px] flex items-center justify-center shadow-sm overflow-hidden whitespace-nowrap px-1"
                                                                    title={shiftInfo.label}
                                                                >
                                                                    🏪 Lynwood {shiftInfo.startStr} - {shiftInfo.endStr} ({shiftInfo.hours}h)
                                                                </div>
                                                            );
                                                        })()
                                                    ) : (
                                                        <span className="text-[10px] italic font-semibold text-slate-400 dark:text-slate-500">
                                                            🏖️ Día Libre en Tienda Lynwood
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Dev Software Track */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black text-orange-600 dark:text-orange-400 w-16 uppercase shrink-0">
                                                    💻 Sistema
                                                </span>
                                                <div className="flex-1 h-5 bg-slate-200/60 dark:bg-slate-800 rounded-md relative overflow-hidden">
                                                    {sessions.map((sess, sIdx) => {
                                                        const pos = intervalToPercentages(sess.startDec, sess.endDec);
                                                        if (!pos) return null;
                                                        return (
                                                            <div
                                                                key={sIdx}
                                                                style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                                                                className="absolute top-0.5 bottom-0.5 bg-orange-500 text-white rounded font-black text-[9px] flex items-center justify-center shadow-sm overflow-hidden whitespace-nowrap px-1"
                                                                title={`${sess.startStr} - ${sess.endStr} (${sess.duration}h)`}
                                                            >
                                                                💻 {sess.duration}h
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Sessions Footer */}
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                                            <span className="font-extrabold text-slate-900 dark:text-white">⏱️ Sesiones Registradas:</span>
                                            {sessions.map((sess, sIdx) => (
                                                <span key={sIdx} className="inline-flex items-center gap-1 font-medium">
                                                    <span className="text-orange-500">●</span>
                                                    <strong>{sess.startStr} - {sess.endStr}</strong> ({sess.duration}h)
                                                    {sIdx < sessions.length - 1 && <span className="text-slate-300 dark:text-slate-700 ml-1">|</span>}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Search & Filter Controls for Table */}
                        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
                            <div className="relative w-full sm:w-96">
                                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar fecha, módulo o descripción..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                            </div>

                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 self-end sm:self-center">
                                Mostrando <span className="font-extrabold text-slate-900 dark:text-white">{filteredRows.length}</span> de {reportData.rows.length} días registrados
                            </div>
                        </div>

                        {/* Activities Table */}
                        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-orange-500" />
                                    <span>Detalle Diario de Actividades Bilingüe ({reportData.monthYear})</span>
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Registro cronológico de tareas de desarrollo, auditorías y pruebas realizadas.
                                </p>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-900 text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                            <th className="px-4 py-3 w-28">Fecha / Date</th>
                                            <th className="px-4 py-3 w-48">Horario / Time</th>
                                            <th className="px-4 py-3 w-24 text-center">Horas</th>
                                            <th className="px-4 py-3 w-48">Módulos</th>
                                            <th className="px-4 py-3">Descripción de Actividades (Español / English)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                        {filteredRows.map((row, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white whitespace-nowrap align-top">
                                                    {row.date}
                                                </td>
                                                <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400 whitespace-nowrap align-top font-medium">
                                                    {row.time}
                                                </td>
                                                <td className="px-4 py-3.5 text-center align-top">
                                                    <span className="inline-block font-black text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/80 px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-900/60">
                                                        {row.hours.toFixed(1)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3.5 align-top">
                                                    <div className="flex flex-wrap gap-1">
                                                        {row.badges.map((b, bIdx) => (
                                                            <span
                                                                key={bIdx}
                                                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                                                            >
                                                                {b}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3.5 align-top space-y-2">
                                                    <div
                                                        className="text-slate-800 dark:text-slate-200 leading-relaxed text-[12px]"
                                                        dangerouslySetInnerHTML={{ __html: row.descEs }}
                                                    />
                                                    {row.descEn && (
                                                        <div
                                                            className="text-slate-500 dark:text-slate-400 text-[11px] italic border-t border-slate-100 dark:border-slate-800/80 pt-1.5 leading-relaxed"
                                                            dangerouslySetInnerHTML={{ __html: row.descEn }}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Parallel Activities Section */}
                        {reportData.parallelActivities && reportData.parallelActivities.length > 0 && (
                            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                                <div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                                        🔬 Actividades Paralelas, Pruebas y Diagnóstico ({reportData.monthYear})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Trabajos técnicos de validación física en restaurantes, auditoría de bases de datos y diseño.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {reportData.parallelActivities.map((act, aIdx) => (
                                        <div
                                            key={aIdx}
                                            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between"
                                        >
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="font-extrabold text-sm text-slate-900 dark:text-white">
                                                        {act.title}
                                                    </h4>
                                                    <span className="px-2 py-0.5 rounded text-xs font-black bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                                                        {act.hours.toFixed(1)} hrs
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                                    {act.desc}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Effort Summary Breakdown */}
                        {reportData.effortSummary && reportData.effortSummary.length > 0 && (
                            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                                <div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                                        📊 Resumen de Esfuerzo por Módulo ({reportData.monthYear})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Distribución proporcional de horas dedicadas por área de impacto en SM TEG.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {reportData.effortSummary.map((eff, effIdx) => {
                                        const percentage = reportData.totalHours > 0
                                            ? Math.min(100, (eff.hours / reportData.totalHours) * 100)
                                            : 0;
                                        return (
                                            <div key={effIdx} className="space-y-1">
                                                <div className="flex items-center justify-between text-xs font-bold">
                                                    <span className="text-slate-800 dark:text-slate-200">{eff.module}</span>
                                                    <span className="text-slate-500 dark:text-slate-400">
                                                        {eff.hours.toFixed(1)} hrs ({percentage.toFixed(0)}%)
                                                    </span>
                                                </div>
                                                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-orange-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${percentage}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 2: AUDITORÍA DE LAS 27 TAREAS */}
                {activeTab === 'tareas' && (
                    <div className="space-y-6">
                        {/* Filter and Search Bar for Tasks */}
                        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
                            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                                {(
                                    [
                                        { id: 'todas', label: `Todas (${reportData.tasks.length})` },
                                        { id: 'completado', label: `✓ Completadas (${reportData.completedTasks})` },
                                        { id: 'progreso', label: `⚡ En Progreso (${reportData.inProgressTasks})` },
                                        { id: 'pendiente', label: `⏳ Pendientes (${reportData.pendingTasks})` }
                                    ] as Array<{ id: TaskFilter; label: string }>
                                ).map(f => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => setTaskFilter(f.id)}
                                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                                            taskFilter === f.id
                                                ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                        }`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>

                            <div className="relative w-full md:w-72">
                                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar tarea, regla o paso..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                            </div>
                        </div>

                        {/* Task Cards Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredTasks.map(task => {
                                const isCompleted = task.status === 'completado';
                                const isProgress = task.status === 'progreso';

                                return (
                                    <div
                                        key={task.num}
                                        className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
                                    >
                                        <div className="space-y-3">
                                            {/* Tag Badges */}
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-900 text-white uppercase tracking-wider">
                                                    {task.category}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                    {task.badgeDept}
                                                </span>
                                                <span
                                                    className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                                                        isCompleted
                                                            ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                                            : isProgress
                                                            ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                                                            : 'bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                                    }`}
                                                >
                                                    {task.statusLabel}
                                                </span>
                                            </div>

                                            {/* Title */}
                                            <h3 className="text-sm font-black text-slate-900 dark:text-white leading-snug">
                                                {task.title}
                                            </h3>

                                            {/* Audit Callout Box */}
                                            <div
                                                className={`p-3 rounded-xl text-xs leading-relaxed border ${
                                                    isCompleted
                                                        ? 'bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800/60'
                                                        : isProgress
                                                        ? 'bg-amber-50/70 dark:bg-amber-950/30 text-amber-950 dark:text-amber-200 border-amber-200 dark:border-amber-800/60'
                                                        : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                                                }`}
                                                dangerouslySetInnerHTML={{ __html: task.audit }}
                                            />
                                        </div>

                                        {/* Verification Steps Checklist */}
                                        {task.steps && task.steps.length > 0 && (
                                            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                    📋 Puntos de Avance & Verificación
                                                </div>
                                                <div className="space-y-1.5">
                                                    {task.steps.map((step, sIdx) => (
                                                        <div key={sIdx} className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 leading-tight">
                                                            <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold text-[9px] flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 mt-0.5">
                                                                {sIdx + 1}
                                                            </span>
                                                            <span>{step}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

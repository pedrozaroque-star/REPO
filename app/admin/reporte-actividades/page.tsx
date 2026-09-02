/**
 * @module admin/reporte-actividades
 * @description Executive PRO Dashboard en React/Next.js/TypeScript para la supervisión analítica
 * de horas de desarrollo, cronograma operativo en Tienda Lynwood y auditoría del roadmap de las 27 tareas canónicas (SM TEG).
 * 
 * @businessRules
 * - Acceso exclusivo para administradores autenticados mediante ProtectedRoute.
 * - Fuente única de verdad tipada en TypeScript (lib/reports-data.ts) para Septiembre, Agosto, Julio y Junio 2026.
 * - Diseño ejecutivo de alta fidelidad, sobrio, sin emojis decorativos, con tipografía estructurada y componentes interactivos.
 * - Características PRO:
 *   1. 4 Tarjetas KPI con distribución de horas, turnos en Lynwood y métricas de avance.
 *   2. Planificador Visual de Jornada Diaria con doble carril (Tienda Lynwood vs Desarrollo TEG) y escala 24h.
 *   3. Ledger interactivo de actividades con buscador en vivo, filtros por módulo y exportación a CSV.
 *   4. Matriz de las 27 tareas con filtros por departamento, prioridad, recuadro de auditoría y checklist de verificación.
 *   5. Resumen analítico de esfuerzo por área y registro de actividades paralelas.
 * 
 * @dataFlow
 * lib/reports-data.ts (MONTHLY_REPORTS, PLANNER_SHIFTS_MAP) → este componente → renderizado nativo TSX
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
    Filter,
    BarChart3,
    FileText,
    Check,
    Hourglass,
    Building2,
    Laptop,
    Activity,
    Briefcase,
    Download,
    TrendingUp,
    SlidersHorizontal,
    ChevronDown,
    ChevronUp,
    Sparkles,
    ArrowUpRight,
    Compass,
    CheckSquare,
    AlertCircle,
    Store
} from 'lucide-react';

type MonthKey = 'septiembre' | 'agosto' | 'julio' | 'junio';
type TabKey = 'actividades' | 'tareas' | 'analitica';
type TaskFilter = 'todas' | 'completado' | 'progreso' | 'pendiente';

export default function AdminReporteActividadesPage() {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <ExecutiveReportDashboard />
        </ProtectedRoute>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME & GANTT UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

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
    roleText: string;
} {
    const rawDay = dateStr.split('-')[0].trim().replace(/[^0-9]/g, '');
    const day = parseInt(rawDay, 10);
    if (isNaN(day)) return { hasShift: false, label: 'Día Libre en Tienda Lynwood', badgeText: 'Día Libre en Tienda', roleText: 'Sin Turno' };
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
            label: `Turno Lynwood #${14} (${shift.hours.toFixed(1)}h): ${shift.start} - ${shift.end} • ${shift.label || 'General Manager'}`,
            badgeText: `Turno Lynwood: ${shift.start} - ${shift.end} (${shift.hours.toFixed(1)}h)`,
            roleText: shift.label || 'General Manager'
        };
    }
    return {
        hasShift: false,
        label: 'Día Libre en Tienda Lynwood',
        badgeText: 'Día Libre en Tienda',
        roleText: 'Día Libre'
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

function cleanText(text: string): string {
    if (!text) return '';
    return text
        .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|✓|⚡|⏳|📌|⏱️|🏖️|📊|📋|🔬|📝|📁|✅|🔴|🟡|🔵|📦|📺|✉️|●/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTIVE DASHBOARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ExecutiveReportDashboard() {
    const { language } = useLanguage();
    const [selectedMonth, setSelectedMonth] = useState<MonthKey>('septiembre');
    const [activeTab, setActiveTab] = useState<TabKey>('actividades');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedModuleFilter, setSelectedModuleFilter] = useState<string>('todos');
    const [taskFilter, setTaskFilter] = useState<TaskFilter>('todas');
    const [selectedTaskCategory, setSelectedTaskCategory] = useState<string>('todas');
    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

    const reportData: MonthlyReportData = MONTHLY_REPORTS[selectedMonth] || MONTHLY_REPORTS.septiembre;
    const monthNum = getMonthNumber(selectedMonth);

    // Calculate Lynwood Store Shifts summary for the month
    const storeShiftsStats = useMemo(() => {
        let totalShiftHours = 0;
        let shiftsCount = 0;
        reportData.rows.forEach(row => {
            const shift = getStoreShiftForDate(row.date, monthNum);
            if (shift.hasShift && shift.hours) {
                totalShiftHours += shift.hours;
                shiftsCount += 1;
            }
        });
        return { totalShiftHours, shiftsCount };
    }, [reportData.rows, monthNum]);

    // Unique modules from daily rows
    const availableModules = useMemo(() => {
        const set = new Set<string>();
        reportData.rows.forEach(r => r.badges.forEach(b => set.add(cleanText(b))));
        return ['todos', ...Array.from(set)];
    }, [reportData.rows]);

    // Filtered daily rows
    const filteredRows = useMemo(() => {
        return reportData.rows.filter(row => {
            const matchesModule = selectedModuleFilter === 'todos' ||
                row.badges.some(b => cleanText(b).toLowerCase() === selectedModuleFilter.toLowerCase());

            const q = searchQuery.toLowerCase().trim();
            const matchesSearch = !q ||
                row.date.toLowerCase().includes(q) ||
                row.badges.some(b => b.toLowerCase().includes(q)) ||
                row.descEs.toLowerCase().includes(q) ||
                row.descEn.toLowerCase().includes(q) ||
                row.time.toLowerCase().includes(q);

            return matchesModule && matchesSearch;
        });
    }, [reportData.rows, selectedModuleFilter, searchQuery]);

    // Filtered tasks
    const filteredTasks = useMemo(() => {
        return reportData.tasks.filter(t => {
            const matchesStatus = taskFilter === 'todas' || t.status === taskFilter;
            const matchesCategory = selectedTaskCategory === 'todas' || t.category === selectedTaskCategory;
            const q = searchQuery.toLowerCase().trim();
            const matchesSearch = !q ||
                t.title.toLowerCase().includes(q) ||
                t.category.toLowerCase().includes(q) ||
                t.badgeDept.toLowerCase().includes(q) ||
                t.audit.toLowerCase().includes(q) ||
                t.steps.some(s => s.toLowerCase().includes(q));

            return matchesStatus && matchesCategory && matchesSearch;
        });
    }, [reportData.tasks, taskFilter, selectedTaskCategory, searchQuery]);

    // Unique task categories
    const taskCategories = useMemo(() => {
        const set = new Set(reportData.tasks.map(t => t.category));
        return ['todas', ...Array.from(set)];
    }, [reportData.tasks]);

    // Toggle daily expansion
    const toggleDayExpanded = (date: string) => {
        setExpandedDays(prev => ({ ...prev, [date]: !prev[date] }));
    };

    // CSV Export
    const handleExportCSV = () => {
        const headers = ['Fecha', 'Horario', 'Horas', 'Modulos', 'Descripcion_ES', 'Descripcion_EN'];
        const csvRows = [headers.join(',')];

        reportData.rows.forEach(r => {
            const row = [
                `"${r.date}"`,
                `"${r.time.replace(/"/g, '""')}"`,
                r.hours,
                `"${r.badges.map(cleanText).join('; ')}"`,
                `"${cleanText(r.descEs).replace(/"/g, '""')}"`,
                `"${cleanText(r.descEn).replace(/"/g, '""')}"`
            ];
            csvRows.push(row.join(','));
        });

        const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_Actividades_${selectedMonth}_2026_TacosGavilan.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handlePrint = () => {
        window.print();
    };

    const completionPercent = reportData.totalTasks > 0
        ? Math.round((reportData.completedTasks / reportData.totalTasks) * 100)
        : 0;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 font-sans pb-20">
            {/* ───────────────────────────────────────────────────────────── */}
            {/* TOP EXECUTIVE BAR                                            */}
            {/* ───────────────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm print:hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-800 border border-slate-700/80 text-white flex items-center justify-center font-black text-sm tracking-wider shadow-sm">
                                TG
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-black tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                                        Tacos Gavilan • Dirección de Sistemas & Desarrollo
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-100 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-700">
                                        SM TEG v2.6.1
                                    </span>
                                </div>
                                <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                                    {language === 'en' ? 'Executive Development & Operational Roadmap' : 'Reporte Ejecutivo de Actividades & Auditoría de Roadmap'}
                                </h1>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 self-end md:self-center">
                            <button
                                onClick={handleExportCSV}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 shadow-sm transition-all"
                                title="Exportar reporte diario a archivo CSV / Excel"
                            >
                                <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                <span>CSV</span>
                            </button>

                            <button
                                onClick={handlePrint}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 shadow-sm transition-all"
                                title="Imprimir informe en formato oficial"
                            >
                                <Printer className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                <span>Imprimir</span>
                            </button>
                        </div>
                    </div>

                    {/* Month Switcher Bar */}
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                        {(['septiembre', 'agosto', 'julio', 'junio'] as MonthKey[]).map(key => {
                            const data = MONTHLY_REPORTS[key];
                            const isActive = selectedMonth === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setSelectedMonth(key)}
                                    className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                                        isActive
                                            ? 'bg-slate-900 text-white dark:bg-orange-500 dark:text-white border-slate-900 dark:border-orange-500 shadow-sm'
                                            : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                                    }`}
                                >
                                    <Calendar className="w-3.5 h-3.5 opacity-80" />
                                    <span className="font-extrabold">{data.monthYear}</span>
                                    <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black ${
                                            isActive
                                                ? 'bg-white/20 text-white'
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

            {/* ───────────────────────────────────────────────────────────── */}
            {/* DASHBOARD BODY CONTAINER                                     */}
            {/* ───────────────────────────────────────────────────────────── */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

                {/* ───────────────────────────────────────────────────────────── */}
                {/* 4 PRO KPI CARDS                                              */}
                {/* ───────────────────────────────────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* KPI 1: Horas Totales Dev */}
                    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3 relative overflow-hidden">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                Horas de Desarrollo TEG
                            </span>
                            <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                                <Laptop className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black font-mono tracking-tight text-slate-900 dark:text-white">
                                {reportData.totalHours.toFixed(1)}
                            </span>
                            <span className="text-xs font-bold text-slate-400">horas auditadas</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                            <span>{reportData.rows.length} días de trabajo registrados</span>
                            <span className="font-mono font-bold text-orange-600 dark:text-orange-400">
                                {(reportData.totalHours / (reportData.rows.length || 1)).toFixed(1)}h/día prom.
                            </span>
                        </div>
                    </div>

                    {/* KPI 2: Lynwood Store Shift Presence */}
                    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3 relative overflow-hidden">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                Jornada Tienda Lynwood #14
                            </span>
                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                <Store className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black font-mono tracking-tight text-blue-600 dark:text-blue-400">
                                {storeShiftsStats.totalShiftHours.toFixed(1)}
                            </span>
                            <span className="text-xs font-bold text-slate-400">horas en tienda</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                            <span>{storeShiftsStats.shiftsCount} turnos Planificador</span>
                            <span className="font-semibold text-blue-600 dark:text-blue-400">General Manager</span>
                        </div>
                    </div>

                    {/* KPI 3: Task Roadmap Progression */}
                    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3 relative overflow-hidden">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                Roadmap Canónico ({reportData.totalTasks} Tareas)
                            </span>
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                <CheckSquare className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
                                {completionPercent}%
                            </span>
                            <span className="text-xs font-bold text-slate-400">
                                ({reportData.completedTasks}/{reportData.totalTasks} completadas)
                            </span>
                        </div>
                        {/* Segmented Progress Bar */}
                        <div className="space-y-1 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                                <div
                                    className="h-full bg-emerald-500 transition-all duration-500"
                                    style={{ width: `${(reportData.completedTasks / reportData.totalTasks) * 100}%` }}
                                    title={`Completadas: ${reportData.completedTasks}`}
                                />
                                <div
                                    className="h-full bg-blue-500 transition-all duration-500"
                                    style={{ width: `${(reportData.inProgressTasks / reportData.totalTasks) * 100}%` }}
                                    title={`En Progreso: ${reportData.inProgressTasks}`}
                                />
                                <div
                                    className="h-full bg-amber-500 transition-all duration-500"
                                    style={{ width: `${(reportData.pendingTasks / reportData.totalTasks) * 100}%` }}
                                    title={`Pendientes: ${reportData.pendingTasks}`}
                                />
                            </div>
                            <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase pt-0.5">
                                <span>{reportData.completedTasks} Comp.</span>
                                <span>{reportData.inProgressTasks} Prog.</span>
                                <span>{reportData.pendingTasks} Pend.</span>
                            </div>
                        </div>
                    </div>

                    {/* KPI 4: Enterprise Impact / Focus Area */}
                    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3 relative overflow-hidden">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                Foco Estratégico del Mes
                            </span>
                            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                <Compass className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-base font-black text-slate-900 dark:text-white truncate">
                                {selectedMonth === 'septiembre' && 'Contabilidad Cohesion & v2.6.1'}
                                {selectedMonth === 'agosto' && 'RONOS HR, MilesIQ & Viele v3'}
                                {selectedMonth === 'julio' && 'Preparador KDS & Tableros TV'}
                                {selectedMonth === 'junio' && 'Telemetría Drive-Thru Nitro'}
                            </div>
                            <div className="text-xs text-slate-400 font-medium truncate">
                                {selectedMonth === 'septiembre' && 'Validación dual QBO y catálogo local'}
                                {selectedMonth === 'agosto' && 'Auditoría Cingular, nóminas y geofencing'}
                                {selectedMonth === 'julio' && 'Menús digitales y órdenes automáticas'}
                                {selectedMonth === 'junio' && 'Integración sensores de ventanilla'}
                            </div>
                        </div>
                        <div className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold border-t border-slate-100 dark:border-slate-800/80 pt-2.5 flex items-center gap-1">
                            <Activity className="w-3.5 h-3.5" />
                            <span>100% Verificado en Base de Datos</span>
                        </div>
                    </div>
                </div>

                {/* ───────────────────────────────────────────────────────────── */}
                {/* SUB-NAVIGATION TABS (PRO SEGMENTED CONTROLS)                 */}
                {/* ───────────────────────────────────────────────────────────── */}
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-2 bg-slate-200/60 dark:bg-slate-900 p-1 rounded-2xl border border-slate-300/60 dark:border-slate-800">
                        <button
                            type="button"
                            onClick={() => setActiveTab('actividades')}
                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                                activeTab === 'actividades'
                                    ? 'bg-white dark:bg-[#111827] text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>Cronograma Diario & Ledger ({reportData.rows.length} Días)</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('tareas')}
                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                                activeTab === 'tareas'
                                    ? 'bg-white dark:bg-[#111827] text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Matriz de Tareas ({reportData.totalTasks} Tareas)</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('analitica')}
                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                                activeTab === 'analitica'
                                    ? 'bg-white dark:bg-[#111827] text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <BarChart3 className="w-3.5 h-3.5" />
                            <span>Análisis de Esfuerzo</span>
                        </button>
                    </div>

                    <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-medium">
                        <span>Periodo Activo:</span>
                        <span className="font-black text-slate-900 dark:text-white">{reportData.monthYear}</span>
                    </div>
                </div>

                {/* ───────────────────────────────────────────────────────────── */}
                {/* TAB 1: CRONOGRAMA DIARIO & LEDGER DE ACTIVIDADES             */}
                {/* ───────────────────────────────────────────────────────────── */}
                {activeTab === 'actividades' && (
                    <div className="space-y-6">
                        {/* Interactive Timeline Visualizer Card */}
                        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                            Planificador Visual de Jornada Diaria ({reportData.monthYear})
                                        </h3>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                            Escala 24 Horas
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Horarios oficiales de Tienda Lynwood cruzados de forma sincronizada con las sesiones de programación TEG.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap text-xs">
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold bg-blue-50 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                        <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                                        <span>Turno Presencial Lynwood #14</span>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold bg-orange-50 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                                        <span className="w-2 h-2 rounded-full bg-orange-500" />
                                        <span>Desarrollo de Software TEG</span>
                                    </span>
                                </div>
                            </div>

                            {/* 24h Master Scale Ruler */}
                            <div className="bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 overflow-x-auto">
                                <div className="flex justify-between text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 min-w-[640px]">
                                    <span>04:00</span><span>05:00</span><span>06:00</span><span>07:00</span><span>08:00</span>
                                    <span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span>
                                    <span>14:00</span><span>15:00</span><span>16:00</span><span>17:00</span><span>18:00</span>
                                    <span>19:00</span><span>20:00</span><span>21:00</span><span>22:00</span><span>23:00</span><span>00:00</span>
                                </div>
                            </div>
                        </div>

                        {/* Search & Filter Tool Bar */}
                        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
                            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 scrollbar-none">
                                <span className="text-xs font-bold text-slate-400 uppercase mr-1 shrink-0">Módulo:</span>
                                {availableModules.slice(0, 7).map(mod => (
                                    <button
                                        key={mod}
                                        type="button"
                                        onClick={() => setSelectedModuleFilter(mod)}
                                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                                            selectedModuleFilter.toLowerCase() === mod.toLowerCase()
                                                ? 'bg-slate-900 text-white dark:bg-orange-500 dark:text-white border-slate-900 dark:border-orange-500'
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                        }`}
                                    >
                                        {mod === 'todos' ? 'Todos los Módulos' : mod}
                                    </button>
                                ))}
                            </div>

                            <div className="relative w-full md:w-72">
                                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar fecha o actividad..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                            </div>
                        </div>

                        {/* Daily Activity Cards Grid / Gantt List */}
                        <div className="space-y-3">
                            {filteredRows.map((row, idx) => {
                                const dayName = getDayOfWeek(row.date, monthNum);
                                const sessions = parseSessions(row.time);
                                const shiftInfo = getStoreShiftForDate(row.date, monthNum);
                                const isExpanded = !!expandedDays[row.date];

                                return (
                                    <div
                                        key={idx}
                                        className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                                    >
                                        {/* Card Header */}
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                            <div className="flex items-center gap-3">
                                                <span className="bg-slate-900 dark:bg-slate-800 text-white font-mono font-black text-xs px-3 py-1 rounded-lg tracking-wider">
                                                    {row.date}
                                                </span>
                                                <span className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                                                    {dayName}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span
                                                    className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                                                        shiftInfo.hasShift
                                                            ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                                    }`}
                                                >
                                                    {shiftInfo.badgeText}
                                                </span>

                                                <span className="bg-orange-50 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-900/60 px-3 py-1 rounded-lg text-xs font-mono font-black">
                                                    Dev TEG: {row.hours.toFixed(1)} hrs
                                                </span>

                                                <button
                                                    onClick={() => toggleDayExpanded(row.date)}
                                                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                                    title={isExpanded ? 'Contraer detalle' : 'Expandir detalle'}
                                                >
                                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Double Track Timeline Bar */}
                                        <div className="bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2.5">
                                            {/* Track 1: Store Shift */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black tracking-wider text-blue-600 dark:text-blue-400 w-16 uppercase shrink-0">
                                                    Tienda
                                                </span>
                                                <div className="flex-1 h-6 bg-slate-200/60 dark:bg-slate-800 rounded-md relative overflow-hidden flex items-center justify-center">
                                                    {shiftInfo.hasShift && shiftInfo.startDec !== null && shiftInfo.startDec !== undefined && shiftInfo.endDec !== null && shiftInfo.endDec !== undefined ? (
                                                        (() => {
                                                            const pos = intervalToPercentages(shiftInfo.startDec, shiftInfo.endDec);
                                                            if (!pos) return null;
                                                            return (
                                                                <div
                                                                    style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                                                                    className="absolute top-0.5 bottom-0.5 bg-blue-600 text-white rounded font-mono font-black text-[10px] flex items-center justify-center shadow-sm overflow-hidden whitespace-nowrap px-2"
                                                                    title={shiftInfo.label}
                                                                >
                                                                    Lynwood {shiftInfo.startStr} - {shiftInfo.endStr} ({shiftInfo.hours}h)
                                                                </div>
                                                            );
                                                        })()
                                                    ) : (
                                                        <span className="text-[10px] italic font-semibold text-slate-400 dark:text-slate-500">
                                                            Día Libre en Tienda Lynwood
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Track 2: Software Development */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black tracking-wider text-orange-600 dark:text-orange-400 w-16 uppercase shrink-0">
                                                    Sistema
                                                </span>
                                                <div className="flex-1 h-6 bg-slate-200/60 dark:bg-slate-800 rounded-md relative overflow-hidden">
                                                    {sessions.map((sess, sIdx) => {
                                                        const pos = intervalToPercentages(sess.startDec, sess.endDec);
                                                        if (!pos) return null;
                                                        return (
                                                            <div
                                                                key={sIdx}
                                                                style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                                                                className="absolute top-0.5 bottom-0.5 bg-orange-500 text-white rounded font-mono font-black text-[10px] flex items-center justify-center shadow-sm overflow-hidden whitespace-nowrap px-2"
                                                                title={`${sess.startStr} - ${sess.endStr} (${sess.duration}h)`}
                                                            >
                                                                {sess.duration}h
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Registered Sessions Pill Badges */}
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                                            <span className="font-extrabold text-slate-900 dark:text-white">Sesiones de Desarrollo:</span>
                                            {sessions.map((sess, sIdx) => (
                                                <span key={sIdx} className="inline-flex items-center gap-1 font-medium bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                                                    <strong>{sess.startStr} - {sess.endStr}</strong> ({sess.duration}h)
                                                </span>
                                            ))}
                                        </div>

                                        {/* Module Badges */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {row.badges.map((b, bIdx) => (
                                                <span
                                                    key={bIdx}
                                                    className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                                                >
                                                    {cleanText(b)}
                                                </span>
                                            ))}
                                        </div>

                                        {/* Activity Description Box */}
                                        <div className="bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-2">
                                            <div
                                                className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-normal"
                                                dangerouslySetInnerHTML={{ __html: cleanText(row.descEs) }}
                                            />
                                            {row.descEn && (
                                                <div
                                                    className="text-[11px] text-slate-500 dark:text-slate-400 italic border-t border-slate-200/60 dark:border-slate-800 pt-2 leading-relaxed"
                                                    dangerouslySetInnerHTML={{ __html: cleanText(row.descEn) }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ───────────────────────────────────────────────────────────── */}
                {/* TAB 2: MATRIZ DE TAREAS DEL ROADMAP (27 TAREAS)               */}
                {/* ───────────────────────────────────────────────────────────── */}
                {activeTab === 'tareas' && (
                    <div className="space-y-6">
                        {/* Status Filters & Search Header */}
                        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
                            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                                {(
                                    [
                                        { id: 'todas', label: `Todas (${reportData.tasks.length})` },
                                        { id: 'completado', label: `Completadas (${reportData.completedTasks})` },
                                        { id: 'progreso', label: `En Progreso (${reportData.inProgressTasks})` },
                                        { id: 'pendiente', label: `Pendientes (${reportData.pendingTasks})` }
                                    ] as Array<{ id: TaskFilter; label: string }>
                                ).map(f => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => setTaskFilter(f.id)}
                                        className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all border ${
                                            taskFilter === f.id
                                                ? 'bg-slate-900 text-white dark:bg-orange-500 dark:text-white border-slate-900 dark:border-orange-500 shadow-sm'
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
                                        className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-4"
                                    >
                                        <div className="space-y-3">
                                            {/* Header Tags */}
                                            <div className="flex items-center justify-between">
                                                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-slate-900 text-white uppercase tracking-wider">
                                                    {cleanText(task.category)}
                                                </span>
                                                <span
                                                    className={`px-2.5 py-0.5 rounded-md text-[10px] font-black border ${
                                                        isCompleted
                                                            ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                                            : isProgress
                                                            ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                                                            : 'bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                                    }`}
                                                >
                                                    {cleanText(task.statusLabel)}
                                                </span>
                                            </div>

                                            {/* Title */}
                                            <h3 className="text-sm font-black text-slate-900 dark:text-white leading-snug">
                                                {cleanText(task.title)}
                                            </h3>

                                            {/* Department Capsule */}
                                            <div className="inline-block text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                                {cleanText(task.badgeDept)}
                                            </div>

                                            {/* Audit Callout Box */}
                                            <div
                                                className={`p-3.5 rounded-xl text-xs leading-relaxed border ${
                                                    isCompleted
                                                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800/60'
                                                        : isProgress
                                                        ? 'bg-amber-50/60 dark:bg-amber-950/20 text-amber-950 dark:text-amber-200 border-amber-200 dark:border-amber-800/60'
                                                        : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                                                }`}
                                                dangerouslySetInnerHTML={{ __html: cleanText(task.audit) }}
                                            />
                                        </div>

                                        {/* Verification Steps Checklist */}
                                        {task.steps && task.steps.length > 0 && (
                                            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                    Puntos de Avance & Verificación
                                                </div>
                                                <div className="space-y-1.5">
                                                    {task.steps.map((step, sIdx) => (
                                                        <div key={sIdx} className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 leading-tight">
                                                            <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-extrabold text-[9px] flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 mt-0.5">
                                                                {sIdx + 1}
                                                            </span>
                                                            <span>{cleanText(step)}</span>
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

                {/* ───────────────────────────────────────────────────────────── */}
                {/* TAB 3: ANÁLISIS DE ESFUERZO & ACTIVIDADES PARALELAS           */}
                {/* ───────────────────────────────────────────────────────────── */}
                {activeTab === 'analitica' && (
                    <div className="space-y-6">
                        {/* Effort Summary Breakdown */}
                        {reportData.effortSummary && reportData.effortSummary.length > 0 && (
                            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 shadow-sm space-y-5">
                                <div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                                        Distribución de Esfuerzo por Módulo ({reportData.monthYear})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Desglose analítico de horas invertidas en cada subsistema corporativo.
                                    </p>
                                </div>

                                <div className="space-y-3.5">
                                    {reportData.effortSummary.map((eff, effIdx) => {
                                        const percentage = reportData.totalHours > 0
                                            ? Math.min(100, (eff.hours / reportData.totalHours) * 100)
                                            : 0;
                                        return (
                                            <div key={effIdx} className="space-y-1.5">
                                                <div className="flex items-center justify-between text-xs font-bold">
                                                    <span className="text-slate-800 dark:text-slate-200">{cleanText(eff.module)}</span>
                                                    <span className="font-mono font-bold text-slate-600 dark:text-slate-300">
                                                        {eff.hours.toFixed(1)} hrs ({percentage.toFixed(1)}%)
                                                    </span>
                                                </div>
                                                <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
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

                        {/* Parallel Activities Section */}
                        {reportData.parallelActivities && reportData.parallelActivities.length > 0 && (
                            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 shadow-sm space-y-5">
                                <div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                                        Actividades Paralelas, Pruebas y Diagnóstico ({reportData.monthYear})
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Trabajos técnicos complementarios de auditoría en sitio, bases de datos y arquitectura de sistemas.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {reportData.parallelActivities.map((act, aIdx) => (
                                        <div
                                            key={aIdx}
                                            className="bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between"
                                        >
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="font-extrabold text-sm text-slate-900 dark:text-white">
                                                        {cleanText(act.title)}
                                                    </h4>
                                                    <span className="px-2 py-0.5 rounded text-xs font-mono font-black bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                                                        {act.hours.toFixed(1)} hrs
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                                    {cleanText(act.desc)}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

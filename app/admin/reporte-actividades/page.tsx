/**
 * @module admin/reporte-actividades
 * @description Admin-only module to view and interact with the full monthly development reports and hour roadmaps (August, July, June 2026).
 * @businessRules
 * - Exclusive access for users with role 'admin'.
 * - Eliminates static PDFs in favor of responsive, interactive, self-contained HTML reports.
 * - Supports monthly switching tabs: Agosto (97.76 hrs), Julio (117.8 hrs), Junio (190.5 hrs).
 * - Allows full-screen preview, direct printing, and opening in standalone browser tabs.
 * @dataFlow
 * - Communicates with /api/admin/reports?month={selectedMonth} via an embedded iframe.
 * @notes
 * - Completely responsive and styled to match TEG modern administrative design standards.
 */

'use client';

import React, { useState, useRef } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useLanguage } from '@/lib/i18n';
import {
    Calendar,
    Clock,
    Printer,
    ExternalLink,
    RefreshCw,
    Shield,
    CheckCircle2,
    Layers,
    Sparkles
} from 'lucide-react';

interface ReportMonthOption {
    id: 'agosto' | 'julio' | 'junio';
    label: string;
    sublabel: string;
    hours: string;
    tasks: string;
    badgeColor: string;
    activeBorderColor: string;
}

const MONTHS_CATALOG: ReportMonthOption[] = [
    {
        id: 'agosto',
        label: 'Agosto 2026',
        sublabel: 'Planificador Gantt & 27 Tareas',
        hours: '169.50 hrs',
        tasks: '27 Tareas',
        badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
        activeBorderColor: 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
    },
    {
        id: 'julio',
        label: 'Julio 2026',
        sublabel: 'Consolidado de 20 Tareas',
        hours: '117.80 hrs',
        tasks: '20 Tareas',
        badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300 dark:border-blue-700',
        activeBorderColor: 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
    },
    {
        id: 'junio',
        label: 'Junio 2026',
        sublabel: 'Reporte Inicial y Drive-Thru',
        hours: '190.50 hrs',
        tasks: '17 Tareas',
        badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border-purple-300 dark:border-purple-700',
        activeBorderColor: 'border-purple-500 bg-purple-50/60 dark:bg-purple-950/30'
    }
];

function ReporteActividadesContent() {
    const { t, language } = useLanguage();
    const [selectedMonth, setSelectedMonth] = useState<'agosto' | 'julio' | 'junio'>('agosto');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const reportUrl = `/api/admin/reports?month=${selectedMonth}&t=${isRefreshing ? Date.now() : ''}`;

    const handleRefresh = () => {
        setIsRefreshing(true);
        if (iframeRef.current) {
            iframeRef.current.src = `/api/admin/reports?month=${selectedMonth}&t=${Date.now()}`;
        }
        setTimeout(() => setIsRefreshing(false), 600);
    };

    const handlePrint = () => {
        if (iframeRef.current && iframeRef.current.contentWindow) {
            try {
                iframeRef.current.contentWindow.focus();
                iframeRef.current.contentWindow.print();
            } catch (e) {
                window.open(reportUrl, '_blank');
            }
        } else {
            window.open(reportUrl, '_blank');
        }
    };

    const handleOpenNewTab = () => {
        window.open(reportUrl, '_blank');
    };

    const activeOption = MONTHS_CATALOG.find(m => m.id === selectedMonth) || MONTHS_CATALOG[0];

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] w-full overflow-hidden bg-slate-100 dark:bg-slate-950">
            {/* Header & Controls Bar */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 flex-shrink-0 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    {/* Title & Badge */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/20 flex-shrink-0">
                            <Clock className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                                    {language === 'en' ? 'Activity & Development Hours Reports' : 'Reporte de Actividades y Horas de Desarrollo'}
                                </h1>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700">
                                    <Shield className="w-3 h-3" />
                                    {language === 'en' ? 'Admin Exclusive' : 'Solo Admin'}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                {language === 'en'
                                    ? 'Interactive HTML viewer for monthly roadmaps, audited dev hours, and Gantt schedules.'
                                    : 'Visor interactivo en HTML de planes de trabajo, horas auditadas y distribución diaria.'}
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 self-end lg:self-center">
                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 transition-colors"
                            title={language === 'en' ? 'Refresh report' : 'Actualizar reporte'}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-orange-500' : ''}`} />
                            <span className="hidden sm:inline">{language === 'en' ? 'Refresh' : 'Actualizar'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handlePrint}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 transition-colors"
                            title={language === 'en' ? 'Print or Save HTML' : 'Imprimir o Guardar'}
                        >
                            <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                            <span className="hidden sm:inline">{language === 'en' ? 'Print' : 'Imprimir'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleOpenNewTab}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 shadow-sm transition-colors"
                            title={language === 'en' ? 'Open in new tab' : 'Abrir en pestaña nueva'}
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>{language === 'en' ? 'Open in Tab' : 'Abrir Pestaña'}</span>
                        </button>
                    </div>
                </div>

                {/* Month Tabs Bar */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1 hidden sm:inline">
                        {language === 'en' ? 'Select Month:' : 'Mes:'}
                    </span>
                    {MONTHS_CATALOG.map((m) => {
                        const isActive = selectedMonth === m.id;
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setSelectedMonth(m.id)}
                                className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                                    isActive
                                        ? `${m.activeBorderColor} text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-400/20`
                                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                }`}
                            >
                                <Calendar className={`w-4 h-4 ${isActive ? 'text-orange-500' : 'text-slate-400'}`} />
                                <div className="text-left">
                                    <div className="flex items-center gap-2">
                                        <span className="font-extrabold">{m.label}</span>
                                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-black border ${m.badgeColor}`}>
                                            {m.hours}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium block">
                                        {m.sublabel}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Iframe Viewport Container */}
            <div className="flex-1 w-full h-full p-2 sm:p-3 overflow-hidden">
                <div className="w-full h-full rounded-2xl overflow-hidden border border-slate-300/80 dark:border-slate-800 bg-white shadow-lg relative">
                    <iframe
                        ref={iframeRef}
                        src={reportUrl}
                        title={`Reporte de ${activeOption.label} - Tacos Gavilan`}
                        className="w-full h-full border-0 bg-white"
                    />
                </div>
            </div>
        </div>
    );
}

export default function AdminReporteActividadesPage() {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <ReporteActividadesContent />
        </ProtectedRoute>
    );
}

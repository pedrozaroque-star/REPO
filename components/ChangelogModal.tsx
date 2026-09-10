/**
 * @module components/ChangelogModal
 * @description Modal interactivo de registro de cambios (Changelog) y control de versiones del sistema SM TEG.
 * @businessRules
 * - Consume la fuente de verdad canónica en lib/version.ts (SYSTEM_VERSION y VERSION_HISTORY).
 * - Totalmente bilingüe (Español e Inglés) sincronizado mediante useLanguage() de lib/i18n.tsx.
 * - Soporta navegación con teclado (Esc para cerrar), backdrop blur con click exterior, y scroll suave.
 * - Destaca visualmente la versión activa actual (v2.8.0) con badge esmeralda y pulso de actividad.
 * @dataFlow
 * - lib/version.ts (SYSTEM_VERSION, VERSION_HISTORY) → ChangelogModal → Renderizado interactivo accesible desde AppSidebar y Reporte de Actividades.
 * @notes Creado por solicitud de Carlos para auditoría visual directa del roadmap de versiones desde la UI.
 */

'use client';

import React, { useEffect } from 'react';
import { useLanguage } from '@/lib/i18n';
import { SYSTEM_VERSION, VERSION_HISTORY, VersionMilestone } from '@/lib/version';
import {
    X,
    Sparkles,
    Calendar,
    Tag,
    CheckCircle2,
    ShieldCheck,
    GitBranch,
    History,
    Layers,
    ExternalLink
} from 'lucide-react';

interface ChangelogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
    const { t, language } = useLanguage();

    // Close on Escape key press
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div
                className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Modal Header ── */}
                <div className="relative px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
                            <History className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black tracking-widest text-emerald-600 dark:text-emerald-400 uppercase">
                                    {SYSTEM_VERSION.brand}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                    {SYSTEM_VERSION.version}
                                </span>
                            </div>
                            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                                {t('changelog.modal_title')}
                            </h2>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label={t('changelog.close')}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* ── Top Status Cards ── */}
                <div className="px-5 py-3 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                            <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                {t('changelog.system_status')}
                            </span>
                            <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                {t('changelog.stage_production')}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
                        <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                            <GitBranch className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                {t('changelog.branch_label')}
                            </span>
                            <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                                {language === 'es' ? SYSTEM_VERSION.releaseMonthEs : SYSTEM_VERSION.releaseMonthEn}
                            </span>
                        </div>
                    </div>
                </div>

                {/* ── Scrollable Release Timeline ── */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6 divide-y divide-slate-100 dark:divide-slate-800/80">
                    {VERSION_HISTORY.map((milestone: VersionMilestone, index: number) => {
                        const isLatest = milestone.version === SYSTEM_VERSION.version;
                        const highlights = language === 'en' ? milestone.highlightsEn : milestone.highlightsEs;
                        const title = language === 'en' ? milestone.titleEn : milestone.titleEs;

                        return (
                            <div
                                key={milestone.version}
                                className={`pt-6 first:pt-0 ${isLatest ? 'relative' : ''}`}
                            >
                                {/* Header of Release */}
                                <div className="flex items-start justify-between gap-3 mb-2.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-black shadow-xs flex items-center gap-1.5 ${
                                            isLatest
                                                ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 ring-2 ring-emerald-500/20'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                                        }`}>
                                            <Tag className="w-3 h-3" />
                                            {milestone.version}
                                        </span>

                                        {isLatest && (
                                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1">
                                                <Sparkles className="w-2.5 h-2.5" />
                                                {t('changelog.latest_badge')}
                                            </span>
                                        )}

                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1">
                                            <Calendar className="w-3 h-3 text-slate-400" />
                                            {milestone.date}
                                        </span>
                                    </div>
                                </div>

                                {/* Title of Release */}
                                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 mb-2.5">
                                    {title}
                                </h3>

                                {/* Highlights list */}
                                <ul className="space-y-1.5 pl-1">
                                    {highlights.map((highlight: string, hIndex: number) => (
                                        <li
                                            key={hIndex}
                                            className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2 leading-relaxed"
                                        >
                                            <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                                                isLatest
                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                    : 'text-slate-400 dark:text-slate-500'
                                            }`} />
                                            <span>{highlight}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })}
                </div>

                {/* ── Modal Footer ── */}
                <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between">
                    <div className="text-[11px] text-slate-400 font-medium">
                        {SYSTEM_VERSION.brand} • {SYSTEM_VERSION.version} • {SYSTEM_VERSION.year}
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white shadow-sm transition-all cursor-pointer"
                    >
                        {t('changelog.close')}
                    </button>
                </div>
            </div>
        </div>
    );
}

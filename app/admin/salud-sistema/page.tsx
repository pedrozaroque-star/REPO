/**
 * @module app/admin/salud-sistema/page
 * @description Módulo interactivo de monitoreo y diagnóstico en vivo de la infraestructura (Supabase & Vercel).
 * Permite a la dirección (Carlos / Administradores) supervisar el almacenamiento en disco vs Spend Cap (8 GB),
 * la latencia de base de datos, el flujo de ventas de Toast POS y disparar auditorías con envío de reporte al correo.
 *
 * @businessRules
 * - Acceso exclusivo para administradores (`<ProtectedRoute allowedRoles={['admin']}>`).
 * - Envía `Authorization: Bearer <teg_token>` si existe en `localStorage` junto con cookies de sesión.
 * - Si el endpoint responde con error HTTP o de diagnóstico, expone el error real en pantalla en vez de simular `0 GB / SISTEMA ÓPTIMO`.
 * - Umbral de Alerta Preventiva: 6.0 GB (75% del Spend Cap de 8 GB).
 * - Umbral de Emergencia Crítica: 7.2 GB (90% del Spend Cap, punto donde PostgreSQL arriesga Read-Only Mode).
 *
 * @dataFlow
 * - Client (`fetch` + `Bearer teg_token`) -> GET `/api/cron/monitor-system-health` -> `lib/system-health-sentinel.ts` -> Supabase & Vercel -> Render UI.
 *
 * @notes
 * - Cumple con el protocolo i18n bilingüe (Español / Inglés).
 */

'use client'

import React, { useState, useEffect } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
    Shield, RefreshCw, Mail, Database, Server, AlertTriangle,
    CheckCircle2, HardDrive, Flame, Activity, AlertOctagon, Info
} from 'lucide-react'
import { HealthReport } from '@/lib/system-health-sentinel'

function SystemHealthContent() {
    const { t } = useLanguage()
    const [report, setReport] = useState<HealthReport | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [sendingEmail, setSendingEmail] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

    const fetchHealth = async (forceEmail = false) => {
        try {
            if (forceEmail) setSendingEmail(true)
            else setRefreshing(true)
            setFetchError(null)

            const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
            const headers: Record<string, string> = {}
            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`
            }

            const res = await fetch(`/api/cron/monitor-system-health${forceEmail ? '?forceEmail=true' : ''}`, {
                cache: 'no-store',
                credentials: 'include',
                headers
            })
            const data = await res.json().catch(() => null)

            if (!res.ok || !data?.success || !data?.report) {
                const errMsg = data?.error || `HTTP ${res.status} ${res.statusText || ''}`.trim()
                throw new Error(errMsg)
            }

            setReport(data.report)
            if (forceEmail) {
                setToastMessage({
                    text: t('system_health.toast_email_success'),
                    type: 'success'
                })
            }
        } catch (err: any) {
            const msg = err?.message || 'Error HTTP'
            console.error('Error fetching system health:', err)
            setFetchError(msg)
            if (forceEmail) {
                setToastMessage({
                    text: `${t('system_health.toast_email_error')} (${msg})`,
                    type: 'error'
                })
            }
        } finally {
            setLoading(false)
            setRefreshing(false)
            setSendingEmail(false)
            if (forceEmail) {
                setTimeout(() => setToastMessage(null), 5000)
            }
        }
    }

    useEffect(() => {
        fetchHealth(false)
    }, [])

    if (loading) {
        return (
            <div className="p-6 max-w-6xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-slate-500">
                <RefreshCw className="animate-spin text-blue-600 mb-4" size={36} />
                <p className="font-medium text-sm">{t('system_health.running')}</p>
            </div>
        )
    }

    if (!report) {
        return (
            <div className="p-4 sm:p-6 max-w-3xl mx-auto">
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-6 shadow-sm space-y-4">
                    <div className="flex items-start gap-3 text-red-800 dark:text-red-300">
                        <AlertOctagon className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" size={24} />
                        <div className="space-y-1">
                            <h1 className="text-base font-bold">{t('system_health.title')}</h1>
                            <p className="text-xs font-mono break-words">{fetchError}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => fetchHealth(false)}
                        disabled={refreshing}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        <span>{refreshing ? t('system_health.running') : t('system_health.refresh_button')}</span>
                    </button>
                </div>
            </div>
        )
    }

    const isWarning = report.overallStatus === 'WARNING'
    const isCritical = report.overallStatus === 'CRITICAL'

    const usagePercent = report.storage.usagePercent || 0
    const estimatedGb = report.storage.estimatedTotalGb || 0
    const maxGb = report.storage.maxDiskGb || 8.0
    const headroomGb = report.storage.headroomGb || 0

    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3.5">
                    <div className={`p-3 rounded-xl ${isCritical ? 'bg-red-500/10 text-red-500' : isWarning ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-600'}`}>
                        <Shield size={28} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                                {t('system_health.title')}
                            </h1>
                            <span className={`text-xs font-black uppercase px-2.5 py-0.5 rounded-full tracking-wider ${isCritical ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border border-red-200' : isWarning ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400 border border-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400 border border-emerald-200'}`}>
                                {isCritical
                                    ? t('system_health.status_critical')
                                    : isWarning
                                        ? t('system_health.status_warning')
                                        : t('system_health.status_healthy')}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('system_health.subtitle')} • {report.timestamp ? new Date(report.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 self-end sm:self-auto">
                    <button
                        onClick={() => fetchHealth(false)}
                        disabled={refreshing || sendingEmail}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? t('system_health.running') : t('system_health.refresh_button')}
                    </button>

                    <button
                        onClick={() => fetchHealth(true)}
                        disabled={refreshing || sendingEmail}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                        <Mail size={14} className={sendingEmail ? 'animate-pulse' : ''} />
                        {sendingEmail ? t('system_health.sending') : t('system_health.email_button')}
                    </button>
                </div>
            </div>

            {fetchError && (
                <div className="p-3.5 rounded-lg text-xs font-mono flex items-center justify-between border bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300">
                    <span>{fetchError}</span>
                    <button onClick={() => setFetchError(null)} className="text-xs opacity-75 hover:opacity-100 font-bold ml-4">✕</button>
                </div>
            )}

            {/* Toast Notification */}
            {toastMessage && (
                <div className={`p-3.5 rounded-lg text-sm font-medium flex items-center justify-between border ${toastMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300'}`}>
                    <span>{toastMessage.text}</span>
                    <button onClick={() => setToastMessage(null)} className="text-xs opacity-75 hover:opacity-100 font-bold ml-4">✕</button>
                </div>
            )}

            {/* Alertas Activas */}
            {report.alerts && report.alerts.length > 0 && (
                <div className={`p-4 rounded-xl border ${isCritical ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-900 dark:text-red-300' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300'}`}>
                    <div className="flex items-center gap-2 font-bold text-sm mb-2">
                        {isCritical ? <AlertOctagon size={18} /> : <AlertTriangle size={18} />}
                        <span>{t('system_health.card_action_title')}</span>
                    </div>
                    <ul className="list-disc list-inside text-xs space-y-1">
                        {report.alerts.map((a, i) => (
                            <li key={i}>{a}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Card 1: Almacenamiento & Spend Cap */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <HardDrive className="text-blue-600" size={20} />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                            {t('system_health.card_storage_title')}
                        </h2>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        {t('system_health.storage_used')}: <strong className="text-slate-900 dark:text-white">{estimatedGb} GB</strong> / {maxGb} GB ({usagePercent}%)
                    </span>
                </div>

                {/* Progress Bar with Threshold Markers */}
                <div className="space-y-1.5">
                    <div className="relative w-full bg-slate-100 dark:bg-slate-800 rounded-full h-4 overflow-hidden border border-slate-200 dark:border-slate-700">
                        <div
                            className={`h-full transition-all duration-500 rounded-full ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 75 ? 'bg-amber-500' : 'bg-blue-600'}`}
                            style={{ width: `${Math.min(usagePercent, 100)}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 px-0.5">
                        <span>0 GB</span>
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">{t('system_health.warning_threshold')}</span>
                        <span className="text-red-600 dark:text-red-400 font-semibold">{t('system_health.critical_threshold')}</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">8.0 GB</span>
                    </div>
                </div>

                {/* Metric Box */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">{t('system_health.storage_used')}</div>
                        <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">{estimatedGb} GB</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">{t('system_health.storage_free')}</div>
                        <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">{headroomGb} GB</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">{t('system_health.warning_threshold')}</div>
                        <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">6.0 GB</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">{t('system_health.storage_limit')}</div>
                        <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">8.0 GB</div>
                    </div>
                </div>

                {/* Spend Cap Educational Note */}
                <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-lg p-3 text-xs text-blue-900 dark:text-blue-300 flex items-start gap-2.5">
                    <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
                    <div>
                        <strong>{t('system_health.notice_spend_cap_title')}</strong>
                        <p className="mt-0.5 leading-relaxed text-blue-800/90 dark:text-blue-300/90">
                            {t('system_health.notice_spend_cap_desc')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Card 2: Rendimiento & Sincronización en Vivo */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex items-center gap-3.5">
                    <div className="p-2.5 bg-blue-50 dark:bg-blue-950 text-blue-600 rounded-lg">
                        <Database size={22} />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                            {t('system_health.db_latency')}
                        </div>
                        <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                            {report.databaseLatencyMs} ms
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex items-center gap-3.5">
                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-lg">
                        <Server size={22} />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                            {t('system_health.vercel_status')}
                        </div>
                        <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                            {report.vercelProduction.status === 200 ? '200 OK' : `HTTP ${report.vercelProduction.status}`}
                        </div>
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">● {report.vercelProduction.latencyMs} ms</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex items-center gap-3.5">
                    <div className="p-2.5 bg-amber-50 dark:bg-amber-950 text-amber-600 rounded-lg">
                        <Flame size={22} />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                            {t('system_health.toast_sync')}
                        </div>
                        <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                            {report.toastSync.activeStoresToday} / 15
                        </div>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('system_health.stores_synced')}</span>
                    </div>
                </div>
            </div>

            {/* Card 3: Volúmenes de Tablas Críticas */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Activity size={18} className="text-blue-600" />
                    <span>{t('system_health.card_tables_title')}</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('system_health.meat_rows')}</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                            {report.storage.meatRows.toLocaleString()}
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('system_health.sales_rows')}</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                            {report.storage.salesRows.toLocaleString()}
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('system_health.schedules_rows')}</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                            {report.storage.schedulesRows.toLocaleString()}
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('system_health.pmix_rows')}</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                            {report.storage.pmixRows.toLocaleString()}
                        </div>
                    </div>
                </div>
            </div>

            {/* Card 4: Plan de Acción y Diagnóstico */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    <span>{t('system_health.card_action_title')}</span>
                </h3>
                {report.recommendedAction ? (
                    <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg text-xs text-amber-900 dark:text-amber-300 font-medium">
                        🛠️ {report.recommendedAction}
                    </div>
                ) : (
                    <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-xs text-emerald-900 dark:text-emerald-300 font-medium">
                        ✅ {t('system_health.healthy_message')}
                    </div>
                )}
            </div>
        </div>
    )
}

export default function SystemHealthPage() {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <SystemHealthContent />
        </ProtectedRoute>
    )
}

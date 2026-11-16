/**
 * @module components/OrderReadyVoiceAuditModal
 * @description Modal ejecutivo de Auditoría en Vivo para verificar en tiempo real en todas las sucursales permitidas:
 * (1) uso de la tableta de cocina (/inventory/preparador -> % de órdenes tocadas antes de despacho KDS + latido en línea) y
 * (2) estado real de la bocina AI (/order-ready-board -> abierta, sin Mute, desbloqueada y locuciones confirmadas por ACK).
 *
 * @businessRules
 * - **Día Laboral 6:00 AM PT**: Consume `/api/order-ready/telemetry?range=today|7d` con agregación directa en PostgreSQL.
 * - **Detección Inmediata de Mute / Desconexión**: Muestra alerta destacada cuando alguna tienda tiene el tablero en MUTE,
 *   audio bloqueado por autoplay o cerrado, e identifica órdenes llamadas desde tableta que no recibieron ACK de bocina.
 * - **Bilingüe 100% (ES / EN)**: Todos los textos usan `useLanguage()` (`orderReadyBoard.audit_*`) sin strings hardcodeados.
 *
 * @dataFlow
 * - OrderReadyBoard Header -> `OrderReadyVoiceAuditModal` -> `GET /api/order-ready/telemetry?range=today|7d` (auto-refresh 20s) -> Tabla y KPIs por sucursal.
 *
 * @notes
 * - Respeta el tema visual del tablero (`isDark`) y soporta alcance automático por rol (Admin = 15 tiendas; Supervisor/Manager = tiendas autorizadas).
 */

'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  RefreshCw,
  Tablet,
  Volume2,
  VolumeX,
  WifiOff,
  X
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import type { StoreTelemetryItem } from '@/app/api/order-ready/telemetry/route'

interface TelemetryResponse {
  success: boolean
  range: 'today' | '7d'
  startDate: string
  endDate: string
  generatedAt: string
  summary: {
    storeCount: number
    totalOrders: number
    tabletCalledOrders: number
    chainPctTabletCalled: number
    specialButtonsCalled: number
    speakerConfirmedOrders: number
    totalPlaybackEvents: number
    unheardCallsSinceActive: number
    avgSpeakerLatencyMs: number | null
    tabletsOnline: number
    speakersActive: number
    speakersMuted: number
    speakersAudioLocked: number
    speakersOffline: number
  }
  stores: StoreTelemetryItem[]
}

interface OrderReadyVoiceAuditModalProps {
  isOpen: boolean
  onClose: () => void
  isDark: boolean
  selectedStore: string
  isAdmin: boolean
}

function formatTimeLa(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  } catch {
    return '—'
  }
}

function formatMmSsDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function OrderReadyVoiceAuditModal({
  isOpen,
  onClose,
  isDark,
  selectedStore
}: OrderReadyVoiceAuditModalProps) {
  const { t } = useLanguage()
  const [range, setRange] = useState<'today' | '7d'>('today')
  const [data, setData] = useState<TelemetryResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const loadTelemetry = useCallback(async (targetRange: 'today' | '7d') => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/order-ready/telemetry?range=${targetRange}&_t=${Date.now()}`, {
        cache: 'no-store'
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      setData(json)
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void loadTelemetry(range)
    const timer = setInterval(() => {
      void loadTelemetry(range)
    }, 20_000)
    return () => clearInterval(timer)
  }, [isOpen, range, loadTelemetry])

  if (!isOpen) return null

  const mutedStores = (data?.stores || []).filter((s) => s.speakerState === 'muted')
  const summary = data?.summary

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-6xl max-h-[92vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
          isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 ${
            isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold leading-tight">
                {t('orderReadyBoard.audit_modal_title')}
              </h2>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {t('orderReadyBoard.audit_modal_subtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Range switch */}
            <div
              className={`inline-flex rounded-xl p-1 border ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setRange('today')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  range === 'today'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('orderReadyBoard.audit_range_today')}
              </button>
              <button
                type="button"
                onClick={() => setRange('7d')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  range === '7d'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('orderReadyBoard.audit_range_7d')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => void loadTelemetry(range)}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('orderReadyBoard.audit_refresh_btn')}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label={t('orderReadyBoard.audit_close_btn')}
              className={`p-1.5 rounded-xl border transition cursor-pointer ${
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                  : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {errorMsg && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300 px-4 py-2.5 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* Muted warning banner */}
          {mutedStores.length > 0 && (
            <div className="rounded-xl border border-rose-500/50 bg-rose-500/15 px-4 py-3 flex items-center gap-3 text-rose-700 dark:text-rose-200">
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500" />
              <p className="text-xs sm:text-sm font-bold">
                {t('orderReadyBoard.audit_muted_alert_banner').replace(
                  '{stores}',
                  mutedStores.map((s) => s.storeName).join(', ')
                )}
              </p>
            </div>
          )}

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              className={`rounded-xl p-3.5 border ${
                isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>{t('orderReadyBoard.audit_kpi_tablet_usage')}</span>
                <Tablet className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black mt-1 tabular-nums">
                {summary ? `${summary.chainPctTabletCalled}%` : '—'}
              </div>
              <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {summary
                  ? t('orderReadyBoard.audit_kpi_tablet_sub')
                      .replace('{called}', summary.tabletCalledOrders.toLocaleString('en-US'))
                      .replace('{total}', summary.totalOrders.toLocaleString('en-US'))
                  : '—'}
              </div>
            </div>

            <div
              className={`rounded-xl p-3.5 border ${
                isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>{t('orderReadyBoard.audit_kpi_speakers_live')}</span>
                <Volume2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black mt-1 tabular-nums">
                {summary ? `${summary.speakersActive} / ${summary.storeCount}` : '—'}
              </div>
              <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {summary
                  ? t('orderReadyBoard.audit_kpi_speakers_sub')
                      .replace('{muted}', String(summary.speakersMuted))
                      .replace('{closed}', String(summary.speakersOffline + summary.speakersAudioLocked))
                  : '—'}
              </div>
            </div>

            <div
              className={`rounded-xl p-3.5 border ${
                isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>{t('orderReadyBoard.audit_kpi_tablets_live')}</span>
                <Activity className="w-4 h-4 text-cyan-500" />
              </div>
              <div className="text-2xl font-black mt-1 tabular-nums">
                {summary ? `${summary.tabletsOnline} / ${summary.storeCount}` : '—'}
              </div>
              <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {t('orderReadyBoard.audit_kpi_tablets_sub')}
              </div>
            </div>

            <div
              className={`rounded-xl p-3.5 border ${
                isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>{t('orderReadyBoard.audit_kpi_confirmed_audio')}</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black mt-1 tabular-nums">
                {summary ? summary.totalPlaybackEvents.toLocaleString('en-US') : '—'}
              </div>
              <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {summary
                  ? t('orderReadyBoard.audit_kpi_confirmed_sub')
                      .replace(
                        '{latency}',
                        summary.avgSpeakerLatencyMs !== null
                          ? `${(summary.avgSpeakerLatencyMs / 1000).toFixed(1)}s`
                          : '—'
                      )
                      .replace('{special}', String(summary.specialButtonsCalled))
                  : '—'}
              </div>
            </div>
          </div>

          {/* Per-store audit table */}
          <div
            className={`rounded-xl border overflow-hidden ${
              isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr
                    className={`border-b text-[11px] uppercase tracking-wider font-bold ${
                      isDark
                        ? 'bg-slate-900 border-slate-800 text-slate-400'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_store')}</th>
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_tablet_live')}</th>
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_speaker_live')}</th>
                    <th className="py-2.5 px-3 text-right">{t('orderReadyBoard.audit_col_orders')}</th>
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_tablet_calls')}</th>
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_speaker_ack')}</th>
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_timing')}</th>
                    <th className="py-2.5 px-3">{t('orderReadyBoard.audit_col_last_activity')}</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-slate-800/80' : 'divide-slate-200'}`}>
                  {(data?.stores || []).map((st) => {
                    const isCurrent = st.storeCode === selectedStore
                    const barColor =
                      st.pctTabletCalled >= 80
                        ? 'bg-emerald-500'
                        : st.pctTabletCalled >= 65
                          ? 'bg-amber-500'
                          : 'bg-rose-500'

                    return (
                      <tr
                        key={st.storeCode}
                        className={`${
                          isCurrent
                            ? isDark
                              ? 'bg-emerald-950/20'
                              : 'bg-emerald-50/50'
                            : isDark
                              ? 'hover:bg-slate-900/50'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* Store */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{st.storeName}</span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                st.autoCallMode === 'smart'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                  : isDark
                                    ? 'bg-slate-800 text-slate-400 border-slate-700'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {st.autoCallMode === 'smart'
                                ? t('orderReadyBoard.audit_mode_smart')
                                : t('orderReadyBoard.audit_mode_manual')}
                            </span>
                          </div>
                        </td>

                        {/* Kitchen Tablet live status */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {st.tabletOnline ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>{t('orderReadyBoard.audit_status_tablet_online')}</span>
                            </span>
                          ) : (
                            <div className="flex flex-col">
                              <span
                                className={`inline-flex items-center gap-1 font-semibold text-[11px] ${
                                  isDark ? 'text-slate-400' : 'text-slate-500'
                                }`}
                              >
                                <WifiOff className="w-3 h-3 opacity-70" />
                                <span>{t('orderReadyBoard.audit_status_tablet_idle')}</span>
                              </span>
                              {st.prepLastHeartbeatAt && (
                                <span className="text-[10px] text-slate-500">
                                  {formatTimeLa(st.prepLastHeartbeatAt)}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Speaker / Board live status */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {st.speakerState === 'active' && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold text-[11px]">
                              <Volume2 className="w-3 h-3" />
                              <span>
                                {t('orderReadyBoard.audit_status_speaker_active')} • {st.speakerVoiceId}{' '}
                                {Math.round(st.speakerVoiceVolume * 100)}%
                              </span>
                            </span>
                          )}
                          {st.speakerState === 'muted' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40 font-black text-[11px]">
                              <VolumeX className="w-3 h-3" />
                              <span>{t('orderReadyBoard.audit_status_speaker_muted')}</span>
                            </span>
                          )}
                          {st.speakerState === 'audio_locked' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/40 font-bold text-[11px]">
                              <AlertTriangle className="w-3 h-3" />
                              <span>{t('orderReadyBoard.audit_status_speaker_locked')}</span>
                            </span>
                          )}
                          {st.speakerState === 'offline' && (
                            <span
                              className={`inline-flex items-center gap-1 font-semibold text-[11px] ${
                                isDark ? 'text-slate-400' : 'text-slate-500'
                              }`}
                            >
                              <WifiOff className="w-3 h-3 opacity-70" />
                              <span>{t('orderReadyBoard.audit_status_speaker_offline')}</span>
                            </span>
                          )}
                        </td>

                        {/* Total Orders */}
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums whitespace-nowrap">
                          {st.totalOrders.toLocaleString('en-US')}
                        </td>

                        {/* Tablet Usage % */}
                        <td className="py-2.5 px-3 min-w-[145px]">
                          <div className="flex items-center justify-between gap-2 font-bold tabular-nums">
                            <span>
                              {st.tabletCalledOrders.toLocaleString('en-US')} /{' '}
                              {st.totalOrders.toLocaleString('en-US')}
                            </span>
                            <span>{st.pctTabletCalled.toFixed(1)}%</span>
                          </div>
                          <div
                            className={`w-full h-1.5 rounded-full overflow-hidden mt-1 ${
                              isDark ? 'bg-slate-800' : 'bg-slate-200'
                            }`}
                          >
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{ width: `${Math.min(100, Math.max(0, st.pctTabletCalled))}%` }}
                            />
                          </div>
                        </td>

                        {/* Speaker Playback ACK */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {st.totalPlaybackEvents > 0 || st.callsSinceSpeakerActive > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                                ✓ {st.totalPlaybackEvents.toLocaleString('en-US')}{' '}
                                {st.avgSpeakerLatencyMs !== null
                                  ? `(${(st.avgSpeakerLatencyMs / 1000).toFixed(1)}s)`
                                  : ''}
                              </span>
                              {st.unheardCallsSinceActive > 0 ? (
                                <span className="text-[10px] font-bold text-rose-500">
                                  {t('orderReadyBoard.audit_ack_unheard_warn').replace(
                                    '{count}',
                                    String(st.unheardCallsSinceActive)
                                  )}
                                </span>
                              ) : (
                                st.callsSinceSpeakerActive > 0 && (
                                  <span className="text-[10px] text-emerald-500 font-semibold">
                                    {t('orderReadyBoard.audit_ack_all_heard')}
                                  </span>
                                )
                              )}
                            </div>
                          ) : (
                            <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                              {t('orderReadyBoard.audit_ack_waiting_reload')}
                            </span>
                          )}
                        </td>

                        {/* Timing */}
                        <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">
                          <div className="font-semibold">{formatMmSsDuration(st.avgPrepToCallSec)}</div>
                          <div className="text-[10px] text-slate-500">
                            {st.avgCallToBumpSec !== null ? `+${st.avgCallToBumpSec}s KDS` : '—'}
                          </div>
                        </td>

                        {/* Last Tap / Last Voice */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-semibold">{formatTimeLa(st.lastTabletCallAt)}</div>
                          <div className="text-[10px] text-slate-500">
                            {st.speakerLastPlayedAt
                              ? `🔊 #${st.speakerLastPlayedOrder || ''} • ${formatTimeLa(
                                  st.speakerLastPlayedAt
                                )}`
                              : '—'}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {t('orderReadyBoard.audit_footer_note')}
          </p>
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3 border-t flex justify-end shrink-0 ${
            isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
          >
            {t('orderReadyBoard.audit_close_btn')}
          </button>
        </div>
      </div>
    </div>
  )
}

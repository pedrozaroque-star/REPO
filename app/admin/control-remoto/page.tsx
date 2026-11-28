/**
 * @module app/admin/control-remoto/page
 * @description Centro de Control Remoto de Sucursales para Tacos Gavilan (`/admin/control-remoto`).
 *              Permite a la dirección (solo rol `admin`) supervisar y controlar remotamente sin visitas físicas:
 *              1) PCs Windows de las 15 sucursales (Action1 pantalla en vivo + TEG Watchdog: volumen real, desmuteo,
 *                 blindaje 24/7 + Chrome Autoplay, reinicio de navegador/PC, PowerShell remoto e instalador 1-clic),
 *              2) Tabletas Android de Preparador y Blindaje Delivery (batería, recarga, limpieza de caché, avisos, enlace RustDesk/Fully Kiosk),
 *              3) TVs de Menú Digital (`/tv` y `/t/`: refresco inmediato, cambio de pantalla, pantalla negra y avisos).
 *
 * @businessRules
 * - Acceso exclusivo para administradores (`<ProtectedRoute allowedRoles={['admin']}>`).
 * - Soporta acciones individuales y acciones masivas ("Aplicar a las 15 sucursales") con bitácora auditada.
 * - Cruza en tiempo real el estado de las PCs con `order_ready_device_status` para detectar bocinas silenciadas o cerradas.
 * - 100% bilingüe (Español / Inglés) vía `useLanguage()` (`remoteControl.*`).
 * - Auto-refresco cada 30 segundos únicamente cuando la pestaña está visible (`document.visibilityState === 'visible'`).
 *
 * @dataFlow
 * - UI -> GET `/api/remote-control/fleet`, POST/PATCH `/api/remote-control/commands`, PATCH `/api/remote-control/settings`,
 *   POST `/api/remote-control/devices/[id]/enroll` -> Supabase (`remote_fleet_*`).
 */

'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
  Activity,
  BatteryCharging,
  CheckCircle2,
  Cpu,
  ExternalLink,
  HardDrive,
  History,
  KeyRound,
  Layers,
  Maximize2,
  Megaphone,
  Monitor,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Tablet,
  Terminal,
  Trash2,
  Tv,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  DEFAULT_PC_WATCHDOG_CONFIG,
  REMOTE_AGENT_LATEST_VERSION,
  REMOTE_STORE_OPTIONS,
  sanitizePcWatchdogConfig,
  type PcWatchdogConfig,
  type RemoteCommandStatus,
  type RemoteDeviceType,
  type RemoteFleetCommand,
  type RemoteFleetSettings,
} from '@/lib/remote-control'
import {
  AddDeviceModal,
  ConfigureDeviceModal,
  InstallerModal,
  PowerShellModal,
  type FleetDeviceUI,
} from '@/components/remote-control/RemoteControlModals'
import LiveScreenModal from '@/components/remote-control/LiveScreenModal'

interface FleetCommandUI extends RemoteFleetCommand {
  storeName: string
  deviceName: string
}

interface FleetSummary {
  totalDevices: number
  onlineDevices: number
  offlineDevices: number
  pendingEnrollment: number
  commandsLast24h: number
  byType: Record<RemoteDeviceType, { total: number; online: number; pending: number }>
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('teg_token')
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`
    }
  }
  return headers
}

function formatLaTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return '—'
  }
}

function formatRelativeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min}m`
  const hrs = Math.floor(min / 60)
  if (hrs < 48) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function RemoteControlContent() {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState<'fleet' | 'bulk' | 'history' | 'setup'>('fleet')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [devices, setDevices] = useState<FleetDeviceUI[]>([])
  const [commands, setCommands] = useState<FleetCommandUI[]>([])
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [settings, setSettings] = useState<RemoteFleetSettings | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Filtros Flota
  const [typeFilter, setTypeFilter] = useState<'all' | RemoteDeviceType>('all')
  const [storeFilter, setStoreFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'pending'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [volumeDrafts, setVolumeDrafts] = useState<Record<string, number>>({})
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null)

  // Modales
  const [installerDevice, setInstallerDevice] = useState<FleetDeviceUI | null>(null)
  const [configDevice, setConfigDevice] = useState<FleetDeviceUI | null>(null)
  const [psDevice, setPsDevice] = useState<FleetDeviceUI | null>(null)
  const [liveScreenDevice, setLiveScreenDevice] = useState<FleetDeviceUI | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  // Acciones masivas (15 sucursales)
  const [bulkDeviceType, setBulkDeviceType] = useState<RemoteDeviceType>('windows_pc')
  const [bulkScope, setBulkScope] = useState<'all' | 'selected'>('all')
  const [bulkStores, setBulkStores] = useState<string[]>([])
  const [bulkCommand, setBulkCommand] = useState<string>('unmute_audio')
  const [bulkVolume, setBulkVolume] = useState<number>(85)
  const [bulkMessage, setBulkMessage] = useState<string>('')
  const [bulkPsScript, setBulkPsScript] = useState<string>('')
  const [bulkRunning, setBulkRunning] = useState(false)

  // Configuración Global
  const [a1OrgUrl, setA1OrgUrl] = useState('')
  const [a1MsiUrl, setA1MsiUrl] = useState('')
  const [a1InstallToken, setA1InstallToken] = useState('')
  const [rdHost, setRdHost] = useState('')
  const [rdKey, setRdKey] = useState('')
  const [globalWd, setGlobalWd] = useState<PcWatchdogConfig>(DEFAULT_PC_WATCHDOG_CONFIG)
  const [savingGlobal, setSavingGlobal] = useState(false)

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev))
    }, 4500)
  }, [])

  const fetchFleet = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await fetch(`/api/remote-control/fleet?_t=${Date.now()}`, {
        headers: getAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setDevices(data.devices || [])
      setCommands(data.recentCommands || [])
      setSummary(data.summary || null)
      if (data.settings) {
        setSettings(data.settings)
        setA1OrgUrl(data.settings.action1_org_url || '')
        setA1MsiUrl(data.settings.action1_installer_url || '')
        setA1InstallToken(data.settings.action1_install_token || '')
        setRdHost(data.settings.rustdesk_relay_host || '')
        setRdKey(data.settings.rustdesk_public_key || '')
        setGlobalWd(sanitizePcWatchdogConfig(data.settings.default_pc_watchdog))
      }
      setErrorMsg(null)
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error loading fleet')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchFleet(false)
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchFleet(true)
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [fetchFleet])

  const sendSingleCommand = async (
    device: FleetDeviceUI,
    commandType: string,
    payload: Record<string, any> = {}
  ) => {
    setBusyDeviceId(device.id)
    try {
      const res = await fetch('/api/remote-control/commands', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          deviceId: device.id,
          commandType,
          payload,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      notify(t('remoteControl.toast_command_sent'), 'success')
      void fetchFleet(true)
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setBusyDeviceId(null)
    }
  }

  const handleBulkExecute = async (e: React.FormEvent) => {
    e.preventDefault()
    setBulkRunning(true)
    try {
      const payload: Record<string, any> = {}
      if (bulkCommand === 'set_volume') payload.volumePct = bulkVolume
      if (bulkCommand === 'show_banner' || bulkCommand === 'show_overlay') {
        payload.message = bulkMessage.trim()
        payload.durationSec = 90
      }
      if (bulkCommand === 'run_powershell') payload.script = bulkPsScript.trim()
      if (bulkCommand === 'set_blackout') {
        payload.blackout = true
        payload.message = bulkMessage.trim() || null
      }

      const res = await fetch('/api/remote-control/commands', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          bulkTarget: {
            deviceType: bulkDeviceType,
            storeCodes: bulkScope === 'selected' ? bulkStores : undefined,
          },
          commandType: bulkCommand,
          payload,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      notify(
        t('remoteControl.toast_bulk_sent').replace('{count}', String(data.count || 0)),
        'success'
      )
      void fetchFleet(true)
      setActiveTab('history')
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setBulkRunning(false)
    }
  }

  const handleCancelCommand = async (commandId: string) => {
    try {
      const res = await fetch('/api/remote-control/commands', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ commandId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`)
      notify(t('remoteControl.toast_saved'), 'success')
      void fetchFleet(true)
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    }
  }

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingGlobal(true)
    try {
      const res = await fetch('/api/remote-control/settings', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          action1OrgUrl: a1OrgUrl,
          action1InstallerUrl: a1MsiUrl,
          action1InstallToken: a1InstallToken,
          rustdeskRelayHost: rdHost,
          rustdeskPublicKey: rdKey,
          defaultPcWatchdog: globalWd,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`)
      setSettings(data.settings)
      notify(t('remoteControl.toast_saved'), 'success')
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setSavingGlobal(false)
    }
  }

  const filteredDevices = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return devices.filter((d) => {
      if (typeFilter !== 'all' && d.device_type !== typeFilter) return false
      if (storeFilter !== 'ALL' && d.store_code !== storeFilter) return false
      if (statusFilter === 'online' && !d.online) return false
      if (statusFilter === 'offline' && (d.online || d.enrollment_status === 'pending')) return false
      if (statusFilter === 'pending' && d.enrollment_status !== 'pending') return false
      if (q) {
        const hay = [
          d.storeName,
          d.store_code,
          d.display_name,
          d.device_key,
          d.last_ip || '',
          d.telemetry?.hostname || '',
          d.telemetry?.localIp || '',
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [devices, typeFilter, storeFilter, statusFilter, searchTerm])

  const renderCommandStatusBadge = (status: RemoteCommandStatus) => {
    const map: Record<RemoteCommandStatus, { cls: string; label: string }> = {
      pending: { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300', label: t('remoteControl.cmd_status_pending') },
      dispatched: { cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300', label: t('remoteControl.cmd_status_dispatched') },
      running: { cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300', label: t('remoteControl.cmd_status_running') },
      succeeded: { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300', label: t('remoteControl.cmd_status_succeeded') },
      failed: { cls: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300', label: t('remoteControl.cmd_status_failed') },
      expired: { cls: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400', label: t('remoteControl.cmd_status_expired') },
      cancelled: { cls: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400', label: t('remoteControl.cmd_status_cancelled') },
    }
    const cfg = map[status] || map.pending
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.cls}`}>
        {cfg.label}
      </span>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Toast flotante */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-xs font-bold text-white animate-in fade-in slide-in-from-bottom-4 ${
            toast.type === 'success'
              ? 'bg-emerald-600 border-emerald-400/40'
              : 'bg-red-600 border-red-400/40'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header Ejecutivo */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white flex items-center justify-center shadow-lg shrink-0">
            <Monitor className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('remoteControl.title')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('remoteControl.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {settings?.action1_org_url && (
            <a
              href={settings.action1_org_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t('remoteControl.open_action1_console')}</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('remoteControl.add_device')}</span>
          </button>
          <button
            type="button"
            onClick={() => void fetchFleet(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? t('remoteControl.refreshing') : t('remoteControl.refresh')}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-xs font-semibold text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* KPIs */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t('remoteControl.kpi_total')}
            </p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{summary.totalDevices}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              PC: {summary.byType.windows_pc.total} • Tab: {summary.byType.android_tablet.total} • TV: {summary.byType.tv_display.total}
            </p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {t('remoteControl.kpi_online')}
            </p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{summary.onlineDevices}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              PC: {summary.byType.windows_pc.online} • Tab: {summary.byType.android_tablet.online} • TV: {summary.byType.tv_display.online}
            </p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t('remoteControl.kpi_offline')}
            </p>
            <p className="text-2xl font-black text-slate-700 dark:text-slate-200 mt-1">{summary.offlineDevices}</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {t('remoteControl.kpi_pending')}
            </p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{summary.pendingEnrollment}</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/50 p-4 col-span-2 sm:col-span-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {t('remoteControl.kpi_commands_24h')}
            </p>
            <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{summary.commandsLast24h}</p>
          </div>
        </div>
      )}

      {/* Navegación por Pestañas */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {[
          { key: 'fleet', label: t('remoteControl.tab_fleet'), icon: Monitor },
          { key: 'bulk', label: t('remoteControl.tab_bulk'), icon: Layers },
          { key: 'history', label: t('remoteControl.tab_history'), icon: History },
          { key: 'setup', label: t('remoteControl.tab_setup'), icon: Wrench },
        ].map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as any)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: FLOTA DE EQUIPOS                                               */}
      {/* ===================================================================== */}
      {activeTab === 'fleet' && (
        <div className="space-y-4">
          {/* Barra de Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('remoteControl.search_placeholder')}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <option value="all">{t('remoteControl.filter_all_types')}</option>
              <option value="windows_pc">{t('remoteControl.filter_windows_pc')}</option>
              <option value="android_tablet">{t('remoteControl.filter_android_tablet')}</option>
              <option value="tv_display">{t('remoteControl.filter_tv_display')}</option>
            </select>

            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <option value="ALL">{t('remoteControl.filter_all_stores')}</option>
              {REMOTE_STORE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <option value="all">{t('remoteControl.filter_all_status')}</option>
              <option value="online">{t('remoteControl.filter_online')}</option>
              <option value="offline">{t('remoteControl.filter_offline')}</option>
              <option value="pending">{t('remoteControl.filter_pending')}</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin" />
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center text-sm text-slate-500">
              {t('remoteControl.empty_fleet')}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredDevices.map((d) => {
                const isBusy = busyDeviceId === d.id
                const tel = d.telemetry || {}
                const wd = sanitizePcWatchdogConfig(d.desired_config)
                const volValue = volumeDrafts[d.id] ?? (typeof tel.volumePct === 'number' ? tel.volumePct : wd.minVolumePct)

                const TypeIcon =
                  d.device_type === 'windows_pc'
                    ? Monitor
                    : d.device_type === 'android_tablet'
                      ? Tablet
                      : Tv

                const statusBadge = d.online
                  ? { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300', label: t('remoteControl.status_online'), icon: Wifi }
                  : d.enrollment_status === 'pending'
                    ? { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300', label: t('remoteControl.status_pending'), icon: KeyRound }
                    : d.enrollment_status === 'revoked'
                      ? { cls: 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300', label: t('remoteControl.status_revoked'), icon: XCircle }
                      : { cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300', label: t('remoteControl.status_offline'), icon: WifiOff }

                const StatusIcon = statusBadge.icon

                return (
                  <div
                    key={d.id}
                    className={`rounded-2xl bg-white dark:bg-slate-900 border p-4 shadow-sm flex flex-col justify-between gap-3.5 transition ${
                      d.online
                        ? 'border-emerald-200/80 dark:border-emerald-900/50'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {/* Top Row */}
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              d.device_type === 'windows_pc'
                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                                : d.device_type === 'android_tablet'
                                  ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                            }`}
                          >
                            <TypeIcon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                              {d.display_name}
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {d.storeName} • {tel.hostname || d.device_role}
                              {tel.localIp ? ` • ${tel.localIp}` : ''}
                            </p>
                          </div>
                        </div>

                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${statusBadge.cls}`}>
                          <StatusIcon className="w-3 h-3" />
                          <span>{statusBadge.label}</span>
                        </span>
                      </div>

                      {/* Estado cruzado con Order Ready Speaker (en vivo en las 15 sucursales) */}
                      {d.linkedOrderReady && d.device_type === 'windows_pc' && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          {d.linkedOrderReady.speakerOnline ? (
                            d.linkedOrderReady.isMuted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-bold">
                                <VolumeX className="w-3 h-3" /> {t('remoteControl.speaker_live_muted')}
                              </span>
                            ) : !d.linkedOrderReady.audioUnlocked ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold">
                                <VolumeX className="w-3 h-3" /> {t('remoteControl.speaker_live_locked')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100/80 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold">
                                <Volume2 className="w-3 h-3" /> {t('remoteControl.speaker_live_active')}
                                {d.linkedOrderReady.lastPlayedOrder ? ` (#${d.linkedOrderReady.lastPlayedOrder})` : ''}
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">
                              <VolumeX className="w-3 h-3" /> {t('remoteControl.speaker_live_offline')}
                            </span>
                          )}

                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${
                              wd.watchdogEnabled
                                ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                            }`}
                          >
                            <Shield className="w-3 h-3" />
                            {wd.watchdogEnabled
                              ? t('remoteControl.metric_watchdog_on')
                              : t('remoteControl.metric_watchdog_off')}
                          </span>
                        </div>
                      )}

                      {/* Métricas de Telemetría por Tipo */}
                      {d.device_type === 'windows_pc' && (
                        <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 p-2.5 text-center">
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-0.5">
                              <Cpu className="w-2.5 h-2.5" /> {t('remoteControl.metric_cpu')}
                            </p>
                            <p className="text-xs font-black text-slate-800 dark:text-slate-100">
                              {tel.cpuPct != null ? `${tel.cpuPct}%` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold">{t('remoteControl.metric_ram')}</p>
                            <p className="text-xs font-black text-slate-800 dark:text-slate-100">
                              {tel.ramUsedPct != null ? `${tel.ramUsedPct}%` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-0.5">
                              <HardDrive className="w-2.5 h-2.5" /> {t('remoteControl.metric_disk')}
                            </p>
                            <p className="text-xs font-black text-slate-800 dark:text-slate-100">
                              {tel.diskFreeGb != null ? `${tel.diskFreeGb}GB` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold">{t('remoteControl.metric_volume')}</p>
                            <p
                              className={`text-xs font-black ${
                                tel.isMuted ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'
                              }`}
                            >
                              {tel.isMuted
                                ? t('remoteControl.metric_muted')
                                : tel.volumePct != null
                                  ? `${tel.volumePct}%`
                                  : '—'}
                            </p>
                          </div>
                        </div>
                      )}

                      {d.device_type === 'android_tablet' && (
                        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 p-2.5 text-center">
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-0.5">
                              <BatteryCharging className="w-3 h-3" /> {t('remoteControl.metric_battery')}
                            </p>
                            <p className="text-xs font-black text-slate-800 dark:text-slate-100">
                              {tel.batteryPct != null ? `${tel.batteryPct}%` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold">{t('remoteControl.metric_fullscreen')}</p>
                            <p className="text-xs font-black text-slate-800 dark:text-slate-100">
                              {tel.isFullscreen === true
                                ? t('remoteControl.metric_yes')
                                : tel.isFullscreen === false
                                  ? t('remoteControl.metric_no')
                                  : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold">{t('remoteControl.metric_route')}</p>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                              {tel.route || d.device_role}
                            </p>
                          </div>
                        </div>
                      )}

                      {d.device_type === 'tv_display' && (
                        <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 p-2.5">
                          {tel.activeImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={tel.activeImageUrl}
                              alt={d.display_name}
                              className="w-20 h-12 object-cover rounded-lg border border-slate-300 dark:border-slate-700 shrink-0"
                            />
                          ) : (
                            <div className="w-20 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                              <Tv className="w-5 h-5" />
                            </div>
                          )}
                          <div className="text-[11px] min-w-0 space-y-0.5">
                            <p className="font-bold text-slate-800 dark:text-slate-100">
                              {t('remoteControl.metric_screen')} #{tel.screenNumber ?? d.desired_config?.screenNumber ?? 1}
                              {tel.screenResolution ? ` • ${tel.screenResolution}` : ''}
                            </p>
                            <p className="text-slate-500">
                              {t('remoteControl.metric_fullscreen')}:{' '}
                              {tel.isFullscreen ? t('remoteControl.metric_yes') : t('remoteControl.metric_no')}
                            </p>
                          </div>
                        </div>
                      )}

                      {tel.lastAutoHealAction && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-2.5 py-1.5">
                          <span className="font-bold">{t('remoteControl.metric_last_autoheal')}:</span>{' '}
                          {tel.lastAutoHealAction}
                        </p>
                      )}

                      <p className="text-[11px] text-slate-400">
                        {t('remoteControl.last_seen')}:{' '}
                        {d.last_heartbeat_at
                          ? `${formatLaTimestamp(d.last_heartbeat_at)} (${formatRelativeAgo(d.last_heartbeat_at)})`
                          : t('remoteControl.never_connected')}
                      </p>
                    </div>

                    {/* Controles Rápidos por Tipo */}
                    <div className="space-y-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                      {/* Control de Volumen Windows */}
                      {d.device_type === 'windows_pc' && d.enrollment_status === 'enrolled' && (
                        <div className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-indigo-600 shrink-0" />
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={volValue}
                            onChange={(e) =>
                              setVolumeDrafts((prev) => ({ ...prev, [d.id]: Number(e.target.value) }))
                            }
                            className="flex-1 accent-indigo-600"
                          />
                          <span className="text-[11px] font-mono font-bold w-8 text-right text-slate-700 dark:text-slate-200">
                            {volValue}%
                          </span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'set_volume', { volumePct: volValue })}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                          >
                            {t('remoteControl.volume_apply')}
                          </button>
                        </div>
                      )}

                      {/* Botones de Acción según Tipo */}
                      {d.device_type === 'windows_pc' && (
                        <div className="flex flex-wrap gap-1.5">
                          {d.enrollment_status === 'enrolled' && (
                            <button
                              type="button"
                              onClick={() => setLiveScreenDevice(d)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-sm cursor-pointer"
                            >
                              <Monitor className="w-3.5 h-3.5" />
                              <span>{t('remoteControl.btn_view_screen_here')}</span>
                            </button>
                          )}

                          {d.remote_tool_url && (
                            <a
                              href={d.remote_tool_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-[11px] font-bold"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>{t('remoteControl.btn_open_action1')}</span>
                            </a>
                          )}

                          {d.enrollment_status === 'enrolled' &&
                            d.agent_version &&
                            d.agent_version !== REMOTE_AGENT_LATEST_VERSION && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void sendSingleCommand(d, 'update_agent')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-black cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>
                                  {t('remoteControl.btn_upgrade_agent_badge').replace(
                                    '{ver}',
                                    REMOTE_AGENT_LATEST_VERSION
                                  )}
                                </span>
                              </button>
                            )}

                          <button
                            type="button"
                            onClick={() => setInstallerDevice(d)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_installer')}</span>
                          </button>

                          {d.enrollment_status === 'enrolled' && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void sendSingleCommand(d, 'unmute_audio')}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                              >
                                {t('remoteControl.btn_unmute')}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void sendSingleCommand(d, 'test_audio')}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                              >
                                {t('remoteControl.btn_test_audio')}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void sendSingleCommand(d, 'reopen_board')}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                              >
                                {t('remoteControl.btn_reopen_board')}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void sendSingleCommand(d, 'restart_browser')}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                              >
                                {t('remoteControl.btn_restart_browser')}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void sendSingleCommand(d, 'apply_hardening')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold cursor-pointer"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>{t('remoteControl.btn_hardening')}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setPsDevice(d)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-black text-emerald-400 text-[11px] font-bold cursor-pointer"
                              >
                                <Terminal className="w-3.5 h-3.5" />
                                <span>{t('remoteControl.btn_powershell')}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  if (confirm(t('remoteControl.confirm_reboot'))) {
                                    void sendSingleCommand(d, 'reboot_pc')
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[11px] font-bold cursor-pointer"
                              >
                                <Power className="w-3.5 h-3.5" />
                                <span>{t('remoteControl.btn_reboot')}</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setConfigDevice(d)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-bold cursor-pointer"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_configure')}</span>
                          </button>
                        </div>
                      )}

                      {d.device_type === 'android_tablet' && (
                        <div className="flex flex-wrap gap-1.5">
                          {d.remote_tool_url && (
                            <a
                              href={d.remote_tool_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>{t('remoteControl.btn_view_screen')}</span>
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'reload_page')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_reload_tablet')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'clear_cache_reload')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_clear_cache_tablet')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              const msg = prompt(t('remoteControl.btn_send_banner'))
                              if (msg && msg.trim()) {
                                void sendSingleCommand(d, 'show_banner', { message: msg.trim(), durationSec: 90 })
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                          >
                            <Megaphone className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_send_banner')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'test_sound')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                          >
                            {t('remoteControl.btn_test_sound')}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'request_fullscreen')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_fullscreen')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfigDevice(d)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold cursor-pointer"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_configure')}</span>
                          </button>
                        </div>
                      )}

                      {d.device_type === 'tv_display' && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'refresh_menu')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_refresh_tv')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void sendSingleCommand(d, 'reload_page')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                          >
                            {t('remoteControl.btn_reload_tv')}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              const nextSc = prompt(`${t('remoteControl.metric_screen')} (1-6):`, '1')
                              const parsed = parseInt(nextSc || '', 10)
                              if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
                                void sendSingleCommand(d, 'switch_screen', { screenNumber: parsed })
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] font-bold cursor-pointer"
                          >
                            {t('remoteControl.btn_switch_screen')}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              const msg = prompt(t('remoteControl.btn_tv_overlay'))
                              if (msg && msg.trim()) {
                                void sendSingleCommand(d, 'show_overlay', { message: msg.trim() })
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 text-[11px] font-bold cursor-pointer"
                          >
                            {t('remoteControl.btn_tv_overlay')}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void sendSingleCommand(d, 'set_blackout', {
                                blackout: !Boolean(d.desired_config?.blackoutMode),
                              })
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-black text-white text-[11px] font-bold cursor-pointer"
                          >
                            {d.desired_config?.blackoutMode
                              ? t('remoteControl.btn_blackout_off')
                              : t('remoteControl.btn_blackout_on')}
                          </button>
                          {(d.desired_config?.overlayMessage || d.desired_config?.blackoutMode) && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void sendSingleCommand(d, 'clear_overlay')}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold cursor-pointer"
                            >
                              {t('remoteControl.btn_tv_clear_overlay')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setConfigDevice(d)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold cursor-pointer"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>{t('remoteControl.btn_configure')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: ACCIONES MASIVAS (15 SUCURSALES)                               */}
      {/* ===================================================================== */}
      {activeTab === 'bulk' && (
        <form
          onSubmit={handleBulkExecute}
          className="max-w-4xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-5"
        >
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">
              {t('remoteControl.bulk_title')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('remoteControl.bulk_desc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                {t('remoteControl.bulk_target_type')}
              </label>
              <select
                value={bulkDeviceType}
                onChange={(e) => {
                  const next = e.target.value as RemoteDeviceType
                  setBulkDeviceType(next)
                  if (next === 'windows_pc') setBulkCommand('unmute_audio')
                  else if (next === 'android_tablet') setBulkCommand('clear_cache_reload')
                  else setBulkCommand('refresh_menu')
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-semibold text-slate-900 dark:text-white"
              >
                <option value="windows_pc">{t('remoteControl.filter_windows_pc')}</option>
                <option value="android_tablet">{t('remoteControl.filter_android_tablet')}</option>
                <option value="tv_display">{t('remoteControl.filter_tv_display')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                {t('remoteControl.bulk_action_label')}
              </label>
              <select
                value={bulkCommand}
                onChange={(e) => setBulkCommand(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-semibold text-slate-900 dark:text-white"
              >
                {bulkDeviceType === 'windows_pc' && (
                  <>
                    <option value="unmute_audio">{t('remoteControl.btn_unmute')}</option>
                    <option value="set_volume">{t('remoteControl.volume_label')}</option>
                    <option value="test_audio">{t('remoteControl.btn_test_audio')}</option>
                    <option value="reopen_board">{t('remoteControl.btn_reopen_board')}</option>
                    <option value="restart_browser">{t('remoteControl.btn_restart_browser')}</option>
                    <option value="clear_browser_cache">{t('remoteControl.btn_clear_cache')}</option>
                    <option value="apply_hardening">{t('remoteControl.btn_hardening')}</option>
                    <option value="update_agent">{t('remoteControl.btn_update_agent')}</option>
                    <option value="run_powershell">{t('remoteControl.btn_powershell')}</option>
                    <option value="reboot_pc">{t('remoteControl.btn_reboot')}</option>
                  </>
                )}
                {bulkDeviceType === 'android_tablet' && (
                  <>
                    <option value="clear_cache_reload">{t('remoteControl.btn_clear_cache_tablet')}</option>
                    <option value="reload_page">{t('remoteControl.btn_reload_tablet')}</option>
                    <option value="show_banner">{t('remoteControl.btn_send_banner')}</option>
                    <option value="test_sound">{t('remoteControl.btn_test_sound')}</option>
                    <option value="request_fullscreen">{t('remoteControl.btn_fullscreen')}</option>
                  </>
                )}
                {bulkDeviceType === 'tv_display' && (
                  <>
                    <option value="refresh_menu">{t('remoteControl.btn_refresh_tv')}</option>
                    <option value="reload_page">{t('remoteControl.btn_reload_tv')}</option>
                    <option value="show_overlay">{t('remoteControl.btn_tv_overlay')}</option>
                    <option value="clear_overlay">{t('remoteControl.btn_tv_clear_overlay')}</option>
                    <option value="set_blackout">{t('remoteControl.btn_blackout_on')}</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {bulkCommand === 'set_volume' && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-4 border border-slate-200 dark:border-slate-800">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                {t('remoteControl.volume_label')}: {bulkVolume}%
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={bulkVolume}
                onChange={(e) => setBulkVolume(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>
          )}

          {(bulkCommand === 'show_banner' || bulkCommand === 'show_overlay' || bulkCommand === 'set_blackout') && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                {t('remoteControl.btn_send_banner')}
              </label>
              <input
                type="text"
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                required={bulkCommand !== 'set_blackout'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>
          )}

          {bulkCommand === 'run_powershell' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                PowerShell Script
              </label>
              <textarea
                rows={5}
                value={bulkPsScript}
                onChange={(e) => setBulkPsScript(e.target.value)}
                required
                placeholder={t('remoteControl.modal_ps_placeholder')}
                className="w-full px-3.5 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-950 text-emerald-300 font-mono text-xs"
              />
            </div>
          )}

          {/* Alcance de Sucursales */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              {t('remoteControl.bulk_store_scope')}
            </label>
            <div className="flex gap-3 text-xs font-semibold">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={bulkScope === 'all'}
                  onChange={() => setBulkScope('all')}
                  className="accent-indigo-600"
                />
                <span>{t('remoteControl.bulk_all_stores')}</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={bulkScope === 'selected'}
                  onChange={() => setBulkScope('selected')}
                  className="accent-indigo-600"
                />
                <span>{t('remoteControl.bulk_select_stores')}</span>
              </label>
            </div>

            {bulkScope === 'selected' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {REMOTE_STORE_OPTIONS.map((s) => {
                  const checked = bulkStores.includes(s.code)
                  return (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() =>
                        setBulkStores((prev) =>
                          prev.includes(s.code) ? prev.filter((x) => x !== s.code) : [...prev, s.code]
                        )
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-bold border text-left transition cursor-pointer ${
                        checked
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {s.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {bulkDeviceType === 'windows_pc' && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl px-3.5 py-2.5">
              {t('remoteControl.bulk_warning_pc')}
            </p>
          )}

          <button
            type="submit"
            disabled={bulkRunning || (bulkScope === 'selected' && bulkStores.length === 0)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black shadow-md disabled:opacity-50 cursor-pointer"
          >
            <Activity className={`w-4 h-4 ${bulkRunning ? 'animate-spin' : ''}`} />
            <span>{t('remoteControl.bulk_execute_btn')}</span>
          </button>
        </form>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: HISTORIAL Y AUDITORÍA                                          */}
      {/* ===================================================================== */}
      {activeTab === 'history' && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {commands.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">
              {t('remoteControl.history_empty')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">{t('remoteControl.history_col_time')}</th>
                    <th className="py-3 px-4">{t('remoteControl.history_col_store')}</th>
                    <th className="py-3 px-4">{t('remoteControl.history_col_cmd')}</th>
                    <th className="py-3 px-4">{t('remoteControl.history_col_status')}</th>
                    <th className="py-3 px-4">{t('remoteControl.history_col_by')}</th>
                    <th className="py-3 px-4">{t('remoteControl.history_col_output')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {commands.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 align-top">
                      <td className="py-3 px-4 whitespace-nowrap text-slate-500">
                        {formatLaTimestamp(c.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900 dark:text-white">{c.storeName}</p>
                        <p className="text-[11px] text-slate-500">{c.deviceName}</p>
                      </td>
                      <td className="py-3 px-4">
                        <code className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {c.command_type}
                        </code>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap space-y-1">
                        <div>{renderCommandStatusBadge(c.status)}</div>
                        {(c.status === 'pending' || c.status === 'dispatched') && (
                          <button
                            type="button"
                            onClick={() => void handleCancelCommand(c.id)}
                            className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
                          >
                            {t('remoteControl.history_cancel')}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {c.requested_by_name || 'Admin'}
                      </td>
                      <td className="py-3 px-4 max-w-md">
                        {c.error_message ? (
                          <p className="text-red-600 dark:text-red-400 font-mono text-[11px] whitespace-pre-wrap break-words">
                            {c.error_message}
                          </p>
                        ) : c.result_output ? (
                          <pre className="text-[11px] font-mono bg-slate-950 text-emerald-300 p-2 rounded-lg max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                            {c.result_output}
                          </pre>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: GUÍA 1-CLIC & CONFIGURACIÓN GLOBAL                             */}
      {/* ===================================================================== */}
      {activeTab === 'setup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form
            onSubmit={handleSaveGlobalSettings}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4"
          >
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              {t('remoteControl.setup_global_title')}
            </h2>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.setup_action1_org_label')}
              </label>
              <input
                type="url"
                value={a1OrgUrl}
                onChange={(e) => setA1OrgUrl(e.target.value)}
                placeholder="https://app.action1.com/console/endpoints"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.setup_action1_msi_label')}
              </label>
              <input
                type="url"
                value={a1MsiUrl}
                onChange={(e) => setA1MsiUrl(e.target.value)}
                placeholder="https://app.action1.com/agent/..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                {t('remoteControl.setup_action1_msi_hint')}
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.setup_action1_token_label')}
              </label>
              <input
                type="password"
                value={a1InstallToken}
                onChange={(e) => setA1InstallToken(e.target.value)}
                placeholder="eyJ..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                {t('remoteControl.setup_action1_token_hint')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('remoteControl.setup_rustdesk_host')}
                </label>
                <input
                  type="text"
                  value={rdHost}
                  onChange={(e) => setRdHost(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('remoteControl.setup_rustdesk_key')}
                </label>
                <input
                  type="text"
                  value={rdKey}
                  onChange={(e) => setRdKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 p-4 space-y-2.5">
              <p className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                {t('remoteControl.modal_config_watchdog_title')}
              </p>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalWd.watchdogEnabled}
                  onChange={(e) => setGlobalWd({ ...globalWd, watchdogEnabled: e.target.checked })}
                />
                <span>{t('remoteControl.modal_config_watchdog_enabled')}</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalWd.forceUnmute}
                  onChange={(e) => setGlobalWd({ ...globalWd, forceUnmute: e.target.checked })}
                />
                <span>{t('remoteControl.modal_config_force_unmute')}</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalWd.preventSleep}
                  onChange={(e) => setGlobalWd({ ...globalWd, preventSleep: e.target.checked })}
                />
                <span>{t('remoteControl.modal_config_prevent_sleep')}</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalWd.autoLaunchBrowser}
                  onChange={(e) => setGlobalWd({ ...globalWd, autoLaunchBrowser: e.target.checked })}
                />
                <span>{t('remoteControl.modal_config_auto_browser')}</span>
              </label>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {t('remoteControl.modal_config_min_volume')}: {globalWd.minVolumePct}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={globalWd.minVolumePct}
                  onChange={(e) => setGlobalWd({ ...globalWd, minVolumePct: Number(e.target.value) })}
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingGlobal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{t('remoteControl.setup_save_global')}</span>
            </button>
          </form>

          {/* Guía Definitiva Paso a Paso */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              {t('remoteControl.setup_guide_title')}
            </h2>

            {[
              { title: t('remoteControl.setup_step1_title'), body: t('remoteControl.setup_step1_body'), color: 'indigo' },
              { title: t('remoteControl.setup_step2_title'), body: t('remoteControl.setup_step2_body'), color: 'emerald' },
              { title: t('remoteControl.setup_step3_title'), body: t('remoteControl.setup_step3_body'), color: 'sky' },
              { title: t('remoteControl.setup_step4_title'), body: t('remoteControl.setup_step4_body'), color: 'amber' },
              { title: t('remoteControl.setup_step5_title'), body: t('remoteControl.setup_step5_body'), color: 'violet' },
            ].map((step) => (
              <div
                key={step.title}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-1"
              >
                <h3 className="text-xs font-black text-slate-900 dark:text-white">{step.title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modales */}
      <InstallerModal
        device={installerDevice}
        onClose={() => setInstallerDevice(null)}
        onUpdated={() => void fetchFleet(true)}
        notify={notify}
      />
      <ConfigureDeviceModal
        device={configDevice}
        onClose={() => setConfigDevice(null)}
        onUpdated={() => void fetchFleet(true)}
        notify={notify}
      />
      <PowerShellModal
        device={psDevice}
        onClose={() => setPsDevice(null)}
        onRun={async (dev, script) => {
          await sendSingleCommand(dev, 'run_powershell', { script })
        }}
      />
      <AddDeviceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => void fetchFleet(true)}
        notify={notify}
      />
      <LiveScreenModal
        device={liveScreenDevice}
        onClose={() => setLiveScreenDevice(null)}
        onSendQuickCommand={sendSingleCommand}
        notify={notify}
      />
    </div>
  )
}

export default function RemoteControlAdminPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <RemoteControlContent />
    </ProtectedRoute>
  )
}

/**
 * @module components/remote-control/RemoteControlModals
 * @description Modales interactivos del Centro de Control Remoto de Sucursales (`/admin/control-remoto`):
 *              1) Instalador 1-Clic (.cmd/.ps1) y revocación de token criptográfico,
 *              2) Configuración del equipo (Action1/RustDesk/Fully Kiosk) y políticas de Watchdog Windows,
 *              3) Consola PowerShell remota con presets seguros,
 *              4) Registro de nuevos equipos (PC adicional, Tableta Android o TV).
 *
 * @businessRules
 * - 100% bilingüe (ES/EN) usando `useLanguage()` (`remoteControl.*`).
 * - Descarga local vía Blob sin exponer credenciales en URLs.
 * - Incluye confirmaciones explícitas para revocar acceso o eliminar dispositivos.
 *
 * @dataFlow
 * - `app/admin/control-remoto/page.tsx` <-> `RemoteControlModals` -> APIs `/api/remote-control/*`.
 */

'use client'

import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
  DEFAULT_PC_WATCHDOG_CONFIG,
  REMOTE_STORE_OPTIONS,
  sanitizePcWatchdogConfig,
  type PcWatchdogConfig,
  type RemoteDeviceType,
  type RemoteFleetDevice,
  type RemoteToolProvider,
} from '@/lib/remote-control'

export interface FleetDeviceUI extends RemoteFleetDevice {
  storeName: string
  online: boolean
  linkedOrderReady?: {
    speakerOnline?: boolean
    prepTabletOnline?: boolean
    isMuted?: boolean
    audioUnlocked?: boolean
    voiceId?: string
    voiceVolume?: number
    isFullscreen?: boolean
    lastPlayedAt?: string | null
    lastPlayedOrder?: string | null
    lastHeartbeatAt?: string | null
  } | null
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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

// ---------------------------------------------------------------------------
// 1. Modal Instalador 1-Clic (.cmd / .ps1) & Revocación
// ---------------------------------------------------------------------------
export function InstallerModal({
  device,
  onClose,
  onUpdated,
  notify,
}: {
  device: FleetDeviceUI | null
  onClose: () => void
  onUpdated: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useLanguage()
  const [generating, setGenerating] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [bundle, setBundle] = useState<{
    tokenPrefix: string
    includesAction1: boolean
    fileNameCmd: string
    fileNamePs1: string
    installerCmd: string
    installerPs1: string
  } | null>(null)

  useEffect(() => {
    setBundle(null)
  }, [device?.id])

  if (!device) return null

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/remote-control/devices/${device.id}/enroll`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ action: 'enroll' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setBundle({
        tokenPrefix: data.tokenPrefix,
        includesAction1: Boolean(data.includesAction1),
        fileNameCmd: data.fileNameCmd,
        fileNamePs1: data.fileNamePs1,
        installerCmd: data.installerCmd,
        installerPs1: data.installerPs1,
      })
      onUpdated()
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleRevoke = async () => {
    if (!confirm(t('remoteControl.confirm_revoke'))) return
    setRevoking(true)
    try {
      const res = await fetch(`/api/remote-control/devices/${device.id}/enroll`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ action: 'revoke' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setBundle(null)
      notify(t('remoteControl.toast_saved'), 'success')
      onUpdated()
      onClose()
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('remoteControl.modal_installer_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {device.display_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('remoteControl.modal_installer_desc')}
          </p>

          {!bundle ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
              <span>
                {generating
                  ? t('remoteControl.modal_installer_generating')
                  : t('remoteControl.modal_installer_generate')}
              </span>
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Token: <code className="font-mono">{bundle.tokenPrefix}...</code>
                </span>
              </div>

              <div
                className={`text-xs font-semibold px-3 py-2 rounded-lg border ${
                  bundle.includesAction1
                    ? 'bg-emerald-100/80 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                }`}
              >
                {bundle.includesAction1
                  ? t('remoteControl.modal_installer_includes_a1')
                  : t('remoteControl.modal_installer_no_a1')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => downloadTextFile(bundle.fileNameCmd, bundle.installerCmd)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{t('remoteControl.modal_installer_download_cmd')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadTextFile(bundle.fileNamePs1, bundle.installerPs1)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-sm transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{t('remoteControl.modal_installer_download_ps1')}</span>
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <p className="font-bold text-slate-800 dark:text-slate-100">
              {t('remoteControl.modal_installer_steps_title')}
            </p>
            <p>{t('remoteControl.modal_installer_step1')}</p>
            <p>{t('remoteControl.modal_installer_step2')}</p>
            <p>{t('remoteControl.modal_installer_step3')}</p>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          {device.enrollment_status === 'enrolled' ? (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={revoking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 transition cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{t('remoteControl.modal_installer_revoke')}</span>
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer"
          >
            {t('remoteControl.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Modal Configurar Equipo & Watchdog
// ---------------------------------------------------------------------------
export function ConfigureDeviceModal({
  device,
  onClose,
  onUpdated,
  notify,
}: {
  device: FleetDeviceUI | null
  onClose: () => void
  onUpdated: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [provider, setProvider] = useState<RemoteToolProvider>('action1')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteDeviceId, setRemoteDeviceId] = useState('')
  const [notes, setNotes] = useState('')
  const [watchdog, setWatchdog] = useState<PcWatchdogConfig>(DEFAULT_PC_WATCHDOG_CONFIG)

  useEffect(() => {
    if (!device) return
    setDisplayName(device.display_name || '')
    setProvider(device.remote_tool_provider || 'action1')
    setRemoteUrl(device.remote_tool_url || '')
    setRemoteDeviceId(device.remote_tool_device_id || '')
    setNotes(device.notes || '')
    setWatchdog(sanitizePcWatchdogConfig(device.desired_config))
  }, [device])

  if (!device) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload: Record<string, any> = {
        displayName,
        remoteToolProvider: provider,
        remoteToolUrl: remoteUrl,
        remoteToolDeviceId: remoteDeviceId,
        notes,
      }
      if (device.device_type === 'windows_pc') {
        payload.desiredConfig = watchdog
      }

      const res = await fetch(`/api/remote-control/devices/${device.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      notify(t('remoteControl.toast_saved'), 'success')
      onUpdated()
      onClose()
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('remoteControl.confirm_delete_device'))) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/remote-control/devices/${device.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      notify(t('remoteControl.toast_deleted'), 'success')
      onUpdated()
      onClose()
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSave}
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('remoteControl.modal_config_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {device.storeName} • {device.device_key}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[74vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.modal_config_display_name')}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.modal_config_provider')}
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as RemoteToolProvider)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              >
                <option value="action1">Action1 (Windows Cloud RMM)</option>
                <option value="rustdesk">RustDesk (Windows / Android)</option>
                <option value="fully_kiosk">Fully Kiosk Browser (Android)</option>
                <option value="meshcentral">MeshCentral (Self-Hosted)</option>
                <option value="chrome_rdp">Chrome Remote Desktop</option>
                <option value="none">None / Web Bridge Only</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('remoteControl.modal_config_remote_url')}
            </label>
            <input
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://app.action1.com/console/endpoints/..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.modal_config_remote_id')}
              </label>
              <input
                type="text"
                value={remoteDeviceId}
                onChange={(e) => setRemoteDeviceId(e.target.value)}
                placeholder="ID Action1 / RustDesk"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('remoteControl.modal_config_notes')}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {device.device_type === 'windows_pc' && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                {t('remoteControl.modal_config_watchdog_title')}
              </h3>

              <div className="space-y-2 text-xs text-slate-700 dark:text-slate-200">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watchdog.watchdogEnabled}
                    onChange={(e) => setWatchdog({ ...watchdog, watchdogEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span className="font-semibold">{t('remoteControl.modal_config_watchdog_enabled')}</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watchdog.forceUnmute}
                    onChange={(e) => setWatchdog({ ...watchdog, forceUnmute: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>{t('remoteControl.modal_config_force_unmute')}</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watchdog.preventSleep}
                    onChange={(e) => setWatchdog({ ...watchdog, preventSleep: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>{t('remoteControl.modal_config_prevent_sleep')}</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watchdog.autoLaunchBrowser}
                    onChange={(e) => setWatchdog({ ...watchdog, autoLaunchBrowser: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>{t('remoteControl.modal_config_auto_browser')}</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watchdog.kioskFullscreen}
                    onChange={(e) => setWatchdog({ ...watchdog, kioskFullscreen: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>{t('remoteControl.modal_config_kiosk_fs')}</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {t('remoteControl.modal_config_min_volume')} ({watchdog.minVolumePct}%)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={watchdog.minVolumePct}
                    onChange={(e) => setWatchdog({ ...watchdog, minVolumePct: Number(e.target.value) })}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    {t('remoteControl.modal_config_target_path')}
                  </label>
                  <input
                    type="text"
                    value={watchdog.targetPath}
                    onChange={(e) => setWatchdog({ ...watchdog, targetPath: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>{t('remoteControl.modal_config_delete')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
            >
              {t('remoteControl.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('remoteControl.modal_config_save')}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. Modal Consola PowerShell Remota
// ---------------------------------------------------------------------------
const PS_PRESETS = [
  {
    label: 'Procesos Chrome / Edge',
    script: 'Get-Process chrome, msedge -ErrorAction SilentlyContinue | Select-Object Name, Id, WorkingSet64, MainWindowTitle | Format-Table -AutoSize',
  },
  {
    label: 'Dispositivos de Audio',
    script: 'Get-CimInstance Win32_SoundDevice | Select-Object Name, Status, Manufacturer | Format-Table -AutoSize',
  },
  {
    label: 'Reiniciar Servicio Audio',
    script: 'Restart-Service -Name Audiosrv -Force; Get-Service Audiosrv | Select-Object Name, Status',
  },
  {
    label: 'Espacio en Disco & RAM',
    script: 'Get-PSDrive C | Select-Object Name, @{N="UsedGB";E={[math]::Round($_.Used/1GB,1)}}, @{N="FreeGB";E={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize',
  },
]

export function PowerShellModal({
  device,
  onClose,
  onRun,
}: {
  device: FleetDeviceUI | null
  onClose: () => void
  onRun: (device: FleetDeviceUI, script: string) => Promise<void>
}) {
  const { t } = useLanguage()
  const [script, setScript] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    setScript('')
  }, [device?.id])

  if (!device) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!script.trim()) return
    setRunning(true)
    try {
      await onRun(device, script.trim())
      onClose()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('remoteControl.modal_ps_title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {device.display_name}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t('remoteControl.modal_ps_desc')}
          </p>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              {t('remoteControl.modal_ps_presets')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PS_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setScript(p.script)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-indigo-900/50 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            required
            placeholder={t('remoteControl.modal_ps_placeholder')}
            className="w-full px-3.5 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-950 text-emerald-300 font-mono text-xs leading-relaxed"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
          >
            {t('remoteControl.cancel')}
          </button>
          <button
            type="submit"
            disabled={running || !script.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{t('remoteControl.modal_ps_run')}</span>
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Modal Registrar Nuevo Equipo
// ---------------------------------------------------------------------------
export function AddDeviceModal({
  isOpen,
  onClose,
  onCreated,
  notify,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const { t } = useLanguage()
  const [storeCode, setStoreCode] = useState('LYNWOOD')
  const [deviceType, setDeviceType] = useState<RemoteDeviceType>('windows_pc')
  const [deviceRole, setDeviceRole] = useState('extra_pc')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/remote-control/devices', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          storeCode,
          deviceType,
          deviceRole,
          displayName: displayName.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      notify(t('remoteControl.toast_saved'), 'success')
      setDisplayName('')
      onCreated()
      onClose()
    } catch (err: any) {
      notify(err?.message || t('remoteControl.toast_error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <form
        onSubmit={handleCreate}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              {t('remoteControl.modal_add_title')}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('remoteControl.modal_add_store')}
            </label>
            <select
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            >
              {REMOTE_STORE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('remoteControl.modal_add_type')}
            </label>
            <select
              value={deviceType}
              onChange={(e) => {
                const nextType = e.target.value as RemoteDeviceType
                setDeviceType(nextType)
                setDeviceRole(
                  nextType === 'windows_pc'
                    ? 'extra_pc'
                    : nextType === 'android_tablet'
                      ? 'prep_tablet'
                      : 'tv_screen_1'
                )
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            >
              <option value="windows_pc">{t('remoteControl.badge_windows')}</option>
              <option value="android_tablet">{t('remoteControl.badge_tablet')}</option>
              <option value="tv_display">{t('remoteControl.badge_tv')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('remoteControl.modal_add_role')}
            </label>
            <input
              type="text"
              value={deviceRole}
              onChange={(e) => setDeviceRole(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('remoteControl.modal_add_name')}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ej. Lynwood — PC Gerente 2"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
          >
            {t('remoteControl.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t('remoteControl.modal_add_submit')}</span>
          </button>
        </div>
      </form>
    </div>
  )
}

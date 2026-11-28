/**
 * @module lib/remote-control
 * @description Catálogo isomórfico (Client + Server, sin dependencias de Node.js) de tipos, constantes,
 *              validadores y resolutores de tienda para el Centro de Control Remoto de Sucursales de Tacos Gavilan
 *              (PCs Windows, Tabletas Android y TVs de Menú Digital).
 *
 * @businessRules
 * - Cubre las 15 sucursales operativas (A–Z sin números `#`) más La Bodega Central (`BODEGA`).
 * - Define listas blancas estrictas de comandos por tipo de equipo (`windows_pc`, `android_tablet`, `tv_display`)
 *   para impedir la ejecución de comandos inválidos o inseguros.
 * - Ventana de dispositivo en línea (`ONLINE_THRESHOLDS_MS`):
 *   * `windows_pc`: 180s (3 min, latido cada 60s).
 *   * `android_tablet`: 180s (3 min, latido cada 45s).
 *   * `tv_display`: 420s (7 min, latido cada 60s–300s).
 * - Los comandos vencen automáticamente (`expires_at`, 15 min por defecto) para evitar reinicios tardíos
 *   si una PC se enciende horas después en horario pico.
 *
 * @dataFlow
 * - Importado por UI (`/admin/control-remoto`), Bridge Web (`RemoteDeviceBridge`), TV (`/tv`) y APIs (`/api/remote-control/*`).
 *
 * @notes
 * - Mantiene compatibilidad con códigos cortos de TV (`AZ`, `LY`, `SL`), códigos Toast (`AZUSA`, `HPARK`, `LABROADWY`),
 *   nombres legibles (`Huntington Park`) e IDs numéricos de `public.stores`.
 */

import { STORE_GUID_BY_CODE, TOAST_STORE_MAP, TOAST_STORES_SORTED } from '@/lib/toast-stores'

export type RemoteDeviceType = 'windows_pc' | 'android_tablet' | 'tv_display'
export type RemoteEnrollmentStatus = 'pending' | 'enrolled' | 'revoked'
export type RemoteToolProvider = 'action1' | 'rustdesk' | 'fully_kiosk' | 'chrome_rdp' | 'meshcentral' | 'none'
export type RemoteCommandStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'cancelled'

export const REMOTE_AGENT_LATEST_VERSION = '1.1.0'

export const REMOTE_ONLINE_THRESHOLDS_MS: Record<RemoteDeviceType, number> = {
  windows_pc: 420_000,
  android_tablet: 420_000,
  tv_display: 480_000,
}

/**
 * Tópico canónico de Supabase Realtime Broadcast para despertar tabletas/TVs al instante
 * (< 500 ms) cuando Admin encola un comando remoto, permitiendo espaciar el polling de respaldo.
 */
export function getRemoteBroadcastTopic(storeCode: string, deviceRole: string): string {
  const cleanStore = String(storeCode || '').trim().toUpperCase()
  const cleanRole = String(deviceRole || '').trim().toLowerCase()
  return `remote-control-${cleanStore}-${cleanRole}`
}

/**
 * Tópico efímero privado de Supabase Realtime Broadcast para transmisión de pantalla en vivo
 * dentro de SM TEG. Incluye el UUID criptográfico `sessionId` generado exclusivamente para Admin.
 */
export function getRemoteScreenBroadcastTopic(deviceId: string, sessionId: string): string {
  return `teg-remote-screen-${String(deviceId).trim()}-${String(sessionId).trim()}`
}

export const ALLOWED_SCREEN_HOTKEYS = [
  'enter',
  'backspace',
  'tab',
  'escape',
  'f5',
  'f11',
  'ctrl_r',
  'ctrl_shift_r',
  'ctrl_l',
  'ctrl_a',
  'ctrl_c',
  'ctrl_v',
  'alt_f4',
  'alt_tab',
  'win_d',
  'up',
  'down',
  'left',
  'right',
  'space',
] as const

export type RemoteScreenHotkey = (typeof ALLOWED_SCREEN_HOTKEYS)[number]

export type RemoteScreenInputEvent =
  | { type: 'click'; button: 'left' | 'right'; xPct: number; yPct: number }
  | { type: 'dblclick'; xPct: number; yPct: number }
  | { type: 'scroll'; xPct: number; yPct: number; delta: number }
  | { type: 'type'; text: string }
  | { type: 'hotkey'; key: RemoteScreenHotkey }

const SCREEN_HOTKEY_SET = new Set<string>(ALLOWED_SCREEN_HOTKEYS)

export function sanitizeScreenInputEvent(raw: unknown): RemoteScreenInputEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const t = String(src.type || '').trim().toLowerCase()

  const clampPct = (v: unknown): number | null => {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(1, Math.round(n * 10000) / 10000))
  }

  if (t === 'click') {
    const xPct = clampPct(src.xPct)
    const yPct = clampPct(src.yPct)
    if (xPct === null || yPct === null) return null
    const button = src.button === 'right' ? 'right' : 'left'
    return { type: 'click', button, xPct, yPct }
  }
  if (t === 'dblclick') {
    const xPct = clampPct(src.xPct)
    const yPct = clampPct(src.yPct)
    if (xPct === null || yPct === null) return null
    return { type: 'dblclick', xPct, yPct }
  }
  if (t === 'scroll') {
    const xPct = clampPct(src.xPct)
    const yPct = clampPct(src.yPct)
    const deltaNum = Number(src.delta)
    if (xPct === null || yPct === null || !Number.isFinite(deltaNum)) return null
    const delta = Math.max(-1200, Math.min(1200, Math.round(deltaNum)))
    return { type: 'scroll', xPct, yPct, delta }
  }
  if (t === 'type') {
    if (typeof src.text !== 'string') return null
    const clean = src.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 300)
    if (!clean) return null
    return { type: 'type', text: clean }
  }
  if (t === 'hotkey') {
    const key = String(src.key || '').trim().toLowerCase()
    if (!SCREEN_HOTKEY_SET.has(key)) return null
    return { type: 'hotkey', key: key as RemoteScreenHotkey }
  }
  return null
}

export const WINDOWS_COMMANDS = [
  'set_volume',
  'unmute_audio',
  'test_audio',
  'reopen_board',
  'restart_browser',
  'open_url',
  'clear_browser_cache',
  'apply_hardening',
  'sync_watchdog_config',
  'collect_diagnostics',
  'reboot_pc',
  'run_powershell',
  'update_agent',
  'start_screen_session',
] as const

export const TABLET_COMMANDS = [
  'reload_page',
  'clear_cache_reload',
  'navigate_url',
  'show_banner',
  'test_sound',
  'request_fullscreen',
] as const

export const TV_COMMANDS = [
  'refresh_menu',
  'reload_page',
  'switch_screen',
  'set_blackout',
  'show_overlay',
  'clear_overlay',
] as const

export type WindowsCommandType = (typeof WINDOWS_COMMANDS)[number]
export type TabletCommandType = (typeof TABLET_COMMANDS)[number]
export type TvCommandType = (typeof TV_COMMANDS)[number]
export type RemoteCommandType = WindowsCommandType | TabletCommandType | TvCommandType

export const COMMANDS_BY_DEVICE_TYPE: Record<RemoteDeviceType, readonly string[]> = {
  windows_pc: WINDOWS_COMMANDS,
  android_tablet: TABLET_COMMANDS,
  tv_display: TV_COMMANDS,
}

export interface PcWatchdogConfig {
  watchdogEnabled: boolean
  minVolumePct: number
  forceUnmute: boolean
  preventSleep: boolean
  autoLaunchBrowser: boolean
  kioskFullscreen: boolean
  targetPath: string
}

export const DEFAULT_PC_WATCHDOG_CONFIG: PcWatchdogConfig = {
  watchdogEnabled: true,
  minVolumePct: 85,
  forceUnmute: true,
  preventSleep: true,
  autoLaunchBrowser: true,
  kioskFullscreen: false,
  targetPath: '/order-ready-board',
}

export interface RemoteFleetSettings {
  id: string
  action1_org_url: string | null
  action1_installer_url: string | null
  action1_install_token?: string | null
  rustdesk_relay_host: string | null
  rustdesk_public_key: string | null
  default_pc_watchdog: PcWatchdogConfig
  updated_by: string | null
  updated_at: string
}

export interface RemoteDeviceTelemetry {
  // Windows PC fields
  hostname?: string | null
  osVersion?: string | null
  localIp?: string | null
  cpuPct?: number | null
  ramUsedPct?: number | null
  ramTotalGb?: number | null
  diskFreeGb?: number | null
  diskTotalGb?: number | null
  uptimeSec?: number | null
  volumePct?: number | null
  isMuted?: boolean | null
  audioDevice?: string | null
  browserRunning?: boolean | null
  browserName?: string | null
  activeWindowTitle?: string | null
  hardeningApplied?: boolean | null
  lastAutoHealAt?: string | null
  lastAutoHealAction?: string | null
  // Android Tablet & Web fields
  route?: string | null
  batteryPct?: number | null
  isCharging?: boolean | null
  isFullscreen?: boolean | null
  screenResolution?: string | null
  userAgent?: string | null
  wakeLockActive?: boolean | null
  // TV fields
  screenNumber?: number | null
  activeImageUrl?: string | null
  blackoutMode?: boolean | null
  overlayMessage?: string | null
}

export interface RemoteFleetDevice {
  id: string
  store_code: string
  device_type: RemoteDeviceType
  device_role: string
  device_key: string
  display_name: string
  agent_token_prefix: string | null
  enrollment_status: RemoteEnrollmentStatus
  remote_tool_provider: RemoteToolProvider
  remote_tool_url: string | null
  remote_tool_device_id: string | null
  desired_config: Record<string, any>
  telemetry: RemoteDeviceTelemetry
  agent_version: string | null
  last_heartbeat_at: string | null
  last_command_ack_at: string | null
  last_ip: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface RemoteFleetCommand {
  id: string
  device_id: string
  store_code: string
  device_type: RemoteDeviceType
  command_type: RemoteCommandType
  payload: Record<string, any>
  status: RemoteCommandStatus
  requested_by_user_id: string | null
  requested_by_name: string | null
  batch_id: string | null
  created_at: string
  dispatched_at: string | null
  completed_at: string | null
  expires_at: string
  result_exit_code: number | null
  result_output: string | null
  result_meta: Record<string, any> | null
  error_message: string | null
}

export interface StoreOption {
  code: string
  name: string
  shortTvCode: string
  numericId: number | null
}

export const REMOTE_STORE_OPTIONS: ReadonlyArray<StoreOption> = [
  ...TOAST_STORES_SORTED.map((s) => {
    const shortMap: Record<string, string> = {
      AZUSA: 'AZ',
      BELL: 'BE',
      DOWNEY: 'DO',
      HOLLYWOOD: 'HO',
      HPARK: 'HP',
      LABROADWY: 'BW',
      LACENTRAL: 'CE',
      LAPUENTE: 'LP',
      LYNWOOD: 'LY',
      NORWALK: 'NO',
      RIALTO: 'RI',
      SANTAANA: 'SA',
      SLAUSON: 'SL',
      SOUTHGATE: 'SG',
      WCOVINA: 'WC',
    }
    const idMap: Record<string, number> = {
      AZUSA: 4,
      BELL: 13,
      DOWNEY: 16,
      HOLLYWOOD: 8,
      HPARK: 11,
      LABROADWY: 5,
      LACENTRAL: 6,
      LAPUENTE: 10,
      LYNWOOD: 14,
      NORWALK: 12,
      RIALTO: 1,
      SANTAANA: 9,
      SLAUSON: 7,
      SOUTHGATE: 15,
      WCOVINA: 3,
    }
    return {
      code: s.code,
      name: s.name,
      shortTvCode: shortMap[s.code] || s.code.slice(0, 2),
      numericId: idMap[s.code] ?? null,
    }
  }),
  {
    code: 'BODEGA',
    name: 'La Bodega Central',
    shortTvCode: 'BO',
    numericId: null,
  },
]

const STORE_ALIAS_TO_CODE: Record<string, string> = {
  AZ: 'AZUSA',
  AZUSA: 'AZUSA',
  '4': 'AZUSA',
  BE: 'BELL',
  BELL: 'BELL',
  '13': 'BELL',
  DO: 'DOWNEY',
  DOWNEY: 'DOWNEY',
  '16': 'DOWNEY',
  HO: 'HOLLYWOOD',
  HOLLYWOOD: 'HOLLYWOOD',
  '8': 'HOLLYWOOD',
  HP: 'HPARK',
  HPARK: 'HPARK',
  'HUNTINGTON PARK': 'HPARK',
  HUNTINGTONPARK: 'HPARK',
  '11': 'HPARK',
  BW: 'LABROADWY',
  LABROADWY: 'LABROADWY',
  'LA BROADWAY': 'LABROADWY',
  LABROADWAY: 'LABROADWY',
  BROADWAY: 'LABROADWY',
  '5': 'LABROADWY',
  CE: 'LACENTRAL',
  LACENTRAL: 'LACENTRAL',
  'LA CENTRAL': 'LACENTRAL',
  CENTRAL: 'LACENTRAL',
  '6': 'LACENTRAL',
  LP: 'LAPUENTE',
  LAPUENTE: 'LAPUENTE',
  'LA PUENTE': 'LAPUENTE',
  '10': 'LAPUENTE',
  LY: 'LYNWOOD',
  LYNWOOD: 'LYNWOOD',
  '14': 'LYNWOOD',
  NO: 'NORWALK',
  NORWALK: 'NORWALK',
  '12': 'NORWALK',
  RI: 'RIALTO',
  RIALTO: 'RIALTO',
  '1': 'RIALTO',
  SA: 'SANTAANA',
  SANTAANA: 'SANTAANA',
  'SANTA ANA': 'SANTAANA',
  '9': 'SANTAANA',
  SL: 'SLAUSON',
  SLAUSON: 'SLAUSON',
  '7': 'SLAUSON',
  SG: 'SOUTHGATE',
  SOUTHGATE: 'SOUTHGATE',
  'SOUTH GATE': 'SOUTHGATE',
  '15': 'SOUTHGATE',
  WC: 'WCOVINA',
  WCOVINA: 'WCOVINA',
  'WEST COVINA': 'WCOVINA',
  WESTCOVINA: 'WCOVINA',
  '3': 'WCOVINA',
  BO: 'BODEGA',
  BODEGA: 'BODEGA',
  WAREHOUSE: 'BODEGA',
  'LA BODEGA': 'BODEGA',
  'LA BODEGA CENTRAL': 'BODEGA',
}

/**
 * Resuelve cualquier alias de sucursal (GUID Toast, código corto TV `LY`, nombre `La Puente`,
 * ID numérico `14` o código canónico `LYNWOOD`) hacia el código canónico del sistema.
 */
export function normalizeRemoteStoreCode(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null

  const guidEntry = TOAST_STORE_MAP[trimmed.toLowerCase()] || TOAST_STORE_MAP[trimmed]
  if (guidEntry?.code) return guidEntry.code

  const upper = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^#\d+\s*/, '')
    .replace(/\s*\(#?\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

  if (STORE_GUID_BY_CODE[upper]) return upper
  if (STORE_ALIAS_TO_CODE[upper]) return STORE_ALIAS_TO_CODE[upper]

  const compact = upper.replace(/[\s_-]+/g, '')
  if (STORE_ALIAS_TO_CODE[compact]) return STORE_ALIAS_TO_CODE[compact]

  return null
}

export function getRemoteStoreDisplayName(storeCode: string): string {
  const normalized = normalizeRemoteStoreCode(storeCode)
  if (!normalized) return storeCode
  const found = REMOTE_STORE_OPTIONS.find((s) => s.code === normalized)
  return found ? found.name : normalized
}

export function isValidCommandForDeviceType(
  deviceType: RemoteDeviceType,
  commandType: string
): commandType is RemoteCommandType {
  return COMMANDS_BY_DEVICE_TYPE[deviceType]?.includes(commandType) ?? false
}

export function isDeviceOnline(
  device: Pick<RemoteFleetDevice, 'device_type' | 'last_heartbeat_at'>,
  nowMs: number = Date.now()
): boolean {
  if (!device.last_heartbeat_at) return false
  const ts = new Date(device.last_heartbeat_at).getTime()
  if (!Number.isFinite(ts)) return false
  const threshold = REMOTE_ONLINE_THRESHOLDS_MS[device.device_type] ?? 180_000
  return nowMs - ts <= threshold
}

export function isSafeInternalRoute(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const val = raw.trim()
  if (!val.startsWith('/') || val.startsWith('//')) return false
  if (val.length > 260) return false
  return /^\/[a-zA-Z0-9/_?&=%.-]*$/.test(val)
}

export function isSafeHttpOrHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const val = raw.trim()
  if (!val || val.length > 1000) return false
  try {
    const u = new URL(val)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export function sanitizePcWatchdogConfig(raw: unknown): PcWatchdogConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawVol = Number(src.minVolumePct)
  const minVolumePct = Number.isFinite(rawVol)
    ? Math.max(0, Math.min(100, Math.round(rawVol)))
    : DEFAULT_PC_WATCHDOG_CONFIG.minVolumePct

  const targetPath = isSafeInternalRoute(src.targetPath)
    ? src.targetPath.trim()
    : DEFAULT_PC_WATCHDOG_CONFIG.targetPath

  return {
    watchdogEnabled:
      typeof src.watchdogEnabled === 'boolean'
        ? src.watchdogEnabled
        : DEFAULT_PC_WATCHDOG_CONFIG.watchdogEnabled,
    minVolumePct,
    forceUnmute:
      typeof src.forceUnmute === 'boolean'
        ? src.forceUnmute
        : DEFAULT_PC_WATCHDOG_CONFIG.forceUnmute,
    preventSleep:
      typeof src.preventSleep === 'boolean'
        ? src.preventSleep
        : DEFAULT_PC_WATCHDOG_CONFIG.preventSleep,
    autoLaunchBrowser:
      typeof src.autoLaunchBrowser === 'boolean'
        ? src.autoLaunchBrowser
        : DEFAULT_PC_WATCHDOG_CONFIG.autoLaunchBrowser,
    kioskFullscreen:
      typeof src.kioskFullscreen === 'boolean'
        ? src.kioskFullscreen
        : DEFAULT_PC_WATCHDOG_CONFIG.kioskFullscreen,
    targetPath,
  }
}

export function buildDeviceKey(
  storeCode: string,
  deviceType: RemoteDeviceType,
  deviceRole: string
): string {
  const cleanRole = deviceRole
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${storeCode}:${deviceType}:${cleanRole || 'default'}`
}

export function sanitizePlainOverlayText(raw: unknown, maxLen = 280): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/**
 * @module lib/remote-control-server
 * @description Helpers exclusivos de servidor (Node.js) para el Centro de Control Remoto de Sucursales:
 *              generación y hash SHA-256 de tokens por PC (`teg_dev_...`), validación estricta de rol Admin activo,
 *              autenticación de agentes Windows, expiración automática de comandos vencidos y rate limiting.
 *
 * @businessRules
 * - **Cero Secretos de Supabase en Tiendas**: Las PCs jamás reciben `SUPABASE_SERVICE_ROLE_KEY`; cada PC utiliza
 *   un token revocable único almacenado únicamente como hash SHA-256 en `remote_fleet_devices.agent_token_hash`.
 * - **Acceso Exclusivo Admin**: Toda administración de flota, generación de instaladores y emisión de comandos
 *   exige JWT válido con rol `'admin'` Y usuario activo en `public.users` (`is_active !== false`).
 * - **Expiración Preventiva**: Los comandos `pending`/`dispatched` cuya fecha `expires_at` haya vencido pasan
 *   automáticamente a `expired` antes de ser entregados al agente para evitar reinicios inesperados en hora pico.
 *
 * @dataFlow
 * - API Routes (`/api/remote-control/*`) -> `requireActiveAdmin()` / `authenticateWindowsAgent()` -> `supabaseAdmin`.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkRateLimit, getServerUser, safeTimingEqual, verifyAdminAuth } from '@/lib/auth-server'
import { getRemoteBroadcastTopic, type RemoteFleetDevice } from '@/lib/remote-control'

export const AGENT_TOKEN_PREFIX_TAG = 'teg_dev_'
export const MAX_COMMAND_OUTPUT_CHARS = 16_000
const EXPIRE_SWEEP_THROTTLE_MS = 60_000
const lastExpireSweepByScope = new Map<string, number>()

export function generateDeviceAgentToken(): {
  plainToken: string
  tokenHash: string
  tokenPrefix: string
} {
  const randomHex = crypto.randomBytes(32).toString('hex')
  const plainToken = `${AGENT_TOKEN_PREFIX_TAG}${randomHex}`
  const tokenHash = hashAgentToken(plainToken)
  const tokenPrefix = plainToken.slice(0, 14)
  return { plainToken, tokenHash, tokenPrefix }
}

export function hashAgentToken(plainToken: string): string {
  return crypto.createHash('sha256').update(plainToken.trim(), 'utf8').digest('hex')
}

export function extractClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  return 'unknown'
}

export function truncateCommandOutput(raw: unknown, maxChars = MAX_COMMAND_OUTPUT_CHARS): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw)
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`
}

export interface ActiveAdminAuthResult {
  authorized: boolean
  userId?: string
  userName?: string
  email?: string
  response?: NextResponse
}

/**
 * Exige rol `admin` mediante `verifyAdminAuth` + verificación de estado activo vía `getServerUser`.
 */
export async function requireActiveAdmin(request: Request): Promise<ActiveAdminAuthResult> {
  const baseCheck = verifyAdminAuth(request, { allowCron: false })
  if (!baseCheck.authorized) {
    return {
      authorized: false,
      response:
        baseCheck.response ||
        NextResponse.json({ error: baseCheck.error || 'No autorizado' }, { status: baseCheck.status || 401 }),
    }
  }

  const serverUser = await getServerUser(request)
  if (!serverUser || serverUser.role.toLowerCase() !== 'admin') {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Acceso denegado: Usuario administrador inactivo o sin permisos' },
        { status: 403 }
      ),
    }
  }

  return {
    authorized: true,
    userId: String(serverUser.id),
    userName: serverUser.name || serverUser.email || 'Admin',
    email: serverUser.email,
  }
}

export interface AgentAuthResult {
  authenticated: boolean
  device?: RemoteFleetDevice
  response?: NextResponse
}

/**
 * Autentica un agente Windows por token `Authorization: Bearer teg_dev_...`
 * validando hash SHA-256 en tiempo constante y bloqueando equipos revocados.
 */
export async function authenticateWindowsAgent(request: Request): Promise<AgentAuthResult> {
  const ip = extractClientIp(request)
  const rl = checkRateLimit(`remote_agent_ip:${ip}`, 180, 60_000)
  if (rl.limited) {
    return {
      authenticated: false,
      response: NextResponse.json(
        { error: 'Demasiadas peticiones del agente', retryAfterSec: rl.retryAfterSec },
        { status: 429 }
      ),
    }
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const xAgentToken = request.headers.get('x-teg-agent-token') || ''
  const rawToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : xAgentToken.trim()

  if (!rawToken || !rawToken.startsWith(AGENT_TOKEN_PREFIX_TAG) || rawToken.length < 40) {
    return {
      authenticated: false,
      response: NextResponse.json({ error: 'Token de agente inválido o ausente' }, { status: 401 }),
    }
  }

  const candidateHash = hashAgentToken(rawToken)

  const { data: device, error } = await supabaseAdmin
    .from('remote_fleet_devices')
    .select(
      'id, store_code, device_type, device_role, device_key, display_name, agent_token_hash, enrollment_status, desired_config, telemetry, agent_version'
    )
    .eq('agent_token_hash', candidateHash)
    .maybeSingle()

  if (error || !device || !device.agent_token_hash) {
    return {
      authenticated: false,
      response: NextResponse.json({ error: 'Dispositivo no autorizado' }, { status: 401 }),
    }
  }

  if (!safeTimingEqual(device.agent_token_hash, candidateHash)) {
    return {
      authenticated: false,
      response: NextResponse.json({ error: 'Dispositivo no autorizado' }, { status: 401 }),
    }
  }

  if (device.enrollment_status === 'revoked') {
    return {
      authenticated: false,
      response: NextResponse.json({ error: 'Token revocado por administrador' }, { status: 403 }),
    }
  }

  return {
    authenticated: true,
    device: device as unknown as RemoteFleetDevice,
  }
}

/**
 * Marca como `expired` cualquier comando pendiente cuyo `expires_at` ya venció.
 * Incluye throttle en memoria (60s global / 5 min por dispositivo) para evitar UPDATEs
 * redundantes en tablas vacías desde heartbeats de dispositivos.
 */
export async function expireStaleCommands(
  deviceId?: string,
  options?: { force?: boolean }
): Promise<void> {
  const scopeKey = deviceId || '__all__'
  const nowMs = Date.now()
  const ttlMs = deviceId ? 300_000 : EXPIRE_SWEEP_THROTTLE_MS
  if (!options?.force) {
    const lastRun = lastExpireSweepByScope.get(scopeKey) || 0
    if (nowMs - lastRun < ttlMs) return
  }
  lastExpireSweepByScope.set(scopeKey, nowMs)
  if (lastExpireSweepByScope.size > 200) {
    lastExpireSweepByScope.clear()
    lastExpireSweepByScope.set(scopeKey, nowMs)
  }

  const nowIso = new Date(nowMs).toISOString()
  let query = supabaseAdmin
    .from('remote_fleet_commands')
    .update({
      status: 'expired',
      completed_at: nowIso,
      error_message: 'Comando expirado sin respuesta antes del tiempo límite.',
    })
    .in('status', ['pending', 'dispatched'])
    .lt('expires_at', nowIso)

  if (deviceId) {
    query = query.eq('device_id', deviceId)
  }

  await query
}

/**
 * Emite un ping ligero vía Supabase Realtime Broadcast hacia las tabletas/TVs destino
 * para que ejecuten comandos remotos en < 500 ms sin requerir polling agresivo.
 */
export async function broadcastRemoteControlWakeup(
  targets: Array<{ store_code: string; device_role: string; device_type: string; id: string }>,
  commandType: string
): Promise<void> {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!baseUrl || !serviceKey) return

  const webTargets = targets.filter(
    (d) => d.device_type === 'android_tablet' || d.device_type === 'tv_display'
  )
  if (webTargets.length === 0) return

  const seenTopics = new Set<string>()
  const messages: Array<{ topic: string; event: string; payload: Record<string, unknown> }> = []
  const nowIso = new Date().toISOString()

  for (const d of webTargets) {
    const topic = getRemoteBroadcastTopic(d.store_code, d.device_role)
    if (seenTopics.has(topic)) continue
    seenTopics.add(topic)
    messages.push({
      topic,
      event: 'command_queued',
      payload: {
        storeCode: d.store_code,
        deviceRole: d.device_role,
        commandType,
        sentAt: nowIso,
      },
    })
  }

  if (messages.length === 0) return

  try {
    await fetch(`${baseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      signal: AbortSignal.timeout(2_000),
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ messages }),
    })
  } catch {
    // Non-blocking: fallback polling guarantees delivery even if broadcast fails
  }
}

/**
 * Sanitiza un registro de dispositivo para nunca devolver `agent_token_hash` a la UI.
 */
export function stripDeviceSecrets<T extends Record<string, any>>(row: T): Omit<T, 'agent_token_hash'> {
  const copy = { ...row }
  delete copy.agent_token_hash
  return copy
}

export function resolvePublicBaseUrl(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (envUrl && /^https?:\/\//i.test(envUrl.trim())) {
    return envUrl.trim().replace(/\/+$/, '')
  }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https')
  if (host) {
    return `${proto}://${host}`.replace(/\/+$/, '')
  }
  return 'https://tacosgavilan.com'
}

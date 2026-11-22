/**
 * @module lib/basecamp-api
 * @description Módulo central de integración con la API REST de Basecamp 3. Maneja autenticación OAuth2,
 *              renovación automática de tokens, rate limiting, paginación, reintentos con backoff exponencial,
 *              y todas las operaciones CRUD contra la API de Basecamp.
 *
 * @businessRules
 * - **Fuente de Verdad**: Supabase es la fuente de verdad del sistema. Basecamp actúa como proveedor
 *   externo de datos y como herramienta de comunicación. Los datos se sincronizan bidireccionalmente
 *   pero Supabase prevalece en caso de conflicto.
 * - **Token Management**: Se almacena un único par de tokens (access + refresh) en la tabla `bc_oauth_tokens`.
 *   El access_token se renueva automáticamente cuando expira, usando el refresh_token.
 * - **Rate Limiting**: Basecamp permite máximo 50 requests/10s por token (documentación dice 500/10s
 *   pero la práctica muestra que 50/10s es más seguro). Se implementa throttling interno.
 * - **User-Agent Obligatorio**: Basecamp EXIGE un User-Agent con nombre de app y email de contacto
 *   en TODAS las peticiones, o retorna 429/403.
 * - **Paginación**: La API usa paginación por header `Link` con `rel="next"`. Se sigue automáticamente.
 * - **Migración Futura**: El sistema debe soportar migración fuera de Basecamp. Todo dato relevante
 *   se persiste en Supabase con `bc_id` como clave de mapeo.
 *
 * @dataFlow
 * - OAuth2 Flow: User → /api/basecamp/auth → Basecamp Auth → /api/basecamp/callback → Supabase `bc_oauth_tokens`
 * - API Calls: `getValidToken()` → Supabase token lookup → auto-refresh if expired → `basecampFetch()` → Basecamp API
 * - Sync: `fetchProjects/Todos/Messages/etc.` → `basecampFetch()` → JSON → Caller (sync route) → Supabase upsert
 *
 * @notes
 * - Account ID fijo: 5052386 (configurado en BASECAMP_ACCOUNT_ID)
 * - Base URL: https://3.basecampapi.com/{account_id}/
 * - Auth URLs usan launchpad.37signals.com (no basecampapi.com)
 * - El token de Basecamp expira cada 2 semanas (~1,209,600 segundos). El refresh_token no expira.
 * - Soporta modo híbrido (`hybrid`) y 100% independiente (`standalone`) controlado por `public.bc_system_config`
 *   con caché en memoria de 15s e invalidación inmediata + auto-cutover ante cancelación de cuenta (`402` / `404` / `invalid_grant`).
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { sanitizeBasecampHtml as sanitizeBasecampHtmlShared } from '@/lib/basecamp-html'

// ============================================================================
// CONFIGURATION & ALLOWED ROLES
// ============================================================================

export const BASECAMP_STAFF_ALLOWED_ROLES: string[] = [
  'admin',
  'supervisor',
  'regional_manager',
  'manager',
  'gerente',
  'general_manager',
  'asistente',
  'assistant',
  'basecamp',
]

const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID || '5052386'
const BASECAMP_API_BASE = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}`
const BASECAMP_AUTH_BASE = 'https://launchpad.37signals.com'
const BASECAMP_USER_AGENT = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (noreply@tacosgavilan.com)'

// Rate limiting: Basecamp allows 50 req/10s (conservative) – we enforce internally
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX_REQUESTS = 50
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1_000

// ============================================================================
// TYPES — Basecamp 3 API Response Interfaces
// ============================================================================

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface BasecampProject {
  id: number
  status: string
  created_at: string
  updated_at: string
  name: string
  description: string
  purpose: string
  clients_enabled: boolean
  bookmark_url: string
  url: string
  app_url: string
  dock: BasecampDock[]
  bookmarked: boolean
}

export interface BasecampDock {
  id: number
  title: string
  name: string
  enabled: boolean
  position: number
  url: string
  app_url: string
}

export interface BasecampPerson {
  id: number
  attachable_sgid: string
  name: string
  email_address: string
  personable_type: string
  title: string
  bio: string | null
  location: string | null
  created_at: string
  updated_at: string
  admin: boolean
  owner: boolean
  client: boolean
  employee: boolean
  time_zone: string
  avatar_url: string
  avatar_kind: string
  status?: string
  company: {
    id: number
    name: string
  } | null
}

export interface BasecampTodoList {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  position: number
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  description: string
  completed: boolean
  completed_ratio: string
  color?: string | null
  name: string
  todos_url: string
  groups_url: string
  app_todos_url: string
}

export interface BasecampPersonRef {
  id: number
  attachable_sgid: string
  name: string
  email_address: string
  personable_type: string
  title: string
  bio: string | null
  location: string | null
  created_at: string
  updated_at: string
  admin: boolean
  owner: boolean
  client: boolean
  employee: boolean
  time_zone: string
  avatar_url: string
  avatar_kind: string
}

export interface BasecampTodo {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  position: number
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  completion_url: string
  completed: boolean
  content: string
  description: string
  starts_on: string | null
  due_on: string | null
  assignees: BasecampPersonRef[]
  completion_subscribers: BasecampPersonRef[]
  completor: BasecampPersonRef | null
  boosts_count?: number
  boosts_url?: string
}

export interface BasecampBoost {
  id: number
  content: string
  created_at: string
  booster?: BasecampPersonRef
  recording?: { id: number; title?: string; type: string; url?: string }
}

export interface BasecampMessage {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
  subject: string
  pinned?: boolean
  category: { id: number; title?: string; name: string; icon?: string; color?: string } | null
}

export interface BasecampMessageCategory {
  id: number
  name: string
  icon?: string
  created_at?: string
  updated_at?: string
}

export interface BasecampCampfireLine {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
}

export interface BasecampDocument {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
}

export interface BasecampUpload {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  description: string
  content_type: string
  byte_size: number
  filename: string
  download_url: string
  app_download_url: string
  width: number | null
  height: number | null
}

export interface BasecampScheduleEntry {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  description: string
  summary: string
  all_day: boolean
  starts_at: string
  ends_at: string
  participants: BasecampPersonRef[]
}

export interface BasecampQuestion {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  paused: boolean
  answers_count: number
  answers_url: string
  schedule_day?: string
  schedule_time?: string
  schedule?: {
    frequency?: string
    days?: number[]
    hour?: number | null
    minute?: number | null
    start_date?: string | null
    end_date?: string | null
  } | null
}

export interface BasecampAnswer {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
  group_on: string
}

// Write operation payloads
export interface CreateTodoData {
  content: string
  description?: string
  assignee_ids?: number[]
  completion_subscriber_ids?: number[]
  notify?: boolean
  due_on?: string
  starts_on?: string
}

export interface UpdateTodoData {
  content: string
  description?: string
  assignee_ids?: number[]
  completion_subscriber_ids?: number[]
  starts_on?: string | null
  due_on?: string | null
  notify?: boolean
}

export interface CreateMessageData {
  subject: string
  content?: string
  status?: string
  category_id?: number
  subscriptions?: number[]
}

// ============================================================================
// SUPABASE CLIENT (Server-Side — Service Role)
// ============================================================================

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase credentials for Basecamp token management')
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

// ============================================================================
// SYSTEM CONFIG & AUTO-CUTOVER (`public.bc_system_config`, id = 1)
// ============================================================================

export type BasecampRuntimeMode = 'hybrid' | 'standalone'

export interface BasecampSystemConfig {
  id: number
  runtime_mode: BasecampRuntimeMode
  auto_cutover_enabled: boolean
  standalone_activated_at: string | null
  standalone_reason: string | null
  updated_by: string | null
  updated_at: string | null
}

const SYSTEM_CONFIG_CACHE_TTL_MS = 5_000

type GlobalBcConfigCacheHolder = typeof globalThis & {
  __tegBcSystemConfigCache?: { value: BasecampSystemConfig; expiresAt: number } | null
  __tegBcSystemConfigInflight?: Promise<BasecampSystemConfig> | null
}
const globalBcConfigHolder = globalThis as GlobalBcConfigCacheHolder

function normalizeSystemConfigRow(row: any): BasecampSystemConfig {
  return {
    id: 1,
    runtime_mode: row?.runtime_mode === 'standalone' ? 'standalone' : 'hybrid',
    auto_cutover_enabled: row?.auto_cutover_enabled !== false,
    standalone_activated_at: row?.standalone_activated_at || null,
    standalone_reason: row?.standalone_reason || null,
    updated_by: row?.updated_by || null,
    updated_at: row?.updated_at || null,
  }
}

export function invalidateBasecampSystemConfigCache(): void {
  globalBcConfigHolder.__tegBcSystemConfigCache = null
  globalBcConfigHolder.__tegBcSystemConfigInflight = null
}

export async function getBasecampSystemConfig(options?: {
  bypassCache?: boolean
}): Promise<BasecampSystemConfig> {
  const bypass = Boolean(options?.bypassCache)
  const cached = globalBcConfigHolder.__tegBcSystemConfigCache
  if (!bypass && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  if (!bypass && globalBcConfigHolder.__tegBcSystemConfigInflight) {
    return globalBcConfigHolder.__tegBcSystemConfigInflight
  }

  const fetchPromise = (async (): Promise<BasecampSystemConfig> => {
    try {
      const supabase = getServiceClient()
      const { data, error } = await supabase
        .from('bc_system_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle()

      if (error) {
        console.warn('⚠️ [Basecamp Config] Error reading bc_system_config, using safe fallback:', error.message)
        return globalBcConfigHolder.__tegBcSystemConfigCache?.value || normalizeSystemConfigRow(null)
      }

      if (!data) {
        const nowIso = new Date().toISOString()
        const { data: created } = await supabase
          .from('bc_system_config')
          .upsert(
            { id: 1, runtime_mode: 'hybrid', auto_cutover_enabled: true, updated_at: nowIso },
            { onConflict: 'id' }
          )
          .select('*')
          .maybeSingle()
        const normalized = normalizeSystemConfigRow(created)
        globalBcConfigHolder.__tegBcSystemConfigCache = {
          value: normalized,
          expiresAt: Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS,
        }
        return normalized
      }

      const normalized = normalizeSystemConfigRow(data)
      globalBcConfigHolder.__tegBcSystemConfigCache = {
        value: normalized,
        expiresAt: Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS,
      }
      return normalized
    } catch (err: any) {
      console.warn('⚠️ [Basecamp Config] Unexpected exception reading bc_system_config:', err?.message || err)
      return globalBcConfigHolder.__tegBcSystemConfigCache?.value || normalizeSystemConfigRow(null)
    } finally {
      globalBcConfigHolder.__tegBcSystemConfigInflight = null
    }
  })()

  if (!bypass) {
    globalBcConfigHolder.__tegBcSystemConfigInflight = fetchPromise
  }
  return fetchPromise
}

export async function updateBasecampSystemConfig(input: {
  runtimeMode?: BasecampRuntimeMode
  autoCutoverEnabled?: boolean
  reason?: string | null
  updatedBy?: string | null
}): Promise<BasecampSystemConfig> {
  const supabase = getServiceClient()
  const current = await getBasecampSystemConfig({ bypassCache: true })
  const nowIso = new Date().toISOString()

  const nextMode: BasecampRuntimeMode =
    input.runtimeMode === 'standalone' || input.runtimeMode === 'hybrid'
      ? input.runtimeMode
      : current.runtime_mode

  const nextAutoCutover =
    typeof input.autoCutoverEnabled === 'boolean'
      ? input.autoCutoverEnabled
      : current.auto_cutover_enabled

  const standaloneActivatedAt =
    nextMode === 'standalone'
      ? current.runtime_mode === 'standalone' && current.standalone_activated_at
        ? current.standalone_activated_at
        : nowIso
      : null

  const standaloneReason =
    nextMode === 'standalone'
      ? input.reason !== undefined
        ? input.reason
        : current.standalone_reason || 'manual_admin_switch'
      : input.reason ?? null

  const { data, error } = await supabase
    .from('bc_system_config')
    .upsert(
      {
        id: 1,
        runtime_mode: nextMode,
        auto_cutover_enabled: nextAutoCutover,
        standalone_activated_at: standaloneActivatedAt,
        standalone_reason: standaloneReason,
        updated_by: input.updatedBy !== undefined ? input.updatedBy : current.updated_by,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to update bc_system_config: ${error.message}`)
  }

  const normalized = normalizeSystemConfigRow(data)
  globalBcConfigHolder.__tegBcSystemConfigCache = {
    value: normalized,
    expiresAt: Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS,
  }
  globalBcConfigHolder.__tegBcSystemConfigInflight = null
  return normalized
}

export function detectBasecampCutoverReason(
  errOrMsg: unknown,
  context?: { isAccountRootEndpoint?: boolean; url?: string }
): string | null {
  const msg = String((errOrMsg as any)?.message || errOrMsg || '').trim()
  if (!msg) return null

  if (
    /\(402\)|status\s*[:=]?\s*402|\b402\s+payment\s+required\b/i.test(msg) ||
    /payment\s*required|subscription\s+(?:expired|canceled|cancelled|inactive)|account\s+(?:is\s+)?(?:frozen|suspended|cancelled|canceled|closed|inactive|expired)/i.test(
      msg
    )
  ) {
    return `basecamp_402_account_inactive: ${msg.slice(0, 180)}`
  }

  if (/\binvalid_grant\b|\bunauthorized_client\b/i.test(msg)) {
    return `oauth_permanent_failure: ${msg.slice(0, 180)}`
  }

  const targetUrl = String(context?.url || '')
  const isAccountRootUrl =
    Boolean(context?.isAccountRootEndpoint) ||
    new RegExp(`/${BASECAMP_ACCOUNT_ID}/(?:projects|people)\\.json(?:\\?|$)`, 'i').test(targetUrl)

  if (
    /\(404\)|status\s*[:=]?\s*404/i.test(msg) &&
    (isAccountRootUrl ||
      new RegExp(
        `account\\s*(?:not\\s*found|cancelled|canceled|closed|inactive|deleted|does\\s*not\\s*exist)|/${BASECAMP_ACCOUNT_ID}/[^\\n]*account`,
        'i'
      ).test(msg))
  ) {
    return `basecamp_404_account_cancelled: ${msg.slice(0, 180)}`
  }

  return null
}

export async function triggerBasecampAutoCutover(reason: string): Promise<boolean> {
  const cleanReason = String(reason || 'auto_cutover_detected').trim().slice(0, 240)
  try {
    const cfg = await getBasecampSystemConfig({ bypassCache: true })
    if (cfg.runtime_mode === 'standalone') {
      return true
    }
    if (!cfg.auto_cutover_enabled) {
      console.warn(`⚠️ [Basecamp Auto-Cutover] Skipped (${cleanReason}) — auto_cutover_enabled is false`)
      return false
    }

    const supabase = getServiceClient()
    const { count, error: countErr } = await supabase
      .from('bc_projects')
      .select('id', { count: 'exact', head: true })

    if (countErr || !count || count < 1) {
      console.warn(
        `⚠️ [Basecamp Auto-Cutover] Aborted (${cleanReason}) — bc_projects count is ${count ?? 0}`
      )
      return false
    }

    await updateBasecampSystemConfig({
      runtimeMode: 'standalone',
      autoCutoverEnabled: cfg.auto_cutover_enabled,
      reason: cleanReason,
      updatedBy: 'system:auto_cutover',
    })
    console.log(`🛡️ [Basecamp Auto-Cutover] Switched to 100% Standalone Mode! Reason: ${cleanReason}`)
    return true
  } catch (err: any) {
    console.error('❌ [Basecamp Auto-Cutover] Failed to persist standalone cutover:', err?.message || err)
    return false
  }
}

// ============================================================================
// RATE LIMITER — Token Bucket Implementation
// ============================================================================

const requestTimestamps: number[] = []

async function waitForRateLimit(): Promise<void> {
  while (true) {
    const now = Date.now()

    // Purge timestamps older than the window
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
      requestTimestamps.shift()
    }

    // If below limit, we can proceed
    if (requestTimestamps.length < RATE_LIMIT_MAX_REQUESTS) {
      requestTimestamps.push(Date.now())
      return
    }

    // Otherwise, wait until the oldest request exits the window + 50ms buffer and check again
    const waitTime = requestTimestamps[0] + RATE_LIMIT_WINDOW_MS - now + 50
    if (waitTime > 0) {
      console.log(`⏳ [Basecamp] Rate limit reached, waiting ${waitTime}ms...`)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }
}

// ============================================================================
// OAUTH2 — Authorization Flow & Encrypted Credential Fallback
// ============================================================================

const OAUTH_CONFIG_SERVICE_NAME = 'basecamp_oauth_app'

function getEncryptionKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'teg-fallback-key'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptOAuthConfig(payload: { clientId: string; clientSecret: string; redirectUri: string }): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const json = JSON.stringify(payload)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `aes256gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptOAuthConfig(tokenStr: string): { clientId: string; clientSecret: string; redirectUri: string } | null {
  try {
    if (!tokenStr || !tokenStr.startsWith('aes256gcm:')) return null
    const parts = tokenStr.split(':')
    if (parts.length !== 4) return null
    const iv = Buffer.from(parts[1], 'hex')
    const authTag = Buffer.from(parts[2], 'hex')
    const encrypted = Buffer.from(parts[3], 'hex')
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    return JSON.parse(decrypted)
  } catch (err: any) {
    console.warn('⚠️ [Basecamp] Failed to decrypt stored OAuth config:', err.message)
    return null
  }
}

/**
 * Resuelve las credenciales OAuth2 (client_id, client_secret, redirect_uri)
 * priorizando variables de entorno y usando como respaldo seguro el registro
 * cifrado con AES-256-GCM en la tabla `integrations` de Supabase.
 * Esto previene que el Cron de Vercel falle con "Missing client_id query parameter".
 */
export async function getOAuthConfig(): Promise<{ clientId: string; clientSecret: string; redirectUri: string }> {
  const envClientId = (process.env.BASECAMP_CLIENT_ID || '').trim()
  const envClientSecret = (process.env.BASECAMP_CLIENT_SECRET || '').trim()
  const envRedirectUri = (process.env.BASECAMP_REDIRECT_URI || 'http://localhost:3000/api/basecamp/callback').trim()

  const supabase = getServiceClient()

  if (envClientId && envClientSecret) {
    // Ensure encrypted backup exists in Supabase for serverless cron environments
    try {
      const { data: existing } = await supabase
        .from('integrations')
        .select('id, access_token')
        .eq('service_name', OAUTH_CONFIG_SERVICE_NAME)
        .maybeSingle()

      const existingDecrypted = existing?.access_token ? decryptOAuthConfig(existing.access_token) : null
      if (!existingDecrypted || existingDecrypted.clientId !== envClientId || existingDecrypted.clientSecret !== envClientSecret) {
        const encryptedPayload = encryptOAuthConfig({
          clientId: envClientId,
          clientSecret: envClientSecret,
          redirectUri: envRedirectUri,
        })
        if (existing?.id) {
          await supabase
            .from('integrations')
            .update({ access_token: encryptedPayload, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        } else {
          await supabase.from('integrations').insert({
            service_name: OAUTH_CONFIG_SERVICE_NAME,
            realm_id: BASECAMP_ACCOUNT_ID,
            access_token: encryptedPayload,
            refresh_token: 'encrypted_aes256gcm',
            token_type: 'EncryptedConfig',
            expires_at: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString(),
          })
        }
      }
    } catch (backupErr: any) {
      console.warn('⚠️ [Basecamp] Non-fatal error backing up OAuth config:', backupErr.message)
    }

    return { clientId: envClientId, clientSecret: envClientSecret, redirectUri: envRedirectUri }
  }

  // Fallback: Read encrypted config from Supabase `integrations` table
  const { data: backupRow } = await supabase
    .from('integrations')
    .select('access_token')
    .eq('service_name', OAUTH_CONFIG_SERVICE_NAME)
    .maybeSingle()

  if (backupRow?.access_token) {
    const decrypted = decryptOAuthConfig(backupRow.access_token)
    if (decrypted?.clientId && decrypted?.clientSecret) {
      return {
        clientId: decrypted.clientId,
        clientSecret: decrypted.clientSecret,
        redirectUri: envRedirectUri || decrypted.redirectUri || 'http://localhost:3000/api/basecamp/callback',
      }
    }
  }

  throw new Error('Basecamp OAuth credentials (BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET) are not configured in environment or database fallback.')
}

/**
 * Genera la URL de autorización de Basecamp OAuth2.
 * Redirige al usuario a 37signals Launchpad para autorizar la app.
 */
export async function getAuthorizationUrl(): Promise<string> {
  const { clientId, redirectUri } = await getOAuthConfig()
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: clientId,
    redirect_uri: redirectUri,
  })
  return `${BASECAMP_AUTH_BASE}/authorization/new?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = await getOAuthConfig()
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: clientId,
    redirect_uri: redirectUri,
    client_secret: clientSecret,
    code,
  })

  const res = await fetch(`${BASECAMP_AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: {
      'User-Agent': BASECAMP_USER_AGENT,
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Basecamp token exchange failed (${res.status}): ${errorText}`)
  }

  return res.json()
}

/**
 * Renueva el access_token usando el refresh_token.
 * Basecamp access_tokens expiran cada ~2 semanas.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = await getOAuthConfig()
  const params = new URLSearchParams({
    type: 'refresh',
    client_id: clientId,
    redirect_uri: redirectUri,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })

  const res = await fetch(`${BASECAMP_AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: {
      'User-Agent': BASECAMP_USER_AGENT,
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Basecamp token refresh failed (${res.status}): ${errorText}`)
  }

  return res.json()
}

// ============================================================================
// TOKEN MANAGEMENT — Auto-Refresh from Supabase
// ============================================================================

/**
 * Obtiene un token válido de Supabase. Si el token ha expirado,
 * lo renueva automáticamente usando el refresh_token y actualiza la DB.
 *
 * @returns access_token válido listo para usar en peticiones API
 * @throws Error si no hay tokens almacenados o si la renovación falla
 */
// In-flight refresh promise singleton to prevent duplicate concurrent refresh calls
let inFlightRefreshPromise: Promise<string> | null = null

export async function getValidToken(): Promise<string> {
  const supabase = getServiceClient()

  // Fetch the most recent token from bc_oauth_tokens
  const { data: tokenRow, error: fetchError } = await supabase
    .from('bc_oauth_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fetchError || !tokenRow) {
    throw new Error(
      'No Basecamp OAuth tokens found. Please authenticate at /api/basecamp/auth first.'
    )
  }

  // Check if token is still valid (with 5 min buffer)
  const expiresAt = new Date(tokenRow.expires_at).getTime()
  const now = Date.now()
  const bufferMs = 5 * 60 * 1000 // 5 minutes

  if (now < expiresAt - bufferMs) {
    // Token is still valid
    return tokenRow.access_token
  }

  // If another concurrent request is already refreshing, wait for it
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise
  }

  // Token expired or about to expire — refresh it with singleton lock
  console.log('🔄 [Basecamp] Token expired, refreshing...')

  inFlightRefreshPromise = (async () => {
    try {
      const newTokens = await refreshAccessToken(tokenRow.refresh_token)

      // Calculate new expiry (Basecamp typically returns expires_in in seconds, fallback to 14 days = 1209600s)
      const expiresInSeconds = Number(newTokens.expires_in) > 0 ? Number(newTokens.expires_in) : 1209600
      const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

      // Update the token in DB
      const { error: updateError } = await supabase
        .from('bc_oauth_tokens')
        .update({
          access_token: newTokens.access_token,
          // Basecamp may or may not return a new refresh_token
          ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tokenRow.id)

      if (updateError) {
        console.error('❌ [Basecamp] Failed to update refreshed token in DB:', updateError)
        throw new Error(`Failed to save refreshed token: ${updateError.message}`)
      }

      console.log('✅ [Basecamp] Token refreshed successfully, new expiry:', newExpiresAt)
      return newTokens.access_token
    } catch (refreshErr: any) {
      console.error('❌ [Basecamp] Token refresh failed:', refreshErr.message)
      const cutoverReason = detectBasecampCutoverReason(refreshErr)
      if (cutoverReason) {
        await triggerBasecampAutoCutover(cutoverReason)
      }
      throw new Error(
        `Basecamp token refresh failed. Re-authenticate at /api/basecamp/auth. Error: ${refreshErr.message}`
      )
    } finally {
      inFlightRefreshPromise = null
    }
  })()

  return inFlightRefreshPromise
}

// ============================================================================
// API FETCHER — Core Fetch with Auth, Rate Limit, Retry, Pagination
// ============================================================================

/**
 * Link header parser for pagination.
 * Basecamp uses: Link: <URL>; rel="next"
 */
function parseLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null

  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return matches ? matches[1] : null
}

/**
 * Core API fetcher with authentication, rate limiting, retry with exponential backoff,
 * and automatic pagination following.
 *
 * @param path - API path relative to BASECAMP_API_BASE (e.g., '/projects.json')
 * @param options - Standard RequestInit options
 * @returns Parsed JSON response
 */
/**
 * Validates that a target Basecamp API URL strictly targets `https://3.basecampapi.com/{accountId}/...`
 * with zero path traversal (`..` / `%2e` / `\`), credentials, or alternate ports, preventing SSRF token exfiltration.
 */
export function assertSafeBasecampApiUrl(rawUrl: string, accountId: string = BASECAMP_ACCOUNT_ID): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Blocked unsafe Basecamp URL: empty input')
  }
  const trimmed = rawUrl.trim()
  if (
    trimmed.includes('..') ||
    trimmed.includes('\\') ||
    /%2e|%5c|%00/i.test(trimmed) ||
    /[\r\n\t]/.test(trimmed)
  ) {
    throw new Error('Blocked unsafe Basecamp URL: path traversal or control characters detected')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Blocked unsafe Basecamp URL: malformed URL')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Blocked unsafe Basecamp URL: HTTPS protocol required')
  }
  if (parsed.hostname.toLowerCase() !== '3.basecampapi.com') {
    throw new Error(`Blocked unsafe Basecamp URL host: ${parsed.hostname}`)
  }
  if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    throw new Error('Blocked unsafe Basecamp URL: custom port or credentials not allowed')
  }

  let decodedPathname = parsed.pathname
  try {
    decodedPathname = decodeURIComponent(parsed.pathname)
  } catch {
    throw new Error('Blocked unsafe Basecamp URL: invalid percent-encoding')
  }

  if (
    decodedPathname.includes('..') ||
    decodedPathname.includes('\\') ||
    parsed.pathname.includes('//') ||
    !parsed.pathname.startsWith(`/${accountId}/`)
  ) {
    throw new Error('Blocked unsafe Basecamp URL: path outside configured Basecamp account scope')
  }

  return parsed.toString()
}

export const sanitizeBasecampHtml = (html: string): string => sanitizeBasecampHtmlShared(html)

export const sanitizeAttachmentHref = (rawUrl?: string): string => {
    if (!rawUrl || typeof rawUrl !== 'string') return '#'
    const trimmed = rawUrl.trim()
    if (trimmed.startsWith('/api/basecamp/attachment?')) return trimmed
    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'https:') return '#'
        const host = parsed.hostname.toLowerCase()
        if (host.endsWith('.supabase.co')) return parsed.toString()
        if (
            host === '3.basecampapi.com' ||
            host === 'preview.app.basecamp.com' ||
            host === 'storage.app.basecamp.com' ||
            host === 'preview.3.basecamp.com' ||
            host === 'storage.3.basecamp.com'
        ) {
            return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
        }
        return '#'
    } catch {
        return '#'
    }
}

export async function basecampFetch<T>(path: string, options?: RequestInit & { noPaginate?: boolean }): Promise<T> {
  if (!path || typeof path !== 'string') {
    throw new Error('Blocked unsafe Basecamp path: empty path')
  }
  const trimmedPath = path.trim()
  const isAbsoluteInput = /^[a-z][a-z0-9+.-]*:/i.test(trimmedPath) || trimmedPath.startsWith('//')
  const candidateUrl = isAbsoluteInput
    ? trimmedPath
    : `${BASECAMP_API_BASE}${trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`}`

  // Strictly validate URL BEFORE retrieving or attaching OAuth Bearer token
  let url = assertSafeBasecampApiUrl(candidateUrl)

  // Ensure .json extension for Basecamp API
  if (!url.includes('.json') && !url.includes('?')) {
    url += '.json'
  } else if (!url.includes('.json') && url.includes('?')) {
    url = url.replace('?', '.json?')
  }
  url = assertSafeBasecampApiUrl(url)

  const token = await getValidToken()
  const noPaginate = options?.noPaginate ?? false

  let allResults: any[] = []
  let currentUrl: string | null = url

  while (currentUrl) {
    const verifiedCurrentUrl = assertSafeBasecampApiUrl(currentUrl)
    // Wait for rate limit slot
    await waitForRateLimit()

    let lastError: Error | null = null
    let response: Response | null = null

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30_000) // 30s timeout

        response = await fetch(verifiedCurrentUrl, {
          ...options,
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': BASECAMP_USER_AGENT,
            ...options?.headers,
          },
        })
        clearTimeout(timeoutId)

        // Success
        if (response.ok) {
          lastError = null
          break
        }

        // Rate limited (429) or Server error (5xx) — retry
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get('Retry-After')
          const backoffMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt)

          console.warn(
            `⚠️ [Basecamp] ${response.status} on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${backoffMs}ms...`
          )
          await new Promise((r) => setTimeout(r, backoffMs))
          lastError = new Error(`Basecamp API error: ${response.status}`)
          continue
        }

        // Client error (4xx, not 429) — don't retry
        const errorBody = await response.text()
        const clientErr = new Error(`Basecamp API error (${response.status}): ${errorBody}`)
        const cutoverReason = detectBasecampCutoverReason(clientErr, { url: verifiedCurrentUrl })
        if (cutoverReason) {
          await triggerBasecampAutoCutover(cutoverReason)
        }
        throw clientErr
      } catch (err: any) {
        if (err.name === 'AbortError') {
          lastError = new Error('Basecamp API request timed out (30s)')
          if (attempt < MAX_RETRIES) {
            const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
            await new Promise((r) => setTimeout(r, backoffMs))
          }
          continue
        }
        // If it's our own thrown error (4xx), just re-throw
        if (err.message?.includes('Basecamp API error')) {
          throw err
        }
        lastError = err
        if (attempt < MAX_RETRIES) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    }

    if (lastError || !response || !response.ok) {
      throw lastError || new Error('Basecamp API request failed after all retries')
    }

    // Parse response
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      // Some write operations return 204 No Content
      return undefined as unknown as T
    }

    const data = await response.json()

    // Handle pagination
    if (noPaginate || !Array.isArray(data)) {
      // Single object response or pagination disabled
      return data as T
    }

    allResults = allResults.concat(data)

    // Check for next page via Link header
    const nextUrl = parseLinkHeader(response.headers.get('Link'))
    currentUrl = nextUrl
  }

  return allResults as unknown as T
}

// ============================================================================
// DATA FETCHING — Read Operations
// ============================================================================

/** Obtiene todos los proyectos del account */
export async function fetchProjects(): Promise<BasecampProject[]> {
  return basecampFetch<BasecampProject[]>('/projects.json')
}

/** Obtiene un proyecto específico por ID */
export async function fetchProject(projectId: number): Promise<BasecampProject> {
  return basecampFetch<BasecampProject>(`/projects/${projectId}.json`, { noPaginate: true })
}

/** Obtiene todas las personas del account */
export async function fetchPeople(): Promise<BasecampPerson[]> {
  return basecampFetch<BasecampPerson[]>('/people.json')
}

/** Obtiene las personas asignadas a un proyecto específico */
export async function fetchProjectPeople(projectId: number): Promise<BasecampPerson[]> {
  // NOTE: Basecamp 3 API uses /projects/ NOT /buckets/ for people endpoint
  return basecampFetch<BasecampPerson[]>(`/projects/${projectId}/people.json`)
}

/** Obtiene el todoset de un proyecto (contenedor raíz de to-do lists) */
export async function fetchTodoSet(projectId: number, todosetId: number): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/todosets/${todosetId}.json`, { noPaginate: true })
}

/** Obtiene las to-do lists de un todoset */
export async function fetchTodoLists(projectId: number, todosetId: number): Promise<BasecampTodoList[]> {
  return basecampFetch<BasecampTodoList[]>(`/buckets/${projectId}/todosets/${todosetId}/todolists.json`)
}

/** Obtiene los to-dos de una to-do list. Por defecto solo retorna los activos (pendientes).
 *  Usar `completed: true` para obtener los completados. */
export async function fetchTodos(
  projectId: number,
  todolistId: number,
  options?: { completed?: boolean; noPaginate?: boolean }
): Promise<BasecampTodo[]> {
  const params = options?.completed ? '?completed=true' : ''
  return basecampFetch<BasecampTodo[]>(
    `/buckets/${projectId}/todolists/${todolistId}/todos.json${params}`,
    { noPaginate: options?.noPaginate }
  )
}

export async function fetchAllTodos(
  projectId: number,
  todolistId: number,
  noPaginateCompleted: boolean = true
): Promise<BasecampTodo[]> {
  const [active, completed] = await Promise.all([
    fetchTodos(projectId, todolistId),
    fetchTodos(projectId, todolistId, { completed: true, noPaginate: noPaginateCompleted }),
  ])
  return [...active, ...completed]
}

/** Obtiene el message board de un proyecto */
export async function fetchMessageBoard(projectId: number, boardId: number): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/message_boards/${boardId}.json`, { noPaginate: true })
}

/** Obtiene los mensajes de un message board */
export async function fetchMessages(projectId: number, boardId: number): Promise<BasecampMessage[]> {
  return basecampFetch<BasecampMessage[]>(`/buckets/${projectId}/message_boards/${boardId}/messages.json`)
}

/** Obtiene las líneas de un campfire (chat) */
export async function fetchCampfireLines(projectId: number, campfireId: number): Promise<BasecampCampfireLine[]> {
  return basecampFetch<BasecampCampfireLine[]>(`/buckets/${projectId}/chats/${campfireId}/lines.json`)
}

/** Obtiene un vault (carpeta de documentos) */
export async function fetchVault(projectId: number, vaultId: number): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/vaults/${vaultId}.json`, { noPaginate: true })
}

/** Obtiene los documentos de un vault */
export async function fetchDocuments(projectId: number, vaultId: number): Promise<BasecampDocument[]> {
  return basecampFetch<BasecampDocument[]>(`/buckets/${projectId}/vaults/${vaultId}/documents.json`)
}

/** Obtiene los uploads (archivos) de un vault */
export async function fetchUploads(projectId: number, vaultId: number): Promise<BasecampUpload[]> {
  return basecampFetch<BasecampUpload[]>(`/buckets/${projectId}/vaults/${vaultId}/uploads.json`)
}

/** Obtiene los sub-vaults (carpetas) de un vault */
export async function fetchSubVaults(projectId: number, vaultId: number): Promise<any[]> {
  return basecampFetch<any[]>(`/buckets/${projectId}/vaults/${vaultId}/vaults.json`)
}

/** Obtiene las entradas del schedule (calendario) */
export async function fetchScheduleEntries(projectId: number, scheduleId: number): Promise<BasecampScheduleEntry[]> {
  return basecampFetch<BasecampScheduleEntry[]>(
    `/buckets/${projectId}/schedules/${scheduleId}/entries.json`
  )
}

/** Obtiene las preguntas de un questionnaire (check-ins) */
export async function fetchQuestions(projectId: number, questionnaireId: number): Promise<BasecampQuestion[]> {
  return basecampFetch<BasecampQuestion[]>(
    `/buckets/${projectId}/questionnaires/${questionnaireId}/questions.json`
  )
}

/** Obtiene las respuestas de una pregunta de check-in */
export async function fetchAnswers(projectId: number, questionId: number): Promise<BasecampAnswer[]> {
  return basecampFetch<BasecampAnswer[]>(`/buckets/${projectId}/questions/${questionId}/answers.json`)
}

// ============================================================================
// WRITE OPERATIONS — Bidirectional Sync
// ============================================================================

/** Crea un nuevo to-do en una to-do list */
export async function createTodo(
  projectId: number,
  todolistId: number,
  data: CreateTodoData
): Promise<BasecampTodo> {
  return basecampFetch<BasecampTodo>(`/buckets/${projectId}/todolists/${todolistId}/todos.json`, {
    method: 'POST',
    body: JSON.stringify(data),
    noPaginate: true,
  })
}

/** Marca un to-do como completado */
export async function completeTodo(projectId: number, todoId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
    method: 'POST',
    noPaginate: true,
  })
}

/** Desmarca un to-do (lo reactiva) */
export async function uncompleteTodo(projectId: number, todoId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
    method: 'DELETE',
    noPaginate: true,
  })
}

/**
 * Actualiza un to-do existente en Basecamp 3 (`PUT /buckets/{projectId}/todos/{todoId}.json`).
 * IMPORTANTE: Basecamp 3 limpia cualquier campo omitido en PUT, por lo que SIEMPRE se envían todos los campos.
 */
export async function updateTodo(
  projectId: number,
  todoId: number,
  payload: UpdateTodoData
): Promise<BasecampTodo> {
  const fullPayload = {
    content: payload.content,
    description: payload.description ?? '',
    assignee_ids: Array.isArray(payload.assignee_ids) ? payload.assignee_ids : [],
    completion_subscriber_ids: Array.isArray(payload.completion_subscriber_ids)
      ? payload.completion_subscriber_ids
      : [],
    starts_on: payload.starts_on ?? null,
    due_on: payload.due_on ?? null,
    notify: payload.notify ?? false,
  }
  return basecampFetch<BasecampTodo>(`/buckets/${projectId}/todos/${todoId}.json`, {
    method: 'PUT',
    body: JSON.stringify(fullPayload),
    noPaginate: true,
  })
}

/** Reordena o mueve un to-do a otra lista o grupo dentro del mismo proyecto (`parent_id` opcional) */
export async function repositionTodo(
  projectId: number,
  todoId: number,
  position: number,
  parentBcId?: number
): Promise<void> {
  const safePos = Math.max(1, Math.floor(Number(position) || 1))
  await basecampFetch(`/buckets/${projectId}/todos/${todoId}/position.json`, {
    method: 'PUT',
    body: JSON.stringify({
      position: safePos,
      ...(parentBcId && Number(parentBcId) > 0 ? { parent_id: Number(parentBcId) } : {}),
    }),
    noPaginate: true,
  })
}

/** Crea una nueva lista de tareas (Todolist) en un Todoset de Basecamp 3 */
export async function createTodolistRemote(
  projectId: number,
  todosetId: number,
  name: string,
  description?: string
): Promise<BasecampTodoList> {
  return basecampFetch<BasecampTodoList>(`/buckets/${projectId}/todosets/${todosetId}/todolists.json`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(description !== undefined ? { description } : {}),
    }),
    noPaginate: true,
  })
}

/** Actualiza el nombre y descripción de una lista de tareas (o grupo) en Basecamp 3 */
export async function updateTodolistRemote(
  projectId: number,
  todolistId: number,
  name: string,
  description?: string
): Promise<BasecampTodoList> {
  return basecampFetch<BasecampTodoList>(`/buckets/${projectId}/todolists/${todolistId}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      description: description ?? '',
    }),
    noPaginate: true,
  })
}

/** Obtiene los grupos hijos (Todolist Groups) de una lista de tareas */
export async function fetchTodolistGroups(
  projectId: number,
  todolistId: number
): Promise<BasecampTodoList[]> {
  return basecampFetch<BasecampTodoList[]>(`/buckets/${projectId}/todolists/${todolistId}/groups.json`)
}

/** Crea un nuevo grupo dentro de una lista de tareas en Basecamp 3 */
export async function createTodolistGroupRemote(
  projectId: number,
  todolistId: number,
  name: string,
  color?: string
): Promise<BasecampTodoList> {
  return basecampFetch<BasecampTodoList>(`/buckets/${projectId}/todolists/${todolistId}/groups.json`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(color ? { color } : {}),
    }),
    noPaginate: true,
  })
}

/** Crea un nuevo mensaje en un message board */
export async function createMessage(
  projectId: number,
  boardId: number,
  data: CreateMessageData
): Promise<BasecampMessage> {
  return basecampFetch<BasecampMessage>(
    `/buckets/${projectId}/message_boards/${boardId}/messages.json`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      noPaginate: true,
    }
  )
}

/** Envía una línea al campfire (chat) */
export async function createCampfireLine(
  projectId: number,
  campfireId: number,
  content: string
): Promise<BasecampCampfireLine> {
  return basecampFetch<BasecampCampfireLine>(
    `/buckets/${projectId}/chats/${campfireId}/lines.json`,
    {
      method: 'POST',
      body: JSON.stringify({ content, content_type: 'text/html' }),
      noPaginate: true,
    }
  )
}

/** Crea un comentario en cualquier recording (message, todo, etc.) */
export async function createComment(
  projectId: number,
  recordingId: number,
  content: string
): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
    method: 'POST',
    body: JSON.stringify({ content }),
    noPaginate: true,
  })
}

/** Obtiene los comentarios de cualquier recording (message, todo, etc.) */
export async function fetchComments(projectId: number, recordingId: number): Promise<any[]> {
  return basecampFetch<any[]>(`/buckets/${projectId}/recordings/${recordingId}/comments.json`)
}

/** Actualiza el contenido HTML de un comentario existente en Basecamp 3 */
export async function updateCommentRemote(
  projectId: number,
  commentId: number,
  content: string
): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/comments/${commentId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
    noPaginate: true,
  })
}

/** Obtiene las categorías de mensajes (Message Types) configuradas en un proyecto de Basecamp 3 */
export async function fetchMessageCategories(projectId: number): Promise<BasecampMessageCategory[]> {
  return basecampFetch<BasecampMessageCategory[]>(`/buckets/${projectId}/categories.json`)
}

/** Actualiza el asunto, contenido y categoría opcional de un mensaje existente en Basecamp 3 */
export async function updateMessageRemote(
  projectId: number,
  messageId: number,
  subject: string,
  content: string,
  categoryId?: number
): Promise<BasecampMessage> {
  return basecampFetch<BasecampMessage>(`/buckets/${projectId}/messages/${messageId}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      subject,
      content: content ?? '',
      ...(categoryId ? { category_id: categoryId } : {}),
    }),
    noPaginate: true,
  })
}

/** Fija (Pin) un recording (ej. Message) arriba del tablero en Basecamp 3 */
export async function pinRecordingRemote(projectId: number, recordingId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/recordings/${recordingId}/pin.json`, {
    method: 'PUT',
    noPaginate: true,
  })
}

/** Desfija (Unpin) un recording en Basecamp 3 */
export async function unpinRecordingRemote(projectId: number, recordingId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/recordings/${recordingId}/pin.json`, {
    method: 'DELETE',
    noPaginate: true,
  })
}

/** Envía cualquier recording (Todo, Comment, Message, Document, Todolist, etc.) a la papelera de Basecamp 3 */
export async function trashRecording(projectId: number, recordingId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/recordings/${recordingId}/status/trashed.json`, {
    method: 'PUT',
    noPaginate: true,
  })
}

/** Obtiene los boosts (reacciones cortas) de cualquier recording en Basecamp 3 */
export async function fetchBoosts(projectId: number, recordingId: number): Promise<BasecampBoost[]> {
  return basecampFetch<BasecampBoost[]>(`/buckets/${projectId}/recordings/${recordingId}/boosts.json`)
}

/** Crea un boost (reacción corta de hasta 16 caracteres) sobre cualquier recording en Basecamp 3 */
export async function createBoostRemote(
  projectId: number,
  recordingId: number,
  content: string
): Promise<BasecampBoost> {
  return basecampFetch<BasecampBoost>(`/buckets/${projectId}/recordings/${recordingId}/boosts.json`, {
    method: 'POST',
    body: JSON.stringify({ content: String(content || '').slice(0, 16) }),
    noPaginate: true,
  })
}

/** Elimina un boost en Basecamp 3 */
export async function deleteBoostRemote(projectId: number, boostId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/boosts/${boostId}.json`, {
    method: 'DELETE',
    noPaginate: true,
  })
}

/** Crea una respuesta a una pregunta de check-in */
export async function createAnswer(
  projectId: number,
  questionId: number,
  content: string
): Promise<BasecampAnswer> {
  return basecampFetch<BasecampAnswer>(
    `/buckets/${projectId}/questions/${questionId}/answers.json`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
      noPaginate: true,
    }
  )
}

/** Crea un evento en el schedule */
export async function createScheduleEntry(
  projectId: number,
  scheduleId: number,
  data: {
    summary: string
    description?: string
    starts_at: string
    ends_at: string
    all_day?: boolean
  }
): Promise<BasecampScheduleEntry> {
  return basecampFetch<BasecampScheduleEntry>(
    `/buckets/${projectId}/schedules/${scheduleId}/entries.json`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      noPaginate: true,
    }
  )
}

/** Crea un documento en un vault */
export async function createDocument(
  projectId: number,
  vaultId: number,
  data: {
    title: string
    content: string
  }
): Promise<BasecampDocument> {
  return basecampFetch<BasecampDocument>(
    `/buckets/${projectId}/vaults/${vaultId}/documents.json`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      noPaginate: true,
    }
  )
}

/**
 * Sube un archivo binario a Basecamp 3 (`POST /attachments.json?name=...`) y retorna su `attachable_sgid`
 * para incrustarlo como `<bc-attachment sgid="...">` en descripciones de To-dos, comentarios o mensajes.
 */
export async function uploadBasecampAttachment(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string | null> {
  const safeName = encodeURIComponent((filename || 'attachment').trim() || 'attachment')
  const res = await basecampFetch<{ attachable_sgid?: string }>(`/attachments.json?name=${safeName}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(buffer.length),
    },
    body: new Uint8Array(buffer),
    noPaginate: true,
  })
  return res?.attachable_sgid || null
}

// ============================================================================
// HELPERS — Dock Finder
// ============================================================================

/**
 * Busca un dock (herramienta) dentro de un proyecto por su nombre.
 * Cada proyecto tiene un "dock" con las herramientas habilitadas (todoset, message_board, etc.)
 *
 * @param project - Proyecto de Basecamp
 * @param dockName - Nombre del dock (e.g., 'todoset', 'message_board', 'chat', 'vault', 'schedule', 'questionnaire')
 * @returns El dock encontrado o undefined
 */
export function findDock(project: BasecampProject, dockName: string): BasecampDock | undefined {
  return project.dock?.find((d) => d.name === dockName && d.enabled)
}

/**
 * Extrae el ID del dock a partir de su URL.
 * Basecamp dock URLs have format: .../buckets/{projectId}/{dockType}/{dockId}.json
 *
 * @param dockUrl - URL completa del dock
 * @returns El ID numérico extraído de la URL
 */
export function extractDockId(dockUrl: string): number {
  // URL format: https://3.basecampapi.com/ACCOUNT/buckets/PROJECT_ID/DOCK_TYPE/DOCK_ID.json
  const parts = dockUrl.replace('.json', '').split('/')
  return parseInt(parts[parts.length - 1], 10)
}

// ============================================================================
// WEBHOOKS — Real-Time Push Notifications from Basecamp 3
// ============================================================================

export interface BasecampWebhook {
  id: number
  active: boolean
  created_at: string
  updated_at: string
  payload_url: string
  types: string[]
  url: string
  app_url: string
}

/** Obtiene los webhooks registrados en un proyecto de Basecamp */
export async function fetchProjectWebhooks(projectId: number): Promise<BasecampWebhook[]> {
  return basecampFetch<BasecampWebhook[]>(`/buckets/${projectId}/webhooks.json`)
}

/**
 * Asegura que exista un webhook activo apuntando a nuestro endpoint en el proyecto de Basecamp.
 * Basecamp exige HTTPS en `payload_url`.
 */
let boostWebhookTypeRejected = false

export async function ensureProjectWebhook(projectId: number, payloadUrl: string): Promise<BasecampWebhook | null> {
  if (!payloadUrl.startsWith('https://')) {
    return null
  }

  try {
    const desiredTypes = [
      'Todo',
      'Todolist',
      'Comment',
      'Message',
      'Document',
      'Upload',
      'Campfire::Line',
      'Question::Answer',
      'Schedule::Entry',
      'Boost',
    ]
    const effectiveTypes = boostWebhookTypeRejected
      ? desiredTypes.filter((t) => t !== 'Boost')
      : desiredTypes

    const existing = await fetchProjectWebhooks(projectId)
    const match = existing.find((w) => w.payload_url === payloadUrl)
    const hasAllEffectiveTypes = Boolean(
      match && Array.isArray(match.types) && effectiveTypes.every((dt) => match.types.includes(dt))
    )
    if (match && match.active && hasAllEffectiveTypes) {
      return match
    }

    const upsertWebhook = async (typesList: string[]): Promise<BasecampWebhook> => {
      if (match) {
        const mergedTypes = Array.from(new Set([...(Array.isArray(match.types) ? match.types : []), ...typesList]))
        return basecampFetch<BasecampWebhook>(`/buckets/${projectId}/webhooks/${match.id}.json`, {
          method: 'PUT',
          body: JSON.stringify({
            payload_url: payloadUrl,
            types: mergedTypes,
            active: true,
          }),
          noPaginate: true,
        })
      }
      return basecampFetch<BasecampWebhook>(`/buckets/${projectId}/webhooks.json`, {
        method: 'POST',
        body: JSON.stringify({
          payload_url: payloadUrl,
          types: typesList,
        }),
        noPaginate: true,
      })
    }

    try {
      return await upsertWebhook(effectiveTypes)
    } catch (innerErr: any) {
      if (String(innerErr?.message || '').includes('must be eligible') && effectiveTypes.includes('Boost')) {
        boostWebhookTypeRejected = true
        const coreTypes = desiredTypes.filter((t) => t !== 'Boost')
        if (match && match.active && Array.isArray(match.types) && coreTypes.every((dt) => match.types.includes(dt))) {
          return match
        }
        return await upsertWebhook(coreTypes)
      }
      throw innerErr
    }
  } catch (err: any) {
    console.warn(`⚠️ [Basecamp Webhook] Could not register webhook for project ${projectId}:`, err.message)
    return null
  }
}


// ============================================================================
// ATTACHMENT URL CLASSIFICATION & HTML CACHE RESOLUTION HELPERS
// ============================================================================

export interface HtmlAttachment {
  contentType: string
  filename: string
  url: string
  secondaryUrl?: string
  rawMatch: string
  isTag: boolean
}

export function isSupabaseStorageUrl(url: string): boolean {
  if (!url) return false
  return (
    url.includes('.supabase.co/') ||
    url.includes('/storage/v1/object/public/') ||
    url.includes('basecamp-attachments/')
  )
}

export const EXTERNAL_BASECAMP_ATTACHMENT_HOSTS = [
  'preview.3.basecamp.com',
  'storage.3.basecamp.com',
  'preview.app.basecamp.com',
  'storage.app.basecamp.com',
  '3.basecampapi.com',
] as const

export function isExternalBasecampUrl(url: string): boolean {
  if (!url || isSupabaseStorageUrl(url)) return false
  const clean = url.replace(/&amp;/gi, '&').trim()
  if (!clean || /^mailto:/i.test(clean)) return false
  if (clean.startsWith('/api/basecamp/attachment?')) {
    try {
      const qs = new URLSearchParams(clean.slice('/api/basecamp/attachment?'.length))
      const inner = qs.get('url')
      return inner ? isExternalBasecampUrl(inner) : false
    } catch {
      return false
    }
  }
  const lower = clean.toLowerCase()
  if (EXTERNAL_BASECAMP_ATTACHMENT_HOSTS.some((host) => lower.includes(host))) {
    return true
  }
  return (lower.includes('basecamp.com') || lower.includes('basecampapi.com')) && lower.includes('/blobs/')
}

export function extractDeterministicBlobKey(basecampUrl: string): string {
  const blobMatch = basecampUrl.match(/\/blobs\/([a-f0-9-]{8,})/i)
  if (blobMatch?.[1]) {
    return blobMatch[1].slice(0, 12)
  }
  const cleanUrl = basecampUrl.split('?')[0]
  let hash = 0
  for (let i = 0; i < cleanUrl.length; i++) {
    hash = (hash * 31 + cleanUrl.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Heals <bc-attachment> tags where `url` was already migrated to Supabase Storage
 * but `href` still points to storage.app.basecamp.com / blobs (or vice versa).
 */
export function healPartiallyMigratedBcAttachmentHrefs(html: string): {
  html: string
  repairedPairs: Array<{ basecamp_url: string; supabase_url: string }>
} {
  const repairedPairs: Array<{ basecamp_url: string; supabase_url: string }> = []
  if (!html) return { html, repairedPairs }

  let updatedHtml = html
  const bcAttachmentRegex = /<bc-attachment\s+([^>]+)>([\s\S]*?)<\/bc-attachment>/gi
  let match: RegExpExecArray | null
  while ((match = bcAttachmentRegex.exec(html)) !== null) {
    const attrsStr = match[1]
    const getAttr = (name: string) => {
      const m = attrsStr.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
      return m ? m[1] : null
    }
    const rawUrl = getAttr('url') || ''
    const rawHref = getAttr('href') || ''
    if (isSupabaseStorageUrl(rawUrl) && isExternalBasecampUrl(rawHref)) {
      updatedHtml = updatedHtml.replaceAll(rawHref, rawUrl)
      repairedPairs.push({ basecamp_url: rawHref, supabase_url: rawUrl })
    } else if (isSupabaseStorageUrl(rawHref) && isExternalBasecampUrl(rawUrl)) {
      updatedHtml = updatedHtml.replaceAll(rawUrl, rawHref)
      repairedPairs.push({ basecamp_url: rawUrl, supabase_url: rawHref })
    }
  }

  return { html: updatedHtml, repairedPairs }
}

export function parseHtmlAttachments(html: string): HtmlAttachment[] {
  const attachments: HtmlAttachment[] = []
  if (!html) return attachments

  const addIfUnique = (entry: HtmlAttachment) => {
    const isDuplicate = attachments.some(
      (a) =>
        a.url === entry.url ||
        a.secondaryUrl === entry.url ||
        (entry.secondaryUrl && (a.url === entry.secondaryUrl || a.secondaryUrl === entry.secondaryUrl))
    )
    if (!isDuplicate) {
      attachments.push(entry)
    }
  }

  // 1. <bc-attachment> tags (paired or self-closing; captures preview.3, storage.3, preview.app, storage.app, 3.basecampapi)
  const bcAttachmentRegex = /<bc-attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
  let match: RegExpExecArray | null
  while ((match = bcAttachmentRegex.exec(html)) !== null) {
    const attrsStr = match[1] || ''
    const getAttr = (name: string) => {
      const m = attrsStr.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
      return m ? m[1] : null
    }
    const contentType = getAttr('content-type') || ''
    if (contentType.toLowerCase().includes('vnd.basecamp.mention')) continue

    const filename = getAttr('filename') || 'attachment'
    const rawHref = getAttr('href') || ''
    const rawUrl = getAttr('url') || ''

    const urlIsExternal = isExternalBasecampUrl(rawUrl)
    const hrefIsExternal = isExternalBasecampUrl(rawHref)

    if (urlIsExternal || hrefIsExternal) {
      const preferDownloadHref = hrefIsExternal && rawHref.includes('/download/')
      const primaryUrl = preferDownloadHref ? rawHref : urlIsExternal ? rawUrl : rawHref
      const otherCandidate = primaryUrl === rawHref ? rawUrl : rawHref
      const otherIsExternal = primaryUrl === rawHref ? urlIsExternal : hrefIsExternal
      const secondaryUrl =
        otherIsExternal && otherCandidate && otherCandidate !== primaryUrl ? otherCandidate : undefined

      addIfUnique({
        contentType,
        filename,
        url: primaryUrl,
        secondaryUrl,
        rawMatch: match[0],
        isTag: true,
      })
    }
  }

  // 2. <img> tags (excluding user/mention avatars)
  const imgRegex = /<img\b([^>]*)>/gi
  let imgMatch: RegExpExecArray | null
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrsStr = imgMatch[1] || ''
    if (
      /\bclass\s*=\s*["'][^"']*\bavatar\b/i.test(attrsStr) ||
      /\bdata-(?:bc-avatar|avatar-for-person-id)\b/i.test(attrsStr)
    ) {
      continue
    }
    const srcMatch = attrsStr.match(/(?:^|\s)src=["']([^"']+)["']/i)
    const src = srcMatch?.[1] || ''
    if (isExternalBasecampUrl(src)) {
      const altMatch = attrsStr.match(/(?:^|\s)alt=["']([^"']+)["']/i)
      addIfUnique({
        contentType: 'image/png',
        filename: altMatch?.[1] || 'image.png',
        url: src,
        rawMatch: imgMatch[0],
        isTag: false,
      })
    }
  }

  // 3. Direct <a href="..."> links pointing to Basecamp blob storage/preview hosts
  const anchorBlobRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let anchorMatch: RegExpExecArray | null
  while ((anchorMatch = anchorBlobRegex.exec(html)) !== null) {
    const attrsStr = anchorMatch[1] || ''
    const hrefMatch = attrsStr.match(/(?:^|\s)href=["']([^"']+)["']/i)
    const href = hrefMatch?.[1] || ''
    if (href && href.includes('/blobs/') && isExternalBasecampUrl(href)) {
      const linkText = (anchorMatch[2] || '').replace(/<[^>]+>/g, '').trim()
      const dlSeg = href.split('/download/')[1]?.split(/[?#]/)[0] || ''
      let fallbackName = linkText || 'attachment'
      if (dlSeg) {
        try {
          fallbackName = decodeURIComponent(dlSeg)
        } catch {
          fallbackName = dlSeg
        }
      }
      addIfUnique({
        contentType: 'application/octet-stream',
        filename: fallbackName,
        url: href,
        rawMatch: anchorMatch[0],
        isTag: false,
      })
    }
  }

  return attachments
}

/**
 * Resolves external Basecamp attachment URLs in HTML strictly from `bc_attachment_cache`
 * without performing any blocking downloads.
 */
export async function resolveHtmlAttachmentsFromCache(
  html: string,
  supabase: any,
  urlCache?: Map<string, string>
): Promise<string> {
  if (!html || (!html.includes('basecamp') && !html.includes('blobs'))) {
    return html
  }

  const healed = healPartiallyMigratedBcAttachmentHrefs(html)
  let updatedHtml = healed.html
  if (healed.repairedPairs.length > 0 && urlCache) {
    for (const pair of healed.repairedPairs) {
      urlCache.set(pair.basecamp_url, pair.supabase_url)
    }
  }

  const attachments = parseHtmlAttachments(updatedHtml)
  if (attachments.length === 0) return updatedHtml

  for (const att of attachments) {
    let localUrl =
      urlCache?.get(att.url) || (att.secondaryUrl ? urlCache?.get(att.secondaryUrl) : undefined)

    if (!localUrl) {
      const lookupUrls = [att.url]
      if (att.secondaryUrl) lookupUrls.push(att.secondaryUrl)

      const { data: cachedRows } = await supabase
        .from('bc_attachment_cache')
        .select('basecamp_url, supabase_url')
        .in('basecamp_url', lookupUrls)

      const validCached = (cachedRows || []).find(
        (r: any) => r?.supabase_url && isSupabaseStorageUrl(r.supabase_url)
      )
      if (validCached?.supabase_url) {
        localUrl = validCached.supabase_url
        urlCache?.set(att.url, validCached.supabase_url)
        if (att.secondaryUrl) {
          urlCache?.set(att.secondaryUrl, validCached.supabase_url)
        }
      }
    }

    if (localUrl) {
      updatedHtml = updatedHtml.replaceAll(att.url, localUrl)
      if (att.secondaryUrl) {
        updatedHtml = updatedHtml.replaceAll(att.secondaryUrl, localUrl)
      }
    }
  }

  return updatedHtml
}

// ============================================================================
// SHARED DB COUNTER & SCHEDULE FORMATTER HELPERS (Safe outside App Router route.ts)
// ============================================================================

export async function syncTodolistCounts(supabase: any, todolistDbId?: string | null): Promise<void> {
  if (!todolistDbId) return
  const [{ count: totalCount, error: totalErr }, { count: completedCount, error: compErr }] = await Promise.all([
    supabase.from('bc_todos').select('*', { count: 'exact', head: true }).eq('todolist_id', todolistDbId),
    supabase
      .from('bc_todos')
      .select('*', { count: 'exact', head: true })
      .eq('todolist_id', todolistDbId)
      .eq('is_completed', true),
  ])
  if (!totalErr && !compErr) {
    await supabase
      .from('bc_todolists')
      .update({
        total_count: totalCount ?? 0,
        completed_count: completedCount ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', todolistDbId)
  }
}

export async function syncTodolistGroupCounts(supabase: any, groupDbId?: string | null): Promise<void> {
  if (!groupDbId) return
  const [{ count: totalCount, error: totalErr }, { count: completedCount, error: compErr }] = await Promise.all([
    supabase.from('bc_todos').select('*', { count: 'exact', head: true }).eq('group_id', groupDbId),
    supabase
      .from('bc_todos')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', groupDbId)
      .eq('is_completed', true),
  ])
  if (!totalErr && !compErr) {
    await supabase
      .from('bc_todolist_groups')
      .update({
        total_count: totalCount ?? 0,
        completed_count: completedCount ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', groupDbId)
  }
}

export function formatQuestionScheduleText(q: any): string {
  const rawDay = String(q?.schedule_day || '').trim()
  const rawTime = String(q?.schedule_time || '').trim()
  if (rawDay && rawTime) return `${rawDay} at ${rawTime}`
  if (rawDay || rawTime) return rawDay || rawTime

  const sched = q?.schedule
  if (sched && typeof sched === 'object') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    let dayPart = ''
    if (Array.isArray(sched.days) && sched.days.length > 0) {
      const sorted = [...sched.days].map(Number).sort((a, b) => a - b)
      if (sorted.length === 7) {
        dayPart = 'Every day'
      } else if (sorted.join(',') === '1,2,3,4,5') {
        dayPart = 'Mon–Fri'
      } else {
        dayPart = sorted.map((d) => dayNames[d] || '').filter(Boolean).join(', ')
      }
    } else if (typeof sched.frequency === 'string' && sched.frequency.trim()) {
      const freqMap: Record<string, string> = {
        every_day: 'Every day',
        every_week: 'Weekly',
        every_other_week: 'Every 2 weeks',
        every_month: 'Monthly',
      }
      dayPart = freqMap[sched.frequency] || ''
    }

    let timePart = ''
    if (typeof sched.hour === 'number' && Number.isFinite(sched.hour)) {
      const h = sched.hour
      const m = String(sched.minute ?? 0).padStart(2, '0')
      const ampm = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 || 12
      timePart = `${h12}:${m} ${ampm}`
    }

    if (dayPart && timePart) return `${dayPart} at ${timePart}`
    if (dayPart || timePart) return dayPart || timePart
  }

  return ''
}

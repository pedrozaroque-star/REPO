/**
 * @module lib/auth-server
 * @description Helper de servidor para autenticar y autorizar peticiones en rutas de API de Next.js.
 *              Valida el JWT personalizado (`teg_token`) almacenado en cookies o headers y verifica
 *              el alcance por rol (`admin`, `supervisor`, `manager`, `asistente`, `employee`) y sucursal.
 *
 * @businessRules
 * - **Compatibilidad**: Soporta el sistema de JWT personalizado de Tacos Gavilan (`cookies()`, header `cookie` y `Authorization: Bearer`).
 * - **Seguridad**: Valida la firma del token usando la clave de firma de Supabase (`SUPABASE_JWT_SECRET`) sin fallbacks inseguros.
 * - **Permisos por Acción (`StoreScopeAction`)**:
 *   * `view`: `admin`, `supervisor`, `manager`, `asistente`/`assistant`, `shift_leader` (y `employee` solo cuando `allowEmployeeRead: true`).
 *   * `complete_checklist`: `admin`, `supervisor`, `manager`, `asistente`/`assistant`, `shift_leader` (restringido a su sucursal).
 *   * `edit_assignments`: `admin`, `supervisor`, `manager`, `asistente`/`assistant` (`shift_leader` NO puede editar asignaciones de estación).
 *   * `publish_schedule`: `admin`, `supervisor`, `manager`, `asistente`/`assistant` (`shift_leader` NO puede publicar horarios).
 *   * `manage_catalog`: `admin`, `supervisor` (y `DELETE` restringido a `admin`).
 * - **Alcance de Tienda (`authorizeStoreScope`)**:
 *   * `admin` y `supervisor` tienen alcance global multitienda.
 *   * `manager`, `asistente` y `shift_leader` están restringidos exclusivamente a su `store_id` asignada (resolviendo tanto ID numérico como `external_id` Toast GUID).
 *   * `employee` solo puede consultar su propia información/tienda cuando el endpoint habilite `allowEmployeeRead`.
 *   * `basecamp` está aislado estrictamente al módulo `/basecamp` (`/api/basecamp/*`): `verifyStaffAuth` y `authorizeStoreScope` rechazan con `HTTP 403` cualquier petición a endpoints financieros, operativos, de tiendas o de administración salvo que el endpoint declare explícitamente `'basecamp'` en `allowedRoles` o `allowBasecampRole: true`.
 *
 * @dataFlow
 * - Request (Cookie `teg_token` o Header `Authorization`) -> `getServerUser()` -> `jwt.verify()` -> `ServerUser` -> `authorizeStoreScope()`.
 *
 * @notes
 * - Fail-closed: si no hay secreto JWT configurado en el entorno, rechaza peticiones sin permitir bypasses.
 * - OPTIMIZACIÓN CACHE RAM (2026-11-19): Caché en memoria de 15 min para lookups de `stores` (`id`, `code`, `external_id`) en `authorizeStoreScope` y `resolveCachedStore`, con deduplicación in-flight, refresco acotado ante misses (cooldown 60s), cero envenenamiento ante errores y preservación exacta de semántica de autorización.
 * - ENDURECIMIENTO AUTH CORE (2026-11-21): Ventana máxima de gracia acotada a 14 días (`MAX_EXPIRED_GRACE_MS`) para tabletas 24/7, validación de `public.users.is_active` con caché TTL 60s (`activeUserStatusCache`, máx 1,000 entradas), comparación en tiempo constante (`safeTimingEqual`) para `CRON_SECRET`, bloqueo de auto-mint `internal-cron` en producción/Vercel y rate limiter reutilizable (`checkRateLimit`).
 * - AISLAMIENTO ROL BASECAMP (2026-11-21): Defensa en profundidad para `role === 'basecamp'` en `verifyStaffAuth` y `authorizeStoreScope` (`HTTP 403`).
 */

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const MAX_EXPIRED_GRACE_MS = 14 * 24 * 60 * 60 * 1000 // 14 días máx de gracia para tabletas 24/7
const ACTIVE_USER_CACHE_TTL_MS = 60 * 1000 // 60 segundos
const ACTIVE_USER_CACHE_MAX_ENTRIES = 1_000
const RATE_LIMIT_MAX_ENTRIES = 5_000

export interface ActiveUserCacheEntry {
  isActive: boolean
  role: string
  storeId?: string | number
  storeScope?: any
  expiresAt: number
}

export const activeUserStatusCache = new Map<string, ActiveUserCacheEntry>()
const inflightStaffLookups = new Map<string, Promise<ActiveUserCacheEntry | null>>()

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitBuckets = new Map<string, RateLimitEntry>()

/**
 * Compara dos cadenas en tiempo constante usando `crypto.timingSafeEqual` tras verificar longitud en bytes.
 */
export function safeTimingEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.byteLength !== bufB.byteLength) {
    if (bufA.byteLength > 0) {
      crypto.timingSafeEqual(bufA, bufA)
    }
    return false
  }
  if (bufA.byteLength === 0) return true
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * Rate limiter en memoria con tope estricto de 5,000 llaves para proteger endpoints críticos.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { limited: boolean; retryAfterSec: number } {
  const now = Date.now()
  const existing = rateLimitBuckets.get(key)

  if (existing && existing.resetAt > now) {
    if (existing.count >= maxRequests) {
      return {
        limited: true,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      }
    }
    existing.count += 1
    return { limited: false, retryAfterSec: 0 }
  }

  if (rateLimitBuckets.size >= RATE_LIMIT_MAX_ENTRIES) {
    for (const [k, v] of rateLimitBuckets) {
      if (v.resetAt <= now) rateLimitBuckets.delete(k)
      if (rateLimitBuckets.size < RATE_LIMIT_MAX_ENTRIES) break
    }
    if (rateLimitBuckets.size >= RATE_LIMIT_MAX_ENTRIES) {
      const oldestKey = rateLimitBuckets.keys().next().value
      if (oldestKey !== undefined) rateLimitBuckets.delete(oldestKey)
    }
  }

  rateLimitBuckets.set(key, {
    count: 1,
    resetAt: now + windowMs,
  })
  return { limited: false, retryAfterSec: 0 }
}

/**
 * Consulta sin incrementar si una llave ya alcanzó el límite de peticiones en la ventana activa.
 */
export function peekRateLimit(
  key: string,
  maxRequests: number
): { limited: boolean; retryAfterSec: number } {
  const now = Date.now()
  const existing = rateLimitBuckets.get(key)
  if (existing && existing.resetAt > now && existing.count >= maxRequests) {
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }
  return { limited: false, retryAfterSec: 0 }
}

export function resetRateLimit(key: string): void {
  rateLimitBuckets.delete(key)
}

function setActiveUserCacheBounded(key: string, entry: ActiveUserCacheEntry): void {
  if (!key) return
  const now = Date.now()
  if (!activeUserStatusCache.has(key) && activeUserStatusCache.size >= ACTIVE_USER_CACHE_MAX_ENTRIES) {
    for (const [k, v] of activeUserStatusCache) {
      if (v.expiresAt <= now) activeUserStatusCache.delete(k)
      if (activeUserStatusCache.size < ACTIVE_USER_CACHE_MAX_ENTRIES) break
    }
    if (activeUserStatusCache.size >= ACTIVE_USER_CACHE_MAX_ENTRIES) {
      const oldest = activeUserStatusCache.keys().next().value
      if (oldest !== undefined) activeUserStatusCache.delete(oldest)
    }
  }
  activeUserStatusCache.set(key, entry)
}

/**
 * Invalida de inmediato la caché de estado activo de usuario tras altas, bajas o cambios de rol.
 */
export function invalidateActiveUserStatusCache(
  userId?: string | number | null,
  email?: string | null
): void {
  if ((userId === undefined || userId === null) && !email) {
    activeUserStatusCache.clear()
    return
  }
  if (userId !== undefined && userId !== null) {
    activeUserStatusCache.delete(`id:${String(userId).trim()}`)
  }
  if (email) {
    activeUserStatusCache.delete(`email:${String(email).trim().toLowerCase()}`)
  }
}

function hasLiveSupabaseServiceConfig(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return Boolean(
    url &&
      !url.includes('placeholder.supabase.co') &&
      key &&
      key !== 'placeholder'
  )
}

function safeDecodeCookie(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

async function fetchActiveStaffStatusFromDb(
  userId: string,
  email: string
): Promise<{ entry?: ActiveUserCacheEntry; transientError?: boolean }> {
  const cleanId = String(userId || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()

  if (!hasLiveSupabaseServiceConfig()) {
    return { transientError: true }
  }

  const inflightKey = cleanId ? `id:${cleanId}` : `email:${cleanEmail}`
  const existingInflight = inflightStaffLookups.get(inflightKey)
  if (existingInflight) {
    const res = await existingInflight
    return res ? { entry: res } : { transientError: true }
  }

  const lookupPromise = (async (): Promise<ActiveUserCacheEntry | null> => {
    try {
      const admin = await getSupabaseAdminClient()
      let row: any = null

      if (/^\d+$/.test(cleanId)) {
        const { data, error } = await admin
          .from('users')
          .select('id, email, role, store_id, store_scope, is_active')
          .eq('id', Number(cleanId))
          .maybeSingle()
        if (error) return null
        row = data
      }

      if (!row && cleanEmail && !/[%*\0\\\s]/.test(cleanEmail)) {
        const escapedEmail = cleanEmail.replace(/_/g, '\\_')
        const { data, error } = await admin
          .from('users')
          .select('id, email, role, store_id, store_scope, is_active')
          .ilike('email', escapedEmail)
          .limit(5)
        if (error) return null
        if (Array.isArray(data)) {
          row = data.find((r: any) => String(r?.email || '').trim().toLowerCase() === cleanEmail) || null
        }
      }

      const expiresAt = Date.now() + ACTIVE_USER_CACHE_TTL_MS
      if (!row) {
        const negativeEntry: ActiveUserCacheEntry = {
          isActive: false,
          role: '',
          expiresAt,
        }
        if (cleanId) setActiveUserCacheBounded(`id:${cleanId}`, negativeEntry)
        if (cleanEmail) setActiveUserCacheBounded(`email:${cleanEmail}`, negativeEntry)
        return negativeEntry
      }

      const positiveEntry: ActiveUserCacheEntry = {
        isActive: row.is_active !== false,
        role: String(row.role || '').trim().toLowerCase(),
        storeId: row.store_id ?? undefined,
        storeScope: row.store_scope ?? undefined,
        expiresAt,
      }
      setActiveUserCacheBounded(`id:${String(row.id)}`, positiveEntry)
      if (cleanId) setActiveUserCacheBounded(`id:${cleanId}`, positiveEntry)
      const dbEmail = String(row.email || cleanEmail).trim().toLowerCase()
      if (dbEmail) setActiveUserCacheBounded(`email:${dbEmail}`, positiveEntry)
      return positiveEntry
    } catch {
      return null
    }
  })().finally(() => {
    inflightStaffLookups.delete(inflightKey)
  })

  inflightStaffLookups.set(inflightKey, lookupPromise)
  const resolved = await lookupPromise
  if (!resolved) return { transientError: true }
  return { entry: resolved }
}

function getCachedStaffStatusSync(
  userId: string,
  email: string
): { hit: ActiveUserCacheEntry | null; expiredHit: ActiveUserCacheEntry | null } {
  const now = Date.now()
  const cleanId = String(userId || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  const byId = cleanId ? activeUserStatusCache.get(`id:${cleanId}`) : undefined
  const byEmail = cleanEmail ? activeUserStatusCache.get(`email:${cleanEmail}`) : undefined
  const candidate = byId || byEmail || null
  if (!candidate) return { hit: null, expiredHit: null }
  if (candidate.expiresAt > now) return { hit: candidate, expiredHit: null }
  return { hit: null, expiredHit: candidate }
}

export function getJwtSecret(): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET
  if (!secret || !secret.trim()) {
    return null
  }
  return secret.trim().replace(/^"(.*)"$/, '$1')
}

export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return null
  }
  return secret.trim()
}

/**
 * Construye encabezados seguros para llamadas internas server-to-server entre crons y endpoints protegidos.
 * En producción usa `CRON_SECRET` / `authorization` / `cookie` entrantes; en local sin `CRON_SECRET` ni sesión,
 * firma un JWT efímero de 5 minutos con `SUPABASE_JWT_SECRET` para que `verifyStaffAuth` nunca devuelva 401.
 */
export function buildInternalCronAuthHeaders(request: Request): Record<string, string> {
  const cronSecret = getCronSecret() || ''
  const incomingAuth = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const incomingCookie = request.headers.get('cookie') || request.headers.get('Cookie') || ''
  let authorization = incomingAuth
  const isLocalDevOnly =
    process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1'
  if (!cronSecret && !incomingAuth && !incomingCookie && isLocalDevOnly) {
    const jwtSecret = getJwtSecret()
    if (jwtSecret) {
      const ephemeral = jwt.sign(
        {
          sub: 'internal-cron',
          email: 'cron@tacosgavilan.com',
          role: 'admin',
          user_role: 'admin',
          user_type: 'staff',
        },
        jwtSecret,
        { algorithm: 'HS256', expiresIn: '5m' }
      )
      authorization = `Bearer ${ephemeral}`
    }
  }
  return {
    'x-cron-auth': cronSecret,
    authorization,
    cookie: incomingCookie,
  }
}

export interface ServerUser {
  id: string
  email: string
  name: string
  username?: string
  role: string
  store_id?: string | number
  store_ids?: string[]
  store_scope?: any
}

/**
 * Obtiene el usuario autenticado del lado del servidor leyendo la cookie 'teg_token' o el header Authorization.
 *
 * @returns ServerUser si el token es válido y el usuario sigue activo en DB, null de lo contrario.
 */
export async function getServerUser(req?: Request): Promise<ServerUser | null> {
  try {
    const candidateTokens: string[] = []

    if (req) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const bearer = authHeader.substring(7).trim()
        if (bearer && bearer !== 'null' && bearer !== 'undefined') candidateTokens.push(bearer)
      }
    }

    try {
      const cookieStore = await cookies()
      const cookieVal = cookieStore.get('teg_token')?.value?.trim()
      if (cookieVal && !candidateTokens.includes(cookieVal)) {
        candidateTokens.push(cookieVal)
      }
    } catch {
      // En contextos fuera de request store de Next.js (ej. tests directos), continuar con headers
    }

    if (req) {
      const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie') || ''
      const match = cookieHeader.match(/(?:^|;\s*)teg_token=([^;]+)/)
      if (match?.[1]) {
        const headerCookieVal = safeDecodeCookie(match[1].trim())
        if (headerCookieVal && !candidateTokens.includes(headerCookieVal)) {
          candidateTokens.push(headerCookieVal)
        }
      }
    }

    if (candidateTokens.length === 0) {
      return null
    }

    const secret = getJwtSecret()
    if (!secret) {
      console.error('❌ [getServerUser] Fail-closed: JWT secret no configurado en variables de entorno')
      return null
    }

    let decoded: any = null
    let isExpiredToken = false
    for (const candidate of candidateTokens) {
      try {
        const verified = jwt.verify(candidate, secret, { algorithms: ['HS256'] }) as any
        if (verified && verified.sub && verified.email) {
          decoded = verified
          isExpiredToken = false
          break
        }
      } catch (verifyErr: any) {
        if (verifyErr?.name === 'TokenExpiredError') {
          try {
            const verifiedGrace = jwt.verify(candidate, secret, {
              algorithms: ['HS256'],
              ignoreExpiration: true
            }) as any
            if (
              verifiedGrace &&
              verifiedGrace.sub &&
              verifiedGrace.email &&
              verifiedGrace.user_type !== 'employee' &&
              typeof verifiedGrace.exp === 'number' &&
              Date.now() - verifiedGrace.exp * 1000 <= MAX_EXPIRED_GRACE_MS
            ) {
              decoded = verifiedGrace
              isExpiredToken = true
              break
            }
          } catch {
            // Ignorar si la firma no es válida
          }
        }
      }
    }

    if (!decoded || !decoded.sub || !decoded.email) {
      return null
    }

    // Bloquear tokens de clientes móviles GoTrue (role='authenticated' sin user_role/user_type de TEG)
    if (decoded.role === 'authenticated' && !decoded.user_role && !decoded.user_type) {
      return null
    }

    let resolvedRole = (
      decoded.user_role ||
      (decoded.role && decoded.role !== 'authenticated' ? decoded.role : '') ||
      'user'
    )
      .toString()
      .toLowerCase()

    let resolvedStoreId = decoded.user_metadata?.store_id ?? decoded.store_id ?? undefined
    let resolvedStoreScope = decoded.user_metadata?.store_scope ?? undefined

    const userIdStr = String(decoded.sub)
    const emailStr = String(decoded.email)
    const isStaffToken = decoded.user_type !== 'employee' && userIdStr !== 'internal-cron'

    if (isStaffToken) {
      const { hit } = getCachedStaffStatusSync(userIdStr, emailStr)
      if (hit) {
        if (!hit.isActive) return null
        if (hit.role) resolvedRole = hit.role
        if (hit.storeId !== undefined) resolvedStoreId = hit.storeId
        if (hit.storeScope !== undefined) resolvedStoreScope = hit.storeScope
      } else {
        const dbCheck = await fetchActiveStaffStatusFromDb(userIdStr, emailStr)
        if (dbCheck.transientError) {
          // Fail open SOLO para tokens no expirados; fail closed para tokens expirados
          if (isExpiredToken) return null
        } else if (dbCheck.entry) {
          if (!dbCheck.entry.isActive) return null
          if (dbCheck.entry.role) resolvedRole = dbCheck.entry.role
          if (dbCheck.entry.storeId !== undefined) resolvedStoreId = dbCheck.entry.storeId
          if (dbCheck.entry.storeScope !== undefined) resolvedStoreScope = dbCheck.entry.storeScope
        }
      }
    }

    return {
      id: userIdStr,
      email: emailStr,
      name: decoded.user_metadata?.full_name || decoded.email,
      role: resolvedRole,
      store_id: resolvedStoreId,
      store_ids: Array.isArray(decoded.user_metadata?.store_ids)
        ? decoded.user_metadata.store_ids
        : undefined,
      store_scope: resolvedStoreScope
    }
  } catch (err: any) {
    console.error('❌ [getServerUser] Verification failed:', err.message)
    return null
  }
}

export type StoreScopeAction =
  | 'view'
  | 'complete_checklist'
  | 'edit_assignments'
  | 'publish_schedule'
  | 'manage_catalog'

export const ACTION_ALLOWED_ROLES: Record<StoreScopeAction, readonly string[]> = {
  view: [
    'admin',
    'supervisor',
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
    'planificador',
    'shift_leader',
    'shift leader',
    'shiftleader',
  ],
  complete_checklist: [
    'admin',
    'supervisor',
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
    'shift_leader',
    'shift leader',
    'shiftleader',
  ],
  edit_assignments: ['admin', 'supervisor', 'manager', 'gerente', 'general_manager', 'asistente', 'assistant'],
  publish_schedule: ['admin', 'supervisor', 'manager', 'gerente', 'general_manager', 'asistente', 'assistant', 'planificador'],
  manage_catalog: ['admin', 'supervisor'],
}

export interface StoreScopeAuthResult {
  authorized: boolean
  status: number
  error?: string
  user?: ServerUser
  isGlobalRole?: boolean
  resolvedStoreId?: number
  resolvedStoreGuid?: string
  canonicalNumericId?: number
  canonicalExternalId?: string
}

export interface CachedStoreLookupRow {
  id: number
  code: string | null
  external_id: string | null
}

interface StoreLookupIndex {
  fetchedAt: number
  byId: Map<number, CachedStoreLookupRow>
  byExternalId: Map<string, CachedStoreLookupRow>
  byCode: Map<string, CachedStoreLookupRow>
}

interface StoreLookupCacheBucket {
  index: StoreLookupIndex | null
  inflight: Promise<StoreLookupIndex | null> | null
  lastMissRefreshAt: number
}

interface StoreLookupQueryResult {
  data?: Array<Record<string, unknown>> | null
  error?: unknown
}

interface StoreLookupSingleResult {
  data?: Record<string, unknown> | null
  error?: unknown
}

interface StoreLookupSelectBuilder extends PromiseLike<StoreLookupQueryResult> {
  eq?: (column: string, value: unknown) => { maybeSingle: () => Promise<StoreLookupSingleResult> }
  in?: (column: string, values: unknown[]) => Promise<StoreLookupQueryResult>
}

interface StoreLookupClientLike {
  supabaseUrl?: string
  from: (table: string) => {
    select: (columns: string) => StoreLookupSelectBuilder
  }
}

const STORE_LOOKUP_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutos
const STORE_LOOKUP_MISS_REFRESH_COOLDOWN_MS = 60_000 // 1 minuto
const storeCacheByUrl = new Map<string, StoreLookupCacheBucket>()
const storeCacheByClient = new WeakMap<object, StoreLookupCacheBucket>()

function getStoreCacheBucket(supabaseClient: StoreLookupClientLike): StoreLookupCacheBucket {
  const urlKey =
    supabaseClient && typeof supabaseClient.supabaseUrl === 'string' && supabaseClient.supabaseUrl.length > 0
      ? supabaseClient.supabaseUrl
      : null
  if (urlKey) {
    let bucket = storeCacheByUrl.get(urlKey)
    if (!bucket) {
      bucket = { index: null, inflight: null, lastMissRefreshAt: 0 }
      storeCacheByUrl.set(urlKey, bucket)
    }
    return bucket
  }
  let bucket = storeCacheByClient.get(supabaseClient)
  if (!bucket) {
    bucket = { index: null, inflight: null, lastMissRefreshAt: 0 }
    storeCacheByClient.set(supabaseClient, bucket)
  }
  return bucket
}

/**
 * Invalida la caché en RAM de sucursales (`id`, `code`, `external_id`).
 * Útil tras altas/ediciones en `/api/stores` o en pruebas automatizadas.
 */
export function invalidateStoreLookupCache(supabaseClient?: unknown): void {
  if (supabaseClient && typeof supabaseClient === 'object') {
    const bucket = getStoreCacheBucket(supabaseClient as StoreLookupClientLike)
    bucket.index = null
    bucket.lastMissRefreshAt = 0
    return
  }
  storeCacheByUrl.clear()
}

async function loadStoreLookupIndex(
  supabaseClient: StoreLookupClientLike | null | undefined,
  forceRefresh = false
): Promise<StoreLookupIndex | null> {
  if (!supabaseClient || typeof supabaseClient.from !== 'function') return null

  const bucket = getStoreCacheBucket(supabaseClient)
  const now = Date.now()
  if (!forceRefresh && bucket.index && now - bucket.index.fetchedAt < STORE_LOOKUP_CACHE_TTL_MS) {
    return bucket.index
  }
  if (bucket.inflight) {
    return bucket.inflight
  }

  bucket.inflight = (async () => {
    try {
      const res = await supabaseClient.from('stores').select('id, code, external_id')
      if (!res || res.error || !Array.isArray(res.data)) {
        return bucket.index
      }
      const byId = new Map<number, CachedStoreLookupRow>()
      const byExternalId = new Map<string, CachedStoreLookupRow>()
      const byCode = new Map<string, CachedStoreLookupRow>()
      for (const raw of res.data) {
        if (raw === null || raw === undefined || raw.id === null || raw.id === undefined) continue
        const numericId = Number(raw.id)
        if (!Number.isFinite(numericId)) continue
        const row: CachedStoreLookupRow = {
          id: numericId,
          code: raw.code !== null && raw.code !== undefined ? String(raw.code).trim() || null : null,
          external_id:
            raw.external_id !== null && raw.external_id !== undefined
              ? String(raw.external_id).trim() || null
              : null
        }
        byId.set(row.id, row)
        if (row.external_id) {
          byExternalId.set(row.external_id, row)
        }
        if (row.code) {
          byCode.set(row.code.toUpperCase(), row)
        }
      }
      const nextIndex: StoreLookupIndex = {
        fetchedAt: Date.now(),
        byId,
        byExternalId,
        byCode
      }
      bucket.index = nextIndex
      return nextIndex
    } catch {
      return bucket.index
    }
  })().finally(() => {
    bucket.inflight = null
  })

  return bucket.inflight
}

async function lookupStoreByIdOrExternalId(
  supabaseClient: StoreLookupClientLike | null | undefined,
  rawTarget: string
): Promise<CachedStoreLookupRow | null> {
  const cleanTarget = String(rawTarget || '').trim()
  if (!cleanTarget || !supabaseClient) return null
  const isNum = /^\d+$/.test(cleanTarget)

  const bucket = getStoreCacheBucket(supabaseClient)
  let index = await loadStoreLookupIndex(supabaseClient, false)

  if (!index) {
    // Fallback seguro para clientes stub/test que solo implementan .eq().maybeSingle()
    const q = supabaseClient.from('stores').select('id, external_id')
    if (typeof q.eq !== 'function') return null
    const { data: st } = isNum
      ? await q.eq('id', Number(cleanTarget)).maybeSingle()
      : await q.eq('external_id', cleanTarget).maybeSingle()
    if (!st) return null
    return {
      id: Number(st.id),
      code: st.code !== null && st.code !== undefined ? String(st.code) : null,
      external_id: st.external_id !== null && st.external_id !== undefined ? String(st.external_id) : null
    }
  }

  const findInIndex = (idx: StoreLookupIndex): CachedStoreLookupRow | null =>
    (isNum ? idx.byId.get(Number(cleanTarget)) : idx.byExternalId.get(cleanTarget)) || null

  const hit = findInIndex(index)
  if (hit) return hit

  // Miss seguro: refresca como máximo 1 vez cada 60s para captar tiendas recién creadas sin permitir miss-flood
  const now = Date.now()
  if (now - bucket.lastMissRefreshAt >= STORE_LOOKUP_MISS_REFRESH_COOLDOWN_MS) {
    bucket.lastMissRefreshAt = now
    const refreshed = await loadStoreLookupIndex(supabaseClient, true)
    if (refreshed) {
      index = refreshed
      return findInIndex(index)
    }
  }

  return null
}

async function lookupStoresByExternalIds(
  supabaseClient: StoreLookupClientLike | null | undefined,
  externalIds: string[]
): Promise<CachedStoreLookupRow[]> {
  if (!supabaseClient || externalIds.length === 0) return []

  const bucket = getStoreCacheBucket(supabaseClient)
  let index = await loadStoreLookupIndex(supabaseClient, false)

  if (!index) {
    const q = supabaseClient.from('stores').select('id, external_id')
    if (typeof q.in !== 'function') return []
    const { data: st } = await q.in('external_id', externalIds)
    return (st || []).map((row) => ({
      id: Number(row.id),
      code: row.code !== null && row.code !== undefined ? String(row.code) : null,
      external_id: row.external_id !== null && row.external_id !== undefined ? String(row.external_id) : null
    }))
  }

  const hasMissing = externalIds.some((ext) => !index!.byExternalId.has(ext))
  if (hasMissing) {
    const now = Date.now()
    if (now - bucket.lastMissRefreshAt >= STORE_LOOKUP_MISS_REFRESH_COOLDOWN_MS) {
      bucket.lastMissRefreshAt = now
      const refreshed = await loadStoreLookupIndex(supabaseClient, true)
      if (refreshed) {
        index = refreshed
      }
    }
  }

  const matched: CachedStoreLookupRow[] = []
  for (const ext of externalIds) {
    const row = index.byExternalId.get(ext)
    if (row) matched.push(row)
  }
  return matched
}

/**
 * Resuelve una sucursal por `id` numérico, `external_id` (Toast GUID) o `code` usando la caché RAM de 15 min.
 */
export async function resolveCachedStore(
  identifier: string | number | null | undefined,
  supabaseClient: unknown
): Promise<CachedStoreLookupRow | null> {
  const clean = identifier !== null && identifier !== undefined ? String(identifier).trim() : ''
  if (!clean || !supabaseClient || typeof supabaseClient !== 'object') return null
  const client = supabaseClient as StoreLookupClientLike

  const index = await loadStoreLookupIndex(client, false)
  if (index) {
    const isNum = /^\d+$/.test(clean)
    const upper = clean.toUpperCase()
    const direct =
      (isNum ? index.byId.get(Number(clean)) : index.byExternalId.get(clean)) ||
      index.byCode.get(upper) ||
      null
    if (direct) return direct

    const bucket = getStoreCacheBucket(client)
    const now = Date.now()
    if (now - bucket.lastMissRefreshAt >= STORE_LOOKUP_MISS_REFRESH_COOLDOWN_MS) {
      bucket.lastMissRefreshAt = now
      const refreshed = await loadStoreLookupIndex(client, true)
      if (refreshed) {
        return (
          (isNum ? refreshed.byId.get(Number(clean)) : refreshed.byExternalId.get(clean)) ||
          refreshed.byCode.get(upper) ||
          null
        )
      }
    }
    return null
  }

  return lookupStoreByIdOrExternalId(client, clean)
}

/**
 * Verifica que el usuario autenticado tenga autorización sobre la sucursal solicitada (`targetStoreId`),
 * soportando tanto ID numérico de `stores.id` como `stores.external_id` (Toast GUID), y validando
 * permisos granulares por acción (`view`, `complete_checklist`, `edit_assignments`, `publish_schedule`, `manage_catalog`).
 */
export async function authorizeStoreScope(
  user: ServerUser | null,
  targetStoreId: string | number | null | undefined,
  supabaseClient: any,
  options?: {
    requireWrite?: boolean
    allowEmployeeRead?: boolean
    allowComparativeAll?: boolean
    action?: StoreScopeAction
    allowedRoles?: string[]
  }
): Promise<StoreScopeAuthResult> {
  if (!user) {
    return {
      authorized: false,
      status: 401,
      error: 'No autenticado. Inicia sesión nuevamente.'
    }
  }

  const role = (user.role || '').trim().toLowerCase()

  if (role === 'basecamp') {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso restringido exclusivamente al módulo Basecamp'
    }
  }

  if (Array.isArray(options?.allowedRoles) && options!.allowedRoles.length > 0) {
    const normalizedAllowed = options!.allowedRoles.map((r) => r.trim().toLowerCase())
    if (!normalizedAllowed.includes(role)) {
      return {
        authorized: false,
        status: 403,
        error: 'Acceso denegado: Tu rol no tiene permiso para ejecutar esta acción.'
      }
    }
  }

  const effectiveAction: StoreScopeAction | undefined =
    options?.action ?? (options?.requireWrite ? 'edit_assignments' : undefined)

  if (effectiveAction) {
    const allowedForAction = ACTION_ALLOWED_ROLES[effectiveAction]
    const employeeReadPermitted =
      effectiveAction === 'view' && Boolean(options?.allowEmployeeRead) && role === 'employee'
    if (!allowedForAction.includes(role) && !employeeReadPermitted) {
      return {
        authorized: false,
        status: 403,
        error: `Acceso denegado: Tu rol (${role}) no tiene permiso para la acción '${effectiveAction}'.`
      }
    }
  }

  const isGlobal = role === 'admin' || role === 'supervisor'

  if (isGlobal) {
    let resolvedStoreId: number | undefined
    let resolvedStoreGuid: string | undefined
    const cleanTarget = targetStoreId !== null && targetStoreId !== undefined ? String(targetStoreId).trim() : ''
    if (cleanTarget && cleanTarget.toUpperCase() !== 'ALL' && supabaseClient) {
      const st = await lookupStoreByIdOrExternalId(supabaseClient, cleanTarget)
      if (st) {
        resolvedStoreId = st.id
        resolvedStoreGuid = st.external_id ?? undefined
      }
    }
    return {
      authorized: true,
      status: 200,
      user,
      isGlobalRole: true,
      resolvedStoreId,
      resolvedStoreGuid,
      canonicalNumericId: resolvedStoreId,
      canonicalExternalId: resolvedStoreGuid
    }
  }

  const isStoreLeadership =
    role === 'manager' ||
    role === 'gerente' ||
    role === 'general_manager' ||
    role === 'asistente' ||
    role === 'assistant'
  const isPlanner = role === 'planificador'
  const isShiftLeader =
    role === 'shift_leader' ||
    role === 'shift leader' ||
    role === 'shiftleader'
  const isEmployee = role === 'employee'

  const canPerformAction =
    effectiveAction === 'complete_checklist'
      ? isStoreLeadership || isShiftLeader
      : effectiveAction === 'publish_schedule'
        ? isStoreLeadership || isPlanner
        : options?.requireWrite || effectiveAction === 'edit_assignments'
          ? isStoreLeadership
          : effectiveAction === 'manage_catalog'
            ? false
            : isStoreLeadership || isPlanner || isShiftLeader || (isEmployee && Boolean(options?.allowEmployeeRead))

  if (!canPerformAction) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso denegado: Tu rol no tiene permisos para ejecutar esta operación.'
    }
  }

  const cleanTarget = targetStoreId !== null && targetStoreId !== undefined ? String(targetStoreId).trim() : ''

  if (!cleanTarget) {
    return {
      authorized: true,
      status: 200,
      user,
      isGlobalRole: false
    }
  }

  if (cleanTarget.toUpperCase() === 'ALL') {
    if (options?.allowComparativeAll && !options?.requireWrite) {
      return {
        authorized: true,
        status: 200,
        user,
        isGlobalRole: false
      }
    }
    return {
      authorized: false,
      status: 403,
      error: 'Acceso denegado: No tienes permisos globales para operar sobre todas las sucursales.'
    }
  }

  if (isEmployee) {
    const empStores = Array.isArray(user.store_ids) ? user.store_ids.map(String) : []
    if (empStores.includes(cleanTarget)) {
      return { authorized: true, status: 200, user, isGlobalRole: false }
    }
    if (supabaseClient && empStores.length > 0) {
      const st = await lookupStoresByExternalIds(supabaseClient, empStores)
      const matched = st.find(
        (row) => String(row.id) === cleanTarget || String(row.external_id) === cleanTarget
      )
      if (matched) {
        return {
          authorized: true,
          status: 200,
          user,
          isGlobalRole: false,
          resolvedStoreId: matched.id,
          resolvedStoreGuid: matched.external_id ?? undefined,
          canonicalNumericId: matched.id,
          canonicalExternalId: matched.external_id ?? undefined
        }
      }
    }
    return {
      authorized: false,
      status: 403,
      error: 'Acceso denegado: No perteneces a la sucursal solicitada.'
    }
  }

  // Para manager o asistente: verificar correspondencia exacta con user.store_id
  const userStoreRaw = user.store_id !== null && user.store_id !== undefined ? String(user.store_id).trim() : ''
  if (!userStoreRaw) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso denegado: Tu cuenta no tiene una sucursal asignada.'
    }
  }

  if (supabaseClient) {
    const storeRow = await lookupStoreByIdOrExternalId(supabaseClient, userStoreRaw)

    if (
      storeRow &&
      (String(storeRow.id) === cleanTarget || String(storeRow.external_id) === cleanTarget)
    ) {
      return {
        authorized: true,
        status: 200,
        user,
        isGlobalRole: false,
        resolvedStoreId: storeRow.id,
        resolvedStoreGuid: storeRow.external_id ?? undefined,
        canonicalNumericId: storeRow.id,
        canonicalExternalId: storeRow.external_id ?? undefined
      }
    }
  } else if (userStoreRaw === cleanTarget) {
    return {
      authorized: true,
      status: 200,
      user,
      isGlobalRole: false
    }
  }

  return {
    authorized: false,
    status: 403,
    error: 'Acceso denegado: No tienes autorización para acceder o modificar otra sucursal.'
  }
}

export interface DecodedToken {
  id: string
  sub: string
  email: string
  role: string
  user_role: string
  user_type?: string
  user_metadata?: {
    full_name?: string
    role?: string
    store_scope?: any
    store_id?: any
    store_ids?: any
    toast_guid?: string
  }
}

/**
 * Verifica un token JWT de autenticación de forma sincrónica.
 *
 * @param token El token JWT a verificar.
 * @returns El token decodificado o null si es inválido.
 */
export function verifyAuthToken(token: string): DecodedToken | null {
  try {
    if (!token || typeof token !== 'string') {
      return null
    }

    const secret = getJwtSecret()
    if (!secret) {
      console.error('❌ [verifyAuthToken] Fail-closed: JWT secret no configurado en variables de entorno')
      return null
    }

    let decoded: any = null
    try {
      decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any
    } catch (verifyErr: any) {
      if (verifyErr?.name === 'TokenExpiredError') {
        const verifiedGrace = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          ignoreExpiration: true
        }) as any
        if (
          verifiedGrace &&
          verifiedGrace.user_type !== 'employee' &&
          typeof verifiedGrace.exp === 'number' &&
          Date.now() - verifiedGrace.exp * 1000 <= MAX_EXPIRED_GRACE_MS
        ) {
          decoded = verifiedGrace
        }
      } else {
        throw verifyErr
      }
    }

    const userId = decoded?.sub ?? decoded?.id
    if (!decoded || !userId || !decoded.email) {
      return null
    }

    // Bloquear tokens de clientes móviles GoTrue (role='authenticated' sin user_role/user_type de TEG)
    if (decoded.role === 'authenticated' && !decoded.user_role && !decoded.user_type) {
      return null
    }

    let resolvedRole = (
      decoded.user_role ||
      (decoded.role && decoded.role !== 'authenticated' ? decoded.role : '') ||
      'user'
    )
      .toString()
      .toLowerCase()

    const userIdStr = String(userId)
    const emailStr = String(decoded.email)
    const isStaffToken = decoded.user_type !== 'employee' && userIdStr !== 'internal-cron'

    if (isStaffToken) {
      const { hit, expiredHit } = getCachedStaffStatusSync(userIdStr, emailStr)
      if (hit) {
        if (!hit.isActive) return null
        if (hit.role) resolvedRole = hit.role
        if (hit.storeId !== undefined && decoded.user_metadata) {
          decoded.user_metadata.store_id = hit.storeId
        }
      } else {
        if (expiredHit) {
          if (!expiredHit.isActive) {
            fetchActiveStaffStatusFromDb(userIdStr, emailStr).catch(() => {})
            return null
          }
          if (expiredHit.role) resolvedRole = expiredHit.role
        }
        fetchActiveStaffStatusFromDb(userIdStr, emailStr).catch(() => {})
      }
    }

    decoded.id = userIdStr
    decoded.sub = userIdStr
    decoded.role = resolvedRole
    decoded.user_role = resolvedRole
    return decoded as DecodedToken
  } catch (err: any) {
    console.error('❌ [verifyAuthToken] Verification failed:', err.message)
    return null
  }
}

/**
 * Valida que una petición HTTP cuente con sesión JWT válida de personal interno (admin, supervisor,
 * manager, asistente, shift_leader, planificador, etc.) o provenga de un Cron autorizado con CRON_SECRET.
 * El rol restringido `'basecamp'` se rechaza con HTTP 403 salvo que el endpoint lo autorice explícitamente
 * mediante `allowedRoles` incluyendo `'basecamp'` o `allowBasecampRole: true`.
 */
export function verifyStaffAuth(
  request: Request,
  options?: { allowedRoles?: string[]; allowCron?: boolean; allowEmployee?: boolean; allowBasecampRole?: boolean }
): AdminAuthResult {
  const allowCron = options?.allowCron ?? true
  const cronSecret = getCronSecret()

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  const cookieHeader = request.headers.get('cookie') || request.headers.get('Cookie') || ''
  const cronHeader = request.headers.get('x-cron-auth') || authHeader || ''

  if (allowCron && cronSecret && cronHeader) {
    const isCronAuthorized =
      safeTimingEqual(cronHeader, `Bearer ${cronSecret}`) ||
      safeTimingEqual(cronHeader, cronSecret)
    if (isCronAuthorized) {
      return { authorized: true }
    }
  }

  let token: string | null = null
  if (authHeader?.startsWith('Bearer ')) {
    const candidate = authHeader.substring(7).trim()
    if (candidate && candidate !== 'null' && candidate !== 'undefined') {
      token = candidate
    }
  }
  if (!token) {
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)teg_token=([^;]+)/)
    if (cookieMatch?.[1]) {
      token = safeDecodeCookie(cookieMatch[1].trim())
    }
  }

  if (!token) {
    const error = 'No autorizado: Token de autenticación no proporcionado'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  const user = verifyAuthToken(token)
  if (!user) {
    const error = 'No autorizado: Token inválido o expirado'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  const userRole = (user.role || user.user_role || '').trim().toLowerCase()
  if (!options?.allowEmployee && (user.user_type === 'employee' || userRole === 'employee')) {
    const error = 'No autorizado: Credenciales de empleado no tienen acceso a este recurso administrativo'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  if (userRole === 'basecamp') {
    const explicitlyAllowed =
      Boolean(options?.allowBasecampRole) ||
      (options?.allowedRoles || []).some((r) => r.trim().toLowerCase() === 'basecamp')
    if (!explicitlyAllowed) {
      const error = 'Acceso restringido exclusivamente al módulo Basecamp'
      return {
        authorized: false,
        error,
        status: 403,
        response: NextResponse.json({ error }, { status: 403 })
      }
    }
  }

  if (options?.allowedRoles && options.allowedRoles.length > 0) {
    const normalizedAllowed = options.allowedRoles.map(r => r.trim().toLowerCase())
    const allowedViaBasecampFlag = userRole === 'basecamp' && Boolean(options?.allowBasecampRole)
    if (
      userRole !== 'admin' &&
      userRole !== 'administrador' &&
      !normalizedAllowed.includes(userRole) &&
      !allowedViaBasecampFlag
    ) {
      const error = 'Acceso denegado: Permisos insuficientes para esta operación'
      return {
        authorized: false,
        error,
        status: 403,
        response: NextResponse.json({ error }, { status: 403 })
      }
    }
  }

  return { authorized: true, user }
}

export interface AdminAuthResult {
  authorized: boolean
  user?: DecodedToken
  error?: string
  status?: number
  response?: NextResponse
}

/**
 * Valida que una petición HTTP a endpoints administrativos cuente con token JWT válido con rol 'admin',
 * o provenga de un invocador de cron autorizado con CRON_SECRET.
 */
export function verifyAdminAuth(request: Request, options?: { allowCron?: boolean }): AdminAuthResult {
  const allowCron = options?.allowCron ?? true
  const cronSecret = getCronSecret()

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  const cookieHeader = request.headers.get('cookie') || request.headers.get('Cookie') || ''
  const cronHeader = request.headers.get('x-cron-auth') || authHeader || ''

  // 1. Invocación de cron: SOLO si está permitida Y el secreto está explícitamente configurado
  if (allowCron && cronSecret && cronHeader) {
    const isCronAuthorized =
      safeTimingEqual(cronHeader, `Bearer ${cronSecret}`) ||
      safeTimingEqual(cronHeader, cronSecret)
    if (isCronAuthorized) {
      return { authorized: true }
    }
  }

  // 2. Extracción de token de usuario
  let token: string | null = null
  if (authHeader?.startsWith('Bearer ')) {
    const candidate = authHeader.substring(7).trim()
    if (candidate && candidate !== 'null' && candidate !== 'undefined') {
      token = candidate
    }
  }
  if (!token) {
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)teg_token=([^;]+)/)
    if (cookieMatch?.[1]) {
      token = safeDecodeCookie(cookieMatch[1].trim())
    }
  }

  if (!token) {
    const error = 'No autorizado: Token de autenticación no proporcionado'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  // 3. Fallo cerrado si falta secreto de firma JWT
  const jwtSecret = getJwtSecret()
  if (!jwtSecret) {
    console.error('❌ [verifyAdminAuth] Fail-closed: JWT_SECRET / SUPABASE_JWT_SECRET no configurado')
    const error = 'No autorizado: Configuración de seguridad del servidor no disponible'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  // 4. Validación de firma y contenido de token
  const user = verifyAuthToken(token)
  if (!user) {
    const error = 'No autorizado: Token inválido o expirado'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  // 5. Exigir rol 'admin' obligatorio
  const userRole = (user.role || user.user_role || '').toLowerCase()
  if (userRole !== 'admin') {
    const error = 'Acceso denegado: Se requiere rol de administrador'
    return {
      authorized: false,
      error,
      status: 403,
      response: NextResponse.json({ error }, { status: 403 })
    }
  }

  return { authorized: true, user }
}

export type DeliveryReconciliationPermission =
  | 'read'
  | 'sync'
  | 'dispute_review'
  | 'manage_mappings'
  | 'publish_journal'

export interface DeliveryReconciliationAuthUser {
  id: string
  email: string
  name: string
  role: string
  storeId: number | null
  store_id: number | null
  storeScope: string | null
  canAccessAllStores: boolean
}

export interface DeliveryReconciliationAuthResult {
  authorized: boolean
  status: number
  code?: string
  error?: string
  isCron?: boolean
  isGlobalScope?: boolean
  user?: DeliveryReconciliationAuthUser
}

export function signDeliveryReconciliationTestJwt(
  payload: Record<string, any>,
  options?: { secretOverride?: string; expiresIn?: string | number }
): string {
  const secret = options?.secretOverride || getJwtSecret()
  if (!secret) throw new Error('JWT_SECRET not configured')
  const signOpts: jwt.SignOptions = { algorithm: 'HS256' }
  if (options?.expiresIn !== undefined) {
    signOpts.expiresIn = options.expiresIn as any
  }
  return jwt.sign(payload, secret, signOpts)
}

const DELIVERY_RECONCILIATION_ROLE_MATRIX: Record<DeliveryReconciliationPermission, readonly string[]> = {
  read: [
    'admin',
    'administrador',
    'supervisor',
    'accounting',
    'contador',
    'general_manager',
    'manager',
    'asistente',
    'assistant',
  ],
  sync: [
    'admin',
    'administrador',
    'supervisor',
    'accounting',
    'contador',
    'general_manager',
    'manager',
  ],
  dispute_review: [
    'admin',
    'administrador',
    'supervisor',
    'accounting',
    'contador',
    'general_manager',
    'manager',
  ],
  manage_mappings: [
    'admin',
    'administrador',
    'supervisor',
    'accounting',
    'contador',
  ],
  publish_journal: [
    'admin',
    'administrador',
    'supervisor',
    'accounting',
    'contador',
  ],
}

const GLOBAL_DELIVERY_ROLES = new Set([
  'admin',
  'administrador',
  'supervisor',
  'accounting',
  'contador',
])

/**
 * Guardián estricto de autenticación y autorización de servidor (Fail-Closed) para el módulo
 * Delivery Platform Order Reconciliation y QuickBooks Journal Entries:
 * 1. Valida firma criptográfica HS256 y expiración estricta (`ignoreExpiration: false`) del JWT (`teg_token`).
 * 2. Permite `CRON_SECRET` única y exclusivamente cuando `allowCron === true` (sincronización programada).
 * 3. Consulta en tiempo real `public.users` en Supabase para confirmar que el usuario existe, tiene `is_active = true`
 *    y obtiene su `role` y `store_id` autoritativos desde la base de datos (sin confiar en banderas del cliente).
 * 4. Aplica matriz de permisos por operación (`read`, `sync`, `dispute_review`, `manage_mappings`, `publish_journal`)
 *    y aislamiento por sucursal (`targetStoreIds` / `requireAllStores`).
 */
export async function authorizeDeliveryReconciliationRequest(
  req: Request,
  supabaseClient: any,
  options: {
    permission: DeliveryReconciliationPermission
    allowCron?: boolean
    targetStoreIds?: number[]
    requireAllStores?: boolean
  }
): Promise<DeliveryReconciliationAuthResult> {
  const allowCron = options.allowCron === true
  const cronSecret = getCronSecret()
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const cronHeader = req.headers.get('x-cron-auth') || authHeader || ''

  if (allowCron && cronSecret && cronHeader) {
    const isCronAuthorized =
      safeTimingEqual(cronHeader, `Bearer ${cronSecret}`) ||
      safeTimingEqual(cronHeader, cronSecret)
    if (isCronAuthorized) {
      return {
        authorized: true,
        status: 200,
        code: 'AUTHORIZED_CRON',
        isCron: true,
        isGlobalScope: true,
        user: {
          id: 'cron',
          email: 'cron@tacosgavilan.com',
          name: 'System Cron',
          role: 'admin',
          storeId: null,
          store_id: null,
          storeScope: 'all',
          canAccessAllStores: true,
        },
      }
    }
  }

  const secret = getJwtSecret()
  if (!secret) {
    console.error('❌ [authorizeDeliveryReconciliationRequest] Fail-closed: JWT secret no configurado')
    return {
      authorized: false,
      status: 401,
      code: 'SERVER_CONFIG_ERROR',
      error: 'No autorizado: Configuración de seguridad del servidor no disponible.',
    }
  }

  const candidateTokens: string[] = []
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim()
    if (bearer && bearer !== 'null' && bearer !== 'undefined') {
      candidateTokens.push(bearer)
    }
  }

  try {
    const cookieStore = await cookies()
    const cookieVal = cookieStore.get('teg_token')?.value?.trim()
    if (cookieVal && !candidateTokens.includes(cookieVal)) {
      candidateTokens.push(cookieVal)
    }
  } catch {
    // Contextos fuera de Next.js request store (ej. pruebas automatizadas) usan headers directamente
  }

  const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie') || ''
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)teg_token=([^;]+)/)
  if (cookieMatch?.[1]) {
    const headerCookieVal = safeDecodeCookie(cookieMatch[1].trim())
    if (headerCookieVal && !candidateTokens.includes(headerCookieVal)) {
      candidateTokens.push(headerCookieVal)
    }
  }

  if (candidateTokens.length === 0) {
    return {
      authorized: false,
      status: 401,
      code: 'MISSING_AUTH_TOKEN',
      error: 'No autenticado: Se requiere sesión activa (token de autenticación no proporcionado).',
    }
  }

  let verifiedPayload: any = null
  let hadExpiredToken = false
  for (const candidate of candidateTokens) {
    try {
      const decoded = jwt.verify(candidate, secret, {
        algorithms: ['HS256'],
        ignoreExpiration: false,
      }) as any
      const uid = decoded?.sub ?? decoded?.id
      if (decoded && uid && decoded.email) {
        verifiedPayload = decoded
        break
      }
    } catch (err: any) {
      if (err?.name === 'TokenExpiredError') {
        hadExpiredToken = true
      }
    }
  }

  if (!verifiedPayload) {
    return {
      authorized: false,
      status: 401,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      error: hadExpiredToken
        ? 'No autenticado: Tu sesión ha expirado. Por favor inicia sesión nuevamente.'
        : 'No autenticado: Token de sesión inválido.',
    }
  }

  const tokenRole = String(
    verifiedPayload.user_role ||
      verifiedPayload.user_metadata?.role ||
      (verifiedPayload.role !== 'authenticated' ? verifiedPayload.role : '') ||
      ''
  )
    .trim()
    .toLowerCase()

  if (verifiedPayload.user_type === 'employee' || tokenRole === 'employee' || tokenRole === 'basecamp') {
    return {
      authorized: false,
      status: 403,
      code: 'ROLE_FORBIDDEN',
      error:
        tokenRole === 'basecamp'
          ? 'Acceso restringido exclusivamente al módulo Basecamp'
          : 'Acceso denegado: Las cuentas de empleado no tienen acceso al módulo de conciliación financiera.',
    }
  }

  // Verificación obligatoria en tiempo real contra public.users en Supabase
  const rawUserId = String(verifiedPayload.sub ?? verifiedPayload.id ?? '').trim()
  const rawEmail = String(verifiedPayload.email || '').trim().toLowerCase()
  let dbUser: any = null

  if (supabaseClient) {
    const numericId = Number(rawUserId)
    if (Number.isFinite(numericId) && numericId > 0) {
      const { data } = await supabaseClient
        .from('users')
        .select('id, email, full_name, role, store_id, store_scope, is_active')
        .eq('id', numericId)
        .maybeSingle()
      dbUser = data
    }
    if (!dbUser && rawEmail) {
      const { data } = await supabaseClient
        .from('users')
        .select('id, email, full_name, role, store_id, store_scope, is_active')
        .ilike('email', rawEmail)
        .maybeSingle()
      dbUser = data
    }
  }

  if (!dbUser) {
    return {
      authorized: false,
      status: 401,
      code: 'USER_NOT_FOUND',
      error: 'No autenticado: Usuario no registrado en el padrón administrativo de Tacos Gavilan.',
    }
  }

  if (dbUser.is_active === false) {
    return {
      authorized: false,
      status: 403,
      code: 'USER_INACTIVE',
      error: 'Acceso denegado: Usuario inactivo en el padrón administrativo de Tacos Gavilan.',
    }
  }

  const authoritativeRole = String(dbUser.role || tokenRole || '')
    .trim()
    .toLowerCase()
  const allowedRoles = DELIVERY_RECONCILIATION_ROLE_MATRIX[options.permission] || []

  if (!allowedRoles.includes(authoritativeRole)) {
    return {
      authorized: false,
      status: 403,
      code: 'ROLE_FORBIDDEN',
      error: `Acceso denegado: Tu rol ('${authoritativeRole}') no tiene permiso para ejecutar la operación '${options.permission}'.`,
    }
  }

  const rawDbStoreId = dbUser.store_id !== null && dbUser.store_id !== undefined ? Number(dbUser.store_id) : null
  const assignedStoreId = Number.isFinite(rawDbStoreId) && rawDbStoreId! > 0 ? rawDbStoreId : null
  const storeScopeStr = dbUser.store_scope ? String(dbUser.store_scope).trim().toLowerCase() : null

  const isGlobalScope =
    GLOBAL_DELIVERY_ROLES.has(authoritativeRole) ||
    (authoritativeRole === 'general_manager' && (!assignedStoreId || storeScopeStr === 'all'))

  if (!isGlobalScope) {
    if (!assignedStoreId) {
      return {
        authorized: false,
        status: 403,
        code: 'STORE_FORBIDDEN',
        error: 'Acceso denegado: Tu cuenta no tiene una sucursal asignada para operar.',
      }
    }

    if (options.requireAllStores) {
      return {
        authorized: false,
        status: 403,
        code: 'STORE_FORBIDDEN',
        error: `Acceso denegado: Tu rol ('${authoritativeRole}') está restringido a la sucursal #${assignedStoreId} y no puede operar sobre todas las sucursales.`,
      }
    }

    if (Array.isArray(options.targetStoreIds) && options.targetStoreIds.length > 0) {
      const unauthorizedStore = options.targetStoreIds.find((sid) => Number(sid) !== assignedStoreId)
      if (unauthorizedStore !== undefined) {
        return {
          authorized: false,
          status: 403,
          code: 'STORE_FORBIDDEN',
          error: `Acceso denegado: No tienes autorización para operar sobre la sucursal #${unauthorizedStore} (tu sucursal asignada es #${assignedStoreId}).`,
        }
      }
    }
  }

  return {
    authorized: true,
    status: 200,
    code: 'AUTHORIZED',
    isCron: false,
    isGlobalScope,
    user: {
      id: String(dbUser.id),
      email: String(dbUser.email || rawEmail),
      name: String(dbUser.full_name || dbUser.email || rawEmail),
      role: authoritativeRole,
      storeId: assignedStoreId,
      store_id: assignedStoreId,
      storeScope: storeScopeStr,
      canAccessAllStores: isGlobalScope,
    },
  }
}

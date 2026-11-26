/**
 * @module lib/order-ready-access
 * @description Control de acceso por tienda del Order Ready Board. Decide qué tiendas puede ver/operar cada usuario.
 *
 * @businessRules
 * - **admin**: ve TODAS las tiendas.
 * - **supervisor**: solo las tiendas de su alcance. Su `users.store_scope` guarda NOMBRES ("Tacos Gavilan Bell"),
 *   por eso se normalizan y se comparan contra `stores.code` y `stores.name`. También cuenta `stores.supervisor_id = user.id`.
 * - **manager / asistente / otros con tienda**: SOLO su `users.store_id` (más `store_scope` si trae códigos, ej. ["RIALTO"]).
 * - Sin tienda asignada y sin ser admin: sin acceso (lista vacía).
 *
 * @dataFlow
 * - JWT (cookie `teg_token`) -> getServerUser() -> id/role -> consulta `users` y `stores` en Supabase (la DB manda, no el token)
 *   -> { all, codes } -> usado por /api/order-ready/my-stores y por las rutas /api/order-ready/orders (GET/POST/PATCH).
 *
 * @notes
 * - Cache en memoria 180 s (3 min) por usuario + caché dedicada de 15 min para tiendas activas (`id, code, name, supervisor_id, is_active`) con deduplicación in-flight: evita golpear `stores` y `users` en cada ciclo de polling sin comprometer el aislamiento por sucursal.
 * - Los nombres se normalizan sin tildes/mayúsculas/prefijo "Tacos Gavilan" para tolerar variantes.
 * - Fix 2026-11-24: `getOrderReadyAccess` prioriza `Authorization: Bearer` sobre la cookie `teg_token` e itera todos los tokens candidatos descartando sesiones `employee` (`/mis-horarios`), evitando que el inicio de sesión de un empleado en otra pestaña de la PC de sucursal bloquee la bocina o la tableta.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, getJwtSecret } from '@/lib/auth-server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'

export interface OrderReadyAccess {
  all: boolean
  codes: string[]
}

interface CachedOrderReadyStore {
  id: string | number
  code: string
  name: string
  supervisor_id: string | number | null
  is_active: boolean | null
}

const CACHE_TTL_MS = 180_000 // 3 minutos
const STORES_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutos
const cache = new Map<string, { at: number; value: OrderReadyAccess }>()
let activeStoresCache: { at: number; rows: CachedOrderReadyStore[] } | null = null
let activeStoresInflight: Promise<CachedOrderReadyStore[]> | null = null

export function clearOrderReadyStoresCache(): void {
  activeStoresCache = null
}

async function getCachedActiveStores(): Promise<CachedOrderReadyStore[]> {
  const now = Date.now()
  if (activeStoresCache && now - activeStoresCache.at < STORES_CACHE_TTL_MS) {
    return activeStoresCache.rows
  }
  if (activeStoresInflight) {
    return activeStoresInflight
  }

  activeStoresInflight = (async () => {
    const { data: stores, error } = await supabaseAdmin
      .from('stores')
      .select('id, code, name, supervisor_id, is_active')
    if (error) {
      return activeStoresCache ? activeStoresCache.rows : []
    }
    const active = ((stores || []) as CachedOrderReadyStore[]).filter(
      (s) => s.is_active !== false
    )
    activeStoresCache = { at: Date.now(), rows: active }
    return active
  })().finally(() => {
    activeStoresInflight = null
  })

  return activeStoresInflight
}

function normalize(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/tacos\s*gavilan/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Calcula las tiendas permitidas leyendo la base de datos (no confía en datos del token). */
export async function resolveOrderReadyAccess(userId: string | number, tokenRole?: string): Promise<OrderReadyAccess> {
  const key = String(userId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const { data: u, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, role, store_id, store_scope, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (userErr) {
    return { all: false, codes: [] }
  }

  let value: OrderReadyAccess = { all: false, codes: [] }
  const role = String(u?.role || tokenRole || '').toLowerCase()

  if (u && u.is_active !== false) {
    if (role === 'admin') {
      value = { all: true, codes: [] }
    } else {
      const active = await getCachedActiveStores()
      const codes = new Set<string>()

      const scope: string[] = Array.isArray(u.store_scope) ? u.store_scope : []
      const scopeNorm = new Set(scope.map(normalize).filter(Boolean))

      if (role === 'supervisor') {
        for (const s of active) {
          if (String(s.supervisor_id ?? '') === String(u.id)) codes.add(String(s.code).toUpperCase())
          if (scopeNorm.has(normalize(s.code)) || scopeNorm.has(normalize(s.name))) codes.add(String(s.code).toUpperCase())
        }
      } else {
        // manager / asistente / demás: SOLO su tienda asignada
        if (u.store_id !== null && u.store_id !== undefined) {
          const own = active.find((s) => String(s.id) === String(u.store_id))
          if (own) codes.add(String(own.code).toUpperCase())
        }
        if (codes.size === 0) {
          for (const s of active) {
            if (scopeNorm.has(normalize(s.code)) || scopeNorm.has(normalize(s.name))) codes.add(String(s.code).toUpperCase())
          }
        }
      }
      value = { all: false, codes: Array.from(codes) }
      if (codes.size === 0 && active.length === 0) {
        return value
      }
    }
  }

  cache.set(key, { at: Date.now(), value })
  return value
}

export function canAccessStore(access: OrderReadyAccess, storeCode: string): boolean {
  return access.all || access.codes.includes(String(storeCode).toUpperCase())
}

/**
 * Autentica la petición (cookie/Bearer) y devuelve el acceso del usuario.
 * En tabletas de cocina (`/inventory/preparador`) o pantallas TV (`/order-ready-board`) que permanecen
 * encendidas 24/7 por más de 7 días, si `getServerUser` rechaza únicamente por expiración del timestamp `exp`,
 * verifica la firma criptográfica HMAC-SHA256 (`SUPABASE_JWT_SECRET`) y valida en vivo en Supabase (`users.is_active !== false`).
 * `null` = no autenticado (responder 401).
 */
export async function getOrderReadyAccess(req: Request): Promise<OrderReadyAccess | null> {
  const user = await getServerUser(req)
  if (user && String(user.role || '').trim().toLowerCase() !== 'employee') {
    const directAccess = await resolveOrderReadyAccess(user.id, user.role)
    if (directAccess.all || directAccess.codes.length > 0) {
      return directAccess
    }
  }

  try {
    const candidateTokens: string[] = []

    // Prioridad 1: Authorization Bearer explícito de la pestaña activa (inmune a cookies de /mis-horarios en otras pestañas)
    if (req) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const bearer = authHeader.substring(7).trim()
        if (bearer && bearer !== 'null' && bearer !== 'undefined') {
          candidateTokens.push(bearer)
        }
      }
    }

    // Prioridad 2: Cookie del request store de Next.js
    try {
      const cookieStore = await cookies()
      const cookieVal = cookieStore.get('teg_token')?.value?.trim()
      if (cookieVal && !candidateTokens.includes(cookieVal)) {
        candidateTokens.push(cookieVal)
      }
    } catch {
      // Ignorar si cookies() no está disponible
    }

    // Prioridad 3: Header Cookie directo (ej. llamadas simuladas o contextos fuera de App Router store)
    if (req) {
      const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie') || ''
      const match = cookieHeader.match(/(?:^|;\s*)teg_token=([^;]+)/)
      if (match?.[1]) {
        let decodedCookie = match[1].trim()
        try {
          decodedCookie = decodeURIComponent(decodedCookie)
        } catch {}
        if (decodedCookie && !candidateTokens.includes(decodedCookie)) {
          candidateTokens.push(decodedCookie)
        }
      }
    }

    if (candidateTokens.length === 0) return null

    const secret = getJwtSecret()
    if (!secret) return null

    for (const candidate of candidateTokens) {
      try {
        const decoded = jwt.verify(candidate, secret, { algorithms: ['HS256'], ignoreExpiration: true }) as any
        if (!decoded || !decoded.sub) continue
        if (decoded.user_type === 'employee' || String(decoded.user_role || '').toLowerCase() === 'employee') {
          continue
        }
        const access = await resolveOrderReadyAccess(decoded.sub, decoded.user_role)
        if (access.all || access.codes.length > 0) {
          return access
        }
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

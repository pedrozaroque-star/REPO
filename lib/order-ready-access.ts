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
 * - Cache en memoria 60 s por usuario: el tablero consulta cada 4 s y no debe golpear la DB cada vez.
 * - Los nombres se normalizan sin tildes/mayúsculas/prefijo "Tacos Gavilan" para tolerar variantes.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser } from '@/lib/auth-server'

export interface OrderReadyAccess {
  all: boolean
  codes: string[]
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; value: OrderReadyAccess }>()

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

  const { data: u } = await supabaseAdmin
    .from('users')
    .select('id, role, store_id, store_scope, is_active')
    .eq('id', userId)
    .maybeSingle()

  let value: OrderReadyAccess = { all: false, codes: [] }
  const role = String(u?.role || tokenRole || '').toLowerCase()

  if (u && u.is_active !== false) {
    if (role === 'admin') {
      value = { all: true, codes: [] }
    } else {
      const { data: stores } = await supabaseAdmin
        .from('stores')
        .select('id, code, name, supervisor_id, is_active')
      const active = (stores || []).filter((s: any) => s.is_active !== false)
      const codes = new Set<string>()

      const scope: string[] = Array.isArray(u.store_scope) ? u.store_scope : []
      const scopeNorm = new Set(scope.map(normalize).filter(Boolean))

      if (role === 'supervisor') {
        for (const s of active as any[]) {
          if (String(s.supervisor_id ?? '') === String(u.id)) codes.add(String(s.code).toUpperCase())
          if (scopeNorm.has(normalize(s.code)) || scopeNorm.has(normalize(s.name))) codes.add(String(s.code).toUpperCase())
        }
      } else {
        // manager / asistente / demás: SOLO su tienda asignada
        if (u.store_id !== null && u.store_id !== undefined) {
          const own = (active as any[]).find((s) => String(s.id) === String(u.store_id))
          if (own) codes.add(String(own.code).toUpperCase())
        }
        if (codes.size === 0) {
          for (const s of active as any[]) {
            if (scopeNorm.has(normalize(s.code)) || scopeNorm.has(normalize(s.name))) codes.add(String(s.code).toUpperCase())
          }
        }
      }
      value = { all: false, codes: Array.from(codes) }
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
 * `null` = no autenticado (responder 401).
 */
export async function getOrderReadyAccess(req: Request): Promise<OrderReadyAccess | null> {
  const user = await getServerUser(req)
  if (!user) return null
  return resolveOrderReadyAccess(user.id, user.role)
}

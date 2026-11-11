/**
 * @module lib/phone-agent-access
 * @description Guardián de autenticación, control de acceso por rol/sucursal (RBAC) y validaciones
 * anti-bucle / formato E.164 para el módulo Contestadora IA Multi-Sucursal (15 Tiendas) de Tacos Gavilan.
 *
 * @businessRules
 * - **admin / administrador / supervisor**: Acceso global a las 15 sucursales, Base de Conocimiento global,
 *   horarios festivos especiales, configuración telefónica por tienda, simulador y bitácora completa.
 * - **manager / general_manager / asistente / assistant**: Acceso estrictamente aislado a su propia sucursal
 *   asignada (`users.store_id` o `users.store_scope`). Pueden consultar llamadas, atender recados telefónicos
 *   (`phone_callback_requests`) y probar el simulador únicamente de su sucursal; tienen bloqueado modificar
 *   reglas globales, festivos o configuraciones de las otras 14 tiendas.
 * - **Terminales 24/7 (`/order-ready-board`)**: Soporta validación criptográfica HMAC-SHA256 para pantallas
 *   de sucursal encendidas continuamente, verificando siempre en vivo `users.is_active !== false` en Supabase.
 * - **Anti-Bucle Telefónico (Call Forwarding Loop Prevention)**: Ningún `manager_transfer_phone` puede coincidir
 *   con el número fijo/celular público de una sucursal ni con ningún `twilio_phone_number` del sistema, evitando
 *   que `<Dial>` reenvíe la llamada de regreso a Twilio en círculo infinito.
 *
 * @dataFlow
 * - Request (`teg_token` cookie o `Authorization: Bearer`) -> `authorizePhoneModuleRequest` ->
 *   consulta cacheada (30 s) a `public.users` + `public.stores` -> resultado tipado `{ authorized, user, response }`.
 *
 * @notes
 * - Bloquea números internacionales fuera de EE. UU./Canadá (`+1` + 10 dígitos válidos) en `<Dial>` para
 *   impedir fraude telefónico (*Toll Fraud*).
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import { getJwtSecret, getServerUser } from '@/lib/auth-server'

export type PhoneModulePermission =
  | 'read_dashboard'
  | 'read_callbacks'
  | 'resolve_callback'
  | 'simulate'
  | 'manage_global'

export interface PhoneAuthorizedUser {
  id: string
  email: string
  name: string
  role: string
  isGlobalAdmin: boolean
  assignedStoreId: number | null
  allowedStoreIds: number[]
}

export interface PhoneAuthCheckResult {
  authorized: boolean
  status: number
  error?: string
  user?: PhoneAuthorizedUser
  response?: NextResponse
}

interface CachedAccessEntry {
  at: number
  userRow: any
  activeStores: Array<{ id: number; code: string; name: string }>
}

const ACCESS_CACHE_TTL_MS = 30_000
const userAccessCache = new Map<string, CachedAccessEntry>()

function normalizeStoreToken(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/tacos\s*(?:el\s*)?gavilan/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Extrae únicamente dígitos numéricos de una cadena telefónica.
 */
export function extractPhoneDigits(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '')
}

/**
 * Normaliza un número telefónico de EE. UU. a formato estricto E.164 (`+1XXXXXXXXXX`).
 * Devuelve `null` si está vacío y `{ valid: false }` si no es un número válido de 10 dígitos de EE. UU.
 * (previene marcaciones inválidas o fraude internacional en `<Dial>`).
 */
export function normalizeUsPhoneE164(raw: string | null | undefined): {
  valid: boolean
  normalized: string | null
  tenDigits: string | null
  error?: string
} {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) {
    return { valid: true, normalized: null, tenDigits: null }
  }

  // Si empieza con '+' pero no es '+1', rechazar internacional
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) {
    return {
      valid: false,
      normalized: null,
      tenDigits: null,
      error: 'Solo se permiten números telefónicos de EE. UU. (+1 de 10 dígitos).'
    }
  }

  const digits = extractPhoneDigits(trimmed)
  let tenDigits = ''
  if (digits.length === 10) {
    tenDigits = digits
  } else if (digits.length === 11 && digits.startsWith('1')) {
    tenDigits = digits.slice(1)
  } else {
    return {
      valid: false,
      normalized: null,
      tenDigits: null,
      error: 'El número telefónico debe contener exactamente 10 dígitos de EE. UU. (ej. +13235550199).'
    }
  }

  // Validar código de área NXX (primer dígito 2-9)
  if (!/^[2-9]\d{9}$/.test(tenDigits)) {
    return {
      valid: false,
      normalized: null,
      tenDigits: null,
      error: 'Código de área inválido para EE. UU.'
    }
  }

  return {
    valid: true,
    normalized: `+1${tenDigits}`,
    tenDigits
  }
}

/**
 * Verifica que el teléfono de transferencia en vivo del gerente NO coincida con ningún teléfono
 * público de sucursal ni con ningún número de Twilio asignado, evitando un bucle infinito de desvío.
 */
export function validateNoForwardingLoop(
  candidateTransferPhone: string | null | undefined,
  stores: Array<{ id: number; name?: string; phone?: string | null }>,
  configs: Array<{ store_id: number; twilio_phone_number?: string | null }>
): { safe: boolean; conflictDescription?: string } {
  const parsed = normalizeUsPhoneE164(candidateTransferPhone)
  if (!parsed.valid || !parsed.tenDigits) {
    return { safe: parsed.valid, conflictDescription: parsed.error }
  }

  const candidate10 = parsed.tenDigits

  for (const s of stores) {
    const storeDigits = extractPhoneDigits(s.phone)
    const store10 = storeDigits.length === 11 && storeDigits.startsWith('1') ? storeDigits.slice(1) : storeDigits
    if (store10 && store10 === candidate10) {
      return {
        safe: false,
        conflictDescription: `El número coincide con la línea principal de la sucursal ${s.name || `#${s.id}`}, lo que causaría un bucle infinito de llamadas (Call Forwarding Loop). Ingresa el celular directo del gerente.`
      }
    }
  }

  for (const c of configs) {
    const twDigits = extractPhoneDigits(c.twilio_phone_number)
    const tw10 = twDigits.length === 11 && twDigits.startsWith('1') ? twDigits.slice(1) : twDigits
    if (tw10 && tw10 === candidate10) {
      return {
        safe: false,
        conflictDescription: `El número coincide con el número Twilio de la sucursal #${c.store_id}, lo que causaría un bucle infinito de llamadas.`
      }
    }
  }

  return { safe: true }
}

const GLOBAL_ADMIN_ROLES = new Set(['admin', 'administrador', 'supervisor'])
const STORE_SCOPED_ROLES = new Set(['manager', 'general_manager', 'asistente', 'assistant'])

async function loadUserAndStores(userId: string | number, fallbackEmail?: string) {
  const cacheKey = `${userId}:${fallbackEmail || ''}`
  const hit = userAccessCache.get(cacheKey)
  if (hit && Date.now() - hit.at < ACCESS_CACHE_TTL_MS) {
    return hit
  }

  const numericId = Number(userId)
  let userRow: any = null
  if (Number.isFinite(numericId) && numericId > 0) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, store_id, store_scope, is_active')
      .eq('id', numericId)
      .maybeSingle()
    userRow = data
  }

  if (!userRow && fallbackEmail) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, store_id, store_scope, is_active')
      .ilike('email', fallbackEmail.trim())
      .maybeSingle()
    userRow = data
  }

  const { data: storesData } = await supabaseAdmin
    .from('stores')
    .select('id, code, name, is_active')
    .order('id', { ascending: true })

  const activeStores = (storesData || [])
    .filter((s: any) => s.is_active !== false)
    .map((s: any) => ({
      id: Number(s.id),
      code: String(s.code || ''),
      name: String(s.name || '')
    }))

  const entry: CachedAccessEntry = {
    at: Date.now(),
    userRow,
    activeStores
  }
  userAccessCache.set(cacheKey, entry)
  return entry
}

/**
 * Autentica y autoriza una solicitud HTTP hacia los endpoints administrativos de la Contestadora IA.
 */
export async function authorizePhoneModuleRequest(
  request: Request,
  options: {
    permission: PhoneModulePermission
    targetStoreId?: number | null
    allowLongLivedStoreTerminal?: boolean
  }
): Promise<PhoneAuthCheckResult> {
  let tokenUser: { id: string | number; email?: string; role?: string; user_type?: string } | null = null

  const serverUser = await getServerUser(request)
  if (serverUser) {
    tokenUser = {
      id: serverUser.id,
      email: serverUser.email,
      role: serverUser.role
    }
  } else if (options.allowLongLivedStoreTerminal) {
    // Soporte para pantallas `/order-ready-board` encendidas 24/7 con verificación criptográfica y chequeo `is_active` en vivo
    try {
      let rawToken: string | undefined
      try {
        const cookieStore = await cookies()
        rawToken = cookieStore.get('teg_token')?.value?.trim()
      } catch {
        // Fuera de contexto de cookies() de Next
      }
      if (!rawToken) {
        const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
        if (authHeader.startsWith('Bearer ')) {
          const candidate = authHeader.slice(7).trim()
          if (candidate && candidate !== 'null' && candidate !== 'undefined') {
            rawToken = candidate
          }
        }
      }
      if (!rawToken) {
        const cookieHeader = request.headers.get('cookie') || request.headers.get('Cookie') || ''
        const m = cookieHeader.match(/(?:^|;\s*)teg_token=([^;]+)/)
        if (m?.[1]) rawToken = decodeURIComponent(m[1].trim())
      }

      const secret = getJwtSecret()
      if (rawToken && secret) {
        const decoded = jwt.verify(rawToken, secret, {
          algorithms: ['HS256'],
          ignoreExpiration: true
        }) as any
        const sub = decoded?.sub ?? decoded?.id
        if (decoded && sub && decoded.user_type !== 'employee') {
          tokenUser = {
            id: String(sub),
            email: decoded.email,
            role: decoded.user_role || decoded.role,
            user_type: decoded.user_type
          }
        }
      }
    } catch {
      tokenUser = null
    }
  }

  if (!tokenUser) {
    const error = 'No autenticado: Inicia sesión para acceder al módulo de Contestadora IA.'
    return {
      authorized: false,
      status: 401,
      error,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  const { userRow, activeStores } = await loadUserAndStores(tokenUser.id, tokenUser.email)
  if (!userRow || userRow.is_active === false) {
    const error = 'Acceso denegado: Usuario inactivo o no registrado en el padrón administrativo.'
    return {
      authorized: false,
      status: 403,
      error,
      response: NextResponse.json({ error }, { status: 403 })
    }
  }

  const role = String(userRow.role || tokenUser.role || '')
    .trim()
    .toLowerCase()

  const isGlobalAdmin = GLOBAL_ADMIN_ROLES.has(role)
  const isStoreScoped = STORE_SCOPED_ROLES.has(role)

  if (!isGlobalAdmin && !isStoreScoped) {
    const error = `Acceso denegado: El rol '${role}' no tiene autorización en el módulo de Contestadora IA.`
    return {
      authorized: false,
      status: 403,
      error,
      response: NextResponse.json({ error }, { status: 403 })
    }
  }

  // `manager`, `general_manager`, `asistente` y `assistant` acceden a `read_dashboard`, `read_callbacks`,
  // `resolve_callback` y `simulate` únicamente acotados a su propia sucursal (`allowedStoreIds`);
  // solo `manage_global` está reservado exclusivamente para Admin y Supervisor.
  if (options.permission === 'manage_global' && !isGlobalAdmin) {
    const error = 'Acceso denegado: Solo Administradores y Supervisores pueden modificar reglas globales, días festivos o configuración de sucursales.'
    return {
      authorized: false,
      status: 403,
      error,
      response: NextResponse.json({ error }, { status: 403 })
    }
  }

  let allowedStoreIds: number[] = []
  let assignedStoreId: number | null =
    userRow.store_id !== null && userRow.store_id !== undefined && Number.isFinite(Number(userRow.store_id))
      ? Number(userRow.store_id)
      : null

  if (isGlobalAdmin) {
    allowedStoreIds = activeStores.map((s) => s.id)
  } else {
    const allowedSet = new Set<number>()
    if (assignedStoreId && activeStores.some((s) => s.id === assignedStoreId)) {
      allowedSet.add(assignedStoreId)
    }
    if (allowedSet.size === 0 && Array.isArray(userRow.store_scope)) {
      const scopeNorm = new Set(userRow.store_scope.map(normalizeStoreToken).filter(Boolean))
      for (const s of activeStores) {
        if (scopeNorm.has(normalizeStoreToken(s.code)) || scopeNorm.has(normalizeStoreToken(s.name))) {
          allowedSet.add(s.id)
        }
      }
      if (!assignedStoreId && allowedSet.size > 0) {
        assignedStoreId = Array.from(allowedSet)[0]
      }
    }
    allowedStoreIds = Array.from(allowedSet)

    if (allowedStoreIds.length === 0) {
      const error = 'Acceso denegado: Tu cuenta no tiene una sucursal activa asignada.'
      return {
        authorized: false,
        status: 403,
        error,
        response: NextResponse.json({ error }, { status: 403 })
      }
    }
  }

  if (
    options.targetStoreId !== undefined &&
    options.targetStoreId !== null &&
    !isGlobalAdmin &&
    !allowedStoreIds.includes(Number(options.targetStoreId))
  ) {
    const error = `Acceso denegado: Tu cuenta solo tiene autorización sobre la sucursal #${assignedStoreId}.`
    return {
      authorized: false,
      status: 403,
      error,
      response: NextResponse.json({ error }, { status: 403 })
    }
  }

  return {
    authorized: true,
    status: 200,
    user: {
      id: String(userRow.id),
      email: String(userRow.email || tokenUser.email || ''),
      name: String(userRow.full_name || userRow.email || 'Staff'),
      role,
      isGlobalAdmin,
      assignedStoreId,
      allowedStoreIds
    }
  }
}

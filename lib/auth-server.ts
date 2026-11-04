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
 *
 * @dataFlow
 * - Request (Cookie `teg_token` o Header `Authorization`) -> `getServerUser()` -> `jwt.verify()` -> `ServerUser` -> `authorizeStoreScope()`.
 *
 * @notes
 * - Fail-closed: si no hay secreto JWT configurado en el entorno, rechaza peticiones sin permitir bypasses.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

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
 * @returns ServerUser si el token es válido, null de lo contrario.
 */
export async function getServerUser(req?: Request): Promise<ServerUser | null> {
  try {
    const candidateTokens: string[] = []

    if (req) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const bearer = authHeader.substring(7).trim()
        if (bearer) candidateTokens.push(bearer)
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
        const headerCookieVal = decodeURIComponent(match[1].trim())
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
    for (const candidate of candidateTokens) {
      try {
        const verified = jwt.verify(candidate, secret, { algorithms: ['HS256'] }) as any
        if (verified && verified.sub && verified.email) {
          decoded = verified
          break
        }
      } catch (verifyErr: any) {
        if (verifyErr?.name === 'TokenExpiredError') {
          try {
            const verifiedGrace = jwt.verify(candidate, secret, {
              algorithms: ['HS256'],
              ignoreExpiration: true
            }) as any
            if (verifiedGrace && verifiedGrace.sub && verifiedGrace.email && verifiedGrace.user_type !== 'employee') {
              decoded = verifiedGrace
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

    const resolvedRole = (
      decoded.user_role ||
      decoded.user_metadata?.role ||
      (decoded.role !== 'authenticated' ? decoded.role : '') ||
      'user'
    )
      .toString()
      .toLowerCase()

    return {
      id: String(decoded.sub),
      email: String(decoded.email),
      name: decoded.user_metadata?.full_name || decoded.email,
      role: resolvedRole,
      store_id: decoded.user_metadata?.store_id ?? decoded.store_id ?? undefined,
      store_ids: Array.isArray(decoded.user_metadata?.store_ids)
        ? decoded.user_metadata.store_ids
        : undefined,
      store_scope: decoded.user_metadata?.store_scope ?? undefined
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
    'asistente',
    'assistant',
    'shift_leader',
    'shift leader',
    'shiftleader',
  ],
  complete_checklist: [
    'admin',
    'supervisor',
    'manager',
    'asistente',
    'assistant',
    'shift_leader',
    'shift leader',
    'shiftleader',
  ],
  edit_assignments: ['admin', 'supervisor', 'manager', 'asistente', 'assistant'],
  publish_schedule: ['admin', 'supervisor', 'manager', 'asistente', 'assistant'],
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
      const isNum = /^\d+$/.test(cleanTarget)
      const q = supabaseClient.from('stores').select('id, external_id')
      const { data: st } = isNum
        ? await q.eq('id', Number(cleanTarget)).maybeSingle()
        : await q.eq('external_id', cleanTarget).maybeSingle()
      if (st) {
        resolvedStoreId = st.id
        resolvedStoreGuid = st.external_id
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
    role === 'asistente' ||
    role === 'assistant'
  const isShiftLeader =
    role === 'shift_leader' ||
    role === 'shift leader' ||
    role === 'shiftleader'
  const isEmployee = role === 'employee'

  const canPerformAction =
    effectiveAction === 'complete_checklist'
      ? isStoreLeadership || isShiftLeader
      : options?.requireWrite || effectiveAction === 'edit_assignments' || effectiveAction === 'publish_schedule'
        ? isStoreLeadership
        : effectiveAction === 'manage_catalog'
          ? false
          : isStoreLeadership || isShiftLeader || (isEmployee && Boolean(options?.allowEmployeeRead))

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
      const { data: st } = await supabaseClient
        .from('stores')
        .select('id, external_id')
        .in('external_id', empStores)
      const matched = (st || []).find(
        (row: any) => String(row.id) === cleanTarget || String(row.external_id) === cleanTarget
      )
      if (matched) {
        return {
          authorized: true,
          status: 200,
          user,
          isGlobalRole: false,
          resolvedStoreId: matched.id,
          resolvedStoreGuid: matched.external_id,
          canonicalNumericId: matched.id,
          canonicalExternalId: matched.external_id
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
    const isNumericUserStore = /^\d+$/.test(userStoreRaw)
    const query = supabaseClient.from('stores').select('id, external_id')
    const { data: storeRow } = isNumericUserStore
      ? await query.eq('id', Number(userStoreRaw)).maybeSingle()
      : await query.eq('external_id', userStoreRaw).maybeSingle()

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
        resolvedStoreGuid: storeRow.external_id,
        canonicalNumericId: storeRow.id,
        canonicalExternalId: storeRow.external_id
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
        if (verifiedGrace && verifiedGrace.user_type !== 'employee') {
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

    const resolvedRole = (
      decoded.user_role ||
      (decoded.role && decoded.role !== 'authenticated' ? decoded.role : '') ||
      decoded.user_metadata?.role ||
      'user'
    )
      .toString()
      .toLowerCase()

    decoded.id = String(userId)
    decoded.sub = String(userId)
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
 */
export function verifyStaffAuth(
  request: Request,
  options?: { allowedRoles?: string[]; allowCron?: boolean; allowEmployee?: boolean }
): AdminAuthResult {
  const allowCron = options?.allowCron ?? true
  const cronSecret = getCronSecret()

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  const cookieHeader = request.headers.get('cookie') || request.headers.get('Cookie') || ''
  const cronHeader = request.headers.get('x-cron-auth') || authHeader

  if (allowCron && cronSecret) {
    const isCronAuthorized = cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
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
      token = decodeURIComponent(cookieMatch[1].trim())
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

  const userRole = (user.role || user.user_role || '').toLowerCase()
  if (!options?.allowEmployee && (user.user_type === 'employee' || userRole === 'employee')) {
    const error = 'No autorizado: Credenciales de empleado no tienen acceso a este recurso administrativo'
    return {
      authorized: false,
      error,
      status: 401,
      response: NextResponse.json({ error }, { status: 401 })
    }
  }

  if (options?.allowedRoles && options.allowedRoles.length > 0) {
    const normalizedAllowed = options.allowedRoles.map(r => r.toLowerCase())
    if (userRole !== 'admin' && userRole !== 'administrador' && !normalizedAllowed.includes(userRole)) {
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
  const cookieHeader = request.headers.get('cookie') || ''
  const cronHeader = request.headers.get('x-cron-auth') || authHeader

  // 1. Invocación de cron: SOLO si está permitida Y el secreto está explícitamente configurado
  if (allowCron && cronSecret) {
    const isCronAuthorized = cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
    if (isCronAuthorized) {
      return { authorized: true }
    }
  }

  // 2. Extracción de token de usuario
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : (cookieHeader.match(/teg_token=([^;]+)/)?.[1]?.trim() || null)

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
  const cronHeader = req.headers.get('x-cron-auth') || authHeader

  if (allowCron && cronSecret) {
    const isCronAuthorized = cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
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
    const headerCookieVal = decodeURIComponent(cookieMatch[1].trim())
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

  if (verifiedPayload.user_type === 'employee' || tokenRole === 'employee') {
    return {
      authorized: false,
      status: 403,
      code: 'ROLE_FORBIDDEN',
      error: 'Acceso denegado: Las cuentas de empleado no tienen acceso al módulo de conciliación financiera.',
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

/**
 * @module lib/viele-auth
 * @description Módulo de autorización y control de acceso basado en roles (RBAC) para la API de Viele & Sons.
 *              Valida el JWT del usuario (teg_token), restringe el acceso según roles de negocio
 *              (admin, supervisor, manager, asistente) y aísla el alcance por sucursal (store scoping).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Admin: Acceso ilimitado a todas las 15 sucursales activas.
 * - Supervisor: Acceso restringido exclusivamente a las sucursales definidas en su `store_scope`.
 * - Manager / Asistente: Acceso restringido exclusivamente a su propia sucursal (`store_id`).
 * - Cron jobs: Autorizados únicamente con `CRON_SECRET` configurado en `x-cron-auth` o `Authorization`.
 * - Fail-Closed: Sin secreto JWT configurado o sin token válido, se rechaza inmediatamente la petición (401/403/500).
 *
 * @dataFlow
 * - Request (Cookie 'teg_token' o Header 'Authorization') -> verifyVieleAuth() -> DecodedToken -> Verificación RBAC y Store ID.
 *
 * @notes
 * - [2026-09-21] Implementado para resolver el hallazgo #2 de la auditoría de seguridad Viele & Sons.
 */

import 'server-only';
import { getJwtSecret, getCronSecret, verifyAuthToken, DecodedToken } from './auth-server';
import { VIELE_PUBLIC_STORES, matchStoreIdWithScope } from './viele-stores-public';

export type VieleUserRole = 'admin' | 'supervisor' | 'manager' | 'asistente';

export interface VieleAuthResult {
  authorized: boolean;
  user?: DecodedToken;
  role?: VieleUserRole;
  isCron?: boolean;
  userStoreId?: number | null;
  allowedStoreIds?: number[];
  error?: string;
  status?: number;
}

export interface VerifyVieleAuthOptions {
  requiredStoreId?: number;
  allowCron?: boolean;
}

/**
 * Valida la autenticación y autorización de una petición para endpoints de Viele & Sons.
 * 
 * @param request Objeto Request HTTP entrante
 * @param options Opciones de validación (requiredStoreId para validar sucursal, allowCron para cron jobs)
 */
export function verifyVieleAuth(
  request: Request,
  options?: VerifyVieleAuthOptions
): VieleAuthResult {
  const allowCron = options?.allowCron ?? false;
  const cronSecret = getCronSecret();

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const cookieHeader = request.headers.get('cookie') || '';
  const cronHeader = request.headers.get('x-cron-auth') || authHeader;

  // 1. Verificación de Cron si está permitido y configurado
  if (allowCron && cronSecret) {
    const isCronAuthorized = cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret;
    if (isCronAuthorized) {
      return {
        authorized: true,
        isCron: true,
        role: 'admin',
        allowedStoreIds: Object.keys(VIELE_PUBLIC_STORES).map(Number)
      };
    }
  }

  // 2. Extracción de token de autenticación del usuario
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : (cookieHeader.match(/teg_token=([^;]+)/)?.[1]?.trim() || null);

  if (!token) {
    return {
      authorized: false,
      error: 'No autorizado: Token de autenticación no proporcionado',
      status: 401
    };
  }

  // 3. Fail-closed si falta secreto de JWT
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    console.error('❌ [verifyVieleAuth] Fail-closed: JWT_SECRET / SUPABASE_JWT_SECRET no configurado');
    return {
      authorized: false,
      error: 'No autorizado: Configuración de seguridad del servidor no disponible',
      status: 401
    };
  }

  // 4. Verificación criptográfica del token JWT
  const user = verifyAuthToken(token);
  if (!user) {
    return {
      authorized: false,
      error: 'No autorizado: Token inválido o expirado',
      status: 401
    };
  }

  // 5. Extracción y validación de rol
  const rawRole = (user.user_role || (user as any).role || user.user_metadata?.role || '').toLowerCase();
  const validRoles: VieleUserRole[] = ['admin', 'supervisor', 'manager', 'asistente'];
  
  // Normalizar variaciones de roles en español
  let role: VieleUserRole | null = null;
  if (rawRole === 'admin' || rawRole === 'administrador') role = 'admin';
  else if (rawRole === 'supervisor') role = 'supervisor';
  else if (rawRole === 'manager' || rawRole === 'gerente') role = 'manager';
  else if (rawRole === 'asistente' || rawRole === 'assistant') role = 'asistente';

  if (!role || !validRoles.includes(role)) {
    return {
      authorized: false,
      error: 'Acceso denegado: Rol no autorizado para operaciones de Viele & Sons',
      status: 403
    };
  }

  const allStoreIds = Object.keys(VIELE_PUBLIC_STORES).map(Number);
  const metadata = user.user_metadata || {};
  const userStoreId = metadata.store_id ?? (user as any).store_id ?? null;
  const storeScope = metadata.store_scope ?? (user as any).store_scope ?? null;

  // 6. Validación de alcance de tiendas (Store Scoping)
  let allowedStoreIds: number[] = [];

  if (role === 'admin') {
    allowedStoreIds = allStoreIds;
  } else if (role === 'supervisor') {
    allowedStoreIds = allStoreIds.filter(sid => matchStoreIdWithScope(sid, storeScope));
  } else {
    // Manager o Asistente
    if (userStoreId) {
      allowedStoreIds = [Number(userStoreId)];
    } else if (storeScope) {
      allowedStoreIds = allStoreIds.filter(sid => matchStoreIdWithScope(sid, storeScope));
    }
  }

  // 7. Si se requiere una sucursal específica, validar que el usuario tenga permiso sobre ella
  if (options?.requiredStoreId) {
    const reqSid = Number(options.requiredStoreId);
    if (!allowedStoreIds.includes(reqSid)) {
      return {
        authorized: false,
        error: `Acceso denegado: No tienes autorización para operar la sucursal #${reqSid} (${VIELE_PUBLIC_STORES[reqSid]?.storeName || 'Desconocida'})`,
        status: 403
      };
    }
  }

  return {
    authorized: true,
    user,
    role,
    userStoreId: userStoreId ? Number(userStoreId) : null,
    allowedStoreIds
  };
}

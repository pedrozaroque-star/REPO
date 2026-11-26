/**
 * @module UpdateUserRoute
 * @description API route para actualizar perfiles de usuario en `public.users` con control estricto de privilegios.
 * @businessRules
 * - Exige sesión autenticada de personal vía `verifyStaffAuth` (`allowCron: false`).
 * - Consulta en `public.users` tanto al usuario invocador como al usuario objetivo antes de mutar.
 * - Un `supervisor` NO puede editar cuentas con rol `admin` o `supervisor`, ni asignar rol `admin` o `supervisor` (`HTTP 403`).
 * - Usuarios auto-editándose (no-admin) están restringidos a una lista blanca estricta (`full_name`, `phone`, `avatar_url`, desconexión propia de Gmail `google_email_connected: null, google_refresh_token: null`, y cambio de contraseña propia con `currentPassword` verificado).
 * - Toda contraseña nueva se almacena cifrada con `bcrypt.hash(password, 12)` en `public.users` y se sincroniza con Supabase Auth.
 * - Cuando el usuario actualizado está activo y tiene rol elegible (`admin`, `supervisor`, `manager`, `asistente`, `basecamp`), asegura su registro no destructivo en `bc_people` vía `resolveOrCreateTegPerson`.
 * @dataFlow
 * - Request (`userId`, `userData`) -> `verifyStaffAuth` + verificación DB -> Whitelist + `bcrypt.hash` -> `supabaseAdmin.from('users').update()` -> Invalidate Auth Cache -> Response.
 * @notes
 * - Hardened 2026-11-21: Bloqueada escalación `supervisor -> admin`, aplicada whitelist explícita en auto-edición y cifrado `bcrypt` (cost 12).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import {
    invalidateActiveUserStatusCache,
    safeTimingEqual,
    verifyStaffAuth,
} from '@/lib/auth-server'
import { canonicalizeBasecampEmail, resolveOrCreateTegPerson } from '@/lib/basecamp-person-resolver'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$/

const ALLOWED_ROLES_SET = new Set([
    'admin',
    'supervisor',
    'general_manager',
    'manager',
    'gerente',
    'asistente',
    'assistant',
    'shift_leader',
    'planificador',
    'basecamp',
    'accounting',
    'contador',
    'auditor',
])

const BASECAMP_SYNC_ROLES = new Set([
    'admin',
    'administrador',
    'supervisor',
    'general_manager',
    'manager',
    'gerente',
    'asistente',
    'assistant',
    'basecamp',
])

const SINGLE_STORE_STAFF_ROLES = new Set([
    'manager',
    'asistente',
    'general_manager',
    'gerente',
    'assistant',
    'shift_leader',
])

function extractDeactivateIds(body: any, userData: any, excludeId?: number | null): number[] {
    const rawList: unknown[] = []
    if (Array.isArray(body?.deactivateUserIds)) rawList.push(...body.deactivateUserIds)
    if (Array.isArray(userData?.deactivateUserIds)) rawList.push(...userData.deactivateUserIds)
    if (body?.deactivateCurrentId !== undefined && body?.deactivateCurrentId !== null) {
        rawList.push(body.deactivateCurrentId)
    }
    if (userData?.deactivateCurrentId !== undefined && userData?.deactivateCurrentId !== null) {
        rawList.push(userData.deactivateCurrentId)
    }
    const ids = new Set<number>()
    for (const item of rawList) {
        const n = Number(item)
        if (Number.isFinite(n) && n > 0 && n !== Number(excludeId)) {
            ids.add(n)
        }
    }
    return Array.from(ids)
}

export async function POST(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowCron: false })
    if (!auth.authorized || !auth.user) return auth.response!

    if (!supabaseServiceKey || supabaseServiceKey === 'placeholder') {
        console.error('⚠️ SUPABASE_SERVICE_ROLE_KEY no está configurado')
        return NextResponse.json({ success: false, error: 'Configuración de seguridad del servidor no disponible' }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    })

    try {
        const body = await request.json()
        const { userId, userData } = body || {}

        if (!userId || !userData || typeof userData !== 'object') {
            return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
        }

        const targetIdNum = Number(userId)
        if (!Number.isFinite(targetIdNum) || targetIdNum <= 0) {
            return NextResponse.json({ success: false, error: 'Identificador de usuario inválido' }, { status: 400 })
        }

        // 1. Obtener usuario objetivo en public.users
        const { data: targetUser, error: targetErr } = await supabaseAdmin
            .from('users')
            .select('id, email, role, password, auth_id, is_active, toast_guid, phone, store_id, store_scope, position_type')
            .eq('id', targetIdNum)
            .maybeSingle()

        if (targetErr || !targetUser) {
            return NextResponse.json({ success: false, error: 'Usuario objetivo no encontrado' }, { status: 404 })
        }

        // 2. Resolver rol autoritativo del invocador desde public.users
        let callerRole = String(auth.user.role || '').trim().toLowerCase()
        let callerDbId: number | null = null
        const callerIdNum = Number(auth.user.id)
        if (Number.isFinite(callerIdNum) && callerIdNum > 0) {
            const { data: callerDb } = await supabaseAdmin
                .from('users')
                .select('id, role, is_active')
                .eq('id', callerIdNum)
                .maybeSingle()
            if (!callerDb || callerDb.is_active === false) {
                return NextResponse.json({ success: false, error: 'Cuenta invocadora inactiva o no autorizada' }, { status: 403 })
            }
            callerRole = String(callerDb.role || callerRole).trim().toLowerCase()
            callerDbId = Number(callerDb.id)
        }

        const isAdmin = callerRole === 'admin' || callerRole === 'administrador'
        const isSupervisor = callerRole === 'supervisor'
        const isSelf =
            String(auth.user.id) === String(targetUser.id) ||
            (callerDbId !== null && callerDbId === Number(targetUser.id))

        if (!isAdmin && !isSupervisor && !isSelf) {
            return NextResponse.json(
                { success: false, error: 'Forbidden: No autorizado para modificar otro usuario' },
                { status: 403 }
            )
        }

        const currentTargetRole = String(targetUser.role || '').trim().toLowerCase()
        const requestedRole =
            userData.role !== undefined && userData.role !== null
                ? String(userData.role).trim().toLowerCase()
                : undefined

        // 3. Impedir escalación supervisor -> admin/supervisor
        if (isSupervisor) {
            if (
                !isSelf &&
                (currentTargetRole === 'admin' ||
                    currentTargetRole === 'administrador' ||
                    currentTargetRole === 'supervisor')
            ) {
                return NextResponse.json(
                    { success: false, error: 'Forbidden: Un supervisor no puede modificar cuentas de administrador o supervisor.' },
                    { status: 403 }
                )
            }
            if (
                requestedRole !== undefined &&
                (requestedRole === 'admin' ||
                    requestedRole === 'administrador' ||
                    requestedRole === 'supervisor')
            ) {
                return NextResponse.json(
                    { success: false, error: 'Forbidden: Un supervisor no puede asignar rol de administrador o supervisor.' },
                    { status: 403 }
                )
            }
        }

        const canManagePrivilegedFields = isAdmin || (isSupervisor && !isSelf)
        const sanitizedData: Record<string, unknown> = {}
        let rawPasswordForAuthSync: string | null = null

        if (canManagePrivilegedFields) {
            if (typeof userData.full_name === 'string' && userData.full_name.trim()) {
                sanitizedData.full_name = userData.full_name.trim()
            }
            if (typeof userData.email === 'string' && userData.email.trim()) {
                sanitizedData.email = userData.email.trim().toLowerCase()
            }
            if (userData.phone !== undefined) {
                sanitizedData.phone =
                    typeof userData.phone === 'string' && userData.phone.trim() ? userData.phone.trim() : null
            }
            if (userData.avatar_url !== undefined) {
                sanitizedData.avatar_url = typeof userData.avatar_url === 'string' ? userData.avatar_url.trim() : null
            }
            if (requestedRole !== undefined) {
                if (!ALLOWED_ROLES_SET.has(requestedRole)) {
                    return NextResponse.json({ success: false, error: `Rol inválido: ${requestedRole}` }, { status: 400 })
                }
                sanitizedData.role = requestedRole
            }
            if (userData.store_id !== undefined) {
                sanitizedData.store_id =
                    userData.store_id !== null && userData.store_id !== '' && Number.isFinite(Number(userData.store_id))
                        ? Number(userData.store_id)
                        : null
            }
            if (userData.store_scope !== undefined) {
                sanitizedData.store_scope = Array.isArray(userData.store_scope)
                    ? userData.store_scope.map((s: unknown) => String(s)).filter(Boolean)
                    : null
            }
            if (userData.is_active !== undefined) {
                sanitizedData.is_active = Boolean(userData.is_active)
            }
            if (userData.position_type !== undefined) {
                sanitizedData.position_type =
                    typeof userData.position_type === 'string' && userData.position_type.trim()
                        ? userData.position_type.trim()
                        : null
            }
            if (userData.toast_guid !== undefined) {
                sanitizedData.toast_guid =
                    typeof userData.toast_guid === 'string' && userData.toast_guid.trim()
                        ? userData.toast_guid.trim()
                        : null
            }

            // Auto-poblar teléfono desde toast_employees si phone está vacío y hay toast_guid
            const effectiveToastGuid = (
                sanitizedData.toast_guid !== undefined ? sanitizedData.toast_guid : targetUser.toast_guid
            ) as string | null
            const effectivePhone = (
                sanitizedData.phone !== undefined ? sanitizedData.phone : targetUser.phone
            ) as string | null
            if ((!effectivePhone || !String(effectivePhone).trim()) && effectiveToastGuid) {
                const { data: toastEmp } = await supabaseAdmin
                    .from('toast_employees')
                    .select('phone')
                    .eq('toast_guid', effectiveToastGuid)
                    .maybeSingle()
                if (typeof toastEmp?.phone === 'string' && toastEmp.phone.trim()) {
                    sanitizedData.phone = toastEmp.phone.trim()
                }
            }

            // Sincronizar automáticamente store_scope con [store.code] para roles operativos de una sola sucursal
            const effectiveRole = ((sanitizedData.role as string | undefined) || currentTargetRole).trim().toLowerCase()
            const effectiveStoreId =
                sanitizedData.store_id !== undefined
                    ? (sanitizedData.store_id as number | null)
                    : targetUser.store_id !== null && targetUser.store_id !== undefined && Number.isFinite(Number(targetUser.store_id))
                      ? Number(targetUser.store_id)
                      : null

            if (SINGLE_STORE_STAFF_ROLES.has(effectiveRole)) {
                if (effectiveStoreId && effectiveStoreId > 0) {
                    const { data: storeRow } = await supabaseAdmin
                        .from('stores')
                        .select('code')
                        .eq('id', effectiveStoreId)
                        .maybeSingle()
                    sanitizedData.store_scope =
                        typeof storeRow?.code === 'string' && storeRow.code.trim()
                            ? [storeRow.code.trim()]
                            : null
                } else {
                    sanitizedData.store_scope = null
                }
                if (!sanitizedData.position_type) {
                    sanitizedData.position_type = targetUser.position_type || 'kitchen'
                }
            } else if (effectiveRole === 'planificador' || effectiveRole === 'basecamp') {
                if (userData.store_id !== undefined || requestedRole !== undefined) {
                    sanitizedData.store_id = null
                    sanitizedData.store_scope = null
                }
            }
            // Solo permitir desconexión explícita de Gmail (nunca inyectar refresh_token desde cliente)
            if (
                userData.google_email_connected === false ||
                userData.google_email_connected === null ||
                userData.google_email_connected === ''
            ) {
                sanitizedData.google_email_connected = null
                sanitizedData.google_refresh_token = null
            }

            if (typeof userData.password === 'string' && userData.password.trim() !== '') {
                if (userData.password.trim().length < 6 || userData.password.length > 256) {
                    return NextResponse.json(
                        { success: false, error: 'La contraseña debe tener al menos 6 caracteres' },
                        { status: 400 }
                    )
                }
                rawPasswordForAuthSync = userData.password
                sanitizedData.password = await bcrypt.hash(userData.password, 12)
            }
        } else {
            // Auto-edición de usuario no-admin: rechazar intentos de escalación y aplicar allowlist estricta
            if (
                userData.role !== undefined ||
                userData.store_id !== undefined ||
                userData.store_scope !== undefined ||
                userData.is_active !== undefined ||
                userData.auth_id !== undefined
            ) {
                return NextResponse.json(
                    { success: false, error: 'Forbidden: No puedes modificar campos de privilegio o alcance.' },
                    { status: 403 }
                )
            }

            if (typeof userData.full_name === 'string' && userData.full_name.trim()) {
                sanitizedData.full_name = userData.full_name.trim()
            }
            if (userData.phone !== undefined) {
                sanitizedData.phone = typeof userData.phone === 'string' ? userData.phone.trim() : null
            }
            if (userData.avatar_url !== undefined) {
                sanitizedData.avatar_url = typeof userData.avatar_url === 'string' ? userData.avatar_url.trim() : null
            }
            // Permitir ÚNICAMENTE desconectar su propio Gmail
            if (
                userData.google_email_connected === false ||
                userData.google_email_connected === null ||
                userData.google_email_connected === ''
            ) {
                sanitizedData.google_email_connected = null
                sanitizedData.google_refresh_token = null
            } else if (userData.google_refresh_token !== undefined || userData.google_email_connected !== undefined) {
                return NextResponse.json(
                    { success: false, error: 'Forbidden: La vinculación de Gmail solo puede realizarse mediante el flujo OAuth oficial.' },
                    { status: 403 }
                )
            }

            if (typeof userData.password === 'string' && userData.password.trim() !== '') {
                if (userData.password.trim().length < 6 || userData.password.length > 256) {
                    return NextResponse.json(
                        { success: false, error: 'La contraseña debe tener al menos 6 caracteres' },
                        { status: 400 }
                    )
                }

                const providedCurrent = body?.currentPassword ?? userData?.currentPassword
                if (typeof providedCurrent !== 'string' || providedCurrent.length === 0) {
                    return NextResponse.json(
                        { success: false, error: 'Se requiere verificar la contraseña actual (currentPassword).' },
                        { status: 403 }
                    )
                }

                const storedPw = typeof targetUser.password === 'string' ? targetUser.password : ''
                const currentMatches = storedPw
                    ? BCRYPT_HASH_REGEX.test(storedPw)
                        ? await bcrypt.compare(providedCurrent, storedPw)
                        : safeTimingEqual(providedCurrent, storedPw)
                    : false

                if (!currentMatches) {
                    return NextResponse.json(
                        { success: false, error: 'La contraseña actual es incorrecta.' },
                        { status: 403 }
                    )
                }

                rawPasswordForAuthSync = userData.password
                sanitizedData.password = await bcrypt.hash(userData.password, 12)
            }
        }

        if (Object.keys(sanitizedData).length === 0) {
            return NextResponse.json({ success: false, error: 'No hay campos válidos para actualizar' }, { status: 400 })
        }

        sanitizedData.updated_at = new Date().toISOString()

        const { data, error } = await supabaseAdmin
            .from('users')
            .update(sanitizedData)
            .eq('id', targetUser.id)
            .select('id, email, full_name, role, phone, is_active, store_scope, avatar_url, last_login, created_at, updated_at, auth_id, store_id, google_email_connected, position_type, toast_guid')

        if (error) {
            console.error('❌ Error en API update-user:', error)
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        invalidateActiveUserStatusCache(targetUser.id, targetUser.email)
        if (typeof sanitizedData.email === 'string') {
            invalidateActiveUserStatusCache(targetUser.id, sanitizedData.email)
        }

        // Desactivar usuarios reemplazados/salientes DESPUÉS de que la actualización principal haya sido exitosa
        if (canManagePrivilegedFields) {
            const idsToDeactivate = extractDeactivateIds(body, userData, targetUser.id)
            if (idsToDeactivate.length > 0) {
                const { data: targetsToDeact } = await supabaseAdmin
                    .from('users')
                    .select('id, email, role')
                    .in('id', idsToDeactivate)
                const allowedDeactUsers = (targetsToDeact || []).filter((u: any) => {
                    if (isAdmin) return true
                    const r = String(u.role || '').trim().toLowerCase()
                    return r !== 'admin' && r !== 'administrador' && r !== 'supervisor'
                })
                const allowedIds = allowedDeactUsers.map((u: any) => Number(u.id))
                if (allowedIds.length > 0) {
                    await supabaseAdmin
                        .from('users')
                        .update({ is_active: false, updated_at: new Date().toISOString() })
                        .in('id', allowedIds)
                    for (const u of allowedDeactUsers) {
                        invalidateActiveUserStatusCache(u.id, u.email)
                    }
                }
            }
        }

        // Sincronizar contraseña en texto plano con Supabase Auth (GoTrue aplica su propio hash interno)
        if (rawPasswordForAuthSync && data?.[0]?.auth_id) {
            try {
                await supabaseAdmin.auth.admin.updateUserById(data[0].auth_id, {
                    password: rawPasswordForAuthSync,
                    email_confirm: true,
                })
            } catch (syncErr) {
                console.warn('⚠️ Sync Auth password warning:', syncErr)
            }
        }

        // Sincronizar de forma no destructiva en bc_people si el usuario actualizado está activo y aplica para Basecamp
        const updatedRow = data?.[0]
        const updatedRoleNorm = String(updatedRow?.role || '').trim().toLowerCase()
        if (updatedRow && updatedRow.is_active !== false && BASECAMP_SYNC_ROLES.has(updatedRoleNorm)) {
            try {
                const resolved = await resolveOrCreateTegPerson(supabaseAdmin, {
                    email: updatedRow.email,
                    name: updatedRow.full_name,
                    role: updatedRow.role,
                })
                if (resolved?.id && String(updatedRow.email || '').trim().toLowerCase() !== 'roque@tacosgavilan.com') {
                    const canonEmail = canonicalizeBasecampEmail(updatedRow.email)
                    const bcPatch: Record<string, unknown> = {
                        is_active: true,
                        updated_at: new Date().toISOString(),
                    }
                    if (canonEmail) bcPatch.email = canonEmail
                    if (typeof sanitizedData.full_name === 'string' && sanitizedData.full_name.trim()) {
                        bcPatch.name = sanitizedData.full_name.trim()
                    }
                    await supabaseAdmin.from('bc_people').update(bcPatch).eq('id', resolved.id)
                }
            } catch (bcSyncErr) {
                console.warn('⚠️ [update-user] Non-blocking bc_people upsert warning:', bcSyncErr)
            }
        }

        return NextResponse.json({ success: true, data })
    } catch (err: any) {
        console.error('❌ Error inesperado en update-user:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

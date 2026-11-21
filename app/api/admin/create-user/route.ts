/**
 * @module CreateUserRoute
 * @description API route para registrar un nuevo usuario en Supabase Auth y guardar su perfil en `public.users`.
 * @businessRules
 * - Exige sesión autenticada de `admin` o `supervisor` vía `verifyStaffAuth` (`allowCron: false`).
 * - Bloquea escalación de privilegios: un `supervisor` NO puede crear cuentas con rol `admin` ni `supervisor` (`HTTP 403`).
 * - Aplica lista blanca estricta de columnas de inserción (sin propagar `...otherData` arbitrario).
 * - Almacena siempre la contraseña en `public.users.password` cifrada con `bcrypt` (factor de costo 12).
 * @dataFlow
 * - Request -> `verifyStaffAuth` + verificación de rol en DB -> `supabaseAdmin.auth.admin.createUser` -> `bcrypt.hash(password, 12)` -> Insert `public.users` -> Response (columnas seguras).
 * @notes
 * - Hardened 2026-11-21: Eliminado mass-assignment `...otherData`, añadida barrera anti-escalación `supervisor -> admin/supervisor` y hash `bcrypt` obligatorio.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { invalidateActiveUserStatusCache, verifyStaffAuth } from '@/lib/auth-server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const ALLOWED_TARGET_ROLES = new Set([
    'admin',
    'supervisor',
    'general_manager',
    'manager',
    'gerente',
    'asistente',
    'assistant',
    'shift_leader',
    'planificador',
    'accounting',
    'contador',
    'auditor',
])

export async function POST(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: false })
    if (!auth.authorized || !auth.user) return auth.response!

    if (!supabaseServiceKey || supabaseServiceKey === 'placeholder') {
        console.error('⚠️ SUPABASE_SERVICE_ROLE_KEY no está configurado. La creación de usuarios fallará.')
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
        const rawEmail = body?.email
        const rawPassword = body?.password
        const rawFullName = body?.fullName ?? body?.full_name
        const rawRole = body?.role
        const rawStoreId = body?.storeId ?? body?.store_id
        const otherData = body?.otherData && typeof body.otherData === 'object' ? body.otherData : {}

        if (typeof rawEmail !== 'string' || !rawEmail.trim() || rawEmail.trim().length > 254) {
            return NextResponse.json({ success: false, error: 'Correo electrónico inválido' }, { status: 400 })
        }
        if (typeof rawPassword !== 'string' || rawPassword.trim().length < 6 || rawPassword.length > 256) {
            return NextResponse.json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
        }
        if (typeof rawFullName !== 'string' || !rawFullName.trim()) {
            return NextResponse.json({ success: false, error: 'El nombre completo es obligatorio' }, { status: 400 })
        }

        const normalizedEmail = rawEmail.trim().toLowerCase()
        const fullName = rawFullName.trim()
        const targetRole = String(rawRole || 'auditor').trim().toLowerCase()

        if (!ALLOWED_TARGET_ROLES.has(targetRole)) {
            return NextResponse.json({ success: false, error: `Rol no permitido: ${targetRole}` }, { status: 400 })
        }

        // Consultar rol autoritativo del invocador en public.users
        let callerRole = String(auth.user.role || '').trim().toLowerCase()
        const callerIdNum = Number(auth.user.id)
        if (Number.isFinite(callerIdNum) && callerIdNum > 0) {
            const { data: callerDb } = await supabaseAdmin
                .from('users')
                .select('role, is_active')
                .eq('id', callerIdNum)
                .maybeSingle()
            if (!callerDb || callerDb.is_active === false) {
                return NextResponse.json({ success: false, error: 'Cuenta invocadora inactiva o no autorizada' }, { status: 403 })
            }
            callerRole = String(callerDb.role || callerRole).trim().toLowerCase()
        }

        const isAdmin = callerRole === 'admin' || callerRole === 'administrador'
        if (!isAdmin && callerRole !== 'supervisor') {
            return NextResponse.json({ success: false, error: 'Forbidden: Permisos insuficientes' }, { status: 403 })
        }

        // Impedir escalación de privilegios por parte de un supervisor
        if (!isAdmin && (targetRole === 'admin' || targetRole === 'administrador' || targetRole === 'supervisor')) {
            return NextResponse.json(
                { success: false, error: 'Forbidden: Un supervisor no puede crear cuentas de administrador o supervisor.' },
                { status: 403 }
            )
        }

        // 1. Crear usuario en Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: normalizedEmail,
            password: rawPassword,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
            },
        })

        if (authError) {
            console.error('❌ Error Auth:', authError)
            return NextResponse.json({ success: false, error: 'Error Auth: ' + authError.message }, { status: 400 })
        }

        const newUserId = authData.user?.id
        if (!newUserId) {
            return NextResponse.json({ success: false, error: 'No se obtuvo ID del nuevo usuario' }, { status: 500 })
        }

        // 2. Construir payload con whitelist explícita y hash bcrypt (cost 12)
        const hashedPassword = await bcrypt.hash(rawPassword, 12)

        const rawStoreScope = body?.store_scope ?? otherData.store_scope
        const rawIsActive = body?.is_active ?? otherData.is_active
        const rawPhone = body?.phone ?? otherData.phone
        const rawPositionType = body?.position_type ?? otherData.position_type
        const rawToastGuid = body?.toast_guid ?? otherData.toast_guid

        const parsedStoreId =
            rawStoreId !== null && rawStoreId !== undefined && rawStoreId !== '' && Number.isFinite(Number(rawStoreId))
                ? Number(rawStoreId)
                : null

        const userPayload: Record<string, unknown> = {
            auth_id: newUserId,
            email: normalizedEmail,
            password: hashedPassword,
            full_name: fullName,
            role: targetRole,
            store_id: parsedStoreId,
            store_scope: Array.isArray(rawStoreScope) ? rawStoreScope.map((s: unknown) => String(s)) : null,
            is_active: typeof rawIsActive === 'boolean' ? rawIsActive : true,
            phone: typeof rawPhone === 'string' && rawPhone.trim() ? rawPhone.trim() : null,
        }

        if (typeof rawPositionType === 'string' && rawPositionType.trim()) {
            userPayload.position_type = rawPositionType.trim()
        }
        if (typeof rawToastGuid === 'string' && rawToastGuid.trim()) {
            userPayload.toast_guid = rawToastGuid.trim()
        }

        const { data: insertedUser, error: dbError } = await supabaseAdmin
            .from('users')
            .insert(userPayload)
            .select('id, email, full_name, role, phone, is_active, store_scope, avatar_url, last_login, created_at, updated_at, auth_id, store_id, google_email_connected, position_type, toast_guid')
            .single()

        if (dbError) {
            console.error('❌ Error DB public.users:', dbError)
            await supabaseAdmin.auth.admin.deleteUser(newUserId)
            return NextResponse.json({ success: false, error: 'Error DB: ' + dbError.message }, { status: 500 })
        }

        invalidateActiveUserStatusCache(insertedUser?.id, insertedUser?.email)
        return NextResponse.json({ success: true, data: insertedUser })
    } catch (err: any) {
        console.error('❌ Error inesperado en create-user:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

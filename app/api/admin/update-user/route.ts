/**
 * @module UpdateUserRoute
 * @description API route to update a user profile in the database.
 * @businessRules
 * - Requires authenticated session via verifyStaffAuth.
 * - Admins/Supervisors can update any user; other staff can only update their own non-privilege profile fields.
 * - Executes profile updates in public.users using service role credentials and strips sensitive columns from response.
 * @dataFlow
 * - Request (userId, userData) -> Verify Auth & Role Scope -> Supabase admin.from('users').update() -> Response (success, data)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffAuth } from '@/lib/auth-server'

// Cliente admin con service_role key (solo del lado del servidor)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

if (!supabaseServiceKey) {
    console.error('⚠️ SUPABASE_SERVICE_ROLE_KEY no está configurado')
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
})

export async function POST(request: NextRequest) {
    const auth = await verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) return auth.response!

    try {
        const body = await request.json()
        const { userId, userData } = body

        if (!userId || !userData || typeof userData !== 'object') {
            return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
        }

        const isAdminOrSupervisor = ['admin', 'supervisor'].includes((auth.user.role || '').toLowerCase())
        const isSelf = String(auth.user.id) === String(userId)

        if (!isAdminOrSupervisor && !isSelf) {
            return NextResponse.json({ success: false, error: 'Forbidden: No autorizado para modificar otro usuario' }, { status: 403 })
        }

        // Si no es admin/supervisor, impedir escalación de privilegios
        const sanitizedData = { ...userData }
        if (!isAdminOrSupervisor) {
            delete sanitizedData.role
            delete sanitizedData.store_id
            delete sanitizedData.store_scope
            delete sanitizedData.is_active
            delete sanitizedData.auth_id
        }

        console.log('🔧 API: Actualizando usuario', userId)

        // Actualizar usando el cliente admin (bypasea RLS) y devolver solo columnas seguras
        const { data, error } = await supabaseAdmin
            .from('users')
            .update(sanitizedData)
            .eq('id', userId)
            .select('id, email, full_name, role, phone, is_active, store_scope, avatar_url, last_login, created_at, updated_at, auth_id, store_id, google_email_connected, position_type, toast_guid')

        if (error) {
            console.error('❌ Error en API:', error)
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        // Si se actualizó la contraseña, sincronizar también con Supabase Auth si existe auth_id
        if (sanitizedData.password && typeof sanitizedData.password === 'string' && data?.[0]?.auth_id) {
            try {
                await supabaseAdmin.auth.admin.updateUserById(data[0].auth_id, {
                    password: sanitizedData.password,
                    email_confirm: true
                })
            } catch (syncErr) {
                console.warn('⚠️ Sync Auth password warning:', syncErr)
            }
        }

        return NextResponse.json({ success: true, data })
    } catch (err: any) {
        console.error('❌ Error inesperado:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

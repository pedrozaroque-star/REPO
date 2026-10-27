/**
 * @module ResetPasswordRoute
 * @description API route to update a user's password in Supabase Auth.
 * Supports both UUIDs and database integer IDs as target user IDs.
 * @businessRules
 * - Requires authenticated session via verifyStaffAuth (admin/supervisor or self).
 * - Synchronizes the hashed credential in Supabase Auth to ensure standard login compatibility.
 * @dataFlow
 * - Request (userId/email, password) -> Verify Auth -> Resolve to Auth UUID -> Supabase admin.updateUserById() -> Response (success)
 * @notes Resolves database integer IDs (bigint) to Supabase Auth UUIDs using a lookup in the public.users table.
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'

export async function POST(request: Request) {
    const auth = await verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) return auth.response!

    try {
        const { email, password, userId } = await request.json()

        const isAdminOrSupervisor = ['admin', 'supervisor'].includes((auth.user.role || '').toLowerCase())
        const isSelfById = userId !== undefined && userId !== null && String(auth.user.id) === String(userId)
        const isSelfByEmail = email && auth.user.email && auth.user.email.toLowerCase() === String(email).toLowerCase()

        if (!isAdminOrSupervisor && !isSelfById && !isSelfByEmail) {
            return NextResponse.json({ error: 'Forbidden: Insufficient privileges to reset another user password' }, { status: 403 })
        }

        // Validar Service Key
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !serviceKey) {
            console.log('Skipping Supabase Auth sync: Missing SUPABASE_SERVICE_ROLE_KEY')
            return NextResponse.json(
                { success: false, message: 'Sync skipped (missing keys)', skipped: true },
                { status: 200 }
            )
        }

        // Crear cliente Admin
        const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        let targetUserId = userId

        // If targetUserId is an integer (database id), fetch its auth_id (UUID) from database
        if (targetUserId && !isNaN(Number(targetUserId))) {
            const { data: dbUser, error: dbError } = await supabaseAdmin
                .from('users')
                .select('auth_id')
                .eq('id', Number(targetUserId))
                .single()

            if (dbError) {
                console.error('Error fetching auth_id for user:', dbError)
            } else if (dbUser && dbUser.auth_id) {
                targetUserId = dbUser.auth_id
            }
        }

        // Si no tenemos ID, intentamos buscar por email (fallback)
        if (!targetUserId && email) {
            const { data, error } = await supabaseAdmin.auth.admin.listUsers()
            if (error) throw error
            const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
            if (user) targetUserId = user.id
        }

        if (!targetUserId) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
        }

        // Actualizar contraseña usando la API Admin (Garantiza hash correcto)
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
            targetUserId,
            {
                password: password,
                email_confirm: true,
                user_metadata: { email_verified: true }
            }
        )

        if (updateError) {
            console.error('Error supabaseAdmin update:', updateError)
            return NextResponse.json({ error: updateError.message }, { status: 400 })
        }

        return NextResponse.json({ success: true })

    } catch (error: any) {
        console.error('Error en reset-password route:', error)
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 })
    }
}

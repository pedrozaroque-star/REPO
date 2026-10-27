/**
 * @module CreateUserRoute
 * @description API route to register a new user in Supabase Auth and save their profile in the database.
 * @businessRules
 * - Requires authenticated admin or supervisor session via verifyStaffAuth.
 * - Creates a credentials-based entry in Supabase Auth with auto-confirmed email.
 * - Inserts the user record in public.users and returns only non-sensitive columns.
 * @dataFlow
 * - Request (email, password, fullName, role, storeId, otherData) -> Verify Admin/Supervisor -> Create Auth User -> Insert public.users profile -> Response (success)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffAuth } from '@/lib/auth-server'

// Cliente admin con service_role key (solo del lado del servidor)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

if (!supabaseServiceKey) {
    console.error('⚠️ SUPABASE_SERVICE_ROLE_KEY no está configurado. La creación de usuarios fallará.')
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
})

export async function POST(request: NextRequest) {
    const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'] })
    if (!auth.authorized) return auth.response!

    try {
        const body = await request.json()
        const { email, password, fullName, role, storeId, otherData } = body

        console.log('🔧 API: Creando usuario', email, role)

        // 1. Crear usuario en Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto-confirmar email
            user_metadata: {
                full_name: fullName
            }
        })

        if (authError) {
            console.error('❌ Error Auth:', authError)
            return NextResponse.json({ success: false, error: 'Error Auth: ' + authError.message }, { status: 400 })
        }

        const newUserId = authData.user?.id

        if (!newUserId) {
            return NextResponse.json({ success: false, error: 'No se obtuvo ID del nuevo usuario' }, { status: 500 })
        }

        // 2. Insertar en public.users
        const userPayload = {
            auth_id: newUserId,
            email: email,
            full_name: fullName,
            role: role || 'auditor',
            store_id: storeId,
            is_active: true,
            ...(otherData || {})
        }

        if (password) {
            // @ts-ignore
            userPayload.password = password
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

        console.log('✅ Usuario creado exitosamente:', insertedUser?.email)
        return NextResponse.json({ success: true, data: insertedUser })

    } catch (err: any) {
        console.error('❌ Error inesperado en create-user:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

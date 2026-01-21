import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cliente admin con service_role key (solo del lado del servidor)
// Esto asegura que podemos crear usuarios en Auth y escribir en public.users sin restricciones de RLS
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

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
    try {
        const body = await request.json()
        const { email, password, fullName, role, storeId, otherData } = body

        console.log('🔧 API: Creando usuario', email, role)

        // 1. Crear usuario en Supabase Check (Authentication)
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

        // 2. Insertar/Actualizar en public.users (Base de datos por defecto)
        // Usamos upsert para manejar el caso donde un Trigger ya haya creado la fila
        const userPayload = {
            auth_id: newUserId, // Link al usuario de Auth
            email: email,
            full_name: fullName,
            role: role || 'auditor', // Default role
            store_id: storeId,
            is_active: true,
            // Agregamos cualquier otra data extra que venga
            ...(otherData || {})
        }

        // Removemos password del payload de public.users si viene, ya que public.users no debe tener la contraseña real (solo auth)
        // A menos que tu sistema use la columna 'password' en public.users para logins legacy, pero idealmente no.
        // Si tu sistema anterior lo usaba, descomenta la siguiente línea:
        if (password) {
            // @ts-ignore
            userPayload.password = password
        }

        const { data: insertedUser, error: dbError } = await supabaseAdmin
            .from('users')
            .insert(userPayload)
            .select()
            .single()

        if (dbError) {
            console.error('❌ Error DB public.users:', dbError)
            // Intentar borrar el usuario de Auth si falló la DB para no dejar registros huerfanos (Rollback manual)
            await supabaseAdmin.auth.admin.deleteUser(newUserId)
            return NextResponse.json({ success: false, error: 'Error DB: ' + dbError.message }, { status: 500 })
        }

        console.log('✅ Usuario creado exitosamente:', insertedUser)
        return NextResponse.json({ success: true, data: insertedUser })

    } catch (err: any) {
        console.error('❌ Error inesperado en create-user:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

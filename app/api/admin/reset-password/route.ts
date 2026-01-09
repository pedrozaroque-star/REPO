import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const { email, password, userId } = await request.json()

        // Validar Service Key
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !serviceKey) {
            console.log('Skipping Supabase Auth sync: Missing SUPABASE_SERVICE_ROLE_KEY')
            // Devolvemos 200 OK para no generar ruido rojo en consola, ya que esto es opcional
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

        // Si no tenemos ID, intentamos buscar por email (fallback)
        if (!targetUserId && email) {
            // Nota: Esto es ineficiente si hay muchos usuarios, pero sirve de fallback
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
                email_confirm: true, // Auto-confirmar
                user_metadata: { email_verified: true } // Forzar metadatos visuales
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

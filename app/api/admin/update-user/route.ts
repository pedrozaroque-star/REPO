import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cliente admin con service_role key (solo del lado del servidor)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

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
    try {
        const body = await request.json()
        const { userId, userData } = body

        console.log('🔧 API: Actualizando usuario', userId, 'con datos:', userData)

        // Actualizar usando el cliente admin (bypasea RLS)
        const { data, error } = await supabaseAdmin
            .from('users')
            .update(userData)
            .eq('id', userId)
            .select()

        if (error) {
            console.error('❌ Error en API:', error)
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        console.log('✅ Usuario actualizado:', data)

        return NextResponse.json({ success: true, data })
    } catch (err: any) {
        console.error('❌ Error inesperado:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}

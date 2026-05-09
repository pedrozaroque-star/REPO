
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url)
    const code = searchParams.get('code')
    const stateRaw = searchParams.get('state') || ''
    const error = searchParams.get('error')

    if (error) {
        return NextResponse.redirect(`${origin}/planificador?error=google_auth_failed`)
    }

    if (!code) {
        return NextResponse.redirect(`${origin}/planificador?error=no_code`)
    }

    // Parse state: puede ser JSON (nuevo formato) o string plana (legacy Planificador)
    let returnUrl = '/planificador'
    let userId = ''
    try {
        const parsed = JSON.parse(stateRaw)
        returnUrl = parsed.returnUrl || '/planificador'
        userId = parsed.userId || ''
    } catch {
        // Legacy: state es solo la URL de retorno (string plana)
        returnUrl = stateRaw || '/planificador'
    }

    const isLoginMode = returnUrl.includes('/auth/sso')

    try {
        // 1. Intercambiar código por tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                redirect_uri: `${origin}/api/auth/google/callback`,
                grant_type: 'authorization_code'
            })
        })

        const tokens = await tokenResponse.json()

        if (!tokens.refresh_token) {
            console.warn('⚠️ GOOGLE AUTH WARNING: No refresh_token received!')
        }

        // 2. Obtener email del usuario de Google
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        })
        const googleUser = await userResponse.json()
        const googleEmail = googleUser.email

        // 3. LOGIC SWITCH: Login (SSO) vs Connect (Link)
        if (isLoginMode) {
            // --- SSO LOGIN FLOW ---
            const supabase = createClient(supabaseUrl, supabaseServiceKey)

            // Check if user exists in DB
            const { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .ilike('email', googleEmail) // Case insensitive match
                .single()

            if (dbError || !user) {
                return NextResponse.redirect(`${origin}/login?error=unauthorized_email`)
            }

            // User Exists! -> AUTO UPDATE GOOGLE CREDS
            const updates: any = {
                google_email_connected: googleEmail,
                last_active: new Date().toISOString()
            }
            if (tokens.refresh_token) updates.google_refresh_token = tokens.refresh_token

            await supabase.from('users').update(updates).eq('id', user.id)

            // CREATE SESSION PAYLOAD (Similar to /api/login)
            const tokenSource = String(user.id) + '-' + String(Date.now())
            const sessionToken = `g_sso_${Buffer.from(tokenSource).toString('base64')}`

            const userPayload = {
                id: user.id,
                email: user.email,
                name: user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                role: user.role,
                store_scope: user.store_scope,
                store_id: user.store_id,
                first_name: user.first_name,
                last_name: user.last_name
            }

            return NextResponse.redirect(`${origin}/auth/sso?token=${sessionToken}&user=${encodeURIComponent(JSON.stringify(userPayload))}`)

        } else {
            // --- CONNECT FLOW (Inspecciones, Planificador, etc.) ---
            const supabase = createClient(supabaseUrl, supabaseServiceKey)

            const updates: any = { google_email_connected: googleEmail }
            if (tokens.refresh_token) {
                updates.google_refresh_token = tokens.refresh_token
            }

            // ESTRATEGIA: Intentar guardar por userId (preciso) -> fallback a email
            let saved = false

            if (userId) {
                // Método 1: userId directo del state (100% confiable)
                const { error: err1 } = await supabase
                    .from('users')
                    .update(updates)
                    .eq('id', userId)

                if (!err1) {
                    saved = true
                    console.log(`✅ [OAuth Connect] Token saved for userId=${userId} (${googleEmail})`)
                } else {
                    console.warn(`⚠️ [OAuth Connect] userId update failed:`, err1)
                }
            }

            if (!saved) {
                // Método 2: Fallback por email (para Planificador u otros sin userId)
                const { error: err2 } = await supabase
                    .from('users')
                    .update(updates)
                    .ilike('email', googleEmail)

                if (!err2) {
                    console.log(`✅ [OAuth Connect] Token saved via email fallback (${googleEmail})`)
                } else {
                    console.error(`❌ [OAuth Connect] Both methods failed for ${googleEmail}:`, err2)
                }
            }

            // Redirigir de vuelta con parámetros (retrocompatibilidad con Planificador)
            const safeParams = new URLSearchParams()
            if (tokens.refresh_token) safeParams.set('rt', tokens.refresh_token)
            safeParams.set('ge', googleEmail)
            safeParams.set('success', 'true')

            return NextResponse.redirect(`${origin}${returnUrl}?${safeParams.toString()}`)
        }

    } catch (error: any) {
        console.error('OAuth Error:', error)
        return NextResponse.redirect(`${origin}/planificador?error=oauth_error&message=${encodeURIComponent(error.message)}`)
    }
}

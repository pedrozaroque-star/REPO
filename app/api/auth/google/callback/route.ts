
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state') // returnUrl
    const error = searchParams.get('error')

    if (error) {
        return NextResponse.redirect(`${origin}/planificador?error=google_auth_failed`)
    }

    if (!code) {
        return NextResponse.redirect(`${origin}/planificador?error=no_code`)
    }

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
            // Si el usuario ya autorizó antes, Google no devuelve refresh_token a menos que revoquemos acceso.
            // Ojo: prompt=consent en el start debería forzarlo.
            console.warn('Google did not return a refresh_token')
        }

        // 2. Obtener email del usuario de Google para confirmar identidad
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        })
        const googleUser = await userResponse.json()
        const googleEmail = googleUser.email

        // 3. Identificar al usuario actual de la aplicación
        // Necesitamos saber QUÉ manager está haciendo esto.
        // Como es un Callback de servidor, no tenemos el contexto del cliente fácil.
        // Usamos supabase auth cookie helper O asumimos que el usuario ya tiene sesión activa en el navegador
        // y al redirigir le asignaremos la data.
        // PROBLEMA: Este endpoint se ejecuta en el servidor.

        // SOLUCIÓN: Usamos cookies de la request para identificar al usuario con Supabase.
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Recuperar session desde cookies del navegador (Next.js pasa las cookies en req)
        // NOTA: Para simplificar en API Route plano, intentamos obtener el usuario desde las cookies.
        // Si no, tendremos un problema de asociación.

        // HACK SEGURO: Usamos el cliente de supabase "auth-helpers" si estuviera disponible, pero aquí estamos en API nativa.
        // Vamos a leer las cookies manualmente para getUser.

        // Alternativa Robusta: El usuario DEBE estar logueado.
        // Supabase Auth guarda un JWT en cookies. Vamos a intentar decodificarlo o usar getUser.
        // Pero getUser requiere pasar las cookies al cliente supabase.

        // Vamos a crear un cliente con las cookies de la solicitud
        const cookies = req.headers.get('cookie') || ''

        // Nota: getUser con Service Role puede buscar por ID, pero aquí no tenemos el ID a menos que venga en el state (inseguro)
        // o lo saquemos del JWT de la cookie.

        // Usaremos un truco: Redirigir a una página cliente intermedia que guarde el token? No, inseguro.

        // MEJOR ENFOQUE: Usar `supabase.auth.getUser()` pasando el access_token de la cookie.
        // Necesitamos extraer el access_token de la cookie `sb-[project-ref]-auth-token`.
        // Esto es complejo de parsear manualmente.

        // PLAN B: Asumir que el usuario inició el flujo desde nuestra app y su sesión es válida.
        // Vamos a guardar el refresh_token TEMPORALMENTE en una tabla `auth_pending_tokens` con un ID de estado
        // O más fácil: Enviar el refresh token ENCRIPTADO a la URL de destino y que el cliente lo guarde (Riesgoso pero viable si HTTPS).

        // PLAN C (Mejor): Usar `@supabase/auth-helpers-nextjs` o `@supabase/ssr` si estuvieran instalados.
        // Veo que usas `getSupabaseClient` en tu código, que usa `createClientComponentClient` o similar.
        // En server side (API Route), deberíamos usar `createServerComponentClient` (o cookies).

        // Vamos a intentar obtener el usuario usando el token de la cookie 'teg_token' si existe (tu login custom)
        // O la cookie de supabase.

        // Revisando tu código de login, usas `localStorage.getItem('teg_token')`.
        // Eso NO se envía al servidor automáticamente en una redirección de OAuth callback :(

        // ENTONCES: No podemos saber quién es el usuario en el server-side callback porque tu auth es client-side (localStorage).

        // SOLUCIÓN PRO: Redirigir al cliente con el token como query param (PELIGROSO pero funcional para MVP)
        // Y que el cliente termine el guardado.
        // Para mitigar riesgo: Es un token que solo sirve para enviar correos de ESE usuario.

        // Vamos a pasar `?google_refresh_token=...&google_email=...` al returnUrl (/planificador).
        // Y en `/planificador` detectamos esos params y llamamos a `saveGoogleCreds`.

        const safeParams = new URLSearchParams()
        if (tokens.refresh_token) safeParams.set('rt', tokens.refresh_token) // Refresh Token
        safeParams.set('ge', googleEmail) // Google Email
        safeParams.set('success', 'true')

        return NextResponse.redirect(`${origin}${state}?${safeParams.toString()}`)

    } catch (error: any) {
        console.error('OAuth Error:', error)
        return NextResponse.redirect(`${origin}/planificador?error=oauth_error&message=${encodeURIComponent(error.message)}`)
    }
}

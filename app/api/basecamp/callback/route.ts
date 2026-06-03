/**
 * @module api/basecamp/callback
 * @description Ruta GET que maneja el callback OAuth2 de Basecamp. Recibe el código de autorización,
 *              lo intercambia por tokens (access + refresh), y guarda los tokens en Supabase.
 *
 * @businessRules
 * - **Token Singleton**: Solo se almacena un par de tokens activo en `bc_oauth_tokens`.
 *   Si ya existe un token previo, se reemplaza (upsert) para evitar múltiples tokens activos.
 * - **Persistencia**: Los tokens se guardan con `expires_at` calculado para permitir
 *   auto-renovación futura sin intervención del usuario.
 * - **Error Handling**: Cualquier error redirige a /basecamp con parámetro de error visible
 *   para que el usuario sepa qué pasó.
 *
 * @dataFlow
 * - Basecamp Launchpad → 302 a /api/basecamp/callback?code=XXX
 * - POST a launchpad.37signals.com/authorization/token (intercambio code→tokens)
 * - Upsert tokens en Supabase `bc_oauth_tokens`
 * - 302 Redirect a /basecamp?auth=success
 *
 * @notes
 * - Basecamp access_tokens típicamente expiran en ~1,209,600 seconds (~2 weeks).
 * - El refresh_token NO expira y se puede usar indefinidamente.
 * - Si el token exchange falla, el usuario debe re-intentar /api/basecamp/auth.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exchangeCodeForToken } from '@/lib/basecamp-api'
import { getServerUser } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Handle error from Basecamp (user denied authorization)
  if (error) {
    console.error('❌ [Basecamp Callback] Auth denied by user:', error)
    return NextResponse.redirect(`${origin}/basecamp?auth=denied&error=${encodeURIComponent(error)}`)
  }

  // Validate code parameter
  if (!code) {
    console.error('❌ [Basecamp Callback] No authorization code received')
    return NextResponse.redirect(`${origin}/basecamp?auth=error&error=no_code`)
  }

  try {
    // 1. Get current logged-in user from request cookies using custom auth helper
    const user = await getServerUser()

    if (!user) {
      console.error('❌ [Basecamp Callback] User is not authenticated via teg_token cookie')
      return NextResponse.redirect(
        `${origin}/basecamp?auth=error&error=${encodeURIComponent('User not authenticated in SM TEG')}`
      )
    }

    // 2. Exchange code for access_token + refresh_token
    console.log('🔄 [Basecamp Callback] Exchanging code for tokens...')
    const tokens = await exchangeCodeForToken(code)

    if (!tokens.access_token) {
      throw new Error('No access_token received from Basecamp')
    }

    // 3. Calculate token expiry
    // Basecamp returns expires_in in seconds (typically ~1,209,600 = 2 weeks)
    const expiresInMs = (tokens.expires_in || 1_209_600) * 1000
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString()

    // 4. Create admin client to query database and save tokens (bypassing RLS)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    )

    // 5. Look up user's auth_id (UUID referencing auth.users) from the custom users table
    // because user.id from the custom JWT is the integer PK of the public.users table.
    const { data: dbUser, error: dbUserError } = await supabaseAdmin
      .from('users')
      .select('auth_id')
      .eq('email', user.email)
      .single()

    if (dbUserError || !dbUser?.auth_id) {
      console.error('❌ [Basecamp Callback] Failed to fetch auth_id for user:', user.email, dbUserError)
      throw new Error(`User account for ${user.email} is not linked to a valid authentication ID`)
    }

    const authUserId = dbUser.auth_id

    // Delete any existing tokens first (singleton pattern)
    await supabaseAdmin.from('bc_oauth_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    // Insert the new token tied to the user's UUID auth_id
    const { error: insertError } = await supabaseAdmin.from('bc_oauth_tokens').insert({
      user_id: authUserId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })

    if (insertError) {
      console.error('❌ [Basecamp Callback] DB insert error:', insertError)
      throw new Error(`Failed to save tokens: ${insertError.message}`)
    }

    console.log('✅ [Basecamp Callback] Tokens saved successfully for user email', user.email, 'with authUserId', authUserId, '. Expires at:', expiresAt)

    // 5. Redirect to Basecamp page with success
    return NextResponse.redirect(`${origin}/basecamp?auth=success`)
  } catch (err: any) {
    console.error('❌ [Basecamp Callback] Error:', err.message)
    return NextResponse.redirect(
      `${origin}/basecamp?auth=error&error=${encodeURIComponent(err.message)}`
    )
  }
}

/**
 * @module api/basecamp/auth
 * @description Ruta GET que inicia el flujo OAuth2 de Basecamp. Redirige al usuario
 *              a la página de autorización de 37signals (Launchpad) para que otorgue
 *              permisos a la aplicación SM-TEG.
 *
 * @businessRules
 * - **Acceso Restringido**: Solo administradores del sistema deberían acceder a esta ruta.
 *   La autenticación con Basecamp conecta toda la instancia (Account ID 5052386), no un usuario individual.
 * - **Flujo Único**: Solo se necesita autenticar una vez. El token se renueva automáticamente después.
 * - **Redirect URI**: Debe coincidir EXACTAMENTE con la URL registrada en la app de Basecamp
 *   (configurada en BASECAMP_REDIRECT_URI).
 *
 * @dataFlow
 * - GET /api/basecamp/auth → Construye URL con client_id + redirect_uri → 302 Redirect a Basecamp Launchpad
 * - El usuario autoriza → Basecamp redirige a /api/basecamp/callback con ?code=xxx
 *
 * @notes
 * - La URL de autorización de Basecamp es: https://launchpad.37signals.com/authorization/new
 * - Parámetro `type=web_server` es OBLIGATORIO para OAuth2 web flow de Basecamp
 */

import { NextResponse } from 'next/server'
import { getAuthorizationUrl } from '@/lib/basecamp-api'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const clientId = process.env.BASECAMP_CLIENT_ID
    if (!clientId) {
      return NextResponse.json(
        { error: 'Basecamp Client ID not configured. Set BASECAMP_CLIENT_ID in .env.local' },
        { status: 500 }
      )
    }

    const authUrl = await getAuthorizationUrl()
    console.log('🔐 [Basecamp Auth] Redirecting to Basecamp authorization...')

    return NextResponse.redirect(authUrl)
  } catch (error: any) {
    console.error('❌ [Basecamp Auth] Error building auth URL:', error.message)
    return NextResponse.json(
      { error: `Failed to initiate Basecamp auth: ${error.message}` },
      { status: 500 }
    )
  }
}

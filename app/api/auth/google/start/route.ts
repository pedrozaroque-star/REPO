/**
 * @module api/auth/google/start
 * @description Inicia el flujo OAuth2 de Google para SSO, conexión individual de gerentes (`/planificador`, `/inspecciones`)
 * o vinculación en 1 clic de la cuenta institucional del sistema (`?mode=system` -> `noreply@tacosgavilan.com`).
 *
 * @businessRules
 * - Solicita `gmail.send` y `userinfo.email` con `access_type=offline` y `prompt=consent` para garantizar `refresh_token`.
 * - En `mode=system`, preselecciona `noreply@tacosgavilan.com` mediante `login_hint` y aísla el flujo para no pisar
 *   credenciales personales ni de administrador.
 *
 * @dataFlow
 * - GET `/api/auth/google/start` -> Redirect a `https://accounts.google.com/o/oauth2/v2/auth` -> `/api/auth/google/callback`.
 */

import { NextResponse } from 'next/server'
import { OFFICIAL_NOREPLY_EMAIL } from '@/lib/system-mailer'

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url)
    const mode = searchParams.get('mode') || ''
    const isSystemMode = mode === 'system'
    const returnUrl = searchParams.get('returnUrl') || (isSystemMode ? 'inline' : '/planificador')
    const userId = isSystemMode ? '' : searchParams.get('userId') || ''
    const loginHint =
        searchParams.get('loginHint') || (isSystemMode ? OFFICIAL_NOREPLY_EMAIL : '')

    const clientId = process.env.GOOGLE_CLIENT_ID
    const redirectUri = `${origin}/api/auth/google/callback`

    const scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ')

    if (!clientId) {
        return NextResponse.json({ error: 'Google Client ID not configured' }, { status: 500 })
    }

    const statePayload = JSON.stringify({
        returnUrl,
        userId,
        mode: isSystemMode ? 'system' : 'user',
    })

    const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: isSystemMode ? 'consent select_account' : 'consent',
        state: statePayload,
    })

    if (loginHint) {
        authParams.set('login_hint', loginHint.trim().toLowerCase())
    }

    return NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`
    )
}

/**
 * @module api/auth/google/start
 * @description Inicia el flujo OAuth2 de Google para SSO (`/login` -> `/auth/sso`), conexión individual de gerentes (`/planificador`, `/inspecciones`)
 * o vinculación en 1 clic de la cuenta institucional del sistema (`?mode=system` -> `noreply@tacosgavilan.com`).
 *
 * @businessRules
 * - Valida estrictamente `returnUrl` como ruta relativa del mismo origen (`startsWith('/') && !startsWith('//') && !includes('@') && !includes('\\')`).
 * - Cuando `mode !== 'login'`, exige sesión autenticada vía `getServerUser(req)` (`HTTP 401` si no hay sesión) y toma `userId` exclusivamente de `serverUser.id` (nunca de query params no confiables). En `mode === 'system'`, exige rol `admin`.
 * - Firma criptográficamente el parámetro `state` con HMAC-SHA256 (`SUPABASE_JWT_SECRET`), `nonce` aleatorio de 16 bytes y expiración de 10 minutos, fijando la cookie `HttpOnly` `tg_google_oauth_nonce`.
 *
 * @dataFlow
 * - GET `/api/auth/google/start` -> Validación de sesión + HMAC `state` + Cookie `tg_google_oauth_nonce` -> Redirect a `https://accounts.google.com/o/oauth2/v2/auth`.
 *
 * @notes
 * - Hardened 2026-11-21: Eliminado OAuth CSRF / secuestro de cuenta por `userId` en URL y Open Redirect en `returnUrl`.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getJwtSecret, getServerUser } from '@/lib/auth-server'
import { OFFICIAL_NOREPLY_EMAIL } from '@/lib/system-mailer'

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url)
    const rawMode = (searchParams.get('mode') || '').trim().toLowerCase()
    const rawReturn = searchParams.get('returnUrl')

    const sanitizedReturn =
        typeof rawReturn === 'string' &&
        rawReturn.length > 0 &&
        rawReturn.length <= 512 &&
        rawReturn.startsWith('/') &&
        !rawReturn.startsWith('//') &&
        !rawReturn.includes('@') &&
        !rawReturn.includes('\\') &&
        !/[\r\n\0]/.test(rawReturn)
            ? rawReturn
            : null

    const effectiveMode: 'login' | 'system' | 'user' =
        rawMode === 'system'
            ? 'system'
            : rawMode === 'login' ||
                sanitizedReturn === '/auth/sso' ||
                Boolean(sanitizedReturn?.startsWith('/auth/sso?'))
              ? 'login'
              : 'user'

    const returnUrl =
        sanitizedReturn ?? (effectiveMode === 'login' ? '/auth/sso' : '/inicio')
    const inlineSystem = effectiveMode === 'system' && !sanitizedReturn

    let verifiedUserId = ''
    if (effectiveMode !== 'login') {
        const serverUser = await getServerUser(req)
        if (!serverUser || !serverUser.id) {
            return NextResponse.json(
                { error: 'No autenticado: Inicia sesión antes de conectar una cuenta de Google.' },
                { status: 401 }
            )
        }
        const roleNorm = (serverUser.role || '').trim().toLowerCase()
        if (effectiveMode === 'system' && roleNorm !== 'admin' && roleNorm !== 'administrador') {
            return NextResponse.json(
                { error: 'Forbidden: Solo un administrador puede activar la cuenta institucional del sistema.' },
                { status: 403 }
            )
        }
        verifiedUserId = String(serverUser.id)
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const jwtSecret = getJwtSecret()
    if (!clientId || !jwtSecret) {
        return NextResponse.json({ error: 'Google OAuth / JWT configuration missing' }, { status: 500 })
    }

    const redirectUri = `${origin}/api/auth/google/callback`
    const loginHint =
        searchParams.get('loginHint') || (effectiveMode === 'system' ? OFFICIAL_NOREPLY_EMAIL : '')

    const scopes =
        effectiveMode === 'login'
            ? 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
            : [
                  'https://www.googleapis.com/auth/gmail.send',
                  'https://www.googleapis.com/auth/userinfo.email',
              ].join(' ')

    const nonce = crypto.randomBytes(16).toString('hex')
    const stateObj = {
        returnUrl,
        userId: verifiedUserId,
        mode: effectiveMode,
        inline: inlineSystem,
        nonce,
        exp: Date.now() + 10 * 60 * 1000, // 10 minutos
    }
    const payloadB64 = Buffer.from(JSON.stringify(stateObj), 'utf8').toString('base64url')
    const sigB64 = crypto.createHmac('sha256', jwtSecret).update(payloadB64).digest('base64url')
    const signedState = `${payloadB64}.${sigB64}`

    const authParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: effectiveMode === 'system' ? 'consent select_account' : effectiveMode === 'login' ? 'select_account' : 'consent',
        state: signedState,
    })

    if (loginHint) {
        authParams.set('login_hint', loginHint.trim().toLowerCase())
    }

    const response = NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`
    )

    response.cookies.set('tg_google_oauth_nonce', nonce, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
        secure: process.env.NODE_ENV === 'production',
    })

    return response
}

/**
 * @module api/auth/google/callback
 * @description Callback OAuth2 endurecido de Google para inicio de sesión SSO, vinculación individual de correo corporativo
 * y activación aislada de la cuenta oficial del sistema (`noreply@tacosgavilan.com` en `mode=system`).
 *
 * @businessRules
 * - Verifica firma HMAC-SHA256, expiración (`10 min`) y coincidencia en tiempo constante de la cookie `HttpOnly` `tg_google_oauth_nonce` contra `state` (`HTTP 403` si falla).
 * - Escapa todas las interpolaciones HTML (`escapeHtml`) y aplica `Content-Security-Policy` restrictiva (`script-src 'none'`) contra Reflected XSS.
 * - Revalida `returnUrl` garantizando redirecciones estrictamente al mismo `origin`.
 * - NUNCA incluye `refresh_token` (`rt`) en la URL de redirección; se persiste exclusivamente del lado del servidor.
 * - En `mode === 'login'`, verifica `user.is_active !== false` (`HTTP 403` si está inactivo) y firma un JWT HS256 real con `SUPABASE_JWT_SECRET`, fijando la cookie `teg_token` en lugar de tokens sin firma (`g_sso_...`).
 *
 * @dataFlow
 * - Google OAuth Code + Signed `state` -> Verificación HMAC/Nonce -> `oauth2.googleapis.com/token` -> `userinfo` -> Supabase (`integrations` / `users`) -> Cookie `teg_token` / Redirect seguro.
 *
 * @notes
 * - Hardened 2026-11-21: Eliminado Reflected XSS, Open Redirect, fuga de `refresh_token` en URL, OAuth CSRF y tokens `g_sso_` sin firma.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'
import {
    getJwtSecret,
    invalidateActiveUserStatusCache,
    safeTimingEqual,
} from '@/lib/auth-server'
import { OFFICIAL_NOREPLY_EMAIL, saveSystemGmailOAuthToken } from '@/lib/system-mailer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function escapeHtml(raw: unknown): string {
    return String(raw ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function htmlResponse(html: string, status = 200) {
    const res = new NextResponse(html, {
        status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'",
            'X-Content-Type-Options': 'nosniff',
        },
    })
    res.cookies.delete('tg_google_oauth_nonce')
    return res
}

function sanitizeSafePath(rawReturn: unknown, fallback = '/inicio'): string {
    if (
        typeof rawReturn === 'string' &&
        rawReturn.length > 0 &&
        rawReturn.length <= 512 &&
        rawReturn.startsWith('/') &&
        !rawReturn.startsWith('//') &&
        !rawReturn.includes('@') &&
        !rawReturn.includes('\\') &&
        !/[\r\n\0]/.test(rawReturn)
    ) {
        return rawReturn
    }
    return fallback
}

function buildSameOriginUrl(origin: string, rawPath: unknown, fallback = '/inicio'): URL {
    const baseOrigin = new URL(origin).origin
    const safePath = sanitizeSafePath(rawPath, fallback)
    const candidate = new URL(safePath, baseOrigin)
    if (candidate.origin !== baseOrigin) {
        return new URL(fallback, baseOrigin)
    }
    return candidate
}

function extractNonceCookie(req: Request): string | null {
    const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie') || ''
    const match = cookieHeader.match(/(?:^|;\s*)tg_google_oauth_nonce=([^;]+)/)
    if (!match?.[1]) return null
    try {
        return decodeURIComponent(match[1].trim())
    } catch {
        return match[1].trim()
    }
}

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url)
    const code = searchParams.get('code')
    const stateRaw = searchParams.get('state') || ''
    const oauthError = searchParams.get('error')

    const jwtSecret = getJwtSecret()
    if (!jwtSecret) {
        return htmlResponse(
            `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;padding:40px;text-align:center;">
                <h2 style="color:#b91c1c;">Error de configuración del servidor</h2>
            </body></html>`,
            500
        )
    }

    // 1. Verificar firma HMAC, expiración y cookie HttpOnly tg_google_oauth_nonce en state
    const cookieNonce = extractNonceCookie(req)
    const stateParts = stateRaw.split('.')
    if (!cookieNonce || stateParts.length !== 2 || !stateParts[0] || !stateParts[1]) {
        return htmlResponse(
            `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                    <h2 style="color:#b91c1c;margin-top:0;">Solicitud OAuth Inválida (403)</h2>
                    <p style="color:#475569;font-size:14px;">La sesión de autorización expiró o la firma de seguridad no coincide.</p>
                </div>
            </body></html>`,
            403
        )
    }

    const [payloadB64, sigB64] = stateParts
    const expectedSig = crypto.createHmac('sha256', jwtSecret).update(payloadB64).digest('base64url')
    if (!safeTimingEqual(sigB64, expectedSig)) {
        return htmlResponse(
            `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                    <h2 style="color:#b91c1c;margin-top:0;">Firma OAuth Inválida (403)</h2>
                    <p style="color:#475569;font-size:14px;">No se pudo verificar la autenticidad del estado OAuth.</p>
                </div>
            </body></html>`,
            403
        )
    }

    let parsedState: {
        returnUrl?: unknown
        userId?: unknown
        mode?: unknown
        inline?: unknown
        nonce?: unknown
        exp?: unknown
    } | null = null

    try {
        parsedState = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    } catch {
        parsedState = null
    }

    if (
        !parsedState ||
        typeof parsedState.nonce !== 'string' ||
        parsedState.nonce.length < 16 ||
        !safeTimingEqual(parsedState.nonce, cookieNonce) ||
        typeof parsedState.exp !== 'number' ||
        parsedState.exp <= Date.now()
    ) {
        return htmlResponse(
            `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                    <h2 style="color:#b91c1c;margin-top:0;">Sesión OAuth Expirada (403)</h2>
                    <p style="color:#475569;font-size:14px;">El enlace de autorización venció o ya fue utilizado. Inicia el proceso nuevamente.</p>
                </div>
            </body></html>`,
            403
        )
    }

    const mode = parsedState.mode === 'system' ? 'system' : parsedState.mode === 'login' ? 'login' : 'user'
    const isSystemMode = mode === 'system'
    const isLoginMode = mode === 'login'
    const isInlineSystem = Boolean(parsedState.inline)
    const userId = typeof parsedState.userId === 'string' ? parsedState.userId.trim() : ''
    const safeReturnUrl = sanitizeSafePath(
        parsedState.returnUrl,
        isLoginMode ? '/auth/sso' : '/inicio'
    )
    const safeOriginHref = escapeHtml(new URL(origin).origin)
    const safeOfficialEmail = escapeHtml(OFFICIAL_NOREPLY_EMAIL)

    if (oauthError) {
        if (isSystemMode) {
            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                        <h2 style="color:#b91c1c;margin-top:0;">Autorización Cancelada</h2>
                        <p style="color:#475569;font-size:14px;">No se completó la autorización de <strong>${safeOfficialEmail}</strong> (${escapeHtml(oauthError)}).</p>
                        <a href="${safeOriginHref}/api/auth/google/start?mode=system" style="display:inline-block;margin-top:14px;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Intentar de nuevo</a>
                    </div>
                </body></html>`,
                400
            )
        }
        const errRedirect = buildSameOriginUrl(origin, isLoginMode ? '/login' : safeReturnUrl, '/login')
        errRedirect.searchParams.set('error', 'google_auth_failed')
        const res = NextResponse.redirect(errRedirect)
        res.cookies.delete('tg_google_oauth_nonce')
        return res
    }

    if (!code) {
        const noCodeRedirect = buildSameOriginUrl(origin, isLoginMode ? '/login' : safeReturnUrl, '/login')
        noCodeRedirect.searchParams.set('error', 'no_code')
        const res = NextResponse.redirect(noCodeRedirect)
        res.cookies.delete('tg_google_oauth_nonce')
        return res
    }

    try {
        // 2. Intercambiar código por tokens con Google
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                redirect_uri: `${new URL(origin).origin}/api/auth/google/callback`,
                grant_type: 'authorization_code',
            }),
        })

        const tokens = await tokenResponse.json()
        if (!tokenResponse.ok || !tokens.access_token) {
            throw new Error(
                tokens.error_description || tokens.error || 'No se pudo obtener access_token de Google'
            )
        }

        // 3. Obtener email verificado del usuario de Google
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const googleUser = await userResponse.json()
        const googleEmail = String(googleUser.email || '').trim()
        const cleanGoogleEmail = googleEmail.toLowerCase()
        const safeGoogleEmail = escapeHtml(googleEmail)

        if (!cleanGoogleEmail) {
            throw new Error('Google no devolvió una dirección de correo válida')
        }

        // 4A. FLUJO AISLADO DE CUENTA OFICIAL DE SISTEMA (`noreply@tacosgavilan.com`)
        if (isSystemMode) {
            if (cleanGoogleEmail !== OFFICIAL_NOREPLY_EMAIL) {
                return htmlResponse(
                    `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                        <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #fed7aa;border-radius:14px;padding:30px;box-shadow:0 6px 20px rgba(0,0,0,0.06);">
                            <h2 style="color:#c2410c;margin-top:0;">⚠️ Seleccionaste otra cuenta</h2>
                            <p style="color:#334155;font-size:15px;line-height:1.6;">
                                Elegiste <strong>${safeGoogleEmail}</strong>, pero este enlace es exclusivo para activar la cuenta institucional <strong>${safeOfficialEmail}</strong>.<br/>
                                <em>(Tus cuentas personales quedaron intactas y no se modificó nada).</em>
                            </p>
                            <a href="${safeOriginHref}/api/auth/google/start?mode=system" style="display:inline-block;margin-top:16px;background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">
                                Elegir ${safeOfficialEmail}
                            </a>
                        </div>
                    </body></html>`,
                    400
                )
            }

            await saveSystemGmailOAuthToken({
                email: OFFICIAL_NOREPLY_EMAIL,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || null,
                expiresInSec: Number(tokens.expires_in || 3500),
            })

            if (!isInlineSystem) {
                const sysRedirect = buildSameOriginUrl(origin, safeReturnUrl, '/inicio')
                sysRedirect.searchParams.set('system_mail_connected', '1')
                sysRedirect.searchParams.set('ge', OFFICIAL_NOREPLY_EMAIL)
                const res = NextResponse.redirect(sysRedirect)
                res.cookies.delete('tg_google_oauth_nonce')
                return res
            }

            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f0fdf4;padding:40px;text-align:center;">
                    <div style="max-width:580px;margin:0 auto;background:#ffffff;border:2px solid #86efac;border-radius:16px;padding:32px;box-shadow:0 8px 24px rgba(0,0,0,0.06);">
                        <div style="font-size:44px;margin-bottom:10px;">✅</div>
                        <h1 style="color:#166534;font-size:22px;margin:0 0 10px 0;">¡Cuenta Oficial del Sistema Activada!</h1>
                        <p style="color:#334155;font-size:15px;line-height:1.6;">
                            <strong>${safeOfficialEmail}</strong> quedó conectada de forma permanente en Supabase para <strong>Tacos Gavilan</strong> (tanto en local como en producción Vercel).
                        </p>
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:18px 0;font-size:13px;color:#475569;text-align:left;">
                            • Todos los correos automáticos del <strong>Sistema de Monitoreo</strong> (Breaks/Lunches diarios a empleados y managers, reporte ejecutivo de los lunes, auditorías RONOS, evaluaciones, radar de precios, salud del sistema y OTP móvil) ahora se despachan desde <strong>${safeOfficialEmail}</strong>.
                        </div>
                        <p style="color:#64748b;font-size:13px;margin-bottom:0;">Ya puedes cerrar esta pestaña.</p>
                    </div>
                </body></html>`
            )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        })

        // 4B. FLUJO LOGIN SSO (emite JWT HS256 firmado en cookie, sin pasar tokens en URL)
        if (isLoginMode) {
            const escapedGoogleEmail = cleanGoogleEmail.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
            const { data: rows, error: dbError } = await supabase
                .from('users')
                .select('id, email, full_name, role, store_scope, store_id, is_active')
                .ilike('email', escapedGoogleEmail)
                .limit(5)

            const user = !dbError && Array.isArray(rows)
                ? rows.find((r: any) => String(r?.email || '').trim().toLowerCase() === cleanGoogleEmail)
                : null

            if (!user) {
                const unauthRedirect = buildSameOriginUrl(origin, '/login', '/login')
                unauthRedirect.searchParams.set('error', 'unauthorized_email')
                const res = NextResponse.redirect(unauthRedirect)
                res.cookies.delete('tg_google_oauth_nonce')
                return res
            }

            if (user.is_active === false) {
                return htmlResponse(
                    `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                        <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                            <h2 style="color:#b91c1c;margin-top:0;">Cuenta Inactiva (403)</h2>
                            <p style="color:#475569;font-size:14px;">La cuenta asociada a <strong>${safeGoogleEmail}</strong> se encuentra desactivada. Contacta al administrador de Tacos Gavilan.</p>
                            <a href="${safeOriginHref}/login" style="display:inline-block;margin-top:14px;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Volver al inicio</a>
                        </div>
                    </body></html>`,
                    403
                )
            }

            const updates: Record<string, unknown> = {
                last_login: new Date().toISOString(),
            }
            if (cleanGoogleEmail !== OFFICIAL_NOREPLY_EMAIL) {
                updates.google_email_connected = googleEmail
                if (tokens.refresh_token) {
                    updates.google_refresh_token = tokens.refresh_token
                }
            }

            await supabase.from('users').update(updates).eq('id', user.id)
            invalidateActiveUserStatusCache(user.id, user.email)

            const jwtToken = jwt.sign(
                {
                    sub: String(user.id),
                    aud: 'authenticated',
                    role: 'authenticated',
                    email: user.email,
                    user_role: user.role,
                    user_type: 'admin',
                    user_metadata: {
                        full_name: user.full_name,
                        role: user.role,
                        store_scope: user.store_scope,
                        store_id: user.store_id,
                    },
                },
                jwtSecret,
                {
                    algorithm: 'HS256',
                    expiresIn: '30d',
                }
            )

            const userPayload = {
                id: user.id,
                email: user.email,
                name: user.full_name || user.email,
                role: user.role,
                store_scope: user.store_scope,
                store_id: user.store_id,
                user_type: 'admin',
            }

            const ssoRedirect = buildSameOriginUrl(origin, '/auth/sso', '/auth/sso')
            ssoRedirect.searchParams.set('user', JSON.stringify(userPayload))

            const res = NextResponse.redirect(ssoRedirect)
            res.cookies.delete('tg_google_oauth_nonce')
            res.cookies.set('teg_token', jwtToken, {
                httpOnly: false,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 30 * 24 * 60 * 60,
            })
            return res
        }

        // 4C. FLUJO CONEXIÓN INDIVIDUAL (Planificador, Inspecciones, etc.)
        if (!userId || !/^\d+$/.test(userId)) {
            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;padding:40px;text-align:center;">
                    <h2 style="color:#b91c1c;">Identidad de usuario no verificada (403)</h2>
                </body></html>`,
                403
            )
        }

        const { data: targetUser } = await supabase
            .from('users')
            .select('id, email, is_active')
            .eq('id', Number(userId))
            .maybeSingle()

        if (!targetUser || targetUser.is_active === false) {
            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;padding:40px;text-align:center;">
                    <h2 style="color:#b91c1c;">Cuenta de usuario no disponible (403)</h2>
                </body></html>`,
                403
            )
        }

        const redirectTarget = buildSameOriginUrl(origin, safeReturnUrl, '/inicio')

        // Impedir sobreescribir el token si el gerente eligió otro correo distinto al suyo
        if (String(targetUser.email || '').trim().toLowerCase() !== cleanGoogleEmail) {
            redirectTarget.searchParams.set('ge', googleEmail)
            redirectTarget.searchParams.set('error', 'email_mismatch')
            const mismatchRes = NextResponse.redirect(redirectTarget)
            mismatchRes.cookies.delete('tg_google_oauth_nonce')
            return mismatchRes
        }

        const updates: Record<string, unknown> = {
            google_email_connected: googleEmail,
            updated_at: new Date().toISOString(),
        }
        if (tokens.refresh_token) {
            updates.google_refresh_token = tokens.refresh_token
        }

        const { error: updateErr } = await supabase
            .from('users')
            .update(updates)
            .eq('id', targetUser.id)

        if (updateErr) {
            throw new Error(updateErr.message)
        }

        // NUNCA exponer refresh_token (rt) en query params de la URL
        redirectTarget.searchParams.set('ge', googleEmail)
        redirectTarget.searchParams.set('success', 'true')

        const res = NextResponse.redirect(redirectTarget)
        res.cookies.delete('tg_google_oauth_nonce')
        return res
    } catch (err: any) {
        console.error('OAuth Error:', err)
        const safeErrMsg = escapeHtml(err?.message || 'Error inesperado durante la autorización OAuth')
        if (isSystemMode) {
            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                        <h2 style="color:#b91c1c;margin-top:0;">Error al guardar autorización</h2>
                        <p style="color:#334155;font-size:14px;">${safeErrMsg}</p>
                        <a href="${safeOriginHref}/api/auth/google/start?mode=system" style="display:inline-block;margin-top:14px;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Reintentar</a>
                    </div>
                </body></html>`,
                500
            )
        }
        const fallbackErrRedirect = buildSameOriginUrl(origin, isLoginMode ? '/login' : safeReturnUrl, '/login')
        fallbackErrRedirect.searchParams.set('error', 'oauth_error')
        const res = NextResponse.redirect(fallbackErrRedirect)
        res.cookies.delete('tg_google_oauth_nonce')
        return res
    }
}

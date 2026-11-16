/**
 * @module api/auth/google/callback
 * @description Callback OAuth2 de Google para inicio de sesión SSO, vinculación individual de correo corporativo
 * y activación aislada de la cuenta oficial del sistema (`noreply@tacosgavilan.com` en `mode=system`).
 *
 * @businessRules
 * - En `mode === 'system'`, exige que la cuenta autorizada sea `noreply@tacosgavilan.com` (evitando sobreescribir
 *   por accidente al usuario administrador activo) y persiste el `refresh_token` en `public.integrations`
 *   (`service_name = 'system_gmail_oauth'`).
 * - Mantiene retrocompatibilidad completa con Login SSO (`/auth/sso`), Planificador e Inspecciones.
 *
 * @dataFlow
 * - Google OAuth Code -> `oauth2.googleapis.com/token` -> `googleapis.com/oauth2/v2/userinfo` -> Supabase (`integrations` / `users`).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { OFFICIAL_NOREPLY_EMAIL, saveSystemGmailOAuthToken } from '@/lib/system-mailer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function htmlResponse(html: string, status = 200) {
    return new NextResponse(html, {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
}

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url)
    const code = searchParams.get('code')
    const stateRaw = searchParams.get('state') || ''
    const error = searchParams.get('error')

    let returnUrl = '/planificador'
    let userId = ''
    let mode = 'user'
    try {
        const parsed = JSON.parse(stateRaw)
        returnUrl = parsed.returnUrl || '/planificador'
        userId = parsed.userId || ''
        mode = parsed.mode || 'user'
    } catch {
        returnUrl = stateRaw || '/planificador'
    }

    const isSystemMode = mode === 'system'

    if (error) {
        if (isSystemMode) {
            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                        <h2 style="color:#b91c1c;margin-top:0;">Autorización Cancelada</h2>
                        <p style="color:#475569;font-size:14px;">No se completó la autorización de <strong>${OFFICIAL_NOREPLY_EMAIL}</strong> (${error}).</p>
                        <a href="${origin}/api/auth/google/start?mode=system" style="display:inline-block;margin-top:14px;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Intentar de nuevo</a>
                    </div>
                </body></html>`,
                400
            )
        }
        return NextResponse.redirect(`${origin}/planificador?error=google_auth_failed`)
    }

    if (!code) {
        return NextResponse.redirect(`${origin}/planificador?error=no_code`)
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
                grant_type: 'authorization_code',
            }),
        })

        const tokens = await tokenResponse.json()
        if (!tokenResponse.ok || !tokens.access_token) {
            throw new Error(
                tokens.error_description || tokens.error || 'No se pudo obtener access_token de Google'
            )
        }

        // 2. Obtener email del usuario de Google
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const googleUser = await userResponse.json()
        const googleEmail = String(googleUser.email || '').trim()
        const cleanGoogleEmail = googleEmail.toLowerCase()

        // 3A. FLUJO AISLADO DE CUENTA OFICIAL DE SISTEMA (`noreply@tacosgavilan.com`)
        if (isSystemMode || cleanGoogleEmail === OFFICIAL_NOREPLY_EMAIL) {
            if (cleanGoogleEmail !== OFFICIAL_NOREPLY_EMAIL) {
                return htmlResponse(
                    `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                        <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #fed7aa;border-radius:14px;padding:30px;box-shadow:0 6px 20px rgba(0,0,0,0.06);">
                            <h2 style="color:#c2410c;margin-top:0;">⚠️ Seleccionaste otra cuenta</h2>
                            <p style="color:#334155;font-size:15px;line-height:1.6;">
                                Elegiste <strong>${googleEmail}</strong>, pero este enlace es exclusivo para activar la cuenta institucional <strong>${OFFICIAL_NOREPLY_EMAIL}</strong>.<br/>
                                <em>(Tus cuentas personales quedaron intactas y no se modificó nada).</em>
                            </p>
                            <a href="${origin}/api/auth/google/start?mode=system" style="display:inline-block;margin-top:16px;background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">
                                Elegir ${OFFICIAL_NOREPLY_EMAIL}
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

            if (returnUrl && returnUrl !== 'inline' && returnUrl.startsWith('/')) {
                return NextResponse.redirect(
                    `${origin}${returnUrl}?system_mail_connected=1&ge=${encodeURIComponent(OFFICIAL_NOREPLY_EMAIL)}`
                )
            }

            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f0fdf4;padding:40px;text-align:center;">
                    <div style="max-width:580px;margin:0 auto;background:#ffffff;border:2px solid #86efac;border-radius:16px;padding:32px;box-shadow:0 8px 24px rgba(0,0,0,0.06);">
                        <div style="font-size:44px;margin-bottom:10px;">✅</div>
                        <h1 style="color:#166534;font-size:22px;margin:0 0 10px 0;">¡Cuenta Oficial del Sistema Activada!</h1>
                        <p style="color:#334155;font-size:15px;line-height:1.6;">
                            <strong>${OFFICIAL_NOREPLY_EMAIL}</strong> quedó conectada de forma permanente en Supabase para <strong>Tacos Gavilan</strong> (tanto en local como en producción Vercel).
                        </p>
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:18px 0;font-size:13px;color:#475569;text-align:left;">
                            • Todos los correos automáticos del <strong>Sistema de Monitoreo</strong> (Breaks/Lunches diarios a empleados y managers, reporte ejecutivo de los lunes, auditorías RONOS, evaluaciones, radar de precios, salud del sistema y OTP móvil) ahora se despachan desde <strong>${OFFICIAL_NOREPLY_EMAIL}</strong>.
                        </div>
                        <p style="color:#64748b;font-size:13px;margin-bottom:0;">Ya puedes cerrar esta pestaña.</p>
                    </div>
                </body></html>`
            )
        }

        // 3B. FLUJO LOGIN SSO
        if (isLoginMode) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey)

            const { data: user, error: dbError } = await supabase
                .from('users')
                .select('*')
                .ilike('email', googleEmail)
                .single()

            if (dbError || !user) {
                return NextResponse.redirect(`${origin}/login?error=unauthorized_email`)
            }

            const updates: any = {
                google_email_connected: googleEmail,
                last_active: new Date().toISOString(),
            }
            if (tokens.refresh_token) updates.google_refresh_token = tokens.refresh_token

            await supabase.from('users').update(updates).eq('id', user.id)

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
                last_name: user.last_name,
            }

            return NextResponse.redirect(
                `${origin}/auth/sso?token=${sessionToken}&user=${encodeURIComponent(JSON.stringify(userPayload))}`
            )
        }

        // 3C. FLUJO CONEXIÓN INDIVIDUAL (Planificador, Inspecciones, etc.)
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const updates: any = { google_email_connected: googleEmail }
        if (tokens.refresh_token) {
            updates.google_refresh_token = tokens.refresh_token
        }

        let saved = false
        if (userId) {
            const { data: updatedRows, error: err1 } = await supabase
                .from('users')
                .update(updates)
                .eq('id', userId)
                .select('id')

            if (!err1 && updatedRows && updatedRows.length > 0) {
                saved = true
                console.log(`✅ [OAuth Connect] Token saved for userId=${userId} (${googleEmail})`)
            } else {
                console.warn(`⚠️ [OAuth Connect] userId update did not match row:`, err1)
            }
        }

        if (!saved) {
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

        const safeParams = new URLSearchParams()
        if (tokens.refresh_token) safeParams.set('rt', tokens.refresh_token)
        safeParams.set('ge', googleEmail)
        safeParams.set('success', 'true')

        return NextResponse.redirect(`${origin}${returnUrl}?${safeParams.toString()}`)
    } catch (error: any) {
        console.error('OAuth Error:', error)
        if (isSystemMode) {
            return htmlResponse(
                `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:40px;text-align:center;">
                    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:14px;padding:28px;">
                        <h2 style="color:#b91c1c;margin-top:0;">Error al guardar autorización</h2>
                        <p style="color:#334155;font-size:14px;">${error.message}</p>
                        <a href="${origin}/api/auth/google/start?mode=system" style="display:inline-block;margin-top:14px;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Reintentar</a>
                    </div>
                </body></html>`,
                500
            )
        }
        return NextResponse.redirect(
            `${origin}/planificador?error=oauth_error&message=${encodeURIComponent(error.message)}`
        )
    }
}

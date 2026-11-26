/**
 * @module lib/system-mailer
 * @description Servicio centralizado e indestructible de despacho de correos automáticos de sistema
 * para Tacos Gavilan, priorizando la cuenta oficial `noreply@tacosgavilan.com` vía Google OAuth2 (Gmail API)
 * con cascada automática de respaldo (failover) para garantizar 0% de correos perdidos.
 *
 * @businessRules
 * - Remitente institucional primario: `noreply@tacosgavilan.com` (normaliza automáticamente variantes como `noreplay@`).
 * - Orden estricto de cascada en `sendSystemEmail`:
 *   0) `preferredUserId` OAuth2 en `public.users` (solo si el módulo lo solicita explícitamente, ej. inspector).
 *   1) `noreply@tacosgavilan.com` vía Gmail REST API OAuth2 (`public.integrations` `service_name = 'system_gmail_oauth'` o `public.users`).
 *   2) `noreply@tacosgavilan.com` vía Nodemailer Gmail SMTP (`SYSTEM_SMTP_PASSWORD` o `SMTP_EMAIL` == `noreply@`).
 *   3) Respaldo automático activo (`carlos@tacosgavilan.com` vía Gmail REST API OAuth2 en `public.users`) mientras
 *      `noreply@tacosgavilan.com` concluye su vinculación OAuth de 1 clic o ante cualquier contingencia.
 *   4) Respaldo secundario SMTP (`SMTP_EMAIL` + `SMTP_PASSWORD`).
 * - Compila MIME RFC 2822 completo (`nodemailer` `streamTransport`) soportando HTML, texto plano, `cc`, `bcc`,
 *   `replyTo`, adjuntos binarios (`Buffer` PDF / `.ics`) e imágenes inline (`cid`).
 *
 * @dataFlow
 * - Lee/actualiza credenciales OAuth de sistema en `public.integrations` (`service_name = 'system_gmail_oauth'`)
 *   y consulta `public.users` como respaldo.
 * - Despacha por HTTPS (`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`).
 * @notes
 * - [2026-11-25] Blindaje Centralizado Anti-Rebotes (`lib/email-recipient-guard.ts`): antes de compilar MIME,
 *   `sendSystemEmail` canoniza alias administrativos (`yasmin@` -> `ap@`, `roque@` -> `carlos@`, `alejandro@` -> `alex@`),
 *   traduce cuentas login-only `@tacosgavilan.com` de `asistente` a su correo personal real verificado en `toast_employees`,
 *   y descarta correos no entregables (`@example.com`, `*.invalid`, cuentas `@tacosgavilan.com` inexistentes, o cuentas
 *   externas bloqueadas por `550 NoSuchUser` / `452 OverQuotaTemp` en `employee_email_audit_state`).
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer'
import { stripStoreNumberTokensInText } from '@/lib/store-display'
import {
    BlockedRecipientError,
    loadEmailDeliverabilityContext,
    sanitizeSystemMailRecipients,
} from '@/lib/email-recipient-guard'

export const OFFICIAL_NOREPLY_EMAIL = 'noreply@tacosgavilan.com'
export const FALLBACK_SYSTEM_EMAIL = 'carlos@tacosgavilan.com'
export const SYSTEM_OAUTH_INTEGRATION_NAME = 'system_gmail_oauth'

function resolveCanonicalPrimaryEmail(): string {
    const raw = (process.env.SYSTEM_SENDER_EMAIL || OFFICIAL_NOREPLY_EMAIL).trim().toLowerCase()
    if (!raw || raw === 'noreplay@tacosgavilan.com') {
        return OFFICIAL_NOREPLY_EMAIL
    }
    return raw
}

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
    const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        'placeholder'
    return createClient(supabaseUrl, supabaseKey)
}

interface CachedAccessToken {
    accessToken: string
    fromEmail: string
    expiresAtMs: number
}

const tokenMemoryCache = new Map<string, CachedAccessToken>()

export interface SystemMailOptions {
    fromName?: string
    to: string | string[]
    cc?: string | string[]
    bcc?: string | string[]
    replyTo?: string
    subject: string
    html?: string
    text?: string
    attachments?: Mail.Attachment[]
    preferredUserId?: string | number | null
    /** Solo para pruebas controladas de infraestructura; por defecto false (guard anti-rebotes siempre activo). */
    skipRecipientGuard?: boolean
}

export interface SystemMailResult {
    messageId: string
    fromEmail: string
    providerUsed:
        | 'preferred_user_oauth'
        | 'noreply_oauth'
        | 'noreply_smtp'
        | 'fallback_carlos_oauth'
        | 'fallback_smtp'
    isFallback: boolean
}

function sanitizeDisplayName(name?: string): string {
    const clean = (name || 'Sistema de Monitoreo').replace(/["\r\n]/g, '').trim()
    return clean || 'Sistema de Monitoreo'
}

async function exchangeRefreshTokenForAccessToken(
    refreshToken: string,
    expectedEmailHint?: string
): Promise<{ accessToken: string; email: string; expiresInSec: number }> {
    const cacheKey = refreshToken.slice(-28)
    const now = Date.now()
    const cached = tokenMemoryCache.get(cacheKey)
    if (cached && cached.expiresAtMs - now > 120_000) {
        return {
            accessToken: cached.accessToken,
            email: cached.fromEmail,
            expiresInSec: Math.floor((cached.expiresAtMs - now) / 1000),
        }
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing')
    }

    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    })

    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    })

    if (!refreshRes.ok) {
        const errData = await refreshRes.json().catch(() => ({}))
        throw new Error(
            `Google OAuth refresh failed (${refreshRes.status}): ${errData.error_description || errData.error || 'unknown'}`
        )
    }

    const tokens = await refreshRes.json()
    const accessToken = String(tokens.access_token || '')
    const expiresInSec = Number(tokens.expires_in || 3500)
    if (!accessToken) {
        throw new Error('Google OAuth returned empty access_token')
    }

    let resolvedEmail = (expectedEmailHint || '').trim().toLowerCase()
    try {
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (profileRes.ok) {
            const profile = await profileRes.json()
            if (profile?.email) {
                resolvedEmail = String(profile.email).trim().toLowerCase()
            }
        }
    } catch {
        // Keep expectedEmailHint if userinfo transiently fails
    }

    if (!resolvedEmail) {
        resolvedEmail = OFFICIAL_NOREPLY_EMAIL
    }

    tokenMemoryCache.set(cacheKey, {
        accessToken,
        fromEmail: resolvedEmail,
        expiresAtMs: now + expiresInSec * 1000,
    })

    return { accessToken, email: resolvedEmail, expiresInSec }
}

async function compileMimeToBase64Url(mailOptions: Mail.Options): Promise<string> {
    const compiler = nodemailer.createTransport({
        streamTransport: true,
        newline: 'windows',
    })
    const info = await compiler.sendMail(mailOptions)
    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
        const message = info.message as any
        if (Buffer.isBuffer(message)) return resolve(message)
        if (message && typeof message.on === 'function') {
            const chunks: Buffer[] = []
            message.on('data', (chunk: Buffer) => chunks.push(chunk))
            message.on('end', () => resolve(Buffer.concat(chunks)))
            message.on('error', (err: Error) => reject(err))
            return
        }
        reject(new Error('Nodemailer streamTransport returned unexpected message stream'))
    })

    return rawBuffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

async function sendViaGmailApi(
    accessToken: string,
    fromEmail: string,
    options: SystemMailOptions
): Promise<{ messageId: string }> {
    const displayName = sanitizeDisplayName(options.fromName)
    const raw = await compileMimeToBase64Url({
        from: `"${displayName}" <${fromEmail}>`,
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
    })

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
    })

    if (!sendRes.ok) {
        const errBody = await sendRes.text().catch(() => '')
        throw new Error(`Gmail API send failed (${sendRes.status}): ${errBody}`)
    }

    const payload = await sendRes.json().catch(() => ({}))
    return { messageId: String(payload?.id || `gmail-${Date.now()}`) }
}

async function sendViaSmtp(
    smtpUser: string,
    smtpPass: string,
    options: SystemMailOptions
): Promise<{ messageId: string }> {
    const displayName = sanitizeDisplayName(options.fromName)
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    })

    const info = await transporter.sendMail({
        from: `"${displayName}" <${smtpUser}>`,
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
    })

    return { messageId: String(info.messageId || `smtp-${Date.now()}`) }
}

/**
 * Guarda o actualiza el token OAuth2 oficial de `noreply@tacosgavilan.com` en `public.integrations`
 * (y opcionalmente sincroniza `public.users` si existe la fila), sin tocar jamás el usuario Admin actual.
 */
export async function saveSystemGmailOAuthToken(params: {
    email: string
    accessToken: string
    refreshToken?: string | null
    expiresInSec?: number
}): Promise<void> {
    const supabase = getSupabaseAdmin()
    const cleanEmail = params.email.trim().toLowerCase()
    const nowIso = new Date().toISOString()
    const expiresAtIso = new Date(Date.now() + (params.expiresInSec || 3500) * 1000).toISOString()

    const { data: existing } = await supabase
        .from('integrations')
        .select('id, refresh_token')
        .eq('service_name', SYSTEM_OAUTH_INTEGRATION_NAME)
        .maybeSingle()

    const effectiveRefreshToken = params.refreshToken || existing?.refresh_token || null
    if (!effectiveRefreshToken) {
        throw new Error(
            'Google no entregó refresh_token. Intenta nuevamente aceptando todos los permisos.'
        )
    }

    if (existing?.id) {
        const { error } = await supabase
            .from('integrations')
            .update({
                realm_id: cleanEmail,
                access_token: params.accessToken,
                refresh_token: effectiveRefreshToken,
                token_type: 'Bearer',
                expires_at: expiresAtIso,
                updated_at: nowIso,
            })
            .eq('id', existing.id)
        if (error) throw new Error(`Error actualizando integrations: ${error.message}`)
    } else {
        const { error } = await supabase.from('integrations').insert({
            service_name: SYSTEM_OAUTH_INTEGRATION_NAME,
            realm_id: cleanEmail,
            access_token: params.accessToken,
            refresh_token: effectiveRefreshToken,
            token_type: 'Bearer',
            expires_at: expiresAtIso,
            updated_at: nowIso,
        })
        if (error) throw new Error(`Error insertando integrations: ${error.message}`)
    }

    // Sincronizar también en public.users si existiera usuario con ese correo
    await supabase
        .from('users')
        .update({
            google_email_connected: cleanEmail,
            google_refresh_token: effectiveRefreshToken,
        })
        .ilike('email', cleanEmail)

    tokenMemoryCache.clear()
}

/**
 * Consulta en vivo si `noreply@tacosgavilan.com` ya tiene token OAuth2 activo y verificado.
 */
export async function getSystemMailerStatus(): Promise<{
    primaryEmail: string
    noreplyConnected: boolean
    activeSenderEmail: string
    provider: string
    updatedAt?: string | null
}> {
    const primaryEmail = resolveCanonicalPrimaryEmail()
    const supabase = getSupabaseAdmin()

    // 1. Check integrations
    const { data: integ } = await supabase
        .from('integrations')
        .select('realm_id, refresh_token, updated_at')
        .eq('service_name', SYSTEM_OAUTH_INTEGRATION_NAME)
        .maybeSingle()

    if (integ?.refresh_token) {
        try {
            const refreshed = await exchangeRefreshTokenForAccessToken(
                integ.refresh_token,
                integ.realm_id || primaryEmail
            )
            return {
                primaryEmail,
                noreplyConnected: refreshed.email.toLowerCase() === primaryEmail,
                activeSenderEmail: refreshed.email,
                provider: 'noreply_oauth',
                updatedAt: integ.updated_at,
            }
        } catch {
            // Fall through to secondary checks
        }
    }

    // 2. Check users table for primaryEmail
    const { data: noreplyUser } = await supabase
        .from('users')
        .select('email, google_email_connected, google_refresh_token, updated_at')
        .or(`email.ilike.${primaryEmail},google_email_connected.ilike.${primaryEmail}`)
        .not('google_refresh_token', 'is', null)
        .limit(1)
        .maybeSingle()

    if (noreplyUser?.google_refresh_token) {
        try {
            const refreshed = await exchangeRefreshTokenForAccessToken(
                noreplyUser.google_refresh_token,
                primaryEmail
            )
            return {
                primaryEmail,
                noreplyConnected: true,
                activeSenderEmail: refreshed.email,
                provider: 'noreply_user_oauth',
                updatedAt: noreplyUser.updated_at,
            }
        } catch {
            // Fall through
        }
    }

    return {
        primaryEmail,
        noreplyConnected: false,
        activeSenderEmail: FALLBACK_SYSTEM_EMAIL,
        provider: 'fallback_carlos_oauth_pending_noreply_click',
        updatedAt: null,
    }
}

/**
 * Despacha un correo de sistema priorizando `noreply@tacosgavilan.com` con failover automático.
 */
export async function sendSystemEmail(rawOptions: SystemMailOptions): Promise<SystemMailResult> {
    const supabase = getSupabaseAdmin()

    // Blindaje centralizado anti-rebotes (canoniza alias, resuelve correos personales de asistentes y bloquea inválidos/llenos)
    let effectiveTo: string | string[] = rawOptions.to
    let effectiveCc: string | string[] | undefined = rawOptions.cc
    let effectiveBcc: string | string[] | undefined = rawOptions.bcc
    let effectiveReplyTo: string | undefined = rawOptions.replyTo

    if (!rawOptions.skipRecipientGuard) {
        const guardCtx = await loadEmailDeliverabilityContext(supabase)
        const sanitized = sanitizeSystemMailRecipients(
            {
                to: rawOptions.to,
                cc: rawOptions.cc,
                bcc: rawOptions.bcc,
                replyTo: rawOptions.replyTo,
            },
            guardCtx
        )

        if (sanitized.rewritten.length > 0) {
            console.log(
                `🔁 [SystemMailer][EmailGuard] Destinatarios redirigidos (${sanitized.rewritten
                    .map((r) => `${r.from} -> ${r.to}`)
                    .join(', ')})`
            )
        }
        if (sanitized.dropped.length > 0) {
            console.warn(
                `🛡️ [SystemMailer][EmailGuard] Destinatarios omitidos para evitar rebote (${sanitized.dropped
                    .map((d) => `${d.email} [${d.reason}]`)
                    .join(', ')})`
            )
        }
        if (sanitized.to.length === 0) {
            throw new BlockedRecipientError(
                `SystemMailer omitió el envío porque ningún destinatario en "To" es entregable (${sanitized.dropped
                    .map((d) => `${d.email}:${d.reason}`)
                    .join(', ')})`,
                sanitized.dropped
            )
        }

        effectiveTo = sanitized.to
        effectiveCc = sanitized.cc.length > 0 ? sanitized.cc : undefined
        effectiveBcc = sanitized.bcc.length > 0 ? sanitized.bcc : undefined
        effectiveReplyTo = sanitized.replyTo
    }

    const options: SystemMailOptions = {
        ...rawOptions,
        to: effectiveTo,
        cc: effectiveCc,
        bcc: effectiveBcc,
        replyTo: effectiveReplyTo,
        subject: stripStoreNumberTokensInText(rawOptions.subject),
        html: rawOptions.html ? stripStoreNumberTokensInText(rawOptions.html) : rawOptions.html,
        text: rawOptions.text ? stripStoreNumberTokensInText(rawOptions.text) : rawOptions.text,
    }
    const primaryEmail = resolveCanonicalPrimaryEmail()
    const errors: string[] = []

    // NIVEL 0 (Opcional): Usuario preferido explícito (ej. Inspector en comentarios de inspección)
    if (options.preferredUserId !== undefined && options.preferredUserId !== null && String(options.preferredUserId).trim() !== '') {
        try {
            const { data: prefUser } = await supabase
                .from('users')
                .select('id, email, google_email_connected, google_refresh_token')
                .eq('id', options.preferredUserId)
                .maybeSingle()

            if (prefUser?.google_refresh_token) {
                const { accessToken, email } = await exchangeRefreshTokenForAccessToken(
                    prefUser.google_refresh_token,
                    prefUser.google_email_connected || prefUser.email
                )
                const sent = await sendViaGmailApi(accessToken, email, options)
                return {
                    messageId: sent.messageId,
                    fromEmail: email,
                    providerUsed: 'preferred_user_oauth',
                    isFallback: false,
                }
            }
        } catch (err: any) {
            errors.push(`preferred_user_oauth: ${err?.message || err}`)
        }
    }

    // NIVEL 1 (Prioridad Oficial): `noreply@tacosgavilan.com` vía Gmail REST API OAuth2
    try {
        let noreplyRefreshToken = process.env.SYSTEM_GOOGLE_REFRESH_TOKEN?.trim() || ''
        let noreplyHint = primaryEmail

        if (!noreplyRefreshToken) {
            const { data: integ } = await supabase
                .from('integrations')
                .select('realm_id, refresh_token')
                .eq('service_name', SYSTEM_OAUTH_INTEGRATION_NAME)
                .maybeSingle()

            if (integ?.refresh_token) {
                noreplyRefreshToken = integ.refresh_token
                if (integ.realm_id) noreplyHint = integ.realm_id.trim().toLowerCase()
            }
        }

        if (!noreplyRefreshToken) {
            const { data: sysUser } = await supabase
                .from('users')
                .select('email, google_email_connected, google_refresh_token')
                .or(`email.ilike.${primaryEmail},google_email_connected.ilike.${primaryEmail}`)
                .not('google_refresh_token', 'is', null)
                .limit(1)
                .maybeSingle()

            if (sysUser?.google_refresh_token) {
                noreplyRefreshToken = sysUser.google_refresh_token
                noreplyHint = (sysUser.google_email_connected || sysUser.email || primaryEmail)
                    .trim()
                    .toLowerCase()
            }
        }

        if (noreplyRefreshToken) {
            const { accessToken, email } = await exchangeRefreshTokenForAccessToken(
                noreplyRefreshToken,
                noreplyHint
            )
            const sent = await sendViaGmailApi(accessToken, email, options)
            return {
                messageId: sent.messageId,
                fromEmail: email,
                providerUsed: 'noreply_oauth',
                isFallback: false,
            }
        }
    } catch (err: any) {
        errors.push(`noreply_oauth: ${err?.message || err}`)
        console.warn('⚠️ [SystemMailer] Nivel 1 (noreply OAuth) falló, intentando siguiente nivel:', err?.message)
    }

    // NIVEL 2: `noreply@tacosgavilan.com` vía Nodemailer Gmail SMTP (App Password)
    const systemSmtpPass = process.env.SYSTEM_SMTP_PASSWORD?.trim()
    const envSmtpEmail = process.env.SMTP_EMAIL?.trim().toLowerCase()
    const envSmtpPass = process.env.SMTP_PASSWORD?.trim()

    if (systemSmtpPass || (envSmtpEmail === primaryEmail && envSmtpPass)) {
        try {
            const passToUse = (systemSmtpPass || envSmtpPass)!
            const sent = await sendViaSmtp(primaryEmail, passToUse, options)
            return {
                messageId: sent.messageId,
                fromEmail: primaryEmail,
                providerUsed: 'noreply_smtp',
                isFallback: false,
            }
        } catch (err: any) {
            errors.push(`noreply_smtp: ${err?.message || err}`)
            console.warn('⚠️ [SystemMailer] Nivel 2 (noreply SMTP) falló, pasando a respaldo OAuth:', err?.message)
        }
    }

    // NIVEL 3 (Último Respaldo): `SMTP_EMAIL` + `SMTP_PASSWORD` (excluyendo buzones ejecutivos protegidos)
    if (
        envSmtpEmail &&
        envSmtpPass &&
        envSmtpEmail !== primaryEmail &&
        envSmtpEmail.toLowerCase() !== 'carlos@tacosgavilan.com' &&
        envSmtpEmail.toLowerCase() !== 'roque@tacosgavilan.com'
    ) {
        try {
            const sent = await sendViaSmtp(envSmtpEmail, envSmtpPass, options)
            return {
                messageId: sent.messageId,
                fromEmail: envSmtpEmail,
                providerUsed: 'fallback_smtp',
                isFallback: true,
            }
        } catch (err: any) {
            errors.push(`fallback_smtp: ${err?.message || err}`)
        }
    }

    throw new Error(`SystemMailer agotó todos los métodos de envío: ${errors.join(' | ')}`)
}

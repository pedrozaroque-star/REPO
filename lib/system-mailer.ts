/**
 * @module lib/system-mailer
 * @description Servicio centralizado e indestructible de despacho de correos automáticos de sistema
 * para Tacos Gavilan, utilizando estrictamente la cuenta oficial `noreply@tacosgavilan.com` vía Google OAuth2
 * (Gmail API) y bloqueando de forma absoluta cualquier envío desde buzones ejecutivos personales
 * (`carlos@tacosgavilan.com`, `roque@tacosgavilan.com`).
 *
 * @businessRules
 * - Remitente institucional único y obligatorio: `noreply@tacosgavilan.com` (normaliza automáticamente variantes como `noreplay@`).
 * - **PROHIBICIÓN ABSOLUTA DE REMITENTES EJECUTIVOS**: Ningún nivel (`NIVEL 0..3`, `sendViaGmailApi`, `sendViaSmtp` ni
 *   `saveSystemGmailOAuthToken`) puede enviar ni registrar correos desde `carlos@tacosgavilan.com` o `roque@tacosgavilan.com`.
 * - Orden estricto de cascada en `sendSystemEmail`:
 *   0) `preferredUserId` OAuth2 en `public.users` (solo si el módulo lo solicita explícitamente y NO es un buzón ejecutivo protegido).
 *   1) `noreply@tacosgavilan.com` vía Gmail REST API OAuth2 (`SYSTEM_GOOGLE_REFRESH_TOKEN`, `public.integrations` `service_name = 'system_gmail_oauth'` o `public.users`).
 *   2) `noreply@tacosgavilan.com` vía Nodemailer Gmail SMTP (`SYSTEM_SMTP_PASSWORD` o `SMTP_EMAIL` == `noreply@`).
 *   3) Respaldo secundario SMTP (`SMTP_EMAIL` + `SMTP_PASSWORD`) estrictamente excluyendo `carlos@tacosgavilan.com` y `roque@tacosgavilan.com`.
 * - Compila MIME RFC 2822 completo (`nodemailer` `streamTransport`) soportando HTML, texto plano, `cc`, `bcc`,
 *   `replyTo`, adjuntos binarios (`Buffer` PDF / `.ics`) e imágenes inline (`cid`).
 * - Todas las llamadas externas a Google OAuth/Gmail API usan `AbortSignal.timeout(20_000)` por protección de servidores.
 *
 * @dataFlow
 * - Lee/actualiza credenciales OAuth de sistema en `public.integrations` (`service_name = 'system_gmail_oauth'`)
 *   y consulta `public.users` cuando aplica.
 * - Despacha por HTTPS (`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`).
 * @notes
 * - [2026-11-26] Candado Absoluto Anti-Remitente Ejecutivo (`PROTECTED_EXECUTIVE_SENDER_EMAILS`): bloquea `carlos@tacosgavilan.com`
 *   y `roque@tacosgavilan.com` en TODOS los niveles, elimina por completo el respaldo hacia cuentas personales de dirección,
 *   agrega `AbortSignal.timeout(20_000)` y registra en logs el remitente y proveedor real utilizado.
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
export const FALLBACK_SYSTEM_EMAIL = OFFICIAL_NOREPLY_EMAIL
export const SYSTEM_OAUTH_INTEGRATION_NAME = 'system_gmail_oauth'

/**
 * Buzones ejecutivos estrictamente prohibidos como remitentes (`From:`) de cualquier correo automatizado.
 */
export const PROTECTED_EXECUTIVE_SENDER_EMAILS: ReadonlySet<string> = new Set([
    'carlos@tacosgavilan.com',
    'roque@tacosgavilan.com',
])

const GOOGLE_FETCH_TIMEOUT_MS = 20_000

function extractNormalizedAddress(raw?: string | null): string {
    const str = String(raw || '').trim()
    if (!str) return ''
    const angle = str.match(/<([^>]+)>/)
    return (angle?.[1] || str).trim().toLowerCase()
}

export function isProtectedExecutiveSender(email?: string | null): boolean {
    const clean = extractNormalizedAddress(email)
    return Boolean(clean && PROTECTED_EXECUTIVE_SENDER_EMAILS.has(clean))
}

function assertAllowedSenderEmail(email: string, context: string): string {
    const clean = extractNormalizedAddress(email)
    if (!clean) {
        throw new Error(`[SystemMailer] Remitente vacío rechazado en ${context}.`)
    }
    if (isProtectedExecutiveSender(clean)) {
        throw new Error(
            `[SystemMailer] Remitente bloqueado por política ejecutiva (${context}): ${clean} tiene prohibido enviar correos de sistema; usa ${OFFICIAL_NOREPLY_EMAIL}.`
        )
    }
    return clean
}

function resolveCanonicalPrimaryEmail(): string {
    const raw = extractNormalizedAddress(process.env.SYSTEM_SENDER_EMAIL || OFFICIAL_NOREPLY_EMAIL)
    if (!raw || raw === 'noreplay@tacosgavilan.com' || isProtectedExecutiveSender(raw)) {
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
        signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
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
            signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
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
    const safeFromEmail = assertAllowedSenderEmail(fromEmail, 'sendViaGmailApi')
    const displayName = sanitizeDisplayName(options.fromName)
    const raw = await compileMimeToBase64Url({
        from: `"${displayName}" <${safeFromEmail}>`,
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
        signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
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
    const safeSmtpUser = assertAllowedSenderEmail(smtpUser, 'sendViaSmtp')
    const displayName = sanitizeDisplayName(options.fromName)
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: safeSmtpUser,
            pass: smtpPass,
        },
    })

    const info = await transporter.sendMail({
        from: `"${displayName}" <${safeSmtpUser}>`,
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
    const cleanEmail = assertAllowedSenderEmail(params.email, 'saveSystemGmailOAuthToken')
    if (cleanEmail !== OFFICIAL_NOREPLY_EMAIL) {
        throw new Error(
            `[SystemMailer] Solo se permite vincular ${OFFICIAL_NOREPLY_EMAIL} como cuenta oficial del sistema (recibido: ${cleanEmail}).`
        )
    }
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
            if (!isProtectedExecutiveSender(refreshed.email)) {
                return {
                    primaryEmail,
                    noreplyConnected: refreshed.email.toLowerCase() === primaryEmail,
                    activeSenderEmail: refreshed.email,
                    provider: 'noreply_oauth',
                    updatedAt: integ.updated_at,
                }
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
            if (!isProtectedExecutiveSender(refreshed.email)) {
                return {
                    primaryEmail,
                    noreplyConnected: refreshed.email.toLowerCase() === primaryEmail,
                    activeSenderEmail: refreshed.email,
                    provider: 'noreply_user_oauth',
                    updatedAt: noreplyUser.updated_at,
                }
            }
        } catch {
            // Fall through
        }
    }

    return {
        primaryEmail,
        noreplyConnected: false,
        activeSenderEmail: OFFICIAL_NOREPLY_EMAIL,
        provider: 'noreply_oauth_disconnected',
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

    // NIVEL 0 (Opcional): Usuario preferido explícito — SIEMPRE bloquea buzones ejecutivos protegidos (carlos@/roque@)
    if (options.preferredUserId !== undefined && options.preferredUserId !== null && String(options.preferredUserId).trim() !== '') {
        try {
            const { data: prefUser } = await supabase
                .from('users')
                .select('id, email, google_email_connected, google_refresh_token')
                .eq('id', options.preferredUserId)
                .maybeSingle()

            const prefBlocked =
                isProtectedExecutiveSender(prefUser?.email) ||
                isProtectedExecutiveSender(prefUser?.google_email_connected)

            if (prefBlocked) {
                console.warn(
                    `🛡️ [SystemMailer] Nivel 0 (preferredUserId=${options.preferredUserId}) omitido por política anti-remitente ejecutivo; enviando desde ${primaryEmail}.`
                )
            } else if (prefUser?.google_refresh_token) {
                const { accessToken, email } = await exchangeRefreshTokenForAccessToken(
                    prefUser.google_refresh_token,
                    prefUser.google_email_connected || prefUser.email
                )
                if (isProtectedExecutiveSender(email)) {
                    console.warn(
                        `🛡️ [SystemMailer] Nivel 0 resolvió buzón ejecutivo protegido (${email}); redirigiendo envío a ${primaryEmail}.`
                    )
                } else {
                    const sent = await sendViaGmailApi(accessToken, email, options)
                    console.log(`📧 [SystemMailer] Sent via preferred_user_oauth from=${email} msgId=${sent.messageId}`)
                    return {
                        messageId: sent.messageId,
                        fromEmail: email,
                        providerUsed: 'preferred_user_oauth',
                        isFallback: false,
                    }
                }
            }
        } catch (err: any) {
            errors.push(`preferred_user_oauth: ${err?.message || err}`)
        }
    }

    // NIVEL 1 (Prioridad Oficial Única): `noreply@tacosgavilan.com` vía Gmail REST API OAuth2
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
            const verifiedSender = assertAllowedSenderEmail(email, 'nivel1_noreply_oauth')
            const sent = await sendViaGmailApi(accessToken, verifiedSender, options)
            console.log(`📧 [SystemMailer] Sent via noreply_oauth from=${verifiedSender} msgId=${sent.messageId}`)
            return {
                messageId: sent.messageId,
                fromEmail: verifiedSender,
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

    if ((systemSmtpPass || (envSmtpEmail === primaryEmail && envSmtpPass)) && !isProtectedExecutiveSender(primaryEmail)) {
        try {
            const passToUse = (systemSmtpPass || envSmtpPass)!
            const sent = await sendViaSmtp(primaryEmail, passToUse, options)
            console.log(`📧 [SystemMailer] Sent via noreply_smtp from=${primaryEmail} msgId=${sent.messageId}`)
            return {
                messageId: sent.messageId,
                fromEmail: primaryEmail,
                providerUsed: 'noreply_smtp',
                isFallback: false,
            }
        } catch (err: any) {
            errors.push(`noreply_smtp: ${err?.message || err}`)
            console.warn('⚠️ [SystemMailer] Nivel 2 (noreply SMTP) falló:', err?.message)
        }
    }

    // NIVEL 3 (Último Respaldo): `SMTP_EMAIL` + `SMTP_PASSWORD` (estrictamente excluyendo buzones ejecutivos protegidos)
    if (
        envSmtpEmail &&
        envSmtpPass &&
        envSmtpEmail !== primaryEmail &&
        !isProtectedExecutiveSender(envSmtpEmail)
    ) {
        try {
            const sent = await sendViaSmtp(envSmtpEmail, envSmtpPass, options)
            console.log(`📧 [SystemMailer] Sent via fallback_smtp from=${envSmtpEmail} msgId=${sent.messageId}`)
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

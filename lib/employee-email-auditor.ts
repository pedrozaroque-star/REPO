/**
 * @module lib/employee-email-auditor
 * @description Motor automatizado de auditoría semanal de correos electrónicos de empleados activos
 * en todas las sucursales de Tacos Gavilan y despacho automático de alertas de corrección en Toast POS
 * a cada Store Manager (con copia CC a su Supervisor de Zona) más resumen ejecutivo a Dirección Operativa.
 *
 * @businessRules
 * 1. Sincronización previa en vivo desde Toast POS (`syncToastEmployees`):
 *    - Antes de auditar, sincroniza el padrón de las 15 sucursales activas directamente desde Toast API
 *      para reflejar cualquier corrección reciente o nuevo ingreso capturado en Toast POS sin depender
 *      de que el gerente haya presionado manualmente "Sincronizar Empleados" en `/planificador`.
 * 2. Criterio estricto de Empleado Activo de Tienda:
 *    - `COALESCE(deleted, false) = false` Y `(turnos en últimos 30 días > 0 O ponches en últimos 30 días > 0 O alta en Toast <= 14 días)`.
 *    - Excluye cuentas virtuales de sistema/POS (`@toasttab.com`, `@tryotter.com`, `Kiosk`, `Online Ordering`,
 *      `TDS Driver`, `Gavilan SG`, etc.) y registros corporativos multitienda duplicados.
 * 3. Verificación Multicapa Real + Caché Persistente en Supabase (`integrations.service_name = 'employee_email_audit_state'`):
 *    - Capa 1 (Universal): Detección de correos ficticios (`@example.com`), dominios mal escritos (`@gamail.com`,
 *      `@gmial.com`, `@gnail.com`, `@hotmal.com`, etc.), reglas estrictas por proveedor (ej. Gmail prohíbe `_` y `-`,
 *      6–30 caracteres; iCloud 3–20 caracteres; Yahoo inicia con letra) y cruce del directorio corporativo `@tacosgavilan.com`
 *      contra `public.users`.
 *    - Capa 2 (HTTPS Cloud): API oficial de credenciales de Microsoft (`GetCredentialType`) para `@hotmail.com`,
 *      `@outlook.com`, `@live.com` y `@msn.com`; ProtonMail PKS y resolución `DNS MX` para dominios personalizados.
 *    - Capa 3 (Live TCP Port 25 `SMTP RCPT TO` + Caché Persistente): Cuando el entorno tiene salida en puerto 25
 *      hacia `gmail-smtp-in.l.google.com`, verifica en tiempo real la existencia exacta de cada buzón `@gmail.com`
 *      (`250 OK` vs `550 5.1.1 NoSuchUser` vs `452 4.2.2 OverQuotaTemp` buzón lleno al 100%) y persiste el resultado
 *      en Supabase (`smtpCache`). Cuando corre en Vercel Serverless (donde AWS Lambda bloquea puerto 25), combina
 *      las Capas 1 y 2 en vivo con el `smtpCache` persistido en Supabase para conservar detección de cuentas
 *      inexistentes sin cambios y buzones llenos recientes.
 * 4. Despacho Automático Anti-Duplicados (Sábados por la tarde, `America/Los_Angeles`):
 *    - Envía desde la cuenta Google OAuth de `carlos@tacosgavilan.com` un correo personalizado a cada Store Manager
 *      cuya tienda tenga 1+ empleados con correo inválido/inexistente/lleno (`CC` Supervisor de Zona), más un
 *      Resumen Ejecutivo Semanal a `carlos@tacosgavilan.com`.
 *    - Registra `lastDispatchedDateLA` en Supabase para garantizar idempotencia (cero envíos duplicados el mismo día).
 *
 * @dataFlow
 * - Cron / Runner -> `syncToastEmployees` (15 tiendas) -> Paginación Supabase (`stores`, `users`, `toast_employees`,
 *   `shifts`, `punches`, `integrations`) -> Verificación Multicapa + Sugerencias -> Gmail API (`carlos@tacosgavilan.com`) ->
 *   Persistencia de estado y caché en `integrations` (`employee_email_audit_state`).
 *
 * @notes
 * - Nombre oficial de marca aplicado estrictamente: **Tacos Gavilan** (nunca "Tacos El Gavilan").
 * - Usa paginación explícita `.range()` en `toast_employees`, `shifts` y `punches` para evitar truncamiento de 1,000 filas.
 */

import net from 'net'
import { promises as dns } from 'dns'
import nodemailer from 'nodemailer'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { syncToastEmployees } from '@/lib/toast-labor'

export type EmailIssueType =
    | 'VALID'
    | 'INVALID_PLACEHOLDER'
    | 'INVALID_TYPO_DOMAIN'
    | 'INVALID_SYNTAX'
    | 'INVALID_PROVIDER_RULE'
    | 'INVALID_DOMAIN_NO_MX'
    | 'INVALID_NONEXISTENT'
    | 'INVALID_OVERQUOTA'
    | 'INVALID_CORPORATE_MISMATCH'

export interface SmtpCacheEntry {
    status: 'VALID' | 'INVALID_NONEXISTENT' | 'INVALID_OVERQUOTA'
    detail: string
    verifiedAt: string
    suggestedCandidate?: string
    suggestedValid?: boolean
}

export interface AuditedEmployeeIssue {
    employeeId: string
    name: string
    phone: string
    currentEmail: string
    storeId: number
    storeCode: string
    storeName: string
    issueType: Exclude<EmailIssueType, 'VALID'>
    issueBadge: string
    issueColor: string
    issueDetail: string
    actionRequired: string
    suggestedEmail?: string
    shifts30d: number
    punches30d: number
}

export interface StoreManagerAuditGroup {
    storeId: number
    storeCode: string
    storeName: string
    managerName: string
    managerEmail: string
    supervisorName: string
    supervisorEmail: string
    employees: AuditedEmployeeIssue[]
    messageId?: string
}

export interface EmployeeEmailAuditResult {
    executedAt: string
    dateLA: string
    port25Available: boolean
    toastSyncedStores: number
    toastSyncedEmployees: number
    totalActiveEmployeesAudited: number
    uniqueEmailsVerified: number
    validEmployeesCount: number
    flaggedEmployeesCount: number
    affectedStoresCount: number
    cleanStores: string[]
    skippedDuplicateSameDay: boolean
    dryRun: boolean
    managerEmailsSent: number
    summaryEmailMessageId?: string
    storeGroups: StoreManagerAuditGroup[]
}

export interface AuditRunOptions {
    dryRun?: boolean
    force?: boolean
    syncToastFirst?: boolean
    testTo?: string | null
    seedCacheOnly?: boolean
}

const INTEGRATION_STATE_KEY = 'employee_email_audit_state'

const GMAIL_MX_HOSTS = [
    'gmail-smtp-in.l.google.com',
    'alt1.gmail-smtp-in.l.google.com',
    'alt2.gmail-smtp-in.l.google.com',
]

const NON_ROUTABLE_PLACEHOLDER_DOMAINS = new Set([
    'example.com',
    'example.org',
    'example.net',
    'test.com',
    'invalid',
    'localhost',
])

const POS_SYSTEM_EMAIL_DOMAINS = new Set(['toasttab.com', 'tryotter.com'])

const POS_BOT_EXACT_NAMES = new Set([
    'default online ordering',
    'tds driver',
    'toast support',
    'online ordering',
    'kiosk kiosk',
    'gavilan sg',
])

const KNOWN_TYPO_DOMAINS: Record<string, string> = {
    'gamail.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gnail.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com',
    'hotmal.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'hormail.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outllok.com': 'outlook.com',
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'iclod.com': 'icloud.com',
    'icoud.com': 'icloud.com',
}

const EXTRA_KNOWN_CORP_EMAILS = new Set([
    'eliseo@tacosgavilan.com',
    'alex@tacosgavilan.com',
])

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getLosAngelesDateISO(d: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value || '2026'
    const m = parts.find((p) => p.type === 'month')?.value || '01'
    const day = parts.find((p) => p.type === 'day')?.value || '01'
    return `${y}-${m}-${day}`
}

export function normalizeAuditText(s: string): string {
    return (s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

export function formatUsPhone(raw?: string | null): string {
    if (!raw || !raw.trim()) return 'Sin teléfono en Toast'
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    }
    if (digits.length === 11 && digits.startsWith('1')) {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
    }
    return raw.trim()
}

function escapeHtml(s: string): string {
    return (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

async function fetchAllPaginated<T = any>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    pageSize = 1000
): Promise<T[]> {
    const all: T[] = []
    let offset = 0
    while (true) {
        const { data, error } = await buildQuery(offset, offset + pageSize - 1)
        if (error) throw new Error(`Supabase paginated query error: ${error.message}`)
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < pageSize) break
        offset += pageSize
    }
    return all
}

export async function probePort25Reachability(): Promise<boolean> {
    return new Promise((resolve) => {
        const sock = net.createConnection({
            host: 'gmail-smtp-in.l.google.com',
            port: 25,
            timeout: 3200,
        })
        let settled = false
        const done = (ok: boolean) => {
            if (settled) return
            settled = true
            try {
                sock.write('QUIT\r\n')
            } catch {}
            try {
                sock.destroy()
            } catch {}
            resolve(ok)
        }
        sock.on('data', (chunk) => {
            const text = chunk.toString('utf8')
            if (text.startsWith('220')) done(true)
            else done(false)
        })
        sock.on('timeout', () => done(false))
        sock.on('error', () => done(false))
    })
}

function smtpProbeOnce(
    email: string,
    mxHost: string
): Promise<{ code: number; response: string }> {
    return new Promise((resolve) => {
        const sock = net.createConnection({ host: mxHost, port: 25, timeout: 9000 })
        let step = 0
        let buf = ''
        let finished = false
        const recentLines: string[] = []

        const finish = (code: number, response: string) => {
            if (finished) return
            finished = true
            try {
                sock.write('QUIT\r\n')
            } catch {}
            try {
                sock.destroy()
            } catch {}
            resolve({ code, response })
        }

        sock.on('data', (chunk) => {
            buf += chunk.toString('utf8')
            const lines = buf.split('\r\n')
            buf = lines.pop() || ''
            for (const line of lines) {
                if (!line) continue
                recentLines.push(line)
                if (line.length >= 4 && line[3] === '-') continue
                const code = parseInt(line.slice(0, 3), 10)
                if (step === 0 && code === 220) {
                    step = 1
                    sock.write('EHLO tacosgavilan.com\r\n')
                } else if (step === 1 && code === 250) {
                    step = 2
                    sock.write('MAIL FROM:<carlos@tacosgavilan.com>\r\n')
                } else if (step === 2 && code === 250) {
                    step = 3
                    sock.write(`RCPT TO:<${email}>\r\n`)
                } else if (step === 3) {
                    finish(code, recentLines.slice(-3).join(' '))
                    return
                } else {
                    finish(code, line)
                    return
                }
            }
        })

        sock.on('timeout', () => finish(0, 'TIMEOUT'))
        sock.on('error', (err) => finish(-1, err.message))
    })
}

async function verifyGmailViaPort25(email: string): Promise<{
    status: 'VALID' | 'INVALID_NONEXISTENT' | 'INVALID_OVERQUOTA' | 'INDETERMINATE'
    detail: string
}> {
    for (let attempt = 0; attempt < GMAIL_MX_HOSTS.length; attempt++) {
        const res = await smtpProbeOnce(email, GMAIL_MX_HOSTS[attempt])
        if (res.code === 250) {
            return { status: 'VALID', detail: res.response }
        }
        if (res.code === 452 && /4\.2\.2|OverQuota|storage space/i.test(res.response)) {
            return {
                status: 'INVALID_OVERQUOTA',
                detail: 'Error 452 4.2.2 Out of storage space (buzón de Google lleno al 100%)',
            }
        }
        if (res.code === 550 || res.code === 551 || res.code === 553) {
            if (!res.response.includes('5.7.1')) {
                return {
                    status: 'INVALID_NONEXISTENT',
                    detail: `Error ${res.code} NoSuchUser (la cuenta no existe en Gmail)`,
                }
            }
        }
        await sleep(900 * (attempt + 1))
    }
    return { status: 'INDETERMINATE', detail: 'Temporary SMTP timeout or rate limit' }
}

async function verifyMicrosoftMailbox(email: string): Promise<{
    status: 'VALID' | 'INVALID_NONEXISTENT' | 'INDETERMINATE'
    detail: string
}> {
    try {
        const res = await fetch('https://login.microsoftonline.com/common/GetCredentialType', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Username: email, isOtherIdpSupported: true }),
        })
        if (!res.ok) {
            return { status: 'INDETERMINATE', detail: `HTTP ${res.status}` }
        }
        const data = await res.json()
        if (data.IfExistsResult === 0 || data.IfExistsResult === 5 || data.IfExistsResult === 6) {
            return { status: 'VALID', detail: `IfExistsResult=${data.IfExistsResult}` }
        }
        if (data.IfExistsResult === 1) {
            return {
                status: 'INVALID_NONEXISTENT',
                detail: 'Microsoft reporta que esta cuenta NO existe (Address not found)',
            }
        }
        return { status: 'INDETERMINATE', detail: `IfExistsResult=${data.IfExistsResult}` }
    } catch (err: any) {
        return { status: 'INDETERMINATE', detail: err.message }
    }
}

export function validateProviderSyntax(rawEmail: string): {
    ok: boolean
    issueType?: 'INVALID_SYNTAX' | 'INVALID_PLACEHOLDER' | 'INVALID_TYPO_DOMAIN' | 'INVALID_PROVIDER_RULE'
    reason?: string
    suggestedEmail?: string
    cleanEmail: string
    local: string
    domain: string
} {
    const trimmed = (rawEmail || '').trim()
    if (!trimmed) {
        return {
            ok: false,
            issueType: 'INVALID_SYNTAX',
            reason: 'El empleado no tiene ningún correo capturado en Toast POS.',
            cleanEmail: '',
            local: '',
            domain: '',
        }
    }
    if (/\s/.test(trimmed)) {
        return {
            ok: false,
            issueType: 'INVALID_SYNTAX',
            reason: 'El correo contiene espacios intermedios inválidos.',
            cleanEmail: trimmed.toLowerCase(),
            local: '',
            domain: '',
        }
    }

    const parts = trimmed.split('@')
    if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
        return {
            ok: false,
            issueType: 'INVALID_SYNTAX',
            reason: 'Formato de correo inválido (falta "@" o dominio incompleto).',
            cleanEmail: trimmed.toLowerCase(),
            local: parts[0] || '',
            domain: (parts[1] || '').toLowerCase(),
        }
    }

    const local = parts[0]
    const localLower = local.toLowerCase()
    const domain = parts[1].toLowerCase()
    const cleanEmail = `${localLower}@${domain}`

    if (NON_ROUTABLE_PLACEHOLDER_DOMAINS.has(domain)) {
        return {
            ok: false,
            issueType: 'INVALID_PLACEHOLDER',
            reason: `Tiene un correo ficticio temporal (@${domain}) generado automáticamente por Toast cuando no se captura un correo real.`,
            cleanEmail,
            local: localLower,
            domain,
        }
    }

    if (KNOWN_TYPO_DOMAINS[domain]) {
        const fixedDomain = KNOWN_TYPO_DOMAINS[domain]
        return {
            ok: false,
            issueType: 'INVALID_TYPO_DOMAIN',
            reason: `El dominio fue escrito como "@${domain}" en lugar de "@${fixedDomain}", por lo que ningún correo puede entregarse.`,
            suggestedEmail: `${localLower}@${fixedDomain}`,
            cleanEmail,
            local: localLower,
            domain,
        }
    }

    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
        return {
            ok: false,
            issueType: 'INVALID_SYNTAX',
            reason: 'Contiene caracteres especiales o acentos no permitidos en direcciones de correo.',
            cleanEmail,
            local: localLower,
            domain,
        }
    }

    if (localLower.startsWith('.') || localLower.endsWith('.') || localLower.includes('..')) {
        return {
            ok: false,
            issueType: 'INVALID_SYNTAX',
            reason: 'Contiene puntos consecutivos ("..") o empieza/termina con punto antes del "@".',
            cleanEmail,
            local: localLower,
            domain,
        }
    }

    if (domain === 'gmail.com') {
        if (/[-_]/.test(localLower) || !/^[a-z0-9.]+$/.test(localLower)) {
            const stripped = localLower.replace(/[_-]+/g, '')
            return {
                ok: false,
                issueType: 'INVALID_PROVIDER_RULE',
                reason: 'Gmail no permite guiones bajos ("_") ni guiones ("-") en las cuentas de correo.',
                suggestedEmail: stripped.length >= 6 ? `${stripped}@gmail.com` : undefined,
                cleanEmail,
                local: localLower,
                domain,
            }
        }
        const withoutDots = localLower.replace(/\./g, '')
        if (withoutDots.length < 6 || withoutDots.length > 30) {
            return {
                ok: false,
                issueType: 'INVALID_PROVIDER_RULE',
                reason: `Longitud inválida para @gmail.com (${withoutDots.length} caracteres; Google exige entre 6 y 30).`,
                cleanEmail,
                local: localLower,
                domain,
            }
        }
    } else if (domain === 'icloud.com') {
        if (localLower.length < 3 || localLower.length > 20 || !/^[a-z0-9._]+$/.test(localLower)) {
            return {
                ok: false,
                issueType: 'INVALID_PROVIDER_RULE',
                reason: `Formato inválido para @icloud.com (Apple exige entre 3 y 20 caracteres alfanuméricos, punto o guion bajo).`,
                cleanEmail,
                local: localLower,
                domain,
            }
        }
    } else if (domain === 'yahoo.com') {
        if (localLower.length < 4 || localLower.length > 32 || !/^[a-z][a-z0-9._]*$/.test(localLower)) {
            return {
                ok: false,
                issueType: 'INVALID_PROVIDER_RULE',
                reason: `Formato inválido para @yahoo.com (Yahoo exige iniciar con letra y entre 4 y 32 caracteres).`,
                cleanEmail,
                local: localLower,
                domain,
            }
        }
    }

    return { ok: true, cleanEmail, local: localLower, domain }
}

function generateTypoCandidates(cleanEmail: string): string[] {
    const [local, domain] = cleanEmail.split('@')
    if (!local || !domain) return []
    const candidates: string[] = []
    if (domain === 'hotmail.com' || domain === 'outlook.com' || domain === 'live.com') {
        if (local.includes('treita')) candidates.push(`${local.replace('treita', 'treinta')}@${domain}`)
    }
    if (domain === 'gmail.com') {
        if (local.includes('_') || local.includes('-')) {
            candidates.push(`${local.replace(/[_-]+/g, '')}@gmail.com`)
        }
        if (local.includes('latorre') && !local.includes('delatorre')) {
            candidates.push(`${local.replace('latorre', 'delatorre')}@gmail.com`)
        }
    }
    return Array.from(new Set(candidates)).filter((c) => c !== cleanEmail)
}

interface StoredAuditState {
    lastDispatchedDateLA?: string
    lastRunAt?: string
    smtpCache?: Record<string, SmtpCacheEntry>
}

async function loadAuditState(supabase: any): Promise<{ rowId: string | null; state: StoredAuditState }> {
    try {
        const { data } = await supabase
            .from('integrations')
            .select('id, access_token')
            .eq('service_name', INTEGRATION_STATE_KEY)
            .maybeSingle()

        if (!data) return { rowId: null, state: { smtpCache: {} } }
        const parsed = JSON.parse(data.access_token || '{}')
        return {
            rowId: data.id,
            state: {
                lastDispatchedDateLA: parsed.lastDispatchedDateLA,
                lastRunAt: parsed.lastRunAt,
                smtpCache: parsed.smtpCache || {},
            },
        }
    } catch {
        return { rowId: null, state: { smtpCache: {} } }
    }
}

async function saveAuditState(
    supabase: any,
    existingRowId: string | null,
    state: StoredAuditState
): Promise<void> {
    const payloadStr = JSON.stringify(state)
    const nowIso = new Date().toISOString()
    if (existingRowId) {
        const { error } = await supabase
            .from('integrations')
            .update({
                access_token: payloadStr,
                updated_at: nowIso,
            })
            .eq('id', existingRowId)
        if (error) throw new Error(`Failed updating ${INTEGRATION_STATE_KEY}: ${error.message}`)
    } else {
        const { error } = await supabase.from('integrations').insert({
            service_name: INTEGRATION_STATE_KEY,
            access_token: payloadStr,
            refresh_token: 'employee_email_audit',
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        })
        if (error) throw new Error(`Failed inserting ${INTEGRATION_STATE_KEY}: ${error.message}`)
    }
}

async function getCarlosGmailAuth(supabase: any): Promise<{ accessToken: string; fromEmail: string }> {
    const { data: carlos, error } = await supabase
        .from('users')
        .select('id, email, google_refresh_token, google_email_connected')
        .eq('email', 'carlos@tacosgavilan.com')
        .single()

    if (error || !carlos?.google_refresh_token) {
        throw new Error('No se encontró token Google OAuth activo para carlos@tacosgavilan.com')
    }

    const params = new URLSearchParams()
    params.append('client_id', process.env.GOOGLE_CLIENT_ID!)
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!)
    params.append('refresh_token', carlos.google_refresh_token)
    params.append('grant_type', 'refresh_token')

    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    })

    if (!refreshRes.ok) {
        const errText = await refreshRes.text()
        throw new Error(`Fallo al refrescar token OAuth de Carlos: ${errText}`)
    }

    const tokens = await refreshRes.json()
    return {
        accessToken: tokens.access_token as string,
        fromEmail: carlos.google_email_connected || carlos.email,
    }
}

async function sendGmailMessage(
    accessToken: string,
    mailOptions: { from: string; to: string; cc?: string; subject: string; html: string }
): Promise<string> {
    const compiler = nodemailer.createTransport({
        streamTransport: true,
        newline: 'windows',
    })
    const info = await compiler.sendMail(mailOptions)
    const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
        const message = info.message as any
        if (Buffer.isBuffer(message)) return resolve(message)
        const chunks: Buffer[] = []
        message.on('data', (chunk: Buffer) => chunks.push(chunk))
        message.on('end', () => resolve(Buffer.concat(chunks)))
        message.on('error', (err: Error) => reject(err))
    })

    const raw = rawBuffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
    })

    const data = await res.json()
    if (!res.ok) {
        throw new Error(`Gmail API send failed (${res.status}): ${JSON.stringify(data)}`)
    }
    return data.id as string
}

function buildStoreManagerHtml(group: StoreManagerAuditGroup, dateLA: string): string {
    const count = group.employees.length
    const plural = count > 1

    const cards = group.employees
        .map(
            (emp, idx) => `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 5px solid ${emp.issueColor}; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
                <div style="font-size: 16px; font-weight: 800; color: #0f172a;">
                    ${idx + 1}. ${escapeHtml(emp.name)}
                </div>
                <span style="display: inline-block; background: ${emp.issueColor}; color: #ffffff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.3px;">
                    ${escapeHtml(emp.issueBadge)}
                </span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
                <tr>
                    <td style="padding: 4px 0; width: 155px; font-weight: 700; color: #475569;">📱 Teléfono:</td>
                    <td style="padding: 4px 0;">${escapeHtml(emp.phone)}</td>
                </tr>
                <tr>
                    <td style="padding: 4px 0; font-weight: 700; color: #475569;">📧 Correo en Toast:</td>
                    <td style="padding: 4px 0;"><code style="background: #fef2f2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-size: 13px; font-weight: 700;">${escapeHtml(emp.currentEmail)}</code></td>
                </tr>
                <tr>
                    <td style="padding: 4px 0; font-weight: 700; color: #475569; vertical-align: top;">⚠️ Problema:</td>
                    <td style="padding: 4px 0; color: #1e293b;">${escapeHtml(emp.issueDetail)}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0 2px 0; font-weight: 700; color: #15803d; vertical-align: top;">✅ Acción requerida:</td>
                    <td style="padding: 6px 0 2px 0; color: #14532d; font-weight: 600;">${escapeHtml(emp.actionRequired)}</td>
                </tr>
            </table>
        </div>`
        )
        .join('')

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <div style="max-width: 660px; margin: 24px auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #166534 0%, #15803d 100%); padding: 24px 28px; color: #ffffff;">
            <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #bbf7d0; margin-bottom: 4px;">
                Tacos Gavilan • Auditoría Semanal Automática (${escapeHtml(dateLA)})
            </div>
            <h1 style="margin: 0; font-size: 21px; font-weight: 800; line-height: 1.3;">
                Acción Requerida en Toast POS — ${escapeHtml(group.storeName)}
            </h1>
        </div>

        <div style="padding: 26px 28px; color: #1e293b; line-height: 1.55; font-size: 14.5px;">
            <p style="margin-top: 0;">
                Hola <strong>${escapeHtml(group.managerName)}</strong>,
            </p>
            <p>
                En la revisión automática semanal del padrón activo de <strong>${escapeHtml(group.storeName)}</strong> detectamos <strong>${count} ${plural ? 'empleados activos cuyos correos presentan' : 'empleado activo cuyo correo presenta'} error de entrega</strong> actualmente en <strong>Toast POS</strong>, lo cual impide que reciban sus horarios y notificaciones:
            </p>

            <div style="background: #f8fafc; padding: 14px; border-radius: 12px; border: 1px solid #e2e8f0; margin: 18px 0;">
                ${cards}
            </div>

            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px 20px; margin-top: 20px;">
                <div style="font-size: 14px; font-weight: 800; color: #166534; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.4px;">
                    📋 Pasos a seguir antes de publicar horarios:
                </div>
                <ol style="margin: 0; padding-left: 20px; color: #14532d; font-size: 13.5px; line-height: 1.65;">
                    <li style="margin-bottom: 6px;">
                        <strong>Verificar con ${plural ? 'cada empleado' : 'el empleado'}:</strong> Revisar en la app de correo de su celular cómo está escrita exactamente su dirección (o que libere espacio en Google si su buzón aparece lleno).
                    </li>
                    <li style="margin-bottom: 6px;">
                        <strong>Corregir en Toast POS:</strong> Entrar a <em>Toast Web &rarr; Employees</em>, abrir el perfil correspondiente, actualizar el campo <strong>Email</strong> y guardar (<em>Save / Publish</em>).
                    </li>
                    <li style="margin-bottom: 6px;">
                        <strong>Sincronizar en el Planificador TEG:</strong> Abrir <a href="https://tacosgavilan.vercel.app/planificador" style="color: #15803d; font-weight: 700;">tacosgavilan.vercel.app/planificador</a> y presionar <strong>"Sincronizar Empleados"</strong>.
                    </li>
                    <li>
                        <strong>Publicar / Reenviar su horario:</strong> Confirmar que el empleado reciba correctamente su horario semanal en su celular.
                    </li>
                </ol>
            </div>

            <p style="margin-top: 18px; margin-bottom: 0;">
                Saludos cordiales,<br />
                <strong>Carlos Velazquez</strong><br />
                <span style="color: #64748b; font-size: 13px;">Tacos Gavilan • carlos@tacosgavilan.com</span>
            </p>
        </div>

        <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 12px 28px; font-size: 11.5px; color: #64748b; text-align: center;">
            Auditoría Semanal Automática de Correos • Tacos Gavilan (CC Supervisor: ${escapeHtml(group.supervisorName)})
        </div>
    </div>
</body>
</html>`
}

function buildExecutiveSummaryHtml(result: EmployeeEmailAuditResult): string {
    const allClean = result.flaggedEmployeesCount === 0
    const headerBg = allClean ? '#15803d' : '#1e293b'

    const rowsHtml = result.storeGroups
        .flatMap((g) =>
            g.employees.map(
                (emp) => `
                <tr>
                    <td style="padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #0f172a;">${escapeHtml(g.storeName)}</td>
                    <td style="padding: 9px 10px; border-bottom: 1px solid #e2e8f0; color: #334155;">${escapeHtml(g.managerName)}<br/><span style="font-size: 11px; color: #64748b;">${escapeHtml(g.managerEmail)}</span></td>
                    <td style="padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1e293b;">${escapeHtml(emp.name)}<br/><span style="font-size: 11px; color: #64748b;">${escapeHtml(emp.phone)}</span></td>
                    <td style="padding: 9px 10px; border-bottom: 1px solid #e2e8f0;"><code style="background: #fef2f2; color: #b91c1c; padding: 2px 5px; border-radius: 4px; font-size: 12px;">${escapeHtml(emp.currentEmail)}</code></td>
                    <td style="padding: 9px 10px; border-bottom: 1px solid #e2e8f0;">
                        <span style="display: inline-block; background: ${emp.issueColor}; color: #fff; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px;">${escapeHtml(emp.issueBadge)}</span>
                    </td>
                </tr>`
            )
        )
        .join('')

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /></head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: Arial, Helvetica, sans-serif;">
    <div style="max-width: 820px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
        <div style="background: ${headerBg}; color: #ffffff; padding: 22px 26px;">
            <div style="font-size: 12px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; opacity: 0.85;">
                Tacos Gavilan • Reporte Ejecutivo Sabatino (${escapeHtml(result.dateLA)})
            </div>
            <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800;">
                ${allClean ? '✅ 100% de Correos de Empleados Activos Válidos' : `📬 Auditoría Semanal de Correos: ${result.flaggedEmployeesCount} Pendientes en ${result.affectedStoresCount} Sucursales`}
            </h1>
        </div>
        <div style="padding: 22px 26px;">
            <table style="width: 100%; border-collapse: separate; border-spacing: 8px; margin-bottom: 16px;">
                <tr>
                    <td style="width: 25%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
                        <div style="font-size: 11px; color: #475569; font-weight: 700; text-transform: uppercase;">Activos Auditados</div>
                        <div style="font-size: 24px; font-weight: 800; color: #0f172a; margin-top: 4px;">${result.totalActiveEmployeesAudited}</div>
                    </td>
                    <td style="width: 25%; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; text-align: center;">
                        <div style="font-size: 11px; color: #166534; font-weight: 700; text-transform: uppercase;">Correos Válidos</div>
                        <div style="font-size: 24px; font-weight: 800; color: #15803d; margin-top: 4px;">${result.validEmployeesCount}</div>
                    </td>
                    <td style="width: 25%; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; text-align: center;">
                        <div style="font-size: 11px; color: #991b1b; font-weight: 700; text-transform: uppercase;">Con Problema</div>
                        <div style="font-size: 24px; font-weight: 800; color: #dc2626; margin-top: 4px;">${result.flaggedEmployeesCount}</div>
                    </td>
                    <td style="width: 25%; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; text-align: center;">
                        <div style="font-size: 11px; color: #1e40af; font-weight: 700; text-transform: uppercase;">Managers Notificados</div>
                        <div style="font-size: 24px; font-weight: 800; color: #1d4ed8; margin-top: 4px;">${result.managerEmailsSent}</div>
                    </td>
                </tr>
            </table>

            ${
                allClean
                    ? `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; color: #14532d; font-size: 14px;">
                        Todas las <strong>15 sucursales</strong> tienen el 100% de sus empleados activos con correos electrónicos verificados y listos para recibir horarios.
                       </div>`
                    : `<table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left; margin-top: 10px;">
                        <thead>
                            <tr style="background: #1e293b; color: #ffffff;">
                                <th style="padding: 9px 10px;">Sucursal</th>
                                <th style="padding: 9px 10px;">Manager Notificado</th>
                                <th style="padding: 9px 10px;">Empleado</th>
                                <th style="padding: 9px 10px;">Correo en Toast</th>
                                <th style="padding: 9px 10px;">Diagnóstico</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                       </table>`
            }

            <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
                <strong>Sucursales 100% limpias (${result.cleanStores.length}):</strong> ${escapeHtml(result.cleanStores.join(', ') || 'Ninguna')}<br/>
                <strong>Modo de verificación:</strong> Toast Sync (${result.toastSyncedStores} tiendas) + Microsoft API + DNS MX + ${result.port25Available ? 'SMTP Puerto 25 en vivo' : 'Caché SMTP Supabase + Validación Estricta Cloud'}
            </div>
        </div>
    </div>
</body>
</html>`
}

export async function runEmployeeEmailAudit(
    options: AuditRunOptions = {}
): Promise<EmployeeEmailAuditResult> {
    const supabase = await getSupabaseAdminClient()
    const dryRun = Boolean(options.dryRun)
    const force = Boolean(options.force)
    const syncToastFirst = options.syncToastFirst !== false
    const seedCacheOnly = Boolean(options.seedCacheOnly)
    const testTo = options.testTo?.trim() || null

    const now = new Date()
    const dateLA = getLosAngelesDateISO(now)

    const { rowId: existingStateId, state: storedState } = await loadAuditState(supabase)
    const smtpCache: Record<string, SmtpCacheEntry> = { ...(storedState.smtpCache || {}) }

    if (
        !dryRun &&
        !force &&
        !testTo &&
        !seedCacheOnly &&
        storedState.lastDispatchedDateLA === dateLA
    ) {
        return {
            executedAt: now.toISOString(),
            dateLA,
            port25Available: false,
            toastSyncedStores: 0,
            toastSyncedEmployees: 0,
            totalActiveEmployeesAudited: 0,
            uniqueEmailsVerified: 0,
            validEmployeesCount: 0,
            flaggedEmployeesCount: 0,
            affectedStoresCount: 0,
            cleanStores: [],
            skippedDuplicateSameDay: true,
            dryRun: false,
            managerEmailsSent: 0,
            storeGroups: [],
        }
    }

    // 1. Load Active Stores & Users (Managers, Supervisors, Corporate Directory)
    const [{ data: storesData, error: storesErr }, { data: usersData, error: usersErr }] =
        await Promise.all([
            supabase
                .from('stores')
                .select('id, code, name, external_id, supervisor_id')
                .eq('is_active', true)
                .order('name'),
            supabase
                .from('users')
                .select('id, full_name, email, role, is_active, store_id, store_scope'),
        ])

    if (storesErr) throw new Error(`Error consultando stores: ${storesErr.message}`)
    if (usersErr) throw new Error(`Error consultando users: ${usersErr.message}`)

    const activeStores = storesData || []
    const allUsers = usersData || []

    // 2. Sync fresh employees from Toast POS across all 15 active stores (in batches of 5)
    let toastSyncedStores = 0
    let toastSyncedEmployees = 0
    if (syncToastFirst) {
        const storeGuids = activeStores.map((s: any) => s.external_id).filter(Boolean) as string[]
        for (let i = 0; i < storeGuids.length; i += 5) {
            const batch = storeGuids.slice(i, i + 5)
            const batchResults = await Promise.all(
                batch.map(async (guid) => {
                    try {
                        return await syncToastEmployees(guid)
                    } catch (err: any) {
                        console.error(`[EMAIL AUDIT] Toast sync warning for ${guid}:`, err.message)
                        return { count: 0, error: err.message }
                    }
                })
            )
            for (const r of batchResults) {
                if (!r.error) toastSyncedStores++
                toastSyncedEmployees += r.count || 0
            }
        }
    }

    // Build corporate directory & store manager/supervisor maps
    const registeredCorporateEmails = new Set<string>(EXTRA_KNOWN_CORP_EMAILS)
    const corpUsersByNormalizedName = new Map<string, string>()
    for (const u of allUsers) {
        if (u.email) {
            const lower = String(u.email).trim().toLowerCase()
            registeredCorporateEmails.add(lower)
            if (lower.endsWith('@tacosgavilan.com') && u.full_name) {
                corpUsersByNormalizedName.set(normalizeAuditText(u.full_name), lower)
            }
        }
    }

    const storeByExternalId = new Map<string, any>()
    for (const s of activeStores) {
        if (s.external_id) storeByExternalId.set(s.external_id, s)
    }

    // 3. Paginated fetch of toast_employees, last-30d shifts, and last-30d punches
    const thirtyDaysAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const cutoff30dISO = getLosAngelesDateISO(thirtyDaysAgoDate)
    const fourteenDaysAgoDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const cutoff14dISO = getLosAngelesDateISO(fourteenDaysAgoDate)

    const [toastEmployees, recentShifts, recentPunches] = await Promise.all([
        fetchAllPaginated((from, to) =>
            supabase
                .from('toast_employees')
                .select(
                    'id, toast_guid, first_name, last_name, chosen_name, email, phone, deleted, created_date, store_ids'
                )
                .eq('deleted', false)
                .range(from, to)
        ),
        fetchAllPaginated((from, to) =>
            supabase
                .from('shifts')
                .select('employee_id, store_id, shift_date, start_time')
                .gte('start_time', new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString())
                .range(from, to)
        ),
        fetchAllPaginated((from, to) =>
            supabase
                .from('punches')
                .select('employee_toast_guid, store_id, business_date')
                .gte('business_date', cutoff30dISO)
                .range(from, to)
        ),
    ])

    // Aggregate shifts & punches by employee
    const shiftStatsByEmpId = new Map<string, { count: number; latestStoreGuid: string; latestDate: string }>()
    for (const sh of recentShifts) {
        if (!sh.employee_id) continue
        const dStr = sh.shift_date || (sh.start_time ? getLosAngelesDateISO(new Date(sh.start_time)) : '')
        if (dStr < cutoff30dISO) continue
        const prev = shiftStatsByEmpId.get(sh.employee_id)
        if (!prev) {
            shiftStatsByEmpId.set(sh.employee_id, {
                count: 1,
                latestStoreGuid: sh.store_id,
                latestDate: dStr,
            })
        } else {
            prev.count++
            if (dStr >= prev.latestDate && sh.store_id) {
                prev.latestDate = dStr
                prev.latestStoreGuid = sh.store_id
            }
        }
    }

    const punchStatsByGuid = new Map<string, { count: number; latestStoreGuid: string; latestDate: string }>()
    for (const pu of recentPunches) {
        if (!pu.employee_toast_guid) continue
        const dStr = String(pu.business_date || '')
        const prev = punchStatsByGuid.get(pu.employee_toast_guid)
        if (!prev) {
            punchStatsByGuid.set(pu.employee_toast_guid, {
                count: 1,
                latestStoreGuid: pu.store_id,
                latestDate: dStr,
            })
        } else {
            prev.count++
            if (dStr >= prev.latestDate && pu.store_id) {
                prev.latestDate = dStr
                prev.latestStoreGuid = pu.store_id
            }
        }
    }

    // Filter to real active store employees
    interface ActiveEmpCandidate {
        id: string
        fullName: string
        phone: string
        rawEmail: string
        store: any
        shifts30d: number
        punches30d: number
    }

    const activeCandidates: ActiveEmpCandidate[] = []
    for (const te of toastEmployees) {
        const rawEmail = String(te.email || '').trim()
        const lowerEmail = rawEmail.toLowerCase()
        const emailDomain = lowerEmail.split('@')[1] || ''
        if (POS_SYSTEM_EMAIL_DOMAINS.has(emailDomain)) continue

        const fullName = `${te.first_name || ''} ${te.last_name || ''}`.replace(/\s+/g, ' ').trim()
        const normName = normalizeAuditText(fullName)
        if (!fullName || POS_BOT_EXACT_NAMES.has(normName)) continue
        if (/\b(kiosk|online ordering|tds driver|toast support)\b/i.test(normName)) continue

        const shStat = shiftStatsByEmpId.get(te.id)
        const puStat = te.toast_guid ? punchStatsByGuid.get(te.toast_guid) : undefined
        const shifts30d = shStat?.count || 0
        const punches30d = puStat?.count || 0

        const createdDateStr = te.created_date ? String(te.created_date).slice(0, 10) : ''
        const isBrandNewHire = Boolean(createdDateStr && createdDateStr >= cutoff14dISO)

        // Skip corporate multi-store records without store shift/punch activity
        if (shifts30d === 0 && punches30d === 0) {
            if (!isBrandNewHire) continue
            if (emailDomain === 'tacosgavilan.com' && registeredCorporateEmails.has(lowerEmail)) continue
        }

        const fallbackStoreGuid = Array.isArray(te.store_ids) ? te.store_ids[0] : null
        const resolvedStoreGuid =
            shStat?.latestStoreGuid || puStat?.latestStoreGuid || fallbackStoreGuid
        const store = resolvedStoreGuid ? storeByExternalId.get(resolvedStoreGuid) : null
        if (!store) continue

        activeCandidates.push({
            id: te.id,
            fullName,
            phone: formatUsPhone(te.phone),
            rawEmail,
            store,
            shifts30d,
            punches30d,
        })
    }

    // 4. Probe Port 25 availability & verify unique emails
    const port25Available = await probePort25Reachability()

    const uniqueRawByNorm = new Map<string, string>()
    for (const c of activeCandidates) {
        const key = c.rawEmail.toLowerCase()
        if (!uniqueRawByNorm.has(key)) uniqueRawByNorm.set(key, c.rawEmail)
    }

    interface VerificationOutcome {
        issueType: EmailIssueType
        detail: string
        suggestedEmail?: string
    }

    const outcomesByNorm = new Map<string, VerificationOutcome>()
    const gmailQueue: string[] = []
    const mxDomainCache = new Map<string, boolean>()

    for (const [normKey, rawEmail] of uniqueRawByNorm.entries()) {
        const syn = validateProviderSyntax(rawEmail)
        if (!syn.ok && syn.issueType) {
            outcomesByNorm.set(normKey, {
                issueType: syn.issueType,
                detail: syn.reason || 'Correo inválido',
                suggestedEmail: syn.suggestedEmail,
            })
            continue
        }

        const { cleanEmail, domain } = syn

        if (domain === 'tacosgavilan.com') {
            if (registeredCorporateEmails.has(cleanEmail)) {
                outcomesByNorm.set(normKey, { issueType: 'VALID', detail: 'Corporativo registrado' })
            } else {
                outcomesByNorm.set(normKey, {
                    issueType: 'INVALID_CORPORATE_MISMATCH',
                    detail: `El correo corporativo ${cleanEmail} no coincide con ninguna cuenta oficial registrada en el sistema TEG.`,
                })
            }
            continue
        }

        if (['hotmail.com', 'live.com', 'outlook.com', 'msn.com'].includes(domain)) {
            const ms = await verifyMicrosoftMailbox(cleanEmail)
            if (ms.status === 'INVALID_NONEXISTENT') {
                let verifiedSuggestion: string | undefined
                for (const cand of generateTypoCandidates(cleanEmail)) {
                    const candCheck = await verifyMicrosoftMailbox(cand)
                    if (candCheck.status === 'VALID') {
                        verifiedSuggestion = cand
                        break
                    }
                }
                outcomesByNorm.set(normKey, {
                    issueType: 'INVALID_NONEXISTENT',
                    detail: ms.detail,
                    suggestedEmail: verifiedSuggestion,
                })
            } else {
                outcomesByNorm.set(normKey, { issueType: 'VALID', detail: ms.detail })
            }
            await sleep(120)
            continue
        }

        if (domain === 'gmail.com') {
            gmailQueue.push(cleanEmail)
            continue
        }

        // Other domains: verify DNS MX records
        let hasMx = mxDomainCache.get(domain)
        if (hasMx === undefined) {
            try {
                const mx = await dns.resolveMx(domain)
                hasMx = Array.isArray(mx) && mx.length > 0
            } catch {
                hasMx = false
            }
            mxDomainCache.set(domain, hasMx)
        }

        if (!hasMx) {
            outcomesByNorm.set(normKey, {
                issueType: 'INVALID_DOMAIN_NO_MX',
                detail: `El dominio "@${domain}" no existe o no recibe correos electrónicos.`,
            })
        } else {
            outcomesByNorm.set(normKey, { issueType: 'VALID', detail: `MX válido (${domain})` })
        }
    }

    // Verify Gmail queue (live Port 25 if reachable, else fallback to Supabase persistent smtpCache)
    if (port25Available) {
        let idx = 0
        const worker = async () => {
            while (true) {
                const currentIdx = idx++
                if (currentIdx >= gmailQueue.length) break
                const email = gmailQueue[currentIdx]
                const res = await verifyGmailViaPort25(email)

                if (res.status === 'VALID') {
                    smtpCache[email] = {
                        status: 'VALID',
                        detail: res.detail,
                        verifiedAt: now.toISOString(),
                    }
                    outcomesByNorm.set(email, { issueType: 'VALID', detail: res.detail })
                } else if (res.status === 'INVALID_NONEXISTENT') {
                    let verifiedSuggestion: string | undefined
                    for (const cand of generateTypoCandidates(email)) {
                        const candRes = await verifyGmailViaPort25(cand)
                        if (candRes.status === 'VALID') {
                            verifiedSuggestion = cand
                            break
                        }
                    }
                    smtpCache[email] = {
                        status: 'INVALID_NONEXISTENT',
                        detail: res.detail,
                        verifiedAt: now.toISOString(),
                        suggestedCandidate: verifiedSuggestion,
                        suggestedValid: Boolean(verifiedSuggestion),
                    }
                    outcomesByNorm.set(email, {
                        issueType: 'INVALID_NONEXISTENT',
                        detail: res.detail,
                        suggestedEmail: verifiedSuggestion,
                    })
                } else if (res.status === 'INVALID_OVERQUOTA') {
                    smtpCache[email] = {
                        status: 'INVALID_OVERQUOTA',
                        detail: res.detail,
                        verifiedAt: now.toISOString(),
                    }
                    outcomesByNorm.set(email, {
                        issueType: 'INVALID_OVERQUOTA',
                        detail: res.detail,
                    })
                } else {
                    // Indeterminate transient timeout: consult cache if available, else assume valid to avoid false alarm
                    const cached = smtpCache[email]
                    if (cached && cached.status !== 'VALID') {
                        outcomesByNorm.set(email, {
                            issueType: cached.status,
                            detail: cached.detail,
                            suggestedEmail: cached.suggestedValid ? cached.suggestedCandidate : undefined,
                        })
                    } else {
                        outcomesByNorm.set(email, { issueType: 'VALID', detail: 'Transient SMTP skip' })
                    }
                }
                await sleep(320)
            }
        }
        await Promise.all([worker(), worker()])

        // Also live-verify suggested Gmail fixes for typo-domain / provider-rule cases
        for (const [normKey, outcome] of outcomesByNorm.entries()) {
            if (outcome.suggestedEmail && outcome.suggestedEmail.endsWith('@gmail.com')) {
                const check = await verifyGmailViaPort25(outcome.suggestedEmail)
                if (check.status !== 'VALID') {
                    outcome.suggestedEmail = undefined
                }
            }
        }
    } else {
        // Cloud mode (Port 25 blocked on AWS Lambda): leverage persistent smtpCache
        const overQuotaMaxAgeMs = 14 * 24 * 60 * 60 * 1000
        for (const email of gmailQueue) {
            const cached = smtpCache[email]
            if (cached?.status === 'INVALID_NONEXISTENT') {
                outcomesByNorm.set(email, {
                    issueType: 'INVALID_NONEXISTENT',
                    detail: cached.detail,
                    suggestedEmail: cached.suggestedValid ? cached.suggestedCandidate : undefined,
                })
            } else if (
                cached?.status === 'INVALID_OVERQUOTA' &&
                now.getTime() - new Date(cached.verifiedAt).getTime() <= overQuotaMaxAgeMs
            ) {
                outcomesByNorm.set(email, {
                    issueType: 'INVALID_OVERQUOTA',
                    detail: cached.detail,
                })
            } else {
                outcomesByNorm.set(email, {
                    issueType: 'VALID',
                    detail: 'Formato Gmail válido',
                })
            }
        }
    }

    // 5. Build flagged employee issues & group by store
    const flaggedIssues: AuditedEmployeeIssue[] = []
    for (const emp of activeCandidates) {
        const normKey = emp.rawEmail.toLowerCase()
        const outcome = outcomesByNorm.get(normKey)
        if (!outcome || outcome.issueType === 'VALID') continue

        let issueBadge = 'CORREO INVÁLIDO'
        let issueColor = '#dc2626'
        let actionRequired =
            'Verificar directamente con el empleado su correo electrónico real en su celular y actualizarlo en Toast POS.'

        if (outcome.issueType === 'INVALID_PLACEHOLDER') {
            issueBadge = 'SIN CORREO REAL CAPTURADO'
            issueColor = '#dc2626'
            actionRequired = `Solicitarle a ${emp.fullName} su correo electrónico personal real y registrarlo en su perfil de Toast POS.`
        } else if (outcome.issueType === 'INVALID_TYPO_DOMAIN') {
            issueBadge = 'DOMINIO MAL ESCRITO'
            issueColor = '#dc2626'
            actionRequired = outcome.suggestedEmail
                ? `Confirmar con ${emp.fullName} y corregirlo en Toast POS a ${outcome.suggestedEmail}.`
                : `Corregir el dominio del correo de ${emp.fullName} en Toast POS.`
        } else if (
            outcome.issueType === 'INVALID_NONEXISTENT' ||
            outcome.issueType === 'INVALID_PROVIDER_RULE' ||
            outcome.issueType === 'INVALID_DOMAIN_NO_MX' ||
            outcome.issueType === 'INVALID_SYNTAX'
        ) {
            issueBadge = 'CORREO NO EXISTE'
            issueColor = '#dc2626'
            actionRequired = outcome.suggestedEmail
                ? `Confirmar con ${emp.fullName} si su correo correcto es ${outcome.suggestedEmail} (cuenta verificada como existente) y corregirlo en Toast POS.`
                : `Revisar en la app de correo del celular de ${emp.fullName} cómo está escrita exactamente su dirección y corregirla en Toast POS.`
        } else if (outcome.issueType === 'INVALID_OVERQUOTA') {
            issueBadge = 'BUZÓN GMAIL LLENO (100%)'
            issueColor = '#ea580c'
            actionRequired = `Pedirle a ${emp.fullName} que libere espacio en su cuenta de Google (Gmail / Google Fotos / Drive) o que proporcione otro correo activo con espacio disponible en Toast POS.`
        } else if (outcome.issueType === 'INVALID_CORPORATE_MISMATCH') {
            issueBadge = 'CORREO MAL ESCRITO EN TOAST'
            issueColor = '#d97706'
            // Try matching employee name against registered corporate users
            const normEmpName = normalizeAuditText(emp.fullName)
            let matchedCorpEmail: string | undefined
            for (const [uName, uEmail] of corpUsersByNormalizedName.entries()) {
                const uTokens = uName.split(' ').filter(Boolean)
                if (uTokens.length >= 2 && uTokens.every((tok) => normEmpName.includes(tok))) {
                    matchedCorpEmail = uEmail
                    break
                }
            }
            actionRequired = matchedCorpEmail
                ? `Actualizar su correo en Toast POS a su cuenta oficial ${matchedCorpEmail} (o a su correo personal activo si él/ella lo prefiere).`
                : `Actualizar su correo en Toast POS a su cuenta oficial registrada o a su correo personal activo.`
        }

        flaggedIssues.push({
            employeeId: emp.id,
            name: emp.fullName,
            phone: emp.phone,
            currentEmail: emp.rawEmail || '(vacío)',
            storeId: emp.store.id,
            storeCode: emp.store.code,
            storeName: `${emp.store.name} #${emp.store.id}`,
            issueType: outcome.issueType,
            issueBadge,
            issueColor,
            issueDetail: outcome.detail,
            actionRequired,
            suggestedEmail: outcome.suggestedEmail,
            shifts30d: emp.shifts30d,
            punches30d: emp.punches30d,
        })
    }

    // Group by Store & resolve Manager + Supervisor dynamically
    const groupsByStoreId = new Map<number, StoreManagerAuditGroup>()
    for (const issue of flaggedIssues) {
        let group = groupsByStoreId.get(issue.storeId)
        if (!group) {
            const store = activeStores.find((s: any) => s.id === issue.storeId)!
            const supervisor = allUsers.find((u: any) => u.id === store.supervisor_id)
            const storeManager = allUsers.find(
                (u: any) =>
                    u.is_active &&
                    u.role === 'manager' &&
                    (u.store_id === store.id ||
                        (Array.isArray(u.store_scope) &&
                            (u.store_scope.includes(store.code) ||
                                u.store_scope.includes(String(store.id)))))
            )

            const supervisorName = supervisor?.full_name || 'Supervisor de Zona'
            const supervisorEmail = supervisor?.email || 'carlos@tacosgavilan.com'
            const managerName = storeManager?.full_name || `Manager ${store.name}`
            const managerEmail = storeManager?.email || supervisorEmail

            group = {
                storeId: store.id,
                storeCode: store.code,
                storeName: `${store.name} #${store.id}`,
                managerName,
                managerEmail,
                supervisorName,
                supervisorEmail,
                employees: [],
            }
            groupsByStoreId.set(issue.storeId, group)
        }
        group.employees.push(issue)
    }

    const storeGroups = Array.from(groupsByStoreId.values()).sort((a, b) =>
        a.storeName.localeCompare(b.storeName)
    )
    for (const g of storeGroups) {
        g.employees.sort((a, b) => a.name.localeCompare(b.name))
    }

    const affectedStoreIds = new Set(storeGroups.map((g) => g.storeId))
    const cleanStores = activeStores
        .filter((s: any) => !affectedStoreIds.has(s.id))
        .map((s: any) => s.name)
        .sort()

    const result: EmployeeEmailAuditResult = {
        executedAt: now.toISOString(),
        dateLA,
        port25Available,
        toastSyncedStores,
        toastSyncedEmployees,
        totalActiveEmployeesAudited: activeCandidates.length,
        uniqueEmailsVerified: uniqueRawByNorm.size,
        validEmployeesCount: activeCandidates.length - flaggedIssues.length,
        flaggedEmployeesCount: flaggedIssues.length,
        affectedStoresCount: storeGroups.length,
        cleanStores,
        skippedDuplicateSameDay: false,
        dryRun: dryRun || seedCacheOnly,
        managerEmailsSent: 0,
        storeGroups,
    }

    // If seedCacheOnly, persist updated smtpCache without marking today as dispatched or sending emails
    if (seedCacheOnly) {
        await saveAuditState(supabase, existingStateId, {
            lastDispatchedDateLA: storedState.lastDispatchedDateLA,
            lastRunAt: now.toISOString(),
            smtpCache,
        })
        return result
    }

    if (dryRun) {
        return result
    }

    // 6. Dispatch Personalized Store Manager Emails + Carlos Executive Summary
    const { accessToken, fromEmail } = await getCarlosGmailAuth(supabase)
    const subjectPrefix = testTo ? '[PRUEBA] ' : ''

    for (const group of storeGroups) {
        const count = group.employees.length
        const subject = `${subjectPrefix}⚠️ Acción Requerida en Toast POS: Corrección de ${
            count === 1 ? 'correo de empleado' : `${count} correos de empleados`
        } — ${group.storeName}`
        const html = buildStoreManagerHtml(group, dateLA)

        const toHeader = testTo
            ? testTo
            : `"${group.managerName}" <${group.managerEmail}>`
        const ccHeader =
            testTo || group.supervisorEmail.toLowerCase() === group.managerEmail.toLowerCase()
                ? undefined
                : `"${group.supervisorName}" <${group.supervisorEmail}>`

        const msgId = await sendGmailMessage(accessToken, {
            from: `"Carlos Velazquez - Tacos Gavilan" <${fromEmail}>`,
            to: toHeader,
            cc: ccHeader,
            subject,
            html,
        })
        group.messageId = msgId
        result.managerEmailsSent++
        await sleep(350)
    }

    // Send Weekly Executive Summary to Carlos
    const summarySubject =
        result.flaggedEmployeesCount === 0
            ? `${subjectPrefix}✅ Auditoría Semanal de Correos: 100% Válidos (${dateLA})`
            : `${subjectPrefix}📬 Resumen Auditoría Semanal de Correos: ${result.flaggedEmployeesCount} pendientes en ${result.affectedStoresCount} sucursales (${dateLA})`

    result.summaryEmailMessageId = await sendGmailMessage(accessToken, {
        from: `"Sistema TEG - Tacos Gavilan" <${fromEmail}>`,
        to: testTo || 'carlos@tacosgavilan.com',
        subject: summarySubject,
        html: buildExecutiveSummaryHtml(result),
    })

    // 7. Persist smtpCache and lastDispatchedDateLA (unless test_to was used)
    await saveAuditState(supabase, existingStateId, {
        lastDispatchedDateLA: testTo ? storedState.lastDispatchedDateLA : dateLA,
        lastRunAt: now.toISOString(),
        smtpCache,
    })

    return result
}

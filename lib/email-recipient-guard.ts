/**
 * @module lib/email-recipient-guard
 * @description Capa centralizada anti-rebotes (*anti-bounce guard*) y resolución de correos entregables
 *   para todos los módulos emisores de correo electrónico de **Tacos Gavilan** (`noreply@tacosgavilan.com`).
 *
 * @businessRules
 * - **Correos Corporativos Reales vs. Logins del Sistema (`@tacosgavilan.com`)**:
 *   1. En `public.users`, los usuarios con rol `asistente` (y alias como `roque@`, `yasmin@`, `admin@`) tienen
 *      direcciones `@tacosgavilan.com` únicamente para iniciar sesión en el portal TEG, SIN buzón real en Google Workspace.
 *   2. Cualquier envío a un `@tacosgavilan.com` sin buzón real rebota con `5.1.3 NoSuchUser` en `noreply@tacosgavilan.com`.
 *   3. `CORPORATE_EMAIL_ALIAS_MAP` redirige canónicamente los alias administrativos a sus buzones reales:
 *      - `roque@tacosgavilan.com` -> `carlos@tacosgavilan.com`
 *      - `alejandro@tacosgavilan.com` -> `alex@tacosgavilan.com`
 *      - `yasmin@tacosgavilan.com` -> `ap@tacosgavilan.com` (buzón real de Cuentas por Pagar / Basecamp).
 *   4. Para los `asistente`, `buildAssistantPersonalEmailIndex` resuelve automáticamente su correo personal real y
 *      verificado desde `public.toast_employees` (`deleted = false`) por `toast_guid` o nombre normalizado + sucursal
 *      (tolerando nombres intermedios y distancia de Levenshtein <= 1 en apellidos como `Cael`/`Calel`).
 *      Si el asistente aún no tiene correo personal válido en Toast POS (ej. tiene su login `@tacosgavilan.com` en Toast),
 *      se omite del envío por correo (0 rebotes) manteniendo su notificación interna en campana (*in-app bell*).
 * - **Bloqueo Dinámico de Correos Externos Rebotados / Buzones Llenos**:
 *   - Consulta el caché persistente de auditoría SMTP (`public.integrations` `service_name = 'employee_email_audit_state'`)
 *     más `KNOWN_BOUNCED_EXTERNAL_EMAILS` (cuentas externas inexistentes verificadas por DSN real, ej. `@icloud.com`):
 *     * `INVALID_NONEXISTENT`: bloqueado permanentemente hasta que se corrija el correo en Toast POS.
 *     * `INVALID_OVERQUOTA` (`452 4.2.2`): bloqueado mientras tenga <= 14 días desde la última verificación SMTP
 *       (se desbloquea automáticamente en cuanto el empleado libera espacio y la auditoría semanal registra `VALID`).
 *
 * @dataFlow
 * - Supabase (`users`, `stores`, `toast_employees`, `integrations[employee_email_audit_state]`) -> caché en memoria (5 min TTL)
 *   -> `loadEmailDeliverabilityContext()` -> consumido por `lib/system-mailer.ts`, `lib/basecamp-person-resolver.ts`,
 *      `lib/basecamp-todo-email.ts`, `lib/inventory/portion-control-alerts.ts`, `lib/inventory/missing-meat-modifier-alerts.ts`,
 *      `lib/inventory/store-portion-coaching-email.ts`, `lib/break-violations-policy.ts`, `lib/ronos-nhp-audit.ts`,
 *      `lib/employee-email-auditor.ts` y crons `/api/cron/sync-violations` y `/api/cron/sync-ronos-violations`.
 *
 * @notes
 * - [2026-11-25] Creado tras auditoría forense completa de los 47 rebotes del buzón `noreply@tacosgavilan.com`.
 * - Sin dependencias hacia otros módulos de correo para evitar importaciones circulares.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const CORPORATE_DOMAIN = 'tacosgavilan.com'

/**
 * Alias de inicio de sesión o correo histórico -> buzón real activo en Google Workspace.
 */
export const CORPORATE_EMAIL_ALIAS_MAP: Readonly<Record<string, string>> = {
  'roque@tacosgavilan.com': 'carlos@tacosgavilan.com',
  'alejandro@tacosgavilan.com': 'alex@tacosgavilan.com',
  'yasmin@tacosgavilan.com': 'ap@tacosgavilan.com',
}

/**
 * Lista blanca de buzones corporativos `@tacosgavilan.com` confirmados como existentes en Google Workspace.
 * Adicionalmente, cualquier usuario en `public.users` con `google_email_connected` verificado se agrega dinámicamente.
 */
export const VERIFIED_CORPORATE_MAILBOXES: ReadonlySet<string> = new Set([
  // Sistema y Corporativo / Administración
  'noreply@tacosgavilan.com',
  'carlos@tacosgavilan.com',
  'raquel@tacosgavilan.com',
  'roberto@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'erick@tacosgavilan.com',
  'alex@tacosgavilan.com',
  'eliseo@tacosgavilan.com',
  'ap@tacosgavilan.com',
  'support@tacosgavilan.com',
  // Supervisores Regionales
  'willian@tacosgavilan.com',
  'javier@tacosgavilan.com',
  'ricardo@tacosgavilan.com',
  'estefani@tacosgavilan.com',
  // General Managers de las 15 sucursales activas
  'lucia@tacosgavilan.com',
  'bell@tacosgavilan.com',
  'jesus3@tacosgavilan.com',
  'alfonso@tacosgavilan.com',
  'eloy@tacosgavilan.com',
  'aaron@tacosgavilan.com',
  'erik@tacosgavilan.com',
  'benjamin@tacosgavilan.com',
  'victorm@tacosgavilan.com',
  'bernabe@tacosgavilan.com',
  'julio@tacosgavilan.com',
  'marco@tacosgavilan.com',
  'jesusr@tacosgavilan.com',
  'jesus@tacosgavilan.com',
  'jovana@tacosgavilan.com',
])

/**
 * Dominios ficticios o no enrutables (POS placeholders, pruebas QA, RFC 2606).
 */
export const NON_ROUTABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'example.com',
  'example.org',
  'example.net',
  'toasttab.com',
  'tryotter.com',
  'localhost',
  'invalid',
  'test.com',
])

export interface BlockedExternalEmailInfo {
  status: 'INVALID_NONEXISTENT' | 'INVALID_OVERQUOTA'
  detail: string
  verifiedAt?: string
}

/**
 * Direcciones externas confirmadas como inexistentes por rebote real (`550 5.1.1`) en proveedores
 * donde el sondeo directo por Puerto 25 no es posible desde IP residencial/Lambda (ej. iCloud).
 */
export const KNOWN_BOUNCED_EXTERNAL_EMAILS: ReadonlyMap<string, BlockedExternalEmailInfo> = new Map([
  [
    'lorenzomartines2003@icloud.com',
    {
      status: 'INVALID_NONEXISTENT',
      detail: 'Error 550 5.1.1 user does not exist en mx02.mail.icloud.com (confirmado por DSN real)',
      verifiedAt: '2026-11-24T19:59:00.000Z',
    },
  ],
])

export const OVERQUOTA_BLOCK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
const EMAIL_SYNTAX_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

export type RecipientBlockReason =
  | 'ok'
  | 'missing'
  | 'invalid_syntax'
  | 'placeholder_domain'
  | 'unregistered_corporate'
  | 'bounced_nonexistent'
  | 'inbox_full_overquota'

export interface GuardUserRow {
  id?: number | string | null
  full_name?: string | null
  email?: string | null
  google_email_connected?: string | null
  role?: string | null
  store_id?: number | string | null
  is_active?: boolean | null
  toast_guid?: string | null
}

export interface GuardStoreRow {
  id?: number | string | null
  external_id?: string | null
}

export interface GuardToastEmployeeRow {
  id?: string | null
  toast_guid?: string | null
  v2_toast_guid?: string | null
  first_name?: string | null
  last_name?: string | null
  chosen_name?: string | null
  email?: string | null
  deleted?: boolean | null
  store_ids?: unknown
}

export interface AssistantPersonalEmailIndex {
  byUserId: Map<number, string>
  byLoginEmail: Map<string, string>
  byNormalizedName: Map<string, string>
}

export interface EmailDeliverabilityContext {
  loadedAtMs: number
  verifiedCorporateEmails: Set<string>
  blockedExternalEmails: Map<string, BlockedExternalEmailInfo>
  assistantIndex: AssistantPersonalEmailIndex
}

export class BlockedRecipientError extends Error {
  readonly code = 'ALL_RECIPIENTS_BLOCKED'
  readonly dropped: Array<{ email: string; reason: RecipientBlockReason }>

  constructor(message: string, dropped: Array<{ email: string; reason: RecipientBlockReason }>) {
    super(message)
    this.name = 'BlockedRecipientError'
    this.dropped = dropped
  }
}

export function canonicalizeCorporateEmail(raw?: string | null): string {
  const clean = String(raw || '').trim().toLowerCase()
  if (!clean) return ''
  return CORPORATE_EMAIL_ALIAS_MAP[clean] || clean
}

export function isAssistantRoleName(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return r === 'asistente' || r === 'assistant' || r === 'asst_manager' || r.includes('asist')
}

export function isNonRoutableDomain(domain: string): boolean {
  const d = String(domain || '').trim().toLowerCase()
  if (!d) return true
  if (NON_ROUTABLE_EMAIL_DOMAINS.has(d)) return true
  if (d.endsWith('.invalid') || d.endsWith('.local') || d.endsWith('.example')) return true
  return false
}

export function normalizeNameForEmailMatch(raw?: string | null): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/**
 * Construye el conjunto de correos `@tacosgavilan.com` realmente existentes en Google Workspace.
 * NUNCA agrega cuentas `asistente` sin `google_email_connected` ni alias de solo login (`roque@`, `yasmin@`, `admin@`).
 */
export function buildVerifiedCorporateEmailSet(users?: GuardUserRow[] | null): Set<string> {
  const set = new Set<string>(VERIFIED_CORPORATE_MAILBOXES)
  for (const u of users || []) {
    if (u.is_active === false) continue
    const connected = canonicalizeCorporateEmail(u.google_email_connected)
    if (connected && connected.endsWith(`@${CORPORATE_DOMAIN}`) && EMAIL_SYNTAX_REGEX.test(connected)) {
      set.add(connected)
    }
  }
  return set
}

/**
 * Evalúa si un correo externo (no `@tacosgavilan.com`) es sintácticamente válido y no está bloqueado por rebote/cuota.
 */
export function checkDeliverableExternalEmail(
  rawEmail?: string | null,
  blockedExternalEmails?: ReadonlyMap<string, BlockedExternalEmailInfo> | null
): { ok: boolean; cleanEmail: string | null; reason: RecipientBlockReason; detail?: string } {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return { ok: false, cleanEmail: null, reason: 'missing' }
  }
  const clean = rawEmail.trim().toLowerCase()
  if (!clean) return { ok: false, cleanEmail: null, reason: 'missing' }
  if (!EMAIL_SYNTAX_REGEX.test(clean)) {
    return { ok: false, cleanEmail: null, reason: 'invalid_syntax' }
  }
  const domain = clean.split('@')[1] || ''
  if (isNonRoutableDomain(domain)) {
    return { ok: false, cleanEmail: null, reason: 'placeholder_domain' }
  }

  const known = KNOWN_BOUNCED_EXTERNAL_EMAILS.get(clean) || blockedExternalEmails?.get(clean)
  if (known) {
    return {
      ok: false,
      cleanEmail: null,
      reason: known.status === 'INVALID_OVERQUOTA' ? 'inbox_full_overquota' : 'bounced_nonexistent',
      detail: known.detail,
    }
  }

  return { ok: true, cleanEmail: clean, reason: 'ok' }
}

/**
 * Extrae el mapa de correos bloqueados desde el estado persistente `employee_email_audit_state` en `public.integrations`.
 */
export function parseBlockedExternalEmailsFromAuditState(
  rawAccessToken?: string | null,
  nowMs = Date.now()
): Map<string, BlockedExternalEmailInfo> {
  const blocked = new Map<string, BlockedExternalEmailInfo>(KNOWN_BOUNCED_EXTERNAL_EMAILS)
  if (!rawAccessToken) return blocked
  try {
    const parsed = JSON.parse(rawAccessToken)
    const smtpCache = parsed?.smtpCache || {}
    for (const [rawKey, entry] of Object.entries<any>(smtpCache)) {
      const email = String(rawKey || '').trim().toLowerCase()
      if (!email || email.endsWith(`@${CORPORATE_DOMAIN}`)) continue
      const status = String(entry?.status || '')
      if (status === 'INVALID_NONEXISTENT') {
        blocked.set(email, {
          status: 'INVALID_NONEXISTENT',
          detail: String(entry?.detail || 'Cuenta inexistente verificada por auditoría SMTP'),
          verifiedAt: entry?.verifiedAt,
        })
      } else if (status === 'INVALID_OVERQUOTA') {
        const verifiedMs = entry?.verifiedAt ? Date.parse(String(entry.verifiedAt)) : 0
        if (!verifiedMs || nowMs - verifiedMs <= OVERQUOTA_BLOCK_MAX_AGE_MS) {
          blocked.set(email, {
            status: 'INVALID_OVERQUOTA',
            detail: String(entry?.detail || 'Buzón de correo lleno al 100% (452 4.2.2)'),
            verifiedAt: entry?.verifiedAt,
          })
        }
      }
    }
  } catch {
    // Ignore malformed JSON gracefully
  }
  return blocked
}

function storeIdsContainExternalId(storeIds: unknown, externalId?: string | null): boolean {
  if (!externalId) return false
  if (Array.isArray(storeIds)) {
    return storeIds.some((s) => String(s || '').trim().toLowerCase() === externalId.toLowerCase())
  }
  if (typeof storeIds === 'string') {
    return storeIds.toLowerCase().includes(externalId.toLowerCase())
  }
  return false
}

/**
 * Construye un índice bidireccional de correos personales reales y entregables para los usuarios `asistente`,
 * cruzando `public.users` contra `public.toast_employees` (`deleted = false`).
 */
export function buildAssistantPersonalEmailIndex(
  users: GuardUserRow[],
  toastEmployees: GuardToastEmployeeRow[],
  stores?: GuardStoreRow[] | null,
  verifiedCorporateEmails?: Set<string> | null,
  blockedExternalEmails?: ReadonlyMap<string, BlockedExternalEmailInfo> | null
): AssistantPersonalEmailIndex {
  const byUserId = new Map<number, string>()
  const byLoginEmail = new Map<string, string>()
  const byNormalizedName = new Map<string, string>()

  const verifiedCorp = verifiedCorporateEmails || buildVerifiedCorporateEmailSet(users)
  const storeExtById = new Map<number, string>()
  for (const s of stores || []) {
    if (s.id != null && s.external_id) {
      storeExtById.set(Number(s.id), String(s.external_id).trim())
    }
  }

  interface IndexedToastEmp {
    email: string
    normName: string
    tokens: string[]
    guids: string[]
    storeIds: unknown
  }

  const usableToast: IndexedToastEmp[] = []
  const toastByGuid = new Map<string, IndexedToastEmp>()

  for (const te of toastEmployees || []) {
    if (te.deleted === true) continue
    const rawEmail = String(te.email || '').trim().toLowerCase()
    if (!rawEmail) continue
    const canon = canonicalizeCorporateEmail(rawEmail)
    const domain = canon.split('@')[1] || ''

    // Ignorar correos corporativos login-only que alguien capturó por error en Toast POS (ej. isidro@, hugo@)
    if (domain === CORPORATE_DOMAIN) {
      if (!verifiedCorp.has(canon)) continue
    } else {
      const extCheck = checkDeliverableExternalEmail(canon, blockedExternalEmails)
      if (!extCheck.ok) continue
    }

    const fullName = String(
      te.chosen_name || `${te.first_name || ''} ${te.last_name || ''}`
    )
    const normName = normalizeNameForEmailMatch(fullName)
    const altNorm = normalizeNameForEmailMatch(`${te.first_name || ''} ${te.last_name || ''}`)
    const effectiveNorm = altNorm || normName
    if (!effectiveNorm) continue

    const guids = [te.toast_guid, te.v2_toast_guid]
      .map((g) => String(g || '').trim().toLowerCase())
      .filter(Boolean)

    const item: IndexedToastEmp = {
      email: canon,
      normName: effectiveNorm,
      tokens: effectiveNorm.split(' ').filter(Boolean),
      guids,
      storeIds: te.store_ids,
    }
    usableToast.push(item)
    for (const g of guids) {
      if (!toastByGuid.has(g)) toastByGuid.set(g, item)
    }
  }

  for (const u of users || []) {
    if (u.is_active === false) continue
    if (!isAssistantRoleName(u.role)) continue

    const rawLogin = String(u.email || '').trim().toLowerCase()
    const normUserName = normalizeNameForEmailMatch(u.full_name)
    const userStoreExt = u.store_id != null ? storeExtById.get(Number(u.store_id)) || null : null

    let resolvedPersonal: string | null = null

    // Paso 1: Si tiene `google_email_connected` válido
    const connected = canonicalizeCorporateEmail(u.google_email_connected)
    if (connected) {
      const d = connected.split('@')[1] || ''
      if (d === CORPORATE_DOMAIN ? verifiedCorp.has(connected) : checkDeliverableExternalEmail(connected, blockedExternalEmails).ok) {
        resolvedPersonal = connected
      }
    }

    // Paso 2: Si `users.email` ya es un correo personal externo válido (ej. josuemartinez0775@gmail.com)
    if (!resolvedPersonal && rawLogin && !rawLogin.endsWith(`@${CORPORATE_DOMAIN}`)) {
      const ext = checkDeliverableExternalEmail(rawLogin, blockedExternalEmails)
      if (ext.ok && ext.cleanEmail) {
        resolvedPersonal = ext.cleanEmail
      }
    }

    // Paso 3: Cruce por `toast_guid` directo
    if (!resolvedPersonal && u.toast_guid) {
      const byG = toastByGuid.get(String(u.toast_guid).trim().toLowerCase())
      if (byG) resolvedPersonal = byG.email
    }

    // Paso 4: Cruce por nombre normalizado contra `toast_employees` (priorizando la misma sucursal)
    if (!resolvedPersonal && normUserName) {
      const userTokens = normUserName.split(' ').filter(Boolean)
      const sameStorePool = userStoreExt
        ? usableToast.filter((t) => storeIdsContainExternalId(t.storeIds, userStoreExt))
        : []

      const findInPool = (pool: IndexedToastEmp[], allowFuzzySurname: boolean): IndexedToastEmp | null => {
        // 4a. Nombre completo exacto
        const exact = pool.find((t) => t.normName === normUserName)
        if (exact) return exact

        // 4b. Todos los tokens del usuario aparecen en los tokens de Toast (ej. "noa rodriguez" en "oscar luis noa rodriguez")
        if (userTokens.length >= 2) {
          const subset = pool.filter((t) => userTokens.every((tok) => t.tokens.includes(tok)))
          if (subset.length === 1) return subset[0]
        }

        // 4c. Misma sucursal + primer nombre exacto + apellido con distancia Levenshtein <= 1 (ej. "domingo cael" <-> "domingo calel")
        if (allowFuzzySurname && userTokens.length >= 2) {
          const firstU = userTokens[0]
          const lastU = userTokens[userTokens.length - 1]
          const fuzzy = pool.filter((t) => {
            const hasFirst = t.tokens.includes(firstU)
            if (!hasFirst) return false
            return t.tokens.some(
              (tok) =>
                tok !== firstU &&
                tok.length >= 4 &&
                lastU.length >= 4 &&
                levenshteinDistance(tok, lastU) <= 1
            )
          })
          if (fuzzy.length === 1) return fuzzy[0]
        }

        return null
      }

      const match =
        (sameStorePool.length > 0 ? findInPool(sameStorePool, true) : null) ||
        findInPool(usableToast, false)

      if (match) resolvedPersonal = match.email
    }

    if (resolvedPersonal) {
      if (u.id != null) byUserId.set(Number(u.id), resolvedPersonal)
      if (rawLogin) byLoginEmail.set(rawLogin, resolvedPersonal)
      if (normUserName) byNormalizedName.set(normUserName, resolvedPersonal)
    }
  }

  return { byUserId, byLoginEmail, byNormalizedName }
}

/**
 * Resuelve el correo electrónico entregable real de un usuario de `public.users`.
 * - Para `manager` / `supervisor` / `admin`: usa `google_email_connected || email` canonizado y validado contra buzones reales.
 * - Para `asistente`: resuelve su correo personal real desde `assistantIndex` (o `null` si no existe, evitando rebote).
 */
export function resolveDeliverableUserEmail(
  user: GuardUserRow,
  verifiedCorporateEmails: Set<string>,
  assistantIndex?: AssistantPersonalEmailIndex | null,
  blockedExternalEmails?: ReadonlyMap<string, BlockedExternalEmailInfo> | null
): string | null {
  if (!user || user.is_active === false) return null

  if (isAssistantRoleName(user.role)) {
    if (user.id != null && assistantIndex?.byUserId.has(Number(user.id))) {
      return assistantIndex.byUserId.get(Number(user.id)) || null
    }
    const rawLogin = String(user.email || '').trim().toLowerCase()
    if (rawLogin && assistantIndex?.byLoginEmail.has(rawLogin)) {
      return assistantIndex.byLoginEmail.get(rawLogin) || null
    }
    if (rawLogin && !rawLogin.endsWith(`@${CORPORATE_DOMAIN}`)) {
      const ext = checkDeliverableExternalEmail(rawLogin, blockedExternalEmails)
      return ext.ok ? ext.cleanEmail : null
    }
    const connected = canonicalizeCorporateEmail(user.google_email_connected)
    if (connected) {
      const dom = connected.split('@')[1] || ''
      if (dom === CORPORATE_DOMAIN) return verifiedCorporateEmails.has(connected) ? connected : null
      const ext = checkDeliverableExternalEmail(connected, blockedExternalEmails)
      return ext.ok ? ext.cleanEmail : null
    }
    return null
  }

  const candidate = canonicalizeCorporateEmail(user.google_email_connected || user.email)
  if (!candidate || !EMAIL_SYNTAX_REGEX.test(candidate)) return null
  const domain = candidate.split('@')[1] || ''
  if (domain === CORPORATE_DOMAIN) {
    return verifiedCorporateEmails.has(candidate) ? candidate : null
  }
  const ext = checkDeliverableExternalEmail(candidate, blockedExternalEmails)
  return ext.ok ? ext.cleanEmail : null
}

/**
 * Parsea un encabezado o lista de destinatarios (`"Nombre" <a@b.com>, c@d.com`) preservando nombres.
 */
function splitAddressEntries(input?: string | string[] | null): Array<{ displayName: string | null; email: string }> {
  if (!input) return []
  const rawItems = Array.isArray(input) ? input : [input]
  const out: Array<{ displayName: string | null; email: string }> = []

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'string') continue
    // Split on commas outside double quotes
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < rawItem.length; i++) {
      const ch = rawItem[i]
      if (ch === '"') {
        inQuotes = !inQuotes
        current += ch
      } else if (ch === ',' && !inQuotes) {
        if (current.trim()) parts.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    if (current.trim()) parts.push(current.trim())

    for (const part of parts) {
      const angleMatch = part.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>$/)
      if (angleMatch) {
        const displayName = angleMatch[1].trim().replace(/^["']|["']$/g, '').trim() || null
        const email = angleMatch[2].trim().toLowerCase()
        out.push({ displayName, email })
      } else {
        const email = part.trim().replace(/^<|>$/g, '').trim().toLowerCase()
        if (email) out.push({ displayName: null, email })
      }
    }
  }

  return out
}

function formatAddressEntry(displayName: string | null, email: string): string {
  if (!displayName) return email
  const safeName = displayName.replace(/["\r\n]/g, '').trim()
  return safeName ? `"${safeName}" <${email}>` : email
}

/**
 * Evalúa, redirige (alias o correo personal de asistente) o bloquea una dirección individual antes de enviar.
 */
export function resolveSingleRecipientEmail(
  rawEmail: string,
  ctx: EmailDeliverabilityContext
): {
  deliverable: boolean
  resolvedEmail: string | null
  rewrittenFrom?: string
  reason: RecipientBlockReason
} {
  const original = String(rawEmail || '').trim().toLowerCase()
  if (!original) {
    return { deliverable: false, resolvedEmail: null, reason: 'missing' }
  }

  const canonical = canonicalizeCorporateEmail(original)
  if (!EMAIL_SYNTAX_REGEX.test(canonical)) {
    return { deliverable: false, resolvedEmail: null, reason: 'invalid_syntax' }
  }

  const domain = canonical.split('@')[1] || ''
  if (isNonRoutableDomain(domain)) {
    return { deliverable: false, resolvedEmail: null, reason: 'placeholder_domain' }
  }

  if (domain === CORPORATE_DOMAIN) {
    if (ctx.verifiedCorporateEmails.has(canonical)) {
      return {
        deliverable: true,
        resolvedEmail: canonical,
        rewrittenFrom: canonical !== original ? original : undefined,
        reason: 'ok',
      }
    }

    // Buscar si corresponde al login de un asistente con correo personal real en Toast POS
    const personal = ctx.assistantIndex.byLoginEmail.get(original) || ctx.assistantIndex.byLoginEmail.get(canonical)
    if (personal) {
      const extCheck = checkDeliverableExternalEmail(personal, ctx.blockedExternalEmails)
      if (extCheck.ok && extCheck.cleanEmail) {
        return {
          deliverable: true,
          resolvedEmail: extCheck.cleanEmail,
          rewrittenFrom: original,
          reason: 'ok',
        }
      }
      return { deliverable: false, resolvedEmail: null, reason: extCheck.reason }
    }

    return { deliverable: false, resolvedEmail: null, reason: 'unregistered_corporate' }
  }

  const extCheck = checkDeliverableExternalEmail(canonical, ctx.blockedExternalEmails)
  if (!extCheck.ok || !extCheck.cleanEmail) {
    return { deliverable: false, resolvedEmail: null, reason: extCheck.reason }
  }

  return {
    deliverable: true,
    resolvedEmail: extCheck.cleanEmail,
    rewrittenFrom: extCheck.cleanEmail !== original ? original : undefined,
    reason: 'ok',
  }
}

export interface SanitizedMailRecipients {
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo?: string
  rewritten: Array<{ from: string; to: string }>
  dropped: Array<{ email: string; reason: RecipientBlockReason }>
}

/**
 * Sanitiza `to`, `cc`, `bcc` y `replyTo` antes de compilar el MIME en `sendSystemEmail()`,
 * deduplicando destinatarios y bloqueando toda dirección que provocaría un rebote.
 */
export function sanitizeSystemMailRecipients(
  input: {
    to: string | string[]
    cc?: string | string[]
    bcc?: string | string[]
    replyTo?: string
  },
  ctx: EmailDeliverabilityContext
): SanitizedMailRecipients {
  const seenEmails = new Set<string>()
  const rewritten: Array<{ from: string; to: string }> = []
  const dropped: Array<{ email: string; reason: RecipientBlockReason }> = []

  const processList = (raw?: string | string[] | null): string[] => {
    const out: string[] = []
    for (const entry of splitAddressEntries(raw)) {
      const res = resolveSingleRecipientEmail(entry.email, ctx)
      if (!res.deliverable || !res.resolvedEmail) {
        dropped.push({ email: entry.email, reason: res.reason })
        continue
      }
      if (res.rewrittenFrom && res.rewrittenFrom !== res.resolvedEmail) {
        rewritten.push({ from: res.rewrittenFrom, to: res.resolvedEmail })
      }
      if (seenEmails.has(res.resolvedEmail)) continue
      seenEmails.add(res.resolvedEmail)
      out.push(formatAddressEntry(entry.displayName, res.resolvedEmail))
    }
    return out
  }

  const to = processList(input.to)
  const cc = processList(input.cc)
  const bcc = processList(input.bcc)

  let replyTo: string | undefined
  if (input.replyTo) {
    const parsedReply = splitAddressEntries(input.replyTo)[0]
    if (parsedReply) {
      const res = resolveSingleRecipientEmail(parsedReply.email, ctx)
      if (res.deliverable && res.resolvedEmail) {
        replyTo = formatAddressEntry(parsedReply.displayName, res.resolvedEmail)
      }
    }
  }

  return { to, cc, bcc, replyTo, rewritten, dropped }
}

// ============================================================================
// CACHÉ EN MEMORIA (5 MIN TTL) PARA CONTEXTO EN VIVO DESDE SUPABASE
// ============================================================================

let cachedContext: EmailDeliverabilityContext | null = null
let inFlightContextPromise: Promise<EmailDeliverabilityContext> | null = null

export function clearEmailDeliverabilityCache(): void {
  cachedContext = null
  inFlightContextPromise = null
}

function buildStaticFallbackContext(): EmailDeliverabilityContext {
  return {
    loadedAtMs: Date.now(),
    verifiedCorporateEmails: new Set<string>(VERIFIED_CORPORATE_MAILBOXES),
    blockedExternalEmails: new Map<string, BlockedExternalEmailInfo>(KNOWN_BOUNCED_EXTERNAL_EMAILS),
    assistantIndex: {
      byUserId: new Map(),
      byLoginEmail: new Map(),
      byNormalizedName: new Map(),
    },
  }
}

async function fetchAllPaginatedGuard<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

function getDefaultSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('placeholder.supabase.co')) {
    return null
  }
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Carga y cachea (TTL 5 min) el contexto real de entregabilidad desde Supabase:
 * - Buzones corporativos verificados (`VERIFIED_CORPORATE_MAILBOXES` + `users.google_email_connected`)
 * - Índice de correos personales reales de asistentes (`users` x `toast_employees`)
 * - Mapa de correos externos bloqueados (`KNOWN_BOUNCED_EXTERNAL_EMAILS` + `employee_email_audit_state`)
 */
export async function loadEmailDeliverabilityContext(
  supabaseOverride?: any,
  options?: { forceRefresh?: boolean }
): Promise<EmailDeliverabilityContext> {
  const nowMs = Date.now()
  if (!options?.forceRefresh && cachedContext && nowMs - cachedContext.loadedAtMs < CONTEXT_CACHE_TTL_MS) {
    return cachedContext
  }
  if (!options?.forceRefresh && inFlightContextPromise) {
    return inFlightContextPromise
  }

  const supabase = supabaseOverride || getDefaultSupabaseAdmin()
  if (!supabase) {
    return buildStaticFallbackContext()
  }

  const loader = (async (): Promise<EmailDeliverabilityContext> => {
    try {
      const [usersRes, storesRes, auditStateRes, toastEmployees] = await Promise.all([
        supabase
          .from('users')
          .select('id, full_name, email, google_email_connected, role, store_id, is_active, toast_guid')
          .eq('is_active', true),
        supabase.from('stores').select('id, external_id').eq('is_active', true),
        supabase
          .from('integrations')
          .select('access_token')
          .eq('service_name', 'employee_email_audit_state')
          .maybeSingle(),
        fetchAllPaginatedGuard<GuardToastEmployeeRow>((from, to) =>
          supabase
            .from('toast_employees')
            .select('id, toast_guid, v2_toast_guid, first_name, last_name, chosen_name, email, deleted, store_ids')
            .eq('deleted', false)
            .range(from, to)
        ),
      ])

      const users: GuardUserRow[] = usersRes?.data || []
      const stores: GuardStoreRow[] = storesRes?.data || []
      const verifiedCorporateEmails = buildVerifiedCorporateEmailSet(users)
      const blockedExternalEmails = parseBlockedExternalEmailsFromAuditState(
        auditStateRes?.data?.access_token,
        nowMs
      )
      const assistantIndex = buildAssistantPersonalEmailIndex(
        users,
        toastEmployees,
        stores,
        verifiedCorporateEmails,
        blockedExternalEmails
      )

      const ctx: EmailDeliverabilityContext = {
        loadedAtMs: Date.now(),
        verifiedCorporateEmails,
        blockedExternalEmails,
        assistantIndex,
      }
      cachedContext = ctx
      return ctx
    } catch (err: any) {
      console.warn('⚠️ [EmailGuard] Error cargando contexto desde Supabase, usando respaldo estático:', err?.message || err)
      return cachedContext || buildStaticFallbackContext()
    } finally {
      inFlightContextPromise = null
    }
  })()

  inFlightContextPromise = loader
  return loader
}

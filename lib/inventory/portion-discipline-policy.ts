/**
 * @module lib/inventory/portion-discipline-policy
 * @description Motor obligatorio ("Sí o Sí") de Corrección en Báscula, Strikes Progresivos (1-2-3),
 *   Expulsión / Baja Definitiva por Reincidencia y Cumplimiento Gerencial de 24 Horas (SLA)
 *   para el Control de Porciones de Carnes (Carne Asada prioridad #1 + 8 proteínas) en Tacos Gavilan.
 *
 * @businessRules
 *   - **Cero Excusas — Política Progresiva de Strikes (Ventana Móvil de 180 Días por `employee_key`)**:
 *     1. `offense_number = 1` (`strike_1_warning`): **1ª Amonestación Escrita Obligatoria + Re-calibración Presencial en Báscula**
 *        (`1.5 oz` taco estándar / `6.0 oz` burrito).
 *     2. `offense_number = 2` (`strike_2_final_suspension`): **2ª Reincidencia: Acta Administrativa Final + Suspensión sin Goce
 *        (Advertencia Previa a Baja)**. Escala de inmediato a Supervisor Regional + Directiva Ejecutiva (`DEFAULT_LEADERSHIP_CC`).
 *     3. `offense_number >= 3` (`strike_3_expulsion`): **3ª Reincidencia: EXPULSIÓN / BAJA DEFINITIVA OBLIGATORIA POR REINCIDENCIA**
 *        (`expulsion_status = 'pending_mandatory_expulsion'`). Despacha alerta urgente `[URGENTE — BAJA OBLIGATORIA POR REINCIDENCIA]`
 *        a Directiva (`raquel@`, `gonzalo@`, `roberto@`, `carlos@`), RRHH (`stephany@cingularhr.com`), Supervisor Regional y Gerente,
 *        más aviso formal al empleado si `validateEmployeeViolationEmail` aprueba su correo.
 *   - **Cálculo Estricto en Servidor**: `offense_number` y `disciplinary_stage` se calculan exclusivamente en servidor consultando
 *     `public.portion_disciplinary_actions`; jamás se confía en valores enviados por el cliente.
 *   - **Plazo Fatal Gerencial de 24 Horas (`enforceOverduePortionAlerts`)**:
 *     * Toda alerta abierta o sin corrección/strike registrado cuyo `due_at < now()` y `is_overdue = false` se marca `is_overdue = true`
 *       y escala por **Incumplimiento Disciplinario Gerencial** al Supervisor Regional y Directiva (sujeto a Strike Gerencial).
 *   - **Marca y Moneda Oficiales**: Estrictamente **Tacos Gavilan** y montos en **USD (`$`)**.
 *
 * @dataFlow
 *   `PATCH /api/food-cost/portion-alerts` & `/api/cron/check-portion-alerts`
 *   → `lib/inventory/portion-discipline-policy.ts`
 *   → `public.portion_disciplinary_actions` + `public.portion_control_alerts` + `sendSystemEmail` (`lib/system-mailer.ts`).
 *
 * @notes
 *   - Respeta rigurosamente `dryRun: boolean` (cero correos reales ni notificaciones de campana durante pruebas).
 *   - Reutiliza `DEFAULT_LEADERSHIP_CC` (`lib/ronos-email.ts`) y `validateEmployeeViolationEmail` / `escapeHtmlSafe` (`lib/break-violations-policy.ts`).
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { sendSystemEmail } from '@/lib/system-mailer'
import { formatStoreDisplayName } from '@/lib/store-display'
import { DEFAULT_LEADERSHIP_CC } from '@/lib/ronos-email'
import { resolveAppBaseUrl } from '@/lib/basecamp-todo-email'
import { escapeHtmlSafe, validateEmployeeViolationEmail } from '@/lib/break-violations-policy'
import { formatSignedUSD } from '@/lib/inventory/food-cost-sales-resolver'
import { normalizeCorporateEmail, validateTestToEmail } from '@/lib/inventory/portion-control-alerts'

export const TACO_TARGET_COOKED_OZ = 1.5
export const BURRITO_TARGET_COOKED_OZ = 6.0
export const STRIKE_LOOKBACK_DAYS = 180
export const MANAGER_SLA_HOURS = 24
export const HR_MANDATORY_EXPULSION_EMAIL = 'stephany@cingularhr.com'

export const DIRECTIVA_EXPULSION_EMAILS: readonly string[] = [
  'raquel@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'roberto@tacosgavilan.com',
  'carlos@tacosgavilan.com',
] as const

export const ALLOWED_DISCIPLINARY_ROLES = [
  'Taquero',
  'Cook',
  'Prep',
  'Shift Leader',
  'Asistente',
  'Manager',
] as const

export type DisciplinaryEmployeeRole = (typeof ALLOWED_DISCIPLINARY_ROLES)[number]
export type DisciplinaryShift = 'AM' | 'PM' | 'BOTH'
export type DisciplinaryStage = 'strike_1_warning' | 'strike_2_final_suspension' | 'strike_3_expulsion'
export type ExpulsionStatus =
  | 'not_applicable'
  | 'pending_mandatory_expulsion'
  | 'expulsion_confirmed'
  | 'appealed_by_director'

export interface PortionDisciplinaryActionRow {
  id: string
  alert_id: string | null
  store_id: number
  store_name: string
  employee_key: string
  employee_toast_guid: string | null
  employee_user_id: number | null
  employee_name: string
  employee_role: DisciplinaryEmployeeRole
  employee_email: string | null
  shift: DisciplinaryShift
  meat_key: string
  meat_name: string
  offense_number: number
  disciplinary_stage: DisciplinaryStage
  excess_bags: number
  dollar_loss_store: number
  scale_audit_completed: boolean
  sampled_tacos_avg_oz: number
  sampled_burritos_avg_oz: number
  mandatory_commitment: string
  issued_by_name: string
  issued_by_email: string | null
  supervisor_verified_by: string | null
  supervisor_verified_at: string | null
  expulsion_status: ExpulsionStatus
  hr_exec_notified_at: string | null
  created_at: string
}

export interface RecordMandatoryStrikeInput {
  alertId: string
  employeeName: string
  employeeRole: string
  employeeToastGuid?: string | null
  employeeUserId?: number | null
  employeeEmail?: string | null
  shift: string
  scaleAuditCompleted: boolean
  sampledTacosAvgOz: number
  sampledBurritosAvgOz: number
  mandatoryCommitment: string
  issuedByName: string
  issuedByEmail?: string | null
  dryRun?: boolean
  skipDbPersist?: boolean
  testTo?: string | null
}

export interface DispatchedDisciplineMailSummary {
  kind: 'escalation_chain' | 'employee_notice' | 'manager_overdue_sla'
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  sent: boolean
  dryRun: boolean
  skippedReason?: string
  messageId?: string
  providerUsed?: string
  error?: string
}

export interface RecordMandatoryStrikeResult {
  actionRow: PortionDisciplinaryActionRow
  updatedAlert: Record<string, any>
  priorStrikesCount: number
  offenseNumber: number
  disciplinaryStage: DisciplinaryStage
  expulsionStatus: ExpulsionStatus
  emailsDispatched: DispatchedDisciplineMailSummary[]
  dryRun: boolean
}

export interface OverdueEnforcementResult {
  checkedAt: string
  dryRun: boolean
  overdueDetectedCount: number
  overdueEscalatedCount: number
  overdueAlertIds: string[]
  emailsDispatched: DispatchedDisciplineMailSummary[]
}

interface StoreChainContacts {
  storeId: number
  storeName: string
  externalId: string | null
  managerName: string | null
  managerEmail: string | null
  managerUserIds: string[]
  assistantEmails: string[]
  supervisorName: string | null
  supervisorEmail: string | null
  supervisorUserId: string | null
  registeredCorporateEmails: Set<string>
}

/**
 * Normaliza nombres propios eliminando tildes, dobles espacios y diferencias de mayúsculas/minúsculas.
 */
export function normalizePersonNameForKey(rawName: string): string {
  return String(rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Construye la llave determinista por nombre y tienda (`name:<store_id>:<lower_name>`).
 */
export function buildNameFallbackEmployeeKey(storeId: number, rawName: string): string {
  const cleanName = normalizePersonNameForKey(rawName) || 'unknown'
  return `name:${Number(storeId)}:${cleanName}`
}

/**
 * Construye `employee_key` canónico priorizando `toast:<guid>`, luego `user:<id>`, y respaldo `name:<store_id>:<lower_name>`.
 */
export function buildCanonicalEmployeeKey(params: {
  storeId: number
  employeeName: string
  employeeToastGuid?: string | null
  employeeUserId?: number | null
}): string {
  const cleanGuid = String(params.employeeToastGuid || '').trim().toLowerCase()
  if (cleanGuid && cleanGuid !== 'null' && cleanGuid !== 'undefined') {
    return `toast:${cleanGuid}`
  }
  const uid = Number(params.employeeUserId)
  if (Number.isFinite(uid) && uid > 0) {
    return `user:${Math.trunc(uid)}`
  }
  return buildNameFallbackEmployeeKey(params.storeId, params.employeeName)
}

/**
 * Normaliza cualquier puesto operativo/gerencial de Toast POS o TEG al catálogo disciplinario oficial.
 */
export function normalizeDisciplinaryRole(rawRole: unknown): DisciplinaryEmployeeRole | null {
  const raw = String(rawRole || '').trim()
  if (!raw) return null

  const exact = ALLOWED_DISCIPLINARY_ROLES.find((r) => r.toLowerCase() === raw.toLowerCase())
  if (exact) return exact

  const lower = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (/\b(taquero|parrillero|carnes|tacos|trompero)\b/.test(lower) || lower.includes('carnes_')) {
    return 'Taquero'
  }
  if (/\b(asistente|assistant|asst)\b/.test(lower)) {
    return 'Asistente'
  }
  if (/\b(shift\s*leader|shift_leader|shiftleader|encargado|lider)\b/.test(lower)) {
    return 'Shift Leader'
  }
  if (/\b(manager|gerente|general_manager)\b/.test(lower)) {
    return 'Manager'
  }
  if (/\b(prep|preparador|preparacion)\b/.test(lower)) {
    return 'Prep'
  }
  if (/\b(cook|cocinero|cocina|grill|kitchen)\b/.test(lower)) {
    return 'Cook'
  }
  return null
}

/**
 * Determina el nivel progresivo de Strike y el estado de expulsión a partir del conteo previo en 180 días.
 */
export function computeProgressiveStrikeStage(priorStrikesCount: number): {
  offenseNumber: number
  disciplinaryStage: DisciplinaryStage
  expulsionStatus: ExpulsionStatus
  stageTitleEs: string
  stageTitleEn: string
} {
  const safePrior = Math.max(0, Math.trunc(Number(priorStrikesCount) || 0))
  const offenseNumber = safePrior + 1

  if (offenseNumber === 1) {
    return {
      offenseNumber: 1,
      disciplinaryStage: 'strike_1_warning',
      expulsionStatus: 'not_applicable',
      stageTitleEs: '1ª Amonestación Escrita Obligatoria + Re-calibración en Báscula (1.5 oz / 6.0 oz)',
      stageTitleEn: 'Strike 1: Mandatory Written Warning + Scale Recalibration (1.5 oz / 6.0 oz)',
    }
  }

  if (offenseNumber === 2) {
    return {
      offenseNumber: 2,
      disciplinaryStage: 'strike_2_final_suspension',
      expulsionStatus: 'not_applicable',
      stageTitleEs: '2ª Reincidencia: Acta Administrativa Final + Suspensión sin Goce (Advertencia Previa a Baja)',
      stageTitleEn: 'Strike 2: Final Administrative Warning + Unpaid Suspension (Pre-Termination Notice)',
    }
  }

  return {
    offenseNumber,
    disciplinaryStage: 'strike_3_expulsion',
    expulsionStatus: 'pending_mandatory_expulsion',
    stageTitleEs: `3ª+ Reincidencia (Falta #${offenseNumber}): EXPULSIÓN / BAJA DEFINITIVA OBLIGATORIA POR REINCIDENCIA`,
    stageTitleEn: `Strike ${offenseNumber}: MANDATORY TERMINATION / EXPULSION FOR REPEAT OFFENSE`,
  }
}

async function resolveStoreChainContacts(storeId: number, fallbackStoreName?: string): Promise<StoreChainContacts> {
  const supabase = await getSupabaseAdminClient()
  const [{ data: storeRow }, { data: usersRows }] = await Promise.all([
    supabase
      .from('stores')
      .select('id, name, external_id, supervisor_id, supervisor_name')
      .eq('id', storeId)
      .maybeSingle(),
    supabase
      .from('users')
      .select('id, full_name, email, google_email_connected, role, store_id, store_scope, is_active')
      .eq('is_active', true)
      .limit(2000),
  ])

  const activeUsers = usersRows || []
  const registeredCorporateEmails = new Set<string>()
  for (const u of activeUsers) {
    for (const candidate of [u.email, u.google_email_connected]) {
      const norm = normalizeCorporateEmail(candidate)
      if (norm && norm.endsWith('@tacosgavilan.com')) {
        registeredCorporateEmails.add(norm)
      }
    }
  }

  let supervisorName: string | null = storeRow?.supervisor_name || null
  let supervisorEmail: string | null = null
  let supervisorUserId: string | null = null

  if (storeRow?.supervisor_id) {
    const sup = activeUsers.find((u) => Number(u.id) === Number(storeRow.supervisor_id))
    if (sup) {
      supervisorName = sup.full_name || supervisorName
      supervisorEmail = normalizeCorporateEmail(sup.google_email_connected || sup.email)
      supervisorUserId = String(sup.id)
    }
  }

  const managers = activeUsers.filter((u) => {
    const r = String(u.role || '').trim().toLowerCase()
    const isMgr = (r === 'manager' || r === 'gerente' || r === 'general_manager') && !r.includes('asistente') && !r.includes('asst')
    if (!isMgr) return false
    if (u.store_id !== null && u.store_id !== undefined && Number(u.store_id) === storeId) return true
    if (Array.isArray(u.store_scope)) {
      return u.store_scope.some((s: unknown) => String(s).trim() === String(storeId))
    }
    return false
  })

  const assistants = activeUsers.filter((u) => {
    const r = String(u.role || '').trim().toLowerCase()
    const isAsst = r === 'asistente' || r === 'assistant' || r === 'asst_manager'
    if (!isAsst) return false
    if (u.store_id !== null && u.store_id !== undefined && Number(u.store_id) === storeId) return true
    if (Array.isArray(u.store_scope)) {
      return u.store_scope.some((s: unknown) => String(s).trim() === String(storeId))
    }
    return false
  })

  const managerEmail =
    managers
      .map((m) => normalizeCorporateEmail(m.google_email_connected || m.email))
      .find((e): e is string => Boolean(e)) || null

  const assistantEmails = Array.from(
    new Set(
      assistants
        .map((a) => normalizeCorporateEmail(a.google_email_connected || a.email))
        .filter((e): e is string => Boolean(e))
    )
  )

  return {
    storeId,
    storeName: formatStoreDisplayName({ id: storeId, name: storeRow?.name || fallbackStoreName }) || 'Sucursal',
    externalId: storeRow?.external_id || null,
    managerName: managers[0]?.full_name || null,
    managerEmail,
    managerUserIds: managers.map((m) => String(m.id)),
    assistantEmails,
    supervisorName,
    supervisorEmail,
    supervisorUserId,
    registeredCorporateEmails,
  }
}

async function resolveServerEmployeeIdentity(params: {
  storeId: number
  storeExternalId: string | null
  employeeName: string
  employeeToastGuid?: string | null
  employeeUserId?: number | null
  employeeEmail?: string | null
}): Promise<{
  employeeKey: string
  employeeToastGuid: string | null
  employeeUserId: number | null
  employeeEmail: string | null
}> {
  const supabase = await getSupabaseAdminClient()
  const normTarget = normalizePersonNameForKey(params.employeeName)

  let resolvedGuid = params.employeeToastGuid ? String(params.employeeToastGuid).trim() : null
  let resolvedUserId =
    params.employeeUserId && Number.isFinite(Number(params.employeeUserId)) && Number(params.employeeUserId) > 0
      ? Math.trunc(Number(params.employeeUserId))
      : null
  let resolvedEmail = params.employeeEmail ? String(params.employeeEmail).trim().toLowerCase() : null

  if (resolvedGuid) {
    const safeGuid = resolvedGuid.replace(/[^a-z0-9-]/gi, '')
    if (safeGuid) {
      const { data: teByGuid } = await supabase
        .from('toast_employees')
        .select('toast_guid, v2_toast_guid, email')
        .or(`toast_guid.eq.${safeGuid},v2_toast_guid.eq.${safeGuid}`)
        .limit(1)
        .maybeSingle()
      if (teByGuid?.email && !resolvedEmail) {
        resolvedEmail = String(teByGuid.email).trim().toLowerCase()
      }
    }
  } else if (!resolvedUserId && normTarget) {
    // Buscar coincidencia exacta en `toast_employees` (priorizando la tienda actual)
    const firstToken = (normTarget.split(' ')[0] || '').replace(/[^a-z0-9]/gi, '')
    if (firstToken.length >= 2) {
      const { data: candidates } = await supabase
        .from('toast_employees')
        .select('toast_guid, first_name, last_name, chosen_name, email, deleted, store_ids')
        .or(`first_name.ilike.%${firstToken}%,chosen_name.ilike.%${firstToken}%`)
        .limit(80)

      const activeMatches = (candidates || []).filter((c) => {
        if (c.deleted === true) return false
        const chosen = normalizePersonNameForKey(c.chosen_name || '')
        const full = normalizePersonNameForKey(`${c.first_name || ''} ${c.last_name || ''}`)
        return chosen === normTarget || full === normTarget
      })

      if (activeMatches.length > 0) {
        const inStoreMatch = params.storeExternalId
          ? activeMatches.find(
              (c) => Array.isArray(c.store_ids) && c.store_ids.some((sid: unknown) => String(sid) === params.storeExternalId)
            )
          : undefined
        const best = inStoreMatch || (activeMatches.length === 1 ? activeMatches[0] : null)
        if (best?.toast_guid) {
          resolvedGuid = String(best.toast_guid).trim()
          if (best.email && !resolvedEmail) {
            resolvedEmail = String(best.email).trim().toLowerCase()
          }
        }
      }
    }

    // Si es líder/gerente/asistente en `users`, vincular `user:<id>`
    if (!resolvedGuid) {
      const { data: staffUsers } = await supabase
        .from('users')
        .select('id, full_name, email, store_id, is_active')
        .eq('is_active', true)
        .limit(500)

      const userMatches = (staffUsers || []).filter(
        (u) => normalizePersonNameForKey(u.full_name || '') === normTarget
      )
      const storeUser =
        userMatches.find((u) => Number(u.store_id) === params.storeId) ||
        (userMatches.length === 1 ? userMatches[0] : null)
      if (storeUser) {
        resolvedUserId = Number(storeUser.id)
        if (storeUser.email && !resolvedEmail) {
          resolvedEmail = String(storeUser.email).trim().toLowerCase()
        }
      }
    }
  } else if (resolvedUserId && !resolvedEmail) {
    const { data: uRow } = await supabase
      .from('users')
      .select('email, google_email_connected')
      .eq('id', resolvedUserId)
      .maybeSingle()
    if (uRow) {
      resolvedEmail = normalizeCorporateEmail(uRow.google_email_connected || uRow.email)
    }
  }

  const employeeKey = buildCanonicalEmployeeKey({
    storeId: params.storeId,
    employeeName: params.employeeName,
    employeeToastGuid: resolvedGuid,
    employeeUserId: resolvedUserId,
  })

  return {
    employeeKey,
    employeeToastGuid: resolvedGuid,
    employeeUserId: resolvedUserId,
    employeeEmail: resolvedEmail,
  }
}

/**
 * Construye el HTML institucional para escalamiento de Strike 2 (Suspensión) o Strike 3 (Expulsión Obligatoria).
 */
export function buildStrikeEscalationEmailHtml(params: {
  action: PortionDisciplinaryActionRow
  contacts: StoreChainContacts
  periodStart?: string
  periodEnd?: string
  isTest?: boolean
}): { subject: string; html: string } {
  const { action, contacts, periodStart, periodEnd, isTest = false } = params
  const isExpulsion = action.disciplinary_stage === 'strike_3_expulsion'
  const isStrike2 = action.disciplinary_stage === 'strike_2_final_suspension'

  const headerBg = isExpulsion ? '#7F1D1D' : isStrike2 ? '#B45309' : '#1E293B'
  const badgeText = isExpulsion
    ? `🚨 STRIKE #${action.offense_number} • BAJA / EXPULSIÓN OBLIGATORIA`
    : isStrike2
      ? '⚠️ STRIKE #2 • ACTA FINAL + SUSPENSIÓN SIN GOCE'
      : '📌 STRIKE #1 • AMONESTACIÓN ESCRITA + BÁSCULA'

  const cleanActionStore = formatStoreDisplayName({ id: action.store_id, name: action.store_name }) || action.store_name
  const baseSubject = isExpulsion
    ? `🚨 [URGENTE — BAJA OBLIGATORIA POR REINCIDENCIA] ${cleanActionStore} — ${action.employee_name} (${action.employee_role}) • Strike #${action.offense_number} en Porciones (${action.meat_name})`
    : isStrike2
      ? `⚠️ [STRIKE 2 — SUSPENSIÓN Y ADVERTENCIA FINAL] ${cleanActionStore} — ${action.employee_name} (${action.employee_role}) • Sobre-Porcionado ${action.meat_name}`
      : `📌 [STRIKE 1 — AMONESTACIÓN Y BÁSCULA] ${cleanActionStore} — ${action.employee_name} (${action.employee_role})`

  const subject = isTest ? `[PRUEBA] ${baseSubject}` : baseSubject
  const appBaseUrl = resolveAppBaseUrl()
  const actionUrl = `${appBaseUrl}/admin/food-cost/meats?store_id=${encodeURIComponent(String(action.store_id))}&meat=${encodeURIComponent(action.meat_key)}`

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC;padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:${headerBg};padding:22px 28px;color:#FFFFFF;">
              <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:0.92;">
                Tacos Gavilan • Control Disciplinario Obligatorio de Porciones
              </div>
              <div style="font-size:20px;font-weight:900;margin-top:6px;">
                ${escapeHtmlSafe(badgeText)}
              </div>
              <div style="font-size:13px;margin-top:6px;opacity:0.95;">
                Sucursal: <strong>${escapeHtmlSafe(cleanActionStore)}</strong>
                ${periodStart && periodEnd ? ` · Ventana auditada: <strong>${escapeHtmlSafe(periodStart)} → ${escapeHtmlSafe(periodEnd)}</strong>` : ''}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              ${
                isExpulsion
                  ? `<div style="background:#FEF2F2;border:2px solid #DC2626;border-radius:10px;padding:16px;margin-bottom:20px;color:#7F1D1D;font-size:13px;line-height:1.55;">
                      <strong style="font-size:14px;text-transform:uppercase;display:block;margin-bottom:4px;">🚨 ORDEN CORPORATIVA NO NEGOCIABLE: BAJA DEFINITIVA POR 3ª REINCIDENCIA</strong>
                      El colaborador <strong>${escapeHtmlSafe(action.employee_name)}</strong> (${escapeHtmlSafe(action.employee_role)}, Turno ${escapeHtmlSafe(action.shift)}) ha acumulado su <strong>Strike #${action.offense_number}</strong> en los últimos 180 días por descontrol/sobre-porcionado de <strong>${escapeHtmlSafe(action.meat_name)}</strong>. Conforme a la política disciplinaria obligatoria de <strong>Tacos Gavilan</strong>, procede su <strong>baja/separación inmediata por reincidencia</strong> coordinada con Recursos Humanos (Cingular HR) y Supervisión Regional.
                    </div>`
                  : `<div style="background:#FFFBEB;border:1px solid #F59E0B;border-left:5px solid #D97706;border-radius:8px;padding:14px 16px;margin-bottom:20px;color:#78350F;font-size:13px;line-height:1.55;">
                      <strong>Política Progresiva Cero Excusas (180 días):</strong> Strike 1 = Amonestación + Báscula · <strong>Strike 2 = Acta Administrativa Final + Suspensión sin Goce</strong> · Strike 3 = <strong>Expulsión / Baja Definitiva Obligatoria</strong>.
                    </div>`
              }

              <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:18px;">
                <tr style="background:#F1F5F9;">
                  <td style="font-weight:700;color:#334155;width:42%;">Colaborador Responsable</td>
                  <td style="font-weight:800;color:#0F172A;">${escapeHtmlSafe(action.employee_name)} (${escapeHtmlSafe(action.employee_role)} · Turno ${escapeHtmlSafe(action.shift)})</td>
                </tr>
                <tr>
                  <td style="font-weight:700;color:#334155;border-top:1px solid #E2E8F0;">Nivel Disciplinario (Servidor)</td>
                  <td style="font-weight:800;color:#B91C1C;border-top:1px solid #E2E8F0;">Strike #${action.offense_number} (${escapeHtmlSafe(action.disciplinary_stage)})</td>
                </tr>
                <tr style="background:#F8FAFC;">
                  <td style="font-weight:700;color:#334155;border-top:1px solid #E2E8F0;">Proteína y Exceso Físico</td>
                  <td style="font-weight:800;color:#991B1B;border-top:1px solid #E2E8F0;">${escapeHtmlSafe(action.meat_name)} · +${Number(action.excess_bags).toFixed(1)} bolsas (${formatSignedUSD(Number(action.dollar_loss_store))} USD pérdida tienda)</td>
                </tr>
                <tr>
                  <td style="font-weight:700;color:#334155;border-top:1px solid #E2E8F0;">Auditoría Real en Báscula</td>
                  <td style="border-top:1px solid #E2E8F0;color:#0F172A;">
                    5 Tacos prom: <strong>${Number(action.sampled_tacos_avg_oz).toFixed(2)} oz</strong> (meta oficial <strong>1.50 oz</strong>) ·
                    3 Burritos prom: <strong>${Number(action.sampled_burritos_avg_oz).toFixed(2)} oz</strong> (meta oficial <strong>6.00 oz</strong>)
                  </td>
                </tr>
                <tr style="background:#F8FAFC;">
                  <td style="font-weight:700;color:#334155;border-top:1px solid #E2E8F0;">Compromiso / Acta Registrada</td>
                  <td style="border-top:1px solid #E2E8F0;color:#1E293B;">${escapeHtmlSafe(action.mandatory_commitment)}</td>
                </tr>
                <tr>
                  <td style="font-weight:700;color:#334155;border-top:1px solid #E2E8F0;">Emitido por</td>
                  <td style="border-top:1px solid #E2E8F0;color:#334155;">${escapeHtmlSafe(action.issued_by_name)}${action.issued_by_email ? ` (${escapeHtmlSafe(action.issued_by_email)})` : ''}</td>
                </tr>
              </table>

              <div style="text-align:center;margin:22px 0;">
                <a href="${escapeHtmlSafe(actionUrl)}" style="display:inline-block;background:#DA291C;color:#FFFFFF;font-weight:800;font-size:13px;text-decoration:none;padding:12px 22px;border-radius:8px;">
                  Abrir Registro de Strikes y Control de Porciones →
                </a>
              </div>

              <div style="border-top:1px solid #E2E8F0;padding-top:14px;font-size:11px;color:#64748B;line-height:1.5;">
                <strong>Escalera de Mando Notificada (Tacos Gavilan):</strong><br/>
                • Gerente de Sucursal: ${escapeHtmlSafe(contacts.managerName || 'Gerencia')} (${escapeHtmlSafe(contacts.managerEmail || 'No asignado')})<br/>
                • Supervisor Regional: ${escapeHtmlSafe(contacts.supervisorName || 'Supervisión')} (${escapeHtmlSafe(contacts.supervisorEmail || 'No asignado')})<br/>
                • Directiva Ejecutiva: ${escapeHtmlSafe(DEFAULT_LEADERSHIP_CC.join(', '))}${isExpulsion ? `<br/>• Recursos Humanos (Baja Obligatoria): ${escapeHtmlSafe(HR_MANDATORY_EXPULSION_EMAIL)}` : ''}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html }
}

/**
 * Construye el aviso disciplinario formal directo al colaborador (replicando el patrón de `lib/ronos-email.ts` y `lib/break-violations-policy.ts`).
 */
export function buildEmployeePortionStrikeEmailHtml(params: {
  action: PortionDisciplinaryActionRow
  contacts: StoreChainContacts
  isTest?: boolean
}): { subject: string; html: string } {
  const { action, contacts, isTest = false } = params
  const isExpulsion = action.disciplinary_stage === 'strike_3_expulsion'
  const isStrike2 = action.disciplinary_stage === 'strike_2_final_suspension'

  const stageBanner = isExpulsion
    ? `🚨 TERCERA REINCIDENCIA (STRIKE #${action.offense_number}) — NOTIFICACIÓN DE BAJA OBLIGATORIA`
    : isStrike2
      ? '⚠️ SEGUNDA REINCIDENCIA (STRIKE #2) — ACTA FINAL Y SUSPENSIÓN SIN GOCE'
      : '📌 PRIMERA AMONESTACIÓN ESCRITA (STRIKE #1) — CALIBRACIÓN OBLIGATORIA EN BÁSCULA'

  const cleanEmpStore = formatStoreDisplayName({ id: action.store_id, name: action.store_name }) || action.store_name
  const baseSubject = isExpulsion
    ? `🚨 Tacos Gavilan: Notificación Formal de Baja por 3ª Reincidencia en Control de Porciones — ${cleanEmpStore}`
    : isStrike2
      ? `⚠️ Tacos Gavilan: Strike #2 (Acta Final y Suspensión) en Control de Porciones — ${cleanEmpStore}`
      : `📌 Tacos Gavilan: Strike #1 (Amonestación Escrita y Báscula) en Control de Porciones — ${cleanEmpStore}`

  const subject = isTest ? `[PRUEBA] ${baseSubject}` : baseSubject

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
  <div style="max-width:620px;margin:20px auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
    <div style="background:#DA291C;color:#FFFFFF;padding:20px 24px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:0.9;">TACOS GAVILAN • CUMPLIMIENTO OPERATIVO Y ESTÁNDAR DE PORCIONES</div>
      <div style="font-size:17px;font-weight:800;margin-top:6px;">${escapeHtmlSafe(stageBanner)}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;margin-top:0;">Estimado(a) <strong>${escapeHtmlSafe(action.employee_name)}</strong> (${escapeHtmlSafe(action.employee_role)}):</p>
      <p style="font-size:14px;line-height:1.6;color:#374151;">
        Por medio del presente documento queda registrado en tu expediente operativo el <strong>Strike #${action.offense_number}</strong> correspondiente a la sucursal <strong>${escapeHtmlSafe(cleanEmpStore)}</strong> (Turno <strong>${escapeHtmlSafe(action.shift)}</strong>) en el control físico de porciones de <strong>${escapeHtmlSafe(action.meat_name)}</strong>.
      </p>

      <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:14px 16px;border-radius:8px;margin:18px 0;font-size:13px;line-height:1.65;">
        <strong>Resultado de Auditoría Presencial en Báscula:</strong><br/>
        • Promedio medido en 5 Tacos: <strong>${Number(action.sampled_tacos_avg_oz).toFixed(2)} oz</strong> (Estándar obligatorio: <strong>1.50 oz cocidas</strong>)<br/>
        • Promedio medido en 3 Burritos: <strong>${Number(action.sampled_burritos_avg_oz).toFixed(2)} oz</strong> (Estándar obligatorio: <strong>6.00 oz cocidas</strong>)<br/>
        • Compromiso / Medida Correctiva: <strong>${escapeHtmlSafe(action.mandatory_commitment)}</strong>
      </div>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:14px 16px;border-radius:8px;font-size:13px;color:#334155;line-height:1.6;">
        <strong>Reglamento Disciplinario Obligatorio (Ventana de 180 Días):</strong><br/>
        1) <strong>Strike 1:</strong> Amonestación escrita + recalibración obligatoria en báscula.<br/>
        2) <strong>Strike 2:</strong> Acta administrativa final + suspensión sin goce de sueldo.<br/>
        3) <strong>Strike 3:</strong> <strong>Expulsión / Baja definitiva obligatoria por reincidencia</strong>.<br/>
        ${
          isExpulsion
            ? '<span style="color:#B91C1C;font-weight:800;display:block;margin-top:6px;">Al tratarse de tu 3ª reincidencia documentada, tu caso ha sido turnado de forma obligatoria a Dirección Ejecutiva, Supervisión Regional y Recursos Humanos para ejecutar la separación laboral.</span>'
            : ''
        }
      </div>

      <div style="border-top:1px solid #E5E7EB;margin-top:20px;padding-top:12px;font-size:11px;color:#6B7280;">
        Copia a Escalera de Mando: Gerencia (${escapeHtmlSafe(contacts.managerEmail || 'Tienda')}) · Supervisión (${escapeHtmlSafe(contacts.supervisorEmail || 'Zona')}) · Dirección Ejecutiva Tacos Gavilan.
      </div>
    </div>
  </div>
</body>
</html>`

  return { subject, html }
}

/**
 * Registra una Corrección Obligatoria en Báscula + Strike Progresivo inmutable en `public.portion_disciplinary_actions`,
 * actualiza `public.portion_control_alerts` y despacha notificaciones de Strike 1 / Strike 2 / Strike 3 Expulsión.
 */
export async function recordMandatoryPortionCorrectionAndStrike(
  input: RecordMandatoryStrikeInput
): Promise<RecordMandatoryStrikeResult> {
  const dryRun = Boolean(input.dryRun)
  const skipDbPersist = Boolean(input.skipDbPersist)

  const testCheck = validateTestToEmail(input.testTo)
  if (!testCheck.valid) {
    throw new Error(testCheck.error || 'Parámetro testTo inválido')
  }

  const cleanEmployeeName = String(input.employeeName || '').trim()
  if (cleanEmployeeName.length < 2) {
    throw new Error('Debes seleccionar o indicar el nombre completo del responsable (employeeName)')
  }

  const normalizedRole = normalizeDisciplinaryRole(input.employeeRole)
  if (!normalizedRole) {
    throw new Error(
      `Puesto inválido (${input.employeeRole}). Valores permitidos: ${ALLOWED_DISCIPLINARY_ROLES.join(', ')}`
    )
  }

  const rawShift = String(input.shift || '').trim().toUpperCase()
  if (rawShift !== 'AM' && rawShift !== 'PM' && rawShift !== 'BOTH') {
    throw new Error('Debes indicar un turno válido: AM, PM o BOTH')
  }
  const validShift: DisciplinaryShift = rawShift

  if (input.scaleAuditCompleted !== true) {
    throw new Error(
      'BLOQUEO DISCIPLINARIO: Es obligatorio confirmar que se realizó la calibración presencial en báscula (scaleAuditCompleted = true)'
    )
  }

  const tacosOz = Number(input.sampledTacosAvgOz)
  const burritosOz = Number(input.sampledBurritosAvgOz)
  if (!Number.isFinite(tacosOz) || tacosOz <= 0 || tacosOz > 24) {
    throw new Error('El pesaje promedio real de 5 Tacos en báscula (sampledTacosAvgOz) debe ser un número mayor a 0 oz')
  }
  if (!Number.isFinite(burritosOz) || burritosOz <= 0 || burritosOz > 48) {
    throw new Error(
      'El pesaje promedio real de 3 Burritos en báscula (sampledBurritosAvgOz) debe ser un número mayor a 0 oz'
    )
  }

  const commitment = String(input.mandatoryCommitment || '').trim()
  if (commitment.length < 10) {
    throw new Error(
      'BLOQUEO DISCIPLINARIO: El compromiso obligatorio y detalle de corrección (correctiveActionNotes) debe tener al menos 10 caracteres'
    )
  }

  const supabase = await getSupabaseAdminClient()
  const { data: alertRow, error: alertErr } = await supabase
    .from('portion_control_alerts')
    .select('*')
    .eq('id', input.alertId)
    .maybeSingle()

  if (alertErr || !alertRow) {
    throw new Error('Alerta de control de porciones no encontrada')
  }

  const storeId = Number(alertRow.store_id)
  const contacts = await resolveStoreChainContacts(storeId, alertRow.store_name)

  const identity = await resolveServerEmployeeIdentity({
    storeId,
    storeExternalId: contacts.externalId,
    employeeName: cleanEmployeeName,
    employeeToastGuid: input.employeeToastGuid,
    employeeUserId: input.employeeUserId,
    employeeEmail: input.employeeEmail,
  })

  // Contar Strikes previos en los últimos 180 días ESTRICTAMENTE EN SERVIDOR
  const lookbackIso = new Date(Date.now() - STRIKE_LOOKBACK_DAYS * 86_400_000).toISOString()
  const fallbackNameKey = buildNameFallbackEmployeeKey(storeId, cleanEmployeeName)

  const candidateKeys = Array.from(new Set([identity.employeeKey, fallbackNameKey].filter(Boolean)))
  const { data: priorRows, error: priorErr } = await supabase
    .from('portion_disciplinary_actions')
    .select('id, employee_key, store_id, employee_name, expulsion_status, created_at')
    .gte('created_at', lookbackIso)
    .neq('expulsion_status', 'appealed_by_director')
    .in('employee_key', candidateKeys)
    .order('created_at', { ascending: false })

  if (priorErr) {
    throw new Error(`Error verificando historial de reincidencias (180d): ${priorErr.message}`)
  }

  // Deduplicar por id y incluir coincidencias exactas mismo nombre + tienda en caso de cambio de llave
  const priorIds = new Set<string>()
  for (const r of priorRows || []) {
    if (r.id) priorIds.add(String(r.id))
  }

  const { data: sameStoreRows } = await supabase
    .from('portion_disciplinary_actions')
    .select('id, employee_name, expulsion_status')
    .eq('store_id', storeId)
    .gte('created_at', lookbackIso)
    .neq('expulsion_status', 'appealed_by_director')

  const normTargetName = normalizePersonNameForKey(cleanEmployeeName)
  for (const r of sameStoreRows || []) {
    if (r.id && normalizePersonNameForKey(r.employee_name || '') === normTargetName) {
      priorIds.add(String(r.id))
    }
  }

  const priorStrikesCount = priorIds.size
  const stageInfo = computeProgressiveStrikeStage(priorStrikesCount)
  const nowIso = new Date().toISOString()

  const insertPayload = {
    alert_id: alertRow.id,
    store_id: storeId,
    store_name: formatStoreDisplayName({ id: storeId, name: alertRow.store_name || contacts.storeName }) || contacts.storeName,
    employee_key: identity.employeeKey,
    employee_toast_guid: identity.employeeToastGuid,
    employee_user_id: identity.employeeUserId,
    employee_name: cleanEmployeeName,
    employee_role: normalizedRole,
    employee_email: identity.employeeEmail,
    shift: validShift,
    meat_key: String(alertRow.meat_key || 'asada'),
    meat_name: String(alertRow.meat_name || 'Carne Asada'),
    offense_number: stageInfo.offenseNumber,
    disciplinary_stage: stageInfo.disciplinaryStage,
    excess_bags: Math.max(0, Math.round((Number(alertRow.variance_bags) || 0) * 100) / 100),
    dollar_loss_store: Math.max(0, Math.round((Number(alertRow.dollar_loss_store) || 0) * 100) / 100),
    scale_audit_completed: true,
    sampled_tacos_avg_oz: Math.round(tacosOz * 100) / 100,
    sampled_burritos_avg_oz: Math.round(burritosOz * 100) / 100,
    mandatory_commitment: commitment.slice(0, 1500),
    issued_by_name: String(input.issuedByName || 'Gerencia').trim(),
    issued_by_email: normalizeCorporateEmail(input.issuedByEmail),
    expulsion_status: stageInfo.expulsionStatus,
  }

  let persistedAction: PortionDisciplinaryActionRow
  if (skipDbPersist) {
    persistedAction = {
      id: '00000000-0000-0000-0000-000000000000',
      ...insertPayload,
      supervisor_verified_by: null,
      supervisor_verified_at: null,
      hr_exec_notified_at: null,
      created_at: nowIso,
    }
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('portion_disciplinary_actions')
      .insert(insertPayload)
      .select('*')
      .single()

    if (insErr || !inserted) {
      throw new Error(`Error insertando Strike disciplinario inmutable: ${insErr?.message || 'sin respuesta'}`)
    }
    persistedAction = inserted as PortionDisciplinaryActionRow
  }

  // Despachar correos según severidad progresiva (Strike 1 -> empleado + tienda; Strike 2 -> Supervisor + Directiva; Strike 3 -> URGENTE Baja RRHH + Directiva)
  const emailsDispatched: DispatchedDisciplineMailSummary[] = []
  let hrExecNotifiedAt: string | null = null

  if (
    stageInfo.disciplinaryStage === 'strike_2_final_suspension' ||
    stageInfo.disciplinaryStage === 'strike_3_expulsion'
  ) {
    const isExpulsion = stageInfo.disciplinaryStage === 'strike_3_expulsion'
    const rawTo = isExpulsion
      ? [
          ...DIRECTIVA_EXPULSION_EMAILS,
          HR_MANDATORY_EXPULSION_EMAIL,
          ...(contacts.supervisorEmail ? [contacts.supervisorEmail] : []),
          ...(contacts.managerEmail ? [contacts.managerEmail] : []),
        ]
      : [
          ...(contacts.supervisorEmail ? [contacts.supervisorEmail] : []),
          ...(contacts.managerEmail ? [contacts.managerEmail] : []),
        ]

    const rawCc = isExpulsion
      ? contacts.assistantEmails
      : [...DEFAULT_LEADERSHIP_CC, ...contacts.assistantEmails]

    const finalTo = testCheck.email ? [testCheck.email] : Array.from(new Set(rawTo.filter(Boolean)))
    const finalCc = testCheck.email
      ? []
      : Array.from(new Set(rawCc.filter((e) => Boolean(e) && !finalTo.includes(e))))
    const finalBcc = testCheck.email || finalTo.includes('carlos@tacosgavilan.com') ? [] : ['carlos@tacosgavilan.com']

    const { subject, html } = buildStrikeEscalationEmailHtml({
      action: persistedAction,
      contacts,
      periodStart: alertRow.period_start,
      periodEnd: alertRow.period_end,
      isTest: Boolean(testCheck.email),
    })

    if (dryRun || finalTo.length === 0) {
      emailsDispatched.push({
        kind: 'escalation_chain',
        to: finalTo,
        cc: finalCc,
        bcc: finalBcc,
        subject,
        sent: false,
        dryRun,
        skippedReason: dryRun ? 'dry_run' : 'no_recipients',
      })
    } else {
      try {
        const mailRes = await sendSystemEmail({
          fromName: 'Disciplina Operativa • Tacos Gavilan',
          to: finalTo,
          cc: finalCc.length > 0 ? finalCc : undefined,
          bcc: finalBcc.length > 0 ? finalBcc : undefined,
          subject,
          html,
        })
        hrExecNotifiedAt = new Date().toISOString()
        emailsDispatched.push({
          kind: 'escalation_chain',
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          sent: true,
          dryRun: false,
          messageId: mailRes.messageId,
          providerUsed: mailRes.providerUsed,
        })
      } catch (mailErr: any) {
        emailsDispatched.push({
          kind: 'escalation_chain',
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          sent: false,
          dryRun: false,
          error: mailErr?.message || 'Error enviando escalamiento disciplinario',
        })
      }
    }

    // Notificación de campana para Supervisor Regional y Gerencia (solo cuando no es dryRun ni testTo)
    if (!dryRun && !skipDbPersist && !testCheck.email) {
      const bellTargets = Array.from(
        new Set([...(contacts.supervisorUserId ? [contacts.supervisorUserId] : []), ...contacts.managerUserIds])
      )
      if (bellTargets.length > 0) {
        await supabase.from('notifications').insert(
          bellTargets.map((uid) => ({
            user_id: uid,
            type: 'alert',
            title: isExpulsion
              ? `🚨 BAJA OBLIGATORIA (Strike #${stageInfo.offenseNumber}): ${cleanEmployeeName}`
              : `⚠️ Strike #2 Suspensión: ${cleanEmployeeName} (${contacts.storeName})`,
            message: `${alertRow.meat_name}: Pesaje báscula ${tacosOz.toFixed(2)} oz taco / ${burritosOz.toFixed(2)} oz burrito.`,
            link: `/admin/food-cost/meats?store_id=${storeId}&meat=${encodeURIComponent(String(alertRow.meat_key || 'asada'))}`,
            is_read: false,
            read: false,
            reference_id: persistedAction.id,
            reference_type: 'portion_disciplinary_action',
          }))
        )
      }
    }
  }

  // Aviso formal directo al empleado (Strike 1, 2 o 3) si `validateEmployeeViolationEmail` aprueba su correo
  const empEmailValidation = validateEmployeeViolationEmail(
    identity.employeeEmail,
    contacts.registeredCorporateEmails
  )
  const { subject: empSubject, html: empHtml } = buildEmployeePortionStrikeEmailHtml({
    action: persistedAction,
    contacts,
    isTest: Boolean(testCheck.email),
  })

  if (!empEmailValidation.deliverable || !empEmailValidation.cleanEmail) {
    emailsDispatched.push({
      kind: 'employee_notice',
      to: [],
      cc: [],
      bcc: [],
      subject: empSubject,
      sent: false,
      dryRun,
      skippedReason: `employee_email_${empEmailValidation.reason}`,
    })
  } else {
    const empTo = testCheck.email ? [testCheck.email] : [empEmailValidation.cleanEmail]
    const empCc = testCheck.email
      ? []
      : Array.from(
          new Set([
            ...(contacts.managerEmail ? [contacts.managerEmail] : []),
            ...(contacts.supervisorEmail ? [contacts.supervisorEmail] : []),
            ...(stageInfo.offenseNumber >= 2 ? DEFAULT_LEADERSHIP_CC : []),
          ])
        ).filter((e) => !empTo.includes(e))

    if (dryRun) {
      emailsDispatched.push({
        kind: 'employee_notice',
        to: empTo,
        cc: empCc,
        bcc: [],
        subject: empSubject,
        sent: false,
        dryRun: true,
        skippedReason: 'dry_run',
      })
    } else {
      try {
        const empMailRes = await sendSystemEmail({
          fromName: 'Cumplimiento Operativo • Tacos Gavilan',
          to: empTo,
          cc: empCc.length > 0 ? empCc : undefined,
          bcc: testCheck.email ? undefined : 'carlos@tacosgavilan.com',
          subject: empSubject,
          html: empHtml,
        })
        emailsDispatched.push({
          kind: 'employee_notice',
          to: empTo,
          cc: empCc,
          bcc: testCheck.email ? [] : ['carlos@tacosgavilan.com'],
          subject: empSubject,
          sent: true,
          dryRun: false,
          messageId: empMailRes.messageId,
          providerUsed: empMailRes.providerUsed,
        })
      } catch (empErr: any) {
        emailsDispatched.push({
          kind: 'employee_notice',
          to: empTo,
          cc: empCc,
          bcc: [],
          subject: empSubject,
          sent: false,
          dryRun: false,
          error: empErr?.message || 'Error enviando aviso al empleado',
        })
      }
    }
  }

  if (hrExecNotifiedAt && !skipDbPersist) {
    const { data: touchedAction } = await supabase
      .from('portion_disciplinary_actions')
      .update({ hr_exec_notified_at: hrExecNotifiedAt })
      .eq('id', persistedAction.id)
      .select('*')
      .single()
    if (touchedAction) {
      persistedAction = touchedAction as PortionDisciplinaryActionRow
    }
  }

  // Vincular el Strike obligatorio con la alerta en `public.portion_control_alerts`
  const formattedNoteLine = `[STRIKE #${stageInfo.offenseNumber} - ${stageInfo.disciplinaryStage.toUpperCase()} | ${cleanEmployeeName} (${normalizedRole}, ${validShift}) | Báscula: 5 Tacos=${tacosOz.toFixed(2)}oz, 3 Burritos=${burritosOz.toFixed(2)}oz]: ${commitment}`
  const combinedNotes = alertRow.corrective_action_notes
    ? `${alertRow.corrective_action_notes}\n${formattedNoteLine}`.slice(0, 1500)
    : formattedNoteLine.slice(0, 1500)

  const alertUpdates: Record<string, any> = {
    disciplinary_action_id: persistedAction.id,
    coaching_shift: validShift,
    coaching_staff_names: `${cleanEmployeeName} (${normalizedRole} • Strike #${stageInfo.offenseNumber})`.slice(0, 300),
    corrective_action_notes: combinedNotes,
  }
  if (!alertRow.acknowledged_at) {
    alertUpdates.acknowledged_by = input.issuedByName
    alertUpdates.acknowledged_at = nowIso
  }
  if (alertRow.status === 'open' || alertRow.status === 'acknowledged') {
    alertUpdates.status = 'coached'
  }
  if (stageInfo.offenseNumber >= 2) {
    alertUpdates.escalated_to_execs = true
  }

  let updatedAlert: Record<string, any> = { ...alertRow, ...alertUpdates }
  if (!skipDbPersist) {
    const { data: savedAlert, error: updErr } = await supabase
      .from('portion_control_alerts')
      .update(alertUpdates)
      .eq('id', alertRow.id)
      .select('*')
      .single()

    if (updErr) {
      throw new Error(`Error vinculando Strike a la alerta: ${updErr.message}`)
    }
    if (savedAlert) updatedAlert = savedAlert
  }

  return {
    actionRow: persistedAction,
    updatedAlert,
    priorStrikesCount,
    offenseNumber: stageInfo.offenseNumber,
    disciplinaryStage: stageInfo.disciplinaryStage,
    expulsionStatus: stageInfo.expulsionStatus,
    emailsDispatched,
    dryRun,
  }
}

/**
 * Confirma la ejecución de una Baja / Expulsión Obligatoria (`expulsion_status = 'expulsion_confirmed'`).
 * Restringido a Supervisores Regionales y Administradores.
 */
export async function confirmMandatoryPortionExpulsion(params: {
  disciplinaryActionId: string
  confirmedByName: string
  notes?: string | null
  dryRun?: boolean
  skipDbPersist?: boolean
}): Promise<PortionDisciplinaryActionRow> {
  const supabase = await getSupabaseAdminClient()
  const { data: existing, error: fetchErr } = await supabase
    .from('portion_disciplinary_actions')
    .select('*')
    .eq('id', params.disciplinaryActionId)
    .maybeSingle()

  if (fetchErr || !existing) {
    throw new Error('Registro disciplinario no encontrado')
  }

  if (existing.disciplinary_stage !== 'strike_3_expulsion') {
    throw new Error('Solo los registros en etapa strike_3_expulsion pueden confirmarse como expulsión ejecutada')
  }

  const nowIso = new Date().toISOString()
  const updatedCommitment =
    params.notes && params.notes.trim()
      ? `${existing.mandatory_commitment}\n[Baja Confirmada por ${params.confirmedByName}]: ${params.notes.trim()}`.slice(0, 1500)
      : existing.mandatory_commitment

  const patchPayload = {
    expulsion_status: 'expulsion_confirmed' as ExpulsionStatus,
    supervisor_verified_by: params.confirmedByName,
    supervisor_verified_at: nowIso,
    mandatory_commitment: updatedCommitment,
  }

  if (params.skipDbPersist) {
    return { ...(existing as PortionDisciplinaryActionRow), ...patchPayload }
  }

  const { data: updated, error: updErr } = await supabase
    .from('portion_disciplinary_actions')
    .update(patchPayload)
    .eq('id', params.disciplinaryActionId)
    .select('*')
    .single()

  if (updErr || !updated) {
    throw new Error(`Error confirmando baja obligatoria: ${updErr?.message || 'sin respuesta'}`)
  }

  return updated as PortionDisciplinaryActionRow
}

/**
 * Enforcer del Plazo Obligatorio Gerencial de 24 Horas (`due_at < now()`):
 * Marca `is_overdue = true` en alertas abiertas/sin coaching ni Strike registrado y escala a
 * Supervisor Regional + Directiva por Incumplimiento Disciplinario Gerencial.
 */
export async function enforceOverduePortionAlerts(options?: {
  dryRun?: boolean
  sendEmails?: boolean
  persistInDbWhenDryRun?: boolean
  storeId?: number | string | null
  testTo?: string | null
  now?: Date
}): Promise<OverdueEnforcementResult> {
  const dryRun = Boolean(options?.dryRun)
  const sendEmails = options?.sendEmails !== undefined ? Boolean(options.sendEmails) : !dryRun
  const shouldPersistDb = !dryRun || Boolean(options?.persistInDbWhenDryRun)
  const nowIso = (options?.now || new Date()).toISOString()

  const testCheck = validateTestToEmail(options?.testTo)
  if (!testCheck.valid) {
    throw new Error(testCheck.error || 'Parámetro testTo inválido')
  }

  const supabase = await getSupabaseAdminClient()
  let query = supabase
    .from('portion_control_alerts')
    .select('*')
    .eq('is_overdue', false)
    .in('status', ['open', 'acknowledged'])
    .is('disciplinary_action_id', null)
    .lt('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(200)

  if (options?.storeId !== undefined && options?.storeId !== null && String(options.storeId).trim() !== '' && String(options.storeId).toLowerCase() !== 'all') {
    const parsedSid = Number(options.storeId)
    if (Number.isFinite(parsedSid) && parsedSid > 0) {
      query = query.eq('store_id', parsedSid)
    }
  }

  const { data: overdueRows, error } = await query
  if (error) {
    throw new Error(`Error consultando alertas vencidas (>24h SLA): ${error.message}`)
  }

  const candidates = overdueRows || []
  const overdueAlertIds: string[] = []
  const emailsDispatched: DispatchedDisciplineMailSummary[] = []
  let overdueEscalatedCount = 0

  for (const alert of candidates) {
    overdueAlertIds.push(String(alert.id))
    const storeId = Number(alert.store_id)
    const contacts = await resolveStoreChainContacts(storeId, alert.store_name)

    if (shouldPersistDb) {
      const { error: updErr } = await supabase
        .from('portion_control_alerts')
        .update({
          is_overdue: true,
          overdue_escalated_at: nowIso,
          escalated_to_execs: true,
        })
        .eq('id', alert.id)

      if (!updErr) {
        overdueEscalatedCount++
      }
    }

    const rawTo = [
      ...(contacts.supervisorEmail ? [contacts.supervisorEmail] : []),
      ...(contacts.managerEmail ? [contacts.managerEmail] : []),
    ]
    const finalTo = testCheck.email
      ? [testCheck.email]
      : Array.from(new Set((rawTo.length > 0 ? rawTo : DEFAULT_LEADERSHIP_CC).filter(Boolean)))
    const finalCc = testCheck.email
      ? []
      : Array.from(new Set(DEFAULT_LEADERSHIP_CC.filter((e) => !finalTo.includes(e))))
    const finalBcc = testCheck.email || finalTo.includes('carlos@tacosgavilan.com') ? [] : ['carlos@tacosgavilan.com']

    const cleanOverdueStore = formatStoreDisplayName({ id: storeId, name: alert.store_name || contacts.storeName }) || contacts.storeName
    const baseSubject = `⏰ [INCUMPLIMIENTO GERENCIAL >24H] ${cleanOverdueStore} — Sin Corrección de Báscula ni Strike (${alert.meat_name} +${Number(alert.variance_bags || 0).toFixed(1)} bolsas)`
    const subject = testCheck.email ? `[PRUEBA] ${baseSubject}` : baseSubject
    const appBaseUrl = resolveAppBaseUrl()
    const actionUrl = `${appBaseUrl}/admin/food-cost/meats?store_id=${encodeURIComponent(String(storeId))}&meat=${encodeURIComponent(String(alert.meat_key || 'asada'))}`

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#0F172A;">
  <div style="max-width:640px;margin:20px auto;background:#FFFFFF;border:2px solid #DC2626;border-radius:12px;overflow:hidden;">
    <div style="background:#991B1B;color:#FFFFFF;padding:20px 24px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;">TACOS GAVILAN • ESCALAMIENTO POR INCUMPLIMIENTO GERENCIAL (SLA 24 HORAS)</div>
      <div style="font-size:19px;font-weight:900;margin-top:6px;">⏰ ALERTA VENCIDA SIN CORRECCIÓN OBLIGATORIA EN TIENDA ${escapeHtmlSafe(cleanOverdueStore)}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;">
      <p style="margin-top:0;">
        La alerta obligatoria de sobre-porcionado de <strong>${escapeHtmlSafe(alert.meat_name)}</strong> (ventana <strong>${escapeHtmlSafe(alert.period_start)} → ${escapeHtmlSafe(alert.period_end)}</strong>, exceso de <strong>+${Number(alert.variance_bags || 0).toFixed(1)} bolsas / ${formatSignedUSD(Number(alert.dollar_loss_store || 0))} USD</strong>) superó el <strong>plazo fatal de 24 horas</strong> (venció: <strong>${escapeHtmlSafe(alert.due_at)}</strong>) sin que el Gerente de Sucursal registrara la calibración en báscula (5 tacos / 3 burritos) ni el Strike disciplinario correspondiente.
      </p>
      <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:14px 16px;border-radius:8px;margin:16px 0;font-size:13px;color:#7F1D1D;">
        <strong>Advertencia de Responsabilidad Gerencial:</strong> Ignorar una corrección obligatoria por más de 24 horas constituye un <strong>Incumplimiento Disciplinario Gerencial</strong>; el Supervisor Regional puede emitir directamente un Strike disciplinario al Gerente de Tienda (rol <code>Manager</code>).
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="${escapeHtmlSafe(actionUrl)}" style="display:inline-block;background:#DA291C;color:#FFFFFF;font-weight:800;font-size:13px;text-decoration:none;padding:12px 20px;border-radius:8px;">
          Intervenir Alerta Vencida Ahora →
        </a>
      </div>
    </div>
  </div>
</body>
</html>`

    if (dryRun || !sendEmails || finalTo.length === 0) {
      emailsDispatched.push({
        kind: 'manager_overdue_sla',
        to: finalTo,
        cc: finalCc,
        bcc: finalBcc,
        subject,
        sent: false,
        dryRun: dryRun || !sendEmails,
        skippedReason: dryRun || !sendEmails ? 'dry_run_or_disabled' : 'no_recipients',
      })
    } else {
      try {
        const mailRes = await sendSystemEmail({
          fromName: 'SLA Disciplinario • Tacos Gavilan',
          to: finalTo,
          cc: finalCc.length > 0 ? finalCc : undefined,
          bcc: finalBcc.length > 0 ? finalBcc : undefined,
          subject,
          html,
        })
        emailsDispatched.push({
          kind: 'manager_overdue_sla',
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          sent: true,
          dryRun: false,
          messageId: mailRes.messageId,
          providerUsed: mailRes.providerUsed,
        })
      } catch (err: any) {
        emailsDispatched.push({
          kind: 'manager_overdue_sla',
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          sent: false,
          dryRun: false,
          error: err?.message || 'Error despachando escalamiento SLA >24h',
        })
      }
    }

    if (!dryRun && sendEmails && shouldPersistDb && !testCheck.email) {
      const bellTargets = Array.from(
        new Set([...(contacts.supervisorUserId ? [contacts.supervisorUserId] : []), ...contacts.managerUserIds])
      )
      if (bellTargets.length > 0) {
        await supabase.from('notifications').insert(
          bellTargets.map((uid) => ({
            user_id: uid,
            type: 'alert',
            title: `⏰ SLA 24h Vencido: ${cleanOverdueStore}`,
            message: `Sin corrección obligatoria ni Strike en ${alert.meat_name} (+${Number(alert.variance_bags || 0).toFixed(1)} bolsas). Escalada a Supervisión y Directiva.`,
            link: `/admin/food-cost/meats?store_id=${storeId}&meat=${encodeURIComponent(String(alert.meat_key || 'asada'))}`,
            is_read: false,
            read: false,
            reference_id: String(alert.id),
            reference_type: 'portion_control_overdue_sla',
          }))
        )
      }
    }
  }

  return {
    checkedAt: nowIso,
    dryRun,
    overdueDetectedCount: candidates.length,
    overdueEscalatedCount,
    overdueAlertIds,
    emailsDispatched,
  }
}

/**
 * Consulta el registro de Strikes recientes + mapa `employee_key -> priorStrikes` (ventana de 180 días)
 * para las sucursales dentro del alcance del usuario.
 */
export async function fetchDisciplinaryContextForStores(storeIds: number[], limit = 150): Promise<{
  disciplinaryActions: PortionDisciplinaryActionRow[]
  employeeStrikeCounts: Record<string, number>
  pendingExpulsionsCount: number
}> {
  if (!storeIds || storeIds.length === 0) {
    return {
      disciplinaryActions: [],
      employeeStrikeCounts: {},
      pendingExpulsionsCount: 0,
    }
  }

  const supabase = await getSupabaseAdminClient()
  const lookbackIso = new Date(Date.now() - STRIKE_LOOKBACK_DAYS * 86_400_000).toISOString()

  const [{ data: recentRows, error: recentErr }, { data: windowRows, error: winErr }] = await Promise.all([
    supabase
      .from('portion_disciplinary_actions')
      .select('*')
      .in('store_id', storeIds)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('portion_disciplinary_actions')
      .select('id, store_id, employee_key, employee_name, expulsion_status, created_at')
      .in('store_id', storeIds)
      .gte('created_at', lookbackIso)
      .neq('expulsion_status', 'appealed_by_director')
      .limit(2000),
  ])

  if (recentErr) {
    throw new Error(`Error consultando acciones disciplinarias: ${recentErr.message}`)
  }
  if (winErr) {
    throw new Error(`Error consultando conteo de strikes 180d: ${winErr.message}`)
  }

  const disciplinaryActions = (recentRows || []) as PortionDisciplinaryActionRow[]
  const byCanonicalKey = new Map<string, Set<string>>()
  const byStoreNameKey = new Map<string, Set<string>>()

  for (const r of windowRows || []) {
    const idStr = String(r.id)
    const eKey = String(r.employee_key || '').trim()
    if (eKey) {
      let s = byCanonicalKey.get(eKey)
      if (!s) {
        s = new Set()
        byCanonicalKey.set(eKey, s)
      }
      s.add(idStr)
    }

    const nameKey = buildNameFallbackEmployeeKey(Number(r.store_id), String(r.employee_name || ''))
    let sn = byStoreNameKey.get(nameKey)
    if (!sn) {
      sn = new Set()
      byStoreNameKey.set(nameKey, sn)
    }
    sn.add(idStr)
  }

  const employeeStrikeCounts: Record<string, number> = {}
  for (const [k, setIds] of byCanonicalKey.entries()) {
    employeeStrikeCounts[k] = setIds.size
  }
  for (const [nk, setIds] of byStoreNameKey.entries()) {
    employeeStrikeCounts[nk] = Math.max(employeeStrikeCounts[nk] || 0, setIds.size)
  }

  const pendingExpulsionsCount = disciplinaryActions.filter(
    (a) => a.expulsion_status === 'pending_mandatory_expulsion'
  ).length

  return {
    disciplinaryActions,
    employeeStrikeCounts,
    pendingExpulsionsCount,
  }
}

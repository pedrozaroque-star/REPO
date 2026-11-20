/**
 * @module api/cron/sync-ronos-violations
 * @description Cron diario automatizado (11:59 AM hora California, PST/PDT) que audita las ponchadas de
 *   RONOS del día laboral anterior en todas las sucursales activas de Tacos Gavilan, cruzándolas contra:
 *   - Horario publicado del Planificador (`shifts`)
 *   - Ponchadas reales de Toast POS (`punches`)
 *   - Tarifas/estatus salarial de Simplify HR (`simplify_employee_rates`) y usuarios (`users`)
 *   Evaluando cada colaborador por hora bajo las políticas del Manual del Empleado (`NHP TEG SPANISH.pdf`):
 *   1) Puntualidad estricta (±3 min respecto al turno publicado) con exención inteligente por llamado/cobertura gerencial.
 *   2) Discrepancias Toast POS vs RONOS (`REPAIR_RONOS_PUNCH`) y tarjetas incompletas (`BROKEN_TIMECARD`) para proteger el cheque.
 *   3) Inasistencias (`NO_SHOW`), salidas tempranas (`EARLY_CLOCK_OUT`) y 3+ días consecutivos por enfermedad (`MEDICAL_NOTE_REQUIRED`).
 *   4) Comidas en RONOS: 30m exactos (`LONG_LUNCH` >=31m sin mencionar margen, `MEAL_PENALTY_SHORT` <30m, 5ta hora `>5h`, omitido `>6h`).
 *   Además genera y envía el **Reporte General Diario de Cadena (Todas las Tiendas)** consolidando las 15 sucursales.
 *
 * @businessRules
 *   - Exclusión total de Managers y Supervisores asalariados (`isExemptSalaried`).
 *   - Deduplicación estricta en `ronos_violation_notifications` por `(ronos_company_id, employee_user_id, violation_date, violation_type)`.
 *   - Envío desde `noreply@tacosgavilan.com` vía `sendSystemEmail` (`fromName: 'Sistema de Monitoreo'`) al colaborador
 *     con correo entregable (`validateEmployeeViolationEmail`) + reporte consolidado diario al Gerente de Tienda (CC Supervisor de Zona).
 *   - Reporte General Diario de Cadena (cuando se auditan todas las tiendas):
 *     * `To`: `['roberto@tacosgavilan.com', ...supervisoresActivosDeTienda]` (únicos)
 *     * `CC`: `RONOS_GENERAL_REPORT_CC` (`['Stephany@cingularhr.com', 'raquel@tacosgavilan.com']`)
 *     * `BCC`: `'carlos@tacosgavilan.com'`
 *   - Modo de Simulación Segura (`general_only=true` + `test_to`): evalúa todas las tiendas en vivo con datos reales
 *     sin enviar correos a empleados ni gerentes ni escribir en `ronos_violation_notifications`, despachando únicamente
 *     el `[SIMULACIÓN] Reporte General Diario de Auditoría RONOS (Todas las Tiendas)` al correo `test_to`.
 *   - Ventana horaria en `America/Los_Angeles` (`11:55 AM – 12:55 PM`) para que el par de crons UTC (`59 18 * * *` y `59 19 * * *`)
 *     ejecute exactamente una vez al día todo el año (PST y PDT), absorbiendo hasta 56 min de jitter de despacho en Vercel.
 *   - Día laboral de Tacos Gavilan: 6:00 AM a 5:59 AM del siguiente día.
 *
 * @dataFlow
 *   Vercel Cron (11:59 AM LA) -> `stores` (`is_active = true`) -> `getRonosStoreAudit` -> `enrichStoreAuditWithNhpPolicy`
 *     -> `ronos_violation_notifications` (dedup) -> `sendSystemEmail` (Empleado + Gerente/Supervisor + Reporte General) -> insert log.
 *
 * @notes
 *   - Soporta `GET` y `POST`, `dry_run=true`, `force=true`, `general_only=true`, `date=YYYY-MM-DD`, `company_id` / `store_id` y `test_to`.
 *   - En `dry_run=true`, `test_to` o `general_only=true`, nunca escribe en `ronos_violation_notifications`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeStoreScope, getServerUser } from '@/lib/auth-server'
import {
  getPacificBusinessDate,
  getRonosAuthToken,
  getRonosStoreAudit,
  getRonosWeeks,
  mapConcurrent,
  RONOS_STORES_MAP,
} from '@/lib/ronos-api'
import {
  enrichStoreAuditWithNhpPolicy,
  normalizeCorporateEmail,
  type EnrichedRonosEmployeeTimecard,
} from '@/lib/ronos-nhp-audit'
import {
  buildChainDailyRonosGeneralReportHtml,
  buildEmployeeRonosPolicyEmailHtml,
  buildManagerDailyRonosReportHtml,
  RONOS_GENERAL_REPORT_CC,
  RONOS_GENERAL_REPORT_LEADERSHIP,
  validateEmployeeViolationEmail,
  type ChainGeneralDailyStoreInput,
  type ManagerDailyRonosReportItem,
  type RonosDayAttendanceEvaluation,
  type RonosPolicyViolationItem,
} from '@/lib/ronos-attendance-policy'
import { sendSystemEmail } from '@/lib/system-mailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function getCaliforniaNowParts(refDate = new Date()): {
  yesterdayIso: string
  hour: number
  minute: number
  totalMinutes: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(refDate)
  const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
  const hour = rawHour === 24 ? 0 : rawHour

  const currentBizDate = getPacificBusinessDate(refDate)
  const bizNoon = new Date(`${currentBizDate}T12:00:00Z`)
  bizNoon.setUTCDate(bizNoon.getUTCDate() - 1)

  return {
    yesterdayIso: bizNoon.toISOString().slice(0, 10),
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  }
}

export async function GET(req: Request) {
  return handleSyncRonosViolations(req)
}

export async function POST(req: Request) {
  return handleSyncRonosViolations(req)
}

async function handleSyncRonosViolations(req: Request) {
  const startTime = Date.now()
  const url = new URL(req.url)

  let body: Record<string, any> = {}
  if (req.method === 'POST') {
    body = await req.json().catch(() => ({}))
  }

  const rawDryRun = url.searchParams.get('dry_run') ?? body.dry_run
  const isDryRun = rawDryRun === true || String(rawDryRun).toLowerCase() === 'true'

  const rawForce = url.searchParams.get('force') ?? body.force
  const forceRun = rawForce === true || String(rawForce).toLowerCase() === 'true'

  const rawGeneralOnly = url.searchParams.get('general_only') ?? body.general_only
  const generalOnly =
    rawGeneralOnly === true || String(rawGeneralOnly).toLowerCase() === 'true'

  const rawTestTo = url.searchParams.get('test_to') ?? body.test_to
  const testTo = typeof rawTestTo === 'string' && rawTestTo.trim() ? rawTestTo.trim() : null

  const explicitDateParam =
    (url.searchParams.get('date') ?? body.date)?.toString().trim() || null
  if (explicitDateParam && !/^\d{4}-\d{2}-\d{2}$/.test(explicitDateParam)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro date inválido: debe tener formato YYYY-MM-DD' },
      { status: 400 }
    )
  }

  const targetCompanyParam =
    (
      url.searchParams.get('company_id') ??
      url.searchParams.get('companyId') ??
      body.company_id ??
      body.companyId
    )
      ?.toString()
      .trim() || null
  if (targetCompanyParam && !/^\d+$/.test(targetCompanyParam)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro company_id inválido: debe ser numérico' },
      { status: 400 }
    )
  }

  const targetStoreParam =
    (
      url.searchParams.get('store_id') ??
      url.searchParams.get('storeId') ??
      body.store_id ??
      body.storeId
    )
      ?.toString()
      .trim() || null

  // 1. Autenticación (Cron Secret o sesión autorizada admin/supervisor/manager por tienda)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  const validCronBearer =
    Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`

  let authUser: Awaited<ReturnType<typeof getServerUser>> = null
  if (!validCronBearer && !isDryRun) {
    authUser = await getServerUser(req)
    if (!authUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const role = (authUser.role || '').toLowerCase()
    const isGlobalStaff = role.includes('admin') || role.includes('supervisor')
    if (!isGlobalStaff) {
      if (role.includes('manager') || role.includes('gerente')) {
        let resolvedScopeTarget: string | number | null = targetStoreParam
        if (!resolvedScopeTarget && targetCompanyParam) {
          const meta = RONOS_STORES_MAP.find(
            (r) => r.ronosCompanyId === Number(targetCompanyParam)
          )
          resolvedScopeTarget = meta?.tegStoreId ?? null
        }
        if (!resolvedScopeTarget || generalOnly) {
          return NextResponse.json(
            {
              success: false,
              error: 'Debes especificar store_id o company_id autorizado para tu sucursal.',
            },
            { status: 403 }
          )
        }
        const scopeCheck = await authorizeStoreScope(authUser, resolvedScopeTarget, supabaseAdmin, {
          requireWrite: true,
          allowedRoles: ['admin', 'supervisor', 'manager'],
        })
        if (!scopeCheck.authorized) {
          return NextResponse.json(
            { success: false, error: scopeCheck.error || 'Forbidden' },
            { status: scopeCheck.status || 403 }
          )
        }
      } else {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  // 2. Verificar ventana horaria oficial en America/Los_Angeles (11:59 AM PT)
  const {
    yesterdayIso,
    hour: laHour,
    minute: laMinute,
    totalMinutes: laTotalMinutes,
  } = getCaliforniaNowParts()
  const hasExplicitOverride =
    forceRun || isDryRun || Boolean(testTo) || Boolean(explicitDateParam) || generalOnly

  const inScheduledWindow = laTotalMinutes >= 11 * 60 + 55 && laTotalMinutes <= 12 * 60 + 55
  if (!hasExplicitOverride && !inScheduledWindow) {
    return NextResponse.json({
      success: true,
      skipped: true,
      la_hour: laHour,
      la_minute: laMinute,
      reason: 'Waiting for 11:55 AM–12:55 PM America/Los_Angeles execution window',
    })
  }

  const targetDate = explicitDateParam || yesterdayIso
  const isChainScope = (!targetCompanyParam && !targetStoreParam) || generalOnly

  console.log(
    `🚀 [CRON 11:59 AM RONOS NHP] Starting Daily RONOS Attendance & Punch-Repair Audit for Business Date: ${targetDate} (dryRun=${isDryRun}, generalOnly=${generalOnly}, testTo=${testTo || 'none'})`
  )

  try {
    // 3. Consultar tiendas activas, usuarios y notificaciones previas de `targetDate`
    const [
      { data: dbStores, error: storesError },
      { data: allUsers, error: usersError },
      { data: existingNotifs, error: existingErr },
    ] = await Promise.all([
      supabaseAdmin
        .from('stores')
        .select(
          'id, code, name, external_id, supervisor_id, supervisor_name, is_active, users!stores_supervisor_id_fkey(full_name, email, google_email_connected)'
        )
        .eq('is_active', true),
      supabaseAdmin
        .from('users')
        .select('id, full_name, email, role, store_id, is_active, google_email_connected'),
      supabaseAdmin
        .from('ronos_violation_notifications')
        .select('ronos_company_id, employee_user_id, violation_date, violation_type')
        .eq('violation_date', targetDate),
    ])

    if (storesError) {
      console.error('Error fetching stores:', storesError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch stores: ' + storesError.message },
        { status: 500 }
      )
    }
    if (usersError) {
      console.warn('Warning fetching users:', usersError)
    }
    if (existingErr) {
      console.warn('Warning fetching existing ronos_violation_notifications:', existingErr)
    }

    const registeredCorporateEmails = new Set<string>()
    for (const u of allUsers || []) {
      if (u.email) registeredCorporateEmails.add(String(u.email).trim().toLowerCase())
      if (u.google_email_connected) {
        registeredCorporateEmails.add(String(u.google_email_connected).trim().toLowerCase())
      }
    }

    const existingDedupeKeys = new Set<string>()
    for (const row of existingNotifs || []) {
      if (!row) continue
      const key = `${Number(row.ronos_company_id)}::${Number(row.employee_user_id)}::${String(row.violation_date).slice(0, 10)}::${String(row.violation_type)}`
      existingDedupeKeys.add(key)
    }

    interface TargetStoreJob {
      tegStoreId: number
      storeCode: string
      storeName: string
      storeExternalId: string | null
      ronosCompanyId: number
      supervisorName: string | null
      supervisorEmail: string | null
    }

    const candidateStores: TargetStoreJob[] = []
    const matchedCompanyIds = new Set<number>()

    for (const s of dbStores || []) {
      const cleanName = (s.name || 'Tacos Gavilan').replace(/toast/i, '').trim()
      const cleanMatchName = cleanName.replace(/^Tacos Gavilan\s+/i, '').trim().toLowerCase()
      const mapEntry = RONOS_STORES_MAP.find(
        (r) =>
          r.tegStoreId === Number(s.id) ||
          (s.code && r.tegCode.toUpperCase() === String(s.code).toUpperCase()) ||
          r.tegName.toLowerCase() === cleanMatchName
      )
      if (!mapEntry) continue
      matchedCompanyIds.add(mapEntry.ronosCompanyId)
      const supRel = s.users as any
      const rawSupEmail = supRel?.google_email_connected || supRel?.email || null
      const rawSupName = s.supervisor_name || supRel?.full_name || null
      candidateStores.push({
        tegStoreId: Number(s.id),
        storeCode: mapEntry.tegCode,
        storeName: cleanName || mapEntry.tegName,
        storeExternalId: s.external_id || null,
        ronosCompanyId: mapEntry.ronosCompanyId,
        supervisorName: rawSupName ? String(rawSupName).trim() : null,
        supervisorEmail: normalizeCorporateEmail(rawSupEmail),
      })
    }

    // Incluir La Bodega explícitamente solo si se solicita vía `company_id=28`
    for (const r of RONOS_STORES_MAP) {
      if (
        !matchedCompanyIds.has(r.ronosCompanyId) &&
        targetCompanyParam === String(r.ronosCompanyId)
      ) {
        candidateStores.push({
          tegStoreId: r.tegStoreId,
          storeCode: r.tegCode,
          storeName: r.tegName,
          storeExternalId: null,
          ronosCompanyId: r.ronosCompanyId,
          supervisorName: null,
          supervisorEmail: null,
        })
      }
    }

    const storesToAudit = candidateStores
      .filter((st) => {
        if (targetCompanyParam && st.ronosCompanyId !== Number(targetCompanyParam)) {
          return false
        }
        if (targetStoreParam) {
          if (/^\d+$/.test(targetStoreParam)) {
            return st.tegStoreId === Number(targetStoreParam)
          }
          return (
            st.storeExternalId === targetStoreParam ||
            st.storeCode.toLowerCase() === targetStoreParam.toLowerCase()
          )
        }
        return true
      })
      .sort((a, b) => a.storeName.localeCompare(b.storeName))

    if (storesToAudit.length === 0) {
      return NextResponse.json({
        success: true,
        dry_run: isDryRun,
        general_only: generalOnly,
        message: 'No active matching stores found to audit',
        business_date: targetDate,
        total_violations: 0,
        emails_sent: 0,
        stores_processed: [],
        duration_ms: Date.now() - startTime,
      })
    }

    // 3b. Pre-validar sesión OAuth2 en RONOS antes de iterar las tiendas:
    //     1) Pre-calienta `cachedSession` una sola vez para el pool concurrente.
    //     2) Si faltan credenciales (`RONOS_USER` / `RONOS_PASS`) o RONOS rechaza el login,
    //        retorna HTTP 500 explícito en lugar de omitir silenciosamente las 15 sucursales.
    try {
      await getRonosAuthToken(forceRun)
    } catch (authErr: any) {
      const msg = authErr?.message || String(authErr)
      console.error('[CRON 11:59 AM RONOS NHP] Fatal RONOS Auth failure:', msg)
      return NextResponse.json(
        {
          success: false,
          error: `Fallo de autenticación con RONOS API: ${msg}`,
          business_date: targetDate,
          duration_ms: Date.now() - startTime,
        },
        { status: 500 }
      )
    }

    // 4. Auditar cada tienda con concurrencia controlada (pool de 4 tiendas)
    const perStoreOutcomes = await mapConcurrent(storesToAudit, 4, async (storeJob) => {
      // Resolver Gerente(s) de Tienda ACTIVO(S) y Supervisor de Zona
      const activeManagers = (allUsers || []).filter((u: any) => {
        if (!u.is_active) return false
        if (Number(u.store_id) !== storeJob.tegStoreId) return false
        const r = String(u.role || '').toLowerCase()
        return (
          (r.includes('manager') || r.includes('gerente')) &&
          !r.includes('asst') &&
          !r.includes('assist') &&
          !r.includes('asistente') &&
          !r.includes('shift')
        )
      })

      const managerEmails = Array.from(
        new Set(
          activeManagers
            .map((m: any) => normalizeCorporateEmail(m.google_email_connected || m.email))
            .filter(
              (e): e is string =>
                Boolean(e) &&
                e !== 'carlos@tacosgavilan.com' &&
                e !== 'roque@tacosgavilan.com'
            )
        )
      )
      const primaryManagerName =
        activeManagers.find((m: any) => m.full_name)?.full_name || null

      const safeSupervisorEmail =
        storeJob.supervisorEmail &&
        storeJob.supervisorEmail !== 'carlos@tacosgavilan.com' &&
        storeJob.supervisorEmail !== 'roque@tacosgavilan.com'
          ? storeJob.supervisorEmail
          : null
      const primaryManagerEmail = managerEmails[0] || safeSupervisorEmail || null

      try {
        const weeks = await getRonosWeeks(storeJob.ronosCompanyId, forceRun)
        const matchingWeek = weeks.find((w) => {
          const wStart = String(w.startDate || '').slice(0, 10)
          const wEnd = String(w.endDate || '').slice(0, 10)
          return wStart && wEnd && targetDate >= wStart && targetDate <= wEnd
        })

        if (!matchingWeek?.weekId) {
          const reason = `No RONOS work week found containing ${targetDate}`
          return {
            summary: {
              storeGuid: storeJob.storeExternalId,
              ronosCompanyId: storeJob.ronosCompanyId,
              storeName: storeJob.storeName,
              supervisorName: storeJob.supervisorName,
              supervisorEmail: safeSupervisorEmail,
              managerRecipients: managerEmails,
              skipped: true,
              reason,
              violationsCount: 0,
              authorizedCallInsCount: 0,
              emailsSent: 0,
              recordsInserted: 0,
            },
            generalStoreInput: {
              storeName: storeJob.storeName,
              storeCode: storeJob.storeCode,
              ronosCompanyId: storeJob.ronosCompanyId,
              supervisorName: storeJob.supervisorName,
              supervisorEmail: safeSupervisorEmail,
              managerEmails,
              evaluatedHourlyCount: 0,
              exemptSalariedCount: 0,
              items: [],
              authorizedCallIns: [],
              error: reason,
            } as ChainGeneralDailyStoreInput,
          }
        }

        const rawAudit = await getRonosStoreAudit(
          storeJob.ronosCompanyId,
          matchingWeek.weekId,
          forceRun || (!isDryRun && !generalOnly)
        )

        const { enrichedAudit } = await enrichStoreAuditWithNhpPolicy(rawAudit, {
          targetDateOnly: targetDate,
        })

        interface PendingEmployeeNotice {
          emp: EnrichedRonosEmployeeTimecard
          ev: RonosDayAttendanceEvaluation
          activeViolations: RonosPolicyViolationItem[]
          unnotifiedViolations: RonosPolicyViolationItem[]
          rawEmployeeEmail: string | null
          validEmployeeEmail: string | null
          emailInvalidReason: string
        }

        const pendingNotices: PendingEmployeeNotice[] = []
        const allStoreViolatingItemsForGeneral: ManagerDailyRonosReportItem[] = []
        const authorizedCallIns: ManagerDailyRonosReportItem[] = []
        const authorizedEarlyOuts: ManagerDailyRonosReportItem[] = []
        const voluntaryExtendedStays: ManagerDailyRonosReportItem[] = []
        let skippedAlreadyNotified = 0
        let exemptSalariedCount = 0
        let evaluatedHourlyCount = 0

        for (const emp of enrichedAudit.employees) {
          if (emp.isInactiveMapping) continue
          if (emp.isSalaried || emp.nhpSummary?.isExemptSalaried) {
            exemptSalariedCount++
            continue
          }

          const dayRec = emp.days.find((d) => String(d.date || '').slice(0, 10) === targetDate)
          const ev = dayRec?.nhpEvaluation
          if (!ev || ev.isExemptSalaried) {
            if (ev?.isExemptSalaried) exemptSalariedCount++
            continue
          }

          const hadDayActivityOrSchedule =
            ev.scheduledShift.hasPublishedShift ||
            ev.ronosSummary.hasRonosPunches ||
            ev.toastSummary.hasToastPunches ||
            ev.ronosSummary.isSick ||
            ev.ronosSummary.isVacation ||
            ev.ronosSummary.isHoliday ||
            ev.violations.some((v) => v.isViolation)

          if (hadDayActivityOrSchedule) {
            evaluatedHourlyCount++
          }

          if (ev.isAuthorizedEarlyCallIn) {
            authorizedCallIns.push({
              employeeUserId: emp.employeeUserId,
              employeeName: emp.fullName,
              jobTitle: emp.jobTitle,
              evaluation: ev,
              deliveryStatusLabel: '🛡️ Exento (Cobertura / Solicitud Gerencial)',
              emailDelivered: false,
            })
          }

          if (ev.isAuthorizedVoluntaryEarlyOut) {
            authorizedEarlyOuts.push({
              employeeUserId: emp.employeeUserId,
              employeeName: emp.fullName,
              jobTitle: emp.jobTitle,
              evaluation: ev,
              deliveryStatusLabel: '📉 Exento (Baja Venta / Cierre Operativo)',
              emailDelivered: false,
            })
          }

          if (ev.isVoluntaryExtendedStay) {
            voluntaryExtendedStays.push({
              employeeUserId: emp.employeeUserId,
              employeeName: emp.fullName,
              jobTitle: emp.jobTitle,
              evaluation: ev,
              deliveryStatusLabel: '⏱️ Permanencia Extendida Voluntaria',
              emailDelivered: false,
            })
          }

          const activeViolations = ev.violations.filter((v) => v.isViolation)
          if (activeViolations.length === 0) continue

          const rawEmail = emp.toastEmail || null
          const emailCheck = validateEmployeeViolationEmail(rawEmail, registeredCorporateEmails)

          const simulatedDeliveryLabel = emailCheck.cleanEmail
            ? `Se enviaría a ${emailCheck.cleanEmail}`
            : rawEmail
              ? `⚠️ Correo inválido en Toast (${rawEmail})`
              : '⚠️ Sin correo en Toast POS'

          allStoreViolatingItemsForGeneral.push({
            employeeUserId: emp.employeeUserId,
            employeeName: emp.fullName,
            jobTitle: emp.jobTitle,
            evaluation: ev,
            deliveryStatusLabel: simulatedDeliveryLabel,
            emailDelivered: false,
          })

          const unnotifiedViolations =
            testTo || generalOnly
              ? activeViolations
              : activeViolations.filter(
                  (v) =>
                    !existingDedupeKeys.has(
                      `${storeJob.ronosCompanyId}::${emp.employeeUserId}::${targetDate}::${v.type}`
                    )
                )

          if (unnotifiedViolations.length === 0) {
            skippedAlreadyNotified += activeViolations.length
            continue
          }

          pendingNotices.push({
            emp,
            ev,
            activeViolations,
            unnotifiedViolations,
            rawEmployeeEmail: rawEmail,
            validEmployeeEmail: emailCheck.cleanEmail,
            emailInvalidReason: emailCheck.reason,
          })
        }

        const totalViolationItemsCount = pendingNotices.reduce(
          (sum, n) => sum + n.unnotifiedViolations.length,
          0
        )

        // Modo dry_run o general_only: NO enviar correos individuales ni por tienda ni escribir en BD
        if (isDryRun || generalOnly) {
          return {
            summary: {
              storeGuid: storeJob.storeExternalId,
              ronosCompanyId: storeJob.ronosCompanyId,
              storeName: storeJob.storeName,
              supervisorName: storeJob.supervisorName,
              supervisorEmail: safeSupervisorEmail,
              managerRecipients: managerEmails,
              evaluatedHourlyCount,
              violationsCount: totalViolationItemsCount,
              employeesWithViolationsCount: pendingNotices.length,
              skippedAlreadyNotified,
              authorizedCallInsCount: authorizedCallIns.length,
              authorizedEarlyOutsCount: authorizedEarlyOuts.length,
              voluntaryExtendedStaysCount: voluntaryExtendedStays.length,
              exemptSalariedCount,
              emailsSent: 0,
              recordsInserted: 0,
              sample: pendingNotices.slice(0, 8).map((n) => ({
                employeeUserId: n.emp.employeeUserId,
                employee: n.emp.fullName,
                punctualityStatus: n.ev.punctualityStatus,
                violationTypes: n.unnotifiedViolations.map((v) => v.type),
                scheduledShift: n.ev.scheduledShift.hasPublishedShift
                  ? `${n.ev.scheduledShift.startTimeLA} - ${n.ev.scheduledShift.endTimeLA}`
                  : null,
                ronosClockIn: n.ev.ronosSummary.clockInLA,
                ronosClockOut: n.ev.ronosSummary.clockOutLA,
                toastClockIn: n.ev.toastSummary.clockInLA,
                toastClockOut: n.ev.toastSummary.clockOutLA,
                deliverableEmail: n.validEmployeeEmail,
                emailReason: n.emailInvalidReason,
              })),
              authorizedCallInsSample: authorizedCallIns.slice(0, 5).map((c) => ({
                employee: c.employeeName,
                scheduledStart: c.evaluation.scheduledShift.startTimeLA,
                ronosClockIn: c.evaluation.ronosSummary.clockInLA,
                exemptionReason: c.evaluation.exemptionReason,
                signals: c.evaluation.earlyCallInSignals,
              })),
              authorizedEarlyOutsSample: authorizedEarlyOuts.slice(0, 8).map((c) => ({
                employee: c.employeeName,
                scheduledEnd: c.evaluation.scheduledShift.endTimeLA,
                ronosClockOut: c.evaluation.ronosSummary.clockOutLA,
                toastClockOut: c.evaluation.toastSummary.clockOutLA,
                reason: c.evaluation.authorizedEarlyOutReason,
              })),
              voluntaryExtendedStaysSample: voluntaryExtendedStays.slice(0, 8).map((c) => ({
                employee: c.employeeName,
                scheduledEnd: c.evaluation.scheduledShift.endTimeLA,
                ronosClockOut: c.evaluation.ronosSummary.clockOutLA,
                extendedStayMinutes: c.evaluation.extendedStayMinutes,
                note: c.evaluation.voluntaryExtendedStayNote,
              })),
            },
            generalStoreInput: {
              storeName: storeJob.storeName,
              storeCode: storeJob.storeCode,
              ronosCompanyId: storeJob.ronosCompanyId,
              supervisorName: storeJob.supervisorName,
              supervisorEmail: safeSupervisorEmail,
              managerEmails,
              evaluatedHourlyCount,
              exemptSalariedCount,
              items: allStoreViolatingItemsForGeneral,
              authorizedCallIns,
              authorizedEarlyOuts,
              voluntaryExtendedStays,
            } as ChainGeneralDailyStoreInput,
          }
        }

        if (pendingNotices.length === 0) {
          return {
            summary: {
              storeGuid: storeJob.storeExternalId,
              ronosCompanyId: storeJob.ronosCompanyId,
              storeName: storeJob.storeName,
              supervisorName: storeJob.supervisorName,
              supervisorEmail: safeSupervisorEmail,
              managerRecipients: managerEmails,
              evaluatedHourlyCount,
              violationsCount: 0,
              skippedAlreadyNotified,
              authorizedCallInsCount: authorizedCallIns.length,
              authorizedEarlyOutsCount: authorizedEarlyOuts.length,
              voluntaryExtendedStaysCount: voluntaryExtendedStays.length,
              exemptSalariedCount,
              emailsSent: 0,
              recordsInserted: 0,
            },
            generalStoreInput: {
              storeName: storeJob.storeName,
              storeCode: storeJob.storeCode,
              ronosCompanyId: storeJob.ronosCompanyId,
              supervisorName: storeJob.supervisorName,
              supervisorEmail: safeSupervisorEmail,
              managerEmails,
              evaluatedHourlyCount,
              exemptSalariedCount,
              items: allStoreViolatingItemsForGeneral,
              authorizedCallIns,
              authorizedEarlyOuts,
              voluntaryExtendedStays,
            } as ChainGeneralDailyStoreInput,
          }
        }

        // 5a. Despachar correos individuales en lotes de 4
        let storeEmailsSent = 0
        let senderUsed = 'noreply@tacosgavilan.com'
        const managerTableItems: ManagerDailyRonosReportItem[] = []
        const dispatchResults: Array<{
          notice: PendingEmployeeNotice
          employeeSent: boolean
          messageId: string | null
          statusLabel: string
        }> = []

        const BATCH_SIZE = 4
        for (let i = 0; i < pendingNotices.length; i += BATCH_SIZE) {
          const batch = pendingNotices.slice(i, i + BATCH_SIZE)
          const batchOut = await Promise.all(
            batch.map(async (notice) => {
              let employeeSent = false
              let messageId: string | null = null
              let statusLabel = '⚠️ Sin correo en Toast POS (Notificar en persona)'

              const evalForEmail: RonosDayAttendanceEvaluation = {
                ...notice.ev,
                violations: notice.unnotifiedViolations,
              }

              if (notice.validEmployeeEmail) {
                const { subject, html } = buildEmployeeRonosPolicyEmailHtml({
                  storeName: storeJob.storeName,
                  employeeName: notice.emp.fullName,
                  employeeJobTitle: notice.emp.jobTitle,
                  businessDate: targetDate,
                  evaluation: evalForEmail,
                  managerContactEmail: primaryManagerEmail,
                  managerName: primaryManagerName,
                  warningStage: 'first',
                })

                const targetRecipient = testTo || notice.validEmployeeEmail
                try {
                  const res = await sendSystemEmail({
                    fromName: 'Sistema de Monitoreo',
                    to: targetRecipient,
                    replyTo: primaryManagerEmail || undefined,
                    subject: testTo ? `[PRUEBA EMPLEADO] ${subject}` : subject,
                    html,
                  })
                  senderUsed = res.fromEmail
                  messageId = res.messageId
                  employeeSent = true
                  statusLabel = `✓ Enviado (${notice.validEmployeeEmail})`
                } catch (empErr: any) {
                  console.error(
                    `[sync-ronos-violations] Error enviando correo a ${notice.validEmployeeEmail}:`,
                    empErr?.message || empErr
                  )
                  statusLabel = `⚠️ Error al enviar (${notice.validEmployeeEmail})`
                }
              } else if (notice.rawEmployeeEmail) {
                statusLabel = `⚠️ Correo inválido en Toast (${notice.rawEmployeeEmail})`
              }

              return {
                notice,
                employeeSent,
                messageId,
                statusLabel,
                managerItem: {
                  employeeUserId: notice.emp.employeeUserId,
                  employeeName: notice.emp.fullName,
                  jobTitle: notice.emp.jobTitle,
                  evaluation: evalForEmail,
                  deliveryStatusLabel: statusLabel,
                  emailDelivered: employeeSent,
                } as ManagerDailyRonosReportItem,
              }
            })
          )

          for (const out of batchOut) {
            if (out.employeeSent) storeEmailsSent++
            managerTableItems.push(out.managerItem)
            dispatchResults.push({
              notice: out.notice,
              employeeSent: out.employeeSent,
              messageId: out.messageId,
              statusLabel: out.statusLabel,
            })
          }
        }

        // 5b. Enviar Reporte Diario Consolidado al Gerente de Tienda (con CC al Supervisor de Zona)
        const effectiveManagerTo = testTo
          ? [testTo]
          : managerEmails.length > 0
            ? managerEmails
            : safeSupervisorEmail
              ? [safeSupervisorEmail]
              : ['noreply@tacosgavilan.com']

        const effectiveManagerCc =
          !testTo && safeSupervisorEmail && !effectiveManagerTo.includes(safeSupervisorEmail)
            ? safeSupervisorEmail
            : undefined

        let managerSummarySent = false
        let managerMessageId: string | null = null
        try {
          const { subject: mgrSubject, html: mgrHtml } = buildManagerDailyRonosReportHtml({
            storeName: storeJob.storeName,
            businessDate: targetDate,
            items: managerTableItems,
            authorizedCallIns,
            authorizedEarlyOuts,
            voluntaryExtendedStays,
            isManualDispatch: forceRun,
          })

          const mgrRes = await sendSystemEmail({
            fromName: 'Sistema de Monitoreo',
            to: effectiveManagerTo,
            cc: effectiveManagerCc,
            subject: testTo ? `[PRUEBA GERENTE] ${mgrSubject}` : mgrSubject,
            html: mgrHtml,
          })
          senderUsed = mgrRes.fromEmail
          managerMessageId = mgrRes.messageId
          managerSummarySent = true
          storeEmailsSent++
        } catch (mgrErr: any) {
          console.error(
            `[sync-ronos-violations] Error enviando reporte gerencial a ${storeJob.storeName}:`,
            mgrErr?.message || mgrErr
          )
        }

        // 5c. Registrar notificaciones en `ronos_violation_notifications` (salvo modo `test_to`)
        let recordsInserted = 0
        if (!testTo && (managerSummarySent || storeEmailsSent > 0)) {
          const rowsToInsert: any[] = []
          for (const dr of dispatchResults) {
            if (!dr.employeeSent && !managerSummarySent) continue
            for (const v of dr.notice.unnotifiedViolations) {
              rowsToInsert.push({
                ronos_company_id: storeJob.ronosCompanyId,
                store_name: storeJob.storeName,
                employee_user_id: dr.notice.emp.employeeUserId,
                employee_name: dr.notice.emp.fullName,
                employee_email:
                  dr.notice.validEmployeeEmail ||
                  dr.notice.rawEmployeeEmail ||
                  'sin-correo@no-registrado.local',
                violation_type: v.type,
                violation_title: v.title,
                violation_date: targetDate,
                violation_details: {
                  stage: 'first',
                  source: 'sync-ronos-violations',
                  category: v.category,
                  description: v.description,
                  policyReference: v.policyReference,
                  actionRequired: v.actionRequired,
                  scheduledShift: dr.notice.ev.scheduledShift,
                  ronosSummary: dr.notice.ev.ronosSummary,
                  toastSummary: dr.notice.ev.toastSummary,
                  emailDelivered: dr.employeeSent,
                  emailInvalidReason: dr.notice.emailInvalidReason,
                  managerRecipients: effectiveManagerTo,
                  supervisorCc: effectiveManagerCc || null,
                },
                recipients_to:
                  dr.employeeSent && dr.notice.validEmployeeEmail
                    ? [dr.notice.validEmployeeEmail]
                    : effectiveManagerTo,
                recipients_cc: effectiveManagerCc ? [effectiveManagerCc] : [],
                sent_by: senderUsed,
                status: 'sent',
                email_message_id:
                  dr.messageId ||
                  managerMessageId ||
                  `cron-ronos-${targetDate}-${dr.notice.emp.employeeUserId}-${v.type}`,
              })
            }
          }

          if (rowsToInsert.length > 0) {
            const { error: insertErr } = await supabaseAdmin
              .from('ronos_violation_notifications')
              .insert(rowsToInsert)
            if (insertErr) {
              console.error(
                `❌ Error inserting ronos_violation_notifications for ${storeJob.storeName}:`,
                insertErr
              )
            } else {
              recordsInserted = rowsToInsert.length
            }
          }
        }

        // Actualizar items para el reporte general con el estatus real de envío
        const dispatchedByUserId = new Map<number, { delivered: boolean; label: string }>()
        for (const dr of dispatchResults) {
          dispatchedByUserId.set(dr.notice.emp.employeeUserId, {
            delivered: dr.employeeSent,
            label: dr.statusLabel,
          })
        }
        const generalStoreItems = allStoreViolatingItemsForGeneral.map((it) => {
          const d = dispatchedByUserId.get(it.employeeUserId)
          return d
            ? { ...it, emailDelivered: d.delivered, deliveryStatusLabel: d.label }
            : { ...it, emailDelivered: true, deliveryStatusLabel: '✓ Notificado previamente' }
        })

        return {
          summary: {
            storeGuid: storeJob.storeExternalId,
            ronosCompanyId: storeJob.ronosCompanyId,
            storeName: storeJob.storeName,
            supervisorName: storeJob.supervisorName,
            supervisorEmail: safeSupervisorEmail,
            managerRecipients: effectiveManagerTo,
            supervisorCc: effectiveManagerCc || null,
            senderUsed,
            evaluatedHourlyCount,
            violationsCount: totalViolationItemsCount,
            employeesWithViolationsCount: pendingNotices.length,
            skippedAlreadyNotified,
            authorizedCallInsCount: authorizedCallIns.length,
            authorizedEarlyOutsCount: authorizedEarlyOuts.length,
            voluntaryExtendedStaysCount: voluntaryExtendedStays.length,
            exemptSalariedCount,
            emailsSent: storeEmailsSent,
            recordsInserted,
          },
          generalStoreInput: {
            storeName: storeJob.storeName,
            storeCode: storeJob.storeCode,
            ronosCompanyId: storeJob.ronosCompanyId,
            supervisorName: storeJob.supervisorName,
            supervisorEmail: safeSupervisorEmail,
            managerEmails,
            evaluatedHourlyCount,
            exemptSalariedCount,
            items: generalStoreItems,
            authorizedCallIns,
            authorizedEarlyOuts,
            voluntaryExtendedStays,
          } as ChainGeneralDailyStoreInput,
        }
      } catch (storeErr: any) {
        console.error(
          `[sync-ronos-violations] Error auditando tienda ${storeJob.storeName}:`,
          storeErr?.message || storeErr
        )
        const errMsg = storeErr?.message || 'Error inesperado auditando sucursal'
        return {
          summary: {
            storeGuid: storeJob.storeExternalId,
            ronosCompanyId: storeJob.ronosCompanyId,
            storeName: storeJob.storeName,
            supervisorName: storeJob.supervisorName,
            supervisorEmail: safeSupervisorEmail,
            error: errMsg,
            violationsCount: 0,
            authorizedCallInsCount: 0,
            authorizedEarlyOutsCount: 0,
            voluntaryExtendedStaysCount: 0,
            emailsSent: 0,
            recordsInserted: 0,
          },
          generalStoreInput: {
            storeName: storeJob.storeName,
            storeCode: storeJob.storeCode,
            ronosCompanyId: storeJob.ronosCompanyId,
            supervisorName: storeJob.supervisorName,
            supervisorEmail: safeSupervisorEmail,
            managerEmails,
            evaluatedHourlyCount: 0,
            exemptSalariedCount: 0,
            items: [],
            authorizedCallIns: [],
            authorizedEarlyOuts: [],
            voluntaryExtendedStays: [],
            error: errMsg,
          } as ChainGeneralDailyStoreInput,
        }
      }
    })

    const storeSummaries = perStoreOutcomes.map((o) => o.summary)
    const generalStoreInputs = perStoreOutcomes.map((o) => o.generalStoreInput)

    let totalViolations = storeSummaries.reduce(
      (sum, s) => sum + (s?.violationsCount || 0),
      0
    )
    let totalEmailsSent = storeSummaries.reduce((sum, s) => sum + (s?.emailsSent || 0), 0)
    const totalRecordsInserted = storeSummaries.reduce(
      (sum, s) => sum + (s?.recordsInserted || 0),
      0
    )
    const totalAuthorizedCallIns = storeSummaries.reduce(
      (sum, s) => sum + (s?.authorizedCallInsCount || 0),
      0
    )
    const totalAuthorizedEarlyOuts = storeSummaries.reduce(
      (sum, s) => sum + (s?.authorizedEarlyOutsCount || 0),
      0
    )
    const totalVoluntaryExtendedStays = storeSummaries.reduce(
      (sum, s) => sum + (s?.voluntaryExtendedStaysCount || 0),
      0
    )

    // 6. Construir y despachar el Reporte General Diario de Cadena (Todas las Tiendas)
    let generalReportMeta: {
      sent: boolean
      isSimulation: boolean
      fromEmail: string | null
      messageId: string | null
      to: string[]
      cc: string[]
      intendedTo: string[]
      intendedCc: string[]
      subject: string
      htmlBytes?: number
      htmlKb?: number
      storesCount: number
      totalEvaluatedHourly: number
      totalAlertEmployees: number
      error?: string
    } | null = null

    if (isChainScope) {
      const activeSupervisorEmails = Array.from(
        new Set(
          storesToAudit
            .map((st) => st.supervisorEmail)
            .filter(
              (e): e is string =>
                Boolean(e) &&
                e !== 'carlos@tacosgavilan.com' &&
                e !== 'roque@tacosgavilan.com'
            )
        )
      )

      const intendedTo = Array.from(
        new Set([...RONOS_GENERAL_REPORT_LEADERSHIP, ...activeSupervisorEmails])
      )
      const intendedToLower = new Set(intendedTo.map((e) => e.toLowerCase()))
      const intendedCc = RONOS_GENERAL_REPORT_CC.filter(
        (e) => !intendedToLower.has(e.trim().toLowerCase())
      )

      const isSimulationMode = Boolean(testTo)
      const simulationTag = isSimulationMode
        ? `${String(laHour).padStart(2, '0')}:${String(laMinute).padStart(2, '0')}`
        : null
      const { subject: genSubject, html: genHtml } = buildChainDailyRonosGeneralReportHtml({
        businessDate: targetDate,
        stores: generalStoreInputs,
        intendedTo,
        intendedCc,
        isSimulation: isSimulationMode,
        isManualDispatch: forceRun || generalOnly,
        simulationRecipientEmail: testTo,
        simulationTag,
      })
      const genHtmlBytes = Buffer.byteLength(genHtml, 'utf8')
      const genHtmlKb = Number((genHtmlBytes / 1024).toFixed(2))

      const totalEvaluatedHourly = generalStoreInputs.reduce(
        (sum, st) => sum + (st.evaluatedHourlyCount || 0),
        0
      )
      const totalAlertEmployees = generalStoreInputs.reduce(
        (sum, st) => sum + (st.items?.length || 0),
        0
      )
      if (isDryRun || generalOnly) {
        totalViolations = generalStoreInputs.reduce(
          (sum, st) =>
            sum +
            (st.items || []).reduce(
              (acc, it) => acc + it.evaluation.violations.filter((v) => v.isViolation).length,
              0
            ),
          0
        )
      }

      if (isDryRun) {
        generalReportMeta = {
          sent: false,
          isSimulation: isSimulationMode,
          fromEmail: null,
          messageId: null,
          to: isSimulationMode && testTo ? [testTo] : intendedTo,
          cc: isSimulationMode ? [] : intendedCc,
          intendedTo,
          intendedCc,
          subject: genSubject,
          htmlBytes: genHtmlBytes,
          htmlKb: genHtmlKb,
          storesCount: generalStoreInputs.length,
          totalEvaluatedHourly,
          totalAlertEmployees,
        }
      } else {
        try {
          const effectiveTo = isSimulationMode && testTo ? [testTo] : intendedTo
          const effectiveCc = isSimulationMode ? undefined : intendedCc.length > 0 ? intendedCc : undefined
          const effectiveBcc = isSimulationMode ? undefined : 'carlos@tacosgavilan.com'

          const genRes = await sendSystemEmail({
            fromName: 'Sistema de Monitoreo',
            to: effectiveTo,
            cc: effectiveCc,
            bcc: effectiveBcc,
            subject: genSubject,
            html: genHtml,
          })

          totalEmailsSent++
          generalReportMeta = {
            sent: true,
            isSimulation: isSimulationMode,
            fromEmail: genRes.fromEmail,
            messageId: genRes.messageId,
            to: effectiveTo,
            cc: effectiveCc || [],
            intendedTo,
            intendedCc,
            subject: genSubject,
            htmlBytes: genHtmlBytes,
            htmlKb: genHtmlKb,
            storesCount: generalStoreInputs.length,
            totalEvaluatedHourly,
            totalAlertEmployees,
          }
        } catch (genErr: any) {
          console.error('[sync-ronos-violations] Error enviando Reporte General Diario:', genErr?.message || genErr)
          generalReportMeta = {
            sent: false,
            isSimulation: isSimulationMode,
            fromEmail: null,
            messageId: null,
            to: isSimulationMode && testTo ? [testTo] : intendedTo,
            cc: isSimulationMode ? [] : intendedCc,
            intendedTo,
            intendedCc,
            subject: genSubject,
            htmlBytes: genHtmlBytes,
            htmlKb: genHtmlKb,
            storesCount: generalStoreInputs.length,
            totalEvaluatedHourly,
            totalAlertEmployees,
            error: genErr?.message || 'Error despachando Reporte General Diario',
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: isDryRun,
      general_only: generalOnly,
      is_test: Boolean(testTo),
      business_date: targetDate,
      total_violations: isDryRun || generalOnly ? totalViolations : totalRecordsInserted || totalViolations,
      total_authorized_early_call_ins: totalAuthorizedCallIns,
      total_authorized_early_outs: totalAuthorizedEarlyOuts,
      total_voluntary_extended_stays: totalVoluntaryExtendedStays,
      emails_sent: totalEmailsSent,
      records_inserted: totalRecordsInserted,
      general_report: generalReportMeta,
      stores_processed: storeSummaries,
      duration_ms: Date.now() - startTime,
    })
  } catch (error: any) {
    console.error('Fatal error in daily RONOS NHP violations cron:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal error' },
      { status: 500 }
    )
  }
}

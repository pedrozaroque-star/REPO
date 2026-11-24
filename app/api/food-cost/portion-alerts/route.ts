/**
 * @module app/api/food-cost/portion-alerts/route
 * @description Endpoint protegido de Control de Porciones y Escalera de Mando:
 *   - `GET`: Consulta alertas (`portion_control_alerts`), conteos recientes de cambio de turno 5:00 PM
 *     (`meat_shift_handover_counts`), acciones disciplinarias inmutables (`portion_disciplinary_actions`),
 *     mapa de reincidencias (`employeeStrikeCounts`), alertas vencidas >24h (`overdueCount`) y KPIs ejecutivos.
 *   - `POST`: Ejecuta escaneo bajo demanda (`action: 'scan'`), envío manual/reenvío de alerta a Escalera de Mando
 *     (`action: 'send_alert'`), registro del Conteo Físico Cambio de Turno 5:00 PM (`action: 'save_handover'`),
 *     o ejecución del SLA 24h (`action: 'enforce_overdue'`), soportando `dryRun` y `testTo` (`@tacosgavilan.com`).
 *   - `PATCH`: Avanza el protocolo obligatorio no negociable (`acknowledge`, `log_coaching` con Strike progresivo 1-2-3
 *     y pesaje obligatorio en báscula, `supervisor_verify`, `resolve`, y `confirm_expulsion`).
 *
 * @businessRules
 *   - **Alcance por Rol (`RBAC`)**:
 *     * `admin` / `accounting` / `cron`: Alcance global en las 15 sucursales.
 *     * `supervisor`: Alcance restringido a sus sucursales asignadas (`stores.supervisor_id = user.id`).
 *     * `manager` / `asistente` / `shift_leader`: Alcance restringido estrictamente a su sucursal asignada (`user.store_id`).
 *   - **Bloqueos Disciplinarios No Negociables ("Sí o Sí")**:
 *     * `log_coaching` exige (`HTTP 400`) responsable (`employeeName`, `employeeRole`, `shift`), calibración en báscula
 *       (`scaleAuditCompleted === true`), promedios reales > 0 oz en 5 tacos y 3 burritos, y compromiso >= 10 caracteres,
 *       insertando automáticamente el Strike inmutable en `portion_disciplinary_actions` (Strike 1 -> Strike 2 -> Strike 3 Expulsión).
 *     * `supervisor_verify` y `resolve` rechazan (`HTTP 400`) si `disciplinary_action_id IS NULL`.
 *     * `confirm_expulsion` está restringido estrictamente a `supervisor` y `admin`.
 *
 * @dataFlow
 *   UI (`PortionControlAlertsPanel` / `/admin/food-cost/meats` / `/admin/food-cost`)
 *   → `/api/food-cost/portion-alerts` → `lib/inventory/portion-control-alerts.ts` → Supabase (`ywwwdcvgfculqmcfkihq`).
 *
 * @notes
 *   - Respuestas con `Cache-Control: no-store, no-cache, must-revalidate` para reflejar cambios de estatus inmediatamente.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth, type DecodedToken } from '@/lib/auth-server'
import {
  MEAT_BENCHMARKS,
  scanPortionControlAlerts,
  sendExistingPortionAlertById,
  validateTestToEmail,
} from '@/lib/inventory/portion-control-alerts'
import {
  ALLOWED_DISCIPLINARY_ROLES,
  confirmMandatoryPortionExpulsion,
  enforceOverduePortionAlerts,
  fetchDisciplinaryContextForStores,
  normalizeDisciplinaryRole,
  recordMandatoryPortionCorrectionAndStrike,
} from '@/lib/inventory/portion-discipline-policy'
import { getBusinessDateLA, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

const ALLOWED_STAFF_ROLES = [
  'admin',
  'administrador',
  'accounting',
  'contador',
  'supervisor',
  'manager',
  'gerente',
  'general_manager',
  'asistente',
  'assistant',
  'shift_leader',
  'shift leader',
  'shiftleader',
]

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
}

interface StoreAccessContext {
  isGlobal: boolean
  isSupervisorOrAdmin: boolean
  isStrictSupervisorOrAdmin: boolean
  userRole: string
  userIdNumeric: number | null
  userDisplayName: string
  userEmail: string | null
  allowedStoreIds: number[]
  storeByAnyKey: Map<string, number>
}

async function resolveCallerStoreAccess(user?: DecodedToken): Promise<StoreAccessContext> {
  const supabase = await getSupabaseAdminClient()
  const { data: storesData, error } = await supabase
    .from('stores')
    .select('id, name, code, external_id, supervisor_id, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })

  if (error) {
    throw new Error(`Error consultando catálogo de sucursales: ${error.message}`)
  }

  const stores = storesData || []
  const storeByAnyKey = new Map<string, number>()
  for (const s of stores) {
    const numId = Number(s.id)
    storeByAnyKey.set(String(numId), numId)
    if (s.external_id) storeByAnyKey.set(String(s.external_id).trim().toLowerCase(), numId)
    if (s.code) storeByAnyKey.set(String(s.code).trim().toLowerCase(), numId)
    if (s.name) storeByAnyKey.set(String(s.name).trim().toLowerCase(), numId)
  }

  // Invocación autorizada de Cron (sin user JWT)
  if (!user) {
    return {
      isGlobal: true,
      isSupervisorOrAdmin: true,
      isStrictSupervisorOrAdmin: true,
      userRole: 'cron',
      userIdNumeric: null,
      userDisplayName: 'Sistema Automático',
      userEmail: null,
      allowedStoreIds: stores.map((s) => Number(s.id)),
      storeByAnyKey,
    }
  }

  const role = String(user.role || user.user_role || '').trim().toLowerCase()
  const parsedUid = Number(user.id || user.sub)
  const userIdNumeric = Number.isFinite(parsedUid) && parsedUid > 0 ? parsedUid : null
  const userDisplayName = String(user.user_metadata?.full_name || user.email || `Staff #${user.id}`).trim()
  const userEmail = user.email ? String(user.email).trim().toLowerCase() : null

  const isGlobal =
    role === 'admin' ||
    role === 'administrador' ||
    role === 'accounting' ||
    role === 'contador'

  const isStrictSupervisorOrAdmin =
    role === 'admin' ||
    role === 'administrador' ||
    role === 'supervisor'

  if (isGlobal) {
    return {
      isGlobal: true,
      isSupervisorOrAdmin: isStrictSupervisorOrAdmin,
      isStrictSupervisorOrAdmin,
      userRole: role,
      userIdNumeric,
      userDisplayName,
      userEmail,
      allowedStoreIds: stores.map((s) => Number(s.id)),
      storeByAnyKey,
    }
  }

  // Consultar fila fresca de `users` para resolver store_id / store_scope / supervisor_id con exactitud
  let dbStoreId: number | null = null
  let dbStoreScope: unknown = user.user_metadata?.store_scope
  if (userIdNumeric !== null) {
    const { data: uRow } = await supabase
      .from('users')
      .select('id, full_name, store_id, store_scope')
      .eq('id', userIdNumeric)
      .maybeSingle()
    if (uRow) {
      if (uRow.store_id !== null && uRow.store_id !== undefined) {
        dbStoreId = Number(uRow.store_id)
      }
      if (uRow.store_scope !== undefined && uRow.store_scope !== null) {
        dbStoreScope = uRow.store_scope
      }
    }
  }

  if (dbStoreId === null && user.user_metadata?.store_id !== undefined && user.user_metadata?.store_id !== null) {
    const resolved = storeByAnyKey.get(String(user.user_metadata.store_id).trim().toLowerCase())
    if (resolved) dbStoreId = resolved
  }

  const allowedSet = new Set<number>()
  if (role === 'supervisor') {
    for (const s of stores) {
      if (userIdNumeric !== null && Number(s.supervisor_id) === userIdNumeric) {
        allowedSet.add(Number(s.id))
      }
    }
  }

  if (dbStoreId !== null && Number.isFinite(dbStoreId)) {
    allowedSet.add(dbStoreId)
  }

  if (Array.isArray(dbStoreScope)) {
    for (const rawEntry of dbStoreScope) {
      const mapped = storeByAnyKey.get(String(rawEntry ?? '').trim().toLowerCase())
      if (mapped) allowedSet.add(mapped)
    }
  }

  return {
    isGlobal: false,
    isSupervisorOrAdmin: role === 'supervisor',
    isStrictSupervisorOrAdmin: role === 'supervisor',
    userRole: role,
    userIdNumeric,
    userDisplayName,
    userEmail,
    allowedStoreIds: Array.from(allowedSet),
    storeByAnyKey,
  }
}

function resolveRequestedStoreIds(
  rawStoreParam: unknown,
  ctx: StoreAccessContext
): { ok: boolean; storeIds: number[]; singleStoreId: number | null; error?: string; status?: number } {
  const clean = rawStoreParam !== undefined && rawStoreParam !== null ? String(rawStoreParam).trim() : ''
  if (!clean || clean.toLowerCase() === 'all') {
    return {
      ok: true,
      storeIds: ctx.allowedStoreIds,
      singleStoreId: ctx.allowedStoreIds.length === 1 ? ctx.allowedStoreIds[0] : null,
    }
  }

  const mapped = ctx.storeByAnyKey.get(clean.toLowerCase())
  if (!mapped) {
    return { ok: false, storeIds: [], singleStoreId: null, error: `Sucursal inválida: ${clean}`, status: 400 }
  }

  if (!ctx.isGlobal && !ctx.allowedStoreIds.includes(mapped)) {
    return {
      ok: false,
      storeIds: [],
      singleStoreId: null,
      error: 'Acceso denegado: No tienes permisos sobre la sucursal solicitada',
      status: 403,
    }
  }

  return { ok: true, storeIds: [mapped], singleStoreId: mapped }
}

export async function GET(req: Request) {
  const auth = verifyStaffAuth(req, { allowedRoles: ALLOWED_STAFF_ROLES, allowCron: true })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  try {
    const ctx = await resolveCallerStoreAccess(auth.user)
    const url = new URL(req.url)
    const storeParam = url.searchParams.get('store_id') || url.searchParams.get('storeId')
    const statusParam = url.searchParams.get('status')?.trim().toLowerCase() || ''
    const severityParam = url.searchParams.get('severity')?.trim().toLowerCase() || ''
    const meatKeyParam = url.searchParams.get('meat_key')?.trim().toLowerCase() || url.searchParams.get('meatKey')?.trim().toLowerCase() || ''
    const startDate = url.searchParams.get('start_date') || url.searchParams.get('startDate') || ''
    const endDate = url.searchParams.get('end_date') || url.searchParams.get('endDate') || ''
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit')) || 100))

    const scope = resolveRequestedStoreIds(storeParam, ctx)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status || 403, headers: NO_STORE_HEADERS })
    }

    if (scope.storeIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          alerts: [],
          handovers: [],
          disciplinaryActions: [],
          employeeStrikeCounts: {},
          overdueCount: 0,
          summary: {
            totalOpenAlerts: 0,
            criticalOpenAlerts: 0,
            escalatedExecAlerts: 0,
            overdueAlerts: 0,
            pendingExpulsions: 0,
            asadaExcessLbs: 0,
            asadaExcessBags: 0,
            asadaStoreLossUsd: 0,
            totalExcessLbs: 0,
            totalExcessBags: 0,
            totalStoreLossUsd: 0,
            totalBodegaLossUsd: 0,
          },
          userRole: ctx.userRole,
          isSupervisorOrAdmin: ctx.isStrictSupervisorOrAdmin,
          allowedStoreIds: [],
        },
        { headers: NO_STORE_HEADERS }
      )
    }

    const supabase = await getSupabaseAdminClient()

    let alertsQuery = supabase
      .from('portion_control_alerts')
      .select('*')
      .in('store_id', scope.storeIds)
      .order('period_end', { ascending: false })
      .order('dollar_loss_store', { ascending: false })
      .limit(limit)

    if (statusParam && statusParam !== 'all') {
      if (statusParam === 'active') {
        alertsQuery = alertsQuery.neq('status', 'resolved')
      } else {
        alertsQuery = alertsQuery.eq('status', statusParam)
      }
    }
    if (severityParam && severityParam !== 'all') {
      alertsQuery = alertsQuery.eq('severity', severityParam)
    }
    if (meatKeyParam && meatKeyParam !== 'all') {
      alertsQuery = alertsQuery.eq('meat_key', meatKeyParam)
    }
    if (startDate && isValidIsoDate(startDate)) {
      alertsQuery = alertsQuery.gte('period_end', startDate)
    }
    if (endDate && isValidIsoDate(endDate)) {
      alertsQuery = alertsQuery.lte('period_start', endDate)
    }

    let handoversQuery = supabase
      .from('meat_shift_handover_counts')
      .select('*')
      .in('store_id', scope.storeIds)
      .order('business_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(40)

    if (startDate && isValidIsoDate(startDate)) {
      handoversQuery = handoversQuery.gte('business_date', startDate)
    }
    if (endDate && isValidIsoDate(endDate)) {
      handoversQuery = handoversQuery.lte('business_date', endDate)
    }

    const [{ data: alertsData, error: alertsErr }, { data: handoversData, error: handoversErr }, disciplineCtx] =
      await Promise.all([
        alertsQuery,
        handoversQuery,
        fetchDisciplinaryContextForStores(scope.storeIds, 150),
      ])

    if (alertsErr) throw new Error(`Error consultando alertas: ${alertsErr.message}`)
    if (handoversErr) throw new Error(`Error consultando cortes 5:00 PM: ${handoversErr.message}`)

    const alerts = alertsData || []
    const handovers = handoversData || []
    const nowMs = Date.now()

    let overdueCount = 0
    for (const a of alerts) {
      const uncoached =
        a.status !== 'coached' && a.status !== 'verified' && a.status !== 'resolved' && !a.disciplinary_action_id
      const pastDue = a.due_at ? new Date(a.due_at).getTime() < nowMs : false
      if (Boolean(a.is_overdue) || (uncoached && pastDue)) {
        overdueCount++
      }
    }

    // Calcular KPIs resumen deduplicando al último periodo por `(store_id, meat_key)` para no inflar sumas
    const latestByStoreMeat = new Map<string, any>()
    for (const a of alerts) {
      const k = `${a.store_id}|${a.meat_key}`
      if (!latestByStoreMeat.has(k)) {
        latestByStoreMeat.set(k, a)
      }
    }

    let totalOpenAlerts = 0
    let criticalOpenAlerts = 0
    let escalatedExecAlerts = 0
    let asadaExcessLbs = 0
    let asadaExcessBags = 0
    let asadaStoreLossUsd = 0
    let totalExcessLbs = 0
    let totalExcessBags = 0
    let totalStoreLossUsd = 0
    let totalBodegaLossUsd = 0

    for (const a of latestByStoreMeat.values()) {
      const isOpen = a.status !== 'resolved' && a.status !== 'verified'
      if (isOpen) {
        totalOpenAlerts++
        if (a.severity === 'critical') criticalOpenAlerts++
        if (a.escalated_to_execs) escalatedExecAlerts++
      }
      const varLbs = Math.max(0, Number(a.variance_lbs) || 0)
      const varBags = Math.max(0, Number(a.variance_bags) || 0)
      const lossStore = Math.max(0, Number(a.dollar_loss_store) || 0)
      const lossBodega = Math.max(0, Number(a.dollar_loss_bodega) || 0)

      totalExcessLbs += varLbs
      totalExcessBags += varBags
      totalStoreLossUsd += lossStore
      totalBodegaLossUsd += lossBodega

      if (a.meat_key === 'asada') {
        asadaExcessLbs += varLbs
        asadaExcessBags += varBags
        asadaStoreLossUsd += lossStore
      }
    }

    return NextResponse.json(
      {
        success: true,
        alerts,
        handovers,
        disciplinaryActions: disciplineCtx.disciplinaryActions,
        employeeStrikeCounts: disciplineCtx.employeeStrikeCounts,
        overdueCount,
        summary: {
          totalOpenAlerts,
          criticalOpenAlerts,
          escalatedExecAlerts,
          overdueAlerts: overdueCount,
          pendingExpulsions: disciplineCtx.pendingExpulsionsCount,
          asadaExcessLbs: Math.round(asadaExcessLbs * 100) / 100,
          asadaExcessBags: Math.round(asadaExcessBags * 100) / 100,
          asadaStoreLossUsd: Math.round(asadaStoreLossUsd * 100) / 100,
          totalExcessLbs: Math.round(totalExcessLbs * 100) / 100,
          totalExcessBags: Math.round(totalExcessBags * 100) / 100,
          totalStoreLossUsd: Math.round(totalStoreLossUsd * 100) / 100,
          totalBodegaLossUsd: Math.round(totalBodegaLossUsd * 100) / 100,
        },
        userRole: ctx.userRole,
        isSupervisorOrAdmin: ctx.isStrictSupervisorOrAdmin,
        allowedStoreIds: ctx.allowedStoreIds,
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err: any) {
    console.error('[GET /api/food-cost/portion-alerts] Error:', err)
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function POST(req: Request) {
  const auth = verifyStaffAuth(req, { allowedRoles: ALLOWED_STAFF_ROLES, allowCron: true })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  try {
    const ctx = await resolveCallerStoreAccess(auth.user)
    const url = new URL(req.url)
    const body = await req.json().catch(() => ({}))

    const dryRun =
      Boolean(body.dryRun) ||
      Boolean(body.dry_run) ||
      url.searchParams.get('dry_run') === 'true'

    const rawTestTo = body.testTo ?? body.test_to ?? url.searchParams.get('test_to') ?? null
    const testCheck = validateTestToEmail(rawTestTo)
    if (!testCheck.valid) {
      return NextResponse.json({ error: testCheck.error }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const rawAction = String(
      body.action ||
        (body.sealed_bags !== undefined || body.sealedBags !== undefined ? 'save_handover' : 'scan')
    )
      .trim()
      .toLowerCase()

    const supabase = await getSupabaseAdminClient()

    // ACCIÓN A: Guardar Conteo Físico Cambio de Turno 5:00 PM (`meat_shift_handover_counts`)
    if (rawAction === 'save_handover') {
      const rawStore = body.store_id ?? body.storeId ?? (ctx.allowedStoreIds.length === 1 ? ctx.allowedStoreIds[0] : null)
      const scope = resolveRequestedStoreIds(rawStore, ctx)
      if (!scope.ok || !scope.singleStoreId) {
        return NextResponse.json(
          { error: scope.error || 'Debes seleccionar una sucursal específica para registrar el conteo 5:00 PM' },
          { status: scope.status || 400, headers: NO_STORE_HEADERS }
        )
      }

      const businessDateRaw = String(body.business_date ?? body.businessDate ?? getBusinessDateLA()).trim()
      if (!isValidIsoDate(businessDateRaw)) {
        return NextResponse.json({ error: 'Fecha laboral inválida (formato requerido YYYY-MM-DD)' }, { status: 400, headers: NO_STORE_HEADERS })
      }

      const rawMeatKey = String(body.meat_key ?? body.meatKey ?? 'asada').trim().toLowerCase()
      const validMeat = MEAT_BENCHMARKS.find((b) => b.key === rawMeatKey || b.inventoryItemId === rawMeatKey)
      if (!validMeat) {
        return NextResponse.json({ error: `Proteína inválida: ${rawMeatKey}` }, { status: 400, headers: NO_STORE_HEADERS })
      }

      const sealedBags = Number(body.sealed_bags ?? body.sealedBags ?? 0)
      const openCookedLbs = Number(body.open_cooked_lbs ?? body.openCookedLbs ?? 0)
      if (!Number.isFinite(sealedBags) || sealedBags < 0 || sealedBags > 2000) {
        return NextResponse.json({ error: 'Bolsas selladas debe ser un número válido entre 0 y 2,000' }, { status: 400, headers: NO_STORE_HEADERS })
      }
      if (!Number.isFinite(openCookedLbs) || openCookedLbs < 0 || openCookedLbs > 5000) {
        return NextResponse.json({ error: 'Libras abiertas debe ser un número válido entre 0 y 5,000' }, { status: 400, headers: NO_STORE_HEADERS })
      }

      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null
      const handoverPayload = {
        store_id: scope.singleStoreId,
        business_date: businessDateRaw,
        meat_key: validMeat.key,
        sealed_bags: Math.round(sealedBags * 100) / 100,
        open_cooked_lbs: Math.round(openCookedLbs * 100) / 100,
        counted_by_name: ctx.userDisplayName,
        counted_by_user_id: ctx.userIdNumeric,
        notes,
      }

      if (dryRun) {
        return NextResponse.json(
          { success: true, dryRun: true, handover: handoverPayload },
          { headers: NO_STORE_HEADERS }
        )
      }

      const { data: savedHandover, error: saveErr } = await supabase
        .from('meat_shift_handover_counts')
        .upsert(handoverPayload, { onConflict: 'store_id,business_date,meat_key' })
        .select('*')
        .single()

      if (saveErr) {
        throw new Error(`Error guardando conteo 5:00 PM: ${saveErr.message}`)
      }

      return NextResponse.json(
        { success: true, handover: savedHandover },
        { headers: NO_STORE_HEADERS }
      )
    }

    // ACCIÓN B: Enviar / Reenviar correo de una alerta existente o de sucursal/carne a Escalera de Mando
    if (rawAction === 'send_alert') {
      if (!ctx.isSupervisorOrAdmin && ctx.userRole !== 'manager' && ctx.userRole !== 'gerente' && ctx.userRole !== 'general_manager') {
        return NextResponse.json(
          { error: 'Solo Gerentes, Supervisores o Administradores pueden despachar alertas por correo' },
          { status: 403, headers: NO_STORE_HEADERS }
        )
      }

      const alertId = String(body.alert_id ?? body.alertId ?? '').trim()
      if (alertId) {
        const { data: targetRow } = await supabase
          .from('portion_control_alerts')
          .select('id, store_id')
          .eq('id', alertId)
          .maybeSingle()

        if (!targetRow) {
          return NextResponse.json({ error: 'Alerta no encontrada' }, { status: 404, headers: NO_STORE_HEADERS })
        }

        if (!ctx.isGlobal && !ctx.allowedStoreIds.includes(Number(targetRow.store_id))) {
          return NextResponse.json({ error: 'No tienes permiso sobre la sucursal de esta alerta' }, { status: 403, headers: NO_STORE_HEADERS })
        }

        const dispatched = await sendExistingPortionAlertById({
          alertId,
          dryRun,
          testTo: testCheck.email,
        })

        return NextResponse.json({ success: true, dispatched }, { headers: NO_STORE_HEADERS })
      }

      // Envío directo desde una vista de tienda/carne sin `alertId` previo: escanear y despachar
      const rawStore = body.store_id ?? body.storeId
      const scope = resolveRequestedStoreIds(rawStore, ctx)
      if (!scope.ok || !scope.singleStoreId) {
        return NextResponse.json(
          { error: scope.error || 'Especifica alertId o store_id para enviar la alerta' },
          { status: scope.status || 400, headers: NO_STORE_HEADERS }
        )
      }

      const scanRes = await scanPortionControlAlerts({
        storeId: scope.singleStoreId,
        startDate: body.start_date ?? body.startDate ?? null,
        endDate: body.end_date ?? body.endDate ?? null,
        spanDays: Number(body.span_days ?? body.spanDays) || 7,
        meatKey: body.meat_key ?? body.meatKey ?? null,
        dryRun,
        sendEmails: true,
        forceResend: true,
        testTo: testCheck.email,
      })

      return NextResponse.json({ success: true, ...scanRes }, { headers: NO_STORE_HEADERS })
    }

    // ACCIÓN C: Escaneo de Balance de Masas (`action === 'scan'`)
    if (rawAction === 'scan') {
      const rawStore = body.store_id ?? body.storeId
      const scope = resolveRequestedStoreIds(rawStore, ctx)
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: scope.status || 403, headers: NO_STORE_HEADERS })
      }

      const sendEmails = body.sendEmails !== undefined ? Boolean(body.sendEmails) : Boolean(body.send_emails)

      if (ctx.isGlobal && !scope.singleStoreId) {
        const result = await scanPortionControlAlerts({
          storeId: null,
          startDate: body.start_date ?? body.startDate ?? null,
          endDate: body.end_date ?? body.endDate ?? null,
          spanDays: Number(body.span_days ?? body.spanDays) || 7,
          meatKey: body.meat_key ?? body.meatKey ?? null,
          dryRun,
          sendEmails,
          forceResend: Boolean(body.forceResend ?? body.force_resend),
          testTo: testCheck.email,
        })
        return NextResponse.json({ success: true, ...result }, { headers: NO_STORE_HEADERS })
      }

      // Usuario acotado a 1 o varias tiendas (manager / asistente / supervisor)
      const combinedAlerts = []
      const combinedEmails = []
      let evaluatedSpans = 0
      let persistedCount = 0
      let periodStart = ''
      let periodEnd = ''

      for (const sid of scope.storeIds) {
        const r = await scanPortionControlAlerts({
          storeId: sid,
          startDate: body.start_date ?? body.startDate ?? null,
          endDate: body.end_date ?? body.endDate ?? null,
          spanDays: Number(body.span_days ?? body.spanDays) || 7,
          meatKey: body.meat_key ?? body.meatKey ?? null,
          dryRun,
          sendEmails,
          forceResend: Boolean(body.forceResend ?? body.force_resend),
          testTo: testCheck.email,
        })
        periodStart = r.periodStart
        periodEnd = r.periodEnd
        evaluatedSpans += r.evaluatedSpans
        persistedCount += r.persistedCount
        combinedAlerts.push(...r.triggeredAlerts)
        combinedEmails.push(...r.emailsDispatched)
      }

      return NextResponse.json(
        {
          success: true,
          periodStart,
          periodEnd,
          dryRun,
          evaluatedSpans,
          triggeredAlerts: combinedAlerts,
          persistedCount,
          emailsDispatched: combinedEmails,
        },
        { headers: NO_STORE_HEADERS }
      )
    }

    if (rawAction === 'enforce_overdue') {
      if (!ctx.isStrictSupervisorOrAdmin) {
        return NextResponse.json(
          { error: 'Solo Supervisores o Administradores pueden ejecutar el enforcer de SLA 24h' },
          { status: 403, headers: NO_STORE_HEADERS }
        )
      }
      const rawStore = body.store_id ?? body.storeId ?? null
      const scope = resolveRequestedStoreIds(rawStore, ctx)
      if (!scope.ok) {
        return NextResponse.json({ error: scope.error }, { status: scope.status || 403, headers: NO_STORE_HEADERS })
      }
      const sendEmails = body.sendEmails !== undefined ? Boolean(body.sendEmails) : Boolean(body.send_emails ?? !dryRun)
      const overdueRes = await enforceOverduePortionAlerts({
        dryRun,
        sendEmails,
        persistInDbWhenDryRun: Boolean(body.persistInDbWhenDryRun),
        storeId: scope.singleStoreId,
        testTo: testCheck.email,
      })
      return NextResponse.json({ success: true, overdueEnforcement: overdueRes }, { headers: NO_STORE_HEADERS })
    }

    return NextResponse.json({ error: `Acción POST desconocida: ${rawAction}` }, { status: 400, headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[POST /api/food-cost/portion-alerts] Error:', err)
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function PATCH(req: Request) {
  const auth = verifyStaffAuth(req, { allowedRoles: ALLOWED_STAFF_ROLES, allowCron: false })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  try {
    const ctx = await resolveCallerStoreAccess(auth.user)
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').trim().toLowerCase()
    const dryRun = Boolean(body.dryRun ?? body.dry_run)
    const skipDbPersist = Boolean(body.previewOnly ?? body.preview_only ?? body.skipDbPersist)
    const rawTestTo = body.testTo ?? body.test_to ?? null
    const testCheck = validateTestToEmail(rawTestTo)
    if (!testCheck.valid) {
      return NextResponse.json({ error: testCheck.error }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (!action) {
      return NextResponse.json({ error: 'Se requiere el campo action' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const supabase = await getSupabaseAdminClient()

    // ACCIÓN ESPECIAL: Confirmación Ejecutiva/Supervisión de Baja Obligatoria (`confirm_expulsion`)
    if (action === 'confirm_expulsion') {
      if (!ctx.isStrictSupervisorOrAdmin) {
        return NextResponse.json(
          { error: 'Solo el Supervisor Regional o un Administrador pueden confirmar la ejecución de una baja obligatoria' },
          { status: 403, headers: NO_STORE_HEADERS }
        )
      }

      const rawStrikeId = String(
        body.disciplinary_action_id ?? body.disciplinaryActionId ?? body.id ?? ''
      ).trim()
      if (!rawStrikeId) {
        return NextResponse.json(
          { error: 'Se requiere disciplinary_action_id (o id) para confirmar la expulsión obligatoria' },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }

      // Permitir pasar el ID directo de `portion_disciplinary_actions` o el ID de una alerta vinculada
      let targetStrikeRow: Record<string, any> | null = null
      const { data: directStrike } = await supabase
        .from('portion_disciplinary_actions')
        .select('*')
        .eq('id', rawStrikeId)
        .maybeSingle()

      if (directStrike) {
        targetStrikeRow = directStrike
      } else {
        const { data: linkedAlert } = await supabase
          .from('portion_control_alerts')
          .select('id, store_id, disciplinary_action_id')
          .eq('id', rawStrikeId)
          .maybeSingle()
        if (linkedAlert?.disciplinary_action_id) {
          const { data: resolvedStrike } = await supabase
            .from('portion_disciplinary_actions')
            .select('*')
            .eq('id', linkedAlert.disciplinary_action_id)
            .maybeSingle()
          targetStrikeRow = resolvedStrike || null
        }
      }

      if (!targetStrikeRow) {
        return NextResponse.json(
          { error: 'Registro disciplinario de expulsión no encontrado' },
          { status: 404, headers: NO_STORE_HEADERS }
        )
      }

      if (!ctx.isGlobal && !ctx.allowedStoreIds.includes(Number(targetStrikeRow.store_id))) {
        return NextResponse.json(
          { error: 'Acceso denegado: No tienes permisos sobre la sucursal de este registro disciplinario' },
          { status: 403, headers: NO_STORE_HEADERS }
        )
      }

      if (targetStrikeRow.disciplinary_stage !== 'strike_3_expulsion') {
        return NextResponse.json(
          { error: 'Solo un registro en etapa strike_3_expulsion puede confirmarse como expulsión ejecutada' },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }

      const confirmedAction = await confirmMandatoryPortionExpulsion({
        disciplinaryActionId: String(targetStrikeRow.id),
        confirmedByName: ctx.userDisplayName,
        notes: typeof body.notes === 'string' ? body.notes : null,
        dryRun,
        skipDbPersist,
      })

      return NextResponse.json(
        { success: true, dryRun, disciplinaryAction: confirmedAction },
        { headers: NO_STORE_HEADERS }
      )
    }

    const alertId = String(body.id ?? body.alert_id ?? body.alertId ?? '').trim()
    if (!alertId) {
      return NextResponse.json({ error: 'Se requieren los campos id y action' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('portion_control_alerts')
      .select('*')
      .eq('id', alertId)
      .maybeSingle()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Alerta no encontrada' }, { status: 404, headers: NO_STORE_HEADERS })
    }

    if (!ctx.isGlobal && !ctx.allowedStoreIds.includes(Number(existing.store_id))) {
      return NextResponse.json(
        { error: 'Acceso denegado: No tienes permisos sobre esta sucursal' },
        { status: 403, headers: NO_STORE_HEADERS }
      )
    }

    const nowIso = new Date().toISOString()
    const updates: Record<string, any> = {}

    if (action === 'acknowledge') {
      updates.acknowledged_by = ctx.userDisplayName
      updates.acknowledged_at = nowIso
      if (existing.status === 'open') {
        updates.status = 'acknowledged'
      }
      if (typeof body.notes === 'string' && body.notes.trim()) {
        updates.corrective_action_notes = body.notes.trim().slice(0, 1000)
      }
    } else if (action === 'log_coaching') {
      const rawEmployeeName = String(
        body.employeeName ??
          body.employee_name ??
          body.coaching_staff_names ??
          body.coachingStaffNames ??
          ''
      ).trim()
      const rawEmployeeRole = body.employeeRole ?? body.employee_role ?? ''
      const normalizedRole = normalizeDisciplinaryRole(rawEmployeeRole)
      const rawShift = String(body.shift ?? body.coaching_shift ?? body.coachingShift ?? '').trim().toUpperCase()
      const rawScaleAudit = body.scaleAuditCompleted ?? body.scale_audit_completed
      const rawTacosOz = Number(body.sampledTacosAvgOz ?? body.sampled_tacos_avg_oz)
      const rawBurritosOz = Number(body.sampledBurritosAvgOz ?? body.sampled_burritos_avg_oz)
      const rawCommitment = String(
        body.correctiveActionNotes ??
          body.corrective_action_notes ??
          body.mandatoryCommitment ??
          body.mandatory_commitment ??
          body.notes ??
          ''
      ).trim()

      // REGLA DE BLOQUEO NO NEGOCIABLE ("Sí o Sí"): HTTP 400 si falta cualquier requisito obligatorio
      if (rawEmployeeName.length < 2) {
        return NextResponse.json(
          { error: 'BLOQUEO DISCIPLINARIO: Debes seleccionar al empleado responsable en turno (employeeName requerido).' },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (!normalizedRole) {
        return NextResponse.json(
          {
            error: `BLOQUEO DISCIPLINARIO: Debes indicar un puesto válido (${ALLOWED_DISCIPLINARY_ROLES.join(', ')}).`,
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (rawShift !== 'AM' && rawShift !== 'PM' && rawShift !== 'BOTH') {
        return NextResponse.json(
          { error: 'BLOQUEO DISCIPLINARIO: Debes indicar el turno auditado exacto (AM, PM o BOTH).' },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (rawScaleAudit !== true) {
        return NextResponse.json(
          {
            error:
              'BLOQUEO DISCIPLINARIO: Es obligatorio confirmar la calibración presencial en báscula (scaleAuditCompleted = true).',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (!Number.isFinite(rawTacosOz) || rawTacosOz <= 0 || rawTacosOz > 24) {
        return NextResponse.json(
          {
            error:
              'BLOQUEO DISCIPLINARIO: Ingresa el promedio real pesado en báscula de 5 Tacos (> 0 oz; estándar 1.5 oz).',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (!Number.isFinite(rawBurritosOz) || rawBurritosOz <= 0 || rawBurritosOz > 48) {
        return NextResponse.json(
          {
            error:
              'BLOQUEO DISCIPLINARIO: Ingresa el promedio real pesado en báscula de 3 Burritos (> 0 oz; estándar 6.0 oz).',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (rawCommitment.length < 10) {
        return NextResponse.json(
          {
            error:
              'BLOQUEO DISCIPLINARIO: Describe el compromiso obligatorio y acción correctiva en al menos 10 caracteres.',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }

      const strikeResult = await recordMandatoryPortionCorrectionAndStrike({
        alertId,
        employeeName: rawEmployeeName,
        employeeRole: normalizedRole,
        employeeToastGuid: body.employeeToastGuid ?? body.employee_toast_guid ?? null,
        employeeUserId: body.employeeUserId ?? body.employee_user_id ?? null,
        employeeEmail: body.employeeEmail ?? body.employee_email ?? null,
        shift: rawShift,
        scaleAuditCompleted: true,
        sampledTacosAvgOz: rawTacosOz,
        sampledBurritosAvgOz: rawBurritosOz,
        mandatoryCommitment: rawCommitment,
        issuedByName: ctx.userDisplayName,
        issuedByEmail: ctx.userEmail,
        dryRun,
        skipDbPersist,
        testTo: testCheck.email,
      })

      return NextResponse.json(
        {
          success: true,
          dryRun: strikeResult.dryRun,
          alert: strikeResult.updatedAlert,
          disciplinaryAction: strikeResult.actionRow,
          priorStrikesCount: strikeResult.priorStrikesCount,
          offenseNumber: strikeResult.offenseNumber,
          disciplinaryStage: strikeResult.disciplinaryStage,
          expulsionStatus: strikeResult.expulsionStatus,
          emailsDispatched: strikeResult.emailsDispatched,
        },
        { headers: NO_STORE_HEADERS }
      )
    } else if (action === 'supervisor_verify') {
      if (!ctx.isStrictSupervisorOrAdmin) {
        return NextResponse.json(
          { error: 'Solo el Supervisor Regional o un Administrador pueden validar el cierre en tienda' },
          { status: 403, headers: NO_STORE_HEADERS }
        )
      }
      if (!existing.disciplinary_action_id) {
        return NextResponse.json(
          {
            error:
              'BLOQUEO DISCIPLINARIO: Ninguna alerta puede ser validada sin antes registrar la corrección obligatoria en báscula y el Strike disciplinario del empleado.',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      updates.supervisor_verified_by = ctx.userDisplayName
      updates.supervisor_verified_at = nowIso
      updates.status = 'verified'
      if (typeof body.notes === 'string' && body.notes.trim()) {
        const prev = existing.corrective_action_notes ? `${existing.corrective_action_notes}\n` : ''
        updates.corrective_action_notes = `${prev}[Verificación Supervisor - ${ctx.userDisplayName}]: ${body.notes.trim()}`.slice(0, 1500)
      }
    } else if (action === 'resolve') {
      if (!ctx.isStrictSupervisorOrAdmin) {
        return NextResponse.json(
          { error: 'Solo el Supervisor Regional o un Administrador pueden marcar una alerta como resuelta' },
          { status: 403, headers: NO_STORE_HEADERS }
        )
      }
      if (!existing.disciplinary_action_id) {
        return NextResponse.json(
          {
            error:
              'BLOQUEO DISCIPLINARIO: Ninguna alerta puede cerrarse sin una corrección obligatoria en báscula y un Strike disciplinario registrado.',
          },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      if (!existing.supervisor_verified_at) {
        updates.supervisor_verified_by = ctx.userDisplayName
        updates.supervisor_verified_at = nowIso
      }
      updates.resolved_at = nowIso
      updates.status = 'resolved'
      if (typeof body.notes === 'string' && body.notes.trim()) {
        const prev = existing.corrective_action_notes ? `${existing.corrective_action_notes}\n` : ''
        updates.corrective_action_notes = `${prev}[Resuelta - ${ctx.userDisplayName}]: ${body.notes.trim()}`.slice(0, 1500)
      }
    } else {
      return NextResponse.json({ error: `Acción PATCH inválida: ${action}` }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (skipDbPersist) {
      return NextResponse.json(
        { success: true, dryRun, alert: { ...existing, ...updates } },
        { headers: NO_STORE_HEADERS }
      )
    }

    const { data: updated, error: updateErr } = await supabase
      .from('portion_control_alerts')
      .update(updates)
      .eq('id', alertId)
      .select('*')
      .single()

    if (updateErr) {
      throw new Error(`Error actualizando alerta: ${updateErr.message}`)
    }

    // Sincronizar sello de verificación del Supervisor en el registro de Strike vinculado
    if ((action === 'supervisor_verify' || action === 'resolve') && existing.disciplinary_action_id) {
      await supabase
        .from('portion_disciplinary_actions')
        .update({
          supervisor_verified_by: ctx.userDisplayName,
          supervisor_verified_at: nowIso,
        })
        .eq('id', existing.disciplinary_action_id)
        .is('supervisor_verified_at', null)
    }

    return NextResponse.json({ success: true, dryRun, alert: updated }, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[PATCH /api/food-cost/portion-alerts] Error:', err)
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

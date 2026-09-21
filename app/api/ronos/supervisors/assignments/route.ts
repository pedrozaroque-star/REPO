/**
 * @module app/api/ronos/supervisors/assignments/route
 * @description API de Gestión de Asignaciones de Supervisores y Tiendas Pagadoras.
 *   - Permite consultar el territorio operativo de cada supervisor y su tienda pagadora vigente.
 *   - Proporciona la cola de revisión para relaciones pendientes de evidencia documental.
 *   - Permite confirmar vínculos manuales exigiendo identificador nativo (assignmentId / employeeId)
 *     y registrando auditoría completa (quién confirmó y cuándo).
 *
 * @businessRules
 *   - Exige autenticación de administrador ('admin').
 *   - Prohíbe terminantemente la confirmación o guardado basado únicamente en nombres.
 *   - Un cambio de tienda pagadora requiere el paystub oficial del nuevo período; no admite sustituciones manuales.
 *
 * @dataFlow
 *   Admin autenticado -> validación de IDs nativos y paystub Simplify HR -> tablas relacionales de supervisor -> UI RONOS.
 *
 * @notes
 *   No se crean pagos administrativos desde datos manuales. La tienda pagadora procede siempre del recibo oficial.
 */

import { NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/auth-server'
import {
  getActiveSupervisorProfiles,
  confirmSupervisorRelationship,
  updateSupervisorPayingStore,
  getStoreOperationalSupervisors
} from '@/lib/supervisor-assignments'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const auth = verifyAdminAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const periodStart = searchParams.get('periodStart') || undefined
    const periodEnd = searchParams.get('periodEnd') || undefined

    // 1. Obtener perfiles vigentes
    const profiles = await getActiveSupervisorProfiles(periodStart, periodEnd)

    // 2. Obtener todas las filas históricas de supervisor_payroll_assignments para auditoría
    const { data: history, error: hErr } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .select('*')
      .order('period_start', { ascending: false })

    if (hErr) {
      console.warn('[SupervisorAssignmentsAPI] Error leyendo historial:', hErr.message)
    }

    // 3. Obtener territorios operativos de stores
    const operationalTerritoryMap = await getStoreOperationalSupervisors()
    const operationalTerritories = Array.from(operationalTerritoryMap.values())

    // 4. Cola de revisión: asignaciones en requires_review o sin assignmentId
    // Regla: No certificar el nombre como confirmado y adjuntar diagnóstico administrativo
    const pendingReviewQueue = (history || [])
      .filter(h => h.review_status === 'requires_review' || !h.supervisor_assignment_id)
      .map(h => ({
        ...h,
        supervisor_name_snapshot: h.review_status === 'verified'
          ? (h.supervisor_name_snapshot || 'Supervisor')
          : 'Pago administrativo por verificar',
        diagnostic: 'Se requiere acceso de Simplify HR al EOR para validar este pago'
      }))

    return NextResponse.json({
      success: true,
      data: {
        profiles,
        operationalTerritories,
        pendingReviewQueue,
        history: history || []
      }
    })
  } catch (err: any) {
    console.error('[SupervisorAssignmentsAPI] Error en GET:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const auth = verifyAdminAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const body = await request.json()
    const { action } = body

    const confirmedBy = auth.user?.email || auth.user?.id
    if (!confirmedBy) {
      return NextResponse.json({ success: false, error: 'No fue posible identificar al administrador autenticado.' }, { status: 401 })
    }

    if (action === 'change_paying_store') {
      const { assignmentId, newPayrollStoreId, newSimplifySiteId, effectiveDate } = body
      if (typeof assignmentId !== 'string' || !assignmentId.trim() || !Number.isSafeInteger(Number(newPayrollStoreId)) || Number(newPayrollStoreId) <= 0 || typeof effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        return NextResponse.json(
          { success: false, error: 'Parámetros incompletos: assignmentId, newPayrollStoreId y effectiveDate son obligatorios.' },
          { status: 400 }
        )
      }

      const res = await updateSupervisorPayingStore({
        assignmentId: assignmentId.trim(),
        newPayrollStoreId: Number(newPayrollStoreId),
        newSimplifySiteId,
        effectiveDate,
        confirmedBy
      })

      if (!res.success) {
        return NextResponse.json({ success: false, error: res.error }, { status: 400 })
      }

      return NextResponse.json({ success: true, message: 'Tienda pagadora actualizada exitosamente.' })
    }

    if (action === 'confirm_relationship') {
      const {
        assignmentId,
        employeeId,
        userId,
        supervisorNameSnapshot,
        operationalStoreId,
        payrollStoreId,
        simplifySiteId,
        paystubId,
        periodStart,
        periodEnd
      } = body

      // VALIDACIÓN ESTRICTA: Prohibir vinculación sin evidencia nativa
      if (!assignmentId && !employeeId) {
        return NextResponse.json(
          {
            success: false,
            error: 'Rechazado: Se exige identificador nativo unívoco (assignmentId o employeeId). Está terminantemente prohibido vincular solo por nombre.'
          },
          { status: 400 }
        )
      }

      const operationalStore = operationalStoreId === undefined || operationalStoreId === null || operationalStoreId === '' ? undefined : Number(operationalStoreId)
      const payrollStore = payrollStoreId === undefined || payrollStoreId === null || payrollStoreId === '' ? undefined : Number(payrollStoreId)
      if ((operationalStore !== undefined && (!Number.isSafeInteger(operationalStore) || operationalStore <= 0)) ||
          (payrollStore !== undefined && (!Number.isSafeInteger(payrollStore) || payrollStore <= 0))) {
        return NextResponse.json({ success: false, error: 'Las tiendas deben ser identificadores enteros positivos.' }, { status: 400 })
      }

      const res = await confirmSupervisorRelationship({
        assignmentId,
        employeeId,
        userId: userId ? Number(userId) : undefined,
        supervisorNameSnapshot: typeof supervisorNameSnapshot === 'string' ? supervisorNameSnapshot.trim() : '',
        operationalStoreId: operationalStore,
        payrollStoreId: payrollStore,
        simplifySiteId,
        paystubId,
        periodStart,
        periodEnd,
        confirmedBy
      })

      if (!res.success) {
        return NextResponse.json({ success: false, error: res.error }, { status: 400 })
      }

      return NextResponse.json({
        success: true,
        data: { id: res.id },
        message: 'Relación de supervisor confirmada y registrada en auditoría.'
      })
    }

    return NextResponse.json(
      { success: false, error: 'Acción no reconocida. Acciones válidas: confirm_relationship, change_paying_store' },
      { status: 400 }
    )
  } catch (err: any) {
    console.error('[SupervisorAssignmentsAPI] Error en POST:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

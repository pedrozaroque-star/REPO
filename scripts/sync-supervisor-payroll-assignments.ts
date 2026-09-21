/**
 * @module scripts/sync-supervisor-payroll-assignments
 * @description Certifica relaciones existentes de supervisores contra paystubs reales de Simplify HR.
 *
 * @businessRules
 *   - Un pago se verifica solo si coinciden paystubId, assignmentId/employeeId, siteId y período.
 *   - Importes, horas y nombre se refrescan exclusivamente desde el recibo certificado.
 *   - Una relación que no se pueda demostrar queda `requires_review` y deja de afectar nómina.
 *   - No crea relaciones por nombre ni usa listas fijas de personas, tiendas, salarios u horas.
 *
 * @dataFlow
 *   supervisor_payroll_assignments -> Simplify HR paystubs -> estado/evidencia en Supabase -> relaciones operativas por ID nativo.
 *
 * @notes
 *   Es idempotente. Solo actualiza las dos tablas propias de RONOS y no toca nómina histórica de otros módulos.
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'
import { getPaystubDetail, getSitePaystubs, SimplifyHrPaystub } from '../lib/simplifyhr-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function nativeKey(row: { supervisor_assignment_id?: string | null; supervisor_employee_id?: string | null }) {
  return row.supervisor_assignment_id ? `assignment:${row.supervisor_assignment_id}` : row.supervisor_employee_id ? `employee:${row.supervisor_employee_id}` : null
}

function paystubHours(paystub: SimplifyHrPaystub) {
  return (paystub.earnings || []).reduce((sum, earning) => sum + (Number.isFinite(Number(earning.hours)) ? Number(earning.hours) : 0), 0)
}

function matches(row: any, paystub: SimplifyHrPaystub) {
  const assignmentMatches = !row.supervisor_assignment_id || paystub.assignmentId === row.supervisor_assignment_id
  const employeeMatches = !row.supervisor_employee_id || paystub.employeeNumber === row.supervisor_employee_id
  const siteMatches = !paystub.siteId || paystub.siteId === row.simplify_site_id
  return paystub.id === row.paystub_id && assignmentMatches && employeeMatches && siteMatches
}

async function main() {
  const { data: payments, error } = await supabaseAdmin
    .from('supervisor_payroll_assignments')
    .select('*')
    .order('period_start', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar pagos de supervisor: ${error.message}`)

  const verifiedKeys = new Set<string>()
  let verifiedPayments = 0
  let pendingPayments = 0

  for (const payment of payments || []) {
    try {
      const paystubs = await getSitePaystubs(payment.simplify_site_id)
      // La lista por sitio puede omitir recibos históricos; el detalle por ID es la segunda fuente oficial.
      const candidate = paystubs.find(stub => matches(payment, stub)) || await getPaystubDetail(payment.paystub_id)
      const paystub = candidate && matches(payment, candidate) ? candidate : null
      const key = nativeKey(payment)
      const periodStart = paystub?.periodStart || paystub?.payPeriodStart
      const periodEnd = paystub?.periodEnd || paystub?.payPeriodEnd
      if (!paystub || !key || !periodStart || !periodEnd) {
        await supabaseAdmin.from('supervisor_payroll_assignments')
          .update({ review_status: 'requires_review', confirmed_at: null })
          .eq('id', payment.id)
        pendingPayments++
        continue
      }

      const officialName = paystub.employeeName || [paystub.firstName, paystub.lastName].filter(Boolean).join(' ') || null
      const { error: updateError } = await supabaseAdmin.from('supervisor_payroll_assignments')
        .update({
          gross_wages: Number(paystub.grossWages || 0),
          salary_hours: paystubHours(paystub),
          period_start: periodStart,
          period_end: periodEnd,
          supervisor_name_snapshot: officialName,
          review_status: 'verified',
          source: 'simplify_paystub',
          confirmed_at: new Date().toISOString()
        })
        .eq('id', payment.id)
      if (updateError) throw updateError
      verifiedKeys.add(key)
      verifiedPayments++
    } catch (syncError: any) {
      await supabaseAdmin.from('supervisor_payroll_assignments')
        .update({ review_status: 'requires_review', confirmed_at: null })
        .eq('id', payment.id)
      pendingPayments++
      console.warn(`[supervisor-sync] Pago ${payment.id} pendiente: ${syncError?.message || 'sin evidencia'}`)
    }
  }

  const { data: operations, error: operationsError } = await supabaseAdmin
    .from('supervisor_operational_assignments')
    .select('id, supervisor_assignment_id, supervisor_employee_id')
  if (operationsError) throw new Error(`No se pudieron cargar relaciones operativas: ${operationsError.message}`)

  let verifiedOperations = 0
  let pendingOperations = 0
  for (const operation of operations || []) {
    const status = nativeKey(operation) && verifiedKeys.has(nativeKey(operation)!) ? 'verified' : 'requires_review'
    const { error: updateError } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .update({ review_status: status })
      .eq('id', operation.id)
    if (updateError) throw updateError
    if (status === 'verified') verifiedOperations++
    else pendingOperations++
  }

  console.log(JSON.stringify({
    payments: { verified: verifiedPayments, requiresReview: pendingPayments },
    operationalAssignments: { verified: verifiedOperations, requiresReview: pendingOperations }
  }))
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})

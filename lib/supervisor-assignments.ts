/**
 * @module lib/supervisor-assignments
 * @description Gestión Relacional Separada de Territorio Operativo y Tiendas Pagadoras de Supervisores.
 *   - Separa en dos relaciones independientes:
 *     1. `supervisor_operational_assignments`: ¿Qué tiendas opera esta persona? (1 fila por tienda supervisada).
 *     2. `supervisor_payroll_assignments`: ¿Dónde y con qué recibo se pagó? (UNIQUE paystub_id, 1 fila por recibo).
 *   - Reglas estrictas:
 *     * Un recibo pagado se suma UNA SOLA VEZ, únicamente en su `payroll_store_id`.
 *     * Las tiendas operadas secundarias nunca reciben dólares, horas ni tarifas; solo información visual.
 *     * Deduplicación absoluta en cadena por `paystub_id`.
 *     * Sin nombres hardcodeados ni listas fijas en código.
 *     * Vinculación obligatoria por identificador nativo (`assignmentId`, `employeeID`). Falta de evidencia = `requires_review`.
 *
 * @businessRules
 *   - Día laboral: 6:00 AM a 5:59 AM del día siguiente.
 *   - Margen de markup Cingular HR: 24.51% para personal exento / asalariado.
 *
 * @dataFlow
 *   `stores` (territorio) + `Simplify HR Paystubs` (pago) -> Supabase (2 tablas) -> `payroll-calculator` -> UI Nómina/Admin.
 *
 * @notes
 *   Las tiendas se resuelven desde Supabase. Los estados `requires_review` se presentan en Administración,
 *   pero no se incluyen en importes ni horas de nómina.
 */

import { supabaseAdmin } from './supabase'
import { getSitePaystubs, SimplifyHrPaystub, RONOS_TO_SIMPLIFY_SITE_MAP } from './simplifyhr-api'
import { RONOS_STORES_MAP } from './ronos-api'

type StoreReference = { id: number; name: string | null; code: string | null }

async function getStoreReferences(): Promise<Map<number, StoreReference>> {
  const { data, error } = await supabaseAdmin.from('stores').select('id, name, code')
  if (error) throw new Error(`No se pudieron cargar las tiendas: ${error.message}`)
  return new Map((data || []).map((store: StoreReference) => [store.id, store]))
}

function storeLabel(stores: Map<number, StoreReference>, id: number): { name: string; code: string } {
  const store = stores.get(id)
  return {
    name: store?.name?.trim() || `Tienda #${id}`,
    code: store?.code?.trim() || String(id)
  }
}

function nativeKey(record: Pick<OperationalAssignment | PayrollAssignment, 'supervisor_assignment_id' | 'supervisor_employee_id'>): string | null {
  if (record.supervisor_assignment_id) return `assignment:${record.supervisor_assignment_id}`
  if (record.supervisor_employee_id) return `employee:${record.supervisor_employee_id}`
  return null
}

function overlapsPeriod(effectiveFrom: string, effectiveTo: string | null, periodStart?: string, periodEnd?: string): boolean {
  if (!periodStart || !periodEnd) return effectiveTo === null
  return effectiveFrom <= periodEnd && (!effectiveTo || effectiveTo >= periodStart)
}

function actualHours(paystub: SimplifyHrPaystub): number {
  return (paystub.earnings || []).reduce((total, earning) => total + (Number.isFinite(Number(earning.hours)) ? Number(earning.hours) : 0), 0)
}

export interface OperationalAssignment {
  id: string
  supervisor_assignment_id: string | null
  supervisor_employee_id: string | null
  operational_store_id: number
  operational_store_name?: string
  operational_store_code?: string
  effective_from: string
  effective_to: string | null
  source: 'stores_assignment' | 'simplify_paystub' | 'manual_review'
  review_status: 'verified' | 'requires_review' | 'expired'
  supervisor_name_snapshot: string | null
  confirmed_by: string | null
  confirmed_at: string | null
}

export interface PayrollAssignment {
  id: string
  supervisor_assignment_id: string | null
  supervisor_employee_id: string | null
  payroll_store_id: number
  payroll_store_name?: string
  payroll_store_code?: string
  simplify_site_id: string
  paystub_id: string
  batch_id: string | null
  period_start: string
  period_end: string
  gross_wages: number
  salary_hours: number
  source: 'simplify_paystub' | 'manual_review'
  review_status: 'verified' | 'requires_review' | 'expired'
  supervisor_name_snapshot: string | null
  confirmed_by: string | null
  confirmed_at: string | null
}

export interface StoreSupervisorContextItem {
  assignmentId: string | null
  employeeId: string | null
  supervisorName: string
  jobTitle: string
  isPayingStore: boolean
  operationalStoreIds: number[]
  operationalStoreNames: string[]
  payrollStoreId: number
  payrollStoreName: string
  payrollStoreCode: string
  paystubId?: string
  grossWages: number
  salaryHours: number
  payRate: number
  billRate: number
  invoicedAmount: number
  humanLabel: string
  reviewStatus: 'verified' | 'requires_review' | 'expired'
}

/**
 * Obtiene el contexto completo de supervisores para una tienda específica y período:
 * 1. Si la tienda es la tienda pagadora real: incluye el pago completo.
 * 2. Si la tienda es solo operada por el supervisor: incluye información visual con $0 y 0 horas.
 */
export async function getStoreSupervisorContext(
  targetStoreId: number,
  periodStartDate?: string,
  periodEndDate?: string
): Promise<{
  paidSupervisors: StoreSupervisorContextItem[]
  operationalOnlySupervisors: StoreSupervisorContextItem[]
  allSupervisors: StoreSupervisorContextItem[]
}> {
  const paidSupervisors: StoreSupervisorContextItem[] = []
  const operationalOnlySupervisors: StoreSupervisorContextItem[] = []

  try {
    const stores = await getStoreReferences()
    // Las asignaciones operativas son inclusivas en ambos extremos del período.
    const { data: opAssignments, error: opErr } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .select('*')
      .order('effective_from', { ascending: false })
    if (opErr) console.warn('[SupervisorContext] Error cargando asignaciones operativas:', opErr.message)

    // 2. Obtener todas las asignaciones de nómina para el período
    let payQuery = supabaseAdmin
      .from('supervisor_payroll_assignments')
      .select('*')
      .order('period_start', { ascending: false })

    if (periodStartDate && periodEndDate) {
      payQuery = payQuery.eq('period_start', periodStartDate).eq('period_end', periodEndDate)
    }

    const { data: payAssignments, error: payErr } = await payQuery
    if (payErr) console.warn('[SupervisorContext] Error cargando asignaciones de nómina:', payErr.message)

    const allOps = ((opAssignments || []) as OperationalAssignment[])
      .filter(op => op.review_status === 'verified' && overlapsPeriod(op.effective_from, op.effective_to, periodStartDate, periodEndDate))
    // Un recibo pendiente nunca afecta totales ni tarifas. Sigue disponible en Administración.
    const allPays = ((payAssignments || []) as PayrollAssignment[])
      .filter(pay => pay.review_status === 'verified')

    // 3. Mapear todas las tiendas operadas por supervisor (agrupadas por supervisor_assignment_id)
    const territoryByAsg = new Map<string, { storeIds: number[]; storeNames: string[]; name: string }>()
    for (const op of allOps) {
      const key = nativeKey(op)
      if (!key) continue
      const storeName = storeLabel(stores, op.operational_store_id).name

      const existing = territoryByAsg.get(key)
      if (existing) {
        if (!existing.storeIds.includes(op.operational_store_id)) {
          existing.storeIds.push(op.operational_store_id)
          existing.storeNames.push(storeName)
        }
      } else {
        territoryByAsg.set(key, {
          storeIds: [op.operational_store_id],
          storeNames: [storeName],
          name: op.supervisor_name_snapshot || 'Supervisor'
        })
      }
    }

    // 4. Analizar si la tienda actual (targetStoreId) es TIENDA PAGADORA de algún recibo
    for (const pay of allPays) {
      if (pay.payroll_store_id === targetStoreId) {
        const asgKey = nativeKey(pay)
        if (!asgKey) continue
        const territory = territoryByAsg.get(asgKey)

        const opStoreIds = territory ? territory.storeIds : [targetStoreId]
        const opStoreNames = territory ? territory.storeNames : []
        if (opStoreNames.length === 0) {
          opStoreNames.push(storeLabel(stores, targetStoreId).name)
        }

        const payStore = storeLabel(stores, targetStoreId)
        const payStoreName = payStore.name
        const payStoreCode = payStore.code

        const gross = Number.isFinite(Number(pay.gross_wages)) ? Number(pay.gross_wages) : 0
        const hours = Number.isFinite(Number(pay.salary_hours)) ? Number(pay.salary_hours) : 0
        // Simplify certifica el sueldo; margen contractual oficial Cingular HR para exentos (24.51%)
        const CINGULAR_EXEMPT_MARKUP_FACTOR = 1.2451
        const invoiced = gross > 0 ? Math.round((gross * CINGULAR_EXEMPT_MARKUP_FACTOR + Number.EPSILON) * 100) / 100 : 0
        const rate = hours > 0 ? Math.round((gross / hours) * 10000) / 10000 : 0
        const billRateVal = hours > 0 ? Math.round((invoiced / hours) * 10000) / 10000 : (gross > 0 ? Math.round((rate * CINGULAR_EXEMPT_MARKUP_FACTOR) * 100) / 100 : 0)

        const isPendingPay = targetStoreId === 0
        const humanLabel = isPendingPay
          ? `Supervisor de ${opStoreNames.join(', ')} · Tienda pagadora pendiente de confirmar`
          : `Supervisor de ${opStoreNames.join(', ')} · Pagado por ${payStoreName}`

        paidSupervisors.push({
          assignmentId: pay.supervisor_assignment_id,
          employeeId: pay.supervisor_employee_id,
          supervisorName: pay.supervisor_name_snapshot || (territory ? territory.name : 'Supervisor'),
          jobTitle: 'District Supervisor',
          isPayingStore: true,
          operationalStoreIds: opStoreIds,
          operationalStoreNames: opStoreNames,
          payrollStoreId: targetStoreId,
          payrollStoreName: payStoreName,
          payrollStoreCode: payStoreCode,
          paystubId: pay.paystub_id,
          grossWages: gross,
          salaryHours: hours,
          payRate: rate,
          billRate: billRateVal,
          invoicedAmount: invoiced,
          humanLabel,
          reviewStatus: pay.review_status
        })
      }
    }

    // 5. Analizar si la tienda actual (targetStoreId) es TIENDA OPERADA por un supervisor que cobra en OTRA tienda
    const opsForThisStore = allOps.filter(op => op.operational_store_id === targetStoreId)
    for (const op of opsForThisStore) {
      const asgKey = nativeKey(op)
      if (!asgKey) continue
      // Buscar los pagos correspondientes en allPays
      const pays = allPays.filter(p => nativeKey(p) === asgKey)
      const pay = pays.length > 0 ? pays[0] : undefined

      const payingStoreId = pay ? pay.payroll_store_id : 0
      // Si la tienda pagadora es distinta a la tienda que estamos evaluando:
      if (payingStoreId !== targetStoreId) {
        const territory = territoryByAsg.get(asgKey)
        const opStoreIds = territory ? territory.storeIds : [targetStoreId]
        const opStoreNames = territory ? territory.storeNames : []

        const isPendingAssignment = !pay || payingStoreId === 0
        const payStore = payingStoreId ? storeLabel(stores, payingStoreId) : null
        const payStoreName = isPendingAssignment ? 'Tienda pagadora pendiente de confirmar' : (payStore?.name || 'Desconocida')
        const payStoreCode = payStore?.code || ''

        const humanLabel = isPendingAssignment
          ? `Supervisor de ${opStoreNames.join(', ')} · Tienda pagadora pendiente de confirmar`
          : `Supervisor de ${opStoreNames.join(', ')} · Pagado por ${payStoreName}`

        const totalGrossWages = pays.reduce((sum, p) => sum + (Number.isFinite(Number(p.gross_wages)) ? Number(p.gross_wages) : 0), 0)
        const totalSalaryHours = pays.reduce((sum, p) => sum + (Number.isFinite(Number(p.salary_hours)) ? Number(p.salary_hours) : 0), 0)

        operationalOnlySupervisors.push({
          assignmentId: op.supervisor_assignment_id,
          employeeId: op.supervisor_employee_id,
          supervisorName: op.supervisor_name_snapshot || (territory ? territory.name : 'Supervisor'),
          jobTitle: 'District Supervisor',
          isPayingStore: false,
          operationalStoreIds: opStoreIds,
          operationalStoreNames: opStoreNames,
          payrollStoreId: payingStoreId,
          payrollStoreName: payStoreName,
          payrollStoreCode: payStoreCode,
          paystubId: pays.map(p => p.paystub_id).join(','),
          grossWages: 0,       // REGLA CRÍTICA: Tienda operada secundaria recibe $0.00
          salaryHours: 0,      // REGLA CRÍTICA: Tienda operada secundaria recibe 0.00h
          payRate: 0,
          billRate: 0,
          invoicedAmount: 0,   // REGLA CRÍTICA: Cero costo facturado a esta tienda
          humanLabel,
          reviewStatus: isPendingAssignment ? 'requires_review' : op.review_status
        })
      }
    }
  } catch (err: any) {
    console.error('[SupervisorContext] Excepción en getStoreSupervisorContext:', err)
  }

  return {
    paidSupervisors,
    operationalOnlySupervisors,
    allSupervisors: [...paidSupervisors, ...operationalOnlySupervisors]
  }
}

/**
 * Obtiene todos los pagos de supervisores de la cadena deduplicando estrictamente por paystub_id.
 */
export async function getChainSupervisorPayments(
  periodStartDate?: string,
  periodEndDate?: string
): Promise<PayrollAssignment[]> {
  try {
    let payQuery = supabaseAdmin
      .from('supervisor_payroll_assignments')
      .select('*')
      .order('period_start', { ascending: false })

    if (periodStartDate && periodEndDate) {
      payQuery = payQuery.eq('period_start', periodStartDate).eq('period_end', periodEndDate)
    }

    const { data, error } = await payQuery
    if (error) {
      console.warn('[SupervisorContext] Error en getChainSupervisorPayments:', error.message)
      return []
    }

    // Deduplicación en memoria de seguridad por paystub_id (garantía dual a nivel aplicación y base de datos)
    const seenPaystubs = new Set<string>()
    const uniquePayments: PayrollAssignment[] = []

    for (const item of (data || []) as PayrollAssignment[]) {
      if (item.review_status === 'verified' && nativeKey(item) && !seenPaystubs.has(item.paystub_id)) {
        seenPaystubs.add(item.paystub_id)
        uniquePayments.push(item)
      }
    }

    return uniquePayments
  } catch (err: any) {
    console.error('[SupervisorContext] Error en getChainSupervisorPayments:', err)
    return []
  }
}

/**
 * Inserta o actualiza una asignación de nómina de supervisor asegurando idempotencia.
 * Si el paystub_id ya existe, omite la inserción para prevenir violaciones o duplicados.
 */
export async function recordSupervisorPayrollPayment(params: {
  assignmentId?: string
  employeeId?: string
  payrollStoreId: number
  simplifySiteId: string
  paystubId: string
  batchId?: string
  periodStart: string
  periodEnd: string
  grossWages: number
  salaryHours: number
  supervisorNameSnapshot: string
  source?: 'simplify_paystub' | 'manual_review'
  confirmedBy: string
}): Promise<{ success: boolean; inserted: boolean; error?: string }> {
  // Esta función registra solamente datos extraídos del recibo verificado en Simplify HR.
  // El flujo manual usa confirmSupervisorRelationship(), que valida la evidencia antes de llegar aquí.
  if (!params.assignmentId && !params.employeeId) {
    return { success: false, inserted: false, error: 'Falta identificador nativo de Simplify HR.' }
  }
  if (!Number.isFinite(params.grossWages) || !Number.isFinite(params.salaryHours) || params.grossWages < 0 || params.salaryHours < 0) {
    return { success: false, inserted: false, error: 'El recibo contiene importes u horas inválidos.' }
  }

  try {
    // 1. Chequeo de idempotencia por paystub_id
    const { data: existing } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .select('id')
      .eq('paystub_id', params.paystubId)
      .limit(1)

    if (existing && existing.length > 0) {
      return { success: true, inserted: false }
    }

    // 2. Inserción protegida
    const record = {
      supervisor_assignment_id: params.assignmentId || null,
      supervisor_employee_id: params.employeeId || null,
      payroll_store_id: params.payrollStoreId,
      simplify_site_id: params.simplifySiteId,
      paystub_id: params.paystubId,
      batch_id: params.batchId || null,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      gross_wages: params.grossWages,
      salary_hours: params.salaryHours,
      source: params.source || 'simplify_paystub',
      review_status: 'verified',
      supervisor_name_snapshot: params.supervisorNameSnapshot,
      confirmed_by: params.confirmedBy,
      confirmed_at: new Date().toISOString()
    }

    const { error } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .insert(record)

    if (error) {
      return { success: false, inserted: false, error: error.message }
    }

    return { success: true, inserted: true }
  } catch (err: any) {
    return { success: false, inserted: false, error: err?.message || 'Error inesperado' }
  }
}

/**
 * Inserta o actualiza una asignación operativa para una tienda asegurando idempotencia.
 */
export async function recordSupervisorOperationalStore(params: {
  assignmentId?: string
  employeeId?: string
  operationalStoreId: number
  effectiveFrom: string
  effectiveTo?: string | null
  supervisorNameSnapshot: string
  source?: 'stores_assignment' | 'simplify_paystub' | 'manual_review'
  confirmedBy?: string
}): Promise<{ success: boolean; inserted: boolean; error?: string }> {
  const hasNativeId = Boolean(params.assignmentId || params.employeeId)
  // Una confirmación manual conserva la evidencia para revisión; solo una sincronización
  // procedente de stores con identificador nativo puede marcar territorio como verificado.
  const reviewStatus = params.source === 'stores_assignment' && hasNativeId ? 'verified' : 'requires_review'

  try {
    // Chequeo de asignación activa idéntica
    let existingQuery = supabaseAdmin
      .from('supervisor_operational_assignments')
      .select('id')
      .eq('operational_store_id', params.operationalStoreId)
      .is('effective_to', null)
    existingQuery = params.assignmentId
      ? existingQuery.eq('supervisor_assignment_id', params.assignmentId)
      : existingQuery.eq('supervisor_employee_id', params.employeeId || '')
    const { data: existing } = await existingQuery.limit(1)

    if (existing && existing.length > 0) {
      return { success: true, inserted: false }
    }

    const record = {
      supervisor_assignment_id: params.assignmentId || null,
      supervisor_employee_id: params.employeeId || null,
      operational_store_id: params.operationalStoreId,
      effective_from: params.effectiveFrom,
      effective_to: params.effectiveTo || null,
      source: params.source || 'stores_assignment',
      review_status: reviewStatus,
      supervisor_name_snapshot: params.supervisorNameSnapshot,
      confirmed_by: params.confirmedBy || null,
      confirmed_at: params.confirmedBy ? new Date().toISOString() : null
    }

    const { error } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .insert(record)

    if (error) {
      return { success: false, inserted: false, error: error.message }
    }

    return { success: true, inserted: true }
  } catch (err: any) {
    return { success: false, inserted: false, error: err?.message || 'Error inesperado' }
  }
}

/**
 * Registra un cambio de tienda pagadora para un supervisor entre períodos:
 * Conserva el historial previo sin traslapes.
 */
export async function changeSupervisorPayingStore(params: {
  assignmentId: string
  employeeId?: string
  oldPeriodEnd: string
  newPeriodStart: string
  newPeriodEnd: string
  newPayrollStoreId: number
  newSimplifySiteId: string
  newPaystubId: string
  grossWages: number
  salaryHours: number
  supervisorNameSnapshot: string
  confirmedBy: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Registrar el nuevo pago en la nueva tienda pagadora para el nuevo período
    const res = await recordSupervisorPayrollPayment({
      assignmentId: params.assignmentId,
      employeeId: params.employeeId,
      payrollStoreId: params.newPayrollStoreId,
      simplifySiteId: params.newSimplifySiteId,
      paystubId: params.newPaystubId,
      periodStart: params.newPeriodStart,
      periodEnd: params.newPeriodEnd,
      grossWages: params.grossWages,
      salaryHours: params.salaryHours,
      supervisorNameSnapshot: params.supervisorNameSnapshot,
      source: 'manual_review',
      confirmedBy: params.confirmedBy
    })

    if (!res.success) {
      return { success: false, error: res.error }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error al cambiar tienda pagadora' }
  }
}

export interface ActiveSupervisorProfile {
  assignmentId: string | null
  employeeId: string | null
  supervisorName: string
  jobTitle: string
  operationalStores: Array<{
    storeId: number
    storeCode: string
    storeName: string
    effectiveFrom: string
    effectiveTo: string | null
    reviewStatus: string
  }>
  payingStore: {
    storeId: number
    storeCode: string
    storeName: string
    simplifySiteId: string
    paystubId?: string
    grossWages?: number
    salaryHours?: number
    reviewStatus: string
  } | null
  humanLabel: string
}

export async function getActiveSupervisorProfiles(
  periodStart?: string,
  periodEnd?: string
): Promise<ActiveSupervisorProfile[]> {
  try {
    const stores = await getStoreReferences()
    const { data: opData } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .select('*')
      .order('effective_from', { ascending: false })
    const ops = ((opData || []) as OperationalAssignment[])
      .filter(op => overlapsPeriod(op.effective_from, op.effective_to, periodStart, periodEnd))

    let payQuery = supabaseAdmin
      .from('supervisor_payroll_assignments')
      .select('*')
      .order('period_start', { ascending: false })

    if (periodStart && periodEnd) {
      payQuery = payQuery.eq('period_start', periodStart).eq('period_end', periodEnd)
    }

    const { data: payData } = await payQuery
    const pays = ((payData || []) as PayrollAssignment[])
      .filter(pay => pay.review_status === 'verified' && Boolean(nativeKey(pay)))

    const profileMap = new Map<string, ActiveSupervisorProfile>()

    for (const op of ops) {
      const key = nativeKey(op)
      if (!key) continue
      const store = storeLabel(stores, op.operational_store_id)
      const storeName = store.name
      const storeCode = store.code

      if (!profileMap.has(key)) {
        profileMap.set(key, {
          assignmentId: op.supervisor_assignment_id,
          employeeId: op.supervisor_employee_id,
          supervisorName: op.supervisor_name_snapshot || 'Supervisor',
          jobTitle: 'District Supervisor',
          operationalStores: [],
          payingStore: null,
          humanLabel: ''
        })
      }

      const prof = profileMap.get(key)!
      prof.operationalStores.push({
        storeId: op.operational_store_id,
        storeCode,
        storeName,
        effectiveFrom: op.effective_from,
        effectiveTo: op.effective_to,
        reviewStatus: op.review_status
      })
    }

    for (const pay of pays) {
      const key = nativeKey(pay)
      if (!key) continue
      let prof = profileMap.get(key)
      if (!prof) {
        prof = {
          assignmentId: pay.supervisor_assignment_id,
          employeeId: pay.supervisor_employee_id,
          supervisorName: pay.supervisor_name_snapshot || 'Supervisor',
          jobTitle: 'District Supervisor',
          operationalStores: [],
          payingStore: null,
          humanLabel: ''
        }
        profileMap.set(key, prof)
      }

      const store = storeLabel(stores, pay.payroll_store_id)
      const storeName = store.name
      const storeCode = store.code

      if (!prof.payingStore) {
        prof.payingStore = {
          storeId: pay.payroll_store_id,
          storeCode,
          storeName,
          simplifySiteId: pay.simplify_site_id,
          paystubId: pay.paystub_id,
          grossWages: Number(pay.gross_wages || 0),
          salaryHours: Number.isFinite(Number(pay.salary_hours)) ? Number(pay.salary_hours) : 0,
          reviewStatus: pay.review_status
        }
      }
    }

    for (const prof of profileMap.values()) {
      const opNames = prof.operationalStores.map(s => s.storeName).join(', ') || 'Sin tiendas operativas'
      const isPending = !prof.payingStore || prof.payingStore.storeId === 0
      const payLabel = isPending || !prof.payingStore
        ? 'Tienda pagadora pendiente de confirmar'
        : `Pagado por ${prof.payingStore.storeName}`
      prof.humanLabel = `Supervisor de ${opNames} · ${payLabel}`
    }

    return Array.from(profileMap.values())
  } catch (err: any) {
    console.error('[SupervisorProfiles] Error en getActiveSupervisorProfiles:', err)
    return []
  }
}

export interface StoreOperationalSupervisorInfo {
  storeId: number
  storeCode: string
  storeName: string
  supervisorName: string
  assignmentId: string | null
  employeeId: string | null
  effectiveFrom: string
  reviewStatus: string
}

export async function getStoreOperationalSupervisors(): Promise<Map<number, StoreOperationalSupervisorInfo>> {
  try {
    const [stores, result] = await Promise.all([
      getStoreReferences(),
      supabaseAdmin
      .from('supervisor_operational_assignments')
      .select('*')
      .or('effective_to.is.null,effective_to.gt.' + new Date().toISOString().substring(0, 10))
    ])
    const { data } = result

    const map = new Map<number, StoreOperationalSupervisorInfo>()
    for (const row of (data || []) as OperationalAssignment[]) {
      const store = storeLabel(stores, row.operational_store_id)
      map.set(row.operational_store_id, {
        storeId: row.operational_store_id,
        storeCode: store.code,
        storeName: store.name,
        supervisorName: row.supervisor_name_snapshot || 'Supervisor',
        assignmentId: row.supervisor_assignment_id,
        employeeId: row.supervisor_employee_id,
        effectiveFrom: row.effective_from,
        reviewStatus: row.review_status
      })
    }
    return map
  } catch (err: any) {
    console.error('[StoreOpSupervisors] Error en getStoreOperationalSupervisors:', err)
    return new Map()
  }
}

export async function confirmSupervisorRelationship(params: {
  assignmentId?: string
  employeeId?: string
  userId?: number
  supervisorNameSnapshot: string
  operationalStoreId?: number
  payrollStoreId?: number
  simplifySiteId?: string
  paystubId?: string
  periodStart?: string
  periodEnd?: string
  confirmedBy: string
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!params.assignmentId && !params.employeeId) {
      return { success: false, error: 'Se requiere assignmentId o employeeId nativo.' }
    }
    if (!params.confirmedBy?.trim()) {
      return { success: false, error: 'No se pudo identificar al administrador que confirma la relación.' }
    }
    const stores = await getStoreReferences()
    if (params.operationalStoreId && !stores.has(params.operationalStoreId)) {
      return { success: false, error: 'La tienda operativa no existe.' }
    }
    if (params.payrollStoreId && !stores.has(params.payrollStoreId)) {
      return { success: false, error: 'La tienda pagadora no existe.' }
    }

    // 1. Validar que la tienda pagadora y simplifySiteId correspondan a la misma sucursal
    if (params.payrollStoreId && params.simplifySiteId) {
      const storeMeta = RONOS_STORES_MAP.find(s => s.tegStoreId === params.payrollStoreId)
      if (storeMeta) {
        const expectedSiteId = RONOS_TO_SIMPLIFY_SITE_MAP[storeMeta.ronosCompanyId]
        if (!expectedSiteId) {
          return {
            success: false,
            error: `Falta mapping de tienda RONOS (companyId: ${storeMeta.ronosCompanyId}) en RONOS_TO_SIMPLIFY_SITE_MAP. No se puede validar la tienda pagadora.`
          }
        }
        if (expectedSiteId && params.simplifySiteId !== expectedSiteId) {
          return {
            success: false,
            error: `Discrepancia de tienda pagadora: La sucursal ${storeMeta.tegName} (${storeMeta.tegCode}) corresponde al sitio Simplify HR "${expectedSiteId}", no a "${params.simplifySiteId}".`
          }
        }
      }
    }

    const payrollFields = [params.payrollStoreId, params.paystubId, params.simplifySiteId, params.periodStart, params.periodEnd]
    if (payrollFields.some(Boolean) && payrollFields.some(value => !value)) {
      return { success: false, error: 'Para registrar un pago se requieren tienda, siteId, paystubId y período completos.' }
    }

    let payInserted = false

    // 2. Procesar registro de nómina primero con validación estricta de recibo
    if (params.payrollStoreId && params.paystubId && params.simplifySiteId && params.periodStart && params.periodEnd) {
      const paystubs = await getSitePaystubs(params.simplifySiteId)
      const paystub = paystubs.find(stub => {
        const start = stub.periodStart || stub.payPeriodStart
        const end = stub.periodEnd || stub.payPeriodEnd
        const assignmentMatches = !params.assignmentId || stub.assignmentId === params.assignmentId
        const employeeMatches = !params.employeeId || stub.employeeNumber === params.employeeId
        const siteMatches = !stub.siteId || stub.siteId === params.simplifySiteId
        return stub.id === params.paystubId && assignmentMatches && employeeMatches && siteMatches && start === params.periodStart && end === params.periodEnd
      })
      if (!paystub) {
        return { success: false, error: 'El recibo no coincide exactamente con los IDs nativos, sitio y período de Simplify HR.' }
      }
      const payRes = await recordSupervisorPayrollPayment({
        assignmentId: params.assignmentId,
        employeeId: params.employeeId,
        payrollStoreId: params.payrollStoreId,
        simplifySiteId: params.simplifySiteId,
        paystubId: params.paystubId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        grossWages: Number(paystub.grossWages || 0),
        salaryHours: actualHours(paystub),
        supervisorNameSnapshot: paystub.employeeName || [paystub.firstName, paystub.lastName].filter(Boolean).join(' ') || params.supervisorNameSnapshot,
        source: 'simplify_paystub',
        confirmedBy: params.confirmedBy
      })
      if (!payRes.success) return { success: false, error: payRes.error }
      payInserted = Boolean(payRes.inserted)
    }

    // 3. Procesar registro operativo (con rollback de nómina si falla)
    if (params.operationalStoreId) {
      const opRes = await recordSupervisorOperationalStore({
        assignmentId: params.assignmentId,
        employeeId: params.employeeId,
        operationalStoreId: params.operationalStoreId,
        effectiveFrom: params.periodStart || new Date().toISOString().slice(0, 10),
        supervisorNameSnapshot: params.supervisorNameSnapshot,
        source: 'manual_review',
        confirmedBy: params.confirmedBy
      })
      if (!opRes.success) {
        if (payInserted && params.paystubId) {
          await supabaseAdmin.from('supervisor_payroll_assignments').delete().eq('paystub_id', params.paystubId)
        }
        return { success: false, error: opRes.error }
      }
    }

    return { success: true, id: 'confirmed' }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error confirmando relación' }
  }
}

export async function updateSupervisorPayingStore(params: {
  assignmentId: string
  employeeId?: string
  newPayrollStoreId: number
  newSimplifySiteId?: string
  effectiveDate: string
  confirmedBy: string
}): Promise<{ success: boolean; error?: string }> {
  // La tienda pagadora es un hecho contable del recibo oficial, no un ajuste libre.
  // La UI debe usar confirmSupervisorRelationship con el paystub del nuevo período.
  return {
    success: false,
    error: 'Para cambiar una tienda pagadora se requiere confirmar el recibo oficial de Simplify HR del nuevo período; no se permiten cambios manuales sin evidencia.'
  }
}

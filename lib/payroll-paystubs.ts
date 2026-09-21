/**
 * @module payroll-paystubs
 * @description Lectura completa y limitada por período de los recibos de Simplify HR.
 * @businessRules Pagina por page/limit verificados en API real; falla ante páginas
 * repetidas o incompletas. Nunca convierte un salario ausente en cero.
 * @dataFlow Simplify HR payroll/paystubs -> páginas -> recibos del período solicitado.
 * @notes Los recibos exponen salarios y referencias de invoice, no el total facturado.
 */
import { callSimplifyHrApi, type SimplifyHrPaystub } from './simplifyhr-api'

export async function loadPeriodPaystubs(siteId: string, start: string, end: string): Promise<SimplifyHrPaystub[]> {
  const found = new Map<string, SimplifyHrPaystub>()
  const seen = new Set<string>()
  const limit = 100
  for (let page = 1; page <= 100; page++) {
    const result = await callSimplifyHrApi<any>('payroll/paystubs', { params: { siteId, page, limit }, maxRetries: 2 })
    if (!Array.isArray(result?.paystubs) || !Number.isInteger(result.total) || !Number.isInteger(result.totalPages)) {
      throw new Error('Simplify HR: respuesta de paginación no reconocida')
    }
    if (result.page !== page || (result.paystubs.length === 0 && seen.size < result.total)) {
      throw new Error('Simplify HR: página incompleta de recibos')
    }
    for (const raw of result.paystubs) {
      if (!raw.id || seen.has(raw.id)) throw new Error('Simplify HR: recibo duplicado o sin identificador')
      seen.add(raw.id)
      if (raw.siteId !== siteId || String(raw.payPeriodStart || '').slice(0, 10) !== start || String(raw.payPeriodEnd || '').slice(0, 10) !== end) continue
      found.set(raw.id, {
        id: raw.id, userId: raw.userId, invoiceId: raw.invoiceId, batchId: raw.batchId,
        employeeNumber: raw.employeeNumber, employeeName: raw.employeeName, firstName: raw.firstName, lastName: raw.lastName,
        siteId: raw.siteId, assignmentId: raw.assignmentId,
        payPeriodStart: raw.payPeriodStart, payPeriodEnd: raw.payPeriodEnd, status: raw.status,
        grossWages: typeof raw.grossWages === 'number' && Number.isFinite(raw.grossWages) ? raw.grossWages : undefined,
        earnings: Array.isArray(raw.earnings) ? raw.earnings : []
      })
    }
    if (page >= result.totalPages) {
      if (seen.size !== result.total) throw new Error('Simplify HR: total de recibos no coincide con páginas recibidas')
      return [...found.values()]
    }
  }
  throw new Error('Simplify HR: se excedió el límite de páginas; no se certifica cobertura')
}

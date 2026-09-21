/**
 * @module scripts/verify-active-paystub-links
 * @description Recalcula el último período bisemanal cerrado de cada tienda para medir recibos Simplify enlazados por assignmentId.
 * @businessRules Solo lectura. No usa coincidencias de nombre como identidad verificable y no muta cachés ni nómina.
 * @dataFlow ronos_work_weeks -> período cerrado por tienda -> payroll-calculator -> resumen de vínculos de recibos.
 * @notes En septiembre de 2026, el período evaluado utiliza las semanas 31 Ago–6 Sep y 7–13 Sep, no la semana en curso.
 */
import { calculateCingularPayrollReport } from '../lib/payroll-calculator'
import { RONOS_STORES_MAP } from '../lib/ronos-api'
import { supabaseAdmin } from '../lib/supabase'

async function main() {
  const { data, error } = await supabaseAdmin
    .from('ronos_work_weeks')
    .select('company_id,week_id,start_date')
    .order('start_date', { ascending: false })
    .limit(1000)
  if (error) throw error
  const weeksByCompany = new Map<number, Array<{ weekId: number; startDate: string }>>()
  for (const row of data || []) {
    const list = weeksByCompany.get(Number(row.company_id)) || []
    list.push({ weekId: Number(row.week_id), startDate: String(row.start_date) })
    weeksByCompany.set(Number(row.company_id), list)
  }

  const results: Array<Record<string, unknown>> = []
  for (const store of RONOS_STORES_MAP) {
    const weeks = (weeksByCompany.get(store.ronosCompanyId) || []).sort((a, b) => b.startDate.localeCompare(a.startDate))
    const payrollWeeks = weeks.slice(2, 4).map(week => week.weekId)
    if (payrollWeeks.length !== 2) throw new Error(`${store.tegName}: faltan semanas para la verificación`)
    const report = await calculateCingularPayrollReport(store.ronosCompanyId, payrollWeeks, true)
    results.push({ store: store.tegName, payrollWeeks, employees: report.totalEmployees, paystubMatches: report.paystubMatchesCount || 0, unmatchedPaystubs: report.unmatchedPaystubsCount || 0 })
  }
  const totals = results.reduce((sum, row) => ({
    employees: sum.employees + Number(row.employees || 0), paystubMatches: sum.paystubMatches + Number(row.paystubMatches || 0), unmatchedPaystubs: sum.unmatchedPaystubs + Number(row.unmatchedPaystubs || 0)
  }), { employees: 0, paystubMatches: 0, unmatchedPaystubs: 0 })
  console.log(JSON.stringify({ totals, stores: results }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 })

/**
 * @module compare-ronos-simplify-native-ids
 * @description Mide intersecciones de identificadores entre RONOS y Simplify HR sin exponer valores personales.
 * @businessRules Solo lectura; los resultados son conteos de coincidencias, nunca IDs ni nombres.
 * @dataFlow Tarjetas RONOS recientes + empleados activos Simplify -> comparación assignmentId/employeeID/userId.
 * @notes Determina la llave técnica disponible para reemplazar el cruce heurístico por nombre.
 */
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'
import { supabaseAdmin } from '../lib/supabase'

function values(rows: any[], field: string) {
  return new Set(rows.map(row => String(row[field] ?? '').trim()).filter(Boolean))
}

function overlap(left: Set<string>, right: Set<string>) {
  return [...left].filter(value => right.has(value)).length
}

async function main() {
  const companyId = 34
  const [{ data: cards, error }, employeesResponse] = await Promise.all([
    supabaseAdmin.from('ronos_employee_timecards_cache')
      .select('employee_user_id,employee_id,pin').eq('company_id', companyId)
      .order('week_id', { ascending: false }).limit(250),
    callSimplifyHrApi<any>('employee/getEmployeesBySiteId', {
      method: 'POST', params: { siteId: RONOS_TO_SIMPLIFY_SITE_MAP[companyId] },
      body: { pageNumber: 1, pageSize: 100, active: true }, maxRetries: 1
    })
  ])
  if (error) throw new Error(error.message)
  const ronos = [...new Map((cards || []).map((card: any) => [card.employee_user_id, card])).values()]
  const simplify = Array.isArray(employeesResponse?.employeeModel) ? employeesResponse.employeeModel : []
  const ronosFields = ['employee_user_id', 'employee_id', 'pin']
  const simplifyFields = ['assignmentId', 'employeeID', 'userId']
  const intersections = Object.fromEntries(ronosFields.map(ronosField => [ronosField,
    Object.fromEntries(simplifyFields.map(simplifyField => [simplifyField,
      overlap(values(ronos, ronosField), values(simplify, simplifyField))
    ]))
  ]))
  console.log(JSON.stringify({
    ronosEmployees: ronos.length, simplifyEmployees: simplify.length,
    simplifyWithAssignmentId: values(simplify, 'assignmentId').size,
    simplifyRonosSynced: simplify.filter((employee: any) => employee.isRonosSynced === true).length,
    intersections
  }, null, 2))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

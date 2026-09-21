/**
 * @module audit-simplify-ronos-native-links
 * @description Consulta los campos nativos assignmentId e isRonosSynced de Simplify HR por sucursal.
 * @businessRules Solo lectura; un assignmentId es el vínculo operativo que Simplify conserva con RONOS.
 * @dataFlow Catálogo RONOS -> Site Simplify HR -> empleados activos -> conteos agregados.
 * @notes No imprime nombres, identificadores, salarios ni credenciales; usa la autenticación existente del proyecto.
 */
import { RONOS_STORES_MAP } from '../lib/ronos-api'
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'

async function main() {
  const stores = []
  for (const store of RONOS_STORES_MAP) {
    const siteId = RONOS_TO_SIMPLIFY_SITE_MAP[store.ronosCompanyId]
    if (!siteId) throw new Error(`No hay Site Simplify para ${store.tegName}`)
    const activeResult = await callSimplifyHrApi<any>('employee/getEmployeesBySiteId', {
      method: 'POST', params: { siteId }, body: { pageNumber: 1, pageSize: 100, active: true }, maxRetries: 1
    })
    const active = Array.isArray(activeResult?.employeeModel) ? activeResult.employeeModel : []
    const summarize = (employees: any[]) => ({
      employees: employees.length,
      withAssignmentId: employees.filter(employee => Boolean(employee.assignmentId)).length,
      ronosSynced: employees.filter(employee => employee.isRonosSynced === true).length,
      syncedWithoutAssignmentId: employees.filter(employee => employee.isRonosSynced === true && !employee.assignmentId).length
    })
    stores.push({
      store: store.tegName,
      companyId: store.ronosCompanyId,
      active: summarize(active)
    })
  }
  const total = (field: keyof (typeof stores)[number]['active']) => stores.reduce((sum, store) => sum + store.active[field], 0)
  console.log(JSON.stringify({
    summary: {
      stores: stores.length,
      simplifyEmployees: total('employees'), assignmentIds: total('withAssignmentId'),
      ronosSynced: total('ronosSynced'), syncedWithoutAssignmentId: total('syncedWithoutAssignmentId')
    },
    stores
  }, null, 2))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

/**
 * @module compare-ronos-punch-assignments
 * @description Verifica si los assignmentId de las ponchadas RONOS coinciden con los assignmentId de Simplify HR.
 * @businessRules Solo lectura; devuelve exclusivamente conteos agregados y no modifica tarjetas ni perfiles.
 * @dataFlow Auditoría RONOS semanal -> punch.assignmentId + empleados Simplify activos -> intersección de llaves.
 * @notes La coincidencia permite usar el enlace nativo sin depender de nombres, PIN o IDs de usuario.
 */
import { getRonosStoreAudit } from '../lib/ronos-api'
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'

async function main() {
  const companyId = 34
  const [audit, simplifyResponse] = await Promise.all([
    getRonosStoreAudit(companyId),
    callSimplifyHrApi<any>('employee/getEmployeesBySiteId', {
      method: 'POST', params: { siteId: RONOS_TO_SIMPLIFY_SITE_MAP[companyId] },
      body: { pageNumber: 1, pageSize: 100, active: true }, maxRetries: 1
    })
  ])
  const ronosAssignments = new Set<string>()
  let employeesWithPunchAssignment = 0
  for (const employee of audit.employees) {
    const assignments = new Set(
      employee.days.flatMap(day => day.punches.map(punch => String(punch.assignmentId || '').trim()).filter(Boolean))
    )
    if (assignments.size) employeesWithPunchAssignment++
    assignments.forEach(assignment => ronosAssignments.add(assignment))
  }
  const simplify = Array.isArray(simplifyResponse?.employeeModel) ? simplifyResponse.employeeModel : []
  const simplifyAssignments = new Set(simplify.map((employee: any) => String(employee.assignmentId || '').trim()).filter(Boolean))
  const intersections = [...ronosAssignments].filter(assignment => simplifyAssignments.has(assignment))
  console.log(JSON.stringify({
    ronosWeekId: audit.weekId, ronosEmployees: audit.employees.length,
    ronosEmployeesWithPunchAssignment: employeesWithPunchAssignment,
    ronosAssignmentIds: ronosAssignments.size, simplifyEmployees: simplify.length,
    simplifyAssignmentIds: simplifyAssignments.size, matchingAssignmentIds: intersections.length
  }, null, 2))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

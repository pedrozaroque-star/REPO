/**
 * @module inspect-simplify-native-link-fields
 * @description Inspecciona sin PII la forma real de los campos nativos de enlace RONOS en empleados Simplify.
 * @businessRules Solo lectura; no imprime valores de identificación, nombres, salarios ni credenciales.
 * @dataFlow Simplify HR empleado por Site -> metadatos de campos -> resumen de valores presentes.
 * @notes Usa la consulta operativa disponible para el módulo, no endpoints administrativos de migración.
 */
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'

async function main() {
  const result = await callSimplifyHrApi<any>('employee/getEmployeesBySiteId', {
    method: 'POST', params: { siteId: RONOS_TO_SIMPLIFY_SITE_MAP[34] },
    body: { pageNumber: 1, pageSize: 100, active: true }, maxRetries: 1
  })
  const employees = Array.isArray(result?.employeeModel) ? result.employeeModel : []
  const keys = [...new Set(employees.flatMap((employee: any) => Object.keys(employee)))].sort()
  const interestingKeys = keys.filter(key => /ronos|assign|employee.?id|user.?id|sync/i.test(key))
  const presence = Object.fromEntries(interestingKeys.map(key => [key, employees.filter((employee: any) => employee[key] !== null && employee[key] !== undefined && employee[key] !== '').length]))
  console.log(JSON.stringify({
    responseKeys: Object.keys(result || {}).sort(), employees: employees.length,
    totalEmployees: Number(result?.totalEmployees || 0), interestingKeys, presence
  }, null, 2))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })

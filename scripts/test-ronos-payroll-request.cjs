/** Runtime simulation of the request parser taken directly from the production route. */
const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')

const source = fs.readFileSync('app/api/ronos/payroll/route.ts', 'utf8')
const catalogSource = fs.readFileSync('lib/ronos-api.ts', 'utf8')
const catalog = catalogSource.slice(catalogSource.indexOf('export const RONOS_STORES_MAP:'), catalogSource.indexOf('/**', catalogSource.indexOf('export const RONOS_STORES_MAP:')))
const parser = source.slice(source.indexOf('    const { searchParams }'), source.indexOf('    let report:'))
// Return response payloads instead of requiring a Next request context; no data sources or payroll calculations are substituted.
const executable = ts.transpileModule(catalog.replace('export ', '') + '\nfunction parse(request: Request) {\n' + parser.replaceAll('NextResponse.json(', 'Object.assign(') + '\nreturn { weekIds, ronosCompanyId, mode }; }\nparse', { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const parse = vm.runInNewContext(executable, { URL, Object })
const run = query => parse({ url: 'http://localhost/api/ronos/payroll?' + query })
for (const query of ['companyId=34x', 'companyId=99999', 'weekIds=', 'weekIds=0,1', 'weekIds=1,1', 'weekIds=-1,2', 'weekIds=1x,2', 'weekIds=1,2,3', 'weekIds=1', 'mode=bad', 'biWeekly=foo', 'format=xml', 'companyId=Miércoles', 'companyId=Miercoles', 'companyId=Sábado', 'companyId=Sabado']) {
  assert.equal(run(query).status, 400, query)
}
for (const query of ['companyId=34&weekIds=155969,155970', 'companyId=all&weekIds=155969,155970', 'companyId=26&biWeekly=false&weekIds=155969']) assert.ok(run(query).weekIds, query)
console.log('PASS: 19 production request parser scenarios; zero DB writes')

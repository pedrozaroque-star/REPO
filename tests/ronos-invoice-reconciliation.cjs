/** Executes the production pure calculator against captured read-only business sources.
 * Usage: node tests/ronos-invoice-reconciliation.cjs <audit snapshot directory>
 * No credentials, network, database writes or fabricated payroll fixtures.
 */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), source = process.argv[2]
if (!source) throw new Error('Provide the directory containing the read-only audit snapshots')
const cache = new Map()
function load(file) {
  const absolute = path.resolve(root, file)
  if (!absolute.startsWith(root + path.sep)) throw new Error('Import outside project prohibited')
  if (cache.has(absolute)) return cache.get(absolute)
  if (absolute.endsWith('.json')) return JSON.parse(fs.readFileSync(absolute,'utf8'))
  const exports = {}; cache.set(absolute,exports)
  const code = ts.transpileModule(fs.readFileSync(absolute,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  vm.runInNewContext(code,{exports,require(name){
    if(!name.startsWith('.')) throw new Error('External dependency forbidden: '+name)
    return load(path.relative(root,path.resolve(path.dirname(absolute),name.endsWith('.json')?name:name+'.ts')))
  }},{filename:absolute})
  return exports
}
const {buildPayrollReport} = load('lib/payroll-reconciliation.ts')
const {moneyCents, normalizePayrollName} = load('lib/payroll-evidence.ts')
const {getInvoiceDocuments} = load('lib/payroll-invoice-evidence.ts')
const read = name => JSON.parse(fs.readFileSync(path.join(source,name+'.json'),'utf8'))
const db=read('db-snapshot'), sites=read('simplify-readonly'), original=JSON.stringify(db)
const reports=[]
for(const s of sites){
  const input={companyId:s.company,storeId:0,storeName:s.stubs[0]?.siteName||String(s.company),storeCode:String(s.company),
    siteId:s.site,start:'2026-08-24',end:'2026-09-06',isBiWeekly:true,mode:'consolidated',
    cards:db.cards.filter(c=>c.company_id===s.company),rates:db.simplify_employee_rates,stubs:s.stubs,
    paystubCoverageComplete:true,clockCoverageComplete:true,
    supervisorPaystubIds:db.supervisor_payroll_assignments.filter(p=>p.review_status==='verified'&&p.simplify_site_id===s.site).map(p=>p.paystub_id)}
  const before=JSON.stringify(input),report=buildPayrollReport(input); reports.push(report)
  assert.equal(JSON.stringify(input),before,'Production calculation mutated evidence')
  assert.equal(moneyCents(report.totalApprovedGrossPay),s.stubs.reduce((a,p)=>a+moneyCents(p.grossWages),0))
  assert.equal(report.employees.flatMap(e=>e.paystubIds||[]).length,s.stubs.length,'Every approved receipt exactly once')
  assert.equal(new Set(report.employees.flatMap(e=>e.paystubIds||[])).size,s.stubs.length)
  assert.equal(report.reconciliationPercentage,0,'No historical contract: no fabricated certification')
  for(const employee of report.employees) for(const [key,value] of Object.entries(employee)) {
    if(typeof value==='number') assert.ok(Number.isFinite(value),key+' must be finite')
  }
  const missing=buildPayrollReport({...input,paystubCoverageComplete:false,stubs:[]})
  assert.equal(missing.totalApprovedGrossPay,null)
  assert.equal(missing.isPartial,true)
  assert.equal(buildPayrollReport({...input,mode:'supplemental'}).isPartial,true,'Unknown batch scope cannot reconcile')
  assert.equal(buildPayrollReport({...input,mode:'supplemental'}).totalApprovedGrossPay,null)
  assert.equal(buildPayrollReport({...input,cards:[],clockCoverageComplete:false}).ronosEstimatedGrossPay,null)
  const missingEarnings=buildPayrollReport({...input,stubs:s.stubs.map(p=>({...p,earnings:[]}))})
  assert.equal(missingEarnings.calculationCoverageComplete,false)
  assert.equal(missingEarnings.invoiceReconciliation.billingVariance,null,'Missing earnings cannot appear as an agency overcharge')
  assert.throws(()=>buildPayrollReport({...input,stubs:[...s.stubs,s.stubs[0]]}),/duplicado/)
  // Sensitivity test on an in-memory copy of the real document object; disk is untouched.
  // An agency charge change must alter ONLY the comparison, never the independent calculation.
  const documents=getInvoiceDocuments(s.company,input.start,input.end)
  if(documents.length){
    const saved=documents[0].billedAmount
    try{
      documents[0].billedAmount=saved+100
      const changed=buildPayrollReport(input)
      assert.equal(changed.totalInvoicedAmount,report.totalInvoicedAmount,'Invoice total must not drive calculation')
      assert.equal(moneyCents(changed.invoiceReconciliation.billingVariance),moneyCents(report.invoiceReconciliation.billingVariance)-10000)
    }finally{documents[0].billedAmount=saved}
  }
  console.log(JSON.stringify({company:s.company,approved:report.totalApprovedGrossPay,calculatedGross:report.totalGrossPay,
    calculatedBill:report.totalInvoicedAmount,invoice:report.invoiceReconciliation?.officialBilledAmount,
    difference:report.invoiceReconciliation?.billingVariance,clockLinks:report.employees.filter(e=>e.hasNativeMatch).length,pending:report.pendingStubsCount}))
}
assert.equal(JSON.stringify(db),original)
const employee = (company,number) => reports.find(r=>r.ronosCompanyId===company).employees.find(e=>e.simplifyEmployeeNumber===number)
assert.equal(employee(28,'275505').payRate,17.9,'Roger rate resolved by assignment despite typo')
assert.ok(employee(28,'275505').totalInvoicedAmount>3000)
assert.equal(employee(27,'256432').payRate,18.4,'Bernardo assignment avoids name mismatch')
assert.equal(employee(33,'201073').vacationHours,40,'Teresa approved vacation retained')
assert.equal(employee(37,'287492').vacationHours,40,'Maria approved vacation retained')
assert.equal(employee(31,'285726').totalHours,80,'Javier full salary+PTO concepts')
assert.equal(employee(34,'249287').totalHours,80,'Carlos full salary+PTO concepts')
assert.equal(moneyCents(''),null); assert.equal(moneyCents(NaN),null); assert.equal(moneyCents(Infinity),null)
assert.equal(normalizePayrollName('Miércoles'),normalizePayrollName('MIERCOLES'))
assert.equal(normalizePayrollName('Sábado'),normalizePayrollName('SABADO'))
// Invoice mismatch must remain visible: no arbitrary balance adjustment.
assert.ok(reports.some(r=>Math.abs(r.invoiceReconciliation?.billingVariance||0)>1))
assert.ok(reports.every(r=>!r.isFullyReconciled))
const calendar=load('components/ronos/helpers.ts')
for(const [iso,day,time] of [
  ['2026-09-19T12:59:00Z','2026-09-18','5:59 AM'],['2026-09-19T13:00:00Z','2026-09-19','6:00 AM'],
  ['2026-09-19T23:59:00Z','2026-09-19','4:59 PM'],['2026-09-20T00:00:00Z','2026-09-19','5:00 PM'],
  ['2026-09-20T07:00:00Z','2026-09-19','12:00 AM'],['2026-12-19T14:00:00Z','2026-12-19','6:00 AM']
]){
  assert.equal(calendar.getPacificBusinessDate(iso),day)
  assert.equal(calendar.formatTime12h(iso),time)
}
console.log('PASS: 12 real stores; source immutability, native identity, PTO, salary, duplicates, missing coverage, finite money and independent variances')
if(process.env.RONOS_AUDIT_OUTPUT) fs.writeFileSync(process.env.RONOS_AUDIT_OUTPUT,JSON.stringify(reports))

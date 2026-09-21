/**
 * @module scripts/reconcile-invoice-paystubs
 * @description Concilia facturas documentadas contra recibos oficiales por identidad explícita.
 * @businessRules Solo lectura remota; nunca vincula por nombre ni certifica RONOS.
 * @dataFlow Facturas JSON + Simplify HR -> comparación centavo a centavo -> evidencia JSON.
 * @notes Incluye cobertura y faltantes; no publica nombres ni información bancaria.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { loadPeriodPaystubs } from '../lib/payroll-paystubs'
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'
import { isClosedPayrollEvidence, moneyCents } from '../lib/payroll-evidence'

async function employees(siteId:string) {
 const found=new Map<string,any>()
 for(const active of [true,false]) for(let pageNumber=1;pageNumber<=100;pageNumber++) {
  const response=await callSimplifyHrApi<any>('employee/getEmployeesBySiteId',{method:'POST',params:{siteId},body:{pageNumber,pageSize:100,active},maxRetries:2})
  if(!Array.isArray(response.employeeModel)||!Number.isInteger(response.totalEmployees))throw Error('Cobertura empleados no reconocida')
  for(const e of response.employeeModel) {if(!e.id)throw Error('Empleado sin ID');found.set(e.id,e)}
  if(pageNumber*100>=response.totalEmployees)break
  if(!response.employeeModel.length||pageNumber===100)throw Error('Cobertura empleados incompleta')
 }
 return [...found.values()]
}
async function main() {
 const invoices=JSON.parse(readFileSync('data/payroll/invoice-evidence.json','utf8')).filter((i:any)=>i.mode==='regular').sort((a:any,b:any)=>Number(b.companyId===26)-Number(a.companyId===26))
 const output:any[]=[]
 for(const invoice of invoices) {
  const siteId=RONOS_TO_SIMPLIFY_SITE_MAP[invoice.companyId]
  const base={invoiceId:invoice.invoiceId,siteId,periodStart:invoice.periodStart,periodEnd:invoice.periodEnd}
  try {
   if(!siteId)throw Error('Sucursal sin Simplify siteId')
   const all=await loadPeriodPaystubs(siteId,invoice.periodStart,invoice.periodEnd)
   const stubs=all.filter(s=>isClosedPayrollEvidence(s,invoice.periodStart,invoice.periodEnd))
   const emps=await employees(siteId)
   const used=new Set<string>()
   const rows=invoice.employees.map((employee:any)=>{
    const number=String(employee.employeeNumber).trim()
    let matches=stubs.filter(s=>String(s.employeeNumber||'').trim()===number)
    let method='employee_number'
    if(!matches.length) {
     const candidates=emps.filter(e=>String(e.employeeID||'').trim()===number)
     method='simplify_employee_id_to_user_assignment'
     if(candidates.length===1) {
      const e=candidates[0]
      matches=stubs.filter(s=>!!e.userId&&s.userId===e.userId&&(!e.assignmentId||s.assignmentId===e.assignmentId))
     } else if(candidates.length>1)return {employeeNumber:number,method,status:'ambiguous_employee_identity'}
    }
    if(matches.length!==1)return {employeeNumber:number,method,status:matches.length?'ambiguous_paystub':'missing_paystub'}
    const s=matches[0]
    if(used.has(s.id))return {employeeNumber:number,method,status:'duplicate_paystub_identity'}
    used.add(s.id)
    const gross=moneyCents(s.grossWages),expected=moneyCents(employee.grossPay)
    const delta=gross===null||expected===null?null:(gross-expected)/100
    return {employeeNumber:number,paystubId:s.id,method,status:delta===null?'missing_gross':delta===0?'gross_match':'gross_variance',invoiceGross:expected===null?null:expected/100,paystubGross:gross===null?null:gross/100,grossDelta:delta}
   })
   const matched=rows.filter((r:any)=>r.status==='gross_match'||r.status==='gross_variance')
   const sum=(key:string)=>matched.reduce((n:number,r:any)=>n+moneyCents(r[key])!,0)/100
   const result={...base,method:'invoice_to_paystub_only',coverage:{invoiceEmployees:rows.length,periodPaystubs:all.length,approvedPaystubs:stubs.length,linkedEmployees:matched.length,grossMatches:rows.filter((r:any)=>r.status==='gross_match').length,grossVariances:rows.filter((r:any)=>r.status==='gross_variance').length,unmatchedInvoiceEmployees:rows.length-matched.length,unmatchedPaystubs:stubs.filter(s=>!used.has(s.id)).length},invoiceGrossTotal:invoice.grossPay,linkedInvoiceGrossTotal:sum('invoiceGross'),linkedPaystubGrossTotal:sum('paystubGross'),linkedGrossDelta:sum('grossDelta'),employees:rows,unmatchedPaystubIds:stubs.filter(s=>!used.has(s.id)).map(s=>s.id)}
   output.push(result)
   console.log(JSON.stringify({...base,...result.coverage,grossDelta:result.linkedGrossDelta}))
  }catch(e:any){output.push({...base,method:'invoice_to_paystub_only',status:'source_error',error:e.message});console.error(invoice.invoiceId+': '+e.message)}
 }
 if(output.some(r=>r.status==='source_error')) throw Error('La conciliación no se guardó porque una fuente falló')
 writeFileSync('data/payroll/paystub-reconciliation.json',JSON.stringify(output,null,2)+'\n')
}
main().catch(e=>{console.error(e.message);process.exitCode=1})

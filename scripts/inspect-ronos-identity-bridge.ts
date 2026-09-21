/**
 * @module scripts/inspect-ronos-identity-bridge
 * @description Investiga campos de identidad reales de Hollywood sin imprimir PII.
 * @businessRules Solo lectura; coincidencias de nombres no certifican identidades.
 * @dataFlow Supabase y Simplify HR -> estadísticas de campos y cruces -> terminal.
 * @notes No imprime valores de nombres, IDs, PIN, SSN ni compensación.
 */
import { supabaseAdmin } from '../lib/supabase'
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'

async function main() {
 if(process.argv.includes('--invoice-only')) {
  const {data,error}=await supabaseAdmin.from('ronos_employee_timecards_cache').select('employee_user_id,employee_id,pin').eq('company_id',26).in('week_id',[155953,155954])
  if(error)throw Error(error.message)
  const ids=[277229,142742,266148,263725,140422,257840]
  console.log('invoiceIdFieldMatches',JSON.stringify(['employee_user_id','employee_id','pin'].map(k=>({field:k,count:ids.filter(id=>data?.some(c=>String((c as any)[k])===String(id))).length}))))
  const response=await callSimplifyHrApi<any>('employee/getEmployeesBySiteId',{method:'POST',params:{siteId:RONOS_TO_SIMPLIFY_SITE_MAP[26]},body:{pageNumber:1,pageSize:100,active:true},maxRetries:1})
  console.log('invoiceSimplifyListMatches',JSON.stringify(['id','employeeID','employeeNumber','userId','assignmentId'].map(k=>({field:k,count:ids.filter(id=>(response.employeeModel||[]).some((e:any)=>String(e[k])===String(id))).length}))))
  return
 }
 const siteId = RONOS_TO_SIMPLIFY_SITE_MAP[26]
 const [cards, mappings, rates, active, inactive] = await Promise.all([
  supabaseAdmin.from('ronos_employee_timecards_cache').select('*').eq('company_id',26).in('week_id',[155953,155954]),
  supabaseAdmin.from('ronos_employee_mappings').select('*').eq('ronos_company_id',26),
  supabaseAdmin.from('simplify_employee_rates').select('*').eq('ronos_company_id',26),
  callSimplifyHrApi<any>('employee/getEmployeesBySiteId',{method:'POST',params:{siteId},body:{pageNumber:1,pageSize:100,active:true},maxRetries:1}),
  callSimplifyHrApi<any>('employee/getEmployeesBySiteId',{method:'POST',params:{siteId},body:{pageNumber:1,pageSize:100,active:false},maxRetries:1})
 ])
 for(const [key,result] of Object.entries({cards,mappings,rates})) {
  if(result.error) throw Error(key+': '+result.error.message)
  console.log(key,JSON.stringify({count:result.data?.length,keys:Object.keys(result.data?.[0]||{})}))
 }
 const emps=[...(active.employeeModel||[]),...(inactive.employeeModel||[])]
 console.log('employeeList',JSON.stringify({activeTotal:active.totalEmployees,inactiveTotal:inactive.totalEmployees,count:emps.length,keys:Object.keys(emps[0]||{})}))
 const details = await Promise.all(emps.map(async(e:any)=>callSimplifyHrApi<any>(`employee/getEmployeeById/${e.id}`,{params:{id:e.id},maxRetries:1})))
 console.log('detailKeys',JSON.stringify([...new Set(details.flatMap(e=>Object.keys(e)))]))
 const uniqueCards=[...new Map((cards.data||[]).map(c=>[c.employee_user_id,c])).values()]
 const invoiceIds=[277229,142742,266148,263725,140422,257840]
 console.log('invoiceIdFieldMatches',JSON.stringify(['employee_user_id','employee_id','pin'].map(k=>({field:k,count:invoiceIds.filter(id=>uniqueCards.some(c=>String(c[k])===String(id))).length}))))
 const matches:any[]=[]
 for(const rk of ['employee_user_id','employee_id','pin']) for(const sk of [...new Set(details.flatMap(e=>Object.keys(e)))]) {
  if(!/id|number|pin|ronos/i.test(sk))continue
  const count=uniqueCards.filter(c=>c[rk]!=null&&String(c[rk])!==''&&details.some(s=>typeof s[sk]!=='object'&&s[sk]!=null&&String(s[sk])===String(c[rk]))).length
  if(count)matches.push({ronosField:rk,simplifyField:sk,count})
 }
 console.log('identityValueIntersections',JSON.stringify(matches))
 console.log('ronosIntegrationFields',JSON.stringify(details.map(e=>Object.fromEntries(Object.entries(e).filter(([k])=>/ronos/i.test(k)).map(([k,v])=>[k,typeof v==='boolean'?v:typeof v==='object'?{type:typeof v,keys:v?Object.keys(v):[]}: {present:v!=null&&v!==''}])))))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})

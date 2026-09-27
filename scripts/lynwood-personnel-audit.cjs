/**
 * @module lynwood-personnel-audit
 * @description Extracción de evidencia laboral de Lynwood para auditoría solicitada.
 * @businessRules Solo SELECT; no inferir contrataciones de fechas de sincronización.
 * @dataFlow Supabase → evidencia local; sin modificaciones en base de datos.
 * @notes No imprime credenciales ni datos de contacto. Conserva IDs para trazabilidad.
 */
require('dotenv').config({path: '.env.local', quiet:true});
const {createClient}=require('@supabase/supabase-js');
const fs=require('node:fs');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const dir='reports/lynwood-personnel-audit-2026-09-25';
fs.mkdirSync(dir,{recursive:true});
const save=(name,x)=>fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify(x,null,2));
async function all(table,columns='*',filter=q=>q,order='id'){
 const out=[];for(let start=0;;start+=1000){let q=filter(db.from(table).select(columns));if(order)q=q.order(order);const {data,error}=await q.range(start,start+999);if(error)throw new Error(`${table}: ${error.message}`);out.push(...data);if(data.length<1000)return out;}
}
async function main(){
 if(process.argv.includes('--verify-counts'))return verifyCounts();
 if(process.argv.includes('--controls'))return controls();
 if(process.argv.includes('--ronos'))return ronos();
 if(process.argv.includes('--supplement'))return supplement();
 if(process.argv.includes('--extract'))return extract();
 const stores=await all('stores','id,name,external_id');save('stores',stores);console.log('STORES',stores);
 const emps=await all('toast_employees','id,toast_guid,v2_toast_guid,first_name,last_name,deleted,store_ids',q=>q.or('first_name.ilike.%carlos%,first_name.ilike.%enrique%,first_name.ilike.%alexander%,first_name.ilike.%joseph%'));save('target-candidates',emps);console.log('EMPLOYEES',emps);
 for(const table of ['punches','shifts','sales_daily_cache','toast_employees','toast_jobs','ronos_punches','ronos_employees','ronos_work_weeks','ronos_payroll_cache','audit_logs','schedules']){
  const {data,error}=await db.from(table).select('*').limit(1);console.log('SCHEMA',table,error?.message||Object.keys(data?.[0]||{}));
 }
}
async function verifyCounts(){
 const sid='80a1ec95-bc73-402e-8884-e5abbe9343e6',checks=[];
 for(const [table,file,datecol] of [['punches','punches','business_date'],['shifts','shifts','shift_date'],['sales_daily_cache','sales','business_date']]){const {count,error}=await db.from(table).select('*',{count:'exact',head:true}).eq('store_id',sid).lte(datecol,'2026-09-24');if(error)throw error;const local=readExisting(file).length;checks.push({table,remote:count,local,match:count===local});if(count!==local)throw new Error(`Conteo cambió ${table}: ${count} vs ${local}`);}
 save('count-validation',{at:new Date().toISOString(),checks,status:'PASS'});console.log('REMOTE COUNTS PASS',checks);
 const {data,error}=await db.from('users').select('id,full_name,role,store_id,toast_guid').eq('id',25);if(error)throw error;save('manager-system-identity',data);console.log('MANAGER',data);
}
async function controls(){
 for(const table of ['weekly_budgets','sales_projections_cache','users','ronos_auth_cache']){const {data,error}=await db.from(table).select('*').limit(1);console.log('SCHEMA',table,error?.message||Object.keys(data?.[0]||{}));}
 const sid='80a1ec95-bc73-402e-8884-e5abbe9343e6';
 for(const [file,table,datecol] of [['budgets','weekly_budgets','week_start'],['projections','sales_projections_cache','business_date']]){try{const data=await all(table,'*',q=>q.eq('store_id',sid).gte(datecol,'2026-05-18').lte(datecol,'2026-09-20'),datecol);save(file,data);console.log(file,data.length);}catch(e){console.log(e.message);}}
 const {count,error}=await db.from('activity_logs').select('id',{count:'exact',head:true});console.log('ACTIVITY COUNT',count,error?.message);save('control-discovery',{activityCount:count,managerActivity:readExisting('manager-activity').length});
}
function readExisting(n){return JSON.parse(fs.readFileSync(`${dir}/${n}.json`));}
async function ronos(){
 const result=await Promise.allSettled([
  ['ronos-cards','ronos_employee_timecards_cache','company_id,week_id,employee_user_id,employee_id,first_name,last_name,full_name,job_title,department_name,total_weekly_hours,regular_hours,overtime_hours,double_time_hours,meal_penalty_count,broken_hours,active,updated_at,vacation_hours,sick_hours,holiday_hours,bereavement_hours,unpaid_leave_hours,ronos_assignment_id',q=>q.eq('company_id',34).order('employee_user_id'),'week_id'],
  ['ronos-weeks','ronos_work_weeks','week_id,company_id,start_date,end_date',q=>q.eq('company_id',34),'week_id'],
  ['ronos-mappings','ronos_employee_mappings','id,ronos_employee_user_id,ronos_employee_id,ronos_company_id,ronos_full_name,ronos_job_title,toast_employee_id,toast_guid,toast_full_name,mapping_type,is_confirmed',q=>q.eq('ronos_company_id',34),'id'],
  ['manager-activity','activity_logs','id,user_id,action,entity_type,entity_id,old_values,new_values,created_at',q=>q.eq('user_id',25),'id']
 ].map(async([file,table,cols,filter,order])=>{const data=await all(table,cols,filter,order);save(file,data);console.log(file,data.length);return {file,count:data.length};}));
 for(const r of result)if(r.status==='rejected')console.error(r.reason.message);
}
async function supplement(){
 const employees=await all('toast_employees','id,toast_guid,v2_toast_guid,first_name,last_name,deleted,created_date,deleted_date,wage_data,job_references,store_ids');
 const sid='80a1ec95-bc73-402e-8884-e5abbe9343e6';
 const punches=JSON.parse(fs.readFileSync(`${dir}/punches.json`));const used=new Set(punches.map(p=>p.employee_toast_guid));
 const scoped=employees.filter(e=>used.has(e.toast_guid)||used.has(e.v2_toast_guid)||JSON.stringify(e.store_ids).includes(sid));save('employees',scoped);console.log('EMPLOYEES',scoped.length);
 for(const table of ['ronos_employee_timecards_cache','ronos_employee_mappings','activity_logs','audit_log','shift_history','employee_history','employee_availability','time_off_requests','schedule_history']){
  const {data,error}=await db.from(table).select('*').limit(1);console.log('SCHEMA',table,error?.message||Object.keys(data?.[0]||{}));
 }
}
async function extract(){
 const sid='80a1ec95-bc73-402e-8884-e5abbe9343e6';
 const tasks=[
 ['employees','toast_employees','id,toast_guid,v2_toast_guid,first_name,last_name,deleted,created_date,deleted_date,wage_data,job_references,store_ids',q=>q.filter('store_ids','cs',JSON.stringify([sid])),'id'],
 ['jobs','toast_jobs','id,guid,title,deleted',q=>q,'id'],
 ['punches','punches','*',q=>q.eq('store_id',sid).lte('business_date','2026-09-24'),'toast_id'],
 ['shifts','shifts','*',q=>q.eq('store_id',sid).lte('shift_date','2026-09-24'),'id'],
 ['sales','sales_daily_cache','*',q=>q.eq('store_id',sid).lte('business_date','2026-09-24'),'id'],
 ['manager-schedules','schedules','*',q=>q.eq('store_id',14).eq('user_id',25).lte('date','2026-09-24'),'id']
 ];
 const results=await Promise.allSettled(tasks.map(async([file,table,cols,filter,order])=>{const rows=await all(table,cols,filter,order);save(file,rows);console.log('EXTRACTED',file,rows.length);return {file,rows:rows.length};}));
 save('extraction-manifest',{at:new Date().toISOString(),results:results.map(r=>r.status==='fulfilled'?r.value:{error:r.reason.message})});
 for(const r of results)if(r.status==='rejected')console.error(r.reason.message);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

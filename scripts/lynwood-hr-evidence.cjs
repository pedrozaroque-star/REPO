/**
 * @module lynwood-hr-evidence
 * @description Consulta historial de empleo y recibos pertinentes en Simplify HR.
 * @businessRules Autenticación y endpoints de lectura; whitelist excluye SSN, cuentas, domicilios y contactos.
 * @dataFlow Simplify HR → cinco perfiles laborales y recibos de Joseph → evidencia local.
 * @notes No ejecuta sincronizaciones ni cambios de empleo, nómina o tarifas.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const fs=require('node:fs'),dir='reports/lynwood-personnel-audit-2026-09-25';
const save=(n,x)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(x,null,2));
const pick=(obj,fields)=>Object.fromEntries(fields.filter(k=>obj[k]!==undefined).map(k=>[k,obj[k]]));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
async function main(){
 if(!process.env.SIMPLIFYHR_USER||!process.env.SIMPLIFYHR_PASS)throw new Error('Credenciales Simplify HR no configuradas');
 const base='https://prod.simplifyhros.com',siteId='657a2e35555bf12601f56284';
 const auth=await fetch(base+'/user/signIn',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.simplifyhros.com',Referer:'https://www.simplifyhros.com/'},body:JSON.stringify({emailAddress:process.env.SIMPLIFYHR_USER,password:process.env.SIMPLIFYHR_PASS}),signal:AbortSignal.timeout(20000)});if(!auth.ok)throw new Error(`HR auth HTTP ${auth.status}`);let token=(await auth.json()).IdToken;if(!token)throw new Error('HR token ausente');
 async function get(endpoint,method='GET',body){let res=await fetch(base+'/'+endpoint,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:'https://www.simplifyhros.com',Referer:'https://www.simplifyhros.com/'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});if(!res.ok)throw new Error(`${endpoint.split('?')[0]} HTTP ${res.status}`);return res.json();}
 let candidates=[],counts=[];
 for(let active of [true,false]){let seen=new Set();for(let page=1;page<=20;page++){let data=await get('employee/getEmployeesBySiteId?siteId='+siteId,'POST',{pageNumber:page,pageSize:100,active});let list=data.employeeModel;if(!Array.isArray(list))throw new Error('HR lista no reconocida');for(let e of list){if(seen.has(e.id))throw new Error('HR página repetida');seen.add(e.id);let name=norm(`${e.firstName||''} ${e.lastName||''}`);if(['carlos velazquez','enrique navarrete','alexander suarez','alexander villarreal','joseph castellanos'].includes(name))candidates.push(pick(e,['id','userId','firstName','lastName','assignmentId','employeeID']));}if(seen.size>=data.totalEmployees||!list.length){counts.push({active,expected:data.totalEmployees,retrieved:seen.size});break;}}}
 save('hr-candidates',{counts,candidates});console.log('HR TARGETS',candidates);
 const profiles=[];for(let e of candidates){let raw=await get(`employee/getEmployeeById/${e.id}?id=${e.id}`);let out=pick(raw,['id','userId','employeeID','assignmentId','firstName','lastName','status','employmentStatus','jobPosition','title','siteId','departmentId','payRate','payType','paySchedule','otPayRate','hireDate','createdDate','modifiedDate','createdBy','isRonosSynced']);
 out.jobHistory=(raw.jobHistory||[]).map(x=>pick(x,['effectiveDate','jobPosition','title','employmentStatus','siteId','siteName','departmentName','comment','createdByUserEmail','createdDate']));out.compensationHistory=(raw.compensationHistory||[]).map(x=>pick(x,['effectiveDate','payRate','paySchedule','payType','otPayRate','createdByUserEmail','createdDate','comment','status','changeReason','approverEmail','approverComment']));profiles.push(out);console.log('HR PROFILE',e.firstName,e.lastName,'hire',out.hireDate,'jobs',out.jobHistory.length,'comp',out.compensationHistory.length);}
 save('hr-profiles',profiles);
 const j=profiles.find(x=>norm(`${x.firstName} ${x.lastName}`)==='joseph castellanos');if(!j?.userId)throw new Error('HR Joseph userId no localizado');
 let stubs=[],seen=new Set(),pages=[];for(let page=1;page<=20;page++){let result=await get(`payroll/paystubs?siteId=${siteId}&userId=${encodeURIComponent(j.userId)}&page=${page}&limit=100`);let list=Array.isArray(result)?result:result.paystubs;if(!Array.isArray(list))throw new Error('HR recibos formato no reconocido');for(let s of list){if(seen.has(s.id))throw new Error('HR recibos página repetida');seen.add(s.id);if(s.userId!==j.userId&&s.assignmentId!==j.assignmentId)continue;if(s.siteId&&s.siteId!==siteId)continue;let start=String(s.payPeriodStart||s.periodStart||'').slice(0,10),end=String(s.payPeriodEnd||s.periodEnd||'').slice(0,10);if(start>'2026-09-24'||end<'2026-07-20')continue;stubs.push(pick(s,['id','userId','assignmentId','siteId','employeeName','firstName','lastName','employeeNumber','invoiceId','batchId','payPeriodStart','payPeriodEnd','periodStart','periodEnd','checkDate','status','grossWages','earnings']));}pages.push({page,count:list.length,total:result.total,totalPages:result.totalPages});if(Array.isArray(result)||page>=result.totalPages||list.length<100)break;}
 save('hr-joseph-paystubs',{userId:j.userId,assignmentId:j.assignmentId,pages,stubs});console.log('HR PAYSTUBS',stubs.length,stubs.map(x=>({id:x.id,start:x.payPeriodStart||x.periodStart,end:x.payPeriodEnd||x.periodEnd,status:x.status,gross:x.grossWages,keys:Object.keys(x)})));
 save('hr-manifest',{status:'COMPLETED',queriedAt:new Date().toISOString(),profiles:profiles.length,stubs:stubs.length,counts,pages});
}
main().catch(e=>{save('hr-manifest',{status:'INCOMPLETE',error:e.message,at:new Date().toISOString()});console.error(e.message);process.exitCode=1;});

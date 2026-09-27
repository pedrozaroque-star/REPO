/**
 * @module lynwood-live-evidence
 * @description Corrobora en RONOS las tarjetas de Joseph mediante endpoints de consulta.
 * @businessRules Solo autenticación y ManagerGetUserWeekByWeekId; sin escrituras ni sincronizaciones.
 * @dataFlow Credenciales locales → RONOS → evidencia local sin fotografías ni contactos.
 * @notes POST es el transporte de lectura de RONOS; no modifica tarjetas ni DB.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const fs=require('node:fs');
const dir='reports/lynwood-personnel-audit-2026-09-25';
const read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const save=(n,x)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(x,null,2));
function sanitize(x){if(Array.isArray(x))return x.map(sanitize);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>!/(photo|image|email|phone|password|token|address|pin$|ssn|birth|socialsecurity)/i.test(k)).map(([k,v])=>[k,sanitize(v)]));return x;}
async function main(){
 if(!process.env.RONOS_USER||!process.env.RONOS_PASS)throw new Error('Credenciales RONOS no configuradas');
 const body=new URLSearchParams({grant_type:'password',username:process.env.RONOS_USER,password:process.env.RONOS_PASS,reCaptcha:'undefined',role:'3',company:'34'});
 const login=await fetch('https://ronos.com/Token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)});if(!login.ok)throw new Error(`RONOS auth HTTP ${login.status}`);const auth=await login.json();if(!auth.access_token)throw new Error('RONOS token ausente');
 if(process.argv.includes('--identity')){console.log('AUTH FIELD NAMES',Object.keys(auth));const identity=Object.fromEntries(Object.entries(auth).filter(([k])=>/^(userId|id|firstName|lastName|fullName|name|role|companyId|user_id)$/i.test(k)));save('ronos-auth-identity',identity);console.log('IDENTITY',identity);return;}
 if(process.argv.includes('--prehire')){let week=read('ronos-weeks').find(w=>w.start_date.slice(0,10)==='2026-07-13');let res=await fetch('https://ronos.com/api/v2.0/WorkWeek/ManagerGetUserWeekByWeekId',{method:'POST',headers:{Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({userId:37548,weekId:week.week_id}),signal:AbortSignal.timeout(25000)});if(!res.ok)throw new Error(`RONOS prehire HTTP ${res.status}`);let data=sanitize(await res.json());save('ronos-joseph-prehire',{weekId:week.week_id,employeeUserId:37548,data});console.log('PREHIRE',data.startDate,data.totalWeeklyHour);return;}
 if(process.argv.includes('--coverage')){
  const requests=[['Irving Saca','2026-08-19'],['Cruz Victorino Castillo','2026-08-19'],['Jose Andres Morales','2026-09-08'],['Fernando Lacayo Cisne','2026-09-13'],['Eliuth Alvarez','2026-09-13']];const weeks=read('ronos-weeks'),cards=read('ronos-cards'),rows=[];
  for(let [name,date] of requests){let week=weeks.find(w=>w.start_date.slice(0,10)<=date&&w.end_date.slice(0,10)>=date);let card=cards.find(c=>c.full_name.toLowerCase()===name.toLowerCase()&&c.week_id===week?.week_id);if(!card){rows.push({name,date,status:'Sin coincidencia exacta en cache'});continue;}
   let res=await fetch('https://ronos.com/api/v2.0/WorkWeek/ManagerGetUserWeekByWeekId',{method:'POST',headers:{Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({userId:card.employee_user_id,weekId:card.week_id}),signal:AbortSignal.timeout(25000)});if(!res.ok)throw new Error(`RONOS cobertura HTTP ${res.status}`);let data=await res.json(),day=data.workDays?.find(d=>d.startTime?.slice(0,10)===date);rows.push({name,date,userId:card.employee_user_id,weekId:card.week_id,totalHours:day?.totalHours??null,punches:day?.punches?.length??null,status:day?'Consultado':'Sin día'});
  }save('coverage-live',rows);console.log(rows);return;
 }
 const cards=read('ronos-cards').filter(c=>c.full_name==='Joseph Castellanos'&&c.total_weekly_hours>0);const results=[];
 for(const c of cards){const res=await fetch('https://ronos.com/api/v2.0/WorkWeek/ManagerGetUserWeekByWeekId',{method:'POST',headers:{Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({userId:c.employee_user_id,weekId:c.week_id}),signal:AbortSignal.timeout(25000)});if(!res.ok)throw new Error(`RONOS read ${c.week_id} HTTP ${res.status}`);const raw=await res.json();const clean=sanitize(raw);results.push({weekId:c.week_id,employeeUserId:c.employee_user_id,data:clean});console.log('LIVE',c.week_id,'days',raw.workDays?.length,'keys',Object.keys(raw).join(','));if(results.length===1){console.log('DAY KEYS',Object.keys(raw.workDays?.[0]||{}));console.log('PUNCH KEYS',Object.keys(raw.workDays?.flatMap(x=>x.punches||[])[0]||{}));}save('ronos-joseph-live',results);}
 save('ronos-live-manifest',{queriedAt:new Date().toISOString(),cards:results.length,endpoint:'WorkWeek/ManagerGetUserWeekByWeekId',mutations:0});
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

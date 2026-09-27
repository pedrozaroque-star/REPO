/**
 * @module scripts/probe-lynwood-close-window
 * @description Consulta de solo lectura de horas de ventas Toast alrededor del cierre Lynwood del 22 de septiembre.
 * @businessRules El sobrante es físico al cierre de tienda; una hora de guardado no prueba hora del conteo.
 * @dataFlow Toast ordersBulk → distribución horaria agregada sin datos de clientes.
 * @notes Solo imprime totales y ejemplos de nombres de campos temporales.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const assert=require('node:assert/strict');
const host=process.env.TOAST_API_HOST||'https://ws-api.toasttab.com';
const ext='80a1ec95-bc73-402e-8884-e5abbe9343e6';
async function main(){
  const login=await fetch(host+'/authentication/v1/authentication/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:process.env.TOAST_CLIENT_ID,clientSecret:process.env.TOAST_CLIENT_SECRET,userAccessType:'TOAST_MACHINE_CLIENT'})});
  if(!login.ok)throw new Error('Toast login '+login.status);
  const token=(await login.json()).token.accessToken;
  const boundary=new Date('2026-09-23T05:36:00Z'); // 22 Sep 22:36 Los Angeles.
  const close=new Date('2026-09-23T08:00:00Z'); // 23 Sep 01:00 Los Angeles, configured close.
  const hourly={};let orders=0,afterSave=0,afterClose=0,noTimestamp=0;
  for(let page=1;page<=40;page++){
    const res=await fetch(host+'/orders/v2/ordersBulk?businessDate=20260922&pageSize=100&page='+page,{headers:{Authorization:'Bearer '+token,'Toast-Restaurant-External-ID':ext}});
    if(!res.ok)throw new Error('Toast ordersBulk '+res.status+' page '+page);
    const batch=await res.json();assert(Array.isArray(batch));
    for(const o of batch){
      if(o.voided)continue;orders++;
      const value=o.closedDate||o.paidDate||o.modifiedDate;
      if(!value){noTimestamp++;continue;}
      const d=new Date(value);if(!Number.isFinite(d.getTime())){noTimestamp++;continue;}
      const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).format(d);
      hourly[local]=(hourly[local]||0)+1;
      if(d>boundary&&d<=close)afterSave++;
      if(d>close)afterClose++;
    }
    if(batch.length<100){console.log(JSON.stringify({orders,afterSaveBeforeConfiguredClose:afterSave,afterConfiguredClose:afterClose,noTimestamp,hourly,field:'closedDate||paidDate||modifiedDate',warning:'La hora de creación del conteo no demuestra cuándo se contó físicamente.'}));return;}
  }
  throw new Error('Pagination exceeded 40 pages');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

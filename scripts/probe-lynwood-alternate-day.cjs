/**
 * @module scripts/probe-lynwood-alternate-day
 * @description Diagnóstico de solo lectura del 21 de septiembre de Lynwood, con conteos de cierre y tickets reales.
 * @businessRules Un pedido enviado no acredita recepción; una unidad comprada se convierte antes de compararla con recetas.
 * @dataFlow Supabase inventory_counts/inventory_orders + Toast ordersBulk → resumen de cobertura y consumo proxy.
 * @notes No escribe datos ni imprime tickets individuales, personas o credenciales.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const ext='80a1ec95-bc73-402e-8884-e5abbe9343e6';
async function all(fn){const out=[];for(let start=0;;start+=500){const {data,error}=await fn().range(start,start+499);if(error)throw error;out.push(...data);if(data.length<500)return out;}}
function loc(t){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'short',timeStyle:'short'}).format(new Date(t));}
async function main(){
  const dates=['2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24'];
  const counts=await all(()=>db.from('inventory_counts').select('inventory_item_id,count_date,quantity_on_hand,created_at').eq('store_id','14').in('count_date',dates).order('inventory_item_id'));
  const orders=await all(()=>db.from('inventory_orders').select('id,order_date,status,order_type,inventory_order_lines(inventory_item_id,final_qty,leftover_value)').eq('store_id',14).eq('order_type','daily').in('order_date',dates).order('order_date'));
  const items=await all(()=>db.from('inventory_items').select('id,name,unit_type,quantity_per_unit').in('id',['fab9d589-8ae8-4381-87da-85f836068996','90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb','ea165e4e-d939-49a8-af9a-7bc186f50e2e','a639ad41-81bf-4de6-8dbc-0291005654ad','6c0a3378-8309-48c9-a438-15313cabd9d8','085ecb0d-c711-4134-ae1a-f7630a22759c']).order('name'));
  console.log(JSON.stringify({countCoverage:Object.fromEntries(dates.map(d=>[d,counts.filter(c=>c.count_date===d).length])),orders:orders.map(o=>({date:o.order_date,status:o.status,lines:o.inventory_order_lines?.length})),countCreatedLocal:Object.fromEntries(dates.map(d=>[d,[...new Set(counts.filter(c=>c.count_date===d).map(c=>loc(c.created_at)))].slice(0,8)]))}));
  for(const item of items){
    const observed=dates.map(d=>counts.find(c=>c.inventory_item_id===item.id&&c.count_date===d));
    const priorLine=orders.find(o=>o.order_date==='2026-09-20')?.inventory_order_lines?.find(l=>l.inventory_item_id===item.id);
    const c20=counts.find(c=>c.inventory_item_id===item.id&&c.count_date==='2026-09-20');
    const c21=counts.find(c=>c.inventory_item_id===item.id&&c.count_date==='2026-09-21');
    const proxy=c20&&c21&&priorLine?Number(c20.quantity_on_hand)+Number(priorLine.final_qty)-Number(c21.quantity_on_hand):null;
    console.log(JSON.stringify({item:item.name,unit:item.unit_type,perPack:item.quantity_per_unit,counts:observed.map(c=>c?.quantity_on_hand??null),count20RecordedAt:c20?loc(c20.created_at):null,count21RecordedAt:c21?loc(c21.created_at):null,order20:priorLine?.final_qty??null,proxy21OnlyIfReceivedInFull:proxy,baseUnits:proxy===null?null:proxy*Number(item.quantity_per_unit)}));
  }
  const host=process.env.TOAST_API_HOST||'https://ws-api.toasttab.com';
  const auth=await fetch(host+'/authentication/v1/authentication/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:process.env.TOAST_CLIENT_ID,clientSecret:process.env.TOAST_CLIENT_SECRET,userAccessType:'TOAST_MACHINE_CLIENT'})});
  if(!auth.ok)throw new Error('Toast auth '+auth.status);const token=(await auth.json()).token.accessToken;
  const hourly={};let tickets=0,unknown=0,afterCount24=0,afterConfiguredClose=0,afterCount23=0,openedAfterCount24=0,paidAfterCount24=0,closedAfterCount24=0;
  const count24Time=new Date(counts.filter(c=>c.count_date==='2026-09-21').map(c=>c.created_at).sort()[0]);
  const count23Time=new Date(counts.filter(c=>c.count_date==='2026-09-20').map(c=>c.created_at).sort()[0]);
  const configuredClose=new Date('2026-09-22T08:00:00Z');
  for(let page=1;page<25;page++){
    let res;
    for(let attempt=0;attempt<4;attempt++){
      res=await fetch(host+`/orders/v2/ordersBulk?businessDate=20260921&pageSize=100&page=${page}`,{headers:{Authorization:'Bearer '+token,'Toast-Restaurant-External-ID':ext}});
      if(res.status!==429)break;
      await new Promise(resolve=>setTimeout(resolve,Math.min(12000,2000*2**attempt)));
    }
    if(!res.ok)throw new Error('Toast orders '+res.status);const rows=await res.json();
    for(const o of rows){if(o.voided)continue;tickets++;const t=o.closedDate||o.paidDate;if(!t){unknown++;continue;}const d=new Date(t);const key=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).format(d);hourly[key]=(hourly[key]||0)+1;if(d>count24Time)afterCount24++;if(d>configuredClose)afterConfiguredClose++;if(d<=count23Time)afterCount23++;if(o.openedDate&&new Date(o.openedDate)>count24Time)openedAfterCount24++;if(o.paidDate&&new Date(o.paidDate)>count24Time)paidAfterCount24++;if(o.closedDate&&new Date(o.closedDate)>count24Time)closedAfterCount24++;}
    if(rows.length<100)break;
  }
  console.log(JSON.stringify({toastBusinessDate:'2026-09-21',tickets,unknownCloseOrPaid:unknown,count20CreatedLocal:loc(count23Time),count21CreatedLocal:loc(count24Time),closedOrPaidAfterCount21:afterCount24,openedAfterCount21:openedAfterCount24,paidAfterCount21:paidAfterCount24,closedAfterCount21:closedAfterCount24,afterConfiguredClose,atOrBeforeCount20:afterCount23,hourly}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

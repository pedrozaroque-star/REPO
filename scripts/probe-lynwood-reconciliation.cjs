/**
 * @module scripts/probe-lynwood-reconciliation
 * @description Diagnóstico de solo lectura para conciliación real de Lynwood el 22 de septiembre.
 * @businessRules Pedido no equivale a recepción; faltante no equivale a cero. No modifica Supabase.
 * @dataFlow Supabase stores/counts/orders/usage → evidencia agregada en consola.
 * @notes No imprime credenciales ni información personal. Consultas paginadas y errores explícitos.
 */
require('dotenv').config({path: '.env.local', quiet: true});
const {createClient} = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
async function all(query) {
  const rows=[];
  for(let start=0;;start+=500){
    const {data,error}=await query().range(start,start+499);
    if(error) throw new Error(error.message);
    rows.push(...data); if(data.length<500) return rows;
  }
}
async function main(){
  const stores=await all(()=>db.from('stores').select('id,name,external_id,opening_time,closing_time,weekly_hours').ilike('name','%lynwood%').order('id'));
  if(stores.length!==1) throw new Error('Lynwood no es único');
  const store=stores[0]; console.log(JSON.stringify({store}));
  const items=await all(()=>db.from('inventory_items').select('id,name,unit_type,quantity_per_unit,yield_percent').or('name.ilike.%carne asada%,name.ilike.%horchata%,name.ilike.%mixta%,name.ilike.%onion%,name.ilike.%cil%,name.ilike.%salsa roja%,name.ilike.%salsa verde%,name.ilike.%lima%,name.ilike.%rajas%').order('id'));
  const ids=items.map(r=>r.id);
  const counts=await all(()=>db.from('inventory_counts').select('inventory_item_id,count_date,quantity_on_hand,created_at').eq('store_id',store.id).in('inventory_item_id',ids).gte('count_date','2026-09-21').lte('count_date','2026-09-22').order('id'));
  const orders=await all(()=>db.from('inventory_orders').select('id,order_date,status,inventory_order_lines(inventory_item_id,final_qty,par_value,leftover_value)').eq('store_id',store.id).eq('order_type','daily').gte('order_date','2026-09-21').lte('order_date','2026-09-22').order('id'));
  const assert=require('node:assert/strict');
  for(const item of items){
    const itemCounts=counts.filter(r=>r.inventory_item_id===item.id);
    const itemOrders=orders.flatMap(o=>(o.inventory_order_lines||[]).filter(l=>l.inventory_item_id===item.id).map(l=>({date:o.order_date,status:o.status,...l})));
    console.log(JSON.stringify({item,counts:itemCounts,orders:itemOrders}));
    const prev=itemCounts.filter(r=>r.count_date==='2026-09-21');
    const current=itemCounts.filter(r=>r.count_date==='2026-09-22');
    const prevOrders=itemOrders.filter(r=>r.date==='2026-09-21');
    if(prev.length===1&&current.length===1&&prevOrders.length===1&&[prev[0].quantity_on_hand,current[0].quantity_on_hand,prevOrders[0].final_qty].every(v=>v!==null)){
      const proxy=Number(prev[0].quantity_on_hand)+Number(prevOrders[0].final_qty)-Number(current[0].quantity_on_hand);
      assert(Number.isFinite(proxy));
      console.log(JSON.stringify({item:item.name,UNVERIFIED_order_based_proxy:proxy,baseUnits:proxy*Number(item.quantity_per_unit),warning:'Supone recepción íntegra al día siguiente y unidades de empaque; NO consumo real verificado.',localCountTimes:itemCounts.map(c=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'short',timeStyle:'short'}).format(new Date(c.created_at)))}));
    }
  }
  const report=require('../reports/simulation-real-tickets-multistore.json').find(r=>r.storeId===store.id&&r.businessDate==='2026-09-22');
  assert(report&&report.totalTickets===763);
  assert(Number.isFinite(report.meatConsumption.rawLbs.asada));
  console.log(JSON.stringify({simulationTickets:report.totalTickets,reportedAsadaRawLbs:report.meatConsumption.rawLbs.asada,runtimeEvidenceChecks:'passed; not certification of consumption accuracy'}));
  for(const table of ['inventory_orders','inventory_counts','inventory_usage_log','inventory_par_ideal']){
    try{
      const dateCol=table==='inventory_orders'?'order_date':table==='inventory_counts'?'count_date':'business_date';
      const storeId=table==='inventory_usage_log'?store.external_id:store.id;
      const rows=await all(()=>{
        let query=db.from(table).select('*').eq('store_id',storeId);
        if(table!=='inventory_par_ideal') query=query.gte(dateCol,'2026-09-20').lte(dateCol,'2026-09-24');
        return query.order(table==='inventory_par_ideal'?'id':dateCol);
      });
      const groups={};for(const r of rows){const k=String(r[dateCol]||'par');groups[k]=(groups[k]||0)+1;}
      console.log(JSON.stringify({table,count:rows.length,dates:groups,columns:Object.keys(rows[0]||{})}));
      if(table==='inventory_orders'){
        for(const r of rows)console.log(JSON.stringify({order:{id:r.id,date:r.order_date,status:r.status,type:r.order_type}}));
        const ids=rows.map(r=>r.id);
        if(ids.length){
          const lines=await all(()=>db.from('inventory_order_lines').select('*').in('order_id',ids).order('id'));
          console.log(JSON.stringify({table:'inventory_order_lines',count:lines.length,columns:Object.keys(lines[0]||{}),leftoverFilled:lines.filter(r=>r.leftover_value!==null).length}));
        }
      }
      if(!rows.length && table!=='inventory_par_ideal'){
        const {data,error}=await db.from(table).select(dateCol).eq('store_id',storeId).order(dateCol,{ascending:false}).limit(5);
        console.log(JSON.stringify({table,latestDates:data,error:error?.message}));
      }
    }catch(e){console.log(JSON.stringify({table,error:e.message}));}
  }
  const res=await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/',{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY}});
  if(res.ok){const schema=await res.json();console.log(JSON.stringify({relevantTables:Object.keys(schema.paths||{}).filter(t=>/invent|receiv|recep|waste|merma|transfer|viele/i.test(t))}));}
  else console.log(JSON.stringify({schemaStatus:res.status}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

/**
 * @module scripts/audit-lynwood-mixta-physical
 * @description Calcula consumo observado de mixta, salsas, lima y rajas, empaquetadas y a granel, desde conteos y entregas QB de Lynwood.
 * @businessRules Solo días consecutivos; entrega completa confirmada por operación; cada SKU conserva su unidad.
 * @dataFlow inventory_counts + inventory_orders/lines + inventory_items → serie diaria de cajas y bolsas.
 * @notes Solo lectura. Días sin conteo o pedido enviado se señalan, nunca se rellenan ni prorratean.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const skus=[{id:'90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb',label:'1 oz Bolsa de Mixta',perCase:190,unit:'bolsitas'},
  {id:'ea165e4e-d939-49a8-af9a-7bc186f50e2e',label:'Onion/ Cil. Mix 1/4',perCase:5,unit:'lb'},
  {id:'a639ad41-81bf-4de6-8dbc-0291005654ad',label:'1.5 oz Salsa Roja Pack',perCase:400,unit:'sobres'},
  {id:'6c0a3378-8309-48c9-a438-15313cabd9d8',label:'1.5 oz Salsa Verde Pack',perCase:400,unit:'sobres'},
  {id:'aa8d2711-fbd7-45b7-9223-52a2722ffd0e',label:'Salsa Roja',perCase:1,unit:'galones'},
  {id:'68a502a5-7e28-4b63-a830-47b9acb91bdf',label:'Salsa Verde',perCase:1,unit:'galones'},
  {id:'f73fe7a6-105c-4624-a87b-07d5f78c09ea',label:'Lima Bolsita',perCase:210,unit:'bolsitas'},
  {id:'0c1f780a-1166-44fd-aa51-879173fa0861',label:'Bolsa Lima 5 LB',perCase:5,unit:'lb'},
  {id:'b4e7349c-669a-42e6-9810-ec3a7673b3f2',label:'2 oz Bolsas de Rajas con Zanahoria',perCase:165,unit:'bolsitas'},
  {id:'d56d8df8-d30c-4964-a425-9aa25d962364',label:'Rajas y Zanahorias',perCase:6,unit:'lb'}];
async function pages(fn){const result=[];for(let n=0;;n+=500){const {data,error}=await fn().range(n,n+499);if(error)throw error;result.push(...data);if(data.length<500)return result;}}
function plusDay(day){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
async function main(){
  const start='2026-08-24',end='2026-09-24';
  const counts=await pages(()=>db.from('inventory_counts').select('inventory_item_id,count_date,quantity_on_hand,created_at').eq('store_id','14').in('inventory_item_id',skus.map(x=>x.id)).gte('count_date',start).lte('count_date',end).order('count_date'));
  const orders=await pages(()=>db.from('inventory_orders').select('id,order_date,status,order_type,inventory_order_lines(inventory_item_id,final_qty)').eq('store_id',14).eq('order_type','daily').gte('order_date',start).lte('order_date',end).order('order_date'));
  const ordersByDate=new Map(orders.map(o=>[o.order_date,o]));
  const countsByKey=new Map(counts.map(c=>[c.count_date+':'+c.inventory_item_id,c]));
  const results=[];let included=0;
  for(let day=start;day<end;day=plusDay(day)){
    const next=plusDay(day),order=ordersByDate.get(day);
    // El usuario excluyó explícitamente el día 22 del piloto: no usarlo como fecha de consumo ni como conteo inicial.
    if(day==='2026-09-22'||next==='2026-09-22')continue;
    for(const sku of skus){
      const prior=countsByKey.get(day+':'+sku.id),later=countsByKey.get(next+':'+sku.id);
      const line=order?.inventory_order_lines?.find(l=>l.inventory_item_id===sku.id);
      const evidence=prior&&later&&order?.status==='sent'&&line?.final_qty!==null&&line?.final_qty!==undefined;
      const delivered=evidence?Number(line.final_qty):null;
      const used=evidence?Number(prior.quantity_on_hand)+delivered-Number(later.quantity_on_hand):null;
      if(used!==null){assert(Number.isFinite(used));included++;}
      results.push({date:next,sku:sku.label,startStock:prior?.quantity_on_hand??null,received:delivered,endStock:later?.quantity_on_hand??null,usedPackages:used,usedBaseUnits:used===null?null:used*sku.perCase,baseUnit:sku.unit,status:!prior||!later?'missing_count':!order?'missing_order':order.status!=='sent'?'order_not_sent':!line?'missing_order_line':used<0?'negative_balance':'observed'});
    }
  }
  const grouped={};for(const sku of skus){const valid=results.filter(r=>r.sku===sku.label&&r.status==='observed');grouped[sku.label]={consecutiveCountDays:valid.length,totalUsedPackages:valid.reduce((s,r)=>s+r.usedPackages,0),totalBaseUnits:valid.reduce((s,r)=>s+r.usedBaseUnits,0),baseUnit:sku.unit};}
  console.log(JSON.stringify({store:'Lynwood',range:[start,end],totalObservedRows:included,summary:grouped,rows:results},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

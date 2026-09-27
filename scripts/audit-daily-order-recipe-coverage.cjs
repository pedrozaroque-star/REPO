/**
 * @module scripts/audit-daily-order-recipe-coverage
 * @description Cruza todos los SKU de Orden Diaria de Lynwood con recetas Toast y consumo guardado.
 * @businessRules Solo lectura; receta no implica consumo físico ni cobertura de todas las ventas.
 * @dataFlow store_order_template → inventory_items/recipes → inventory_usage_log.
 * @notes Excluye 2026-09-22 y no escribe en Supabase.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
async function pages(fn){const out=[];for(let n=0;;n+=500){const {data,error}=await fn().range(n,n+499);if(error)throw error;out.push(...data);if(data.length<500)return out;}}
function businessDate(iso){const d=new Date(new Date(iso).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}));d.setHours(d.getHours()-6);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
async function main(){
  const stores=await pages(()=>db.from('stores').select('id,name,external_id').ilike('name','%lynwood%'));
  assert.equal(stores.length,1);const store=stores[0];
  const template=await pages(()=>db.from('store_order_template').select('inventory_item_id,sort_position').eq('store_id',store.id).eq('order_type','daily').order('sort_position'));
  assert(template.length>0);const ids=template.map(x=>x.inventory_item_id);
  const items=await pages(()=>db.from('inventory_items').select('id,sku,name,unit_type,unit_measure,quantity_per_unit,yield_percent').in('id',ids));
  const recipes=await pages(()=>db.from('recipes').select('inventory_item_id,toast_menu_item_guid,quantity,unit,type').in('inventory_item_id',ids));
  const usage=await pages(()=>db.from('inventory_usage_log').select('inventory_item_id,business_date,theoretical_usage').eq('store_id',store.id).gte('business_date','2026-09-19').lte('business_date','2026-09-24'));
  const pmix=await pages(()=>db.from('pmix_daily_cache').select('business_date,items').eq('store_id',store.external_id).gte('business_date','2026-09-19').lte('business_date','2026-09-24'));
  const guids=new Set(pmix.flatMap(r=>Array.isArray(r.items)?r.items.map(x=>x.guid):[]));
  const recipeGuids=new Set(recipes.map(r=>r.toast_menu_item_guid));
  const pmixProducts=pmix.filter(r=>r.business_date!=='2026-09-22').flatMap(r=>Array.isArray(r.items)?r.items.map(x=>({date:r.business_date,guid:x.guid,name:x.name,quantity:Number(x.quantity)||0})):[]);
  const uncovered=pmixProducts.filter(x=>x.quantity>0&&!recipeGuids.has(x.guid));
  const uncoveredByName=new Map();for(const x of uncovered){const key=x.name||x.guid;uncoveredByName.set(key,(uncoveredByName.get(key)||0)+x.quantity);}
  const rows=template.map(t=>{const item=items.find(i=>i.id===t.inventory_item_id);const rr=recipes.filter(r=>r.inventory_item_id===t.inventory_item_id);return {position:t.sort_position,id:t.inventory_item_id,name:item?.name||'MISSING_ITEM',unit:item?.unit_type,unitMeasure:item?.unit_measure,perUnit:item?.quantity_per_unit,recipeRows:rr.length,distinctToastGuids:new Set(rr.map(r=>r.toast_menu_item_guid)).size,matchesCachedPmix:rr.filter(r=>guids.has(r.toast_menu_item_guid)).length,loggedDates:usage.filter(r=>r.inventory_item_id===t.inventory_item_id).map(r=>r.business_date),recipeUnits:[...new Set(rr.map(r=>r.unit))],recipeTypes:[...new Set(rr.map(r=>r.type))]};});
  const boundary=['2026-09-21T12:59:00Z','2026-09-21T13:00:00Z'].map(x=>({utc:x,businessDate:businessDate(x)}));
  assert.equal(boundary[0].businessDate,'2026-09-20');assert.equal(boundary[1].businessDate,'2026-09-21');
  assert.equal((0/0)||0,0);assert.equal(Number.isFinite(0/0),false);
  console.log(JSON.stringify({store,templateCount:template.length,inventoryItemCount:items.length,recipeRows:recipes.length,pmixDates:pmix.map(p=>p.business_date),pmixGuidCount:guids.size,pmixSoldProducts:pmixProducts.filter(x=>x.quantity>0).length,uncoveredSoldProducts:uncovered.length,uncoveredQuantity:uncovered.reduce((s,x)=>s+x.quantity,0),uncoveredTopNames:[...uncoveredByName].sort((a,b)=>b[1]-a[1]).slice(0,30),usageRows:usage.length,usageDates:[...new Set(usage.map(u=>u.business_date))],boundary,rows},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

/**
 * @module scripts/audit-daily-order-catalog
 * @description Auditoría de solo lectura del catálogo Orden Diaria por tienda.
 * @businessRules Respeta la plantilla QB específica de cada tienda; no infiere que ausencia significa producto obsoleto.
 * @dataFlow stores + store_order_template + inventory_items + quickbooks_mappings → comparaciones de catálogo.
 * @notes No modifica datos; una diferencia de nombre no implica error de mapeo por sí sola.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
async function all(build){const rows=[];for(let offset=0;;offset+=500){const {data,error}=await build().range(offset,offset+499);if(error)throw error;rows.push(...data);if(data.length<500)return rows;}}
function normalize(s){return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
async function main(){
 const [stores,templates,items,mappings]=await Promise.all([
  all(()=>db.from('stores').select('*').order('name')),
  all(()=>db.from('store_order_template').select('*').eq('order_type','daily').order('sort_position')),
  all(()=>db.from('inventory_items').select('*').order('name')),
  all(()=>db.from('quickbooks_mappings').select('*'))
 ]);
 const byId=new Map(items.map(i=>[i.id,i]));
 const active=stores.filter(s=>s.is_active!==false && s.active!==false && s.status!=='inactive');
 const storeRows=active.map(s=>{const t=templates.filter(x=>String(x.store_id)===String(s.id));return {store:s.name,id:s.id,lines:t.length,uniqueItems:new Set(t.map(x=>x.inventory_item_id)).size,duplicateItems:[...new Set(t.map(x=>x.inventory_item_id))].filter(id=>t.filter(x=>x.inventory_item_id===id).length>1).map(id=>({id,name:byId.get(id)?.name,positions:t.filter(x=>x.inventory_item_id===id).map(x=>x.sort_position)})),missingItem:t.filter(x=>!byId.has(x.inventory_item_id)).map(x=>x.inventory_item_id),missingQbId:t.filter(x=>!x.qb_item_id).length};});
 const included=new Map();for(const t of templates){if(!included.has(t.inventory_item_id))included.set(t.inventory_item_id,new Set());included.get(t.inventory_item_id).add(String(t.store_id));}
 const common=active.filter(s=>templates.some(t=>String(t.store_id)===String(s.id)));
 const allIds=[...new Set(templates.map(t=>t.inventory_item_id))];
 const itemRows=allIds.map(id=>{const item=byId.get(id);const t=templates.filter(x=>x.inventory_item_id===id);return {id,name:item?.name??null,unit_type:item?.unit_type??null,quantity_per_unit:item?.quantity_per_unit??null,unit_measure:item?.unit_measure??null,order_unit_description:item?.order_unit_description??null,excel_reference:item?.excel_reference??null,purchase_unit_cost:item?.purchase_unit_cost??null,stores:t.length,storeNames:t.map(x=>stores.find(s=>String(s.id)===String(x.store_id))?.name??String(x.store_id)),qbIds:[...new Set(t.map(x=>String(x.qb_item_id)))],qbNames:[...new Set(t.map(x=>x.qb_item_name))],mappingCount:mappings.filter(m=>m.inventory_item_id===id).length};}).sort((a,b)=>(a.name??'').localeCompare(b.name??''));
 const nameGroups=new Map();for(const x of itemRows){const key=normalize(x.name);if(!nameGroups.has(key))nameGroups.set(key,[]);nameGroups.get(key).push(x);}
 const duplicateNames=[...nameGroups.entries()].filter(([k,v])=>k&&v.length>1).map(([k,v])=>({normalized:k,items:v.map(x=>({id:x.id,name:x.name,unit_type:x.unit_type,quantity_per_unit:x.quantity_per_unit}))}));
 const anomalies=itemRows.filter(x=>!x.name||!Number.isFinite(Number(x.quantity_per_unit))||Number(x.quantity_per_unit)<=0||!x.unit_type||x.qbIds.length>1||x.qbNames.length>1||x.mappingCount===0||x.stores!==common.length);
 assert.equal(itemRows.length,new Set(itemRows.map(x=>x.id)).size);
 assert.equal(normalize('Miércoles'),normalize('Miercoles'));
 assert.equal(normalize('SÁBADO'),normalize('sabado'));
 assert(Number.isFinite(0/1));
 assert(!Number.isFinite(0/0));
 const tz=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',hour12:false});assert(tz.format(new Date('2026-09-25T12:59:00Z')).includes('05'));assert(tz.format(new Date('2026-09-25T13:00:00Z')).includes('06'));
 console.log(JSON.stringify({summary:{activeStores:active.length,storesWithDailyTemplate:common.length,templateRows:templates.length,uniqueItems:itemRows.length,duplicateNameGroups:duplicateNames.length,anomalyItems:anomalies.length},stores:storeRows,duplicateNames,anomalies,items:itemRows},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});

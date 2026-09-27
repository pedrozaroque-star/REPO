/**
 * @module scripts/probe-lynwood-rajas-order
 * @description Verifica renglones de rajas en órdenes diarias de Lynwood sin modificar datos.
 * @businessRules Un renglón ausente no equivale a cero; QB solo recibe cantidades mayores que cero.
 * @dataFlow inventory_orders + inventory_order_lines + inventory_counts → evidencia por fecha.
 * @notes No consulta ni imprime credenciales; no modifica Supabase ni QuickBooks.
 */
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const ids={bulk:'d56d8df8-d30c-4964-a425-9aa25d962364',packets:'b4e7349c-669a-42e6-9810-ec3a7673b3f2'};
async function main(){
  const {data:orders,error}=await db.from('inventory_orders').select('id,order_date,status,qb_estimate_id,qb_estimate_number,inventory_order_lines(inventory_item_id,calculated_qty,adjusted_qty,final_qty,leftover_value)').eq('store_id',14).eq('order_type','daily').gte('order_date','2026-09-19').lte('order_date','2026-09-24').order('order_date');
  if(error)throw error;
  const {data:counts,error:countError}=await db.from('inventory_counts').select('inventory_item_id,count_date,quantity_on_hand').eq('store_id','14').in('inventory_item_id',Object.values(ids)).gte('count_date','2026-09-19').lte('count_date','2026-09-24').order('count_date');
  if(countError)throw countError;
  for(const order of orders){
    const lines=order.inventory_order_lines||[];
    const selected=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,lines.find(l=>l.inventory_item_id===id)??null]));
    console.log(JSON.stringify({date:order.order_date,status:order.status,qbEstimateId:order.qb_estimate_id,qbEstimateNumber:order.qb_estimate_number,totalLines:lines.length,rajas:selected,counts:counts.filter(c=>c.count_date===order.order_date)}));
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

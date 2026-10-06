import { supabaseAdmin } from '../lib/supabase'
async function main(){const {data}=await supabaseAdmin.from('accounting_sales_packets').select('status,updated_at,stores(name)').eq('business_date','2026-10-03');for(const p of (data as any[])||[])console.log(p.stores.name,p.status,p.updated_at)}
main()

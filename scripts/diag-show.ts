import { supabaseAdmin } from '../lib/supabase'
async function main(){const {data}=await supabaseAdmin.from('accounting_sales_packets').select('status,journal_total_debits,journal_lines,stores(name)').eq('business_date','2026-10-03');for(const p of (data as any[])||[]){const n=p.stores.name;if(/Norwalk/.test(n)){console.log('==',n,p.status,p.journal_total_debits);for(const l of p.journal_lines)console.log(l.account,l.memo,l.debit||'',l.credit||'')}}}
main()



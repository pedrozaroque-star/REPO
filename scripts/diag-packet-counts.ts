import { supabaseAdmin } from '../lib/supabase'
async function main() {
  const { data } = await supabaseAdmin
    .from('accounting_sales_packets')
    .select('business_date,status,updated_at')
    .gte('business_date', '2026-09-14')
    .lte('business_date', '2026-09-27')
  const by: Record<string, { n: number; last: string }> = {}
  for (const p of data || []) {
    const b = (by[p.business_date] = by[p.business_date] || { n: 0, last: '' })
    b.n++
    if (p.updated_at > b.last) b.last = p.updated_at
  }
  console.log(by)
}
main()

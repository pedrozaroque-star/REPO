import { supabaseAdmin } from '../lib/supabase'
import fs from 'fs'
async function main(){
  const raw = fs.readFileSync(process.argv[2],'utf8'); const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}')+1))
  const date = process.argv[3]
  const { data } = await supabaseAdmin.from('accounting_sales_packets').select('status,journal_lines,stores(name)').eq('business_date', date)
  const ours: Record<string, Record<string, number>> = {}
  for (const p of (data as any[])||[]) { const n = p.stores.name.replace(/Tacos Gavilan\s*/i,'').replace(/^LA /,'').trim().toLowerCase(); const m: Record<string, number> = {}; for (const l of p.journal_lines) { const ac = l.account==='51050'?'13200':l.account; m[ac] = Math.round(((m[l.account]||0) + (Number(l.debit)||0) - (Number(l.credit)||0))*100)/100 } ours[n]=m }
  const num = (s: string) => Number((s||'0').replace(/[$,\s]/g,'')) || 0
  let ident = 0, tot = 0
  for (const [id, rows] of Object.entries<any>(j)) {
    if (!Array.isArray(rows)) { console.log(id, rows); continue }
    const m: Record<string, number> = {}; let loc = ''
    for (const r of rows) { const c = r.split('|'); if (!/^\d{5}$/.test(c[0])) continue; loc = (c[5]||'').trim(); const ac2 = c[0]==='51050'?'13200':c[0]; m[ac2] = Math.round(((m[ac2]||0) + num(c[2]) - num(c[3]))*100)/100 }
    const key = Object.keys(ours).find(k => loc.toLowerCase().includes(k) || k.includes(loc.toLowerCase().replace(/^la /,'')))
    tot++
    if (!key) { console.log('SIN MATCH', id, loc); continue }
    const o = ours[key]; const diffs: string[] = []
    for (const a of new Set([...Object.keys(m), ...Object.keys(o)])) { const d = Math.round(((o[a]||0) - (m[a]||0))*100)/100; if (Math.abs(d) > 0.009) diffs.push(`${a}: app=${o[a]||0} cohesion=${m[a]||0} d=${d}`) }
    if (!diffs.length) { ident++; console.log('IDENTICO', loc) } else { console.log('DIFF', loc); diffs.forEach(d => console.log('   ', d)) }
  }
  console.log('identicos', ident, 'de', tot)
}
main()


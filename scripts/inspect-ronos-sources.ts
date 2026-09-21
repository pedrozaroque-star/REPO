/**
 * @module scripts/inspect-ronos-sources
 * @description Inspección de metadatos reales de nómina sin exponer datos personales.
 * @businessRules Solo lectura; nunca imprime tokens, nombres, cuentas o salarios individuales.
 * @dataFlow Simplify HR y Supabase -> metadatos de cobertura -> terminal.
 * @notes Permite verificar la forma real de paginación antes de implementarla.
 */
import { callSimplifyHrApi, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'
import { supabaseAdmin } from '../lib/supabase'

async function main() {
  const siteId = RONOS_TO_SIMPLIFY_SITE_MAP[26]
  const result = await callSimplifyHrApi<any>('payroll/paystubs', {
    params: { siteId, limit: 2 }, maxRetries: 1
  })
  const rows = Array.isArray(result) ? result : result?.paystubs || []
  console.log(JSON.stringify({
    responseKeys: Object.keys(result || {}),
    pagination: Object.fromEntries(Object.entries(result || {}).filter(([k, v]) => /total|page|limit|hasMore|skip|offset/i.test(k) && typeof v !== 'object')),
    count: rows.length,
    rowKeys: Object.keys(rows[0] || {}),
    earningsKeys: Object.keys(rows[0]?.earnings?.[0] || {}),
    statuses: [...new Set(rows.map((s: any) => s.status))],
    periods: rows.map((s: any) => [s.payPeriodStart || s.periodStart, s.payPeriodEnd || s.periodEnd])
  }, null, 2))
  const { data, error } = await supabaseAdmin.from('ronos_employee_timecards_cache')
    .select('week_id,pin,employee_user_id').eq('company_id', 26).in('week_id', [155953, 155954])
  if (error) throw new Error(error.message)
  console.log('Cached Hollywood cards:', data?.length, 'PIN match count (sample):', rows.filter((s: any) => data?.some(c => String(c.pin) === String(s.employeeNumber))).length)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

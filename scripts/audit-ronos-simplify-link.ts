/**
 * @module audit-ronos-simplify-link
 * @description Audita si existe un identificador persistente entre RONOS, Toast y Simplify HR.
 * @businessRules Solo lectura. Una coincidencia por nombre se reporta como candidato, nunca como identidad confirmada.
 * @dataFlow Supabase mappings/Toast/rates + RONOS cache -> conteos de claves y cobertura.
 * @notes No imprime nombres, IDs, salarios, credenciales ni datos personales.
 */
import { supabaseAdmin } from '../lib/supabase'
import { normalizePayrollName } from '../lib/payroll-evidence'
import { getSimplifyHrSiteInfo, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'

async function main() {
  const companyId = 26
  const site = await getSimplifyHrSiteInfo(RONOS_TO_SIMPLIFY_SITE_MAP[companyId])
  const [{ data: cards, error: cardsError }, { data: mappings, error: mappingsError }, { data: toast, error: toastError }, { data: rates, error: ratesError }] = await Promise.all([
    supabaseAdmin.from('ronos_employee_timecards_cache').select('employee_user_id,employee_id,pin,full_name').eq('company_id', companyId).in('week_id', [155953, 155954]),
    supabaseAdmin.from('ronos_employee_mappings').select('*').eq('ronos_company_id', companyId),
    supabaseAdmin.from('toast_employees').select('*').eq('deleted', false).limit(5000),
    supabaseAdmin.from('simplify_employee_rates').select('*').eq('ronos_company_id', companyId)
  ])
  for (const [name, error] of Object.entries({ cardsError, mappingsError, toastError, ratesError })) if (error) throw Error(`${name}: ${(error as any).message}`)
  const uniqueCards = [...new Map((cards || []).map(c => [c.employee_user_id, c])).values()]
  const confirmed = (mappings || []).filter((m: any) => m.is_confirmed && m.toast_employee_id)
  const mappedRonosIds = new Set(confirmed.map((m: any) => String(m.ronos_employee_user_id)))
  const toastKeys = Object.keys((toast || [])[0] || {})
  const simplifyKeys = Object.keys((rates || [])[0] || {})
  const rateNames = new Map<string, number>()
  for (const rate of rates || []) {
    const name = normalizePayrollName(String((rate as any).normalized_name || (rate as any).full_name || ''))
    rateNames.set(name, (rateNames.get(name) || 0) + 1)
  }
  const uniqueNameCandidates = uniqueCards.filter((card: any) => rateNames.get(normalizePayrollName(String(card.full_name || ''))) === 1).length
  const simplifyIdFields = simplifyKeys.filter(k => /employee.*id|user.*id|assignment.*id/i.test(k))
  const toastSimplifyFields = toastKeys.filter(k => /simplify|employee.*id|external.*id|payroll/i.test(k))
  const simplifyIds = new Set((rates || []).map((rate: any) => String(rate.employee_id || '')).filter(Boolean))
  const toastByName = new Map<string, any[]>()
  for (const employee of toast || []) {
    const name = normalizePayrollName(`${(employee as any).first_name || ''} ${(employee as any).last_name || ''}`)
    if (name) toastByName.set(name, [...(toastByName.get(name) || []), employee])
  }
  const toastToSimplifyByExternalId = (toast || []).filter((employee: any) =>
    simplifyIds.has(String(employee.external_employee_id || '')) || simplifyIds.has(String(employee.external_id || ''))).length
  const ronosToToastToSimplifyCandidates = uniqueCards.filter((card: any) => {
    const matches = toastByName.get(normalizePayrollName(String(card.full_name || ''))) || []
    return matches.length === 1 && (simplifyIds.has(String(matches[0].external_employee_id || '')) || simplifyIds.has(String(matches[0].external_id || '')))
  }).length
  console.log(JSON.stringify({
    companyId, siteRonosCompanyId: site.ronosCompanyId ?? null, siteMappingMatchesCompany: site.ronosCompanyId === companyId,
    ronosEmployees: uniqueCards.length, savedMappings: (mappings || []).length,
    confirmedRonosToToast: confirmed.length, ronosCoveredByConfirmedToast: uniqueCards.filter((c: any) => mappedRonosIds.has(String(c.employee_user_id))).length,
    simplifyRates: (rates || []).length, ronosToUniqueSimplifyNameCandidates: uniqueNameCandidates,
    mappingColumns: Object.keys((mappings || [])[0] || {}).filter(k => /ronos|toast|simplify|employee|guid|confirm/i.test(k)),
    toastPotentialBridgeColumns: toastSimplifyFields, simplifyIdentifierColumns: simplifyIdFields,
    toastToSimplifyByExternalId, ronosToToastToSimplifyCandidates,
    persistentRonosToSimplifyKeyPresent: false
  }, null, 2))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

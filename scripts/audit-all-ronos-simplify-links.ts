/**
 * @module audit-all-ronos-simplify-links
 * @description Verifica en vivo el vínculo oficial RONOS–Simplify HR de las 16 ubicaciones.
 * @businessRules Solo lectura; mide los mapeos persistidos sin crear ni confirmar identidades.
 * @dataFlow Catálogo RONOS + sites Simplify + Supabase -> matriz de cobertura por sucursal.
 * @notes Site–RONOS es una relación organizacional; no equivale por sí misma a una identidad individual.
 */
import { RONOS_STORES_MAP } from '../lib/ronos-api'
import { getSimplifyHrSiteInfo, RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'
import { supabaseAdmin } from '../lib/supabase'
import { normalizePayrollName } from '../lib/payroll-evidence'

type AuditRow = {
  store: string; companyId: number; siteConfigured: boolean; siteRonosCompanyId: number | null
  siteMatches: boolean; siteDepartmentsMapped: number; siteSyncStatus: string | null
  storedRates: number; savedEmployeeMappings: number; confirmedRonosToastMappings: number; error?: string
  recentWeeks: number; ronosEmployeesInRecentWeeks: number; uniqueRateNameCandidates: number
}

async function main() {
  const companyIds = RONOS_STORES_MAP.map(store => store.ronosCompanyId)
  const [{ data: rates, error: ratesError }, { data: mappings, error: mappingsError }] = await Promise.all([
    supabaseAdmin.from('simplify_employee_rates').select('ronos_company_id,employee_id,full_name,normalized_name').in('ronos_company_id', companyIds),
    supabaseAdmin.from('ronos_employee_mappings').select('ronos_company_id,toast_employee_id,is_confirmed').in('ronos_company_id', companyIds)
  ])
  if (ratesError) throw Error(`simplify_employee_rates: ${ratesError.message}`)
  if (mappingsError) throw Error(`ronos_employee_mappings: ${mappingsError.message}`)
  const rows: AuditRow[] = []
  for (const store of RONOS_STORES_MAP) {
    const siteId = RONOS_TO_SIMPLIFY_SITE_MAP[store.ronosCompanyId]
    const storeRates = (rates || []).filter((rate: any) => Number(rate.ronos_company_id) === store.ronosCompanyId).length
    const storeMappings = (mappings || []).filter((mapping: any) => Number(mapping.ronos_company_id) === store.ronosCompanyId)
    const base = {
      store: store.tegName, companyId: store.ronosCompanyId, siteConfigured: Boolean(siteId),
      storedRates: storeRates, savedEmployeeMappings: storeMappings.length,
      confirmedRonosToastMappings: storeMappings.filter((mapping: any) => mapping.is_confirmed && mapping.toast_employee_id).length
    }
    const { data: weeks, error: weeksError } = await supabaseAdmin.from('ronos_work_weeks')
      .select('week_id').eq('company_id', store.ronosCompanyId).order('end_date', { ascending: false }).limit(2)
    if (weeksError) throw Error(`ronos_work_weeks ${store.tegName}: ${weeksError.message}`)
    const weekIds = (weeks || []).map((week: any) => week.week_id)
    const { data: cards, error: cardsError } = weekIds.length
      ? await supabaseAdmin.from('ronos_employee_timecards_cache').select('employee_user_id,full_name,first_name,last_name').eq('company_id', store.ronosCompanyId).in('week_id', weekIds)
      : { data: [], error: null }
    if (cardsError) throw Error(`ronos_employee_timecards_cache ${store.tegName}: ${cardsError.message}`)
    const uniqueCards = [...new Map((cards || []).filter((card: any) => card.employee_user_id).map((card: any) => [card.employee_user_id, card])).values()]
    const rateNameCounts = new Map<string, number>()
    for (const rate of (rates || []).filter((rate: any) => Number(rate.ronos_company_id) === store.ronosCompanyId)) {
      const name = normalizePayrollName(String((rate as any).normalized_name || (rate as any).full_name || ''))
      if (name) rateNameCounts.set(name, (rateNameCounts.get(name) || 0) + 1)
    }
    const ronosCardName = (card: any) => String(card.full_name || `${card.first_name || ''} ${card.last_name || ''}`).trim()
    const employeeCoverage = {
      recentWeeks: weekIds.length,
      ronosEmployeesInRecentWeeks: uniqueCards.length,
      uniqueRateNameCandidates: uniqueCards.filter((card: any) => rateNameCounts.get(normalizePayrollName(ronosCardName(card))) === 1).length
    }
    if (!siteId) { rows.push({ ...base, ...employeeCoverage, siteRonosCompanyId: null, siteMatches: false, siteDepartmentsMapped: 0, siteSyncStatus: null, error: 'Sin Site ID configurado' }); continue }
    try {
      const site = await getSimplifyHrSiteInfo(siteId)
      rows.push({ ...base, ...employeeCoverage, siteRonosCompanyId: site.ronosCompanyId ?? null,
        siteMatches: site.ronosCompanyId === store.ronosCompanyId,
        siteDepartmentsMapped: Array.isArray(site.ronosDepartmentMappings) ? site.ronosDepartmentMappings.length : 0,
        siteSyncStatus: site.ronosSyncStatus || null })
    } catch (error: any) {
      rows.push({ ...base, ...employeeCoverage, siteRonosCompanyId: null, siteMatches: false, siteDepartmentsMapped: 0, siteSyncStatus: null, error: error?.message || 'Error de Site API' })
    }
  }
  const summary = {
    stores: rows.length,
    officialSiteMatches: rows.filter(row => row.siteMatches).length,
    siteErrors: rows.filter(row => row.error).length,
    storesWithRates: rows.filter(row => row.storedRates > 0).length,
    persistedEmployeeMappings: rows.reduce((sum, row) => sum + row.savedEmployeeMappings, 0),
    confirmedRonosToastMappings: rows.reduce((sum, row) => sum + row.confirmedRonosToastMappings, 0)
    ,recentRonosEmployees: rows.reduce((sum, row) => sum + row.ronosEmployeesInRecentWeeks, 0)
    ,uniqueRateNameCandidates: rows.reduce((sum, row) => sum + row.uniqueRateNameCandidates, 0)
  }
  console.log(JSON.stringify({ summary, stores: rows }, null, 2))
  if (summary.officialSiteMatches !== rows.length || summary.siteErrors) process.exitCode = 2
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

/**
 * @module lib/external-accounting-deep-links
 * @description Deterministically parses, validates, and serializes URL deep-link parameters
 * (`?company=&tab=&report=&basis=&view=&work=&firm=&clients_view=&list=&contact_type=`) for `/admin/contabilidad-externa`.
 *
 * @businessRules
 * - Prevents the initial mount race condition where a URL writer `useEffect` overwrote `window.location.search`
 *   with default state (`tab=overview`) before the URL reader `useEffect` finished hydrating state.
 * - Normalizes `company` / `realmId` across all 8 companies (6 `ACTIVE_QBO` + 2 `RETIRED_FROM_QBO_LOCAL_ACTIVE`).
 * - Validates `tab` against all 17 supported workspace tabs (`ActiveTab`).
 * - Automatically infers `tab = 'reports'` when `?report=...` is passed without an explicit `tab`,
 *   and `tab = 'transactions'` when `?view=...` is passed without an explicit `tab`.
 * - Normalizes `basis` case-insensitively to `'Accrual' | 'Cash'`.
 *
 * @dataFlow
 * Browser URL / Next.js `useSearchParams` -> `parseAccountingDeepLink` -> React State -> `buildAccountingDeepLinkSearch` -> `window.history.replaceState`
 *
 * @notes
 * - Pure TypeScript module with zero DOM globals required, enabling 100% deterministic runtime testing via `tsx`.
 */

export type AccountingActiveTab =
  | 'overview'
  | 'transactions'
  | 'checks_deposits'
  | 'contacts'
  | 'reports'
  | 'accounts'
  | 'reconcile'
  | 'recurring'
  | 'lists'
  | 'audit_log'
  | 'books_review'
  | 'clients'
  | 'firm_hub'
  | 'budgeting'
  | 'rules'
  | 'reclassify'
  | 'company_settings'

export type AccountingTxnViewMode =
  | 'all'
  | 'invoices'
  | 'sales'
  | 'bills'
  | 'expenses'
  | 'client_overview'
  | 'write_off_invoices'

export type AccountingReportBasis = 'Accrual' | 'Cash'

export type AccountingListTabKey =
  | 'items'
  | 'categories'
  | 'departments'
  | 'classes'
  | 'paymentMethods'
  | 'terms'
  | 'customFields'
  | 'attachments'
  | 'costGroups'

export type AccountingWorkSubView =
  | 'client_insights'
  | 'books_close'
  | 'tax_prep'
  | '1099s'
  | 'projects'
  | 'cpa_audit'

export type AccountingFirmHubSubView =
  | 'playbooks'
  | 'users'
  | 'user_groups'
  | 'policy_templates'
  | 'coa_templates'
  | 'integrations'

export const VALID_COMPANY_REALM_IDS: ReadonlySet<string> = new Set<string>([
  '123145858055022',  // 7947 Downey Plaza LLC (ACTIVE_QBO)
  '193514304333307',  // Chicken Taco Catering LLC (RETIRED_FROM_QBO_LOCAL_ACTIVE)
  '554651555',        // Gutierrez Financial (ACTIVE_QBO)
  '123145825185692',  // Raquel Accounting (ACTIVE_QBO)
  '193514841181564',  // Canasty Financial, LLC (ACTIVE_QBO)
  '9130355308251406', // Elveze LLC (RETIRED_FROM_QBO_LOCAL_ACTIVE)
  '9130357603135416', // Govegu LLC (ACTIVE_QBO)
  '9130357696871496', // TEG Holdings Inc (ACTIVE_QBO)
])

export const VALID_ACCOUNTING_TABS: ReadonlySet<AccountingActiveTab> = new Set<AccountingActiveTab>([
  'overview',
  'transactions',
  'checks_deposits',
  'contacts',
  'reports',
  'accounts',
  'reconcile',
  'recurring',
  'lists',
  'audit_log',
  'books_review',
  'clients',
  'firm_hub',
  'budgeting',
  'rules',
  'reclassify',
  'company_settings',
])

export const VALID_TXN_VIEW_MODES: ReadonlySet<AccountingTxnViewMode> = new Set<AccountingTxnViewMode>([
  'all',
  'invoices',
  'sales',
  'bills',
  'expenses',
  'client_overview',
  'write_off_invoices',
])

export const VALID_REPORT_TYPES: ReadonlySet<string> = new Set<string>([
  'pnl',
  'pnl_by_month',
  'pnl_by_customer',
  'pnl_by_class',
  'balance_sheet',
  'balance_sheet_comparison',
  'cash_flow',
  'ar_aging',
  'ap_aging',
  'tax_summary',
  'sales_tax_liability',
  'inventory_valuation',
  'budget_vs_actual',
  'budget_vs_actuals',
  'budget_overview',
  'kpi_scorecard',
  'transaction_list_by_date',
  'bank_register',
  'general_ledger',
  'trial_balance',
  'vendor_expenses',
  'expenses_by_vendor',
  'customer_income',
  'sales_by_customer',
  'sales_by_item',
  'check_detail',
  'deposit_detail',
  'qbo_archive',
  'account_quickreport',
  'estimates_progress',
  'unbilled_charges',
  'payroll_summary',
  'time_activities',
  'audit_log',
])

export const VALID_LIST_TAB_KEYS: ReadonlySet<AccountingListTabKey> = new Set<AccountingListTabKey>([
  'items',
  'categories',
  'departments',
  'classes',
  'paymentMethods',
  'terms',
  'customFields',
  'attachments',
  'costGroups',
])

export const VALID_WORK_SUB_VIEWS: ReadonlySet<AccountingWorkSubView> = new Set<AccountingWorkSubView>([
  'client_insights',
  'books_close',
  'tax_prep',
  '1099s',
  'projects',
  'cpa_audit',
])

export const VALID_FIRM_HUB_SUB_VIEWS: ReadonlySet<AccountingFirmHubSubView> = new Set<AccountingFirmHubSubView>([
  'playbooks',
  'users',
  'user_groups',
  'policy_templates',
  'coa_templates',
  'integrations',
])

export interface ParsedAccountingDeepLink {
  companyRealmId: string
  realmId: string
  company: string
  activeTab: AccountingActiveTab
  tab: AccountingActiveTab
  reportType: string
  report: string
  reportBasis: AccountingReportBasis
  basis: AccountingReportBasis
  txnViewMode: AccountingTxnViewMode
  view: AccountingTxnViewMode
  activeListKey: AccountingListTabKey
  workSubView: AccountingWorkSubView
  firmHubSubView: AccountingFirmHubSubView
  clientsSubView: 'list'
  contactFilterType: 'ALL' | 'Vendor' | 'Customer' | '1099'
  hasExplicitParams: boolean
  hasExplicitCompany: boolean
  hasExplicitTab: boolean
  hasExplicitReport: boolean
  hasExplicitBasis: boolean
  hasExplicitView: boolean
}

const REPORT_TYPE_ALIASES: Record<string, string> = {
  profit_and_loss: 'pnl',
  profitandloss: 'pnl',
  p_and_l: 'pnl',
  balancesheet: 'balance_sheet',
  bs: 'balance_sheet',
  cashflow: 'cash_flow',
  statement_of_cash_flows: 'cash_flow',
  ar: 'ar_aging',
  ap: 'ap_aging',
  gl: 'general_ledger',
  tb: 'trial_balance',
  sales_tax: 'sales_tax_liability',
  salestax: 'sales_tax_liability',
  inventory: 'inventory_valuation',
  inventory_status: 'inventory_valuation',
  budget: 'budget_vs_actual',
  budgets: 'budget_vs_actual',
  kpis: 'kpi_scorecard',
  kpi: 'kpi_scorecard',
}

export function parseAccountingDeepLink(
  searchInput: string | URLSearchParams | null | undefined,
  defaults?: Partial<ParsedAccountingDeepLink>
): ParsedAccountingDeepLink {
  const sp =
    typeof searchInput === 'string'
      ? new URLSearchParams(searchInput.startsWith('?') ? searchInput.slice(1) : searchInput)
      : searchInput instanceof URLSearchParams
        ? searchInput
        : new URLSearchParams()

  const rawCompany = (sp.get('company') || sp.get('realmId') || '').trim()
  const rawTab = (sp.get('tab') || '').trim().toLowerCase()
  const rawReport = (sp.get('report') || sp.get('reportType') || '').trim().toLowerCase()
  const rawBasis = (sp.get('basis') || '').trim().toLowerCase()
  const rawView = (sp.get('view') || '').trim().toLowerCase()
  const rawList = (sp.get('list') || '').trim()
  const rawWork = (sp.get('work') || '').trim().toLowerCase()
  const rawFirm = (sp.get('firm') || '').trim().toLowerCase()
  const rawClientsView = (sp.get('clients_view') || '').trim().toLowerCase()
  const rawContactType = (sp.get('contact_type') || '').trim()

  const normalizedReportCandidate = REPORT_TYPE_ALIASES[rawReport] || rawReport
  const validReport = VALID_REPORT_TYPES.has(normalizedReportCandidate)
    ? normalizedReportCandidate
    : defaults?.reportType || 'pnl'

  const validView = VALID_TXN_VIEW_MODES.has(rawView as AccountingTxnViewMode)
    ? (rawView as AccountingTxnViewMode)
    : defaults?.txnViewMode || 'all'

  let resolvedTab: AccountingActiveTab = defaults?.activeTab || 'overview'
  if (VALID_ACCOUNTING_TABS.has(rawTab as AccountingActiveTab)) {
    resolvedTab = rawTab as AccountingActiveTab
  } else if (rawReport && VALID_REPORT_TYPES.has(normalizedReportCandidate)) {
    resolvedTab = 'reports'
  } else if (rawView && VALID_TXN_VIEW_MODES.has(rawView as AccountingTxnViewMode)) {
    resolvedTab = 'transactions'
  } else if (rawList && VALID_LIST_TAB_KEYS.has(rawList as AccountingListTabKey)) {
    resolvedTab = 'lists'
  } else if (rawWork && VALID_WORK_SUB_VIEWS.has(rawWork as AccountingWorkSubView)) {
    resolvedTab = 'books_review'
  } else if (rawFirm && VALID_FIRM_HUB_SUB_VIEWS.has(rawFirm as AccountingFirmHubSubView)) {
    resolvedTab = 'firm_hub'
  }

  const resolvedBasis: AccountingReportBasis =
    rawBasis === 'cash'
      ? 'Cash'
      : rawBasis === 'accrual'
        ? 'Accrual'
        : defaults?.reportBasis || 'Accrual'

  const resolvedListKey: AccountingListTabKey = VALID_LIST_TAB_KEYS.has(rawList as AccountingListTabKey)
    ? (rawList as AccountingListTabKey)
    : defaults?.activeListKey || 'items'

  const resolvedWorkSubView: AccountingWorkSubView = VALID_WORK_SUB_VIEWS.has(rawWork as AccountingWorkSubView)
    ? (rawWork as AccountingWorkSubView)
    : defaults?.workSubView || 'client_insights'

  const resolvedFirmHubSubView: AccountingFirmHubSubView = VALID_FIRM_HUB_SUB_VIEWS.has(
    rawFirm as AccountingFirmHubSubView
  )
    ? (rawFirm as AccountingFirmHubSubView)
    : defaults?.firmHubSubView || 'playbooks'

  const resolvedClientsSubView: 'list' = 'list'

  const resolvedContactFilterType: 'ALL' | 'Vendor' | 'Customer' | '1099' =
    rawContactType === 'Vendor' || rawContactType === 'Customer' || rawContactType === '1099'
      ? rawContactType
      : defaults?.contactFilterType || 'ALL'

  const isValidRawCompany = Boolean(rawCompany && VALID_COMPANY_REALM_IDS.has(rawCompany))
  const defaultCompanyCandidate = defaults?.companyRealmId || defaults?.realmId || defaults?.company || '123145825185692'
  const resolvedRealmId = isValidRawCompany
    ? rawCompany
    : VALID_COMPANY_REALM_IDS.has(defaultCompanyCandidate)
      ? defaultCompanyCandidate
      : '123145825185692'
  const hasExplicitParams = Boolean(
    isValidRawCompany || rawTab || rawReport || rawBasis || rawView || rawList || rawWork || rawFirm || rawClientsView || rawContactType
  )

  return {
    companyRealmId: resolvedRealmId,
    realmId: resolvedRealmId,
    company: resolvedRealmId,
    activeTab: resolvedTab,
    tab: resolvedTab,
    reportType: validReport,
    report: validReport,
    reportBasis: resolvedBasis,
    basis: resolvedBasis,
    txnViewMode: validView,
    view: validView,
    activeListKey: resolvedListKey,
    workSubView: resolvedWorkSubView,
    firmHubSubView: resolvedFirmHubSubView,
    clientsSubView: resolvedClientsSubView,
    contactFilterType: resolvedContactFilterType,
    hasExplicitParams,
    hasExplicitCompany: isValidRawCompany,
    hasExplicitTab: Boolean(rawTab || rawReport || rawView || rawList || rawWork || rawFirm),
    hasExplicitReport: Boolean(rawReport),
    hasExplicitBasis: Boolean(rawBasis),
    hasExplicitView: Boolean(rawView),
  }
}

export interface AccountingDeepLinkStateInput {
  activeRealmId?: string
  realmId?: string
  company?: string
  activeTab: AccountingActiveTab
  reportType?: string
  reportBasis?: AccountingReportBasis
  txnViewMode?: AccountingTxnViewMode
  activeListKey?: AccountingListTabKey
  workSubView?: AccountingWorkSubView
  firmHubSubView?: AccountingFirmHubSubView
  clientsSubView?: 'list'
  contactFilterType?: 'ALL' | 'Vendor' | 'Customer' | '1099'
}

export function buildAccountingDeepLinkSearch(
  currentSearchOrState: string | URLSearchParams | AccountingDeepLinkStateInput | null | undefined,
  maybeState?: AccountingDeepLinkStateInput
): string {
  const isFirstArgState =
    currentSearchOrState !== null &&
    typeof currentSearchOrState === 'object' &&
    !(currentSearchOrState instanceof URLSearchParams)

  const currentSearch = isFirstArgState ? '' : (currentSearchOrState as string | URLSearchParams | null | undefined)
  const state: AccountingDeepLinkStateInput = isFirstArgState
    ? (currentSearchOrState as AccountingDeepLinkStateInput)
    : (maybeState || { activeTab: 'overview' })

  const sp =
    typeof currentSearch === 'string'
      ? new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch)
      : currentSearch instanceof URLSearchParams
        ? new URLSearchParams(currentSearch.toString())
        : new URLSearchParams()

  sp.delete('realmId')
  const resolvedRealmId = state.activeRealmId || state.realmId || state.company || ''
  if (resolvedRealmId) {
    sp.set('company', resolvedRealmId)
  }
  if (state.activeTab) {
    sp.set('tab', state.activeTab)
  }
  if (state.activeTab === 'reports' && state.reportType) {
    sp.set('report', state.reportType)
    sp.set('basis', state.reportBasis || 'Accrual')
  } else {
    sp.delete('report')
    sp.delete('reportType')
    sp.delete('basis')
  }
  if (state.activeTab === 'transactions' && state.txnViewMode) {
    sp.set('view', state.txnViewMode)
  } else {
    sp.delete('view')
  }
  if (state.activeTab === 'lists' && state.activeListKey) {
    sp.set('list', state.activeListKey)
  } else {
    sp.delete('list')
  }
  if (state.activeTab === 'books_review' && state.workSubView) {
    sp.set('work', state.workSubView)
  } else {
    sp.delete('work')
  }
  if (state.activeTab === 'firm_hub' && state.firmHubSubView) {
    sp.set('firm', state.firmHubSubView)
  } else {
    sp.delete('firm')
  }
  if (state.activeTab === 'clients' && state.clientsSubView) {
    sp.set('clients_view', state.clientsSubView)
  } else {
    sp.delete('clients_view')
  }
  if (state.activeTab === 'contacts' && state.contactFilterType && state.contactFilterType !== 'ALL') {
    sp.set('contact_type', state.contactFilterType)
  } else {
    sp.delete('contact_type')
  }
  return sp.toString()
}

/**
 * @module api/pnl/consolidated
 * @description Generates the multi-location side-by-side Profit and Loss (P&L) statement
 * for all 15 active Tacos Gavilan stores plus the consolidated chain total.
 * Replicates the exact enterprise reporting layout of Restaurant365 (R365).
 * 
 * @businessRules
 * - Work day starts at 6:00 AM PST and ends at 5:59 AM PST the following day.
 * - Stores: All 15 active stores in `stores` table are included in parallel columns.
 * - Sales: Net sales, gross sales, and discounts are sourced from `sales_daily_cache`.
 * - Labor: Regular wages and overtime wages are calculated from `punches` (hourly_wage * hours)
 *   plus employer payroll taxes and benefits (calibrated at 12%).
 * - Food Cost (COGS): Sourced from `food_cost_daily_cache` (Toast PMIX * recipes * purchase prices).
 * - Intercompany Elimination (Bodega Mode):
 *   * In 'store' mode: Reflects store transfer pricing with commissary markup.
 *   * In 'corporate' mode: Eliminates internal Bodega markup (~10% on meat and prepared items)
 *     so corporate reports reflect true external supplier purchase costs.
 * - Operating Expenses (OpEx): Monthly store expenses (rent, utilities, CAM, insurance, repairs)
 *   from `store_operating_expenses` prorated to the exact days in the selected date range.
 * - Shared Brand Expenses: Corporate overhead (Meta Ads, general brand marketing, supervision)
 *   from `shared_brand_expenses` allocated across stores (even split or sales weighted).
 * - Safe Math: All percentages are calculated relative to Net Sales with 0/0 division guards.
 * 
 * @dataFlow
 * Toast APIs / Supabase Caches ->
 *   - sales_daily_cache (Sales)
 *   - punches (Labor)
 *   - food_cost_daily_cache (Food Cost)
 *   - store_operating_expenses (Fixed OpEx)
 *   - shared_brand_expenses (Brand Overhead)
 * -> Aggregated Side-by-Side Matrix -> /admin/pnl
 * 
 * @notes
 * - Solves the QuickBooks delay and multi-store visibility gap identified by Erick Velazquez.
 * - Saves ~$60,000+ USD/year by replacing Restaurant365's accounting and reporting module.
 * - Uses deterministic pagination (`toast_id` / `id` + `.range()`) to prevent PostgREST 1,000-row silent truncation on monthly `punches` (~7,700+ rows/month) and multi-month caches.
 * - Enforces store-level RBAC scoping: `admin` and `supervisor` view all 15 stores, while single-store `manager`/`asistente` is strictly scoped to their assigned `store_id`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth, resolveCachedStore } from '@/lib/auth-server'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { diffCalendarDays, isInvalidFoodCostCacheRow, resolveCachedFoodCostDollars } from '@/lib/inventory/food-cost-sales-resolver'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface StoreSummary {
  id: string
  external_id: string
  name: string
  // Sales
  gross_sales: number
  comps_discounts: number
  net_sales: number
  sales_pct: number // 100%
  // Prime Cost (Food Cost + Direct Labor Wages — 100% parity with /ventas)
  food_cost: number
  food_cost_pct: number
  labor_wages: number
  labor_wages_pct: number
  total_prime_cost: number
  prime_cost_pct: number
  // Separate Transparent COGS & Labor Burden Lines
  packaging_cost: number
  packaging_cost_pct: number
  employee_benefits: number
  employee_benefits_pct: number
  // Gross Profit
  gross_profit: number
  gross_profit_pct: number
  // Operating Expenses
  rent: number
  cam_charges: number
  utilities: number
  repairs_maintenance: number
  supplies_misc: number
  insurance: number
  total_operating_expenses: number
  operating_expenses_pct: number
  // Store Level Net Income
  store_net_income: number
  store_net_income_pct: number
  // Corporate Overhead
  corporate_overhead: number
  corporate_overhead_pct: number
  // Final Profitability
  ebitda: number
  ebitda_pct: number
  net_profit: number
  net_profit_pct: number
  // Estimation flags
  food_cost_estimated?: boolean
  labor_estimated?: boolean
}

interface ConsolidatedPnLResponse {
  period: string
  startDate: string
  endDate: string
  daysCount: number
  bodegaMode: 'store' | 'corporate'
  stores: StoreSummary[]
  consolidated: StoreSummary
  sharedExpenses: any[]
}

function safePct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0
  return parseFloat(((numerator / denominator) * 100).toFixed(2))
}

function round2(val: number): number {
  return parseFloat((val || 0).toFixed(2))
}

export async function GET(request: NextRequest) {
  const auth = verifyStaffAuth(request, {
    allowedRoles: ['admin', 'supervisor', 'manager', 'asistente', 'assistant']
  })
  if (!auth.authorized) return auth.response!

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || getCaliforniaBusinessDate()
    const endDate = searchParams.get('endDate') || startDate
    const period = searchParams.get('period') || 'custom'
    const bodegaMode = (searchParams.get('bodegaMode') === 'corporate' ? 'corporate' : 'store') as 'store' | 'corporate'
    const requestedStoreParam = (searchParams.get('store_id') || searchParams.get('storeId') || '').trim()

    if (startDate > endDate) {
      return NextResponse.json({ error: 'startDate must be before or equal to endDate' }, { status: 400 })
    }

    // Calculate days in period using DST-safe UTC calendar math
    const startD = new Date(startDate + 'T12:00:00Z')
    const endD = new Date(endDate + 'T12:00:00Z')
    const daysCount = Math.max(1, diffCalendarDays(startDate, endDate) + 1)
    const monthProportion = daysCount / 30.416 // average days per month for proration

    // 1. Fetch active stores
    const { data: stores, error: storesErr } = await supabase
      .from('stores')
      .select('id, name, external_id')
      .order('name')

    if (storesErr) throw storesErr
    if (!stores || stores.length === 0) {
      return NextResponse.json({ error: 'No active stores found' }, { status: 404 })
    }

    // Enforce store-level RBAC scoping: admin/supervisor/cron see all 15 stores; manager/asistente strictly scoped to assigned store_id
    const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase().trim()
    let isGlobalScope = !auth.user || userRole === 'admin' || userRole === 'administrador' || userRole === 'supervisor'
    let scopedStoreKeys: string[] = []
    let targetStores = stores

    if (!isGlobalScope && auth.user) {
      let rawStoreId: string | number | null =
        auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id ?? null
      let rawScope = String(auth.user.user_metadata?.store_scope || '').toLowerCase().trim()

      const numericUid = Number(auth.user.id)
      if (Number.isFinite(numericUid) && numericUid > 0) {
        const { data: dbUser } = await supabase
          .from('users')
          .select('store_id, store_scope, is_active')
          .eq('id', numericUid)
          .maybeSingle()
        if (dbUser) {
          if (dbUser.is_active === false) {
            return NextResponse.json({ error: 'Acceso denegado: Usuario inactivo.' }, { status: 403 })
          }
          if (dbUser.store_id !== null && dbUser.store_id !== undefined) {
            rawStoreId = dbUser.store_id
          }
          if (dbUser.store_scope) {
            rawScope = String(dbUser.store_scope).toLowerCase().trim()
          }
        }
      }

      if (rawScope === 'all' && userRole === 'general_manager') {
        isGlobalScope = true
      } else {
        const cachedAssigned = await resolveCachedStore(rawStoreId, supabase)
        const cleanRaw = rawStoreId !== null && rawStoreId !== undefined ? String(rawStoreId).trim() : ''
        const assignedStore = stores.find(
          (s) =>
            (cachedAssigned && String(s.id) === String(cachedAssigned.id)) ||
            (cleanRaw && (String(s.id) === cleanRaw || s.external_id === cleanRaw))
        )

        if (!assignedStore) {
          return NextResponse.json(
            { error: 'Acceso denegado: Tu cuenta no tiene una sucursal asignada para consultar el P&L.' },
            { status: 403 }
          )
        }

        if (
          requestedStoreParam &&
          requestedStoreParam.toUpperCase() !== 'ALL' &&
          requestedStoreParam !== String(assignedStore.id) &&
          requestedStoreParam !== assignedStore.external_id
        ) {
          return NextResponse.json(
            { error: 'Acceso denegado: No tienes autorización para consultar el P&L de otra sucursal.' },
            { status: 403 }
          )
        }

        targetStores = [assignedStore]
        scopedStoreKeys = [String(assignedStore.id), assignedStore.external_id].filter(Boolean) as string[]
      }
    } else if (requestedStoreParam && requestedStoreParam.toUpperCase() !== 'ALL') {
      const requestedMatch = stores.find(
        (s) => String(s.id) === requestedStoreParam || s.external_id === requestedStoreParam
      )
      if (requestedMatch) {
        targetStores = [requestedMatch]
      }
    }

    const PAGE_SIZE = 1000
    const MAX_PAGES = 60

    // 2. Fetch sales from sales_daily_cache (paginated by id)
    const salesRows: any[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE
      let sQuery = supabase
        .from('sales_daily_cache')
        .select('id, store_id, net_sales, gross_sales, discounts, business_date')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (!isGlobalScope && scopedStoreKeys.length > 0) {
        sQuery = sQuery.in('store_id', scopedStoreKeys)
      }
      const { data: batch, error: salesErr } = await sQuery
      if (salesErr) {
        console.warn('Warning: sales_daily_cache query error:', salesErr)
        break
      }
      if (!batch || batch.length === 0) break
      salesRows.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }

    // 3. Fetch 100% of labor from punches using deterministic pagination on primary key toast_id
    const punchRows: any[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE
      let pQuery = supabase
        .from('punches')
        .select('toast_id, store_id, regular_hours, overtime_hours, hourly_wage, business_date')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('toast_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (!isGlobalScope && scopedStoreKeys.length > 0) {
        pQuery = pQuery.in('store_id', scopedStoreKeys)
      }
      const { data: batch, error: punchErr } = await pQuery
      if (punchErr) {
        console.warn('Warning: punches query error:', punchErr)
        break
      }
      if (!batch || batch.length === 0) break
      punchRows.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }

    // 4. Fetch food cost from food_cost_daily_cache (paginated by id)
    const foodCostRows: any[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE
      let fcQuery = supabase
        .from('food_cost_daily_cache')
        .select('id, store_id, store_name, food_cost, total_cost, packaging_cost, net_sales, business_date')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (!isGlobalScope && scopedStoreKeys.length > 0) {
        fcQuery = fcQuery.in('store_id', scopedStoreKeys)
      }
      const { data: batch, error: fcErr } = await fcQuery
      if (fcErr) {
        console.warn('Warning: food_cost_daily_cache query error:', fcErr)
        break
      }
      if (!batch || batch.length === 0) break
      foodCostRows.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }

    // 5. Fetch store operating expenses
    let opExpQuery = supabase.from('store_operating_expenses').select('*')
    if (!isGlobalScope && scopedStoreKeys.length > 0) {
      opExpQuery = opExpQuery.in('store_id', scopedStoreKeys)
    }
    const { data: opExpenses, error: opErr } = await opExpQuery

    if (opErr) console.warn('Warning: store_operating_expenses query error:', opErr)

    // 6. Fetch shared brand expenses
    const { data: sharedExpenses, error: sharedErr } = await supabase
      .from('shared_brand_expenses')
      .select('*')
      .lte('period_start', endDate)
      .gte('period_end', startDate)

    if (sharedErr) console.warn('Warning: shared_brand_expenses query error:', sharedErr)

    // Index data by storeKey (external_id or store_id)
    const salesMap = new Map<string, { net: number; gross: number; discounts: number }>()
    for (const r of salesRows || []) {
      const k = r.store_id
      const cur = salesMap.get(k) || { net: 0, gross: 0, discounts: 0 }
      cur.net += Number(r.net_sales || 0)
      cur.gross += Number(r.gross_sales || 0)
      cur.discounts += Number(r.discounts || 0)
      salesMap.set(k, cur)
    }

    const laborMap = new Map<string, { regularPay: number; otPay: number; totalWages: number }>()
    for (const p of punchRows || []) {
      const k = p.store_id
      const cur = laborMap.get(k) || { regularPay: 0, otPay: 0, totalWages: 0 }
      const wage = Number(p.hourly_wage || 0) > 0 ? Number(p.hourly_wage) : 20.00 // fallback California Fast Food min wage
      const reg = Number(p.regular_hours || 0) * wage
      const ot = Number(p.overtime_hours || 0) * wage * 1.5
      cur.regularPay += reg
      cur.otPay += ot
      cur.totalWages += (reg + ot)
      laborMap.set(k, cur)
    }

    const normStoreName = (raw: unknown) =>
      String(raw || '').replace(/^Tacos Gavilan\s+/i, '').trim().toLowerCase()

    const foodCostMap = new Map<string, number>()
    const packagingCostMap = new Map<string, number>()
    const foodCostByNameMap = new Map<string, number>()
    const packagingByNameMap = new Map<string, number>()

    for (const fc of foodCostRows || []) {
      const rowFood = resolveCachedFoodCostDollars(fc)
      const rowPkg = Number(fc.packaging_cost ?? 0)
      const rowSales = Number(fc.net_sales ?? 0)
      if (isInvalidFoodCostCacheRow(rowFood, rowSales)) {
        continue
      }
      const k = String(fc.store_id || '')
      if (k) {
        foodCostMap.set(k, (foodCostMap.get(k) || 0) + rowFood)
        packagingCostMap.set(k, (packagingCostMap.get(k) || 0) + rowPkg)
      }
      const nk = normStoreName(fc.store_name)
      if (nk) {
        foodCostByNameMap.set(nk, (foodCostByNameMap.get(nk) || 0) + rowFood)
        packagingByNameMap.set(nk, (packagingByNameMap.get(nk) || 0) + rowPkg)
      }
    }

    const opExpMap = new Map<string, any>()
    const targetMonth = startDate.substring(0, 7)
    for (const exp of opExpenses || []) {
      const k = exp.store_id
      const existing = opExpMap.get(k)
      if (
        exp.month_year === targetMonth ||
        (exp.month_year === 'DEFAULT' && existing?.month_year !== targetMonth) ||
        !existing
      ) {
        opExpMap.set(k, exp)
      }
    }

    // Pre-calculate chain total net sales for sales-weighted overhead allocation
    let chainTotalNetSales = 0
    for (const s of stores) {
      const key = s.external_id || String(s.id)
      const sales = salesMap.get(key)?.net || 0
      chainTotalNetSales += sales
    }

    // Calculate total corporate overhead to distribute
    const corporateOverheadMap = new Map<string, number>()
    
    for (const sh of sharedExpenses || []) {
      const amount = Number(sh.amount || 0)
      const expStart = new Date(sh.period_start + 'T12:00:00')
      const expEnd = new Date(sh.period_end + 'T12:00:00')
      const maxStart = new Date(Math.max(startD.getTime(), expStart.getTime()))
      const minEnd = new Date(Math.min(endD.getTime(), expEnd.getTime()))
      
      let overlapDays = 0
      if (minEnd >= maxStart) {
        overlapDays = Math.max(1, Math.ceil((minEnd.getTime() - maxStart.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      }
      const expTotalDays = Math.max(1, Math.ceil((expEnd.getTime() - expStart.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      const expenseProportion = expTotalDays > 0 ? (overlapDays / expTotalDays) : 0
      const proratedAmount = amount * expenseProportion

      for (const s of targetStores) {
        const key = s.external_id || String(s.id)
        const sales = salesMap.get(key)?.net || 0
        let storeShare = 0
        
        if (sh.allocation_method === 'even_split' || !isGlobalScope) {
          storeShare = proratedAmount / stores.length
        } else {
          // default to sales_weighted across all 15 stores
          const salesRatio = chainTotalNetSales > 0 ? (sales / chainTotalNetSales) : (1 / stores.length)
          storeShare = proratedAmount * salesRatio
        }
        
        corporateOverheadMap.set(key, (corporateOverheadMap.get(key) || 0) + storeShare)
      }
    }

    // Build per-store summaries
    const storeSummaries: StoreSummary[] = []

    for (const s of targetStores) {
      const key = s.external_id || String(s.id)
      const sales = salesMap.get(key) || { net: 0, gross: 0, discounts: 0 }
      const labor = laborMap.get(key) || { regularPay: 0, otPay: 0, totalWages: 0 }
      
      // Food Cost & External Packaging Cost (separated!)
      const nk = normStoreName(s.name)
      let rawFoodCost = foodCostMap.get(key) ?? foodCostMap.get(String(s.id)) ?? foodCostByNameMap.get(nk) ?? 0
      const rawPackagingCost = packagingCostMap.get(key) ?? packagingCostMap.get(String(s.id)) ?? packagingByNameMap.get(nk) ?? 0
      let food_cost_estimated = false
      // Fallback: If cache is empty for date range, estimate based on benchmark 31.5% (transparently flagged in UI)
      if (rawFoodCost === 0 && sales.net > 0) {
        rawFoodCost = sales.net * 0.315
        food_cost_estimated = true
      }

      // Intercompany Elimination: apply 0.90x ONLY to Bodega food_cost — NEVER to external packaging!
      const foodCost = bodegaMode === 'corporate' ? rawFoodCost * 0.90 : rawFoodCost
      const packagingCost = rawPackagingCost

      // Direct Labor Wages & Transparent Separate Payroll Taxes/Benefits (12% est.)
      let labor_estimated = false
      let laborWages = labor.totalWages
      if (laborWages === 0 && sales.net > 0) {
        laborWages = sales.net * 0.26
        labor_estimated = true
      }
      const employeeBenefits = laborWages * 0.12 // 12% est. for FICA, payroll taxes, workers comp (shown separately below Prime Cost)
      // Prime Cost = Food Cost + Direct Labor Wages (100% parity with /ventas — NO hidden 12% inside Prime Cost!)
      const totalPrimeCost = foodCost + laborWages
      const grossProfit = sales.net - totalPrimeCost - packagingCost - employeeBenefits

      // Operating expenses prorated
      const exp = opExpMap.get(key)
      const isLarge = ['Lynwood', 'Huntington Park', 'South Gate', 'West Covina', 'Downey'].includes(s.name)
      const isMedium = ['Bell', 'La Puente', 'Norwalk', 'Rialto', 'Santa Ana'].includes(s.name)

      const monthlyRent = exp?.rent_monthly ?? (isLarge ? 12500 : isMedium ? 10000 : 8500)
      const monthlyCam = exp?.cam_charges ?? (isLarge ? 950 : isMedium ? 750 : 550)
      const monthlyUtilities = exp?.utilities_monthly ?? (isLarge ? 6200 : isMedium ? 5200 : 4400)
      const monthlyRM = exp?.repairs_maintenance_monthly ?? (isLarge ? 2200 : isMedium ? 1800 : 1400)
      const monthlySupplies = exp?.supplies_misc_monthly ?? (isLarge ? 1800 : isMedium ? 1500 : 1200)
      const monthlyInsurance = exp?.insurance_monthly ?? (isLarge ? 850 : isMedium ? 750 : 650)

      const rent = round2(monthlyRent * monthProportion)
      const cam = round2(monthlyCam * monthProportion)
      const utilities = round2(monthlyUtilities * monthProportion)
      const repairs = round2(monthlyRM * monthProportion)
      const supplies = round2(monthlySupplies * monthProportion)
      const insurance = round2(monthlyInsurance * monthProportion)

      const totalOpEx = round2(rent + cam + utilities + repairs + supplies + insurance)
      const storeNetIncome = round2(grossProfit - totalOpEx)

      // Retrieve calculated corporate overhead for this store
      const corporateOverhead = round2(corporateOverheadMap.get(key) || 0)

      const ebitda = round2(storeNetIncome - corporateOverhead)
      // Estimated depreciation and interest (~1.5% of sales)
      const depreciationInterest = round2(sales.net * 0.015)
      const netProfit = round2(ebitda - depreciationInterest)

      storeSummaries.push({
        id: String(s.id),
        external_id: s.external_id,
        name: s.name,
        gross_sales: round2(sales.gross || (sales.net + sales.discounts)),
        comps_discounts: round2(sales.discounts),
        net_sales: round2(sales.net),
        sales_pct: 100.0,
        food_cost: round2(foodCost),
        food_cost_pct: safePct(foodCost, sales.net),
        labor_wages: round2(laborWages),
        labor_wages_pct: safePct(laborWages, sales.net),
        total_prime_cost: round2(totalPrimeCost),
        prime_cost_pct: safePct(totalPrimeCost, sales.net),
        packaging_cost: round2(packagingCost),
        packaging_cost_pct: safePct(packagingCost, sales.net),
        employee_benefits: round2(employeeBenefits),
        employee_benefits_pct: safePct(employeeBenefits, sales.net),
        gross_profit: round2(grossProfit),
        gross_profit_pct: safePct(grossProfit, sales.net),
        rent,
        cam_charges: cam,
        utilities,
        repairs_maintenance: repairs,
        supplies_misc: supplies,
        insurance,
        total_operating_expenses: totalOpEx,
        operating_expenses_pct: safePct(totalOpEx, sales.net),
        store_net_income: storeNetIncome,
        store_net_income_pct: safePct(storeNetIncome, sales.net),
        corporate_overhead: corporateOverhead,
        corporate_overhead_pct: safePct(corporateOverhead, sales.net),
        ebitda,
        ebitda_pct: safePct(ebitda, sales.net),
        net_profit: netProfit,
        net_profit_pct: safePct(netProfit, sales.net),
        food_cost_estimated,
        labor_estimated,
      })
    }

    // Calculate Consolidated Total across all stores
    const consolidated: StoreSummary = {
      id: 'consolidated',
      external_id: 'consolidated',
      name: 'Total Consolidado',
      gross_sales: round2(storeSummaries.reduce((sum, s) => sum + s.gross_sales, 0)),
      comps_discounts: round2(storeSummaries.reduce((sum, s) => sum + s.comps_discounts, 0)),
      net_sales: round2(storeSummaries.reduce((sum, s) => sum + s.net_sales, 0)),
      sales_pct: 100.0,
      food_cost: round2(storeSummaries.reduce((sum, s) => sum + s.food_cost, 0)),
      food_cost_pct: 0,
      labor_wages: round2(storeSummaries.reduce((sum, s) => sum + s.labor_wages, 0)),
      labor_wages_pct: 0,
      total_prime_cost: round2(storeSummaries.reduce((sum, s) => sum + s.total_prime_cost, 0)),
      prime_cost_pct: 0,
      packaging_cost: round2(storeSummaries.reduce((sum, s) => sum + s.packaging_cost, 0)),
      packaging_cost_pct: 0,
      employee_benefits: round2(storeSummaries.reduce((sum, s) => sum + s.employee_benefits, 0)),
      employee_benefits_pct: 0,
      gross_profit: round2(storeSummaries.reduce((sum, s) => sum + s.gross_profit, 0)),
      gross_profit_pct: 0,
      rent: round2(storeSummaries.reduce((sum, s) => sum + s.rent, 0)),
      cam_charges: round2(storeSummaries.reduce((sum, s) => sum + s.cam_charges, 0)),
      utilities: round2(storeSummaries.reduce((sum, s) => sum + s.utilities, 0)),
      repairs_maintenance: round2(storeSummaries.reduce((sum, s) => sum + s.repairs_maintenance, 0)),
      supplies_misc: round2(storeSummaries.reduce((sum, s) => sum + s.supplies_misc, 0)),
      insurance: round2(storeSummaries.reduce((sum, s) => sum + s.insurance, 0)),
      total_operating_expenses: round2(storeSummaries.reduce((sum, s) => sum + s.total_operating_expenses, 0)),
      operating_expenses_pct: 0,
      store_net_income: round2(storeSummaries.reduce((sum, s) => sum + s.store_net_income, 0)),
      store_net_income_pct: 0,
      corporate_overhead: round2(storeSummaries.reduce((sum, s) => sum + s.corporate_overhead, 0)),
      corporate_overhead_pct: 0,
      ebitda: round2(storeSummaries.reduce((sum, s) => sum + s.ebitda, 0)),
      ebitda_pct: 0,
      net_profit: round2(storeSummaries.reduce((sum, s) => sum + s.net_profit, 0)),
      net_profit_pct: 0,
      food_cost_estimated: storeSummaries.some(s => s.food_cost_estimated),
      labor_estimated: storeSummaries.some(s => s.labor_estimated),
    }

    // Compute consolidated percentages
    consolidated.food_cost_pct = safePct(consolidated.food_cost, consolidated.net_sales)
    consolidated.labor_wages_pct = safePct(consolidated.labor_wages, consolidated.net_sales)
    consolidated.prime_cost_pct = safePct(consolidated.total_prime_cost, consolidated.net_sales)
    consolidated.packaging_cost_pct = safePct(consolidated.packaging_cost, consolidated.net_sales)
    consolidated.employee_benefits_pct = safePct(consolidated.employee_benefits, consolidated.net_sales)
    consolidated.gross_profit_pct = safePct(consolidated.gross_profit, consolidated.net_sales)
    consolidated.operating_expenses_pct = safePct(consolidated.total_operating_expenses, consolidated.net_sales)
    consolidated.store_net_income_pct = safePct(consolidated.store_net_income, consolidated.net_sales)
    consolidated.corporate_overhead_pct = safePct(consolidated.corporate_overhead, consolidated.net_sales)
    consolidated.ebitda_pct = safePct(consolidated.ebitda, consolidated.net_sales)
    consolidated.net_profit_pct = safePct(consolidated.net_profit, consolidated.net_sales)

    const responsePayload: ConsolidatedPnLResponse = {
      period,
      startDate,
      endDate,
      daysCount,
      bodegaMode,
      stores: storeSummaries,
      consolidated,
      sharedExpenses: isGlobalScope ? (sharedExpenses || []) : []
    }

    return NextResponse.json(responsePayload)
  } catch (err: any) {
    console.error('Error in /api/pnl/consolidated:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

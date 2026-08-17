/**
 * @module chat-tools
 * @description Operational tools executor for TEG Assistant AI. It acts as the interface between Google Gemini's function calling loops and Tacos El Gavilan's backend database and analytical engines.
 * @businessRules
 * - Incorporates rules from the 6 AM PST business day boundary.
 * - Adheres to California compliance guidelines by wrapping the AI breaks scheduler.
 * - Performs theoretical cost analysis matching QuickBooks purchase prices.
 * @dataFlow
 * - Gemini Tool Calls -> executeTool() -> Database Select/Upsert / Local Forecasting Engine / AI Breaks Engine -> Formatted Markdown String Response.
 * @notes Combines multi-year lookups and weather APIs dynamically to generate instant predictive insights inside the support chat.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { calculateIngredientCost, type InventoryCostData } from '@/lib/inventory/recipe-calculations'
import { generateSmartForecast } from '@/lib/intelligence'
import { scheduleBreaksWithDemand } from '@/lib/breaks-engine'

const clean = (name: string) => (name || '').replace(/^Tacos Gavilan\s+/i, '').trim()
const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Gemini Function Declarations ──
export const TOOL_DECLARATIONS = [
  {
    name: 'query_sales',
    description: 'Query net sales, order count, labor cost, Uber/DoorDash sales from sales_daily_cache. Use for any sales/revenue/labor question.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        store_name: { type: 'STRING', description: 'Optional store name filter (partial match)' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_food_cost',
    description: 'Query food cost percentage and dollar amounts from food_cost_daily_cache.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        store_name: { type: 'STRING', description: 'Optional store name filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_labor',
    description: 'Query labor punches: hours worked, overtime, employee attendance from punches table.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        employee_name: { type: 'STRING', description: 'Optional employee name filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_inspections',
    description: 'Query supervisor inspections: scores, status, inspector details.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        store_name: { type: 'STRING', description: 'Optional store filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_discounts',
    description: 'Query discount audit log: discount types, amounts, anomalies from sales_discounts_log.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        store_name: { type: 'STRING', description: 'Optional store filter' },
        discount_name: { type: 'STRING', description: 'Optional discount type filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_schedules',
    description: 'Query employee schedules and shifts for a week. Shows who works when, days off.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Week start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'Week end date YYYY-MM-DD' },
        employee_name: { type: 'STRING', description: 'Optional employee name filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_employees',
    description: 'Query employee roster: names, roles, stores, job titles from users and toast_employees.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Optional store name filter' },
        role: { type: 'STRING', description: 'Optional role filter (manager, supervisor, cashier, etc.)' }
      }
    }
  },
  {
    name: 'query_inventory',
    description: 'Query inventory items, recipes, menu items, costs. Items include purchase_unit_cost, quantity_per_unit (bag/box size auto-synced from QB Description), order_unit_description, unit_measure, and yield_percent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', description: 'Optional category filter (meat, produce, dairy, etc.)' },
        item_name: { type: 'STRING', description: 'Optional item name search' }
      }
    }
  },
  {
    name: 'query_feedback',
    description: 'Query customer feedback/Google reviews and internal employee feedback.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        source: { type: 'STRING', description: 'Filter: google, internal, or all' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_stores',
    description: 'Get list of all stores with details.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'query_menu_recipes',
    description: 'Query Toast menu items (prices, names) and recipe ingredient details. Use for menu prices, combos, recipe ingredients.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_name: { type: 'STRING', description: 'Menu item or recipe name to search (partial match)' },
        group_name: { type: 'STRING', description: 'Menu group/category filter (e.g. Tacos, Burritos, Combos)' }
      }
    }
  },
  {
    name: 'query_checklists',
    description: 'Query assistant and manager checklists: completion counts, scores, dates, status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        store_name: { type: 'STRING', description: 'Optional store filter' },
        type: { type: 'STRING', description: 'Filter: assistant, manager, or all' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_violations_budgets',
    description: 'Query punch violations (overtime, missed breaks), weekly budgets, staff evaluations, and inspection comments.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        data_type: { type: 'STRING', description: 'What to query: violations, budgets, evaluations, inspection_comments, or all' },
        store_name: { type: 'STRING', description: 'Optional store filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_product_mix',
    description: 'Query product mix (pmix) sales breakdown by menu item, and meat consumption history. Use for questions about which items sold most, meat usage.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        store_name: { type: 'STRING', description: 'Optional store filter' },
        data_type: { type: 'STRING', description: 'pmix, meat, or all' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_forecast',
    description: 'Generate a highly detailed hourly sales and labor projection (cooks and cashiers required per hour) for any store and date using the 4-layer smart-hybrid AI forecasting model.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Store name filter (e.g. Lynwood, Huntington Park, El Monte)' },
        target_date: { type: 'STRING', description: 'Date YYYY-MM-DD' }
      },
      required: ['store_name', 'target_date']
    }
  },
  {
    name: 'calculate_breaks',
    description: 'Simulate and calculate California-compliant meal and rest breaks for all shifts of a store on a specific date, ensuring lunch and rests are outside peak hours and correctly spaced.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Store name filter' },
        target_date: { type: 'STRING', description: 'Date YYYY-MM-DD' }
      },
      required: ['store_name', 'target_date']
    }
  },
  {
    name: 'analyze_performance',
    description: 'Perform a deep operational real-time audit comparing actual vs target KPIs (Food Cost%, Labor Cost%, under/overstaffing deviations, punch violations) for a store and date range.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Store name filter' },
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' }
      },
      required: ['store_name', 'start_date', 'end_date']
    }
  },
  {
    name: 'query_safe_counts',
    description: 'Query vault cash counts and safe history from safe_counts table. Includes bills, coins, drawer counts, and grand totals.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Optional store name filter' },
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_prep_pace',
    description: 'Query meat preparation requests and cooking pace from preparador_requests and meat_consumption_history.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Optional store name filter' },
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_inventory_orders',
    description: 'Query store inventory orders, statuses, and order line details from inventory_orders and inventory_order_lines.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Optional store name filter' },
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'execute_custom_sql',
    description: 'Run unrestricted custom PostgreSQL queries (SELECT, joins, aggregates, schema lookups) against any database table for dynamic insights and analysis.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query_text: { type: 'STRING', description: 'The complete PostgreSQL raw query string to execute (e.g. SELECT * FROM stores LIMIT 5;)' }
      },
      required: ['query_text']
    }
  },
  {
    name: 'query_uniforms_stock',
    description: 'Query uniform inventory stock levels across all stores or a specific store.',
    parameters: {
      type: 'OBJECT',
      properties: {
        store_name: { type: 'STRING', description: 'Optional store name filter' }
      }
    }
  },
  {
    name: 'query_executive_uniforms_dashboard',
    description: 'Generate an executive summary of uniform operations: total inventory value, recent sales revenue, and missing cash from safe reconciliations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_supervisor_mileage',
    description: 'Query supervisor mileage tracking logs (MilesIQ), total miles, rates, reimbursement dollar amounts, and HR submission statuses.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'STRING', description: 'End date YYYY-MM-DD' },
        supervisor_name: { type: 'STRING', description: 'Optional supervisor name filter' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'query_supplier_prices',
    description: 'Query supplier items, prices, mappings, and price change history from suppliers, supplier_item_mappings, and supplier_price_history. Use for vendor cost questions, Viele & Sons SKUs, price inflation audits, or COGS packaging prices.',
    parameters: {
      type: 'OBJECT',
      properties: {
        supplier_name: { type: 'STRING', description: 'Optional supplier name filter (e.g. "Viele & Sons", "Sysco")' },
        sku: { type: 'STRING', description: 'Optional SKU filter (e.g. "BCLCO", "EP9PR", "ELDP22")' },
        search_text: { type: 'STRING', description: 'Optional keyword to search in descriptions or item names' }
      }
    }
  }
]

// ── Tool Executor ──
export async function executeTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'query_supplier_prices': return await querySupplierPrices(args)
      case 'query_supervisor_mileage': return await querySupervisorMileage(args)
      case 'query_sales': return await querySales(args)
      case 'query_food_cost': return await queryFoodCost(args)
      case 'query_labor': return await queryLabor(args)
      case 'query_inspections': return await queryInspections(args)
      case 'query_discounts': return await queryDiscounts(args)
      case 'query_schedules': return await querySchedules(args)
      case 'query_employees': return await queryEmployees(args)
      case 'query_inventory': return await queryInventory(args)
      case 'query_feedback': return await queryFeedback(args)
      case 'query_stores': return await queryStores()
      case 'query_menu_recipes': return await queryMenuRecipes(args)
      case 'query_checklists': return await queryChecklists(args)
      case 'query_violations_budgets': return await queryViolationsBudgets(args)
      case 'query_product_mix': return await queryProductMix(args)
      case 'query_forecast': return await queryForecast(args)
      case 'calculate_breaks': return await calculateBreaks(args)
      case 'analyze_performance': return await analyzePerformance(args)
      case 'query_safe_counts': return await querySafeCounts(args)
      case 'query_prep_pace': return await queryPrepPace(args)
      case 'query_inventory_orders': return await queryInventoryOrders(args)
      case 'execute_custom_sql': return await executeCustomSql(args)
      case 'query_uniforms_stock': return await queryUniformsStock(args)
      case 'query_executive_uniforms_dashboard': return await queryExecutiveUniformsDashboard(args)
      default: return `Tool "${name}" not found.`
    }
  } catch (e: any) {
    return `Error executing ${name}: ${e.message}`
  }
}

// ── Store map helper (shared) ──
async function getStoreMaps() {
  const { data: stores } = await supabaseAdmin.from('stores').select('id, name, external_id')
  const idToName: Record<string, string> = {}
  const nameToId: Record<string, string> = {};
  (stores || []).forEach(s => {
    const n = clean(s.name)
    idToName[s.id] = n
    idToName[s.external_id] = n
    idToName[String(s.id)] = n
    nameToId[n.toLowerCase()] = s.id
  })
  return { idToName, nameToId, stores: stores || [] }
}

async function getStoreIdsByName(storeName: string): Promise<number[]> {
  const { stores } = await getStoreMaps()
  const sn = storeName.toLowerCase().trim()
  return stores
    .filter(s => clean(s.name).toLowerCase().includes(sn))
    .map(s => Number(s.id))
}

// ── 1. Sales ──
async function querySales(args: any): Promise<string> {
  let query = supabaseAdmin
    .from('sales_daily_cache')
    .select('business_date, store_name, net_sales, order_count, labor_cost, uber_sales, doordash_sales, grubhub_sales')
    .gte('business_date', args.start_date)
    .lte('business_date', args.end_date)
    .order('business_date', { ascending: true })

  if (args.store_name) {
    query = query.ilike('store_name', `%${args.store_name}%`)
  }

  const { data, error } = await query.limit(2000)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No sales data found for ${args.start_date} to ${args.end_date}.`

  // Aggregate by store
  const byStore: Record<string, { sales: number; orders: number; labor: number; uber: number; dd: number }> = {}
  let total = 0, orders = 0, labor = 0, uber = 0, dd = 0
  data.forEach(r => {
    const s = Number(r.net_sales) || 0, o = Number(r.order_count) || 0
    const l = Number(r.labor_cost) || 0, u = Number(r.uber_sales) || 0, d = Number(r.doordash_sales) || 0
    total += s; orders += o; labor += l; uber += u; dd += d
    const name = clean(r.store_name)
    if (!byStore[name]) byStore[name] = { sales: 0, orders: 0, labor: 0, uber: 0, dd: 0 }
    byStore[name].sales += s; byStore[name].orders += o; byStore[name].labor += l
    byStore[name].uber += u; byStore[name].dd += d
  })

  const storeLines = Object.entries(byStore).sort((a, b) => b[1].sales - a[1].sales)
    .map(([n, v]) => `${n}: ${fmt$(v.sales)} | Orders: ${v.orders} | Labor: ${fmt$(v.labor)} (${v.sales > 0 ? ((v.labor/v.sales)*100).toFixed(1) : 0}%) | Uber: ${fmt$(v.uber)} | DD: ${fmt$(v.dd)}`)

  // Aggregate by date (daily breakdown for day-of-week analysis)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const byDate: Record<string, { sales: number; orders: number; labor: number }> = {}
  data.forEach(r => {
    const dt = r.business_date
    if (!byDate[dt]) byDate[dt] = { sales: 0, orders: 0, labor: 0 }
    byDate[dt].sales += Number(r.net_sales) || 0
    byDate[dt].orders += Number(r.order_count) || 0
    byDate[dt].labor += Number(r.labor_cost) || 0
  })
  const dailyLines = Object.entries(byDate).sort().map(([dt, v]) => {
    const [y, m, d] = dt.split('-').map(Number)
    const dayName = dayNames[new Date(y, m - 1, d).getDay()]
    return `${dt} (${dayName}): ${fmt$(v.sales)} | ${v.orders} orders | Labor: ${fmt$(v.labor)}`
  })

  return `Sales ${args.start_date} to ${args.end_date}:\nTotal: ${fmt$(total)} | Orders: ${orders} | Labor: ${fmt$(labor)} (${total > 0 ? ((labor/total)*100).toFixed(1) : 0}%) | Uber: ${fmt$(uber)} | DD: ${fmt$(dd)}\n\nBy Store:\n${storeLines.join('\n')}\n\nDaily Breakdown:\n${dailyLines.join('\n')}`
}

// ── 2. Food Cost ──
async function queryFoodCost(args: any): Promise<string> {
  let query = supabaseAdmin
    .from('food_cost_daily_cache')
    .select('business_date, store_name, total_cost, net_sales, cost_percentage')
    .gte('business_date', args.start_date)
    .lte('business_date', args.end_date)

  if (args.store_name) query = query.ilike('store_name', `%${args.store_name}%`)

  const { data, error } = await query.limit(1000)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No food cost data for ${args.start_date} to ${args.end_date}.`

  const byStore: Record<string, { cost: number; sales: number }> = {}
  let totalCost = 0, totalSales = 0
  data.forEach(r => {
    const c = Number(r.total_cost) || 0, s = Number(r.net_sales) || 0
    totalCost += c; totalSales += s
    const name = clean(r.store_name)
    if (!byStore[name]) byStore[name] = { cost: 0, sales: 0 }
    byStore[name].cost += c; byStore[name].sales += s
  })

  const pct = totalSales > 0 ? ((totalCost / totalSales) * 100).toFixed(1) : '0'
  const lines = Object.entries(byStore).sort((a, b) => b[1].cost - a[1].cost)
    .map(([n, v]) => `${n}: Cost ${fmt$(v.cost)} / Sales ${fmt$(v.sales)} = ${v.sales > 0 ? ((v.cost/v.sales)*100).toFixed(1) : 0}%`)

  // Daily breakdown
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const byDate: Record<string, { cost: number; sales: number }> = {}
  data.forEach(r => {
    const dt = r.business_date
    if (!byDate[dt]) byDate[dt] = { cost: 0, sales: 0 }
    byDate[dt].cost += Number(r.total_cost) || 0
    byDate[dt].sales += Number(r.net_sales) || 0
  })
  const dailyLines = Object.entries(byDate).sort().map(([dt, v]) => {
    const [y, m, d] = dt.split('-').map(Number)
    const dayName = dayNames[new Date(y, m - 1, d).getDay()]
    return `${dt} (${dayName}): Cost ${fmt$(v.cost)} / Sales ${fmt$(v.sales)} = ${v.sales > 0 ? ((v.cost/v.sales)*100).toFixed(1) : 0}%`
  })

  return `Food Cost ${args.start_date} to ${args.end_date}:\nTotal Cost: ${fmt$(totalCost)} | Sales: ${fmt$(totalSales)} | Food Cost: ${pct}%\n\nBy Store:\n${lines.join('\n')}\n\nDaily Breakdown:\n${dailyLines.join('\n')}`
}

// ── 3. Labor ──
async function queryLabor(args: any): Promise<string> {
  let query = supabaseAdmin
    .from('punches')
    .select('employee_name, store_id, in_date, hours_worked, is_overtime, regular_rate, overtime_rate')
    .gte('in_date', args.start_date)
    .lte('in_date', args.end_date)

  if (args.employee_name) query = query.ilike('employee_name', `%${args.employee_name}%`)

  const { data, error } = await query.limit(2000)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No punch data for ${args.start_date} to ${args.end_date}.`

  const { idToName } = await getStoreMaps()
  const byEmp: Record<string, { hours: number; ot: number; punches: number; store: string }> = {}
  let totalH = 0, totalOT = 0
  data.forEach(p => {
    const h = Number(p.hours_worked) || 0
    totalH += h; if (p.is_overtime) totalOT++
    const name = p.employee_name || '?'
    if (!byEmp[name]) byEmp[name] = { hours: 0, ot: 0, punches: 0, store: idToName[p.store_id] || '' }
    byEmp[name].hours += h; if (p.is_overtime) byEmp[name].ot++; byEmp[name].punches++
  })

  const uniq = Object.keys(byEmp).length
  const top = Object.entries(byEmp).sort((a, b) => b[1].hours - a[1].hours).slice(0, 20)
    .map(([n, v]) => `${n} [${v.store}]: ${v.hours.toFixed(1)}h in ${v.punches} shifts${v.ot > 0 ? ` (${v.ot} OT)` : ''}`)

  return `Labor ${args.start_date} to ${args.end_date}:\nTotal: ${totalH.toFixed(1)}h | ${data.length} punches | ${uniq} employees | ${totalOT} overtime\n\nTop employees:\n${top.join('\n')}`
}

// ── 4. Inspections ──
async function queryInspections(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const { data: users } = await supabaseAdmin.from('users').select('id, full_name')
  const userMap: Record<string, string> = {};
  (users || []).forEach(u => { userMap[u.id] = u.full_name || '?' })

  let query = supabaseAdmin
    .from('supervisor_inspections')
    .select('id, store_id, inspector_id, overall_score, inspection_date, estatus_admin, shift')
    .gte('inspection_date', args.start_date)
    .lte('inspection_date', args.end_date)
    .order('inspection_date', { ascending: false })

  if (args.store_name) {
    const storeIds = await getStoreIdsByName(args.store_name)
    if (storeIds.length) query = query.in('store_id', storeIds)
  }

  const { data, error } = await query.limit(500)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No inspections for ${args.start_date} to ${args.end_date}.`

  const avg = Math.round(data.reduce((s, i) => s + (i.overall_score || 0), 0) / data.length)
  const pending = data.filter(i => !i.estatus_admin || i.estatus_admin === 'pendiente').length
  const approved = data.filter(i => ['aprobado', 'cerrado'].includes(i.estatus_admin || '')).length

  const bySup: Record<string, { count: number; score: number }> = {}
  data.forEach(i => {
    const n = userMap[i.inspector_id] || '?'
    if (!bySup[n]) bySup[n] = { count: 0, score: 0 }
    bySup[n].count++; bySup[n].score += (i.overall_score || 0)
  })
  const supLines = Object.entries(bySup).sort((a, b) => b[1].count - a[1].count)
    .map(([n, v]) => `${n}: ${v.count} inspections (avg ${Math.round(v.score / v.count)}%)`)

  return `Inspections ${args.start_date} to ${args.end_date}:\nTotal: ${data.length} | Avg Score: ${avg}% | Pending: ${pending} | Approved: ${approved}\n\nBy Inspector:\n${supLines.join('\n')}`
}

// ── 5. Discounts ──
async function queryDiscounts(args: any): Promise<string> {
  let query = supabaseAdmin
    .from('sales_discounts_log')
    .select('store_name, discount_name, discount_amount, business_date, server_name, approver_name')
    .gte('business_date', args.start_date)
    .lte('business_date', args.end_date)
    .order('discount_amount', { ascending: false })

  if (args.store_name) query = query.ilike('store_name', `%${args.store_name}%`)
  if (args.discount_name) query = query.ilike('discount_name', `%${args.discount_name}%`)

  const { data, error } = await query.limit(500)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No discounts for ${args.start_date} to ${args.end_date}.`

  const byType: Record<string, { count: number; amount: number }> = {}
  let totalAmt = 0
  data.forEach(d => {
    const amt = Math.abs(Number(d.discount_amount) || 0)
    totalAmt += amt
    const name = d.discount_name || '?'
    if (!byType[name]) byType[name] = { count: 0, amount: 0 }
    byType[name].count++; byType[name].amount += amt
  })

  const lines = Object.entries(byType).sort((a, b) => b[1].amount - a[1].amount)
    .map(([n, v]) => `${n}: ${v.count}x = ${fmt$(v.amount)}`)

  return `Discounts ${args.start_date} to ${args.end_date}:\nTotal: ${data.length} discounts = ${fmt$(totalAmt)}\n\nBy Type:\n${lines.join('\n')}`
}

// ── 6. Schedules ──
async function querySchedules(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const { data: users } = await supabaseAdmin.from('users').select('id, full_name, role, position_type, store_id').eq('is_active', true)
  const userMap: Record<string, { name: string; role: string; store: string }> = {};
  (users || []).forEach(u => {
    userMap[String(u.id)] = { name: u.full_name || '?', role: `${u.role || ''}${u.position_type ? ` (${u.position_type})` : ''}`, store: idToName[u.store_id] || '' }
  })

  let query = supabaseAdmin.from('schedules')
    .select('user_id, store_id, date, start_time, end_time, shift_label')
    .gte('date', args.start_date).lte('date', args.end_date).limit(5000)

  const { data, error } = await query
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No schedules for ${args.start_date} to ${args.end_date}.`

  const byUser: Record<string, { name: string; role: string; store: string; days: Record<string, string> }> = {}

  data.forEach((s: any) => {
    const uid = String(s.user_id)
    const u = userMap[uid]
    if (!byUser[uid]) {
      byUser[uid] = { name: u?.name || uid.slice(0, 8), role: u?.role || '', store: u?.store || idToName[s.store_id] || '', days: {} }
    }
    const time = s.start_time && s.end_time ? `${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)}` : (s.shift_label || 'ON')
    byUser[uid].days[s.date] = time
  })

  if (args.employee_name) {
    const filter = args.employee_name.toLowerCase()
    Object.keys(byUser).forEach(k => { if (!byUser[k].name.toLowerCase().includes(filter)) delete byUser[k] })
  }

  const lines = Object.values(byUser).sort((a, b) => a.name.localeCompare(b.name))
    .map(u => {
      const dayStr = Object.entries(u.days).sort().map(([d, t]) => `${d}: ${t}`).join(' | ')
      return `${u.name} (${u.role}) [${u.store}]: ${dayStr}`
    })

  return `Schedules ${args.start_date} to ${args.end_date}:\n${Object.keys(byUser).length} employees\n\n${lines.join('\n')}`
}

// ── 7. Employees ──
async function queryEmployees(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()

  let query = supabaseAdmin.from('users').select('id, full_name, role, email, store_id, position_type, is_active')
  if (args.role) query = query.ilike('role', `%${args.role}%`)

  const { data, error } = await query.limit(500)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No employees found.'

  let filtered = data
  if (args.store_name) {
    const sn = args.store_name.toLowerCase()
    filtered = data.filter(u => (idToName[u.store_id] || '').toLowerCase().includes(sn))
  }

  const byRole: Record<string, number> = {}
  filtered.forEach(u => { byRole[u.role || 'none'] = (byRole[u.role || 'none'] || 0) + 1 })

  const lines = filtered.map(u => `${u.full_name || '?'} | ${u.role || '?'} | ${u.position_type || ''} | ${idToName[u.store_id] || '?'} | ${u.is_active ? 'Active' : 'Inactive'}`)

  const roleSummary = Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r}: ${c}`).join(', ')

  return `Employees (${filtered.length} total):\nBy Role: ${roleSummary}\n\n${lines.join('\n')}`
}

// ── 8. Inventory ──
async function queryInventory(args: any): Promise<string> {
  let query = supabaseAdmin.from('inventory_items').select('id, name, category_id, unit_type, purchase_unit_cost, yield_percent, unit_measure')
  if (args.category) query = query.ilike('category', `%${args.category}%`)
  if (args.item_name) query = query.ilike('name', `%${args.item_name}%`)

  const { data, error } = await query.order('name').limit(200)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No inventory items found.'

  const byCat: Record<string, number> = {}
  data.forEach(i => { byCat[i.category_id || 'none'] = (byCat[i.category_id || 'none'] || 0) + 1 })

  const lines = data.map(i => `${i.name} | ${i.unit_type || '?'} | ${fmt$(Number(i.purchase_unit_cost) || 0)}/${i.unit_measure || 'u'} | yield: ${i.yield_percent || 100}%`)

  return `Inventory (${data.length} items):\nBy Category: ${Object.entries(byCat).map(([c, n]) => `${c}: ${n}`).join(', ')}\n\n${lines.join('\n')}`
}

// ── 9. Feedback ──
async function queryFeedback(args: any): Promise<string> {
  const parts: string[] = []

  // Customer feedback / Google reviews
  if (!args.source || args.source !== 'internal') {
    const { data } = await supabaseAdmin.from('customer_feedback')
      .select('store_name, rating, nps_score, comments, source, submission_date')
      .gte('submission_date', args.start_date).lte('submission_date', args.end_date)
      .order('submission_date', { ascending: false }).limit(50)

    if (data?.length) {
      const avg = (data.reduce((s, r) => s + (Number(r.rating) || 0), 0) / data.length).toFixed(1)
      const lines = data.slice(0, 15).map(r => `[${r.submission_date}] ${clean(r.store_name)} ★${r.rating} (${r.source || 'google'}): ${(r.comments || '').slice(0, 100)}`)
      parts.push(`Customer Reviews (${data.length}): Avg ${avg}★\n${lines.join('\n')}`)
    }
  }

  // Internal feedback
  if (!args.source || args.source !== 'google') {
    const { data } = await supabaseAdmin.from('system_feedback')
      .select('id, category, message, status, created_at')
      .gte('created_at', args.start_date).lte('created_at', args.end_date)
      .order('created_at', { ascending: false }).limit(30)

    if (data?.length) {
      parts.push(`Internal Feedback (${data.length}): ${data.map(f => `[${f.category || '?'}] ${(f.message || '').slice(0, 80)}`).join('\n')}`)
    }
  }

  return parts.length ? parts.join('\n\n') : `No feedback for ${args.start_date} to ${args.end_date}.`
}

// ── 10. Stores ──
async function queryStores(): Promise<string> {
  const { data, error } = await supabaseAdmin.from('stores').select('id, name, code, external_id, address, city, state, zip_code, phone, is_active, has_drive_thru, opening_time, closing_time, supervisor_name')
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No stores found.'

  const lines = data.map(s => `${clean(s.name)} (Code: ${s.code || '-'}) | ID: ${s.id} | External: ${s.external_id || '-'} | Active: ${s.is_active} | Drive-Thru: ${s.has_drive_thru} | Hours: ${s.opening_time || '-'}-${s.closing_time || '-'} | Supervisor: ${s.supervisor_name || '-'} | ${s.address || ''}, ${s.city || ''}, ${s.state || ''} ${s.zip_code || ''}`)
  return `Stores (${data.length}):\n${lines.join('\n')}`
}

// ── 11. Menu & Recipes ──
async function queryMenuRecipes(args: any): Promise<string> {
  const parts: string[] = []

  let menuItems: any[] = []
  const searchTerm = args.item_name || ''

  if (searchTerm) {
    // STEP 1: Search REAL menu items first (not modifiers)
    const { data: mainItems } = await supabaseAdmin.from('toast_menu_items')
      .select('guid, name, price, group_name, is_modifier')
      .eq('active', true)
      .eq('is_modifier', false)
      .ilike('name', `%${searchTerm}%`)
      .order('name').limit(50)

    // STEP 2: Also search by group_name for broader matches
    const { data: groupItems } = await supabaseAdmin.from('toast_menu_items')
      .select('guid, name, price, group_name, is_modifier')
      .eq('active', true)
      .eq('is_modifier', false)
      .ilike('group_name', `%${searchTerm}%`)
      .order('name').limit(50)

    // Merge unique results
    const seen = new Set<string>()
    const merged: any[] = []
    for (const item of [...(mainItems || []), ...(groupItems || [])]) {
      if (!seen.has(item.guid)) { seen.add(item.guid); merged.push(item) }
    }
    menuItems = merged

    // STEP 3: If no real items, try modifiers too
    if (menuItems.length === 0) {
      const { data: allItems } = await supabaseAdmin.from('toast_menu_items')
        .select('guid, name, price, group_name, is_modifier')
        .eq('active', true)
        .ilike('name', `%${searchTerm}%`)
        .order('name').limit(50)
      menuItems = allItems || []
    }
  } else if (args.group_name) {
    const { data } = await supabaseAdmin.from('toast_menu_items')
      .select('guid, name, price, group_name, is_modifier')
      .eq('active', true)
      .ilike('group_name', `%${args.group_name}%`)
      .order('name').limit(100)
    menuItems = data || []
  } else {
    const { data } = await supabaseAdmin.from('toast_menu_items')
      .select('guid, name, price, group_name, is_modifier')
      .eq('active', true).eq('is_modifier', false).order('group_name').limit(200)
    menuItems = data || []
  }

  if (!menuItems.length) return `No menu items found for "${searchTerm || args.group_name || 'all'}".`

  // Show found items
  const mainDishes = menuItems.filter(m => !m.is_modifier)
  const modifiers = menuItems.filter(m => m.is_modifier)

  if (mainDishes.length) {
    const lines = mainDishes.map(m => `${m.name}: ${fmt$(Number(m.price) || 0)} [${m.group_name || '?'}]`)
    parts.push(`Menu Items (${mainDishes.length}):\n${lines.join('\n')}`)
  }
  if (modifiers.length) {
    const lines = modifiers.map(m => `${m.name}: ${fmt$(Number(m.price) || 0)} [${m.group_name || '?'}]`)
    parts.push(`Add-ons/Modifiers (${modifiers.length}):\n${lines.join('\n')}`)
  }

  // RECIPE DETAILS — look up ingredients for all found items
  const guids = menuItems.map(m => m.guid).filter(Boolean)
  if (guids.length > 0) {
    const { data: recipes, error: recErr } = await supabaseAdmin.from('recipes')
      .select('toast_menu_item_guid, inventory_item_id, quantity, unit, type')
      .in('toast_menu_item_guid', guids)

    if (recErr) {
      parts.push(`Recipe lookup error: ${recErr.message}`)
    } else if (recipes?.length) {
      // Get ingredient details
      const invIds = [...new Set(recipes.map(r => r.inventory_item_id).filter(Boolean))]

      const { data: invItems, error: invErr } = await supabaseAdmin.from('inventory_items')
        .select('id, name, purchase_unit_cost, unit_type, unit_measure, yield_percent, quantity_per_unit').in('id', invIds)

      // Build inventory map
      const invMap: Record<string, { name: string; data: InventoryCostData }> = {};

      if (invItems?.length) {
        invItems.forEach(i => {
          invMap[i.id] = {
            name: i.name,
            data: {
              purchase_unit_cost: Number(i.purchase_unit_cost) || 0,
              quantity_per_unit: Number(i.quantity_per_unit) || 1,
              unit_measure: i.unit_measure || '',
              unit_type: i.unit_type || '',
              yield_percent: Number(i.yield_percent) || 100
            }
          }
        })
      } else if (invIds.length > 0) {
        // Fallback: individual lookups
        for (const invId of invIds) {
          const { data: single } = await supabaseAdmin.from('inventory_items')
            .select('id, name, purchase_unit_cost, unit_type, unit_measure, yield_percent, quantity_per_unit').eq('id', invId).single()
          if (single) {
            invMap[single.id] = {
              name: single.name,
              data: {
                purchase_unit_cost: Number(single.purchase_unit_cost) || 0,
                quantity_per_unit: Number(single.quantity_per_unit) || 1,
                unit_measure: single.unit_measure || '',
                unit_type: single.unit_type || '',
                yield_percent: Number(single.yield_percent) || 100
              }
            }
          }
        }
      }

      // Group by menu item — use calculateIngredientCost (same engine as food cost module)
      const guidToName: Record<string, { name: string; price: number }> = {}
      menuItems.forEach(m => { if (m.guid) guidToName[m.guid] = { name: m.name, price: Number(m.price) || 0 } })

      const byItem: Record<string, { lines: string[]; totalCost: number; price: number }> = {}
      recipes.forEach(r => {
        const mi = guidToName[r.toast_menu_item_guid]
        const itemName = mi?.name || '?'
        if (!byItem[itemName]) byItem[itemName] = { lines: [], totalCost: 0, price: mi?.price || 0 }
        const inv = invMap[r.inventory_item_id]
        if (!inv) {
          byItem[itemName].lines.push(`  ?: ${r.quantity} ${r.unit} (ingredient not found)`)
          return
        }
        // Use the EXACT same formula as the food cost engine
        const cost = calculateIngredientCost(r.quantity, r.unit, inv.data, r.type || 'cooked')
        const costPerUnit = (inv.data.purchase_unit_cost || 0) / (inv.data.quantity_per_unit || 1)
        byItem[itemName].totalCost += cost
        byItem[itemName].lines.push(
          `  ${inv.name}: ${r.quantity} ${r.unit} × ${fmt$(costPerUnit)}/${inv.data.unit_measure || 'u'} = ${fmt$(cost)}${(inv.data.yield_percent || 100) < 100 ? ` (yield ${inv.data.yield_percent}%)` : ''}`
        )
      })

      const recipeOutput = Object.entries(byItem).map(([itemName, data]) => {
        const margin = data.price > 0 ? ((data.price - data.totalCost) / data.price * 100).toFixed(1) : '?'
        return `📦 ${itemName} — Price: ${fmt$(data.price)} | Ingredient Cost: ${fmt$(data.totalCost)} | Margin: ${margin}%\n${data.lines.join('\n')}`
      })
      parts.push(`\nRecipe Breakdown:\n${recipeOutput.join('\n\n')}`)
    } else {
      parts.push(`No recipes configured for these items in the system.`)
    }
  }

  return parts.join('\n\n')
}

// ── 12. Checklists ──
async function queryChecklists(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const parts: string[] = []

  // Assistant checklists
  if (!args.type || args.type !== 'manager') {
    let q = supabaseAdmin.from('assistant_checklists')
      .select('id, store_id, checklist_type, checklist_date, shift, score, user_name, estatus_admin, estatus_supervisor')
      .gte('checklist_date', args.start_date).lte('checklist_date', args.end_date)
      .order('checklist_date', { ascending: false })
    const { data } = await q.limit(200)

    if (data?.length) {
      let filtered = data
      if (args.store_name) {
        const sn = args.store_name.toLowerCase()
        filtered = data.filter(c => (idToName[c.store_id] || '').toLowerCase().includes(sn))
      }
      const avgScore = filtered.length > 0 ? Math.round(filtered.reduce((s, c) => s + (Number(c.score) || 0), 0) / filtered.length) : 0
      const byStore: Record<string, number> = {}
      filtered.forEach(c => { const n = idToName[c.store_id] || '?'; byStore[n] = (byStore[n] || 0) + 1 })
      const storeLines = Object.entries(byStore).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}: ${c}`)
      parts.push(`Assistant Checklists (${filtered.length}): Avg Score: ${avgScore}%\nBy Store: ${storeLines.join(' | ')}\nRecent: ${filtered.slice(0, 10).map(c => `${c.checklist_date} ${idToName[c.store_id] || '?'} ${c.user_name || '?'} (${c.shift || '?'}) Score:${c.score}%`).join('\n')}`)
    }
  }

  // Manager checklists
  if (!args.type || args.type !== 'assistant') {
    let q = supabaseAdmin.from('manager_checklists')
      .select('id, store_id, manager_name, checklist_date, shift, score, estatus_admin, estatus_supervisor')
      .gte('checklist_date', args.start_date).lte('checklist_date', args.end_date)
      .order('checklist_date', { ascending: false })
    const { data } = await q.limit(200)

    if (data?.length) {
      let filtered = data
      if (args.store_name) {
        const sn = args.store_name.toLowerCase()
        filtered = data.filter(c => (idToName[c.store_id] || '').toLowerCase().includes(sn))
      }
      const avgScore = filtered.length > 0 ? Math.round(filtered.reduce((s, c) => s + (Number(c.score) || 0), 0) / filtered.length) : 0
      parts.push(`Manager Checklists (${filtered.length}): Avg Score: ${avgScore}%\nRecent: ${filtered.slice(0, 10).map(c => `${c.checklist_date} ${idToName[c.store_id] || '?'} ${c.manager_name || '?'} (${c.shift || '?'}) Score:${c.score}%`).join('\n')}`)
    }
  }

  return parts.length ? parts.join('\n\n') : `No checklists for ${args.start_date} to ${args.end_date}.`
}

// ── 13. Violations, Budgets, Evaluations, Inspection Comments ──
async function queryViolationsBudgets(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const parts: string[] = []
  const dt = args.data_type || 'all'

  // Punch violations
  if (dt === 'all' || dt === 'violations') {
    const { data } = await supabaseAdmin.from('punch_violations')
      .select('id, store_id, employee_toast_guid, business_date, violation_type, actual_minutes, allowed_minutes, status')
      .gte('business_date', args.start_date).lte('business_date', args.end_date)
      .order('business_date', { ascending: false }).limit(300)
    if (data?.length) {
      let filtered = data
      if (args.store_name) {
        const sn = args.store_name.toLowerCase()
        filtered = data.filter(v => (idToName[v.store_id] || '').toLowerCase().includes(sn))
      }
      const byType: Record<string, number> = {}
      filtered.forEach(v => { byType[v.violation_type || '?'] = (byType[v.violation_type || '?'] || 0) + 1 })
      const typeLines = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}: ${c}`)
      parts.push(`Punch Violations (${filtered.length}):\nBy Type: ${typeLines.join(' | ')}`)
    }
  }

  // Weekly budgets
  if (dt === 'all' || dt === 'budgets') {
    const { data } = await supabaseAdmin.from('weekly_budgets')
      .select('store_id, week_start, sales_projections, labor_target')
      .gte('week_start', args.start_date).lte('week_start', args.end_date)
      .order('week_start', { ascending: false }).limit(100)
    if (data?.length) {
      const lines = data.map(b => `${idToName[b.store_id] || '?'} (${b.week_start}): Target Sales: ${JSON.stringify(b.sales_projections)} | Labor Target: ${b.labor_target || '?'}%`)
      parts.push(`Weekly Budgets (${data.length}):\n${lines.join('\n')}`)
    }
  }

  // Staff evaluations
  if (dt === 'all' || dt === 'evaluations') {
    const { data } = await supabaseAdmin.from('staff_evaluations')
      .select('id, store_id, evaluation_date, evaluator_name, evaluated_name, evaluated_role, desempeno_general, fortalezas, areas_mejora')
      .gte('evaluation_date', args.start_date).lte('evaluation_date', args.end_date)
      .order('evaluation_date', { ascending: false }).limit(50)
    if (data?.length) {
      let filtered = data
      if (args.store_name) {
        const sn = args.store_name.toLowerCase()
        filtered = data.filter(e => (idToName[e.store_id] || '').toLowerCase().includes(sn))
      }
      const lines = filtered.map(e => `${e.evaluation_date} ${idToName[e.store_id] || '?'}: ${e.evaluated_name} (${e.evaluated_role || '?'}) by ${e.evaluator_name} — Rating: ${e.desempeno_general || '?'}/5 | Strengths: ${(e.fortalezas || '').slice(0, 80)} | Improve: ${(e.areas_mejora || '').slice(0, 80)}`)
      parts.push(`Staff Evaluations (${filtered.length}):\n${lines.join('\n')}`)
    }
  }

  // Inspection comments
  if (dt === 'all' || dt === 'inspection_comments') {
    const { data } = await supabaseAdmin.from('inspection_comments')
      .select('id, inspection_id, user_name, user_role, content, created_at')
      .gte('created_at', args.start_date).lte('created_at', args.end_date + 'T23:59:59')
      .order('created_at', { ascending: false }).limit(50)
    if (data?.length) {
      const lines = data.map(c => `[${c.created_at?.slice(0, 10)}] ${c.user_name} (${c.user_role}): ${(c.content || '').slice(0, 120)}`)
      parts.push(`Inspection Comments (${data.length}):\n${lines.join('\n')}`)
    }
  }

  return parts.length ? parts.join('\n\n') : `No data for ${args.start_date} to ${args.end_date}.`
}

// ── 14. Product Mix & Meat Consumption ──
async function queryProductMix(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const parts: string[] = []
  const dt = args.data_type || 'all'

  // PMIX (product mix) — items is a JSONB column with array of sold items
  if (dt === 'all' || dt === 'pmix') {
    let q = supabaseAdmin.from('pmix_daily_cache')
      .select('business_date, store_id, items')
      .gte('business_date', args.start_date).lte('business_date', args.end_date)
    if (args.store_name) {
      const matchIds = await getStoreIdsByName(args.store_name)
      if (matchIds.length) q = q.in('store_id', matchIds)
    }
    const { data } = await q.limit(500)
    if (data?.length) {
      // Aggregate items across all days/stores
      const itemTotals: Record<string, { qty: number; sales: number }> = {}
      data.forEach(row => {
        const items = Array.isArray(row.items) ? row.items : []
        items.forEach((item: any) => {
          const name = item.name || item.menuItem || '?'
          if (!itemTotals[name]) itemTotals[name] = { qty: 0, sales: 0 }
          itemTotals[name].qty += Number(item.quantity || item.qty || 0)
          itemTotals[name].sales += Number(item.sales || item.netSales || item.amount || 0)
        })
      })
      const topItems = Object.entries(itemTotals).sort((a, b) => b[1].sales - a[1].sales).slice(0, 30)
        .map(([name, v]) => `${name}: ${v.qty} sold = ${fmt$(v.sales)}`)
      parts.push(`Product Mix ${args.start_date} to ${args.end_date} (${data.length} day-store records):\nTop Items:\n${topItems.join('\n')}`)
    }
  }

  // Meat consumption
  if (dt === 'all' || dt === 'meat') {
    let q = supabaseAdmin.from('meat_consumption_history')
      .select('store_id, business_date, meat_type, raw_lbs')
      .gte('business_date', args.start_date).lte('business_date', args.end_date)
      .order('business_date', { ascending: true })
    if (args.store_name) {
      const matchIds = await getStoreIdsByName(args.store_name)
      if (matchIds.length) q = q.in('store_id', matchIds)
    }
    const { data } = await q.limit(500)
    if (data?.length) {
      const byMeat: Record<string, number> = {}
      data.forEach(r => {
        const mt = r.meat_type || '?'
        byMeat[mt] = (byMeat[mt] || 0) + (Number(r.raw_lbs) || 0)
      })
      const meatLines = Object.entries(byMeat).sort((a, b) => b[1] - a[1])
        .map(([mt, lbs]) => `${mt}: ${lbs.toFixed(1)} lbs`)
      parts.push(`Meat Consumption ${args.start_date} to ${args.end_date}:\n${meatLines.join('\n')}`)
    }
  }

  return parts.length ? parts.join('\n\n') : `No product mix or meat data for ${args.start_date} to ${args.end_date}.`
}

// ── 15. Forecast ──
async function queryForecast(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const storeNameInput = (args.store_name || '').toLowerCase().trim()
  
  const matchedStoreEntry = Object.entries(idToName).find(([, name]) => name.toLowerCase().includes(storeNameInput))
  if (!matchedStoreEntry) {
    return `Store matching "${args.store_name}" not found. Available stores: ${Object.values(idToName).join(', ')}`
  }
  
  const [storeId, storeName] = matchedStoreEntry
  const targetDate = args.target_date
  
  try {
    const forecast = await generateSmartForecast(storeId, targetDate)
    
    const lines = [
      `🔮 **Smart Forecast Projection for ${storeName} on ${targetDate}**`,
      `================================================================`,
      `*   **Base Historical Sales:** ${fmt$(forecast.base_sales || 0)}`,
      `*   **Growth Factor Applied:** ${((forecast.growth_factor_applied || 1.0) * 100).toFixed(1)}%`,
      `*   **Weather Adjustment:** ${forecast.weather_adjustment ? '⚠️ Severe Weather Penalty Applied (-5%)' : '✅ None'}`,
      `*   **Projected Net Sales:** **${fmt$(forecast.total_sales || 0)}**`,
      ``,
      `| Hour | Projected Sales | Projected Tickets | Required Cooks | Required Cashiers | Reasoning |`,
      `| :--- | :-------------- | :---------------- | :------------- | :---------------- | :-------- |`
    ]
    
    const sortedHours = [...(forecast.hours || [])].sort((a, b) => a.hour - b.hour)
    const maxSales = forecast.hours?.reduce((m, hr) => hr.projected_sales > m ? hr.projected_sales : m, 0) || 1
    
    sortedHours.forEach(h => {
      const displayHour = h.hour >= 24 ? `${h.hour - 24}:00 (Next Day)` : `${h.hour}:00`
      const isPeak = h.projected_sales > 0 && h.projected_sales >= (maxSales * 0.85)
      
      const salesText = isPeak ? `🔥 **${fmt$(h.projected_sales)}**` : fmt$(h.projected_sales)
      
      lines.push(
        `| ${displayHour} | ${salesText} | ${h.projected_tickets.toFixed(0)} | ${h.required_kitchen} | ${h.required_foh} | ${h.reasoning} |`
      )
    })
    
    return lines.join('\n')
  } catch (error: any) {
    return `Error generating forecast: ${error.message}`
  }
}

// ── 16. Calculate Breaks ──
async function calculateBreaks(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const storeNameInput = (args.store_name || '').toLowerCase().trim()
  
  const matchedStoreEntry = Object.entries(idToName).find(([, name]) => name.toLowerCase().includes(storeNameInput))
  if (!matchedStoreEntry) {
    return `Store matching "${args.store_name}" not found. Available stores: ${Object.values(idToName).join(', ')}`
  }
  
  const [storeId, storeName] = matchedStoreEntry
  const targetDate = args.target_date
  
  try {
    const { data: dbShifts, error: shiftErr } = await supabaseAdmin
      .from('shifts')
      .select('*')
      .eq('store_id', storeId)
      .eq('shift_date', targetDate)
      
    if (shiftErr) return `Database error fetching shifts: ${shiftErr.message}`
    if (!dbShifts?.length) return `No scheduled shifts found for ${storeName} on ${targetDate}. Breaks can only be calculated for scheduled days.`
    
    const { data: employees } = await supabaseAdmin.from('toast_employees').select('*')
    const { data: jobs } = await supabaseAdmin.from('toast_jobs').select('*')
    
    const forecast = await generateSmartForecast(storeId, targetDate)
    const hours = forecast.hours || []
    
    const presentShifts = dbShifts.filter(s => s.employee_id !== null && s.is_callback !== true)
    
    const shiftsForAi = presentShifts.map(s => {
      const emp = (employees || []).find(e => e.id === s.employee_id || e.toast_guid === s.employee_toast_guid)
      let extTitle = ''
      if (emp && emp.job_references && emp.job_references.length > 0) {
        const jobRef = emp.job_references[0]
        if (jobRef.title) extTitle = jobRef.title
        else {
          const job = (jobs || []).find(j => j.guid === jobRef.guid || String(j.id) === jobRef.guid)
          if (job) extTitle = job.title
        }
      }
      if (!extTitle) {
        const shiftJob = (jobs || []).find(j => j.guid === s.job_id || String(j.id) === String(s.job_id))
        if (shiftJob) extTitle = shiftJob.title
      }
      if (!extTitle && emp) extTitle = 'cook'
      
      const titleLowerCase = extTitle.toLowerCase()
      const employeeName = emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown Staff'
      const isLeader = titleLowerCase.includes('manager') || titleLowerCase.includes('asst') || titleLowerCase.includes('shift') || titleLowerCase.includes('lead') || titleLowerCase.includes('asistente') || titleLowerCase.includes('assistant') || titleLowerCase.includes('encargado') || employeeName.toLowerCase().includes('manager')
      
      return {
        ...s,
        is_leader: isLeader,
        job_title: extTitle,
        employee_name: employeeName
      }
    })
    
    const { data: prefData } = await supabaseAdmin
      .from('break_manual_overrides')
      .select('*')
      .eq('store_id', storeId)
      
    const learnedPrefs = prefData || []
    
    const calculatedShifts = scheduleBreaksWithDemand(shiftsForAi as any, hours, learnedPrefs)
    
    const lines = [
      `📅 **California-Compliant AI Breaks Schedule for ${storeName} on ${targetDate}**`,
      `========================================================================`,
      `🤖 *Processed by TEG AI Breaks Engine V25 (Strict spacing & Peak-aware)*`,
      ``,
      `| Employee | Position | Shift Hours | Scheduled Lunches & Breaks |`,
      `| :--- | :--- | :--- | :--- |`
    ]
    
    calculatedShifts.forEach((s: any) => {
      const formatTime = (iso: string) => {
        try {
          const d = new Date(iso)
          return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })
        } catch {
          return iso
        }
      }
      
      const startDisplay = formatTime(s.start_time)
      const endDisplay = formatTime(s.end_time)
      
      const breakTextList = (s.breaks_schedule || []).map((b: any) => {
        const typeLabel = b.type === 'meal_30' ? '🍔 Meal (30m)' : '☕ Break (10m)'
        return `**${typeLabel}:** ${formatTime(b.start_time)} - ${formatTime(b.end_time)}`
      })
      
      const breakSummary = breakTextList.length > 0 ? breakTextList.join('<br>') : '*None required (Short shift)*'
      
      lines.push(
        `| **${s.employee_name}** | ${s.job_title} | ${startDisplay} - ${endDisplay} | ${breakSummary} |`
      )
    })
    
    return lines.join('\n')
  } catch (error: any) {
    return `Error simulating breaks schedule: ${error.message}`
  }
}

// ── 17. Analyze Performance ──
async function analyzePerformance(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  const storeNameInput = (args.store_name || '').toLowerCase().trim()
  
  const matchedStoreEntry = Object.entries(idToName).find(([, name]) => name.toLowerCase().includes(storeNameInput))
  if (!matchedStoreEntry) {
    return `Store matching "${args.store_name}" not found. Available stores: ${Object.values(idToName).join(', ')}`
  }
  
  const [storeId, storeName] = matchedStoreEntry
  const { start_date, end_date } = args
  
  try {
    const { data: salesData } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('business_date, net_sales, labor_cost, order_count, total_tickets')
      .eq('store_id', storeId)
      .gte('business_date', start_date)
      .lte('business_date', end_date)
      .order('business_date', { ascending: true })
      
    const { data: foodData } = await supabaseAdmin
      .from('food_cost_daily_cache')
      .select('business_date, total_cost, cost_percentage')
      .eq('store_id', storeId)
      .gte('business_date', start_date)
      .lte('business_date', end_date)
      
    const { data: violations } = await supabaseAdmin
      .from('punch_violations')
      .select('violation_type, business_date')
      .eq('store_id', storeId)
      .gte('business_date', start_date)
      .lte('business_date', end_date)
      
    if (!salesData?.length) {
      return `No actual sales data found for ${storeName} from ${start_date} to ${end_date} to perform audit.`
    }
    
    let totalSales = 0
    let totalLabor = 0
    let totalOrders = 0
    let daysWithSales = salesData.length
    
    salesData.forEach(d => {
      totalSales += Number(d.net_sales) || 0
      totalLabor += Number(d.labor_cost) || 0
      totalOrders += Number(d.order_count || d.total_tickets) || 0
    })
    
    let totalFoodCost = 0
    foodData?.forEach(f => {
      if (Number(f.total_cost) > 0) {
        totalFoodCost += Number(f.total_cost)
      }
    })
    
    const actualLaborPct = totalSales > 0 ? (totalLabor / totalSales) * 100 : 0
    const actualFoodPct = totalSales > 0 && totalFoodCost > 0 ? (totalFoodCost / totalSales) * 100 : 0
    const primeCostPct = actualLaborPct + actualFoodPct
    
    const laborTarget = 21.5
    const foodTarget = 32.0
    const primeTarget = 53.5
    
    const laborStatus = actualLaborPct <= laborTarget ? '🟢 HEALTHY (Cumple Meta)' : actualLaborPct <= 23.5 ? '🟡 WARNING (Elevado)' : '🔴 CRITICAL (Sobrepresupuesto)'
    const foodStatus = actualFoodPct > 0 ? (actualFoodPct <= foodTarget ? '🟢 HEALTHY (Cumple Meta)' : actualFoodPct <= 35.0 ? '🟡 WARNING (Elevado)' : '🔴 CRITICAL (Alto Desperdicio/Precios)') : '⚪ N/A (Sin datos de recetas)'
    const primeStatus = primeCostPct > 0 ? (primeCostPct <= primeTarget ? '🟢 HEALTHY' : '🔴 CRITICAL (Fuera de Meta Global)') : '⚪ N/A'
    
    const lines = [
      `📊 **Operational Performance Deep Audit for ${storeName}**`,
      `📅 **Period:** ${start_date} to ${end_date} (${daysWithSales} days)`,
      `========================================================================`,
      `### 💰 Financial KPI scorecard`,
      `*   **Net Sales Total:** **${fmt$(totalSales)}** (Avg: ${fmt$(totalSales / daysWithSales)}/day)`,
      `*   **Total Orders:** **${totalOrders}** (ATV: ${fmt$(totalSales / (totalOrders || 1))})`,
      `*   **Labor Cost:** **${fmt$(totalLabor)}** | **${actualLaborPct.toFixed(1)}%** (Meta: <21.5%) -> **${laborStatus}**`,
      `*   **Food Cost (Theoretical):** ${totalFoodCost > 0 ? `**${fmt$(totalFoodCost)}** | **${actualFoodPct.toFixed(1)}%**` : '*N/A*'} (Meta: <32.0%) -> **${foodStatus}**`,
      `*   **Prime Cost (Labor + Food):** ${primeCostPct > 0 ? `**${primeCostPct.toFixed(1)}%**` : '*N/A*'} (Meta: <53.5%) -> **${primeStatus}**`,
      ``,
      `### ⚖️ Labor Compliance & Violations`,
      `*   **Total Punch Violations:** **${violations?.length || 0}** cases detected.`
    ]
    
    if (violations?.length) {
      const byType: Record<string, number> = {}
      violations.forEach(v => {
        byType[v.violation_type] = (byType[v.violation_type] || 0) + 1
      })
      Object.entries(byType).forEach(([type, count]) => {
        lines.push(`    *   ⚠️ **${type}:** ${count} cases`)
      })
    } else {
      lines.push(`    *   ✅ No California labor compliance violations detected during this period. Excellent shift discipline!`)
    }
    
    lines.push(
      ``,
      `### 🧠 Actionable Recommendations & Operations Intelligence`,
      `1.  **Labor Cost Optimization:**`
    )
    
    if (actualLaborPct > laborTarget) {
      const excessLaborAmt = totalLabor - (totalSales * (laborTarget / 100))
      lines.push(
        `    *   ⚠️ **Deviation:** Labor is **${(actualLaborPct - laborTarget).toFixed(1)}%** over target, representing an excess expenditure of **${fmt$(excessLaborAmt)}**.`
        + `\n    *   💡 **Action:** Review scheduled shifts against the smart hourly forecast using ` + '`query_forecast`.'
        + ` Consider dynamic mid-day cuts if actual sales do not track the forecast by 2 PM.`
      )
    } else {
      lines.push(`    *   ✅ **Excellent Roster Efficiency!** Labor is tracking at **${actualLaborPct.toFixed(1)}%**, which is below our 21.5% target ceiling. Maintain this scheduling pattern.`)
    }
    
    lines.push(`2.  **Food Cost and Margins:**`)
    if (actualFoodPct > foodTarget) {
      lines.push(
        `    *   ⚠️ **Theoretical Food Cost is ${actualFoodPct.toFixed(1)}%** (Meta: 32%).`
        + `\n    *   💡 **Action:** Check recipe margins and yield percentages of high-volume items (Combos, Tacos de Asada) using ` + '`query_menu_recipes`.'
        + ` Ensure prep amounts are strictly controlled using the production Prep tool to avoid organic waste.`
      )
    } else if (actualFoodPct > 0) {
      lines.push(`    *   ✅ **Food Cost under control:** Theoretical usage is at **${actualFoodPct.toFixed(1)}%**, showing perfect portion control and recipe accuracy.`)
    } else {
      lines.push(`    *   ℹ️ No recipe cost logs were parsed for this date range in Supabase cache. Run monthly sync.`)
    }
    
    return lines.join('\n')
  } catch (error: any) {
    return `Error running performance audit: ${error.message}`
  }
}

// ── 18. Execute Custom SQL ──
async function executeCustomSql(args: any): Promise<string> {
  const { query_text } = args
  if (!query_text) return 'Error: query_text parameter is required.'

  // Trim trailing semicolon to prevent PostgreSQL subquery syntax errors inside '(' || query_text || ')'
  let sqlQuery = query_text.trim()
  if (sqlQuery.endsWith(';')) {
    sqlQuery = sqlQuery.slice(0, -1).trim()
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('execute_sql', { query_text: sqlQuery })
    if (error) {
      return `SQL Execution Error: ${error.message}\nDetail: ${error.details || ''}\nHint: ${error.hint || ''}`
    }

    if (!data) return 'No result returned.'
    if (data.error) {
      return `SQL Engine Error: ${data.error}`
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return 'Query executed successfully. 0 rows returned.'
      
      // Convert JSON array to Markdown table
      const headers = Object.keys(data[0])
      const headerRow = `| ${headers.join(' | ')} |`
      const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`
      const dataRows = data.map(row => {
        return `| ${headers.map(h => {
          const val = row[h]
          if (val === null || val === undefined) return 'NULL'
          if (typeof val === 'object') return JSON.stringify(val)
          return String(val)
        }).join(' | ')} |`
      })
      return `${headerRow}\n${separatorRow}\n${dataRows.join('\n')}\n\n*Total rows: ${data.length}*`
    }

    return JSON.stringify(data, null, 2)
  } catch (e: any) {
    return `Exception running SQL: ${e.message}`
  }
}

// ── 19. Safe Counts (Caja Fuerte) ──
async function querySafeCounts(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  let query = supabaseAdmin
    .from('safe_counts')
    .select('id, store_id, business_date, grand_total, bills_total, coins_total, drawers_total, uniforms_amount, notes, counted_at')
    .gte('business_date', args.start_date)
    .lte('business_date', args.end_date)
    .order('business_date', { ascending: false })

  if (args.store_name) {
    const storeIds = await getStoreIdsByName(args.store_name)
    if (storeIds.length) query = query.in('store_id', storeIds)
  }

  const { data, error } = await query.limit(500)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No safe counts found from ${args.start_date} to ${args.end_date}.`

  let grand = 0
  const lines = data.map(r => {
    grand += Number(r.grand_total) || 0
    const storeName = idToName[r.store_id] || `Store #${r.store_id}`
    return `${r.business_date} | ${storeName} | Total: ${fmt$(Number(r.grand_total) || 0)} (Bills: ${fmt$(Number(r.bills_total) || 0)}, Coins: ${fmt$(Number(r.coins_total) || 0)}, Drawers: ${fmt$(Number(r.drawers_total) || 0)}, Uniforms: ${fmt$(Number(r.uniforms_amount) || 0)}) | Notes: ${r.notes || 'None'}`
  })

  return `--- Safe Counts ---\nTotal records: ${data.length}\nGrand total sum: ${fmt$(grand)}\n\n${lines.join('\n')}`
}

// ── 23. Uniforms ──
async function queryUniformsStock(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  
  // 1. Fetch pricing
  const { data: pricingData, error: pricingErr } = await supabaseAdmin
    .from('uniforms_pricing')
    .select('*')
    
  if (pricingErr) return `Error fetching pricing: ${pricingErr.message}`
  
  const pricingMap: Record<string, any> = {}
  pricingData?.forEach(p => {
    pricingMap[p.item_category] = p
  })
  
  let query = supabaseAdmin
    .from('uniforms_inventory_stock')
    .select('*')
    
  if (args.store_name) {
    const storeIds = await getStoreIdsByName(args.store_name)
    if (storeIds.length) query = query.in('store_id', storeIds)
  }

  const { data, error } = await query
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No uniform stock data found.'

  const byStore: Record<string, any[]> = {}
  data.forEach((r: any) => {
    const storeName = idToName[r.store_id] || `Store ${r.store_id}`
    if (!byStore[storeName]) byStore[storeName] = []
    byStore[storeName].push({
      ...r,
      pricing: pricingMap[r.item_category]
    })
  })

  let output = `Uniforms Stock:\n`
  for (const [store, stock] of Object.entries(byStore)) {
    let totalItems = 0
    let totalValue = 0
    output += `\n🏪 **${store}**\n`
    stock.sort((a, b) => (a.item_category || '').localeCompare(b.item_category || ''))
      .forEach(s => {
        const p = s.pricing
        const qty = s.quantity_on_hand || 0
        totalItems += qty
        
        const price = p ? Number(p.sale_price) || 0 : 0
        totalValue += qty * price
        
        const itemName = p ? (p.display_name_en || p.item_category) : s.item_category
        output += `- ${qty}x ${itemName} (Size: ${s.size}) @ ${fmt$(price)}\n`
      })
    output += `> Total: ${totalItems} items, Value: ${fmt$(totalValue)}\n`
  }
  
  return output
}

async function queryExecutiveUniformsDashboard(args: any): Promise<string> {
  // Get all transactions
  const { data: tx, error: txError } = await supabaseAdmin
    .from('uniforms_transactions')
    .select('*')
    .gte('business_date', args.start_date)
    .lte('business_date', args.end_date)
    
  if (txError) return `Error fetching transactions: ${txError.message}`
  
  let totalSales = 0
  let totalFree = 0
  let itemsSold = 0
  let itemsFree = 0
  
  ;(tx || []).forEach(t => {
    if (t.transaction_type === 'sale') {
      totalSales += Number(t.total_price) || 0
      itemsSold += Number(t.quantity) || 0
    } else if (t.transaction_type === 'free') {
      totalFree += Number(t.total_price) || 0
      itemsFree += Number(t.quantity) || 0
    }
  })
  
  return `Uniforms Executive Dashboard (${args.start_date} to ${args.end_date}):\n\n` +
         `💰 **Sales Revenue**: ${fmt$(totalSales)} (${itemsSold} items sold)\n` +
         `👕 **Free Uniforms Value**: ${fmt$(totalFree)} (${itemsFree} items given)\n` +
         `\nTo investigate cash discrepancies, recommend comparing this with the Safe Counts report for the same period.`
}

// ── 20. Prep Pace (Preparador) ──
async function queryPrepPace(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  let query = supabaseAdmin
    .from('preparador_requests')
    .select('id, store_id, sender_name, items, status, created_at')
    .gte('created_at', args.start_date + 'T00:00:00')
    .lte('created_at', args.end_date + 'T23:59:59')
    .order('created_at', { ascending: false })

  if (args.store_name) {
    const storeIds = await getStoreIdsByName(args.store_name)
    if (storeIds.length) query = query.in('store_id', storeIds)
  }

  const { data, error } = await query.limit(200)
  if (error) return `Error: ${error.message}`

  const lines: string[] = []
  if (data?.length) {
    data.forEach(r => {
      const storeName = idToName[r.store_id] || `Store #${r.store_id}`
      const dateStr = r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '?'
      const itemsList = typeof r.items === 'object' && r.items ? JSON.stringify(r.items) : String(r.items)
      lines.push(`[${dateStr}] ${storeName} | Sender: ${r.sender_name || '?'} | Status: ${r.status} | Items: ${itemsList.slice(0, 200)}`)
    })
  }

  // Also query meat consumption
  let meatQuery = supabaseAdmin
    .from('meat_consumption_history')
    .select('store_id, business_date, meat_type, raw_lbs')
    .gte('business_date', args.start_date)
    .lte('business_date', args.end_date)
    .order('business_date', { ascending: false })

  if (args.store_name) {
    const storeIds = await getStoreIdsByName(args.store_name)
    if (storeIds.length) meatQuery = meatQuery.in('store_id', storeIds)
  }

  const { data: meatData } = await meatQuery.limit(500)
  const meatLines: string[] = []
  if (meatData?.length) {
    meatData.forEach(r => {
      const storeName = idToName[r.store_id] || `Store #${r.store_id}`
      meatLines.push(`${r.business_date} | ${storeName} | ${r.meat_type}: ${Number(r.raw_lbs).toFixed(1)} lbs`)
    })
  }

  const parts: string[] = []
  if (lines.length) parts.push(`Prep Requests (Cooking Pace):\n${lines.join('\n')}`)
  if (meatLines.length) parts.push(`Meat Consumption Logs:\n${meatLines.join('\n')}`)

  return parts.length ? parts.join('\n\n') : `No prep pace or meat data found from ${args.start_date} to ${args.end_date}.`
}

// ── 21. Inventory Orders ──
async function queryInventoryOrders(args: any): Promise<string> {
  const { idToName } = await getStoreMaps()
  let query = supabaseAdmin
    .from('inventory_orders')
    .select('id, store_id, order_date, week_start_date, status, created_by, qb_estimate_number')
    .gte('order_date', args.start_date)
    .lte('order_date', args.end_date)
    .order('order_date', { ascending: false })

  if (args.store_name) {
    const storeIds = await getStoreIdsByName(args.store_name)
    if (storeIds.length) query = query.in('store_id', storeIds)
  }

  const { data, error } = await query.limit(200)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No inventory orders found from ${args.start_date} to ${args.end_date}.`

  // Let's get order lines for the recent orders to show details
  const orderIds = data.map(o => o.id).slice(0, 5) // details for top 5 orders
  let lineDetails = ''
  if (orderIds.length) {
    const { data: lines } = await supabaseAdmin
      .from('inventory_order_lines')
      .select('order_id, inventory_item_id, calculated_qty, adjusted_qty, final_qty')
      .in('order_id', orderIds)
      
    const itemIds = [...new Set(lines?.map(l => l.inventory_item_id) || [])]
    const { data: items } = await supabaseAdmin.from('inventory_items').select('id, name').in('id', itemIds)
    const itemMap: Record<string, string> = {}
    items?.forEach(i => { itemMap[i.id] = i.name })

    const orderLinesMap: Record<string, string[]> = {}
    lines?.forEach(l => {
      if (!orderLinesMap[l.order_id]) orderLinesMap[l.order_id] = []
      const name = itemMap[l.inventory_item_id] || l.inventory_item_id
      orderLinesMap[l.order_id].push(`  - ${name}: final=${l.final_qty} (calc=${l.calculated_qty}, adj=${l.adjusted_qty})`)
    })

    lineDetails = '\n\nRecent Order Details:\n' + data.slice(0, 5).map(o => {
      const storeName = idToName[o.store_id] || `Store #${o.store_id}`
      const orderLines = orderLinesMap[o.id] || []
      return `📦 Order ${o.order_date} - ${storeName} [${o.status || 'Pending'}] (QB: ${o.qb_estimate_number || 'N/A'})\n${orderLines.join('\n')}`
    }).join('\n')
  }

  const summary = data.map(o => {
    const storeName = idToName[o.store_id] || `Store #${o.store_id}`
    return `${o.order_date} | ${storeName} | Status: ${o.status || 'Pending'} | QB: ${o.qb_estimate_number || 'N/A'} | Created By: ${o.created_by || 'System'}`
  }).join('\n')

  return `Inventory Orders:\n${summary}${lineDetails}`
}

async function querySupervisorMileage(args: { start_date: string; end_date: string; supervisor_name?: string }): Promise<string> {
  let query = supabaseAdmin
    .from('supervisor_mileage_trips')
    .select('*')
    .gte('trip_date', args.start_date)
    .lte('trip_date', args.end_date)
    .order('trip_date', { ascending: false })

  if (args.supervisor_name) {
    query = query.ilike('supervisor_name', `%${args.supervisor_name}%`)
  }

  const { data, error } = await query.limit(100)
  if (error) return `Error querying supervisor mileage: ${error.message}`
  if (!data?.length) return `No supervisor mileage trips found from ${args.start_date} to ${args.end_date}.`

  const totalMiles = data.reduce((s, r) => s + (Number(r.distance_miles) || 0), 0)
  const totalAmount = data.reduce((s, r) => {
    const m = Number(r.distance_miles) || 0
    const rate = Number(r.rate_per_mile) || 0.76
    const p = Number(r.parking_amount) || 0
    const t = Number(r.tolls_amount) || 0
    return s + (m * rate) + p + t
  }, 0)

  const summary = data.map(r => {
    const m = Number(r.distance_miles) || 0
    const rate = Number(r.rate_per_mile) || 0.76
    const tot = (m * rate) + (Number(r.parking_amount) || 0) + (Number(r.tolls_amount) || 0)
    return `${r.trip_date} | ${r.supervisor_name} | ${r.origin_name} -> ${r.destination_name} | ${m.toFixed(2)} mi @ $${rate.toFixed(3)} | $${tot.toFixed(2)} USD | Status: ${r.status}`
  }).join('\n')

  return `🚗 Supervisor Mileage Summary (MilesIQ):\nTotal Trips: ${data.length}\nTotal Miles: ${totalMiles.toFixed(2)} mi\nTotal Reimbursement: $${totalAmount.toFixed(2)} USD\n\nDetail:\n${summary}`
}

async function querySupplierPrices(args: { supplier_name?: string; sku?: string; search_text?: string }): Promise<string> {
  let query = supabaseAdmin
    .from('supplier_item_mappings')
    .select(`
      id,
      supplier_sku,
      supplier_description,
      pack_quantity,
      pack_unit,
      base_unit,
      suppliers (name, supplier_code),
      inventory_items (id, name, sku, purchase_unit_cost, quantity_per_unit, unit_measure)
    `)

  if (args.sku) {
    query = query.ilike('supplier_sku', `%${args.sku}%`)
  }
  if (args.search_text) {
    query = query.or(`supplier_description.ilike.%${args.search_text}%,supplier_sku.ilike.%${args.search_text}%`)
  }

  const { data, error } = await query.limit(50)
  if (error) return `Error querying supplier prices: ${error.message}`
  if (!data?.length) return `No supplier item mappings found for criteria (SKU: ${args.sku || 'any'}, Search: ${args.search_text || 'any'}).`

  let filtered = data
  if (args.supplier_name) {
    const sName = args.supplier_name.toLowerCase()
    filtered = filtered.filter((r: any) => (r.suppliers?.name || '').toLowerCase().includes(sName))
  }

  const summary = filtered.map((r: any) => {
    const item = r.inventory_items
    const cost = item ? Number(item.purchase_unit_cost) || 0 : 0
    const pack = r.pack_quantity || 1
    const unitCost = Number((cost / pack).toFixed(4))
    const supName = r.suppliers?.name || 'Viele & Sons'
    return `| **${r.supplier_sku}** | ${r.supplier_description} | ${pack} ${r.pack_unit} | ${item?.name || 'N/A'} | $${cost.toFixed(2)}/case ($${unitCost.toFixed(4)}/unit) | ${supName} |`
  }).join('\n')

  return `📊 **Supplier Item Catalog & Prices (Radar de Precios):**\nTotal Matches: ${filtered.length}\n\n| SKU | Description | Pack | Master Item | Price / Unit Cost | Supplier |\n|---|---|---|---|---|---|\n${summary}`
}



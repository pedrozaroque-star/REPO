import { supabaseAdmin } from '@/lib/supabase'

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
    description: 'Query inventory items, recipes, menu items, costs.',
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
  }
]

// ── Tool Executor ──
export async function executeTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {
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

  const { data, error } = await query.limit(1000)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No sales data found for ${args.start_date} to ${args.end_date}.`

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

  const lines = Object.entries(byStore).sort((a, b) => b[1].sales - a[1].sales)
    .map(([n, v]) => `${n}: ${fmt$(v.sales)} | Orders: ${v.orders} | Labor: ${fmt$(v.labor)} (${v.sales > 0 ? ((v.labor/v.sales)*100).toFixed(1) : 0}%) | Uber: ${fmt$(v.uber)} | DD: ${fmt$(v.dd)}`)

  return `Sales ${args.start_date} to ${args.end_date}:\nTotal: ${fmt$(total)} | Orders: ${orders} | Labor: ${fmt$(labor)} (${total > 0 ? ((labor/total)*100).toFixed(1) : 0}%) | Uber: ${fmt$(uber)} | DD: ${fmt$(dd)}\n\nBy Store:\n${lines.join('\n')}`
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

  return `Food Cost ${args.start_date} to ${args.end_date}:\nTotal Cost: ${fmt$(totalCost)} | Sales: ${fmt$(totalSales)} | Food Cost: ${pct}%\n\nBy Store:\n${lines.join('\n')}`
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
    const storeIds = Object.entries(idToName).filter(([, n]) => n.toLowerCase().includes((args.store_name || '').toLowerCase())).map(([id]) => id)
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
  let query = supabaseAdmin.from('inventory_items').select('id, name, category, unit, cost_per_unit, yield_percent, type')
  if (args.category) query = query.ilike('category', `%${args.category}%`)
  if (args.item_name) query = query.ilike('name', `%${args.item_name}%`)

  const { data, error } = await query.order('name').limit(200)
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No inventory items found.'

  const byCat: Record<string, number> = {}
  data.forEach(i => { byCat[i.category || 'none'] = (byCat[i.category || 'none'] || 0) + 1 })

  const lines = data.map(i => `${i.name} | ${i.category || '?'} | ${fmt$(Number(i.cost_per_unit) || 0)}/${i.unit} | yield: ${i.yield_percent || 100}%`)

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
  const { data, error } = await supabaseAdmin.from('stores').select('id, name, external_id, address, phone')
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No stores found.'

  const lines = data.map(s => `${clean(s.name)} | ID: ${s.id} | External: ${s.external_id || '-'} | ${s.address || ''} | ${s.phone || ''}`)
  return `Stores (${data.length}):\n${lines.join('\n')}`
}

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd' // Slauson
  const dateStr = '2026-06-07' // Sunday

  console.log(`Checking match for ${dateStr}...`)

  // 1. Fetch shifts
  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('store_id', storeId)
    .eq('shift_date', dateStr)

  // 2. Fetch all employees
  let allEmps: any[] = []
  let page = 0
  const PAGE_SIZE = 1000
  let hasMore = true
  while (hasMore) {
    const { data } = await supabase
      .from('toast_employees')
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    allEmps = [...allEmps, ...data]
    if (data.length < PAGE_SIZE) hasMore = false
    page++
  }

  const shiftEmployeeIds = new Set((shifts || [])?.map(s => String(s.employee_id)))

  console.log('Employee IDs in shifts:', Array.from(shiftEmployeeIds))

  for (const s of shifts || []) {
    const emp = allEmps.find(e => String(e.id) === String(s.employee_id))
    if (!emp) {
      console.log(`❌ Missing Employee Profile for ID ${s.employee_id}!`)
    } else {
      console.log(`✅ Found employee for ID ${s.employee_id}: ${emp.first_name} ${emp.last_name}`)
    }
  }
}

run()

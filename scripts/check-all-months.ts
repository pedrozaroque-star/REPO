import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function checkAllMonths() {
  const { data } = await supabaseAdmin.from('sales_daily_cache').select('business_date')
  const dates = data?.map(d => d.business_date) || []
  const unique = Array.from(new Set(dates)).sort()
  console.log(`Total dates in database: ${unique.length}`)
  console.log(`Earliest date: ${unique[0]}`)
  console.log(`Latest date: ${unique[unique.length - 1]}`)

  // Group by month
  const byMonth: Record<string, number> = {}
  for (const d of unique) {
    const m = d.substring(0, 7)
    byMonth[m] = (byMonth[m] || 0) + 1
  }
  console.log('Dates per month in database:', byMonth)
}

checkAllMonths()

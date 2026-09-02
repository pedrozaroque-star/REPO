/**
 * Buscar fechas representativas disponibles en sales_daily_cache a lo largo de 2026
 * Run via: npx tsx scripts/find-2026-audit-dates.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { supabaseAdmin } from '../lib/supabase'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function findDates() {
  const { data, error } = await supabaseAdmin
    .from('sales_daily_cache')
    .select('business_date')
    .gte('business_date', '2026-01-01')
    .lte('business_date', '2026-09-01')
    .order('business_date', { ascending: true })

  if (error || !data) {
    console.error('Error fetching dates:', error?.message)
    return
  }

  const uniqueDates = Array.from(new Set(data.map(d => d.business_date)))
  console.log(`📅 Total de fechas únicas encontradas en 2026: ${uniqueDates.length}`)
  console.log('Muestra de fechas:')
  console.log(uniqueDates.slice(0, 30))
  console.log('...')
  console.log(uniqueDates.slice(-30))
}

findDates()

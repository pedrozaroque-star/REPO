
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function checkJobs() {
    // Get unique job titles from punches in Jan 2026
    const { data: punches } = await supabase
        .from('punches')
        .select('job_title')
        .eq('store_id', STORE_ID)
        .gte('business_date', '2026-01-01')

    if (!punches) return console.log('No punches found')

    const jobs = new Set(punches.map(p => p.job_title))
    console.log('Puestos encontrados:', [...jobs])
}

checkJobs()

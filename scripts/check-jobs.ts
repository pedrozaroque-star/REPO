// Quick check of job titles
// Run with: npx tsx scripts/check-jobs.ts

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
    console.log('=== TOAST JOBS ===\n')

    const { data: jobs } = await supabase
        .from('toast_jobs')
        .select('guid, title')
        .order('title')

    jobs?.forEach(j => {
        console.log(`${j.title} → ${j.guid}`)
    })
}

main().catch(console.error)

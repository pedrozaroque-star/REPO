import { getSupabaseClient } from './lib/supabase'

async function investigate() {
    const supabase = await getSupabaseClient()

    console.log('--- TOAST JOBS ---')
    const { data: jobs, error: jobsError } = await supabase.from('toast_jobs').select('*')
    if (jobsError) console.error(jobsError)
    else console.table(jobs?.map(j => ({ id: j.id, title: j.title })))

    console.log('\n--- SHIFTS (Last 3 months) ---')
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    const { count, error: countError } = await supabase
        .from('shifts')
        .select('*', { count: 'exact', head: true })
        .gte('start_time', threeMonthsAgo.toISOString())

    if (countError) console.error(countError)
    else console.log(`Total historical shifts found: ${count}`)

    console.log('\n--- PUNCHES (Last 3 months) ---')
    const { count: punchCount, error: punchError } = await supabase
        .from('punches')
        .select('*', { count: 'exact', head: true })
        .gte('start_time', threeMonthsAgo.toISOString())

    if (punchError) {
        console.log('Punches table error:', punchError.message)
    } else {
        console.log(`Total historical punches found: ${punchCount}`)
        const { data: punchSample } = await supabase
            .from('punches')
            .select('*')
            .limit(1)
        if (punchSample && punchSample.length > 0) {
            console.log('Punch table schema sample keys:', Object.keys(punchSample[0]))
        }
    }
}

investigate()


import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    const storeName = 'Huntington Park'
    const dateStr = '2026-02-16'

    console.log(`🔍 ANALYZING LABOR (Final Fixed): ${storeName} on ${dateStr}\n`)

    const { data: stores } = await supabase.from('stores').select('*').ilike('name', `%${storeName}%`)
    const store = stores?.[0]
    const storeGuid = store.external_id

    const { data: shifts } = await supabase.from('shifts').select('*').eq('store_id', storeGuid).eq('shift_date', dateStr)
    const { data: punches } = await supabase.from('punches').select('*').eq('store_id', storeGuid).eq('business_date', dateStr)

    const shiftEmpIds = shifts?.map(s => s.employee_id) || []
    const punchGuids = punches?.map(p => p.employee_toast_guid) || []

    // Fetch Correct Columns
    const { data: empsById } = await supabase.from('toast_employees').select('id, toast_guid, first_name, last_name, wage_data, job_references').in('id', shiftEmpIds)
    const { data: empsByGuid } = await supabase.from('toast_employees').select('id, toast_guid, first_name, last_name, wage_data, job_references').in('toast_guid', punchGuids)

    const allEmps = [...(empsById || []), ...(empsByGuid || [])]

    // De-duplicate and Map
    const idToGuid = new Map<string, string>()
    const guidToDetails = new Map<string, any>()

    allEmps.forEach(e => {
        const fullName = `${e.first_name || ''} ${e.last_name || ''}`.trim()
        idToGuid.set(e.id, e.toast_guid)
        guidToDetails.set(e.toast_guid, {
            name: fullName,
            wage: Number(e.wage_data?.[0]?.wage || 0),
            isSalaried: e.job_references?.some((j: any) => j.is_exempt || j.wage_frequency === 'WEEKLY')
        })
    })

    const stats = new Map<string, { plan: number, actual: number }>()

    // Sum Plan
    let totalPlanHours = 0
    shifts?.forEach(s => {
        const guid = idToGuid.get(s.employee_id)
        if (!guid) return

        const start = new Date(s.start_time).getTime()
        const end = new Date(s.end_time).getTime()
        let hours = (end - start) / 3600000
        if (hours > 5) hours -= 0.5

        const entry = stats.get(guid) || { plan: 0, actual: 0 }
        entry.plan += hours
        stats.set(guid, entry)
        totalPlanHours += hours
    })

    // Sum Actual
    let totalActualHours = 0
    punches?.forEach(p => {
        const guid = p.employee_toast_guid
        if (!guid) return
        const hours = (p.regular_hours || 0) + (p.overtime_hours || 0)

        const entry = stats.get(guid) || { plan: 0, actual: 0 }
        entry.actual += hours
        stats.set(guid, entry)
        totalActualHours += hours
    })

    const results: any[] = []

    stats.forEach((val, guid) => {
        const details = guidToDetails.get(guid)
        const diff = val.actual - val.plan

        // Always add explicit salaried flag check
        const isSalaried = details?.isSalaried || false
        const wage = details?.wage || 0
        const costImpact = isSalaried ? 0 : (diff * wage) // Simplify for logic check

        results.push({
            name: details?.name || 'Unknown',
            wage: wage,
            isSalaried: isSalaried,
            Plan: Number(val.plan.toFixed(2)),
            Actual: Number(val.actual.toFixed(2)),
            Diff: Number(diff.toFixed(2)),
            CostImpact: Number(costImpact.toFixed(2))
        })
    })

    console.table(results.sort((a, b) => b.Diff - a.Diff))

    let calcCostVar = 0
    results.forEach(r => calcCostVar += r.CostImpact)

    console.log(`\nTotal Plan Hours: ${totalPlanHours.toFixed(2)}`)
    console.log(`Total Actual Hours: ${totalActualHours.toFixed(2)}`)
    console.log(`Net Hours Variance: ${(totalActualHours - totalPlanHours).toFixed(2)}`)
    console.log(`Calc Cost Variance: $${calcCostVar.toFixed(2)}`)
}

run()

import { getSupabaseClient } from '@/lib/supabase'

const STORE_ID = 'acf15327-54c8-4da4-8d0d-3ac0544dc422' // Lynwood (default) or make dynamic
// If user has a different store selected, we might need to know. 
// For now, Lynwood is the safest bet to check data health.

async function diagnose() {
    console.log("🔍 DIAGNOSIS STARTED for Smart Scheduler logic...")
    const supabase = await getSupabaseClient()

    // 1. Check Punches Table Health (Simple Check first)
    const { data: testData, error: viewError } = await supabase.from('punches').select('*').limit(1)
    if (viewError) {
        console.error("❌ CRITICAL: Cannot read 'punches' table.", viewError)
        return
    }
    if (testData && testData.length > 0) {
        console.log("✅ Schema Columns:", Object.keys(testData[0]).join(', '))
    } else {
        console.log("⚠️ Table is empty, cannot verify schema columns from data.")
    }

    const { count, error: countErr } = await supabase
        .from('punches')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', STORE_ID)

    if (countErr) {
        console.error("❌ Error counting punches:", JSON.stringify(countErr, null, 2))
        return
    }
    console.log(`📊 Total Punches for Store: ${count}`)

    if (count === 0) {
        console.error("❌ NO DATA: 'punches' table is empty for this store. Generator needs history.")
        return
    }

    // 2. Check Freshness (Max Date)
    const { data: maxData } = await supabase
        .from('punches')
        .select('business_date')
        .eq('store_id', STORE_ID)
        .order('business_date', { ascending: false })
        .limit(1)

    const lastPunchDate = maxData?.[0]?.business_date
    console.log(`📅 Oldest Punch in DB: (Not checked)`)
    console.log(`📅 NEWEST Punch in DB: ${lastPunchDate}`)

    if (!lastPunchDate) return

    const now = new Date()
    const lastDate = new Date(lastPunchDate + 'T12:00:00')
    const diffDaysOverall = (now.getTime() - lastDate.getTime()) / (1000 * 3600 * 24)
    console.log(`⏱️ Days since last punch (Overall): ${diffDaysOverall.toFixed(1)} days`)

    if (diffDaysOverall > 20) {
        console.error(`⚠️ CRITICAL: Data is too old! The generator ignores employees inactive for > 20 days.`)
        console.error(`   Your data is ${diffDaysOverall.toFixed(1)} days old. You need to run a sync/backfill for 2025/2026.`)
    } else {
        console.log("✅ Data freshness looks OK globally.")
    }

    // 3. Employee Specific Check
    console.log("\n🕵️ Checking Active Employees logic...")
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name, toast_guid')
        .eq('deleted', false)
        .limit(10) // Check first 10

    if (!emps || emps.length === 0) {
        console.log("❌ No active employees found in 'toast_employees'")
        return
    }

    let activeCount = 0
    let rejectedCount = 0

    for (const emp of emps) {
        if (!emp.toast_guid) {
            console.log(`   - ${emp.first_name} ${emp.last_name}: ⚠️ NO TOAST GUID`)
            continue
        }

        const { data: lastP } = await supabase
            .from('punches')
            .select('business_date')
            .eq('employee_toast_guid', emp.toast_guid)
            .order('business_date', { ascending: false })
            .limit(1)

        if (!lastP || lastP.length === 0) {
            console.log(`   - ${emp.first_name} ${emp.last_name}: ❌ No history found (0 punches)`)
            rejectedCount++
            continue
        }

        const pDate = new Date(lastP[0].business_date + 'T12:00:00')
        const diff = (now.getTime() - pDate.getTime()) / (1000 * 3600 * 24)

        if (diff > 20) {
            console.log(`   - ${emp.first_name} ${emp.last_name}: ❌ Inactive (${diff.toFixed(1)} days ago)`)
            rejectedCount++
        } else {
            console.log(`   - ${emp.first_name} ${emp.last_name}: ✅ Active (${diff.toFixed(1)} days ago)`)
            activeCount++
        }
    }

    console.log(`\n📋 SAMPLE RESULT: ${activeCount} Qualified / ${rejectedCount} Rejected (out of sample ${emps.length})`)
}

diagnose()

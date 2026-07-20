
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthToken, getToastRestaurants } from '@/lib/toast-api'
import { scheduleBreaksWithDemand } from '@/lib/breaks-engine'
import { generateSmartForecast } from '@/lib/intelligence'

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(req: Request) {
    // 🔒 Security check (Vercel Cron header or token)
    const authHeader = req.headers.get('authorization')
    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🤖 [Smart Rebalance] Starting automated punch monitoring...')

    try {
        const token = await getAuthToken()
        if (!token) throw new Error('Failed to get Toast Auth Token')
            
        const stores = await getToastRestaurants(token)
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) // YYYY-MM-DD
        
        let rebalancedStoresCount = 0
        let totalVariancesFound = 0

        // 🚀 PRE-FETCH MASTER DATA (Bien hecho: una sola consulta fuera del bucle)
        const { data: emps } = await supabase.from('toast_employees').select('id, first_name, last_name, job_references, toast_guid')
        const { data: jobs } = await supabase.from('toast_jobs').select('*')

        for (const store of stores) {
            if (!store.id) continue
            
            // 1. Get Scheduled Shifts for Today in this store
            const { data: dbShifts } = await supabase
                .from('shifts')
                .select('*')
                .eq('store_id', store.id)
                .eq('shift_date', today)
            
            if (!dbShifts || dbShifts.length === 0) continue

            // 2. Get Toast Real Punches
            const startIso = `${today}T00:00:00.000+0000`
            const endIso = `${today}T23:59:59.999+0000`
            const punchRes = await fetch(`https://ws-api.toasttab.com/labor/v1/timeEntries?startDate=${startIso}&endDate=${endIso}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.id }
            })
            
            if (!punchRes.ok) continue
            
            const punches = await punchRes.json()
            const timeEntries = Array.isArray(punches) ? punches : (punches.timeEntries || [])

            // 3. Compare and detect "Significant Variances" (> 60 mins)
            let storeNeedsRebalance = false
            const adjustedShifts = dbShifts.map(s => {
                const emp = emps?.find(e => e.id === s.employee_id)
                if (!emp) return s

                // Find matching punch by toast_guid
                const punch = timeEntries.find((p: any) => p.employee.guid === emp.toast_guid)
                
                if (punch && punch.inDate) {
                    const scheduledStart = new Date(s.start_time).getTime()
                    const actualStart = new Date(punch.inDate).getTime()
                    const diffMins = Math.abs(actualStart - scheduledStart) / (1000 * 60)

                    if (diffMins >= 60) {
                        console.log(`⚠️ Variance for ${emp.first_name} at ${store.name}: ${Math.round(diffMins)}m`)
                        totalVariancesFound++
                        storeNeedsRebalance = true
                        // Pass the actual punch for AI context
                        return { ...s, start_time: punch.inDate }
                    }
                }
                return s
            })

            // 4. Rebalance if needed
            if (storeNeedsRebalance) {
                const forecast = await generateSmartForecast(store.id, today)
                const hours = forecast.hours || []

                const augmentedForAi = adjustedShifts.map(s => {
                    const emp = emps?.find(e => e.id === s.employee_id)
                    let title = ''
                    if (emp?.job_references?.[0]) {
                        title = jobs?.find(j => j.guid === emp.job_references[0].guid)?.title || ''
                    }
                    const t = title.toLowerCase()
                    const isLeader = t.includes('manager') || t.includes('asst') || t.includes('shift') || t.includes('lead') || t.includes('encargado') || t.includes('asistente')
                    return { ...s, is_leader: isLeader, job_title: title }
                })

                // 🧠 DEEP AUDIT: Filter out shifts marked as absent (is_callback)
                const activeShiftsForRebalance = adjustedShifts.filter(s => s.is_callback !== true);
                
                if (activeShiftsForRebalance.length === 0) continue;

                // Re-calculate the whole day's puzzle (only for present employees)
                const newShifts = scheduleBreaksWithDemand(activeShiftsForRebalance as any, hours)

                // Update DB (Batching optimization: updates only if breaks actually changed)
                for (const updated of newShifts) {
                    const original = dbShifts.find(obs => obs.id === updated.id)
                    const breaksChanged = JSON.stringify(original?.breaks_schedule) !== JSON.stringify(updated.breaks_schedule)
                    
                    if (breaksChanged) {
                        await supabase.from('shifts')
                            .update({ 
                                breaks_schedule: updated.breaks_schedule,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', updated.id)
                    }
                }
                
                rebalancedStoresCount++
            }
        }

        return NextResponse.json({ 
            success: true, 
            summary: {
                checked_stores: stores.length,
                variances_found: totalVariancesFound,
                rebalanced_stores: rebalancedStoresCount
            }
        })

    } catch (error: any) {
        console.error('❌ Rebalance Cron Error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

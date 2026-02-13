
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// LOAD SECRETS FROM .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// CONSTANTS
const DATE_TARGET = '2026-02-06'
const STORE_GUID = '95866cfc-eeb8-4af9-9586-f78931e1ea04' // South Gate
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

// --- AUTH HELPER (Local) ---
let cachedToken: string | null = null
async function getAuthToken() {
    if (cachedToken) return cachedToken
    console.log('🔑 Authenticating with Toast...')

    if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
        throw new Error('❌ Missing TOAST_CLIENT_ID or TOAST_CLIENT_SECRET in .env.local')
    }

    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })

    if (!res.ok) throw new Error(`Auth Failed: ${res.status} ${await res.text()}`)
    const data: any = await res.json()
    cachedToken = data.token.accessToken
    return cachedToken
}

async function main() {
    console.log(`\n🕵️ DEBUG LABOR: Checking Store ${STORE_GUID} for ${DATE_TARGET}`)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ CRITICAL: Missing request Supabase keys in .env.local')
        process.exit(1)
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Check Supabase 'punches' (What Planner uses)
    const { data: punches, error } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', STORE_GUID)
        .gte('business_date', DATE_TARGET)
        .lte('business_date', DATE_TARGET)

    if (error) console.error('❌ Supabase Error:', error)
    else console.log(`💾 Supabase 'punches': Found ${punches?.length} records.`)

    // Check for Open Punches in DB
    const openPunches = punches?.filter((p: any) => !p.clock_out) || []
    if (openPunches.length > 0) {
        console.log(`\n⚠️  WARNING: Found ${openPunches.length} OPEN punches in DB!`)
        openPunches.forEach((p: any) => {
            console.log(`   - Employee: ${p.employee_toast_guid} (In: ${p.clock_in})`)
            // Calculate phantom hours
            const hours = (new Date().getTime() - new Date(p.clock_in).getTime()) / (1000 * 60 * 60)
            console.log(`     -> Phantom Hours: ${hours.toFixed(1)} hrs`)
        })
    } else {
        console.log(`✅ No open punches found in DB for this date.`)
    }

    // 2. Fetch Live from Toast
    console.log('\n📡 Fetching Live from Toast API...')
    try {
        const token = await getAuthToken()
        if (!token) return

        const liveEntries = await fetchToastLabor(token, STORE_GUID, DATE_TARGET)
        console.log(`📊 Toast Live: Found ${liveEntries.length} records.`)

        const liveOpen = liveEntries.filter((e: any) => !e.outDate)

        // STRICT FILTER: Only process the TARGET DATE
        // Because we fetched a wide window, we might get previous or next day data.
        // Toast businessDate is YYYYMMDD string usually.
        // If businessDate missing, we infer it.

        const targetYMD = DATE_TARGET.replace(/-/g, '')
        const filteredEntries = liveEntries.filter((e: any) => {
            if (e.businessDate) return e.businessDate === targetYMD

            // Inference fallback
            if (e.inDate) {
                const d = new Date(e.inDate)
                // Convert to LA
                const laDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }))
                if (laDate.getHours() < 4) laDate.setDate(laDate.getDate() - 1)
                const iso = laDate.toISOString().split('T')[0]
                return iso === DATE_TARGET
            }
            return false
        })

        console.log(`🎯 FILTERED to ${DATE_TARGET}: ${filteredEntries.length} records (from ${liveEntries.length} raw)`)

        const longShifts = filteredEntries.filter((e: any) => {
            const h = (e.regularHours || 0) + (e.overtimeHours || 0)
            return h > 18
        })

        if (liveOpen.length > 0) {
            console.log(`\n⚠️  TOAST API REPORTING OPEN SHIFTS (User must fix in POS):`)
            liveOpen.forEach((e: any) => {
                console.log(`   - ${e.employee?.firstName} ${e.employee?.lastName} (In: ${e.inDate})`)
            })
        }

        if (longShifts.length > 0) {
            console.log(`\n⚠️  TOAST API REPORTING IMPOSSIBLE SHIFTS (>18h):`)
            longShifts.forEach((e: any) => {
                const h = (e.regularHours || 0) + (e.overtimeHours || 0)
                console.log(`   - ${e.employee?.firstName} ${e.employee?.lastName}: ${h.toFixed(1)} hrs`)
            })
        }

        if (liveOpen.length === 0 && longShifts.length === 0) {
            console.log(`✅ Toast says all shifts are CLOSED and NORMAL.`)
        }

        // 3. FIX MODE
        if (process.argv.includes('--fix')) {
            console.log('\n🔧 FIXING: Hard Sync (Delete + Upsert)...')

            // HARD DELETE existing punches for this day to remove ghosts
            const { error: delErr } = await supabase
                .from('punches')
                .delete()
                .eq('store_id', STORE_GUID)
                .eq('business_date', DATE_TARGET)

            if (delErr) console.error('❌ Delete Failed:', delErr)
            else console.log('✅ Deleted stale punches for target date.')

            const upsertData = filteredEntries.map((p: any) => ({
                toast_id: p.guid,
                employee_toast_guid: p.employeeReference?.guid,
                store_id: STORE_GUID,
                clock_in: p.inDate,
                clock_out: p.outDate,
                business_date: p.businessDate ? `${p.businessDate.slice(0, 4)}-${p.businessDate.slice(4, 6)}-${p.businessDate.slice(6, 8)}` : DATE_TARGET,
                regular_hours: p.regularHours || 0,
                overtime_hours: p.overtimeHours || 0,
                hourly_wage: p.hourlyWage || 0,
                last_updated: new Date().toISOString()
            }))

            const { error: upsertErr } = await supabase.from('punches').upsert(upsertData, { onConflict: 'toast_id' })
            if (upsertErr) console.error('❌ Upsert Failed:', upsertErr)
            else console.log(`✅ Upserted ${upsertData.length} records.`)

            // Also clear sales cache just in case
            await supabase.from('sales_daily_cache').delete().eq('store_id', STORE_GUID).eq('business_date', DATE_TARGET)
            console.log('✅ Sales Cache cleared.')
        }
    } catch (err: any) {
        console.error('API Error:', err.message)
    }
}

async function fetchToastLabor(token: string, storeId: string, date: string) {
    // WIDEN WINDOW: Toast stores in UTC. 
    // South Gate (PST) Business Day Feb 6 = Feb 6 4:00 AM PST -> Feb 7 4:00 AM PST
    // PST is UTC-8. So Feb 6 04:00 => Feb 6 12:00 UTC.
    // Feb 7 04:00 => Feb 7 12:00 UTC.
    // To be safe, let's fetch from Feb 6 05:00 UTC to Feb 7 20:00 UTC to catch everything.

    // Actually, simpler: Fetch from [Date]T00:00 to [Date+2]T00:00 and filter by businessDate in code if needed, 
    // but Toast /timeEntries endpoint filters by 'inDate' usually if businessDate not specified?
    // Docs say startDate/endDate filter on IN time.

    // We want splits starting from Feb 6 04:00 PST.
    // Let's ask for Feb 6 08:00:00 UTC to Feb 7 12:00:00 UTC. 
    // That covers midnight to midnight PST roughly? No.
    // Feb 6 00:00 PST = Feb 6 08:00 UTC.
    // Feb 7 00:00 PST = Feb 7 08:00 UTC.
    // So distinct day is 08:00 to 08:00 next day.
    // Let's go 00:00 to 00:00 + 48 hours to be safe.

    const startIso = `${date}T00:00:00.000+0000`

    // Add 1 day for end date, effectively covering 48 hours to succeed logic
    const nextDay = new Date(date)
    nextDay.setDate(nextDay.getDate() + 2)
    const endIso = `${nextDay.toISOString().split('T')[0]}T00:00:00.000+0000`

    let all: any[] = []
    let page = 1
    while (true) {
        const url = new URL(`${TOAST_API_HOST}/labor/v1/timeEntries`)
        url.searchParams.append('startDate', startIso)
        url.searchParams.append('endDate', endIso)
        url.searchParams.append('pageSize', '100')
        url.searchParams.append('page', String(page))

        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeId }
        })
        if (!res.ok) {
            console.error('Fetch Error:', await res.text())
            break
        }
        const data: any = await res.json()
        const entries = Array.isArray(data) ? data : (data.timeEntries || [])
        all = [...all, ...entries]
        if (entries.length < 100) break
        page++
    }
    return all
}

main().catch(console.error)

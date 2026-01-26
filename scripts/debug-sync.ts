
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

// Load environment variables
try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    const envConfig = dotenv.parse(fs.readFileSync(envPath))
    for (const k in envConfig) {
        process.env[k] = envConfig[k]
    }
} catch (e) {
    console.warn("⚠️ No se pudo leer .env.local")
}

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!TOAST_CLIENT_ID) { console.error("Missing TOAST_CLIENT_ID"); process.exit(1); }

async function getAuthToken() {
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })
    const data = await res.json()
    return data.token.accessToken
}

async function debugSync() {
    console.log("Debugging Sync for Jan 25, 2026...")
    const token = await getAuthToken()
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

    // Rango amplio para asegurar capturar todo el dia de negocio 25
    // Business Date 20260125 puede tener clock-ins desde el 25 a las 4am hasta el 26 a las 4am UTC
    const startDate = '2026-01-25T08:00:00.000+0000' // 12:00 AM PST
    const endDate = '2026-01-26T14:00:00.000+0000'   // 06:00 AM PST next day

    let allPunches: any[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
        const url = `${TOAST_API_HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${page}&pageSize=100`
        console.log(`Fetching page ${page}...`)

        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeId } })

        if (!res.ok) {
            console.error(await res.text())
            break
        }

        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
            allPunches = [...allPunches, ...data]
            console.log(`  Got ${data.length} records.`)
            if (data.length < 100) hasMore = false
            else page++
        } else {
            hasMore = false
        }
    }

    console.log(`Total Punches Fetched: ${allPunches.length}`)

    // Filter only those with businessDate = 20260125
    const dayPunches = allPunches.filter(p => p.businessDate === '20260125')
    console.log(`Punches belonging to Business Date 20260125: ${dayPunches.length}`)

    if (dayPunches.length > 0) {
        console.log("Sample Punch:", JSON.stringify(dayPunches[0], null, 2))

        // Save to DB
        const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } })

        const upsertData = dayPunches.map((p: any) => ({
            toast_id: p.guid,
            employee_toast_guid: p.employeeReference?.guid,
            job_toast_guid: p.jobReference?.guid,
            store_id: storeId,
            clock_in: p.inDate,
            clock_out: p.outDate,
            business_date: '2026-01-25',
            regular_hours: p.regularHours || 0,
            overtime_hours: p.overtimeHours || 0,
            last_updated: new Date().toISOString()
        }))

        const { error } = await supabase.from('punches').upsert(upsertData, { onConflict: 'toast_id' })
        if (error) console.error("DB Error:", error)
        else console.log("✅ Saved to DB successfully")
    }
}

debugSync()

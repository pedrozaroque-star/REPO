
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

if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Faltan variables de entorno (TOAST o SUPABASE)")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
})

// SOLO LYNWOOD
const STORE = { id: '80a1ec95-bc73-402e-8884-e5abbe9343e6', name: 'Lynwood' };

async function getAuthToken() {
    console.log("🔑 Autenticando con Toast...")
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })
    if (!res.ok) throw new Error(`Auth Error: ${res.statusText}`)
    const data = await res.json()
    return data.token.accessToken
}

async function fetchTimeEntries(token: string, storeId: string, startDate: string, endDate: string) {
    let allEntries: any[] = []
    let page = 1
    let hasMore = true

    // Toast requires full ISO strings for labor API
    const startIso = `${startDate}T00:00:00.000+0000`
    const endIso = `${endDate}T23:59:59.999+0000`

    while (hasMore) {
        const url = new URL(`${TOAST_API_HOST}/labor/v1/timeEntries`)
        url.searchParams.append('startDate', startIso)
        url.searchParams.append('endDate', endIso)
        url.searchParams.append('page', page.toString())
        url.searchParams.append('pageSize', '100')

        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) {
            console.error(`❌ Error fetching ${storeId} page ${page}: ${res.statusText}`)
            break
        }

        const data = await res.json()
        if (data && Array.isArray(data)) {
            allEntries = allEntries.concat(data)
            if (data.length < 100) hasMore = false
            else page++
            process.stdout.write(`p${page}.. `);
        } else {
            hasMore = false
        }
    }
    return allEntries
}

async function syncHistory() {
    console.log("🚀 Llenando datos de labor SOLO LYNWOOD (Enero 2 - 4)...")

    let token = ''
    try {
        token = await getAuthToken()
    } catch (e) {
        console.error(e)
        return
    }

    // MUESTRA
    const start = '2026-01-02';
    const end = '2026-01-04';

    process.stdout.write(`   ⏳ Consultando ${start} a ${end}: `)
    const entries = await fetchTimeEntries(token, STORE.id, start, end)

    if (entries.length > 0) {
        console.log(`\n✅ ${entries.length} reg.`)
        // Transformar para Supabase
        const rows = entries.map(e => ({
            toast_id: e.guid,
            store_id: STORE.id,
            employee_toast_id: e.employeeReference?.guid,
            employee_toast_guid: e.employeeReference?.guid,
            job_toast_id: e.jobReference?.guid,
            job_toast_guid: e.jobReference?.guid,
            business_date: e.businessDate,
            clock_in: e.inDate,
            clock_out: e.outDate,
            regular_hours: e.regularHours,
            overtime_hours: e.overtimeHours,
            tips: e.tipsAmount || 0,
            created_at: new Date().toISOString()
        }))

        // Upsert masivo
        const { error } = await supabase.from('punches').upsert(rows, { onConflict: 'toast_id' })

        if (error) {
            console.log(`❌ Error API: ${error.message}`)
        } else {
            console.log(`💾 Guardados con éxito. Ahora ejecuta audit-jan-2026.ts`)
        }
    } else {
        console.log(`⚪ 0 registros encontrados.`)
    }

    console.log(`\n🏁 Sincronización Finalizada.`)
}

syncHistory().catch(console.error)

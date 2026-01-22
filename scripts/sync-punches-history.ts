
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

const TOAST_STORES = [
    { id: 'acf15327-54c8-4da4-8d0d-3ac0544dc422', name: 'Rialto' },
    { id: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', name: 'Azusa' },
    { id: '42ed15a6-106b-466a-9076-1e8f72451f6b', name: 'Norwalk' },
    { id: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a', name: 'Downey' },
    { id: '475bc112-187d-4b9c-884d-1f6a041698ce', name: 'LA Broadway' },
    { id: 'a83901db-2431-4283-834e-9502a2ba4b3b', name: 'Bell' },
    { id: '5fbb58f5-283c-4ea4-9415-04100ee6978b', name: 'Hollywood' },
    { id: '47256ade-2cd4-4073-9632-84567ad9e2c8', name: 'Huntington Park' },
    { id: '8685e942-3f07-403a-afb6-faec697cd2cb', name: 'LA Central' },
    { id: '3a803939-eb13-4def-a1a4-462df8e90623', name: 'La Puente' },
    { id: '80a1ec95-bc73-402e-8884-e5abbe9343e6', name: 'Lynwood' },
    { id: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', name: 'Santa Ana' },
    { id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd', name: 'Slauson' },
    { id: '95866cfc-eeb8-4af9-9586-f78931e1ea04', name: 'South Gate' },
    { id: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02', name: 'West Covina' }
]

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
        } else {
            hasMore = false
        }
    }
    return allEntries
}

async function syncHistory() {
    console.log("🚀 Iniciando Sincronización Masiva (Últimos 90 días)...")

    let token = ''
    try {
        token = await getAuthToken()
    } catch (e) {
        console.error(e)
        return
    }

    // Calcular rangos de fechas (Chunks cortos para evitar timeouts/limites y mostrar progreso)
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 30) // Solo 30 dias para rapida actualizacion

    const chunks = []
    let current = new Date(start)
    while (current < end) {
        let chunkEnd = new Date(current)
        chunkEnd.setDate(current.getDate() + 0) // 1 DIA SOLO
        if (chunkEnd > end) chunkEnd = end

        chunks.push({
            start: current.toISOString().split('T')[0],
            end: chunkEnd.toISOString().split('T')[0]
        })
        current.setDate(current.getDate() + 1) // Avanzar 1 dia
    }

    let totalSaved = 0

    for (const store of TOAST_STORES) {
        console.log(`\n🏢 Procesando: ${store.name} (${store.id})`)

        for (const chunk of chunks) {
            process.stdout.write(`   ⏳ ${chunk.start}: `)
            const entries = await fetchTimeEntries(token, store.id, chunk.start, chunk.end)

            if (entries.length > 0) {
                console.log(`✅ ${entries.length} reg.`)
                // Transformar para Supabase
                const rows = entries.map(e => ({
                    toast_id: e.guid,
                    store_id: store.id,
                    employee_toast_id: e.employeeReference?.guid, // BACKWARD COMPAT (maybe remove if schema changed)
                    employee_toast_guid: e.employeeReference?.guid, // CORRECT FIELD
                    job_toast_id: e.jobReference?.guid, // BACKWARD COMPAT
                    job_toast_guid: e.jobReference?.guid, // CORRECT FIELD
                    business_date: e.businessDate,
                    clock_in: e.inDate,
                    clock_out: e.outDate,
                    regular_hours: e.regularHours,
                    overtime_hours: e.overtimeHours,
                    tips: e.tipsAmount || 0, // A veces viene como tipsAmount o similar, verificar si es crítico
                    created_at: new Date().toISOString()
                }))

                // Upsert en batches de 100
                // IMPORTANTE: Mapear 'employeeReference.guid' a la columna correcta
                // El usuario mencionó que 'punches' debe tener estos datos para el algoritmo

                const { error } = await supabase.from('punches').upsert(rows, { onConflict: 'toast_id' })

                if (error) {
                    console.log(`❌ Error API: ${error.message}`)
                } else {
                    totalSaved += rows.length
                }
            } else {
                console.log(`⚪ 0`)
            }
        }
    }

    console.log(`\n🏁 Sincronización Finalizada. Total ponchadas guardadas: ${totalSaved}`)
}

syncHistory().catch(console.error)

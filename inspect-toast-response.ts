import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

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

    if (!res.ok) throw new Error(`Toast Auth Failed: ${res.status}`)
    const data = await res.json()
    return data.token.accessToken
}

async function inspectRealResponse() {
    const token = await getAuthToken()
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)

    const startStr = yesterday.toISOString().replace('Z', '+0000')
    const endStr = today.toISOString().replace('Z', '+0000')

    console.log(`Fetching timeEntries for Lynwood (last 24 hours)...`)
    console.log(`Range: ${startStr} to ${endStr}`)

    const url = `${TOAST_API_HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startStr)}&endDate=${encodeURIComponent(endStr)}`

    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    })

    if (!res.ok) {
        console.error(`API Error: ${res.status}`)
        console.error(await res.text())
        return
    }

    const data = await res.json()
    const punches = Array.isArray(data) ? data : []

    console.log(`\nFetched ${punches.length} time entries`)

    if (punches.length > 0) {
        console.log(`\n--- ESTRUCTURA REAL DE LA PRIMERA PONCHADA ---`)
        console.log(JSON.stringify(punches[0], null, 2))

        console.log(`\n--- CLAVES DISPONIBLES ---`)
        console.log(Object.keys(punches[0]))
    } else {
        console.log('No se encontraron ponchadas en las últimas 24 horas')
    }
}

inspectRealResponse()

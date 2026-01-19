
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || ''
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || ''

async function getToken() {
    console.log("🔑 Generando token...")
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })
    const data: any = await res.json()
    return data.token.accessToken
}

async function inspectLabor() {
    try {
        const token = await getToken()

        // West Covina ID (Confirmado que existe y tiene ventas)
        const storeId = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'

        // Probamos una fecha RECIENTE y SEGURA (Ayer)
        // Para asegurar problemas de Timezone, pedimos un rango de 48h
        const now = new Date()
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)

        // Formato ISO exacto UTC
        const startIso = yesterday.toISOString().split('T')[0] + 'T00:00:00.000+0000'
        const endIso = now.toISOString().split('T')[0] + 'T23:59:59.999+0000'

        console.log(`🔍 Buscando Time Entries en West Covina (${storeId})`)
        console.log(`📅 Rango: ${startIso} -> ${endIso}`)

        // Endpoint correcto (validado en docs)
        const url = `${TOAST_API_HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startIso)}&endDate=${encodeURIComponent(endIso)}&pageSize=5`

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) {
            console.log(`❌ Error HTTP: ${res.status} ${res.statusText}`)
            console.log(await res.text())
            return
        }

        const data: any = await res.json()

        // La respuesta puede ser un array directo o un objeto con timeEntries
        const entries = Array.isArray(data) ? data : (data.timeEntries || [])

        if (entries.length > 0) {
            console.log(`\n✅ ¡ÉXITO! Se encontraron ${entries.length} registros.`)
            console.log("📋 ESTRUCTURA DEL PRIMER REGISTRO:")
            console.log(JSON.stringify(entries[0], null, 2))
        } else {
            console.log("⚠️ Respuesta vacía (array de longitud 0).")
            console.log("Posibles causas: Sin turnos en ese rango, o permisos insuficientes para ver PII.")
        }

    } catch (e: any) {
        console.error("🔥 Excepción:", e.message)
    }
}

inspectLabor()

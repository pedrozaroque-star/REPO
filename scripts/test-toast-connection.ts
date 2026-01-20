
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// Load environment variables
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')
dotenv.config({ path: envPath })

const TOAST_API_HOST = process.env.TOAST_API_HOST
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

console.log("🔍 Verificando Configuración...")
console.log(`   Host: ${TOAST_API_HOST}`)
console.log(`   Client ID: ${TOAST_CLIENT_ID ? '******' + TOAST_CLIENT_ID.slice(-4) : 'MISSING'}`)
console.log(`   Client Secret: ${TOAST_CLIENT_SECRET ? '******' + TOAST_CLIENT_SECRET.slice(-4) : 'MISSING'}`)

async function testConnection() {
    try {
        console.log("\n🚀 Probando Autenticación...")

        const authRes = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: TOAST_CLIENT_ID,
                clientSecret: TOAST_CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })

        if (!authRes.ok) {
            console.error(`❌ Falló la autenticación: ${authRes.status} ${authRes.statusText}`)
            const text = await authRes.text()
            console.error(`   Respuesta: ${text}`)
            return
        }

        const authData = await authRes.json()
        const token = authData.token.accessToken
        console.log("✅ Autenticación Exitosa!")

        // Test grabbing restaurants
        console.log("\n🏢 Listando Restaurantes...")
        const restRes = await fetch(`${TOAST_API_HOST}/restaurants/v1/restaurants`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })

        if (!restRes.ok) {
            console.error(`❌ Falló listar restaurantes: ${restRes.status} ${restRes.statusText}`)
            return
        }

        const rests = await restRes.json()
        console.log(`✅ Se encontraron ${rests.length} restaurantes.`)
        if (rests.length > 0) {
            console.log(`   Ejemplo: ${rests[0].name} (${rests[0].guid})`)
        }

        // Test Labor API for one store
        if (rests.length > 0) {
            const storeId = rests[0].guid
            const today = new Date().toISOString().split('T')[0]
            console.log(`\n⏳ Probando Time Entries para ${rests[0].name} (Hoy: ${today})...`)

            const startIso = `${today}T00:00:00.000+0000`
            const endIso = `${today}T23:59:59.999+0000`

            const url = new URL(`${TOAST_API_HOST}/labor/v1/timeEntries`)
            url.searchParams.append('startDate', startIso)
            url.searchParams.append('endDate', endIso)
            url.searchParams.append('pageSize', '5')

            const laborRes = await fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (!laborRes.ok) {
                console.error(`❌ Falló Time Entries: ${laborRes.status} ${laborRes.statusText}`)
                const text = await laborRes.text()
                console.error(`   Respuesta: ${text}`)
            } else {
                const laborData = await laborRes.json()
                console.log(`✅ API Labor responde OK. Registros encontrados hoy: ${laborData.length}`)
            }
        }

    } catch (err: any) {
        console.error("\n❌ Error Crítico de Conexión:")
        console.error(err)
    }
}

testConnection()

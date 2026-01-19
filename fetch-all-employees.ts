
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || ''
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || ''

// Mapa definitivo de tiendas (Copiado de lib/toast-api.ts)
const STORES: Record<string, string> = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington Park',
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina'
}

async function getToken() {
    console.log("🔑 Generando token de acceso...")
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

async function fetchAllEmployees() {
    try {
        const token = await getToken()
        const allEmployees: any[] = []

        console.log(`📋 Procesando ${Object.keys(STORES).length} tiendas DEFINIDAS...`)

        // Iterar usando el mapa hardcodeado (Infalible)
        for (const [storeId, storeName] of Object.entries(STORES)) {
            console.log(`\n🔎 ${storeName} (${storeId})...`)

            // 1. Obtener Empleados
            const url = `${TOAST_API_HOST}/labor/v1/employees`
            const resEmp = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (!resEmp.ok) {
                console.error(`❌ Error HTTP ${resEmp.status} al obtener empleados en ${storeName}`)
                continue
            }

            const empData: any = await resEmp.json()
            const employees = Array.isArray(empData) ? empData : (empData.employees || [])

            console.log(`   -> 👤 ${employees.length} empleados.`)

            // 2. Obtener Puestos (Jobs)
            let jobsMap: Record<string, string> = {}
            try {
                const resJobs = await fetch(`${TOAST_API_HOST}/labor/v1/jobs`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeId }
                })
                const jobsData: any = await resJobs.json()
                const jobsList = Array.isArray(jobsData) ? jobsData : (jobsData.jobs || [])

                jobsList.forEach((j: any) => {
                    if (j.guid && j.title) jobsMap[j.guid] = j.title
                })
                console.log(`   -> 💼 ${Object.keys(jobsMap).length} puestos cargados.`)
            } catch (err) {
                console.warn("   ⚠️ No se pudieron cargar los jobs.")
            }

            // 3. Procesar
            employees.forEach((e: any) => {
                let jobTitles: string[] = []
                if (e.jobs) {
                    e.jobs.forEach((jRef: any) => {
                        if (jRef.title) jobTitles.push(jRef.title)
                        else if (jRef.guid && jobsMap[jRef.guid]) jobTitles.push(jobsMap[jRef.guid])
                        else if (jRef.name) jobTitles.push(jRef.name)
                    })
                }

                allEmployees.push({
                    tienda: storeName,
                    storeId: storeId,
                    guid: e.guid,
                    firstName: e.firstName,
                    lastName: e.lastName,
                    externalId: e.externalId,
                    email: e.email,
                    phone: e.phone,
                    puestos: jobTitles.join(" | "),
                    deleted: e.deleted
                })
            })
        }

        const filename = 'reporte-empleados-toast.json'
        console.log(`\n💾 Guardando reporte total: ${allEmployees.length} empleados en '${filename}'.`)
        fs.writeFileSync(filename, JSON.stringify(allEmployees, null, 2))

        console.log("\n✅ ¡Misión Cumplida!")

    } catch (e: any) {
        console.error("🔥 Error crítico:", e.message)
    }
}

fetchAllEmployees()

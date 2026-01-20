// scripts/inspect-toast-employees.ts
import dotenv from 'dotenv'
import path from 'path'

// Load env vars from .env.local (Next.js default)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config() // Fallback to .env
// import fetch from 'node-fetch' -- Native fetch used in Node 18+

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET
// Use a known store ID from the project
const TEST_STORE_ID = 'acf15327-54c8-4da4-8d0d-3ac0544dc422' // Rialto

async function getAuthToken() {
    console.log('Authenticating...')
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
    const data = await res.json()
    return data.token.accessToken
}

async function inspectEmployees() {
    try {
        if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
            throw new Error('Missing TOAST_CLIENT_ID or TOAST_CLIENT_SECRET env vars')
        }

        const token = await getAuthToken()
        console.log('Auth success. Fetching employees...')

        const res = await fetch(`${TOAST_API_HOST}/labor/v1/employees?pageSize=20`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': TEST_STORE_ID
            }
        })

        if (!res.ok) {
            console.error(`Error fetching employees: ${res.status}`)
            console.error(await res.text())
            return
        }

        const employees = await res.json()
        console.log(`Fetched ${employees.length} employees.`)

        // Find a real employee (not system user) who has jobs
        const realEmployee = employees.find((e: any) =>
            !e.firstName.includes('Default') &&
            !e.lastName.includes('Ordering') &&
            !e.deleted
        )

        if (realEmployee) {
            console.log('--- REAL EMPLOYEE FOUND ---')
            console.log(`Name: ${realEmployee.firstName} ${realEmployee.lastName}`)
            console.log(JSON.stringify(realEmployee, null, 2))

            console.log('\n--- DATA CHECK ---')
            console.log('Has Jobs?', realEmployee.jobReferences?.length > 0)
            console.log('Jobs Data:', JSON.stringify(realEmployee.jobReferences, null, 2))
            console.log('Has Wages?', !!realEmployee.wages)
            console.log('Has WageOverrides?', !!realEmployee.wageOverrides)
        } else {
            console.log('No real employees found in this batch. (Found only system users)')
            if (employees.length > 0) {
                console.log('Sample System User:', JSON.stringify(employees[0], null, 2))
            }
        }

    } catch (e: any) {
        console.error('Script Error:', e.message)
        if (e.cause) console.error(e.cause)
    }
}

inspectEmployees()

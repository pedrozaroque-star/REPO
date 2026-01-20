// scripts/verify-toast-jobs.ts
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET
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

async function verifyJobs() {
    try {
        const token = await getAuthToken()
        console.log('Auth success. Fetching Jobs...')

        // Attempting /labor/v1/jobs based on standard REST patterns
        const res = await fetch(`${TOAST_API_HOST}/labor/v1/jobs`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': TEST_STORE_ID
            }
        })

        if (!res.ok) {
            console.error(`Error fetching jobs: ${res.status}`)
            console.error(await res.text())
            return
        }

        const jobs = await res.json()
        console.log(`Fetched ${jobs.length} jobs.`)

        if (jobs.length > 0) {
            console.log('--- SAMPLE JOB JSON ---')
            console.log(JSON.stringify(jobs[0], null, 2))
        }

    } catch (e: any) {
        console.error('Script Error:', e.message)
    }
}

verifyJobs()

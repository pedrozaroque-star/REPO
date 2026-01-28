
import { fetchToastData, getAuthToken } from '@/lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function fetchJobRoles() {
    console.log('🕵️‍♂️ Fetching Job Roles from Toast API...')

    const token = await getAuthToken()
    if (!token) {
        console.error('❌ Failed to auth')
        return
    }

    // We need a Management Store GUID to query configs
    // Let's use Lynwood as a reference source
    const STORE_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

    try {
        // Fetch Jobs configuration
        // Endpoint: /labor/v1/jobs usually requires store context
        const url = `${TOAST_API_HOST}/labor/v1/jobs`

        console.log(`📡 GET ${url}`)

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': STORE_GUID
            }
        })

        if (!res.ok) {
            console.error(`❌ API Error: ${res.status} ${res.statusText}`)
            const txt = await res.text()
            console.error(txt)

            // Try fallback API endpoint if v1/jobs fails ? 
            // Often jobs are part of "config" or "employees" endpoints in some versions
            return
        }

        const jobs = await res.json()

        console.log('\n✅ FOUND JOB ROLES:')
        if (Array.isArray(jobs)) {
            jobs.forEach((j: any) => {
                console.log(`   🔸 [${j.guid}] ${j.title || j.name}`)
            })
        } else {
            console.log('Format unexpected:', jobs)
        }

    } catch (e) {
        console.error('Script error:', e)
    }
}

fetchJobRoles()

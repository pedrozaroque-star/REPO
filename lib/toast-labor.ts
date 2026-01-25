import { getSupabaseClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api' // Re-using auth helpers if possible, or refactoring
// Duplicate Fetch Logic for cleanliness or refactor toast-api later.
// For now, I'll implement a clean isolated fetcher here to avoid breaking existing toast-api

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

// --- AUTH HELPER (Duplicated for safety/isolation) ---
let cachedToken: string | null = null
let tokenExpiry: number = 0

async function getAuthToken() {
    if (cachedToken && Date.now() < tokenExpiry - 300000) return cachedToken

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
    cachedToken = data.token.accessToken
    tokenExpiry = Date.now() + (3600 * 1000)
    return cachedToken
}

// --- SYNC JOBS ---
export async function syncToastJobs(storeId: string) {
    const token = await getAuthToken()
    const supabase = await getSupabaseClient()

    try {
        const res = await fetch(`${TOAST_API_HOST}/labor/v1/jobs`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status} ${await res.text()}`)

        const jobs = await res.json()
        if (!Array.isArray(jobs)) return { count: 0, error: 'Invalid response format' }

        const upsertData = jobs.map((job: any) => ({
            guid: job.guid,
            title: job.title,
            external_id: job.externalId,
            deleted: job.deleted,
            last_updated: new Date().toISOString()
        }))

        // Upsert in chunks
        let total = 0
        for (let i = 0; i < upsertData.length; i += 50) {
            const chunk = upsertData.slice(i, i + 50)
            const { error } = await supabase.from('toast_jobs').upsert(chunk, { onConflict: 'guid' })
            if (error) console.error('Error upserting jobs:', error)
            else total += chunk.length
        }

        return { count: total, success: true }

    } catch (e: any) {
        console.error('Sync Jobs Error:', e)
        return { count: 0, error: e.message }
    }
}

// --- SYNC EMPLOYEES ---
export async function syncToastEmployees(storeId: string) {
    const token = await getAuthToken()
    const supabase = await getSupabaseClient()

    try {
        let allEmployees: any[] = []
        // Optional: Pagination logic if > 100 employees. For now fetch max 100 or assume small list
        // Toast default limit is often 100.
        const res = await fetch(`${TOAST_API_HOST}/labor/v1/employees?pageSize=200`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) throw new Error(`Failed to fetch employees: ${res.status}`)
        const data = await res.json()
        allEmployees = Array.isArray(data) ? data : []

        console.log(`Fetched ${allEmployees.length} raw employees from Toast`)

        // Prepare for DB
        const upsertData = allEmployees.map((emp: any) => {
            // Extract Wage Data in a clean format
            const wageData = emp.wageOverrides?.map((w: any) => ({
                job_guid: w.jobReference?.guid,
                wage: w.wage,
                // Default to hourly if not verified, need to check if response has rate type
                // Usually it's implied by job or defaultWage
            })) || []

            return {
                toast_guid: emp.guid,
                first_name: emp.firstName,
                last_name: emp.lastName,
                chosen_name: emp.chosenName,
                email: emp.email, // Ensure this maps to the new column
                phone: emp.phoneNumber, // Ensure this maps to the new column
                phone_country_code: emp.phoneNumberCountryCode,
                external_id: emp.externalId,
                external_employee_id: emp.externalEmployeeId,
                v2_toast_guid: emp.v2EmployeeGuid,

                deleted: emp.deleted,
                created_date: emp.createdDate,
                deleted_date: emp.deletedDate,

                wage_data: wageData, // JSONB (Wage Overrides)
                job_references: emp.jobReferences || [], // JSONB (All Roles)

                last_updated: new Date().toISOString()
            }
        })

        // Upsert
        let total = 0
        for (let i = 0; i < upsertData.length; i += 50) {
            const chunk = upsertData.slice(i, i + 50)
            const { error } = await supabase.from('toast_employees').upsert(chunk, { onConflict: 'toast_guid' })
            if (error) {
                console.error('Error upserting employees:', error)
            }
            else total += chunk.length
        }

        return { count: total, success: true }

    } catch (e: any) {
        console.error('Sync Employees Error:', e)
        return { count: 0, error: e.message }
    }
}

// --- SYNC PUNCHES (TIME ENTRIES) ---
export async function syncToastPunches(storeId: string, startDate: string, endDate: string) {
    const token = await getAuthToken()
    const supabase = await getSupabaseClient()

    try {
        console.log(`Syncing punches for store ${storeId} [${startDate} to ${endDate}]`)
        // Using encodeURIComponent as per Toast protocol for dates with +0000
        const url = `${TOAST_API_HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })

        if (!res.ok) throw new Error(`Failed to fetch punches: ${res.status} ${await res.text()}`)
        const data = await res.json()
        const punches = Array.isArray(data) ? data : []

        console.log(`Fetched ${punches.length} raw punches from Toast`)

        // Prepare for DB
        const upsertData = punches.map((p: any) => ({
            toast_id: p.guid,
            employee_toast_guid: p.employeeReference?.guid,
            job_toast_guid: p.jobReference?.guid,
            store_id: storeId, // Store GUID
            clock_in: p.inDate,
            clock_out: p.outDate,
            business_date: p.businessDate ? `${p.businessDate.slice(0, 4)}-${p.businessDate.slice(4, 6)}-${p.businessDate.slice(6, 8)}` : null,
            last_updated: new Date().toISOString()
        }))

        // Upsert in chunks
        let total = 0
        for (let i = 0; i < upsertData.length; i += 50) {
            const chunk = upsertData.slice(i, i + 50)
            const { error } = await supabase.from('punches').upsert(chunk, { onConflict: 'toast_id' })
            if (error) {
                console.error('Error upserting punches:', JSON.stringify(error, null, 2))
            } else {
                total += chunk.length
            }
        }

        return { count: total, success: true }

    } catch (e: any) {
        console.error('Sync Punches Error:', e)
        return { count: 0, error: e.message }
    }
}

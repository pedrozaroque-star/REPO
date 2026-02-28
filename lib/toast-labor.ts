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

        // 1. Get existing store_ids for these employees to preserve multi-store mapping
        const guids = allEmployees.map((e: any) => e.guid)
        let existingStoreMap: Record<string, string[]> = {}

        if (guids.length > 0) {
            const { data: existingData } = await supabase
                .from('toast_employees')
                .select('toast_guid, store_ids')
                .in('toast_guid', guids)

            if (existingData) {
                existingData.forEach((row: any) => {
                    let stores: string[] = []
                    if (Array.isArray(row.store_ids)) stores = row.store_ids
                    else if (typeof row.store_ids === 'string') {
                        try { stores = JSON.parse(row.store_ids) } catch { stores = [row.store_ids] }
                    }
                    existingStoreMap[row.toast_guid] = stores
                })
            }
        }

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

                store_ids: existingStoreMap[emp.guid]?.includes(storeId)
                    ? existingStoreMap[emp.guid]
                    : [...(existingStoreMap[emp.guid] || []), storeId],

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

        // 1. Fetch ALL data first to avoid partial state if fetch fails
        let allPunches: any[] = []
        let page = 1
        let hasMore = true

        while (hasMore) {
            let retryCount = 0
            const maxRetries = 3
            let success = false

            while (!success && retryCount < maxRetries) {
                const url = `${TOAST_API_HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${page}&pageSize=100`
                try {
                    const res = await fetch(url, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Toast-Restaurant-External-ID': storeId
                        }
                    })

                    if (!res.ok) {
                        if (res.status === 429 || res.status >= 500) {
                            console.warn(`⚠️  Toast API ${res.status} (Page ${page}). Retrying (${retryCount + 1}/${maxRetries})...`)
                            await new Promise(r => setTimeout(r, 2000 * (retryCount + 1)))
                            retryCount++
                            continue
                        }
                        throw new Error(`Failed to fetch punches page ${page}: ${res.status} ${await res.text()}`)
                    }

                    const data = await res.json()
                    success = true // Proceed

                    if (Array.isArray(data) && data.length > 0) {
                        // LOOP PROTECTION: Check if API is returning the same page
                        const newIds = data.map((x: any) => x.guid).join(',')
                        if (allPunches.length > 0) {
                            // Check against the last N records (where N is current batch size)
                            const lastPageStart = Math.max(0, allPunches.length - data.length)
                            const lastPageIds = allPunches.slice(lastPageStart).map((x: any) => x.guid).join(',')

                            if (newIds === lastPageIds) {
                                console.warn(`⚠️  Infinite loop detected (API returned same page ${page}). Stopping fetch.`)
                                hasMore = false
                                success = true
                                break
                            }
                        }

                        allPunches = [...allPunches, ...data]
                        console.log(`Fetched page ${page}: ${data.length} punches`)

                        // Strict Stop Condition:
                        // If we received fewer records than requested, we are surely done.
                        // Toast API behavior: if data.length < pageSize, it's the last page.
                        if (data.length < 50) { // Using 50 generally safe if pageSize is 100
                            hasMore = false
                        } else {
                            page++
                        }
                    } else {
                        hasMore = false
                    }

                } catch (err: any) {
                    if (retryCount >= maxRetries - 1) throw err
                    console.warn(`⚠️  Fetch Error: ${err.message}. Retrying...`)
                    retryCount++
                    await new Promise(r => setTimeout(r, 2000))
                }
            }
        }

        console.log(`Total fetched: ${allPunches.length} punches from Toast. Cleaning old data...`)

        // SAFETY CHECK: If Toast returns 0 records for a multi-day range, abort to prevent accidental mass deletion.
        // Single day syncs might legitimately be 0 (closed store), but multi-day usually implies error.
        const startDateObj = new Date(startDate)
        const endDateObj = new Date(endDate)
        const dayDiff = (endDateObj.getTime() - startDateObj.getTime()) / (1000 * 3600 * 24)

        if (allPunches.length === 0 && dayDiff > 1.5) {
            throw new Error("Safety Stop: Toast returned 0 records for a multi-day range. Aborting sync to protect existing data.")
        }

        // 2. Delete Existing Data for this Range (Prevent Ghost Shifts/Duplicates)
        // Extract YYYY-MM-DD from ISO strings provided
        const startYMD = startDate.split('T')[0]
        const endYMD = endDate.split('T')[0]

        const { error: deleteError } = await supabase
            .from('punches')
            .delete()
            .eq('store_id', storeId)
            .gte('business_date', startYMD)
            .lte('business_date', endYMD)

        if (deleteError) {
            console.error('Error cleaning old punches:', deleteError)
            throw new Error(`Failed to clean old punches: ${deleteError.message}`)
        }

        // 3. Prepare for DB - Include hours from Toast response
        const upsertData = allPunches.map((p: any) => {
            let bDate = p.businessDate ? `${p.businessDate.slice(0, 4)}-${p.businessDate.slice(4, 6)}-${p.businessDate.slice(6, 8)}` : null

            // ENFORCE 6 AM RULE:
            // Toast sometimes assigns 4 AM shifts to "Today", but our rule is 6 AM.
            // We must check the clock-in time and force the correct business date if it falls in the early morning window.
            if (p.inDate) {
                const clockIn = new Date(p.inDate)
                const laTime = new Date(clockIn.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

                // If shift starts before 6:00 AM LA Time, it belongs to the previous day.
                // This overrides whatever Toast says if Toast thinks day starts at 4 AM.
                if (laTime.getHours() < 6) {
                    const correctedDate = new Date(laTime)
                    correctedDate.setDate(correctedDate.getDate() - 1)

                    const y = correctedDate.getFullYear()
                    const m = String(correctedDate.getMonth() + 1).padStart(2, '0')
                    const d = String(correctedDate.getDate()).padStart(2, '0')
                    bDate = `${y}-${m}-${d}`
                } else if (!bDate) {
                    // Fallback if no businessDate and >= 6 AM
                    const y = laTime.getFullYear()
                    const m = String(laTime.getMonth() + 1).padStart(2, '0')
                    const d = String(laTime.getDate()).padStart(2, '0')
                    bDate = `${y}-${m}-${d}`
                }
            }

            return {
                toast_id: p.guid,
                employee_toast_guid: p.employeeReference?.guid,
                job_toast_guid: p.jobReference?.guid,
                store_id: storeId, // Store GUID
                clock_in: p.inDate,
                clock_out: p.outDate,
                business_date: bDate,
                regular_hours: p.regularHours || 0,
                overtime_hours: p.overtimeHours || 0,
                hourly_wage: p.hourlyWage || null,
                breaks: p.breaks || null,
                last_updated: new Date().toISOString()
            }
        })

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

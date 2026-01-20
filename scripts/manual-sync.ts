// scripts/manual-sync.ts
import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
// import fetch from 'node-fetch' -- Native fetch used in Node 18+

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

const STORE_IDS = [
    'acf15327-54c8-4da4-8d0d-3ac0544dc422', // Rialto (Master for Jobs)
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', // Azusa
    '42ed15a6-106b-466a-9076-1e8f72451f6b', // Norwalk
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a', // Downey
    '475bc112-187d-4b9c-884d-1f6a041698ce', // LA Broadway
    'a83901db-2431-4283-834e-9502a2ba4b3b', // Bell
    '5fbb58f5-283c-4ea4-9415-04100ee6978b', // Hollywood
    '47256ade-2cd4-4073-9632-84567ad9e2c8', // Huntington Park
    '8685e942-3f07-403a-afb6-faec697cd2cb', // LA Central
    '3a803939-eb13-4def-a1a4-462df8e90623', // La Puente
    '80a1ec95-bc73-402e-8884-e5abbe9343e6', // Lynwood
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', // Santa Ana
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd', // Slauson
    '95866cfc-eeb8-4af9-9586-f78931e1ea04', // South Gate
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'  // West Covina
]

const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('--- STARTING MANUAL SYNC (MULTI-STORE AGGREGATION) ---')

if (!TOAST_CLIENT_ID || !NEXT_PUBLIC_SUPABASE_URL) {
    console.error('Missing Env Vars')
    process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL!, NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false }
})

let cachedToken: string | null = null

async function getAuthToken() {
    if (cachedToken) return cachedToken
    console.log('Authenticating with Toast...')
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })

    if (!res.ok) throw new Error(`Toast Auth Failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    cachedToken = data.token.accessToken
    return cachedToken
}

async function run() {
    try {
        const token = await getAuthToken()
        console.log('Auth success. Token obtained.')

        // 1. SYNC JOBS (Use first store as master for definitions)
        console.log('\n--- 1. FETCHING JOBS (Using Master Store: Rialto) ---')
        const jobsRes = await fetch(`${TOAST_API_HOST}/labor/v1/jobs`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': STORE_IDS[0]
            }
        })

        if (!jobsRes.ok) throw new Error(`Jobs API Error: ${jobsRes.status}`)
        const jobs = await jobsRes.json()
        console.log(`Fetched ${jobs.length} jobs.`)

        const jobUpsert = jobs.map((job: any) => ({
            guid: job.guid,
            title: job.title,
            external_id: job.externalId,
            deleted: job.deleted,
            last_updated: new Date().toISOString()
        }))

        // Upsert Jobs
        const { error: jobError } = await supabase.from('toast_jobs').upsert(jobUpsert, { onConflict: 'guid' })
        if (jobError) console.error('Supabase Job Error:', jobError)
        else console.log(`Jobs synced successfully.`)


        // 2. SYNC EMPLOYEES (Aggregate Stores)
        console.log('\n--- 2. FETCHING EMPLOYEES & AGGREGATING STORES ---')

        // Map to aggregate employees across stores
        // Key: Employee GUID, Value: Employee Object with store_ids array
        const employeeMap = new Map<string, any>();

        for (const storeId of STORE_IDS) {
            const empRes = await fetch(`${TOAST_API_HOST}/labor/v1/employees?pageSize=200`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (!empRes.ok) {
                console.error(`Error fetching store ${storeId}: ${empRes.status}`)
                continue
            }

            const employees = await empRes.json()
            const empList = Array.isArray(employees) ? employees : []

            // FILTER: ONLY ACTIVE EMPLOYEES
            const activeEmployees = empList.filter((e: any) => !e.deleted)

            if (activeEmployees.length > 0) process.stdout.write(` [${storeId.substring(0, 4)}: ${activeEmployees.length}]`)

            for (const emp of activeEmployees) {
                const existing = employeeMap.get(emp.guid);

                if (existing) {
                    // Employee already found in another store -> Add this storeId
                    if (!existing.store_ids.includes(storeId)) {
                        existing.store_ids.push(storeId);
                    }
                    // TODO: Merge wageOverrides if they differ per store? 
                    // For now, we assume wageOverrides contains the relevant wages for the employee.
                } else {
                    // New Employee
                    const wageData = emp.wageOverrides?.map((w: any) => ({
                        job_guid: w.jobReference?.guid,
                        wage: w.wage,
                    })) || []

                    employeeMap.set(emp.guid, {
                        toast_guid: emp.guid,
                        first_name: emp.firstName,
                        last_name: emp.lastName,
                        chosen_name: emp.chosenName,
                        email: emp.email,
                        phone: emp.phoneNumber,
                        phone_country_code: emp.phoneNumberCountryCode,
                        external_id: emp.externalId,
                        external_employee_id: emp.externalEmployeeId,
                        v2_toast_guid: emp.v2EmployeeGuid,

                        deleted: emp.deleted,
                        created_date: emp.createdDate,
                        deleted_date: emp.deletedDate,

                        wage_data: wageData,
                        job_references: emp.jobReferences || [],

                        store_ids: [storeId], // Initialize with current store

                        last_updated: new Date().toISOString()
                    });
                }
            }
        }

        console.log(`\n\nTotal Unique Employees: ${employeeMap.size}`)
        console.log('Upserting to Supabase...')

        const empUpsert = Array.from(employeeMap.values());

        // Upsert in chunks
        const chunkSize = 100;
        let totalUpserted = 0;
        for (let i = 0; i < empUpsert.length; i += chunkSize) {
            const chunk = empUpsert.slice(i, i + chunkSize);
            const { error: empError } = await supabase.from('toast_employees').upsert(chunk, { onConflict: 'toast_guid' })

            if (empError) console.error(`Supabase Upsert Error (Chunk ${i}):`, empError)
            else totalUpserted += chunk.length;
        }

        console.log(`🎉 Done! Total Employees Saved: ${totalUpserted}`)

    } catch (e: any) {
        console.error('Runtime Error:', e)
    }
}

run()

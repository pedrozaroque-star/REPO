import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function scanAllToastEmployees() {
    console.log('--- SCANNING ALL TOAST EMPLOYEES VIA API (Active + Deleted) ---')
    const token = await getAuthToken()
    if (!token) return

    // 1. Get All Restaurants
    const resStore = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    const dataStore = await resStore.json()
    const stores = Array.isArray(dataStore) ? dataStore : (dataStore.restaurants || [])

    // Map Store GUID to Name
    const storeMap: Record<string, string> = {}
    stores.forEach((s: any) => {
        const guid = s.restaurantGuid || s.guid || s.id
        storeMap[guid] = s.name
    })

    console.log(`Checking ${stores.length} stores for the emails (active & deleted)...`)

    const targets = [
        'isidromondragon16@gmail.com',
        'ortizgustavo1220@gmail.com'
    ]

    for (const store of stores) {
        const guid = store.restaurantGuid || store.guid || store.id
        const storeName = store.name

        // Fetch ALL employees including deleted via time range hack?
        // Toast Labor API doesn't have "showArchived" query param documented publicly but it supports "minLastModifiedDate".
        // However, retrieving ALL history is heavy.
        // We will try without date filter first. Some endpoints return deleted=true records if they are recent.
        // If that fails, we can't reliably "search all archived" via standard API easily without syncing everything.
        // But let's try a specific trick: Some integrations use specific params.

        // Trying to find documentation or standard behavior for fetching deleted.
        // Usually, deleted employees are returned but marked "deleted: true".
        // IF they are not returned, it means they were deleted long ago or API filters them.

        // Let's try to fetch recent modifications far back.
        // Or check if there is an endpoint /labor/v1/employees/deleted? No.

        try {
            const resEmp = await fetch(`${TOAST_API_HOST}/labor/v1/employees?restaurantGuid=${guid}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': guid
                }
            })

            if (!resEmp.ok) continue

            const emps = await resEmp.json()
            if (!Array.isArray(emps)) continue

            emps.forEach((emp: any) => {
                const mail = emp.email ? emp.email.toLowerCase() : ''
                if (targets.includes(mail)) {
                    console.log(`\n🚨 FOUND MATCH!`)
                    console.log(`  Store: ${storeName} (GUID: ${guid})`)
                    console.log(`  Name: ${emp.firstName} ${emp.lastName}`)
                    console.log(`  Email: ${emp.email}`)
                    console.log(`  Deleted: ${emp.deleted}`)
                    console.log(`  Toast GUID: ${emp.guid}`)
                }
            })

        } catch (err) {
            console.error(`Status check failed for ${storeName}`)
        }
    }
    console.log('Scan complete.')
}

scanAllToastEmployees()

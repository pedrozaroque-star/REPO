import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function scanAllToastEmployees() {
    console.log('--- SCANNING ALL TOAST EMPLOYEES VIA API ---')
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

    console.log(`Checking ${stores.length} stores for the emails...`)

    const targets = [
        'isidromondragon16@gmail.com',
        'ortizgustavo1220@gmail.com'
    ]

    for (const store of stores) {
        const guid = store.restaurantGuid || store.guid || store.id
        const storeName = store.name

        // Fetch employees specifically for THIS store (including deleted if API allows param?)
        // Toast API for employees usually returns ALL active/deleted relative to last update?
        // We'll try fetching without date filter to get ALL current state.

        try {
            const resEmp = await fetch(`${TOAST_API_HOST}/labor/v1/employees?restaurantGuid=${guid}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': guid
                }
            })

            if (!resEmp.ok) {
                // console.log(` Skipped ${storeName}: ${resEmp.status}`)
                continue
            }

            const emps = await resEmp.json()
            if (!Array.isArray(emps)) continue

            // Analyze
            emps.forEach((emp: any) => {
                if (emp.email && targets.includes(emp.email.toLowerCase())) {
                    console.log(`\n🚨 FOUND MATCH!`)
                    console.log(`  Store: ${storeName} (GUID: ${guid})`)
                    console.log(`  Name: ${emp.firstName} ${emp.lastName}`)
                    console.log(`  Email: ${emp.email}`)
                    console.log(`  Deleted: ${emp.deleted || false}`)
                    console.log(`  Created: ${emp.createdDate}`)
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

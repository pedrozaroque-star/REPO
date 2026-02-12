import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function inspect() {
    console.log("🔍 Inspecting Toast Menu Response...")
    try {
        const token = await getAuthToken()
        if (!token) throw new Error("No token")

        // Get Guide
        const resRef = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        const dataRef = await resRef.json()
        const guid = dataRef[0]?.restaurantGuid || dataRef.restaurants?.[0]?.guid
        console.log("Store GUID:", guid)

        if (!guid) return

        // Fetch Menu
        const url = `${TOAST_API_HOST}/menus/v2/menus`
        console.log("Fetching:", url)
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': guid
            }
        })

        const data = await res.json()
        console.log("---- DEBUG INFO ----")
        console.log("Type:", typeof data)
        console.log("Is Array?", Array.isArray(data))
        if (!Array.isArray(data) && data.menus && data.menus.length > 0) {
            const firstMenu = data.menus[0]
            console.log("First Menu:", firstMenu.name)
            if (firstMenu.menuGroups && firstMenu.menuGroups.length > 0) {
                const firstGroup = firstMenu.menuGroups[0]
                console.log("First Group:", firstGroup.name)
                console.log("Group Keys:", Object.keys(firstGroup))
                console.log("Items:", JSON.stringify(firstGroup.items).substring(0, 500))
                console.log("Nested Groups:", JSON.stringify(firstGroup.menuGroups).substring(0, 500))
            }
        }

    } catch (e: any) {
        console.error("❌ Error:", e)
    }
}

inspect()

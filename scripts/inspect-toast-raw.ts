import { getAuthToken } from '../lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function inspectRaw() {
    console.log('--- INSPECTING RAW TOAST RESPONSE ---')
    const token = await getAuthToken()
    if (!token) return

    // Get store
    const resStore = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    const dataStore = await resStore.json()
    const stores = Array.isArray(dataStore) ? dataStore : (dataStore.restaurants || [])

    if (stores.length === 0) {
        console.log('No restaurants found:', dataStore)
        return
    }

    const guid = stores[0].restaurantGuid || stores[0].guid || stores[0].id
    console.log(`Store: ${guid}`)

    // Get Menus
    const res = await fetch(`${TOAST_API_HOST}/menus/v2/menus`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': guid
        }
    })

    if (!res.ok) {
        console.log('Error:', res.status)
        return
    }

    const data = await res.json()
    console.log('--- ROOT KEYS ---')
    Object.keys(data).forEach(k => console.log(k))

    // 1. Find Modifier Group GUID for "Taco Choice"
    if (!data.modifierGroupReferences) return

    let targetGroupRefId: string | number | null = null
    Object.values(data.modifierGroupReferences).forEach(g => {
        if (g.name.includes('Taco Choice')) {
            console.log(`Found Target Mod Group: ${g.name} (RefID: ${g.referenceId})`)
            targetGroupRefId = g.referenceId
        }
    })

    if (!targetGroupRefId) {
        console.log('Could not find "Taco Choice" modifier group.')
        return
    }

    // 2. Search Menus for Items that use this Reference
    // We need to fetch menus again or use what we have? 
    // Wait, the 'data' object I have is mostly references. 
    // The actual Menus structure is in data.menus

    console.log('--- SEARCHING FOR PARENTS ---')
    function searchParents(obj: any, path: string) {
        if (Array.isArray(obj)) {
            obj.forEach(o => searchParents(o, path))
            return
        }
        if (obj && typeof obj === 'object') {
            const currentName = obj.name || '?'

            // Check if this item has modifierGroupReferences including our target
            if (obj.modifierGroupReferences) {
                if (obj.modifierGroupReferences.includes(targetGroupRefId)) {
                    console.log(`✅ FOUND PARENT: "${currentName}"`)
                    console.log(`   Path: ${path} > ${currentName}`)
                    console.log(`   Price: ${obj.price}`)
                }
            }

            // Recurse
            if (obj.menuGroups) {
                obj.menuGroups.forEach((g: any) => searchParents(g, path + ' > ' + currentName))
            }
            if (obj.menuItems) {
                obj.menuItems.forEach((i: any) => searchParents(i, path + ' > ' + currentName))
            }
        }
    }

    if (data.menus) {
        searchParents(data.menus, 'Root')
    }
}

inspectRaw()

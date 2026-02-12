import { getSupabaseAdminClient } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

// Interfaces for Toast API Response (Simplified)
interface ToastMenuResponse {
    menus: ToastMenu[]
}

interface ToastMenu {
    name: string
    guid: string
    menuGroups: ToastMenuGroup[]
}

interface ToastMenuGroup {
    guid: string
    name: string
    menuItems: ToastMenuItem[]
    menuGroups?: ToastMenuGroup[] // Nested groups
}

interface ToastMenuItem {
    guid: string
    name: string
    price?: number
    plu?: string
    sku?: string
    outOfStock?: boolean
}

// Flattened Item for DB
interface FlattenedMenuItem {
    guid: string
    name: string
    sku: string | null
    price: number | null
    group_name: string
    is_modifier: boolean
    active: boolean
}

/**
 * Fetch Menu from Toast API
 * Documentation: https://doc.toasttab.com/openapi/menus/operation/getMenus/
 */
async function fetchToastMenuTree(token: string, restaurantGuid: string): Promise<FlattenedMenuItem[]> {
    const url = `${TOAST_API_HOST}/menus/v2/menus`

    // We fetch the entire menu tree for a single restaurant.
    // Assuming the menu is shared or we just need one reference structure.
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': restaurantGuid
        }
    })

    if (!res.ok) {
        const txt = await res.text()
        throw new Error(`Toast Menus API Error (${res.status}): ${txt}`)
    }

    const data = await res.json() as any
    // API might return an object with "menus" property or an array
    const menus = Array.isArray(data) ? data : (data.menus || [])
    // API returns an Array of Menus (e.g. "Food", "Drinks", "Online Ordering")

    // Flatten the tree
    const flatItems: FlattenedMenuItem[] = []

    function processGroup(group: ToastMenuGroup, parentName: string) {
        // console.log(`Processing Group: ${group.name} (${group.menuItems?.length || 0} items)`)
        (group.menuItems || []).forEach(item => {
            flatItems.push({
                guid: item.guid,
                name: item.name,
                sku: item.sku || item.plu || null,
                price: item.price || 0,
                group_name: parentName ? `${parentName} > ${group.name}` : group.name,
                is_modifier: false,
                active: !item.outOfStock
            })
        })

        if (group.menuGroups) {
            group.menuGroups.forEach(subGroup => processGroup(subGroup, parentName ? `${parentName} > ${group.name}` : group.name))
        }
    }

    menus.forEach((menu: any) => {
        console.log(`Processing Menu: ${menu.name} (Groups: ${menu.menuGroups?.length || 0})`)
        if (menu.menuGroups) {
            menu.menuGroups.forEach((group: any) => processGroup(group, menu.name))
        }
    })

    // Deduplicate items by GUID
    // An item can appear in multiple groups/menus. We only need to store it once.
    const uniqueItems = Array.from(
        new Map(flatItems.map(item => [item.guid, item])).values()
    )

    return uniqueItems
}

async function getFirstRestaurantGuid(token: string): Promise<string | null> {
    // Reuse logic or minimal fetch
    const res = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) return null
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data.restaurants || [])
    if (list.length > 0) return list[0].restaurantGuid || list[0].guid || list[0].id
    return null
}

export async function syncMenuFromToast() {
    console.log("🔄 Starting Menu Sync from Toast...")
    const supabase = await getSupabaseAdminClient()

    try {
        const token = await getAuthToken()
        if (!token) throw new Error("Could not authenticate with Toast")

        // 1. Get a target store (Reference Store)
        const referenceStoreGuid = await getFirstRestaurantGuid(token)
        if (!referenceStoreGuid) throw new Error("No stores found in Toast account to fetch menu from.")

        console.log(`📍 Fetching Menu using Reference Store: ${referenceStoreGuid}`)

        // 2. Fetch Tree
        const items = await fetchToastMenuTree(token, referenceStoreGuid)
        console.log(`📦 Found ${items.length} menu items. Syncing to DB...`)

        // 3. Upsert to DB
        // Batch upsert to avoid huge payload? 3000 items might be okay in one go usually, but let's chunk it.
        const CHUNK_SIZE = 500
        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
            const chunk = items.slice(i, i + CHUNK_SIZE)
            const { error } = await supabase
                .from('toast_menu_items')
                .upsert(chunk, { onConflict: 'guid' })

            if (error) {
                console.error("❌ Batch Upsert Error:", error.message)
                throw error
            }
        }

        console.log("✅ Menu Sync Complete!")
        return { success: true, count: items.length }

    } catch (e: any) {
        console.error("❌ Menu Sync Failed:", e.message)
        return { success: false, error: e.message }
    }
}

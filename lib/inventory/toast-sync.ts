import { getSupabaseAdminClient } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

// Interfaces for Toast API Response (Simplified)
// Basic Interfaces
interface ToastMenuResponse {
    menus: ToastMenu[]
    modifierGroupReferences?: Record<string, ToastModifierGroupRef>
    modifierOptionReferences?: Record<string, ToastModifierOptionRef>
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
    modifierGroupReferences?: number[]
}

interface ToastModifierGroupRef {
    referenceId: number
    name: string
    guid: string
    modifierOptionReferences: number[]
}

interface ToastModifierOptionRef {
    referenceId: number
    name: string
    guid: string
    price?: number
    sku?: string
    plu?: string
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

async function fetchToastMenuTree(token: string, restaurantGuid: string): Promise<FlattenedMenuItem[]> {
    const url = `${TOAST_API_HOST}/menus/v2/menus`

    // We fetch the entire menu tree for a single restaurant.
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

    const data = await res.json() as ToastMenuResponse
    const menus = Array.isArray(data) ? data : (data.menus || [])

    // Flatten the tree
    const flatItems: FlattenedMenuItem[] = []

    // 1. Process Modifiers (if available at root)
    if (data.modifierGroupReferences && data.modifierOptionReferences) {
        console.log(`Processing ${Object.keys(data.modifierGroupReferences).length} Modifier Groups...`)

        Object.values(data.modifierGroupReferences).forEach(group => {
            const groupName = `[Mod] ${group.name}`

            group.modifierOptionReferences.forEach(optId => {
                const opt = data.modifierOptionReferences![optId]
                if (opt) {
                    flatItems.push({
                        guid: opt.guid,
                        name: opt.name,
                        sku: opt.sku || opt.plu || null,
                        price: opt.price || 0,
                        group_name: groupName,
                        is_modifier: true,
                        active: true
                    })
                }
            })
        })
    }

    // 2. Process Regular Menus (Last write wins for Dedupe)
    function processItem(item: ToastMenuItem, parentName: string) {
        flatItems.push({
            guid: item.guid,
            name: item.name,
            sku: item.sku || item.plu || null,
            price: item.price || 0,
            group_name: parentName,
            is_modifier: false,
            active: !item.outOfStock
        })
    }

    function processGroup(group: ToastMenuGroup, parentName: string) {
        (group.menuItems || []).forEach(item => {
            processItem(item, parentName ? `${parentName} > ${group.name}` : group.name)
        })

        if (group.menuGroups) {
            group.menuGroups.forEach(subGroup => processGroup(subGroup, parentName ? `${parentName} > ${group.name}` : group.name))
        }
    }

    menus.forEach((menu: any) => {
        // console.log(`Processing Menu: ${menu.name}`)
        if (menu.menuGroups) {
            menu.menuGroups.forEach((group: any) => processGroup(group, menu.name))
        }
    })

    // Deduplicate items by GUID
    // An item can appear in multiple groups/menus. We only need to store it once.
    // Also modifiers might be shared across groups?
    // If a modifier is shared, which group name should we keep?
    // Maybe keep the one that is most descriptive?
    // For now, map logic keeps the LAST one processed.
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

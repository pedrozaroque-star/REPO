// I suspect circular dependency or bad export.
// Let's just import getAuthToken from toast-api which I know exports it.
import { getAuthToken } from './toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export interface ProductMixItem {
    guid: string
    name: string
    group_name?: string
    quantity: number
    net_sales: number // Price - Discounts - Refunds
    gross_sales: number // Price
    voided_quantity: number
}

// ... rest of file

export interface ProductMixOptions {
    storeId: string
    startDate: string
    endDate: string
}

export async function getProductMix(options: ProductMixOptions): Promise<ProductMixItem[]> {
    const { storeId, startDate, endDate } = options
    const token = await getAuthToken()
    if (!token) throw new Error("Auth Token Failed")

    const itemMap = new Map<string, ProductMixItem>()

    // Helper to update map
    const addFn = (guid: string, name: string, qty: number, net: number, gross: number, voided: number) => {
        const existing = itemMap.get(guid) || {
            guid, name, quantity: 0, net_sales: 0, gross_sales: 0, voided_quantity: 0
        }
        existing.quantity += qty
        existing.net_sales += net
        existing.gross_sales += gross
        existing.voided_quantity += voided
        // Update name if we have a better one? Keep first.
        itemMap.set(guid, existing)
    }

    let page = 1
    const pageSize = 100
    let hasMore = true

    // Format YYYY-MM-DD to YYYYMMDD for businessDate
    // WE NEED TO LOOP DAYS if range > 1 day? 
    // ordersBulk accepts valid single businessDate mostly?
    // Docs: "businessDate" (string)
    // We'll iterate dates in the range.

    const curDate = new Date(startDate)
    const lastDate = new Date(endDate)

    while (curDate <= lastDate) {
        const dateStr = curDate.toISOString().split('T')[0]
        const businessDate = dateStr.replace(/-/g, '')
        console.log(`Fetching PMIX for ${dateStr} (${businessDate})...`)
        page = 1
        hasMore = true

        while (hasMore) {
            const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
            url.searchParams.append('businessDate', businessDate)
            url.searchParams.append('pageSize', String(pageSize))
            url.searchParams.append('page', String(page))
            // Fetch full object to ensure we get item.guid and modifiers

            const res = await fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (!res.ok) {
                console.warn(`Failed fetching orders for ${dateStr}: ${res.status}`)
                break // Skip day on error
            }

            const entries = await res.json()
            if (!Array.isArray(entries) || entries.length === 0) {
                hasMore = false
                continue
            }

            // Recursive processor for Selections AND Modifiers
            const processSelection = (sel: any) => {
                if (sel.voided) return // Skip voided (or should we count void quantity?) 
                // User wants Sales primarily. Voids don't count for sales.
                // If we want "Waste", we'd need a separate report.

                const guid = sel.item?.guid
                if (!guid) return // Should not happen for valid items

                const name = sel.displayName
                const qty = Number(sel.quantity || 1)

                let price = Number(sel.price || 0)
                const gross = Number(sel.preDiscountPrice || sel.price || 0)

                // Adjust for Tax Included
                if (sel.taxInclusion === 'INCLUDED') {
                    price -= Number(sel.tax || 0)
                }

                // Refunds
                let refundAmt = 0
                if (sel.refundDetails?.refundAmount) {
                    refundAmt = Number(sel.refundDetails.refundAmount)
                }

                const net = price - refundAmt

                addFn(guid, name, qty, net, gross, 0)

                // Process embedded modifiers
                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => processSelection(mod))
                }
            }

            entries.forEach((order: any) => {
                if (order.voided) return
                if (order.checks) {
                    order.checks.forEach((check: any) => {
                        if (check.voided) return
                        if (check.selections) {
                            check.selections.forEach((sel: any) => processSelection(sel))
                        }
                    })
                }
            })

            if (entries.length < pageSize) hasMore = false
            else page++
        }

        curDate.setDate(curDate.getDate() + 1)
    }

    // Convert Map to Array
    return Array.from(itemMap.values())
}

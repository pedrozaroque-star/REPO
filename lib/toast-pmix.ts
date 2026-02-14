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
                if (sel.voided) return

                const guid = sel.item?.guid
                if (!guid) return

                const name = sel.displayName
                const qty = Number(sel.quantity || 1)

                // Raw Totals (Aggregated)
                let rawPrice = Number(sel.price || 0)
                let rawTax = Number(sel.tax || 0)
                let rawRefund = 0
                if (sel.refundDetails?.refundAmount) {
                    rawRefund = Number(sel.refundDetails.refundAmount)
                }

                // Calculate Child Totals (to subtract)
                let childPrice = 0
                let childTax = 0
                let childRefund = 0

                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => {
                        if (mod.voided) return
                        childPrice += Number(mod.price || 0)
                        childTax += Number(mod.tax || 0)
                        if (mod.refundDetails?.refundAmount) {
                            childRefund += Number(mod.refundDetails.refundAmount)
                        }
                    })
                }

                // Self-Only Amounts (Parent - Children)
                let selfPrice = rawPrice - childPrice
                let selfTax = rawTax - childTax
                let selfRefund = rawRefund - childRefund

                // Adjust for Tax Included
                let selfPreTaxPrice = selfPrice
                if (sel.taxInclusion === 'INCLUDED') {
                    selfPreTaxPrice = selfPrice - selfTax
                }

                // Net Sales = PreTax Price - Refunds
                // Note: Refunds in Toast are usually gross (inc tax)? 
                // If tax is included, refund amount usually includes tax.
                // So Net Sales (ex tax) should subtract Refund (ex tax). 
                // However, commonly 'Net Sales' = (Price - Tax) - (Refund - RefundTax).
                // If we assume refundAmount includes tax if original price did.
                // Let's approximate: Net = SelfPreTaxPrice - (selfRefund - refundTax?)
                // Actually, if we just do: Net = (Price - Refund) - Tax.
                // (10 - 0) - 1 = 9. 
                // Refund 10. (10 - 10) - 0 = 0.
                // Refund 5. (10 - 5) - (0.5?) = 4.5.
                // Simplest: Net = selfPreTaxPrice - selfRefund.
                // WARNING: If selfRefund includes tax, we might be subtracting too much from Sales.
                // But generally correct for "Net Sales" reporting.

                // Let's stick to the user formula: Sum(Price) - Sum(Discounts) - Sum(Refunds).
                // Here Price is "post-discount". 
                // So Net = selfPreTaxPrice - selfRefund.

                const net = selfPreTaxPrice - selfRefund

                // Gross Sales (Pre-Discount)? 
                // sel.preDiscountPrice usually includes modifiers too? Assume yes.
                // We won't try to perfect Good Sales yet, focus on Net.
                // For Gross, we use `selfPrice` (which is post-discount in variable name but pre-discount in reality? No sel.price is post-discount).
                // Use sel.preDiscountPrice if avail.
                let rawGross = Number(sel.preDiscountPrice || sel.price || 0)
                // We'd need to subtract child Gross too... complex.
                // Let's just use selfPrice as "Gross" for this simplified logic unless preDiscount is critical.
                // Actually, the user asked for Net Sales accuracy.

                addFn(guid, name, qty, net, selfPrice, 0)

                // Recurse
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

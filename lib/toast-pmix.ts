import { getAuthToken, getDiningOptions } from './toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export interface ProductMixItem {
    guid: string
    name: string
    group_name?: string
    quantity: number
    net_sales: number
    gross_sales: number
    discounts: number
    voided_quantity: number
    unit_price: number // REAL Toast List Price (Pre-Discount)
}

export interface ProductMixOptions {
    storeId: string
    startDate: string
    endDate: string
}

export async function getProductMix(options: ProductMixOptions): Promise<ProductMixItem[]> {
    const { storeId, startDate, endDate } = options
    const token = await getAuthToken()
    if (!token) throw new Error("Auth Token Failed")

    // Fetch Dining Options Map (GROUP BY DINING OPTION for 3rd Party Split)
    const diningOptionMap = await getDiningOptions(storeId)

    const itemMap = new Map<string, ProductMixItem>()

    // Helper to update map
    const addFn = (guid: string, name: string, groupName: string, qty: number, net: number, gross: number, discount: number, voided: number, unitPrice: number) => {
        const key = `${guid}_${groupName}` // Create unique entry per Item+Group

        const existing = itemMap.get(key) || {
            guid,
            name,
            group_name: groupName,
            quantity: 0,
            net_sales: 0,
            gross_sales: 0,
            discounts: 0,
            voided_quantity: 0,
            unit_price: unitPrice
        }
        existing.quantity += qty
        existing.net_sales += net
        existing.gross_sales += gross
        existing.discounts += discount
        existing.voided_quantity += voided

        // If we found a non-zero price and currently have 0, update it (e.g. first item was a void/comp)
        if (existing.unit_price === 0 && unitPrice > 0) {
            existing.unit_price = unitPrice
        }

        itemMap.set(key, existing)
    }

    let page = 1
    const pageSize = 100
    let hasMore = true

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

            const res = await fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })

            if (!res.ok) {
                console.warn(`Failed fetching orders for ${dateStr}: ${res.status}`)
                break
            }

            const entries = await res.json()
            if (!Array.isArray(entries) || entries.length === 0) {
                hasMore = false
                continue
            }

            // Recursive processor for Selections AND Modifiers
            // Now accepts parentGroupName to inherit context (e.g. Uber Eats)
            const processSelection = (sel: any, parentGroupName?: string, checkId?: string) => {
                if (sel.voided) return

                const guid = sel.item?.guid
                if (!guid) return

                const nameRaw = sel.displayName

                // Append modifiers to name to distinguish variations (e.g. Gallon (Horchata))
                let name = nameRaw
                if (sel.modifiers && Array.isArray(sel.modifiers) && sel.modifiers.length > 0) {
                    const significantMods = sel.modifiers
                        .map((m: any) => m.displayName)
                        .filter((n: string) => !n.startsWith('NO ') && !n.startsWith('No ') && !n.startsWith('Sin ')) // Filter basic exclusions
                        .join(', ')

                    if (significantMods) {
                        name = `${nameRaw} (${significantMods})`
                    }
                }

                const qty = Number(sel.quantity || 1)

                let rawPrice = Number(sel.price || 0)
                let rawTax = Number(sel.tax || 0)
                let rawRefund = 0
                if (sel.refundDetails?.refundAmount) {
                    rawRefund = Number(sel.refundDetails.refundAmount)
                }

                // Calculate Child Totals (to subtract from parent)
                let childPrice = 0
                let childTax = 0
                let childRefund = 0
                let childGross = 0

                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => {
                        if (mod.voided) return

                        const modPrice = Number(mod.price || 0)
                        // Handle null preDiscountPrice properly (treat null/undefined as missing -> fallback to normal price)
                        const rawModPre = mod.preDiscountPrice
                        const modPreDiscount = Number((rawModPre !== undefined && rawModPre !== null) ? rawModPre : modPrice)

                        childPrice += modPrice
                        childGross += modPreDiscount
                        childTax += Number(mod.tax || 0)
                        if (mod.refundDetails?.refundAmount) {
                            childRefund += Number(mod.refundDetails.refundAmount)
                        }
                    })
                }

                let selfPrice = rawPrice - childPrice
                let selfTax = rawTax - childTax
                let selfRefund = rawRefund - childRefund

                // GROSS SALES = Pre-Discount Price (List Price)
                const rawSelPre = sel.preDiscountPrice
                const totalGross = Number((rawSelPre !== undefined && rawSelPre !== null) ? rawSelPre : (sel.price || 0))

                // Subtract child gross so we don't double count modifiers
                let selfGross = totalGross - childGross

                // Discount Logic
                // Gross (List) - Price (Actual) = Discount
                // Ensure no negative (floating point safety)
                const selfDiscount = Math.max(0, selfGross - selfPrice)

                let selfPreTaxPrice = selfPrice
                if (sel.taxInclusion === 'INCLUDED') {
                    selfPreTaxPrice = selfPrice - selfTax
                }

                const net = selfPreTaxPrice - selfRefund

                // GROUPS: Resolve Dining Option
                let groupName = 'Uncategorized'

                // 1. Try explicit diningOption on self
                const doGuid = sel.diningOption?.guid
                if (doGuid && diningOptionMap.has(doGuid)) {
                    groupName = diningOptionMap.get(doGuid)!
                } else if (sel.diningOption?.name) {
                    groupName = sel.diningOption.name
                }

                // 2. If uncategorized, inherit from parent (e.g. Modifier inheriting from Taco)
                if (groupName === 'Uncategorized' && parentGroupName) {
                    groupName = parentGroupName
                }

                // UNIT PRICE is simply selfGross (List Price per item)
                const unitPrice = qty > 0 ? (selfGross / qty) : 0

                // DEBUG: Warn about 0 price items if they look like main items
                // (e.g. Tacos, Burritos) and are not just free add-ons.
                // We'll log it once per unique item to avoid spam.
                if (unitPrice === 0 && selfGross === 0 && qty > 0) {
                    // Log potentially suspicious 0-price items to help diagnose
                    // console.warn(`[Suspicious $0.00] ${name} (Check: ${checkId}) Group: ${groupName}`)
                }

                addFn(guid, name, groupName, qty, net, selfGross, selfDiscount, 0, unitPrice)

                // Recurse, passing down current groupName as parent context
                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => processSelection(mod, groupName, checkId))
                }
            }

            entries.forEach((order: any) => {
                if (order.voided) return

                // Resolve Order-Level Dining Option first
                let orderDO = 'Uncategorized'
                const oGuid = order.diningOption?.guid
                if (oGuid && diningOptionMap.has(oGuid)) {
                    orderDO = diningOptionMap.get(oGuid)!
                } else if (order.diningOption?.name) {
                    orderDO = order.diningOption.name
                }

                // Pass checkId down for debugging context
                if (order.checks) {
                    order.checks.forEach((check: any) => {
                        if (check.voided) return
                        if (check.selections) {
                            // Use orderDO as default parent group
                            check.selections.forEach((sel: any) => processSelection(sel, orderDO, check.guid))
                        }
                    })
                }
            })

            if (entries.length < pageSize) hasMore = false
            else page++
        }

        curDate.setDate(curDate.getDate() + 1)
    }

    return Array.from(itemMap.values())
}

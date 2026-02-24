import { getAuthToken, getDiningOptions } from './toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'

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
    modifier_guids?: string[]
    modifier_gross_sales: number
    half_meat_adjustments: number // Count of "Half" modifiers — used to reduce full meat cost by 50%
}

export interface ProductMixOptions {
    storeId: string
    startDate: string
    endDate: string
    bundleModifiers?: boolean // New flag for bundling modifiers into parent
    mergeDiningOptions?: boolean // New flag for merging all dining options (e.g. food cost reports)
    skipCache?: boolean
}

export async function getProductMix(options: ProductMixOptions): Promise<ProductMixItem[]> {
    const { storeId, startDate, endDate, bundleModifiers = false } = options
    const token = await getAuthToken()
    if (!token) throw new Error("Auth Token Failed")

    // Fetch Dining Options Map (GROUP BY DINING OPTION for 3rd Party Split)
    const diningOptionMap = await getDiningOptions(storeId)

    // Add modifier_guids to map value type (using extended interface internally if needed, or just casting)
    // We updated the interface above, so it's fine.
    const itemMap = new Map<string, ProductMixItem>()

    // Helper to update map
    const addFn = (targetMap: Map<string, ProductMixItem>, guid: string, name: string, groupName: string, qty: number, net: number, gross: number, discount: number, voided: number, unitPrice: number, modGuids?: string[], modGross?: number, halfMeatCount?: number) => {
        // If bundling, we group by Name (variation) to preserve cost accuracy
        // Otherwise, group by GUID+Group (standard PMIX)
        const key = bundleModifiers
            ? `${guid}_${groupName}_${name}`
            : `${guid}_${groupName}`

        const existing = targetMap.get(key) || {
            guid,
            name,
            group_name: groupName,
            quantity: 0,
            net_sales: 0,
            gross_sales: 0,
            discounts: 0,
            voided_quantity: 0,
            unit_price: unitPrice,
            modifier_guids: [],
            modifier_gross_sales: 0,
            half_meat_adjustments: 0
        }
        existing.quantity += qty
        existing.net_sales += net
        existing.gross_sales += gross
        existing.discounts += discount
        existing.voided_quantity += voided
        existing.modifier_gross_sales += (modGross || 0)
        existing.half_meat_adjustments += (halfMeatCount || 0)

        // If we found a non-zero price and currently have 0, update it
        if (existing.unit_price === 0 && unitPrice > 0) {
            existing.unit_price = unitPrice
        }

        // Collect modifier guids if provided
        if (modGuids && modGuids.length > 0) {
            // We just append. If multiple items are merged, we append all their modifiers.
            // This allows calculating total constituent cost for the group.
            if (!existing.modifier_guids) existing.modifier_guids = []
            existing.modifier_guids.push(...modGuids)
        }

        targetMap.set(key, existing)
    }

    const datesToFetch: string[] = []
    const curDateObj = new Date(startDate)
    const lastDateObj = new Date(endDate)

    while (curDateObj <= lastDateObj) {
        datesToFetch.push(curDateObj.toISOString().split('T')[0])
        curDateObj.setDate(curDateObj.getDate() + 1)
    }

    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    const [mm, dd, yyyy] = nowStr.split('/')
    const todayLa = `${yyyy}-${mm}-${dd}`
    const supabase = await getSupabaseAdminClient()

    // Process dates strictly sequentially. 
    // Toast strictly rate-limits the ordersBulk endpoint; concurrent dates trigger 429
    for (const dateStr of datesToFetch) {
        const businessDate = dateStr.replace(/-/g, '')
        const isDirty = (dateStr === todayLa)

        // SELF-HEALING CACHE CHECK
        if (!options.skipCache && !isDirty) {
            const { data: cachedData, error: cacheErr } = await supabase
                .from('pmix_daily_cache')
                .select('items')
                .eq('store_id', storeId)
                .eq('business_date', dateStr)
                .single();

            if (!cacheErr && cachedData && cachedData.items && Array.isArray(cachedData.items) && cachedData.items.length > 0) {
                console.log(`[PMIX Cache HIT] ${dateStr} (${storeId})`)
                cachedData.items.forEach((item: ProductMixItem) => {
                    // Convert potential group_name override if mergeDiningOptions is on.
                    // Doing this locally when loading from cache ensures food-cost queries bypass group grouping.
                    const finalGroupName = options.mergeDiningOptions ? 'All Channels' : (item.group_name || 'Uncategorized')
                    addFn(
                        itemMap,
                        item.guid,
                        item.name,
                        finalGroupName,
                        Number(item.quantity || 0),
                        Number(item.net_sales || 0),
                        Number(item.gross_sales || 0),
                        Number(item.discounts || 0),
                        Number(item.voided_quantity || 0),
                        Number(item.unit_price || 0),
                        item.modifier_guids,
                        Number(item.modifier_gross_sales || 0),
                        Number(item.half_meat_adjustments || 0)
                    )
                })
                continue;
            }
        }

        console.log(`[PMIX LIVE FETCH] ${dateStr} (${businessDate})...`)

        let page = 1
        const pageSize = 100
        let hasMore = true

        const dayItemMap = new Map<string, ProductMixItem>()

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
            const processSelection = (sel: any, parentGroupName?: string, checkId?: string) => {
                if (sel.voided) return

                const guid = sel.item?.guid
                if (!guid) return

                const nameRaw = sel.displayName

                // Append modifiers to name
                let name = nameRaw
                let significantMods = ''
                if (sel.modifiers && Array.isArray(sel.modifiers) && sel.modifiers.length > 0) {
                    significantMods = sel.modifiers
                        .map((m: any) => m.displayName)
                        .filter((n: string) => !n.startsWith('NO ') && !n.startsWith('No ') && !n.startsWith('Sin '))
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

                // If NOT bundling, we subtract child prices to isolate Parent
                // If bundling, we want the Aggregate (Parent + Children) values for this row
                let childPrice = 0
                let childTax = 0
                let childRefund = 0
                let childGross = 0

                const modGuids: string[] = []
                let halfMeatCount = 0

                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => {
                        if (mod.voided) return

                        // Collect GUIDs if bundling
                        if (bundleModifiers && mod.item?.guid) {
                            modGuids.push(mod.item.guid)
                            // Detect "Half" meat modifiers (e.g. "Half Pollo", "Half Pastor")
                            // Each Half means the main meat portion should be halved
                            if (mod.displayName && /^half /i.test(mod.displayName)) {
                                halfMeatCount++
                            }
                        }

                        // Always track child gross for separation logic
                        const modPrice = Number(mod.price || 0)
                        const rawModPre = mod.preDiscountPrice
                        const modPreDiscount = Number((rawModPre !== undefined && rawModPre !== null) ? rawModPre : modPrice)
                        childGross += modPreDiscount

                        if (!bundleModifiers) {
                            // Only calculate child subtraction if we are recursing/splitting
                            childPrice += modPrice
                            childTax += Number(mod.tax || 0)
                            if (mod.refundDetails?.refundAmount) {
                                childRefund += Number(mod.refundDetails.refundAmount)
                            }
                        }
                    })
                }

                // If bundling, self metrics are the RAW metrics (don't subtract children)
                // If not bundling, self metrics are (Raw - Children)
                let selfPrice = rawPrice - childPrice
                let selfTax = rawTax - childTax
                let selfRefund = rawRefund - childRefund

                // GROSS SALES
                const rawSelPre = sel.preDiscountPrice
                const totalGross = Number((rawSelPre !== undefined && rawSelPre !== null) ? rawSelPre : (sel.price || 0))
                let selfGross = totalGross - childGross

                // Discount Logic
                const selfDiscount = Math.max(0, selfGross - selfPrice)

                let selfPreTaxPrice = selfPrice
                if (sel.taxInclusion === 'INCLUDED') {
                    selfPreTaxPrice = selfPrice - selfTax
                }

                const net = selfPreTaxPrice - selfRefund

                // Start Group Logic
                let groupName = 'Uncategorized'
                const doGuid = sel.diningOption?.guid
                if (doGuid && diningOptionMap.has(doGuid)) {
                    groupName = diningOptionMap.get(doGuid)!
                } else if (sel.diningOption?.name) {
                    groupName = sel.diningOption.name
                }
                if (groupName === 'Uncategorized' && parentGroupName) {
                    groupName = parentGroupName
                }

                // Override if merging dining options
                if (options.mergeDiningOptions) {
                    groupName = 'All Channels'
                }
                // End Group Logic

                const unitPrice = qty > 0 ? ((selfGross - (bundleModifiers ? childGross : 0)) / qty) : 0

                // Add to Map
                addFn(dayItemMap, guid, name, groupName, qty, net, selfGross, selfDiscount, 0, unitPrice, bundleModifiers ? modGuids : undefined, childGross, halfMeatCount)

                // Recurse ONLY if NOT bundling
                if (!bundleModifiers && sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => processSelection(mod, groupName, checkId))
                }
            }

            entries.forEach((order: any) => {
                if (order.voided) return
                let orderDO = 'Uncategorized'
                const oGuid = order.diningOption?.guid
                if (oGuid && diningOptionMap.has(oGuid)) {
                    orderDO = diningOptionMap.get(oGuid)!
                } else if (order.diningOption?.name) {
                    orderDO = order.diningOption.name
                }

                if (order.checks) {
                    order.checks.forEach((check: any) => {
                        if (check.voided) return
                        if (check.selections) {
                            check.selections.forEach((sel: any) => processSelection(sel, orderDO, check.guid))
                        }
                    })
                }
            })

            if (entries.length < pageSize) hasMore = false
            else page++
        }

        // --- END OF DAY LOGIC: MERGE AND CACHE ---
        const dayItems = Array.from(dayItemMap.values())

        // 1. Merge into Master ItemMap
        dayItems.forEach(item => {
            // Since group reduction for mergeDiningOptions already happened inside dayItemMap 
            // via parentGroupName processing, we just dump it in.
            // But if `addFn` reconstructs key, that's fine.
            addFn(
                itemMap,
                item.guid,
                item.name,
                item.group_name || 'Uncategorized',
                item.quantity,
                item.net_sales,
                item.gross_sales,
                item.discounts,
                item.voided_quantity,
                item.unit_price,
                item.modifier_guids,
                item.modifier_gross_sales,
                item.half_meat_adjustments
            )
        });

        // 2. Async Write-Back (Self-Healing Cache)
        if (!isDirty && dayItems.length > 0) {
            // We use standard group names during caching to ensure raw reusability, but we already applied mergeDiningOptions to dayItemMap.
            // CAUTION: If `mergeDiningOptions: true`, dayItems will have "All Channels".
            // It's safer to always cache the RAW PMIX data.
            // Oh, wait! If `mergeDiningOptions` is true during a live fetch, we corrupt the cache with grouped data.
            // Since this cache stores the full day, we should probably ALWAYS fetch exactly what was requested, 
            // but for safety, the next fetching query will re-apply `mergeDiningOptions` from cache!
            // Wait, if it's cached as `All Channels`, we lose granularity.
            // But this is PMIX cache.
            console.log(`[PMIX Cache WRITE] Saving ${dayItems.length} items for ${dateStr} (${storeId})...`)

            // Fire and forget
            supabase.from('pmix_daily_cache').upsert({
                store_id: storeId,
                business_date: dateStr,
                items: dayItems
            }, { onConflict: 'store_id,business_date' })
                .then(({ error }) => {
                    if (error) console.error(`[PMIX Cache WRITE] Error for ${dateStr}:`, error)
                    else console.log(`[PMIX Cache WRITE] Success for ${dateStr}`)
                })
        }
    }

    return Array.from(itemMap.values())
}

/**
 * @module lib/toast-pmix
 * @description Fetches and aggregates the Product Mix (PMIX) from Toast API. Key to determining item-level sales volume.
 * 
 * @businessRules
 * - **Integración de Modificadores (Bundling)**: Integra las selecciones de modificadores dentro de los items padres si se activa la opción de agrupación para simplificar el análisis de costos.
 * - **Fusión de Dining Options**: Agrupa y unifica los tipos de servicio (dining options) para facilitar el análisis financiero y de rendimiento de canales de delivery de terceros (3rd-party delivery).
 * - **Ajuste de Media Porción de Carne (Half Meat Adjustments)**: Identifica y cuenta modificadores con prefijo "Half" (ej: "Half Pollo", "Half Pastor") para reducir el cálculo del costo de carne completa en un 50% durante el análisis de recetas.
 * 
 * @dataFlow
 * - Toast `/orders/v2/ordersBulk` o tablas de caché -> procesa las selecciones (selections) y distribuciones de cantidad por item -> retorna listas de items de menú vendidos (`ProductMixItem[]`) con sus ventas netas, cantidades y mapeo de modificadores.
 * 
 * @notes
 * - Implementa un mecanismo de caché autosanable (`pmix_daily_cache`) para evitar llamadas duplicadas y costosas al API.
 * - Dado el límite estricto de Toast API, las fechas se procesan de forma estrictamente secuencial para evitar errores 429.
 * - [2026-07-26] BUGFIX: Evita usar caché de PMIX incompleta (creada por pedidos a futuro o catering antes del día operativo real) comprobando que `updated_at` (en Los Angeles time) no sea anterior a `business_date`.
 * - [2026-09-09] BUGFIX & HARDENING: Escritura de caché convertida a síncrona (await) para evitar pérdida de promesas en serverless. Añadido candado de seguridad (Guard Clause) que bloquea Live Fetch a Toast en fechas con más de 120 días de antigüedad cuando no se solicite forzado explícito (skipCache).
 * - [2026-11-23] BUGFIX CRÍTICO: (1) Aplicada regla corporativa de 06:00 AM (`getBusinessDateLA()`) en `todayLa` e `isDirty` para impedir que entre 12:00 AM y 5:59 AM PT se congele `pmix_daily_cache` a medianoche perdiendo las órdenes nocturnas (12 AM–4 AM); (2) Corregida doble resta de `childGross` en `unitPrice` (`selfGross / qty`); (3) Acotados los reintentos por `429` a un máximo de 4 por página con backoff progresivo.
 */
import { getAuthToken, getDiningOptions } from './toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'
import {
    addDaysIso,
    diffCalendarDays,
    getBusinessDateLA,
    getLANowParts,
} from '@/lib/inventory/food-cost-sales-resolver'

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
    let curDate = startDate
    while (curDate <= endDate) {
        datesToFetch.push(curDate)
        curDate = addDaysIso(curDate, 1)
    }

    // Regla corporativa de las 06:00 AM (America/Los_Angeles):
    // Entre 12:00 AM y 05:59 AM PT, el día laboral del día anterior sigue ABIERTO (`isDirty = true`),
    // impidiendo que se congele `pmix_daily_cache` a medianoche y se pierdan las órdenes de 12 AM–4 AM.
    const todayLa = getBusinessDateLA()
    const supabase = await getSupabaseAdminClient()

    // Process dates strictly sequentially. 
    // Toast strictly rate-limits the ordersBulk endpoint; concurrent dates trigger 429
    for (const dateStr of datesToFetch) {
        const businessDate = dateStr.replace(/-/g, '')
        const isDirty = (dateStr >= todayLa)

        // SELF-HEALING CACHE CHECK
        if (!options.skipCache && !isDirty) {
            const { data: cachedData, error: cacheErr } = await supabase
                .from('pmix_daily_cache')
                .select('items, updated_at')
                .eq('store_id', storeId)
                .eq('business_date', dateStr)
                .single();

            if (!cacheErr && cachedData && cachedData.items && Array.isArray(cachedData.items) && cachedData.items.length > 0) {
                // Validación defensiva: verificar si la caché se generó ANTES de la fecha operativa
                // (ej. pedido a futuro / catering procesado antes de la fecha operativa real).
                const updatedAt = new Date(cachedData.updated_at)
                const updatedAtDateStr = getLANowParts(updatedAt).calendarDate

                if (updatedAtDateStr < dateStr) {
                    console.log(`[PMIX Cache BYPASS] Caché de pedido futuro detectada para ${dateStr} (${storeId}). Creado el: ${updatedAtDateStr}. Forzando descarga en vivo.`)
                } else {
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
        }

        // DEFENSIVE GUARD: Prevenir saturación de Toast API (Error 429 y Timeout 504)
        // Si no está en caché y la fecha tiene más de 120 días, NO llamar a Toast en vivo a menos que se fuerce explícitamente (skipCache: true)
        const daysAgo = diffCalendarDays(dateStr, todayLa)
        if (!options.skipCache && daysAgo > 120) {
            console.warn(`[PMIX LIVE FETCH BLOCKED] Fecha ${dateStr} (${daysAgo} días atrás) no está en caché. Se omite llamada a Toast API para evitar Error 429 y Timeout 504.`)
            continue
        }

        console.log(`[PMIX LIVE FETCH] ${dateStr} (${businessDate})...`)

        let page = 1
        const pageSize = 100
        let hasMore = true
        let rateLimitRetries = 0
        const MAX_429_RETRIES = 4

        const dayItemMap = new Map<string, ProductMixItem>()

        while (hasMore) {
            const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
            url.searchParams.append('businessDate', businessDate)
            url.searchParams.append('pageSize', String(pageSize))
            url.searchParams.append('page', String(page))

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 60000)

            const res = await fetch(url.toString(), {
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })
            clearTimeout(timeoutId)

            if (!res.ok) {
                const errTxt = await res.text().catch(() => '')
                console.error(`[PMIX] Error ${res.status}: ${errTxt}`)
                if (res.status === 429 && rateLimitRetries < MAX_429_RETRIES) {
                    rateLimitRetries++
                    const backoffMs = Math.min(5000 * rateLimitRetries, 15000)
                    console.warn(`[Toast API] Rate limited on PMIX page ${page} (retry ${rateLimitRetries}/${MAX_429_RETRIES}), waiting ${backoffMs}ms...`)
                    await new Promise(r => setTimeout(r, backoffMs))
                    continue // retry the same page
                }
                throw new Error(`Toast API Error (${storeId}): ${res.status}${res.status === 429 ? ` (exceeded ${MAX_429_RETRIES} rate-limit retries)` : ''}`)
            }
            rateLimitRetries = 0

            const entries = await res.json()
            if (!Array.isArray(entries) || entries.length === 0) {
                hasMore = false
                continue
            }

            // Recursive processor for Selections AND Modifiers
            const processSelection = (sel: any, parentGroupName?: string, checkId?: string, parentQty: number = 1) => {
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

                const currentQty = Number(sel.quantity || 1)
                const qty = currentQty * parentQty

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
                            // CRITICAL: Toast pre-scales mod.quantity by parent sel.quantity
                            // e.g., 10 tacos with Salsa Roja → Toast sends mod.quantity=10
                            // So we use modBaseQty directly — do NOT multiply by qty again
                            const modBaseQty = Number(mod.quantity || 1)
                            for (let i = 0; i < modBaseQty; i++) {
                                modGuids.push(mod.item.guid)
                            }
                            // Detect "Half" meat modifiers (e.g. "Half Pollo", "Half Pastor")
                            // Each Half means the main meat portion should be halved
                            if (mod.displayName && /^half /i.test(mod.displayName)) {
                                halfMeatCount += modBaseQty
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

                // selfGross at L318 already subtracted childGross; do NOT subtract childGross a second time
                const unitPrice = qty > 0 ? (selfGross / qty) : 0

                // Add to Map
                addFn(dayItemMap, guid, name, groupName, qty, net, selfGross, selfDiscount, 0, unitPrice, bundleModifiers ? modGuids : undefined, childGross, halfMeatCount)

                // Recurse ONLY if NOT bundling
                if (!bundleModifiers && sel.modifiers && Array.isArray(sel.modifiers)) {
                    sel.modifiers.forEach((mod: any) => processSelection(mod, groupName, checkId, qty))
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
                            check.selections.forEach((sel: any) => processSelection(sel, orderDO, check.guid, 1))
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

        // 2. Write-Back (Self-Healing Cache) ONLY for closed days with full channel + bundled modifier fidelity
        if (!isDirty && dayItems.length > 0 && bundleModifiers && !options.mergeDiningOptions) {
            console.log(`[PMIX Cache WRITE] Saving ${dayItems.length} items for ${dateStr} (${storeId})...`)

            const { error: writeErr } = await supabase.from('pmix_daily_cache').upsert({
                store_id: storeId,
                business_date: dateStr,
                items: dayItems,
                updated_at: new Date().toISOString()
            }, { onConflict: 'store_id,business_date' })

            if (writeErr) console.error(`[PMIX Cache WRITE] Error for ${dateStr}:`, writeErr)
            else console.log(`[PMIX Cache WRITE] Success for ${dateStr}`)
        }
    }

    return Array.from(itemMap.values())
}

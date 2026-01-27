import { getSupabaseClient } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

// DEBUG LOGGING HELPER
const logDebug = (msg: string, data?: any) => {
    try {
        const timestamp = new Date().toISOString()
        const logLine = `[${timestamp}] ${msg} ${data ? JSON.stringify(data) : ''}\n`
        const logPath = path.join(process.cwd(), 'server-debug.log')
        fs.appendFileSync(logPath, logLine)
    } catch (e) {
        // Limit console noise
    }
}

// --- CONFIGURATION ---
const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || ''
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || ''

export interface ToastMetricsOptions {
    storeIds: string | 'all'
    startDate: string
    endDate: string
    groupBy: 'day' | 'week' | 'month' | 'year'
    skipCache?: boolean
    fastMode?: boolean
}

export interface MetricRow {
    storeId: string
    storeName: string
    periodStart: string
    periodEnd: string
    netSales: number
    grossSales: number
    discounts: number
    tips: number
    taxes: number
    serviceCharges: number
    orderCount: number
    guestCount: number
    totalHours: number
    laborCost: number // Regular + Overtime
    laborPercentage: number
    splh: number // Sales Per Labor Hour
    uberSales?: number
    doordashSales?: number
    grubhubSales?: number
    ebtCount?: number
    ebtAmount?: number
    hourlySales?: Record<number, number>
    hourlyTickets?: Record<number, number>
}

// Map store generic ID to Toast restaurantGuid
const STORE_NAME_OVERRIDES: Record<string, string> = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington Park',
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina'
}

// Token Cache
let cachedToken: string | null = null
let tokenExpiry: number = 0

// --- AUTHENTICATION ---
async function getAuthToken() {
    // Return cached token if valid (buffer 5 min)
    if (cachedToken && Date.now() < tokenExpiry - 300000) {
        return cachedToken
    }

    try {
        const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                clientId: TOAST_CLIENT_ID,
                clientSecret: TOAST_CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Auth Failed: ${res.status} ${err}`)
        }

        const data = await res.json()
        cachedToken = data.token.accessToken
        // Assuming typical 1h expiry, set local expiry
        tokenExpiry = Date.now() + (3600 * 1000)
        return cachedToken
    } catch (error) {
        throw error
    }
}


// --- HELPER: GET RESTAURANTS ---
async function getRestaurants(token: string) {
    const res = await fetch(`${TOAST_API_HOST}/partners/v1/restaurants`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })

    if (!res.ok) {
        return []
    }

    const data = await res.json()
    let list = []
    if (Array.isArray(data)) list = data
    else if (data && Array.isArray(data.restaurants)) list = data.restaurants
    else return []

    return list.map((r: any) => {
        const id = r.restaurantGuid || r.guid || r.id
        const originalName = r.restaurantName || r.name
        return {
            id,
            name: STORE_NAME_OVERRIDES[id] || originalName
        }
    })
}

// --- HELPER: GET DINING OPTIONS MAP ---
async function getDiningOptionsMap(token: string, storeId: string): Promise<Record<string, string>> {
    try {
        const url = new URL(`${TOAST_API_HOST}/config/v2/diningOptions`)
        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (!res.ok) return {}
        const data = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(data)) {
            data.forEach((opt: any) => {
                if (opt.guid && opt.name) map[opt.guid] = opt.name
            })
        }
        return map
    } catch (e) {
        return {}
    }
}


// --- HELPER: GET SALES (ATTEMPT) ---
// Since we might not have Reporting API, we'll try to get Orders Summary or Fallback
async function getSalesForStore(token: string, storeId: string, startDate: string, endDate: string, fastMode: boolean = false) {
    try {
        // Fetch Metadata Map first
        const diningOptionMap = fastMode ? {} : await getDiningOptionsMap(token, storeId)


        let net = 0
        let gross = 0
        let totalDiscounts = 0
        let totalTips = 0
        let totalTaxes = 0
        let totalSvcCharges = 0
        let count = 0
        let guests = 0

        // Channel Breakdowns
        let uber = 0
        let doordash = 0
        let grubhub = 0
        let ebtC = 0
        let ebtA = 0

        let page = 1
        const pageSize = 100
        let hasMore = true
        // Robust date formatting: YYYY-MM-DD -> YYYYMMDD
        const formattedDate = startDate.split('-').join('')

        const hourlySales: Record<number, number> = {}
        const hourlyTickets: Record<number, number> = {}
        for (let i = 0; i < 24; i++) {
            hourlySales[i] = 0
            hourlyTickets[i] = 0
        }

        while (hasMore) {
            const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
            url.searchParams.append('businessDate', formattedDate)
            url.searchParams.append('pageSize', String(pageSize))
            url.searchParams.append('page', String(page))

            let fields = ''
            if (fastMode) {
                // FAST MODE: Only Check Totals. NO SELECTIONS (Items).
                // Net ~= Check Amount - Tax - Tip
                fields = [
                    'openedDate',
                    'voided',
                    'numberOfGuests',
                    'checks.voided',
                    'checks.amount', // Total with Tax/Tip
                    'checks.taxAmount',
                    'checks.payments.tipAmount',
                    'checks.payments.amount',
                    // We might need discounts to get Gross roughly
                    'checks.appliedDiscounts'
                ].join(',')
            } else {
                // FULL PRECISION MODE
                fields = [
                    'diningOption',
                    'voided',
                    'openedDate',
                    'numberOfGuests',
                    'checks.voided',
                    'checks.amount',
                    'checks.taxAmount',
                    'checks.appliedDiscounts',
                    'checks.appliedServiceCharges',
                    'checks.payments.tipAmount',
                    'checks.payments.amount',
                    'checks.payments.displayName',
                    'checks.payments.paymentInstrument',
                    'checks.payments.refundStatus',
                    'checks.payments.refundAmount',
                    'checks.selections.price',
                    'checks.selections.preDiscountPrice',
                    'checks.selections.quantity',
                    'checks.selections.tax',
                    'checks.selections.taxInclusion',
                    'checks.selections.displayName',
                    'checks.selections.voided',
                    'checks.selections.deferred',
                    'checks.selections.refundDetails',
                    'checks.selections.toastGiftCard',
                    'checks.serviceCharges',
                    'serviceCharges',
                    'source',
                    'deliveryService'
                ].join(',')
            }
            url.searchParams.append('fields', fields)

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 25000) // 25s timeout

            console.log(`[FastMode] Fetching for ${storeId} (Fast=${fastMode})`)

            const res = await fetch(url.toString(), {
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })
            clearTimeout(timeoutId)

            if (!res.ok) {
                const errTxt = await res.text().catch(() => 'No Body')
                console.error(`[FastMode] ERROR ${res.status}: ${errTxt}`)
                break
            }

            const data = await res.json()
            const orders = Array.isArray(data) ? data : []

            orders.forEach((order: any) => {
                if (order.voided) return
                count++
                guests += (order.numberOfGuests || 1)
                let orderNetCalc = 0

                let hour = -1
                if (order.openedDate) {
                    try {
                        // Force conversion to LA Time (PST/PDT)
                        // This handles UTC -> Local conversion strictly
                        const laTime = new Date(order.openedDate).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            hour12: false,
                            timeZone: 'America/Los_Angeles'
                        })
                        hour = parseInt(laTime)
                        // Handle "24" edge case if any, though hour12:false usually gives 0-23
                        if (hour === 24) hour = 0

                        // Increment Ticket Count for this hour
                        if (hour >= 0 && hour < 24) {
                            hourlyTickets[hour] = (hourlyTickets[hour] || 0) + 1
                        }
                    } catch (e) { }
                }

                if (order.checks && Array.isArray(order.checks)) {
                    if (fastMode) {
                        // --- FAST MODE LOGIC ---
                        order.checks.forEach((check: any) => {
                            if (check.voided) return
                            // check.payments?.some(...) removed

                            // Simple Net = Amount - Tax - Tip + ServiceCharges
                            let checkAmt = Number(check.amount || 0)
                            const checkTax = Number(check.taxAmount || 0)
                            let checkTip = 0
                            check.payments?.forEach((p: any) => checkTip += Number(p.tipAmount || 0))

                            let checkSvc = 0
                            check.serviceCharges?.forEach((s: any) => checkSvc += Number(s.amount || 0))

                            let checkNet = checkAmt - checkTax - checkTip + checkSvc

                            net += checkNet
                            orderNetCalc += checkNet

                            // Attempt Gross Approximation: Net + Discounts
                            // Note: without items, we can't know pre-discount price perfectly, but Check Amount + Discounts is close enough for live
                            let checkDisc = 0
                            check.appliedDiscounts?.forEach((d: any) => checkDisc += Number(d.amount || 0))
                            gross += (checkNet + checkDisc)
                            totalDiscounts += checkDisc
                            totalTaxes += checkTax
                            totalTips += checkTip

                            if (hour >= 0 && hour < 24) {
                                hourlySales[hour] = (hourlySales[hour] || 0) + checkNet
                            }
                        })

                        // Add Order Level Service Charges (e.g. Delivery)
                        order.serviceCharges?.forEach((s: any) => {
                            const sAmt = Number(s.amount || 0)
                            net += sAmt
                            if (hour >= 0 && hour < 24) hourlySales[hour] = (hourlySales[hour] || 0) + sAmt
                        })

                    } else {
                        // --- FULL PRECISION LOGIC ---
                        order.checks.forEach((check: any) => {
                            if (check.voided) return

                            if (check.voided) return
                            // check.payments?.some(...) removed to include re-paid checks

                            // --- EBT DETECTION (Check Level) ---
                            // iterate payments to find EBT
                            check.payments?.forEach((p: any) => {
                                const pName = (p.displayName || p.paymentInstrument?.displayName || '').toLowerCase()
                                if (pName.includes('ebt')) {
                                    ebtC++
                                    ebtA += Number(p.amount || 0)
                                }
                            })

                            // 1. Calculate from selections (excluding gift cards)
                            let checkItemNetSum = 0     // Sum of price (after item discounts)
                            let checkItemGrossSum = 0   // Sum of preDiscountPrice (before any discounts)
                            let checkItemRefunds = 0    // Sum of refunds on items
                            let giftCardTotal = 0

                            const sumSelection = (sel: any, isGiftCard: boolean) => {
                                // SKIP VOIDED ITEMS
                                if (sel.voided) return
                                // SKIP DEFERRED ITEMS unless it is a Gift Card Load (Add Value)
                                if (sel.deferred && !isGiftCard) return

                                let itemPrice = Number(sel.price || 0)
                                const itemPreDiscount = Number(sel.preDiscountPrice || sel.price || 0)

                                // HANDLE TAX INCLUDED ITEMS
                                if (sel.taxInclusion === 'INCLUDED') {
                                    const taxAmount = Number(sel.tax || 0)
                                    itemPrice -= taxAmount
                                }

                                // Item Refunds
                                if (sel.refundDetails?.refundAmount) {
                                    checkItemRefunds += Number(sel.refundDetails.refundAmount)
                                }

                                if (isGiftCard) {
                                    giftCardTotal += itemPrice
                                } else {
                                    checkItemNetSum += itemPrice
                                    checkItemGrossSum += itemPreDiscount
                                }
                            }

                            check.selections?.forEach((sel: any) => {
                                const isGiftCard = sel.toastGiftCard || sel.displayName?.toLowerCase().includes('gift card')
                                sumSelection(sel, isGiftCard)
                            })

                            // 3. Final Net and Gross
                            // Gross = Sum of pre-discount prices (before ANY discounts)
                            const checkGross = checkItemGrossSum
                            let checkNet = checkItemNetSum // Initial - refunds logic applies below
                            let checkDiscounts = 0


                            // Deduct Check-level discounts
                            if (check.appliedDiscounts) {
                                const checkLevelDiscountAmount = check.appliedDiscounts.reduce((sum: number, d: any) => sum + (d.amount || 0), 0)
                                checkNet -= checkLevelDiscountAmount
                                checkDiscounts += checkLevelDiscountAmount
                            }

                            // Apply item refunds
                            checkNet -= checkItemRefunds
                            checkDiscounts += (checkGross - checkNet - checkDiscounts) // Adjust totalDiscounts based on final net/gross

                            // 4. Other metrics
                            const checkTax = Number(check.taxAmount || 0)

                            let checkTips = 0
                            check.payments?.forEach((p: any) => {
                                checkTips += Number(p.tipAmount || 0)
                            })

                            let checkSvc = 0
                            check.appliedServiceCharges?.forEach((svc: any) => {
                                checkSvc += Number(svc.chargeAmount || 0)
                            })

                            // 5. Aggregate totals

                            // ADJUST FOR UNLINKED REFUNDS (Payment refunds not attached to items)
                            let paymentRefunds = 0
                            check.payments?.forEach((p: any) => paymentRefunds += Number(p.refundAmount || 0))

                            // If payment refunds exceed item refunds, substract the difference from Net
                            if (paymentRefunds > (checkItemRefunds + 0.01)) {
                                const unlinked = paymentRefunds - checkItemRefunds
                                checkNet -= unlinked
                                // Also reduce Gross? Usually refunds reduce Net. Gross is "Sales". 
                                // Net = Gross - Disc - Refunds. 
                                // Our checkNet was (checkItemNetSum - checkItemRefunds).
                                // So reducing it further is correct.
                            }

                            net += checkNet
                            orderNetCalc += checkNet
                            gross += checkGross
                            totalDiscounts += checkDiscounts
                            totalTips += checkTips
                            totalTaxes += checkTax
                            totalSvcCharges += checkSvc

                            if (hour >= 0 && hour < 24) {
                                hourlySales[hour] = (hourlySales[hour] || 0) + checkNet
                            }
                        })
                    }
                }

                // --- DETECTION & ATTRIBUTION ---
                const dName = order.diningOption?.name || diningOptionMap[order.diningOption?.guid] || ''
                const dService = (order.deliveryService?.name || '').toLowerCase()
                const dOptionRaw = dName.toLowerCase()
                const sourceRaw = (typeof order.source === 'string' ? order.source : (order.source?.name || '')).toLowerCase()

                const fullString = `${dService} ${dOptionRaw} ${sourceRaw}`.trim()

                const isUber = fullString.includes('uber') || fullString.includes('eats') || fullString.includes('postmates')
                const isDoorDash = fullString.includes('doordash') || fullString.includes('dash')
                const isGrubHub = fullString.includes('grubhub') || fullString.includes('grub')

                if (isUber) uber += orderNetCalc
                else if (isDoorDash) doordash += orderNetCalc
                else if (isGrubHub) grubhub += orderNetCalc
            })



            // Log Summary ONCE guaranteed
            if ((global as any).sourceSummary && !(global as any).SUMMARY_LOGGED) {
                console.log('[FINAL SOURCES SUMMARY]', JSON.stringify((global as any).sourceSummary, null, 2))
                    ; (global as any).SUMMARY_LOGGED = true
            }


            if (orders.length < pageSize) hasMore = false
            else page++
        }

        return {
            netSales: net,
            grossSales: gross,
            discounts: totalDiscounts,
            tips: totalTips,
            taxes: totalTaxes,
            serviceCharges: totalSvcCharges,
            orders: count,
            guests: guests,
            hours: count * 0.4,
            hourlySales,
            hourlyTickets,
            uberSales: uber,
            doordashSales: doordash,
            grubhubSales: grubhub,
            ebtCount: ebtC,
            ebtAmount: ebtA
        }
    } catch (e: any) {
        logDebug(`Detailed Sales Error [${storeId}]:`, e.message)
        // RETHROW to debug live sync issues
        throw new Error(`Toast API Error (${storeId}): ${e.message}`)
    }
}

// --- HELPER: GET LABOR ---
async function getLaborForRange(token: string, storeId: string, startDate: string, endDate: string) {
    try {
        let allEntries: any[] = []
        let page = 1
        const pageSize = 100
        let hasMore = true

        const startPath = new Date(startDate)
        startPath.setDate(startPath.getDate() - 1)
        const endPath = new Date(endDate)
        endPath.setDate(endPath.getDate() + 1)

        const startIso = `${startPath.toISOString().split('T')[0]}T00:00:00.000+0000`
        const endIso = `${endPath.toISOString().split('T')[0]}T23:59:59.999+0000`

        while (hasMore) {
            const url = new URL(`${TOAST_API_HOST}/labor/v1/timeEntries`)
            url.searchParams.append('startDate', startIso)
            url.searchParams.append('endDate', endIso)
            url.searchParams.append('page', page.toString())
            url.searchParams.append('pageSize', pageSize.toString())

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

            const res = await fetch(url.toString(), {
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId,
                    'Content-Type': 'application/json'
                }
            })
            clearTimeout(timeoutId)

            if (!res.ok) break

            const data = await res.json()
            const entries = Array.isArray(data) ? data : (data.timeEntries || [])
            allEntries = allEntries.concat(entries)
            if (entries.length < pageSize) hasMore = false
            else page++
        }

        const dailyLabor: Record<string, { hours: number, laborCost: number }> = {}
        const now = new Date()

        allEntries.forEach((entry: any) => {
            const bDate = entry.businessDate // YYYYMMDD
            if (!dailyLabor[bDate]) dailyLabor[bDate] = { hours: 0, laborCost: 0 }

            let regHours = entry.regularHours || entry.paidHours || 0
            let otHours = entry.overtimeHours || 0
            let dtHours = 0

            if (!entry.outDate && entry.inDate) {
                const clockIn = new Date(entry.inDate)
                const totalLive = Math.max(0, (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60))
                if (totalLive > 12) { regHours = 8; otHours = 4; dtHours = totalLive - 12; }
                else if (totalLive > 8) { regHours = 8; otHours = totalLive - 8; dtHours = 0; }
                else { regHours = totalLive; otHours = 0; dtHours = 0; }
            } else {
                if (regHours + otHours > 12) {
                    const total = regHours + otHours
                    regHours = 8; otHours = 4; dtHours = total - 12
                }
            }

            const rate = entry.hourlyWage || 0
            const pay = (regHours * rate) + (otHours * rate * 1.5) + (dtHours * rate * 2.0)

            dailyLabor[bDate].laborCost += pay
            dailyLabor[bDate].hours += (regHours + otHours + dtHours)
        })

        // Round final daily totals only once
        Object.keys(dailyLabor).forEach(date => {
            dailyLabor[date].laborCost = Number(dailyLabor[date].laborCost.toFixed(2))
            dailyLabor[date].hours = Number(dailyLabor[date].hours.toFixed(2))
        })

        return dailyLabor
    } catch (e: any) {
        logDebug(`Labor Fetch Error for ${storeId}`, e.message)
        return {}
    }
}



// --- MAIN DATA FETCH ---
export const fetchToastData = async (options: ToastMetricsOptions): Promise<{ rows: MetricRow[], connectionError?: string }> => {

    let realStores: any[] = []
    let token = ''
    let connectionError = ''

    try {
        console.log("Attempting Toast Auth...")
        token = (await getAuthToken()) || ''
        if (token) {
            realStores = await getRestaurants(token)
            console.log(`Found ${realStores.length} real stores via API`)
        }
    } catch (e: any) {
        logDebug("CRITICAL AUTH ERROR:", e.message + (e.stack ? e.stack : ''))
        console.warn("Failed to connect to Toast API, falling back to Mock List", e)
        connectionError = e.message || String(e)
    }

    // USE REAL STORES IF AVAILABLE, ELSE MOCK
    const storesToUse = realStores.length > 0 ? realStores : TOAST_STORES_MOCK
    const targetIds = String(options.storeIds)
    const storeList = options.storeIds === 'all'
        ? storesToUse
        : storesToUse.filter(s => targetIds.includes(s.id))

    console.log(`🔍 [DEBUG] Auth Token: ${!!token}`)
    console.log(`🔍 [DEBUG] Usando Tiendas: ${realStores.length > 0 ? 'REALES (API)' : 'MOCK (Locales)'}`)
    if (storeList.length > 0) console.log(`🔍 [DEBUG] ID Buscado[0]: ${storeList[0].id} (${storeList[0].name})`)

    // Only force hourly breakdown if specifically requested or if implied by logic, BUT respect groupBy='day'
    const isHourly = (options.startDate === options.endDate) && (options.groupBy !== 'day')
    const rows: MetricRow[] = []

    // 1. CHECK SUPABASE CACHE (Only for past dates)
    // Force Timezone to Los Angeles (Business Day)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    let cachedData: any[] = []

    // CHECK SUPABASE CACHE
    // We now allow cache even for single days (isHourly) to speed up "Yesterday" or specific past dates.
    // The trade-off is we lose real hourly granularity for that specific day from cache, but gain massive speed.
    try {
        if (!options.skipCache) {
            try {
                const supabase = await getSupabaseClient()

                // PAGINATION FIX: PostgREST limit is 1000. We fetch all in batches.
                let allRows: any[] = []
                let page = 0
                const pageSize = 1000
                let hasMore = true

                while (hasMore) {
                    const { data, error } = await supabase
                        .from('sales_daily_cache')
                        .select('*')
                        .in('store_id', storeList.map(s => s.id))
                        .gte('business_date', options.startDate)
                        .lte('business_date', options.endDate)
                        .range(page * pageSize, (page + 1) * pageSize - 1)

                    if (error) throw error
                    if (data) {
                        allRows = allRows.concat(data)
                        if (data.length < pageSize) hasMore = false
                        else page++
                    } else {
                        hasMore = false
                    }
                }
                cachedData = allRows
            } catch (e) {
                // silent fail
            }
        }


        // Optimize: Create a Map for O(1) lookup
        const cacheMap = new Map<string, any>()
        cachedData.forEach(c => {
            // Ensure date is YYYY-MM-DD
            const dateKey = String(c.business_date).split('T')[0]
            // Normalize ID
            const storeKey = String(c.store_id).trim().toLowerCase()
            cacheMap.set(`${storeKey}_${dateKey}`, c)
        })

        try {
            // Prepare range dates
            const neededDates: string[] = []
            const cur = new Date(options.startDate)
            const end = new Date(options.endDate)
            while (cur <= end) {
                neededDates.push(cur.toISOString().split('T')[0])
                cur.setDate(cur.getDate() + 1)
            }

            const batchResults: any[] = []
            const CONCURRENCY_LIMIT = 10
            let storeIndex = 0

            async function processStoreDate(store: any, dateStr: string) {
                const storeKey = String(store.id).trim().toLowerCase()
                const cached = cacheMap.get(`${storeKey}_${dateStr}`)
                // --- DIRTY WINDOW LOGIC ---
                // In restaurants, "Yesterday" is not final until the shift ends (often 2-4 AM Today).
                // If it is before 6 AM in LA, we treat Yesterday as "Today" (Dirty/Dynamic).
                const nowLA = new Date()
                const laHour = parseInt(nowLA.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }))

                const yesterday = new Date(nowLA)
                yesterday.setDate(nowLA.getDate() - 1)
                const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

                const isToday = dateStr === todayStr
                const isYesterdayEarlyHours = dateStr === yesterdayStr && laHour < 6

                const isDirty = isToday || isYesterdayEarlyHours

                // Use cache ONLY for past dates that are outside the dirty window
                if (cached && !isDirty) {
                    return {
                        store,
                        date: dateStr,
                        salesMetrics: {
                            netSales: Number(cached.net_sales),
                            grossSales: Number(cached.gross_sales || 0),
                            discounts: Number(cached.discounts || 0),
                            tips: Number(cached.tips || 0),
                            taxes: Number(cached.taxes || 0),
                            serviceCharges: Number(cached.service_charges || 0),
                            orders: cached.order_count,
                            guests: cached.guest_count,
                            // Fix for cached single days: Use real hourly data if available (new column),
                            // otherwise fallback to average distribution.
                            hourlySales: cached.hourly_data || (() => {
                                if (!isHourly) return {}
                                const total = Number(cached.net_sales)
                                const dist: Record<number, number> = {}
                                const startH = 9; const endH = 23; // 14 hours
                                const perH = total / (endH - startH)
                                for (let h = startH; h < endH; h++) dist[h] = perH
                                return dist
                            })(),
                            hourlyTickets: cached.hourly_tickets || {},
                            uberSales: Number(cached.uber_sales || 0),
                            doordashSales: Number(cached.doordash_sales || 0),
                            grubhubSales: Number(cached.grubhub_sales || 0),
                            ebtCount: Number(cached.ebt_count || 0),
                            ebtAmount: Number(cached.ebt_amount || 0)
                        },
                        laborMetrics: {
                            hours: Number(cached.labor_hours),
                            laborCost: Number(cached.labor_cost)
                        },
                        fromCache: true
                    }
                }

                // Real Fetch
                if (realStores.length > 0 && token) {
                    try {
                        const sales = await getSalesForStore(token, store.id, dateStr, dateStr, options.fastMode)

                        // Fetch Labor specifically for this day (Lazy Load)
                        const bKey = dateStr.split('-').join('')
                        let labor = { hours: 0, laborCost: 0 }
                        try {
                            const laborMap = await getLaborForRange(token, store.id, dateStr, dateStr)
                            if (laborMap[bKey]) labor = laborMap[bKey]
                        } catch (e) { /* ignore labor error */ }

                        return {
                            store,
                            date: dateStr,
                            salesMetrics: {
                                ...sales,
                                // Enforce these exist just in case
                                uberSales: sales.uberSales || 0,
                                doordashSales: sales.doordashSales || 0,
                                grubhubSales: sales.grubhubSales || 0,
                                ebtCount: sales.ebtCount || 0,
                                ebtAmount: sales.ebtAmount || 0,
                                hourlySales: sales.hourlySales || {}
                            },
                            laborMetrics: labor,
                            fromCache: false
                        }
                    } catch (err) {
                        // FALLBACK: Try cache if API fails, even for hourly (better than error)
                        if (cached && !isToday) {
                            return {
                                store, date: dateStr,
                                salesMetrics: {
                                    netSales: Number(cached.net_sales),
                                    grossSales: Number(cached.gross_sales || 0),
                                    discounts: Number(cached.discounts || 0),
                                    tips: Number(cached.tips || 0),
                                    taxes: Number(cached.taxes || 0),
                                    serviceCharges: Number(cached.service_charges || 0),
                                    orders: cached.order_count,
                                    guests: cached.guest_count,
                                    hourlySales: {}, // No hourly data in daily cache
                                    hourlyTickets: {},
                                    uberSales: Number(cached.uber_sales || 0),
                                    doordashSales: Number(cached.doordash_sales || 0),
                                    grubhubSales: Number(cached.grubhub_sales || 0),
                                    ebtCount: Number(cached.ebt_count || 0),
                                    ebtAmount: Number(cached.ebt_amount || 0)
                                },
                                laborMetrics: { hours: Number(cached.labor_hours), laborCost: Number(cached.labor_cost) },
                                fromCache: true
                            }
                        }
                        throw err // Rethrow if no cache available
                    }
                } else {
                    // Mock
                    const salesVal = 2000 + Math.random() * 4000
                    return {
                        store,
                        date: dateStr,
                        salesMetrics: {
                            netSales: salesVal,
                            grossSales: salesVal * 1.1,
                            discounts: salesVal * 0.1,
                            tips: salesVal * 0.18,
                            taxes: salesVal * 0.08,
                            serviceCharges: 0,
                            orders: Math.floor(salesVal / 25),
                            guests: Math.floor(salesVal / 20),
                            hourlySales: {},
                            hourlyTickets: {},
                            uberSales: 0,
                            doordashSales: 0,
                            grubhubSales: 0,
                            ebtCount: 0,
                            ebtAmount: 0
                        },
                        laborMetrics: { hours: (salesVal / 25) * 0.4, laborCost: ((salesVal / 25) * 0.4) * 18.50 },
                        fromCache: false
                    }
                }
            }

            // Run in batches
            const allTasks: { store: any, date: string }[] = []
            neededDates.forEach(d => storeList.forEach(s => allTasks.push({ store: s, date: d })))

            const results: any[] = []
            for (let i = 0; i < allTasks.length; i += CONCURRENCY_LIMIT) {
                const batch = allTasks.slice(i, i + CONCURRENCY_LIMIT)
                const resolved = await Promise.all(batch.map(t => processStoreDate(t.store, t.date)))
                results.push(...resolved)
            }

            // 4. BATCH UPDATE CACHE (Only Past Dates, NEVER Today, and Only if Shift is Closed)
            // Re-calculate logic to be safe
            const nowForCache = new Date()
            const laHourForCache = parseInt(nowForCache.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }))
            const yesterdayForCache = new Date(nowForCache)
            yesterdayForCache.setDate(nowForCache.getDate() - 1)
            const yesterdayStrCache = yesterdayForCache.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

            const toCache = results.filter(r => {
                // 1. Never cache if read from cache
                if (r.fromCache) return false

                // 2. Never cache Fast Mode results (incomplete data fields)
                if (options.fastMode) return false

                // 3. Never cache TODAY (volatile data, wait for next day)
                if (r.date === todayStr) return false

                // 4. Never cache YESTERDAY if we are strictly in the "Dirty Window" (<6am)
                // (Already handled by fetching logic, but ensuring storage safety)
                if (r.date === yesterdayStrCache && laHourForCache < 6) return false

                return true
            })

            if (toCache.length > 0) {
                const supabase = await getSupabaseClient()
                const rowsForCache = toCache.map(r => ({
                    store_id: r.store.id,
                    store_name: r.store.name,
                    business_date: r.date,
                    net_sales: r.salesMetrics.netSales,
                    gross_sales: r.salesMetrics.grossSales,
                    discounts: r.salesMetrics.discounts,
                    tips: r.salesMetrics.tips,
                    taxes: r.salesMetrics.taxes,
                    service_charges: r.salesMetrics.serviceCharges,
                    order_count: r.salesMetrics.orders,
                    guest_count: r.salesMetrics.guests,
                    labor_hours: r.laborMetrics.hours,
                    labor_cost: r.laborMetrics.laborCost,
                    hourly_data: r.salesMetrics.hourlySales,
                    hourly_tickets: r.salesMetrics.hourlyTickets,
                    uber_sales: r.salesMetrics.uberSales || 0,
                    doordash_sales: r.salesMetrics.doordashSales || 0,
                    grubhub_sales: r.salesMetrics.grubhubSales || 0,
                    ebt_count: r.salesMetrics.ebtCount || 0,
                    ebt_amount: r.salesMetrics.ebtAmount || 0
                }))
                // Upsert in chunks of 50 to avoid URL length issues
                for (let i = 0; i < rowsForCache.length; i += 50) {
                    const chunk = rowsForCache.slice(i, i + 50)
                    const { error: upsertError } = await supabase.from('sales_daily_cache').upsert(chunk, { onConflict: 'store_id, business_date' })
                    if (upsertError) {
                        console.error('CRITICAL CACHE UPSERT ERROR:', JSON.stringify(upsertError, null, 2))
                    } else {
                        console.log(`✅ Cached ${chunk.length} days.`)
                    }
                }
            }

            // 5. AGGREGATE RESULTS
            for (const res of results) {
                const { store, date, salesMetrics, laborMetrics } = res
                if (isHourly) {
                    // Ensure full 24h cycle coverage
                    for (let i = 0; i < 24; i++) {
                        const h = (7 + i) % 24
                        const isNextDay = (7 + i) >= 24
                        let displayDate = date
                        if (isNextDay) {
                            const d2 = new Date(date)
                            d2.setUTCDate(d2.getUTCDate() + 1)
                            displayDate = d2.toISOString().split('T')[0]
                        }
                        const pStart = `${displayDate} ${String(h).padStart(2, '0')}:00`
                        const hourlySales = (salesMetrics as any).hourlySales?.[h] || 0
                        rows.push({
                            storeId: store.id,
                            storeName: store.name,
                            periodStart: pStart,
                            periodEnd: pStart,
                            netSales: hourlySales,
                            grossSales: i === 0 ? (salesMetrics.grossSales || 0) : 0,
                            discounts: i === 0 ? (salesMetrics.discounts || 0) : 0,
                            tips: i === 0 ? (salesMetrics.tips || 0) : 0,
                            taxes: i === 0 ? (salesMetrics.taxes || 0) : 0,
                            serviceCharges: i === 0 ? (salesMetrics.serviceCharges || 0) : 0,
                            orderCount: i === 0 ? salesMetrics.orders : 0,
                            guestCount: i === 0 ? salesMetrics.guests : 0,
                            totalHours: i === 0 ? (laborMetrics.hours || 0) : 0,
                            laborCost: i === 0 ? (laborMetrics.laborCost || 0) : 0,
                            laborPercentage: 0,
                            splh: 0,
                            uberSales: i === 0 ? (salesMetrics.uberSales || 0) : 0,
                            doordashSales: i === 0 ? (salesMetrics.doordashSales || 0) : 0,
                            grubhubSales: i === 0 ? (salesMetrics.grubhubSales || 0) : 0,
                            ebtCount: i === 0 ? (salesMetrics.ebtCount || 0) : 0,
                            ebtAmount: i === 0 ? (salesMetrics.ebtAmount || 0) : 0,
                            hourlySales: i === 0 ? (salesMetrics.hourlySales || {}) : {}
                        })
                    }
                } else {
                    const dayDate = new Date(date)
                    let pStart = date
                    let pEnd = date
                    if (options.groupBy === 'week') {
                        const wi = getISOWeekInfo(dayDate); pStart = wi.monday; pEnd = wi.sunday;
                    } else if (options.groupBy === 'month') {
                        const ms = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}`
                        pStart = `${ms}-01`; pEnd = `${ms}-30`;
                    }

                    let existing = rows.find(r => r.storeId === store.id && r.periodStart === pStart)
                    if (!existing) {
                        existing = {
                            storeId: store.id,
                            storeName: store.name,
                            periodStart: pStart,
                            periodEnd: pEnd,
                            netSales: 0,
                            grossSales: 0,
                            discounts: 0,
                            tips: 0,
                            taxes: 0,
                            serviceCharges: 0,
                            orderCount: 0,
                            guestCount: 0,
                            totalHours: 0,
                            laborCost: 0,
                            laborPercentage: 0,
                            splh: 0,
                            uberSales: 0,
                            doordashSales: 0,
                            grubhubSales: 0,
                            ebtCount: 0,
                            ebtAmount: 0,
                            hourlySales: {}
                        }
                        rows.push(existing)
                    }

                    existing.netSales += salesMetrics.netSales
                    existing.grossSales += (salesMetrics.grossSales || 0)
                    existing.discounts += (salesMetrics.discounts || 0)
                    existing.tips += (salesMetrics.tips || 0)
                    existing.taxes += (salesMetrics.taxes || 0)
                    existing.serviceCharges += (salesMetrics.serviceCharges || 0)
                    existing.orderCount += salesMetrics.orders
                    existing.guestCount += salesMetrics.guests
                    existing.totalHours += (laborMetrics.hours || 0)
                    existing.laborCost += (laborMetrics.laborCost || 0)
                    existing.uberSales = (existing.uberSales || 0) + (salesMetrics.uberSales || 0)
                    existing.doordashSales = (existing.doordashSales || 0) + (salesMetrics.doordashSales || 0)
                    existing.grubhubSales = (existing.grubhubSales || 0) + (salesMetrics.grubhubSales || 0)
                    existing.ebtCount = (existing.ebtCount || 0) + (salesMetrics.ebtCount || 0)
                    existing.ebtAmount = (existing.ebtAmount || 0) + (salesMetrics.ebtAmount || 0)
                    // Merge Hourly Sales
                    const hSales = salesMetrics.hourlySales || {}
                    existing.hourlySales = existing.hourlySales || {}
                    for (let h = 0; h < 24; h++) {
                        existing.hourlySales[h] = (existing.hourlySales[h] || 0) + (hSales[h] || 0)
                    }

                }
            }

            // Final Calculations
            rows.forEach(r => {
                r.laborPercentage = r.netSales > 0 ? (r.laborCost / r.netSales) * 100 : 0
                r.splh = r.totalHours > 0 ? r.netSales / r.totalHours : 0

                // Format to 2 decimal places for financial accuracy
                r.netSales = Number(r.netSales.toFixed(2))
                r.grossSales = Number((r.grossSales || 0).toFixed(2))
                r.discounts = Number((r.discounts || 0).toFixed(2))
                r.tips = Number((r.tips || 0).toFixed(2))
                r.taxes = Number((r.taxes || 0).toFixed(2))
                r.serviceCharges = Number((r.serviceCharges || 0).toFixed(2))

                r.laborCost = Number(r.laborCost.toFixed(2))
                r.totalHours = Number(r.totalHours.toFixed(2))
                r.laborPercentage = Number(r.laborPercentage.toFixed(1))
                r.splh = Number(r.splh.toFixed(2))
            })
            return { rows, connectionError: connectionError || undefined }
        } catch (err: any) {
            logDebug("CRASH PROCESSING DATA:", err.message + (err.stack ? err.stack : ''))
            throw err
        }
    } catch (outerErr: any) {
        logDebug("OUTER CATCH ERROR:", outerErr.message)
        return { rows: [], connectionError: outerErr.message || 'Unknown error' }
    }
}

// --- HELPERS ---
export const getISOWeekInfo = (date: Date) => {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 4 - (d.getDay() || 7))
    const yearStart = new Date(d.getFullYear(), 0, 1)
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)

    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(date)
    monday.setDate(diff)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    return {
        year: d.getFullYear(),
        week: weekNo,
        monday: monday.toISOString().split('T')[0],
        sunday: sunday.toISOString().split('T')[0]
    }
}

// MOCK STORE LIST (Fallback)
export const TOAST_STORES_MOCK = [
    { id: '1', name: "Lynwood (Mock)" },
    { id: '2', name: "South Gate (Mock)" },
    { id: '3', name: "LA Central (Mock)" },
    { id: '4', name: "Huntington Park (Mock)" },
    { id: '5', name: "Hollywood (Mock)" },
    { id: '6', name: "Downey (Mock)" },
    { id: '7', name: "Norwalk (Mock)" },
    { id: '8', name: "Rialto (Mock)" },
    { id: '9', name: "LA Broadway (Mock)" },
    { id: '10', name: "West Covina (Mock)" },
    { id: '11', name: "Slauson (Mock)" },
    { id: '12', name: "Santa Ana (Mock)" },
    { id: '13', name: "La Puente (Mock)" },
    { id: '14', name: "Azusa (Mock)" },
    { id: '15', name: "Bell (Mock)" },
]

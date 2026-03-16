import { NextRequest, NextResponse } from 'next/server'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const targetGuid = searchParams.get('guid')
        const targetName = searchParams.get('name') || ''
        const targetGroupName = searchParams.get('group_name') || ''

        if (!storeId || !startDate || !endDate || !targetGuid) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        const token = await getAuthToken()
        if (!token) throw new Error("Auth Token Failed")

        // First gets Dining Options Map
        let diningOptionMap: Record<string, string> = {}
        try {
            const urlOpt = new URL(`${TOAST_API_HOST}/config/v2/diningOptions`)
            const resOpt = await fetch(urlOpt.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })
            if (resOpt.ok) {
                const dataOpt = await resOpt.json()
                if (Array.isArray(dataOpt)) {
                    dataOpt.forEach((opt: any) => {
                        if (opt.guid && opt.name) diningOptionMap[opt.guid] = opt.name
                    })
                }
            }
        } catch (e) {
            console.error("Failed to parse dining options")
        }

        const tickets: any[] = []

        let datesToFetch: string[] = []
        const curDateObj = new Date(startDate)
        const lastDateObj = new Date(endDate)

        while (curDateObj <= lastDateObj) {
            datesToFetch.push(curDateObj.toISOString().split('T')[0])
            curDateObj.setDate(curDateObj.getDate() + 1)
        }

        // Loop over the dates
        for (const dateStr of datesToFetch) {
            let page = 1
            const pageSize = 100
            let hasMore = true
            const formattedDate = dateStr.split('-').join('')

            while (hasMore) {
                const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
                url.searchParams.append('businessDate', formattedDate)
                url.searchParams.append('pageSize', String(pageSize))
                url.searchParams.append('page', String(page))
                // Request enough fields to reconstruct the full name including modifiers
                url.searchParams.append('fields', 'id,openedDate,checks.selections.price,checks.selections.item,checks.selections.quantity,checks.selections.voided,checks.selections.displayName,checks.selections.modifiers,diningOption')

                const res = await fetch(url.toString(), {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Toast-Restaurant-External-ID': storeId
                    }
                })

                if (!res.ok) {
                    if (res.status === 429) {
                        await new Promise(r => setTimeout(r, 1000))
                        continue
                    }
                    console.warn(`Failed fetching orders for ${dateStr}: ${res.status}`)
                    break
                }

                const entries = await res.json()
                if (!Array.isArray(entries) || entries.length === 0) {
                    hasMore = false
                    continue
                }

                entries.forEach((order: any) => {
                    if (order.voided) return

                    order.checks?.forEach((check: any) => {
                        if (check.voided) return
                        check.selections?.forEach((sel: any) => {
                            if (sel.voided) return
                            if (sel.item?.guid === targetGuid) {
                                // Reconstruct full name with significant modifiers to match Toast PMIX grouping
                                let reconstructedName = sel.displayName || ''
                                if (sel.modifiers && Array.isArray(sel.modifiers) && sel.modifiers.length > 0) {
                                    const sigMods = sel.modifiers
                                        .filter((m: any) => !m.voided)
                                        .map((m: any) => m.displayName)
                                        .filter((n: string) => n && !n.startsWith('NO ') && !n.startsWith('No ') && !n.startsWith('Sin '))
                                        .join(', ')
                                    
                                    if (sigMods) {
                                        reconstructedName = `${reconstructedName} (${sigMods})`
                                    }
                                }

                                // Skip if the reconstructed name doesn't match the exact product variation the user clicked on
                                if (targetName && reconstructedName !== targetName) {
                                    return
                                }

                                // Group validation
                                let curGroupName = 'Uncategorized'
                                const doGuid = order.diningOption?.guid || sel.diningOption?.guid
                                if (doGuid && diningOptionMap[doGuid]) {
                                    curGroupName = diningOptionMap[doGuid]
                                } else if (order.diningOption?.name) {
                                    curGroupName = order.diningOption.name
                                }

                                if (!targetGroupName || targetGroupName === 'All Channels' || curGroupName?.toLowerCase().includes(targetGroupName.toLowerCase()) || targetGroupName.toLowerCase().includes(curGroupName?.toLowerCase())) {
                                    
                                    // Parse LA time
                                    let timeStr = order.openedDate
                                    if (order.openedDate) {
                                        try {
                                            timeStr = new Date(order.openedDate).toLocaleString('en-US', {
                                                timeZone: 'America/Los_Angeles',
                                                month: 'short',
                                                day: '2-digit',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                hour12: true
                                            })
                                        } catch (e) { }
                                    }

                                    tickets.push({
                                        date: timeStr,
                                        orderNumber: order.id,
                                        quantity: sel.quantity || 1,
                                    })
                                }
                            }
                        })
                    })
                })

                if (entries.length < pageSize) hasMore = false
                else page++

                // Hard cap at 500 records to prevent browser crash, we just want to prove it exists
                if (tickets.length >= 250) {
                    hasMore = false
                    break
                }
            }
            if (tickets.length >= 250) break
        }

        // Return up to 250 tickets so we don't crash
        return NextResponse.json({
            tickets: tickets.slice(0, 250)
        })

    } catch (e: any) {
        console.error('Item Tickets API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

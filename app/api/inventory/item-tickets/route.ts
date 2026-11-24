/**
 * @module app/api/inventory/item-tickets
 * @description Consulta los tickets individuales de Toast POS (`ordersBulk`) donde se vendió un platillo específico (`guid`), filtrando por variante de modificadores/descuento de empleado y canal (`diningOption`).
 *
 * @businessRules
 * - Traduce dinámicamente los GUIDs de `diningOptions` por tienda (`config/v2/diningOptions`).
 * - Acota estrictamente la ventana de consulta a `endDate - startDate <= 35` días (`400 Bad Request` si se excede) y un tope de 250 tickets para prevenir denegación de servicio (DoS) contra Toast `ordersBulk`.
 * - Solicita explícitamente `voided`, `checks.voided`, `appliedDiscounts`, `checks.appliedDiscounts` y `checks.selections.appliedDiscounts` en `fields` para excluir anulaciones y etiquetar comidas de empleado con bordes de palabra (`\bemployee\b|\bemp\b` sin falsos positivos en `"Empanada"`).
 *
 * @dataFlow
 * - Modal Detalle Food Cost / PMIX -> `GET /api/inventory/item-tickets` -> Toast API `diningOptions` + `ordersBulk` -> lista de tickets JSON.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` y validación estricta de fechas ISO `YYYY-MM-DD`.
 * - [2026-11-23] FIX: Añadidos `voided`, `checks.voided` y `appliedDiscounts` en `fields` de Toast y corregida regex de empleado para no coincidir con `"Empanada"`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthToken } from '@/lib/toast-api'
import { verifyStaffAuth } from '@/lib/auth-server'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const MAX_DATE_RANGE_DAYS = 35
const EMP_DISCOUNT_NAME_RE = /\b(?:employee|emp|emplead[oa]?s?)\b|discount|descuento|100%|50%/i
const EMP_TARGET_VARIANT_RE = /\b(?:employee|emp|emplead[oa]?s?)\b/i

export async function GET(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request)
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

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

        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 })
        }

        const startMs = Date.parse(`${startDate}T00:00:00Z`)
        const endMs = Date.parse(`${endDate}T00:00:00Z`)
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
            return NextResponse.json({ error: 'Invalid date range: endDate must be >= startDate' }, { status: 400 })
        }

        const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24))
        if (diffDays > MAX_DATE_RANGE_DAYS) {
            return NextResponse.json(
                { error: `Date range exceeds maximum allowed window of ${MAX_DATE_RANGE_DAYS} days` },
                { status: 400 }
            )
        }

        const token = await getAuthToken()
        if (!token) throw new Error('Auth Token Failed')

        // First get Dining Options Map dynamically per Toast Protocol
        const diningOptionMap: Record<string, string> = {}
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
        } catch {
            console.error('Failed to parse dining options')
        }

        const tickets: any[] = []

        const datesToFetch: string[] = []
        const curDateObj = new Date(`${startDate}T12:00:00Z`)
        const lastDateObj = new Date(`${endDate}T12:00:00Z`)

        while (curDateObj <= lastDateObj) {
            datesToFetch.push(curDateObj.toISOString().split('T')[0])
            curDateObj.setUTCDate(curDateObj.getUTCDate() + 1)
        }

        // Fetch all dates concurrently in parallel for maximum speed
        await Promise.all(datesToFetch.map(async (dateStr) => {
            let page = 1
            const pageSize = 100
            let hasMore = true
            const formattedDate = dateStr.split('-').join('')
            let rateLimitRetries = 0

            while (hasMore && tickets.length < 250) {
                const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
                url.searchParams.append('businessDate', formattedDate)
                url.searchParams.append('pageSize', String(pageSize))
                url.searchParams.append('page', String(page))
                // Include voided, checks.voided, and appliedDiscounts so void filtering and employee meal tagging are accurate
                url.searchParams.append(
                    'fields',
                    'guid,voided,openedDate,appliedDiscounts,diningOption,checks.guid,checks.voided,checks.displayNumber,checks.appliedDiscounts,checks.selections.price,checks.selections.item,checks.selections.quantity,checks.selections.voided,checks.selections.displayName,checks.selections.modifiers,checks.selections.appliedDiscounts'
                )

                const res = await fetch(url.toString(), {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Toast-Restaurant-External-ID': storeId
                    }
                })

                if (!res.ok) {
                    if (res.status === 429 && rateLimitRetries < 4) {
                        rateLimitRetries++
                        await new Promise(r => setTimeout(r, 1000 * rateLimitRetries))
                        continue
                    }
                    console.warn(`Failed fetching orders for ${dateStr}: ${res.status}`)
                    break
                }
                rateLimitRetries = 0

                const entries = await res.json()
                if (!Array.isArray(entries) || entries.length === 0) {
                    hasMore = false
                    continue
                }

                entries.forEach((order: any) => {
                    const orderGuid = order.guid || order.id
                    if (order.voided || !orderGuid) return

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

                                // Tag employee/discount variations if present on order, check, or selection
                                const allDiscs = [
                                    ...(order.appliedDiscounts || []),
                                    ...(check.appliedDiscounts || []),
                                    ...(sel.appliedDiscounts || [])
                                ].filter((d: any) => !d?.voided && !d?.deleted && d?.state !== 'VOIDED' && d?.state !== 'REMOVED')

                                const hasEmpDisc = allDiscs.some((d: any) =>
                                    EMP_DISCOUNT_NAME_RE.test(d.name || d.discountName || '')
                                )

                                if (hasEmpDisc && !EMP_TARGET_VARIANT_RE.test(reconstructedName)) {
                                    if (reconstructedName.includes('(')) {
                                        reconstructedName = reconstructedName.replace(/\)$/, ', Empleada)')
                                    } else {
                                        reconstructedName += ' (Empleada)'
                                    }
                                }

                                // Target name variation filter (word-boundary regex so "Empanada" never matches 'emp'!)
                                if (targetName) {
                                    const normTarget = targetName.trim().toLowerCase()
                                    const normRecon = reconstructedName.trim().toLowerCase()
                                    const isEmpTarget = EMP_TARGET_VARIANT_RE.test(normTarget)

                                    if (isEmpTarget && !hasEmpDisc && !EMP_TARGET_VARIANT_RE.test(normRecon)) {
                                        return
                                    }

                                    if (!isEmpTarget && normTarget.includes('(') && normRecon !== normTarget) {
                                        return
                                    }
                                }

                                // Group validation
                                let curGroupName = 'Uncategorized'
                                const doGuid = order.diningOption?.guid || sel.diningOption?.guid
                                if (doGuid && diningOptionMap[doGuid]) {
                                    curGroupName = diningOptionMap[doGuid]
                                } else if (order.diningOption?.name) {
                                    curGroupName = order.diningOption.name
                                }

                                if (
                                    !targetGroupName ||
                                    targetGroupName === 'All Channels' ||
                                    curGroupName === 'Uncategorized' ||
                                    curGroupName?.toLowerCase().includes(targetGroupName.toLowerCase()) ||
                                    targetGroupName.toLowerCase().includes(curGroupName?.toLowerCase())
                                ) {
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
                                        } catch {}
                                    }

                                    const rawTicketId = check?.displayNumber || check?.guid?.slice(0, 8) || orderGuid.slice(0, 8)

                                    tickets.push({
                                        date: timeStr,
                                        orderId: orderGuid,
                                        checkId: String(rawTicketId),
                                        orderNumber: `#${rawTicketId}`,
                                        quantity: sel.quantity || 1,
                                        diningOption: curGroupName
                                    })
                                }
                            }
                        })
                    })
                })

                if (entries.length < pageSize) hasMore = false
                else page++
            }
        }))

        const targetQuantityParam = searchParams.get('quantity')
        const targetQuantity = targetQuantityParam ? parseInt(targetQuantityParam, 10) : null

        if (targetQuantity && targetQuantity > 0 && tickets.length > 0) {
            tickets.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            let currentSum = 0
            const matchedTickets: any[] = []
            for (const t of tickets) {
                if (currentSum >= targetQuantity) break
                matchedTickets.push(t)
                currentSum += (t.quantity || 1)
            }
            return NextResponse.json({
                tickets: matchedTickets
            })
        }

        return NextResponse.json({
            tickets: tickets.slice(0, 250)
        })

    } catch (e: any) {
        console.error('Item Tickets API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

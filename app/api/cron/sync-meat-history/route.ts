import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel maximum

function get30MinBucket(isoDateStr: string): string {
    const dateObj = new Date(isoDateStr)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false
    });
    let timeParts = formatter.format(dateObj).split(':')
    let h = parseInt(timeParts[0], 10)
    let m = parseInt(timeParts[1], 10)
    if (h === 24) h = 0;
    m = m >= 30 ? 30 : 0
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
}

export async function GET(request: NextRequest) {
    // 1. Verificar Authorization si es Production
    if (process.env.NODE_ENV === 'production') {
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    try {
        const token = await getAuthToken()
        if (!token) throw new Error("No Toast Token")

        const supabase = await getSupabaseAdminClient()

        // Sync D-1
        const d = new Date()
        d.setHours(d.getHours() - 12) // Desplazar al día de negocio anterior de LA si se corre muy temprano
        d.setDate(d.getDate() - 1)
        
        // Ajuste con timezone LA
        const laTime = d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
        const [mm, dd, yyyy] = laTime.split('/')
        const dateStr = `${yyyy}-${mm}-${dd}`
        const businessDate = `${yyyy}${mm}${dd}`

        // Datos Supabase
        const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true)
        const { data: inventoryData } = await supabase.from('inventory_items').select('*')
        const { data: recipesData } = await supabase.from('recipes').select('*')
        
        if (!inventoryData || !recipesData || !stores) throw new Error("Missing db dependencies")

        const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA']
        const recipeLookup = new Map<string, any>()
        const itemLookup = new Map<string, any>()
        
        inventoryData.forEach(i => {
           const name = i.name.toUpperCase()
           if (targetProteins.some(p => name.includes(p)) && !name.includes('SALSA')) {
               itemLookup.set(i.id, i)
           }
        })
        
        recipesData.forEach(r => {
            if (itemLookup.has(r.inventory_item_id)) {
                const iData = itemLookup.get(r.inventory_item_id)
                let meatType = 'OTRO'
                targetProteins.forEach(tp => { if (iData.name.toUpperCase().includes(tp)) meatType = tp })
                recipeLookup.set(r.toast_menu_item_guid, { ...r, yield_percent: iData.yield_percent || 100, meat_type: meatType })
            }
        })

        let totalUpserted = 0

        for (const store of stores) {
            if (!store.external_id) continue
            
            const buckets = new Map<string, number>()
            let page = 1
            let hasMore = true
            
            // Reparación/Sobreescritura: Opcional, borrar previos de ese business date antes de mergear
             await supabase.from('meat_consumption_history').delete()
                 .eq('store_id', store.id)
                 .eq('business_date', dateStr)
            
            while (hasMore) {
                const res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id }
                })
                
                if (!res.ok) { hasMore = false; continue; }
                const entries = await res.json() as any[]
                if (!Array.isArray(entries) || entries.length === 0) { hasMore = false; continue; }
                
                entries.forEach((order) => {
                    if (order.voided || !order.openedDate) return
                    const bucketTime = get30MinBucket(order.openedDate)
                    if (order.checks) {
                        order.checks.forEach((check: any) => {
                            if (check.voided || !check.selections) return
                            const processSel = (sel: any) => {
                                if (sel.voided) return
                                const guid = sel.item?.guid
                                if (guid && recipeLookup.has(guid)) {
                                    const rData = recipeLookup.get(guid)
                                    const soldQty = Number(sel.quantity || 1)
                                    const portionQty = Number(rData.quantity || 0)
                                    const yieldPct = Number(rData.yield_percent || 100) / 100
                                    let lbs = 0, total = soldQty * portionQty
                                    if (rData.unit === 'oz') lbs = total / 16
                                    else if (rData.unit === 'lb') lbs = total
                                    else if (rData.unit === 'g') lbs = total * 0.00220462
                                    else if (rData.unit === 'kg') lbs = total * 2.20462
                                    
                                    const rawLbs = lbs / yieldPct
                                    if (rawLbs > 0) {
                                        const bKey = `${bucketTime}_${rData.meat_type}`
                                        buckets.set(bKey, (buckets.get(bKey) || 0) + rawLbs)
                                    }
                                }
                                if (sel.modifiers) sel.modifiers.forEach((m: any) => processSel(m))
                            }
                            check.selections.forEach((sel: any) => processSel(sel))
                        })
                    }
                })
                if (entries.length < 100) hasMore = false
                else page++
            }
            
            const inserts = Array.from(buckets.entries()).map(([key, raw_lbs]) => {
                const [interval, meat] = key.split('_')
                return {
                    store_id: store.id,
                    business_date: dateStr,
                    interval_start: interval,
                    meat_type: meat,
                    raw_lbs: raw_lbs
                }
            })
            
            if (inserts.length > 0) {
                const { error } = await supabase.from('meat_consumption_history').insert(inserts)
                if (error) console.error(error)
                else totalUpserted += inserts.length
            }
        }

        return NextResponse.json({ success: true, date: dateStr, inserted: totalUpserted })
        
    } catch (err: any) {
        console.error(err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max on Vercel Pro

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const CLIENT_ID = process.env.TOAST_CLIENT_ID
const CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

async function getToastToken() {
    try {
        const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
                userAccessType: 'TOAST_MACHINE_CLIENT'
            })
        })
        const data = await res.json() as any
        return data.token.accessToken
    } catch (e) {
        console.error("Error Obteniendo Token:", e)
        return null
    }
}

function get30MinBucket(isoDateStr: string): string {
    const dateObj = new Date(isoDateStr)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    
    let timeParts = formatter.format(dateObj).split(':')
    let h = parseInt(timeParts[0], 10)
    let m = parseInt(timeParts[1], 10)
    
    if (h === 24) h = 0;
    m = m >= 30 ? 30 : 0
    
    const hStr = h.toString().padStart(2, '0')
    const mStr = m.toString().padStart(2, '0')
    return `${hStr}:${mStr}:00`
}

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            if (process.env.CRON_SECRET) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        console.log("🚀 [CRON] Iniciando Sync Meat History...")
        let token = await getToastToken()
        let tokenTime = Date.now()
        if (!token) throw new Error("No Toast Token")

        const { data: inventoryData } = await supabase.from('inventory_items').select('*')
        const { data: recipesData } = await supabase.from('recipes').select('*')
        const { data: stores } = await supabase.from('stores').select('id, name, external_id').eq('is_active', true)

        if (!inventoryData || !recipesData || !stores) throw new Error("Error obteniendo datos base de Supabase")

        const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA', 'CAFE', 'CHAMPURRADO', 'AGUACATE', 'GUACAMOLE', 'FRIJOL MOLIDO', 'ARROZ']
        const meatItems = inventoryData.filter(i => {
            const name = i.name.toUpperCase()
            return targetProteins.some(p => name.includes(p)) && !name.includes('SALSA')
        })
        
        const recipeLookup = new Map<string, any>()
        const itemLookup = new Map<string, any>()
        
        meatItems.forEach(i => itemLookup.set(i.id, i))
        
        recipesData.forEach(r => {
            if (itemLookup.has(r.inventory_item_id)) {
                const iData = itemLookup.get(r.inventory_item_id)
                let meatType = 'OTRO'
                targetProteins.forEach(tp => {
                    if (iData.name.toUpperCase().includes(tp)) meatType = tp
                })
                recipeLookup.set(r.toast_menu_item_guid, { ...r, yield_percent: iData.yield_percent || 100, meat_type: meatType })
            }
        })

        // Calcular día anterior (ayer)
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
        laNow.setDate(laNow.getDate() - 1) // yesterday
        
        const y = laNow.getFullYear()
        const m = String(laNow.getMonth() + 1).padStart(2, '0')
        const day = String(laNow.getDate()).padStart(2, '0')
        const dateStr = `${y}-${m}-${day}`
        const businessDate = dateStr.replace(/-/g, '')
        
        console.log(`📅 [CRON] Procesando fecha: ${dateStr}`)

        const results: any[] = []

        const limit = 3; 
        let activePromises = 0;
        const processStore = async (store: any) => {
            if (!store.external_id) return
            
            await supabase.from('meat_consumption_history')
                .delete()
                .eq('business_date', dateStr)
                .eq('store_id', store.id);

            const buckets = new Map<string, number>()
            
            let page = 1
            let hasMore = true
            let maxRetries = 5
            
            while (hasMore) {
                if (Date.now() - tokenTime > 1000 * 60 * 45) {
                    token = await getToastToken()
                    tokenTime = Date.now()
                }

                let res;
                try {
                    res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id }
                    })
                } catch (err: any) {
                    console.error(`Error Red en ${store.name}: ${err.message}`);
                    break;
                }
                
                if (res.status === 401) {
                    token = await getToastToken()
                    tokenTime = Date.now()
                    continue; 
                }

                if (res.status === 429) {
                    if (maxRetries > 0) {
                        maxRetries--;
                        const waitTime = (6 - maxRetries) * 3000 + Math.random() * 2000;
                        await new Promise(r => setTimeout(r, waitTime));
                        continue;
                    } else {
                        break;
                    }
                }
                
                if (!res.ok) break
                
                maxRetries = 3
                    
                const entries = await res.json() as any[]
                if (!Array.isArray(entries) || entries.length === 0) {
                    hasMore = false
                    continue
                }
                
                entries.forEach((order) => {
                    if (order.voided || !order.openedDate) return
                    
                    const openedIso = order.openedDate
                    const bucketTime = get30MinBucket(openedIso)
                    
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
                                    const unit = rData.unit
                                    const yieldPct = Number(rData.yield_percent || 100) / 100
                                    
                                    let lbs = 0
                                    let total = soldQty * portionQty
                                    if (unit === 'oz') lbs = total / 16
                                    else if (unit === 'lb') lbs = total
                                    else if (unit === 'g') lbs = total * 0.00220462
                                    else if (unit === 'kg') lbs = total * 2.20462
                                    else if (rData.meat_type === 'CAFE' || rData.meat_type === 'CHAMPURRADO') lbs = total
                                    
                                    const rawLbs = lbs / yieldPct
                                    
                                    if (rawLbs > 0) {
                                        const bKey = `${bucketTime}_${rData.meat_type}`
                                        buckets.set(bKey, (buckets.get(bKey) || 0) + rawLbs)
                                    }
                                }
                                
                                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                                    sel.modifiers.forEach((m: any) => processSel(m))
                                }
                            }
                            
                            check.selections.forEach((sel: any) => processSel(sel))
                        })
                    }
                })
                
                if (entries.length < 100) hasMore = false
                else page++
            }
            
            const inserts = []
            for (const [key, raw_lbs] of buckets.entries()) {
                const [interval_start, meat_type] = key.split('_')
                inserts.push({
                    store_id: store.id,
                    business_date: dateStr,
                    interval_start: interval_start,
                    meat_type: meat_type,
                    raw_lbs: raw_lbs
                })
            }
            
            if (inserts.length > 0) {
                const { error } = await supabase.from('meat_consumption_history').insert(inserts)
                if (error) console.error("Error inserting:", error.message)
                else results.push({ store: store.name, rows: inserts.length })
            }
        }

        const promises = []
        for (const store of stores) {
            if (!store.external_id) continue;
            
            while(activePromises >= limit) {
                await new Promise(r => setTimeout(r, 500))
            }
            
            activePromises++
            const p = processStore(store).finally(() => {
                activePromises--
            })
            promises.push(p)
        }
        
        await Promise.all(promises)

        console.log("✅ [CRON] Terminado.")
        return NextResponse.json({ success: true, processed_date: dateStr, details: results })

    } catch (error: any) {
        console.error(`💥 [CRON] Error crítico total:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

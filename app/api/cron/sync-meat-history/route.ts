/**
 * @module sync-meat-history
 * @description Cron job que sincroniza el consumo histórico de carnes y preparaciones desde Toast API en bloques de 30 minutos.
 * @businessRules
 *   - Día laboral Gavilán: 6:00 AM a 5:59 AM del siguiente día (America/Los_Angeles).
 *   - Proteínas rastreadas: ASADA, PASTOR, POLLO, CARNITAS, CABEZA, LENGUA, BUCHE, CHORIZO, CAFE, CHAMPURRADO, AGUACATE, GUACAMOLE, FRIJOL MOLIDO, ARROZ.
 *   - Yield formula: rawLbs = (soldQty * portionQty in lbs) / yieldPct.
 * @dataFlow Toast API /ordersBulk -> recipe lookup & yield -> meat_consumption_history table.
 * @notes Se ejecutan lotes por minuto LA para balancear consumo de API Toast sin timeouts.
 */
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

        // @businessRule: Proteínas e insumos rastreados en historial de consumo.
        // ASADA, PASTOR, POLLO, CABEZA, LENGUA requieren pace en parrilla.
        // BUCHE, CHORIZO, CARNITAS se cocinan al momento pero se registran en historial.
        // CAFE, CHAMPURRADO, AGUACATE, GUACAMOLE, FRIJOL MOLIDO, ARROZ son preparaciones de cocina trasera.
        const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA', 'BUCHE', 'CHORIZO', 'CAFE', 'CHAMPURRADO', 'AGUACATE', 'GUACAMOLE', 'FRIJOL MOLIDO', 'ARROZ']
        const meatItems = inventoryData.filter(i => {
            const name = i.name.toUpperCase()
            return targetProteins.some(p => name.includes(p)) && !name.includes('SALSA')
        })
        
        const recipeLookup = new Map<string, any[]>()
        const itemLookup = new Map<string, any>()
        
        meatItems.forEach(i => itemLookup.set(i.id, i))
        
        recipesData.forEach(r => {
            if (itemLookup.has(r.inventory_item_id)) {
                const iData = itemLookup.get(r.inventory_item_id)
                let meatType = 'OTRO'
                targetProteins.forEach(tp => {
                    if (iData.name.toUpperCase().includes(tp)) meatType = tp
                })
                const list = recipeLookup.get(r.toast_menu_item_guid) || []
                list.push({ ...r, yield_percent: iData.yield_percent || 100, meat_type: meatType })
                recipeLookup.set(r.toast_menu_item_guid, list)
            }
        })

        // Sort stores consistently to ensure stable batching
        const sortedStores = stores.sort((a, b) => a.id - b.id)

        // Parse query parameter ?batch=0/1/2 or determine dynamically by current LA minute
        const searchParams = new URL(request.url).searchParams
        const batchParam = searchParams.get('batch')
        let batch = batchParam !== null ? parseInt(batchParam, 10) : null
        
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
        
        if (batch === null || isNaN(batch)) {
            const min = laNow.getMinutes()
            batch = Math.floor((min % 30) / 10) // 0-9m -> 0, 10-19m -> 1, 20-29m -> 2
        }

        // Calculate store batch slices dynamically
        const batchSize = Math.ceil(sortedStores.length / 3)
        const startIdx = batch * batchSize
        const endIdx = Math.min(startIdx + batchSize, sortedStores.length)
        const storesToProcess = sortedStores.slice(startIdx, endIdx)

        console.log(`📦 [CRON] Procesando Batch ${batch} (tiendas ${startIdx + 1} a ${endIdx} de ${sortedStores.length})`)

        // Regla Gavilán: El día cierra a las 6:00 AM (LA Time)
        const businessDay = new Date(laNow)
        if (laNow.getHours() < 6) { businessDay.setDate(businessDay.getDate() - 1) }
        
        const laYesterday = new Date(businessDay)
        laYesterday.setDate(laYesterday.getDate() - 1)
        
        const formatLA = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const dateStrYest = formatLA(laYesterday)
        const dateStrToday = formatLA(businessDay)
        
        // Optimización: Solo sincronizamos ayer durante la hora posterior al cierre del día laboral (6:00 AM a 6:59 AM)
        const laHour = laNow.getHours()
        const targetDates = (laHour === 6) ? [dateStrYest, dateStrToday] : [dateStrToday]
        console.log(`📅 [CRON] Procesando intraday... Fechas: ${targetDates.join(', ')} (Hora LA: ${laHour})`)

        const results: any[] = []

        const limit = 3; 
        let activePromises = 0;
        const queue: (() => void)[] = [];

        const acquire = () => new Promise<void>((resolve) => {
            if (activePromises < limit) {
                activePromises++;
                resolve();
            } else {
                queue.push(resolve);
            }
        });

        const release = () => {
            activePromises--;
            if (queue.length > 0) {
                const next = queue.shift();
                if (next) {
                    activePromises++;
                    next();
                }
            }
        };
        const processStore = async (store: any) => {
            if (!store.external_id) return
            
            for (const targetDateStr of targetDates) {
                const businessDate = targetDateStr.replace(/-/g, '')
                
                await supabase.from('meat_consumption_history')
                    .delete()
                    .eq('business_date', targetDateStr)
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
                            
                            const processSel = (sel: any, parentQty: number = 1) => {
                                if (sel.voided) return
                                const currentQty = Number(sel.quantity || 1)
                                const effectiveQty = currentQty * parentQty
                                
                                const guid = sel.item?.guid
                                if (guid && recipeLookup.has(guid)) {
                                    const rDataList = recipeLookup.get(guid)!
                                    const soldQty = effectiveQty
                                    
                                    for (const rData of rDataList) {
                                        const portionQty = Number(rData.quantity || 0)
                                        const unit = rData.unit
                                        const yieldPct = (Number(rData.yield_percent) || 100) / 100
                                        
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
                                }
                                
                                if (sel.modifiers && Array.isArray(sel.modifiers)) {
                                    sel.modifiers.forEach((m: any) => processSel(m, effectiveQty))
                                }
                            }
                            
                            check.selections.forEach((sel: any) => processSel(sel, 1))
                        })
                    }
                })
                
                if (entries.length < 100) hasMore = false
                else page++
            } // End of Pagination While Loop
            
            const inserts = []
            for (const [key, raw_lbs] of buckets.entries()) {
                const [interval_start, meat_type] = key.split('_')
                inserts.push({
                    store_id: store.id,
                    business_date: targetDateStr,
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
        } // End of For targetDates Loop
        }

        const promises = storesToProcess.map(async (store) => {
            if (!store.external_id) return;
            
            await acquire();
            try {
                await processStore(store);
            } finally {
                release();
            }
        });
        
        await Promise.all(promises)

        console.log("✅ [CRON] Terminado.")
        return NextResponse.json({ success: true, processed_dates: targetDates, details: results })

    } catch (error: any) {
        console.error(`💥 [CRON] Error crítico total:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

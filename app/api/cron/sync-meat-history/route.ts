/**
 * @module sync-meat-history
 * @description Cron job que sincroniza el consumo histórico de carnes y preparaciones desde Toast API en bloques de 30 minutos.
 * @businessRules
 *   - Día laboral Gavilán: 6:00 AM a 5:59 AM del siguiente día (America/Los_Angeles).
 *   - Ventana sin ventas: Se omite 4:15–5:59 AM LA y 6:30–6:59 AM LA (`?force=1` permite override manual).
 *   - Cierre final de ayer: Entre 6:00–6:29 AM LA se ejecuta UNA sola pasada `[dateStrYest]` cubriendo lotes 0, 1 y 2.
 *   - Proteínas rastreadas: ASADA, PASTOR, POLLO, CARNITAS, CABEZA, LENGUA, BUCHE, CHORIZO, CAFE, CHAMPURRADO, AGUACATE, GUACAMOLE, FRIJOL MOLIDO, ARROZ.
 *   - Yield formula: rawLbs = (soldQty * portionQty in lbs) / yieldPct.
 * @dataFlow Toast API /ordersBulk -> recipe lookup & yield -> diff-based UPSERT + selective DELETE -> meat_consumption_history table.
 * @notes
 *   - Se ejecutan lotes por minuto LA para balancear consumo de API Toast sin timeouts.
 *   - 2026-11-19 (Paquete 2A): Salto en horas muertas (`4:15–5:59 AM` y `6:30–6:59 AM LA`), pasada única `[dateStrYest]` en `6:00–6:29 AM LA`, proyecciones slim en `inventory_items`/`recipes`, y reemplazo de `DELETE+INSERT` ciego por `UPSERT` por diferencias + `DELETE` selectivo de cubetas anuladas (Caveat A: maneja órdenes anuladas en Toast con 0% drift eliminando >95% de dead tuples).
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

        const searchParams = new URL(request.url).searchParams
        const forceRun = searchParams.get('force') === '1' || searchParams.get('force') === 'true'
        const batchParam = searchParams.get('batch')

        const now = new Date()
        const laParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(now)
        const getPart = (type: string) => laParts.find(p => p.type === type)?.value || '0'
        const laYear = parseInt(getPart('year'), 10)
        const laMonth = parseInt(getPart('month'), 10)
        const laDay = parseInt(getPart('day'), 10)
        const rawLaHour = parseInt(getPart('hour'), 10)
        const laHour = rawLaHour === 24 ? 0 : rawLaHour
        const laMinute = parseInt(getPart('minute'), 10)

        // Ventana muerta: 4:15–5:59 AM LA (tiendas cerradas) y 6:30–6:59 AM LA (post cierre final de ayer)
        if (!forceRun) {
            if ((laHour === 4 && laMinute >= 15) || laHour === 5) {
                console.log(`⏳ [CRON MEAT] Omitido en horas muertas (4:15-5:59 AM LA). Hora LA: ${laHour}:${String(laMinute).padStart(2, '0')}`)
                return NextResponse.json({
                    success: true,
                    skipped: true,
                    message: 'Skipped: Dead hours (4:15 AM - 5:59 AM LA)'
                })
            }
            if (laHour === 6 && laMinute >= 30) {
                console.log(`⏳ [CRON MEAT] Omitido en ventana post-cierre (6:30-6:59 AM LA). Hora LA: ${laHour}:${String(laMinute).padStart(2, '0')}`)
                return NextResponse.json({
                    success: true,
                    skipped: true,
                    message: 'Skipped: Post-closeout dead hours (6:30 AM - 6:59 AM LA)'
                })
            }
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        console.log("🚀 [CRON] Iniciando Sync Meat History...")
        let token = await getToastToken()
        let tokenTime = Date.now()
        if (!token) throw new Error("No Toast Token")

        const { data: inventoryData } = await supabase.from('inventory_items').select('id, name, yield_percent')
        const { data: recipesData } = await supabase.from('recipes').select('toast_menu_item_guid, inventory_item_id, quantity, unit')
        const { data: stores } = await supabase.from('stores').select('id, name, external_id').eq('is_active', true)

        if (!inventoryData || !recipesData || !stores) throw new Error("Error obteniendo datos base de Supabase")

        // @businessRule: Proteínas e insumos rastreados en historial de consumo.
        // ASADA, PASTOR, POLLO, CABEZA, LENGUA requieren pace en parrilla.
        // BUCHE, CHORIZO, CARNITAS se cocinan al momento pero se registran en historial.
        // CAFE, CHAMPURRADO, AGUACATE, GUACAMOLE, FRIJOL MOLIDO, ARROZ son preparaciones de cocina trasera.
        const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA', 'BUCHE', 'CHORIZO', 'CAFE', 'CHAMPURRADO', 'AGUACATE', 'GUACAMOLE', 'FRIJOL MOLIDO', 'ARROZ']
        const meatItems = inventoryData.filter(i => {
            const name = (i.name || '').toUpperCase()
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
                    if ((iData.name || '').toUpperCase().includes(tp)) meatType = tp
                })
                const list = recipeLookup.get(r.toast_menu_item_guid) || []
                list.push({ ...r, yield_percent: iData.yield_percent || 100, meat_type: meatType })
                recipeLookup.set(r.toast_menu_item_guid, list)
            }
        })

        // Sort stores consistently to ensure stable batching
        const sortedStores = stores.sort((a, b) => a.id - b.id)

        // Parse query parameter ?batch=0/1/2 or determine dynamically by current LA minute
        let batch = batchParam !== null ? parseInt(batchParam, 10) : null
        
        if (batch === null || isNaN(batch)) {
            batch = Math.floor((laMinute % 30) / 10) // 0-9m -> 0, 10-19m -> 1, 20-29m -> 2
        }

        // Calculate store batch slices dynamically
        const batchSize = Math.ceil(sortedStores.length / 3)
        const startIdx = batch * batchSize
        const endIdx = Math.min(startIdx + batchSize, sortedStores.length)
        const storesToProcess = sortedStores.slice(startIdx, endIdx)

        console.log(`📦 [CRON] Procesando Batch ${batch} (tiendas ${startIdx + 1} a ${endIdx} de ${sortedStores.length})`)

        // Regla Gavilán: El día cierra a las 6:00 AM (LA Time)
        const businessDayUtc = new Date(Date.UTC(laYear, laMonth - 1, laDay))
        if (laHour < 6) { businessDayUtc.setUTCDate(businessDayUtc.getUTCDate() - 1) }
        
        const laYesterdayUtc = new Date(businessDayUtc.getTime())
        laYesterdayUtc.setUTCDate(laYesterdayUtc.getUTCDate() - 1)
        
        const formatUtcYmd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        const dateStrYest = formatUtcYmd(laYesterdayUtc)
        const dateStrToday = formatUtcYmd(businessDayUtc)
        
        // Optimización: En 6:00–6:29 AM LA corremos UNA sola pasada final de ayer [dateStrYest] (lotes 0,1,2)
        const targetDates = (laHour === 6 && laMinute < 30)
            ? [dateStrYest]
            : (laHour === 6 && forceRun)
            ? [dateStrYest, dateStrToday]
            : [dateStrToday]
        console.log(`📅 [CRON] Procesando intraday... Fechas: ${targetDates.join(', ')} (Hora LA: ${laHour}:${String(laMinute).padStart(2, '0')})`)

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
                
                const buckets = new Map<string, number>()
                
                let page = 1
                let hasMore = true
                let maxRetries = 5
                let fetchIncomplete = false
                
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
                    fetchIncomplete = true
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
                        fetchIncomplete = true
                        break;
                    }
                }
                
                if (!res.ok) {
                    fetchIncomplete = true
                    break
                }
                
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
                                            const bKey = `${bucketTime}|${rData.meat_type}`
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

            if (fetchIncomplete) {
                console.warn(`⚠️ [CRON MEAT] Paginación incompleta en ${store.name} (${targetDateStr}); se omiten mutaciones para evitar borrar cubetas válidas.`)
                continue
            }

            // Diff-based UPSERT + selective DELETE (Caveat A: maneja órdenes anuladas en Toast sin dead-tuple bloat)
            const normInterval = (t: string) => (t && t.length === 5 ? `${t}:00` : String(t || ''))
            const { data: existingRows, error: existingErr } = await supabase
                .from('meat_consumption_history')
                .select('id, interval_start, meat_type, raw_lbs')
                .eq('store_id', store.id)
                .eq('business_date', targetDateStr)

            if (existingErr) {
                console.error(`Error leyendo meat_consumption_history existente (${store.name} ${targetDateStr}):`, existingErr.message)
                continue
            }

            const existingMap = new Map<string, { id: string; raw_lbs: number }>()
            for (const row of existingRows || []) {
                const k = `${normInterval(row.interval_start)}|${row.meat_type}`
                existingMap.set(k, { id: row.id, raw_lbs: Number(row.raw_lbs || 0) })
            }

            const toUpsert: Array<{
                store_id: number
                business_date: string
                interval_start: string
                meat_type: string
                raw_lbs: number
            }> = []
            for (const [key, raw_lbs] of buckets.entries()) {
                const sepIdx = key.indexOf('|')
                const interval_start = key.slice(0, sepIdx)
                const meat_type = key.slice(sepIdx + 1)
                const prev = existingMap.get(key)
                if (!prev || Math.abs(raw_lbs - prev.raw_lbs) > 1e-4) {
                    toUpsert.push({
                        store_id: store.id,
                        business_date: targetDateStr,
                        interval_start,
                        meat_type,
                        raw_lbs,
                    })
                }
            }

            const idsToDelete: string[] = []
            for (const [key, prev] of existingMap.entries()) {
                if (!buckets.has(key)) {
                    idsToDelete.push(prev.id)
                }
            }

            let writeFailed = false
            if (toUpsert.length > 0) {
                const { error: upsertErr } = await supabase
                    .from('meat_consumption_history')
                    .upsert(toUpsert, { onConflict: 'store_id,business_date,interval_start,meat_type' })
                if (upsertErr) {
                    writeFailed = true
                    console.error(`Error upserting meat_consumption_history (${store.name}):`, upsertErr.message)
                }
            }

            if (idsToDelete.length > 0) {
                const { error: delErr } = await supabase
                    .from('meat_consumption_history')
                    .delete()
                    .in('id', idsToDelete)
                if (delErr) {
                    writeFailed = true
                    console.error(`Error deleting vanished meat_consumption_history rows (${store.name}):`, delErr.message)
                }
            }

            if (!writeFailed) {
                results.push({
                    store: store.name,
                    date: targetDateStr,
                    upserted: toUpsert.length,
                    deleted: idsToDelete.length,
                    unchanged: buckets.size - toUpsert.length,
                })
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

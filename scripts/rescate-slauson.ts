import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function getToastToken() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: process.env.TOAST_CLIENT_ID,
            clientSecret: process.env.TOAST_CLIENT_SECRET,
            userAccessType: "TOAST_MACHINE_CLIENT"
        })
    })
    if (!res.ok) throw new Error("No se pudo obtener token de Toast")
    const d = await res.json()
    return d.token.accessToken
}

function get30MinBucket(isoString: string) {
    const d = new Date(isoString);
    let h = d.getHours();
    let m = d.getMinutes();
    if (m >= 0 && m < 30) m = 0;
    else m = 30;
    const hh = h.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    return `${hh}:${mm}:00`;
}

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) throw new Error('Faltan credenciales Supabase')

    const supabase = createClient(supabaseUrl, supabaseKey)
    const TOAST_API_HOST = process.env.NEXT_PUBLIC_TOAST_API_HOST

    console.log("Cargando recetas para Slauson...")
    const { data: stores } = await supabase.from('stores').select('*').ilike('name', '%slauson%').limit(1)
    if (!stores || stores.length === 0) throw new Error("Store no encontrada")
    const store = stores[0]

    const { data: meatItems } = await supabase.from('inventory_items').select('*').eq('category', 'Carnes')
    const { data: recipesData } = await supabase.from('recipes').select('*')
    
    const targetProteins = ['ASADA', 'POLLO', 'PASTOR', 'CARNITAS', 'CABEZA', 'CHORIZO', 'LENGUA', 'BUCHE']
    const recipeLookup = new Map<string, any>()
    const itemLookup = new Map<string, any>()
    
    meatItems?.forEach(i => itemLookup.set(i.id, i))
    recipesData?.forEach(r => {
        if (itemLookup.has(r.inventory_item_id)) {
            const iData = itemLookup.get(r.inventory_item_id)
            let meatType = 'OTRO'
            targetProteins.forEach(tp => {
                if (iData.name.toUpperCase().includes(tp)) meatType = tp
            })
            recipeLookup.set(r.toast_menu_item_guid, { ...r, yield_percent: iData.yield_percent || 100, meat_type: meatType })
        }
    })

    // Dates
    const start = new Date('2026-02-01')
    const end = new Date('2026-04-07')
    const dates = []
    let cur = new Date(start)
    while (cur <= end) {
        // Obtenemos solo los lunes (1) para reparar rápido la proyección de los lunes de tableta!
        // La tablet proyecta comparando el mismo DOW histórico.
        let dow = cur.getDay() // 0=Sun, 1=Mon
        if (dow === 1 || dow === 2) { 
            dates.push(cur.toISOString().split('T')[0])
        }
        cur.setDate(cur.getDate() + 1)
    }

    let token = await getToastToken()
    let tokenTime = Date.now()

    for (const dateStr of dates) {
        const businessDate = dateStr.replace(/-/g, '')
        process.stdout.write(`\n📅 Slauson: ${dateStr} `)
        
        await supabase.from('meat_consumption_history').delete().eq('business_date', dateStr).eq('store_id', store.id)

        const buckets = new Map<string, number>()
        let page = 1; let hasMore = true; let maxRetries = 3;

        while (hasMore) {
            if (Date.now() - tokenTime > 1000 * 60 * 45) {
                token = await getToastToken(); tokenTime = Date.now()
            }
            
            const res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id }
            })
            
            if (res.status === 429) {
                if (maxRetries > 0) {
                    maxRetries--;
                    await new Promise(r => setTimeout(r, 4000));
                    continue;
                } else break;
            }
            if (!res.ok) break;

            maxRetries = 3;
            const entries = await res.json()
            if (!Array.isArray(entries) || entries.length === 0) { hasMore = false; continue; }

            entries.forEach((order: any) => {
                if (order.voided || !order.openedDate) return
                const openedIso = order.openedDate
                const bucketTime = get30MinBucket(openedIso)
                
                if (order.checks) {
                    order.checks.forEach((check: any) => {
                        if (check.voided || !check.selections) return
                        
                        const processSel = (sel: any, parentQty: number = 1) => {
                            if (sel.voided) return
                            const effectiveQty = Number(sel.quantity || 1) * parentQty
                            const guid = sel.item?.guid
                            
                            if (guid && recipeLookup.has(guid)) {
                                const rData = recipeLookup.get(guid)
                                const portionQty = Number(rData.quantity || 0)
                                const yieldPct = Number(rData.yield_percent || 100) / 100
                                let lbs = 0
                                let total = effectiveQty * portionQty
                                if (rData.unit === 'oz') lbs = total / 16
                                else if (rData.unit === 'lb') lbs = total
                                
                                const rawLbs = lbs / yieldPct
                                if (rawLbs > 0) {
                                    const bKey = `${bucketTime}_${rData.meat_type}`
                                    buckets.set(bKey, (buckets.get(bKey) || 0) + rawLbs)
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
            if (!error) process.stdout.write(`✅`)
        }
    }
    console.log("\n🏁 Rescate de Slauson Terminado.")
}
main().catch(console.error).finally(()=>process.exit(0))

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

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

async function getToastToken() {
    const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: process.env.TOAST_CLIENT_ID,
            clientSecret: process.env.TOAST_CLIENT_SECRET,
            userAccessType: "TOAST_MACHINE_CLIENT"
        })
    })
    const d = await res.json()
    return d.token.accessToken
}

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars')

    const supabase = createClient(supabaseUrl, supabaseKey)
    const storeName = "slauson"
    const businessDate = "20260406"
    
    // Get store
    const { data: stores } = await supabase.from('stores').select('*').ilike('name', `%${storeName}%`).limit(1)
    const store = stores![0]
    
    // Get recipes and inventory to build yield & unit map
    const { data: meatItems, error: mErr } = await supabase.from('inventory_items').select('*').ilike('name', '%ASADA%')
    if (mErr) console.error("inventory_items ERROR:", mErr)
    const { data: recipesData } = await supabase.from('recipes').select('*')
    
    const itemLookup = new Map<string, any>()
    meatItems?.forEach(i => itemLookup.set(i.id, i))
    
    // Encuentra la ASADA
    const asadaItem = meatItems?.find(i => i.name.toUpperCase().includes('ASADA'))
    const yieldPct = (asadaItem?.yield_percent || 61.5) / 100
    
    const recipeLookup = new Map<string, any>()
    const targetProteins = ['ASADA']
    recipesData?.forEach(r => {
        if (itemLookup.has(r.inventory_item_id)) {
            const iData = itemLookup.get(r.inventory_item_id)
            targetProteins.forEach(tp => {
                if (iData.name.toUpperCase().includes(tp)) {
                    recipeLookup.set(r.toast_menu_item_guid, { 
                        ...r, 
                        yield_percent: iData.yield_percent || 100,
                        meat_type: tp,
                        product_name: r.name 
                    })
                }
            })
        }
    })
    
    // Fetch Toast Data
    const token = await getToastToken()
    let page = 1; let hasMore = true;
    const itemsCount: any = {}

    while (hasMore) {
        const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
        const res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': store.external_id }
        })
        if (res.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 4000))
            continue
        }
        if (!res.ok) {
            console.log("Error status:", res.status)
            break
        }
        const entries = await res.json()
        if (!Array.isArray(entries) || entries.length === 0) {
            hasMore = false
            break
        }

        entries.forEach((order: any) => {
            if (order.voided || !order.openedDate) return
            const dStr = new Date(order.openedDate).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const d = new Date(dStr)
            const h = d.getHours()
            
            // FILTRO DE HORARIO: 15:00 a 16:00 (3 PM a 4 PM)
            if (h !== 15) return 
            
            if (order.checks) {
                order.checks.forEach((check: any) => {
                    if (check.voided || !check.selections) return
                    
                    const processSel = (sel: any, parentQty: number = 1, parentName = "") => {
                        if (sel.voided) return
                        const currentQty = Number(sel.quantity || 1)
                        const effectiveQty = currentQty * parentQty
                        
                        const guid = sel.item?.guid
                        const itemName = sel.displayName || "Unknown"
                        const displayName = parentName ? `${parentName} -> ${itemName}` : itemName
                        
                        if (guid && recipeLookup.has(guid)) {
                            const rData = recipeLookup.get(guid)
                            const portionQty = Number(rData.quantity || 0)
                            const unit = rData.unit
                            
                            if (!itemsCount[displayName]) {
                                itemsCount[displayName] = { count: 0, rawLbs: 0, recipeOz: portionQty + " " + unit }
                            }
                            
                            itemsCount[displayName].count += effectiveQty
                            
                            let lbs = 0
                            let total = effectiveQty * portionQty
                            if (unit === 'oz') lbs = total / 16
                            else if (unit === 'lb') lbs = total
                            
                            const rawLbs = lbs / yieldPct
                            itemsCount[displayName].rawLbs += rawLbs
                        }
                        
                        if (sel.modifiers && Array.isArray(sel.modifiers)) {
                            sel.modifiers.forEach((m: any) => processSel(m, effectiveQty, parentName ? parentName : itemName))
                        }
                    }
                    check.selections.forEach((sel: any) => processSel(sel, 1, ""))
                })
            }
        })
        
        if (entries.length < 100) hasMore = false
        else page++
    }

    // Print breakdown
    console.log("=============================================================================")
    console.log(` DESGLOSE FÍSICO: ASADA CRUDA | ${store.name} | 3PM - 4PM (15:00)`)
    console.log(` > Merma (Yield): ${yieldPct * 100}%`)
    console.log("=============================================================================")
    console.log("| Cant | Lbs Crudas | Receta Asignada       | Producto")
    console.log("|------|------------|-----------------------|----------")
    
    let totalLbs = 0;
    let totalItems = 0;
    
    const sorted = Object.entries(itemsCount).sort((a: any, b: any) => b[1].rawLbs - a[1].rawLbs)
    sorted.forEach(([name, data]: any) => {
        totalLbs += data.rawLbs
        totalItems += data.count
        const countStr = data.count.toString().padEnd(4, ' ')
        const lbsStr = data.rawLbs.toFixed(2).padEnd(6, ' ') + " lbs"
        const recStr = data.recipeOz.padEnd(21, ' ')
        console.log(`| ${countStr} | ${lbsStr}   | ${recStr} | ${name}`)
    })
    console.log("=============================================================================")
    console.log(`| ${totalItems.toString().padEnd(4, ' ')} | ${totalLbs.toFixed(2).padEnd(6, ' ')} lbs   | TOTALES COMPUTADOS (REAL OCURRIDO)`)
    console.log("=============================================================================")
    
    // Now get the PROJECTION from the RPC!
    // Since 15:00 hour has TWO buckets (15:00 and 15:30)
    console.log(`\nConsultando proyección histórica para DOW = 2...`)
    const { data: rpcData } = await supabase.rpc('get_meat_history_avg', {
        p_store_id: store.id,
        p_dow: 2
    })
    
    if (rpcData) {
        const p1500 = rpcData.find((d: any) => d.interval_start === '15:00:00' && d.meat_type === 'ASADA')
        const p1530 = rpcData.find((d: any) => d.interval_start === '15:30:00' && d.meat_type === 'ASADA')
        const totalProj = (Number(p1500?.avg_lbs || 0) + Number(p1530?.avg_lbs || 0)).toFixed(2)
        console.log(`\n[PROYECCIÓN TABLETA]`)
        console.log(`- Base de datos proyectó para 15:00: ${p1500?.avg_lbs || 0} lbs`)
        console.log(`- Base de datos proyectó para 15:30: ${p1530?.avg_lbs || 0} lbs`)
        console.log(`- TOTAL PROYECTADO POR LA TABLETA PARA LA HORA: ${totalProj} lbs`)
    }
}
main().catch(console.error).finally(()=>process.exit(0))

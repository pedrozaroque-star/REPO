import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })
config({ path: '.env' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const CLIENT_ID = process.env.TOAST_CLIENT_ID
const CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET

async function getToastToken() {
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
}

function get30MinBucket(isoDateStr: string): string {
    const dateObj = new Date(isoDateStr)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    })
    let timeParts = formatter.format(dateObj).split(':')
    let h = parseInt(timeParts[0], 10)
    let m = parseInt(timeParts[1], 10)
    if (h === 24) h = 0
    m = m >= 30 ? 30 : 0
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
}

async function investigate() {
    console.log("🕵️ Investigando Central 14:00 - 16:00 ...")

    // 1. Get Store ID for "Central"
    const { data: stores } = await supabase.from('stores').select('id, name, external_id').ilike('name', '%central%')
    if (!stores || stores.length === 0) return console.log("No Central store found")
    const central = stores[0]
    console.log(`Encontrada sucursal: ${central.name}`)

    // 2. Fetch Historical Averages (Saturday DOW = 6)
    // Wait, today is April 4th, 2026. April 4 is a Saturday. 
    // DOW in JS: 0=Sun, 1=Mon... 6=Sat. Our RPC uses DOW extraction which in Postgres is 0-6 or 1-7 depending on ISO. DOW in postgres is 0-6 (0=Sunday).
    // Let's just fetch the raw averages from our table for DOW = 6
    const { data: histData, error } = await supabase.rpc('get_meat_history_avg', {
        p_store_id: central.id,
        p_dow: 6 // Saturday
    })
    
    if (error) console.error("RPC Error:", error)
    
    // We care about 14:00:00 and 15:30:00 ASADA
    const avg14 = histData?.find((h: any) => h.interval_start === '14:00:00' && h.meat_type === 'ASADA')?.avg_lbs || 0
    const avg1430 = histData?.find((h: any) => h.interval_start === '14:30:00' && h.meat_type === 'ASADA')?.avg_lbs || 0
    const avg15 = histData?.find((h: any) => h.interval_start === '15:00:00' && h.meat_type === 'ASADA')?.avg_lbs || 0
    const avg1530 = histData?.find((h: any) => h.interval_start === '15:30:00' && h.meat_type === 'ASADA')?.avg_lbs || 0
    const avg16 = histData?.find((h: any) => h.interval_start === '16:00:00' && h.meat_type === 'ASADA')?.avg_lbs || 0

    console.log(`\n============================`)
    console.log(`📊 PROMEDIO HISTÓRICO (Tableta hoy Sábado)`)
    console.log(`============================`)
    console.log(`14:00 -> ${avg14.toFixed(1)} Lbs (2:00 PM - 2:30 PM)`)
    console.log(`14:30 -> ${avg1430.toFixed(1)} Lbs`)
    console.log(`15:00 -> ${avg15.toFixed(1)} Lbs`)
    console.log(`15:30 -> ${avg1530.toFixed(1)} Lbs (3:30 PM - 4:00 PM)`)
    console.log(`16:00 -> ${avg16.toFixed(1)} Lbs`)
    
    // 3. Let's fetch REAL-TIME TOAST DATA for TODAY
    const businessDate = '20260404'
    console.log(`\n📡 Conectando a Toast para leer ventas reales de HOY en vivo...`)
    
    const token = await getToastToken()
    
    // Recipes Mapping for Asada
    const { data: invData } = await supabase.from('inventory_items').select('*').ilike('name', '%asada%')
    const { data: recipesData } = await supabase.from('recipes').select('*')
    const recipeLookup = new Map()
    if (invData && recipesData) {
        const asadaItems = invData.map(i => i.id)
        recipesData.forEach(r => {
            if (asadaItems.includes(r.inventory_item_id)) {
                const yieldPct = (invData.find(i => i.id === r.inventory_item_id)?.yield_percent || 61.5) / 100
                recipeLookup.set(r.toast_menu_item_guid, { portion: Number(r.quantity), unit: r.unit, yieldPct })
            }
        })
    }

    const realTimeLbs = { '14:00:00': 0, '14:30:00': 0, '15:00:00': 0, '15:30:00': 0, '16:00:00': 0 }

    let page = 1
    let hasMore = true
    while(hasMore) {
        const res = await fetch(`${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': central.external_id }
        })
        if (!res.ok) {
            if (res.status === 429) { await new Promise(r=>setTimeout(r, 6000)); continue; }
            break;
        }
        const entries = await res.json() as any[]
        if (entries.length === 0) break
        
        entries.forEach(order => {
            if (order.voided || !order.openedDate) return
            const b = get30MinBucket(order.openedDate)
            if (b in realTimeLbs) {
                order.checks?.forEach((chk: any) => {
                    if (chk.voided) return
                    const p = (sel: any) => {
                        if (sel.voided) return
                        const rData = recipeLookup.get(sel.item?.guid)
                        if (rData) {
                            const qty = Number(sel.quantity || 1)
                            let lbs = 0
                            const total = qty * rData.portion
                            if (rData.unit === 'oz') lbs = total / 16
                            else if (rData.unit === 'lb') lbs = total
                            const raw = lbs / rData.yieldPct
                            realTimeLbs[b as keyof typeof realTimeLbs] += raw
                        }
                        sel.modifiers?.forEach(p)
                    }
                    chk.selections?.forEach(p)
                })
            }
        })
        
        if (entries.length < 100) hasMore = false
        else page++
    }

    console.log(JSON.stringify({
        avg14, real14: realTimeLbs['14:00:00'], diff14: realTimeLbs['14:00:00'] - avg14,
        avg1530: avg1530, real1530: realTimeLbs['15:30:00'], diff1530: realTimeLbs['15:30:00'] - avg1530
    }))
}

investigate()

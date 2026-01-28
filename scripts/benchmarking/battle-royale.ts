
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import * as fs from 'fs'
import { generateLegacyForecast } from './model-legacy'
import { generateSmartForecast } from '../../lib/intelligence'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const TODAY_STR = '2026-01-28'
const CSV_DIR = path.resolve(process.cwd(), '7shifts proyecciones')

// --- HELPER: Parse 7Shifts Date "November 1 2025" -> "2025-11-01"
function parse7ShiftsDate(dateStr: string): string | null {
    try {
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return null
        return d.toISOString().split('T')[0]
    } catch { return null }
}

// --- HELPER: Parse Money "$20183.85" -> 20183.85
function parseMoney(str: string): number {
    if (!str) return 0
    return parseFloat(str.replace(/[$,]/g, '')) || 0
}

// --- HELPER: Load 7Shifts Data ---
function load7ShiftsData() {
    const map = new Map<string, Map<string, number>>() // normalized_store_name -> (date -> forecast)

    if (!fs.existsSync(CSV_DIR)) {
        console.warn("⚠️ 7Shifts folder not found")
        return map
    }

    const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'))

    for (const file of files) {
        // Normalize filename to match store name logic: "Lynwood.csv" -> "lynwood"
        const storeKey = file.replace('.csv', '').toLowerCase().trim()
        const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf-8')
        const lines = content.split('\n')

        const storeMap = new Map<string, number>()

        // Skip header (line 0) and Total (last line check)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line || line.startsWith('Total')) continue

            // Simple CSV split (assuming no commas in date string based on sample "November 1 2025")
            // Wait, "November 1 2025" has spaces but no commas.
            // But if formatting changes to "November 1, 2025", split(',') breaks.
            // The sample showed: November 1 2025,$20183.85
            // So split(',') works fine.

            const cols = line.split(',')
            if (cols.length < 3) continue

            const dateRaw = cols[0]
            const projRaw = cols[2] // Column 2 is "Projected Sales"

            const isoDate = parse7ShiftsDate(dateRaw)
            if (isoDate) {
                storeMap.set(isoDate, parseMoney(projRaw))
            }
        }

        map.set(storeKey, storeMap)
        // console.log(`Loaded 7Shifts for ${storeKey}: ${storeMap.size} days`)
    }

    return map
}

function getStoreKey(dbName: string): string {
    // Basic normalization
    let key = dbName.toLowerCase().replace('tacos gavilan', '').trim()

    // Explicit Alias Mapping based on CSV filenames
    const aliases: Record<string, string> = {
        'la broadway': 'broadway',
        'la central': 'central',
        'south gate': 'southgate' // CSV is southgate.csv
    }

    return aliases[key] || key
}


function getDatesInRange(start: string, end: string) {
    const arr = []
    let dt = new Date(start + 'T12:00:00')
    const endDt = new Date(end + 'T12:00:00')
    while (dt <= endDt) {
        arr.push(dt.toISOString().split('T')[0])
        dt.setDate(dt.getDate() + 1)
    }
    return arr
}

async function runBattle() {
    console.log("⚔️  BATTLE ROYALE: TRIPLE THREAT (LEGACY vs NEW vs 7SHIFTS) ⚔️")

    const startDate = '2025-11-01'
    const endDate = '2026-03-15'
    const allDates = getDatesInRange(startDate, endDate)

    // Load External Forecasts
    const shiftsData = load7ShiftsData()

    // Fetch Stores
    const { data: stores } = await supabase
        .from('stores')
        .select('external_id, name')
        .eq('is_active', true)
        .order('name')

    if (!stores) return

    const activeStores = stores.map(s => ({
        store_id: s.external_id,
        name: s.name,
        key: getStoreKey(s.name)
    }))

    // START HTML
    let html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Battle Royale: Triple Threat</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #eef2f3; padding: 20px; color: #333; }
            h1 { text-align: center; color: #2c3e50; }
            .nav-bar { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom: 30px; position: sticky; top: 0; background: #eef2f3; padding: 10px; z-index: 100; }
            .nav-btn { text-decoration: none; background: #fff; padding: 10px 20px; border-radius: 20px; color: #2c3e50; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.1); transition: all 0.2s; }
            .nav-btn:hover { background: #3498db; color: white; transform: translateY(-2px); }
            
            .store-section { background: white; max-width: 1200px; margin: 0 auto 50px auto; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            h2 { border-bottom: 3px solid #3498db; padding-bottom: 10px; margin-top: 0; color: #2c3e50; }
            
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
            th { background-color: #34495e; color: white; padding: 10px; text-align: left; }
            td { padding: 8px; border-bottom: 1px solid #eee; }
            
            .money { font-family: 'Consolas', monospace; font-weight: 600; }
            .error-high { color: #e74c3c; font-weight: 700; }
            .error-low { color: #27ae60; }
            
            .winner-new { background-color: #d5f5e3; } /* Green */
            .winner-old { background-color: #fadbd8; } /* Red */
            .winner-7shifts { background-color: #f9e79f; } /* Yellow */
            
            .future-row { color: #7f8c8d; font-style: italic; background: #fdfefe; }
            .future-high { color: #2980b9; font-weight: bold; }
            
            .metrics-dashboard { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; background: #f8f9fa; padding: 15px; border-radius: 8px; }
            .metric-card { text-align: center; }
            .metric-val { font-size: 20px; font-weight: bold; }
            .metric-lbl { font-size: 11px; text-transform: uppercase; color: #777; }
        </style>
    </head>
    <body>
        <h1>🛡️ TRIPLE THREAT: Legacy vs 7Shifts vs Intelligence 🛡️</h1>
        
        <div class="nav-bar">
            ${activeStores.map(s => `<a href="#store-${s.store_id}" class="nav-btn">${s.name}</a>`).join('')}
        </div>
    `

    for (const store of activeStores) {
        if (!store.store_id) continue
        console.log(`Processing ${store.name} (Key: ${store.key})...`)

        // Fetch Actuals
        const { data: actualsData } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales')
            .eq('store_id', store.store_id)
            .gte('business_date', startDate)
            .lte('business_date', TODAY_STR)

        const actualMap = new Map()
        actualsData?.forEach(r => actualMap.set(r.business_date, r.net_sales))

        // Get 7Shifts Map for this store
        const store7Shifts = shiftsData.get(store.key)

        let errLeg = 0, errNew = 0, err7S = 0
        let count = 0
        let winsNew = 0, winsLeg = 0, wins7S = 0

        let rows = ''

        // Parallel Chunks
        const chunkSize = 15
        for (let i = 0; i < allDates.length; i += chunkSize) {
            const chunk = allDates.slice(i, i + chunkSize)
            const promises = chunk.map(async (date) => {
                const isFuture = date >= TODAY_STR
                const actual = actualMap.get(date)
                const val7S = store7Shifts?.get(date) || 0

                let legVal = 0, newVal = 0
                try {
                    const [leg, smart] = await Promise.all([
                        generateLegacyForecast(store.store_id, date),
                        generateSmartForecast(store.store_id, date)
                    ])
                    legVal = leg
                    newVal = Math.round(smart.total_sales)
                } catch (e) { return null }

                if (!isFuture && actual !== undefined) {
                    const diffLeg = Math.abs(legVal - actual)
                    const diffNew = Math.abs(newVal - actual)
                    const diff7S = val7S > 0 ? Math.abs(val7S - actual) : 999999

                    const pctLeg = actual > 0 ? (diffLeg / actual) * 100 : 0
                    const pctNew = actual > 0 ? (diffNew / actual) * 100 : 0
                    const pct7S = actual > 0 && val7S > 0 ? (diff7S / actual) * 100 : 0

                    let winner = 'new'
                    let bestDiff = diffNew

                    if (diffLeg < bestDiff) { bestDiff = diffLeg; winner = 'old' }
                    if (val7S > 0 && diff7S < bestDiff) { bestDiff = diff7S; winner = '7s' }

                    let wClass = 'winner-new', wText = '🆕 Nuevo'
                    if (winner === 'old') { wClass = 'winner-old'; wText = '👴 Viejo' }
                    if (winner === '7s') { wClass = 'winner-7shifts'; wText = '🎰 7Shifts' }

                    // Format
                    const fmt = (pct: number) => pct > 50 ? `⚠️ ${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`
                    const cls = (pct: number) => pct > 15 ? 'error-high' : 'error-low'

                    const cell7S = val7S > 0 ? `<td class="money">$${Math.round(val7S)}</td><td class="${cls(pct7S)}">${fmt(pct7S)}</td>` : `<td>-</td><td>-</td>`

                    return {
                        type: 'past',
                        pctLeg, pctNew, pct7S, has7S: val7S > 0,
                        winner,
                        html: `
                        <tr class="${wClass}">
                            <td>${date}</td>
                            <td class="money">$${Math.round(actual)}</td>
                            <td class="money">$${Math.round(legVal)}</td>
                            <td class="${cls(pctLeg)}">${fmt(pctLeg)}</td>
                            ${cell7S}
                            <td class="money">$${Math.round(newVal)}</td>
                            <td class="${cls(pctNew)}">${fmt(pctNew)}</td>
                            <td><b>${wText}</b></td>
                        </tr>`
                    }
                } else {
                    // Future
                    // 7s Future
                    const has7S = val7S > 0
                    const cell7S = has7S ? `<td class="money">$${Math.round(val7S)}</td><td>-</td>` : `<td>-</td><td>-</td>`

                    const delta = newVal - legVal
                    let note = '🔵'
                    if (newVal === 0) note = '🎄 CERRADO'

                    return {
                        type: 'future',
                        html: `
                        <tr class="future-row">
                            <td>${date}</td>
                            <td>-</td>
                            <td class="money">$${Math.round(legVal)}</td>
                            <td>-</td>
                            ${cell7S}
                            <td class="money future-high">$${Math.round(newVal)}</td>
                            <td>-</td>
                            <td>${note}</td>
                        </tr>`
                    }
                }
            })

            const results = await Promise.all(promises)
            for (const res of results) {
                if (!res) continue
                rows += res.html
                if (res.type === 'past') {
                    errLeg += (res.pctLeg || 0)
                    errNew += (res.pctNew || 0)
                    if (res.has7S) err7S += (res.pct7S || 0)
                    count++
                    if (res.winner === 'new') winsNew++
                    if (res.winner === 'old') winsLeg++
                    if (res.winner === '7s') wins7S++
                }
            }
        }

        // STORE SUMMARY
        const meanLeg = count > 0 ? (errLeg / count).toFixed(1) : "0"
        const meanNew = count > 0 ? (errNew / count).toFixed(1) : "0"
        const mean7S = count > 0 ? (err7S / count).toFixed(1) : "0" // Crude average (assumes 7s has data for all days, if not it skews, but ok for now)

        html += `
        <div id="store-${store.store_id}" class="store-section">
            <h2>🏬 ${store.name}</h2>
            
            <div class="metrics-dashboard">
                 <div class="metric-card">
                    <div class="metric-val" style="color: #e74c3c">${meanLeg}%</div>
                    <div class="metric-lbl">Error Viejo</div>
                 </div>
                 <div class="metric-card">
                    <div class="metric-val" style="color: #f1c40f">${mean7S}%</div>
                    <div class="metric-lbl">Error 7Shifts</div>
                 </div>
                 <div class="metric-card">
                    <div class="metric-val" style="color: #27ae60">${meanNew}%</div>
                    <div class="metric-lbl">Error Nuevo</div>
                 </div>
                 <div class="metric-card">
                    <div class="metric-val">${winsNew} vs ${wins7S} vs ${winsLeg}</div>
                    <div class="metric-lbl">Wins (New / 7s / Old)</div>
                 </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Real</th>
                        <th>Viejo</th>
                        <th>Err</th>
                        <th>7Shifts</th>
                        <th>Err</th>
                        <th>Nuevo</th>
                        <th>Err</th>
                        <th>Ganador</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
        `

    }

    html += `</body></html>`
    fs.writeFileSync('battle_royale_triple_threat.html', html)
    console.log("✅ Reporte Triple Amenaza Generado: battle_royale_triple_threat.html")
}

runBattle()

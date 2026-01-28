
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
// Capacity Rules from lib/intelligence
const RULES = {
    KITCHEN_DOLLARS_PER_HEAD: 211, // $211 per cook (Industry Standard)
    CASHIER_TICKETS_PER_HEAD: 11,  // 11 tickets per cashier (Calibrated for Lynwood)
    MIN_COOKS: 2,
    MIN_CASHIERS: 1
}

async function runAnalysis() {
    console.log("🕵️ Mining Job GUIDs for Lynwood...")

    // 1. Map Job GUIDs to Roles (FOH vs BOH)
    // We need to find which GUIDs correspond to 'Cashier', 'Cook', 'Taquero', etc. for THIS store.
    // Since toast_jobs table mixes all stores (or has many guids), we filter by name patterns.

    // FETCH ALL JOBS (We can't filter by store_id in toast_jobs easily if it's not linked, 
    // but usually GUIDs are unique or we filter strictly by name).
    // Let's fetch all and filter in memory by name.

    const { data: allJobs } = await supabase.from('toast_jobs').select('title, guid')

    const roleMap = {
        FOH: [] as string[],
        BOH: [] as string[]
    }

    const ignored = []

    allJobs?.forEach(j => {
        const title = j.title.toLowerCase()
        if (title.includes('cashier') || title.includes('shift') || title.includes('manager')) roleMap.FOH.push(j.guid)
        else if (title.includes('cook') || title.includes('taquero') || title.includes('dish') || title.includes('prep')) roleMap.BOH.push(j.guid)
        else ignored.push(title)
    })

    console.log(`✅ Mapped ${roleMap.FOH.length} Cashier GUIDs and ${roleMap.BOH.length} Kitchen GUIDs.`)

    // 2. Define Time Range (Last 3 Months: Nov 2025 - Jan 2026)
    const startDate = '2025-11-01'
    const endDate = '2026-02-01'

    console.log(`📅 Analyzing Planning from ${startDate} to ${endDate}...`)

    // 3. Fetch Sales Data (Hourly)
    const { data: salesData } = await supabase
        .from('sales_daily_cache')
        .select('business_date, hourly_data, hourly_tickets')
        .eq('store_id', STORE_ID)
        .gte('business_date', startDate)
        .lte('business_date', endDate)

    // Index Sales by Date
    const salesByDate: Record<string, { sales: any, tickets: any }> = {}
    salesData?.forEach(row => {
        salesByDate[row.business_date] = {
            sales: row.hourly_data,
            tickets: row.hourly_tickets
        }
    })

    // 4. Fetch Punches (Massive Query - might need pagination, but let's try strict columns)
    // We need clock_in, clock_out, job_toast_guid, business_date

    // 4. Fetch Punches (Monthly Pagination Strategy)
    console.log(`   Downloading all punches in chunks...`)

    // Generate start/end for each month
    const rangeStarts = ['2025-11-01', '2025-12-01', '2026-01-01']
    const rangeEnds = ['2025-12-01', '2026-01-01', '2026-02-01']

    let allPunches: any[] = []

    for (let i = 0; i < rangeStarts.length; i++) {
        const s = rangeStarts[i]
        const e = rangeEnds[i]
        console.log(`   Fetching ${s} to ${e}...`)

        const { data: chunk, error } = await supabase
            .from('punches')
            .select('business_date, clock_in, clock_out, job_toast_guid')
            .eq('store_id', STORE_ID)
            .gte('business_date', s)
            .lt('business_date', e)
            .limit(10000) // 10k per month should be plenty

        if (error) console.error(`Error chunk ${s}:`, error)
        if (chunk) allPunches = [...allPunches, ...chunk]
    }

    console.log(`✅ Loaded ${allPunches.length} total shifts. Processing usage...`)

    // DIAGNOSTIC: Check Role Mapping Coverage
    const uniqueGuids = new Set(allPunches.map(p => p.job_toast_guid))
    let mappedCount = 0
    uniqueGuids.forEach(g => {
        if (roleMap.FOH.includes(g) || roleMap.BOH.includes(g)) mappedCount++
    })
    console.log(`ℹ️  Found ${uniqueGuids.size} unique Job Types used. Mapped ${mappedCount} of them.`)

    if (mappedCount < uniqueGuids.size) {
        // Find unmapped high-usage roles?
        console.log("⚠️ Warning: Some roles are unmapped. Resolving names...")
        const unmappedIds = [...uniqueGuids].filter(g => !roleMap.FOH.includes(g) && !roleMap.BOH.includes(g))

        const { data: jobDetails } = await supabase
            .from('toast_jobs')
            .select('title, guid')
            .in('guid', unmappedIds)

        if (jobDetails) {
            jobDetails.forEach(j => {
                console.log(`   🚨 UNMAPPED ROLE FOUND: "${j.title}" (GUID: ${j.guid})`)
                // Auto-fix for next run? 
                // We can't auto-fix effectively in this run, but we will know what to add.
            })
        }
    }

    // 5. Analyze Hour by Hour (Aggregating by "Weekday-Hour" to find patterns)
    // Structure: patterns['Friday']['19'] = { totalGapFOH: 0, totalGapBOH: 0, count: 0 }

    const patterns: Record<string, Record<string, {
        gapFOH: number, gapBOH: number,
        samples: number,
        overFOH: number, overBOH: number,
        underFOH: number, underBOH: number
    }>> = {}

    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    weekdays.forEach(d => {
        patterns[d] = {}
        for (let h = 0; h < 24; h++) {
            patterns[d][h] = { gapFOH: 0, gapBOH: 0, samples: 0, overFOH: 0, overBOH: 0, underFOH: 0, underBOH: 0 }
        }
    })

    // Process each day in range
    const startD = new Date(startDate)
    const endD = new Date(endDate)

    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0]
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })

        const mySales = salesByDate[dateStr]
        const myPunches = allPunches.filter(p => p.business_date === dateStr)

        if (!mySales) continue // Closed or missing data

        // Analyze key hours (11am to 10pm)
        for (let h = 11; h <= 22; h++) {
            const hourSales = Number(mySales.sales[h] || 0)
            const hourTix = Number(mySales.tickets[h] || 0)

            if (hourSales === 0) continue

            // REQUIRED STAFF (Ideal)
            let idealCooks = Math.ceil(hourSales / RULES.KITCHEN_DOLLARS_PER_HEAD)
            if (idealCooks < RULES.MIN_COOKS) idealCooks = RULES.MIN_COOKS

            let idealCashiers = Math.ceil(hourTix / RULES.CASHIER_TICKETS_PER_HEAD)
            if (idealCashiers < RULES.MIN_CASHIERS) idealCashiers = RULES.MIN_CASHIERS

            // 4b. Count Actual Staff (Robust Timezone Logic)
            let actualCooks = 0
            let actualCashiers = 0

            // Helper to get local hour 0-23
            const toLocalHour = (dStr: string) => {
                const d = new Date(dStr)
                // Use IANA Timezone to get correct hour regardless of DST
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles',
                    hour: 'numeric',
                    hour12: false
                }).formatToParts(d)
                const hPart = parts.find(p => p.type === 'hour')
                return hPart ? parseInt(hPart.value) : -1
            }

            myPunches.forEach(p => {
                if (!p.clock_out) return // Skip active/stuck punches for history analysis to be safe, or assume end of day? 
                // Actually, let's assume if no clock_out, they worked 8h. Or skip. 
                // Skip is safer for history.

                const inH = toLocalHour(p.clock_in)
                const outH = toLocalHour(p.clock_out)

                if (inH === -1 || outH === -1) return

                let isWorking = false

                // Simple range check handling midnight wrap
                if (outH < inH) {
                    // Overnight shift (e.g. 22:00 to 02:00)
                    // Working if H >= 22 OR H < 2
                    if (h >= inH || h < outH) isWorking = true
                } else {
                    // Normal shift (e.g. 10:00 to 18:00)
                    // Working if H >= 10 AND H < 18
                    if (h >= inH && h < outH) isWorking = true
                }

                if (isWorking) {
                    if (roleMap.FOH.includes(p.job_toast_guid)) actualCashiers++
                    if (roleMap.BOH.includes(p.job_toast_guid)) actualCooks++
                }
            })

            // Calculate Gap
            const gapCooks = actualCooks - idealCooks // Negative = Understaffed
            const gapCash = actualCashiers - idealCashiers

            // Debug first few
            // if (h === 19 && dayName === 'Friday' && Math.random() < 0.01) {
            //    console.log(`Debug Friday 7pm: Sales $${hourSales} -> Need ${idealCooks} Cooks. Have ${actualCooks}. Gap: ${gapCooks}`)
            // }

            const stats = patterns[dayName][h]
            stats.samples++
            stats.gapFOH += gapCash
            stats.gapBOH += gapCooks

            if (gapCooks < -1.5) stats.underBOH++ // Tolerance: Missing > 1.5 person
            if (gapCooks > 2.5) stats.overBOH++
            if (gapCash < -0.5) stats.underFOH++
            if (gapCash > 1.5) stats.overFOH++
        }
    }

    // GENERATE MARKDOWN REPORT (ESPAÑOL)
    let md = '# 🕵️ REPORTE FORENSE: AUDITORÍA DE PLANEACIÓN (Últimos 3 Meses)\n'
    md += '*Análisis basado en datos reales de Nov 2025 - Ene 2026 en Lynwood.*\n\n'
    md += 'Este reporte compara tu personal programado (Punches reales de Managers, Cajeros, Cocineros) vs. la demanda real de clientes.\n\n'

    md += '## 🚨 TOP 5: HORAS DE CRISIS (Falta Personal)\n'
    md += '*Momentos donde tu equipo está bajo presión extrema y el servicio corre peligro.*\n\n'
    md += '| Día | Hora | Faltan Cocineros | Faltan Cajeros | Frecuencia |\n'
    md += '|-----|------|------------------|----------------|------------|\n'

    // Check if patterns filled
    const allSlots: any[] = []
    Object.entries(patterns).forEach(([day, hours]) => {
        Object.entries(hours).forEach(([h, stat]) => {
            if (stat.samples < 5) return // Filter low sample
            allSlots.push({
                day, h,
                avgGapCook: stat.gapBOH / stat.samples,
                avgGapCash: stat.gapFOH / stat.samples,
                pctUnderBOH: (stat.underBOH / stat.samples) * 100,
                pctUnderFOH: (stat.underFOH / stat.samples) * 100
            })
        })
    })

    // Sort by worst BOH gap
    const worstBOH = [...allSlots].sort((a, b) => a.avgGapCook - b.avgGapCook).slice(0, 5)

    const translateDay = (d: string) => {
        const map: any = { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' }
        return map[d] || d
    }

    worstBOH.forEach(s => {
        md += `| **${translateDay(s.day)}** | ${s.h}:00 | **${s.avgGapCook.toFixed(1)}** | ${s.avgGapCash.toFixed(1)} | ${s.pctUnderBOH.toFixed(0)}% de las veces |\n`
    })

    md += '\n## 💸 TOP 5: HORAS DE DESPERDICIO (Sobra Personal)\n'
    md += '*Momentos donde estás pagando salarios innecesarios (baja venta, mucha gente).*\n\n'
    md += '| Día | Hora | Sobran Cocineros | Sobran Cajeros | Frecuencia |\n'
    md += '|-----|------|------------------|----------------|------------|\n'

    // Sort by Overstaffing (Higher positive gap)
    // Combined score? or just Cashier waste? Let's check Cashier waste since it was huge.
    // Or mostly BOH waste.
    const worstWaste = [...allSlots].sort((a, b) => (b.avgGapCash + b.avgGapCook) - (a.avgGapCash + a.avgGapCook)).slice(0, 5)

    worstWaste.forEach(s => {
        md += `| **${translateDay(s.day)}** | ${s.h}:00 | +${s.avgGapCook.toFixed(1)} | **+${s.avgGapCash.toFixed(1)}** | ${(s.avgGapCash > 1.5 ? 100 : 0)}% |\n`
    })

    // WEEKLY HEATMAP SUMMARY
    md += '\n## 📅 RESUMEN SEMANAL (Patrones)\n'
    md += 'Clave: 🟢 Bien, 🔴 Crisis (Falta gente), 🟡 Desperdicio (Sobra gente)\n\n'

    weekdays.forEach(day => {
        md += `### ${translateDay(day)}\n`
        let line = ''
        for (let h = 11; h <= 22; h++) {
            const s = patterns[day][h]
            if (s.samples === 0) continue
            const avg = s.gapBOH / s.samples
            const avgC = s.gapFOH / s.samples
            let icon = '🟢'

            // Logic for Icon
            if (avg < -1.5 || avgC < -1.0) icon = '🔴' // Crisis
            else if (avg > 2.0 || avgC > 2.0) icon = '🟡' // Waste

            line += `**${h}:00**: ${icon} (Coc:${avg.toFixed(1)} Caj:${avgC.toFixed(1)}) | `
        }
        md += line + '\n\n'
    })

    fs.writeFileSync('planning_audit_report.md', md)
    console.log('✅ Reporte en Español guardado en planning_audit_report.md')
}

runAnalysis()

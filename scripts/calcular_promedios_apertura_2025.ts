
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: '.env.local' })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Env Vars')
    process.exit(1)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// --- CONFIGURATION FROM route.ts (Production Source of Truth) ---
// dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const STORE_CLOSING_HOURS: Record<string, Record<number, number>> = {
    'Azusa': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 25, 6: 25 },
    'Bell': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },
    'Downey': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },
    'Hollywood': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },
    'Huntington': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 26, 5: 27, 6: 27 },
    'LA Broadway': { 0: 26, 1: 25, 2: 25, 3: 25, 4: 26, 5: 28, 6: 28 }, // Mon is 25 (1am)
    'LA Central': { 0: 26, 1: 26, 2: 26, 3: 26, 4: 27, 5: 28, 6: 28 },
    'La Puente': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },
    'Lynwood': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27 },
    'Norwalk': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },
    'Rialto': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 25, 5: 27, 6: 27 },
    'Santa Ana': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },
    'Slauson': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },
    'South Gate': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },
    'West Covina': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 }
}

const STORE_OPENING_HOURS: Record<string, number> = {
    'Azusa': 10, 'Bell': 10, 'Downey': 9, 'Hollywood': 9, 'Huntington': 10,
    'LA Broadway': 8, 'LA Central': 8, 'La Puente': 10, 'Lynwood': 9,
    'Norwalk': 9, 'Rialto': 9, 'Santa Ana': 10, 'Slauson': 10,
    'South Gate': 10, 'West Covina': 9
}

const DEFAULT_CLOSING_HOURS: Record<number, number> = {
    0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27
}
const DEFAULT_OPENING_HOUR = 9

function getStoreClosingHour(storeName: string, dayOfWeek: number): number {
    for (const [key, hours] of Object.entries(STORE_CLOSING_HOURS)) {
        if (storeName.includes(key)) {
            return hours[dayOfWeek] || DEFAULT_CLOSING_HOURS[dayOfWeek]
        }
    }
    return DEFAULT_CLOSING_HOURS[dayOfWeek]
}

function getStoreOpeningHour(storeName: string): number {
    for (const [key, hour] of Object.entries(STORE_OPENING_HOURS)) {
        if (storeName.includes(key)) {
            return hour
        }
    }
    return DEFAULT_OPENING_HOUR
}

const formatHour = (h: number) => {
    let hour = h;
    if (hour >= 24) hour -= 24;
    const ampm = hour >= 12 && hour < 24 ? 'PM' : 'AM';
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;
    return `${hour}:00 ${ampm}`;
}

async function run() {
    console.log('🚀 Calculando Promedios 2025 (Con Supervisores)...')

    // 1. Tiendas & Supervisores
    const { data: stores } = await supabase.from('stores')
        .select('external_id, name, supervisor_name')
        .eq('is_active', true)

    if (!stores) {
        console.error('❌ No se encontraron tiendas.')
        return
    }

    // Maps
    const storeMap = new Map(stores.map(s => [s.external_id, s.name]))
    // Clean supervisor names if null
    const supervisorMap = new Map(stores.map(s => [s.name, s.supervisor_name || 'Sin Supervisor']))

    console.log(`✅ ${stores.length} tiendas cargadas.`)

    // 2. Descargar Datos
    let allSales: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    console.log('📥 Descargando datos...')
    // Increase timeout or something? No, standard fetch.
    while (hasMore) {
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('business_date, store_id, hourly_data')
            .gte('business_date', '2025-01-01')
            .lte('business_date', '2025-12-31')
            .order('business_date')
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error('❌ Error fetching sales:', error)
            break
        }

        if (!data || data.length === 0) {
            hasMore = false
        } else {
            allSales = allSales.concat(data)
            process.stdout.write(`\r   Registros: ${allSales.length}`)
            if (data.length < pageSize) hasMore = false
            page++
        }
    }
    console.log(`\n✅ ${allSales.length} registros totales.`)

    // 3. Accumulators
    const stats = new Map<string, Map<number, any>>()

    for (const record of allSales) {
        const storeName = storeMap.get(record.store_id)
        if (!storeName) continue

        if (!stats.has(storeName)) {
            const m = new Map()
            for (let d = 0; d < 7; d++) m.set(d, { openSum: 0, openCount: 0, closeSum: 0, closeCount: 0 })
            stats.set(storeName, m)
        }

        // Get Day Index
        const parts = record.business_date.split('-');
        // UTC Date
        const date = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
        const dayIdx = date.getUTCDay();

        const dayStats = stats.get(storeName)!.get(dayIdx)

        const openHour = getStoreOpeningHour(storeName)
        const closeHourRaw = getStoreClosingHour(storeName, dayIdx)

        const hourly = record.hourly_data || {}

        const openSale = Number(hourly[openHour.toString()] || 0)

        // Key logic: (Close - 1) % 24
        const closeKey = ((closeHourRaw - 1) % 24).toString()
        const closeSale = Number(hourly[closeKey] || 0)

        if (openSale > 0) {
            dayStats.openSum += openSale
            dayStats.openCount++
        }

        if (closeSale > 0) {
            dayStats.closeSum += closeSale
            dayStats.closeCount++
        }
    }

    // 4. Output
    console.log('\n--- GUARDANDO CSV ---')
    // USING SEMICOLON DELIMITER
    let csvContent = `Tienda;Supervisor;Dia;HoraApertura;VentasApertura;HoraCierre;VentasCierre\n`;

    const sortedStoreNames = Array.from(stats.keys()).sort()

    for (const store of sortedStoreNames) {
        const daysMap = stats.get(store)!
        const dayOrder = [1, 2, 3, 4, 5, 6, 0] // Mon-Sun
        const openConfig = getStoreOpeningHour(store)
        const supervisor = supervisorMap.get(store)

        for (const dayIdx of dayOrder) {
            const s = daysMap.get(dayIdx)
            const avgOpen = s.openCount > 0 ? s.openSum / s.openCount : 0
            const avgClose = s.closeCount > 0 ? s.closeSum / s.closeCount : 0
            const closeH = getStoreClosingHour(store, dayIdx)

            csvContent += `${store};${supervisor};${DAYS[dayIdx]};${formatHour(openConfig)};${avgOpen.toFixed(2)};${formatHour(closeH)};${avgClose.toFixed(2)}\n`
        }
    }

    const outPath = path.resolve('docs', 'promedios_apertura_cierre_2025_con_supervisor.csv')
    try {
        fs.writeFileSync(outPath, csvContent)
        console.log(`✅ CSV guardado exitosamente en: ${outPath}`)
    } catch (err) {
        console.error('❌ Error escribiendo archivo:', err)
    }
}

run().catch(e => console.error('BIG ERROR:', e))

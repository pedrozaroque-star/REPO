
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Cargar variables de entorno
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runAnalysis() {
    console.log('🚀 Iniciando Análisis de Ventas 2025 (Apertura/Cierre)...')

    // 1. Obtener todas las tiendas
    const { data: stores } = await supabase
        .from('stores')
        .select('external_id, name')
        .eq('is_active', true)

    if (!stores) {
        console.error('❌ No se encontraron tiendas.')
        return
    }

    const storeMap = new Map(stores.map(s => [s.external_id, s.name]))
    console.log(`✅ ${stores.length} tiendas cargadas.`)

    // 2. Obtener datos de ventas 2025
    // Paginación para no saturar memoria (aunque son ~5000 registros, es manejable, pero mejor prevenir)
    let allSales: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        console.log(`📥 Descargando página ${page + 1}...`)
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('business_date, store_id, hourly_data')
            .gte('business_date', '2025-01-01')
            .lte('business_date', '2025-12-31')
            .order('business_date', { ascending: true })
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error('❌ Error fetching sales:', error)
            break
        }

        if (data.length < pageSize) hasMore = false
        allSales = allSales.concat(data)
        page++
    }

    console.log(`📊 ${allSales.length} registros de ventas procesados.`)

    // 3. Procesar y Generar CSV
    const csvHeader = 'Store,Date,DayOfWeek,FirstHour,FirstHourSales,LastHour,LastHourSales\n'
    let csvContent = csvHeader

    // Helper para formatear hora (0-29)
    const formatHour = (h: number) => {
        let hour = h
        const ampm = hour >= 12 && hour < 24 ? 'PM' : 'AM'
        if (hour > 12) hour -= 12
        if (hour === 0) hour = 12 // Medianoche
        if (hour > 12) hour -= 12 // Madrugada (25 -> 1 AM)
        return `${hour}:00 ${ampm}`
    }

    // Helper para obtener día de semana
    const getDayOfWeek = (dateStr: string) => {
        const d = new Date(dateStr)
        // Ajuste por UTC (Business Date es string YYYY-MM-DD, al hacer new Date asume UTC 00:00)
        // Para obtener el día correcto, aseguramos que se interprete como local o UTC consistente
        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
        return days[d.getUTCDay()]
    }

    let count = 0

    const analysisSummary: any = {} // Para mostrar en consola

    for (const record of allSales) {
        const storeName = storeMap.get(record.store_id)
        if (!storeName) continue

        const hourly = record.hourly_data || {}
        const hoursWithSales = Object.entries(hourly)
            .map(([h, sales]) => ({ hour: parseInt(h), sales: Number(sales) }))
            .filter(h => h.sales > 0)
            .sort((a, b) => a.hour - b.hour)

        if (hoursWithSales.length === 0) continue

        const first = hoursWithSales[0]
        const last = hoursWithSales[hoursWithSales.length - 1]

        // CSV Line
        const line = `${storeName},${record.business_date},${getDayOfWeek(record.business_date)},${formatHour(first.hour)},${first.sales.toFixed(2)},${formatHour(last.hour)},${last.sales.toFixed(2)}\n`
        csvContent += line
        count++

        // Guardar resumen (promedio por tienda)
        if (!analysisSummary[storeName]) analysisSummary[storeName] = {
            firstSalesSum: 0, lastSalesSum: 0, count: 0,
            earliestOpen: 24, latestClose: 0
        }

        analysisSummary[storeName].firstSalesSum += first.sales
        analysisSummary[storeName].lastSalesSum += last.sales
        analysisSummary[storeName].count++
        analysisSummary[storeName].earliestOpen = Math.min(analysisSummary[storeName].earliestOpen, first.hour)
        analysisSummary[storeName].latestClose = Math.max(analysisSummary[storeName].latestClose, last.hour)
    }

    // 4. Escribir archivo
    const outputPath = path.resolve(process.cwd(), 'docs', 'ventas_apertura_cierre_2025.csv')
    fs.writeFileSync(outputPath, csvContent)

    console.log(`✅ Reporte generado en: ${outputPath}`)
    console.log(`📈 Total días analizados: ${count}`)

    console.log('\n--- RESUMEN PROMEDIO 2025 ---')
    Object.entries(analysisSummary).forEach(([store, stats]: [string, any]) => {
        const avgFirst = (stats.firstSalesSum / stats.count).toFixed(2)
        const avgLast = (stats.lastSalesSum / stats.count).toFixed(2)
        console.log(`${store}: Apertura Promedio $${avgFirst} | Cierre Promedio $${avgLast}`)
    })
}

runAnalysis().catch(console.error)

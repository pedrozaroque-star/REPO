
import { getSupabaseClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode')

    // ----------- MODO AÑOS DISPONIBLES -----------
    if (mode === 'years') {
        try {
            const supabase = await getSupabaseClient()
            const currentY = new Date().getFullYear()
            const promises = []
            // Escanear desde 2018 hasta año actual + 1
            for (let y = currentY + 1; y >= 2018; y--) {
                promises.push(
                    supabase.from('sales_daily_cache')
                        .select('id')
                        .gte('business_date', `${y}-01-01`)
                        .lte('business_date', `${y}-12-31`)
                        .limit(1)
                        .then(({ data }) => ({ year: y, exists: data && data.length > 0 }))
                )
            }
            const results = await Promise.all(promises)
            const years = results.filter(r => r.exists).map(r => r.year)
            return NextResponse.json(years)
        } catch (e: any) {
            return NextResponse.json({ error: e.message }, { status: 500 })
        }
    }

    // ----------- MODO REPORTE ANUAL (MATRIX) -----------
    const year = searchParams.get('year') || new Date().getFullYear().toString()
    const limitDateParam = searchParams.get('limit_date') // YYYY-MM-DD opcional
    const limitDate = limitDateParam ? new Date(limitDateParam) : null

    try {
        const supabase = await getSupabaseClient()
        const storeMap: Record<string, number[]> = {}
        const initMonths = () => Array(12).fill(0)

        const monthPromises = []

        for (let m = 0; m < 12; m++) {
            const startDate = new Date(Number(year), m, 1)
            const lastDayOfMonth = new Date(Number(year), m + 1, 0)

            // Si hay límite y el mes empieza DESPUÉS del límite, saltar
            if (limitDate && startDate > limitDate) {
                // Promesa vacía resuelta para mantener el índice del array
                monthPromises.push(Promise.resolve({ data: [], error: null }))
                continue
            }

            // Si hay límite y el límite cae ADENTRO de este mes, cortar la fecha fin
            let endDate = lastDayOfMonth
            if (limitDate && limitDate < lastDayOfMonth && limitDate >= startDate) {
                endDate = limitDate
            }

            const startStr = startDate.toISOString().split('T')[0]
            const endStr = endDate.toISOString().split('T')[0]

            const p = supabase
                .from('sales_daily_cache')
                .select('store_name, business_date, net_sales')
                .gte('business_date', startStr)
                .lte('business_date', endStr)
                .limit(2000)

            monthPromises.push(p)
        }

        // Ejecutar las 12 peticiones en paralelo (muy rápido en infraestructura server)
        const results = await Promise.all(monthPromises)

        let totalRowsFetched = 0

        // Procesar los 12 resultados
        results.forEach((chunk, monthIdx) => {
            if (chunk.error) {
                console.error(`❌ Error fetching Month ${monthIdx + 1}:`, chunk.error.message)
                return
            }

            const rows = chunk.data || []
            totalRowsFetched += rows.length

            rows.forEach(row => {
                const storeName = row.store_name?.trim() || 'Unknown'
                // Ya sabemos el mes por el índice del chunk (monthIdx), 
                // no hace falta parsear la fecha, lo cual es más seguro aún.
                const targetMonthIndex = monthIdx

                if (!storeMap[storeName]) {
                    storeMap[storeName] = initMonths()
                }

                // Sumar venta
                storeMap[storeName][targetMonthIndex] += Number(row.net_sales || 0)
            })
        })

        // Formatear para Frontend y Filtrar Mocks
        const result = Object.entries(storeMap)
            .map(([name, months]) => {
                const total = months.reduce((a, b) => a + b, 0)
                return { name, months, total }
            })
            .filter(r => {
                const n = r.name.toLowerCase()
                // Lista negra de palabras clave de mocks
                if (n.includes('mock')) return false
                if (n.includes('test')) return false
                if (n.includes('example')) return false
                if (n === 'unknown') return false
                // Si tienes nombres específicos de mocks de Toast, agrégalos aquí
                return true
            })
            .sort((a, b) => b.total - a.total)

        return NextResponse.json({
            data: result,
            meta: {
                strategy: 'parallel_monthly_fetch',
                year,
                totalRowsFetched,
                timestamp: new Date().toISOString()
            }
        })

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

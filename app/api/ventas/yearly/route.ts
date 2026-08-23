/**
 * @module api/ventas/yearly/route
 * @description Provides annual monthly sales matrix aggregating 12-month net sales per store from Supabase sales_daily_cache, and provides list of available historical years.
 * @businessRules
 * - Enforces authentication and authorization for admin, supervisor, and manager roles.
 * - Pure calendar arithmetic prevents timezone date drift on UTC servers.
 * - Filters out mock, test, and placeholder stores from analytics.
 * @dataFlow
 * - Client -> GET /api/ventas/yearly -> Supabase sales_daily_cache -> Formatted JSON matrix.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        // 🛡️ SECURITY CHECK 🛡️
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })

        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
        const user = verifyAuthToken(token)
        if (!user) return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        // ✅ AUTH SUCCESS
        const { searchParams } = new URL(request.url)
        const mode = searchParams.get('mode')

        // ----------- MODO AÑOS DISPONIBLES -----------
        if (mode === 'years') {
            const supabase = await getSupabaseAdminClient()
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
        }

        // ----------- MODO REPORTE ANUAL (MATRIX) -----------
        const year = searchParams.get('year') || new Date().getFullYear().toString()
        const limitDateParam = searchParams.get('limit_date') // YYYY-MM-DD opcional
        const limitDate = limitDateParam ? new Date(limitDateParam) : null

        const supabase = await getSupabaseAdminClient()
        const storeMap: Record<string, number[]> = {}
        const initMonths = () => Array(12).fill(0)

        const monthPromises = []

        for (let m = 0; m < 12; m++) {
            const monthPad = String(m + 1).padStart(2, '0')
            const startDate = new Date(Number(year), m, 1)
            const lastDayOfMonth = new Date(Number(year), m + 1, 0)

            // Si hay límite y el mes empieza DESPUÉS del límite, saltar
            if (limitDate && startDate > limitDate) {
                monthPromises.push(Promise.resolve({ data: [], error: null }))
                continue
            }

            const startStr = `${year}-${monthPad}-01`
            let endDay = String(lastDayOfMonth.getDate()).padStart(2, '0')
            
            // Si el límite cae adentro del mes
            if (limitDate && limitDate < lastDayOfMonth && limitDate >= startDate) {
                endDay = String(limitDate.getDate()).padStart(2, '0')
            }
            const endStr = `${year}-${monthPad}-${endDay}`

            const p = supabase
                .from('sales_daily_cache')
                .select('store_name, business_date, net_sales')
                .gte('business_date', startStr)
                .lte('business_date', endStr)
                .limit(2000)

            monthPromises.push(p)
        }

        // Ejecutar las 12 peticiones en paralelo
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
                const targetMonthIndex = monthIdx

                if (!storeMap[storeName]) {
                    storeMap[storeName] = initMonths()
                }

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
                if (n.includes('mock')) return false
                if (n.includes('test')) return false
                if (n.includes('example')) return false
                if (n === 'unknown') return false
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
        console.error("Yearly Sales API Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

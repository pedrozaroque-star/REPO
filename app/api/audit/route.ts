/**
 * @module app/api/audit/route
 * @description Endpoint administrativo de diagnóstico que devuelve conteos globales de tablas principales (`users`, `stores`, `inspections`, `sales_daily_cache` por año).
 *
 * @businessRules
 * - Acceso exclusivo para `admin`, `supervisor` o invocación interna autorizada (`CRON_SECRET`).
 *
 * @dataFlow
 * - Admin / Cron -> `GET /api/audit` -> `verifyStaffAuth` -> conteos HEAD en Supabase -> respuesta JSON.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` Fail-Closed.
 */
import { getSupabaseClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const supabase = await getSupabaseClient()

        // 1. Usuarios
        const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true })

        // 2. Tiendas
        const { count: storesCount } = await supabase.from('stores').select('*', { count: 'exact', head: true })

        // 3. Inspecciones
        const { count: inspCount } = await supabase.from('inspections').select('*', { count: 'exact', head: true })

        // 4. Ventas por Año (Aproximado por primeros 4 chars)
        // No podemos hacer group by complejo via SDK facilmente, regresamos total raw
        const { count: salesCount } = await supabase.from('sales_daily_cache').select('*', { count: 'exact', head: true })

        // Muestreo para ver años (usamos rpc si existiera, pero haremos un distinct manual pequeño o count por rangos)
        const years = [2020, 2021, 2022, 2023, 2024, 2025]
        const salesByYear: Record<string, number> = {}

        for (const y of years) {
            const { count } = await supabase.from('sales_daily_cache')
                .select('*', { count: 'exact', head: true })
                .gte('business_date', `${y}-01-01`)
                .lte('business_date', `${y}-12-31`)
            salesByYear[y] = count || 0
        }

        return NextResponse.json({
            users: usersCount,
            stores: storesCount,
            inspections: inspCount,
            total_sales_records: salesCount,
            sales_progress: salesByYear
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

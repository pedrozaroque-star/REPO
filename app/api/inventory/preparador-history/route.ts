/**
 * @module preparador-history
 * @description API endpoint que consulta el promedio histórico de consumo de carnes e insumos
 *   agrupados por intervalo de 30 minutos y día de la semana (DOW).
 * @businessRules
 *   - Day of Week (DOW): 1=Lunes, 2=Martes ... 7=Domingo (ISO DOW).
 *   - Utiliza RPC get_meat_history_avg para cálculo en base de datos.
 * @dataFlow meat_consumption_history -> RPC get_meat_history_avg -> JSON response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const dow = searchParams.get('dow') // 1 (Monday) to 7 (Sunday)
        
        if (!storeId || !dow) {
            return NextResponse.json({ error: 'Missing storeId or dow' }, { status: 400 })
        }

        const parsedDow = parseInt(dow, 10)
        if (isNaN(parsedDow) || parsedDow < 1 || parsedDow > 7) {
            return NextResponse.json({ error: 'Invalid dow parameter (must be 1-7)' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()
        
        const { data, error } = await supabase.rpc('get_meat_history_avg', {
            p_store_id: storeId,
            p_dow: parsedDow
        })
        
        if (error) {
            console.warn("RPC get_meat_history_avg error:", error.message)
            return NextResponse.json([])
        }

        return NextResponse.json(data || [])
        
    } catch (e: any) {
        console.error("Error in preparador-history API:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

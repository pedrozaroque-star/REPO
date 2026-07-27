/**
 * @module api/inventory/anomalies
 * @description API para leer y resolver anomalías de Food Cost.
 *
 * @businessRules
 * - GET: Retorna anomalías no resueltas ordenadas por severidad y fecha.
 * - PATCH: Marca una anomalía como resuelta (resolved=true).
 *
 * @dataFlow
 * - Lee de: food_cost_anomalies
 * - Escribe en: food_cost_anomalies (solo campo resolved/resolved_at)
 *
 * @notes
 * - [2026-07-27] Creado para complementar la Capa B (cron anomaly detection).
 *   El cron escribe anomalías y este endpoint las sirve al dashboard.
 */
import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET() {
    const supabase = await getSupabaseAdminClient()

    const { data, error } = await supabase
        .from('food_cost_anomalies')
        .select('*')
        .eq('resolved', false)
        .order('severity', { ascending: true })  // critical first
        .order('business_date', { ascending: false })
        .limit(20)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
    const supabase = await getSupabaseAdminClient()
    const { id } = await request.json()

    if (!id) {
        return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const { error } = await supabase
        .from('food_cost_anomalies')
        .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolved_by: 'manual'
        })
        .eq('id', id)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}

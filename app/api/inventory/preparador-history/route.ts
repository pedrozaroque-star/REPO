import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const dow = searchParams.get('dow') // 1 (Monday) to 7 (Sunday)
        
        // We will fetch all intervals for this DOW to draw a timeline, 
        // or just the current and next few. Fetching all intervals is better for UX.
        
        if (!storeId || !dow) {
            return NextResponse.json({ error: 'Missing storeId or dow' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()
        
        // Unfortunately PostgREST via JS client doesn't support grouping natively without RPC if we want complex AVG.
        // But since we can query all data for a specific store and specific DOW, we can aggregate in memory.
        // Usually, 3 years = ~150 weeks. 150 weeks * 15 hours * 2 intervals * 5 meats = ~22,000 rows.
        // That's a bit heavy to pull. We should use an RPC, or just let PostgREST filter and do math here.
        // Let's create an RPC or just send a raw query. We don't have access to execute raw SQL from the JS client directly.
        // Wait, we can fetch the view or create an RPC in the SQL migration.
        
        // I'll define an RPC in the migration file. For now, I'll attempt a standard select 
        // and if it's too large, it might fail.

        // Actually, we can just create an RPC function. Let's assume the RPC exists or we will just fetch recent data.
        
         const { data, error } = await supabase.rpc('get_meat_history_avg', {
             p_store_id: storeId,
             p_dow: parseInt(dow)
         })
         
         if (error) {
             // Fallback: Si el usuario no ejecutó el SQL del RPC, bajamos en memoria los ultimos 6 meses para no romper.
             console.warn("RPC failed, falling back to memory aggregation:", error.message)
             
             const sixMonthsAgo = new Date()
             sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
             const dStr = sixMonthsAgo.toISOString().split('T')[0]
             
             const { data: rawData, error: rErr } = await supabase
                .from('meat_consumption_history')
                .select('interval_start, meat_type, raw_lbs')
                .eq('store_id', storeId)
                .gte('business_date', dStr)
                
            if (rErr) throw rErr
            
            // Note: In fallback, we just pull everything and we don't DOW filter at DB level because PostgREST doesn't support EXTRACT natively directly in select without views.
            // Wait, we CAN filter DOW via a generated column, but we don't have one.
            // Returning rawData and let client figure it out is too much.
            // I'll build the RPC in the SQL file!
            return NextResponse.json({ error: 'Please apply the new SQL Migration containing get_meat_history_avg function.' }, { status: 400 })
         }

        return NextResponse.json(data)
        
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

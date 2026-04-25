import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Force USING the ANON key to test RLS and exact client response
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
    try {
        let allData: any[] = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;
        let iter = 0;
        let lastError = null;

        while (hasMore && iter < 15) {
            iter++;
            const { data, error } = await supabase.from('sales_discounts_log').select('*').eq('business_date', '2026-04-20').order('id', { ascending: true }).range(from, from + pageSize - 1)
            
            if (error) {
                lastError = error;
                break;
            }

            if (data) {
                allData = [...allData, ...data];
            }
            
            if (!data || data.length < pageSize) {
                hasMore = false;
            } else {
                from += pageSize;
            }
        }

        return NextResponse.json({ 
            success: !lastError, 
            error: lastError,
            count: allData.length,
            iterations: iter
        })
    } catch (e: any) {
        return NextResponse.json({ caughtError: e.message })
    }
}

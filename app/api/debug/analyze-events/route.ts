import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET() {
    try {
        const supabase = await getSupabaseClient()

        // Define Test Events (2025 Dates) vs Control Dates (1 week prior)
        const events = [
            { name: 'Super Bowl', date: '2025-02-09', control: '2025-02-02' },
            { name: 'Valentines', date: '2025-02-14', control: '2025-02-07' },
            { name: 'St Patricks', date: '2025-03-17', control: '2025-03-10' },
            { name: 'Cinco de Mayo', date: '2025-05-05', control: '2025-04-28' },
            { name: 'Mothers Day', date: '2025-05-11', control: '2025-05-04' },
            { name: 'Memorial Day', date: '2025-05-26', control: '2025-05-19' },
            { name: 'Fathers Day', date: '2025-06-15', control: '2025-06-08' },
            { name: 'July 4th', date: '2025-07-04', control: '2025-06-27' },
            { name: 'Labor Day', date: '2025-09-01', control: '2025-08-25' },
            { name: 'Halloween', date: '2025-10-31', control: '2025-10-24' }
        ]

        const results = []

        for (const evt of events) {
            // Fetch Event Sales (Sum across all stores for broader signal)
            const { data: eventData } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('business_date', evt.date)

            const totalEventSales = eventData?.reduce((sum, row) => sum + (Number(row.net_sales) || 0), 0) || 0

            // Fetch Control Sales
            const { data: controlData } = await supabase
                .from('sales_daily_cache')
                .select('net_sales')
                .eq('business_date', evt.control)

            const totalControlSales = controlData?.reduce((sum, row) => sum + (Number(row.net_sales) || 0), 0) || 0

            // Calculate Multiplier
            let multiplier = 1.0
            if (totalControlSales > 0 && totalEventSales > 0) {
                multiplier = totalEventSales / totalControlSales
            }

            results.push({
                name: evt.name,
                date2025: evt.date,
                sales: Math.round(totalEventSales),
                controlDate: evt.control,
                controlSales: Math.round(totalControlSales),
                calculatedMultiplier: parseFloat(multiplier.toFixed(2))
            })
        }

        return NextResponse.json({ success: true, analysis: results })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

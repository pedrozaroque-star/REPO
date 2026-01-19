import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams

        const storeIds = searchParams.get('storeIds') || 'all'
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const groupBy = (searchParams.get('groupBy') as any) || 'day'

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: 'Missing startDate or endDate' },
                { status: 400 }
            )
        }

        const options: ToastMetricsOptions = {
            storeIds,
            startDate,
            endDate,
            groupBy
        }

        // Logic "Granularity Guard"
        // If range > 60 days and groupBy is 'day', suggest 'week'
        const start = new Date(startDate)
        const end = new Date(endDate)
        const dayDiff = (end.getTime() - start.getTime()) / (1000 * 3600 * 24)

        let effectiveGroupBy = groupBy
        if (dayDiff > 60 && groupBy === 'day') {
            effectiveGroupBy = 'week'
            // We could auto-switch, but for now we just process what is asked 
            // or we could force it: options.groupBy = 'week'
        }

        const { rows, connectionError } = await fetchToastData(options)

        return NextResponse.json({
            meta: {
                requestedGroupBy: groupBy,
                effectiveGroupBy: effectiveGroupBy,
                totalRows: rows.length,
                connectionError // Pass error to frontend
            },
            data: rows
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json(
            {
                error: 'Internal Server Error',
                details: error.message,
                _debug_stack: error.stack
            },
            { status: 500 }
        )
    }
}

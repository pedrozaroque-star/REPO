import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'
import { verifyAuthToken } from '@/lib/auth-server'

export async function GET(request: NextRequest) {
    try {
        // 🛡️ SECURITY CHECK 🛡️
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')

        // 1. Validate Token (Manual JWT Verify)
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        // 2. Validate Role (Admin Only)
        // Check the 'user_role' claim inside the token directly! 
        // Logic: Our /api/login embeds 'user_role' in the JWT.
        if (user.user_role !== 'admin' && user.user_role !== 'supervisor') {
            return NextResponse.json({ error: 'Forbidden: Admins & Supervisors Only' }, { status: 403 })
        }

        // ✅ AUTH SUCCESS - PROCEED


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

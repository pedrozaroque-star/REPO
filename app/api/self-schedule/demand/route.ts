import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateSmartForecast } from '@/lib/intelligence'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { getLeadershipAvailability, LeadershipByShift, getDefaultLeadership } from '@/lib/leadership-availability'

/**
 * GET /api/self-schedule/demand?weekStart=YYYY-MM-DD&storeId=xxx
 * Returns hourly demand projections for the Demand Map visualization
 */
export async function GET(request: NextRequest) {
    try {
        // 🛡️ AUTH CHECK - Admin/Manager only
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor') {
            return NextResponse.json({ error: 'Forbidden: Admin/Manager only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const weekStart = searchParams.get('weekStart')
        const storeId = searchParams.get('storeId')

        if (!weekStart || !storeId) {
            return NextResponse.json({ error: 'Missing weekStart or storeId' }, { status: 400 })
        }

        // Get store info
        const { data: store } = await supabaseAdmin
            .from('stores')
            .select('external_id, name, opening_time, closing_time, weekly_hours')
            .eq('external_id', storeId)
            .single()

        if (!store) {
            return NextResponse.json({ error: 'Store not found' }, { status: 404 })
        }

        /**
         * Helper: Parse time string to unbounded hour (e.g. 01:00 -> 25)
         */
        function parseTimeUnbounded(timeStr: string | null): number {
            if (!timeStr) return 24; // Default midnight
            const [hStr] = timeStr.split(':');
            let h = parseInt(hStr, 10);
            if (h >= 0 && h <= 5) h += 24;
            return h;
        }

        // Calculate dynamic opening hour
        const openVal = parseTimeUnbounded(store.opening_time)
        const openHour = openVal > 24 ? openVal - 24 : openVal
        const prepHour = openHour - 1

        /**
         * Get closing hour dynamically from DB config
         */
        /**
         * Get closing hour dynamically from DB config
         */
        function getStoreClosingHour(currentStore: any, dayOfWeek: number): number {
            if (currentStore.weekly_hours && Array.isArray(currentStore.weekly_hours)) {
                // weekly_hours uses day: 0-6
                const dayConfig = currentStore.weekly_hours.find((d: any) => d.day === dayOfWeek)
                if (dayConfig && dayConfig.close) {
                    return parseTimeUnbounded(dayConfig.close)
                }
            }
            // Fallback
            return parseTimeUnbounded(currentStore.closing_time)
        }

        // Fetch dynamic leadership availability for this store
        let leadership: LeadershipByShift
        try {
            const { byShift } = await getLeadershipAvailability(store.external_id, supabaseAdmin)
            leadership = byShift
        } catch (e) {
            console.warn('Failed to get leadership availability, using defaults')
            leadership = getDefaultLeadership()
        }

        // Generate forecast for each day of the week
        const weekStartDate = parseISO(weekStart)
        const days: {
            date: string
            hours: { hour: number; required_kitchen: number; required_foh: number; projected_sales: number }[]
            prepHour: number  // Changed from openHour - shows when prep/first shift starts
            closeHour: number
        }[] = []

        for (let i = 0; i < 7; i++) {
            const date = addDays(weekStartDate, i)
            const dateStr = format(date, 'yyyy-MM-dd')
            const dayOfWeek = date.getDay() // 0=Sun, 1=Mon, etc.
            const closeHour = getStoreClosingHour(store, dayOfWeek)

            try {
                const forecast = await generateSmartForecast(store.external_id, dateStr)

                if (forecast && forecast.hours) {
                    days.push({
                        date: dateStr,
                        hours: forecast.hours.map(h => ({
                            hour: h.hour,
                            required_kitchen: h.required_kitchen || 0,
                            required_foh: h.required_foh || 0,
                            projected_sales: h.projected_sales || 0
                        })),
                        prepHour,
                        closeHour
                    })
                } else {
                    // No forecast available - push empty day
                    days.push({
                        date: dateStr,
                        hours: [],
                        prepHour,
                        closeHour
                    })
                }
            } catch (e) {
                console.warn(`Failed to get forecast for ${dateStr}:`, e)
                days.push({
                    date: dateStr,
                    hours: [],
                    prepHour,
                    closeHour
                })
            }
        }

        return NextResponse.json({
            success: true,
            storeName: store.name,
            storeId: store.external_id,
            weekStart,
            days,
            // Dynamic leadership availability by day and shift
            leadership: {
                am: leadership.am,
                pm: leadership.pm
            }
        })

    } catch (error: any) {
        console.error('Error fetching demand data:', error)
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
    }
}

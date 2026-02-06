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
            .select('external_id, name, opening_time, closing_time')
            .eq('external_id', storeId)
            .single()

        if (!store) {
            return NextResponse.json({ error: 'Store not found' }, { status: 404 })
        }

        // Store opening hours (used for prep calculation)
        const STORE_OPENING_HOURS: Record<string, number> = {
            'Azusa': 10,        // Opens 10AM
            'Bell': 10,         // Opens 10AM
            'Downey': 9,        // Opens 9AM
            'Hollywood': 9,     // Opens 9AM
            'Huntington': 10,   // Opens 10AM
            'LA Broadway': 8,   // Opens 8AM
            'LA Central': 8,    // Opens 8AM
            'La Puente': 10,    // Opens 10AM
            'Lynwood': 9,       // Opens 9AM
            'Norwalk': 9,       // Opens 9AM
            'Rialto': 9,        // Opens 9AM
            'Santa Ana': 10,    // Opens 10AM
            'Slauson': 10,      // Opens 10AM
            'South Gate': 10,   // Opens 10AM
            'West Covina': 9    // Opens 9AM
        }

        function getStoreOpeningHour(storeName: string): number {
            for (const [key, hour] of Object.entries(STORE_OPENING_HOURS)) {
                if (storeName.toLowerCase().includes(key.toLowerCase())) {
                    return hour
                }
            }
            return 9 // Default 9AM
        }

        const openHour = getStoreOpeningHour(store.name)
        const prepHour = openHour - 1  // Prep starts 1 hour before opening

        // Store-specific closing hours by day of week
        // dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
        // Hours > 24 = next day (25 = 1AM, 26 = 2AM, etc.)
        const STORE_CLOSING_HOURS: Record<string, Record<number, number>> = {
            'Azusa': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 25, 6: 25 },
            'Bell': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },
            'Downey': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },
            'Hollywood': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },
            'Huntington': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 26, 5: 27, 6: 27 },
            'LA Broadway': { 0: 26, 1: 25, 2: 25, 3: 25, 4: 26, 5: 28, 6: 28 },
            'LA Central': { 0: 26, 1: 26, 2: 26, 3: 26, 4: 27, 5: 28, 6: 28 },
            'La Puente': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },
            'Lynwood': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27 },
            'Norwalk': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },
            'Rialto': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 25, 5: 27, 6: 27 },
            'Santa Ana': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },
            'Slauson': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },
            'South Gate': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },
            'West Covina': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 }
        }

        const DEFAULT_CLOSING_HOURS: Record<number, number> = {
            0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27
        }

        function getStoreClosingHour(storeName: string, dayOfWeek: number): number {
            for (const [key, hours] of Object.entries(STORE_CLOSING_HOURS)) {
                if (storeName.toLowerCase().includes(key.toLowerCase())) {
                    return hours[dayOfWeek] ?? DEFAULT_CLOSING_HOURS[dayOfWeek]
                }
            }
            return DEFAULT_CLOSING_HOURS[dayOfWeek]
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
            const closeHour = getStoreClosingHour(store.name, dayOfWeek)

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

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateSmartForecast, CAPACITY_RULES } from '@/lib/intelligence'
import { addDays, format } from 'date-fns'
import { getLeadershipAvailability, getLeadersForDay, LeadershipByShift, getDefaultLeadership } from '@/lib/leadership-availability'

/**
 * POST /api/self-schedule/admin/generate
 * Admin publica una semana → Intelligence genera los TURNOS requeridos
 * 
 * CAMBIO: Ahora genera TURNOS COMPLETOS (AM/PM) en lugar de slots de 1 hora
 */
export async function POST(request: NextRequest) {
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

        // Allow ONLY admin and supervisor - NO managers
        if (!['admin', 'supervisor', 'administrador'].includes(user.user_role?.toLowerCase())) {
            return NextResponse.json({ error: 'Forbidden: Admin/Supervisor only' }, { status: 403 })
        }

        const body = await request.json()
        const { weekStart, storeIds, storeId, publish = false } = body

        // Support both storeId (singular) and storeIds (array)
        const targetStoreIds = storeId ? [storeId] : (storeIds || null)

        if (!weekStart) {
            return NextResponse.json({ error: 'Missing weekStart (YYYY-MM-DD)' }, { status: 400 })
        }

        // Parse week start and get all 7 days
        const weekStartDate = new Date(weekStart + 'T12:00:00')
        const dates: string[] = []
        for (let i = 0; i < 7; i++) {
            dates.push(format(addDays(weekStartDate, i), 'yyyy-MM-dd'))
        }

        // Get all stores with their operating hours
        let stores: { external_id: string; name: string; opening_time: string; closing_time: string }[] = []
        if (targetStoreIds && targetStoreIds.length > 0) {
            const { data } = await supabaseAdmin
                .from('stores')
                .select('external_id, name, opening_time, closing_time')
                .in('external_id', targetStoreIds)
            stores = data || []
        } else {
            const { data } = await supabaseAdmin
                .from('stores')
                .select('external_id, name, opening_time, closing_time')
                .eq('is_active', true)
            stores = data || []
        }

        if (stores.length === 0) {
            return NextResponse.json({ error: 'No stores found' }, { status: 400 })
        }

        // Preload leadership availability for all stores (dynamically from punch history)
        const leadershipByStore = new Map<string, LeadershipByShift>()
        console.log('🔍 Loading dynamic leadership availability for all stores...')
        for (const store of stores) {
            try {
                const { byShift } = await getLeadershipAvailability(store.external_id, supabaseAdmin)
                leadershipByStore.set(store.external_id, byShift)
            } catch (err) {
                console.warn(`⚠️ Failed to get leadership for ${store.name}, using defaults`)
                leadershipByStore.set(store.external_id, getDefaultLeadership())
            }
        }
        console.log(`✅ Leadership data loaded for ${leadershipByStore.size} stores`)

        // Load staffing configuration for all stores
        const { data: staffingConfigs } = await supabaseAdmin
            .from('store_staffing_config')
            .select('*')

        const staffingByStore = new Map<string, {
            kitchen: { am: number; pm: number };
            cashier: { am: number; pm: number };
        }>()

        for (const config of staffingConfigs || []) {
            if (!staffingByStore.has(config.store_id)) {
                staffingByStore.set(config.store_id, {
                    kitchen: { am: 4, pm: 5 },
                    cashier: { am: 4, pm: 5 }
                })
            }
            const storeConfig = staffingByStore.get(config.store_id)!
            if (config.position === 'kitchen') {
                storeConfig.kitchen[config.shift_type.toLowerCase() as 'am' | 'pm'] = config.headcount
            } else {
                storeConfig.cashier[config.shift_type.toLowerCase() as 'am' | 'pm'] = config.headcount
            }
        }
        console.log(`✅ Staffing config loaded for ${staffingByStore.size} stores`)

        /**
         * NEW APPROACH: Generate FIXED HEADCOUNT shifts with staggered entry times
         * 
         * Instead of calculating how many people based on demand, we:
         * 1. Use the configured headcount (e.g., 4 AM, 5 PM for kitchen)
         * 2. Create exactly that many shifts
         * 3. Use demand curve to STAGGER when each person enters/exits
         * 
         * This eliminates idle time while maintaining peak coverage.
         * 
         * HYBRID APPROACH (Feb 2026):
         * - Creates staggered base shifts for minimum coverage
         * - Adds extra spots during rush hours based on demand forecast
         */
        function generateHybridShifts(
            storeOpeningHour: number,
            closingHour: number,
            staffingConfig: { kitchen: { am: number; pm: number }; cashier: { am: number; pm: number } },
            forecastHours?: { hour: number; required_kitchen: number; required_foh: number }[],
            dayOfWeek?: number  // 0=Sun, 5=Fri, 6=Sat - for weekend extra staff
        ): {
            startHour: number;
            endHour: number;
            requiredKitchen: number;
            requiredFoh: number;
            shiftType: 'AM' | 'PM';
        }[] {
            const shifts: {
                startHour: number;
                endHour: number;
                requiredKitchen: number;
                requiredFoh: number;
                shiftType: 'AM' | 'PM';
            }[] = []

            const PM_START = 17  // 5:00 PM
            const PM_EARLY_START = 16  // 4:00 PM - PM can start early for overlap
            const AM_EXTENDED_END = 18  // 6:00 PM - AM can extend for overlap
            const MIN_SHIFT_HOURS = 6  // For cashiers
            const MAX_SHIFT_HOURS = 8  // For cashiers
            const KITCHEN_SHIFT_HOURS = 8  // AM Kitchen shifts are exactly 8 hours
            const washEndHour = closingHour + 1  // 1 hour after closing for wash

            // Helper: Find peak demand hour in a range
            const getPeakDemand = (startH: number, endH: number, type: 'kitchen' | 'foh') => {
                if (!forecastHours) return 0
                let peak = 0
                for (const h of forecastHours) {
                    const hour = h.hour >= 24 ? h.hour : h.hour
                    if (hour >= startH && hour < endH) {
                        const demand = type === 'kitchen' ? h.required_kitchen : h.required_foh
                        if (demand > peak) peak = demand
                    }
                }
                return peak
            }

            // ========== AM SHIFTS ==========
            const amKitchenCount = staffingConfig.kitchen.am
            const amCashierCount = staffingConfig.cashier.am

            // Check transition demand (4pm-6pm) to decide if AM should extend
            const transitionDemandAM = getPeakDemand(PM_EARLY_START, 18, 'kitchen')
            const amNeedsExtension = transitionDemandAM >= 3  // Extend AM if high transition demand
            const amEnd = amNeedsExtension ? AM_EXTENDED_END : PM_START  // 6pm or 5pm

            // Determine AM rush hour (usually 11am-1pm for lunch)
            const amRushStart = 11
            const amRushPeakKitchen = getPeakDemand(amRushStart, 14, 'kitchen')
            const amRushPeakCashier = getPeakDemand(amRushStart, 14, 'foh')

            // Create AM Kitchen shifts - all exactly 7 hours
            const amKitchenShifts: { start: number; end: number; count: number }[] = []
            let kitchenAssigned = 0

            // First person: PREP - starts 1 hour before opening for preparation
            if (kitchenAssigned < amKitchenCount) {
                const prepStart = storeOpeningHour - 1  // 8am for 9am opening
                amKitchenShifts.push({ start: prepStart, end: Math.min(prepStart + KITCHEN_SHIFT_HOURS, amEnd), count: 1 })
                kitchenAssigned++
            }

            // Second person: starts at store opening
            if (kitchenAssigned < amKitchenCount) {
                amKitchenShifts.push({ start: storeOpeningHour, end: Math.min(storeOpeningHour + KITCHEN_SHIFT_HOURS, amEnd), count: 1 })
                kitchenAssigned++
            }

            // Third person: staggered +1 hour
            if (kitchenAssigned < amKitchenCount) {
                amKitchenShifts.push({ start: storeOpeningHour + 1, end: Math.min(storeOpeningHour + 1 + KITCHEN_SHIFT_HOURS, amEnd), count: 1 })
                kitchenAssigned++
            }

            // Bridge crew: remaining staff work until PM takes over
            const bridgeCrewSize = Math.max(0, amKitchenCount - kitchenAssigned)
            if (bridgeCrewSize > 0) {
                const bridgeStart = storeOpeningHour + 2  // 11am for 9am opening
                const bridgeEnd = Math.min(bridgeStart + KITCHEN_SHIFT_HOURS, amEnd)
                amKitchenShifts.push({ start: bridgeStart, end: bridgeEnd, count: bridgeCrewSize })
                kitchenAssigned += bridgeCrewSize
            }

            // Convert to shift format
            for (const s of amKitchenShifts) {
                shifts.push({
                    startHour: s.start,
                    endHour: s.end,
                    requiredKitchen: s.count,
                    requiredFoh: 0,
                    shiftType: 'AM'
                })
            }

            // AM Cashiers: Improved stagger for better coverage
            // 1 cashier opens at 9am, then stagger 10am, 11am for lunch rush
            // WEEKEND BOOST: +1 extra cashier on Fri/Sat/Sun
            const isWeekend = dayOfWeek !== undefined && (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6)
            const weekendExtraCashier = isWeekend ? 1 : 0
            const totalAmCashiers = amCashierCount + weekendExtraCashier

            let cashierAssigned = 0
            for (let i = 0; i < totalAmCashiers; i++) {
                let start: number
                if (i === 0) {
                    // First cashier: OPENING at store opening (9am)
                    start = storeOpeningHour
                } else if (i === 1) {
                    // Second cashier: 10am
                    start = 10
                } else {
                    // Rest: 11am for lunch rush (including weekend extra)
                    start = amRushStart  // 11am
                }
                shifts.push({
                    startHour: start,
                    endHour: Math.min(start + MIN_SHIFT_HOURS, amEnd),
                    requiredKitchen: 0,
                    requiredFoh: 1,
                    shiftType: 'AM'
                })
                cashierAssigned++
            }

            // ========== PM SHIFTS ==========
            const pmKitchenCount = staffingConfig.kitchen.pm
            const pmCashierCount = staffingConfig.cashier.pm

            // Determine PM rush hours (usually 6pm-9pm for dinner)
            const pmRushStart = 18  // 6pm
            const pmRushEnd = 21    // 9pm
            const pmRushPeakKitchen = getPeakDemand(pmRushStart, pmRushEnd, 'kitchen')
            const pmRushPeakCashier = getPeakDemand(pmRushStart, pmRushEnd, 'foh')

            // Check transition demand (4pm-6pm) to decide if we need early PM start
            const transitionDemandKitchen = getPeakDemand(PM_EARLY_START, pmRushStart, 'kitchen')
            const needsEarlyPMStart = transitionDemandKitchen >= 3  // High transition demand

            // PM Kitchen shifts - REORDERED: Opening -> Rush -> Wash
            const pmKitchenShifts: { start: number; end: number; count: number }[] = []
            let pmKitchenAssigned = 0

            // 1. Opening crew FIRST: 2 people start at 4pm or 5pm based on demand
            const pmOpeningStart = needsEarlyPMStart ? PM_EARLY_START : PM_START
            const openingCrewSize = Math.min(2, pmKitchenCount)
            if (openingCrewSize > 0) {
                pmKitchenShifts.push({ start: pmOpeningStart, end: Math.min(pmOpeningStart + MAX_SHIFT_HOURS, closingHour), count: openingCrewSize })
                pmKitchenAssigned += openingCrewSize
            }

            // 2. Reserve 1 for wash crew
            const reservedForWash = 1
            const availableForRush = Math.max(0, pmKitchenCount - pmKitchenAssigned - reservedForWash)

            // 3. Rush crew: remaining staff (minus wash reserve) start at 6pm for dinner rush
            if (availableForRush > 0) {
                const rushStart = pmRushStart  // 6pm
                const rushEnd = Math.min(rushStart + MAX_SHIFT_HOURS, closingHour)
                pmKitchenShifts.push({ start: rushStart, end: rushEnd, count: availableForRush })
                pmKitchenAssigned += availableForRush
            }

            // 4. Wash crew: handles closing + wash (guaranteed at least 1)
            const washCrewSize = Math.max(1, pmKitchenCount - pmKitchenAssigned)
            const washStart = Math.max(PM_START + 2, washEndHour - MAX_SHIFT_HOURS)
            pmKitchenShifts.push({ start: washStart, end: washEndHour, count: washCrewSize })

            // Convert PM kitchen to shift format
            for (const s of pmKitchenShifts) {
                shifts.push({
                    startHour: s.start,
                    endHour: s.end,
                    requiredKitchen: s.count,
                    requiredFoh: 0,
                    shiftType: 'PM'
                })
            }

            // PM Cashiers: Improved pattern - start at 4pm for better transition coverage
            const CASHIER_PM_START = PM_EARLY_START  // 4pm instead of 5pm
            let pmCashierAssigned = 0

            // Opening cashiers at 4pm (transition coverage)
            const openingCashierCount = Math.min(2, pmCashierCount)
            if (openingCashierCount > 0) {
                shifts.push({
                    startHour: CASHIER_PM_START,  // 4pm
                    endHour: Math.min(CASHIER_PM_START + MAX_SHIFT_HOURS, closingHour),
                    requiredKitchen: 0,
                    requiredFoh: openingCashierCount,
                    shiftType: 'PM'
                })
                pmCashierAssigned += openingCashierCount
            }

            // Rush/mid cashiers at 5pm  
            const midCashierCount = Math.min(2, pmCashierCount - pmCashierAssigned)
            if (midCashierCount > 0) {
                shifts.push({
                    startHour: PM_START,  // 5pm
                    endHour: Math.min(PM_START + MAX_SHIFT_HOURS, closingHour),
                    requiredKitchen: 0,
                    requiredFoh: midCashierCount,
                    shiftType: 'PM'
                })
                pmCashierAssigned += midCashierCount
            }

            // CLOSING cashiers - late shift that covers until close + 1hr
            const closingCashierCount = Math.max(1, pmCashierCount - pmCashierAssigned)
            if (closingCashierCount > 0) {
                // Start at 6pm or 7pm, end at closing + 1 hour
                const closingCashierStart = Math.max(pmRushStart, washEndHour - MAX_SHIFT_HOURS)  // 6pm or later
                shifts.push({
                    startHour: closingCashierStart,
                    endHour: washEndHour,  // Same as kitchen wash crew (closing + 1hr)
                    requiredKitchen: 0,
                    requiredFoh: closingCashierCount,
                    shiftType: 'PM'
                })
            }

            // Filter out any shifts that are too short
            return shifts.filter(s => s.endHour - s.startHour >= MIN_SHIFT_HOURS)
        }

        // Generate SHIFTS using Intelligence Engine with DEMAND ZONES
        const shiftsToCreate: any[] = []
        let processedCount = 0
        let errorCount = 0

        /**
         * SHIFT CONFIGURATION - Tacos Gavilán Operational Standards
         * ===========================================================
         * AM: 1 hour before public opening → 5:00 PM
         * PM: 5:00 PM → Store closing + 1hr wash
         * 
         * Each store has different closing hours per day of week.
         * Hours > 24 represent next day (e.g., 25 = 1AM, 26 = 2AM)
         * 
         * Wash crew: 3 people (included in PM)
         * Shift Leaders: Deducted from available spots (wildcards)
         */

        // Store-specific closing hours: { storeName: { dayOfWeek: closingHour } }
        // dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
        const STORE_CLOSING_HOURS: Record<string, Record<number, number>> = {
            'Azusa': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 25, 6: 25 },  // 10AM → 12AM, Fri-Sat: 1AM
            'Bell': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },  // 10AM → 12AM, Fri-Sat: 2AM
            'Downey': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },  // 12AM / 3AM
            'Hollywood': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },  // 9AM → 12AM, Fri-Sat: 3AM
            'Huntington': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 26, 5: 27, 6: 27 },  // 10AM → 12AM, Thu: 2AM, Fri-Sat: 3AM
            'LA Broadway': { 0: 26, 1: 25, 2: 25, 3: 25, 4: 26, 5: 28, 6: 28 },  // Sun:2AM, Mon-Wed:1AM, Thu:2AM / 4AM
            'LA Central': { 0: 26, 1: 26, 2: 26, 3: 26, 4: 27, 5: 28, 6: 28 },  // 2AM, Thu:3AM / 4AM
            'La Puente': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },  // 12AM / 2AM
            'Lynwood': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27 },  // 1AM, Thu:2AM / 3AM
            'Norwalk': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },  // 1AM / 3AM
            'Rialto': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 25, 5: 27, 6: 27 },  // 9AM → 12AM, Thu: 1AM, Fri-Sat: 3AM
            'Santa Ana': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 26, 6: 26 },  // 12AM / 2AM
            'Slauson': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 },  // 10AM → 1AM, Fri-Sat: 3AM
            'South Gate': { 0: 24, 1: 24, 2: 24, 3: 24, 4: 24, 5: 27, 6: 27 },  // 10AM → 12AM, Fri-Sat: 3AM
            'West Covina': { 0: 25, 1: 25, 2: 25, 3: 25, 4: 25, 5: 27, 6: 27 }   // 1AM / 3AM
        }

        // Store opening hours (prep starts 1 hour before)
        const STORE_OPENING_HOURS: Record<string, number> = {
            'Azusa': 10,        // Opens 10AM
            'Bell': 10,         // Opens 10AM
            'Downey': 9,        // Opens 9AM
            'Hollywood': 9,     // Opens 9AM
            'Huntington': 10,   // Opens 10AM
            'LA Broadway': 8,   // Opens 8AM
            'LA Central': 8,    // Opens 8AM
            'La Puente': 10,    // Opens 10AM
            'Lynwood': 9,       // Opens 9AM (prep at 8AM)
            'Norwalk': 9,       // Opens 9AM
            'Rialto': 9,        // Opens 9AM
            'Santa Ana': 10,    // Opens 10AM
            'Slauson': 10,      // Opens 10AM
            'South Gate': 10,   // Opens 10AM
            'West Covina': 9    // Opens 9AM
        }
        const DEFAULT_OPENING_HOUR = 9  // Default 9AM

        // Default closing hours if store not found in map
        const DEFAULT_CLOSING_HOURS: Record<number, number> = {
            0: 25, 1: 25, 2: 25, 3: 25, 4: 26, 5: 27, 6: 27  // 1AM, Thu:2AM / 3AM
        }

        const SHIFT_CONFIG = {
            PM_START: 17,        // 5:00 PM (PM shift always starts at 5pm)
            WASH_CREW_SIZE: 3,   // People for post-close wash
            WASH_DURATION: 1,    // 1 hour after closing
            MIN_SHIFT_HOURS: 6,  // Minimum shift duration (Feb 2026)
            MAX_WASH_SHIFT_HOURS: 8, // Wash crew can work 6-8 hours

            // Leadership roles (wildcards that cover both kitchen & cashier)
            LEADERSHIP_ROLES: ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO'],

            // Leadership structure per shift - these cover operational roles
            // AM: 2 SL (1 kitchen, 1 cashier) + 1 Asst = 3 total
            // PM: 4 SL (2 kitchen, 2 cashier) + 1 Asst = 5 total
            LEADERSHIP: {
                am: { kitchen: 2, foh: 1 },  // 1 SL + 1 Asst kitchen, 1 SL cashier
                pm: { kitchen: 3, foh: 2 }   // 2 SL + 1 Asst kitchen, 2 SL cashier
            }
        }

        /**
         * Get closing hour for a specific store and day
         */
        function getStoreClosingHour(storeName: string, dayOfWeek: number): number {
            // Find matching store by checking if store name contains any key
            for (const [key, hours] of Object.entries(STORE_CLOSING_HOURS)) {
                if (storeName.includes(key)) {
                    return hours[dayOfWeek] || DEFAULT_CLOSING_HOURS[dayOfWeek]
                }
            }
            return DEFAULT_CLOSING_HOURS[dayOfWeek]
        }

        /**
         * Get opening hour for a specific store
         */
        function getStoreOpeningHour(storeName: string): number {
            for (const [key, hour] of Object.entries(STORE_OPENING_HOURS)) {
                if (storeName.includes(key)) {
                    return hour
                }
            }
            return DEFAULT_OPENING_HOUR
        }

        /**
         * Get leadership count for a store (now uses dynamic data!)
         * Returns how many leaders cover each position per shift for a specific day
         */
        function getLeadershipCoverage(
            storeLeadership: LeadershipByShift,
            dayOfWeek: number,
            shiftType: 'AM' | 'PM'
        ): { kitchen: number; foh: number } {
            return getLeadersForDay(storeLeadership, dayOfWeek, shiftType)
        }

        /**
         * Generate STAGGERED shifts based on hourly demand curve
         * 
         * NEW PHILOSOPHY (Feb 2026):
         * - Base openers: 1 cook + 1 cashier from pool (SL + Asst are separate)
         * - Additional staff enter when demand increases
         * - Staff exit when demand decreases
         * - Prefer longer shifts when possible
         * 
         * UPDATED: Now uses dynamic leadership availability per store/day/shift
         */
        function generateStaggeredShifts(
            hours: { hour: number; required_kitchen: number; required_foh: number }[],
            storeName: string,
            storeOpeningHour: number,
            dayOfWeek: number,
            storeLeadership: LeadershipByShift
        ) {
            const shifts: {
                startHour: number
                endHour: number
                requiredKitchen: number
                requiredFoh: number
                shiftType: 'AM' | 'PM'
            }[] = []

            const amStart = storeOpeningHour - 1
            const amEnd = SHIFT_CONFIG.PM_START
            const closingHour = getStoreClosingHour(storeName, dayOfWeek)
            const pmEnd = closingHour + SHIFT_CONFIG.WASH_DURATION

            // Helper: Get demand for a specific hour, accounting for leadership coverage
            // Leadership already covers some positions, so we subtract them from raw demand
            // Only count 80% of leaders to leave buffer for breaks
            const LEADERSHIP_COVERAGE_FACTOR = 0.8

            const getDemand = (hour: number, position: 'kitchen' | 'foh', shiftType: 'AM' | 'PM') => {
                const hourData = hours.find(h => h.hour === hour)
                if (!hourData) return 1 // Default minimum

                // Get leadership coverage for this shift type and position (now dynamic!)
                const leadership = getLeadershipCoverage(storeLeadership, dayOfWeek, shiftType)
                const leadersCovering = position === 'kitchen' ? leadership.kitchen : leadership.foh
                const raw = position === 'kitchen' ? hourData.required_kitchen : hourData.required_foh

                // Subtract 80% of leaders who cover this position (20% buffer for breaks)
                const effectiveCoverage = Math.floor(leadersCovering * LEADERSHIP_COVERAGE_FACTOR)

                // Calculate net demand
                let netDemand = Math.max(raw - effectiveCoverage, 0)

                // GUARANTEE: Pre-opening prep hour needs at least 1 pool cook
                // First AM hour = prep time, always need pool staff regardless of leadership
                const isFirstAMHour = (shiftType === 'AM' && hour === amStart)
                if (isFirstAMHour && position === 'kitchen' && netDemand < 1) {
                    netDemand = 1
                }

                return netDemand
            }

            // ========== GENERATE AM STAGGERED SHIFTS ==========
            const amKitchenShifts = generateStaggeredForPosition(
                amStart, amEnd, 'kitchen', 'AM', getDemand
            )
            const amFohShifts = generateStaggeredForPosition(
                amStart, amEnd, 'foh', 'AM', getDemand
            )

            // ========== GENERATE PM STAGGERED SHIFTS ==========
            // PM shifts now end at CLOSING (not closing + wash time)
            const pmKitchenShifts = generateStaggeredForPosition(
                SHIFT_CONFIG.PM_START, closingHour, 'kitchen', 'PM', getDemand, closingHour
            )
            const pmFohShifts = generateStaggeredForPosition(
                SHIFT_CONFIG.PM_START, closingHour, 'foh', 'PM', getDemand, closingHour
            )

            // ========== WASH CREW: Separate explicit shift ==========
            // Wash crew is a dedicated shift that covers closing and cleanup
            // These are kitchen staff that stay to clean after closing
            const washCrewShifts: typeof pmKitchenShifts = []
            if (closingHour) {
                // Shift: starts before close, ends 1 hour after (wash duration from config)
                // Example: Lynwood closes 1am → wash crew works 9pm-2am
                const washStart = closingHour - 5  // 5 hours before close
                const washEnd = closingHour + SHIFT_CONFIG.WASH_DURATION  // 1 hour after closing

                washCrewShifts.push({
                    startHour: Math.max(washStart, SHIFT_CONFIG.PM_START),  // Don't start before 5pm
                    endHour: washEnd,
                    requiredKitchen: SHIFT_CONFIG.WASH_CREW_SIZE,  // 3 people
                    requiredFoh: 0,
                    shiftType: 'PM'
                })
            }

            // Combine all shifts
            return [...amKitchenShifts, ...amFohShifts, ...pmKitchenShifts, ...pmFohShifts, ...washCrewShifts]
        }

        /**
         * Generate staggered shifts for a single position (kitchen or cashier)
         * Creates shifts that match EXACTLY with the demand map
         */
        function generateStaggeredForPosition(
            startHour: number,
            endHour: number,
            position: 'kitchen' | 'foh',
            shiftType: 'AM' | 'PM',
            getDemand: (hour: number, pos: 'kitchen' | 'foh', type: 'AM' | 'PM') => number,
            closingHour?: number
        ) {
            const shifts: {
                startHour: number
                endHour: number
                requiredKitchen: number
                requiredFoh: number
                shiftType: 'AM' | 'PM'
            }[] = []

            // Build demand curve for this range
            // NOTE: Wash crew is handled separately, not added to demand curve
            const hourlyDemand: { hour: number; demand: number }[] = []
            for (let h = startHour; h < endHour && h < 30; h++) {
                const actualHour = h >= 24 ? h - 24 : h
                const demand = getDemand(actualHour, position, shiftType)
                hourlyDemand.push({ hour: h, demand })
            }

            if (hourlyDemand.length === 0) return shifts

            // Track active shifts (people currently working)
            // Each entry: { startHour, personId }
            let activeShifts: { startHour: number; personId: number }[] = []
            let personCounter = 0
            let previousDemand = 0

            for (const { hour, demand } of hourlyDemand) {
                const currentStaff = activeShifts.length

                if (demand > currentStaff) {
                    // NEED MORE PEOPLE: Create (demand - currentStaff) new shifts starting NOW
                    const needed = demand - currentStaff
                    for (let i = 0; i < needed; i++) {
                        personCounter++
                        activeShifts.push({ startHour: hour, personId: personCounter })
                    }
                } else if (demand < currentStaff) {
                    // NEED FEWER PEOPLE: End (currentStaff - demand) oldest shifts NOW
                    const excess = currentStaff - demand
                    for (let i = 0; i < excess && activeShifts.length > 0; i++) {
                        // Remove oldest (FIFO - first in, first out)
                        const toEnd = activeShifts.shift()!
                        if (hour > toEnd.startHour) {
                            shifts.push({
                                startHour: toEnd.startHour,
                                endHour: hour,
                                requiredKitchen: position === 'kitchen' ? 1 : 0,
                                requiredFoh: position === 'foh' ? 1 : 0,
                                shiftType
                            })
                        }
                    }
                }

                previousDemand = demand
            }

            // Close all remaining active shifts at end of period
            for (const active of activeShifts) {
                if (endHour > active.startHour) {
                    shifts.push({
                        startHour: active.startHour,
                        endHour: endHour,
                        requiredKitchen: position === 'kitchen' ? 1 : 0,
                        requiredFoh: position === 'foh' ? 1 : 0,
                        shiftType
                    })
                }
            }

            // ADJUST SHIFTS TO MEET MINIMUM DURATION
            // PM kitchen (wash crew) can work 6-8 hours
            const minDuration = SHIFT_CONFIG.MIN_SHIFT_HOURS
            const maxWashDuration = SHIFT_CONFIG.MAX_WASH_SHIFT_HOURS

            // Maximum end hour: closing + wash (if PM) or 30 (6AM)
            // This is an ABSOLUTE cap - shifts cannot go past this
            const maxEndHour = closingHour
                ? closingHour + SHIFT_CONFIG.WASH_DURATION
                : 30

            const adjustedShifts = shifts.map(shift => {
                const duration = shift.endHour - shift.startHour
                const isWashCrew = shiftType === 'PM' && position === 'kitchen'
                const targetDuration = isWashCrew ? maxWashDuration : minDuration

                if (duration < minDuration) {
                    // Shift is too short - need to adjust

                    // Check if extending end would hit closing cap
                    const idealEnd = shift.startHour + targetDuration

                    if (idealEnd > maxEndHour) {
                        // CAN'T EXTEND END - Must start EARLIER instead
                        // For closing shifts, move start time backwards
                        const newStartHour = maxEndHour - targetDuration

                        // Don't go before PM_START for PM shifts
                        const minStartHour = shiftType === 'PM' ? SHIFT_CONFIG.PM_START : startHour
                        const adjustedStart = Math.max(newStartHour, minStartHour)

                        return { ...shift, startHour: adjustedStart, endHour: maxEndHour }
                    } else {
                        // Can extend end normally
                        return { ...shift, endHour: Math.min(idealEnd, 30) }
                    }
                }
                return shift
            })

            // CONSOLIDATE: Merge shifts with same start/end into one with higher count
            const consolidated = new Map<string, typeof shifts[0] & { count: number }>()
            for (const shift of adjustedShifts) {
                const key = `${shift.startHour}-${shift.endHour}-${shift.shiftType}`
                const existing = consolidated.get(key)
                if (existing) {
                    existing.requiredKitchen += shift.requiredKitchen
                    existing.requiredFoh += shift.requiredFoh
                } else {
                    consolidated.set(key, { ...shift, count: 1 })
                }
            }

            return Array.from(consolidated.values())
        }

        for (const store of stores) {
            // Get store opening hour from config (more reliable than DB parsing)
            const storeOpeningHour = getStoreOpeningHour(store.name)

            for (const dateStr of dates) {
                try {
                    // Get Intelligence forecast for this store/date
                    const forecast = await generateSmartForecast(store.external_id, dateStr)

                    if (!forecast || !forecast.hours || forecast.hours.length === 0) {
                        continue
                    }

                    // Get day of week (0=Sun, 1=Mon, etc.)
                    const dateObj = new Date(dateStr + 'T12:00:00')
                    const dayOfWeek = dateObj.getDay()

                    // Get closing hour for this store/day
                    const closingHour = getStoreClosingHour(store.name, dayOfWeek)

                    // Get staffing config for this store (or use defaults)
                    const staffingConfig = staffingByStore.get(store.external_id) || {
                        kitchen: { am: 4, pm: 5 },
                        cashier: { am: 4, pm: 5 }
                    }

                    // HYBRID: Generate shifts with staggered base + extra spots during rush
                    // Uses configured headcount AND demand forecast for intelligent grouping
                    // NOTE: dayOfWeek passed to add extra cashier on Fri/Sat/Sun
                    const staggeredShifts = generateHybridShifts(
                        storeOpeningHour,
                        closingHour,
                        staffingConfig,
                        forecast.hours,  // Pass forecast for rush hour detection
                        dayOfWeek        // Pass day for weekend extra staff
                    )

                    console.log(`📅 ${store.name} ${dateStr}: Hybrid shifts generated (${staggeredShifts.length} blocks, ${staffingConfig.kitchen.am}+${staffingConfig.kitchen.pm} kitchen, ${staffingConfig.cashier.am}+${staffingConfig.cashier.pm} cashier)`)

                    // Create shifts from staggered blocks
                    for (const block of staggeredShifts) {
                        // VALIDATE: start_hour must be 0-23 (DB constraint)
                        if (block.startHour < 0 || block.startHour >= 24) {
                            console.log(`⚠️ Skipping invalid start_hour: ${block.startHour}`)
                            continue
                        }

                        // VALIDATE: end_hour must be 1-29 AND > start_hour (DB constraints)
                        if (block.endHour < 1 || block.endHour > 29) {
                            console.log(`⚠️ Skipping invalid end_hour: ${block.endHour} (must be 1-29)`)
                            continue
                        }
                        if (block.endHour <= block.startHour) {
                            console.log(`⚠️ Skipping invalid range: ${block.startHour}-${block.endHour} (end must be > start)`)
                            continue
                        }

                        // Create kitchen shift
                        if (block.requiredKitchen > 0) {
                            shiftsToCreate.push({
                                store_id: store.external_id,
                                shift_date: dateStr,
                                start_hour: block.startHour,
                                end_hour: block.endHour,
                                position_type: 'kitchen',
                                required_count: Math.max(block.requiredKitchen, CAPACITY_RULES.MIN_KITCHEN),
                                claimed_count: 0,
                                status: publish ? 'published' : 'draft',
                                week_start: weekStart
                            })
                        }

                        // Create cashier shift
                        if (block.requiredFoh > 0) {
                            shiftsToCreate.push({
                                store_id: store.external_id,
                                shift_date: dateStr,
                                start_hour: block.startHour,
                                end_hour: block.endHour,
                                position_type: 'cashier',
                                required_count: Math.max(block.requiredFoh, CAPACITY_RULES.MIN_CASHIERS),
                                claimed_count: 0,
                                status: publish ? 'published' : 'draft',
                                week_start: weekStart
                            })
                        }
                    }

                    processedCount++
                } catch (forecastError) {
                    console.warn(`Failed to forecast ${store.name} on ${dateStr}:`, forecastError)
                    errorCount++
                }
            }
        }

        if (shiftsToCreate.length === 0) {
            return NextResponse.json({
                error: 'No shifts generated',
                message: 'Intelligence Engine did not generate any staff requirements'
            }, { status: 400 })
        }

        // Delete existing shifts for this week (if regenerating)
        await supabaseAdmin
            .from('open_shifts')
            .delete()
            .eq('week_start', weekStart)
            .in('store_id', stores.map(s => s.external_id))

        // DEDUPLICATE shifts before inserting
        // unique_shift constraint is: store_id + shift_date + start_hour + position_type
        // For shifts with same start, keep the one with longest duration (max end_hour)
        const uniqueShifts = new Map<string, typeof shiftsToCreate[0]>()
        for (const shift of shiftsToCreate) {
            // Key WITHOUT end_hour to match unique constraint
            const key = `${shift.store_id}-${shift.shift_date}-${shift.start_hour}-${shift.position_type}`
            const existing = uniqueShifts.get(key)
            if (existing) {
                // Keep the longest shift (max end_hour) and sum required_count
                existing.end_hour = Math.max(existing.end_hour, shift.end_hour)
                existing.required_count += shift.required_count
            } else {
                uniqueShifts.set(key, { ...shift })
            }
        }
        const deduplicatedShifts = Array.from(uniqueShifts.values())
        console.log(`📊 Deduplicated ${shiftsToCreate.length} → ${deduplicatedShifts.length} shifts`)

        // Insert all shifts (using INSERT since we already deleted existing ones)
        const { data: createdShifts, error: insertError } = await supabaseAdmin
            .from('open_shifts')
            .insert(deduplicatedShifts)
            .select()

        if (insertError) {
            console.error('Insert error:', insertError)
            return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        // Calculate total spots (sum of required_count) from what was actually inserted
        const totalSpots = deduplicatedShifts.reduce((sum, s) => sum + (s.required_count || 1), 0)

        return NextResponse.json({
            success: true,
            message_es: `${totalSpots} spots generados para ${stores.length} tiendas`,
            message_en: `${totalSpots} spots generated for ${stores.length} stores`,
            stats: {
                stores_processed: stores.length,
                days_processed: dates.length,
                shifts_created: deduplicatedShifts.length,  // DB rows
                spots_created: totalSpots,                   // Total positions (matches UI)
                forecasts_processed: processedCount,
                forecast_errors: errorCount
            }
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}

/**
 * PUT /api/self-schedule/admin/generate
 * Publicar/despublicar una semana
 */
export async function PUT(request: NextRequest) {
    try {
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')
        const user = verifyAuthToken(token)

        if (!user || (user.user_role !== 'admin' && user.user_role !== 'supervisor')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { weekStart, storeId, status } = body

        if (!weekStart || !status) {
            return NextResponse.json({ error: 'Missing weekStart or status' }, { status: 400 })
        }

        let query = supabaseAdmin
            .from('open_shifts')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('week_start', weekStart)

        if (storeId) {
            query = query.eq('store_id', storeId)
        }

        const { error } = await query

        if (error) {
            console.error('Update error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            message_es: `Semana ${status === 'published' ? 'publicada' : 'actualizada'}`,
            message_en: `Week ${status === 'published' ? 'published' : 'updated'}`
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}

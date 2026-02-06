import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/self-schedule/slots
 * Obtener slots disponibles para las próximas 2 semanas
 * Filtrado por posición del empleado (kitchen/cashier)
 */
export async function GET(request: NextRequest) {
    try {
        // 🛡️ AUTH CHECK
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const positionType = searchParams.get('positionType') || 'kitchen'
        const weekStart = searchParams.get('weekStart') // YYYY-MM-DD

        // Get today and 2 weeks ahead
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const twoWeeksLater = new Date(today)
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14)

        let query = supabaseAdmin
            .from('open_shifts')
            .select(`
                *,
                shift_claims (
                    id,
                    employee_id,
                    employee_name,
                    status
                )
            `)
            .eq('status', 'published')
            .eq('position_type', positionType)
            .gte('shift_date', today.toISOString().split('T')[0])
            .lte('shift_date', twoWeeksLater.toISOString().split('T')[0])
            .order('shift_date', { ascending: true })
            .order('start_hour', { ascending: true })

        if (storeId) {
            query = query.eq('store_id', storeId)
        }

        if (weekStart) {
            query = query.eq('week_start', weekStart)
        }

        const { data: slots, error } = await query

        if (error) {
            console.error('Error fetching slots:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Get shiftType filter from query params
        const shiftType = searchParams.get('shiftType') // 'AM' or 'PM'

        // Add availability flag and filter by shift type
        let enrichedSlots = slots?.map(slot => ({
            ...slot,
            available_spots: slot.required_count - slot.claimed_count,
            is_available: slot.claimed_count < slot.required_count
        }))

        // Filter by AM/PM if specified
        // AM = shifts starting before 15:00 (3pm)
        // PM = shifts starting at 15:00 or later
        if (shiftType && enrichedSlots) {
            const AM_PM_THRESHOLD = 15 // 3pm - shifts starting before this are AM

            if (shiftType === 'AM') {
                enrichedSlots = enrichedSlots.filter(slot => slot.start_hour < AM_PM_THRESHOLD)
                console.log(`🕐 Filtered to AM shifts (start_hour < ${AM_PM_THRESHOLD}): ${enrichedSlots.length} slots`)
            } else if (shiftType === 'PM') {
                enrichedSlots = enrichedSlots.filter(slot => slot.start_hour >= AM_PM_THRESHOLD)
                console.log(`🕐 Filtered to PM shifts (start_hour >= ${AM_PM_THRESHOLD}): ${enrichedSlots.length} slots`)
            }
        }

        return NextResponse.json({
            data: enrichedSlots,
            meta: {
                total: enrichedSlots?.length || 0,
                positionType,
                shiftType: shiftType || 'all',
                dateRange: {
                    from: today.toISOString().split('T')[0],
                    to: twoWeeksLater.toISOString().split('T')[0]
                }
            }
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}

/**
 * POST /api/self-schedule/slots
 * Reclamar un slot disponible
 */
export async function POST(request: NextRequest) {
    try {
        // 🛡️ AUTH CHECK
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        const body = await request.json()
        const { shiftId, employeeName } = body

        if (!shiftId) {
            return NextResponse.json({ error: 'Missing shiftId' }, { status: 400 })
        }

        // Get employee info for store/position validation
        const { data: employee } = await supabaseAdmin
            .from('employees')
            .select('store_id, position')
            .eq('auth_user_id', user.id)
            .single()

        // 1. Check if slot is still available
        const { data: shift, error: shiftError } = await supabaseAdmin
            .from('open_shifts')
            .select('*')
            .eq('id', shiftId)
            .single()

        if (shiftError || !shift) {
            return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
        }

        // ====== NEW VALIDATIONS ======

        // Validation 9: No past dates
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const shiftDate = new Date(shift.shift_date + 'T00:00:00')
        if (shiftDate < today) {
            return NextResponse.json({
                error: 'Past date',
                message_es: 'No puedes tomar turnos de fechas pasadas.',
                message_en: 'You cannot claim shifts for past dates.'
            }, { status: 400 })
        }

        // Validation 10: 1 day advance notice
        const minAdvanceDays = 1
        const minDate = new Date(today)
        minDate.setDate(minDate.getDate() + minAdvanceDays)
        if (shiftDate < minDate) {
            return NextResponse.json({
                error: 'Too soon',
                message_es: `Los turnos deben tomarse con al menos ${minAdvanceDays} días de anticipación.`,
                message_en: `Shifts must be claimed at least ${minAdvanceDays} days in advance.`
            }, { status: 400 })
        }

        // Validation 6: Only their assigned store
        if (employee && employee.store_id && shift.store_id !== employee.store_id) {
            return NextResponse.json({
                error: 'Wrong store',
                message_es: 'Solo puedes tomar turnos de tu tienda asignada.',
                message_en: 'You can only claim shifts at your assigned store.'
            }, { status: 403 })
        }

        // Validation 7: Only their position (kitchen/cashier)
        if (employee && employee.position) {
            const employeePosition = employee.position.toLowerCase()
            const shiftPosition = shift.position_type?.toLowerCase()

            // Map employee positions to shift position types
            const isKitchen = employeePosition.includes('cook') || employeePosition.includes('cocin') || employeePosition.includes('kitchen')
            const isCashier = employeePosition.includes('cashier') || employeePosition.includes('cajer') || employeePosition.includes('foh')

            if (shiftPosition === 'kitchen' && !isKitchen) {
                return NextResponse.json({
                    error: 'Wrong position',
                    message_es: 'Este turno es para cocineros. Tu posición no coincide.',
                    message_en: 'This shift is for kitchen staff. Your position does not match.'
                }, { status: 403 })
            }

            if (shiftPosition === 'cashier' && !isCashier) {
                return NextResponse.json({
                    error: 'Wrong position',
                    message_es: 'Este turno es para cajeros. Tu posición no coincide.',
                    message_en: 'This shift is for cashiers. Your position does not match.'
                }, { status: 403 })
            }
        }

        // ====== END NEW VALIDATIONS ======

        if (shift.status !== 'published') {
            return NextResponse.json({ error: 'Shift is not available for claiming' }, { status: 400 })
        }

        if (shift.claimed_count >= shift.required_count) {
            return NextResponse.json({
                error: 'Shift is full',
                message_es: 'Este turno ya está lleno. Alguien más lo tomó primero.',
                message_en: 'This shift is full. Someone else claimed it first.'
            }, { status: 409 })
        }

        // 2. Check if user already claimed this specific shift
        const { data: existingClaim } = await supabaseAdmin
            .from('shift_claims')
            .select('id')
            .eq('open_shift_id', shiftId)
            .eq('employee_id', user.id)
            .eq('status', 'active')
            .single()

        if (existingClaim) {
            return NextResponse.json({
                error: 'Already claimed',
                message_es: 'Ya tienes este turno.',
                message_en: 'You already have this shift.'
            }, { status: 409 })
        }

        // 3. Check for OVERLAPPING shifts on the same day
        // Get all active claims for this employee
        const { data: allActiveClaims } = await supabaseAdmin
            .from('shift_claims')
            .select(`
                id,
                open_shift_id,
                open_shifts!inner (
                    id,
                    shift_date,
                    start_hour,
                    end_hour,
                    week_start
                )
            `)
            .eq('employee_id', user.id)
            .eq('status', 'active')

        // Filter to same date and check for overlaps
        const newStart = shift.start_hour
        const newEnd = shift.end_hour

        const overlappingShift = allActiveClaims?.find((claim: any) => {
            const claimedShift = claim.open_shifts as any
            if (!claimedShift || claimedShift.shift_date !== shift.shift_date) {
                return false
            }

            // Check for overlap: new shift overlaps if it starts before claimed ends 
            // AND new shift ends after claimed starts
            const claimedStart = claimedShift.start_hour
            const claimedEnd = claimedShift.end_hour

            // Overlap condition: (newStart < claimedEnd) AND (newEnd > claimedStart)
            return newStart < claimedEnd && newEnd > claimedStart
        })

        if (overlappingShift) {
            const overlappingData = overlappingShift.open_shifts as any
            return NextResponse.json({
                error: 'Shift overlap',
                message_es: `Ya tienes un turno de ${overlappingData.start_hour}:00 a ${overlappingData.end_hour > 24 ? overlappingData.end_hour - 24 : overlappingData.end_hour}:00 ese día. Los turnos no pueden traslaparse.`,
                message_en: `You already have a shift from ${overlappingData.start_hour}:00 to ${overlappingData.end_hour > 24 ? overlappingData.end_hour - 24 : overlappingData.end_hour}:00 that day. Shifts cannot overlap.`
            }, { status: 409 })
        }

        // Validation 5: Max 1 shift per day (even if not overlapping)
        const sameDayShift = allActiveClaims?.find((claim: any) => {
            const claimedShift = claim.open_shifts as any
            return claimedShift && claimedShift.shift_date === shift.shift_date
        })

        if (sameDayShift) {
            return NextResponse.json({
                error: 'One shift per day',
                message_es: 'Solo puedes tomar un turno por día.',
                message_en: 'You can only claim one shift per day.'
            }, { status: 409 })
        }

        // Validation 4: Max 49 hours per week
        const MAX_WEEKLY_HOURS = 49
        const shiftHours = newEnd > 24 ? (newEnd - 24) + (24 - newStart) : (newEnd - newStart)

        // Filter claims for the same week and calculate total hours
        const sameWeekClaims = allActiveClaims?.filter((claim: any) => {
            const claimedShift = claim.open_shifts as any
            return claimedShift && claimedShift.week_start === shift.week_start
        }) || []

        let totalWeeklyHours = shiftHours  // Start with the new shift's hours
        for (const claim of sameWeekClaims) {
            const claimedShift = claim.open_shifts as any
            if (claimedShift) {
                const start = claimedShift.start_hour
                const end = claimedShift.end_hour
                const hours = end > 24 ? (end - 24) + (24 - start) : (end - start)
                totalWeeklyHours += hours
            }
        }

        if (totalWeeklyHours > MAX_WEEKLY_HOURS) {
            const currentHours = totalWeeklyHours - shiftHours
            return NextResponse.json({
                error: 'Weekly hours exceeded',
                message_es: `Este turno te daría ${totalWeeklyHours} horas esta semana. El máximo es ${MAX_WEEKLY_HOURS} horas. Ya tienes ${currentHours} horas programadas.`,
                message_en: `This shift would give you ${totalWeeklyHours} hours this week. Maximum is ${MAX_WEEKLY_HOURS} hours. You already have ${currentHours} hours scheduled.`
            }, { status: 409 })
        }

        // 5. ATOMIC CLAIM: Use UPDATE with condition to prevent race condition
        // This UPDATE will only succeed if claimed_count < required_count
        // If two users try at the same time, only ONE will succeed
        const { data: updatedShift, error: updateError } = await supabaseAdmin
            .from('open_shifts')
            .update({ claimed_count: shift.claimed_count + 1 })
            .eq('id', shiftId)
            .lt('claimed_count', shift.required_count) // CRITICAL: Only if space available
            .select()
            .single()

        if (updateError || !updatedShift) {
            // Race condition - someone else got the last spot
            console.log(`⚠️ Race condition detected for shift ${shiftId} - update failed`)
            return NextResponse.json({
                error: 'Shift is full',
                message_es: '¡Alguien más tomó el último espacio! Intenta con otro turno.',
                message_en: 'Someone else claimed the last spot! Try another shift.'
            }, { status: 409 })
        }

        // 6. Now insert the claim (the spot is already reserved)
        const { data: claim, error: claimError } = await supabaseAdmin
            .from('shift_claims')
            .insert({
                open_shift_id: shiftId,
                employee_id: user.id,
                employee_name: employeeName || user.email || 'Unknown',
                status: 'active'
            })
            .select()
            .single()

        if (claimError) {
            // Rollback the claimed_count increment if claim insert fails
            await supabaseAdmin
                .from('open_shifts')
                .update({ claimed_count: updatedShift.claimed_count - 1 })
                .eq('id', shiftId)

            if (claimError.code === '23505') { // Unique violation - already claimed
                return NextResponse.json({
                    error: 'Already claimed',
                    message_es: 'Ya tienes este turno.',
                    message_en: 'You already have this shift.'
                }, { status: 409 })
            }
            console.error('Claim error:', claimError)
            return NextResponse.json({ error: claimError.message }, { status: 500 })
        }

        // 6. SYNC TO PLANIFICADOR: Create shift record in 'shifts' table

        // First, get the store's external_id (Toast GUID) - this is what toast_employees uses
        const { data: storeData } = await supabaseAdmin
            .from('stores')
            .select('external_id')
            .eq('external_id', shift.store_id)  // open_shifts uses external_id
            .single()

        const toastStoreGuid = storeData?.external_id || shift.store_id
        console.log(`🔍 Looking for toast_employee - Store GUID: ${toastStoreGuid}, Email: ${user.email}`)

        const { data: toastEmployees, error: toastError } = await supabaseAdmin
            .from('toast_employees')
            .select('id, first_name, last_name, email, store_ids')
            .ilike('email', user.email)  // Search by email first
            .limit(20)  // Need enough to cover all store-specific employee records

        console.log(`🔍 Toast employee lookup result:`, {
            count: toastEmployees?.length || 0,
            employees: toastEmployees?.map(e => ({ id: e.id, email: e.email, name: `${e.first_name} ${e.last_name}`, store_ids: e.store_ids })),
            error: toastError?.message
        })

        // Filter by store_ids using the Toast GUID
        console.log(`🔍 Looking for store GUID: ${toastStoreGuid} in employee store_ids...`)

        const toastEmployee = toastEmployees?.find(emp => {
            console.log(`   Checking ${emp.first_name}: store_ids =`, JSON.stringify(emp.store_ids))
            if (Array.isArray(emp.store_ids)) {
                const match = emp.store_ids.includes(toastStoreGuid)
                console.log(`   Array check: ${match}`)
                return match
            }
            if (typeof emp.store_ids === 'string') {
                const match = emp.store_ids.includes(toastStoreGuid)
                console.log(`   String check: ${match}`)
                return match
            }
            console.log(`   No store_ids found`)
            return false
        })

        if (toastEmployee) {
            // Create the shift record for the planificador
            // CRITICAL FIX: Server runs in UTC, but we need LA timezone hours
            // The planner's formatTime12h uses 'America/Los_Angeles' timezone
            // We must build ISO strings that represent LA time correctly

            const startHour = shift.start_hour
            let endHour = shift.end_hour
            let endDateOffset = 0

            // Handle overnight shifts (e.g., end_hour = 25 means 1am next day)
            if (endHour > 24) {
                endHour = endHour - 24
                endDateOffset = 1
            }

            // Format hours for datetime string (HH:MM format like "08:00" or "16:00")
            const startTimeLocal = `${startHour.toString().padStart(2, '0')}:00`
            const endTimeLocal = `${endHour.toString().padStart(2, '0')}:00`

            // Calculate end date (might be next day for overnight shifts)
            let endDateStr = shift.shift_date
            if (endDateOffset > 0) {
                const tempDate = new Date(shift.shift_date + 'T12:00:00') // noon to avoid TZ issues
                tempDate.setDate(tempDate.getDate() + endDateOffset)
                endDateStr = tempDate.toISOString().split('T')[0]
            }

            // TIMEZONE FIX: Build ISO strings with LA timezone offset
            // LA is UTC-8 (PST) or UTC-7 (PDT). For simplicity, use PST (-08:00)
            // This ensures the stored UTC time, when converted back to LA, shows correct hour
            // Example: 08:00-08:00 → 16:00Z (UTC) → formatTime12h shows 8:00am LA ✓
            const startTimeStr = `${shift.shift_date}T${startTimeLocal}:00.000-08:00`
            let endTimeStr = `${endDateStr}T${endTimeLocal}:00.000-08:00`

            // Convert to actual Date objects to verify and handle edge cases
            const startDate = new Date(startTimeStr)
            const endDate = new Date(endTimeStr)

            // If end is before start (edge case), add a day
            if (endDate <= startDate) {
                const fixedEnd = new Date(endDate)
                fixedEnd.setDate(fixedEnd.getDate() + 1)
                endTimeStr = fixedEnd.toISOString()
            }

            // Convert to proper ISO format for storage (toISOString gives UTC which is what DB expects)
            const finalStartTimeStr = startDate.toISOString()
            const finalEndTimeStr = endDate.toISOString()

            console.log(`⏰ Time calculation:`)
            console.log(`   shift.start_hour: ${shift.start_hour}, shift.end_hour: ${shift.end_hour}`)
            console.log(`   startTimeLocal: ${startTimeLocal}, endTimeLocal: ${endTimeLocal}`)
            console.log(`   finalStartTimeStr: ${finalStartTimeStr}`)
            console.log(`   finalEndTimeStr: ${finalEndTimeStr}`)

            // Look up the job_id based on position_type
            // Toast uses English: Kitchen = Cook/Prep, Cashier = Cashier
            // Note: shifts.job_id FK references toast_jobs.id (internal ID, not guid)
            const jobSearchTerms = shift.position_type === 'kitchen'
                ? ['Cook', 'Cocinero', 'Kitchen', 'Prep', 'Preparador']
                : ['Cashier', 'Cajero', 'Register']

            let job_id: string | null = null

            // Try each search term until we find a match
            for (const term of jobSearchTerms) {
                const { data: jobData } = await supabaseAdmin
                    .from('toast_jobs')
                    .select('id, title')  // Use id, not guid - FK references id
                    .ilike('title', `%${term}%`)
                    .limit(1)
                    .single()

                if (jobData?.id) {
                    job_id = jobData.id
                    console.log(`🔍 Job found: "${jobData.title}" → id: ${job_id}`)
                    break
                }
            }

            if (!job_id) {
                console.log(`⚠️ No job found for position_type: ${shift.position_type}`)
            }

            const shiftRecord = {
                store_id: shift.store_id,
                employee_id: toastEmployee.id,
                job_id: job_id,  // Add the job/position
                shift_date: shift.shift_date,
                start_time: finalStartTimeStr,
                end_time: finalEndTimeStr,
                status: 'draft',  // Draft so manager can review before publishing
                is_open: false
            }

            console.log(`📝 Inserting shift record:`, JSON.stringify(shiftRecord, null, 2))

            const { error: shiftInsertError } = await supabaseAdmin
                .from('shifts')
                .insert(shiftRecord)

            if (shiftInsertError) {
                console.warn('Failed to create shift record for planificador:', shiftInsertError)
                // Don't fail the claim - just log the warning
            } else {
                console.log(`✅ Shift synced to planificador: ${toastEmployee.first_name} ${shift.shift_date} ${shift.start_hour}:00-${shift.end_hour}:00`)
            }
        } else {
            console.warn(`Employee not found in toast_employees by email: ${user.email}`)
        }

        return NextResponse.json({
            success: true,
            claim,
            message_es: '¡Turno reclamado exitosamente!',
            message_en: 'Shift claimed successfully!'
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}

/**
 * DELETE /api/self-schedule/slots
 * Soltar un turno (drop)
 */
export async function DELETE(request: NextRequest) {
    try {
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace('Bearer ', '')
        const user = verifyAuthToken(token)

        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        const searchParams = request.nextUrl.searchParams
        const claimId = searchParams.get('claimId')

        if (!claimId) {
            return NextResponse.json({ error: 'Missing claimId' }, { status: 400 })
        }

        // 1. Get the claim to find the open_shift_id
        const { data: claim, error: claimFetchError } = await supabaseAdmin
            .from('shift_claims')
            .select('id, open_shift_id, status')
            .eq('id', claimId)
            .eq('employee_id', user.id)
            .single()

        if (claimFetchError || !claim) {
            return NextResponse.json({ error: 'Claim not found or not yours' }, { status: 404 })
        }

        if (claim.status !== 'active') {
            return NextResponse.json({ error: 'Claim is not active' }, { status: 400 })
        }

        // 2. Update claim status to 'dropped'
        const { error: updateError } = await supabaseAdmin
            .from('shift_claims')
            .update({ status: 'dropped' })
            .eq('id', claimId)

        if (updateError) {
            console.error('Drop error:', updateError)
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        // 3. Decrement claimed_count on the open_shift (get current and update)
        const { data: shiftData } = await supabaseAdmin
            .from('open_shifts')
            .select('claimed_count')
            .eq('id', claim.open_shift_id)
            .single()

        if (shiftData) {
            await supabaseAdmin
                .from('open_shifts')
                .update({ claimed_count: Math.max(0, shiftData.claimed_count - 1) })
                .eq('id', claim.open_shift_id)
        }

        // 4. SYNC TO PLANIFICADOR: Delete the corresponding shift record
        // We need to find the shift by employee + date + store
        // First get the open_shift details
        const { data: openShift } = await supabaseAdmin
            .from('open_shifts')
            .select('store_id, shift_date')
            .eq('id', claim.open_shift_id)
            .single()

        if (openShift) {
            // Find the toast_employee for this user
            const { data: toastEmployees } = await supabaseAdmin
                .from('toast_employees')
                .select('id, store_ids')
                .ilike('email', user.email)
                .limit(20)

            // Find the right employee for this store
            const toastEmployee = toastEmployees?.find(emp => {
                if (Array.isArray(emp.store_ids)) return emp.store_ids.includes(openShift.store_id)
                if (typeof emp.store_ids === 'string') return emp.store_ids.includes(openShift.store_id)
                return false
            })

            if (toastEmployee) {
                // Delete the shift matching employee + store + date
                const { error: shiftDeleteError, count } = await supabaseAdmin
                    .from('shifts')
                    .delete()
                    .eq('employee_id', toastEmployee.id)
                    .eq('store_id', openShift.store_id)
                    .eq('shift_date', openShift.shift_date)

                if (shiftDeleteError) {
                    console.warn('Failed to delete shift from planificador:', shiftDeleteError)
                } else {
                    console.log(`✅ Shift removed from planificador for employee: ${toastEmployee.id}, date: ${openShift.shift_date}`)
                }
            }
        }

        // 5. NOTIFY OTHER EMPLOYEES: Alert others with same position that a shift is available
        // ONLY if the shift actually has available spots after the drop
        // First get the full open_shift details including position_type and current counts
        const { data: fullOpenShift } = await supabaseAdmin
            .from('open_shifts')
            .select('store_id, shift_date, start_hour, end_hour, position_type, claimed_count, required_count')
            .eq('id', claim.open_shift_id)
            .single()

        // Only notify if there are now available spots
        if (fullOpenShift && fullOpenShift.claimed_count < fullOpenShift.required_count) {
            // Format time for notification
            const formatHour = (hour: number) => {
                const h24 = hour >= 24 ? hour - 24 : hour
                const suffix = h24 >= 12 ? 'PM' : 'AM'
                const h = h24 > 12 ? h24 - 12 : h24 === 0 ? 12 : h24
                return `${h}:00 ${suffix}`
            }

            // Get store name
            const { data: storeData } = await supabaseAdmin
                .from('stores')
                .select('name')
                .eq('external_id', fullOpenShift.store_id)
                .single()
            const storeName = storeData?.name?.replace(/^Tacos? Gavilan /i, '') || 'Tienda'
            const positionType = fullOpenShift.position_type

            // SIMPLIFIED: Get all employees at this store (no complex job filtering)
            const { data: allEmployees } = await supabaseAdmin
                .from('toast_employees')
                .select('id, first_name, email, store_ids')
                .eq('deleted', false)

            // Filter to employees at this store (exclude the one who dropped)
            const employeesToNotify = allEmployees?.filter(emp => {
                // Skip the user who dropped the shift
                if (emp.email?.toLowerCase() === user.email?.toLowerCase()) return false

                // Check if employee is at this store
                if (Array.isArray(emp.store_ids)) {
                    return emp.store_ids.includes(fullOpenShift.store_id)
                }
                if (typeof emp.store_ids === 'string') {
                    return emp.store_ids.includes(fullOpenShift.store_id)
                }
                return false
            }) || []

            console.log(`📢 Found ${employeesToNotify.length} employees to notify at ${storeName} about ${positionType} shift`)

            // Create notifications for each eligible employee
            // Format date for message
            const shiftDate = new Date(fullOpenShift.shift_date + 'T12:00:00')
            const dateStr = shiftDate.toLocaleDateString('es-MX', {
                weekday: 'long',
                day: 'numeric',
                month: 'short'
            })

            const notifications = employeesToNotify.map(emp => ({
                user_id: emp.id,
                title: '🔔 ¡Turno disponible!',
                message: `Se liberó un turno de ${positionType === 'kitchen' ? 'Cocina' : 'Cajero'} en ${storeName}: ${dateStr}, ${formatHour(fullOpenShift.start_hour)} - ${formatHour(fullOpenShift.end_hour)}`,
                type: 'info',
                link: '/mis-horarios',
                is_read: false
            }))

            console.log(`📢 Notification payload:`, JSON.stringify(notifications, null, 2))

            if (notifications.length > 0) {
                const { data: insertedNotifs, error: notifError } = await supabaseAdmin
                    .from('notifications')
                    .insert(notifications)
                    .select()

                if (notifError) {
                    console.error('❌ Failed to create shift drop notifications:', notifError)
                    console.error('❌ Error code:', notifError.code)
                    console.error('❌ Error details:', notifError.details)
                } else {
                    console.log(`✅ Notified ${notifications.length} employees about dropped shift`)
                    console.log(`✅ Inserted notifications:`, insertedNotifs)
                }
            } else {
                console.log(`⚠️ No employees to notify (filters removed everyone)`)
            }
        }

        return NextResponse.json({
            success: true,
            message_es: 'Turno liberado exitosamente',
            message_en: 'Shift dropped successfully'
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}

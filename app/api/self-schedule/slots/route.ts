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

        // Add availability flag
        const enrichedSlots = slots?.map(slot => ({
            ...slot,
            available_spots: slot.required_count - slot.claimed_count,
            is_available: slot.claimed_count < slot.required_count
        }))

        return NextResponse.json({
            data: enrichedSlots,
            meta: {
                total: enrichedSlots?.length || 0,
                positionType,
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

        // 1. Check if slot is still available
        const { data: shift, error: shiftError } = await supabaseAdmin
            .from('open_shifts')
            .select('*')
            .eq('id', shiftId)
            .single()

        if (shiftError || !shift) {
            return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
        }

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

        // 2. Check if user already claimed this shift
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

        // 3. Create the claim (trigger will update claimed_count)
        const { data: claim, error: claimError } = await supabaseAdmin
            .from('shift_claims')
            .insert({
                open_shift_id: shiftId,
                employee_id: user.id,
                employee_name: employeeName || user.name || user.email || 'Unknown',
                status: 'active'
            })
            .select()
            .single()

        if (claimError) {
            // Race condition - someone else got it
            if (claimError.code === '23505') { // Unique violation
                return NextResponse.json({
                    error: 'Shift is no longer available',
                    message_es: 'Este turno ya no está disponible.',
                    message_en: 'This shift is no longer available.'
                }, { status: 409 })
            }
            console.error('Claim error:', claimError)
            return NextResponse.json({ error: claimError.message }, { status: 500 })
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

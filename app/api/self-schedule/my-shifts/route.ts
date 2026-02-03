import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/self-schedule/my-shifts
 * Obtener los turnos que el empleado actual ha reclamado
 */
export async function GET(request: NextRequest) {
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
        const weekStart = searchParams.get('weekStart')

        // Get current user's claims with shift details
        let query = supabaseAdmin
            .from('shift_claims')
            .select(`
                *,
                open_shifts (
                    id,
                    store_id,
                    shift_date,
                    start_hour,
                    end_hour,
                    position_type,
                    week_start
                )
            `)
            .eq('employee_id', user.id)
            .eq('status', 'active')
            .order('claimed_at', { ascending: false })

        const { data: claims, error } = await query

        if (error) {
            console.error('Error fetching claims:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Enrich with store names
        const storeIds = [...new Set(claims?.map(c => c.open_shifts?.store_id).filter(Boolean))]

        let storeMap = new Map<string, string>()

        // Only query stores if there are claims with store IDs
        if (storeIds.length > 0) {
            const { data: stores } = await supabaseAdmin
                .from('stores')
                .select('external_id, name')
                .in('external_id', storeIds)

            storeMap = new Map(stores?.map(s => [s.external_id, s.name]))
        }

        const enrichedClaims = claims?.map(claim => ({
            ...claim,
            store_name: storeMap.get(claim.open_shifts?.store_id) || 'Unknown Store'
        }))

        // Calculate total hours
        const totalHours = claims?.reduce((sum, claim) => {
            const shift = claim.open_shifts
            if (shift) {
                return sum + (shift.end_hour - shift.start_hour)
            }
            return sum
        }, 0) || 0

        return NextResponse.json({
            data: enrichedClaims,
            meta: {
                total_claims: claims?.length || 0,
                total_hours: totalHours
            }
        })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}

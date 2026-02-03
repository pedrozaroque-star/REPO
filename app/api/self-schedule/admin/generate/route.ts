import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateSmartForecast, CAPACITY_RULES } from '@/lib/intelligence'
import { addDays, format } from 'date-fns'

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

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor') {
            return NextResponse.json({ error: 'Forbidden: Admin/Manager only' }, { status: 403 })
        }

        const body = await request.json()
        const { weekStart, storeIds, publish = false } = body

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
        if (storeIds && storeIds.length > 0) {
            const { data } = await supabaseAdmin
                .from('stores')
                .select('external_id, name, opening_time, closing_time')
                .in('external_id', storeIds)
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

        // Generate SHIFTS using Intelligence Engine with DEMAND ZONES
        const shiftsToCreate: any[] = []
        let processedCount = 0
        let errorCount = 0

        // Helper function: Generate demand-based blocks from hourly requirements
        function generateDemandBlocks(
            hours: { hour: number; required_kitchen: number; required_foh: number }[],
            openHour: number,
            closeHour: number
        ) {
            // Sort hours by time
            const sortedHours = [...hours].sort((a, b) => a.hour - b.hour)

            // Define demand thresholds based on max values for this day
            const maxKitchen = Math.max(...sortedHours.map(h => h.required_kitchen || 0))
            const maxFoh = Math.max(...sortedHours.map(h => h.required_foh || 0))

            // Threshold: "High demand" = > 70% of max, "Medium" = > 40% of max
            const highThresholdK = maxKitchen * 0.7
            const medThresholdK = maxKitchen * 0.4

            // Create blocks based on demand intensity changes
            const blocks: {
                startHour: number;
                endHour: number;
                requiredKitchen: number;
                requiredFoh: number;
                intensity: 'low' | 'medium' | 'high';
            }[] = []

            let currentBlock: typeof blocks[0] | null = null

            for (const hour of sortedHours) {
                if (hour.hour < openHour || hour.hour >= closeHour) continue

                const kitchenReq = hour.required_kitchen || 0
                const fohReq = hour.required_foh || 0

                // Determine intensity
                let intensity: 'low' | 'medium' | 'high' = 'low'
                if (kitchenReq >= highThresholdK) {
                    intensity = 'high'
                } else if (kitchenReq >= medThresholdK) {
                    intensity = 'medium'
                }

                // Start new block or extend current
                if (!currentBlock) {
                    currentBlock = {
                        startHour: hour.hour,
                        endHour: hour.hour + 1,
                        requiredKitchen: kitchenReq,
                        requiredFoh: fohReq,
                        intensity
                    }
                } else if (currentBlock.intensity === intensity) {
                    // Same intensity - extend block and update peak requirements
                    currentBlock.endHour = hour.hour + 1
                    currentBlock.requiredKitchen = Math.max(currentBlock.requiredKitchen, kitchenReq)
                    currentBlock.requiredFoh = Math.max(currentBlock.requiredFoh, fohReq)
                } else {
                    // Intensity changed - push current block and start new
                    if (currentBlock.endHour - currentBlock.startHour >= 2) {
                        blocks.push({ ...currentBlock })
                    } else {
                        // Too short - merge with previous or expand
                        if (blocks.length > 0) {
                            blocks[blocks.length - 1].endHour = currentBlock.endHour
                            blocks[blocks.length - 1].requiredKitchen = Math.max(
                                blocks[blocks.length - 1].requiredKitchen,
                                currentBlock.requiredKitchen
                            )
                            blocks[blocks.length - 1].requiredFoh = Math.max(
                                blocks[blocks.length - 1].requiredFoh,
                                currentBlock.requiredFoh
                            )
                        } else {
                            blocks.push({ ...currentBlock })
                        }
                    }

                    currentBlock = {
                        startHour: hour.hour,
                        endHour: hour.hour + 1,
                        requiredKitchen: kitchenReq,
                        requiredFoh: fohReq,
                        intensity
                    }
                }
            }

            // Push final block
            if (currentBlock) {
                blocks.push(currentBlock)
            }

            // Ensure minimum 3-hour blocks (merge short adjacent blocks)
            const mergedBlocks: typeof blocks = []
            for (const block of blocks) {
                const duration = block.endHour - block.startHour
                if (duration < 3 && mergedBlocks.length > 0) {
                    // Merge with previous
                    const prev = mergedBlocks[mergedBlocks.length - 1]
                    prev.endHour = block.endHour
                    prev.requiredKitchen = Math.max(prev.requiredKitchen, block.requiredKitchen)
                    prev.requiredFoh = Math.max(prev.requiredFoh, block.requiredFoh)
                } else {
                    mergedBlocks.push(block)
                }
            }

            return mergedBlocks
        }

        for (const store of stores) {
            // Parse store operating hours
            const openHour = parseInt(store.opening_time?.split(':')[0] || '8')
            const closeHour = parseInt(store.closing_time?.split(':')[0] || '22')

            for (const dateStr of dates) {
                try {
                    // Get Intelligence forecast for this store/date
                    const forecast = await generateSmartForecast(store.external_id, dateStr)

                    if (!forecast || !forecast.hours || forecast.hours.length === 0) {
                        continue
                    }

                    // Generate demand-based blocks
                    const demandBlocks = generateDemandBlocks(forecast.hours, openHour, closeHour)

                    console.log(`📅 ${store.name} ${dateStr}: Generated ${demandBlocks.length} demand blocks`)

                    // Create shifts from demand blocks
                    for (const block of demandBlocks) {
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

        // Insert all shifts
        const { data: createdShifts, error: insertError } = await supabaseAdmin
            .from('open_shifts')
            .upsert(shiftsToCreate, {
                onConflict: 'store_id,shift_date,start_hour,position_type',
                ignoreDuplicates: false
            })
            .select()

        if (insertError) {
            console.error('Insert error:', insertError)
            return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            message_es: `Semana ${publish ? 'publicada' : 'generada'} exitosamente`,
            message_en: `Week ${publish ? 'published' : 'generated'} successfully`,
            stats: {
                stores_processed: stores.length,
                days_processed: dates.length,
                shifts_created: shiftsToCreate.length,
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

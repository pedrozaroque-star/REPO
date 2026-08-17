/**
 * @module ScheduleCalendarAPI
 * @description API endpoint to download RFC 5545 iCalendar (.ics) files for employee schedules on iOS and Android devices.
 * @businessRules
 * - Serves published work shifts as standard .ics calendar events.
 * - Compatible with Apple Calendar (iOS Safari / Mail 1-tap import), Google Calendar (Android / web), and Outlook.
 * - Injects store address, shift times, station assignments, tasks, and 1-hour prior alarms.
 * @dataFlow
 * - Request: GET /api/schedule/calendar?employee_id=...&store_id=...&start_date=...&end_date=...
 * - Queries: 'stores', 'toast_employees', 'shifts', 'station_assignments', 'operating_procedures'
 * - Response: text/calendar (.ics)
 * @notes
 * - Safe fallback if some store address fields are missing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateScheduleICS, CalendarShiftItem, CalendarStoreInfo } from '@/lib/calendar-helper'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url)
        const employeeId = searchParams.get('employee_id')
        const storeId = searchParams.get('store_id')
        const startDate = searchParams.get('start_date')
        const endDate = searchParams.get('end_date')
        const shiftId = searchParams.get('shift_id')

        if (!employeeId && !shiftId) {
            return new NextResponse('Parámetros faltantes: employee_id o shift_id son requeridos.', { status: 400 })
        }

        // 1. Fetch Store Information
        let storeInfo: CalendarStoreInfo = { name: 'Tacos Gavilan' }
        if (storeId) {
            const { data: storeData } = await supabase
                .from('stores')
                .select('name, address, city, state, zip_code, phone')
                .or(`external_id.eq.${storeId},id.eq.${isNaN(Number(storeId)) ? -1 : Number(storeId)}`)
                .maybeSingle()

            if (storeData) {
                storeInfo = {
                    name: storeData.name || 'Tacos Gavilan',
                    address: storeData.address || '',
                    city: storeData.city || '',
                    state: storeData.state || 'CA',
                    zip_code: storeData.zip_code || '',
                    phone: storeData.phone || ''
                }
            }
        }

        // 2. Fetch Employee Information
        let employeeName = 'Empleado'
        if (employeeId) {
            const { data: empData } = await supabase
                .from('toast_employees')
                .select('first_name, last_name, chosen_name')
                .or(`toast_guid.eq.${employeeId},id.eq.${isNaN(Number(employeeId)) ? -1 : Number(employeeId)}`)
                .maybeSingle()

            if (empData) {
                employeeName = `${empData.chosen_name || empData.first_name || ''} ${empData.last_name || ''}`.trim() || 'Empleado'
            }
        }

        // 3. Query Shifts
        let shiftsQuery = supabase
            .from('shifts')
            .select('*')
            .order('start_time', { ascending: true })

        if (shiftId) {
            shiftsQuery = shiftsQuery.eq('id', shiftId)
        } else {
            shiftsQuery = shiftsQuery.eq('employee_id', employeeId)

            if (startDate) {
                shiftsQuery = shiftsQuery.gte('shift_date', startDate)
            }
            if (endDate) {
                shiftsQuery = shiftsQuery.lte('shift_date', endDate)
            }
        }

        const { data: dbShifts, error: shiftsError } = await shiftsQuery

        if (shiftsError) {
            console.error('Error fetching shifts for calendar:', shiftsError)
            return new NextResponse('Error al consultar turnos', { status: 500 })
        }

        if (!dbShifts || dbShifts.length === 0) {
            return new NextResponse('No se encontraron turnos para las fechas especificadas.', { status: 404 })
        }

        // 4. Fetch Station Assignments for richer calendar details
        const dates = [...new Set(dbShifts.map((s: any) => s.shift_date))]
        const { data: assignments } = await supabase
            .from('station_assignments')
            .select('assignment_date, position_name, sub_position, employee_id')
            .eq('employee_id', employeeId)
            .in('assignment_date', dates)

        // 5. Map Shifts into CalendarShiftItem structure
        const calendarShifts: CalendarShiftItem[] = dbShifts.map((s: any) => {
            const shiftDate = s.shift_date
            const matchedAssignment = (assignments || []).find(
                (a: any) => a.assignment_date === shiftDate
            )

            let positionTitle = s.job_title || s.role || ''
            if (matchedAssignment?.position_name) {
                positionTitle = matchedAssignment.sub_position
                    ? `${matchedAssignment.position_name} (${matchedAssignment.sub_position.replace(/_AM|_PM/g, '')})`
                    : matchedAssignment.position_name
            }

            return {
                id: s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                position_title: positionTitle,
                breaks: s.breaks_schedule && Array.isArray(s.breaks_schedule) ? s.breaks_schedule : []
            }
        })

        // 6. Generate RFC 5545 iCalendar content
        const icsContent = generateScheduleICS({
            store: storeInfo,
            employeeName,
            shifts: calendarShifts,
            calendarName: `Horario ${storeInfo.name}`
        })

        const safeStoreName = (storeInfo.name || 'Tacos_Gavilan').replace(/[^a-zA-Z0-9_-]/g, '_')
        const filename = `Horario_${safeStoreName}_${startDate || 'semanal'}.ics`

        return new NextResponse(icsContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8; method=PUBLISH',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        })

    } catch (error: any) {
        console.error('Calendar generation error:', error)
        return new NextResponse(`Error interno: ${error.message}`, { status: 500 })
    }
}

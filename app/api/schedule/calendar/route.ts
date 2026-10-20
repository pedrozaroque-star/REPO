/**
 * @module ScheduleCalendarAPI
 * @description API endpoint to download RFC 5545 iCalendar (.ics) files for employee schedules on iOS and Android devices.
 * @businessRules
 * - Serves published work shifts (`status = 'published'`) as standard .ics calendar events.
 * - Requires either a valid HMAC-signed calendar token (`token`) scoped to `(employee_id, store_id, start_date, end_date)`
 *   or an authenticated session (`teg_token`) authorized for that store and employee.
 * - Filters shifts and station assignments strictly by `store_id` and `employee_id`.
 * - Resolves overlapping shift periods (`AM` / `PM`) and effective store-adjusted activities via `lib/actividades-resolution.ts`.
 * @dataFlow
 * - Request: GET /api/schedule/calendar?employee_id=...&store_id=...&start_date=...&end_date=...&token=...
 * - Queries: 'stores', 'toast_employees', 'shifts', 'station_assignments', 'operating_procedures', 'position_activities'
 * - Response: text/calendar (.ics)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import {
    generateScheduleICS,
    CalendarShiftItem,
    CalendarStoreInfo,
    verifyCalendarAccessToken,
} from '@/lib/calendar-helper'
import {
    getShiftOverlappingPeriods,
    isStorePilotActiveForActivitiesEmail,
    mergeAndDeduplicateActivities,
    resolveStationActivities,
} from '@/lib/actividades-resolution'

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url)
        const employeeId = searchParams.get('employee_id')?.trim() || ''
        const storeId = searchParams.get('store_id')?.trim() || ''
        const startDate = searchParams.get('start_date')?.trim() || ''
        const endDate = searchParams.get('end_date')?.trim() || ''
        const shiftId = searchParams.get('shift_id')?.trim() || ''
        const token = searchParams.get('token')?.trim() || ''

        if (!employeeId || !storeId) {
            return new NextResponse(
                'Parámetros faltantes: employee_id y store_id son requeridos.',
                { status: 400 }
            )
        }

        // 1. Autenticación y Autorización: Token firmado HMAC o sesión válida autorizada
        let isAuthorized = false
        if (token) {
            const tokenCheck = verifyCalendarAccessToken(token, {
                employeeId,
                storeId,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
                shiftId: shiftId || undefined,
            })
            if (!tokenCheck.valid) {
                return new NextResponse(
                    `Acceso denegado al calendario: token inválido o expirado (${tokenCheck.reason}).`,
                    { status: 403 }
                )
            }
            isAuthorized = true
        } else {
            const user = await getServerUser(req)
            if (!user) {
                return new NextResponse(
                    'No autorizado: Se requiere enlace firmado o sesión activa para descargar el calendario.',
                    { status: 401 }
                )
            }
            if (user.role === 'employee' && String(user.id) !== String(employeeId)) {
                return new NextResponse(
                    'Acceso denegado: No puedes consultar el calendario de otro empleado.',
                    { status: 403 }
                )
            }
            const scopeAuth = await authorizeStoreScope(user, storeId, supabaseAdmin, {
                allowEmployeeRead: true,
            })
            if (!scopeAuth.authorized) {
                return new NextResponse(scopeAuth.error || 'Acceso denegado.', {
                    status: scopeAuth.status || 403,
                })
            }
            isAuthorized = true
        }

        if (!isAuthorized) {
            return new NextResponse('No autorizado.', { status: 401 })
        }

        // 2. Fetch Store Information (including horarios y modelo DT)
        const isNumStore = /^\d+$/.test(storeId)
        const storeQuery = supabaseAdmin
            .from('stores')
            .select(
                'id, external_id, name, address, city, state, zip_code, phone, opening_time, closing_time, weekly_hours, has_drive_thru'
            )
        const { data: storeData } = isNumStore
            ? await storeQuery.eq('id', Number(storeId)).maybeSingle()
            : await storeQuery.eq('external_id', storeId).maybeSingle()

        if (!storeData) {
            return new NextResponse('Sucursal no encontrada.', { status: 404 })
        }

        const resolvedStoreGuid = storeData.external_id || storeId
        const storeInfo: CalendarStoreInfo = {
            name: storeData.name || 'Tacos Gavilan',
            address: storeData.address || '',
            city: storeData.city || '',
            state: storeData.state || 'CA',
            zip_code: storeData.zip_code || '',
            phone: storeData.phone || '',
        }

        // 3. Fetch Employee Information & Verify Store Membership
        const isUuidEmp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)
        const { data: empData } = await supabaseAdmin
            .from('toast_employees')
            .select('id, toast_guid, first_name, last_name, chosen_name, store_ids')
            .or(
                isUuidEmp
                    ? `id.eq.${employeeId},toast_guid.eq.${employeeId}`
                    : `toast_guid.eq.${employeeId}`
            )
            .maybeSingle()

        if (!empData) {
            return new NextResponse('Empleado no encontrado.', { status: 404 })
        }

        const resolvedEmployeeId = empData.id
        const employeeName =
            `${empData.chosen_name || empData.first_name || ''} ${empData.last_name || ''}`.trim() ||
            'Empleado'

        // 4. Query Published Shifts Strictly Scoped to Store & Employee
        let shiftsQuery = supabaseAdmin
            .from('shifts')
            .select('*')
            .eq('store_id', resolvedStoreGuid)
            .eq('employee_id', resolvedEmployeeId)
            .eq('status', 'published')
            .order('start_time', { ascending: true })

        if (shiftId) {
            shiftsQuery = shiftsQuery.eq('id', shiftId)
        } else {
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
            return new NextResponse(
                'No se encontraron turnos publicados para las fechas especificadas.',
                { status: 404 }
            )
        }

        // 5. Fetch Station Assignments & Catalog for Shared Resolution
        const dates = [...new Set(dbShifts.map((s: any) => s.shift_date))]
        const includeTasksForStore = isStorePilotActiveForActivitiesEmail(storeData)

        const [assignmentsRes, proceduresRes, posActivitiesRes] = await Promise.all([
            supabaseAdmin
                .from('station_assignments')
                .select('assignment_date, main_station, sub_position, tasks, employee_id, store_id')
                .eq('store_id', resolvedStoreGuid)
                .eq('employee_id', resolvedEmployeeId)
                .in('assignment_date', dates),
            includeTasksForStore
                ? supabaseAdmin
                      .from('operating_procedures')
                      .select(
                          'id, activity, description, shift_type, shift, start_time, duration_minutes, frequency, store_model, role, overrides'
                      )
                : Promise.resolve({ data: [] }),
            includeTasksForStore
                ? supabaseAdmin
                      .from('position_activities')
                      .select('id, position_key, activity_id, shift, frequency, store_model')
                : Promise.resolve({ data: [] }),
        ])

        const assignments = assignmentsRes.data || []
        const procedures = proceduresRes.data || []
        const positionActivities = posActivitiesRes.data || []

        // 6. Map Shifts into CalendarShiftItem structure using shared resolution
        const calendarShifts: CalendarShiftItem[] = dbShifts.map((s: any) => {
            const shiftDate = s.shift_date
            const isCallback = Boolean(s.is_callback)

            if (isCallback) {
                return {
                    id: s.id,
                    shift_date: shiftDate,
                    start_time: s.start_time,
                    end_time: s.end_time,
                    position_title: 'AUSENTE / CALLBACK',
                    tasks: [],
                    breaks: [],
                }
            }

            const overlappingPeriods = getShiftOverlappingPeriods(s.start_time, s.end_time)
            const dayAssignments = assignments.filter((a: any) => a.assignment_date === shiftDate)

            const matchedAssignments = dayAssignments.filter((a: any) => {
                const sub = String(a.sub_position || '')
                const main = String(a.main_station || '')
                const isExplicitAM = sub.endsWith('_AM') || main.endsWith('_AM')
                const isExplicitPM = sub.endsWith('_PM') || main.endsWith('_PM')
                if (isExplicitAM) return overlappingPeriods.includes('AM')
                if (isExplicitPM) return overlappingPeriods.includes('PM')
                return true
            })

            const stationLabels: string[] = []
            const stationActivityLists = []

            for (const a of matchedAssignments) {
                const cleanMain = String(a.main_station || '')
                    .replace(/\s*_(AM|PM)$/i, '')
                    .trim()
                const cleanSub = String(a.sub_position || '')
                    .replace(/\s*_(AM|PM)$/i, '')
                    .trim()
                if (!cleanMain) continue
                const label =
                    cleanSub && cleanSub.toLowerCase() !== cleanMain.toLowerCase()
                        ? `${cleanMain} (${cleanSub})`
                        : cleanMain
                if (!stationLabels.includes(label)) {
                    stationLabels.push(label)
                }

                if (includeTasksForStore) {
                    const subRaw = String(a.sub_position || '')
                    const mainRaw = String(a.main_station || '')
                    const posPeriods: Array<'AM' | 'PM'> =
                        subRaw.endsWith('_PM') || mainRaw.endsWith('_PM')
                            ? ['PM']
                            : subRaw.endsWith('_AM') || mainRaw.endsWith('_AM')
                              ? ['AM']
                              : overlappingPeriods.length > 0
                                ? overlappingPeriods
                                : ['AM']

                    for (const assignShift of posPeriods) {
                        stationActivityLists.push(
                            resolveStationActivities({
                                mainStation: cleanMain,
                                subPosition: cleanSub || null,
                                shift: assignShift,
                                businessDateStr: shiftDate,
                                store: storeData,
                                procedures,
                                positionActivities,
                                legacyTasks: Array.isArray(a.tasks) ? a.tasks : [],
                                isCallback: false,
                                shiftStartTime: s.start_time,
                                shiftEndTime: s.end_time,
                                enforceShiftWindow: posPeriods.length > 1,
                                isClosingShift: Boolean((s as any).is_closing || (a as any).is_closing),
                            })
                        )
                    }
                }
            }

            const positionTitle =
                stationLabels.length > 0
                    ? stationLabels.join(' + ')
                    : s.job_title || s.role || ''

            const mergedActivities = includeTasksForStore
                ? mergeAndDeduplicateActivities(stationActivityLists)
                : []

            const formattedTasks = mergedActivities.map((act) =>
                act.effective_start_time
                    ? `[${act.formatted_time}] ${act.title}`
                    : act.title
            )

            return {
                id: s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                position_title: positionTitle,
                tasks: formattedTasks,
                breaks:
                    s.breaks_schedule && Array.isArray(s.breaks_schedule)
                        ? s.breaks_schedule
                        : [],
            }
        })

        // 7. Generate RFC 5545 iCalendar content
        const icsContent = generateScheduleICS({
            store: storeInfo,
            employeeName,
            shifts: calendarShifts,
            calendarName: `Horario ${storeInfo.name}`,
        })

        const safeStoreName = (storeInfo.name || 'Tacos_Gavilan').replace(/[^a-zA-Z0-9_-]/g, '_')
        const filename = `Horario_${safeStoreName}_${startDate || 'semanal'}.ics`

        return new NextResponse(icsContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8; method=PUBLISH',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
            },
        })
    } catch (error: any) {
        console.error('Calendar generation error:', error)
        return new NextResponse(`Error interno: ${error.message}`, { status: 500 })
    }
}

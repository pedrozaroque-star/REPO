/**
 * @module PublishScheduleAPI
 * @description API endpoint para publicar horarios semanales del Planificador, generar vistas previas
 * sin efectos secundarios (`preview_only`), enviar notificaciones por correo y adjuntar calendarios (.ics).
 *
 * @businessRules
 * 1. Autenticación y Autorización Estricta (`A17`):
 *    - Valida identidad desde el JWT del servidor (`getServerUser`) antes de leer credenciales o mutar datos.
 *    - Verifica rol (`admin`, `supervisor`, `manager`, `asistente`) y alcance de sucursal (`authorizeStoreScope`).
 *    - Valida que todos los `shift_ids` pertenezcan a la sucursal y rango de fechas autorizado.
 *    - Elimina el fallback implícito a cuentas personales y nunca borra tokens OAuth de terceros.
 * 2. Modo Vista Previa Pura (`preview_only: true`):
 *    - Calcula exactamente estaciones, actividades con hora efectiva ajustada por sucursal/día, descansos
 *      y HTML del correo sin enviar correos, sin cambiar `status` a `'published'` y sin mutar la base de datos.
 * 3. Resolución Unificada de Actividades y Horarios (`A01–A11`, `A25`):
 *    - Usa `lib/actividades-resolution.ts` y `lib/store-time-offset.ts` (`weekly_hours` + `has_drive_thru`).
 *    - Usa intervalos semiabiertos `[start, end)` con precisión de minutos sobre la jornada laboral 6:00 AM–5:59 AM.
 *    - Respeta `is_callback === true` (Ausente/Callback) como condición excluyente de actividades operativas (`A08`).
 *    - Controla la inclusión operativa de actividades en correos mediante `isStorePilotActiveForActivitiesEmail`
 *      (Slauson activa en piloto; las 15 sucursales 100% soportadas y verificables).
 *
 * @dataFlow
 * - Reads: `stores`, `shifts`, `toast_employees`, `station_assignments`, `position_activities`, `operating_procedures`.
 * - Writes (solo cuando `preview_only !== true`): `shifts.status = 'published'`, `shifts.breaks_schedule`, `schedules` sync.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import path from 'path'
import fs from 'fs'
import { generateSmartForecast } from '@/lib/intelligence'
import { scheduleBreaksWithDemand, LearnedPreference } from '@/lib/breaks-engine'
import {
    generateScheduleICS,
    buildGoogleCalendarUrl,
    buildCalendarApiUrl,
    CalendarStoreInfo,
    CalendarShiftItem,
} from '@/lib/calendar-helper'
import { syncPlannerToSchedules } from '@/lib/sync-planner-to-schedules'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import {
    escapeHtml,
    fetchCompleteRangeAssignments,
    getHourLA,
    getShiftOverlappingPeriods,
    isFreqMatch as sharedIsFreqMatch,
    isStorePilotActiveForActivitiesEmail,
    isValidCalendarDateISO,
    mergeAndDeduplicateActivities,
    normalizeText as sharedNormalizeText,
    ResolvedActivityItem,
    resolveStationActivities,
    sanitizeUnsafeProcedureDescription,
} from '@/lib/actividades-resolution'

// Helper to extract California local hour (0-23) immune to UTC server drift
function getLAHour(d: Date | string): number {
    if (typeof d === 'string') return getHourLA(d)
    const str = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/Los_Angeles',
    })
    const h = parseInt(str, 10)
    return h === 24 ? 0 : h
}

// Helper to translate employee job + station group to standard role keys
function resolvePositionKey(jobTitle: string, stationName?: string, stationGroup?: string): string {
    const title = (jobTitle || '').toLowerCase()

    if (
        title.includes('manager') &&
        !title.includes('asst') &&
        !title.includes('assist') &&
        !title.includes('asistente') &&
        !title.includes('shift')
    ) {
        return 'MANAGER'
    }

    if (title.includes('asst') || title.includes('assist') || title.includes('asistente')) {
        return 'ASSISTANT'
    }

    if (title.includes('shift') || title.includes('leader') || title.includes('encargado')) {
        const group = (stationGroup || '').toLowerCase()
        const station = (stationName || '').toLowerCase()
        const isKitchen =
            group === 'kitchen' ||
            [
                'burritos',
                'tortillas',
                'tacos',
                'carnes',
                'parrilla',
                'preparacion',
                'cubrir descansos (cocina)',
            ].some((s) => station.includes(s))
        return isKitchen ? 'SHIFT_LEADER_MALE' : 'SHIFT_LEADER_FEMALE'
    }

    if (
        title.includes('cook') ||
        title.includes('cocinero') ||
        title.includes('prep') ||
        title.includes('preparador') ||
        title.includes('taquero') ||
        title.includes('tortill')
    ) {
        return 'COOK_MALE'
    }

    if (title.includes('cashier') || title.includes('cajera') || title.includes('cajero')) {
        return 'CASHIER'
    }

    const group = (stationGroup || '').toLowerCase()
    if (group === 'kitchen') {
        return 'COOK_MALE'
    }
    return 'CASHIER'
}

function mapRoleKeyToCatalogPositionKey(roleKey: string): { mainStation: string; subPosition: string | null } {
    switch (roleKey) {
        case 'MANAGER':
            return { mainStation: 'MANAGER', subPosition: 'LIDERAZGO|Manager' }
        case 'ASSISTANT':
            return { mainStation: 'ASSISTANT', subPosition: 'LIDERAZGO|Asistente de Manager' }
        case 'SHIFT_LEADER_MALE':
            return { mainStation: 'SHIFT_LEADER_MALE', subPosition: 'LIDERAZGO|Shift Leader' }
        case 'SHIFT_LEADER_FEMALE':
            return { mainStation: 'SHIFT_LEADER_FEMALE', subPosition: 'LIDERAZGO|Shift Leader' }
        case 'COOK_MALE':
            return { mainStation: 'TACOS', subPosition: null }
        case 'CASHIER':
            return { mainStation: 'Caja 1 / Salón', subPosition: null }
        default:
            return { mainStation: roleKey, subPosition: null }
    }
}

function normalizeText(text: string): string {
    return sharedNormalizeText(text)
}

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

// Función para obtener transporte OAuth2 de Gmail (ESTRICTO: Solo usuario autenticado o cuenta corporativa explícita)
async function getTransporter(authenticatedUserId: string) {
    if (!authenticatedUserId) {
        throw new Error('Usuario no identificado. No se pueden enviar correos anónimos.')
    }

    const { data: user, error } = await supabase
        .from('users')
        .select('id, email, google_refresh_token, google_email_connected')
        .eq('id', authenticatedUserId)
        .maybeSingle()

    if (error) {
        console.error('❌ [API] DB Error fetching user OAuth credentials:', error)
    }

    let targetUser = user
    const delegatedCorporateUserId = process.env.CORPORATE_SCHEDULE_SENDER_USER_ID?.trim()

    if ((!targetUser?.google_refresh_token || !targetUser?.google_email_connected) && delegatedCorporateUserId) {
        const { data: corpUser } = await supabase
            .from('users')
            .select('id, email, google_refresh_token, google_email_connected')
            .eq('id', delegatedCorporateUserId)
            .maybeSingle()
        if (corpUser?.google_refresh_token && corpUser?.google_email_connected) {
            console.log(
                `ℹ️ [API] Using explicitly configured corporate sender (${corpUser.google_email_connected}) on behalf of user ${authenticatedUserId}`
            )
            targetUser = corpUser
        }
    }

    if (targetUser?.google_refresh_token && targetUser?.google_email_connected) {
        try {
            const tokenUrl = 'https://oauth2.googleapis.com/token'
            const params = new URLSearchParams()
            params.append('client_id', process.env.GOOGLE_CLIENT_ID!)
            params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!)
            params.append('refresh_token', targetUser.google_refresh_token)
            params.append('grant_type', 'refresh_token')

            const refreshRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
            })

            if (!refreshRes.ok) {
                const errData = await refreshRes.json()
                console.error('❌ [API] Failed to refresh token:', errData)
                throw new Error(`Token Refresh Failed: ${errData.error_description || errData.error}`)
            }

            const tokens = await refreshRes.json()
            const accessToken = tokens.access_token

            const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
            })
            const profile = await profileRes.json()
            const realEmail = profile.email || targetUser.google_email_connected

            return {
                accessToken,
                fromEmail: realEmail,
            }
        } catch (e) {
            console.error('❌ [API] Critical Auth Error during refresh:', e)
            throw new Error('GMAIL_AUTH_FAILED: ' + (e as Error).message)
        }
    }

    throw new Error('GMAIL_AUTH_FAILED: GMAIL_NOT_CONNECTED')
}

export async function POST(req: Request) {
    try {
        // 0. AUTENTICACIÓN Y AUTORIZACIÓN OBLIGATORIA ANTES DE CUALQUIER EFECTO SECUNDARIO (A17)
        const authUser = await getServerUser(req)
        if (!authUser) {
            return NextResponse.json(
                { error: 'No autenticado. Inicia sesión para publicar o previsualizar horarios.' },
                { status: 401 }
            )
        }

        const body = await req.json()
        const { store_id, start_date, end_date } = body
        const previewOnly = Boolean(body.preview_only)

        if (!store_id || !start_date || !end_date) {
            return NextResponse.json(
                { error: 'Missing required fields: store_id, start_date, end_date' },
                { status: 400 }
            )
        }

        if (
            !isValidCalendarDateISO(String(start_date).trim()) ||
            !isValidCalendarDateISO(String(end_date).trim()) ||
            String(start_date).trim() > String(end_date).trim()
        ) {
            return NextResponse.json(
                { error: 'Rango de fechas inválido: start_date y end_date deben ser fechas reales YYYY-MM-DD con start_date <= end_date.' },
                { status: 400 }
            )
        }

        const scopeAuth = await authorizeStoreScope(authUser, store_id, supabase, {
            requireWrite: !previewOnly,
            action: previewOnly ? 'view' : 'publish_schedule',
            allowedRoles: previewOnly
                ? ['admin', 'supervisor', 'manager', 'asistente', 'assistant', 'shift_leader', 'shift leader', 'shiftleader']
                : ['admin', 'supervisor', 'manager', 'asistente', 'assistant'],
        })
        if (!scopeAuth.authorized) {
            return NextResponse.json(
                { error: scopeAuth.error || 'No tienes permiso sobre esta sucursal.' },
                { status: scopeAuth.status || 403 }
            )
        }

        // Resolver tienda y configuración horaria / Drive-Thru (A02, A09)
        const isNumericStore = /^\d+$/.test(String(store_id).trim())
        const storeQuery = supabase
            .from('stores')
            .select(
                'id, external_id, name, address, city, state, zip_code, phone, opening_time, closing_time, weekly_hours, has_drive_thru'
            )
        const { data: store } = isNumericStore
            ? await storeQuery.eq('id', Number(store_id)).maybeSingle()
            : await storeQuery.eq('external_id', String(store_id).trim()).maybeSingle()

        if (!store) {
            return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 })
        }

        const resolvedStoreGuid = store.external_id || String(store_id).trim()
        const storeName = store.name || 'Tu Equipo'
        const hasDT = Boolean(store.has_drive_thru)

        // Validar pertenencia estricta de shift_ids antes de cualquier mutación (A17)
        const requestedShiftIds: string[] = Array.isArray(body.shift_ids)
            ? body.shift_ids.map((id: any) => String(id).trim()).filter(Boolean)
            : []

        if (requestedShiftIds.length > 0) {
            const { data: verifiedShifts, error: verifyErr } = await supabase
                .from('shifts')
                .select('id, store_id, shift_date')
                .in('id', requestedShiftIds)

            if (verifyErr) {
                return NextResponse.json(
                    { error: 'Error verificando shift_ids: ' + verifyErr.message },
                    { status: 500 }
                )
            }

            const invalidShift = (verifiedShifts || []).find(
                (s: any) =>
                    String(s.store_id) !== resolvedStoreGuid ||
                    String(s.shift_date) < String(start_date) ||
                    String(s.shift_date) > String(end_date)
            )

            if (
                invalidShift ||
                (verifiedShifts || []).length !== requestedShiftIds.length
            ) {
                return NextResponse.json(
                    {
                        error: 'Acceso denegado: Uno o más shift_ids no pertenecen a la sucursal o semana autorizada.',
                    },
                    { status: 403 }
                )
            }
        }

        // 1. Obtener credenciales de envío SOLO si no es preview_only
        let accessToken = ''
        let fromEmail = authUser.email

        if (!previewOnly) {
            const creds = await getTransporter(authUser.id)
            accessToken = creds.accessToken
            fromEmail = creds.fromEmail
        }

        // 2. Actualizar estado a 'published' SOLO cuando no es preview_only y con scope estricto de tienda/rango
        if (!previewOnly && requestedShiftIds.length > 0) {
            const { error: ensureError } = await supabase
                .from('shifts')
                .update({ status: 'published' })
                .eq('store_id', resolvedStoreGuid)
                .gte('shift_date', start_date)
                .lte('shift_date', end_date)
                .in('id', requestedShiftIds)

            if (ensureError) {
                console.error('❌ [API] Failed to ensure publish status:', ensureError)
                return NextResponse.json(
                    { error: 'No se pudieron actualizar los turnos a estado publicado.' },
                    { status: 500 }
                )
            }
        }

        // Consultar turnos del periodo (en preview_only incluye borradores para previsualizar antes de publicar)
        let query = supabase
            .from('shifts')
            .select('*')
            .eq('store_id', resolvedStoreGuid)
            .gte('shift_date', start_date)
            .lte('shift_date', end_date)

        if (!previewOnly) {
            query = query.eq('status', 'published')
        }
        if (requestedShiftIds.length > 0) {
            query = query.in('id', requestedShiftIds)
        }

        const { data: shifts, error: shiftError } = await query

        if (shiftError) {
            console.error('❌ [API] Error querying shifts:', shiftError)
            return NextResponse.json(
                { success: false, error: 'Database error fetching shifts: ' + shiftError.message },
                { status: 500 }
            )
        }

        if (!shifts || shifts.length === 0) {
            return NextResponse.json({
                success: true,
                preview_only: previewOnly,
                stats: { email: 0, errors: 0 },
                previews: [],
                message: 'No shifts found for the specified store and date range',
            })
        }

        // Sincronizar turnos de liderazgo solo en publicación real (nunca en preview_only)
        if (!previewOnly) {
            try {
                await syncPlannerToSchedules({
                    storeExternalId: resolvedStoreGuid,
                    startDate: start_date,
                    endDate: end_date,
                    customClient: supabase,
                })
            } catch (syncErr: any) {
                console.error('⚠️ [API] Advertencia no bloqueante al sincronizar Horarios:', syncErr.message)
            }
        }

        // 3. Identify Employees (validando que pertenezcan a los turnos de la sucursal)
        const shiftEmployeeIds = new Set(shifts.map((s: any) => String(s.employee_id)).filter(Boolean))
        let targetEmployeeIds: string[] = []
        if (body.employee_ids && Array.isArray(body.employee_ids) && body.employee_ids.length > 0) {
            targetEmployeeIds = body.employee_ids
                .map((id: any) => String(id).trim())
                .filter((id: string) => shiftEmployeeIds.has(id))
        } else {
            targetEmployeeIds = Array.from(shiftEmployeeIds)
        }

        if (targetEmployeeIds.length === 0) {
            return NextResponse.json({
                success: true,
                preview_only: previewOnly,
                previews: [],
                message: 'No employees to notify in this store scope',
            })
        }

        // 4. Fetch Employee Contact Info, Station Assignments (paginated fail-closed), Catalog & Position Mappings
        const [empRes, assignRes, jobsRes, overridesRes, posActRes, procRes] = await Promise.all([
            supabase.from('toast_employees').select('*').in('id', targetEmployeeIds),
            fetchCompleteRangeAssignments<Record<string, unknown>>({
                pageSize: 1000,
                maxRows: 25000,
                fetchPage: async (offset, limit) => {
                    const res = await supabase
                        .from('station_assignments')
                        .select('*', { count: 'exact' })
                        .eq('store_id', resolvedStoreGuid)
                        .gte('assignment_date', start_date)
                        .lte('assignment_date', end_date)
                        .order('id', { ascending: true })
                        .range(offset, offset + limit - 1)
                    return {
                        data: res.data || null,
                        error: res.error ? { message: res.error.message } : null,
                        count: res.count,
                    }
                },
            }),
            supabase.from('toast_jobs').select('*'),
            supabase.from('break_manual_overrides').select('*').eq('store_id', resolvedStoreGuid),
            supabase
                .from('position_activities')
                .select('id, position_key, activity_id, shift, frequency, store_model'),
            supabase
                .from('operating_procedures')
                .select(
                    'id, activity, description, start_time, duration_minutes, shift_type, shift, frequency, store_model, role, overrides'
                ),
        ])

        if (empRes.error) throw empRes.error
        if (assignRes.error || !assignRes.isComplete) {
            throw new Error(
                assignRes.error?.message ||
                    `Lectura paginada incompleta de station_assignments (${assignRes.incompletenessReason || 'UNKNOWN'}).`
            )
        }
        if (posActRes.error) throw posActRes.error
        if (procRes.error) throw procRes.error

        const employees = empRes.data || []
        const stationAssignments = assignRes.data || []
        const allJobs = jobsRes.data || []
        const storeOverrides = overridesRes.data || []
        const positionActivities = posActRes.data || []
        const allProcedures = procRes.data || []

        // 5. SMART BREAKS GENERATION (solo muta DB cuando previewOnly === false)
        const learnedPrefs: LearnedPreference[] = storeOverrides.map((o: any) => ({
            role: o.role,
            day_of_week: o.day_of_week,
            break_type: o.break_type,
            break_index: o.break_index,
            offset_from_start_min: o.offset_from_start_min,
            shift_duration_min: o.shift_duration_min,
            peak_hour: o.peak_hour,
        }))

        if (!previewOnly && shifts.length > 0) {
            const datesToProcess = [...new Set(shifts.map((s: any) => s.shift_date))]
            for (const dateStr of datesToProcess) {
                try {
                    const { data: dayShifts } = await supabase
                        .from('shifts')
                        .select('*')
                        .eq('store_id', resolvedStoreGuid)
                        .eq('shift_date', dateStr)
                    if (!dayShifts) continue

                    const { hours: hoursToDraw } = await generateSmartForecast(resolvedStoreGuid, dateStr)
                    const dayEmpIds = [...new Set(dayShifts.map((s: any) => s.employee_id).filter(Boolean))]
                    const { data: dayEmployees } = await supabase
                        .from('toast_employees')
                        .select('*')
                        .in('id', dayEmpIds)

                    const shiftsForAi = dayShifts
                        .filter((s: any) => s.is_callback !== true)
                        .map((s: any) => {
                            const emp = (dayEmployees || []).find(
                                (e: any) => e.id === s.employee_id || e.toast_guid === s.employee_toast_guid
                            )
                            let extTitle = ''
                            if (emp?.job_references?.[0]) {
                                const job = allJobs.find((j: any) => j.guid === emp.job_references[0].guid)
                                if (job) extTitle = job.title
                            }
                            if (!extTitle && s.job_id) {
                                const shiftJob = allJobs.find(
                                    (j: any) => j.guid === s.job_id || String(j.id) === String(s.job_id)
                                )
                                if (shiftJob) extTitle = shiftJob.title
                            }

                            const titleLower = extTitle.toLowerCase()
                            const empNameLower = emp
                                ? `${emp.first_name} ${emp.last_name}`.toLowerCase()
                                : ''
                            const isLeader =
                                titleLower.includes('manager') ||
                                titleLower.includes('asst') ||
                                titleLower.includes('shift') ||
                                titleLower.includes('lead') ||
                                titleLower.includes('asistente') ||
                                titleLower.includes('assistant') ||
                                titleLower.includes('encargado') ||
                                empNameLower.includes('alberto romero') ||
                                empNameLower.includes('manager')

                            return { ...s, is_leader: isLeader, job_title: extTitle }
                        })

                    const augmented = scheduleBreaksWithDemand(
                        shiftsForAi as any,
                        hoursToDraw || [],
                        learnedPrefs
                    )

                    for (const aug of augmented) {
                        const originalIdx = shifts.findIndex((ls: any) => ls.id === aug.id)
                        if (originalIdx !== -1) {
                            shifts[originalIdx].breaks_schedule = aug.breaks_schedule
                            await supabase
                                .from('shifts')
                                .update({ breaks_schedule: aug.breaks_schedule })
                                .eq('id', aug.id)
                                .eq('store_id', resolvedStoreGuid)
                        }
                    }
                } catch (e) {
                    console.error(`❌ [API] Error filling breaks for ${dateStr}:`, e)
                }
            }
        }

        // Control de piloto por tienda (Slauson activo en producción; en preview_only permite previsualizar cualquier tienda)
        const isPilotStoreActive = isStorePilotActiveForActivitiesEmail(store)
        const isActivitiesEnabled =
            isPilotStoreActive || (previewOnly && body.include_activities_preview !== false)

        const results = { email: 0, errors: 0 }
        const employeePreviews: any[] = []

        const isFreqMatch = (paFrequency: string, dayIdxOrDate: string | number): boolean => {
            return sharedIsFreqMatch(paFrequency, dayIdxOrDate)
        }

        // Función común para resolver puestos y actividades de un turno (compartida por correo, preview y calendario)
        const resolveShiftContext = (emp: any, s: any) => {
            const dayStr = s.shift_date
            const isCallback = Boolean(s.is_callback)

            const job = allJobs.find(
                (j: any) =>
                    j.id === s.job_id ||
                    String(j.guid) === String(s.job_id) ||
                    String(j.id) === String(s.job_id)
            )
            const jobTitle = job?.title || s.job_title || s.role || ''

            // Regla A08: Ausente/Callback es mutuamente excluyente con actividades y roles de trabajo
            if (isCallback) {
                return {
                    isCallback: true,
                    stationDisplay: 'AUSENTE / CALLBACK',
                    positionBadgeHtml: `
                        <div style="margin-top: 4px; font-size: 13px; font-weight: 800; color: #dc2626; background: #fef2f2; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #fee2e2;">
                            AUSENTE / CALLBACK
                        </div>
                    `,
                    tasksHtml: '',
                    resolvedActivities: [] as ResolvedActivityItem[],
                    calendarTaskStrings: [] as string[],
                    overlappingPeriods: [] as Array<'AM' | 'PM'>,
                }
            }

            // Regla A06: Intersección de turno con precisión de minutos [start, end)
            const overlappingPeriods = getShiftOverlappingPeriods(s.start_time, s.end_time)
            const effectivePeriods: Array<'AM' | 'PM'> =
                overlappingPeriods.length > 0
                    ? overlappingPeriods
                    : [getLAHour(new Date(s.start_time)) >= 17 ? 'PM' : 'AM']

            const myPositions = stationAssignments.filter((a: any) => {
                if (a.employee_id !== emp.id || a.assignment_date !== dayStr) return false
                const sub = String(a.sub_position || '')
                const main = String(a.main_station || '')
                const isExplicitAM = sub.endsWith('_AM') || main.endsWith('_AM')
                const isExplicitPM = sub.endsWith('_PM') || main.endsWith('_PM')
                if (isExplicitAM) return effectivePeriods.includes('AM')
                if (isExplicitPM) return effectivePeriods.includes('PM')
                return true
            })

            const cleanStationLabels: string[] = []
            for (const pos of myPositions) {
                const cleanMain = String(pos.main_station || '')
                    .replace(/\s*_(AM|PM)$/i, '')
                    .trim()
                const cleanSub = String(pos.sub_position || '')
                    .replace(/\s*_(AM|PM)$/i, '')
                    .trim()
                const label =
                    cleanSub && cleanSub.toLowerCase() !== cleanMain.toLowerCase()
                        ? `${cleanMain} (${cleanSub})`
                        : cleanMain
                if (label && !cleanStationLabels.includes(label)) {
                    cleanStationLabels.push(label)
                }
            }

            let stationDisplay =
                cleanStationLabels.length > 0 ? cleanStationLabels.join(' + ') : jobTitle
            let positionBadgeHtml = ''

            if (stationDisplay) {
                positionBadgeHtml = `
                    <div style="margin-top: 4px; font-size: 13px; font-weight: 800; color: #4f46e5; background: #eef2ff; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #c7d2fe;">
                        <span style="font-size: 10px; color: #6366f1; text-transform: uppercase;">Puesto:</span> ${escapeHtml(stationDisplay)}
                    </div>
                `
            }

            let resolvedActivities: ResolvedActivityItem[] = []

            if (isActivitiesEnabled) {
                if (myPositions.length > 0) {
                    const stationLists: ResolvedActivityItem[][] = []
                    for (const pos of myPositions) {
                        const subRaw = String(pos.sub_position || '')
                        const mainRaw = String(pos.main_station || '')
                        const cleanMain = mainRaw.replace(/\s*_(AM|PM)$/i, '').trim()
                        const cleanSub = subRaw.replace(/\s*_(AM|PM)$/i, '').trim()

                        const posPeriods: Array<'AM' | 'PM'> =
                            subRaw.endsWith('_PM') || mainRaw.endsWith('_PM')
                                ? ['PM']
                                : subRaw.endsWith('_AM') || mainRaw.endsWith('_AM')
                                  ? ['AM']
                                  : effectivePeriods

                        for (const pShift of posPeriods) {
                            stationLists.push(
                                resolveStationActivities({
                                    mainStation: cleanMain,
                                    subPosition: cleanSub || null,
                                    shift: pShift,
                                    businessDateStr: dayStr,
                                    store,
                                    procedures: allProcedures,
                                    positionActivities,
                                    legacyTasks: Array.isArray(pos.tasks) ? pos.tasks : [],
                                    isCallback: false,
                                    shiftStartTime: s.start_time,
                                    shiftEndTime: s.end_time,
                                    enforceShiftWindow: true,
                                    isClosingShift: Boolean(pos.is_closing),
                                })
                            )
                        }
                    }
                    resolvedActivities = mergeAndDeduplicateActivities(stationLists)
                } else if (jobTitle) {
                    // Fallback por rol de Toast cuando no hay estación manual asignada (solo si no es ausente)
                    const roleKey = resolvePositionKey(jobTitle, undefined, undefined)
                    const mappedStation = mapRoleKeyToCatalogPositionKey(roleKey)

                    const getFriendlyRoleName = (key: string): string => {
                        switch (key) {
                            case 'MANAGER':
                                return 'Gerente / Manager'
                            case 'ASSISTANT':
                                return 'Asistente / Assistant'
                            case 'SHIFT_LEADER_MALE':
                                return 'Shift Leader - Cocina'
                            case 'SHIFT_LEADER_FEMALE':
                                return 'Shift Leader - Servicio'
                            case 'COOK_MALE':
                                return 'Cocinero / Cook'
                            case 'CASHIER':
                                return 'Cajera / Cashier'
                            default:
                                return 'Colaborador'
                        }
                    }

                    const displayRoleName = getFriendlyRoleName(roleKey)
                    stationDisplay = displayRoleName
                    positionBadgeHtml = `
                        <div style="margin-top: 4px; font-size: 13px; font-weight: 800; color: #0f766e; background: #f0fdfa; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #99f6e4;">
                            <span style="font-size: 10px; color: #0d9488; text-transform: uppercase;">Rol:</span> ${escapeHtml(displayRoleName)}
                        </div>
                    `

                    const roleLists: ResolvedActivityItem[][] = []
                    for (const pShift of effectivePeriods) {
                        roleLists.push(
                            resolveStationActivities({
                                mainStation: mappedStation.mainStation,
                                subPosition: mappedStation.subPosition,
                                shift: pShift,
                                businessDateStr: dayStr,
                                store,
                                procedures: allProcedures,
                                positionActivities,
                                legacyTasks: [],
                                isCallback: false,
                                shiftStartTime: s.start_time,
                                shiftEndTime: s.end_time,
                                enforceShiftWindow: true,
                            })
                        )
                    }
                    resolvedActivities = mergeAndDeduplicateActivities(roleLists)
                }
            }

            let tasksHtml = ''
            if (resolvedActivities.length > 0) {
                const tasksList = resolvedActivities
                    .map((act) => {
                        const safeTitle = escapeHtml(sanitizeUnsafeProcedureDescription(act.title || ''))
                        const safeFormattedTime = escapeHtml(act.formatted_time || '')
                        const safeDescText = sanitizeUnsafeProcedureDescription(act.description || '')
                        const timePrefix = act.effective_start_time
                            ? `<strong style="color: #ea580c;">${safeFormattedTime}</strong> — `
                            : ''
                        const multiStationSuffix =
                            act.source_stations.length > 1
                                ? ` <span style="font-size: 9px; color: #64748b;">(${escapeHtml(act.source_stations.join(', '))})</span>`
                                : ''
                        const descHtml = safeDescText
                            ? `<div style="font-size: 10px; font-weight: 500; color: #64748b; margin-top: 2px; line-height: 1.35;">${escapeHtml(safeDescText)}</div>`
                            : ''
                        return `<li style="font-size: 11px; color: #4b5563; margin-bottom: 5px;">${timePrefix}${safeTitle}${multiStationSuffix}${descHtml}</li>`
                    })
                    .join('')

                tasksHtml = `
                    <div style="margin-top: 8px; text-align: left; background: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 800; margin-bottom: 4px;">Actividades Asignadas:</div>
                        <ul style="margin: 0; padding-left: 16px; font-weight: 600; font-size: 11px;">
                            ${tasksList}
                        </ul>
                    </div>
                `
            }

            const calendarTaskStrings = resolvedActivities.map((act) => {
                const safeTitle = sanitizeUnsafeProcedureDescription(act.title || '')
                const safeDesc = sanitizeUnsafeProcedureDescription(act.description || '')
                const base = act.effective_start_time ? `[${act.formatted_time}] ${safeTitle}` : safeTitle
                return safeDesc ? `${base}: ${safeDesc}` : base
            })

            return {
                isCallback: false,
                stationDisplay,
                positionBadgeHtml,
                tasksHtml,
                resolvedActivities,
                calendarTaskStrings,
                overlappingPeriods: effectivePeriods,
            }
        }

        const processChunk = async (chunk: any[]) => {
            const promises = chunk.map(async (emp: any) => {
                const empShifts = shifts
                    .filter((s: any) => s.employee_id === emp.id)
                    .sort(
                        (a: any, b: any) =>
                            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
                    )

                if (empShifts.length === 0) return

                const shiftContexts = new Map<string, ReturnType<typeof resolveShiftContext>>()
                for (const s of empShifts) {
                    shiftContexts.set(String(s.id), resolveShiftContext(emp, s))
                }

                // Prepare structured shifts for iCalendar generation (A10: incluye estaciones y tareas resueltas)
                const calendarShifts: CalendarShiftItem[] = empShifts.map((s: any) => {
                    const ctx = shiftContexts.get(String(s.id))!
                    return {
                        id: s.id,
                        shift_date: s.shift_date,
                        start_time: s.start_time,
                        end_time: s.end_time,
                        position_title: ctx.stationDisplay,
                        tasks: ctx.calendarTaskStrings,
                        breaks:
                            !ctx.isCallback &&
                            s.breaks_schedule &&
                            Array.isArray(s.breaks_schedule)
                                ? s.breaks_schedule
                                : [],
                    }
                })

                const storeInfo: CalendarStoreInfo = {
                    name: storeName,
                    address: store?.address || '',
                    city: store?.city || '',
                    state: store?.state || 'CA',
                    zip_code: store?.zip_code || '',
                    phone: store?.phone || '',
                }

                const empFullName =
                    `${emp.chosen_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() ||
                    'Empleado'

                const icsContent = generateScheduleICS({
                    store: storeInfo,
                    employeeName: empFullName,
                    shifts: calendarShifts,
                    calendarName: `Horario ${storeName}`,
                })

                const appBaseUrl =
                    process.env.NEXT_PUBLIC_APP_URL ||
                    (process.env.VERCEL_URL
                        ? `https://${process.env.VERCEL_URL}`
                        : 'https://tacosgavilan.vercel.app')

                // A20: Enlace de calendario firmado con token HMAC acotado a empleado/tienda/rango
                const calendarDownloadUrl = buildCalendarApiUrl({
                    baseUrl: appBaseUrl,
                    employeeId: emp.id,
                    storeId: resolvedStoreGuid,
                    startDate: start_date,
                    endDate: end_date,
                })

                // Build shift rows for email table
                const shiftRows = empShifts
                    .map((s: any) => {
                        const startDate = new Date(s.start_time)
                        const endDate = new Date(s.end_time)
                        const ctx = shiftContexts.get(String(s.id))!

                        // Usar la fecha operativa del turno (s.shift_date) para evitar desfase por inicio en madrugada
                        const businessDayAnchor = new Date(`${s.shift_date}T12:00:00Z`)
                        const dayName = businessDayAnchor.toLocaleDateString('es-US', {
                            weekday: 'long',
                            timeZone: 'UTC',
                        })
                        const dayNum = businessDayAnchor.toLocaleDateString('es-US', {
                            day: 'numeric',
                            timeZone: 'UTC',
                        })
                        const month = businessDayAnchor.toLocaleDateString('es-US', {
                            month: 'short',
                            timeZone: 'UTC',
                        })
                        const start = startDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                            timeZone: 'America/Los_Angeles',
                        })
                        const end = endDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                            timeZone: 'America/Los_Angeles',
                        })

                        const positionBadge = ctx.positionBadgeHtml
                        const tasksHtml = ctx.tasksHtml

                        let breaksHtml = ''
                        if (
                            !ctx.isCallback &&
                            s.breaks_schedule &&
                            Array.isArray(s.breaks_schedule) &&
                            s.breaks_schedule.length > 0
                        ) {
                            const list = s.breaks_schedule
                                .map((b: any) => {
                                    const bTime = new Date(b.start_time).toLocaleTimeString(
                                        'en-US',
                                        {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                            hour12: true,
                                            timeZone: 'America/Los_Angeles',
                                        }
                                    )
                                    const bName = b.type === 'meal_30' ? 'Almuerzo' : 'Descanso'
                                    const bColor = b.type === 'meal_30' ? '#d97706' : '#059669'
                                    return `<span style="display: inline-block; font-size: 11px; background: ${bColor}10; color: ${bColor}; padding: 2px 6px; border-radius: 4px; margin: 2px; font-weight: 700;">${bName}: ${bTime}</span>`
                                })
                                .join(' ')

                            breaksHtml = `
                                <div style="margin-top: 10px; border-top: 1px dashed #e5e7eb; pt: 8px;">
                                    <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; margin-bottom: 4px;">Breaks Programados:</div>
                                    ${list}
                                </div>
                            `
                        }

                        const detailLines = [
                            `Turno de trabajo en Tacos Gavilan ${storeName}.`,
                            `Horario: ${start} - ${end}`,
                            ...(ctx.stationDisplay ? [`Posición: ${ctx.stationDisplay}`] : []),
                            ...(ctx.calendarTaskStrings.length > 0
                                ? [`Actividades:\n• ${ctx.calendarTaskStrings.join('\n• ')}`]
                                : []),
                        ]

                        const singleGoogleCalUrl = buildGoogleCalendarUrl({
                            title: `🌮 Turno Tacos Gavilan - ${storeName}${ctx.stationDisplay ? ` (${ctx.stationDisplay})` : ''}`,
                            details: detailLines.join('\n'),
                            location: `${storeName}, ${store?.address || ''}, ${store?.city || ''}, CA ${store?.zip_code || ''}`
                                .replace(/,\s*,/g, ',')
                                .trim(),
                            startTime: s.start_time,
                            endTime: s.end_time,
                        })

                        return `
                            <tr>
                                <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #4f46e5; text-transform: capitalize;">
                                    ${dayName}<br>
                                    <span style="font-size: 24px; font-weight: 800; color: #1f2937;">${dayNum}</span>
                                    <span style="font-size: 12px; color: #6b7280; text-transform: uppercase; margin-left: 4px;">${month}</span>
                                </td>
                                <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 16px; font-weight: 600; color: #1f2937;">
                                    <div>${start} - ${end}</div>
                                    ${positionBadge}
                                    ${tasksHtml}
                                    ${breaksHtml}
                                    <div style="margin-top: 10px;">
                                        <a href="${escapeHtml(singleGoogleCalUrl)}" target="_blank" style="display: inline-block; font-size: 11px; font-weight: 700; color: #4338ca; background: #e0e7ff; padding: 4px 10px; border-radius: 6px; text-decoration: none; border: 1px solid #c7d2fe;">
                                            📅 Google Calendar
                                        </a>
                                    </div>
                                </td>
                            </tr>
                        `
                    })
                    .join('')

                const fullHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Tu Nuevo Horario</title>
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
                        <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                                    <img src="cid:logo" alt="Logo" style="display: block; margin: 0 auto 20px auto; width: 80px; height: auto;" />
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800;">📅 Tu Nuevo Horario</h1>
                                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${escapeHtml(storeName)}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px 20px 30px;">
                                    <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 24px;">¡Hola, ${escapeHtml(emp.first_name || '')}! 👋</h2>
                                    <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">El Gerente (${escapeHtml(fromEmail || '')}) ha publicado tus turnos:</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 0 30px 20px 30px;">
                                    <div style="background: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%); border: 2px solid #bfdbfe; border-radius: 16px; padding: 22px 20px; text-align: center;">
                                        <div style="font-size: 17px; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
                                            📲 Sincroniza tus Turnos con tu Teléfono
                                        </div>
                                        <p style="margin: 0 0 16px 0; color: #2563eb; font-size: 13px; font-weight: 600; line-height: 1.4;">
                                            Agrega todos tus turnos de la semana al calendario de tu <strong>iPhone</strong> o <strong>Android</strong> con alarmas automáticas 1 hora antes de cada turno.
                                        </p>
                                        <table role="presentation" style="margin: 0 auto; border-collapse: collapse;">
                                            <tr>
                                                <td style="border-radius: 12px; background: #2563eb; text-align: center; box-shadow: 0 4px 12px rgba(37,99,235,0.35);">
                                                    <a href="${escapeHtml(calendarDownloadUrl)}" target="_blank" style="display: inline-block; padding: 13px 26px; font-size: 14px; font-weight: 800; color: #ffffff; text-decoration: none; border-radius: 12px; letter-spacing: 0.3px;">
                                                        📲 Agregar a mi Calendario (iPhone / Android)
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                        <div style="margin-top: 12px; font-size: 11px; color: #64748b; font-weight: 500;">
                                            💡 También puedes abrir el archivo adjunto <strong>.ics</strong> para importar todos los turnos directamente.
                                        </div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 0 30px 20px 30px;">
                                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 16px; overflow: hidden; border: 2px solid #e5e7eb;">
                                        <thead>
                                            <tr style="background: #f3f4f6;">
                                                <th style="padding:16px; text-align: left; font-size: 14px; color: #374151;">Día</th>
                                                <th style="padding:16px; text-align: center; font-size: 14px; color: #374151;">Horario y Descansos</th>
                                            </tr>
                                        </thead>
                                        <tbody>${shiftRows}</tbody>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 0 30px 40px 30px;">
                                    <div style="background: #fffbeb; border: 2px solid #fcd34d; border-radius: 12px; padding: 20px; text-align: center;">
                                        <p style="margin: 0; color: #92400e; font-size: 16px; font-weight: 800; line-height: 1.5;">
                                            ⚠️ AVISO IMPORTANTE:<br>
                                            Los horarios de breaks (descansos) y lunches (almuerzos) son una guía inicial y <span style="text-decoration: underline;">podrán cambiar</span> de acuerdo a las necesidades operativas del restaurante y el flujo de clientes.
                                        </p>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 30px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                                    <p style="margin: 0; color: #9ca3af; font-size: 13px;">Enviado por ${escapeHtml(fromEmail || '')} a través de Sistema de Monitoreo Tacos Gavilan.</p>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `

                if (previewOnly) {
                    const mappedShiftsPreview = empShifts.map((s: any) => {
                        const ctx = shiftContexts.get(String(s.id))!
                        const mappedActs = (ctx.resolvedActivities || []).map((act) => ({
                            ...act,
                            activity: act.title,
                            adjustedTime: act.formatted_time,
                        }))
                        return {
                            shift_id: s.id,
                            shift_date: s.shift_date,
                            date: s.shift_date,
                            start_time: s.start_time,
                            startTime: s.start_time,
                            end_time: s.end_time,
                            endTime: s.end_time,
                            is_callback: ctx.isCallback,
                            isCallback: ctx.isCallback,
                            station_display: ctx.stationDisplay,
                            position: ctx.stationDisplay,
                            stations: ctx.stationDisplay ? [ctx.stationDisplay] : [],
                            overlapping_periods: ctx.overlappingPeriods,
                            activities: mappedActs,
                        }
                    })
                    employeePreviews.push({
                        employee_id: emp.id,
                        employeeId: emp.id,
                        employee_name: empFullName,
                        employeeName: empFullName,
                        email: emp.email || null,
                        calendar_download_url: calendarDownloadUrl,
                        shifts: mappedShiftsPreview,
                        html_preview: fullHtml,
                    })
                    return
                }

                // Prepare Attachments Safely (Logo + Native .ics Calendar File)
                const attachments: any[] = []
                const logoPath = path.join(process.cwd(), 'public', 'logo.png')
                if (fs.existsSync(logoPath)) {
                    attachments.push({
                        filename: 'logo.png',
                        path: logoPath,
                        cid: 'logo',
                    })
                }

                const safeStoreName = (storeName || 'Tacos_Gavilan')
                    .replace(/\s+/g, '_')
                    .replace(/[^a-zA-Z0-9_-]/g, '')
                attachments.push({
                    filename: `Horario_${safeStoreName}_${start_date}.ics`,
                    content: icsContent,
                    contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
                })

                const mailOptions = {
                    from: `"${storeName} Schedule" <${fromEmail}>`,
                    to: emp.email,
                    subject: `📅 Horario: ${storeName}`,
                    html: fullHtml,
                    attachments,
                }

                if (emp.email) {
                    try {
                        const compiler = nodemailer.createTransport({
                            streamTransport: true,
                            newline: 'windows',
                        })
                        const info = await compiler.sendMail(mailOptions)

                        const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                            const message = info.message as any
                            if (Buffer.isBuffer(message)) return resolve(message)
                            if (typeof message.pipe === 'function') {
                                const chunks: Buffer[] = []
                                message.on('data', (chunk: Buffer) => chunks.push(chunk))
                                message.on('end', () => resolve(Buffer.concat(chunks)))
                                message.on('error', (err: Error) => reject(err))
                                return
                            }
                            reject(new Error('Nodemailer returned unknown message format'))
                        })

                        const raw = rawBuffer
                            .toString('base64')
                            .replace(/\+/g, '-')
                            .replace(/\//g, '_')
                            .replace(/=+$/, '')

                        const sendRes = await fetch(
                            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                            {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ raw }),
                            }
                        )

                        if (!sendRes.ok) {
                            const err = await sendRes.json()
                            throw new Error(JSON.stringify(err))
                        }

                        await sendRes.json()
                        results.email++
                    } catch (e) {
                        console.error(`Email failed for ${emp.first_name}:`, e)
                        results.errors++
                    }
                }
            })
            await Promise.all(promises)
        }

        const BATCH_SIZE = 5
        for (let i = 0; i < employees.length; i += BATCH_SIZE) {
            const chunk = employees.slice(i, i + BATCH_SIZE)
            await processChunk(chunk)
            if (!previewOnly) {
                await new Promise((r) => setTimeout(r, 500))
            }
        }

        if (previewOnly) {
            const totalShiftsCount = employeePreviews.reduce((acc, ep) => acc + (ep.shifts?.length || 0), 0)
            const totalActivitiesCount = employeePreviews.reduce(
                (acc, ep) =>
                    acc +
                    (ep.shifts || []).reduce((sAcc: number, sh: any) => sAcc + (sh.activities?.length || 0), 0),
                0
            )
            return NextResponse.json({
                success: true,
                preview_only: true,
                store: {
                    id: store.id,
                    external_id: resolvedStoreGuid,
                    name: storeName,
                    has_drive_thru: hasDT,
                    pilot_active: isPilotStoreActive,
                },
                summary: {
                    employeesCount: employeePreviews.length,
                    shiftsCount: totalShiftsCount,
                    activitiesCount: totalActivitiesCount,
                    withEmailCount: employeePreviews.filter((ep) => Boolean(ep.email)).length,
                    withoutEmailCount: employeePreviews.filter((ep) => !ep.email).length,
                    pilotActive: isPilotStoreActive,
                },
                previews: employeePreviews,
            })
        }

        // 7. SEND CONSOLIDATED REPORT TO MANAGER
        if (results.email > 0) {
            const getApiRoleWeight = (title: string, empShifts: any[]) => {
                const t = (title || '').toLowerCase()
                if (
                    t.includes('manager') &&
                    !t.includes('asst') &&
                    !t.includes('assist') &&
                    !t.includes('asistente') &&
                    !t.includes('shift')
                )
                    return 10

                let totalAmHours = 0
                let totalPmHours = 0
                empShifts.forEach((s: any) => {
                    const start = new Date(s.start_time)
                    const end = new Date(s.end_time)
                    const startH = getLAHour(start) + start.getMinutes() / 60
                    let endH = getLAHour(end) + end.getMinutes() / 60
                    if (endH < startH) endH += 24
                    const overlapAm = Math.max(0, Math.min(endH, 17) - startH)
                    const overlapPm = Math.max(0, endH - Math.max(startH, 17))
                    totalAmHours += overlapAm
                    totalPmHours += overlapPm
                })

                const blockScore = totalPmHours > totalAmHours ? 2000 : 1000
                let roleScore = 99
                if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) roleScore = 1
                else if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) roleScore = 2
                else if (t.includes('cashier') || t.includes('cajera')) roleScore = 3
                else if (
                    t.includes('cook') ||
                    t.includes('cocinero') ||
                    t.includes('prep') ||
                    t.includes('preparador') ||
                    t.includes('taquero') ||
                    t.includes('tortill')
                )
                    roleScore = 4
                return blockScore + roleScore
            }

            const allEmpIdInShifts = [...new Set(shifts.map((s: any) => s.employee_id).filter(Boolean))]
            const { data: allShiftsEmployees } = await supabase
                .from('toast_employees')
                .select('id, first_name, last_name, job_references')
                .in('id', allEmpIdInShifts)

            const empMap = (allShiftsEmployees || []).sort((a: any, b: any) => {
                const aShifts = shifts.filter((s: any) => s.employee_id === a.id)
                const bShifts = shifts.filter((s: any) => s.employee_id === b.id)
                const aJob = a.job_references?.[0]?.title || ''
                const bJob = b.job_references?.[0]?.title || ''
                const wA = getApiRoleWeight(aJob, aShifts)
                const wB = getApiRoleWeight(bJob, bShifts)
                if (wA !== wB) return wA - wB
                return (a.first_name || '').localeCompare(b.first_name || '')
            })

            const reportDates = [...new Set(shifts.map((s: any) => s.shift_date))].sort()

            const tableHeaders = reportDates
                .map((d: string) => {
                    const dateObj = new Date(d + 'T12:00:00')
                    return `<th style="padding: 6px; border: 1px solid #ddd; font-size: 10px; background: #f1f5f9; text-transform: uppercase;">${dateObj.toLocaleDateString('es-US', { weekday: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })}</th>`
                })
                .join('')

            const reportRows = empMap
                .map((emp: any) => {
                    const empShifts = shifts.filter((s: any) => s.employee_id === emp.id)
                    if (empShifts.length === 0) return ''

                    const cells = reportDates
                        .map((dateStr: string) => {
                            const dayShifts = empShifts.filter((s: any) => s.shift_date === dateStr)
                            if (dayShifts.length === 0)
                                return `<td style="border: 1px solid #eee; background: #fafafa;"></td>`

                            const content = dayShifts
                                .map((s: any) => {
                                    const sTime = new Date(s.start_time)
                                        .toLocaleTimeString('en-US', {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                            hour12: true,
                                            timeZone: 'America/Los_Angeles',
                                        })
                                        .replace(':00', '')
                                    const eTime = new Date(s.end_time)
                                        .toLocaleTimeString('en-US', {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                            hour12: true,
                                            timeZone: 'America/Los_Angeles',
                                        })
                                        .replace(':00', '')

                                    let bInfo = ''
                                    if (s.breaks_schedule && Array.isArray(s.breaks_schedule)) {
                                        bInfo = s.breaks_schedule
                                            .map((b: any) => {
                                                const bt = new Date(b.start_time)
                                                    .toLocaleTimeString('en-US', {
                                                        hour: 'numeric',
                                                        minute: '2-digit',
                                                        hour12: true,
                                                        timeZone: 'America/Los_Angeles',
                                                    })
                                                    .replace(':00', '')
                                                const color =
                                                    b.type === 'meal_30' ? '#f97316' : '#22c55e'
                                                return `<div style="font-size: 8px; color: ${color}; font-weight: bold;">${b.type === 'meal_30' ? 'L:' : 'B:'}${bt}</div>`
                                            })
                                            .join('')
                                    }

                                    return `
                                        <div style="font-size: 9px; font-weight: bold; margin-bottom: 2px;">${sTime}-${eTime}</div>
                                        ${bInfo}
                                    `
                                })
                                .join('<div style="margin: 4px 0; border-top: 1px solid #eee;"></div>')

                            return `<td style="padding: 4px; border: 1px solid #eee; vertical-align: top; min-width: 60px;">${content}</td>`
                        })
                        .join('')

                    return `
                        <tr>
                            <td style="padding: 6px; border: 1px solid #ddd; font-weight: bold; font-size: 11px; background: #fdfdfd; white-space: nowrap;">${escapeHtml(emp.first_name || '')} ${escapeHtml(emp.last_name?.charAt(0) || '')}.</td>
                            ${cells}
                        </tr>
                    `
                })
                .join('')

            const managerHtml = `
                <!DOCTYPE html>
                <html>
                <body style="font-family: 'Inter', Arial, sans-serif; color: #1e293b; padding: 0; margin: 0; background-color: #f8fafc;">
                    <div style="max-width: 1100px; margin: 0 auto; background: white; padding: 40px; border: 1px solid #e2e8f0;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4f46e5; padding-bottom: 20px; margin-bottom: 30px;">
                            <div style="flex: 1;">
                                <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #1e293b; letter-spacing: -0.025em;">REPORTES DE PROGRAMACIÓN</h1>
                                <p style="margin: 4px 0 0 0; font-size: 14px; font-weight: 600; color: #6366f1; text-transform: uppercase;">${escapeHtml(storeName)}</p>
                            </div>
                            <div style="text-align: right; font-size: 11px; line-height: 1.6;">
                                <div style="font-weight: 900; color: #4f46e5;">DOCUMENTO OFICIAL</div>
                                <div><b>Publicado:</b> ${new Date().toLocaleDateString('es-US', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                <div><b>Manager ID:</b> ${escapeHtml(fromEmail || '')}</div>
                                <div style="margin-top: 10px; background: #eff6ff; color: #1d4ed8; padding: 4px 8px; border-radius: 4px; display: inline-block;">
                                    Confirmaciones de envío: <b>${results.email}</b>
                                </div>
                            </div>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; table-layout: fixed;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="width: 130px; padding: 10px 8px; border: 1px solid #e2e8f0; font-size: 10px; color: #64748b; text-align: left;">COLABORADOR</th>
                                    ${tableHeaders}
                                </tr>
                            </thead>
                            <tbody style="font-size: 10px; color: #334155;">
                                ${reportRows}
                            </tbody>
                        </table>
                        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
                            <div>© ${new Date().getFullYear()} Tacos Gavilan - Sistema de Gestión de Labor</div>
                            <div style="font-style: italic;">* L: Lunch (30m) | B: Break (10m)</div>
                            <div>Página 1 de 1</div>
                        </div>
                    </div>
                </body>
                </html>
            `

            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
            doc.setFontSize(18)
            doc.setTextColor(79, 70, 229)
            doc.text(`HORARIO MAESTRO: ${storeName}`, 14, 20)

            doc.setFontSize(10)
            doc.setTextColor(100, 116, 139)
            const dateRangeStr =
                reportDates.length > 0
                    ? `${reportDates[0]} - ${reportDates[reportDates.length - 1]}`
                    : ''
            doc.text(`Periodo: ${dateRangeStr} | Generado por: ${fromEmail}`, 14, 28)
            doc.text(`Fecha de Publicación: ${new Date().toLocaleString()}`, 14, 33)

            const head = [
                [
                    'EMPLEADO',
                    ...reportDates.map((d: string) => {
                        const dateObj = new Date(d + 'T12:00:00')
                        return dateObj
                            .toLocaleDateString('es-US', {
                                weekday: 'short',
                                day: 'numeric',
                                timeZone: 'America/Los_Angeles',
                            })
                            .toUpperCase()
                    }),
                ],
            ]

            const tableBody = empMap.map((emp: any) => {
                const empShifts = shifts.filter((s: any) => s.employee_id === emp.id)
                const row = [`${emp.first_name} ${emp.last_name?.charAt(0) || ''}.`]

                reportDates.forEach((dateStr: string) => {
                    const dayShifts = empShifts.filter((s: any) => s.shift_date === dateStr)
                    if (dayShifts.length === 0) {
                        row.push('')
                    } else {
                        const cellText = dayShifts
                            .map((s: any) => {
                                const sTime = new Date(s.start_time)
                                    .toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true,
                                        timeZone: 'America/Los_Angeles',
                                    })
                                    .replace(':00', '')
                                const eTime = new Date(s.end_time)
                                    .toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true,
                                        timeZone: 'America/Los_Angeles',
                                    })
                                    .replace(':00', '')
                                let bText = ''
                                if (s.breaks_schedule && Array.isArray(s.breaks_schedule)) {
                                    bText =
                                        '\n' +
                                        s.breaks_schedule
                                            .map((b: any) => {
                                                const bt = new Date(b.start_time)
                                                    .toLocaleTimeString('en-US', {
                                                        hour: 'numeric',
                                                        minute: '2-digit',
                                                        hour12: true,
                                                        timeZone: 'America/Los_Angeles',
                                                    })
                                                    .replace(':00', '')
                                                return `${b.type === 'meal_30' ? 'L:' : 'B:'}${bt}`
                                            })
                                            .join('  ')
                                }
                                return `${sTime}-${eTime}${bText}`
                            })
                            .join('\n---\n')
                        row.push(cellText)
                    }
                })
                return row
            })

            autoTable(doc, {
                startY: 40,
                head,
                body: tableBody,
                theme: 'grid',
                styles: {
                    fontSize: 7,
                    cellPadding: 2,
                    overflow: 'linebreak',
                    halign: 'center',
                    valign: 'middle',
                },
                headStyles: {
                    fillColor: [79, 70, 229],
                    textColor: 255,
                    halign: 'center',
                    fontStyle: 'bold',
                },
                columnStyles: {
                    0: {
                        fontStyle: 'bold',
                        fontSize: 8,
                        cellWidth: 35,
                        halign: 'left',
                        fillColor: [249, 250, 251],
                    },
                },
                alternateRowStyles: { fillColor: [255, 255, 255] },
                willDrawCell: (data) => {
                    if (data.section === 'body' && data.column.index > 0) {
                        data.cell.styles.textColor = 255
                        ;(data.cell as any)._coloredText = data.cell.text
                        data.cell.text = []
                    }
                },
                didDrawCell: (data) => {
                    if (data.section === 'body' && data.column.index > 0) {
                        const cell = data.cell
                        const lines = (cell as any)._coloredText || []
                        if (lines.length === 0) return

                        let currentY = cell.y + 4
                        const centerX = cell.x + cell.width / 2
                        doc.setFontSize(7)

                        lines.forEach((line: string) => {
                            if (line === '---') {
                                doc.setDrawColor(240)
                                doc.line(cell.x + 2, currentY, cell.x + cell.width - 2, currentY)
                                currentY += 4
                                return
                            }

                            if (line.includes('L:')) {
                                doc.setTextColor(249, 115, 22)
                                doc.setFont('helvetica', 'bold')
                                doc.setFontSize(7)
                            } else if (line.includes('B:')) {
                                doc.setTextColor(34, 197, 94)
                                doc.setFont('helvetica', 'bold')
                                doc.setFontSize(7)
                            } else {
                                doc.setTextColor(30, 41, 59)
                                doc.setFont('helvetica', 'bold')
                                doc.setFontSize(8)
                            }

                            doc.text(line, centerX, currentY, { align: 'center' })
                            currentY += 4
                        })
                    }
                },
            })

            const pageCount = (doc as any).internal.getNumberOfPages()
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i)
                doc.setFontSize(8)
                doc.setTextColor(150)
                doc.text(
                    `Sistema TEG Tacos Gavilan | Página ${i} de ${pageCount}`,
                    doc.internal.pageSize.width / 2,
                    doc.internal.pageSize.height - 10,
                    { align: 'center' }
                )
            }

            const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

            try {
                const compiler = nodemailer.createTransport({
                    streamTransport: true,
                    newline: 'windows',
                })
                const info = await compiler.sendMail({
                    from: `"Sistema TEG" <${fromEmail}>`,
                    to: fromEmail,
                    subject: `📑 RESUMEN PUBLICACIÓN: ${storeName}`,
                    html: managerHtml,
                    attachments: [
                        {
                            filename: `Horario_${storeName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
                            content: pdfBuffer,
                        },
                    ],
                })
                const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                    const message = info.message as any
                    if (Buffer.isBuffer(message)) return resolve(message)
                    const chunks: Buffer[] = []
                    message.on('data', (chunk: Buffer) => chunks.push(chunk))
                    message.on('end', () => resolve(Buffer.concat(chunks)))
                    message.on('error', (err: Error) => reject(err))
                })
                const raw = rawBuffer
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '')

                await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ raw }),
                })
            } catch (me) {
                console.error('❌ Failed to send Manager Report:', me)
            }
        }

        return NextResponse.json({ success: true, stats: results })
    } catch (error: any) {
        console.error('Notification Error:', error)
        const status =
            typeof error?.message === 'string' && error.message.includes('GMAIL_AUTH_FAILED')
                ? 401
                : 500
        return NextResponse.json({ error: error.message }, { status })
    }
}

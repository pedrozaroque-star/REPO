import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import {
    CANONICAL_STATIONS_CATALOG,
    type ClearedStationAssignmentScope,
    extractLiteralShiftSuffix,
    fetchCompleteRangeAssignments,
    getPositionMatchCandidates,
    isValidCalendarDateISO,
    isValidStationGroup,
    normalizeAssignmentSubPosition,
    normalizeText,
    prepareSafeAssignmentsBeforeRpc,
    stripLiteralShiftSuffix,
    validateFullWeekClonePayload,
} from '@/lib/actividades-resolution'

/**
 * @module RolesAPI
 * @description API de lectura y persistencia transaccional de asignaciones de estaciones (`station_assignments`).
 * @businessRules
 * - GET requiere sesión autenticada y alcance autorizado sobre `store_id` (`action: 'view'`, empleados pueden leer su tienda en modo tableta/kiosco).
 * - POST requiere sesión autenticada con permisos explícitos `edit_assignments` (`admin`, `supervisor`, `manager`, `asistente`/`assistant` de la tienda; `shift_leader` NO tiene permiso para editar asignaciones).
 * - Validación estricta de fechas reales de calendario (`isValidCalendarDateISO`), `station_group` y arreglo `tasks`.
 * - Reemplazo 100% atómico en PostgreSQL mediante `replace_station_assignments_atomic` con control de concurrencia optimista (`expected_revision` -> HTTP 409 en conflicto).
 * - GET y la lectura previa AM usan paginación exacta y comparan la revisión antes/después; conteo ausente, variable o revisión modificada abortan la lectura.
 * - La clonación de semana completa requiere confirmación explícita y `expected_revision` del rango destino para impedir sobrescribir cambios concurrentes.
 * @dataFlow
 * - Lee/escribe `public.station_assignments` vía RPC transaccional.
 * @notes
 * - Remediación integral de hallazgos A12, A13, A16, A18 y Hallazgo 2 de permisos/validación (2026-10-20).
 * - Fail-closed de lecturas paginadas y control de revisión estable en rango (2026-10-21).
 */

const VALID_CANONICAL_STATIONS_NORM = new Set(
    CANONICAL_STATIONS_CATALOG.flatMap(s => [
        normalizeText(s.station),
        ...Array.from(getPositionMatchCandidates(s.station)).map(normalizeText),
    ])
)

async function readAssignmentsRevision(
    storeId: string,
    startDate: string,
    endDate: string,
    activeShift: 'AM' | 'PM' | null
): Promise<{ revision: string | null; error: { message: string } | null }> {
    const result = await supabaseAdmin.rpc('get_station_assignments_revision', {
        p_store_id: storeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_active_shift: activeShift,
    })
    if (result.error) return { revision: null, error: { message: result.error.message } }
    return {
        revision: typeof result.data === 'string' && result.data.trim() ? result.data : null,
        error: null,
    }
}

export async function GET(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json({ error: 'No autenticado. Inicie sesión.' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const store_id = searchParams.get('store_id')
        const start_date = searchParams.get('start_date')
        const end_date = searchParams.get('end_date')
        const active_shift = searchParams.get('active_shift')
        const include_meta = searchParams.get('include_meta') === '1'
        const revision_only = searchParams.get('revision_only') === '1'

        if (!store_id || !start_date || !end_date) {
            return NextResponse.json({ error: 'Faltan parámetros requeridos (store_id, start_date, end_date)' }, { status: 400 })
        }

        if (!isValidCalendarDateISO(start_date) || !isValidCalendarDateISO(end_date)) {
            return NextResponse.json({ error: 'Fecha inválida o inexistente en el calendario (use YYYY-MM-DD)' }, { status: 400 })
        }

        if (start_date > end_date) {
            return NextResponse.json({ error: 'El rango de fechas es inválido: start_date no puede ser mayor que end_date' }, { status: 400 })
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: true,
            requireWrite: false,
            action: 'view',
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta sucursal' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || store_id

        if (revision_only) {
            const revisionResult = await readAssignmentsRevision(canonicalStoreGuid, start_date, end_date, null)
            if (revisionResult.error || !revisionResult.revision) {
                return NextResponse.json(
                    { error: revisionResult.error?.message || 'No se pudo obtener la revisión de las asignaciones' },
                    { status: 500 }
                )
            }
            return NextResponse.json(
                { revision: revisionResult.revision },
                { headers: { 'X-Assignments-Revision': revisionResult.revision } }
            )
        }

        const [assignmentsRes, revisionAmRes, revisionPmRes] = await Promise.all([
            fetchCompleteRangeAssignments<any>({
                fetchPage: async (offset, limit) => {
                    const res = await supabaseAdmin
                        .from('station_assignments')
                        .select(
                            `
                            *,
                            toast_employees (
                                id,
                                first_name,
                                last_name
                            )
                        `,
                            { count: 'exact' }
                        )
                        .eq('store_id', canonicalStoreGuid)
                        .gte('assignment_date', start_date)
                        .lte('assignment_date', end_date)
                        .order('assignment_date', { ascending: true })
                        .order('id', { ascending: true })
                        .range(offset, offset + limit - 1)
                    return {
                        data: res.data,
                        error: res.error ? { message: res.error.message } : null,
                        count: res.count,
                    }
                },
                fetchRevision: () => readAssignmentsRevision(canonicalStoreGuid, start_date, end_date, null),
                pageSize: 500,
                maxRows: 10000,
            }),
            include_meta
                ? supabaseAdmin.rpc('get_station_assignments_revision', {
                      p_store_id: canonicalStoreGuid,
                      p_start_date: start_date,
                      p_end_date: end_date,
                      p_active_shift: 'AM',
                  })
                : Promise.resolve({ data: null }),
            include_meta
                ? supabaseAdmin.rpc('get_station_assignments_revision', {
                      p_store_id: canonicalStoreGuid,
                      p_start_date: start_date,
                      p_end_date: end_date,
                      p_active_shift: 'PM',
                  })
                : Promise.resolve({ data: null }),
        ])

        if (assignmentsRes.error || assignmentsRes.isComplete === false) {
            return NextResponse.json(
                {
                    error:
                        assignmentsRes.error?.message ||
                        assignmentsRes.incompletenessReason ||
                        'Lectura incompleta de asignaciones',
                },
                { status: 500 }
            )
        }

        const revision = assignmentsRes.endRevision
        if (!revision) {
            return NextResponse.json({ error: 'No se pudo confirmar una revisión estable de las asignaciones' }, { status: 500 })
        }
        const revisionAm = typeof revisionAmRes?.data === 'string' ? revisionAmRes.data : revision
        const revisionPm = typeof revisionPmRes?.data === 'string' ? revisionPmRes.data : revision
        const rows = (assignmentsRes.data || []).map((row: any) => ({
            ...row,
            sub_position: normalizeAssignmentSubPosition(row.main_station, row.sub_position, 'AM'),
        }))

        if (include_meta) {
            return NextResponse.json(
                {
                    data: rows,
                    assignments: rows,
                    revision,
                    revisions: {
                        ALL: revision,
                        AM: revisionAm,
                        PM: revisionPm,
                    },
                },
                { headers: { 'X-Assignments-Revision': revision } }
            )
        }

        return NextResponse.json(rows, {
            headers: { 'X-Assignments-Revision': revision }
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json({ error: 'No autorizado. Inicie sesión.' }, { status: 401 })
        }

        const body = await req.json()
        const {
            assignments,
            cleared_assignments,
            replace_all_shifts_confirmed,
            store_id,
            start_date,
            end_date,
            active_shift,
            expected_revision,
        } = body

        if (!assignments || !Array.isArray(assignments) || !store_id || !start_date || !end_date) {
            return NextResponse.json(
                { error: 'Faltan parámetros críticos (assignments, store_id, start_date, end_date)' },
                { status: 400 }
            )
        }

        if (!isValidCalendarDateISO(String(start_date)) || !isValidCalendarDateISO(String(end_date))) {
            return NextResponse.json(
                { error: 'Fecha inválida o inexistente en start_date o end_date (use YYYY-MM-DD)' },
                { status: 400 }
            )
        }

        // Validación estricta de orden cronológico SIN Math.abs (A16)
        const startMs = new Date(`${start_date}T00:00:00Z`).getTime()
        const endMs = new Date(`${end_date}T00:00:00Z`).getTime()
        if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
            return NextResponse.json(
                { error: 'El rango de fechas es inválido: end_date no puede ser anterior a start_date' },
                { status: 400 }
            )
        }

        const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24))
        if (diffDays > 14) {
            return NextResponse.json(
                { error: 'El rango de fechas no puede exceder 14 días' },
                { status: 400 }
            )
        }

        if (active_shift !== undefined && active_shift !== null && active_shift !== 'AM' && active_shift !== 'PM') {
            return NextResponse.json(
                { error: 'Parámetro active_shift inválido (debe ser AM o PM)' },
                { status: 400 }
            )
        }

        const fullWeekCheck = validateFullWeekClonePayload({
            activeShift: active_shift,
            replaceAllShiftsConfirmed: replace_all_shifts_confirmed,
            assignmentsCount: assignments.length,
        })
        if (!fullWeekCheck.ok) {
            return NextResponse.json(
                { error: fullWeekCheck.error, code: fullWeekCheck.code },
                { status: fullWeekCheck.status }
            )
        }

        if (active_shift == null && (typeof expected_revision !== 'string' || !expected_revision.trim())) {
            return NextResponse.json(
                {
                    error: 'La clonación de semana completa requiere la revisión actual de destino para evitar sobrescribir cambios concurrentes.',
                    code: 'EXPECTED_REVISION_REQUIRED',
                },
                { status: 400 }
            )
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: false,
            requireWrite: true,
            action: 'edit_assignments',
            allowedRoles: ['admin', 'supervisor', 'manager', 'asistente', 'assistant'],
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta tienda' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || String(store_id)
        const canonicalStoreNum = authScope.canonicalNumericId

        // Validar cada elemento de assignments antes de tocar la base de datos (A16 / Hallazgo 2)
        const distinctEmployeeIds = new Set<string>()
        const processedAssignments: Array<{
            employee_id: string
            assignment_date: string
            main_station: string
            sub_position: string
            station_group: string
            tasks: string[]
        }> = []

        for (let i = 0; i < assignments.length; i++) {
            const a = assignments[i]
            if (!a || typeof a !== 'object') {
                return NextResponse.json({ error: `Asignación inválida en índice ${i}` }, { status: 400 })
            }

            const empId = String(a.employee_id || '').trim()
            const assignDate = String(a.assignment_date || '').trim()
            const rawMainStation = String(a.main_station || a.sub_position || '').trim()
            const rawSubPosition = String(a.sub_position || a.main_station || '').trim()
            const cleanMainStation = stripLiteralShiftSuffix(rawMainStation)

            if (!empId) {
                return NextResponse.json({ error: `Falta employee_id en asignación #${i + 1}` }, { status: 400 })
            }

            if (!isValidCalendarDateISO(assignDate) || assignDate < start_date || assignDate > end_date) {
                return NextResponse.json(
                    { error: `La fecha de asignación (${assignDate}) es inválida o está fuera del rango autorizado [${start_date}, ${end_date}]` },
                    { status: 400 }
                )
            }

            if (!cleanMainStation || !rawSubPosition) {
                return NextResponse.json(
                    { error: `Falta main_station o sub_position en asignación #${i + 1}` },
                    { status: 400 }
                )
            }

            let normalizedSubPosition = rawSubPosition
            if (active_shift) {
                const oppositeShift = active_shift === 'AM' ? 'PM' : 'AM'
                const subSuffix = extractLiteralShiftSuffix(rawSubPosition)
                const mainSuffix = extractLiteralShiftSuffix(rawMainStation)
                if (subSuffix === oppositeShift || mainSuffix === oppositeShift) {
                    return NextResponse.json(
                        { error: `Incoherencia de turno: la asignación "${rawSubPosition}" / "${rawMainStation}" no coincide con active_shift "${active_shift}"` },
                        { status: 400 }
                    )
                }
                if (subSuffix !== active_shift) {
                    normalizedSubPosition = normalizeAssignmentSubPosition(
                        rawMainStation,
                        rawSubPosition,
                        active_shift
                    )
                }
            } else {
                normalizedSubPosition = normalizeAssignmentSubPosition(
                    rawMainStation,
                    rawSubPosition,
                    'AM'
                )
            }

            // Validar que la estación exista en el catálogo canónico o sea una estación reconocida
            const normMain = normalizeText(cleanMainStation)
            if (!VALID_CANONICAL_STATIONS_NORM.has(normMain)) {
                const { data: posCheck } = await supabaseAdmin
                    .from('position_activities')
                    .select('position_key')
                    .ilike('position_key', cleanMainStation)
                    .limit(1)
                if (!posCheck || posCheck.length === 0) {
                    return NextResponse.json(
                        { error: `La estación "${cleanMainStation}" no existe en el catálogo oficial de estaciones` },
                        { status: 400 }
                    )
                }
            }

            if (a.station_group !== undefined && a.station_group !== null && String(a.station_group).trim() !== '') {
                if (!isValidStationGroup(String(a.station_group))) {
                    return NextResponse.json(
                        { error: `station_group inválido ("${a.station_group}") en asignación #${i + 1}` },
                        { status: 400 }
                    )
                }
            }

            if (a.tasks !== undefined && a.tasks !== null) {
                if (!Array.isArray(a.tasks) || a.tasks.length > 100) {
                    return NextResponse.json(
                        { error: `Formato de tasks inválido o excede el límite permitido (máx 100) en asignación #${i + 1}` },
                        { status: 400 }
                    )
                }
                for (let tIdx = 0; tIdx < a.tasks.length; tIdx++) {
                    const taskItem = a.tasks[tIdx]
                    if (typeof taskItem !== 'string' || taskItem.trim().length > 300) {
                        return NextResponse.json(
                            { error: `Tarea inválida en asignación #${i + 1}, índice ${tIdx}` },
                            { status: 400 }
                        )
                    }
                }
            }

            // Normalizar station_group en minúsculas ('front', 'kitchen', 'drivethru', 'leadership', 'extras')
            const canonicalEntry = CANONICAL_STATIONS_CATALOG.find(
                s => normalizeText(s.station) === normMain
            )
            const rawGroup = String(
                a.station_group || canonicalEntry?.group || 'front'
            ).trim().toLowerCase()
            const normalizedGroup =
                rawGroup === 'salon'
                    ? 'front'
                    : rawGroup === 'cocina'
                      ? 'kitchen'
                      : rawGroup

            const sanitizedTasks: string[] = Array.isArray(a.tasks)
                ? a.tasks.map((t: string) => t.trim()).filter(Boolean)
                : []

            distinctEmployeeIds.add(empId)
            processedAssignments.push({
                employee_id: empId,
                assignment_date: assignDate,
                main_station: cleanMainStation,
                sub_position: normalizedSubPosition,
                station_group: normalizedGroup,
                tasks: sanitizedTasks,
            })
        }

        // Blindaje Hallazgo C: Si se guarda el turno AM, consultar todas las filas del rango [start_date, end_date]
        // para la sucursal y verificar literalmente los sufijos "_AM" y "_PM" (sin comodín "_" de SQL LIKE).
        // Si la lectura falla, detener inmediatamente el guardado (fail-closed) y NO invocar la RPC de reemplazo.
        let finalAssignmentsToPersist = processedAssignments
        let unsuffixedResolutionAudit: ReturnType<typeof prepareSafeAssignmentsBeforeRpc> extends infer R
            ? R extends { ok: true; resolutionAudit: infer A }
                ? A
                : never
            : never = []

        if (active_shift === 'AM') {
            const existingRangeQueryResult = await fetchCompleteRangeAssignments<{
                id?: string | number | null
                store_id?: string | number | null
                employee_id?: string | number | null
                assignment_date?: string | null
                main_station?: string | null
                sub_position?: string | null
                station_group?: string | null
                tasks?: string[] | null
            }>({
                fetchPage: async (offset, limit) => {
                    const res = await supabaseAdmin
                        .from('station_assignments')
                        .select(
                            'id, store_id, employee_id, assignment_date, main_station, sub_position, station_group, tasks',
                            { count: 'exact' }
                        )
                        .eq('store_id', canonicalStoreGuid)
                        .gte('assignment_date', start_date)
                        .lte('assignment_date', end_date)
                        .order('assignment_date', { ascending: true })
                        .order('id', { ascending: true })
                        .range(offset, offset + limit - 1)
                    return {
                        data: res.data,
                        error: res.error ? { message: res.error.message } : null,
                        count: res.count,
                    }
                },
                fetchRevision: () => readAssignmentsRevision(canonicalStoreGuid, start_date, end_date, 'AM'),
                pageSize: 500,
                maxRows: 10000,
            })

            const scopedClearedList: ClearedStationAssignmentScope[] = Array.isArray(cleared_assignments)
                ? cleared_assignments
                      .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
                      .map((item) => ({
                          store_id: String(item.store_id || canonicalStoreGuid).trim(),
                          assignment_date: String(item.assignment_date || '').trim(),
                          main_station: item.main_station ? String(item.main_station).trim() : null,
                          sub_position: String(item.sub_position || item.main_station || '').trim(),
                      }))
                : []

            const safePrep = prepareSafeAssignmentsBeforeRpc({
                activeShift: 'AM',
                storeId: canonicalStoreGuid,
                incomingAssignments: processedAssignments,
                clearedAssignments: scopedClearedList,
                existingRangeQueryResult,
            })

            if (!safePrep.ok) {
                return NextResponse.json(
                    {
                        error: safePrep.error,
                        code: safePrep.code,
                        details: safePrep.details,
                    },
                    { status: safePrep.status }
                )
            }

            finalAssignmentsToPersist = safePrep.assignments
            unsuffixedResolutionAudit = safePrep.resolutionAudit
            for (const item of finalAssignmentsToPersist) {
                if (item.employee_id) distinctEmployeeIds.add(String(item.employee_id))
            }
        }

        // Verificar que todos los employee_id existan y pertenezcan o tengan turno en la sucursal (A16)
        if (distinctEmployeeIds.size > 0) {
            const empIdList = Array.from(distinctEmployeeIds)
            const [empRes, shiftRes, prevAssignRes] = await Promise.all([
                supabaseAdmin
                    .from('toast_employees')
                    .select('id, store_ids')
                    .in('id', empIdList),
                supabaseAdmin
                    .from('shifts')
                    .select('employee_id')
                    .eq('store_id', canonicalStoreGuid)
                    .in('employee_id', empIdList),
                supabaseAdmin
                    .from('station_assignments')
                    .select('employee_id')
                    .eq('store_id', canonicalStoreGuid)
                    .in('employee_id', empIdList)
            ])

            if (empRes.error || shiftRes.error || prevAssignRes.error) {
                const readErr = empRes.error || shiftRes.error || prevAssignRes.error
                return NextResponse.json({ error: readErr!.message }, { status: 500 })
            }

            const empMap = new Map<string, any>()
            for (const row of empRes.data || []) {
                empMap.set(String(row.id), row)
            }
            const shiftEmpSet = new Set((shiftRes.data || []).map((r: any) => String(r.employee_id)))
            const prevAssignEmpSet = new Set((prevAssignRes.data || []).map((r: any) => String(r.employee_id)))

            for (const empId of empIdList) {
                const empRow = empMap.get(empId)
                if (!empRow) {
                    return NextResponse.json(
                        { error: `El empleado (${empId}) no existe en el padrón de empleados` },
                        { status: 400 }
                    )
                }

                const storeIdsArr = Array.isArray(empRow.store_ids) ? empRow.store_ids.map(String) : []
                const belongsByStoreIds =
                    storeIdsArr.includes(canonicalStoreGuid) ||
                    (canonicalStoreNum !== null && storeIdsArr.includes(String(canonicalStoreNum)))
                const belongsByShiftOrHistory = shiftEmpSet.has(empId) || prevAssignEmpSet.has(empId)

                if (!belongsByStoreIds && !belongsByShiftOrHistory) {
                    return NextResponse.json(
                        { error: `El empleado (${empId}) no pertenece ni tiene turnos asignados en esta sucursal` },
                        { status: 400 }
                    )
                }
            }
        }

        // Ejecutar reemplazo 100% atómico dentro de una única transacción en PostgreSQL (A12, A13)
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
            'replace_station_assignments_atomic',
            {
                p_store_id: canonicalStoreGuid,
                p_start_date: start_date,
                p_end_date: end_date,
                p_active_shift: active_shift || null,
                p_expected_revision: expected_revision || null,
                p_assignments: finalAssignmentsToPersist,
            }
        )

        if (rpcError) {
            if (rpcError.message?.includes('CONFLICT_REVISION_MISMATCH')) {
                return NextResponse.json(
                    {
                        error: 'Las asignaciones fueron modificadas por otra sesión antes de guardar. Recarga para ver los cambios más recientes.',
                        code: 'CONFLICT_REVISION_MISMATCH',
                        details: rpcError.message,
                    },
                    { status: 409 }
                )
            }
            throw rpcError
        }

        return NextResponse.json({
            success: true,
            revision: rpcResult?.new_revision || null,
            deleted_count: rpcResult?.deleted_count ?? 0,
            inserted_count: rpcResult?.inserted_count ?? finalAssignmentsToPersist.length,
            unsuffixed_resolution_audit: unsuffixedResolutionAudit,
        })
    } catch (error: any) {
        console.error('CRITICAL SAVE ERROR:', error)
        return NextResponse.json(
            {
                error: 'Error al persistir en base de datos',
                details: error.message,
            },
            { status: 500 }
        )
    }
}

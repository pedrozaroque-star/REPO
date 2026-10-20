import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import { CANONICAL_STATIONS_CATALOG, getPositionMatchCandidates, normalizeText } from '@/lib/actividades-resolution'

/**
 * @module RolesAPI
 * @description API de lectura y persistencia transaccional de asignaciones de estaciones (`station_assignments`).
 * @businessRules
 * - GET requiere sesión autenticada y alcance autorizado sobre `store_id` (empleados pueden leer su tienda en modo tableta/kiosco).
 * - POST requiere sesión autenticada con permisos de escritura (`admin`, `supervisor`, `manager`, `asistente` de la tienda).
 * - Validación estricta de rango de fechas (`start_date <= end_date`, sin `Math.abs`, máximo 14 días en escritura).
 * - Reemplazo 100% atómico en PostgreSQL mediante `replace_station_assignments_atomic` con control de concurrencia optimista (`expected_revision` -> HTTP 409 en conflicto).
 * @dataFlow
 * - Lee/escribe `public.station_assignments` vía RPC transaccional.
 * @notes
 * - Remediación integral de hallazgos A12, A13, A16 y A18 (2026-10-19).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const VALID_CANONICAL_STATIONS_NORM = new Set(
    CANONICAL_STATIONS_CATALOG.flatMap(s => [
        normalizeText(s.station),
        ...Array.from(getPositionMatchCandidates(s.station)),
    ])
)

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

        if (!store_id || !start_date || !end_date) {
            return NextResponse.json({ error: 'Faltan parámetros requeridos (store_id, start_date, end_date)' }, { status: 400 })
        }

        if (!ISO_DATE_RE.test(start_date) || !ISO_DATE_RE.test(end_date)) {
            return NextResponse.json({ error: 'Formato de fecha inválido (use YYYY-MM-DD)' }, { status: 400 })
        }

        if (start_date > end_date) {
            return NextResponse.json({ error: 'El rango de fechas es inválido: start_date no puede ser mayor que end_date' }, { status: 400 })
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: true,
            requireWrite: false,
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta sucursal' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || store_id

        const [assignmentsRes, revisionRes, revisionAmRes, revisionPmRes] = await Promise.all([
            supabaseAdmin
                .from('station_assignments')
                .select(`
                    *,
                    toast_employees (
                        id,
                        first_name,
                        last_name
                    )
                `)
                .eq('store_id', canonicalStoreGuid)
                .gte('assignment_date', start_date)
                .lte('assignment_date', end_date)
                .limit(5000),
            supabaseAdmin.rpc('get_station_assignments_revision', {
                p_store_id: canonicalStoreGuid,
                p_start_date: start_date,
                p_end_date: end_date,
                p_active_shift: active_shift === 'AM' || active_shift === 'PM' ? active_shift : null,
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

        if (assignmentsRes.error) {
            return NextResponse.json({ error: assignmentsRes.error.message }, { status: 500 })
        }

        const revision = typeof revisionRes.data === 'string' ? revisionRes.data : '0:0'
        const revisionAm = typeof revisionAmRes?.data === 'string' ? revisionAmRes.data : revision
        const revisionPm = typeof revisionPmRes?.data === 'string' ? revisionPmRes.data : revision
        const rows = assignmentsRes.data || []

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
        const { assignments, store_id, start_date, end_date, active_shift, expected_revision } = body

        if (!assignments || !Array.isArray(assignments) || !store_id || !start_date || !end_date) {
            return NextResponse.json(
                { error: 'Faltan parámetros críticos (assignments, store_id, start_date, end_date)' },
                { status: 400 }
            )
        }

        if (!ISO_DATE_RE.test(String(start_date)) || !ISO_DATE_RE.test(String(end_date))) {
            return NextResponse.json(
                { error: 'Formato de fecha inválido en start_date o end_date (use YYYY-MM-DD)' },
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

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: false,
            requireWrite: true,
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta tienda' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || String(store_id)
        const canonicalStoreNum = authScope.canonicalNumericId

        // Validar cada elemento de assignments antes de tocar la base de datos (A16)
        const distinctEmployeeIds = new Set<string>()
        const processedAssignments: Array<{
            employee_id: string
            assignment_date: string
            main_station: string
            sub_position: string
            station_group: string
            tasks: any[]
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
            const cleanMainStation = rawMainStation.replace(/_(AM|PM)$/i, '').trim()

            if (!empId) {
                return NextResponse.json({ error: `Falta employee_id en asignación #${i + 1}` }, { status: 400 })
            }

            if (!ISO_DATE_RE.test(assignDate) || assignDate < start_date || assignDate > end_date) {
                return NextResponse.json(
                    { error: `La fecha de asignación (${assignDate}) está fuera del rango autorizado [${start_date}, ${end_date}]` },
                    { status: 400 }
                )
            }

            if (!cleanMainStation || !rawSubPosition) {
                return NextResponse.json(
                    { error: `Falta main_station o sub_position en asignación #${i + 1}` },
                    { status: 400 }
                )
            }

            if (active_shift) {
                const expectedSuffix = `_${active_shift}`
                const oppositeSuffix = active_shift === 'AM' ? '_PM' : '_AM'
                if (rawSubPosition.toUpperCase().endsWith(oppositeSuffix)) {
                    return NextResponse.json(
                        { error: `Incoherencia de turno: sub_position "${rawSubPosition}" no coincide con active_shift "${active_shift}"` },
                        { status: 400 }
                    )
                }
                if (!rawSubPosition.toUpperCase().endsWith(expectedSuffix)) {
                    return NextResponse.json(
                        { error: `sub_position "${rawSubPosition}" debe incluir el sufijo "${expectedSuffix}"` },
                        { status: 400 }
                    )
                }
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

            // Normalizar station_group en minúsculas ('front', 'kitchen', 'drivethru', 'leadership', 'extras')
            const canonicalEntry = CANONICAL_STATIONS_CATALOG.find(
                s => normalizeText(s.station) === normMain
            )
            const normalizedGroup = String(
                a.station_group || canonicalEntry?.group || 'front'
            ).trim().toLowerCase()

            distinctEmployeeIds.add(empId)
            processedAssignments.push({
                employee_id: empId,
                assignment_date: assignDate,
                main_station: cleanMainStation,
                sub_position: rawSubPosition,
                station_group: normalizedGroup,
                tasks: Array.isArray(a.tasks) ? a.tasks : [],
            })
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

            if (empRes.error) {
                return NextResponse.json({ error: empRes.error.message }, { status: 500 })
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
                p_assignments: processedAssignments,
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
            inserted_count: rpcResult?.inserted_count ?? processedAssignments.length,
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

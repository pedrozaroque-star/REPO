import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope, resolveCachedStore } from '@/lib/auth-server'
import {
    getBusinessDateLA,
    isValidCalendarDateISO,
    normalizeText,
} from '@/lib/actividades-resolution'

/**
 * @module StoreEmployeesRosterAPI
 * @description Endpoint acotado y autenticado del servidor para consultar el padrón completo de empleados elegibles,
 *              turnos diarios (`shifts` + síntesis de liderazgo desde `schedules`) e historial activo de una sucursal (A24).
 * @businessRules
 * - Usa `JSON.stringify([...])` en `.contains('store_ids', ...)` sobre columnas `jsonb` para evitar `PostgresError 22P02`,
 *   además de soportar `store_ids` serializados como texto o arreglo numérico/GUID.
 * - Pagina de forma determinista `toast_employees`, `shifts`, `station_assignments` y `schedules` (orden DESC por fecha en `-60d..+14d`)
 *   para eliminar por completo el truncamiento silencioso de 1,000 filas de PostgREST.
 * - Cruza `schedules` + `users` (`store_id = canonicalStoreNum`) vinculando por `toast_guid`, `email` o nombre normalizado
 *   para garantizar que gerentes y asistentes programados en `/horarios` siempre aparezcan en el padrón y turnos del día.
 * - Mantiene 100% compatibilidad hacia atrás: sin `include_shifts=1` retorna `Employee[]`; con `include_shifts=1` retorna
 *   `{ employees, shifts, week_shift_employee_ids }`.
 * - Excluye administradores y supervisores corporativos cuyo `store_id` no corresponda a la sucursal consultada.
 * @dataFlow
 * - Cruza `toast_employees`, `shifts`, `station_assignments`, `schedules` y `users` en el servidor vía `supabaseAdmin`.
 * @notes
 * - Remediación integral 2026-11-25: fix `22P02` en `.contains('store_ids')`, paginación sin tope de 1,000 filas,
 *   integración de líderes desde `schedules` y contrato unificado `include_shifts=1` para tabletas 24/7 y managers.
 */

const ALLOWED_VIEW_ROLES = [
    'admin',
    'supervisor',
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
    'planificador',
    'shift_leader',
    'shift leader',
    'shiftleader',
    'employee',
]

const STORE_LEADERSHIP_ROLES = new Set([
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
    'shift_leader',
    'shift leader',
    'shiftleader',
])

const EMPLOYEE_SELECT_COLUMNS =
    'id, toast_guid, first_name, last_name, chosen_name, email, deleted, store_ids, job_references'

function addDaysISO(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().split('T')[0]
}

function parseSafeStoreIds(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.map((v) => String(v ?? '').trim()).filter(Boolean)
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (!trimmed) return []
        try {
            const parsed = JSON.parse(trimmed)
            if (Array.isArray(parsed)) {
                return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
            }
            if (parsed !== null && parsed !== undefined) {
                return [String(parsed).trim()].filter(Boolean)
            }
        } catch {
            return trimmed
                .replace(/^[\[{]+|[\]}]+$/g, '')
                .split(',')
                .map((s) => s.replace(/^["']+|["']+$/g, '').trim())
                .filter(Boolean)
        }
    }
    return []
}

function isWorkingScheduleEntry(sched: {
    shift_label?: string | null
    start_time?: string | null
    end_time?: string | null
}): boolean {
    const start = String(sched.start_time || '').trim()
    const end = String(sched.end_time || '').trim()
    if (!start || !end) return false
    if (start.slice(0, 5) === '00:00' && end.slice(0, 5) === '00:00') return false

    const label = String(sched.shift_label || '').trim().toLowerCase()
    if (
        label.includes('enferm') ||
        label.includes('sick') ||
        label.includes('vacac') ||
        label.includes('vacat') ||
        label.includes('off') ||
        label.includes('descanso') ||
        label.includes('permis') ||
        label.includes('leave') ||
        label.includes('unpaid') ||
        label.includes('ausenc') ||
        label.includes('absence')
    ) {
        return false
    }
    return true
}

async function fetchPaginatedRows<T>(
    fetchPage: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    pageSize = 1000,
    maxPages = 25
): Promise<{ data: T[]; error: { message: string } | null }> {
    const all: T[] = []
    for (let page = 0; page < maxPages; page++) {
        const offset = page * pageSize
        const res = await fetchPage(offset, pageSize)
        if (res.error) {
            return { data: all, error: { message: res.error.message } }
        }
        const batch = Array.isArray(res.data) ? res.data : []
        all.push(...batch)
        if (batch.length < pageSize) {
            break
        }
    }
    return { data: all, error: null }
}

export async function GET(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json({ error: 'No autenticado. Inicie sesión.' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const store_id = searchParams.get('store_id')
        const rawDate = searchParams.get('date')
        const rawRefDate = searchParams.get('reference_date')
        const includeShifts =
            searchParams.get('include_shifts') === '1' ||
            searchParams.get('include_shifts') === 'true'

        if (!store_id) {
            return NextResponse.json({ error: 'Falta parámetro store_id' }, { status: 400 })
        }

        if (rawDate && !isValidCalendarDateISO(rawDate)) {
            return NextResponse.json(
                { error: 'Parámetro date inválido (use YYYY-MM-DD real)' },
                { status: 400 }
            )
        }

        if (rawRefDate && !isValidCalendarDateISO(rawRefDate)) {
            return NextResponse.json(
                { error: 'Parámetro reference_date inválido (use YYYY-MM-DD real)' },
                { status: 400 }
            )
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: true,
            requireWrite: false,
            action: 'view',
            allowedRoles: ALLOWED_VIEW_ROLES,
        })
        if (!authScope.authorized) {
            return NextResponse.json(
                { error: authScope.error || 'Acceso denegado a esta sucursal' },
                { status: authScope.status }
            )
        }

        let canonicalStoreGuid = authScope.canonicalExternalId || ''
        let canonicalStoreNum: number | null =
            authScope.canonicalNumericId !== undefined && authScope.canonicalNumericId !== null
                ? Number(authScope.canonicalNumericId)
                : null

        if (!canonicalStoreGuid || canonicalStoreNum === null) {
            const cachedStore = await resolveCachedStore(store_id, supabaseAdmin)
            if (cachedStore) {
                if (!canonicalStoreGuid && cachedStore.external_id) {
                    canonicalStoreGuid = cachedStore.external_id
                }
                if (canonicalStoreNum === null && Number.isFinite(cachedStore.id)) {
                    canonicalStoreNum = cachedStore.id
                }
            }
        }
        if (!canonicalStoreGuid) {
            canonicalStoreGuid = store_id.trim()
        }

        const targetDate = rawDate || rawRefDate || getBusinessDateLA()
        const windowStart = addDaysISO(targetDate, -60)
        const windowEnd = addDaysISO(targetDate, 14)

        // 1. Consultas paginadas y seguras en paralelo (0 error 22P02, 0 truncamiento de 1,000 filas)
        const [
            shiftsWindowRes,
            dayShiftsRes,
            assignWindowRes,
            activeUsersRes,
            guidStoreEmpsRes,
            numStrStoreEmpsRes,
            numIntStoreEmpsRes,
            allActiveEmpsRes,
            schedulesWindowRes,
        ] = await Promise.all([
            fetchPaginatedRows<any>((offset, limit) =>
                supabaseAdmin
                    .from('shifts')
                    .select('id, employee_id, shift_date')
                    .eq('store_id', canonicalStoreGuid)
                    .gte('shift_date', windowStart)
                    .lte('shift_date', windowEnd)
                    .order('shift_date', { ascending: false })
                    .order('id', { ascending: true })
                    .range(offset, offset + limit - 1)
            ),
            includeShifts
                ? fetchPaginatedRows<any>((offset, limit) =>
                      supabaseAdmin
                          .from('shifts')
                          .select('*')
                          .eq('store_id', canonicalStoreGuid)
                          .eq('shift_date', targetDate)
                          .order('start_time', { ascending: true })
                          .order('id', { ascending: true })
                          .range(offset, offset + limit - 1)
                  )
                : Promise.resolve({ data: [] as any[], error: null }),
            fetchPaginatedRows<any>((offset, limit) =>
                supabaseAdmin
                    .from('station_assignments')
                    .select('id, employee_id, assignment_date')
                    .eq('store_id', canonicalStoreGuid)
                    .gte('assignment_date', windowStart)
                    .lte('assignment_date', windowEnd)
                    .order('assignment_date', { ascending: false })
                    .order('id', { ascending: true })
                    .range(offset, offset + limit - 1)
            ),
            supabaseAdmin
                .from('users')
                .select('id, full_name, email, role, store_id, toast_guid, is_active')
                .eq('is_active', true),
            fetchPaginatedRows<any>((offset, limit) =>
                supabaseAdmin
                    .from('toast_employees')
                    .select(EMPLOYEE_SELECT_COLUMNS)
                    .contains('store_ids', JSON.stringify([canonicalStoreGuid]))
                    .order('id', { ascending: true })
                    .range(offset, offset + limit - 1)
            ),
            canonicalStoreNum !== null
                ? fetchPaginatedRows<any>((offset, limit) =>
                      supabaseAdmin
                          .from('toast_employees')
                          .select(EMPLOYEE_SELECT_COLUMNS)
                          .contains('store_ids', JSON.stringify([String(canonicalStoreNum)]))
                          .order('id', { ascending: true })
                          .range(offset, offset + limit - 1)
                  )
                : Promise.resolve({ data: [] as any[], error: null }),
            canonicalStoreNum !== null
                ? fetchPaginatedRows<any>((offset, limit) =>
                      supabaseAdmin
                          .from('toast_employees')
                          .select(EMPLOYEE_SELECT_COLUMNS)
                          .contains('store_ids', JSON.stringify([Number(canonicalStoreNum)]))
                          .order('id', { ascending: true })
                          .range(offset, offset + limit - 1)
                  )
                : Promise.resolve({ data: [] as any[], error: null }),
            fetchPaginatedRows<any>((offset, limit) =>
                supabaseAdmin
                    .from('toast_employees')
                    .select(EMPLOYEE_SELECT_COLUMNS)
                    .eq('deleted', false)
                    .order('id', { ascending: true })
                    .range(offset, offset + limit - 1)
            ),
            canonicalStoreNum !== null
                ? fetchPaginatedRows<any>((offset, limit) =>
                      supabaseAdmin
                          .from('schedules')
                          .select('id, user_id, store_id, date, shift_label, start_time, end_time, role')
                          .eq('store_id', canonicalStoreNum)
                          .gte('date', windowStart)
                          .lte('date', windowEnd)
                          .order('date', { ascending: false })
                          .order('id', { ascending: true })
                          .range(offset, offset + limit - 1)
                  )
                : Promise.resolve({ data: [] as any[], error: null }),
        ])

        if (guidStoreEmpsRes.error) {
            console.error('[StoreEmployeesRosterAPI] guidStoreEmpsRes error:', guidStoreEmpsRes.error.message)
        }
        if (shiftsWindowRes.error) {
            return NextResponse.json({ error: shiftsWindowRes.error.message }, { status: 500 })
        }
        if (dayShiftsRes.error) {
            return NextResponse.json({ error: dayShiftsRes.error.message }, { status: 500 })
        }
        if (assignWindowRes.error) {
            return NextResponse.json({ error: assignWindowRes.error.message }, { status: 500 })
        }

        const weekShiftEmpIdsSet = new Set<string>()
        const extraEmployeeIds = new Set<string>()

        for (const r of shiftsWindowRes.data) {
            if (r?.employee_id) {
                const idStr = String(r.employee_id)
                weekShiftEmpIdsSet.add(idStr)
                extraEmployeeIds.add(idStr)
            }
        }
        for (const r of assignWindowRes.data) {
            if (r?.employee_id) {
                extraEmployeeIds.add(String(r.employee_id))
            }
        }

        const baseEmployeesMap = new Map<string, any>()
        const addStoreEmployeeCandidate = (emp: any) => {
            if (!emp?.id) return
            const idStr = String(emp.id)
            if (emp.deleted && !extraEmployeeIds.has(idStr)) return
            baseEmployeesMap.set(idStr, emp)
        }

        for (const emp of guidStoreEmpsRes.data) addStoreEmployeeCandidate(emp)
        for (const emp of numStrStoreEmpsRes.data) addStoreEmployeeCandidate(emp)
        for (const emp of numIntStoreEmpsRes.data) addStoreEmployeeCandidate(emp)

        // Respaldo para filas activas donde `store_ids` haya sido guardado como JSON string escalar
        const allActiveEmployees = allActiveEmpsRes.data || []
        for (const emp of allActiveEmployees) {
            if (!emp?.id || baseEmployeesMap.has(String(emp.id))) continue
            const parsedStores = parseSafeStoreIds(emp.store_ids)
            if (
                parsedStores.includes(canonicalStoreGuid) ||
                (canonicalStoreNum !== null && parsedStores.includes(String(canonicalStoreNum)))
            ) {
                baseEmployeesMap.set(String(emp.id), emp)
            }
        }

        // 2. Vincular líderes de tienda desde `users` + `schedules` (`store_id = canonicalStoreNum`)
        const activeUsers = Array.isArray(activeUsersRes.data) ? activeUsersRes.data : []
        const activeUsersById = new Map<string, any>()
        for (const u of activeUsers) {
            if (u?.id !== undefined && u?.id !== null) {
                activeUsersById.set(String(u.id), u)
            }
        }

        const scheduledUserIdsInStore = new Set<string>(
            (schedulesWindowRes.data || [])
                .map((s: any) => (s?.user_id !== undefined && s?.user_id !== null ? String(s.user_id) : ''))
                .filter(Boolean)
        )

        const storeLeaderUsers = activeUsers.filter((u: any) => {
            const roleNorm = String(u?.role || '').trim().toLowerCase()
            const uStore = u?.store_id !== undefined && u?.store_id !== null ? String(u.store_id).trim() : ''
            const belongsToThisStore =
                uStore === canonicalStoreGuid ||
                (canonicalStoreNum !== null && uStore === String(canonicalStoreNum))
            if (belongsToThisStore && STORE_LEADERSHIP_ROLES.has(roleNorm)) {
                return true
            }
            if (scheduledUserIdsInStore.has(String(u.id)) && STORE_LEADERSHIP_ROLES.has(roleNorm)) {
                return true
            }
            return false
        })

        // Buscar registros en `toast_employees` para líderes cuyo toast_guid pueda estar inactivo o fuera del mapa inicial
        const leaderGuids = Array.from(
            new Set(
                storeLeaderUsers
                    .map((u: any) => String(u?.toast_guid || '').trim())
                    .filter(Boolean)
            )
        )
        const leaderGuidEmps: any[] = []
        if (leaderGuids.length > 0) {
            const { data: byGuid } = await supabaseAdmin
                .from('toast_employees')
                .select(EMPLOYEE_SELECT_COLUMNS)
                .in('toast_guid', leaderGuids)
            if (Array.isArray(byGuid)) {
                leaderGuidEmps.push(...byGuid)
            }
        }

        const candidatePoolForLeaders = new Map<string, any>()
        for (const emp of allActiveEmployees) {
            if (emp?.id) candidatePoolForLeaders.set(String(emp.id), emp)
        }
        for (const emp of baseEmployeesMap.values()) {
            if (emp?.id) candidatePoolForLeaders.set(String(emp.id), emp)
        }
        for (const emp of leaderGuidEmps) {
            if (emp?.id) candidatePoolForLeaders.set(String(emp.id), emp)
        }
        const allLeaderCandidates = Array.from(candidatePoolForLeaders.values())

        const userIdToToastEmp = new Map<string, any>()
        for (const u of storeLeaderUsers) {
            const uGuid = String(u?.toast_guid || '').trim()
            const uEmail = String(u?.email || '').trim().toLowerCase()
            const uNormName = normalizeText(u?.full_name || '')

            const matched =
                (uGuid ? allLeaderCandidates.find((e) => String(e?.toast_guid || '').trim() === uGuid) : undefined) ||
                (uEmail
                    ? allLeaderCandidates.find((e) => String(e?.email || '').trim().toLowerCase() === uEmail)
                    : undefined) ||
                (uNormName
                    ? allLeaderCandidates.find((e) => {
                          const fullNorm = normalizeText(`${e?.first_name || ''} ${e?.last_name || ''}`)
                          const chosenNorm = normalizeText(`${e?.chosen_name || ''} ${e?.last_name || ''}`)
                          return fullNorm === uNormName || (Boolean(chosenNorm) && chosenNorm === uNormName)
                      })
                    : undefined)

            if (matched?.id) {
                const empIdStr = String(matched.id)
                userIdToToastEmp.set(String(u.id), matched)
                baseEmployeesMap.set(empIdStr, matched)
            }
        }

        // Incorporar turnos de `schedules` a `weekShiftEmpIdsSet` y sintetizar turnos del `targetDate` cuando falten en `shifts`
        const combinedDayShifts: any[] = [...(dayShiftsRes.data || [])]
        const existingDayShiftEmpIds = new Set<string>(
            combinedDayShifts.map((s: any) => String(s?.employee_id || '')).filter(Boolean)
        )

        for (const sched of schedulesWindowRes.data || []) {
            if (!sched || !isWorkingScheduleEntry(sched)) continue
            const uidStr = sched.user_id !== undefined && sched.user_id !== null ? String(sched.user_id) : ''
            if (!uidStr) continue
            const matchedEmp = userIdToToastEmp.get(uidStr)
            if (!matchedEmp?.id) continue

            const empIdStr = String(matchedEmp.id)
            weekShiftEmpIdsSet.add(empIdStr)
            extraEmployeeIds.add(empIdStr)

            if (includeShifts && sched.date === targetDate && !existingDayShiftEmpIds.has(empIdStr)) {
                const userRecord = activeUsersById.get(uidStr)
                const roleNorm = String(userRecord?.role || sched.role || '').trim().toLowerCase()
                if (STORE_LEADERSHIP_ROLES.has(roleNorm)) {
                    combinedDayShifts.push({
                        id: `schedule-${sched.id ?? `${uidStr}-${targetDate}`}`,
                        employee_id: empIdStr,
                        store_id: canonicalStoreGuid,
                        shift_date: targetDate,
                        start_time: String(sched.start_time),
                        end_time: String(sched.end_time),
                        is_callback: false,
                    })
                    existingDayShiftEmpIds.add(empIdStr)
                }
            }
        }

        // 3. Cargar empleados prestados / históricos por lotes de 200 IDs (sin truncamiento)
        const missingIds = Array.from(extraEmployeeIds).filter((id) => !baseEmployeesMap.has(id))
        for (let i = 0; i < missingIds.length; i += 200) {
            const chunk = missingIds.slice(i, i + 200)
            const { data: borrowedEmps, error: borrowedErr } = await supabaseAdmin
                .from('toast_employees')
                .select(EMPLOYEE_SELECT_COLUMNS)
                .in('id', chunk)
            if (borrowedErr) {
                return NextResponse.json({ error: borrowedErr.message }, { status: 500 })
            }
            for (const emp of borrowedEmps || []) {
                if (emp?.id) {
                    baseEmployeesMap.set(String(emp.id), emp)
                }
            }
        }

        // 4. Excluir administradores y supervisores corporativos cuyo `store_id` no sea esta sucursal
        const globalAdminNames = new Set(
            activeUsers
                .filter((u: any) => {
                    const roleNorm = String(u?.role || '').trim().toLowerCase()
                    if (roleNorm !== 'admin' && roleNorm !== 'supervisor') return false
                    if (!u.store_id) return true
                    const uStore = String(u.store_id).trim()
                    return uStore !== canonicalStoreGuid && uStore !== String(canonicalStoreNum)
                })
                .map((u: any) => normalizeText(String(u.full_name || '')))
                .filter(Boolean)
        )

        const roster = Array.from(baseEmployeesMap.values())
            .filter((emp) => {
                if (emp?.id && extraEmployeeIds.has(String(emp.id))) return true
                const fullNorm = normalizeText(`${emp.first_name || ''} ${emp.last_name || ''}`)
                return !globalAdminNames.has(fullNorm)
            })
            .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''))

        const headers = {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
        }

        if (includeShifts) {
            return NextResponse.json(
                {
                    employees: roster,
                    shifts: combinedDayShifts,
                    week_shift_employee_ids: Array.from(weekShiftEmpIdsSet),
                },
                { headers }
            )
        }

        return NextResponse.json(roster, { headers })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

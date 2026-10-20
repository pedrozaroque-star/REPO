import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'

/**
 * @module StoreEmployeesRosterAPI
 * @description Endpoint acotado del servidor para consultar el padrón de empleados elegibles de una sucursal (A24).
 * @businessRules
 * - Evita descargar todos los empleados de la empresa (`toast_employees`) en el navegador.
 * - La ventana histórica de turnos y asignaciones (-60 días a +14 días) se centra en `reference_date` (la fecha seleccionada en el tablero/planificador), permitiendo navegar a semanas pasadas o futuras sin perder empleados prestados o rotados.
 * - Excluye administradores y supervisores corporativos cuyo `store_id` no sea esta sucursal.
 * @dataFlow
 * - Cruza `toast_employees`, `shifts`, `station_assignments` y `users` en el servidor.
 * @notes
 * - Creado en la remediación integral de ACTIVIDADES (Hallazgo A24, 2026-10-19).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function addDaysISO(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().split('T')[0]
}

export async function GET(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json({ error: 'No autenticado. Inicie sesión.' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const store_id = searchParams.get('store_id')
        const rawRefDate = searchParams.get('reference_date')

        if (!store_id) {
            return NextResponse.json({ error: 'Falta parámetro store_id' }, { status: 400 })
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: true,
            requireWrite: false,
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta sucursal' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || store_id
        const canonicalStoreNum = authScope.canonicalNumericId

        const referenceDate =
            rawRefDate && ISO_DATE_RE.test(rawRefDate)
                ? rawRefDate
                : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

        const windowStart = addDaysISO(referenceDate, -60)
        const windowEnd = addDaysISO(referenceDate, 14)

        // 1. Consultar en paralelo turnos recientes/futuros en la ventana, asignaciones en la ventana y usuarios admin globales
        const [shiftsRes, assignRes, adminUsersRes, storeEmployeesRes] = await Promise.all([
            supabaseAdmin
                .from('shifts')
                .select('employee_id')
                .eq('store_id', canonicalStoreGuid)
                .gte('shift_date', windowStart)
                .lte('shift_date', windowEnd),
            supabaseAdmin
                .from('station_assignments')
                .select('employee_id')
                .eq('store_id', canonicalStoreGuid)
                .gte('assignment_date', windowStart)
                .lte('assignment_date', windowEnd),
            supabaseAdmin
                .from('users')
                .select('full_name, store_id, role')
                .in('role', ['admin', 'supervisor']),
            supabaseAdmin
                .from('toast_employees')
                .select('id, first_name, last_name, chosen_name, email, deleted, store_ids, job_references')
                .contains('store_ids', [canonicalStoreGuid])
        ])

        const extraEmployeeIds = new Set<string>()
        for (const r of shiftsRes.data || []) {
            if (r.employee_id) extraEmployeeIds.add(String(r.employee_id))
        }
        for (const r of assignRes.data || []) {
            if (r.employee_id) extraEmployeeIds.add(String(r.employee_id))
        }

        const baseEmployeesMap = new Map<string, any>()
        for (const emp of storeEmployeesRes.data || []) {
            if (emp.deleted && !extraEmployeeIds.has(String(emp.id))) continue
            baseEmployeesMap.set(String(emp.id), emp)
        }

        // Si también hay empleados con store_ids numérico o prestados vía turnos/asignaciones que no estaban en el contains(GUID)
        const missingIds = Array.from(extraEmployeeIds).filter(id => !baseEmployeesMap.has(id))
        if (missingIds.length > 0) {
            const { data: borrowedEmps } = await supabaseAdmin
                .from('toast_employees')
                .select('id, first_name, last_name, chosen_name, email, deleted, store_ids, job_references')
                .in('id', missingIds)
            for (const emp of borrowedEmps || []) {
                baseEmployeesMap.set(String(emp.id), emp)
            }
        }

        // Si la tienda tiene ID numérico, revisar empleados que tengan el ID numérico en store_ids
        if (canonicalStoreNum !== null) {
            const { data: numericStoreEmps } = await supabaseAdmin
                .from('toast_employees')
                .select('id, first_name, last_name, chosen_name, email, deleted, store_ids, job_references')
                .contains('store_ids', [String(canonicalStoreNum)])
            for (const emp of numericStoreEmps || []) {
                if (emp.deleted && !extraEmployeeIds.has(String(emp.id))) continue
                baseEmployeesMap.set(String(emp.id), emp)
            }
        }

        // Excluir administradores/supervisores globales que no pertenezcan específicamente a esta tienda
        const globalAdminNames = new Set(
            (adminUsersRes.data || [])
                .filter((u: any) => {
                    if (!u.store_id) return true
                    const uStore = String(u.store_id)
                    return uStore !== canonicalStoreGuid && uStore !== String(canonicalStoreNum)
                })
                .map((u: any) => String(u.full_name || '').toLowerCase().trim())
                .filter(Boolean)
        )

        const roster = Array.from(baseEmployeesMap.values())
            .filter(emp => {
                const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().trim()
                return !globalAdminNames.has(fullName)
            })
            .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''))

        return NextResponse.json(roster)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

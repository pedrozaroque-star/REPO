/**
 * @module smart-rebalance-cron
 * @description Robot desatendido que audita ponchadas reales de Toast POS vs turnos programados y recalcula descansos con IA ante variaciones >= 60 min.
 * @businessRules
 * - Regla 6:00 AM: El día laboral corre de 6:00 AM a 5:59 AM del día siguiente (horario `America/Los_Angeles`).
 * - Variación Significativa: Solo rebalancea el turno del empleado que poncha con >= 60 minutos de diferencia respecto a su horario,
 *   congelando como anclas los descansos del resto de compañeros puntuales para nunca desordenar toda la tienda.
 * - Aprendizaje Automático (Motor V30 Universal): Incorpora `break_manual_overrides` ordenadas por `created_at DESC`,
 *   prioriza el puesto real del turno (`s.job_id`) y estaciones de `station_assignments`.
 * @dataFlow Consulta `toast_employees`, `toast_jobs`, `shifts`, `station_assignments`, `break_manual_overrides` y API de Toast Labor → Actualiza `shifts.breaks_schedule`.
 * @notes
 * - Corregido corte de día de negocio a las 6:00 AM (`hour < 6` pertenece al día anterior).
 * - Eliminada columna inexistente `updated_at` en `UPDATE shifts` que bloqueaba silenciosamente la persistencia en PostgreSQL.
 * - Aislado el rebalanceo exclusivamente a los `varianceShiftIds` detectados.
 * - 2026-11-19 (Paquete 2A): Agregado salto de ventana muerta `4:15–6:59 AM LA` (`?force=1` override), corregido bucle de re-cálculo cada 20 min estampando el marcador retrocompatible `rebalanced_punch_sig` en cada `BreakBlock` de `breaks_schedule` (y caché RAM para turnos de 0 breaks sin alterar formato de arreglo ni UI), y procesado de sucursales en lotes concurrentes de 3.
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor` en todos los entornos.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthToken, getToastRestaurants } from '@/lib/toast-api'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
    scheduleBreaksWithDemand,
    LearnedPreference,
    resolveShiftRoleTitle,
    resolveShiftIsLeader,
    resolveShiftStationSummary,
} from '@/lib/breaks-engine'
import { generateSmartForecast } from '@/lib/intelligence'

function getLAOffset(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        timeZoneName: 'longOffset'
    }).formatToParts(now)
    const tz = parts.find(p => p.type === 'timeZoneName')?.value
    return tz ? tz.replace('GMT', '').replace(':', '') : '-0700'
}

function getCaliforniaBusinessDate(now: Date = new Date()): { today: string; tomorrow: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(now)
    const get = (t: string) => parts.find(p => p.type === t)?.value || ''
    const baseUtc = new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))))
    const hour = Number(get('hour')) % 24
    if (hour < 6) {
        baseUtc.setUTCDate(baseUtc.getUTCDate() - 1)
    }
    const nextUtc = new Date(baseUtc.getTime())
    nextUtc.setUTCDate(nextUtc.getUTCDate() + 1)

    const fmt = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    return { today: fmt(baseUtc), tomorrow: fmt(nextUtc) }
}

function getLATimeParts(now: Date = new Date()): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now)
    const rawHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
    const hour = rawHour === 24 ? 0 : rawHour
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
    return { hour, minute }
}

// Respaldo ligero en RAM únicamente para el caso borde de turnos con variación que quedan con 0 descansos (<3.5h)
const rebalancedZeroBreakCache = new Map<string, string>()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

export const maxDuration = 300

export async function GET(req: Request) {
    const auth = await verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const { searchParams } = new URL(req.url)
    const forceRun = searchParams.get('force') === '1' || searchParams.get('force') === 'true'
    const now = new Date()

    if (!forceRun) {
        const { hour: laHour, minute: laMinute } = getLATimeParts(now)
        if ((laHour === 4 && laMinute >= 15) || laHour === 5 || laHour === 6) {
            console.log(
                `⏳ [Smart Rebalance V30] Omitido en horas muertas (4:15 AM - 6:59 AM LA). Hora LA: ${laHour}:${String(laMinute).padStart(2, '0')}`
            )
            return NextResponse.json({
                success: true,
                skipped: true,
                message: 'Skipped: Dead hours (4:15 AM - 6:59 AM LA)',
            })
        }
    }

    console.log('🤖 [Smart Rebalance V30] Starting automated punch monitoring...')

    try {
        const token = await getAuthToken()
        if (!token) throw new Error('Failed to get Toast Auth Token')

        const stores = await getToastRestaurants(token)
        const { today, tomorrow } = getCaliforniaBusinessDate(now)
        const laOffset = getLAOffset(now)

        let rebalancedStoresCount = 0
        let totalVariancesFound = 0

        const { data: jobs } = await supabase.from('toast_jobs').select('*')
        const allJobs = jobs || []

        const startIso = `${today}T06:00:00.000${laOffset}`
        const endIso = `${tomorrow}T06:00:00.000${laOffset}`

        const processStore = async (store: { id: string; name?: string }): Promise<{ variancesFound: number; rebalanced: boolean }> => {
            if (!store.id) return { variancesFound: 0, rebalanced: false }

            // 1. Obtener turnos programados hoy en la tienda
            const { data: dbShifts } = await supabase
                .from('shifts')
                .select('*')
                .eq('store_id', store.id)
                .eq('shift_date', today)

            if (!dbShifts || dbShifts.length === 0) return { variancesFound: 0, rebalanced: false }

            const shiftEmpIds = [...new Set(dbShifts.map(s => s.employee_id).filter(Boolean))]
            const { data: emps } = shiftEmpIds.length > 0
                ? await supabase
                      .from('toast_employees')
                      .select('id, first_name, last_name, job_references, toast_guid')
                      .in('id', shiftEmpIds)
                : { data: [] }

            // 2. Consultar ponchadas reales de Toast en el día de negocio completo (6:00 AM a 6:00 AM CA)
            const punchRes = await fetch(
                `https://ws-api.toasttab.com/labor/v1/timeEntries?startDate=${startIso}&endDate=${endIso}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Toast-Restaurant-External-ID': store.id,
                    },
                }
            )

            if (!punchRes.ok) return { variancesFound: 0, rebalanced: false }

            const punches = await punchRes.json()
            const timeEntries = Array.isArray(punches) ? punches : punches.timeEntries || []

            // 3. Detectar variaciones significativas (>= 60 min en entrada o salida) no procesadas aún para esa ponchada
            const varianceShiftIds = new Set<string>()
            const variancePunchSigByShiftId = new Map<string, string>()
            let storeVariancesFound = 0

            const adjustedShifts = dbShifts.map(s => {
                const emp = emps?.find(e => String(e.id) === String(s.employee_id))
                if (!emp || !emp.toast_guid) return s

                const empPunches = timeEntries.filter((p: any) => p.employee?.guid === emp.toast_guid && p.inDate)
                empPunches.sort((a: any, b: any) => new Date(a.inDate).getTime() - new Date(b.inDate).getTime())
                const punch = empPunches[0]

                if (punch && punch.inDate) {
                    const scheduledStart = new Date(s.start_time).getTime()
                    const actualStart = new Date(punch.inDate).getTime()
                    const diffInMins = Math.abs(actualStart - scheduledStart) / (1000 * 60)

                    const scheduledEnd = new Date(s.end_time).getTime()
                    const actualEnd = punch.outDate ? new Date(punch.outDate).getTime() : null
                    const diffOutMins = actualEnd ? Math.abs(actualEnd - scheduledEnd) / (1000 * 60) : 0

                    if (diffInMins >= 60 || diffOutMins >= 60) {
                        const shiftIdStr = String(s.id)
                        const adjustedStart = diffInMins >= 60 ? punch.inDate : s.start_time
                        const adjustedEnd = actualEnd && diffOutMins >= 60 ? punch.outDate : s.end_time
                        const punchSig = `${diffInMins >= 60 ? punch.inDate : ''}|${actualEnd && diffOutMins >= 60 ? punch.outDate : ''}`
                        const existingBreaks = Array.isArray(s.breaks_schedule) ? s.breaks_schedule : []

                        // Si este turno ya fue rebalanceado para exactamente la misma firma de ponchada, evitar re-cálculo
                        const alreadyRebalancedInDb =
                            existingBreaks.length > 0 &&
                            existingBreaks.every(
                                (b: Record<string, unknown> | null | undefined) =>
                                    Boolean(b) && b?.rebalanced_punch_sig === punchSig
                            )
                        const alreadyRebalancedZeroBreak =
                            existingBreaks.length === 0 && rebalancedZeroBreakCache.get(shiftIdStr) === punchSig

                        if (alreadyRebalancedInDb || alreadyRebalancedZeroBreak) {
                            return {
                                ...s,
                                start_time: adjustedStart,
                                end_time: adjustedEnd,
                            }
                        }

                        console.log(
                            `⚠️ Variance for ${emp.first_name} at ${store.name}: in=${Math.round(diffInMins)}m, out=${Math.round(diffOutMins)}m`
                        )
                        storeVariancesFound++
                        varianceShiftIds.add(shiftIdStr)
                        variancePunchSigByShiftId.set(shiftIdStr, punchSig)
                        // Limpiar únicamente los descansos NO manuales del empleado con variación horaria
                        const preservedManual = existingBreaks.filter(
                            (b: Record<string, unknown> | null | undefined) => Boolean(b && b.is_manual)
                        )
                        return {
                            ...s,
                            start_time: adjustedStart,
                            end_time: adjustedEnd,
                            breaks_schedule: preservedManual,
                        }
                    }
                }
                return s
            })

            // 4. Rebalancear ÚNICAMENTE los turnos con variación >= 60m respetando anclas del resto del equipo
            let storeUpdatedAny = false
            if (varianceShiftIds.size > 0) {
                const [forecast, { data: stationRows }, { data: storeOverrides }] = await Promise.all([
                    generateSmartForecast(store.id, today),
                    supabase
                        .from('station_assignments')
                        .select('employee_id, assignment_date, main_station, sub_position, station_group')
                        .eq('store_id', store.id)
                        .eq('assignment_date', today),
                    supabase
                        .from('break_manual_overrides')
                        .select('*')
                        .eq('store_id', store.id)
                        .order('created_at', { ascending: false })
                        .limit(3000),
                ])

                const hours = forecast.hours || []

                const activeShiftsForRebalance = adjustedShifts
                    .filter(s => s.is_callback !== true)
                    .map(s => {
                        const emp = emps?.find(e => String(e.id) === String(s.employee_id))
                        const title = resolveShiftRoleTitle(s, emp, allJobs) || (emp ? 'cook' : '')
                        const isLeader = resolveShiftIsLeader(title)
                        const stationName = resolveShiftStationSummary(s, stationRows || [])
                        const isVarianceTarget = varianceShiftIds.has(String(s.id))
                        const existingBreaks = Array.isArray(s.breaks_schedule) ? s.breaks_schedule : []

                        // Congelar los descansos de compañeros puntuales para que no se desordene toda la tienda
                        const safeBreaks = (!isVarianceTarget && existingBreaks.length > 0)
                            ? existingBreaks.map((b: any) => ({ ...b, is_manual: true }))
                            : existingBreaks

                        return {
                            ...s,
                            is_leader: isLeader,
                            job_title: title,
                            employee_name: emp
                                ? `${emp.first_name || ''} ${emp.last_name || ''}`.replace(/\s+/g, ' ').trim().toLowerCase()
                                : '',
                            station_name: stationName,
                            breaks_schedule: safeBreaks,
                        }
                    })

                if (activeShiftsForRebalance.length === 0) {
                    return { variancesFound: storeVariancesFound, rebalanced: false }
                }

                const learnedPrefs: LearnedPreference[] = (storeOverrides || []).map(o => ({
                    role: o.role,
                    day_of_week: o.day_of_week,
                    break_type: o.break_type,
                    break_index: o.break_index,
                    offset_from_start_min: o.offset_from_start_min,
                    shift_duration_min: o.shift_duration_min,
                    peak_hour: o.peak_hour,
                    updated_at: o.updated_at || o.created_at || null,
                    created_at: o.created_at || null,
                }))

                const newShifts = scheduleBreaksWithDemand(activeShiftsForRebalance as any, hours, learnedPrefs)

                for (const updated of newShifts) {
                    const updatedIdStr = String(updated.id)
                    if (!varianceShiftIds.has(updatedIdStr)) continue
                    const original = dbShifts.find(obs => String(obs.id) === updatedIdStr)
                    const punchSig = variancePunchSigByShiftId.get(updatedIdStr) || ''
                    const rawNewBreaks = Array.isArray(updated.breaks_schedule) ? updated.breaks_schedule : []
                    const stampedBreaks = rawNewBreaks.map((b: Record<string, unknown>) => ({
                        ...b,
                        rebalanced_punch_sig: punchSig,
                    }))

                    if (stampedBreaks.length === 0) {
                        if (rebalancedZeroBreakCache.size > 1000) rebalancedZeroBreakCache.clear()
                        rebalancedZeroBreakCache.set(updatedIdStr, punchSig)
                    }

                    const breaksChanged =
                        JSON.stringify(original?.breaks_schedule || []) !== JSON.stringify(stampedBreaks)

                    if (breaksChanged) {
                        const { error: updErr } = await supabase
                            .from('shifts')
                            .update({ breaks_schedule: stampedBreaks })
                            .eq('id', updated.id)
                        if (updErr) {
                            console.error(`❌ [Smart Rebalance] Failed updating shift ${updated.id}:`, updErr.message)
                        } else {
                            storeUpdatedAny = true
                        }
                    }
                }
            }

            return { variancesFound: storeVariancesFound, rebalanced: storeUpdatedAny }
        }

        // Procesar sucursales en lotes concurrentes de 3 para reducir wall-time de Fluid Memory
        const CONCURRENCY_BATCH_SIZE = 3
        for (let i = 0; i < stores.length; i += CONCURRENCY_BATCH_SIZE) {
            const batch = stores.slice(i, i + CONCURRENCY_BATCH_SIZE)
            const batchResults = await Promise.all(batch.map(processStore))
            for (const res of batchResults) {
                totalVariancesFound += res.variancesFound
                if (res.rebalanced) rebalancedStoresCount++
            }
        }

        return NextResponse.json({
            success: true,
            summary: {
                business_date: today,
                checked_stores: stores.length,
                variances_found: totalVariancesFound,
                rebalanced_stores: rebalancedStoresCount,
            },
        })
    } catch (error: any) {
        console.error('❌ Rebalance Cron Error:', error)
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}

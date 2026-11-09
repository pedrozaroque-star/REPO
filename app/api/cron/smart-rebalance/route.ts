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
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthToken, getToastRestaurants } from '@/lib/toast-api'
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

export const maxDuration = 300

export async function GET(req: Request) {
    // 🔒 Security check (Vercel Cron header or token)
    const authHeader = req.headers.get('authorization')
    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🤖 [Smart Rebalance V30] Starting automated punch monitoring...')

    try {
        const token = await getAuthToken()
        if (!token) throw new Error('Failed to get Toast Auth Token')

        const stores = await getToastRestaurants(token)
        const now = new Date()
        const { today, tomorrow } = getCaliforniaBusinessDate(now)
        const laOffset = getLAOffset(now)

        let rebalancedStoresCount = 0
        let totalVariancesFound = 0

        const { data: jobs } = await supabase.from('toast_jobs').select('*')
        const allJobs = jobs || []

        for (const store of stores) {
            if (!store.id) continue

            // 1. Obtener turnos programados hoy en la tienda
            const { data: dbShifts } = await supabase
                .from('shifts')
                .select('*')
                .eq('store_id', store.id)
                .eq('shift_date', today)

            if (!dbShifts || dbShifts.length === 0) continue

            const shiftEmpIds = [...new Set(dbShifts.map(s => s.employee_id).filter(Boolean))]
            const { data: emps } = shiftEmpIds.length > 0
                ? await supabase
                      .from('toast_employees')
                      .select('id, first_name, last_name, job_references, toast_guid')
                      .in('id', shiftEmpIds)
                : { data: [] }

            // 2. Consultar ponchadas reales de Toast en el día de negocio completo (6:00 AM a 6:00 AM CA)
            const startIso = `${today}T06:00:00.000${laOffset}`
            const endIso = `${tomorrow}T06:00:00.000${laOffset}`
            const punchRes = await fetch(
                `https://ws-api.toasttab.com/labor/v1/timeEntries?startDate=${startIso}&endDate=${endIso}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Toast-Restaurant-External-ID': store.id,
                    },
                }
            )

            if (!punchRes.ok) continue

            const punches = await punchRes.json()
            const timeEntries = Array.isArray(punches) ? punches : punches.timeEntries || []

            // 3. Detectar variaciones significativas (>= 60 min en entrada o salida)
            const varianceShiftIds = new Set<string>()
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
                        console.log(
                            `⚠️ Variance for ${emp.first_name} at ${store.name}: in=${Math.round(diffInMins)}m, out=${Math.round(diffOutMins)}m`
                        )
                        totalVariancesFound++
                        varianceShiftIds.add(String(s.id))
                        // Limpiar únicamente los descansos NO manuales del empleado con variación horaria
                        const preservedManual = Array.isArray(s.breaks_schedule)
                            ? s.breaks_schedule.filter((b: any) => b && b.is_manual)
                            : []
                        return {
                            ...s,
                            start_time: diffInMins >= 60 ? punch.inDate : s.start_time,
                            end_time: actualEnd && diffOutMins >= 60 ? punch.outDate : s.end_time,
                            breaks_schedule: preservedManual,
                        }
                    }
                }
                return s
            })

            // 4. Rebalancear ÚNICAMENTE los turnos con variación >= 60m respetando anclas del resto del equipo
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

                if (activeShiftsForRebalance.length === 0) continue

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

                let storeUpdatedAny = false
                for (const updated of newShifts) {
                    if (!varianceShiftIds.has(String(updated.id))) continue
                    const original = dbShifts.find(obs => String(obs.id) === String(updated.id))
                    const breaksChanged =
                        JSON.stringify(original?.breaks_schedule || []) !== JSON.stringify(updated.breaks_schedule || [])

                    if (breaksChanged) {
                        const { error: updErr } = await supabase
                            .from('shifts')
                            .update({ breaks_schedule: updated.breaks_schedule })
                            .eq('id', updated.id)
                        if (updErr) {
                            console.error(`❌ [Smart Rebalance] Failed updating shift ${updated.id}:`, updErr.message)
                        } else {
                            storeUpdatedAny = true
                        }
                    }
                }

                if (storeUpdatedAny) rebalancedStoresCount++
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

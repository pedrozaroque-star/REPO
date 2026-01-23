import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { syncToastEmployees, syncToastJobs, syncToastPunches } from '@/lib/toast-labor'

/**
 * SMART SCHEDULE GENERATOR API
 * 1. Syncs recent data from Toast (High Precision)
 * 2. Predicts schedules based on 6 months history
 * 3. Replaces existing drafts
 */

export async function POST(req: NextRequest) {
    try {
        const { storeId, startDate, endDate } = await req.json()

        if (!storeId || !startDate || !endDate) {
            return NextResponse.json({ error: 'Faltan parámetros (storeId, startDate, endDate)' }, { status: 400 })
        }

        const supabase = await getSupabaseClient()

        // --- 1. SYNC RECENT DATA (High Precision) ---
        // Sync employees and jobs to catch promotions or changes
        await syncToastEmployees(storeId)
        await syncToastJobs(storeId)

        // Sync last 15 days of punches to feed history with latest data
        const syncStart = new Date()
        syncStart.setDate(syncStart.getDate() - 15)
        const syncEnd = new Date()
        syncEnd.setDate(syncEnd.getDate() + 1)

        const startIso = `${syncStart.toISOString().split('T')[0]}T00:00:00.000+0000`
        const endIso = `${syncEnd.toISOString().split('T')[0]}T23:59:59.999+0000`

        await syncToastPunches(storeId, startIso, endIso)

        // --- 2. GENERATION LOGIC ---
        // (Simplified version of generate-smart-schedules.ts for real-time)

        // 2.1 Fetch history (6 months) with pagination
        const historyLimit = new Date()
        historyLimit.setDate(historyLimit.getDate() - 180)
        const historyLimitStr = historyLimit.toISOString().split('T')[0]

        let punches: any[] = []
        let page = 0
        const pageSize = 1000
        let hasMore = true

        while (hasMore) {
            const { data, error } = await supabase
                .from('punches')
                .select('*')
                .eq('store_id', storeId)
                .gte('business_date', historyLimitStr)
                .range(page * pageSize, (page + 1) * pageSize - 1)

            if (error) throw error
            if (data && data.length > 0) {
                punches = punches.concat(data)
                if (data.length < pageSize) hasMore = false
                else page++
            } else {
                hasMore = false
            }
        }

        // 2.2 Fetch current profiles (Source of truth for roles)
        const { data: emps, error: empErr } = await supabase
            .from('toast_employees')
            .select('id, toast_guid, v2_toast_guid, job_references, store_ids')
            .eq('deleted', false)

        if (empErr) throw empErr

        // 2.2b Fetch jobs to map GUID to ID
        const { data: jobs, error: jobErr } = await supabase
            .from('toast_jobs')
            .select('id, guid')

        if (jobErr) throw jobErr
        const jobGuidToId: Record<string, string> = {}
        jobs.forEach(j => { jobGuidToId[j.guid] = j.id })

        const empProfileMap: Record<string, any> = {}
        emps.forEach(e => {
            const profile = {
                id: e.id,
                jobGuid: e.job_references?.[0]?.guid || '',
                storeId: e.store_ids?.[0] || ''
            }
            if (e.toast_guid) empProfileMap[e.toast_guid] = profile
            if (e.v2_toast_guid) empProfileMap[e.v2_toast_guid] = profile
        })

        // 2.3 Group history by employee
        const employeeHistory: Record<string, any[]> = {}
        punches.forEach(p => {
            const guid = p.employee_toast_guid
            if (!guid) return
            if (!employeeHistory[guid]) employeeHistory[guid] = []
            employeeHistory[guid].push(p)
        })

        // 2.4 Iterate by employee first (To handle rest days rule)
        const targetStart = new Date(startDate + 'T00:00:00')
        const newShifts: any[] = []

        for (const guid in employeeHistory) {
            const history = employeeHistory[guid]
            const profile = empProfileMap[guid]
            if (!profile) continue

            // Check inactivity (20 days)
            const sorted = [...history].sort((a, b) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())
            const lastWork = new Date(sorted[0].business_date + 'T12:00:00') // Use noon to avoid TZ flip
            const diffDays = (new Date().getTime() - lastWork.getTime()) / (1000 * 3600 * 24)
            if (diffDays > 20) continue

            // Potential shifts for the week
            const empWeeklyShifts: any[] = []
            const dayFrequencies: Record<number, number> = {}

            // Calculate frequencies for all 7 days
            const counts = [0, 0, 0, 0, 0, 0, 0]
            history.forEach(p => {
                const d = new Date(p.business_date + 'T12:00:00')
                counts[d.getUTCDay()]++
            })
            const maxFreq = Math.max(...counts)

            // Evaluate each of the 7 days
            for (let d = 0; d < 7; d++) {
                const currentDay = new Date(targetStart)
                currentDay.setDate(targetStart.getDate() + d)
                const dateStr = currentDay.toISOString().split('T')[0]
                const dayOfWeek = currentDay.getUTCDay()

                const thisFreq = counts[dayOfWeek]
                dayFrequencies[dayOfWeek] = thisFreq

                // Smart Rest Day (20% Threshold - existing logic)
                if (thisFreq === 0 || (maxFreq > 4 && thisFreq / maxFreq < 0.2)) continue

                // Find Moda (Time Patterns) - Recent 45 days priority
                const historyToday = history.filter(p => new Date(p.business_date + 'T12:00:00').getUTCDay() === dayOfWeek)
                const analysisSet = historyToday.filter(p => {
                    const diff = (new Date().getTime() - new Date(p.business_date + 'T12:00:00').getTime()) / (1000 * 3600 * 24)
                    return diff <= 45
                }).length > 0 ? historyToday.filter(p => (new Date().getTime() - new Date(p.business_date + 'T12:00:00').getTime()) / (1000 * 3600 * 24) <= 45) : historyToday

                const patterns: Record<string, number> = {}
                analysisSet.forEach(p => {
                    if (!p.clock_in || !p.clock_out) return
                    const s = formatTime(p.clock_in)
                    const e = formatTime(p.clock_out)
                    const k = `${s}|${e}`
                    patterns[k] = (patterns[k] || 0) + 1
                })

                let bestPattern = ''
                let maxCount = 0
                for (const k in patterns) {
                    if (patterns[k] > maxCount) {
                        maxCount = patterns[k]; bestPattern = k
                    }
                }

                if (bestPattern) {
                    const [s, e] = bestPattern.split('|')

                    // --- HOLIDAY RULES ---
                    let finalStart = combine(dateStr, s)
                    let finalEnd = combine(dateStr, e)
                    let skipShift = false

                    const holiday = checkHoliday(new Date(dateStr + 'T12:00:00')) // Use noon

                    if (holiday.factor === 0.0) {
                        // Closed Days (Christmas, Good Friday)
                        skipShift = true
                    } else if (holiday.closeEarly) {
                        // Cap end time at 16:00 (4pm)
                        const closure = new Date(dateStr + 'T16:00:00')
                        if (new Date(finalEnd) > closure) {
                            finalEnd = closure.toISOString()
                            // If shift becomes too short (<3h), check if we skip
                            const duration = (new Date(finalEnd).getTime() - new Date(finalStart).getTime()) / 3600000
                            if (duration < 3) skipShift = true
                        }
                    } else if (holiday.openLate) {
                        // Start no earlier than 11:00
                        const opening = new Date(dateStr + 'T11:00:00')
                        if (new Date(finalStart) < opening) {
                            finalStart = opening.toISOString()
                            // Sanity check invalid shifts (end < start)
                            if (new Date(finalEnd) <= new Date(finalStart)) skipShift = true
                        }
                    }

                    if (!skipShift) {
                        empWeeklyShifts.push({
                            employee_id: profile.id,
                            store_id: storeId,
                            shift_date: dateStr,
                            day_of_week: dayOfWeek,
                            start_time: finalStart,
                            end_time: finalEnd,
                            toast_job_guid: profile.jobGuid,
                            job_id: jobGuidToId[profile.jobGuid] || null,
                            status: 'draft',
                            frequency: thisFreq // Store frequency to identify weakest day
                        })
                    }
                }
            }

            // --- MANDATORY REST DAY RULE ---
            // If the employee has 7 shifts, remove the one on the day with the lowest historical frequency
            if (empWeeklyShifts.length >= 7) {
                let weakestDayIdx = 0
                let lowestFreq = 999999

                empWeeklyShifts.forEach((s, idx) => {
                    if (s.frequency < lowestFreq) {
                        lowestFreq = s.frequency
                        weakestDayIdx = idx
                    }
                })

                // console.log(`Rest day rule: Removing shift for ${guid} on day ${empWeeklyShifts[weakestDayIdx].day_of_week} (Freq: ${lowestFreq})`)
                empWeeklyShifts.splice(weakestDayIdx, 1)
            }

            // Add cleaned shifts to the main list
            empWeeklyShifts.forEach(({ frequency, day_of_week, ...s }) => newShifts.push(s))
        }

        // --- 3. PERSISTENCE ---
        // Delete drafts for this week/store
        await supabase
            .from('shifts')
            .delete()
            .eq('store_id', storeId)
            .eq('status', 'draft')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)

        // Insert new ones
        if (newShifts.length > 0) {
            const { error: insErr } = await supabase.from('shifts').insert(newShifts)
            if (insErr) throw insErr
        }

        return NextResponse.json({ success: true, count: newShifts.length })

    } catch (error: any) {
        console.error('API Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// HELPERS
function checkHoliday(d: Date) {
    const m = d.getMonth()
    const date = d.getDate()
    const day = d.getDay()
    const year = d.getFullYear()

    // Helper: Get Nth Weekday of Month (e.g. 2nd Sunday)
    const getNthWeekday = (month: number, weekday: number, n: number) => {
        const firstDay = new Date(year, month, 1).getDay()
        const offset = (weekday - firstDay + 7) % 7
        const firstDate = 1 + offset
        return firstDate + (n - 1) * 7
    }

    // Helper: Get Last Weekday of Month (e.g. Last Monday)
    const getLastWeekday = (month: number, weekday: number) => {
        const lastDay = new Date(year, month + 1, 0)
        const lastDate = lastDay.getDate()
        const lastDayOfWeek = lastDay.getDay()
        const offset = (lastDayOfWeek - weekday + 7) % 7
        return lastDate - offset
    }

    // --- 1. FIXED DATES ---
    // Operational Rules (Closed/Hours) + Sales Factors
    if (m === 11 && date === 24) return { factor: 0.4, closeEarly: true }
    if (m === 11 && date === 25) return { factor: 0.0, closed: true }
    if (m === 11 && date === 31) return { factor: 0.4, closeEarly: true }
    if (m === 0 && date === 1) return { factor: 0.9, openLate: true }

    if (m === 1 && date === 14) return { factor: 1.05 } // Valentines
    if (m === 4 && date === 5) return { factor: 1.25 } // Cinco Mayo
    if (m === 6 && date === 4) return { factor: 0.80 } // July 4th

    // Mexican National Holidays (Validated 2024)
    if (m === 8 && date === 15) return { factor: 0.96 } // Grito
    if (m === 8 && date === 16) return { factor: 0.90 } // Independencia
    if (m === 9 && date === 31) return { factor: 1.15 } // Halloween
    if (m === 10 && (date === 1 || date === 2)) return { factor: 1.03 } // Muertos
    if (m === 11 && date === 12) return { factor: 1.07 } // Guadalupe

    // Fixed Mexico Mother's Day (May 10)
    if (m === 4 && date === 10) return { factor: 0.93 }


    // --- 2. MOBILE DATES ---

    // Thanksgiving (4th Thu Nov) - Close 4pm
    if (m === 10) {
        const date4thThu = getNthWeekday(10, 4, 4)
        if (date === date4thThu) return { factor: 0.4, closeEarly: true }
    }

    // Memorial Day (Last Mon May)
    if (m === 4) {
        const dateLastMon = getLastWeekday(4, 1)
        if (date === dateLastMon) return { factor: 1.15 }
    }

    // Labor Day (1st Mon Sep)
    if (m === 8) {
        const date1stMon = getNthWeekday(8, 1, 1)
        if (date === date1stMon) return { factor: 1.19 }
    }

    // Fathers Day (3rd Sun Jun)
    if (m === 5) {
        const date3rdSun = getNthWeekday(5, 0, 3)
        if (date === date3rdSun) return { factor: 0.88 }
    }

    // Super Bowl (2nd Sun Feb) - Approx rule
    if (m === 1) {
        const date2ndSun = getNthWeekday(1, 0, 2)
        if (date === date2ndSun) return { factor: 0.85 }
    }

    // Good Friday (Viernes Santo)
    if (m === 2 || m === 3) {
        // Easter Algorithm
        const a = year % 19
        const b = Math.floor(year / 100)
        const c = year % 100
        const d_calc = Math.floor(b / 4)
        const e = b % 4
        const f = Math.floor((b + 8) / 25)
        const g = Math.floor((b - f + 1) / 3)
        const h = (19 * a + b - d_calc - g + 15) % 30
        const i = Math.floor(c / 4)
        const k = c % 4
        const l = (32 + 2 * e + 2 * i - h - k) % 7
        const m_calc = Math.floor((a + 11 * h + 22 * l) / 451)
        const month = Math.floor((h + l - 7 * m_calc + 114) / 31) - 1
        const dayVal = ((h + l - 7 * m_calc + 114) % 31) + 1

        const easter = new Date(year, month, dayVal)
        const goodFriday = new Date(easter)
        goodFriday.setDate(easter.getDate() - 2)

        if (m === goodFriday.getMonth() && date === goodFriday.getDate()) {
            return { factor: 0.0, closed: true }
        }
    }

    return { factor: 1.0 }
}

function formatTime(iso: string) {
    const d = new Date(iso)
    const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles', hour12: false })
    let [h, m] = t.split(':').map(Number)
    if (m < 15) m = 0
    else if (m < 45) m = 30
    else { m = 0; h = (h + 1) % 24 }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function combine(date: string, time: string) {
    // Return ISO string in UTC but representing local time 
    // This matches the DB structure where start_time is TIMESTAMPTZ
    const [h, m] = time.split(':')
    const d = new Date(`${date}T${h}:${m}:00`)
    return d.toISOString()
}

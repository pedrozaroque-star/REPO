import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Leadership Availability Detection
 * 
 * Analyzes punch history to determine which days Shift Leaders and Assistants
 * typically work vs. have off. Uses clock_in time to determine AM vs PM shift.
 * 
 * Detection Logic:
 * - AM shift: clock_in before 2pm (14:00)
 * - PM shift: clock_in at/after 2pm
 * - Day off: frequency === 0 or < 20% of max frequency
 */

// Leadership role keywords to match in toast_jobs titles
const LEADERSHIP_KEYWORDS = ['SHIFT LEADER', 'MANAGER', 'ASST', 'JEFE', 'ENCARGADO', 'SUPERVISOR']

// How many days of history to analyze
const HISTORY_DAYS = 90

// Threshold: if frequency is less than this ratio of max, consider it a day off
const DAY_OFF_THRESHOLD = 0.2

// Hour threshold: clock_in before this hour = AM, after = PM
const AM_PM_THRESHOLD = 14 // 2:00 PM

export interface LeadershipByShift {
    am: { kitchen: number[]; foh: number[] }  // [0-6] for each day of week
    pm: { kitchen: number[]; foh: number[] }  // [0-6] for each day of week
}

export interface LeaderAnalysis {
    employeeGuid: string
    employeeName: string
    role: string
    shiftType: 'AM' | 'PM'
    primaryPosition: 'kitchen' | 'foh'
    daysWorking: number[]  // Array of day numbers (0-6) when they typically work
    daysOff: number[]      // Array of day numbers (0-6) when they're typically off
}

/**
 * Analyze leadership availability for a specific store
 * Returns counts per day of week (0-6) separated by AM/PM shift
 */
export async function getLeadershipAvailability(
    storeExternalId: string,
    supabase: SupabaseClient
): Promise<{
    byShift: LeadershipByShift,
    leaders: LeaderAnalysis[]
}> {
    // Default empty response
    const defaultResult: LeadershipByShift = {
        am: { kitchen: [0, 0, 0, 0, 0, 0, 0], foh: [0, 0, 0, 0, 0, 0, 0] },
        pm: { kitchen: [0, 0, 0, 0, 0, 0, 0], foh: [0, 0, 0, 0, 0, 0, 0] }
    }

    // 1. Get all job titles to find leadership GUIDs
    const { data: jobs } = await supabase
        .from('toast_jobs')
        .select('id, guid, title')

    if (!jobs || jobs.length === 0) {
        console.log('No jobs found in toast_jobs')
        return { byShift: defaultResult, leaders: [] }
    }

    // Create job GUID to title map
    const jobMap: Record<string, string> = {}
    jobs.forEach(j => {
        if (j.guid) jobMap[j.guid] = j.title
    })

    // Find leadership job GUIDs
    const leadershipJobGuids = jobs
        .filter(j => LEADERSHIP_KEYWORDS.some(k => j.title?.toUpperCase().includes(k)))
        .map(j => j.guid)
        .filter(Boolean) as string[]

    if (leadershipJobGuids.length === 0) {
        console.log('No leadership jobs found matching keywords')
        return { byShift: defaultResult, leaders: [] }
    }

    // 2. Get punch history for this store with leadership jobs (last 90 days)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_DAYS)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    let allPunches: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('punches')
            .select('employee_toast_guid, business_date, job_toast_guid, clock_in')
            .eq('store_id', storeExternalId)
            .in('job_toast_guid', leadershipJobGuids)
            .gte('business_date', cutoffStr)
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error('Error fetching punch history:', error)
            break
        }
        if (data) {
            allPunches = allPunches.concat(data)
            if (data.length < pageSize) hasMore = false
        } else {
            hasMore = false
        }
        page++
    }

    if (allPunches.length === 0) {
        console.log('No leadership punches found')
        return { byShift: defaultResult, leaders: [] }
    }

    // 3. Get employee names for GUIDs
    const employeeGuids = [...new Set(allPunches.map(p => p.employee_toast_guid).filter(Boolean))]

    const { data: employees } = await supabase
        .from('toast_employees')
        .select('toast_guid, v2_toast_guid, first_name, last_name')
        .eq('deleted', false)

    const empMap: Record<string, string> = {}
    employees?.forEach(e => {
        const name = `${e.first_name} ${e.last_name}`
        if (e.toast_guid) empMap[e.toast_guid] = name
        if (e.v2_toast_guid) empMap[e.v2_toast_guid] = name
    })

    // 4. Analyze each leader
    const result: LeadershipByShift = {
        am: { kitchen: [0, 0, 0, 0, 0, 0, 0], foh: [0, 0, 0, 0, 0, 0, 0] },
        pm: { kitchen: [0, 0, 0, 0, 0, 0, 0], foh: [0, 0, 0, 0, 0, 0, 0] }
    }
    const leaderAnalyses: LeaderAnalysis[] = []

    for (const guid of employeeGuids) {
        const empPunches = allPunches.filter(p => p.employee_toast_guid === guid)
        const empName = empMap[guid] || `Unknown`

        // Get the most common job for this employee
        const jobCounts: Record<string, number> = {}
        empPunches.forEach(p => {
            const jg = p.job_toast_guid
            jobCounts[jg] = (jobCounts[jg] || 0) + 1
        })
        const mainJobGuid = Object.entries(jobCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
        const role = jobMap[mainJobGuid] || 'Unknown'

        // Determine AM vs PM based on most common clock_in hour
        let amCount = 0
        let pmCount = 0
        empPunches.forEach(p => {
            if (!p.clock_in) return
            const clockInDate = new Date(p.clock_in)
            const hourStr = clockInDate.toLocaleString('en-US', {
                hour: 'numeric',
                hour12: false,
                timeZone: 'America/Los_Angeles'
            })
            const hour = parseInt(hourStr)
            if (hour < AM_PM_THRESHOLD) {
                amCount++
            } else {
                pmCount++
            }
        })
        const shiftType: 'AM' | 'PM' = amCount >= pmCount ? 'AM' : 'PM'

        // Count frequency per day
        const counts = [0, 0, 0, 0, 0, 0, 0]
        empPunches.forEach(p => {
            const date = new Date(p.business_date)
            counts[date.getUTCDay()]++
        })

        const maxFreq = Math.max(...counts)
        const isFoh = role.toUpperCase().includes('CASHIER') ||
            role.toUpperCase().includes('CAJA') ||
            role.toUpperCase().includes('FOH')
        const primaryPosition: 'kitchen' | 'foh' = isFoh ? 'foh' : 'kitchen'

        // Determine work/off days
        const daysWorking: number[] = []
        const daysOff: number[] = []

        for (let d = 0; d < 7; d++) {
            const isOff = counts[d] === 0 || (maxFreq > 4 && counts[d] / maxFreq < DAY_OFF_THRESHOLD)
            if (isOff) {
                daysOff.push(d)
            } else {
                daysWorking.push(d)
                // Add to appropriate bucket
                if (shiftType === 'AM') {
                    if (isFoh) result.am.foh[d]++
                    else result.am.kitchen[d]++
                } else {
                    if (isFoh) result.pm.foh[d]++
                    else result.pm.kitchen[d]++
                }
            }
        }

        leaderAnalyses.push({
            employeeGuid: guid,
            employeeName: empName,
            role,
            shiftType,
            primaryPosition,
            daysWorking,
            daysOff
        })
    }

    console.log(`📊 Leadership analysis for store ${storeExternalId}:`)
    console.log(`   Found ${leaderAnalyses.length} leaders, analyzed ${allPunches.length} punches`)

    return { byShift: result, leaders: leaderAnalyses }
}

/**
 * Get leadership count for a specific day and shift
 * Convenience function for shift generator
 */
export function getLeadersForDay(
    availability: LeadershipByShift,
    dayOfWeek: number,
    shiftType: 'AM' | 'PM'
): { kitchen: number; foh: number } {
    const shift = shiftType === 'AM' ? availability.am : availability.pm
    return {
        kitchen: shift.kitchen[dayOfWeek] || 0,
        foh: shift.foh[dayOfWeek] || 0
    }
}

/**
 * Get default static availability when dynamic data unavailable
 */
export function getDefaultLeadership(): LeadershipByShift {
    return {
        // Based on SHIFT_CONFIG defaults
        am: {
            kitchen: [2, 2, 2, 2, 2, 2, 2],  // 2 kitchen leaders AM
            foh: [1, 1, 1, 1, 1, 1, 1]       // 1 FOH leader AM
        },
        pm: {
            kitchen: [3, 3, 3, 3, 3, 3, 3],  // 3 kitchen leaders PM
            foh: [2, 2, 2, 2, 2, 2, 2]       // 2 FOH leaders PM
        }
    }
}

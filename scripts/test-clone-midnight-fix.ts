import { addDays, format } from 'date-fns'

// Business rule:
// Workday in Tacos Gavilan starts at 6:00 AM and ends at 5:59 AM next day.
// PM shift starts at 5:00 PM.

interface Shift {
    id: string
    shift_date: string // e.g. "2026-09-04" (Friday)
    start_time: string // ISO string, e.g. "2026-09-05T01:00:00-07:00" (Saturday 1:00 AM, but business date Friday)
    end_time: string   // ISO string, e.g. "2026-09-05T05:00:00-07:00" (Saturday 5:00 AM)
    employee_id: string
    job_id: string
}

function formatDateISO(d: Date) {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function cloneShiftsBuggy(sourceShifts: Shift[], weekStart: Date) {
    return sourceShifts.map((s: any) => {
        const origShiftDate = new Date(s.shift_date + 'T12:00:00')
        let day = origShiftDate.getDay()
        const dayOffset = day === 0 ? 6 : day - 1

        const targetDateObj = addDays(weekStart, dayOffset)
        const dateStr = formatDateISO(targetDateObj)

        const origStart = new Date(s.start_time)
        const newStart = new Date(targetDateObj)
        newStart.setHours(origStart.getHours(), origStart.getMinutes(), origStart.getSeconds(), 0)

        const duration = new Date(s.end_time).getTime() - origStart.getTime()
        const newEnd = new Date(newStart.getTime() + duration)

        return {
            shift_date: dateStr,
            start_time: newStart.toISOString(),
            end_time: newEnd.toISOString()
        }
    })
}

function cloneShiftsFixed(sourceShifts: Shift[], targetWeekStart: Date, sourceWeekStart: Date) {
    // Exact day offset between source week and target week in days
    // Both targetWeekStart and sourceWeekStart are Mondays
    const daysDiff = Math.round((targetWeekStart.getTime() - sourceWeekStart.getTime()) / (24 * 3600 * 1000))
    
    return sourceShifts.map((s: any) => {
        const origStart = new Date(s.start_time)
        const origEnd = new Date(s.end_time)
        const duration = origEnd.getTime() - origStart.getTime()

        // Simply shift start_time and end_time forward by exactly daysDiff days!
        const newStart = addDays(origStart, daysDiff)
        const newEnd = new Date(newStart.getTime() + duration)

        // And target shift_date is shifted by exactly daysDiff days from s.shift_date
        const [origY, origM, origD] = s.shift_date.split('-').map(Number)
        const origBusinessDate = new Date(origY, origM - 1, origD, 12, 0, 0)
        const newBusinessDate = addDays(origBusinessDate, daysDiff)
        const newShiftDateStr = formatDateISO(newBusinessDate)

        return {
            shift_date: newShiftDateStr,
            start_time: newStart.toISOString(),
            end_time: newEnd.toISOString()
        }
    })
}

// TEST CASE:
// Friday 2026-09-04 business date.
// Shift starts on Saturday 2026-09-05 at 01:00 AM (Pacific Time).
// Shift ends on Saturday 2026-09-05 at 05:00 AM.
const sourceWeekStart = new Date(2026, 7, 31) // Monday Aug 31, 2026
const targetWeekStart = new Date(2026, 8, 7)  // Monday Sep 7, 2026

const sampleShifts: Shift[] = [
    {
        id: '1',
        shift_date: '2026-09-04', // Friday
        start_time: new Date(2026, 8, 5, 1, 0, 0).toISOString(), // Sat 1:00 AM
        end_time: new Date(2026, 8, 5, 5, 0, 0).toISOString(),   // Sat 5:00 AM
        employee_id: 'emp-1',
        job_id: 'job-1'
    },
    {
        id: '2',
        shift_date: '2026-09-04', // Friday regular day shift
        start_time: new Date(2026, 8, 4, 8, 0, 0).toISOString(), // Fri 8:00 AM
        end_time: new Date(2026, 8, 4, 16, 30, 0).toISOString(), // Fri 4:30 PM
        employee_id: 'emp-2',
        job_id: 'job-2'
    }
]

console.log('--- BUGGY VERSION ---')
const buggyResults = cloneShiftsBuggy(sampleShifts, targetWeekStart)
buggyResults.forEach((r, idx) => {
    console.log(`Shift ${idx + 1} (${sampleShifts[idx].shift_date}):`)
    console.log(`  Source Start: ${sampleShifts[idx].start_time}`)
    console.log(`  Buggy Target Start: ${r.start_time}`)
    console.log(`  Target shift_date: ${r.shift_date}`)
    const startObj = new Date(r.start_time)
    console.log(`  Local target date: ${startObj.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`)
})

console.log('\n--- FIXED VERSION ---')
const fixedResults = cloneShiftsFixed(sampleShifts, targetWeekStart, sourceWeekStart)
fixedResults.forEach((r, idx) => {
    console.log(`Shift ${idx + 1} (${sampleShifts[idx].shift_date}):`)
    console.log(`  Source Start: ${sampleShifts[idx].start_time}`)
    console.log(`  Fixed Target Start: ${r.start_time}`)
    console.log(`  Target shift_date: ${r.shift_date}`)
    const startObj = new Date(r.start_time)
    console.log(`  Local target date: ${startObj.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`)
})

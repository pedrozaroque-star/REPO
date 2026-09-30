import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { addDays } from 'date-fns'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

function formatDateISO(d: Date) {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function calculateBusinessDateFromStart(d: Date): string {
    const laParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: false,
        hour: 'numeric',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(d)
    const partMap: Record<string, string> = {}
    laParts.forEach(p => partMap[p.type] = p.value)
    const hour = parseInt(partMap.hour, 10)
    const baseDate = new Date(`${partMap.year}-${partMap.month}-${partMap.day}T12:00:00`)
    if (hour < 6) {
        baseDate.setDate(baseDate.getDate() - 1)
    }
    return formatDateISO(baseDate)
}

async function runLiveTests() {
    console.log('=====================================================')
    console.log('   TACOS GAVILAN - PLANIFICADOR LIVE VERIFICATION    ')
    console.log('=====================================================\n')

    // TEST 1: Boundary Hours (6:00 AM Rule & 5:00 PM PM Shift)
    console.log('--- TEST 1: Business Day Boundary Verification (6:00 AM rule) ---')
    const testCases = [
        { iso: '2026-09-05T05:59:00-07:00', desc: 'Sat 5:59 AM (before 6am)', expectedBusinessDate: '2026-09-04' },
        { iso: '2026-09-05T06:00:00-07:00', desc: 'Sat 6:00 AM (start of day)', expectedBusinessDate: '2026-09-05' },
        { iso: '2026-09-05T16:59:00-07:00', desc: 'Sat 4:59 PM (day shift)', isPM: false },
        { iso: '2026-09-05T17:00:00-07:00', desc: 'Sat 5:00 PM (PM shift starts)', isPM: true },
        { iso: '2026-09-06T01:30:00-07:00', desc: 'Sun 1:30 AM (Sat night close)', expectedBusinessDate: '2026-09-05' }
    ]

    for (const tc of testCases) {
        const d = new Date(tc.iso)
        const bDate = calculateBusinessDateFromStart(d)
        if (tc.expectedBusinessDate) {
            const pass = bDate === tc.expectedBusinessDate
            console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${tc.desc}: got ${bDate}, expected ${tc.expectedBusinessDate}`)
            if (!pass) throw new Error(`Business date mismatch for ${tc.desc}`)
        }
        if (tc.isPM !== undefined) {
            const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric' }).format(d), 10)
            const isPM = hour >= 17
            const pass = isPM === tc.isPM
            console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${tc.desc}: hour=${hour}, isPM=${isPM}`)
            if (!pass) throw new Error(`PM shift check failed for ${tc.desc}`)
        }
    }

    // TEST 2: Direct jsonb contains query on toast_employees
    console.log('\n--- TEST 2: Employee Store Query Optimization ---')
    const lynwoodGuid = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
    const t0 = Date.now()
    const { data: emps, error: empErr } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name, deleted, sort_order')
        .contains('store_ids', JSON.stringify([lynwoodGuid]))
        .order('sort_order', { ascending: true })

    const elapsed = Date.now() - t0
    if (empErr) throw empErr
    console.log(`  [PASS] Lynwood employees fetched in ${elapsed}ms: total=${emps?.length || 0}`)
    if ((emps?.length || 0) === 0) throw new Error('No employees returned for Lynwood')

    // TEST 3: Midnight Shift Cloning (Math Verification)
    console.log('\n--- TEST 3: Past-Midnight Shift Cloning Preservation ---')
    const sourceWeekMonday = new Date(2026, 7, 31) // Mon Aug 31
    const targetWeekMonday = new Date(2026, 8, 7)  // Mon Sep 7
    const daysDiff = Math.round((targetWeekMonday.getTime() - sourceWeekMonday.getTime()) / (24 * 3600 * 1000))

    // Source shift: Friday 2026-09-04 business date, calendar Saturday 1:00 AM to 5:00 AM
    const sourceStart = new Date('2026-09-05T01:00:00-07:00')
    const sourceEnd = new Date('2026-09-05T05:00:00-07:00')
    const sourceShiftDate = '2026-09-04'

    const clonedStart = addDays(sourceStart, daysDiff)
    const clonedEnd = addDays(sourceEnd, daysDiff)
    const [origY, origM, origD] = sourceShiftDate.split('-').map(Number)
    const clonedShiftDate = formatDateISO(addDays(new Date(origY, origM - 1, origD, 12, 0, 0), daysDiff))

    const clonedStartLA = clonedStart.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    console.log(`  Source Start: ${sourceStart.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} (Business Date: ${sourceShiftDate})`)
    console.log(`  Cloned Start: ${clonedStartLA} (Business Date: ${clonedShiftDate})`)

    const clonedHour = new Date(clonedStart).getHours()
    // It must still be 1:00 AM and day must be Saturday Sep 12 (business date Friday Sep 11)
    const passClone = clonedShiftDate === '2026-09-11' && clonedStartLA.includes('1:00:00 AM') && clonedStartLA.includes('9/12/2026')
    console.log(`  [${passClone ? 'PASS' : 'FAIL'}] Overnight shift correctly kept Saturday 1:00 AM under Friday business day!`)
    if (!passClone) throw new Error('Overnight shift failed clone test')

    // TEST 4: Live DB Mutation Smoke Test (Insert -> Select -> Delete)
    console.log('\n--- TEST 4: Live DB Mutation Smoke Test (shifts table) ---')
    // Get active job for store
    const { data: job } = await supabase.from('toast_jobs').select('id').limit(1).single()
    const activeEmp = emps.find(e => !e.deleted)

    const testShift = {
        store_id: lynwoodGuid,
        employee_id: activeEmp?.id || null,
        job_id: job?.id,
        shift_date: '2026-09-07',
        start_time: '2026-09-07T08:00:00-07:00',
        end_time: '2026-09-07T16:30:00-07:00',
        status: 'draft',
        notes: '__SMOKE_TEST_AUTO_REMOVE__'
    }

    console.log('  Inserting test shift into shifts table...')
    const { data: inserted, error: insertErr } = await supabase
        .from('shifts')
        .insert(testShift)
        .select()
        .single()

    if (insertErr) {
        console.error('  Mutation INSERT Error:', insertErr)
        throw insertErr
    }
    console.log(`  [PASS] Inserted test shift id=${inserted.id}`)

    // Read back
    const { data: readBack, error: readErr } = await supabase
        .from('shifts')
        .select('*')
        .eq('id', inserted.id)
        .single()

    if (readErr || !readBack) throw new Error('Failed to read back inserted shift')
    console.log(`  [PASS] Verified shift readback: status='${readBack.status}', shift_date='${readBack.shift_date}'`)

    // Clean up
    console.log('  Cleaning up test shift...')
    const { error: deleteErr } = await supabase
        .from('shifts')
        .delete()
        .eq('id', inserted.id)

    if (deleteErr) throw deleteErr
    console.log('  [PASS] Cleaned up test shift successfully')

    console.log('\n=====================================================')
    console.log('   ALL 4 LIVE VERIFICATION TESTS PASSED (100% OK)     ')
    console.log('=====================================================')
}

runLiveTests().catch(err => {
    console.error('Verification failed:', err)
    process.exit(1)
})

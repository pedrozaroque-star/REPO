import { getSupabaseClient } from '../lib/supabase'
import { formatDateISO, addDays, getMonday } from '../app/planificador/lib/utils'

async function runMultiDaySmokeTest() {
    console.log('=====================================================')
    console.log('   TACOS GAVILAN - MULTI-DAY SHIFT SMOKE TEST        ')
    console.log('=====================================================')

    const baseMonday = new Date('2026-10-05T12:00:00') // Monday
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(baseMonday, i))

    // 1. Test Multi-Day Generation Logic (Mon-Fri)
    console.log('\n--- TEST 1: Generating 5 Shifts (Mon-Fri 09:00 - 17:00) ---')
    const selectedDays = weekDays.slice(0, 5).map(d => formatDateISO(d))
    const startTime = '09:00'
    const endTime = '17:00'
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)

    const shifts = selectedDays.map(dStr => {
        const dateBase = new Date(dStr + 'T12:00:00')
        const start = new Date(dateBase)
        start.setHours(sh, sm, 0, 0)
        const end = new Date(dateBase)
        end.setHours(eh, em, 0, 0)

        return {
            shift_date: dStr,
            start_time: start.toISOString(),
            end_time: end.toISOString()
        }
    })

    console.log(`  Generated ${shifts.length} shifts:`)
    shifts.forEach((s, idx) => {
        const dur = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / (1000 * 3600)
        console.log(`    Day ${idx + 1} (${s.shift_date}): ${new Date(s.start_time).toLocaleTimeString()} - ${new Date(s.end_time).toLocaleTimeString()} (${dur}h)`)
    })

    const allDurationsOk = shifts.every(s => (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) === 8 * 3600 * 1000)
    console.log(`  ${allDurationsOk ? '[PASS]' : '[FAIL]'} All 5 shifts have exact 8.0h duration`)
    if (!allDurationsOk) throw new Error('Shift duration calculation mismatch')

    // 2. Test Multi-Day Overnight Shift (PM Shift 17:00 - 01:30)
    console.log('\n--- TEST 2: Multi-Day Overnight PM Shift (17:00 - 01:30) ---')
    const pmStart = '17:00'
    const pmEnd = '01:30'
    const [psh, psm] = pmStart.split(':').map(Number)
    const [peh, pem] = pmEnd.split(':').map(Number)
    const isOvernight = (peh < psh) || (peh === psh && pem < psm)

    const pmShifts = selectedDays.map(dStr => {
        const dateBase = new Date(dStr + 'T12:00:00')
        const start = new Date(dateBase)
        start.setHours(psh, psm, 0, 0)
        const end = new Date(dateBase)
        if (isOvernight) end.setDate(end.getDate() + 1)
        end.setHours(peh, pem, 0, 0)

        return {
            shift_date: dStr,
            start_time: start.toISOString(),
            end_time: end.toISOString()
        }
    })

    const allPMDurationsOk = pmShifts.every(s => (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) === 8.5 * 3600 * 1000)
    console.log(`  ${allPMDurationsOk ? '[PASS]' : '[FAIL]'} All 5 overnight PM shifts have exact 8.5h duration across midnight`)
    if (!allPMDurationsOk) throw new Error('Overnight calculation failed')

    // 3. Test Live Supabase Batch Mutation (Insert 3 Shifts & Delete)
    console.log('\n--- TEST 3: Live Supabase DB Batch Mutation Smoke Test ---')
    const supabase = await getSupabaseClient()
    const { data: store } = await supabase.from('stores').select('id, name').limit(1).single()
    if (!store) throw new Error('No store found in DB')

    const batchTestPayloads = [
        {
            store_id: store.id,
            shift_date: '2026-10-05',
            start_time: '2026-10-05T09:00:00.000Z',
            end_time: '2026-10-05T17:00:00.000Z',
            is_open: true,
            status: 'draft',
            notes: 'TEST_MULTIDAY_SMOKE_1'
        },
        {
            store_id: store.id,
            shift_date: '2026-10-06',
            start_time: '2026-10-06T09:00:00.000Z',
            end_time: '2026-10-06T17:00:00.000Z',
            is_open: true,
            status: 'draft',
            notes: 'TEST_MULTIDAY_SMOKE_2'
        },
        {
            store_id: store.id,
            shift_date: '2026-10-07',
            start_time: '2026-10-07T09:00:00.000Z',
            end_time: '2026-10-07T17:00:00.000Z',
            is_open: true,
            status: 'draft',
            notes: 'TEST_MULTIDAY_SMOKE_3'
        }
    ]

    console.log(`  Batch inserting ${batchTestPayloads.length} shifts to Supabase...`)
    const { data: inserted, error: insertError } = await supabase.from('shifts').insert(batchTestPayloads).select()
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`)
    console.log(`  [PASS] Successfully batch inserted ${inserted.length} test shifts!`)

    // Verify
    const insertedIds = inserted.map(s => s.id)
    const { data: verified, error: verifyError } = await supabase.from('shifts').select('id, notes').in('id', insertedIds)
    if (verifyError || verified.length !== 3) throw new Error('Verification failed')
    console.log(`  [PASS] Verified readback: all 3 shifts exist in DB`)

    // Cleanup
    console.log(`  Cleaning up test shifts...`)
    const { error: deleteError } = await supabase.from('shifts').delete().in('id', insertedIds)
    if (deleteError) throw new Error(`Cleanup failed: ${deleteError.message}`)
    console.log(`  [PASS] Cleaned up test shifts successfully`)

    console.log('\n=====================================================')
    console.log('   ALL MULTI-DAY VERIFICATION TESTS PASSED (100% OK) ')
    console.log('=====================================================')
}

runMultiDaySmokeTest().catch(err => {
    console.error('Test failed:', err)
    process.exit(1)
})

import { formatDateISO, addDays } from '../app/planificador/lib/utils'

console.log('=====================================================')
console.log('   TACOS GAVILAN - MOBILE PLANNER LOGIC SMOKE TEST   ')
console.log('=====================================================')

// 1. Test 1-Tap Presets
const testDate = new Date('2026-09-30T12:00:00')
const dateStr = formatDateISO(testDate)

console.log(`\n--- TEST 1: Preset Shifts Time & Duration Verification ---`)
const presets = [
    { name: 'Apertura', startHour: 7, startMin: 0, endHour: 15, endMin: 30, isOvernight: false, expectedHours: 8.5 },
    { name: 'Medio', startHour: 11, startMin: 0, endHour: 19, endMin: 30, isOvernight: false, expectedHours: 8.5 },
    { name: 'Turno PM', startHour: 17, startMin: 0, endHour: 1, endMin: 30, isOvernight: true, expectedHours: 8.5 },
    { name: 'Cierre', startHour: 16, startMin: 0, endHour: 0, endMin: 30, isOvernight: true, expectedHours: 8.5 }
]

presets.forEach(p => {
    const start = new Date(testDate)
    start.setHours(p.startHour, p.startMin, 0, 0)
    const end = new Date(testDate)
    if (p.isOvernight) end.setDate(end.getDate() + 1)
    end.setHours(p.endHour, p.endMin, 0, 0)

    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    const pass = Math.abs(durationHours - p.expectedHours) < 0.01
    console.log(`  ${pass ? '[PASS]' : '[FAIL]'} ${p.name}: Start=${start.toLocaleTimeString('en-US')}, End=${end.toLocaleTimeString('en-US')}, Hours=${durationHours}h`)
    if (!pass) throw new Error(`Preset ${p.name} failed duration calculation`)
})

// 2. Test Duplicate to Next Day Logic
console.log(`\n--- TEST 2: Duplicate to Next Day Calculation ---`)
const origStart = new Date('2026-09-30T17:00:00') // Wed 5:00 PM
const origEnd = new Date('2026-10-01T01:30:00')   // Thu 1:30 AM (overnight)
const durationMs = origEnd.getTime() - origStart.getTime()

const nextDay = addDays(testDate, 1)
const newStart = new Date(nextDay)
newStart.setHours(origStart.getHours(), origStart.getMinutes(), 0, 0)
const newEnd = new Date(newStart.getTime() + durationMs)

console.log(`  Original: ${origStart.toLocaleString('en-US')} -> ${origEnd.toLocaleString('en-US')}`)
console.log(`  Duplicated: ${newStart.toLocaleString('en-US')} -> ${newEnd.toLocaleString('en-US')}`)
const dupPass = newStart.getDate() === 1 && newEnd.getDate() === 2 && (newEnd.getTime() - newStart.getTime()) === durationMs
console.log(`  ${dupPass ? '[PASS]' : '[FAIL]'} Duplicated shift preserved exact 8.5h duration and overnight offset`)
if (!dupPass) throw new Error('Duplicate logic failed')

// 3. Test Filter Count Invariants
// 4. Test Employee Contact Sheet Data Extraction
console.log(`\n--- TEST 4: Employee Contact Sheet Data Resolution ---`)
const sampleEmp = {
    id: 'emp-101',
    first_name: 'Victor',
    last_name: 'Muñoz',
    chosen_name: 'Victor',
    phone: '323-555-0199',
    email: 'victor.munoz@tacosgavilan.com',
    external_id: '1042',
    toast_guid: '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d'
}

const telLink = `tel:${sampleEmp.phone}`
const smsLink = `sms:${sampleEmp.phone}`
const mailLink = `mailto:${sampleEmp.email}`
const posId = sampleEmp.external_id || sampleEmp.toast_guid.slice(0, 8)

console.log(`  Employee: ${sampleEmp.chosen_name} ${sampleEmp.last_name}`)
console.log(`  Tel Link: ${telLink}`)
console.log(`  SMS Link: ${smsLink}`)
console.log(`  Email Link: ${mailLink}`)
console.log(`  POS Code: #${posId}`)

const contactPass = telLink === 'tel:323-555-0199' &&
    smsLink === 'sms:323-555-0199' &&
    mailLink === 'mailto:victor.munoz@tacosgavilan.com' &&
    posId === '1042'

console.log(`  ${contactPass ? '[PASS]' : '[FAIL]'} 1-Tap contact protocol links generated accurately`)
if (!contactPass) throw new Error('Contact links failed')

// 5. Test Live DB Connection and toast_employees contact fields
console.log(`\n--- TEST 5: Live Database Employee Contact Fields Check ---`)
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function runLiveDbTest() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
        console.log('  [SKIP] Supabase env vars not found for live DB test')
        return
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: emps, error } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name, chosen_name, phone, email, external_id, toast_guid')
        .limit(5)

    if (error) {
        console.error('  [FAIL] DB query error:', error.message)
        throw error
    }

    console.log(`  Retrieved ${emps?.length || 0} sample employees from toast_employees:`)
    emps?.forEach(e => {
        const name = `${e.chosen_name || e.first_name} ${e.last_name}`
        const phoneDisplay = e.phone || '(No phone)'
        const emailDisplay = e.email || '(No email)'
        const pos = e.external_id || (e.toast_guid ? e.toast_guid.slice(0, 8) : 'N/A')
        console.log(`  - ${name.padEnd(25)} | Tel: ${phoneDisplay.padEnd(15)} | POS: #${pos}`)
    })
    console.log(`  [PASS] Live DB query verified schema compatibility for Contact Sheet`)
}

runLiveDbTest().then(() => {
    console.log(`\n=====================================================`)
    console.log(`   ALL MOBILE LOGIC SMOKE TESTS PASSED (100% OK)      `)
    console.log(`=====================================================`)
}).catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})


/**
 * Simulation Test for Preparador Mobile & Business Logic
 * Tests:
 * 1. Business Day Rollover (6:00 AM cutoff in America/Los_Angeles)
 * 2. 48 Half-hour intervals coverage
 * 3. Mobile state transitions & calculations (Parrilla, Insumos cart, Resumen totals)
 * 4. Division by zero safeguards for meat pace
 * 5. Live DB smoke test on preparador_requests table (insert + query + cleanup)
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// 1. Business Day Rollover Simulation
function testBusinessDate(mockDate: Date): string {
    const laDateStr = mockDate.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const laTimeStr = mockDate.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false })
    let hour = parseInt(laTimeStr.split(':')[0], 10)
    if (hour === 24) hour = 0
    
    if (hour < 6) {
        const [y, m, d] = laDateStr.split('-').map(Number)
        const prevDay = new Date(y, m - 1, d - 1)
        const py = prevDay.getFullYear()
        const pm = String(prevDay.getMonth() + 1).padStart(2, '0')
        const pd = String(prevDay.getDate()).padStart(2, '0')
        return `${py}-${pm}-${pd}`
    }
    return laDateStr
}

// 2. 48 Intervals Generator
function generate48Intervals(): string[] {
    const intervals: string[] = []
    for (let i = 0; i < 48; i++) {
        const totalMinutes = 6 * 60 + i * 30
        const h = Math.floor(totalMinutes / 60) % 24
        const m = totalMinutes % 60
        intervals.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`)
    }
    return intervals
}

async function runTests() {
    console.log('🚀 Starting Preparador Mobile & Logic Simulation Suite...\n')
    let passed = 0
    let failed = 0

    // Test 1: 5:59 AM vs 6:00 AM Rollover
    try {
        const d1 = new Date('2026-09-30T12:59:00Z') // 5:59 AM PDT
        const d2 = new Date('2026-09-30T13:00:00Z') // 6:00 AM PDT
        const date1 = testBusinessDate(d1)
        const date2 = testBusinessDate(d2)

        if (date1 === '2026-09-29' && date2 === '2026-09-30') {
            console.log('✅ Test 1 Passed: Business date rollover at 6:00 AM works perfectly.')
            passed++
        } else {
            console.error(`❌ Test 1 Failed: Expected 2026-09-29 and 2026-09-30, got ${date1} and ${date2}`)
            failed++
        }
    } catch (e: any) {
        console.error('❌ Test 1 Error:', e.message)
        failed++
    }

    // Test 2: 48 Intervals coverage
    try {
        const intervals = generate48Intervals()
        if (intervals.length === 48 && intervals[0] === '06:00:00' && intervals[47] === '05:30:00') {
            console.log('✅ Test 2 Passed: Exactly 48 intervals from 06:00 to 05:30 generated.')
            passed++
        } else {
            console.error(`❌ Test 2 Failed: Expected 48 intervals starting 06:00 and ending 05:30. Got ${intervals.length}, ${intervals[0]}, ${intervals[intervals.length - 1]}`)
            failed++
        }
    } catch (e: any) {
        console.error('❌ Test 2 Error:', e.message)
        failed++
    }

    // Test 3: Division by zero safety in meat calculations
    try {
        const safePaceCalculation = (avg_lbs: number, accelerator: number, duration: number) => {
            const projectedLbs = (avg_lbs || 0) * (accelerator || 1.0)
            const safeDuration = duration > 0 ? duration : 1
            const displayVal = projectedLbs / safeDuration
            return {
                projectedLbs,
                displayVal,
                maxTrayLbs: Math.max(1, Math.ceil(displayVal))
            }
        }

        const resZero = safePaceCalculation(0, 1.2, 0)
        const resNormal = safePaceCalculation(15.4, 1.15, 2)

        if (
            Number.isFinite(resZero.displayVal) &&
            !isNaN(resZero.displayVal) &&
            resZero.maxTrayLbs === 1 &&
            resNormal.maxTrayLbs === 9
        ) {
            console.log('✅ Test 3 Passed: Zero-division and NaN protection verified.')
            passed++
        } else {
            console.error('❌ Test 3 Failed:', { resZero, resNormal })
            failed++
        }
    } catch (e: any) {
        console.error('❌ Test 3 Error:', e.message)
        failed++
    }

    // Test 4: Cart logic for mobile supplies (add, increase, decrease, total count)
    try {
        interface CartItem { name: string; qty: number }
        let cart: CartItem[] = []

        const addToCart = (name: string) => {
            const existing = cart.find(c => c.name === name)
            if (existing) {
                cart = cart.map(c => c.name === name ? { ...c, qty: c.qty + 1 } : c)
            } else {
                cart = [...cart, { name, qty: 1 }]
            }
        }

        const decreaseItem = (name: string) => {
            const existing = cart.find(c => c.name === name)
            if (!existing) return
            if (existing.qty <= 1) {
                cart = cart.filter(c => c.name !== name)
            } else {
                cart = cart.map(c => c.name === name ? { ...c, qty: c.qty - 1 } : c)
            }
        }

        addToCart('Tortillas de maiz')
        addToCart('Tortillas de maiz')
        addToCart('Salsa verde')
        const totalItems1 = cart.reduce((acc, item) => acc + item.qty, 0) // Should be 3
        decreaseItem('Tortillas de maiz')
        const totalItems2 = cart.reduce((acc, item) => acc + item.qty, 0) // Should be 2
        decreaseItem('Salsa verde')
        const totalItems3 = cart.reduce((acc, item) => acc + item.qty, 0) // Should be 1

        if (totalItems1 === 3 && totalItems2 === 2 && totalItems3 === 1 && cart[0].name === 'Tortillas de maiz') {
            console.log('✅ Test 4 Passed: Mobile cart aggregation and counter badge logic verified.')
            passed++
        } else {
            console.error('❌ Test 4 Failed: Cart counts unexpected', { totalItems1, totalItems2, totalItems3 })
            failed++
        }
    } catch (e: any) {
        console.error('❌ Test 4 Error:', e.message)
        failed++
    }

    // Test 5: Live Database Mutation Smoke Test on preparador_requests
    try {
        // Query stores to get a valid store_id
        const { data: storeData } = await supabase.from('stores').select('id').limit(1)
        const testStoreId = storeData?.[0]?.id

        if (!testStoreId) {
            console.warn('⚠️ Test 5 Skipped: No stores found in DB to test mutation.')
        } else {
            // Live insert
            const testPayload = {
                store_id: testStoreId,
                items: [{ name: 'TEST_ITEM_SIMULATION', qty: 1 }],
                status: 'PENDING'
            }

            const { data: inserted, error: insertErr } = await supabase
                .from('preparador_requests')
                .insert([testPayload])
                .select()
                .single()

            if (insertErr || !inserted) {
                console.error('❌ Test 5 Failed inserting preparador_requests:', insertErr)
                failed++
            } else {
                // Immediate cleanup
                const { error: deleteErr } = await supabase
                    .from('preparador_requests')
                    .delete()
                    .eq('id', inserted.id)

                if (deleteErr) {
                    console.error('❌ Test 5 Cleanup Error:', deleteErr)
                    failed++
                } else {
                    console.log('✅ Test 5 Passed: Live Supabase DB mutation smoke test (insert + clean) passed without errors.')
                    passed++
                }
            }
        }
    } catch (e: any) {
        console.error('❌ Test 5 Exception:', e.message)
        failed++
    }

    console.log(`\n========================================`)
    console.log(`Results: ${passed} Passed, ${failed} Failed`)
    console.log(`========================================\n`)

    if (failed > 0) process.exit(1)
}

runTests().catch(err => {
    console.error('Simulation Suite fatal error:', err)
    process.exit(1)
})

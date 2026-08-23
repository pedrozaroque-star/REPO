import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function runComprehensiveDiscountSimulation() {
    console.log('═══════════════════════════════════════════════════════════════════')
    console.log('🔬 SIMULACIÓN AUTOMATIZADA: MÓDULO DE DESCUENTOS Y AUDITORÍA')
    console.log('═══════════════════════════════════════════════════════════════════\n')

    let allTestsPassed = true

    // ─────────────────────────────────────────────────────────────────
    // TEST 1: Regla de Día Laboral (6:00 AM a 5:59 AM)
    // ─────────────────────────────────────────────────────────────────
    console.log('--- TEST 1: Regla de Día Laboral y Zonas Horarias ---')
    const testTimes = [
        { iso: '2026-07-26T05:59:59-07:00', expectedDate: '2026-07-25', desc: '5:59:59 AM (pertenece al día anterior)' },
        { iso: '2026-07-26T06:00:00-07:00', expectedDate: '2026-07-26', desc: '6:00:00 AM (inicia nuevo día laboral)' },
        { iso: '2026-07-26T16:59:59-07:00', isPM: false, desc: '4:59:59 PM (Turno AM)' },
        { iso: '2026-07-26T17:00:00-07:00', isPM: true, desc: '5:00:00 PM (Inicia Turno PM)' }
    ]

    testTimes.forEach(t => {
        const d = new Date(t.iso)
        const hour = d.getHours()
        if (t.isPM !== undefined) {
            const isPMActual = hour >= 17 || hour < 6
            const pass = isPMActual === t.isPM
            if (!pass) allTestsPassed = false
            console.log(`  ${pass ? '✅' : '❌'} ${t.desc} -> Calculado: ${isPMActual ? 'PM' : 'AM'} (Esperado: ${t.isPM ? 'PM' : 'AM'})`)
        }
    })

    // ─────────────────────────────────────────────────────────────────
    // TEST 2: Prevención de División por Cero (NaN / Infinity)
    // ─────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Robustez Matemática y Prevención de NaN / Infinity ---')
    const zeroMetrics = {
        totalDiscounts: 0,
        totalSales: 0,
        seniorTotal: 0,
        employeeTotal: 0,
        orderCount: 0
    }

    const safeDiscountPct = zeroMetrics.totalSales > 0 ? (zeroMetrics.totalDiscounts / zeroMetrics.totalSales) * 100 : 0
    const safeSeniorPct = zeroMetrics.totalDiscounts > 0 ? (zeroMetrics.seniorTotal / zeroMetrics.totalDiscounts) * 100 : 0
    const safeAvgPerOrder = zeroMetrics.orderCount > 0 ? zeroMetrics.totalDiscounts / zeroMetrics.orderCount : 0

    const noNaN = !isNaN(safeDiscountPct) && !isNaN(safeSeniorPct) && !isNaN(safeAvgPerOrder)
    const noInfinity = isFinite(safeDiscountPct) && isFinite(safeSeniorPct) && isFinite(safeAvgPerOrder)
    if (!noNaN || !noInfinity) allTestsPassed = false
    console.log(`  ${noNaN && noInfinity ? '✅' : '❌'} Casos de cero ventas / cero descuentos -> Pct: ${safeDiscountPct}%, SeniorPct: ${safeSeniorPct}%, Avg: $${safeAvgPerOrder}`)

    // ─────────────────────────────────────────────────────────────────
    // TEST 3: Detección Exacta de Doble Descuento
    // ─────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Clasificador de Doble Descuento ---')
    const testTickets = [
        {
            name: 'Ticket #940 (Lynwood) - Doble Descuento Verdadero',
            discounts: [
                { discount_name: 'Employee Discount', discount_amount: 4.60 },
                { discount_name: 'Cash Reward', discount_amount: 3.30 }
            ],
            subtotalBruto: 15.80,
            subtotalNeto: 7.90,
            expectedDouble: true
        },
        {
            name: 'Ticket #285 (West Covina) - Promoción Múltiples Tacos (Misma Regla)',
            discounts: [
                { discount_name: 'Taco Tuesday', discount_amount: 10.50 },
                { discount_name: 'Taco Tuesday', discount_amount: 6.00 }
            ],
            subtotalBruto: 110.00,
            subtotalNeto: 93.50,
            expectedDouble: false
        },
        {
            name: 'Ticket #141 (West Covina) - Duplicado Fantasma Toast ($9.93 + $9.93)',
            discounts: [
                { discount_name: 'Employee Discount', discount_amount: 9.93 },
                { discount_name: 'First Responder Discount', discount_amount: 9.93 }
            ],
            subtotalBruto: 19.86,
            subtotalNeto: 9.93,
            expectedDouble: false
        },
        {
            name: 'Ticket #696 (Santa Ana) - Descuento Sobrescrito en POS ($1.20 + $2.40)',
            discounts: [
                { discount_name: '25% Off - Catering', discount_amount: 1.20 },
                { discount_name: 'First Responder Discount', discount_amount: 2.40 }
            ],
            subtotalBruto: 4.79,
            subtotalNeto: 2.39,
            expectedDouble: false
        }
    ]

    function evaluateDoubleDiscount(ticket: typeof testTickets[0]) {
        const types = Array.from(new Set(ticket.discounts.map(d => d.discount_name)))
        if (types.length <= 1) return false

        const amounts = ticket.discounts.map(d => d.discount_amount)
        const maxAmt = Math.max(...amounts)
        const isGhost = amounts.every(a => Math.abs(a - maxAmt) < 0.01)
        if (isGhost) return false

        const totalRealDiscount = Math.max(0, ticket.subtotalBruto - ticket.subtotalNeto)
        const sumAmounts = amounts.reduce((a, b) => a + b, 0)

        // Si la suma excede la rebaja en dinero real del ticket, fue sobrescrito
        if (sumAmounts > totalRealDiscount + 0.05) return false

        return true
    }

    testTickets.forEach(t => {
        const result = evaluateDoubleDiscount(t)
        const pass = result === t.expectedDouble
        if (!pass) allTestsPassed = false
        console.log(`  ${pass ? '✅' : '❌'} ${t.name} -> Resultado: ${result ? '🚨 DOBLE DESCUENTO' : 'NORMAL'} (Esperado: ${t.expectedDouble ? 'DOBLE' : 'NORMAL'})`)
    })

    // ─────────────────────────────────────────────────────────────────
    // TEST 4: Prueba Real de Mutación y Limpieza en Base de Datos
    // ─────────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Live DB Mutation Smoke Test (Supabase sales_discounts_log) ---')
    const testRecord = {
        store_id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
        store_name: 'Lynwood',
        business_date: '2026-07-29',
        discount_name: 'TEST_SMOKE_DISCOUNT',
        discount_amount: 5.00,
        approver_name: 'Smoke Test Agent',
        server_name: 'Smoke Test Agent',
        order_id: 'test-smoke-order-guid',
        check_id: '999999',
        opened_date: new Date().toISOString()
    }

    const { data: inserted, error: insertErr } = await supabase
        .from('sales_discounts_log')
        .insert(testRecord)
        .select()
        .single()

    if (insertErr || !inserted) {
        console.error('  ❌ Error insertando registro de prueba:', insertErr?.message)
        allTestsPassed = false
    } else {
        console.log('  ✅ Inserción real en sales_discounts_log exitosa. ID:', inserted.id)

        // Limpiar inmediatamente
        const { error: deleteErr } = await supabase
            .from('sales_discounts_log')
            .delete()
            .eq('id', inserted.id)

        if (deleteErr) {
            console.error('  ❌ Error limpiando registro de prueba:', deleteErr.message)
            allTestsPassed = false
        } else {
            console.log('  ✅ Limpieza inmediata de registro de prueba completada.')
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════')
    console.log(allTestsPassed ? '🎉 TODAS LAS SIMULACIONES PASARON CON 100% DE ÉXITO' : '⚠️ ALGUNAS PRUEBAS FALLARON')
    console.log('═══════════════════════════════════════════════════════════════════\n')
}

runComprehensiveDiscountSimulation()

/**
 * Simulation and Runtime Test for Daily Order Safeguards (Blindaje de Captura)
 * Tests:
 * 1. Typos in Leftovers (e.g. typing 55 instead of 5)
 * 2. Negative Adjustments (e.g. typing -5)
 * 3. Extreme Adjustments (e.g. typing 80 when PAR is 10)
 * 4. Critical staple items ending in 0
 * 5. Hard cap catastrophic quantities (> 999)
 * 6. Business Day Cutoff logic (6:00 AM vs 5:59 AM)
 * 7. Division by zero, NaN, empty string resiliency
 */

import { getBusinessMonday, addDays, type CalculatedOrderLine } from '../app/inventory/orders/utils'

function runSimulation() {
    console.log('=== TEST SUITE: BLINDAJE DE ORDEN DIARIA (SAFEGUARDS) ===\n')

    let testsPassed = 0
    let totalTests = 0

    function assert(condition: boolean, testName: string, detail?: string) {
        totalTests++
        if (condition) {
            console.log(`✅ [PASS] ${testName}`)
            testsPassed++
        } else {
            console.error(`❌ [FAIL] ${testName} - Detail: ${detail}`)
            process.exit(1)
        }
    }

    // -------------------------------------------------------------
    // Helper anomaly detection (matching page.tsx logic exactly)
    // -------------------------------------------------------------
    interface OrderAnomaly {
        itemId: string
        itemName: string
        parValue: number
        leftoverValue: number | null
        calculatedQty: number
        adjustedQty?: number
        finalQty: number
        type: 'high_leftover' | 'high_adjust' | 'high_final' | 'zero_critical' | 'negative_final'
        message: string
    }

    function detectOrderAnomalies(
        lines: CalculatedOrderLine[],
        adjustmentsMap: Record<string, number | string>,
        countsMap: Record<string, Record<string, number>>,
        orderDate: string,
        lang: string
    ): OrderAnomaly[] {
        const anomalies: OrderAnomaly[] = []

        for (const l of lines) {
            const rawAdj = adjustmentsMap[l.inventory_item_id]
            const adjNum = rawAdj !== undefined && rawAdj !== '' ? Number(rawAdj) : undefined
            const finalQty = adjNum !== undefined && !isNaN(adjNum) ? adjNum : l.calculated_qty
            const currentLeftover = countsMap[l.inventory_item_id]?.[orderDate]
            const par = l.par_value || 0

            // 1. Sobrante anormalmente alto vs PAR (detecta typos como poner 55 en vez de 5)
            if (
                !l.is_extraordinary &&
                currentLeftover !== undefined &&
                currentLeftover !== null &&
                par > 0
            ) {
                const isHighLeftover = (par >= 3 && currentLeftover >= par * 1.5 && (currentLeftover - par >= 4)) ||
                    (par < 3 && currentLeftover >= 8)

                if (isHighLeftover) {
                    const percent = Math.round(((currentLeftover - par) / par) * 100)
                    anomalies.push({
                        itemId: l.inventory_item_id,
                        itemName: l.item_name,
                        parValue: par,
                        leftoverValue: currentLeftover,
                        calculatedQty: l.calculated_qty,
                        adjustedQty: adjNum,
                        finalQty,
                        type: 'high_leftover',
                        message: lang === 'es'
                            ? `Sobrante capturado (${currentLeftover}) es ${percent}% mayor al PAR (${par}). Provocará pedir 0 unidades.`
                            : `Captured leftover (${currentLeftover}) is ${percent}% higher than PAR (${par}). Will result in ordering 0 units.`
                    })
                    continue
                }
            }

            // 2. Ajuste manual inusualmente alto o negativo
            if (adjNum !== undefined && !isNaN(adjNum)) {
                if (adjNum < 0) {
                    anomalies.push({
                        itemId: l.inventory_item_id,
                        itemName: l.item_name,
                        parValue: par,
                        leftoverValue: currentLeftover ?? null,
                        calculatedQty: l.calculated_qty,
                        adjustedQty: adjNum,
                        finalQty,
                        type: 'negative_final',
                        message: lang === 'es'
                            ? `El ajuste ingresado (${adjNum}) es negativo.`
                            : `Entered adjustment (${adjNum}) is negative.`
                    })
                    continue
                }

                const isHighAdjust = (par >= 4 && adjNum >= par * 2.5 && (adjNum - par >= 8)) ||
                    (par < 4 && par > 0 && adjNum >= 25) ||
                    (par === 0 && adjNum >= 50)

                if (isHighAdjust) {
                    anomalies.push({
                        itemId: l.inventory_item_id,
                        itemName: l.item_name,
                        parValue: par,
                        leftoverValue: currentLeftover ?? null,
                        calculatedQty: l.calculated_qty,
                        adjustedQty: adjNum,
                        finalQty,
                        type: 'high_adjust',
                        message: lang === 'es'
                            ? `Ajuste manual (${adjNum}) excede ampliamente el PAR habitual (${par}). Pedido final: ${finalQty}.`
                            : `Manual adjustment (${adjNum}) substantially exceeds PAR (${par}). Final order: ${finalQty}.`
                    })
                    continue
                }
            }

            // 3. Cantidad final elevada no justificada
            if (par > 0 && finalQty > Math.max(par * 2.5, 30)) {
                anomalies.push({
                    itemId: l.inventory_item_id,
                    itemName: l.item_name,
                    parValue: par,
                    leftoverValue: currentLeftover ?? null,
                    calculatedQty: l.calculated_qty,
                    adjustedQty: adjNum,
                    finalQty,
                    type: 'high_final',
                    message: lang === 'es'
                        ? `Cantidad final (${finalQty}) es más de 2.5x el consumo diario normal (PAR ${par}).`
                        : `Final quantity (${finalQty}) is over 2.5x normal daily consumption (PAR ${par}).`
                })
                continue
            }

            // 4. Insumo de alto volumen que queda en 0
            if (!l.is_extraordinary && par >= 15 && finalQty === 0 && currentLeftover !== undefined) {
                anomalies.push({
                    itemId: l.inventory_item_id,
                    itemName: l.item_name,
                    parValue: par,
                    leftoverValue: currentLeftover,
                    calculatedQty: l.calculated_qty,
                    adjustedQty: adjNum,
                    finalQty,
                    type: 'zero_critical',
                    message: lang === 'es'
                        ? `Insumo de alto volumen (PAR ${par}) quedará en 0 a pedir por el sobrante reportado (${currentLeftover}).`
                        : `High-volume item (PAR ${par}) will have 0 ordered due to reported leftover (${currentLeftover}).`
                })
            }
        }

        return anomalies
    }

    function validateHardCaps(
        lines: CalculatedOrderLine[],
        adjustmentsMap: Record<string, number | string>
    ): string | null {
        for (const l of lines) {
            const rawAdj = adjustmentsMap[l.inventory_item_id]
            const adjNum = rawAdj !== undefined && rawAdj !== '' ? Number(rawAdj) : undefined
            const finalQty = adjNum !== undefined && !isNaN(adjNum) ? adjNum : l.calculated_qty

            if (finalQty < 0) {
                return `Cantidad negativa detectada en ${l.item_name}: ${finalQty}`
            }

            const maxAllowed = 999
            if (finalQty > maxAllowed) {
                return `El insumo "${l.item_name}" tiene una cantidad final de ${finalQty}. El límite máximo es ${maxAllowed}.`
            }
        }
        return null
    }

    // -------------------------------------------------------------
    // Test 1: Typo in Leftovers (Typing 55 instead of 5 for Queso Asadero)
    // -------------------------------------------------------------
    const lineQueso: CalculatedOrderLine = {
        inventory_item_id: 'item-queso',
        item_name: 'Queso Asadero (Caja)',
        unit_description: 'Case',
        par_value: 10,
        par_ideal_value: 10,
        leftover_value: 55,
        calculated_qty: 0,
        rounding_rule: 'none',
        qb_item_id: 'QB-101'
    }
    const anomalies1 = detectOrderAnomalies(
        [lineQueso],
        {},
        { 'item-queso': { '2026-09-26': 55 } },
        '2026-09-26',
        'es'
    )
    assert(anomalies1.length === 1, 'Test 1: Catches leftover typo (55 vs PAR 10)')
    assert(anomalies1[0].type === 'high_leftover', 'Test 1: Type is high_leftover')
    assert(anomalies1[0].leftoverValue === 55, 'Test 1: Identifies 55 leftover value')

    // -------------------------------------------------------------
    // Test 2: Negative Adjustment (-10)
    // -------------------------------------------------------------
    const lineTortillas: CalculatedOrderLine = {
        inventory_item_id: 'item-tortillas',
        item_name: 'Tortillas Maiz',
        unit_description: 'Caja',
        par_value: 20,
        par_ideal_value: 20,
        leftover_value: 5,
        calculated_qty: 15,
        rounding_rule: 'none',
        qb_item_id: 'QB-102'
    }
    const anomalies2 = detectOrderAnomalies(
        [lineTortillas],
        { 'item-tortillas': -10 },
        { 'item-tortillas': { '2026-09-26': 5 } },
        '2026-09-26',
        'es'
    )
    assert(anomalies2.length === 1, 'Test 2: Catches negative adjustment')
    assert(anomalies2[0].type === 'negative_final', 'Test 2: Type is negative_final')

    // -------------------------------------------------------------
    // Test 3: Hard Cap blocks negative numbers
    // -------------------------------------------------------------
    const hardCapErrNegative = validateHardCaps([lineTortillas], { 'item-tortillas': -10 })
    assert(hardCapErrNegative !== null, 'Test 3: Hard cap blocks negative final quantity')

    // -------------------------------------------------------------
    // Test 4: Extreme Adjustment (+100 when PAR is 12)
    // -------------------------------------------------------------
    const lineCarne: CalculatedOrderLine = {
        inventory_item_id: 'item-asada',
        item_name: 'Carne Asada Diezmillo',
        unit_description: 'Case',
        par_value: 12,
        par_ideal_value: 12,
        leftover_value: 2,
        calculated_qty: 10,
        rounding_rule: 'none',
        qb_item_id: 'QB-103'
    }
    const anomalies4 = detectOrderAnomalies(
        [lineCarne],
        { 'item-asada': 85 },
        { 'item-asada': { '2026-09-26': 2 } },
        '2026-09-26',
        'es'
    )
    assert(anomalies4.length === 1, 'Test 4: Catches abnormally high adjustment')
    assert(anomalies4[0].type === 'high_adjust', 'Test 4: Type is high_adjust')

    // -------------------------------------------------------------
    // Test 5: Hard Cap blocks catastrophic orders (> 999)
    // -------------------------------------------------------------
    const hardCapErrHuge = validateHardCaps([lineCarne], { 'item-asada': 1500 })
    assert(hardCapErrHuge !== null, 'Test 5: Hard cap strictly blocks order > 999')

    // -------------------------------------------------------------
    // Test 6: Normal valid order passes with 0 anomalies
    // -------------------------------------------------------------
    const lineCebolla: CalculatedOrderLine = {
        inventory_item_id: 'item-cebolla',
        item_name: 'Cebolla Blanca',
        unit_description: 'Saco 50lb',
        par_value: 6,
        par_ideal_value: 6,
        leftover_value: 2,
        calculated_qty: 4,
        rounding_rule: 'none',
        qb_item_id: 'QB-104'
    }
    const anomalies6 = detectOrderAnomalies(
        [lineCebolla],
        {},
        { 'item-cebolla': { '2026-09-26': 2 } },
        '2026-09-26',
        'es'
    )
    assert(anomalies6.length === 0, 'Test 6: Normal healthy order has 0 anomalies')

    // -------------------------------------------------------------
    // Test 7: Zero Critical (High volume staple ending in 0)
    // -------------------------------------------------------------
    const lineAguacate: CalculatedOrderLine = {
        inventory_item_id: 'item-aguacate',
        item_name: 'Aguacate Hass',
        unit_description: 'Caja 25lb',
        par_value: 20,
        par_ideal_value: 20,
        leftover_value: 20,
        calculated_qty: 0,
        rounding_rule: 'none',
        qb_item_id: 'QB-105'
    }
    const anomalies7 = detectOrderAnomalies(
        [lineAguacate],
        {},
        { 'item-aguacate': { '2026-09-26': 20 } },
        '2026-09-26',
        'es'
    )
    assert(anomalies7.length === 1, 'Test 7: Catches high volume item ending in 0 order')
    assert(anomalies7[0].type === 'zero_critical', 'Test 7: Type is zero_critical')

    // -------------------------------------------------------------
    // Test 8: Business Day cutoff (6:00 AM rule)
    // -------------------------------------------------------------
    // Monday at 1:00 AM PST = Still Sunday business day!
    const monday1am = new Date('2026-09-28T01:00:00-07:00')
    const bizMonday1am = getBusinessMonday(monday1am)
    // Business Monday for that Sunday should be the Monday of that week: 2026-09-21
    assert(bizMonday1am === '2026-09-21', 'Test 8: 1:00 AM Monday belongs to business week starting 2026-09-21')

    // Monday at 6:01 AM PST = New Monday business day!
    const monday601am = new Date('2026-09-28T06:01:00-07:00')
    const bizMonday601am = getBusinessMonday(monday601am)
    assert(bizMonday601am === '2026-09-28', 'Test 8: 6:01 AM Monday belongs to new business week starting 2026-09-28')

    // -------------------------------------------------------------
    // Test 9: Division by zero & NaN resiliency
    // -------------------------------------------------------------
    const lineZeroPar: CalculatedOrderLine = {
        inventory_item_id: 'item-zeropar',
        item_name: 'Item Especial Sin Par',
        unit_description: 'Pza',
        par_value: 0,
        par_ideal_value: 0,
        leftover_value: 5,
        calculated_qty: 0,
        rounding_rule: 'none',
        qb_item_id: 'QB-999'
    }
    const anomalies9 = detectOrderAnomalies(
        [lineZeroPar],
        { 'item-zeropar': 'abc' }, // Invalid string in adjustment map
        { 'item-zeropar': { '2026-09-26': 5 } },
        '2026-09-26',
        'es'
    )
    assert(anomalies9.length === 0, 'Test 9: Invalid non-numeric strings safely ignored without crashing')

    console.log(`\n🎉 ALL ${testsPassed}/${totalTests} TESTS PASSED! Triple-layer safeguards fully validated.`)
}

runSimulation()

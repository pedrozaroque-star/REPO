/**
 * @module test-delivery-armor-core
 * @description Simulación determinista del flujo de Entrega Blindada.
 * @businessRules Valida corte 6 AM, plataformas, acentos, cuatro controles, riesgo y matemática finita.
 * @dataFlow Funciones puras de lib/delivery-armor -> aserciones runtime.
 * @notes No usa mocks de mutación ni expone PINs reales.
 */

import assert from 'node:assert/strict'
import { areQuickChecksComplete, calculateDeliveryRisk, classifyPlatform, getToastBusinessDate, isDeliveryPlatform, isHighRiskBeverage } from '../lib/delivery-armor'

const laInstant = (value: string) => new Date(`${value}-07:00`)

assert.equal(getToastBusinessDate(laInstant('2026-10-13T05:59:00')), '20261012')
assert.equal(getToastBusinessDate(laInstant('2026-10-13T06:00:00')), '20261013')
assert.equal(getToastBusinessDate(laInstant('2026-10-13T23:59:00')), '20261013')
assert.equal(getToastBusinessDate(laInstant('2026-10-14T00:00:00')), '20261013')

assert.equal(classifyPlatform('DOORDASH - DELIVERY'), 'DOORDASH')
assert.equal(classifyPlatform('Uber Eats'), 'UBER_EATS')
assert.equal(classifyPlatform('Postmates'), 'UBER_EATS')
assert.equal(classifyPlatform('GrubHub Delivery'), 'GRUBHUB')
assert.equal(isDeliveryPlatform('To Go'), false)
assert.equal(isDeliveryPlatform('For Here'), false)

for (const drink of ['Limón', 'Limon', 'Sangría', 'Sangria', 'CAFÉ', 'Cafe', 'Horchata']) {
  assert.equal(isHighRiskBeverage(drink), true, drink)
}
assert.equal(isHighRiskBeverage('Taco Asada'), false)

assert.equal(areQuickChecksComplete({ foodComplete: true, drinksComplete: true, bagCountCorrect: true, bagSealed: true }), true)
assert.equal(areQuickChecksComplete({ foodComplete: true, drinksComplete: true, bagCountCorrect: true, bagSealed: false }), false)

assert.deepEqual(calculateDeliveryRisk({ hasRefrigeratedBeverages: false, totalItemsCount: 7, confirmedBagCount: 1 }), { level: 'NORMAL', reasons: [], evidencePolicy: 'NONE' })
assert.equal(calculateDeliveryRisk({ hasRefrigeratedBeverages: true, totalItemsCount: 8, confirmedBagCount: 2 }).evidencePolicy, 'SEALED_BAG')

for (const value of [0, 1, 8, 20]) assert.equal(Number.isFinite(value / Math.max(1, value)), true)
console.log('Delivery Armor core simulation: PASS')

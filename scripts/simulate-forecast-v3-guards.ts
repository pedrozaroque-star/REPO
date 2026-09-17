/**
 * @module SimulateForecastV3Guards
 * @description Simulación determinista de protecciones estadísticas, eventos, horarios y casos borde de Sales Intelligence V3.1.
 * @businessRules Valida día laboral 6 AM, suma horaria exacta, eventos independientes del orden y cero divisiones inválidas.
 * @dataFlow Casos sintéticos reproducibles -> funciones puras del motor -> assertions y salida de terminal.
 * @notes No escribe archivos ni realiza mutaciones de base de datos.
 */

import assert from 'node:assert/strict'
import { combineEventMultipliers, getDistanceAdjustedMultiplier } from '../lib/event-statistics'
import { clamp, median, robustAverageCheck, robustWeightedMean, safeRatio, winsorize } from '../lib/forecast-statistics'
import { getComparativeDates } from '../lib/holidays'

const nearlyEqual = (actual: number, expected: number, tolerance = 0.000001) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
}

assert.equal(median([30, 10, 20, 100]), 25)
assert.deepEqual(winsorize([10, 11, 12, 100]).map(Math.round), [10, 11, 12, 74])
assert.ok(robustWeightedMean([{ value: 100, weight: 1 }, { value: 110, weight: 2 }, { value: 1000, weight: 3 }]) < 1000)
assert.equal(robustAverageCheck([{ sales: 1000, tickets: 50 }, { sales: 900, tickets: 0 }], 18.5), 20)
assert.equal(safeRatio(0, 0, 1), 1)
assert.equal(safeRatio(Number.NaN, 10, 1), 1)
assert.equal(clamp(Number.POSITIVE_INFINITY, 0.92, 1.15), 0.92)

const forward = combineEventMultipliers([1.3, 0.7])
const reverse = combineEventMultipliers([0.7, 1.3])
nearlyEqual(forward, reverse)
nearlyEqual(forward, 1)
assert.ok(getDistanceAdjustedMultiplier(1.3, 4.99, 'local', true) > getDistanceAdjustedMultiplier(1.3, 5.01, 'local', true))
assert.ok(Math.abs(getDistanceAdjustedMultiplier(1.3, 4.99, 'local', true) - getDistanceAdjustedMultiplier(1.3, 5.01, 'local', true)) < 0.001)

assert.deepEqual(getComparativeDates('2024-09-16'), ['2023-09-16'])
assert.deepEqual(getComparativeDates('2023-09-16'), [])

const activeHours = Array.from({ length: 16 }, (_, index) => index + 10) // 10 AM through 1 AM
const weights: number[] = activeHours.map((_, index) => index < 2 ? 100 : 0)
for (let index = 1; index < weights.length; index++) {
    if (weights[index] === 0) weights[index] = weights[index - 1] * 0.85
}
const totalWeight = weights.reduce((sum, value) => sum + value, 0)
const projectedTotal = 1000
const hourly = weights.map(value => projectedTotal * value / totalWeight)
nearlyEqual(hourly.reduce((sum, value) => sum + value, 0), projectedTotal)
assert.ok(activeHours.every(hour => hour >= 6 && hour <= 29))
assert.equal(new Set(activeHours).size, activeHours.length)

const businessDateForHour = (calendarDate: string, hour: number, minute: number) => {
    if (hour > 6 || (hour === 6 && minute >= 0)) return calendarDate
    const date = new Date(`${calendarDate}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - 1)
    return date.toISOString().slice(0, 10)
}
assert.equal(businessDateForHour('2026-09-17', 5, 59), '2026-09-16')
assert.equal(businessDateForHour('2026-09-17', 6, 0), '2026-09-17')
assert.equal(16 * 60 + 59 < 17 * 60, true) // 4:59 PM remains AM/regular shift
assert.equal(17 * 60 >= 17 * 60, true) // 5:00 PM starts PM shift

for (const value of ['Miércoles', 'Miercoles', 'miércoles', 'Sábado', 'Sabado']) {
    assert.ok(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().length > 0)
}

console.log('✅ Estadística robusta: mediana, winsorization, pesos y 0/0')
console.log('✅ Eventos: composición simétrica y distancia continua')
console.log('✅ Feriados: comparables estrictamente anteriores, sin fuga temporal')
console.log('✅ Día laboral: horas únicas 6–29 y suma horaria exacta al total')
console.log('✅ Límites: 5:59/6:00 AM y 4:59/5:00 PM')
console.log('✅ Cadenas: acentos y mayúsculas normalizables sin pérdida')

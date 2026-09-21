/**
 * @module tests/ronos-payroll-concurrency
 * @description Simulación en tiempo real del pool de cálculos corporativos de nómina RONOS.
 * @businessRules El consolidado no supera tres cálculos simultáneos y conserva el orden de tiendas.
 * @dataFlow Tiendas simuladas -> mapWithConcurrency -> medición de concurrencia y orden.
 * @notes Cubre éxito, fallos convertidos en resultados y límite de concurrencia sin usar mocks de red.
 */

import assert from 'node:assert/strict'
import { mapWithConcurrency } from '../lib/ronos-payroll-concurrency'

const stores = Array.from({ length: 16 }, (_, index) => index + 1)
let active = 0
let peak = 0

const outcomes = await mapWithConcurrency(stores, 3, async (store) => {
  active += 1
  peak = Math.max(peak, active)
  await new Promise(resolve => setTimeout(resolve, 8 + ((store % 3) * 4)))
  active -= 1
  return store === 7 ? { store, state: 'failed' as const } : { store, state: 'calculated' as const }
})

assert.equal(outcomes.length, 16)
assert.ok(peak <= 3, `La concurrencia máxima fue ${peak}, esperaba <= 3`)
assert.deepEqual(outcomes.map(outcome => outcome.store), stores, 'El orden de salida debe coincidir con las tiendas')
assert.equal(outcomes[6].state, 'failed', 'Un fallo por tienda debe permanecer identificado')
assert.equal(active, 0, 'No deben quedar cálculos activos')

console.log(`RONOS payroll concurrency simulation passed: ${outcomes.length} stores, peak ${peak}, ordered partial result preserved.`)

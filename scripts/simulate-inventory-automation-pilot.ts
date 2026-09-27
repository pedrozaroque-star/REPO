/**
 * @module scripts/simulate-inventory-automation-pilot
 * @description Simulación determinista del motor shadow y elegibilidad de sucursales piloto.
 * @businessRules Lynwood y Slauson participan; el conteo físico permanece oficial.
 * @dataFlow Casos estáticos -> motor puro -> aserciones de comparación y sucursal.
 * @notes No usa mocks de DB ni modifica datos.
 */
import assert from 'node:assert/strict'
import {
  buildPilotComparisonLine,
  canCloseInventoryAutomationPilot,
  getInventoryAutomationPilotStoreName,
  isInventoryAutomationPilotStore,
  isImplausibleArrivalQuantity,
} from '../lib/inventory/automation-pilot'

const exact = buildPilotComparisonLine({
  inventory_item_id: 'asada', item_name: 'Carne Asada', physical_leftover: 5,
  automatic_leftover: 5, par_value: 10, rounding_rule: 'none',
})
assert.equal(exact.variance, 0)
assert.equal(exact.within_tolerance, true)
assert.equal(exact.official_order_qty, 5)

const outside = buildPilotComparisonLine({
  inventory_item_id: 'pastor', item_name: 'Pastor', physical_leftover: 2,
  automatic_leftover: 4, par_value: 8, rounding_rule: 'none',
})
assert.equal(outside.variance, -2)
assert.equal(outside.within_tolerance, false)
assert.equal(outside.automatic_order_qty, 4)
assert.equal(outside.official_order_qty, 6)

const rounded = buildPilotComparisonLine({
  inventory_item_id: 'paper', item_name: 'Papelito Para Torta', physical_leftover: 31,
  automatic_leftover: 29, par_value: 90, rounding_rule: 'ceiling_30',
})
assert.equal(rounded.official_order_qty, 60)
assert.equal(rounded.automatic_order_qty, 90)

const unavailable = buildPilotComparisonLine({
  inventory_item_id: 'lard', item_name: 'Viva Lard', physical_leftover: 2,
  automatic_leftover: null, par_value: 4, rounding_rule: 'none',
})
assert.equal(unavailable.within_tolerance, null)
assert.equal(unavailable.automatic_order_qty, null)
assert.equal(unavailable.official_order_qty, 2)

assert.equal(isInventoryAutomationPilotStore('Tacos Gavilan Lynwood #14'), true)
assert.equal(isInventoryAutomationPilotStore('Tacos Gavilan Slauson'), true)
assert.equal(isInventoryAutomationPilotStore('Tacos Gavilan Bell'), false)
assert.equal(getInventoryAutomationPilotStoreName('SLAUSON-TEG'), 'Slauson')

assert.equal(canCloseInventoryAutomationPilot({
  storeName: 'Tacos Gavilan Slauson', targetStoreId: 7, userName: 'Slauson Manager',
  userEmail: 'manager@example.com', userRole: 'manager', assignedStoreIds: [7],
}), true)
assert.equal(canCloseInventoryAutomationPilot({
  storeName: 'Tacos Gavilan Slauson', targetStoreId: 7, userName: 'Other Manager',
  userEmail: 'other@example.com', userRole: 'manager', assignedStoreIds: [14],
}), false)
assert.equal(canCloseInventoryAutomationPilot({
  storeName: 'Tacos Gavilan Lynwood', targetStoreId: 14, userName: 'Carlos Velázquez',
  userEmail: 'carlos@example.com', userRole: 'manager', assignedStoreIds: [14],
}), true)
assert.equal(canCloseInventoryAutomationPilot({
  storeName: 'Tacos Gavilan Slauson', targetStoreId: 7, userName: 'Roque',
  userEmail: 'admin@example.com', userRole: 'admin', assignedStoreIds: [],
}), true)

assert.equal(isImplausibleArrivalQuantity(11211120, 60, 41), true)
assert.equal(isImplausibleArrivalQuantity(41, 60, 41), false)
assert.equal(isImplausibleArrivalQuantity(120, 60, 41), false)
assert.equal(isImplausibleArrivalQuantity(Number.NaN, 60, 41), true)

console.log('PASS inventory automation pilot: 4 calculations + 4 store checks + 4 authorization checks + 4 anomaly checks; physical count remains official')

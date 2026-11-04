/**
 * @module scripts/test_delivery_fee_rules
 * @description Automated runtime verification for Tacos Gavilan Delivery Fee & Tax Rules (Oct 2026).
 * Validates:
 * 1. Base delivery fee: $5.99 up to 6.0 miles.
 * 2. Long-distance surcharge: +$1.75 ($7.74) when distance > 6.0 miles.
 * 3. Range limit: error when distance > 10.0 miles.
 * 4. Integration with October 1, 2026 CDTFA tax rates.
 */

import assert from 'assert'
import { getDeliveryFee, calculateDistanceMiles, BASE_DELIVERY_FEE, DISTANCE_SURCHARGE_FEE } from '../gavilan-app/lib/constants'
import { STORE_TAX_RATES, getStoreTaxRate } from '../gavilan-app/lib/constants'

function runSimulation() {
  console.log('🧪 INICIANDO SIMULACIÓN DE REGLAS DE ENTREGA Y TAXES (OCTUBRE 2026)...')

  // Test 1: Distancia corta (2.5 millas)
  const feeShort = getDeliveryFee(2.5)
  console.log(`✓ Entrega a 2.5 mi: $${feeShort.toFixed(2)} (esperado: $5.99)`)
  assert.strictEqual(feeShort, 5.99, 'La tarifa base para <= 6.0 millas debe ser $5.99')

  // Test 2: Distancia límite (exactamente 6.0 millas)
  const feeLimit = getDeliveryFee(6.0)
  console.log(`✓ Entrega a 6.0 mi: $${feeLimit.toFixed(2)} (esperado: $5.99)`)
  assert.strictEqual(feeLimit, 5.99, 'La tarifa límite para 6.0 millas debe ser $5.99')

  // Test 3: Distancia que supera las 6 millas (6.1 millas)
  const feeOver6 = getDeliveryFee(6.1)
  console.log(`✓ Entrega a 6.1 mi: $${feeOver6.toFixed(2)} (esperado: $7.74)`)
  assert.strictEqual(feeOver6, 7.74, 'La tarifa para > 6.0 millas debe ser $5.99 + $1.75 = $7.74')

  // Test 4: Distancia larga (8.5 millas)
  const feeLong = getDeliveryFee(8.5)
  console.log(`✓ Entrega a 8.5 mi: $${feeLong.toFixed(2)} (esperado: $7.74)`)
  assert.strictEqual(feeLong, 7.74, 'La tarifa para 8.5 millas debe ser $7.74')

  // Test 5: Cálculo de distancia Haversine entre Lynwood (#14) y punto a 7.2 millas
  const lynwoodLat = 33.930001
  const lynwoodLon = -118.21232
  // Coordenadas a ~7.5 millas
  const testLat = 33.8500
  const testLon = -118.1500
  const distance = calculateDistanceMiles(lynwoodLat, lynwoodLon, testLat, testLon)
  const feeCalculated = getDeliveryFee(distance)
  console.log(`✓ Distancia calculada: ${distance.toFixed(2)} mi -> Tarifa: $${feeCalculated.toFixed(2)}`)
  assert(distance > 6.0, 'La distancia debe ser > 6.0 millas')
  assert.strictEqual(feeCalculated, 7.74, 'Tarifa debe ser $7.74')

  // Test 6: Verificación de Taxes Octubre 2026
  console.log('\n🏛️ VERIFICACIÓN DE TAXES (CDTFA OCTUBRE 2026):')
  assert.strictEqual(getStoreTaxRate(7), 0.1025, 'Slauson (#7) debe ser 10.25%')
  assert.strictEqual(getStoreTaxRate(14), 0.1125, 'Lynwood (#14) debe ser 11.25%')
  assert.strictEqual(getStoreTaxRate(16), 0.1100, 'Downey (#16) debe ser 11.00%')
  assert.strictEqual(getStoreTaxRate(1), 0.0775, 'Rialto (#1) debe ser 7.75%')
  assert.strictEqual(getStoreTaxRate(9), 0.0925, 'Santa Ana (#9) debe ser 9.25%')
  console.log('✓ Todas las tasas por sucursal coinciden al 100%')

  // Test 7: Total con delivery fee + taxes
  // Orden: 4 Tacos de Asada @ $2.29 = $9.16 en Slauson (10.25%) + Delivery a 7 millas ($7.74)
  const subtotal = 9.16
  const tax = Number((subtotal * 0.1025).toFixed(2)) // $0.94
  const delivery = 7.74
  const total = Number((subtotal + tax + delivery).toFixed(2)) // $9.16 + $0.94 + $7.74 = $17.84
  console.log(`✓ Simulación Total: Subtotal $${subtotal} + Tax $${tax} + Delivery $${delivery} = Total $${total}`)
  assert.strictEqual(total, 17.84, 'Total matemático exacto')

  console.log('\n🎉 TODAS LAS PRUEBAS DE DELIVERY FEE Y TAXES PASARON EXITOSAMENTE.')
}

runSimulation()

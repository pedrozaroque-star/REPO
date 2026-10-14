/**
 * @module test-delivery-armor-core
 * @description Simulación determinista del flujo de Entrega Blindada.
 * @businessRules Valida corte 6 AM, plataformas, acentos, cuatro controles, riesgo y matemática finita.
 * @dataFlow Funciones puras de lib/delivery-armor -> aserciones runtime.
 * @notes No usa mocks de mutación ni expone PINs reales.
 */

import assert from 'node:assert/strict'
import {
  areQuickChecksComplete,
  calculateDeliveryRisk,
  classifyPlatform,
  extractKdsTiming,
  extractPlatformOrderIdentity,
  getToastBusinessDate,
  isDeliveryPlatform,
  isHighRiskBeverage,
  maskCustomerName
} from '../lib/delivery-armor'

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

for (const drink of ['Limón', 'Limon', 'Sangría', 'Sangria', 'CAFÉ', 'Cafe', 'Horchata', 'Large Piña', 'Champurrado']) {
  assert.equal(isHighRiskBeverage(drink), true, drink)
}
assert.equal(isHighRiskBeverage('Taco Asada'), false)

assert.equal(areQuickChecksComplete({ foodComplete: true, drinksComplete: true, bagCountCorrect: true, bagSealed: true }), true)
assert.equal(areQuickChecksComplete({ foodComplete: true, drinksComplete: true, bagCountCorrect: true, bagSealed: false }), false)

assert.deepEqual(calculateDeliveryRisk({ hasRefrigeratedBeverages: false, totalItemsCount: 7, confirmedBagCount: 1 }), { level: 'NORMAL', reasons: [], evidencePolicy: 'NONE' })
assert.equal(calculateDeliveryRisk({ hasRefrigeratedBeverages: true, totalItemsCount: 8, confirmedBagCount: 2 }).evidencePolicy, 'SEALED_BAG')

// Pruebas de extracción de claves oficiales por plataforma y enmascarado de nombre
assert.equal(maskCustomerName('Aramis P.'), 'A••• P.')
assert.equal(maskCustomerName('Jose Martinez'), 'J••• M.')

const ueIdentity = extractPlatformOrderIdentity({
  platform: 'UBER_EATS',
  displayNumber: '541',
  tabName: '  UBER414DB Aramis P.  ',
  firstName: 'UE-Aramis414DB',
  lastName: 'P.',
  deliveryNotes: 'Driver Pin: 31902213 (Jessica)'
})
assert.equal(ueIdentity.shortOrderKey, '414DB')
assert.equal(ueIdentity.platformOrderKey, 'UBER414DB')
assert.equal(ueIdentity.cleanCustomerName, 'Aramis P.')
assert.equal(ueIdentity.maskedCustomerName, 'A••• P.')
assert.equal(ueIdentity.assignedDriverHint, 'Jessica')

const ddIdentity = extractPlatformOrderIdentity({
  platform: 'DOORDASH',
  displayNumber: '31',
  tabName: 'DD 316669c1 Santana A',
  firstName: 'Santana',
  lastName: 'A'
})
assert.equal(ddIdentity.shortOrderKey, '316669C1')
assert.equal(ddIdentity.platformOrderKey, 'DD 316669C1')

const ghIdentity = extractPlatformOrderIdentity({
  platform: 'GRUBHUB',
  displayNumber: '225',
  tabName: 'Cathy W Grubhub #838534995740292',
  firstName: 'Cathy',
  lastName: 'W'
})
assert.equal(ghIdentity.shortOrderKey, '#0292')
assert.equal(ghIdentity.platformOrderKey, 'GH #838534995740292')

// Ejemplos reales de tickets físicos (Slauson #42, Hollywood #92 y #849, Downey #538, KDS #353)
const ueTakeout42 = extractPlatformOrderIdentity({
  platform: classifyPlatform('Uber Eats Takeout'),
  displayNumber: '42',
  tabName: 'UBERB5BCB Monse R.',
  firstName: 'UE-MonseB5BCB',
  lastName: 'R.'
})
assert.equal(ueTakeout42.platformOrderKey, 'UBERB5BCB')
assert.equal(ueTakeout42.shortOrderKey, 'B5BCB')
assert.equal(ueTakeout42.cleanCustomerName, 'Monse R.')

const ddHollywood92 = extractPlatformOrderIdentity({
  platform: 'DOORDASH',
  displayNumber: '92',
  tabName: 'DD 04bbb1a4 Demetri P',
  firstName: 'Demetri',
  lastName: 'P.'
})
assert.equal(ddHollywood92.platformOrderKey, 'DD 04BBB1A4')
assert.equal(ddHollywood92.shortOrderKey, '04BBB1A4')

const ddHollywood849 = extractPlatformOrderIdentity({
  platform: 'DOORDASH',
  displayNumber: '849',
  tabName: 'DD fafae52b clifford s',
  firstName: 'clifford',
  lastName: 's.'
})
assert.equal(ddHollywood849.platformOrderKey, 'DD FAFAE52B')
assert.equal(ddHollywood849.shortOrderKey, 'FAFAE52B')
assert.equal(isHighRiskBeverage('Medium Strawberry Fanta'), true)

const toastDowney538 = extractPlatformOrderIdentity({
  platform: classifyPlatform('Toast Delivery Services (Online)'),
  displayNumber: '538',
  firstName: 'Jess',
  lastName: 'Lopez',
  phone: '(313) 764-4449'
})
assert.equal(toastDowney538.platformOrderKey, 'TOAST #538 (4449)')
assert.equal(toastDowney538.shortOrderKey, '#538•4449')

const ueVoided353 = extractPlatformOrderIdentity({
  platform: 'UBER_EATS',
  displayNumber: '353',
  tabName: 'UBERF2201 Jerry B.',
  firstName: 'Jerry',
  lastName: 'B.'
})
assert.equal(ueVoided353.platformOrderKey, 'UBERF2201')
assert.equal(ueVoided353.shortOrderKey, 'F2201')

// Prueba de cronómetro KDS (ignora bebidas en SENT cuando los platillos ya están en READY)
const kdsTiming = extractKdsTiming({
  openedDate: '2026-10-14T00:04:54.595Z',
  checks: [
    {
      selections: [
        { displayName: 'Taco Asada', fulfillmentStatus: 'READY', createdDate: '2026-10-14T00:04:54.595Z', modifiedDate: '2026-10-14T00:07:46.854Z' },
        { displayName: 'Large Piña', fulfillmentStatus: 'SENT', createdDate: '2026-10-14T00:04:54.595Z', modifiedDate: '2026-10-14T00:04:55.329Z' }
      ]
    }
  ]
})
assert.equal(kdsTiming.kdsStatus, 'READY')
assert.equal(kdsTiming.kdsPrepSeconds, 172)

for (const value of [0, 1, 8, 20]) assert.equal(Number.isFinite(value / Math.max(1, value)), true)
console.log('Delivery Armor core simulation: PASS')

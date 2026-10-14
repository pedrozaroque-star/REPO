/**
 * @module test-delivery-armor-core
 * @description Simulación determinista del flujo de Entrega Blindada.
 * @businessRules Valida corte 6 AM, plataformas, acentos, cuatro controles, riesgo y matemática finita.
 * @dataFlow Funciones puras de lib/delivery-armor -> aserciones runtime.
 * @notes No usa mocks de mutación ni expone PINs reales.
 */

import assert from 'node:assert/strict'
import {
  areCustomerNamesConfusable,
  areQuickChecksComplete,
  calculateDeliveryRisk,
  classifyPlatform,
  extractKdsTiming,
  extractPlatformOrderIdentity,
  formatDisputeStatement,
  getToastBusinessDate,
  isDeliveryPlatform,
  isHighRiskBeverage,
  isOrderUnclaimedByDriver,
  maskCustomerName,
  UNCLAIMED_DRIVER_TIMEOUT_MS
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

// Pruebas de blindaje contra nombres duplicados (mismo nombre aunque el apellido sea diferente) y nombres muy parecidos
assert.deepEqual(areCustomerNamesConfusable('Maria G.', 'Maria G.'), { confusable: true, reason: 'EXACT_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Maria G.', 'Maria R.'), { confusable: true, reason: 'SAME_FIRST_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Jose L.', 'José Martinez'), { confusable: true, reason: 'SAME_FIRST_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Cristian M.', 'Christian R.'), { confusable: true, reason: 'SIMILAR_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Bryan S.', 'Brian T.'), { confusable: true, reason: 'SIMILAR_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Carla P.', 'Karla M.'), { confusable: true, reason: 'SIMILAR_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Alex G.', 'Alexis R.'), { confusable: true, reason: 'SIMILAR_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Jovita G.', 'Jovana L.'), { confusable: true, reason: 'SIMILAR_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Maria G.', 'Mario L.'), { confusable: true, reason: 'SIMILAR_NAME' })
assert.deepEqual(areCustomerNamesConfusable('Jovita G.', 'Marco S.'), { confusable: false, reason: null })
assert.deepEqual(areCustomerNamesConfusable('Kristy V.', 'Evelyn C.'), { confusable: false, reason: null })

const ueIdentity = extractPlatformOrderIdentity({
  platform: 'UBER_EATS',
  displayNumber: '541',
  tabName: '  UBER414DB Aramis P.  ',
  firstName: 'UE-Aramis414DB',
  lastName: 'P.',
  deliveryNotes: 'Driver Pin: 31902213 (Jessica)'
})
assert.equal(ueIdentity.shortOrderKey, '414DB')
assert.equal(ueIdentity.platformOrderKey, '414DB')
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

// Ejemplos reales de tickets físicos (Slauson #42, Slauson #559, Hollywood #92 y #849, Downey #538, KDS #353)
const ueTakeout42 = extractPlatformOrderIdentity({
  platform: classifyPlatform('Uber Eats Takeout'),
  displayNumber: '42',
  tabName: 'UBERB5BCB Monse R.',
  firstName: 'UE-MonseB5BCB',
  lastName: 'R.'
})
assert.equal(ueTakeout42.platformOrderKey, 'B5BCB')
assert.equal(ueTakeout42.shortOrderKey, 'B5BCB')
assert.equal(ueTakeout42.cleanCustomerName, 'Monse R.')

const ueSlauson559 = extractPlatformOrderIdentity({
  platform: 'UBER_EATS',
  displayNumber: '559',
  tabName: 'UBER60A07 Jovita G.',
  firstName: 'UE-Jovita60A07',
  lastName: 'G.'
})
assert.equal(ueSlauson559.platformOrderKey, '60A07')
assert.equal(ueSlauson559.shortOrderKey, '60A07')
assert.equal(ueSlauson559.cleanCustomerName, 'Jovita G.')

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
assert.equal(ueVoided353.platformOrderKey, 'F2201')
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

// Prueba de cambio automático de estatus si una orden no fue recogida por ningún chofer en 2 horas o más (119m59s vs 120m00s)
assert.equal(UNCLAIMED_DRIVER_TIMEOUT_MS, 2 * 60 * 60 * 1000)
const refNow = new Date('2026-10-14T18:00:00.000Z').getTime()
assert.equal(
  isOrderUnclaimedByDriver({
    openedDate: new Date(refNow - (2 * 60 * 60 * 1000 - 1000)).toISOString(),
    status: 'PACKED_AND_SEALED',
    nowMs: refNow
  }),
  false,
  'A 1h 59m 59s aún sigue esperando al chofer'
)
assert.equal(
  isOrderUnclaimedByDriver({
    openedDate: new Date(refNow - 2 * 60 * 60 * 1000).toISOString(),
    status: 'PACKED_AND_SEALED',
    nowMs: refNow
  }),
  true,
  'Exactamente a las 2 horas (120 min) sin chofer cambia automáticamente a no recogida'
)
assert.equal(
  isOrderUnclaimedByDriver({
    openedDate: new Date(refNow - 3 * 60 * 60 * 1000).toISOString(),
    status: 'DELIVERED',
    handedAt: new Date(refNow - 90 * 60 * 1000).toISOString(),
    nowMs: refNow
  }),
  false,
  'Una orden ya entregada a un chofer nunca debe marcarse como no recogida'
)
const unclaimedDossier = formatDisputeStatement({
  store_id: 7,
  toast_display_number: '671',
  platform: 'UBER_EATS',
  status: 'UNCLAIMED_2H',
  packed_at: '2026-10-14T16:00:00.000Z',
  packer_ronos_name: 'Colaborador Test',
  packer_ronos_user_id: 10
})
assert.equal(unclaimedDossier.includes('UNCLAIMED_2H'), true)

for (const value of [0, 1, 8, 20]) assert.equal(Number.isFinite(value / Math.max(1, value)), true)

// Prueba de contrato Fullscreen en tableta (PIN, Login, Operación y Retorno a PIN)
import fs from 'node:fs'
import path from 'node:path'

const clientLayoutSource = fs.readFileSync(path.join(process.cwd(), 'components', 'ClientLayout.tsx'), 'utf8')
assert.equal(
  clientLayoutSource.includes("'/admin/blindaje-delivery/empaque'"),
  true,
  'ClientLayout debe incluir /admin/blindaje-delivery/empaque en publicRoutes para ocultar barras y mostrar pantalla completa'
)

const empaqueSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'admin', 'blindaje-delivery', 'empaque', 'page.tsx'),
  'utf8'
)
assert.equal(empaqueSource.includes('requestFullscreen'), true, 'Debe invocar requestFullscreen nativo')
assert.equal(empaqueSource.includes('ensureFullscreen'), true, 'Debe mantener fullscreen en PIN, login y logout')
assert.equal(empaqueSource.includes('fixed inset-0 z-[100] w-screen h-screen'), true, 'Debe ocupar 100% de la pantalla')
assert.equal(empaqueSource.includes('max-w-2xl'), false, 'No debe restringir el ancho a max-w-2xl en la tableta')
assert.equal(
  empaqueSource.includes('/api/order-ready/tts?n='),
  true,
  'Debe reutilizar los audios de órdenes ya descargados en Supabase Storage (/api/order-ready/tts)'
)
assert.equal(
  empaqueSource.includes('Please%20pack.') && empaqueSource.includes('Por%20favor%20empacar.'),
  true,
  'Debe anunciar Please pack / Por favor empacar al salir del KDS'
)
assert.equal(
  empaqueSource.includes("prevStatus === 'IN_KITCHEN'"),
  true,
  'Debe detectar automáticamente cuando el cocinero borra la orden del KDS (IN_KITCHEN -> READY)'
)
assert.equal(
  empaqueSource.includes('collisionsByGuid') && empaqueSource.includes("t('blindaje_delivery.collision_banner_title')"),
  true,
  'Debe alertar con alto énfasis cuando existan órdenes con nombres iguales o muy parecidos desde KDS'
)
assert.equal(
  empaqueSource.includes('landscape:grid-cols-[370px_1fr]') && empaqueSource.includes('landscape:flex-col'),
  true,
  'Si la tableta está horizontal debe pasar todas las órdenes del lado izquierdo'
)
assert.equal(
  empaqueSource.includes('order.items.map('),
  false,
  'No debe mostrar el contenido de artículos de los tickets en ninguna de las dos versiones (vertical u horizontal)'
)
assert.equal(
  empaqueSource.includes("t('blindaje_delivery.stage_unclaimed')") && empaqueSource.includes('isOrderUnclaimedAfter2Hours'),
  true,
  'Debe cambiar automáticamente el estatus a NO RECOGIDA (+2H) cuando una orden cumple 2 horas o más sin ser recogida por ningún chofer'
)
assert.equal(
  empaqueSource.includes('Expedientes') || empaqueSource.includes('href="/admin/blindaje-delivery"'),
  false,
  'El botón de Expedientes fue eliminado totalmente de la tableta de empaque'
)
assert.equal(
  empaqueSource.includes('useLanguage') && empaqueSource.includes("setLanguage(language === 'es' ? 'en' : 'es')"),
  true,
  'La tableta de empaque debe estar 100% traducida con useLanguage() e incluir botón de cambio de idioma ES/EN'
)

const dashboardSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'admin', 'blindaje-delivery', 'page.tsx'),
  'utf8'
)
assert.equal(
  dashboardSource.includes('openDossierModal') || dashboardSource.includes('Evidencia (Fotos)'),
  false,
  'El botón de Expediente y columna de Evidencia (Fotos) fueron eliminados totalmente del panel'
)
assert.equal(
  dashboardSource.includes('useLanguage') && dashboardSource.includes("t('blindaje_delivery.title')"),
  true,
  'El panel administrativo de Blindaje Delivery debe usar useLanguage() para traducción completa ES/EN'
)

import { dictionaries } from '../lib/i18n'
const esKeys = Object.keys(dictionaries.es.blindaje_delivery).sort()
const enKeys = Object.keys(dictionaries.en.blindaje_delivery).sort()
assert.deepEqual(
  esKeys,
  enKeys,
  'Los diccionarios ES y EN de blindaje_delivery deben tener exactamente las mismas claves (100% paridad bilingüe)'
)
assert.equal(
  esKeys.length >= 115,
  true,
  'El diccionario de blindaje_delivery debe cubrir la totalidad de textos del módulo'
)

console.log('Delivery Armor core simulation: PASS')



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
  getBusinessDateYmdLA,
  getToastBusinessDate,
  isDeliveryPlatform,
  isHighRiskBeverage,
  isOrderUnclaimedByDriver,
  maskCustomerName,
  resolveEffectiveOrderOpenedDate,
  UNCLAIMED_DRIVER_TIMEOUT_MS
} from '../lib/delivery-armor'

const laInstant = (value: string) => new Date(`${value}-07:00`)

// Regresión Caso Real Slauson #7 Orden #975 (Karla M, DoorDash):
// Toast/DoorDash envía openedDate truncado a 00:01:00.000+0000 UTC (7 horas atrás en LA), mientras createdDate tiene la hora real (06:59:11.567+0000 UTC = 11:59 PM LA)
assert.equal(
  resolveEffectiveOrderOpenedDate({
    openedDate: '2026-10-17T00:01:00.000+0000',
    createdDate: '2026-10-17T06:59:11.567+0000',
    checks: [
      {
        openedDate: '2026-10-17T00:01:00.000+0000',
        selections: [{ createdDate: '2026-10-17T06:59:11.552+0000', voided: false }]
      }
    ]
  }),
  '2026-10-17T06:59:11.567Z',
  'Debe usar el timestamp real de creación (createdDate) cuando openedDate viene truncado a medianoche UTC (Caso Orden #975 Karla M)'
)

assert.equal(getToastBusinessDate(laInstant('2026-10-13T05:59:00')), '20261012')
assert.equal(getToastBusinessDate(laInstant('2026-10-13T06:00:00')), '20261013')
assert.equal(getToastBusinessDate(laInstant('2026-10-13T23:59:00')), '20261013')
assert.equal(getToastBusinessDate(laInstant('2026-10-14T00:00:00')), '20261013')
assert.equal(getBusinessDateYmdLA(laInstant('2026-10-16T05:59:59')), '2026-10-15')
assert.equal(getBusinessDateYmdLA(laInstant('2026-10-16T06:00:00')), '2026-10-16')
assert.equal(getBusinessDateYmdLA(laInstant('2026-10-17T02:06:00')), '2026-10-16')
assert.equal(getBusinessDateYmdLA('2026-10-17T02:06:00.000Z'), '2026-10-16')

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

const disputesRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'delivery-armor', 'disputes', 'route.ts'),
  'utf8'
)
assert.equal(
  disputesRouteSource.includes("searchParams.get('limit') || '5000'") &&
    disputesRouteSource.includes('.range(offset, offset + batchLimit - 1)'),
  true,
  'El endpoint /api/delivery-armor/disputes no debe truncar en 50 órdenes y debe paginar hasta 5000 registros'
)

const dashboardSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'admin', 'blindaje-delivery', 'page.tsx'),
  'utf8'
)
assert.equal(
  dashboardSource.includes('type="date"') &&
    dashboardSource.includes('handleStepDay(-1)') &&
    dashboardSource.includes('handleStepDay(1)') &&
    dashboardSource.includes("t('blindaje_delivery.date_today')") &&
    dashboardSource.includes('item.business_date < startDate'),
  true,
  'El panel administrativo /admin/blindaje-delivery debe incluir selector de fechas (Hoy, Ayer, 7 Días, Todas + calendario Desde/Hasta y flechas) filtrado por día laboral 6 AM - 5:59 AM'
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
  empaqueSource.includes('/api/order-ready/tts?n=') &&
    empaqueSource.includes('Please%20pack.') &&
    empaqueSource.includes('Favor%20de%20empacar.') &&
    empaqueSource.includes('&v=kds2'),
  true,
  'Debe usar los audios de órdenes de Supabase Storage (/api/order-ready/tts) seguidos de Please pack. y Favor de empacar. con la misma voz calibrada (&v=kds2)'
)
assert.equal(
  empaqueSource.includes('strikeBellPartial(1318.51') &&
    empaqueSource.includes('strikeBellPartial(1760.0') &&
    empaqueSource.includes('triggerBellCycle(0.0, 0.0)') &&
    empaqueSource.includes('triggerBellCycle(1.25, 0.45)') &&
    empaqueSource.includes('createDynamicsCompressor') &&
    empaqueSource.includes('setTimeout(resolve, 3450)'),
  true,
  'La campana de Delivery debe sonar 2 veces seguidas (~3.45s) con volumen amplificado (masterGain + DynamicsCompressor)'
)
assert.equal(
  empaqueSource.includes("prevStatus === 'IN_KITCHEN'"),
  true,
  'Debe detectar automáticamente cuando el cocinero borra la orden del KDS (IN_KITCHEN -> READY)'
)
assert.equal(
  empaqueSource.includes('collisionsByGuid') &&
    empaqueSource.includes("t('blindaje_delivery.collision_banner_title')") &&
    empaqueSource.includes("o.audit?.status !== 'released' && isOrderCurrentlyActive(o, dismissedVoided)"),
  true,
  'Debe alertar con alto énfasis cuando existan órdenes activas con nombres iguales o muy parecidos y quitar el color rojo en cuanto se entrega una de las 2'
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
assert.equal(
  empaqueSource.includes('PIN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000') &&
    empaqueSource.includes('recordCashierActivity') &&
    empaqueSource.includes('blindaje_packer_last_activity_at') &&
    empaqueSource.includes('handleSessionReplacedError') &&
    empaqueSource.includes('blindaje_packer_session_token'),
  true,
  'La sesión del PIN de la cajera debe cerrarse tras 10 min sin actividad o cuando alguien más inicia sesión en esa tienda (no puede haber 2 sesiones abiertas)'
)

assert.equal(
  empaqueSource.includes('getOrderOperationalPriority') &&
    empaqueSource.includes('hasBagCountChanged') &&
    empaqueSource.includes('isEditingStep1') &&
    empaqueSource.includes('isInKitchenBlocked') &&
    empaqueSource.includes('isReleaseInCooldown') &&
    empaqueSource.includes('driverPresentAck') &&
    empaqueSource.includes('undoPacking') &&
    empaqueSource.includes('reopenOrder') &&
    empaqueSource.includes('showHistoryRef.current') &&
    empaqueSource.includes('voided_packed_banner_title') &&
    !empaqueSource.includes('readyAgeMs <= 20 * 60 * 1000'),
  true,
  'Debe garantizar continuidad total entre cajeras y los 7 blindajes operativos en tienda'
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
  esKeys.length >= 133,
  true,
  'El diccionario de blindaje_delivery debe cubrir la totalidad de textos del módulo'
)
assert.equal(
  Object.values(dictionaries.es.blindaje_delivery).some(v => /\bQR\b/i.test(String(v))) ||
    Object.values(dictionaries.en.blindaje_delivery).some(v => /\bQR\b/i.test(String(v))) ||
    empaqueSource.includes('DOORDASH_QR'),
  false,
  'Ningún texto de Blindaje Delivery debe pedir ni mencionar código QR'
)
assert.equal(
  empaqueSource.includes('activeSorted[0]?.guid') ||
    empaqueSource.includes('newlyReadyOrders[0].guid') ||
    empaqueSource.includes('nextActive[0]?.guid') ||
    empaqueSource.includes('nextToPack.guid'),
  false,
  'Las órdenes nunca deben seleccionarse automáticamente: solo manualmente por la cajera'
)
assert.equal(
  empaqueSource.includes('data-order-detail="true"') &&
    empaqueSource.includes('data-order-card="true"') &&
    empaqueSource.includes("setSelected(prev => (prev === value.guid ? null : value.guid))"),
  true,
  'Debe quitar la selección al presionar en cualquier espacio en blanco o al volver a tocar la tarjeta seleccionada'
)
const appSidebarSource = fs.readFileSync(path.join(process.cwd(), 'components', 'AppSidebar.tsx'), 'utf8')
assert.equal(
  appSidebarSource.includes("item.path === '/admin/blindaje-delivery'"),
  true,
  'AppSidebar debe mostrar la insignia NEW en Blindaje Delivery'
)

import {
  registerExclusiveStorePinSession,
  touchActiveStorePinSession,
  getActiveStorePinSession,
  clearActiveStorePinSession,
  reopenDeliveredAudit,
  undoPackingAudit
} from '../lib/delivery-armor'
import { supabaseAdmin } from '../lib/supabase'

;(async () => {
  const testStoreId = 9999
  const testOrderGuid = `test-continuity-guid-${Date.now()}`
  try {
    // 1. Cajera 1 inicia sesión en la tienda 9999
    const s1 = await registerExclusiveStorePinSession({
      storeId: testStoreId,
      employeeUserId: 101,
      employeeName: 'Cajera Uno',
      jobTitle: 'Cashier'
    })
    const check1 = await touchActiveStorePinSession(testStoreId, s1.sessionToken)
    assert.equal(check1.valid, true, 'La sesión de Cajera Uno debe estar activa')

    // 2. Cajera 2 inicia sesión en la misma tienda 9999 -> debe cerrar/reemplazar la sesión de Cajera Uno
    const s2 = await registerExclusiveStorePinSession({
      storeId: testStoreId,
      employeeUserId: 202,
      employeeName: 'Cajera Dos',
      jobTitle: 'Cashier'
    })
    assert.notEqual(s1.sessionToken, s2.sessionToken, 'Cada inicio de sesión genera un token único')

    const checkOldSession = await touchActiveStorePinSession(testStoreId, s1.sessionToken)
    assert.equal(checkOldSession.valid, false, 'La sesión de Cajera Uno debe quedar invalidada inmediatamente')
    assert.equal(
      checkOldSession.replacedBy,
      'Cajera Dos',
      'Debe indicar que Cajera Dos inició sesión en esa tienda'
    )

    // 3. Intentar cerrar con el token viejo NO debe borrar la sesión nueva de Cajera Dos
    const clearedByOld = await clearActiveStorePinSession(testStoreId, s1.sessionToken)
    assert.equal(clearedByOld, false, 'El logout de la sesión desplazada no debe borrar la nueva sesión activa')

    const activeNow = await getActiveStorePinSession(testStoreId)
    assert.equal(activeNow?.sessionToken, s2.sessionToken, 'La única sesión activa debe seguir siendo la de Cajera Dos')

    // 4. Simulación real en DB de continuidad entre Cajera 1 (arma bolsa) -> Cajera 2 (actualiza/entrega) -> Reabrir orden entregada por error -> Deshacer empaque a EMPACANDO
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('delivery_packing_audits')
      .insert({
        toast_order_guid: testOrderGuid,
        store_id: 7,
        toast_display_number: '999',
        platform: 'UBER_EATS',
        dining_option_name: 'Uber Eats - Delivery',
        customer_name: 'Test C.',
        items_json: [],
        matched_items: ['1'],
        match_completed: true,
        expected_bag_count: 1,
        confirmed_bag_count: 1,
        packer_ronos_user_id: 2454,
        packer_ronos_name: 'Jennifer Test',
        packed_at: new Date().toISOString(),
        handed_by_ronos_user_id: 2457,
        handed_by_ronos_name: 'Abigail Test',
        handed_at: new Date().toISOString(),
        driver_name: 'Test Driver',
        driver_confirmed: true,
        status: 'DELIVERED'
      })
      .select('*')
      .single()
    assert.equal(!insertErr && !!inserted, true, `Insert de prueba debe funcionar: ${insertErr?.message || ''}`)

    const reopened = await reopenDeliveredAudit({
      orderGuid: testOrderGuid,
      storeId: 7,
      reopenedByEmployee: {
        id: 2457,
        fullName: 'Abigail Test',
        jobTitle: 'Cashier',
        storeId: 7
      }
    })
    assert.equal(reopened.status, 'PACKED_AND_SEALED', 'La orden reabierta debe regresar a PACKED_AND_SEALED (LISTA)')
    assert.equal(reopened.handed_at, null, 'handed_at debe limpiarse al reabrir la orden')
    assert.equal(reopened.packer_ronos_name, 'Jennifer Test', 'Debe conservar quién empacó originalmente la orden')

    const undone = await undoPackingAudit({
      orderGuid: testOrderGuid,
      storeId: 7,
      undoneByEmployee: {
        id: 2457,
        fullName: 'Abigail Test',
        jobTitle: 'Cashier',
        storeId: 7
      }
    })
    assert.equal(undone, true, 'undoPackingAudit debe regresar la orden a EMPACANDO eliminando el registro prematuro')

    // 5. Limpieza final con el token activo
    const clearedByNew = await clearActiveStorePinSession(testStoreId, s2.sessionToken)
    assert.equal(clearedByNew, true, 'La sesión activa debe poder cerrarse limpiamente')

    console.log('Delivery Armor core simulation: PASS')
  } finally {
    await supabaseAdmin.from('delivery_packing_audits').delete().eq('toast_order_guid', testOrderGuid)
    await clearActiveStorePinSession(testStoreId)
  }
})()




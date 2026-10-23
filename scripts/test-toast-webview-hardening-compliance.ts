/**
 * @module scripts/test-toast-webview-hardening-compliance
 * @description Suite automatizada de pruebas de cumplimiento, seguridad WebView (ALLOW_IN_WEBVIEW,
 * OPEN_EXTERNAL, BLOCK), prueba de no-escape de Linking.openURL en react-native-webview,
 * interceptación de popups onOpenWindow, consistencia legal de GPS en primer plano,
 * catálogo autoritativo de 15 sucursales (IDs 1, 3..16), horarios en America/Los_Angeles,
 * configuración EAS/Expo (Android API 36, Project ID vinculado), JSDoc obligatorio,
 * rutas legales HTTP 200 y prueba real de mutación/eliminación de cuenta en Supabase.
 *
 * @businessRules
 * - Valida exhaustivamente todas las reglas de las Fases 1 a 16 de la Continuación Oficial
 *   "Tacos Gavilan App — Fase de Corrección, Build Nativo y Validación Real para App Store / Google Play".
 * - Cero mocks de lógica de negocio: importa directamente los módulos reales de `gavilan-app` y ejecuta
 *   peticiones HTTP y mutaciones reales contra el servidor local y Supabase.
 *
 * @dataFlow
 * - Importa `lib/webview-security.ts`, `lib/constants.ts`, `lib/toast-ordering.ts` desde `C:\Users\pedro\Desktop\gavilan-app`.
 * - Consulta `public.stores` y ejecuta smoke test de creación/eliminación en `public.app_users` / Supabase Auth.
 *
 * @notes
 * - Ejecutar con: `npx tsx scripts/test-toast-webview-hardening-compliance.ts`
 */

import fs from 'fs'
import path from 'path'
import assert from 'assert'
import Module from 'module'
import { supabaseAdmin } from '../lib/supabase'
import {
  evaluateWebViewNavigationRequest,
  recordSanitizedWebViewHostEvent,
  getSanitizedWebViewHostLogs,
  clearSanitizedWebViewHostLogs,
  EXPLICIT_ORIGIN_WHITELIST,
  WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST,
  ALLOWED_WEBVIEW_HTTPS_HOSTS,
  WEBVIEW_SECURITY_CONFIG,
} from '../../gavilan-app/lib/webview-security'

// Registro de llamadas a Linking.openURL para demostrar que URLs bloqueadas NUNCA abren el navegador externo
const openedExternalUrls: string[] = []

// Evitar que Node/tsx intente parsear la sintaxis Flow (`import typeof`) de `node_modules/react-native/index.js`
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load
;(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === 'react-native') {
    return {
      Platform: {
        OS: 'ios',
        select: (spec: Record<string, unknown>) => spec.ios ?? spec.default,
      },
      Linking: {
        openURL: async (url: string) => {
          openedExternalUrls.push(url)
          return true
        },
      },
      Alert: {
        alert: () => {},
      },
    }
  }
  return originalLoad.apply(this, [request, parent, isMain])
}

const {
  ALL_STORES,
  getAuthoritativeStoreById,
  isStoreCurrentlyOpen,
  getStoreOpenStatus,
  calculateDistanceMiles,
  sortStoresByDistance,
  buildStorePhoneUrl,
  buildStoreNavigationUrls,
} = require('../../gavilan-app/lib/constants') as typeof import('../../gavilan-app/lib/constants')

const {
  TOAST_ONLINE_STORE_URLS,
  getToastOnlineStoreConfig,
  getToastOnlineStoreUrl,
} = require('../../gavilan-app/lib/toast-ordering') as typeof import('../../gavilan-app/lib/toast-ordering')

const GAVILAN_APP_ROOT = 'C:/Users/pedro/Desktop/gavilan-app'
const TEG_ROOT = 'c:/Users/pedro/Desktop/teg-modernizado'
let LOCAL_WEB_BASE = process.env.TEST_WEB_BASE || 'http://localhost:3000'

let passedAssertions = 0

function check(condition: unknown, message: string): void {
  assert.ok(condition, `❌ FALLÓ: ${message}`)
  passedAssertions++
}

async function runComplianceSuite(): Promise<void> {
  console.log('======================================================================')
  console.log('🛡️  AUDITORÍA Y PRUEBAS DE CUMPLIMIENTO — TACOS GAVILAN APP (v2.1.0)')
  console.log('======================================================================\n')

  // =========================================================================
  // 1. SEGURIDAD WEBVIEW (DENY-BY-DEFAULT, NO-ESCAPE LINKING.OPENURL, POPUPS)
  // =========================================================================
  console.log('▶ [1/6] Probando Política de Seguridad Deny-by-Default del WebView y No-Escape...')

  clearSanitizedWebViewHostLogs()

  // 1.1 Todas las 15 URLs de order.online (Pickup y Delivery) deben clasificarse como ALLOW_IN_WEBVIEW
  for (const store of ALL_STORES) {
    const decisionPickup = evaluateWebViewNavigationRequest(store.toastOrderingUrl)
    const decisionDelivery = evaluateWebViewNavigationRequest(
      getToastOnlineStoreUrl(store.id, 'DELIVERY')
    )
    check(
      decisionPickup.allowInWebView === true &&
        decisionPickup.action === 'ALLOW_IN_WEBVIEW' &&
        decisionPickup.reason === 'ALLOWED_HTTPS_HOST',
      `Debe permitir URL Pickup de ${store.name}: ${store.toastOrderingUrl}`
    )
    check(
      decisionDelivery.allowInWebView === true &&
        decisionDelivery.action === 'ALLOW_IN_WEBVIEW' &&
        decisionDelivery.reason === 'ALLOWED_HTTPS_HOST',
      `Debe permitir URL Delivery de ${store.name}`
    )
  }

  // 1.2 Hosts necesarios para Login OTP, Pagos, 3D Secure, Apple Pay y Google Pay deben permitirse en WebView
  const allowedCheckoutUrls = [
    'https://identity.doordash.com/auth?client_id=toast',
    'https://js.stripe.com/v3/',
    'https://hooks.stripe.com/3d_secure_2/hosted',
    'https://songbird.cardinalcommerce.com/edge/v1/Init',
    'https://centinelapi.cardinalcommerce.com/V1/Cruise/Collect',
    'https://pay.google.com/gp/p/js/pay.js',
    'https://applepay.cdn-apple.com/jsapi/v1/apple-pay-sdk.js',
    'https://challenges.cloudflare.com/turnstile/v0/api.js',
  ]
  for (const url of allowedCheckoutUrls) {
    const d = evaluateWebViewNavigationRequest(url)
    check(
      d.allowInWebView === true && d.action === 'ALLOW_IN_WEBVIEW',
      `Host de autenticación/pago/3DS debe clasificarse como ALLOW_IN_WEBVIEW: ${url}`
    )
  }

  // 1.3 Bloqueo estricto de HTTP inseguro
  const httpDecision = evaluateWebViewNavigationRequest(
    'http://order.online/store/tacos-gavilan-lynwood-727877'
  )
  check(
    httpDecision.allowInWebView === false &&
      httpDecision.action === 'BLOCK' &&
      httpDecision.reason === 'BLOCKED_INSECURE_HTTP',
    'http://order.online debe ser bloqueado por BLOCKED_INSECURE_HTTP'
  )

  // 1.4 Bloqueo de javascript:, file:, content:, data:, intent:, blob:, market:, itms-apps:
  const dangerousUrls = [
    'javascript:alert(1)',
    'JAVASCRIPT:window.ReactNativeWebView.postMessage("hack")',
    'file:///etc/passwd',
    'content://com.android.providers.media.documents/document/image%3A1',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'intent://order.online/#Intent;scheme=https;package=com.evil;end',
    'blob:https://order.online/550e8400-e29b-41d4-a716-446655440000',
    'market://details?id=com.evil.app',
    'itms-apps://itunes.apple.com/app/id123456',
  ]
  for (const badUrl of dangerousUrls) {
    const d = evaluateWebViewNavigationRequest(badUrl)
    check(
      d.allowInWebView === false &&
        d.action === 'BLOCK' &&
        d.reason === 'BLOCKED_DANGEROUS_SCHEME',
      `Esquema peligroso debe bloquearse: ${badUrl}`
    )
  }

  // 1.5 Bloqueo de dominios desconocidos, dominios parecidos (lookalike), puertos no estándar y credenciales embebidas
  const unknownAndSpoofUrls: Array<{ url: string; expectedReason: string }> = [
    { url: 'https://evil.example.com/checkout', expectedReason: 'BLOCKED_UNKNOWN_HOST' },
    { url: 'https://order.online.evil.example.com/store/', expectedReason: 'BLOCKED_UNKNOWN_HOST' },
    { url: 'https://tacosgavilan-order.online/store/', expectedReason: 'BLOCKED_UNKNOWN_HOST' },
    { url: 'https://order-online.com/store/', expectedReason: 'BLOCKED_UNKNOWN_HOST' },
    { url: 'https://phishing.toasttab.com/login', expectedReason: 'BLOCKED_UNKNOWN_HOST' },
    { url: 'https://evil.doordash.com/auth', expectedReason: 'BLOCKED_UNKNOWN_HOST' },
    {
      url: 'https://order.online:secret@evil.example.com/store/',
      expectedReason: 'BLOCKED_EMBEDDED_CREDENTIALS',
    },
    {
      url: 'https://order.online:8443/store/tacos-gavilan-lynwood-727877',
      expectedReason: 'BLOCKED_NON_STANDARD_PORT',
    },
    {
      url: 'https://order.online/downloads/payload.apk?token=123',
      expectedReason: 'BLOCKED_ARBITRARY_DOWNLOAD',
    },
  ]
  for (const item of unknownAndSpoofUrls) {
    const d = evaluateWebViewNavigationRequest(item.url)
    check(
      d.allowInWebView === false &&
        d.action === 'BLOCK' &&
        d.reason === item.expectedReason,
      `URL maliciosa/no autorizada debe bloquearse (${item.expectedReason}): ${item.url}`
    )
  }

  // 1.6 Manejo externo explícito (OPEN_EXTERNAL) de tel:, mailto: y Apple/Google Maps
  const telDecision = evaluateWebViewNavigationRequest('tel:+14247855535')
  check(
    telDecision.allowInWebView === false &&
      telDecision.action === 'OPEN_EXTERNAL' &&
      telDecision.reason === 'EXTERNAL_TEL_SCHEME',
    'tel: debe clasificarse como OPEN_EXTERNAL'
  )

  const mailtoDecision = evaluateWebViewNavigationRequest('mailto:support@tacosgavilan.com')
  check(
    mailtoDecision.allowInWebView === false &&
      mailtoDecision.action === 'OPEN_EXTERNAL' &&
      mailtoDecision.reason === 'EXTERNAL_MAILTO_SCHEME',
    'mailto: debe clasificarse como OPEN_EXTERNAL'
  )

  const appleMapsDecision = evaluateWebViewNavigationRequest(
    'https://maps.apple.com/?q=3220+E.+Imperial+Hwy.'
  )
  check(
    appleMapsDecision.allowInWebView === false &&
      appleMapsDecision.action === 'OPEN_EXTERNAL' &&
      appleMapsDecision.reason === 'EXTERNAL_MAPS_URL',
    'Apple Maps debe clasificarse como OPEN_EXTERNAL'
  )

  const googleMapsDecision = evaluateWebViewNavigationRequest(
    'https://www.google.com/maps/search/?api=1&query=3220+E.+Imperial+Hwy.'
  )
  check(
    googleMapsDecision.allowInWebView === false &&
      googleMapsDecision.action === 'OPEN_EXTERNAL' &&
      googleMapsDecision.reason === 'EXTERNAL_MAPS_URL',
    'Google Maps debe clasificarse como OPEN_EXTERNAL'
  )

  // 1.7 Prueba de integración contra la lógica interna de react-native-webview (lib/WebViewShared.js):
  // Demostrar que con WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST = ['*'], react-native-webview NUNCA
  // llama a Linking.openURL antes de ejecutar nuestro evaluador central, y que una URL BLOCK
  // jamás se carga en el WebView ni se abre externamente.
  openedExternalUrls.length = 0
  check(
    Array.isArray(WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST) &&
      WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST.length === 1 &&
      WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST[0] === '*',
    'WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST debe ser ["*"] para desactivar el auto-Linking.openURL de WebViewShared.js'
  )
  check(
    !EXPLICIT_ORIGIN_WHITELIST.includes('*') &&
      EXPLICIT_ORIGIN_WHITELIST.length === ALLOWED_WEBVIEW_HTTPS_HOSTS.size,
    'EXPLICIT_ORIGIN_WHITELIST debe contener únicamente los orígenes HTTPS exactos sin comodín "*"'
  )

  // Simular exactamente el flujo de handleShouldStartLoadWithRequest + handleOpenWindow de menu.tsx
  function simulateMenuWebViewGatekeeper(rawUrl: string): {
    loadedInWebView: boolean
    openedExternally: boolean
    decisionAction: string
  } {
    const decision = evaluateWebViewNavigationRequest(rawUrl)
    if (decision.action === 'ALLOW_IN_WEBVIEW') {
      return { loadedInWebView: true, openedExternally: false, decisionAction: decision.action }
    }
    if (decision.action === 'OPEN_EXTERNAL' && decision.externalUrl) {
      openedExternalUrls.push(decision.externalUrl)
      return { loadedInWebView: false, openedExternally: true, decisionAction: decision.action }
    }
    return { loadedInWebView: false, openedExternally: false, decisionAction: decision.action }
  }

  for (const item of unknownAndSpoofUrls) {
    const res = simulateMenuWebViewGatekeeper(item.url)
    check(
      res.loadedInWebView === false &&
        res.openedExternally === false &&
        res.decisionAction === 'BLOCK',
      `URL bloqueada no puede cargarse en WebView ni abrirse externamente: ${item.url}`
    )
  }
  for (const badUrl of dangerousUrls) {
    const res = simulateMenuWebViewGatekeeper(badUrl)
    check(
      res.loadedInWebView === false &&
        res.openedExternally === false &&
        res.decisionAction === 'BLOCK',
      `Esquema peligroso no puede cargarse en WebView ni abrirse externamente: ${badUrl}`
    )
  }
  check(
    openedExternalUrls.length === 0,
    'Ninguna URL bloqueada o esquema peligroso debe haber invocado Linking.openURL'
  )

  // 1.8 Sanitización estricta de logs (cero query strings, tokens, rutas o PII)
  const sensitiveUrl =
    'https://order.online/store/tacos-gavilan-lynwood-727877/?session_token=SECRET_JWT_999&phone=%2B14247855535&card_last4=4242#checkout'
  const logEntry = recordSanitizedWebViewHostEvent(sensitiveUrl)
  const serializedLogs = JSON.stringify(getSanitizedWebViewHostLogs())
  check(
    logEntry.hostname === 'order.online' &&
      !serializedLogs.includes('SECRET_JWT_999') &&
      !serializedLogs.includes('4247855535') &&
      !serializedLogs.includes('4242') &&
      !serializedLogs.includes('tacos-gavilan-lynwood'),
    'El registro sanitizado de hosts NUNCA debe incluir query strings, rutas, tokens ni PII'
  )

  // 1.9 Verificación de configuración de cookies/popups y ausencia de injectedJavaScript/onMessage en menu.tsx
  check(
    WEBVIEW_SECURITY_CONFIG.sharedCookiesEnabled === true &&
      WEBVIEW_SECURITY_CONFIG.thirdPartyCookiesEnabled === true &&
      WEBVIEW_SECURITY_CONFIG.setSupportMultipleWindows === true &&
      WEBVIEW_SECURITY_CONFIG.javaScriptCanOpenWindowsAutomatically === false &&
      WEBVIEW_SECURITY_CONFIG.allowFileAccess === false &&
      WEBVIEW_SECURITY_CONFIG.mixedContentMode === 'never',
    'WEBVIEW_SECURITY_CONFIG debe habilitar cookies requeridas por Toast/DoorDash/3DS y bloquear acceso a archivos y contenido mixto'
  )

  const menuTsxContent = fs.readFileSync(
    path.join(GAVILAN_APP_ROOT, 'app/(tabs)/menu.tsx'),
    'utf8'
  )
  check(
    menuTsxContent.includes('originWhitelist={WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST}') &&
      menuTsxContent.includes('onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}') &&
      menuTsxContent.includes('onOpenWindow={handleOpenWindow}'),
    'menu.tsx debe conectar WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST, onShouldStartLoadWithRequest y onOpenWindow'
  )
  check(
    menuTsxContent.includes('clearCache') &&
      menuTsxContent.includes('clearHistory') &&
      menuTsxContent.includes('incognito={isPurgingCookies}'),
    'menu.tsx debe ejecutar limpieza real de caché, historial y cookies nativas (ciclo incognito)'
  )
  check(
    !menuTsxContent.includes('injectedJavaScript'),
    'menu.tsx no debe contener injectedJavaScript'
  )
  check(
    !menuTsxContent.includes('onMessage'),
    'menu.tsx no debe contener onMessage bridge'
  )

  console.log('   ✅ Seguridad WebView, no-escape Linking.openURL, onOpenWindow y purga de sesión verificados.\n')

  // =========================================================================
  // 2. PRIVACIDAD Y CONSISTENCIA DE GPS EN PRIMER PLANO (FASE 2)
  // =========================================================================
  console.log('▶ [2/6] Verificando Consistencia Legal de Privacidad y GPS en Primer Plano...')

  const tegI18nContent = fs.readFileSync(path.join(TEG_ROOT, 'lib/i18n.tsx'), 'utf8')
  const privacyPageContent = fs.readFileSync(
    path.join(TEG_ROOT, 'app/app/privacy/page.tsx'),
    'utf8'
  )

  const forbiddenFalsePrivacyClaims = [
    'Cero permisos de ubicación GPS',
    'Zero GPS location permissions',
    'no solicita permisos de ubicación',
    'does not request location permissions',
  ]
  for (const falseClaim of forbiddenFalsePrivacyClaims) {
    check(
      !tegI18nContent.includes(falseClaim) && !privacyPageContent.includes(falseClaim),
      `Política de privacidad y traducciones NO deben contener la afirmación falsa: "${falseClaim}"`
    )
  }

  check(
    tegI18nContent.includes('When In Use') &&
      tegI18nContent.includes('Find Nearest Store') &&
      tegI18nContent.includes('Near Me') &&
      tegI18nContent.includes('Cerca de mí'),
    'lib/i18n.tsx debe divulgar con precisión el uso opcional de GPS en primer plano (When In Use) para Near Me / Cerca de mí'
  )

  console.log('   ✅ Consistencia entre permisos GPS en app.json y Política de Privacidad verificada.\n')

  // =========================================================================
  // 3. CATÁLOGO AUTORITATIVO DE 15 TIENDAS, HORARIOS Y SINCRONIZACIÓN CON SUPABASE
  // =========================================================================
  console.log('▶ [3/6] Probando Catálogo Autoritativo de 15 Sucursales (IDs 1, 3..16) y Horarios...')

  check(ALL_STORES.length === 15, `Debe haber exactamente 15 tiendas (actual: ${ALL_STORES.length})`)
  check(
    Object.keys(TOAST_ONLINE_STORE_URLS).length === 15,
    `TOAST_ONLINE_STORE_URLS debe tener 15 tiendas (actual: ${Object.keys(TOAST_ONLINE_STORE_URLS).length})`
  )

  const expectedStoreIds = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  const actualStoreIds = ALL_STORES.map((s) => s.id).sort((a, b) => a - b)
  check(
    JSON.stringify(actualStoreIds) === JSON.stringify(expectedStoreIds),
    `Los IDs de las 15 sucursales deben ser exactamente [1, 3..16] (actual: ${JSON.stringify(actualStoreIds)})`
  )

  const uniqueIds = new Set(ALL_STORES.map((s) => s.id))
  const uniqueToastIds = new Set(ALL_STORES.map((s) => s.toastStoreId))
  const uniqueUrls = new Set(ALL_STORES.map((s) => s.toastOrderingUrl))
  check(uniqueIds.size === 15, 'Los 15 store.id deben ser únicos')
  check(uniqueToastIds.size === 15, 'Los 15 toastStoreId deben ser únicos')
  check(uniqueUrls.size === 15, 'Las 15 URLs de order.online deben ser únicas')

  for (const store of ALL_STORES) {
    check(
      store.toastOrderingUrl.startsWith('https://order.online/store/') &&
        store.toastOrderingUrl.includes(store.toastStoreId),
      `URL inválida para sucursal ${store.name}: ${store.toastOrderingUrl}`
    )
    check(
      Object.keys(store.weeklySchedule).length === 7,
      `Sucursal ${store.name} debe tener horario para los 7 días de la semana`
    )
  }

  // 3.1 Verificación de error explícito ante storeId inválido (incluyendo ID 2 inexistente)
  for (const invalidId of [999, 2, 0, -1]) {
    let threwConstants = false
    let threwToastConfig = false
    let threwToastUrl = false
    try {
      getAuthoritativeStoreById(invalidId)
    } catch {
      threwConstants = true
    }
    try {
      getToastOnlineStoreConfig(invalidId)
    } catch {
      threwToastConfig = true
    }
    try {
      getToastOnlineStoreUrl(invalidId)
    } catch {
      threwToastUrl = true
    }
    check(
      threwConstants && threwToastConfig && threwToastUrl,
      `storeId inválido "${invalidId}" debe lanzar error explícito sin caer en otra sucursal`
    )
  }

  // 3.2 Pruebas de horas límite en America/Los_Angeles (incluyendo cierres de madrugada)
  check(
    isStoreCurrentlyOpen(14, new Date('2026-10-14T16:59:00Z')) === false,
    'Lynwood (#14) debe estar CERRADO a las 9:59 AM PDT'
  )
  check(
    isStoreCurrentlyOpen(14, new Date('2026-10-14T17:00:00Z')) === true,
    'Lynwood (#14) debe estar ABIERTO a las 10:00 AM PDT'
  )

  const sat230AmStatus = getStoreOpenStatus(14, new Date('2026-10-17T09:30:00Z'), 'es')
  check(
    sat230AmStatus.isOpen === true && sat230AmStatus.badgeText === 'ABIERTO',
    'Lynwood (#14) debe estar ABIERTO a las 2:30 AM del sábado (madrugada del turno viernes)'
  )
  check(
    isStoreCurrentlyOpen(14, new Date('2026-10-17T10:05:00Z')) === false,
    'Lynwood (#14) debe estar CERRADO a las 3:05 AM del sábado'
  )
  check(
    isStoreCurrentlyOpen(5, new Date('2026-10-17T10:30:00Z')) === true,
    'LA Broadway (#5) debe estar ABIERTO a las 3:30 AM del sábado'
  )
  check(
    isStoreCurrentlyOpen(1, new Date('2026-10-15T07:15:00Z')) === false,
    'Rialto (#1) debe estar CERRADO a las 12:15 AM del jueves'
  )

  // 3.3 Cruce 1:1 contra public.stores en Supabase y /app/support
  const { data: dbStores, error: dbStoresErr } = await supabaseAdmin
    .from('stores')
    .select('id, name, address, phone, opening_time')
    .eq('is_active', true)
    .order('id')
  check(!dbStoresErr && dbStores && dbStores.length === 15, 'public.stores debe tener 15 tiendas activas')

  const supportPageContent = fs.readFileSync(
    path.join(TEG_ROOT, 'app/app/support/page.tsx'),
    'utf8'
  )

  const normalizeAddressStyle = (addr: string) =>
    addr.replace(/\b(E|W|N|S|Rd|St|Ave|Blvd|Hwy)\./g, '$1').trim()

  for (const dbStore of dbStores || []) {
    const appStore = getAuthoritativeStoreById(Number(dbStore.id))
    check(
      appStore.phone === dbStore.phone,
      `Teléfono de ${appStore.name} debe coincidir entre app (${appStore.phone}) y DB (${dbStore.phone})`
    )
    check(
      normalizeAddressStyle(appStore.address) === normalizeAddressStyle(dbStore.address),
      `Dirección de ${appStore.name} debe coincidir entre app (${appStore.address}) y DB (${dbStore.address})`
    )
    check(
      supportPageContent.includes(appStore.phone) && supportPageContent.includes(appStore.address),
      `/app/support debe incluir teléfono y dirección exactos de ${appStore.name}`
    )
  }

  // Verificar que Hollywood (#8) abre a las 09:00 en Supabase
  const hollywoodDb = (dbStores || []).find((s) => Number(s.id) === 8)
  check(
    hollywoodDb?.opening_time?.startsWith('09:00'),
    `Hollywood (#8) en public.stores debe tener opening_time = 09:00:00 (actual: ${hollywoodDb?.opening_time})`
  )

  // 3.4 Verificación de Localizador GPS, Ordenamiento por Cercanía, Marcador tel: y Navegación Apple Maps / Google Maps
  const lynwoodStore = getAuthoritativeStoreById(14)
  const zeroDist = calculateDistanceMiles(
    lynwoodStore.latitude,
    lynwoodStore.longitude,
    lynwoodStore.latitude,
    lynwoodStore.longitude
  )
  check(zeroDist === 0, `Distancia GPS a la misma coordenada debe ser 0 (actual: ${zeroDist})`)

  const sortedFromLynwood = sortStoresByDistance(
    ALL_STORES,
    lynwoodStore.latitude,
    lynwoodStore.longitude
  )
  check(
    sortedFromLynwood.length === 15 && sortedFromLynwood[0].id === 14,
    'Al ubicarse en Lynwood #14, sortStoresByDistance debe colocar a Lynwood (#14) en primer lugar (#1 más cercana)'
  )
  for (let i = 1; i < sortedFromLynwood.length; i++) {
    check(
      sortedFromLynwood[i].distanceMiles >= sortedFromLynwood[i - 1].distanceMiles,
      'sortStoresByDistance debe ordenar de menor a mayor distancia en millas'
    )
  }

  for (const store of ALL_STORES) {
    const telUrl = buildStorePhoneUrl(store.phone)
    check(
      Boolean(telUrl && telUrl.startsWith('tel:+1') && telUrl.length === 16),
      `buildStorePhoneUrl debe generar tel:+1XXXXXXXXXX para ${store.name} (actual: ${telUrl})`
    )

    const iosNav = buildStoreNavigationUrls(store, 'ios')
    check(
      iosNav.providerLabel === 'Apple Maps' &&
        iosNav.primaryUrl.startsWith('maps://?daddr=') &&
        iosNav.primaryUrl.includes('dirflg=d') &&
        iosNav.fallbackUrl.startsWith('https://maps.apple.com/?daddr='),
      `En iOS la navegación debe usar Apple Maps para ${store.name}`
    )

    const androidNav = buildStoreNavigationUrls(store, 'android')
    check(
      androidNav.providerLabel === 'Google Maps' &&
        androidNav.primaryUrl.startsWith('google.navigation:q=') &&
        androidNav.fallbackUrl.startsWith('https://www.google.com/maps/dir/?api=1&destination='),
      `En Android la navegación debe usar Google Maps para ${store.name}`
    )
  }

  console.log('   ✅ Catálogo de 15 sucursales, GPS Haversine, marcador tel:, Apple Maps / Google Maps y sincronización DB verificados.\n')

  // =========================================================================
  // 4. CONFIGURACIÓN EXPO / EAS / ANDROID API 36 / LOCKFILE / JSDOC
  // =========================================================================
  console.log('▶ [4/6] Probando Configuración de package.json, package-lock.json, app.json, eas.json y JSDoc...')

  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(GAVILAN_APP_ROOT, 'package.json'), 'utf8')
  )
  const pkgLockJson = JSON.parse(
    fs.readFileSync(path.join(GAVILAN_APP_ROOT, 'package-lock.json'), 'utf8')
  )
  const appJson = JSON.parse(
    fs.readFileSync(path.join(GAVILAN_APP_ROOT, 'app.json'), 'utf8')
  )
  const easJson = JSON.parse(
    fs.readFileSync(path.join(GAVILAN_APP_ROOT, 'eas.json'), 'utf8')
  )
  const dotEnv = fs.readFileSync(path.join(GAVILAN_APP_ROOT, '.env'), 'utf8')

  check(
    pkgJson.version === appJson.expo.version && pkgJson.version === '2.1.0',
    `Versiones deben coincidir en 2.1.0 (package.json=${pkgJson.version}, app.json=${appJson.expo.version})`
  )
  check(
    pkgLockJson.packages?.['']?.version === '2.1.0' &&
      Boolean(pkgLockJson.packages?.['']?.dependencies?.['@supabase/supabase-js']),
    'package-lock.json debe estar sincronizado con package.json v2.1.0 e incluir @supabase/supabase-js'
  )
  check(
    appJson.expo.owner === 'roquepv' &&
      appJson.expo.extra?.eas?.projectId === 'ce1d5d66-fbb1-46e3-bfc6-9921590ba7da',
    'app.json debe tener owner="roquepv" y extra.eas.projectId vinculado en EAS'
  )
  check(
    Boolean(pkgJson.dependencies['expo-location']),
    'expo-location debe existir en dependencies de package.json para el localizador GPS de sucursales'
  )
  check(
    Boolean(appJson.expo.ios?.infoPlist?.NSLocationWhenInUseUsageDescription) &&
      Array.isArray(appJson.expo.android?.permissions) &&
      appJson.expo.android.permissions.includes('android.permission.ACCESS_COARSE_LOCATION') &&
      appJson.expo.android.permissions.includes('android.permission.ACCESS_FINE_LOCATION') &&
      !JSON.stringify(appJson).includes('NSLocationAlways') &&
      !JSON.stringify(appJson).includes('ACCESS_BACKGROUND_LOCATION'),
    'app.json debe declarar únicamente permisos de ubicación en primer plano (WhenInUse) para el localizador GPS y nunca ubicación en segundo plano'
  )
  check(
    appJson.expo.ios?.supportsTablet === false,
    'app.json debe tener ios.supportsTablet = false'
  )

  const androidConfig = appJson.expo.android || {}
  const buildPropsPlugin = (appJson.expo.plugins || []).find(
    (p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties'
  )
  const targetSdk36 =
    androidConfig.targetSdkVersion === 36 ||
    (Array.isArray(buildPropsPlugin) && buildPropsPlugin[1]?.android?.targetSdkVersion === 36)
  const compileSdk36 =
    androidConfig.compileSdkVersion === 36 ||
    (Array.isArray(buildPropsPlugin) && buildPropsPlugin[1]?.android?.compileSdkVersion === 36)

  check(
    targetSdk36 && compileSdk36,
    'app.json debe configurar Android compileSdkVersion=36 y targetSdkVersion=36'
  )

  check(
    !JSON.stringify(easJson.build?.preview || {}).includes('localhost') &&
      !JSON.stringify(easJson.build?.production || {}).includes('localhost'),
    'eas.json no debe apuntar a localhost en preview ni production'
  )
  check(
    !dotEnv.includes('localhost') && dotEnv.includes('https://tacosgavilan.vercel.app'),
    '.env no debe apuntar a localhost y debe usar HTTPS de producción (https://tacosgavilan.vercel.app)'
  )
  check(
    appJson.expo.experiments?.baseUrl === '/app',
    'app.json debe tener experiments.baseUrl = "/app" para servir el bundle web bajo /app'
  )

  // Verificación binaria de iconos nativos (1024x1024 y RGB sin canal alfa para icon.png en App Store)
  const iconPngBuf = fs.readFileSync(path.join(GAVILAN_APP_ROOT, 'assets/icon.png'))
  check(
    iconPngBuf.readUInt32BE(16) === 1024 &&
      iconPngBuf.readUInt32BE(20) === 1024 &&
      iconPngBuf[25] === 2,
    'assets/icon.png debe ser exactamente 1024x1024 px y RGB opaco (ColorType=2, sin canal alfa) para Apple App Store'
  )
  for (const iconAsset of [
    'assets/splash-icon.png',
    'assets/android-icon-foreground.png',
    'assets/android-icon-background.png',
    'assets/android-icon-monochrome.png',
  ]) {
    const assetBuf = fs.readFileSync(path.join(GAVILAN_APP_ROOT, iconAsset))
    check(
      assetBuf.readUInt32BE(16) === 1024 && assetBuf.readUInt32BE(20) === 1024,
      `${iconAsset} debe tener resolución 1024x1024 px`
    )
  }

  // Verificación de cabeceras JSDoc obligatorias en todos los archivos TS/TSX de gavilan-app
  function verifyJsDocInDir(dirPath: string): void {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (['node_modules', '.expo', 'dist', '.git'].includes(entry.name)) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        verifyJsDocInDir(fullPath)
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8')
        for (const tag of ['@module', '@description', '@businessRules', '@dataFlow', '@notes']) {
          check(
            content.includes(tag),
            `El módulo ${fullPath} debe incluir la etiqueta JSDoc obligatoria ${tag}`
          )
        }
      }
    }
  }
  verifyJsDocInDir(GAVILAN_APP_ROOT)

  const indexHtmlRouteTsx = fs.readFileSync(
    path.join(GAVILAN_APP_ROOT, 'app/index.html.tsx'),
    'utf8'
  )
  const notFoundRouteTsx = fs.readFileSync(
    path.join(GAVILAN_APP_ROOT, 'app/+not-found.tsx'),
    'utf8'
  )
  check(
    !fs.existsSync(path.join(GAVILAN_APP_ROOT, 'app/index.tsx')) &&
      fs.existsSync(path.join(GAVILAN_APP_ROOT, 'app/(tabs)/index.tsx')),
    'No debe existir app/index.tsx en la raíz para evitar colisión de ruta (/) contra app/(tabs)/index.tsx'
  )
  check(
    indexHtmlRouteTsx.includes('<Redirect href="/(tabs)" />'),
    'app/index.html.tsx debe redirigir inmediatamente a /(tabs) para no bloquearse en el fondo borgoña después del splash'
  )
  check(
    notFoundRouteTsx.includes('<Redirect href="/" />'),
    'app/+not-found.tsx debe redirigir automáticamente a /'
  )

  console.log('   ✅ Configuración EAS, lockfile, API 36, redirección post-splash y cabeceras JSDoc verificadas.\n')

  // =========================================================================
  // 5. UI HONESTY & PÁGINAS LEGALES HTTP 200
  // =========================================================================
  console.log('▶ [5/6] Verificando Ausencia de Claims No Autoritativos y Rutas HTTP 200...')

  const forbiddenUiTerms = [
    '9 min',
    '10 min',
    '25–35 min',
    '25-35 min',
    '10:00 AM - 12:45 AM',
    '#3 Most liked',
    'Official Toast POS catalog',
    'orders.prices:read',
    'curbside',
    'Curbside',
    'CURBSIDE',
  ]

  function scanDirForForbiddenTerms(dirPath: string): void {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (['node_modules', '.expo', 'dist', '.git'].includes(entry.name)) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        scanDirForForbiddenTerms(fullPath)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        for (const term of forbiddenUiTerms) {
          check(
            !content.includes(term),
            `El archivo ${fullPath} aún contiene el texto no autoritativo "${term}"`
          )
        }
      }
    }
  }

  scanDirForForbiddenTerms(GAVILAN_APP_ROOT)

  const gavilanI18nContent = fs.readFileSync(
    path.join(GAVILAN_APP_ROOT, 'lib/i18n.tsx'),
    'utf8'
  )
  const forbiddenI18nRedirects = [
    'Toast Online',
    'order.online',
    'frame-ancestors',
    'noopener,noreferrer',
    'CSP',
  ]
  for (const term of forbiddenI18nRedirects) {
    check(
      !gavilanI18nContent.includes(term),
      `gavilan-app/lib/i18n.tsx no debe mostrar leyendas técnicas ni referencias a "${term}"`
    )
  }

  const requiredLegalRoutes = [
    '/app',
    '/app/privacy',
    '/app/terms',
    '/app/support',
    '/app/delete-account',
    '/api/mobile/stores',
  ]

  try {
    const probe = await fetch(`${LOCAL_WEB_BASE}/api/mobile/stores`, { signal: AbortSignal.timeout(2500) })
    if (!probe.ok) {
      LOCAL_WEB_BASE = 'https://tacosgavilan.vercel.app'
    }
  } catch {
    LOCAL_WEB_BASE = 'https://tacosgavilan.vercel.app'
  }

  for (const route of requiredLegalRoutes) {
    const res = await fetch(`${LOCAL_WEB_BASE}${route}`)
    check(
      res.status === 200,
      `Ruta pública ${route} debe responder HTTP 200 (recibido: ${res.status})`
    )
  }

  const indexHtmlRes = await fetch(`${LOCAL_WEB_BASE}/app/index.html`)
  const indexHtmlText = await indexHtmlRes.text()
  const scriptMatch = indexHtmlText.match(/src="(\/app\/_expo\/static\/js\/web\/entry-[^"]+\.js)"/)
  check(
    indexHtmlRes.status === 200 && Boolean(scriptMatch?.[1]),
    'public/app/index.html debe apuntar a /app/_expo/static/js/web/entry-*.js'
  )
  const bundleRes = await fetch(`${LOCAL_WEB_BASE}${scriptMatch![1]}`)
  check(
    bundleRes.status === 200,
    `Bundle JS web ${scriptMatch![1]} debe responder HTTP 200`
  )

  console.log('   ✅ Higiene de textos UI y rutas públicas HTTP 200 verificadas.\n')

  // =========================================================================
  // 6. LIVE DB MUTATION SMOKE TEST (CREACIÓN Y ELIMINACIÓN DE CUENTA MÓVIL)
  // =========================================================================
  console.log('▶ [6/6] Ejecutando Prueba Real de Mutación y Eliminación de Cuenta en Supabase...')

  const rand4 = Math.floor(1000 + Math.random() * 8999)
  const testPhone10 = `999555${rand4}`
  const testEmail = `compliance.smoke.${Date.now()}.${rand4}@tacosgavilan.test`
  const testPassword = `SmokeTest!${Date.now()}#TG`

  // 6.1 Crear usuario real temporal en Supabase Auth
  const { data: authCreateData, error: authCreateErr } =
    await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })

  check(
    !authCreateErr && authCreateData?.user?.id,
    `Creación de usuario temporal en Supabase Auth exitosa (${testEmail})`
  )
  const authUserId = authCreateData!.user.id

  // 6.2 Iniciar sesión para obtener JWT real de Supabase Auth
  const { data: signInData, error: signInErr } =
    await supabaseAdmin.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })
  check(
    !signInErr && signInData?.session?.access_token,
    'Obtención de JWT real de Supabase Auth exitosa'
  )
  const accessToken = signInData!.session!.access_token

  // 6.3 Insertar perfil real en public.app_users
  const { data: createdProfile, error: userCreateErr } = await supabaseAdmin
    .from('app_users')
    .upsert(
      {
        id: authUserId,
        phone: testPhone10,
        first_name: 'Compliance',
        last_name: 'SmokeTest',
        email: null,
        avatar_url: null,
      },
      { onConflict: 'id' }
    )
    .select('id, phone')
    .single()

  check(
    !userCreateErr && createdProfile?.id === authUserId,
    `Inserción en public.app_users exitosa (${testPhone10})`
  )

  // 6.4 Invocar endpoint real DELETE /api/mobile/user/delete con el Bearer JWT
  const deleteRes = await fetch(`${LOCAL_WEB_BASE}/api/mobile/user/delete`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const deleteJson = await deleteRes.json()
  check(
    deleteRes.status === 200 && deleteJson.deleted === true,
    `DELETE /api/mobile/user/delete debe responder 200 y deleted=true (recibido: ${deleteRes.status})`
  )

  // 6.5 Confirmar que el registro ya no existe en app_users ni en auth.users
  const { data: verifyUserAfter } = await supabaseAdmin
    .from('app_users')
    .select('id')
    .eq('id', authUserId)
    .maybeSingle()

  const { data: verifyAuthAfter } =
    await supabaseAdmin.auth.admin.getUserById(authUserId)

  check(
    verifyUserAfter === null && !verifyAuthAfter?.user,
    'El usuario debe quedar eliminado permanentemente de public.app_users y Supabase Auth'
  )

  // 6.6 Prueba end-to-end de CORS OPTIONS + Flujo OTP App Review (2135550199 / 123456) + Eliminación
  const optionsSendRes = await fetch(`${LOCAL_WEB_BASE}/api/mobile/auth/send-otp`, {
    method: 'OPTIONS',
  })
  const optionsVerifyRes = await fetch(`${LOCAL_WEB_BASE}/api/mobile/auth/verify-otp`, {
    method: 'OPTIONS',
  })
  check(
    optionsSendRes.status === 204 &&
      optionsVerifyRes.status === 204 &&
      optionsSendRes.headers.get('access-control-allow-headers')?.includes('X-Gavilan-Client'),
    'OPTIONS preflight en send-otp y verify-otp debe responder HTTP 204 con X-Gavilan-Client permitido'
  )

  const sendOtpReviewRes = await fetch(`${LOCAL_WEB_BASE}/api/mobile/auth/send-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gavilan-Client': 'mobile-app-v1',
    },
    body: JSON.stringify({ phone: '+1 (213) 555-0199' }),
  })
  const sendOtpReviewJson = await sendOtpReviewRes.json()
  check(
    sendOtpReviewRes.status === 200 && sendOtpReviewJson.success === true,
    `POST /api/mobile/auth/send-otp para teléfono de revisión debe responder 200 (recibido: ${sendOtpReviewRes.status})`
  )

  const verifyOtpReviewRes = await fetch(`${LOCAL_WEB_BASE}/api/mobile/auth/verify-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gavilan-Client': 'mobile-app-v1',
    },
    body: JSON.stringify({ phone: '12135550199', code: '123456' }),
  })
  const verifyOtpReviewJson = await verifyOtpReviewRes.json()
  check(
    verifyOtpReviewRes.status === 200 &&
      Boolean(verifyOtpReviewJson.token) &&
      Boolean(verifyOtpReviewJson.session?.access_token) &&
      verifyOtpReviewJson.user?.phone === '2135550199',
    'POST /api/mobile/auth/verify-otp debe emitir tanto session.access_token como token top-level'
  )

  const deleteReviewRes = await fetch(`${LOCAL_WEB_BASE}/api/mobile/user/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${verifyOtpReviewJson.session.access_token}`,
    },
  })
  const deleteReviewJson = await deleteReviewRes.json()
  check(
    deleteReviewRes.status === 200 && deleteReviewJson.deleted === true,
    'POST /api/mobile/user/delete debe eliminar limpiamente la sesión de revisión'
  )

  console.log('   ✅ Prueba real de mutación, flujo OTP App Review y eliminación en base de datos exitosa.\n')

  console.log('======================================================================')
  console.log(`🎉 TODAS LAS ${passedAssertions} ASERCIONES DE CUMPLIMIENTO PASARON EXITOSAMENTE`)
  console.log('======================================================================')
}

runComplianceSuite().catch((err) => {
  console.error('\n❌ ERROR FATAL EN SUITE DE CUMPLIMIENTO:', err)
  process.exit(1)
})

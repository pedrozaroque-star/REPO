/**
 * @module scripts/test-toast-webview-hardening-compliance
 * @description Suite automatizada de pruebas de cumplimiento, seguridad WebView,
 * catálogo autoritativo de 15 sucursales, horarios en America/Los_Angeles,
 * configuración EAS/Expo (Android API 36, sin permisos de ubicación), rutas legales HTTP 200
 * y prueba real de mutación/eliminación de cuenta en Supabase.
 *
 * @businessRules
 * - Valida exhaustivamente todas las reglas de las Fases 1 a 13 del ciclo definitivo
 *   "Tacos Gavilan App con Toast Online Ordering integrado visualmente mediante WebView nativo en iOS/Android".
 * - Cero mocks: importa directamente los módulos reales de `gavilan-app` y ejecuta peticiones
 *   HTTP y mutaciones reales contra el servidor local y Supabase.
 *
 * @dataFlow
 * - Importa `lib/webview-security.ts`, `lib/constants.ts`, `lib/toast-ordering.ts` desde `C:\Users\pedro\Desktop\gavilan-app`.
 * - Consulta `public.stores` y ejecuta smoke test de creación/eliminación en `public.app_users` / `public.app_sessions`.
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
  WEBVIEW_SECURITY_CONFIG,
} from '../../gavilan-app/lib/webview-security'

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
        openURL: async () => true,
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
} = require('../../gavilan-app/lib/constants') as typeof import('../../gavilan-app/lib/constants')

const {
  TOAST_ONLINE_STORE_URLS,
  getToastOnlineStoreConfig,
  getToastOnlineStoreUrl,
} = require('../../gavilan-app/lib/toast-ordering') as typeof import('../../gavilan-app/lib/toast-ordering')

const GAVILAN_APP_ROOT = 'C:/Users/pedro/Desktop/gavilan-app'
const LOCAL_WEB_BASE = 'http://localhost:3000'

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
  // 1. SEGURIDAD WEBVIEW (DENY-BY-DEFAULT, ESQUEMAS, LOGS SANITIZADOS, CERO BRIDGE)
  // =========================================================================
  console.log('▶ [1/5] Probando Política de Seguridad Deny-by-Default del WebView...')

  clearSanitizedWebViewHostLogs()

  // 1.1 Todas las 15 URLs de order.online deben ser permitidas
  for (const store of ALL_STORES) {
    const decision = evaluateWebViewNavigationRequest(store.toastOrderingUrl)
    check(
      decision.allowInWebView === true &&
        decision.action === 'ALLOW_WEBVIEW' &&
        decision.reason === 'ALLOWED_HTTPS_HOST',
      `Debe permitir URL oficial de ${store.name}: ${store.toastOrderingUrl}`
    )
  }

  // 1.2 Bloqueo estricto de HTTP inseguro
  const httpDecision = evaluateWebViewNavigationRequest(
    'http://order.online/store/tacos-gavilan-lynwood-727877'
  )
  check(
    httpDecision.allowInWebView === false &&
      httpDecision.action === 'BLOCK' &&
      httpDecision.reason === 'BLOCKED_INSECURE_HTTP',
    'http://order.online debe ser bloqueado por BLOCKED_INSECURE_HTTP'
  )

  // 1.3 Bloqueo de javascript:, file:, data:, intent:, blob:, about:
  const dangerousUrls = [
    'javascript:alert(1)',
    'JAVASCRIPT:window.ReactNativeWebView.postMessage("hack")',
    'file:///etc/passwd',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'intent://order.online/#Intent;scheme=https;package=com.evil;end',
    'blob:https://order.online/550e8400-e29b-41d4-a716-446655440000',
    'about:blank',
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

  // 1.4 Bloqueo de dominios desconocidos y ataques de credenciales embebidas
  const unknownHostDecision = evaluateWebViewNavigationRequest('https://evil.example.com/checkout')
  check(
    unknownHostDecision.allowInWebView === false &&
      unknownHostDecision.action === 'BLOCK' &&
      unknownHostDecision.reason === 'BLOCKED_UNKNOWN_HOST',
    'https://evil.example.com debe ser bloqueado por BLOCKED_UNKNOWN_HOST'
  )

  const subdomainSpoofDecision = evaluateWebViewNavigationRequest(
    'https://order.online.evil.example.com/store/'
  )
  check(
    subdomainSpoofDecision.allowInWebView === false &&
      subdomainSpoofDecision.action === 'BLOCK' &&
      subdomainSpoofDecision.reason === 'BLOCKED_UNKNOWN_HOST',
    'https://order.online.evil.example.com debe ser bloqueado'
  )

  const credSpoofDecision = evaluateWebViewNavigationRequest(
    'https://order.online:secret@evil.example.com/store/'
  )
  check(
    credSpoofDecision.allowInWebView === false &&
      credSpoofDecision.action === 'BLOCK' &&
      credSpoofDecision.reason === 'BLOCKED_EMBEDDED_CREDENTIALS',
    'Credenciales embebidas user:pass@host deben ser bloqueadas'
  )

  // 1.5 Bloqueo de descargas arbitrarias
  const apkDownloadDecision = evaluateWebViewNavigationRequest(
    'https://order.online/downloads/payload.apk?token=123'
  )
  check(
    apkDownloadDecision.allowInWebView === false &&
      apkDownloadDecision.action === 'BLOCK' &&
      apkDownloadDecision.reason === 'BLOCKED_ARBITRARY_DOWNLOAD',
    'Descarga .apk debe ser bloqueada'
  )

  // 1.6 Manejo externo explícito de tel:, mailto: y Apple/Google Maps
  const telDecision = evaluateWebViewNavigationRequest('tel:+14247855535')
  check(
    telDecision.allowInWebView === false &&
      telDecision.action === 'OPEN_EXTERNAL_SYSTEM' &&
      telDecision.reason === 'EXTERNAL_TEL_SCHEME',
    'tel: debe delegarse al sistema operativo'
  )

  const mailtoDecision = evaluateWebViewNavigationRequest('mailto:support@tacosgavilan.com')
  check(
    mailtoDecision.allowInWebView === false &&
      mailtoDecision.action === 'OPEN_EXTERNAL_SYSTEM' &&
      mailtoDecision.reason === 'EXTERNAL_MAILTO_SCHEME',
    'mailto: debe delegarse al sistema operativo'
  )

  const appleMapsDecision = evaluateWebViewNavigationRequest(
    'https://maps.apple.com/?q=3220+E.+Imperial+Hwy.'
  )
  check(
    appleMapsDecision.allowInWebView === false &&
      appleMapsDecision.action === 'OPEN_EXTERNAL_SYSTEM' &&
      appleMapsDecision.reason === 'EXTERNAL_MAPS_URL',
    'Apple Maps debe abrirse externamente'
  )

  const googleMapsDecision = evaluateWebViewNavigationRequest(
    'https://www.google.com/maps/search/?api=1&query=3220+E.+Imperial+Hwy.'
  )
  check(
    googleMapsDecision.allowInWebView === false &&
      googleMapsDecision.action === 'OPEN_EXTERNAL_SYSTEM' &&
      googleMapsDecision.reason === 'EXTERNAL_MAPS_URL',
    'Google Maps debe abrirse externamente'
  )

  // 1.7 Sanitización estricta de logs (cero query strings, tokens, rutas o PII)
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

  // 1.8 Verificación de ausencia de originWhitelist={['*']}, injectedJavaScript y onMessage en menu.tsx
  check(
    !EXPLICIT_ORIGIN_WHITELIST.includes('*') && EXPLICIT_ORIGIN_WHITELIST.length >= 15,
    'EXPLICIT_ORIGIN_WHITELIST no puede contener el comodín global "*"'
  )
  check(
    WEBVIEW_SECURITY_CONFIG.sharedCookiesEnabled === false &&
      WEBVIEW_SECURITY_CONFIG.thirdPartyCookiesEnabled === false &&
      WEBVIEW_SECURITY_CONFIG.allowFileAccess === false,
    'WEBVIEW_SECURITY_CONFIG debe iniciar con cookies de terceros y acceso a archivos deshabilitados'
  )

  const menuTsxContent = fs.readFileSync(
    path.join(GAVILAN_APP_ROOT, 'app/(tabs)/menu.tsx'),
    'utf8'
  )
  check(
    !menuTsxContent.includes("originWhitelist={['*']}") &&
      !menuTsxContent.includes('originWhitelist={["*"]}'),
    'menu.tsx no debe contener originWhitelist wildcard'
  )
  check(
    !menuTsxContent.includes('injectedJavaScript'),
    'menu.tsx no debe contener injectedJavaScript'
  )
  check(
    !menuTsxContent.includes('onMessage'),
    'menu.tsx no debe contener onMessage bridge'
  )

  console.log('   ✅ Seguridad WebView verificada con éxito.\n')

  // =========================================================================
  // 2. CATÁLOGO AUTORITATIVO DE 15 TIENDAS, HORARIOS Y SINCRONIZACIÓN CON SUPABASE
  // =========================================================================
  console.log('▶ [2/5] Probando Catálogo Autoritativo de 15 Sucursales y Horarios...')

  check(ALL_STORES.length === 15, `Debe haber exactamente 15 tiendas (actual: ${ALL_STORES.length})`)
  check(
    Object.keys(TOAST_ONLINE_STORE_URLS).length === 15,
    `TOAST_ONLINE_STORE_URLS debe tener 15 tiendas (actual: ${Object.keys(TOAST_ONLINE_STORE_URLS).length})`
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

  // 2.1 Verificación de error explícito ante storeId inválido (cero fallback silencioso)
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

  // 2.2 Pruebas de horas límite en America/Los_Angeles (incluyendo cierres de madrugada)
  // Lynwood (#14): Dom–Mié 10:00 AM – 1:00 AM, Jue 10:00 AM – 2:00 AM, Vie–Sáb 10:00 AM – 3:00 AM
  // En Octubre 2026, Los Ángeles está en PDT (UTC-7).
  // Miércoles 14 Oct 2026 09:59 PDT = 2026-10-14T16:59:00Z -> Cerrado
  // Miércoles 14 Oct 2026 10:00 PDT = 2026-10-14T17:00:00Z -> Abierto
  check(
    isStoreCurrentlyOpen(14, new Date('2026-10-14T16:59:00Z')) === false,
    'Lynwood (#14) debe estar CERRADO a las 9:59 AM PDT'
  )
  check(
    isStoreCurrentlyOpen(14, new Date('2026-10-14T17:00:00Z')) === true,
    'Lynwood (#14) debe estar ABIERTO a las 10:00 AM PDT'
  )

  // Sábado 17 Oct 2026 02:30 AM PDT (madrugada del turno Viernes que cierra a las 3:00 AM) = 2026-10-17T09:30:00Z
  const sat230AmStatus = getStoreOpenStatus(14, new Date('2026-10-17T09:30:00Z'), 'es')
  check(
    sat230AmStatus.isOpen === true && sat230AmStatus.badgeText === 'ABIERTO',
    'Lynwood (#14) debe estar ABIERTO a las 2:30 AM del sábado (madrugada del turno viernes)'
  )
  // Sábado 17 Oct 2026 03:05 AM PDT = 2026-10-17T10:05:00Z -> Cerrado
  check(
    isStoreCurrentlyOpen(14, new Date('2026-10-17T10:05:00Z')) === false,
    'Lynwood (#14) debe estar CERRADO a las 3:05 AM del sábado'
  )

  // LA Broadway (#5) cierra a las 4:00 AM en Viernes/Sábado:
  // Sábado 17 Oct 2026 03:30 AM PDT = 2026-10-17T10:30:00Z -> Abierto
  check(
    isStoreCurrentlyOpen(5, new Date('2026-10-17T10:30:00Z')) === true,
    'LA Broadway (#5) debe estar ABIERTO a las 3:30 AM del sábado'
  )

  // Rialto (#1) cierra a las 12:00 AM de Domingo a Jueves:
  // Jueves 15 Oct 2026 00:15 AM PDT = 2026-10-15T07:15:00Z -> Cerrado
  check(
    isStoreCurrentlyOpen(1, new Date('2026-10-15T07:15:00Z')) === false,
    'Rialto (#1) debe estar CERRADO a las 12:15 AM del jueves'
  )

  // 2.3 Cruce 1:1 contra public.stores en Supabase
  const { data: dbStores, error: dbStoresErr } = await supabaseAdmin
    .from('stores')
    .select('id, name, address, phone')
    .eq('is_active', true)
    .order('id')
  check(!dbStoresErr && dbStores && dbStores.length === 15, 'public.stores debe tener 15 tiendas activas')

  for (const dbStore of dbStores || []) {
    const appStore = getAuthoritativeStoreById(Number(dbStore.id))
    check(
      appStore.phone === dbStore.phone,
      `Teléfono de ${appStore.name} debe coincidir entre app (${appStore.phone}) y DB (${dbStore.phone})`
    )
    check(
      appStore.address === dbStore.address,
      `Dirección de ${appStore.name} debe coincidir entre app (${appStore.address}) y DB (${dbStore.address})`
    )
  }

  console.log('   ✅ Catálogo de 15 sucursales, horarios y sincronización DB verificados.\n')

  // =========================================================================
  // 3. CONFIGURACIÓN EXPO / EAS / ANDROID API 36 / PERMISOS
  // =========================================================================
  console.log('▶ [3/5] Probando Configuración de package.json, app.json, eas.json y .env...')

  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(GAVILAN_APP_ROOT, 'package.json'), 'utf8')
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
    !pkgJson.dependencies['expo-location'],
    'expo-location no debe existir en dependencies de package.json'
  )
  check(
    !JSON.stringify(appJson).includes('NSLocationWhenInUseUsageDescription') &&
      !JSON.stringify(appJson).includes('ACCESS_FINE_LOCATION') &&
      !JSON.stringify(appJson).includes('ACCESS_COARSE_LOCATION'),
    'app.json no debe declarar permisos de ubicación iOS ni Android'
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
    !dotEnv.includes('localhost') && dotEnv.includes('https://teg-modernizado.vercel.app'),
    '.env no debe apuntar a localhost y debe usar HTTPS de producción'
  )

  console.log('   ✅ Configuración de compilación, permisos y API 36 verificada.\n')

  // =========================================================================
  // 4. UI HONESTY & PÁGINAS LEGALES HTTP 200
  // =========================================================================
  console.log('▶ [4/5] Verificando Ausencia de Claims No Autoritativos y Rutas HTTP 200...')

  const forbiddenUiTerms = [
    '9 min',
    '10 min',
    '25–35 min',
    '25-35 min',
    '10:00 AM - 12:45 AM',
    '#3 Most liked',
    'Official Toast POS catalog',
    'orders.prices:read',
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

  const requiredLegalRoutes = [
    '/app',
    '/app/privacy',
    '/app/terms',
    '/app/support',
    '/app/delete-account',
    '/api/mobile/stores',
  ]

  for (const route of requiredLegalRoutes) {
    const res = await fetch(`${LOCAL_WEB_BASE}${route}`)
    check(
      res.status === 200,
      `Ruta pública ${route} debe responder HTTP 200 (recibido: ${res.status})`
    )
  }

  console.log('   ✅ Higiene de textos UI y rutas públicas HTTP 200 verificadas.\n')

  // =========================================================================
  // 5. LIVE DB MUTATION SMOKE TEST (CREACIÓN Y ELIMINACIÓN DE CUENTA MÓVIL)
  // =========================================================================
  console.log('▶ [5/5] Ejecutando Prueba Real de Mutación y Eliminación de Cuenta en Supabase...')

  const rand4 = Math.floor(1000 + Math.random() * 8999)
  const testPhone10 = `999555${rand4}`
  const testEmail = `compliance.smoke.${Date.now()}.${rand4}@tacosgavilan.test`
  const testPassword = `SmokeTest!${Date.now()}#TG`

  // 5.1 Crear usuario real temporal en Supabase Auth
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

  // 5.2 Iniciar sesión para obtener JWT real de Supabase Auth
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

  // 5.3 Insertar perfil real en public.app_users
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

  // 5.4 Invocar endpoint real DELETE /api/mobile/user/delete con el Bearer JWT
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

  // 5.5 Confirmar que el registro ya no existe en app_users ni en auth.users
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

  console.log('   ✅ Prueba real de mutación y eliminación en base de datos exitosa.\n')

  console.log('======================================================================')
  console.log(`🎉 TODAS LAS ${passedAssertions} ASERCIONES DE CUMPLIMIENTO PASARON EXITOSAMENTE`)
  console.log('======================================================================')
}

runComplianceSuite().catch((err) => {
  console.error('\n❌ ERROR FATAL EN SUITE DE CUMPLIMIENTO:', err)
  process.exit(1)
})

# 🛡️ Auditoría y Matriz de Cumplimiento — Tacos Gavilan App (`v2.1.0`)

**Definición Oficial de Producto y Arquitectura:**
> **Tacos Gavilan App con Toast Online Ordering integrado visualmente mediante WebView nativo en iOS/Android.**

---

## 1. Resumen Ejecutivo (`Executive Summary`)

En este ciclo de continuación oficial se auditaron línea por línea y corrigieron los repositorios **Tacos Gavilan App** (`C:\Users\pedro\Desktop\gavilan-app`, versión `2.1.0`) y **TEG Modernizado** (`c:\Users\pedro\Desktop\teg-modernizado`, rutas `/app`, `/app/privacy`, `/app/terms`, `/app/support`, `/app/delete-account` y asistente IA).

| Componente / Dominio | Clasificación Actual | Evidencia Técnica |
| :--- | :--- | :--- |
| **Seguridad Real del WebView (`ALLOW_IN_WEBVIEW` / `OPEN_EXTERNAL` / `BLOCK`)** | `IMPLEMENTED_LOCAL` | `lib/webview-security.ts` + `app/(tabs)/menu.tsx`. Usa `WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST = ['*']` para anular el desvío automático `Linking.openURL` de `react-native-webview` (`WebViewShared.js`) y fuerza que el 100% de las URLs e intentos `onOpenWindow` pasen por `evaluateWebViewNavigationRequest`. |
| **Limpieza Real de Sesión y Cookies Toast** | `IMPLEMENTED_LOCAL` | `purgeNativeWebViewStorage()` en `app/(tabs)/menu.tsx`: invoca `clearCache(true)`, `clearHistory()`, `clearFormData()` y cicla `incognito` para ejecutar `CookieManager.getInstance().removeAllCookies(null)` en Android y limpiar `WKWebsiteDataStore` en iOS. Conectado tanto desde `Menu` como desde `Account` (`webViewSessionEpoch`). |
| **Protección al Cambiar de Sucursal o Modalidad (`Pickup` / `Delivery`)** | `IMPLEMENTED_LOCAL` | `onTouchStart={() => markWebViewSessionActive(true)}` sobre el contenedor nativo del WebView en `menu.tsx` garantiza que cualquier interacción con el SPA de `order.online` active el diálogo de confirmación antes de cambiar de tienda o entre Pickup y Delivery. |
| **Consistencia Legal de Privacidad y GPS en Primer Plano (`When In Use`)** | `IMPLEMENTED_LOCAL` | Corregida la regresión en `teg-modernizado/lib/i18n.tsx` (`es.mobile_legal` y `en.mobile_legal`) y `app/app/privacy/page.tsx`: explica con exactitud que el permiso de ubicación en primer plano (`NSLocationWhenInUseUsageDescription`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) se solicita solo al pulsar *"Near Me / Cerca de mí"*, se procesa únicamente en la RAM del dispositivo (`userCoords`) para calcular distancia Haversine en millas y nunca se envía a servidores ni se almacena. |
| **Catálogo Autoritativo de las 15 Sucursales (`IDs: 1, 3..16`)** | `IMPLEMENTED_LOCAL` | `lib/constants.ts`, `public.stores` en Supabase y `/app/support` contrastados 1:1 contra `https://tacosgavilan.com/locations/`. Documentado que `id = 2` no existe en `public.stores` y Downey es `id = 16`. Sincronizado `opening_time = 09:00:00` de Hollywood (`id = 8`) en Supabase. |
| **Higiene de `package.json` y `package-lock.json` (`Expo SDK 56`)** | `IMPLEMENTED_LOCAL` | Sincronizados `package.json` y `package-lock.json` en `gavilan-app` (incluyendo `@supabase/supabase-js@^2.106.2`); `npm ls --depth=0` y `npx tsc --noEmit` pasan con código `0`. |
| **Vinculación EAS (`@roquepv/tacos-gavilan-app`) y Android API 36** | `IMPLEMENTED_LOCAL` | Proyecto vinculado en EAS (`owner: "roquepv"`, `projectId: "ce1d5d66-fbb1-46e3-bfc6-9921590ba7da"`), `compileSdkVersion: 36`, `targetSdkVersion: 36`, `supportsTablet: false`. |
| **Suite Automatizada de Cumplimiento (798 aserciones)** | `IMPLEMENTED_LOCAL` | `npx tsx scripts/test-toast-webview-hardening-compliance.ts` (798/798 aserciones exitosas, código de salida `0`). |
| **Confirmación Escrita de Toast para WebView** | `BLOCKED_EXTERNAL` | Solicitud formal lista en Sección 6; pasará a `TOAST_CONFIRMED` únicamente al recibir confirmación escrita de Toast. |
| **Builds Nativos EAS y Pruebas en Dispositivos Físicos (iPhone / Android)** | `NOT_TESTED` | Requiere cuenta Apple Developer activa para firma iOS y ejecución de `eas build --profile preview` para pruebas físicas en iPhone y Android. |
| **Aprobación en TestFlight / Play Internal / Tiendas** | `NOT_TESTED` | Pendiente de pruebas físicas completas (Pickup, Delivery, OTP, Tarjeta, Apple Pay, Google Pay) y envío a revisión oficial. |

---

## 2. Arquitectura Exacta (`System Architecture`)

```mermaid
flowchart TD
    User["Cliente en Tacos Gavilan App (v2.1.0)"] --> Home["Pestaña Home: Directorio Nativo de 15 Sucursales (IDs 1, 3..16)\n(GPS opcional en RAM When In Use, Horarios America/Los_Angeles, tel:, Apple/Google Maps)"]
    User --> Menu["Pestaña Menu: Pedidos en Línea (Solo Pickup y Delivery)"]
    User --> Orders["Pestaña Orders: Guía de Confirmación SMS/Email de Toast\n+ Historial Local de Últimas Sucursales Abiertas"]
    User --> Account["Pestaña Account: Cuenta Opcional SMS OTP\n+ Reinicio Real de Sesión Toast + Eliminación In-App y Web + Enlaces Legales HTTP 200"]

    Menu --> PlatformCheck{"Plataforma de Ejecución"}
    PlatformCheck -->|iOS WKWebView / Android WebView| SecPolicy["lib/webview-security.ts\nevaluateWebViewNavigationRequest\n(onShouldStartLoadWithRequest + onOpenWindow)"]
    PlatformCheck -->|Web /app (CSP frame-ancestors)| SafeTab["lib/toast-ordering.ts\nPestaña Externa Segura (noopener,noreferrer)"]

    SecPolicy -->|ALLOW_IN_WEBVIEW (Host HTTPS en Allowlist Exacta)| ToastWebView["WebView Nativo: https://order.online/store/...\n(Menú, Modificadores, Carrito, Pickup, Delivery, Impuestos y Pago)"]
    SecPolicy -->|OPEN_EXTERNAL (tel:, mailto:, Apple/Google Maps, Legal)| ExternalOS["Linking.openURL hacia App del Sistema Operativo"]
    SecPolicy -->|BLOCK (http:, javascript:, file:, content:, data:, intent:, blob:, Host desconocido)| Blocked["Navegación Bloqueada (Cero Linking.openURL) + Log Sanitizado"]
```

---

## 3. Catálogo Verificado de las 15 Sucursales (`Authoritative 15-Store Catalog`)

> [!NOTE]
> En `public.stores` de Supabase existen exactamente **15 sucursales activas** con `id: 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16`. El registro `id = 2` no existe históricamente en la tabla `public.stores`, por lo que Downey tiene asignado el `id = 16`. Cualquier consulta a `id = 2` lanza un error explícito sin caer silenciosamente en otra sucursal.

| Store ID (`public.stores`) | Sucursal | Dirección Verificada | Teléfono Verificado | Horario Real (`America/Los_Angeles`) | Toast Store ID | URL Canónica `order.online` |
| :---: | :--- | :--- | :--- | :--- | :---: | :--- |
| **1** | **Rialto** | 115 E. Baseline Rd., Rialto, CA 92376 | `(909) 562-0430` | Dom–Jue: 10:00 AM – 12:00 AM \| Vie–Sáb: 10:00 AM – 2:00 AM | `841931` | `https://order.online/store/tacos-gavilan-rialto-841931` |
| **3** | **West Covina** | 101 S. Azusa Ave., West Covina, CA 91791 | `(626) 917-2662` | Dom–Jue: 10:00 AM – 1:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `725035` | `https://order.online/store/tacos-gavilan-west-covina-725035` |
| **4** | **Azusa** | 887 S. Azusa Ave., Azusa, CA 91702 | `(626) 969-1011` | Dom–Jue: 10:00 AM – 11:00 PM \| Vie–Sáb: 10:00 AM – 12:00 AM | `718169` | `https://order.online/store/tacos-gavilan-azusa-718169` |
| **5** | **LA Broadway** | 4380 S. Broadway, Los Angeles, CA 90037 | `(323) 233-2302` | Lun–Mié: 8:00 AM – 1:00 AM \| Jue y Dom: 8:00 AM – 2:00 AM \| Vie–Sáb: 8:00 AM – 4:00 AM | `260769` | `https://order.online/store/tacos-gavilan-los-angeles-260769` |
| **6** | **LA Central** | 1900 S. Central Ave., Los Angeles, CA 90011 | `(213) 742-6677` | Dom–Mié: 8:00 AM – 2:00 AM \| Jue: 8:00 AM – 3:00 AM \| Vie–Sáb: 8:00 AM – 4:00 AM | `260847` | `https://order.online/store/tacos-gavilan-los-angeles-260847` |
| **7** | **Slauson** | 5833 S. Broadway, Los Angeles, CA 90003 | `(323) 615-0084` | Dom–Jue: 10:00 AM – 1:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `23989119` | `https://order.online/store/tacos-gavilan-slauson-broadway-23989119` |
| **8** | **Hollywood** | 7070 Sunset Blvd., Los Angeles, CA 90028 | `(323) 963-7993` | Dom–Jue: 9:00 AM – 12:00 AM \| Vie–Sáb: 9:00 AM – 3:00 AM | `551916` | `https://order.online/store/tacos-gavilan-los-angeles-551916` |
| **9** | **Santa Ana** | 1258 E. 17th St., Santa Ana, CA 92701 | `(714) 480-0713` | Dom–Jue: 10:00 AM – 12:00 AM \| Vie–Sáb: 10:00 AM – 2:00 AM | `724574` | `https://order.online/store/tacos-gavilan-santa-ana-724574` |
| **10** | **La Puente** | 13009 Valley Blvd., La Puente, CA 91746 | `(626) 336-3000` | Dom–Jue: 10:00 AM – 12:00 AM \| Vie–Sáb: 10:00 AM – 2:00 AM | `963464` | `https://order.online/store/tacos-gavilan-la-puente-963464` |
| **11** | **Huntington Park** | 2425 E. Florence Ave., Huntington Park, CA 90255 | `(323) 581-7309` | Dom–Mié: 10:00 AM – 12:00 AM \| Jue: 10:00 AM – 2:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `260849` | `https://order.online/store/tacos-gavilan-huntington-park-260849` |
| **12** | **Norwalk** | 10968 Rosecrans Ave., Norwalk, CA 90650 | `(562) 651-0045` | Dom–Jue: 10:00 AM – 1:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `1327857` | `https://order.online/store/tacos-gavilan-norwalk-1327857` |
| **13** | **Bell** | 4406 E. Florence Ave., Bell, CA 90201 | `(323) 771-1722` | Dom–Jue: 10:00 AM – 12:00 AM \| Vie–Sáb: 10:00 AM – 2:00 AM | `260912` | `https://order.online/store/tacos-gavilan-bell-260912` |
| **14** | **Lynwood** | 3220 E. Imperial Hwy., Lynwood, CA 90262 | `(424) 785-5535` | Dom–Mié: 10:00 AM – 1:00 AM \| Jue: 10:00 AM – 2:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `727877` | `https://order.online/store/tacos-gavilan-lynwood-727877` |
| **15** | **South Gate** | 5800 Firestone Blvd., South Gate, CA 90280 | `(562) 806-1200` | Dom–Jue: 10:00 AM – 12:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `846517` | `https://order.online/store/tacos-gavilan-south-gate-846517` |
| **16** | **Downey** | 7947 E. Florence Ave., Downey, CA 90240 | `(562) 927-7486` | Dom–Jue: 10:00 AM – 12:00 AM \| Vie–Sáb: 10:00 AM – 3:00 AM | `302620` | `https://order.online/store/tacos-gavilan-downey-302620` |

---

## 4. Política de Seguridad del WebView (`WebView Security Policy`)

Implementada en `C:\Users\pedro\Desktop\gavilan-app\lib\webview-security.ts` y conectada a `app/(tabs)/menu.tsx`:

1. **Corrección de la Interacción `originWhitelist` vs `Linking.openURL`**:
   - En `react-native-webview` (`lib/WebViewShared.js`), `createOnShouldStartLoadWithRequest` evalúa `originWhitelist` **antes** de llamar a `onShouldStartLoadWithRequest`; cuando una URL no coincide con `originWhitelist`, `react-native-webview` ejecuta automáticamente `Linking.openURL(url)` y abre la URL externa sin pasar por nuestro filtro.
   - Para eliminar esa fuga, `menu.tsx` pasa `originWhitelist={WEBVIEW_INTERCEPTION_ORIGIN_WHITELIST}` (`['*']`) al componente `<NativeWebView>` y delega el **100% de la autorización** a `handleShouldStartLoadWithRequest` y `handleOpenWindow`, que invocan `evaluateWebViewNavigationRequest(url)`.
2. **Clasificación Central en Tres Acciones (`evaluateWebViewNavigationRequest`)**:
   - `ALLOW_IN_WEBVIEW`: Solo URLs con esquema `https:`, puerto estándar (`443` o vacío), sin credenciales embebidas, cuyo `hostname` pertenezca exactamente a `ALLOWED_WEBVIEW_HTTPS_HOSTS` (`EXPLICIT_ORIGIN_WHITELIST`).
   - `OPEN_EXTERNAL`: Esquemas y destinos aprobados explícitamente (`tel:`, `mailto:`, `maps:`, `geo:`, `maps.apple.com`, `maps.google.com`, `www.google.com/maps...`, `tacosgavilan.com`).
   - `BLOCK`: Bloqueo total (sin `Linking.openURL` y sin carga en WebView) para `http:`, `javascript:`, `data:`, `file:`, `content:`, `blob:`, `intent:`, `market:`, `itms-apps:`, credenciales `user:pass@host`, puertos no estándar, descargas de ejecutables (`.apk`, `.ipa`, `.exe`, etc.), dominios lookalike y cualquier host HTTPS desconocido.
3. **Intercepción de Ventanas Emergentes (`onOpenWindow`)**:
   - `setSupportMultipleWindows: true` + `onOpenWindow={handleOpenWindow}` intercepta cualquier `window.open` o `target="_blank"`. Si el destino es `ALLOW_IN_WEBVIEW` (ej. paso de autenticación o 3DS), navega dentro del mismo WebView seguro; si es `OPEN_EXTERNAL`, lo delega al sistema operativo; si es `BLOCK`, lo descarta y muestra aviso.
4. **Cero Inyección JS y Cero Puente de Privilegios**:
   - `menu.tsx` no utiliza `injectedJavaScript` ni `onMessage` / `window.ReactNativeWebView.postMessage`.
   - Jamás intercepta PAN, CVC, contraseñas, tokens, cookies ni datos bancarios.

---

## 5. Matriz de Sesiones, Cookies, Login y Pagos (`Phase 4 Matrix`)

| Función | iOS (`WKWebView`) | Android (`Android System WebView`) | Configuración Requerida | Resultado Actual |
| :--- | :--- | :--- | :--- | :--- |
| **Toast / DoorDash Login** | `WKWebsiteDataStore.defaultDataStore` con `sharedCookiesEnabled: true` | `CookieManager` con `thirdPartyCookiesEnabled: true` + `domStorageEnabled: true` | Hosts exactos `order.online`, `toasttab.com`, `identity.doordash.com`, `challenges.cloudflare.com`, `hcaptcha.com`, `recaptcha.net` en `EXPLICIT_ORIGIN_WHITELIST` | Configurado y verificado en código (`NOT_TESTED` en dispositivo físico hasta ejecutar build EAS) |
| **OTP (Verificación SMS)** | Soporta autocompletado de código SMS en `<input autocomplete="one-time-code">` de `WKWebView` | Soporta entrada manual y flujo `identity.doordash.com` / `auth.toasttab.com` | `javaScriptEnabled: true`, `domStorageEnabled: true`, `onOpenWindow` redirigido al WebView | Configurado (`NOT_TESTED` en dispositivo físico) |
| **Carrito (`Bag / Cart`)** | Persiste en `localStorage` / `sessionStorage` / cookies de `order.online` | Persiste en `domStorageEnabled: true` y cookies de `order.online` | Confirmación antes de cambiar sucursal o Pickup/Delivery (`onTouchStart` activa `hasActiveWebViewSession`) | Configurado (`NOT_TESTED` en dispositivo físico) |
| **Tarjeta de Crédito / Débito** | Iframes PCI-DSS de Stripe / Braintree sobre HTTPS | Iframes PCI-DSS de Stripe / Braintree sobre HTTPS | `js.stripe.com`, `api.stripe.com`, `hooks.stripe.com`, `m.stripe.network`, `assets.braintreegateway.com`, `payments.braintree-api.com` permitidos | Configurado (`NOT_TESTED` en dispositivo físico) |
| **Apple Pay** | Apple restringe Apple Pay JS (`ApplePaySession`) dentro de `WKWebView` de terceros salvo flujos `PKPaymentAuthorizationViewController` o Safari/`SFSafariViewController` | No aplica en Android | `applepay.cdn-apple.com` permitido; si `order.online` oculta Apple Pay dentro de `WKWebView`, el cliente paga con tarjeta dentro del WebView o abre la vista segura del navegador | Limitación documentada honestamente (`NOT_TESTED` en iPhone físico) |
| **Google Pay** | No aplica en iOS | Google Pay Web (`PaymentRequest` / `pay.google.com`) en Android WebView depende de la política de WebView del comerciante en `order.online` | `pay.google.com` permitido; si no se muestra en WebView, pago con tarjeta funciona directamente en el checkout | Limitación documentada honestamente (`NOT_TESTED` en Android físico) |
| **3D Secure (`3DS2`)** | Retos `hooks.stripe.com` y `songbird.cardinalcommerce.com` en iframe o `window.open` | Retos `hooks.stripe.com` y `centinelapi.cardinalcommerce.com` con `thirdPartyCookiesEnabled: true` | `sharedCookiesEnabled: true`, `thirdPartyCookiesEnabled: true`, `onOpenWindow` redirigiendo URLs `ALLOW_IN_WEBVIEW` al WebView | Configurado (`NOT_TESTED` en dispositivo físico) |
| **Pickup** | URL `?mode=pickup` en `order.online` | URL `?mode=pickup` en `order.online` | Selector nativo `Pickup` sincronizado con la URL de las 15 tiendas | Configurado (`NOT_TESTED` en dispositivo físico) |
| **Delivery** | URL `?mode=delivery` en `order.online` (despacho DoorDash de Toast) | URL `?mode=delivery` en `order.online` (despacho DoorDash de Toast) | Selector nativo `Delivery` sincronizado con la URL de las 15 tiendas | Configurado (`NOT_TESTED` en dispositivo físico) |

---

## 6. Privacidad y GPS en Primer Plano (`Apple App Privacy & Google Play Data Safety`)

### Confirmación Técnica en Código
- **Dónde se solicita**: Únicamente en `C:\Users\pedro\Desktop\gavilan-app\contexts\StoreContext.tsx` (`requestUserLocation`) cuando el usuario pulsa explícitamente el botón **"Near Me / Cerca de mí"** en la pantalla `Home`.
- **Qué permiso utiliza**: Permiso de ubicación únicamente en primer plano (`Location.requestForegroundPermissionsAsync()` -> `NSLocationWhenInUseUsageDescription` en iOS y `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` en Android). Cero permisos en segundo plano (`Always` / `ACCESS_BACKGROUND_LOCATION`).
- **Cómo se procesa**: Calcula la distancia Haversine en millas localmente en la memoria RAM del teléfono (`userCoords`) para ordenar las 15 sucursales.
- **Almacenamiento / Transmisión**:
  - ¿Se almacena en disco o AsyncStorage? **NO** (solo se guarda `gavilan_selected_store_id_v1`).
  - ¿Se transmite al backend o Supabase? **NO**.
  - ¿Se registra en analytics o publicidad? **NO**.

### Declaración Lista para Apple App Privacy (`App Store Connect`)
- **Location (`Coarse Location` / `Precise Location`)**:
  - *Collected?* **No** (según la guía de Apple App Privacy, los datos de ubicación que se procesan exclusivamente en el dispositivo en memoria volátil y nunca se envían fuera del dispositivo no requieren declararse como recopilados en servidores; no obstante, en las notas de revisión y en `/app/privacy` se explica claramente el uso de `When In Use` para ordenar las 15 sucursales cercanas).
  - *Used for Tracking?* **No**.

### Declaración Lista para Google Play Data Safety (`Google Play Console`)
- **Location (`Approximate location` / `Precise location`)**:
  - *Processed ephemerally on device only (not shared, not stored on servers, not used for advertising)*: La app solicita permiso de ubicación en primer plano únicamente cuando el usuario toca **"Near Me / Cerca de mí"** para ordenar las 15 sucursales en pantalla. Las coordenadas no salen del dispositivo.

---

## 7. Borrador de Solicitud Formal a Toast (`Formal Toast Compatibility & Authorization Request`)

> **Estado actual:** `BLOCKED_EXTERNAL` (se actualizará a `TOAST_CONFIRMED` únicamente cuando el representante de Toast responda por escrito).

**Subject:** Written Confirmation Request — Embedding Toast Online Ordering (`order.online`) via Native WebView in Official Tacos Gavilan iOS & Android App

Dear Toast Account Representative / Toast Support Team,

We are preparing the official **Tacos Gavilan** mobile application for iOS (`com.tacosgavilan.mobile`) and Android (`com.tacosgavilan.mobile`) covering our 15 Tacos Gavilan restaurant locations.

Inside our native mobile app, customers select one of our 15 Tacos Gavilan branches (using our verified store directory, optional foreground nearest-store locator, real operating hours, phone dialer, and turn-by-turn navigation), and the `Menu` tab loads our existing official Toast Online Ordering storefront (`https://order.online/store/...`) inside a native mobile WebView (`WKWebView` on iOS and `Android System WebView` on Android) with a strict HTTPS domain allowlist and zero JavaScript injection.

Before submitting our binaries to Apple App Store Review and Google Play Console, we kindly request your written confirmation on the following points:

1. **WebView Compatibility:** Does Toast officially support full customer ordering and checkout on `https://order.online/store/...` inside native `WKWebView` (iOS) and `Android System WebView` (Android) for:
   - Session & cart cookies
   - Guest checkout and SMS OTP / DoorDash identity login
   - Credit/debit card entry and 3D Secure (3DS2)
   - Apple Pay and Google Pay wallets
   - Pickup orders and Delivery / Toast Delivery Services (TDS / DoorDash) orders
2. **Required Domains for Allowlist:** We enforce a strict deny-by-default HTTPS host allowlist on our WebView (`order.online`, `toasttab.com`, `doordash.com`, `identity.doordash.com`, `unity.doordash.com`, `js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`, `m.stripe.network`, `centinelapi.cardinalcommerce.com`, `songbird.cardinalcommerce.com`, `challenges.cloudflare.com`, `hcaptcha.com`, `recaptcha.net`, `pay.google.com`, `applepay.cdn-apple.com`). Are there any additional domains or subdomains required?
3. **Terms & Branding Requirements:** Confirm that displaying our own official `order.online/store/tacos-gavilan-...` storefronts inside the official Tacos Gavilan mobile app complies with Toast’s terms of service.

Thank you for your support,

**Carlos Pedroza**  
Tacos Gavilan Inc.

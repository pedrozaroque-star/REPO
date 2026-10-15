# 🛡️ Auditoría y Matriz de Cumplimiento — Tacos Gavilan App (`v2.1.0`)

**Definición Oficial de Producto y Arquitectura:**
> **Tacos Gavilan App con Toast Online Ordering integrado visualmente mediante WebView nativo en iOS/Android.**

---

## 1. Resumen Ejecutivo (`Executive Summary`)

En este ciclo se endureció y verificó la aplicación descargable propia **Tacos Gavilan App** (`C:\Users\pedro\Desktop\gavilan-app`, versión `2.1.0`) y sus páginas públicas legales/soporte en `c:\Users\pedro\Desktop\teg-modernizado` (`/app`, `/app/privacy`, `/app/terms`, `/app/support`, `/app/delete-account`).

| Componente / Dominio | Clasificación Actual | Evidencia Técnica |
| :--- | :--- | :--- |
| **WebView Nativo Endurecido (iOS/Android)** | `IMPLEMENTED_LOCAL` | `app/(tabs)/menu.tsx` + `lib/webview-security.ts` (`onShouldStartLoadWithRequest`, deny-by-default, sin `injectedJavaScript` ni `onMessage`). |
| **Lanzador Web Seguro (`/app`)** | `IMPLEMENTED_LOCAL` | `lib/toast-ordering.ts` (`noopener,noreferrer`, `opener = null`), explicación honesta de bloqueo CSP `frame-ancestors`. |
| **Catálogo Autoritativo de 15 Sucursales** | `IMPLEMENTED_LOCAL` | `lib/constants.ts` + `public.stores` en Supabase contrastados 1:1 contra `https://tacosgavilan.com/locations/`. Cero fallback silencioso. |
| **Horarios Reales por Tienda y Día (`America/Los_Angeles`)** | `IMPLEMENTED_LOCAL` | `evaluateStoreSchedule` / `isStoreCurrentlyOpen` / `getStoreOpenStatus` con soporte de cierres de madrugada (12:00 AM – 4:00 AM). |
| **Eliminación de Permisos Innecesarios (`expo-location`)** | `IMPLEMENTED_LOCAL` | Removidos `expo-location`, `NSLocationWhenInUseUsageDescription`, `ACCESS_FINE_LOCATION` y `ACCESS_COARSE_LOCATION`. |
| **Configuración Android API 36 & EAS** | `IMPLEMENTED_LOCAL` | `compileSdkVersion: 36`, `targetSdkVersion: 36`, `supportsTablet: false`, `version: "2.1.0"`, HTTPS de producción en `.env` y `eas.json`. |
| **Páginas Legales y Eliminación de Cuenta (`HTTP 200`)** | `IMPLEMENTED_LOCAL` | `/app/privacy`, `/app/terms`, `/app/support`, `/app/delete-account` + `DELETE /api/mobile/user/delete` probado contra Supabase. |
| **Suite Automatizada de Cumplimiento (395 aserciones)** | `IMPLEMENTED_LOCAL` | `npx tsx scripts/test-toast-webview-hardening-compliance.ts` (395/395 aserciones exitosas, código de salida `0`). |
| **Confirmación Escrita de Toast para WebView** | `BLOCKED_EXTERNAL` | Solicitud formal redactada en Sección 6; se clasificará como `TOAST_CONFIRMED` únicamente al recibir respuesta escrita de Toast. |
| **Pruebas en Dispositivos Físicos (iPhone / Android)** | `NOT_TESTED` | Requiere vincular `owner`/`projectId` de EAS y ejecutar `eas build --profile preview` para instalar en iPhone y Android físicos. |
| **Aprobación en TestFlight / Play Internal / Tiendas** | `NOT_TESTED` | Pendiente de pruebas físicas y envío a revisión oficial de Apple App Store y Google Play Console. |

---

## 2. Arquitectura Exacta (`System Architecture`)

```mermaid
flowchart TD
    User["Cliente en Tacos Gavilan App (v2.1.0)"] --> Home["Pestaña Home: Directorio Nativo de 15 Sucursales\n(Horarios reales America/Los_Angeles, Llamada directa, Mapas)"]
    User --> Menu["Pestaña Menu: Pedidos en Línea"]
    User --> Orders["Pestaña Orders: Guía de Confirmación SMS/Email de Toast\n+ Historial Local de Últimas Sucursales Abiertas"]
    User --> Account["Pestaña Account: Cuenta Opcional SMS OTP\n+ Eliminación In-App y Web + Enlaces Legales HTTP 200"]

    Menu --> PlatformCheck{"Plataforma de Ejecución"}
    PlatformCheck -->|iOS WKWebView / Android WebView| SecPolicy["lib/webview-security.ts\nevaluateWebViewNavigationRequest (Deny-by-Default)"]
    PlatformCheck -->|Web /app (CSP frame-ancestors)| SafeTab["lib/toast-ordering.ts\nPestaña Externa Segura (noopener,noreferrer)"]

    SecPolicy -->|HTTPS Host en Allowlist| ToastWebView["WebView Nativo: https://order.online/store/...\n(Menú, Modificadores, Carrito, Pickup, Delivery, Impuestos y Pago)"]
    SecPolicy -->|tel: / mailto: / Apple & Google Maps| ExternalOS["Linking.openURL hacia App del Sistema Operativo"]
    SecPolicy -->|http: / javascript: / file: / data: / intent: / Host desconocido| Blocked["Navegación Bloqueada + Log Sanitizado (Solo esquema + hostname)"]
```

---

## 3. Estado Git de Ambos Repositorios (`Git Preservation & Status`)

De conformidad con la Fase 0, **no se realizó ningún commit, push, configuración de remoto ni despliegue**:

1. **Repositorio Móvil (`C:\Users\pedro\Desktop\gavilan-app`)**:
   - **Branch**: `master`
   - **HEAD actual**: `347de8a` (`feat(toast-webview): ocultar catalogo nativo y envolver Toast Online dentro del tab Menu`)
   - **Remote configurado**: Ninguno (`git remote -v` vacío; commits únicamente locales).
   - **Archivos endurecidos en árbol de trabajo**:
     - `lib/constants.ts`, `lib/toast-ordering.ts`, `lib/webview-security.ts`, `lib/i18n.tsx`, `lib/api.ts`, `lib/types.ts`
     - `contexts/StoreContext.tsx`, `components/StoreSelectorModal.tsx`, `components/IntegrationStatusModal.tsx`
     - `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/menu.tsx`, `app/(tabs)/tracker.tsx`, `app/(tabs)/account.tsx`
     - `package.json`, `app.json`, `eas.json`, `.env`

2. **Repositorio Web y Backend (`c:\Users\pedro\Desktop\teg-modernizado`)**:
   - **Branch**: `main` (tracking `origin/main`)
   - **HEAD actual**: `177001d` (`feat(app-clientes): actualizar bundle web con Toast Online directo en tab Menu`)
   - **Archivos creados/actualizados en este ciclo**:
     - `components/mobile-legal/MobileLegalShell.tsx`
     - `app/app/privacy/page.tsx`
     - `app/app/terms/page.tsx`
     - `app/app/support/page.tsx`
     - `app/app/delete-account/page.tsx`
     - `app/app/page.tsx`, `middleware.ts`, `app/api/mobile/stores/route.ts`, `lib/i18n.tsx`
     - `app/api/support-chat/route.ts`, `lib/chat-tools.ts`
     - `public/app/*` (bundle web exportado desde `gavilan-app`)
     - `scripts/test-toast-webview-hardening-compliance.ts`
   - **Cambios ajenos preservados intactos**: Todos los archivos previos de otros módulos (`empaque/page.tsx`, `publish/route.ts`, `announcement-tts/route.ts`, `contabilidad/[packetId]/page.tsx`, `lib/order-ready-tts.ts`, `scripts/test-delivery-armor-core.ts`) se mantuvieron intactos.

---

## 4. Catálogo Verificado de las 15 Sucursales (`Authoritative 15-Store Catalog`)

Contrastado 1:1 entre `C:\Users\pedro\Desktop\gavilan-app\lib\constants.ts`, `public.stores` en Supabase (`/api/mobile/stores`), `/app/support` y `https://tacosgavilan.com/locations/`:

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

## 5. Política de Seguridad del WebView (`WebView Security Policy`)

Implementada en `C:\Users\pedro\Desktop\gavilan-app\lib\webview-security.ts` y conectada a `app/(tabs)/menu.tsx`:

1. **Deny-by-Default (`evaluateWebViewNavigationRequest`)**:
   - Solo permite navegar dentro del WebView a URLs con esquema `https:` cuyo `hostname` pertenezca exactamente a `EXACT_ALLOWED_HTTPS_HOSTS`:
     - `order.online`, `www.order.online`
     - `toasttab.com`, `www.toasttab.com`, `order.toasttab.com`, `pos.toasttab.com`, `ws.toasttab.com`, `api.toasttab.com`, `cdn.toasttab.com`
     - `doordash.com`, `www.doordash.com`, `identity.doordash.com`, `unity.doordash.com`
     - `js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`, `m.stripe.network`, `challenges.cloudflare.com`, `pay.google.com`, `applepay.cdn-apple.com`
2. **Esquemas y Vectores Bloqueados (`BLOCK`)**:
   - `http:` (`BLOCKED_INSECURE_HTTP`)
   - `javascript:`, `data:`, `file:`, `intent:`, `blob:`, `about:`, `vbscript:`, `chrome:`, `content:`, `ftp:`, `ws:`, `wss:` (`BLOCKED_DANGEROUS_SCHEME`)
   - Credenciales embebidas en URL `https://user:pass@host` (`BLOCKED_EMBEDDED_CREDENTIALS`)
   - Descargas arbitrarias `.apk`, `.ipa`, `.exe`, `.dmg`, `.pkg`, `.msi`, `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.sh`, `.bat`, `.ps1`, `.jar` (`BLOCKED_ARBITRARY_DOWNLOAD`)
   - Cualquier dominio o subdominio no listado (`BLOCKED_UNKNOWN_HOST`)
3. **Delegación Explícita al Sistema Operativo (`OPEN_EXTERNAL_SYSTEM`)**:
   - `tel:` (validado por expresión regular y sanitizado a dígitos/+).
   - `mailto:` (validado por expresión regular).
   - `maps:`, `geo:`, `https://maps.apple.com/...`, `https://maps.google.com/...`, `https://www.google.com/maps/...`.
4. **Cero Inyección JS y Cero Puente de Privilegios**:
   - `menu.tsx` no utiliza `injectedJavaScript` ni `onMessage` / `window.ReactNativeWebView.postMessage`.
   - No lee formularios, tarjetas, contraseñas, cookies ni DOM del checkout.
5. **Privacidad de Cookies y Registro Sanitizado**:
   - `WEBVIEW_SECURITY_CONFIG` inicia con `sharedCookiesEnabled: false`, `thirdPartyCookiesEnabled: false`, `allowFileAccess: false`, `mixedContentMode: 'never'`.
   - El botón **Reiniciar (`Reset`)** en la barra superior de `Menu` limpia caché/sesión e incrementa `webViewSessionEpoch` para remontar el `WebView` desde cero.
   - `recordSanitizedWebViewHostEvent` guarda exclusivamente `{ timestamp, action, reason, scheme, hostname }` (nunca rutas, query strings, tokens ni PII).

---

## 6. Borrador de Solicitud Formal a Toast (`Formal Toast Compatibility & Authorization Request`)

> **Estado actual:** `BLOCKED_EXTERNAL` (se actualizará a `TOAST_CONFIRMED` únicamente cuando el representante de Toast responda por escrito).

### Versión en Inglés (Para enviar al Account Executive / Partner Support de Toast)

**Subject:** Written Confirmation Request — Embedding Toast Online Ordering (`order.online`) via Native WebView in Official Tacos Gavilan iOS & Android App

Dear Toast Account Representative / Toast Support Team,

We are preparing the official **Tacos Gavilan** mobile application for iOS (`com.tacosgavilan.mobile`) and Android (`com.tacosgavilan.mobile`) covering our 15 Tacos Gavilan restaurant locations.

Inside our native mobile app, customers select one of our 15 Tacos Gavilan branches (using our verified store directory, real operating hours, and support features), and the `Menu` tab loads our existing official Toast Online Ordering storefront (`https://order.online/store/...`) inside a native mobile WebView (`WKWebView` on iOS and `Android System WebView` on Android) with a strict HTTPS domain allowlist and zero JavaScript injection.

Before submitting our binaries to Apple App Store Review and Google Play Console, we kindly request your written confirmation on the following points:

1. **WebView Compatibility:** Does Toast officially support full customer ordering and checkout on `https://order.online/store/...` inside native `WKWebView` (iOS) and `Android System WebView` (Android) for:
   - First-party session & cart cookies
   - Guest checkout and SMS OTP / DoorDash identity login
   - Credit/debit card entry
   - Apple Pay and Google Pay wallets
   - Pickup orders
   - Delivery / Toast Delivery Services (TDS / DoorDash) orders
2. **Required Domains for Allowlist:** We enforce a strict deny-by-default HTTPS host allowlist on our WebView (`order.online`, `toasttab.com`, `doordash.com`, `identity.doordash.com`, `unity.doordash.com`, `js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`, `m.stripe.network`, `challenges.cloudflare.com`, `pay.google.com`, `applepay.cdn-apple.com`). Are there any additional domains or subdomains required for authentication, fraud prevention (3DS), or payment processing?
3. **Terms & Branding Requirements:** Confirm that displaying our own official `order.online/store/tacos-gavilan-...` storefronts inside the official Tacos Gavilan mobile app complies with Toast’s terms of service, and let us know if any specific Toast/DoorDash attribution badge is required in the native header.

Thank you for your support,

**Carlos Pedroza**  
Tacos Gavilan Inc.

---

### Versión en Español (Referencia Interna para Dirección)

**Asunto:** Solicitud de Confirmación Escrita — Uso de Toast Online Ordering (`order.online`) en WebView Nativo dentro de Tacos Gavilan App (iOS y Android)

Estimado representante de cuenta de Toast:

Estamos preparando el lanzamiento de la aplicación móvil oficial de **Tacos Gavilan** para iOS y Android (`com.tacosgavilan.mobile`) para nuestras 15 sucursales. Dentro de la app, el cliente selecciona su sucursal y la pestaña `Menu` muestra nuestro portal oficial `https://order.online/store/...` mediante un WebView nativo (`WKWebView` en iOS y `Android System WebView` en Android) sin inyección de scripts y con lista blanca estricta de dominios HTTPS.

Solicitamos su confirmación por escrito sobre:
1. Compatibilidad completa de `order.online` dentro de `WKWebView` y `Android System WebView` para sesiones/cookies, login OTP, pago con tarjeta, Apple Pay, Google Pay, Pickup y Delivery (TDS/DoorDash).
2. Lista completa de dominios y subdominios que intervienen en autenticación, antifraude y pasarela de pago para mantener nuestra allowlist exacta.
3. Confirmación de que no existe restricción contractual para mostrar nuestras propias tiendas de `order.online` dentro de la app oficial de Tacos Gavilan o si se requiere alguna atribución visual específica.

---

## 7. Matriz de Pruebas en Dispositivos Físicos (`Physical Device Test Matrix`)

> **Estado actual:** `NOT_TESTED` en hardware físico (`DEVICE_TESTED_IOS` y `DEVICE_TESTED_ANDROID` se marcarán al ejecutar esta matriz sobre el binario EAS instalado en iPhone y Android reales).

| # | Caso de Prueba (iPhone Físico iOS + Teléfono Físico Android) | Resultado Esperado | Estado iOS | Estado Android |
| :---: | :--- | :--- | :---: | :---: |
| **1** | Abrir cada una de las **15 sucursales** desde el selector en la pestaña `Menu` | Carga la URL exacta `https://order.online/store/...` de esa sucursal sin cruzar tiendas. | `NOT_TESTED` | `NOT_TESTED` |
| **2** | Navegar categorías, abrir un platillo y seleccionar modificadores obligatorios/opcionales | Modificadores y precios se actualizan dentro del WebView sin recorte de barra inferior. | `NOT_TESTED` | `NOT_TESTED` |
| **3** | Agregar ítems al carrito de `order.online` y verificar persistencia al navegar dentro de la tienda | El carrito de Toast conserva los productos seleccionados. | `NOT_TESTED` | `NOT_TESTED` |
| **4** | Intentar cambiar de sucursal con sesión activa en el WebView | Muestra alerta de confirmación advirtiendo que cambiar de sucursal reinicia la sesión de pedido. | `NOT_TESTED` | `NOT_TESTED` |
| **5** | Seleccionar modalidad **Pickup** y llegar a la pantalla de checkout | Muestra dirección de la sucursal seleccionada, impuestos reales y total de Toast. | `NOT_TESTED` | `NOT_TESTED` |
| **6** | Seleccionar modalidad **Delivery** e ingresar dirección de entrega | Calcula cobertura, tarifa de entrega e impuestos reales en `order.online`. | `NOT_TESTED` | `NOT_TESTED` |
| **7** | Iniciar sesión / verificación OTP de cliente dentro de `order.online` | Recibe SMS OTP y completa autenticación sin bloquearse por la allowlist. | `NOT_TESTED` | `NOT_TESTED` |
| **8** | Pago con tarjeta de crédito/débito en checkout | Campos de tarjeta (Stripe/Toast) cargan y procesan correctamente sobre HTTPS. | `NOT_TESTED` | `NOT_TESTED` |
| **9** | Pago con **Apple Pay** (iOS) y **Google Pay** (Android) | Verificar si `order.online` habilita el botón de wallet dentro de `WKWebView` / `Android WebView`. | `NOT_TESTED` | `NOT_TESTED` |
| **10** | Controles nativos: **Atrás**, **Inicio**, **Recargar** y **Reiniciar** | Funcionan inmediatamente; **Reiniciar** limpia sesión/caché del WebView. | `NOT_TESTED` | `NOT_TESTED` |
| **11** | Enlaces externos: tocar teléfono (`tel:`) o Cómo llegar (`Maps`) en `Home` o `Menu` | Abre el marcador telefónico o Apple/Google Maps del sistema operativo. | `NOT_TESTED` | `NOT_TESTED` |
| **12** | Pérdida de red (Modo Avión) y botón **Reintentar** | Muestra pantalla segura de error de conexión con botón **Reintentar** y opción secundaria de recuperación externa. | `NOT_TESTED` | `NOT_TESTED` |
| **13** | Eliminación de cuenta in-app (`Account` -> `Delete My Account Permanently`) | Elimina el usuario en Supabase Auth + `public.app_users` y cierra sesión inmediatamente. | `NOT_TESTED` | `NOT_TESTED` |

---

## 8. Matriz de Cumplimiento Apple App Store (`Apple App Review Matrix`)

| Regla / Requisito Apple | Implementación en Tacos Gavilan App (`v2.1.0`) | Clasificación |
| :--- | :--- | :---: |
| **Guideline 2.1 — App Completeness** | Cero botones muertos, cero precios/impuestos simulados, cero órdenes falsas. Catálogo de 15 tiendas y páginas legales operativas. Pendiente prueba en iPhone físico y envío a TestFlight. | `IMPLEMENTED_LOCAL` |
| **Guideline 2.3 — Accurate Metadata** | Descripción y textos bilingües (EN/ES) honestos: no promete tracking GPS nativo ni recompensas inactivas; configurada solo para iPhone (`supportsTablet: false`). | `IMPLEMENTED_LOCAL` |
| **Guideline 2.5.5 — IPv6 Networking** | Todas las llamadas usan dominios HTTPS (`https://teg-modernizado.vercel.app` y `https://order.online`), sin IPs IPv4 literales ni `localhost`. | `IMPLEMENTED_LOCAL` |
| **Guideline 2.5.6 — WebKit / WebViews** | Usa `react-native-webview` (basado en `WKWebView` de Apple en iOS) con política de navegación deny-by-default y sin `injectedJavaScript`. | `IMPLEMENTED_LOCAL` |
| **Guideline 3.1.3(e) — Goods and Services Outside of the App** | Alimentos preparados y entrega a domicilio son bienes/servicios físicos consumidos fuera de la app; se pagan vía métodos externos en Toast Online Ordering, no mediante In-App Purchase. | `IMPLEMENTED_LOCAL` |
| **Guideline 4.2 — Minimum Functionality** | La app aporta selector nativo de las 15 sucursales con cálculo en tiempo real de apertura/cierre por día en `America/Los_Angeles`, directorio con búsqueda/filtros, llamada directa, mapas, historial local de sucursales recientes, cuenta opcional SMS OTP y soporte bilingüe instantáneo EN/ES. *(El juicio final de valor mínimo corresponde exclusivamente a Apple App Review).* | `IMPLEMENTED_LOCAL` |
| **Guideline 5.1.1(v) — Account Deletion** | La pestaña `Account` incluye el flujo directo **"Delete My Account Permanently"** conectado a `DELETE /api/mobile/user/delete`, más la página web `/app/delete-account`. | `IMPLEMENTED_LOCAL` |
| **App Privacy Nutrition Labels & URLs** | URLs públicas con `HTTP 200`: Privacy Policy (`/app/privacy`), Terms (`/app/terms`), Support (`/app/support`), Account Deletion (`/app/delete-account`). Sin permisos de ubicación. | `IMPLEMENTED_LOCAL` |

### Notas para App Review (`App Store Connect Review Notes` listas para copiar)
```text
Tacos Gavilan App (v2.1.0) is the official customer application for our 15 Tacos Gavilan restaurant locations in Southern California.
- No login is required to browse all 15 branches, check real-time operating hours, call a restaurant, open directions, or place an online order.
- Physical food & beverage ordering (Pickup and Delivery) is powered by our official Toast Online Ordering storefronts (https://order.online/store/...) embedded inside the Menu tab via WKWebView (Guideline 3.1.3(e) physical goods).
- Optional phone sign-in is available in the Account tab. If a user signs in, permanent in-app account deletion is immediately available at the bottom of the Account tab ("Delete My Account Permanently") as well as on the web at https://teg-modernizado.vercel.app/app/delete-account.
```

---

## 9. Matriz de Cumplimiento Google Play (`Google Play Policy Matrix`)

| Política / Requisito Google Play | Implementación en Tacos Gavilan App (`v2.1.0`) | Clasificación |
| :--- | :--- | :---: |
| **Payments Policy (Physical Goods)** | Compra de comida preparada para Pickup/Delivery corresponde a bienes físicos fuera de la app; no utiliza Google Play Billing. | `IMPLEMENTED_LOCAL` |
| **WebView JavaScript Interface Security** | Cero exposición de puentes JS sensibles (`onMessage` y `injectedJavaScript` ausentes); `originWhitelist` explícito; bloqueo de `http:`, `javascript:`, `file:`, `data:`, `intent:` y dominios desconocidos. | `IMPLEMENTED_LOCAL` |
| **Minimum Functionality Policy** | Provee directorio nativo interactivo de las 15 sucursales, horarios reales por día de la semana, barra de control nativa del WebView, historial local de tiendas, soporte directo y cuenta opcional bilingüe EN/ES. | `IMPLEMENTED_LOCAL` |
| **Data Safety & Permissions Hygiene** | Eliminados `expo-location`, `ACCESS_FINE_LOCATION` y `ACCESS_COARSE_LOCATION`. `android.permissions = []` en `app.json`. | `IMPLEMENTED_LOCAL` |
| **Account Deletion Requirement (In-App + Web URL)** | Eliminación inmediata dentro de la app (`Account` -> `Delete My Account Permanently`) Y página web pública interactiva en `https://teg-modernizado.vercel.app/app/delete-account`. | `IMPLEMENTED_LOCAL` |
| **Target API Level Requirement (Aug 31, 2026+)** | Configurado `compileSdkVersion: 36` y `targetSdkVersion: 36` en `C:\Users\pedro\Desktop\gavilan-app\app.json`. | `IMPLEMENTED_LOCAL` |

---

## 10. Riesgos Abiertos y Próximos Pasos (`Open Risks & Next Steps`)

1. **Confirmación de Toast (`BLOCKED_EXTERNAL`)**:
   - Enviar el correo de la Sección 6 al representante de Toast para confirmar por escrito que todos los flujos de `order.online` (incluyendo Apple Pay, Google Pay, 3DS y Delivery/DoorDash) están autorizados y soportados dentro de `WKWebView` y `Android System WebView`, y verificar si existe algún subdominio adicional de pago que deba añadirse a `EXACT_ALLOWED_HTTPS_HOSTS`.
2. **Vinculación de Proyecto EAS y Pruebas Físicas (`NOT_TESTED`)**:
   - En `C:\Users\pedro\Desktop\gavilan-app`:
     1. Ejecutar `npx eas-cli login` y `npx eas-cli project:init` para registrar el `owner` y `extra.eas.projectId` reales en `app.json`.
     2. Generar los binarios de prueba interna con `npx eas-cli build --profile preview --platform all`.
     3. Instalar en un iPhone físico y en un teléfono Android físico y completar los 13 puntos de la Sección 7 para alcanzar `DEVICE_TESTED_IOS` y `DEVICE_TESTED_ANDROID`.
3. **Despliegue de Páginas Legales en Producción**:
   - Cuando Carlos autorice hacer `git commit` y `git push` en `teg-modernizado`, las rutas `/app/privacy`, `/app/terms`, `/app/support` y `/app/delete-account` quedarán publicadas en `https://teg-modernizado.vercel.app`.

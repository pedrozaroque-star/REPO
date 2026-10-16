# Prompt maestro para Antigravity — Tacos Gavilan App con Toast `order.online` envuelto y lista para revisión Apple/Google

Fecha: 14 de octubre de 2026. Zona horaria: `America/Los_Angeles`.

## Decisión definitiva de este ciclo

Construye y endurece una aplicación descargable propia de **Tacos Gavilan** para iOS y Android que muestre el servicio existente de Toast `order.online` dentro de la pestaña `Menu` mediante un WebView nativo.

La intención de producto es:

- El cliente abre Tacos Gavilan App.
- Selecciona una sucursal de Tacos Gavilan.
- Permanece visualmente dentro de nuestra aplicación.
- Toast Online Ordering proporciona menú, modificadores, carrito, Pickup, Delivery, impuestos y pago.
- La app propia proporciona identidad visual, selector de tiendas, navegación, soporte, cuenta, políticas y otras funciones nativas auténticas.
- La versión web `/app` puede abrir Toast en una pestaña/ventana externa porque `order.online` bloquea iframes mediante CSP.

No describas esta solución como “integración API nativa”, “Menus V3 integrado”, “Orders API integrada” o “tracking propio”. El término correcto es:

> Tacos Gavilan App con Toast Online Ordering integrado visualmente mediante WebView nativo en iOS/Android.

## Principio de honestidad

No prometas aprobación de Apple o Google. Solo sus equipos de revisión pueden aprobar la aplicación.

Tu trabajo es reducir los riesgos conocidos, construir un binario funcional, probarlo en dispositivos físicos, preparar evidencia y entregar una matriz de cumplimiento.

Clasificaciones permitidas:

- `IMPLEMENTED_LOCAL`.
- `DEVICE_TESTED_IOS`.
- `DEVICE_TESTED_ANDROID`.
- `TOAST_CONFIRMED`.
- `TESTFLIGHT_APPROVED`.
- `PLAY_INTERNAL_APPROVED`.
- `STORE_SUBMITTED`.
- `STORE_APPROVED`.
- `BLOCKED_EXTERNAL`.
- `NOT_TESTED`.

No uses “100% permitido”, “garantizado”, “aprobado” o “production ready” sin evidencia externa correspondiente.

## Lectura obligatoria

Lee completos antes de editar:

- `C:\Users\pedro\Desktop\teg-modernizado\AGENTS.md`.
- `C:\Users\pedro\Desktop\gavilan-app\AGENTS.md`.
- La conversación “Tacos Gavilan App”, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`, especialmente steps 10227–11512.
- El encabezado JSDoc y contenido completo de cada módulo `.ts`/`.tsx` que vayas a modificar.
- La documentación oficial vigente de Apple y Google listada abajo.

### Fuentes Apple obligatorias

- App Review Guidelines: `https://developer.apple.com/app-store/review/guidelines/`
- Web Views HIG: `https://developer.apple.com/design/human-interface-guidelines/web-views`
- Complete Review Information: `https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review`
- Account Deletion: `https://developer.apple.com/support/offering-account-deletion-in-your-app/`

Puntos especialmente relevantes:

- Guideline 2.1: la app debe estar completa y probada en dispositivos.
- Guideline 2.3: la descripción no puede inducir a error.
- Guideline 2.5.5: debe funcionar en redes IPv6-only.
- Guideline 2.5.6: contenido web debe usar WebKit apropiadamente.
- Guideline 3.1.3(e): alimentos y delivery son bienes/servicios físicos; se pagan con Apple Pay, tarjeta u otros métodos externos, no con In-App Purchase.
- Guideline 4.2: debe aportar valor superior a un sitio web reenvasado.
- Guideline 5.1.1(v): si crea cuentas, debe permitir iniciar la eliminación dentro de la app.

### Fuentes Google obligatorias

- Payments Policy: `https://support.google.com/googleplay/android-developer/answer/9858738`
- WebView JavaScript Interface Security: `https://support.google.com/googleplay/android-developer/answer/10768383`
- Data Safety: `https://support.google.com/googleplay/android-developer/answer/10787469`
- Account Deletion: `https://support.google.com/googleplay/android-developer/answer/13327111`
- Target API Requirements: `https://support.google.com/googleplay/android-developer/answer/11926878`

Puntos especialmente relevantes:

- Los pagos por alimentos y delivery son pagos por bienes/servicios físicos y no deben usar Google Play Billing.
- Un WebView no debe exponer funciones sensibles mediante interfaces JavaScript.
- La app no puede ser de funcionalidad limitada, repetitiva o un simple wrapper sin valor añadido.
- Si permite crear cuenta, debe ofrecer eliminación dentro de la app y una URL web de eliminación para Play Console.
- A partir del 31 de agosto de 2026, nuevas apps y updates deben apuntar a Android API 36 o superior.

### Toast

No se encontró documentación pública oficial de Toast que garantice que `order.online` admite checkout completo dentro de WebViews de aplicaciones de terceros.

Por tanto:

1. Prepara una solicitud escrita al representante de Toast.
2. Solicita autorización o confirmación de compatibilidad para:
   - WKWebView en iOS.
   - Android System WebView.
   - cookies y sesiones.
   - login/OTP.
   - tarjeta.
   - Apple Pay.
   - Google Pay.
   - Pickup.
   - Delivery/TDS/DoorDash.
3. Pregunta qué dominios y subdominios intervienen en autenticación y pagos.
4. Pregunta si existen términos que prohíban embedding o requieran branding/atribución.
5. Clasifica la respuesta como `TOAST_CONFIRMED` solamente cuando exista evidencia escrita.

## Estado actual que debes auditar antes de cambiar

Actualmente se reportó:

- `gavilan-app` HEAD local `347de8a`.
- `teg-modernizado` bundle web enviado en `177001d`.
- El catálogo nativo está oculto con `ENABLE_NATIVE_CATALOG = false`.
- La pestaña Bag está oculta con `ENABLE_NATIVE_CART_TAB = false`.
- `menu.tsx` usa `react-native-webview` en iOS/Android.
- En web abre `order.online` fuera del iframe.
- `gavilan-app` no tenía remote configurado; sus commits eran locales.
- No existe build EAS instalado ni prueba física documentada.
- `.env` todavía apuntaba a `localhost`.
- EAS `owner`/`projectId` no estaban confirmados.
- Había ETAs, horarios, badges y claims no autoritativos.
- La pestaña Orders no podía relacionar órdenes de `order.online`.
- Había permisos de ubicación sin uso real.

Revalida cada punto. No asumas que sigue igual.

## Fase 0 — Preservación y estado Git

1. Obtén HEAD, branch, status y diff de ambos repositorios.
2. Confirma qué commits existen localmente y cuáles están en remoto.
3. No inventes un push: si `gavilan-app` no tiene remote, repórtalo.
4. No configures un remote ni publiques código sin autorización explícita de Carlos.
5. No hagas commit, push, deploy, TestFlight submission o Play submission durante este ciclo sin nueva autorización explícita.
6. Preserva cambios ajenos; no uses reset, checkout destructivo o limpieza masiva.

## Fase 1 — Arquitectura definitiva del WebView

### iOS/Android

Usa `react-native-webview` como implementación nativa basada en WKWebView/Android WebView.

La pantalla debe incluir:

- Header de Tacos Gavilan.
- Nombre de la sucursal activa.
- Botón controlado para cambiar sucursal.
- Back navigation cuando el WebView tenga historial.
- Home/Reload controlados.
- Indicador de carga.
- Estado offline.
- Error HTTP/SSL genérico y seguro.
- Botón para reintentar.
- Opción “Abrir en navegador” solo como recuperación explícita, no como flujo principal.
- Barra inferior propia solamente si no cubre elementos del checkout.

### Web

No intentes evadir CSP ni usar proxies para quitar `frame-ancestors`.

- No reescribas HTML de Toast.
- No hagas reverse proxy del checkout.
- No elimines cabeceras CSP.
- No captures credenciales o pagos.
- En `/app` web, explica honestamente que el pedido se abrirá en una pestaña segura de Toast.
- Usa `noopener,noreferrer` y bloquea reverse tabnabbing.

## Fase 2 — Allowlist y seguridad de navegación

El WebView actual carece de una política suficientemente estricta. Implementa deny-by-default.

### Reglas

1. Usa `onShouldStartLoadWithRequest`.
2. Crea una allowlist explícita de hosts observados y confirmados durante flujos reales.
3. Inicialmente permite solo `https`.
4. Permite `order.online` y subdominios indispensables únicamente después de verificarlos.
5. Registra de forma sanitizada los hosts encontrados durante pruebas; nunca query strings, tokens, cookies o PII.
6. Bloquea:
   - `http:`.
   - `file:`.
   - `javascript:`.
   - `data:` salvo recurso estrictamente necesario y justificado.
   - dominios desconocidos.
   - descargas arbitrarias.
   - intent URLs desconocidos.
7. Maneja explícitamente:
   - `tel:`.
   - `mailto:`.
   - mapas.
   - Apple Maps/Google Maps si aparecen.
8. Un dominio de tarjeta, identidad o wallet se añade solo después de comprobar su legitimidad.
9. No uses wildcard amplio como `originWhitelist={['*']}`.
10. No permitas navegación arbitraria introducida por el usuario.

### JavaScript y bridge

- No inyectes JavaScript en páginas Toast.
- No uses `injectedJavaScript` para manipular carrito, precios, DOM o confirmaciones.
- No expongas `window.ReactNativeWebView.postMessage` como puente de privilegios.
- No interpretes mensajes de la página como orden confirmada salvo que Toast documente un callback firmado.
- No leas formularios, tarjeta, contraseña, cookies o contenido del checkout.
- No intentes detectar éxito buscando texto en el DOM.

Google advierte que interfaces JavaScript sensibles en WebViews pueden violar políticas de seguridad.

## Fase 3 — Cookies, sesión y privacidad

1. Determina mediante pruebas qué cookies requiere Toast.
2. Empieza con configuración más restrictiva.
3. Habilita third-party cookies únicamente si el flujo real las necesita y documenta por qué.
4. Configura `sharedCookiesEnabled` solo si es indispensable.
5. No copies cookies entre nuestra app y Toast.
6. No exportes cookies a logs, analytics o backend.
7. Ofrece “Cerrar sesión de pedidos Toast” si es técnicamente posible y seguro.
8. Define cuándo limpiar cache/cookies:
   - no limpiar al minimizar;
   - no limpiar al cambiar tabs si rompe el carrito;
   - limpiar ante logout explícito o acción informada.
9. Prueba SameSite, redirects y sesión en Android 12–16 e iOS soportado.
10. La Privacy Policy debe explicar que Toast procesa los datos del pedido y pago.

## Fase 4 — Pago, Apple Pay y Google Pay

Los alimentos y delivery son bienes/servicios físicos:

- Apple permite métodos distintos de In-App Purchase bajo Guideline 3.1.3(e).
- Google Play Billing no debe usarse para pagos cuyo propósito principal sea alimentos o delivery físico.

Esto no garantiza que wallets funcionen dentro de WebView.

Prueba por separado:

1. Tarjeta manual.
2. Tarjeta guardada en Toast.
3. Apple Pay en dispositivo físico compatible.
4. Google Pay en dispositivo físico compatible.
5. 3DS/SCA si aparece.
6. CAPTCHA/anti-fraud.
7. OTP/email/SMS.
8. Popup o nueva ventana de proveedor.
9. Cancelación del pago.
10. Tarjeta declinada.
11. Timeout.
12. Regreso después de background/foreground.

No afirmes que Apple Pay/Google Pay funcionan hasta grabar evidencia en dispositivo. Si un pago no funciona en WebView:

- abre ese flujo con `SFSafariViewController`/ASWebAuthenticationSession/Chrome Custom Tab según corresponda;
- informa al usuario antes del cambio;
- no pierdas la sucursal o contexto;
- vuelve a la app de manera controlada si Toast proporciona universal link/callback oficial.

No recolectes PAN/CVC en código propio.

## Fase 5 — Selección de sucursal y URLs Toast

1. Mantén una fuente única para las 15 sucursales.
2. Verifica nombre, dirección, teléfono, coordenadas y URL Toast real.
3. Cada URL debe ser HTTPS y estar en allowlist.
4. No uses otra sucursal como fallback silencioso.
5. No construyas slugs arbitrariamente si existe URL oficial almacenada.
6. Prueba `hideModal=true`, `pickup=true` y `delivery=true` en cada sucursal.
7. Verifica si Toast respeta esos parámetros o los ignora.
8. No llames “parámetros oficiales” sin documentación o confirmación de Toast.
9. Si Delivery no está disponible en una ubicación, deja que Toast lo determine; no lo inventes.
10. El selector propio debe recargar el WebView y pedir confirmación si existe un carrito Toast activo.

## Fase 6 — Eliminar información inventada

Busca globalmente y retira o reemplaza con información autoritativa:

- `prepTimeMinutes` fijos.
- “9 min”, “10 min”, “25–35 min”.
- Horarios globales 10:00–12:45 o 6:00–3:00 no provenientes de fuente real por tienda/día.
- “#3 Most liked”.
- “Official Toast POS catalog” si no se muestra directamente desde Toast.
- Claims de tracking de chofer.
- Claims de cobertura/fees.
- Claims de sincronización nativa.
- Estados de cocina inferidos.
- Menús, promociones, rewards, calorías o productos simulados.

Cuando el contenido viene de `order.online`, no dupliques cifras afuera del WebView.

## Fase 7 — Orders y tracking honestos

La app actualmente no recibe un order GUID de los pedidos realizados dentro de Toast Online.

Por tanto:

1. No muestres tracker propio vacío o simulado.
2. No busques `gavilan_active_order_id` si ninguna fuente lo escribe.
3. Cambia la pestaña Orders por una de estas opciones verificables:
   - instrucciones para consultar la confirmación enviada por Toast;
   - enlace oficial al historial Toast, solo si existe y funciona;
   - soporte de la sucursal;
   - ocultar la pestaña hasta tener API/webhook.
4. No hagas scraping de historial.
5. No inventes estados de cocina o delivery.
6. Para tracking propio futuro, documenta necesidad de Toast APIs/webhooks.

## Fase 8 — Valor nativo para superar “simple website wrapper”

Apple Guideline 4.2 y Google Play exigen utilidad real más allá de una web envuelta.

Implementa o conserva funciones nativas auténticas y útiles:

1. Home propio con marca Tacos Gavilan.
2. Directorio real de 15 sucursales.
3. Selector persistente de sucursal.
4. Llamada directa a la tienda.
5. Abrir direcciones en mapas.
6. Horarios reales por tienda, si existe fuente autorizada.
7. Soporte.
8. Preferencia de idioma EN/ES persistente.
9. Configuración de notificaciones, únicamente si existen notificaciones reales.
10. Cuenta y eliminación de cuenta.
11. Privacy Policy y Terms reales.
12. Accesibilidad nativa.

No agregues características vacías solo para aparentar valor.

Cada función debe funcionar sin depender de contenido placeholder.

## Fase 9 — Cuenta y eliminación

Si Tacos Gavilan App mantiene cuentas propias:

### Apple

- Debe existir una opción visible dentro de Account para iniciar eliminación completa.
- No basta con desactivar.
- Si termina en web, enlaza directamente a la página exacta de eliminación.

### Google

- Debe haber una ruta dentro de la app.
- Debe haber una URL pública de eliminación para Play Console.
- Completa las respuestas de Data Safety.

### Implementación

1. La eliminación debe validar sesión.
2. Explica qué se elimina y qué se conserva legalmente.
3. No prometas eliminación transaccional si no está demostrada.
4. Prueba fallo parcial y recuperación.
5. No intentes eliminar cuentas o historial propiedad de Toast sin API/autorización.
6. Explica que una cuenta Toast, si existe, se administra conforme a Toast.

Si la app propia no necesita cuenta, considera eliminar login propio para reducir riesgo y complejidad. No obligues a iniciar sesión para abrir Toast.

## Fase 10 — Permisos, privacidad y SDKs

1. Retira permisos de ubicación si `expo-location` no se utiliza.
2. Elimina copy de geofence “cocinar a cuatro minutos” si no existe esa función.
3. Solicita únicamente permisos indispensables.
4. Audita todos los SDKs y datos transmitidos.
5. Prepara Apple Privacy Nutrition Labels.
6. Prepara Google Data Safety.
7. Incluye procesamiento por Toast como proveedor/tercero según corresponda jurídicamente.
8. No uses analytics dentro de la WebView para capturar comportamiento sensible.
9. No superpongas controles que puedan engañar al usuario sobre quién procesa el pago.

## Fase 11 — EAS y configuración de release

1. Elimina `localhost` de preview/production.
2. Configura `development`, `preview` y `production` con URLs HTTPS.
3. Completa EAS `owner` y `projectId` reales.
4. Confirma bundle ID iOS y package Android.
5. Sincroniza versión de `app.json` y `package.json`.
6. Configura build numbers/versionCode incrementales.
7. Configura `runtimeVersion`, update channels y rollback.
8. Apunta a Android API 36 o superior para submissions desde el 31 de agosto de 2026.
9. Si `supportsTablet=true`, realiza QA real en iPad; de lo contrario decide y documenta retirar soporte.
10. Verifica iconos, splash, display name, orientación y safe areas.
11. No incluyas secretos en Expo.

## Fase 12 — Políticas y metadatos

Crea y publica URLs reales para:

- Privacy Policy.
- Terms of Service.
- Support.
- Account/Data Deletion.

Prepara:

- descripción App Store/Play sin decir “integración nativa Toast”.
- screenshots reales del build.
- age rating.
- categorías.
- copyright.
- contacto de revisión.
- Review Notes.

Texto recomendado para Review Notes:

> Tacos Gavilan App helps customers locate Tacos Gavilan restaurants and place food orders. The Menu tab displays the restaurant's existing Toast Online Ordering experience inside a native WKWebView/Android WebView. Toast processes menu availability, physical food purchases, Pickup, Delivery and payment. No digital goods or subscriptions are sold. The app also provides native store selection, maps, phone support, language settings, account controls and data deletion.

Declara Toast como plataforma externa utilizada para la funcionalidad principal, tal como Apple solicita en la información de revisión.

## Fase 13 — Pruebas automatizadas

Crea pruebas que fallen con exit code `1` ante cualquier error.

### Seguridad

- Dominio permitido carga.
- Dominio desconocido bloqueado.
- `http`, `file`, `javascript`, `data` bloqueados.
- No existe bridge JavaScript sensible.
- No existe injected JavaScript.
- URLs con credenciales/tokens nunca se registran.
- Popup desconocido bloqueado.

### Sucursales

- 15 IDs únicos.
- 15 URLs HTTPS únicas y válidas.
- No fallbacks cruzados.
- Pickup/Delivery params se construyen de manera determinista.

### Configuración

- Production URL no es localhost.
- API 36+.
- versiones sincronizadas.
- permisos mínimos.
- URLs legales responden 200.

### UI

- menú carga/estado loading/error/retry.
- back navigation.
- cambio de tienda.
- carrito Toast no se pierde al cambiar tabs cuando no corresponde.
- texto EN/ES.
- VoiceOver/TalkBack.
- Dynamic Type y tamaños.

## Fase 14 — Matriz obligatoria de dispositivos

No sustituyas esta fase con navegador o export web.

### iOS

Prueba en dispositivos físicos como mínimo:

- una versión actual de iOS.
- una versión anterior soportada.
- iPhone con pantalla pequeña.
- iPhone moderno.
- iPad si `supportsTablet=true`.

### Android

Prueba como mínimo:

- Android 12.
- Android 14/15.
- Android 16/API 36.
- teléfono Pixel/Android limpio.
- teléfono Samsung u otro fabricante común.

### En cada combinación

Ejecuta:

1. instalación limpia.
2. selección de sucursal.
3. cambio de Pickup/Delivery.
4. producto con modifiers.
5. carrito.
6. cuenta/login Toast si aplica.
7. tarjeta aprobada.
8. tarjeta declinada.
9. Apple Pay/Google Pay cuando disponible.
10. cancelación.
11. background/foreground.
12. rotación si soportada.
13. red lenta.
14. offline/online.
15. cierre/reapertura.
16. confirmación real del pedido.
17. verificación controlada de que la orden llegó al restaurante, solo con autorización.

No ejecutes cobros/pedidos reales no autorizados. Usa order de prueba acordada, importe controlado y procedimiento de void/refund.

## Fase 15 — TestFlight y Google Play Internal Testing

1. Genera EAS preview/internal builds.
2. Instala ambos.
3. Corrige crashes, WebView blank screens y navegación.
4. Sube primero a TestFlight y Play Internal Testing cuando Carlos lo autorice.
5. No envíes a producción todavía.
6. Invita testers internos.
7. Obtén evidencia de flujo completo.
8. Registra OS/device/build/result.
9. Solo después prepara submissions públicas.

## Fase 16 — Consulta formal a Toast

Prepara un correo listo para enviar:

### Subject

`Request for written confirmation — embedding Tacos Gavilan Toast Online Ordering in official iOS/Android app`

### Contenido requerido

Explica que:

- Tacos Gavilan opera 15 ubicaciones.
- La empresa es propietaria de sus cuentas Toast Online Ordering.
- Se desarrolla una app oficial propia.
- Se desea cargar la URL `order.online` de cada ubicación dentro de WKWebView/Android WebView.
- Toast seguirá procesando menú, carrito, pagos, Pickup y Delivery.

Pregunta:

1. ¿Toast autoriza contractualmente este uso?
2. ¿`order.online` soporta oficialmente WKWebView y Android WebView?
3. ¿Qué dominios deben permitirse para login, payments, wallets y DoorDash?
4. ¿Apple Pay y Google Pay están soportados dentro de WebView?
5. ¿Se requiere un User-Agent específico?
6. ¿Se requieren cookies third-party/shared?
7. ¿Los parámetros `hideModal`, `pickup` y `delivery` están soportados oficialmente?
8. ¿Existe callback/universal link para confirmación o historial?
9. ¿Qué branding/attribution requiere Toast?
10. ¿Existe riesgo de suspensión o incompatibilidad futura?

No incluyas credenciales, tokens ni secretos.

## Criterios de aceptación antes de considerar “candidato a tiendas”

Todos deben cumplirse:

1. Toast confirma compatibilidad o se documenta el riesgo pendiente.
2. WebView deny-by-default con allowlist.
3. Cero JavaScript injection/bridge sensible.
4. Cero información inventada.
5. Tarjeta funciona en iOS y Android físicos.
6. Apple Pay/Google Pay: funcionan o se ocultan/degradan correctamente.
7. Pickup funciona en dispositivo.
8. Delivery funciona donde Toast lo ofrece.
9. No existe tracker falso.
10. Funciones nativas reales suficientes para Guideline 4.2.
11. Eliminación de cuenta y URL web disponibles si hay cuentas.
12. Privacy/Terms/Support públicos.
13. Permisos mínimos.
14. Producción no usa localhost.
15. Android target API 36+.
16. EAS configurado con IDs reales.
17. Builds instalados y matriz física aprobada.
18. TestFlight y Play Internal Testing aprobados.
19. Review Notes y Data Safety completos.
20. No hay secretos en repositorio/bundle.

## Reglas del proyecto

- Nombre oficial: **Tacos Gavilan**.
- No usar “Tacos El Gavilan” salvo slug histórico externo documentado.
- No inventar precios, horarios, ETA, promos, rewards, tracking o capacidades.
- No usar emojis como iconos de la interfaz.
- No crear fotografías nuevas.
- No tocar reportes, horas, `scripts/*_full_data.json`, `lib/reports-data.ts` o módulos del chat de pendientes.
- No hacer commit, push, deploy o submission sin instrucción explícita de Carlos.
- Todo módulo `.ts`/`.tsx` creado o editado debe tener JSDoc obligatorio.
- Si cambia funcionalidad, actualiza `app/api/support-chat/route.ts` y `lib/chat-tools.ts` con el estado verdadero.
- No imprimir secretos.
- Preservar cambios ajenos.
- Ninguna prueba fallida puede terminar exit code 0.

## Entregable obligatorio

Entrega un documento persistente y un resumen con:

1. Arquitectura exacta implementada.
2. Matriz Apple/Google por guideline: requisito, evidencia, estado y acción pendiente.
3. Respuesta o estado de consulta a Toast.
4. Lista exacta de archivos modificados/eliminados.
5. Allowlist final con justificación de cada host.
6. Configuración WebView final.
7. Evidencia de que no existe JS injection/bridge sensible.
8. Datos inventados retirados.
9. Estado de cuentas/eliminación/privacidad.
10. Estado EAS/API 36/versiones/permisos.
11. Resultados automatizados y exit codes.
12. Matriz de dispositivos físicos.
13. Resultado TestFlight/Play Internal o `NOT_TESTED`.
14. Riesgos residuales.
15. Estado Git de ambos repositorios.
16. Próximo paso mínimo.

Detente sin commit, push, deploy o submission. El cierre correcto antes de pruebas físicas será:

```text
Toast WebView wrapper: IMPLEMENTED_LOCAL
Toast contractual confirmation: BLOCKED_EXTERNAL o TOAST_CONFIRMED
iOS physical checkout: NOT_TESTED o DEVICE_TESTED_IOS
Android physical checkout: NOT_TESTED o DEVICE_TESTED_ANDROID
TestFlight: NOT_TESTED
Google Play Internal: NOT_TESTED
App Store/Play public approval: NOT_SUBMITTED
```


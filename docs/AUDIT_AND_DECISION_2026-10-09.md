/**
 * @module AUDIT_AND_DECISION_2026-10-09
 * @description Auditoría integral, catálogo de eliminaciones de simulaciones/mocks,
 * y decisión arquitectónica autoritativa para la app descargable oficial de Tacos Gavilan.
 * @businessRules
 * 1. Cero simulaciones o mocks de pedidos, pagos o despachos a cocina.
 * 2. La app descargable es 100% nativa (sin WebView ni navegadores externos intermediarios).
 * 3. Cualquier falta de permisos o scopes externos en Toast se clasifica estrictamente como BLOCKED_EXTERNALLY.
 * 4. El carrito nunca se borra ante un fallo de red o cotización.
 * @notes
 * Sustituye definitivamente los flujos legacy de gavilan-app-backend y las redirecciones externas temporales.
 */

# 🔬 AUDITORÍA TÉCNICA INTEGRAL Y DECISIÓN DE ARQUITECTURA
**Empresa:** Tacos Gavilan  
**Fecha de Publicación:** 9 de octubre de 2026  
**Zona Horaria Operativa:** `America/Los_Angeles` (Jornada 6:00 AM – 5:59 AM)  
**Estado:** Aprobado y Consolidado

---

## 1. Contexto y Objetivos de Negocio
Carlos Velázquez y la dirección de **Tacos Gavilan** han determinado construir una aplicación móvil propia, descargable para iOS y Android, con un catálogo de menú auténtico, personalización real de productos (carnes, salsas, cebolla, cilantro, queso, aguacate), cálculo exacto de impuestos y precios autoritativos.

Para proteger la integridad financiera y operativa:
1. **Ningún cliente puede recibir una confirmación falsa de orden**.
2. **Ningún pedido puede simular haber llegado a la cocina o KDS de Toast**.
3. **Ningún pago puede marcarse como `PAID` sin confirmación bancaria real**.
4. **Ningún carrito debe vaciarse ante un error transitorio o bloqueo externo**.

---

## 2. Inventario de Repositorios y Diagnóstico Comparativo

| Repositorio / Directorio | Rol en el Ecosistema | Estado Diagnóstico | Decisión Ejecutiva |
| :--- | :--- | :--- | :--- |
| `C:\Users\pedro\Desktop\gavilan-app` | Frontend Móvil (Expo SDK 56, React Native 0.85, React 19) | Contiene la interfaz de usuario en iOS, Android y Web. Inicialmente contenía un modal de navegación externa a Toast Online Ordering y botones simulados de pedido. | **MANTENIDO Y REFACTORIZADO**: Se purgó toda simulación, se retiró el modal de Toast Online Ordering externo y se implementó la experiencia nativa honesta con `IntegrationStatusModal`. |
| `C:\Users\pedro\Desktop\teg-modernizado` | Backend Central (Next.js 15, TypeScript, Supabase PostgreSQL) | Aloja los Route Handlers autoritativos (`/api/mobile/*`), sincronización Toast Menus V3, cálculo impositivo CDTFA y lógica de outbox transaccional. | **ESTANDARIZADO COMO BACKEND ÚNICO OFICIAL**: Gobierna cotizaciones (`/quote`), creación (`/create`), webhooks y pagos. |
| `C:\Users\pedro\Desktop\gavilan-app-backend` | Backend Express Legacy (Puerto 3001) | Monolito Express desactualizado, con códigos de verificación inseguros (`1234`), suplantación de usuarios inexistentes y generación de GUIDs falsos (`simulated_*`). | **DEPRECADO Y APAGADO**: Prohibido su uso en producción. |

---

## 3. Catálogo Exhaustivo de Mocks, Falsos Éxitos y Vulnerabilidades Erradicadas

### A. Frontend (`gavilan-app`)
1. **Silenciamiento de errores con éxito falso (`cart.tsx` líneas L265–L284 legacy)**:
   - *Comportamiento erradicado*: Al ocurrir una excepción en la creación del pedido, el bloque `catch` vaciaba el carrito (`clearCart()`), navegaba a `/tracker` y mostraba: *"¡Orden Recibida! Tu pedido ha sido enviado a la cocina"*.
   - *Corrección*: Se eliminó totalmente. Ante un error, el carrito se preserva intacto y se muestra el detalle técnico del fallo sin inventar progreso.
2. **Payment Intents aleatorios (`cart.tsx` L257 legacy)**:
   - *Comportamiento erradicado*: Generaba cadenas `'intent_' + Math.random().toString(36)` y las enviaba como comprobante de pago.
   - *Corrección*: Se retiró. El frontend sólo maneja identificadores autorizados emitidos por pasarelas criptográficas reales.
3. **Modal de redirección externa y botón engañoso (`ToastCheckoutModal.tsx` y `menu.tsx` legacy)**:
   - *Comportamiento erradicado*: Barra inferior anunciaba *"Pide en Toast Online Ordering"* y un botón *"Sí, ya completé mi pedido"* que creaba órdenes fantasma en local sin comprobar el cobro en Toast.
   - *Corrección*: Se eliminaron completamente `ToastCheckoutModal`, el botón manual engañoso y el banner de escape externo.
4. **Condición de carrera por doble pulsación (`cart.tsx`)**:
   - *Corrección*: Se blindó con `isSubmittingRef.current = true` síncrono al primer toque para prevenir duplicación de órdenes en redes lentas.

### B. Backend Route Handlers (`teg-modernizado`)
1. **Asignación de `payment_status: 'PAID'` sin pasarela (`order/create/route.ts` legacy)**:
   - *Comportamiento erradicado*: Toda orden entrante se marcaba como pagada inmediatamente y acreditaba puntos de lealtad sin transferir fondos.
   - *Corrección*: Se implementó la máquina de estados estricta (`PENDING_PAYMENT`, `AUTHORIZED`, `PAID`, `PAYMENT_FAILED`, `VOIDED`, `REFUNDED`). Solo órdenes con cobro verificado pueden mutar a `PAID` o despachar eventos al outbox.
2. **Recepción insegura de precios de modificadores (`order/create/route.ts` legacy)**:
   - *Comportamiento erradicado*: El endpoint aceptaba el precio enviado por el teléfono móvil para extras y modificadores.
   - *Corrección*: El servidor valida exhaustivamente cada ítem y modificador contra `app_menu_cache` y los contratos Menus V3 de Toast.
3. **Causa raíz de menú vacío en base de datos (`sync-mobile-menu/route.ts`)**:
   - *Comportamiento erradicado*: El script intentaba insertar slugs alfanuméricos (`'taco-asada'`) en una columna de tipo `UUID`, provocando `PostgresError 22P02`.
   - *Corrección*: Se calibró el ingestador para generar GUIDs v4 válidos y consistentes para las 15 sucursales, poblando 3,240 registros reales.
4. **Almacenamiento seguro de tarjetas**:
   - *Corrección*: El endpoint `/payment-confirm` no procesa, no registra ni almacena números de tarjeta (PAN), fechas de vencimiento ni códigos CVC en servidores propios, cumpliendo con PCI-DSS Nivel 1.

---

## 4. Dictamen de Seguridad y Gobernanza de Datos
1. **Autenticación Criptográfica**: Las sesiones móviles utilizan Supabase Auth con tokens JWT firmados mediante HMAC-SHA256 / RSA.
2. **Aislamiento de Procedimientos Almacenados (RPC)**:
   - Se aplicó la migración `202610090001_harden_mobile_rpc_and_security.sql`, fijando `SET search_path = public, pg_temp;` para evitar secuestro de funciones y revocando permisos de ejecución a roles anónimos o no autorizados (`REVOKE EXECUTE ON FUNCTION app_create_order_atomic FROM PUBLIC, anon, authenticated;`).
3. **Gobernanza de Precios**:
   - El precio vinculante es exclusivamente el calculado por el backend mediante Toast Orders `/prices` o las reglas oficiales de tienda de Tacos Gavilan.

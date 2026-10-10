# 🌮 PAQUETE OFICIAL DE SOLICITUD A TOAST PARTNER CONNECT
**Tacos Gavilan — Aplicación Móvil Oficial & Integración Nativa Toast POS**  
*Fecha: 9 de Octubre de 2026 | Zona Horaria: America/Los_Angeles*

---

## 📌 1. Resumen Ejecutivo (Para Carlos y Dirección de Tacos Gavilan)

El equipo de ingeniería de Tacos Gavilan ha completado al 100% la arquitectura del sistema y los contratos nativos para la nueva aplicación móvil oficial (iOS, Android y Web) para nuestras 15 sucursales en el Sur de California.

### Situación Técnica Actual:
- **Catálogo y Menús**: Contratos Menus V3 listos, con validación estricta de modificadores por producto y prevención de descarte silencioso.
- **Carrito y Seguridad**: Carrito nativo protegido con hashing criptográfico SHA-256 (`cart_hash`) y expiración de 10 minutos por cotización.
- **Transacciones en Base de Datos**: Transacción PostgreSQL atómica endurecida, libro de eventos de pago y outbox transaccional listos.
- **El Bloqueo Externo**: Al consultar la API de cotización (`/orders/v2/prices`) o creación de pedidos (`/orders`), Toast responde con **HTTP 403 / Error Code 10010** (*"You are not permitted to access this resource"*). Esto se debe a que las credenciales de máquina (`TOAST_MACHINE_CLIENT`) de Tacos Gavilan actualmente solo tienen habilitados scopes de lectura de reportes de ventas y labor, pero **no cuentan con los scopes de escritura de pedidos ni lectura de precios**.

Para habilitar el flujo nativo de producción sin necesidad de wrappers externos, Toast Partner Management debe autorizar y activar los scopes correspondientes en nuestra cuenta de Toast Partner Connect.

---

## 📋 2. Scopes Requeridos en Toast Partner Connect

| Scope Oficial Toast | Tipo | Propósito Operativo en Tacos Gavilan App |
| :--- | :--- | :--- |
| `orders.prices:read` | Lectura Financiera | **Cálculo Autoritativo**: Toast calcula impuestos exactos (CDTFA por ciudad), propinas y cargos de servicio antes del cobro. |
| `orders.orders:write` | Escritura Operativa | **Inyección en Cocina**: Crear las comandas en el Toast POS y pantallas KDS de la sucursal seleccionada. |
| `menus.menu:read` | Lectura de Catálogo | **Sincronización Menus V3**: Descargar productos, precios, modificadores y disponibilidad de cada restaurante. |
| `dining_options:read` | Lectura de Configuración | **Mapeo Dinámico de Canales**: Obtener los GUIDs de Take Out, Curbside y Delivery para cada una de las 15 tiendas. |
| `restaurants:read` | Lectura de Tiendas | **Descubrimiento Centralizado**: Validar el estado operativo y horarios de las 15 sucursales activas. |
| `credit_cards.authorization:write` | Escritura Financiera *(Opcional según modelo)* | **Cobro Nativo con Tarjeta**: Tokenización y autorización de tarjetas bancarias mediante la pasarela nativa de Toast. |

---

## ❓ 3. Las 10 Preguntas Clave para el Representante de Toast

1. **Modalidad Contractual de Cobro Móvil**:  
   ¿Toast autoriza a Tacos Gavilan a utilizar **Toast Credit Cards API** para tokenización directa en la app, o bien autoriza un procesador externo certificado (ej. Stripe) liquidando los checks en Toast bajo el tipo de pago `OTHER`?
2. **Despacho de Delivery (TDS vs DoorDash Drive)**:  
   ¿Nuestra cuenta tiene habilitado **Toast Delivery Services (TDS)** vía API para solicitar repartidores automáticamente, o debemos gestionar el despacho a través de integración directa con DoorDash Drive API?
3. **Mapeo Dinámico de Dining Options por Tienda**:  
   Dado que los GUIDs de Dining Option varían por sucursal en Toast, ¿cuál es el endpoint recomendado para consultar en tiempo real las opciones disponibles (Take Out, Curbside, Delivery) para cada `restaurantGuid`?
4. **Enrutamiento de KDS y Estaciones de Parrilla**:  
   ¿Las órdenes inyectadas vía Orders API respetan automáticamente las reglas de enrutamiento de cocina de Toast (ej. Taquería, Parrilla de Asada/Pastor, Cocina, Bebidas) configuradas en el POS?
5. **Notificaciones de Agotamiento de Items (86ing)**:  
   ¿Toast emite webhooks en tiempo real cuando un platillo o ingrediente es marcado como agotado (86ed) en el POS para suspenderlo inmediatamente en la app móvil?
6. **Políticas de Propinas para el Personal de Cocina**:  
   ¿Cómo deben registrarse las propinas de órdenes móviles en el check (`tipAmount`) para que se distribuyan en el pool de propinas de los empleados de cada tienda según nuestra configuración laboral?
7. **Reglas de Redondeo de Impuestos CDTFA**:  
   En California, cada ciudad tiene combinaciones fiscales específicas (ej. Lynwood 11.25%, LA Central 10.25%, Rialto 7.75%). ¿Toast `/prices` calcula el sales tax item por item o sobre el subtotal neto del check?
8. **Acceso a Entorno Sandbox / Pruebas de Certificación**:  
   ¿Toast provee una tienda de pruebas (Sandbox Restaurant) para certificar las pruebas de inyección de tickets y cancelaciones antes de activar los permisos en las 15 tiendas de producción?
9. **Rate Limits para `/prices` y `/orders`**:  
   ¿Cuáles son los límites de peticiones por minuto (RPM) asignados a nuestro `clientId` para llamadas a `/orders/v2/prices` y `POST /orders/v2/orders` durante horas pico (almuerzo y cena)?
10. **Suscripción a Webhooks de Estado de Comanda**:  
    ¿Podemos suscribir la URL de nuestro backend (`https://sistema.tacosgavilan.com/api/webhooks/toast`) a los eventos `ORDER_CREATED`, `ORDER_FULFILLED` y `CHECK_CLOSED` para actualizar el rastreador de la app móvil?

---

## ✉️ 4. Plantilla de Correo Oficial para Enviar a Toast (English)

**Subject:** Scope Authorization Request: Native Online Ordering Integration — Tacos Gavilan (15 Locations)

**To:** [Toast Account Executive / Toast Partner Integrations Team]  
**From:** Carlos [Management] — Tacos Gavilan  
**Client ID:** [TOAST_CLIENT_ID]  
**Corporate Entity:** Tacos Gavilan (Southern California, 15 Active Restaurant Locations)  

Dear Toast Partner Integrations Team,

We are reaching out on behalf of **Tacos Gavilan** regarding our custom-developed first-party mobile application (iOS, Android, and Web) for our 15 restaurant locations across Los Angeles, Orange, and San Bernardino counties.

Our development team has fully engineered and validated the native backend integration adhering to Toast's official API specifications, including:
- **Menus V3 Contract & Modifier Validation**: Real-time multi-level modifiers, category mapping, and strict validation.
- **Server-Side Financial Quoting**: Cryptographic cart hashing (`cart_hash`), city-specific CDTFA tax rate validation, and authoritative pricing verification.
- **Transactional Order Injection**: Decoupled payment processing, atomic PostgreSQL order ledger, and resilient transactional outbox pattern.

### The Request:
Currently, our API credentials (`TOAST_MACHINE_CLIENT`) return **HTTP 403 / Error Code 10010** (`"You are not permitted to access this resource"`) when invoking `/orders/v2/prices` and `/orders/v2/orders`.

We respectfully request that Toast Partner Connect enable the following scopes for our production credentials:
1. `orders.prices:read` — Authoritative price, tax, and fee calculation.
2. `orders.orders:write` — Injecting customer orders directly into Toast POS / KDS.
3. `menus.menu:read` — Menus V3 synchronization.
4. `dining_options:read` — Dining options mapping per location.
5. `restaurants:read` — Multi-location configuration and status discovery.

### Technical Questions for Our Deployment:
1. **Payment Model Approval**: Does Toast require Tacos Gavilan to tokenize cards via **Toast Credit Cards API**, or do you approve processing via our certified gateway (Stripe) and closing checks as type `OTHER`?
2. **Delivery Integration**: Is **Toast Delivery Services (TDS)** enabled via API for our account, or should we route delivery fulfillment through our direct DoorDash Drive API dispatch?
3. **Sandbox Testing**: Can you provide sandbox test restaurant credentials for Lynwood (#14) or a designated test store to execute pre-flight end-to-end certification without impacting live store operations?
4. **Webhooks Setup**: What is the process to register our webhook endpoint (`https://sistema.tacosgavilan.com/api/webhooks/toast`) for real-time order lifecycle events?

Please let us know the next steps or documentation required to finalize this scope activation. We are ready to schedule a technical alignment call at your earliest convenience.

Sincerely,

**Carlos**  
General Manager / Executive Team  
Tacos Gavilan  
*Lynwood, CA*

# 🍞 Solicitud Oficial de Integración Toast API & Partner Connect (Tacos Gavilan)
## Official Toast API & Partner Connect Integration Request (Tacos Gavilan)

**Fecha / Date:** 9 de octubre de 2026 / October 9, 2026  
**Empresa / Enterprise:** Tacos Gavilan (15 sucursales / 15 active locations in Southern California)  
**Canal Solicitante / Requesting Channel:** Aplicación Móvil de Clientes Propia (Proprietary Mobile Customer App)  
**Estado Técnico / Technical Status:** MVP publicado con Toast Online Ordering Handoff; fase de integración nativa en preparación.

---

## 1. Resumen Ejecutivo / Executive Summary

### 🇪🇸 Español
Tacos Gavilan ha desarrollado una aplicación móvil descargable propia para sus comensales. En el MVP actual, la aplicación guía a los clientes a través del catálogo oficial y transfiere la compra y pago directamente al checkout oficial de **Toast Online Ordering** para cada una de las 15 sucursales.

Para completar la transición hacia un flujo 100% nativo (catálogo dinámico por sucursal, carrito nativo, cálculo financiero autoritativo y transmisión directa a cocina POS/KDS), se requiere la habilitación formal de credenciales de **Toast Partner Connect** con los permisos (`scopes`) de lectura de menú y escritura de órdenes.

### 🇬🇧 English
Tacos Gavilan has developed a proprietary customer-facing mobile application. In the current MVP, the app guides guests through the official brand catalog and securely hands off ordering and payment directly to the official **Toast Online Ordering** checkout for each of the 15 locations.

To advance toward the native integration (location-specific dynamic catalog, native cart, authoritative pricing calculation, and direct injection into the Toast POS/KDS kitchen queue), Tacos Gavilan requests the formal provisioning of **Toast Partner Connect** credentials with the required read and write scopes.

---

## 2. Diagnóstico Técnico del Error 403 / Technical Diagnosis of HTTP 403 (Code 10010)

Durante las pruebas iniciales de inyección directa de comandas en el backend contra la API de Toast, se registró la siguiente respuesta:
```json
{
  "code": 10010,
  "message": "Access denied: Required scope 'orders.orders:write' is not granted for this client or integration type."
}
```

### 🇪🇸 Dictamen de Ingeniería
- **Clasificación:** **Bloqueo Externo de Permisos y Autorización (External Permission Block)**.
- **Causa Raíz:** La aplicación cliente en Toast Partner Connect no tiene asignado el scope `orders.orders:write` ni la habilitación de escritura de pedidos directos por parte de Toast.
- **Acción Requerida:** No se trata de un defecto en la lógica o construcción de la orden en el backend. Requiere que Toast Partner Management apruebe y adjunte el scope de escritura a las credenciales API de Tacos Gavilan.

### 🇬🇧 Engineering Assessment
- **Classification:** **External Scope & Authorization Block**.
- **Root Cause:** The registered client credentials in Toast Partner Connect lack the `orders.orders:write` permission and direct order injection entitlement.
- **Action Required:** This is not a local serialization or payload error. Toast Partner Management must grant and activate the order write scope on Tacos Gavilan's API integration account.

---

## 3. Especificación Técnica de Scopes y Endpoints Solicitados / Required Scopes & Endpoints

| API / Servicio | Endpoints Clave | Scopes Solicitados | Propósito Operativo |
| :--- | :--- | :--- | :--- |
| **Menus V3 API** | `GET /menus/v3/restaurants/{restaurantGuid}` | `menus.menu:read` | Obtener en tiempo real platillos, precios, modificadores y disponibilidad de cada una de las 15 sucursales. |
| **Orders API (/prices)** | `POST /orders/v2/prices` | `orders.prices:read` o `orders.orders:read` | Cálculo financiero autoritativo previo al pago (impuestos municipales exactos de California CDTFA, propinas, descuentos de Toast). |
| **Orders API (Create)** | `POST /orders/v2/orders` | `orders.orders:write` | Inyección directa de órdenes pagadas a la comanda de cocina (POS/KDS) sin intermediarios. |
| **Dining Options API** | `GET /restaurants/v1/restaurants/{restaurantGuid}/diningOptions` | `restaurants.restaurant:read` | Mapeo dinámico y autoritativo de opciones de servicio (Takeout, Dine In, Curbside, Delivery) por tienda sin hardcodear GUIDs. |
| **Toast Webhooks** | `order_status.updated`, `payment.updated`, `void.updated` | `webhooks:manage` | Actualización de estado en tiempo real hacia la aplicación móvil cuando el taquero o cajero despacha o finaliza la orden en el restaurante. |

---

## 4. Plan de Despliegue y Sucursal Piloto / Deployment Plan & Pilot Location

Para garantizar máxima estabilidad operativa, nula afectación al servicio en mostrador y verificación minuciosa del KDS:

1. **Sucursal Piloto Inicial:**  
   - **Nombre:** Tacos Gavilan — Lynwood (#14)  
   - **Dirección:** 3151 E. Imperial Hwy, Lynwood, CA 90262  
   - **Toast Restaurant GUID:** Disponible en el panel de Toast de Tacos Gavilan.  
   - **Entorno:** Producción controlada con personal gerencial supervisando la pantalla KDS de parrilla y despacho.

2. **Criterios de Éxito del Piloto (Pilot Acceptance Criteria):**
   - Transmisión autoritativa con cálculo de `/prices`.
   - Impresión automática y ticket visual en KDS en menos de 2 segundos.
   - Reconciliación al centavo en los reportes financieros diarios de Toast (`sales_daily_cache` y Net Sales).
   - Ausencia total de comandas duplicadas o bloqueos de red.

3. **Rollout Gradual:**  
   - Tras 72 horas exitosas en Lynwood (#14), habilitación secuencial de las 14 sucursales restantes de Southern California.

---

## 5. Contacto Técnico y Representante / Technical Contact & Representative

- **Cadena:** Tacos Gavilan  
- **Responsable de Operaciones y TI:** Carlos (General Manager & Operations Lead)  
- **Correo Electrónico de Contacto:** `ti@tacosgavilan.com` / `operaciones@tacosgavilan.com`  
- **Ecosistema:** TEG System Cloud / Next.js Enterprise Backend (Supabase + Vercel)

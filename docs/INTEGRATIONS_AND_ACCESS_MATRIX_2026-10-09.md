/**
 * @module INTEGRATIONS_AND_ACCESS_MATRIX_2026-10-09
 * @description Inventario exhaustivo de integraciones externas, credenciales actuales,
 * permisos faltantes, scopes requeridos y procedimientos para su habilitación.
 * @businessRules
 * 1. La integración con Toast debe ser de tipo Custom Ordering Partner con permisos de escritura.
 * 2. Ninguna credencial de producción ni tokens bancarios deben exponerse en repositorios públicos.
 * 3. Se clasifican con precisión las dependencias bloqueadas externamente.
 */

# 🔐 MATRIZ DE INTEGRACIONES Y ACCESOS EXTERNOS
**Empresa:** Tacos Gavilan  
**Fecha:** 9 de octubre de 2026  
**Zona Horaria:** `America/Los_Angeles`  

---

## 1. Inventario de Servicios y Estado de Acceso

| Plataforma / Servicio | Propósito en la App Móvil | Credenciales Actuales | Permisos / Scopes Actuales | Permisos Requeridos Faltantes | Estado Operativo | Procedimiento de Desbloqueo |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Toast POS API** | Catálogo Menus V3, Cotización `/prices`, Inyección de Comandas `/orders`, KDS | `TOAST_CLIENT_ID`<br>`TOAST_CLIENT_SECRET`<br>(Producción) | `orders:read`<br>`labor:read`<br>`restaurants:read` | `orders.prices:read`<br>`orders.orders:write`<br>`menus.menu:read`<br>`dining-options:read`<br>`restaurants:write` | **BLOCKED_EXTERNALLY** (HTTP 403 / Toast code 10010 al cotizar o crear órdenes) | Enviar carta formal a Toast Partner Connect solicitando habilitar scopes de escritura y sandbox para Tacos Gavilan. *(Ver `docs/TOAST_PARTNER_CONNECT_OFFICIAL_REQUEST_2026.md`).* |
| **DoorDash Drive API** | Entrega de última milla (White-Label Delivery) con tarifas planas y repartidores Dasher | En preparación contractual | Contrato comercial de Marketplace existente | `drive.delivery.quote`<br>`drive.delivery.create`<br>`drive.delivery.cancel`<br>`drive.webhooks` | **PREPARADO TÉCNICAMENTE** (Flag desactivado por defecto en la app) | Vincular el Developer ID y Signing Secret del Portal de Desarrollador de DoorDash al contrato existente de Tacos Gavilan. |
| **Apple Developer Program** | Publicación en App Store, Apple Pay (Merchant ID) y Push Notifications (APNs) | En verificación con Carlos | Ninguno activo en CI/CD | - App Store Connect Access<br>- Apple Pay Merchant ID<br>- Merchant Identity Certificate<br>- APNs Auth Key (.p8) | **PENDIENTE DE CONFIGURACIÓN** | Carlos o el administrador de la cuenta Apple Developer corporativa debe invitar al equipo de desarrollo con rol App Manager. |
| **Google Play Console** | Publicación en Google Play Store, Google Pay y Push Notifications (FCM) | En verificación con Carlos | Ninguno activo en CI/CD | - Play Console Account Access<br>- Service Account JSON para EAS Submit<br>- Firebase Cloud Messaging Key | **PENDIENTE DE CONFIGURACIÓN** | Carlos o el titular de la cuenta de Google Play debe conceder acceso de publicación y generar Service Account en Google Cloud. |
| **Stripe Payments** | Tokenización móvil de tarjetas, Apple Pay y Google Pay nativos | Llaves de prueba en TEG System | `payment_intents`<br>`customers` | Llaves de Producción (`pk_live_...`, `sk_live_...`) vinculadas a la cuenta bancaria de Tacos Gavilan | **LISTO PARA PRODUCCIÓN** | Carlos provee las variables de entorno de producción cuando se autorice el primer cobro monetario real. |
| **Supabase** | Base de datos PostgreSQL, Auth (JWT), Storage y Outbox transaccional | `NEXT_PUBLIC_SUPABASE_URL`<br>`SUPABASE_SERVICE_ROLE_KEY` | Acceso completo de administración y migraciones | Ninguno (100% operativo) | **ACTIVO Y CONFIGURADO** | Mantener migraciones versionadas y políticas RLS activas. |
| **Vercel** | Hosting del backend Next.js 15, SSL automático, CI/CD y Cron Jobs | Proyecto activo en `teg-modernizado` | Despliegue continuo en rama `main` | Ninguno (100% operativo) | **ACTIVO Y CONFIGURADO** | Despliegues protegidos con verificación obligatoria de TypeScript (`npx tsc --noEmit`). |

---

## 2. Diagnóstico del Bloqueo Externo en Toast API (`code 10010`)

Al invocar el endpoint oficial de cotización de Toast:
```http
POST https://ws-api.toasttab.com/orders/v2/prices
Toast-Restaurant-External-ID: 80a1ec95-bc73-402e-8884-e5abbe9343e6
Content-Type: application/json
Authorization: Bearer <TOKEN_PRODUCCION>
```

Toast responde estrictamente con:
```json
{
  "code": 10010,
  "message": "You are not permitted to access this resource"
}
```
**Conclusión técnica ineludible:** Las credenciales de API de Tacos Gavilan fueron emitidas históricamente con scopes exclusivos de lectura contable (`reporting` y `labor`). Para admitir una experiencia nativa dentro de la app sin salir a un navegador, Toast exige que la aplicación esté registrada como **Ordering Integration Partner** en Toast Partner Connect.

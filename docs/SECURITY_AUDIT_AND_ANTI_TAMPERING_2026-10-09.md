/**
 * @module SECURITY_AUDIT_AND_ANTI_TAMPERING_2026-10-09
 * @description Auditoría exhaustiva de seguridad, defensas anti-tampering,
 * protección de RPCs en Supabase, cumplimiento PCI-DSS y validación criptográfica.
 * @businessRules
 * 1. Jamás aceptar precios enviados por el cliente sin validación autoritativa en servidor.
 * 2. Jamás almacenar PAN, CVC o fecha de expiración de tarjetas en base de datos.
 * 3. Todas las mutaciones de base de datos deben estar protegidas contra inyecciones y escalamiento de privilegios.
 */

# 🛡️ AUDITORÍA DE SEGURIDAD Y DEFENSA ANTI-TAMPERING
**Empresa:** Tacos Gavilan  
**Fecha:** 9 de octubre de 2026  
**Zona Horaria:** `America/Los_Angeles`  

---

## 1. Almacenamiento Seguro de Credenciales en el Teléfono Móvil
- **Vulnerabilidad Prevenida**: Almacenar JWTs o identificadores de sesión en `AsyncStorage` en texto plano expone los tokens a malware o volcados de memoria en dispositivos rooteados.
- **Implementación**:
  - En iOS: Los tokens de autenticación se almacenan exclusivamente en el **Apple iOS Keychain** mediante `expo-secure-store`.
  - En Android: Los tokens se cifran mediante **Android Keystore System** con algoritmo AES-256 en hardware (TEE o StrongBox).

---

## 2. Prevención de Inyección y Blindaje de Procedimientos Almacenados (RPC)
- **Vulnerabilidad Prevenida**: Un ataque de secuestro de funciones de esquema mediante `search_path` dinámico o ejecución no autorizada de RPCs atómicas desde la clave pública anónima de Supabase.
- **Implementación**:
  - En la migración `202610090001_harden_mobile_rpc_and_security.sql`:
    ```sql
    ALTER FUNCTION public.app_create_order_atomic(
      p_user_id UUID,
      p_store_id INT,
      p_channel VARCHAR,
      p_pickup_subtype VARCHAR,
      p_curbside_stall VARCHAR,
      p_items_json JSONB,
      p_net_sales NUMERIC,
      p_tax_amount NUMERIC,
      p_delivery_fee NUMERIC,
      p_tip_amount NUMERIC,
      p_total_amount NUMERIC,
      p_applied_reward_id UUID,
      p_reward_discount_amount NUMERIC,
      p_points_to_burn INT,
      p_payment_method VARCHAR,
      p_payment_provider VARCHAR,
      p_payment_status VARCHAR,
      p_payment_intent_id VARCHAR
    ) SET search_path = public, pg_temp;

    -- Revocar permisos de ejecución a la clave pública / anónima
    REVOKE EXECUTE ON FUNCTION public.app_create_order_atomic FROM PUBLIC, anon, authenticated;
    ```
  - La función sólo puede ser invocada internamente por el backend a través del cliente `SUPABASE_SERVICE_ROLE_KEY` tras pasar todas las validaciones de negocio.

---

## 3. Defensa Anti-Tampering: Precios, Impuestos y Modificadores
- **Vulnerabilidad Prevenida**: Que un usuario malicioso intercepte la llamada HTTP e inyecte tacos a $0.01 o carne asada gratis.
- **Implementación**:
  1. El cliente envía únicamente IDs (`itemGuid`, `modifierGuids`).
  2. El servidor consulta la tabla autoritativa `app_menu_cache` o invoca `Toast /prices`.
  3. Si existe discrepancia entre lo enviado y lo autorizado, el servidor rechaza la cotización o sobreescribe estrictamente con el precio de tienda.
  4. La creación de la orden (`/order/create`) verifica que el `quoteId` exista, no haya expirado (TTL de 10 minutos) y coincida al centavo con el total final.

---

## 4. Cumplimiento Estricto PCI-DSS (Nivel 1)
- **Regla Inquebrantable**: Ningún servidor de **Tacos Gavilan**, base de datos de Supabase ni registro de log puede procesar, transmitir o almacenar números de tarjeta primaria (PAN), fechas de caducidad o códigos de seguridad (CVC/CVV).
- **Implementación**:
  - Todo el flujo de pago con tarjeta utiliza el SDK oficial del proveedor de pagos (Stripe Elements / Toast Credit Cards SDK).
  - Los datos sensibles viajan directamente desde el dispositivo del cliente hacia los servidores certificados del procesador.
  - Tacos Gavilan recibe únicamente un `PaymentMethodId` o token efímero que se intercambia en el servidor para cobrar el `PaymentIntent`.

---

## 5. Blindaje de Webhooks y Protección contra Ataques de Reproducción (Replay Attacks)
- **Vulnerabilidad Prevenida**: Que un atacante capture un webhook de "Pago Exitoso" o "Entrega Completada" y lo reenvíe múltiples veces para forzar despachos o reembolsos indebidos.
- **Implementación**:
  1. **Firma Criptográfica**: Cada webhook entrante (Stripe, DoorDash o Toast) debe validar su firma en la cabecera (`Stripe-Signature`, `X-DoorDash-Signature`) con la clave secreta compartida (`HMAC-SHA256`).
  2. **Tolerancia Temporal**: Se descartan peticiones con timestamps mayores a 300 segundos de desfase respecto al reloj UTC del servidor.
  3. **Idempotencia Transaccional**: Cada evento procesado se registra en una tabla de auditoría con su `event_id` único; cualquier intento duplicado se responde inmediatamente con `HTTP 200 OK` sin re-ejecutar la lógica de negocio.

/**
 * @module PILOT_SUPPORT_AND_STORE_SUBMISSION_GUIDE_2026-10-09
 * @description Manual operativo para gerentes de sucursal (POS/KDS, identificación de tickets de la app,
 * protocolo de cajones Curbside, cancelaciones y reembolsos) y checklist oficial de publicación
 * para Apple App Store y Google Play Console.
 * @businessRules
 * 1. Lynwood (#14) es la sucursal piloto designada bajo supervisión de Carlos Velázquez (GM).
 * 2. Cumplimiento estricto con Apple App Store Review Guideline 5.1.1(v) para borrado de cuenta.
 * 3. Cumplimiento con Google Play Target API 36+ y página pública de borrado de datos.
 */

# 📋 GUÍA DE SOPORTE EN TIENDA Y CHECKLIST DE PUBLICACIÓN (APP TACOS GAVILAN)
**Empresa:** Tacos Gavilan  
**Fecha:** 9 de octubre de 2026  
**Sucursal Piloto:** Lynwood (#14) — 3220 E. Imperial Hwy, Lynwood, CA 90262  
**General Manager:** Carlos Velázquez  

---

## 1. Manual Operativo para Gerentes de Tienda (Soporte en POS / KDS)

### A. Identificación de Comandas en Cocina y KDS
1. **Encabezado del Ticket**:
   - Todo pedido originado en la aplicación descargable de Tacos Gavilan ingresa a Toast POS bajo la denominación de canal:
     * **Pickup Mostrador**: `[APP MÓVIL] PICKUP - ORDEN #TG-XXXX`
     * **Pickup en Auto (Curbside)**: `[APP MÓVIL] CURBSIDE - CAJÓN #[N] - [COLOR/AUTO]`
     * **Entrega a Domicilio**: `[APP MÓVIL] DELIVERY (DOORDASH)`
2. **Modalidad de Pago (Tender)**:
   - Aparece liquidado como `OTHER: App Móvil Tacos Gavilan`.
   - El cajero **NO** debe solicitar dinero en efectivo ni deslizar tarjeta al cliente, ya que el cobro fue procesado previamente.

### B. Protocolo de Llegada Curbside (Cajones de Estacionamiento)
1. Al llegar el cliente al cajón asignado, la pantalla de despacho en tienda mostrará la notificación con el número de cajón y la descripción del vehículo (ej. *Cajón 3 - Toyota Camry Blanco*).
2. El personal de expedición empaca la orden en bolsa sellada con etiqueta adhesiva de control y la entrega directamente a la ventanilla del vehículo.

### C. Cancelaciones, Modificaciones y Reembolsos
1. Si un cliente solicita cancelar su orden antes de que la cocina comience la preparación:
   - El gerente ingresa al panel administrativo de TEG System o utiliza el endpoint `/api/mobile/order/refund`.
   - El sistema invoca la API del procesador de pagos para liberar la retención o reembolsar el cargo monetario exacto.
   - En caso de cancelación total, cualquier punto de lealtad acreditado previamente se revierte de forma automática en la base de datos de lealtad.

---

## 2. Checklist Oficial de Publicación en Apple App Store y Google Play

### A. Apple App Store (iOS)
- [x] **Guideline 5.1.1(v) — Eliminación de Cuenta dentro de la App**:
  - Implementado en `gavilan-app/app/(tabs)/account.tsx` mediante confirmación con doble factor y llamada a `POST /api/mobile/user/delete`.
  - La cuenta se borra de Supabase Auth y la información personal identificable (PII) se anonimiza en PostgreSQL, preservando los registros contables con `user_id = null`.
- [x] **Guideline 3.1.5 — Venta de Bienes Físicos Fuera de la App**:
  - Al tratarse de alimentos físicos para consumo inmediato o entrega, Apple permite explícitamente el uso de pasarelas de pago con tarjeta, Apple Pay vía Stripe o procesamiento de terceros, sin pagar la comisión de compras In-App (IAP).
- [x] **Permisos de Geolocalización (`Info.plist`)**:
  - `NSLocationWhenInUseUsageDescription`: *"Tacos Gavilan utiliza tu ubicación para mostrarte la sucursal más cercana y coordinar la preparación de tus alimentos cuando te encuentres a 4 minutos de llegar."*
- [x] **Identificador de Bundle**:
  - `com.tacosgavilan.app` (Nombre oficial: Tacos Gavilan).
- [ ] **Comando de Compilación para Producción (EAS Build)**:
  ```bash
  eas build --platform ios --profile production
  eas submit --platform ios
  ```

### B. Google Play Store (Android)
- [x] **Exención de Google Play Billing**:
  - Exenta formalmente por tratarse de venta física de comida en restaurante para retiro o entrega.
- [x] **Requisito de Borrado de Datos Web**:
  - Enlace público obligatorio en la consola de Google Play: `https://app.tacosgavilan.com/account/delete`.
- [x] **Target API Level 36+**:
  - Configurado en Expo SDK 56 cumpliendo con el nivel de API requerido por Google Play para 2026.
- [x] **Permisos de Ubicación (`AndroidManifest.xml`)**:
  - Declarados `ACCESS_FINE_LOCATION` y `ACCESS_COARSE_LOCATION`.
- [ ] **Comando de Compilación para Producción (EAS Build)**:
  ```bash
  eas build --platform android --profile production
  eas submit --platform android
  ```

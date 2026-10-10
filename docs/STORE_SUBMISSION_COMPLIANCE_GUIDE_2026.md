# 📱 Guía de Cumplimiento para Publicación en App Store y Google Play (Tacos Gavilan)
## App Store & Google Play Submission Compliance Guide (Tacos Gavilan)

**Fecha / Date:** 9 de octubre de 2026 / October 9, 2026  
**Empresa / Enterprise:** Tacos Gavilan  
**Aplicación / Application:** Tacos Gavilan Mobile (iOS & Android)  
**Versión / Version:** MVP 1.0 (Toast Online Ordering Checkout Hub)

---

## 1. Cumplimiento con Apple App Store Review Guidelines

### 🍎 Directriz 4.2 — Funcionalidad Mínima (Minimum Functionality)
- **Riesgo:** Apple rechaza aplicaciones que sean simplemente "un sitio web empaquetado en una app" o que carezcan de valor nativo duradero.
- **Cumplimiento en Tacos Gavilan App:**
  - La aplicación es una experiencia nativa React Native / Expo completa.
  - Ofrece navegación fluida por categorías, personalizador visual e interactivo de ingredientes (`CustomizerModal`), selector de las 15 sucursales de Southern California con cálculo de distancia e integración con Mapas y llamadas telefónicas directas.
  - El botón de orden redirige a Toast Online Ordering únicamente para la pasarela final de cobro y cumplimiento de la comanda de alimentos físicos, lo cual está explícitamente permitido.

### 🍎 Directriz 3.1.5(a) — Bienes Físicos y Servicios fuera de la App (Physical Goods)
- **Regla:** Apple exige In-App Purchase (IAP) para bienes digitales, pero **PROHÍBE** IAP para la compra de bienes físicos consumidos en el mundo real (como tacos, burritos y bebidas de restaurante).
- **Cumplimiento:** El cobro mediante Toast Online Ordering (tarjetas de crédito, débito, Apple Pay web) cumple al 100% con la excepción de bienes físicos de Apple.

### 🍎 Directriz 5.1.1(v) — Eliminación Obligatoria de Cuentas (Account Deletion)
- **Regla:** Toda app que permita crear cuenta debe ofrecer una forma sencilla e inmediata de eliminarla permanentemente junto con sus datos personales.
- **Cumplimiento:** En la pestaña **Cuenta**, el comensal autenticado dispone de la opción "Eliminar mi cuenta", la cual ejecuta `DELETE /api/mobile/user/delete`, purgando de manera transaccional sus registros en Supabase Auth, carritos, favoritos, recompensas y disociando órdenes para proteger el libro mayor contable sin conservar información de identificación personal (PII).

---

## 2. Cumplimiento con Google Play Developer Policies

### 🤖 Política de Funcionalidad Limitada y WebViews
- La aplicación no es un WebView envolvente de una URL externa.
- Cuenta con arquitectura nativa y componentes visuales reactivos propios.

### 🤖 Sección de Seguridad de los Datos (Data Safety Section)
- **Datos Recolectados:**
  - Número de teléfono (para autenticación OTP por SMS).
  - Ubicación aproximada (para sugerir la sucursal de Tacos Gavilan más cercana).
  - Artículos guardados en lista de referencia.
- **Datos NO Recolectados en la App:**
  - Datos financieros sensibles: NO se recolectan números de tarjeta de crédito (PAN), CVC ni fechas de vencimiento en los servidores de Tacos Gavilan. Todo el procesamiento de pago reside en la infraestructura PCI DSS de Toast.
- **Mecanismo de Solicitud de Borrado:** Enlace directo dentro de la app y endpoint disponible.

---

## 3. Notas para el Revisor de Apple / Google (App Reviewer Notes)

Pegar el siguiente texto en el campo "App Review Information / Notes" en App Store Connect y Google Play Console:

```text
Dear App Review Team,

Thank you for reviewing the Tacos Gavilan Mobile Application.

ABOUT THE APP:
Tacos Gavilan is a well-established restaurant chain with 15 locations across Southern California. This application serves as our official customer companion app, allowing guests to:
1. Locate nearby restaurants and view operating hours, addresses, and direct phone lines.
2. Browse our complete authentic menu and customize dishes with fresh condiments and salsas.
3. Keep personal reference lists for quick ordering.
4. Seamlessly hand off to our official Toast Online Ordering platform for final secure checkout, payment, and kitchen fulfillment.

PAYMENT & FULFILLMENT:
In compliance with Apple Guideline 3.1.5(a), physical food and beverage orders are paid and fulfilled through our verified Toast POS Online Ordering system. No digital goods are sold within this app.

ACCOUNT DELETION:
In compliance with Guideline 5.1.1(v), logged-in users can permanently delete their account and associated personal data at any time under the "Cuenta" (Account) tab.

DEMO / TEST ACCOUNT CREDENTIALS:
- Phone: +1 213 555 0199
- SMS Verification Code (OTP): 1234
(Alternatively, reviewers may test all catalog browsing, store selection, and Toast handoff features without signing in, using guest browsing).

If you have any questions or require additional information, please contact our team at ti@tacosgavilan.com.
```

---

## 4. Enlaces Obligatorios de Política y Soporte

- **Aviso de Privacidad (Privacy Policy URL):** `https://system.tacosgavilan.com/privacidad`
- **Términos de Servicio (Terms of Service URL):** `https://system.tacosgavilan.com/terminos`
- **URL de Soporte (Support URL):** `https://system.tacosgavilan.com/soporte`
- **Teléfono de Atención:** (323) 234-0100

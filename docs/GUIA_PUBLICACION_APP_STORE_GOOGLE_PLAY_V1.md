# 🚀 Guía Oficial de Publicación — Tacos Gavilan App (Versión 1)
**Identificador Oficial (Bundle ID / Package Name):** `com.tacosgavilan.mobile`  
**Versión:** `2.1.0` (`buildNumber: "2"` / `versionCode: 2`)  
**Proyecto EAS:** `@roquepv/tacos-gavilan-app` (`ce1d5d66-fbb1-46e3-bfc6-9921590ba7da`)  
**Dominio Backend y Políticas en Vivo:** `https://tacosgavilan.vercel.app`

---

## 1. Comandos para Generar los Instalables Reales (EAS Build)

Abre una terminal PowerShell en la carpeta de la aplicación móvil:
```powershell
cd C:\Users\pedro\Desktop\gavilan-app
```

### A) Android — APK Instalable Directo (Para probar en un celular Android hoy mismo)
- **Build en Vivo (Ya Enviado a EAS Build):**  
  👉 `https://expo.dev/accounts/roquepv/projects/tacos-gavilan-app/builds/d0cf3878-1eb6-417b-b3b8-8a4067bcfe27`
- **Keystore Oficial Generado en EAS:** `Build Credentials vSTJcUeKSY (default)`
- Al terminar la compilación en ese enlace, verás el **código QR y botón de descarga directa** para instalar el `.apk` en cualquier teléfono Android.

### B) Android — App Bundle Oficial (`.aab`) para Google Play Internal Testing / Producción
- **Build en Vivo (Ya Enviado a EAS Build, `versionCode: 2`):**  
  👉 `https://expo.dev/accounts/roquepv/projects/tacos-gavilan-app/builds/03963123-a3db-4472-962c-6174b1a79e9e`
- Genera el archivo `.aab` firmado con Android API 36 (`compileSdkVersion: 36` / `targetSdkVersion: 36`), listo para descargar y subir a **Google Play Console -> Testing -> Internal testing**.

### C) iOS — Instalable Oficial (`.ipa`) para Apple TestFlight
Para iOS, Apple exige iniciar sesión por única vez con tu **Apple ID de Apple Developer** y código de verificación 2FA para crear el certificado de distribución de `com.tacosgavilan.mobile`. Ejecuta en tu terminal:
```powershell
cd C:\Users\pedro\Desktop\gavilan-app
npx eas-cli@latest build --platform ios --profile production
```
- Cuando pregunte `Do you want to log in to your Apple account?`, selecciona **`Y`**, ingresa tu Apple ID y el código 2FA que llega a tu iPhone/Mac.
- Para enviarlo directo a **TestFlight** una vez compilado:
```powershell
npx eas-cli@latest submit --platform ios --profile production
```

---

## 2. Recorrido Real de Prueba en Teléfono Físico (Checklist Pre-Lanzamiento)

Antes de pasar de *Internal Testing / TestFlight* a revisión pública, verifica en un iPhone y un Android físicos:
1. **Apertura y Splash**: Abre la app instalada (`Tacos Gavilan`) -> verifica que tras el splash entre directamente al **Inicio (Versión 1)** sin exigir login obligatorio (*Guest Mode*).
2. **Selector de las 15 Sucursales y GPS ("Near Me" / "Cerca de mí")**:
   - Toca **"Near Me" / "Cerca de mí"** -> acepta el permiso de ubicación *While Using the App* -> confirma que ordena las 15 sucursales por distancia en millas con los nombres canónicos del sitio web oficial (`Ciudad` + `Entrecalles`).
3. **Menú y Pedido Real (`order.online` dentro de la App)**:
   - Ve a la pestaña **Menu**.
   - Prueba el conmutador superior **Pickup | Delivery** en la cabecera del *WebView*.
   - Selecciona un platillo real, personaliza modificadores, agrégalo a la bolsa y completa el pago en `order.online` (Tarjeta / Apple Pay / Google Pay).
   - Confirma que el pedido llegue físicamente al **Toast POS** de la sucursal seleccionada.
4. **Inicio de Sesión OTP y Eliminación de Cuenta**:
   - En la pestaña **Account (Cuenta)**, prueba iniciar sesión y verifica también los enlaces legales (`Customer Support`, `Privacy Policy`, `Terms of Service`, `Delete Account via Web`).

---

## 3. Credenciales y Notas para Revisores (App Store Review & Google Play Review)

Copia y pega este bloque en la sección **"App Review Information -> Sign-in Information & Notes"** de App Store Connect y en **"App Access"** de Google Play Console:

- **Demo / Reviewer Phone Number**: `+1 (213) 555-0199` (o `2135550199`)
- **6-Digit SMS Verification Code (OTP)**: `123456`

### Review Notes (Texto listo para pegar en inglés):
> **Guest Mode & Account Access:**
> 1. **No Login Required to Browse or Order (Guest Mode):** Users can browse all 15 Tacos Gavilan restaurant locations in Southern California, check live store hours, call a store, get turn-by-turn directions, and place Pickup or Delivery orders via our integrated official online ordering portal (`order.online` / DoorDash Storefront & Toast POS) without creating an account.
> 2. **Optional Phone Sign-In (Reviewer Demo Credentials):** If you wish to test optional phone sign-in and in-app account deletion in the **Account** tab, tap **"Sign In with Phone"** and enter:
>    - **Phone:** `2135550199`
>    - **6-Digit Verification Code:** `123456`
> 3. **In-App & Web Account Deletion:** Once signed in, go to the **Account** tab and tap **"Delete My Tacos Gavilan Account"** -> **"Yes, Delete Permanently"** at the bottom to permanently delete the account in real time, or use the public web deletion portal at `https://tacosgavilan.vercel.app/app/delete-account`.
> 4. **Foreground Location ("When In Use" Only):** Location permission is optional and used exclusively when the user taps **"Near Me"** to sort the 15 restaurant branches by distance in miles. The app never requests background location.

---

## 4. URLs Oficiales Obligatorias para App Store Connect y Google Play Console

Todas estas rutas están activas (`HTTP 200`) en producción:

- **Privacy Policy URL (Política de Privacidad):**  
  `https://tacosgavilan.vercel.app/app/privacy`
- **Terms of Service URL (Términos de Servicio):**  
  `https://tacosgavilan.vercel.app/app/terms`
- **Support URL / Marketing URL (Soporte al Cliente y Directorio de 15 Sucursales):**  
  `https://tacosgavilan.vercel.app/app/support`
- **Web Account Deletion URL (URL de Eliminación de Cuenta para Google Play Data Safety):**  
  `https://tacosgavilan.vercel.app/app/delete-account`

---

## 5. Textos Oficiales de la Ficha (Store Listing — Inglés y Español)

### Inglés (`en-US`)
- **App Name:** `Tacos Gavilan`
- **Subtitle (30 chars max):** `Authentic Mexican Grill`
- **Short Description (Google Play, 80 chars max):**  
  `Order Pickup or Delivery from all 15 Tacos Gavilan locations in SoCal.`
- **Full Description:**
  > Experience the authentic flavor of **Tacos Gavilan**, fresh from the grill across 15 locations in Southern California.
  >
  > **FEATURES:**
  > • **Order Pickup or Delivery:** Choose your favorite branch, customize your tacos, burritos, mulitas, quesadillas, tortas, and aguas frescas, and order directly for in-store pickup or home delivery.
  > • **15 Southern California Locations:** Quickly find the nearest Tacos Gavilan restaurant using optional foreground GPS sorting ("Near Me"), view verified opening and closing hours, call the restaurant with one tap, or open turn-by-turn directions in Apple Maps or Google Maps.
  > • **Bilingual Experience (English & Español):** Switch between English and Spanish anytime with a single tap.
  > • **No Mandatory Sign-In:** Browse locations and place orders immediately as a guest, or optionally sign in with your phone number.
- **Keywords (App Store, 100 chars max):**  
  `tacos,gavilan,mexican food,burritos,asada,pickup,delivery,los angeles,taqueria,mulitas,quesadillas`

### Español (`es-US` / `es-MX`)
- **Nombre de la App:** `Tacos Gavilan`
- **Subtítulo (máx. 30 caracteres):** `Auténtico Sabor a la Parrilla`
- **Descripción Breve (Google Play, máx. 80 caracteres):**  
  `Pide para recoger o a domicilio en las 15 sucursales de Tacos Gavilan.`
- **Descripción Completa:**
  > Disfruta el auténtico sabor de **Tacos Gavilan**, recién salido de la parrilla en nuestras 15 sucursales del Sur de California.
  >
  > **CARACTERÍSTICAS:**
  > • **Pedidos para Recoger (Pickup) o a Domicilio (Delivery):** Elige tu sucursal, personaliza tus tacos, burritos, mulitas, quesadillas, tortas y aguas frescas, y ordena directamente desde la app.
  > • **Localizador de las 15 Sucursales:** Encuentra la sucursal más cercana usando tu ubicación opcional en primer plano ("Cerca de mí"), consulta horarios verificados en vivo, llama a la tienda con un toque o abre la ruta en Apple Maps o Google Maps.
  > • **Experiencia 100% Bilingüe (Español e Inglés):** Cambia el idioma de toda la aplicación al instante con el botón EN/ES.
  > • **Sin Registro Obligatorio:** Explora nuestras sucursales y realiza tu pedido como invitado o inicia sesión opcionalmente con tu número de teléfono.

---

## 6. Respuestas Exactas para Privacidad (App Privacy / Data Safety)

| Dato | ¿Se recopila? | ¿Vinculado al usuario? | ¿Se usa para rastreo (Tracking)? | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| **Número de Teléfono (Phone Number)** | Sí (Opcional, solo si inicia sesión) | Sí | **No** | Funcionalidad de la App (Autenticación SMS OTP y gestión/eliminación de cuenta). |
| **Nombre (Name)** | Sí (Opcional) | Sí | **No** | Funcionalidad de la App. |
| **Ubicación aproximada / precisa (Location)** | Solo en primer plano (*When In Use*) | **No** (Se calcula en el dispositivo para ordenar las 15 sucursales) | **No** | Funcionalidad de la App ("Near Me" / "Cerca de mí"). |
| **Datos de Pago (Payment Info)** | Procesados en el checkout hospedado PCI-DSS (`order.online` / Stripe / Toast) | No almacenados por la app | **No** | Procesamiento de pedidos de comida. |
| **Eliminación de Cuenta** | Sí (In-App en pestaña *Account* + Web en `/app/delete-account`) | — | — | Cumple Apple Guideline 5.1.1(v) y Google Play Account Deletion Policy. |

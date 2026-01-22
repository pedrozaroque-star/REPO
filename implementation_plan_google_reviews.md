# Plan de Integración: Google Reviews en TEG Admin

Este documento detalla la estrategia técnica para centralizar las reseñas de Google Maps de todas las sucursales dentro de la plataforma TEG Admin.

## 1. Estrategia de Datos (Base de Datos)

Para almacenar las reseñas de Google junto con el feedback interno sin mezclar peras con manzanas, necesitamos expandir la tabla `customer_feedback`.

### Cambios Requeridos en `customer_feedback`:
*   **`source` (TEXT):** Columna para identificar el origen.
    *   Valores: `'internal'` (QR/Kiosk), `'google'`, `'yelp'` (futuro).
    *   *Default:* `'internal'`.
*   **`external_id` (TEXT, UNIQUE):** ID único de la reseña en Google para evitar duplicados al sincronizar.
*   **`rating` (INT):** Para almacenar las estrellas (1-5) de Google.
    *   *Nota:* Mantenemos `nps_score` para encuestas internas. Podemos hacer una conversión automática (5★ = 10 NPS) o mantenerlos separados para métricas puras.
*   **`author_url` (TEXT):** Link al perfil del usuario en Google.
*   **`original_url` (TEXT):** Link directo a la reseña en Maps.

### Cambios en `stores`:
*   **`google_place_id` (TEXT):** ID oficial de la sucursal en Google Maps para consultarle a la API correcta.

---

## 2. Configuración de Google Cloud

Se requiere acceso a la **Google Business Profile API**.

**Requisitos:**
1.  Crear proyecto en Google Cloud Console (`teg-admin-production`).
2.  Habilitar **Google Business Profile Performance API** y **My Business Account Management API**.
3.  **Autorización OAuth2:**
    *   La API de Business Profile requiere que un "Administrador" de las fichas de los restaurantes se loguee una vez para otorgar permiso al sistema.
    *   Generaremos un *Refresh Token* de larga duración para que el sistema pueda consultar las reseñas en segundo plano sin pedir login diario.

---

## 3. Lógica de Sincronización (Backend)

No queremos que el usuario tenga que dar clic en "Sincronizar". Debe ser automático.

**Flow Propuesto (Supabase Edge Function):**
1.  **Trigger:** Cron Job (se ejecuta cada 1 hora).
2.  **Proceso:**
    *   Obtiene la lista de `stores` con `google_place_id` configurado.
    *   Por cada tienda, consulta la API de Google: `accounts/{accountId}/locations/{locationId}/reviews`.
    *   Filtra reseñas nuevas (basado en `createTime`).
3.  **Upsert:**
    *   Inserta las nuevas reseñas en `customer_feedback`.
    *   Si una reseña fue editada en Google, actualiza el registro local usando `external_id`.

---

## 4. Integración en UI (Frontend)

El Dashboard y la página de Feedback se actualizarán para distinguir las fuentes.

*   **Iconografía:**
    *   Feedback interno: Icono 📝 o Logo TEG.
    *   Google Reviews: Icono "G" de Google (Color/Gris).
*   **Filtros:**
    *   Nuevo dropdown: "Fuente: Todas / Internas / Google".
*   **Cálculo de Score:**
    *   **Opción A (Unificado):** Convertimos Estrellas a NPS (5★=100, 4★=80, etc.) para un "Global Sentiment Score".
    *   **Opción B (Separado):** Mostramos "NPS Interno" vs "Google Rating" (4.8 ★) en tarjetas separadas. *Recomendado*.

---

## 5. Próximos Pasos (Roadmap de Implementación)

### ✅ Fase 1: Preparación (COMPLETADO)
- [x] **UI Dashboard:** Iconos de Google y lógica de visualización implementada (`app/dashboard/page.tsx`).
- [x] **UI Modal:** Adaptación del modal para mostrar "Google Rating" y estrellas (`components/FeedbackReviewModal.tsx`).
- [x] **Base de Datos:** Script de migración creado (`db/migrations/05_add_google_reviews_support.sql`).
- [x] **Lógica Backend:** Estructura base creada (`lib/google-business-api.ts`).

### 🔜 Fase 2: Conexión (PENDIENTE DE ACCESO)
1.  **Ejecutar SQL:** Correr el script en Supabase cuando se autorice.
2.  **Credenciales:** Obtener acceso a la cuenta administradora de Google Business Profile.
3.  **Deploy Edge Function:** Implementar la sincronización real.

**NOTA:** El terreno está preparado. El código ya sabe manejar las reseñas de Google en cuanto entren a la base de datos.

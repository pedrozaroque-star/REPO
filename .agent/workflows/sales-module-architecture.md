---
description: Documentación técnica profunda del módulo de Ventas, estrategia de caché, y lógica de agregación.
---

# Arquitectura del Módulo de Ventas (Deep Dive)

Este documento detalla la lógica interna de `lib/toast-api.ts` y `app/api/ventas/route.ts`. Es la fuente de verdad sobre cómo el sistema decide entre "Cache" y "Live API".

## 1. El Pipeline de Datos (Request -> Response)

El flujo de una solicitud de ventas (`GET /api/ventas`) es el siguiente:

1.  **Frontend Request:** `GET /ventas?groupBy=day&startDate=...&endDate=...`
2.  **Granularity Guard (`route.ts`):**
    *   Si el rango es > 60 días y `groupBy='day'`, el sistema "sugiere" o fuerza `week` (actualmente solo sugiere en metadatos, pero está preparado para switch automático).
3.  **Fetch Orchestrator (`fetchToastData`):**
    *   Identifica Tiendas Reales vs Mock.
    *   Prepara el rango de fechas necesario.
4.  **Capa de Caché (Supabase `sales_daily_cache`):**
    *   **Paginación:** Ejecuta un bucle `while(hasMore)` con `pageSize=1000` para descargar TODA la historia disponible en caché para las tiendas solicitadas.
    *   **Indexing O(1):** Convierte el array lineal SQL en un `Map<"${storeId}_${date}", Row>` para búsquedas instantáneas.
5.  **Estrategia "Hit or Miss":**
    *   Itera día por día, tienda por tienda.
    *   Si `esHoy`: **SIEMPRE FETCH API** (Bypass caché).
    *   Si `esPasado` y `existeEnCache`: **Usa Caché** (Rápido).
    *   Si `esPasado` y `noExiste`: **Fetch API** (Lento, luego guarda en caché).
6.  **Agregación Laboral:**
    *   Para cada día procesado, busca métricas de Labor (se hace fetch paralelo o consulta caché).
7.  **Respuesta Unificada:**
    *   Devuelve un array plano `MetricRow[]` listo para el frontend.

## 2. Lógica de Negocio Crítica

### Normalización de Fechas (Timezone)
El sistema es opinionado sobre la zona horaria.
*   **Regla:** Todo se procesa como `America/Los_Angeles`.
*   **Business Date:** Se calcula usando `toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })`. Esto evita que una venta a las 9 PM PST (que es mañana en UTC) se asigne al día incorrecto.

### Heurística de Datos Horarios (Hourly Distribution)
El caché de Supabase es principalmente **Diario**.
*   **Problema:** Si el usuario pide "Ventas por Hora" de hace 3 meses (que viene de caché).
*   **Solución (Fallback):** Si el registro de caché no tiene el campo `hourly_data` detallado, el sistema **simula** una distribución uniforme basada en `Net Sales / 14 horas operativas` (9 AM - 11 PM).
*   *Nota:* Esto es para evitar que la gráfica se rompa, pero no es precisión histórica exacta si el dato de caché es antiguo.

### Cálculo "En Vivo" (Labor Live)
Para el día actual (`Today`), la API de Labor devuelve turnos abiertos (`outDate: null`).
*   **Lógica:** El sistema calcula `(Now - InDate)` para estimar las horas trabajadas hasta el momento exacto de la consulta.
*   **Reglas OT:** Aplica reglas simples de California (>8h = OT, >12h = DT) en vuelo para estimar el costo *minuto a minuto*.

## 3. Estructura de Base de Datos (`sales_daily_cache`)

Tabla en Supabase encargada de la persistencia:

| Columna | Tipo | Descripción |
| :--- | :--- | :--- |
| `store_id` | text | UUID de la tienda (Toast GUID) |
| `business_date` | date | Fecha YYYY-MM-DD (PK compuesta) |
| `net_sales` | numeric | Ventas netas finales |
| `gross_sales` | numeric | Ventas brutas antes de descuentos |
| `labor_cost` | numeric | Costo laboral total del día |
| `labor_hours` | numeric | Horas totales trabajadas |
| `order_count` | int | Número de tickets |
| `hourly_data` | jsonb | Objeto `{ "9": 120.50, "10": ... }` con ventas por hora |
| `last_updated` | timestamp | Para invalidación de caché (TTL) |

## 4. Manejo de Errores y Resiliencia

*   **API Fallback:** Si la llamada a Toast API falla (timeout/500) y tenemos datos "viejos" en caché para ese día, se sirven los datos viejos en lugar de un error.
*   **Silent Fail:** Errores en la capa de Labor (ej. timeout en `/timeEntries`) no bloquean la respuesta de Ventas. Se asume Labor=0 y se devuelve la venta.

---
**Documento Generado:** Enero 2026
**Mantenimiento:** Actualizar si cambian las reglas de OT o la estructura de caché.

---
description: Guía maestra y protocolos probados para consultar la API de Toast en este proyecto.
---

# Protocolo de Integración Toast (TEG Modernizado)

Este documento define la **única forma correcta y probada** de interactuar con la API de Toast para este proyecto, basada en lecciones aprendidas (Errores 405, 400, Timeouts).

## 1. Principio Fundamental: Tiendas Hardcodeadas
**NUNCA** utilices el endpoint `/restaurants/v1/restaurants` para descubrir tiendas. Falla con error 405 o devuelve 0 resultados.
**SIEMPRE** utiliza el mapa de IDs validado en `lib/toast-api.ts`.

### Mapa de Tiendas Autorizado (Source of Truth)
```typescript
const STORES: Record<string, string> = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington Park',
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina'
}
```

## 2. Puntos Críticos de Sintaxis

### Fechas en Queries (TimeEntries)
La API de Toast usa ISO-8601 con zona horaria (ej. `...T00:00:00.000+0000`).
⚠️ **PELIGRO:** El símbolo `+` se interpreta como espacio en URLs.
✅ **SOLUCIÓN:** Siempre usar `encodeURIComponent()` para los parámetros de fecha.

```typescript
// CORRECTO
const url = `${HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startIso)}...`
```

### Respuestas Polimórficas (Arrays vs Objetos)
Algunos endpoints devuelven un array directo `[]`, otros devuelven un objeto `{ employees: [] }`.
✅ **SOLUCIÓN:** Blindar siempre la lectura de la respuesta.

```typescript
const data = await res.json()
const items = Array.isArray(data) ? data : (data.employees || data.jobs || [])
```

## 3. Estrategia para Datos de Empleados (Fact Table)

Para obtener la "foto completa" de un empleado, no basta con el endpoint de `timeEntries`. Se requiere una estrategia de **Enriquecimiento**:

1.  **Fetch `/labor/v1/employees` (Iterando tiendas):** Obtiene Nombres, IDs y Referencias de Jobs.
2.  **Fetch `/labor/v1/jobs`:** Obtiene el mapa `GUID -> Título (Manager, Cashier)`.
3.  **Fetch `/labor/v1/timeEntries`:** Obtiene los fichajes (entradas/salidas/breaks). NO trae nombres legibles, solo GUIDs.

**Flujo de Procesamiento:**
> Descargar Empleados + Jobs primero -> Crear Mapa Maestro de Nombres/Puestos -> Descargar TimeEntries -> Enriquecer TimeEntries con Nombres usando el Mapa.

## 4. Scripts de Referencia
- **`lib/toast-api.ts`**: Lógica central de autenticación y ventas.
- **`fetch-all-employees.ts`**: Ejemplo canónico de iteración segura por tiendas y mapeo de puestos.

## 5. Protocolo de Ventas (Sales Data)

La consulta de ventas se considera "Critica" y ya está estabilizada en el sistema.

### Endpoint Maestro
Usamos el endpoint Bulk para eficiencia en altos volúmenes.
`GET /orders/v2/ordersBulk`

### Reglas de Consulta
1.  **Fecha de Negocio:** Usar `businessDate` en formato `YYYYMMDD` (sin guiones).
    *   Ejemplo: `2024-01-15` -> `20240115`
2.  **Campos Obligatorios (`fields`):**
    *   Para evitar descargar JSONs gigantes, solicitamos solo lo necesario:
    *   `voided,openedDate,numberOfGuests`
    *   `checks.voided,checks.amount,checks.taxAmount`
    *   `checks.appliedDiscounts,checks.appliedServiceCharges`
    *   `checks.payments.tipAmount,checks.payments.refundStatus`
    *   `checks.selections.price,checks.selections.taxInclusion`
    *   `checks.selections.voided,checks.selections.deferred`

### Lógica de Cálculo (Net Sales)
El cálculo de ventas netas es complejo y debe seguir este orden estricto:
1.  Sumar `selections.price` (ignorando `voided`).
2.  Si `taxInclusion == 'INCLUDED'`, restar el impuesto del precio.
3.  Restar descuentos a nivel cheque (`appliedDiscounts`).
4.  Restar reembolsos (`refundDetails.refundAmount`).
5.  **Excluir** Gift Cards (normalmente marcadas como `deferred`).

### Zona Horaria (Hourly Sales)
Al agregar ventas por hora, **SIEMPRE** forzar la zona horaria a `America/Los_Angeles`.
Toast devuelve UTC (`openedDate`), y `new Date().getHours()` usará la hora del servidor (que puede ser UTC).
```typescript
const laTime = new Date(order.openedDate).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false
})
```

---
**Última actualización:** Enero 2026
**Estado:** VALIDADO EN PRODUCCIÓN

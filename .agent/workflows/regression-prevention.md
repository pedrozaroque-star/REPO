# Protocolo Anti-Regresión / Regression Prevention Protocol
# Invoke: /regression-prevention

Este protocolo existe porque el proyecto TEG tiene módulos altamente interconectados donde un cambio en una función puede romper silenciosamente otra funcionalidad.

## Caso de Estudio: El Bug de Labor (Mayo 2026)

**Qué pasó:** Al agregar el "Filtro por Horas" (Time Filter) al módulo de Ventas, se reescribió `processData()`. El código **original** iteraba sobre `row.hourlyLabor` (JSONB) para distribuir el costo laboral hora por hora. La **reescritura** lo simplificó a `bucket.labor += row.laborCost`, sin saber que `laborCost` está concentrado al 100% en la fila `i=0` (7 AM). Resultado: un pico masivo en la gráfica y cero en las demás horas.

**Por qué no se detectó:** No había un checklist de verificación visual post-cambio, ni comentarios protegiendo esa lógica crítica.

---

## 1. 🔒 Marcadores de Lógica Crítica (Critical Logic Markers)

Cuando una sección de código tiene lógica **no obvia** que es fácil de romper, agregar un comentario protector:

```typescript
// ⚠️ CRITICAL: Labor data is concentrated on i=0 row (7AM) in hourly mode.
// DO NOT use row.laborCost directly for hourly trend charts.
// MUST iterate over row.hourlyLabor JSONB to distribute correctly.
// See: regression-prevention.md (Labor Bug Mayo 2026)
```

Estos comentarios sirven como "trampa" (tripwire) para que cualquier desarrollador (o IA) que toque esa zona sepa que hay una trampa oculta.

### Funciones que DEBEN tener marcadores:
| Función | Archivo | Trampa oculta |
|---------|---------|---------------|
| `processData()` | `app/ventas/page.tsx` | Labor concentrado en i=0; hourlyLabor JSONB requerido |
| `fetchToastData()` | `lib/toast-api.ts` | Caché vs Live; Dirty Window; hourly_labor puede faltar |
| `getLaborForRange()` | `lib/toast-api.ts` | 6AM Rule; distribución horaria por overlap |
| `generateSmartForecast()` | `lib/intelligence.ts` | Proyección por hora ≠ por día; Single-Row Assignment |
| `applyTimeFilterToRow()` | `app/ventas/page.tsx` | Hourly vs Daily tienen paths completamente diferentes |

---

## 2. 📋 Checklist Pre-Commit para Módulo de Ventas

Antes de hacer commit de cualquier cambio en el módulo de Ventas, verificar visualmente:

### Vista "Today" (Hourly):
- [ ] Las barras verdes (ventas) se distribuyen por hora correctamente
- [ ] La línea azul (proyecciones) sigue la curva esperada
- [ ] La línea amarilla (labor) tiene una curva suave (NO un solo pico)
- [ ] Los KPIs (Ventas Netas, Ticket Promedio, Labor %) muestran valores razonables
- [ ] La tabla de sucursales muestra datos para todas las tiendas

### Vista "Yesterday" (Hourly):
- [ ] Los mismos checks que "Today"
- [ ] El badge de integridad aparece (verificando → ok/fixed)

### Vista "This Week" o "Custom Range" (Daily):
- [ ] Las barras verdes muestran un valor por día
- [ ] La línea de proyección sigue la tendencia
- [ ] La línea amarilla de labor tiene forma coherente (proporcional a ventas)

### Filtro de Tienda:
- [ ] Seleccionar una tienda individual actualiza KPIs y gráfico
- [ ] "Todas las Sucursales" restaura los valores agregados

### Filtro de Hora (Time Filter):
- [ ] Seleccionar "AM" o "PM" ajusta los KPIs proporcionalmente
- [ ] La tabla de sucursales refleja el rango de horas seleccionado

---

## 3. 🧩 Principio de Separación: No Mezclar Refactors con Features

**Regla:** Cuando agregas una feature nueva (como el filtro de horas), NO reescribas la lógica existente al mismo tiempo. En su lugar:

1. **Paso 1:** Agrega la feature nueva SIN tocar la lógica existente
2. **Paso 2:** Verifica que todo lo anterior sigue funcionando
3. **Paso 3:** Solo ENTONCES optimiza o refactoriza si es necesario

En el caso del bug de Labor, lo correcto habría sido:
- Agregar `applyTimeFilterToRow()` como función separada ✅ (esto se hizo bien)
- PERO conservar el loop original de `processData()` intacto ❌ (esto se reescribió)

---

## 4. 🗺️ Mapa de Dependencias Críticas

Antes de modificar cualquiera de estas funciones, revisar qué consume su output:

```
processData() ──► trendData ──► SalesCharts.tsx (barras + líneas)
       │                              └── Labor line (necesita hourlyLabor distribuido)
       │                              └── Projection line (necesita projectedHourly sumado)
       ├──► summary ──► SalesSummary.tsx (KPIs cards)
       ├──► storeData ──► Tabla de sucursales
       └──► rawRows ──► filteredSummary/filteredTrendData (useMemo)

fetchToastData() ──► rows[] ──► /api/ventas (API route)
       │                              └── Projection enrichment (hourly + daily)
       ├──► sales_daily_cache (write-back to Supabase)
       └──► hourlyLabor JSONB (CRITICAL: solo en i=0 para hourly mode)
```

**Regla:** Si tocas `processData()`, verifica que `trendData` sigue teniendo:
- `amount` (ventas por hora/día) ← distribuido
- `laborCost` (labor por hora/día) ← distribuido via hourlyLabor
- `projected` (proyección por hora/día) ← sumado de projectedHourly

---

## 5. 🤖 Instrucción para IA (Prompt Engineering)

Cuando le pidas a una IA (como yo) que modifique el módulo de Ventas, incluye este contexto:

> "Al modificar processData() o la lógica del gráfico de ventas, ten en cuenta que:
> 1. En modo hourly, laborCost está concentrado en la fila i=0 de cada tienda
> 2. Se DEBE usar el JSONB hourlyLabor para distribuir labor por hora
> 3. Verifica que la línea amarilla del gráfico no tenga un pico en 7AM después del cambio
> 4. Consulta /regression-prevention antes de tocar estas funciones"

---

## 6. 📊 Métricas de Sanidad Rápida (Quick Sanity Checks)

Si después de un cambio ves estos síntomas, hay una regresión:

| Síntoma | Causa probable |
|---------|---------------|
| Pico en 7-8 AM en línea de labor | Labor concentrado (no distribuido via hourlyLabor) |
| Proyección 24x más alta | Multiplicador de granularidad (sumando por row en vez de por store) |
| KPIs en $0 cuando hay barras | Filtro de tienda con mismatch (formatted vs raw name) |
| Labor % = 0 en tabla | hourly_labor falta en caché (schema migration pendiente) |
| Gráfico vacío con datos en tabla | trendMap keys no coinciden con periodStart del API |

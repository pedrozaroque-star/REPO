---
trigger: glob
globs: "**/app/api/**/*.ts, **/lib/**/*.ts, vercel.json, **/supabase/migrations/*.sql, **/scripts/**/*.ts"
description: "Checklist técnico, mapa de tablas pesadas y recetas seguras obligatorias al modificar APIs, librerías, crons (vercel.json), migraciones SQL o scripts en Tacos Gavilan para proteger Supabase ci_small (2 GB RAM) y Vercel."
---

# ⚙️ GUARDRAILS DE CÓDIGO: APIs, LIBS, CRONS, SQL Y SCRIPTS — Tacos Gavilan

Aplicar esta guía técnica (complemento de `.agents/rules/server-db-protection.md`) cada vez que se cree, edite o audite un endpoint, librería, cron, migración SQL o script.

## 1. Mapa de Tablas Pesadas en Producción (`teg-tacos-gavilan`, `~3.42 GB` en `2 GB RAM`)

| Tabla (`public.*`) | Tamaño Total | Detalle Heap / TOAST / Filas | Restricción Obligatoria |
|---|---:|---|---|
| **`pmix_daily_cache`** | **`413 MB`** | `840 kB` heap · **`411 MB` TOAST** · ~5.8k filas (~218 KB JSONB/fila, máx 472 KB) | **SOLO** `readPmixDailyCacheChunked` (`<= 15` filas/req, secuencial, sin `OFFSET`) |
| **`punches`** | **`371 MB`** | `304 MB` heap · ~549.5k filas (`breaks` JSONB) | Nunca `SELECT *` ni `OFFSET` profundo; filtrar fecha+tienda o usar SQL `RPC` |
| **`meat_consumption_history`** | **`367 MB`** | `247 MB` heap · `113+ MB` idx · ~812k filas | Usar RPCs `get_meat_consumption_ampm_summary` / `get_meat_consumption_totals_by_type` |
| **`order_ready_announcements`** | **`237 MB`** | `116 MB` heap · ~326.7k filas (3.5M idx scans) | Filtrar siempre por `store_id` + ventana corta; *backoff* con Realtime |
| **`dt_orders`** | **`231 MB`** | `91 MB` heap · ~414.1k filas | Agregar en SQL `RPC` y acotar `maxDays <= 95` |
| **`delivery_platform_orders`** | **`203 MB`** | `118 MB` heap · **`60 MB` TOAST** (`raw_payload`) · ~89.7k filas | Nunca `SELECT *` / `raw_payload` en listados; conservar filtro fecha aun con `search` |
| **`sales_discounts_log`** | **`161 MB`** | `116 MB` heap · ~556.9k filas | Agregar en servidor/SQL `RPC`; prohibido paginar 16 tiendas desde navegador |
| **`external_accounting_transactions`** | **`148 MB`** | `131 MB` heap · `1.8 MB` TOAST (`raw_data`/`line_items`) · ~18.9k filas | Nunca descargar toda la compañía; paginar por `txn_date` + columnas escalares |
| **`bc_todos`** / `bc_attachment_cache` / `bc_comments` | **`109 / 67 / 31 MB`** | ~14.9k / 32k filas | Usar filtros indexados (trigram en `bc_comments`); evitar N+1 en sync completo |
| **Otras sensibles (JSONB / alto volumen)** | `29–61 MB` | `sales_daily_cache` (`61 MB`, `hourly_data`), `inventory_counts` (`59 MB`, 219k filas), `shifts` (`47 MB`), `phone_calls` (`transcript`), `accounting_sales_packets`, `activity_logs`, `dt_halfhour_stats` (~720 filas/día) | Proyección escalar explícita, `maxDays` estricto y agregación SQL `RPC` |

## 2. Recetas de Código Aprobadas (Replicar — No Inventar)

### A. Lectura Segura de `pmix_daily_cache` (TOAST > 100 KB/fila)
- Importar `readPmixDailyCacheChunked` desde `@/lib/inventory/pmix-cache-reader` (`PMIX_SAFE_CHUNK_ROWS = 15`).
- Usar modo *streaming* (`onChunk`) al acumular totales multi-tienda para no retener cientos de MB JSONB en heap de Node/Vercel.
- **Nunca** atrapar errores de DB para disparar *fallback* en vivo contra Toast API sobre fechas históricas.

### B. Concurrencia Acotada (`<= 2–3`) en Multi-Tienda / Multi-Fecha
```ts
// Patrón aprobado (como STORE_CONCURRENCY = 2 en app/api/inventory/food-cost/route.ts)
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}
```
- **Prohibido**: `Promise.all(stores.map(...))` sobre 15 tiendas o `Promise.all(rows.map(r => supabase.update(...)))` dentro de un `GET`.

### C. Caché *Single-Flight* (vuelo único) + TTL Acotado en Rutas Analíticas
- Deduplicar peticiones simultáneas con `Map<string, Promise<T>>` (`inFlight`) + caché TTL en memoria (`30s–5m`) con tope de llaves (ej. `MAX_CACHE_KEYS = 50`, evacuando la más antigua) para evitar fugas de memoria (*memory leaks*) en funciones calientes de Vercel.

### D. Agregación SQL (`RPC`) y Paginación *Keyset* (Cero `OFFSET` Profundo)
- **Preferir siempre SQL `RPC`** (`GROUP BY`, `COUNT`, `SUM`, `LAG()`) para KPIs, conteos, P&L, reportes anuales o radares de riesgo en vez de traer decenas de miles de filas a Node.
- **Recordatorio PostgREST**: `.limit(5000)` se trunca silenciosamente a **`1,000` filas** (`max-rows`). Si necesitas iterar filas: usar paginación *keyset* (`.gt('id', lastId).order('id', { ascending: true }).limit(500)`) o `.order('id')` determinista + `MAX_PAGES` explícito.
- Fragmentar cualquier filtro `.in('col', ids)` en lotes de **`<= 150–200` elementos** (previene HTTP `414 URI Too Long`).

### E. Cabeceras Obligatorias de API Routes / Crons y `fetch()` Externo
- Exportar siempre `export const dynamic = 'force-dynamic'` y `export const maxDuration = 60` (o `300` en crons largos autorizados).
- Reutilizar el singleton `supabaseAdmin` (prohibido instanciar `createClient()` dentro del handler en cada petición).
- Todo `fetch()` externo DEBE incluir `signal: AbortSignal.timeout(25_000)` (15–30s), límite de reintentos `429` (`<= 4`) y un *time budget* interno (`Date.now() < deadlineMs`, ej. `240s` en crons de `300s`).
- Mantener autenticación *fail-closed* (`verifyStaffAuth` / `CRON_SECRET`) en todo cron y ruta administrativa.

### F. Migraciones SQL (`supabase/migrations/*.sql`)
- En tablas `> 10 MB`: usar **`CREATE INDEX CONCURRENTLY IF NOT EXISTS`** (fuera de bloques `BEGIN/COMMIT`) seguido de `ANALYZE public.<tabla>;`.
- Validar consultas críticas con `EXPLAIN (ANALYZE, BUFFERS)`: verificar `0` *temp disk spills* y uso de índice (sin `Seq Scan` sobre tablas >10 MB).
- Nunca eliminar ni aumentar sin justificación los timeouts de `pg_roles` (`service_role = 30s`, `authenticated = 8s`, `anon = 3s`).

### G. Scripts (`scripts/`, `scratch/`) y `vercel.json`
- En scripts Node/TSX en Windows: poner `import dns from 'node:dns'; dns.setDefaultResultOrder('ipv4first')` en la primera línea y cargar catálogos/contexto (`ctx`) una sola vez fuera de bucles.
- En `vercel.json`: conservar siempre `/api/cron/sync-sales` y `/api/cron/sync-labor`, evitar minuto `:00`, y escalonar crons pesados con **`>= 3–5 min`** de diferencia UTC.

## 3. Checklist Pre-Entrega (10 Verificaciones Rápidas)
1. [ ] Sin `SELECT *` ni columnas JSONB pesadas en listados o paginaciones.
2. [ ] `pmix_daily_cache` consultado únicamente vía `readPmixDailyCacheChunked` (`<= 15` filas).
3. [ ] `maxDays` validado y `skipCache` bloqueado/acotado en toda ruta por fechas.
4. [ ] Sin `Promise.all` sin tope (`concurrency <= 2–3`) ni escrituras masivas dentro de `GET`.
5. [ ] Errores de DB propagados (sin caer en tormentas Toast/QBO ni reintentar `522/524/57014`).
6. [ ] `AbortSignal.timeout(...)` + tope `429` en cada `fetch()` externo.
7. [ ] `export const dynamic = 'force-dynamic'` + `export const maxDuration` + singleton `supabaseAdmin`.
8. [ ] `.in(...)` fragmentado a `<= 150–200` y paginación con `.order('id')` + `MAX_PAGES` (o SQL `RPC`).
9. [ ] Cero `DELETE` + `INSERT` fuera de transacción (usar `UPSERT` o RPC transaccional).
10. [ ] Crons en `vercel.json` sin colisiones en el mismo minuto UTC y `npm run preflight:cloud` en `exit 0`.

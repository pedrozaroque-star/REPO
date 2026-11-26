---
trigger: always_on
description: "Regla obligatoria de protección de servidores Supabase (ci_small 2 GB RAM / PostgREST) y Vercel Functions/Crons en Tacos Gavilan: prohíbe lecturas TOAST/JSONB sin fragmentar, fan-out paralelo sin tope, rangos sin límite, tormentas de reintentos y polling agresivo."
---

# 🛡️ REGLA OBLIGATORIA: PROTECCIÓN DE SERVIDORES (SUPABASE + VERCEL) — Tacos Gavilan

Esta regla es **permanente, transversal e inquebrantable** para **CUALQUIER** módulo, ruta API (`app/api/`), librería (`lib/`), cron (`vercel.json`), herramienta del Chat IA (`lib/chat-tools.ts`), componente cliente (`app/`, `components/`) o script temporal (`scripts/`, `scratch/`).

## 1. Realidad de Infraestructura (Límites Físicos en Producción)
- **Supabase Producción (`teg-tacos-gavilan`, `ywwwdcvgfculqmcfkihq`, `us-west-1`)**: PostgreSQL `17.6` en instancia **`ci_small` (`2 GB RAM` compartidos** entre PostgreSQL, PostgREST, Auth, Storage y Realtime), `shared_buffers = 512 MB`, `work_mem = 5 MB`, `max_connections = 90`, tamaño de DB `~3.42 GB` (más grande que la RAM disponible).
- **Tráfico real en horas pico (`12:00–21:00 America/Los_Angeles`)**: **`1,400–2,024 reqs/min`** desde 15 sucursales (kioskos, TVs de orden lista, tablets de parrilla, app móvil, contestadora IA y panel gerencial).
- **Timeouts activos (`pg_roles`)**: `anon = 3s`, `authenticated / authenticator = 8s`, **`service_role = 30s statement_timeout / 30s idle_in_transaction / 10s lock_timeout`**. Nunca relajar estos límites.
- **Vercel Functions & Crons**: `40` crons activos en `vercel.json`; cada instancia *serverless* (sin servidor) es aislada (sin memoria compartida entre procesos) y sujeta a límites de `maxDuration` y memoria.

## 2. Incidente Real Canónico (*Postmortem* `2026-11-24`, `18:30:03–18:44:18 PST` — `14 min` de caída total)
> **NUNCA repetir este patrón en ningún módulo ni script:**
1. En cena pico (`1,818 reqs/min`), un script de auditoría (`audit_santa_ana_meats_deep_check.ts`) ejecutó `23` lecturas de `pmix_daily_cache` en `6 min` sin compartir contexto en memoria (`ctx`), moviendo `~196+ MB` de JSONB.
2. A las `18:28:58 PST`, `check_60d_meat_yields_and_cubana.ts` consultó `pmix_daily_cache` (`413 MB` totales, **`411 MB` en TOAST**, promedio **`~218 KB` JSONB/fila**, pico `472 KB`) pidiendo `15 tiendas × 62 días = 930 filas` con `limit=1000` en **una sola petición HTTP a PostgREST (`~202.5 MB` de JSON descomprimido)**.
3. En ese momento `service_role` tenía `rolconfig = null` (sin `statement_timeout` propio, heredando `120s` e `idle_in_transaction = 0` infinito). Al matar el proceso Node local, **la consulta siguió viva huérfana en PostgreSQL**, y además se reintentaron `3×` scripts pesados (`fast_30d_meat_benchmark.ts`) encima del servidor ya saturado.
4. **Consecuencia**: Cascada de Cloudflare **`522` / `524` / `521`**, **`57014 statement timeout`**, **4/6 servicios `UNHEALTHY`** (`db`, `rest`, `auth`, `storage`) y **reinicio forzado OOM** (*Out-Of-Memory* / falta de memoria) de PostgreSQL a las `18:44:18 PST`.

## 3. Las 8 Leyes Inquebrantables de Protección de Servidores

1. **Cero `SELECT *` ni lecturas masivas en tablas grandes o con `JSONB` / `TOAST`**:
   - En `pmix_daily_cache` (y cualquier tabla con blobs >100 KB/fila): **PROHIBIDO** leer `> 15` filas por petición HTTP. Usar siempre `readPmixDailyCacheChunked` (secuencial, `<= 15` filas, sin `OFFSET`).
   - En tablas grandes (`punches`, `meat_consumption_history`, `order_ready_announcements`, `dt_orders`, `delivery_platform_orders`, `sales_discounts_log`, `external_accounting_transactions`, `bc_todos`, `sales_daily_cache`, `phone_calls`, `accounting_sales_packets`, `activity_logs`, `dt_halfhour_stats`): proyectar **solo columnas escalares explícitas** (jamás `SELECT *` ni `raw_payload`/`raw_data`/`transcript`/`hourly_data` en listados), usar `.order('id')` determinista + `MAX_PAGES` (o paginación *keyset* / SQL `RPC` agregada) y fragmentar `.in(...)` a `<= 150–200` ítems.
2. **Cero *Fan-Out* (abanico paralelo) sin tope ni escrituras en `GET`**:
   - **PROHIBIDO** `Promise.all(stores.map(...))` o `Promise.all(dates.map(...))` sin límite sobre 15 sucursales, DB, Toast, QuickBooks, ClearNine o RONOS. Limitar la concurrencia (*concurrency cap*) a **`<= 2–3`** (o secuencial).
   - **PROHIBIDO** ejecutar ráfagas de `UPDATE`/`UPSERT`/`DELETE` o *seeding* dentro de endpoints `GET`.
3. **Candados obligatorios de rango (`maxDays`) y `skipCache`**:
   - Toda ruta API con `startDate..endDate` DEBE validar y acotar `maxDays` (`<= 35–65` días para detalle/JSONB; `<= 95` días para estadísticas; `<= 366` días solo para resúmenes agregados en SQL).
   - **PROHIBIDO** permitir `skipCache=true` sin candado sobre rangos multi-día o todas las tiendas (bloquear o restringir a admin y `<= 1` día).
4. **Cero amplificación de fallos (*Retry-Piling* y *Error Swallowing*)**:
   - **PROHIBIDO** reintentar consultas pesadas ante `522`, `524`, `521` o `57014`. Si un query/script se cuelga: **DETENERSE** y verificar estado/logs en Supabase antes de re-lanzar (matar Node local **NO** cancela el query en PostgreSQL).
   - **PROHIBIDO** silenciar errores de lectura de caché DB (`catch { // silent }`) para caer en tormentas de Toast/QBO en vivo + `UPSERT` masivos. Propagar el error explícitamente.
   - **PROHIBIDO** ejecutar recálculos pesados de 15 tiendas síncronamente dentro de endpoints consultados periódicamente (`/api/dashboard/*`): devolver caché existente + `partial: true`.
5. **Seguridad obligatoria en scripts (`scripts/`, `scratch/`) y Chat IA (`execute_sql`)**:
   - Todo script `tsx`/`node` contra producción DEBE: fijar `dns.setDefaultResultOrder('ipv4first')` en Windows, reutilizar un único contexto compartido (`ctx`) en memoria sin re-leer tablas dentro de bucles, y usar lecturas fragmentadas (`<= 15` filas en TOAST) o `RPC`/`LIMIT`.
   - Durante horas pico (**`12:00–21:00 America/Los_Angeles`**): **PROHIBIDO** lanzar barridos históricos multi-mes o >10 consultas pesadas consecutivas sin fragmentación y pausas.
   - En `lib/chat-tools.ts` (`execute_sql`): exigir `LIMIT <= 200`, timeout corto (`8s`) y bloquear `SELECT *`/JSONB sin filtro en tablas pesadas.
6. **Higiene de Vercel Functions, *Timeouts* externos y atomicidad**:
   - Todo `fetch()` externo (Toast, QBO, ClearNine, RONOS, Wholesail, Twilio, Gemini) DEBE usar `AbortSignal.timeout(15_000..30_000)` y tope de reintentos `429` (`<= 4`).
   - Toda ruta pesada o cron DEBE exportar `export const dynamic = 'force-dynamic'` + `export const maxDuration = ...`, reutilizar `supabaseAdmin` (nunca `createClient()` nuevo por request) y respetar un presupuesto de tiempo interno (`time budget`).
   - **PROHIBIDO** `DELETE` + `INSERT` fuera de transacción para reconstruir tablas (un timeout borra datos en producción); usar `UPSERT` atómico o función SQL transaccional.
7. **Higiene de *Polling* (sondeo) en Frontend y Kioskos 24/7**:
   - Todo `setInterval` DEBE pausar si `document.visibilityState !== 'visible'`, cancelar vuelos previos con `AbortController`, reducir frecuencia (*backoff*) cuando Supabase Realtime esté `SUBSCRIBED`, y reducir a `>= 60s` en horas muertas (`04:15–06:59 AM America/Los_Angeles`).
8. **Escalonamiento de Crons en `vercel.json` y DDL online**:
   - Nunca co-programar crons pesados de Toast/DB/QBO/RONOS en el mismo minuto UTC ni apilarlos en `:00`; mantener separación mínima de **`>= 3–5 min`**.
   - Todo índice sobre tablas `> 10 MB` DEBE crearse con `CREATE INDEX CONCURRENTLY IF NOT EXISTS` seguido de `ANALYZE`.

> Para el *checklist* técnico, recetas de código aprobadas y el mapa de pesos reales de tablas, consultar `.agents/rules/api-cron-db-guardrails.md`.

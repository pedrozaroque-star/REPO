# ☁️ CONTEXTO OPERATIVO Y REMOTE AGENTS — Tacos Gavilan

> Nota: Las reglas completas de negocio, auditoría, seguridad y protocolos del proyecto residen en el archivo raíz [`AGENTS.md`](../AGENTS.md). Este archivo resume los identificadores oficiales para sesiones locales y **Google Antigravity Remote Agents** (sin depender del PC).

## 🔑 Identificadores Canónicos (No Secretos)
- **Marca Oficial**: `Tacos Gavilan` (moneda exclusiva: `USD` dólares y centavos; sin pasteles de cumpleaños, solo `Flan` y `Cheesecake` individuales).
- **Nomenclatura Sucursales Los Ángeles para Clientes (`lib/customer-store-names.ts`)**: Internamente se usan `LA Broadway` (#5), `LA Central` (#6) y `Slauson` (#7); **frente al cliente SIEMPRE decir `Los Ángeles` + entrecalles**: `#5 Los Ángeles (Vernon y Broadway)`, `#6 Los Ángeles (Central y Washington)` y `#7 Los Ángeles (Slauson y Broadway)`.
- **Repositorio GitHub**: `pedrozaroque-star/REPO` (rama de producción: `main`)
- **Proyecto Supabase Producción**: `teg-tacos-gavilan`
  - `project_id`: `ywwwdcvgfculqmcfkihq`
  - `region`: `us-west-1`
  - ⚠️ **CANDADO MULTI-PROYECTO**: Nunca consultar ni mutar `MotoCruz` (`cjuaolbneuyzvhdtqtiw`) ni `candy` (`zwevlqbnqdynfkryewcq`).
- **Proyecto Vercel Producción**: `tacosgavilan`
  - `projectId`: `prj_ZqezfSQCqko7rz64nQOsJS7Oqavp`
  - `teamId`: `team_gizPjG5JHpw8Bd580QMnSELN`
- **Horario Laboral (`America/Los_Angeles`)**: Día laboral de `06:00 AM` a `05:59 AM` del día siguiente; turno PM inicia `05:00 PM`.

## 🛡️ Protección de Servidores (Supabase `2 GB RAM` + Vercel)
- **Regla Permanente**: Cumplir estrictamente [`.agents/rules/server-db-protection.md`](./rules/server-db-protection.md) y [`.agents/rules/api-cron-db-guardrails.md`](./rules/api-cron-db-guardrails.md) en **todo** módulo, API, cron, chat tool o script (`scratch/`).
- Prohibido `SELECT *` en tablas pesadas/JSONB, lecturas `> 15` filas de `pmix_daily_cache`, `Promise.all` sin tope (`<= 2–3`), rangos sin `maxDays`, reintentos en cascada sobre `522/524/57014`, escrituras en `GET`, `fetch()` sin `AbortSignal.timeout` o colisiones de crons.

## 🛠️ Comandos de Verificación en la Nube
- **Chequeo completo pre-despliegue**: `npm run preflight:cloud` (valida tamaño de `AGENTS.md`, crons en `vercel.json`, ejecuta `next typegen` y `tsc --noEmit` sin requerir `.env`).
- **Solo TypeScript**: `npm run typecheck`.

## 🚀 Runbook Remoto (Skill Obligatorio)
Al trabajar desde un entorno Linux en la nube (`antigravity.google.com`), ejecutar migraciones remotas en Supabase o desplegar a Vercel, activar y seguir el skill [`remote-cloud-ops`](./skills/remote-cloud-ops/SKILL.md).

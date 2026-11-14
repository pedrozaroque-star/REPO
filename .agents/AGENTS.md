# ☁️ CONTEXTO OPERATIVO Y REMOTE AGENTS — Tacos Gavilan

> Nota: Las reglas completas de negocio, auditoría, seguridad y protocolos del proyecto residen en el archivo raíz [`AGENTS.md`](../AGENTS.md). Este archivo resume los identificadores oficiales para sesiones locales y **Google Antigravity Remote Agents** (sin depender del PC).

## 🔑 Identificadores Canónicos (No Secretos)
- **Marca Oficial**: `Tacos Gavilan`
- **Repositorio GitHub**: `pedrozaroque-star/REPO` (rama de producción: `main`)
- **Proyecto Supabase Producción**: `teg-tacos-gavilan`
  - `project_id`: `ywwwdcvgfculqmcfkihq`
  - `region`: `us-west-1`
  - ⚠️ **CANDADO MULTI-PROYECTO**: Nunca consultar ni mutar `MotoCruz` (`cjuaolbneuyzvhdtqtiw`) ni `candy` (`zwevlqbnqdynfkryewcq`).
- **Proyecto Vercel Producción**: `tacosgavilan`
  - `projectId`: `prj_ZqezfSQCqko7rz64nQOsJS7Oqavp`
  - `teamId`: `team_gizPjG5JHpw8Bd580QMnSELN`
- **Horario Laboral (`America/Los_Angeles`)**: Día laboral de `06:00 AM` a `05:59 AM` del día siguiente; turno PM inicia `05:00 PM`.

## 🛠️ Comandos de Verificación en la Nube
- **Chequeo completo pre-despliegue**: `npm run preflight:cloud` (valida tamaño de `AGENTS.md`, crons en `vercel.json`, ejecuta `next typegen` y `tsc --noEmit` sin requerir `.env`).
- **Solo TypeScript**: `npm run typecheck`.

## 🚀 Runbook Remoto (Skill Obligatorio)
Al trabajar desde un entorno Linux en la nube (`antigravity.google.com`), ejecutar migraciones remotas en Supabase o desplegar a Vercel, activar y seguir el skill [`remote-cloud-ops`](./skills/remote-cloud-ops/SKILL.md).

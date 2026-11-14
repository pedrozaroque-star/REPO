---
name: remote-cloud-ops
description: >-
  Runbook and verification workflow for operating Tacos Gavilan from Google Antigravity Remote Agents (cloud/mobile without a local PC), executing safe Supabase MCP migrations/queries, running clean-clone TypeScript checks, and deploying to Vercel via GitHub. Activate whenever running in a Linux cloud sandbox without .env.local, deploying to Vercel, or applying Supabase database changes remotely.
---

# Remote Cloud Ops — Tacos Gavilan (Remote Agents / Mobile-First)

Este procedimiento garantiza que cualquier sesión de **Google Antigravity Remote Agents** (Linux cloud sandbox sin acceso a la PC de Windows ni a archivos `.env.local` locales) opere, verifique y despliegue cambios en **Tacos Gavilan** de forma idéntica a la PC local.

## 1. Environment Bootstrap en Cloud Sandbox
1. Verificar si existe `node_modules` en la raíz del repositorio:
   - Si no existe, instalar dependencias limpias de forma determinista:
     ```bash
     npm ci --prefer-offline --no-audit
     ```
2. **Prohibido crear o subir secretos**:
   - NUNCA crear archivos `.env*` falsos ni incluir credenciales reales en commits o código fuente.
   - Si una tarea solo requiere verificación estática, compilación de tipos o cambios de código + DB vía MCP, `npm run preflight:cloud` funciona sin variables `.env`.

## 2. Operaciones en Supabase vía MCP (`supabase-mcp-server`)
1. **Candado Estricto de Proyecto**:
   - Usar **SIEMPRE** `project_id: "ywwwdcvgfculqmcfkihq"` (`teg-tacos-gavilan`, `us-west-1`).
   - PROHIBIDO ejecutar consultas, migraciones o cambios sobre `cjuaolbneuyzvhdtqtiw` (`MotoCruz`) o `zwevlqbnqdynfkryewcq` (`candy`).
2. **Inspección de Columnas Generadas (Prevención `428C9`)**:
   - Antes de escribir o modificar endpoints/scripts con `INSERT` o `UPDATE`, consultar el esquema real con `execute_sql`:
     ```sql
     SELECT column_name, data_type, is_generated, generation_expression
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '<tabla>';
     ```
   - Nunca incluir columnas con `is_generated = 'ALWAYS'` ni valores derivados en payloads de mutación.
3. **Doble Sincronización de Migraciones (Supabase + Git)**:
   - Toda alteración DDL aprobada debe aplicarse con `apply_migration` en `ywwwdcvgfculqmcfkihq` **Y** guardarse en el repositorio bajo `supabase/migrations/YYYYMMDDHHMMSS_<descripcion>.sql` para mantener paridad exacta entre Git y producción.
4. **Auditoría de Seguridad RLS**:
   - Después de crear o alterar tablas, ejecutar `get_advisors` (`type: "security"`) en `ywwwdcvgfculqmcfkihq` para confirmar que Row Level Security (RLS) y las políticas estén habilitadas.

## 3. Verificación Pre-Despliegue Obligatoria
1. Ejecutar el chequeo integral en terminal:
   ```bash
   npm run preflight:cloud
   ```
   Esto valida:
   - Que `AGENTS.md` pesa `< 24,000` bytes (sin truncamiento silencioso),
   - Que `vercel.json` es JSON válido y conserva los crons obligatorios `/api/cron/sync-sales` y `/api/cron/sync-labor`,
   - Que `npx next typegen` y `npx tsc --noEmit` terminan con **0 errores**.
2. **Sincronización del Asistente IA (`TEG Assistant Sync`)**:
   - Si se crearon, editaron o eliminaron funcionalidades, endpoints, reglas de negocio o tablas, actualizar `app/api/support-chat/route.ts` y `lib/chat-tools.ts`.
3. **Aislamiento de Reportes**:
   - En chats de desarrollo/operación técnica, PROHIBIDO modificar `scripts/*_full_data.json` o `lib/reports-data.ts`.

## 4. Despliegue a Vercel y Monitoreo (Solo tras Aprobación Explícita)
1. **Cero Auto-Commits**:
   - Reportar al usuario el resumen de cambios y el resultado de `npm run preflight:cloud`, y esperar confirmación explícita antes de hacer `git commit` o `git push`.
2. **Push Limpio y Explícito**:
   - Cuando el usuario autorice desplegar:
     - Verificar `git status` y hacer `git add <rutas-explicitas>` únicamente de los archivos modificados para la tarea (NUNCA usar `git add .` ni `git add -A` si hubiera otros archivos sucios).
     - Hacer `git commit -m "<tipo>(<alcance>): <resumen>"` y `git push origin main`.
3. **Seguimiento en Vercel MCP (`vercel-plugin_vercel`)**:
   - Al empujar a `main`, Vercel despliega automáticamente el proyecto `tacosgavilan` (`projectId: "prj_ZqezfSQCqko7rz64nQOsJS7Oqavp"`, `teamId: "team_gizPjG5JHpw8Bd580QMnSELN"`).
   - Verificar el progreso con `list_deployments` / `get_deployment` hasta que el estado sea `READY`. Si falla, inspeccionar logs con `list_deployment_events` y reportar al usuario de inmediato.

## 5. Guía para el Usuario en Teléfono
- Para instrucciones paso a paso de conexión móvil en `https://antigravity.google.com`, consultar [`references/MOBILE_SETUP_GUIDE.md`](./references/MOBILE_SETUP_GUIDE.md).

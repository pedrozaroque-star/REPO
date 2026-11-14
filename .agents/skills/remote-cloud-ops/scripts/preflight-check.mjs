/**
 * @module remote-cloud-ops/preflight-check
 * @description Script multiplataforma (Windows PowerShell y Linux Cloud Bash) de verificación previa al despliegue en la nube para Google Antigravity Remote Agents.
 * @businessRules
 * - AGENTS.md debe mantenerse por debajo de 24,000 bytes para evitar truncamiento silencioso de reglas en Antigravity.
 * - vercel.json debe ser JSON válido y conservar los dos crons críticos de Toast API: /api/cron/sync-sales y /api/cron/sync-labor.
 * - TypeScript debe compilar limpio con `next typegen` + `tsc --noEmit` sin depender de archivos `.env` locales.
 * @dataFlow
 * - Lee AGENTS.md y vercel.json -> valida estructura y límites -> ejecuta `npx next typegen` y `npx tsc --noEmit` -> reporta resumen con rama git actual.
 * @notes
 * - No modifica archivos ni ejecuta git commit/push; solo valida integridad antes de solicitar aprobación al usuario.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const MAX_AGENTS_BYTES = 24000;
const REQUIRED_CRONS = ['/api/cron/sync-sales', '/api/cron/sync-labor'];

function fail(message) {
  console.error(`\n[PREFLIGHT ERROR] ${message}`);
  process.exit(1);
}

// 1. Validar tamaño de AGENTS.md
const agentsPath = path.join(ROOT_DIR, 'AGENTS.md');
if (!fs.existsSync(agentsPath)) {
  fail('No se encontró AGENTS.md en la raíz del proyecto.');
}
const agentsBytes = fs.statSync(agentsPath).size;
if (agentsBytes >= MAX_AGENTS_BYTES) {
  fail(
    `AGENTS.md pesa ${agentsBytes} bytes y supera el límite seguro de ${MAX_AGENTS_BYTES} bytes.`
  );
}
console.log(`[1/4] AGENTS.md OK (${agentsBytes} / ${MAX_AGENTS_BYTES} bytes)`);

// 2. Validar vercel.json y crons críticos de Toast API
const vercelPath = path.join(ROOT_DIR, 'vercel.json');
if (!fs.existsSync(vercelPath)) {
  fail('No se encontró vercel.json en la raíz del proyecto.');
}
let vercelConfig;
try {
  vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
} catch (err) {
  fail(`vercel.json contiene JSON inválido: ${err.message}`);
}

const cronPaths = new Set(
  Array.isArray(vercelConfig?.crons) ? vercelConfig.crons.map((c) => c?.path).filter(Boolean) : []
);
for (const requiredCron of REQUIRED_CRONS) {
  if (!cronPaths.has(requiredCron)) {
    fail(`Falta el cron obligatorio "${requiredCron}" en vercel.json.`);
  }
}
console.log(
  `[2/4] vercel.json OK (${vercelConfig.crons.length} crons configurados; Toast sync-sales & sync-labor presentes)`
);

// 3. Generar tipos de rutas de Next.js 16 y correr chequeo estricto de TypeScript
console.log('[3/4] Ejecutando npx next typegen...');
try {
  execSync('npx next typegen', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch {
  fail('Falló `npx next typegen`. Revisa errores de rutas o configuración de Next.js.');
}

console.log('[4/4] Ejecutando npx tsc --noEmit...');
try {
  execSync('npx tsc --noEmit', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch {
  fail('Falló `npx tsc --noEmit`. Corrige los errores de TypeScript antes de desplegar.');
}

let currentBranch = 'desconocida';
try {
  currentBranch = execSync('git branch --show-current', {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim() || 'HEAD';
} catch {
  // Ignorar si se corre fuera de contexto git completo
}

console.log(
  `\n[PREFLIGHT OK] Listo para aprobación de commit/push. Rama actual: ${currentBranch}. (Recuerda: nunca hacer git commit/push sin autorización explícita del usuario).`
);

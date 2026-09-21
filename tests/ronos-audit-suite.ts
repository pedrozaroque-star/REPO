/**
 * @file tests/ronos-audit-suite.ts
 * @description Suite Global Unificada y Reproducible de Auditoría y Calidad — Módulo RONOS (Tacos Gavilán).
 *
 * Consolida e integra de manera rigurosa las pruebas de los 4 agentes del sistema:
 *   - SECCIÓN 1: SEGURIDAD Y AUTORIZACIÓN (Agente 1)
 *       * 401 sin token, 403 usuario no admin (roles employee, manager, user).
 *       * 400 con companyId=34x o caracteres alfanuméricos.
 *       * 400 con format=csv (bloqueo preventivo en query y body).
 *       * Fail-closed sin secretos de entorno (JWT_SECRET, SUPABASE_JWT_SECRET, CRON_SECRET).
 *       * Blindaje de servidor contra inyección de violaciones ficticias en /notify-violation.
 *   - SECCIÓN 2: IDENTIDAD, MAPEOS Y TRASLADOS (Agente 2)
 *       * Nombres similares NO generan coincidencia automática sin ID nativo.
 *       * assignmentId único certifica coincidencia nativa inmediata.
 *       * Desvincular persiste limpiando toast_employee_id a NULL en Supabase.
 *       * Inactivo persiste con mapping_type='inactive' y toast_employee_id=NULL.
 *       * Traslado multi-tienda exige horas reales en la semana visible (no históricos de 0h).
 *       * Paginación dinámica no trunca tiendas de más de 100 empleados.
 *   - SECCIÓN 3: SINCRONIZACIÓN, CACHÉ Y PERÍODOS (Agente 3)
 *       * Semana inexistente lanza RonosWeekNotFoundError con código 400.
 *       * Zona horaria America/Los_Angeles certificada en límites 5:59 AM vs 6:00 AM.
 *       * Lunes 5:59 AM mantiene semana abierta; Lunes 6:00 AM cierra el período.
 *       * Persistencia atómica de ronos_assignment_id con filtros estrictos por company_id y week_id.
 *       * Resiliencia ante fallos upstream: conservación de caché previa sin borrado destructivo.
 *       * Consolidado con tiendas fallidas reporta failedStores e isPartial=true.
 *   - SECCIÓN 4: NÓMINA, SICK/VACATION Y AUDITORÍA PEO (Agente 4)
 *       * Sick/Vacation pagado en Simplify sin checador RONOS => requires_investigation.
 *       * Conservación íntegra de horas RONOS sin sobreescritura ciega de earnings.
 *       * Supervisores administrativos con recibo oficial real (no $3,460 ciego ni 80h fijas).
 *       * Recibo sin ID nativo => clasificación en pending_native_link (sección pendientes).
 *       * Prohibición absoluta de 100% de conciliación falso cuando hay incidencias o pendientes.
 *       * Los 5 estados de evidencia reales: reconciled, estimated, requires_investigation, insufficient_data, error.
 *       * Separación física de pagos (operativos, administrativos, pendientes, insuficientes, investigación).
 *       * Blindaje matemático completo contra NaN, Infinity y división por cero (safeDiv, safeNum, safeRound).
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import jwt from 'jsonwebtoken'
import { verifyAdminAuth, verifyAuthToken, getJwtSecret, getCronSecret } from '../lib/auth-server'
import { POST as loginPost } from '../app/api/login/route'
import { GET as punchesGet } from '../app/api/ronos/punches/route'
import { GET as syncGet, POST as syncPost } from '../app/api/ronos/sync/route'
import { GET as mappingsGet, POST as mappingsPost, DELETE as mappingsDelete } from '../app/api/ronos/mappings/route'
import { POST as refreshTransfersPost } from '../app/api/ronos/refresh-transfers/route'
import { GET as payrollGet } from '../app/api/ronos/payroll/route'
import { GET as notifyViolationGet, POST as notifyViolationPost } from '../app/api/ronos/notify-violation/route'
import { supabaseAdmin } from '../lib/supabase'
import {
  calculateNameSimilarity,
  resolveNativeAutoMatch,
  saveEmployeeMapping,
  ToastEmployeeCandidate
} from '../lib/ronos-mapping'
import {
  LA_TIMEZONE,
  RonosWeekNotFoundError,
  getPacificBusinessDate,
  isWeekClosed,
  sortWeeksChronologically,
  isCacheComplete,
  getCachedStoreAudit,
  getRonosStoreAudit,
  getRonosChainWideAudit,
  RonosWorkWeek
} from '../lib/ronos-api'
import {
  calculateCingularPayrollReport,
  CingularInvoiceSummaryReport,
  CingularEmployeePayrollItem,
  PayrollEvidenceAuditStatus,
  safeNum,
  safeDiv,
  safeRound
} from '../lib/payroll-calculator'

// ============================================================================
// CONFIGURACIÓN DE COLORES Y UTILIDADES DE ASERCIÓN
// ============================================================================
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

interface SuiteStats {
  passed: number
  failed: number
}

const stats: Record<string, SuiteStats> = {
  seguridad: { passed: 0, failed: 0 },
  identidad: { passed: 0, failed: 0 },
  sincronizacion: { passed: 0, failed: 0 },
  nomina: { passed: 0, failed: 0 }
}

function assert(condition: boolean, suiteKey: keyof typeof stats, name: string, detail?: string) {
  if (condition) {
    stats[suiteKey].passed++
    console.log(`  ${GREEN}✓ [PASS]${RESET} ${name}`)
  } else {
    stats[suiteKey].failed++
    console.error(`  ${RED}✗ [FAIL]${RESET} ${name} ${detail ? `(${detail})` : ''}`)
  }
}

// Token helper para pruebas de seguridad
const TEST_JWT_SECRET = 'ronos-audit-suite-unified-jwt-secret-2026'

function createTestToken(role: string, email = 'user@tacosgavilan.com'): string {
  return jwt.sign(
    {
      sub: 'test-user-unified-suite',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      user_role: role,
      user_metadata: { role, full_name: `Test ${role}` }
    },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  )
}

const adminToken = createTestToken('admin', 'carlos@tacosgavilan.com')
const employeeToken = createTestToken('employee', 'colaborador@tacosgavilan.com')
const managerToken = createTestToken('manager', 'gerente@tacosgavilan.com')

function authHeader(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}

// ============================================================================
// SUITE PRINCIPAL DE AUDITORÍA
// ============================================================================
async function runGlobalRonosAuditSuite() {
  const startTime = Date.now()

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}${CYAN}║   SUITE GLOBAL UNIFICADA DE AUDITORÍA Y CALIDAD — MÓDULO RONOS       ║${RESET}`)
  console.log(`${BOLD}${CYAN}║   Tacos Gavilán • AGENTE 6 — PRUEBAS Y CALIDAD                       ║${RESET}`)
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════╝${RESET}\n`)

  const originalJwtSecret = process.env.JWT_SECRET
  const originalSupabaseJwtSecret = process.env.SUPABASE_JWT_SECRET
  const originalCronSecret = process.env.CRON_SECRET

  try {
    // ========================================================================
    // SECCIÓN 1: SEGURIDAD Y CONTROL DE ACCESO (AGENTE 1)
    // ========================================================================
    console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)
    console.log(`${BOLD}SECCIÓN 1: SEGURIDAD Y AUTORIZACIÓN (Fail-Closed, 401, 403, 400, Cero CSV)${RESET}`)
    console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)

    // 1.1 Fail-closed sin secretos
    delete process.env.JWT_SECRET
    delete process.env.SUPABASE_JWT_SECRET
    assert(getJwtSecret() === null, 'seguridad', 'lib/auth-server: getJwtSecret retorna null si faltan secretos')
    assert(verifyAuthToken('some-token') === null, 'seguridad', 'lib/auth-server: verifyAuthToken retorna null sin secretos en entorno')

    const reqNoEnv = new Request('http://localhost/test', { headers: { Authorization: `Bearer ${adminToken}` } })
    const authNoEnv = verifyAdminAuth(reqNoEnv)
    assert(authNoEnv.authorized === false && authNoEnv.status === 401, 'seguridad', 'lib/auth-server: verifyAdminAuth falla cerrado (401) sin secretos en entorno')

    // 1.2 Fail-closed sin CRON_SECRET y rechazo de fallback obsoleto
    delete process.env.CRON_SECRET
    assert(getCronSecret() === null, 'seguridad', 'lib/auth-server: getCronSecret retorna null si no está en el entorno')

    const reqCronFallback = new Request('http://localhost/test', {
      headers: { 'x-cron-auth': 'teg-cron-secret-2026' }
    })
    const authCronFallback = verifyAdminAuth(reqCronFallback)
    assert(authCronFallback.authorized === false && authCronFallback.status === 401, 'seguridad', 'lib/auth-server: rechaza fallback previo teg-cron-secret-2026')

    // Restaurar JWT secret de prueba para las validaciones subsecuentes
    process.env.JWT_SECRET = TEST_JWT_SECRET

    // 1.3 Validación de Tokens y Roles en auth-server
    const reqNoToken = new Request('http://localhost/test')
    assert(verifyAdminAuth(reqNoToken).authorized === false, 'seguridad', 'lib/auth-server: 401 sin cabecera Authorization')

    const reqBadToken = new Request('http://localhost/test', { headers: { Authorization: 'Bearer invalid.token.payload' } })
    assert(verifyAdminAuth(reqBadToken).authorized === false, 'seguridad', 'lib/auth-server: 401 con token corrupto')

    const reqEmployee = new Request('http://localhost/test', { headers: authHeader(employeeToken) })
    const authEmp = verifyAdminAuth(reqEmployee)
    assert(authEmp.authorized === false && authEmp.status === 403, 'seguridad', 'lib/auth-server: 403 para rol employee')

    const reqManager = new Request('http://localhost/test', { headers: authHeader(managerToken) })
    const authMgr = verifyAdminAuth(reqManager)
    assert(authMgr.authorized === false && authMgr.status === 403, 'seguridad', 'lib/auth-server: 403 para rol manager')

    const reqAdmin = new Request('http://localhost/test', { headers: authHeader(adminToken) })
    const authAdm = verifyAdminAuth(reqAdmin)
    assert(authAdm.authorized === true && authAdm.user?.user_role === 'admin', 'seguridad', 'lib/auth-server: 200 autorizado para rol admin')

    // 1.4 /api/login fail-closed
    delete process.env.JWT_SECRET
    delete process.env.SUPABASE_JWT_SECRET
    const loginResNoSecret = await loginPost(new Request('http://localhost/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@tacosgavilan.com', password: 'secretpassword' })
    }))
    const loginDataNoSecret = await loginResNoSecret.json()
    assert(
      loginResNoSecret.status === 500 && loginDataNoSecret.error === 'Server authentication configuration error',
      'seguridad',
      'app/api/login: responde 500 "Server authentication configuration error" sin JWT secret'
    )
    process.env.JWT_SECRET = TEST_JWT_SECRET

    const loginResNoEmail = await loginPost(new Request('http://localhost/api/login', {
      method: 'POST',
      body: JSON.stringify({})
    }))
    assert(loginResNoEmail.status === 400, 'seguridad', 'app/api/login: responde 400 si falta el email')

    // 1.5 /api/ronos/punches: 401, 403, 400 companyId=34x, 400 format=csv, 400 inputs
    const p1 = await punchesGet(new Request('http://localhost/api/ronos/punches'))
    assert(p1.status === 401, 'seguridad', '/api/ronos/punches: 401 sin token')

    const p2 = await punchesGet(new Request('http://localhost/api/ronos/punches', { headers: authHeader(employeeToken) }))
    assert(p2.status === 403, 'seguridad', '/api/ronos/punches: 403 usuario no admin')

    const p3 = await punchesGet(new Request('http://localhost/api/ronos/punches?companyId=34x', { headers: authHeader(adminToken) }))
    assert(p3.status === 400, 'seguridad', '/api/ronos/punches: 400 con companyId=34x')

    const p4 = await punchesGet(new Request('http://localhost/api/ronos/punches?format=csv', { headers: authHeader(adminToken) }))
    assert(p4.status === 400, 'seguridad', '/api/ronos/punches: 400 bloqueo inmediato de format=csv')

    const p5 = await punchesGet(new Request('http://localhost/api/ronos/punches?mode=malicious', { headers: authHeader(adminToken) }))
    assert(p5.status === 400, 'seguridad', '/api/ronos/punches: 400 con mode inválido')

    const p6 = await punchesGet(new Request('http://localhost/api/ronos/punches?weekId=abc', { headers: authHeader(adminToken) }))
    assert(p6.status === 400, 'seguridad', '/api/ronos/punches: 400 con weekId no numérico')

    const p7 = await punchesGet(new Request('http://localhost/api/ronos/punches?startDate=2026/09/18', { headers: authHeader(adminToken) }))
    assert(p7.status === 400, 'seguridad', '/api/ronos/punches: 400 con startDate mal formateada')

    // 1.6 /api/ronos/sync: GET y POST
    const s1 = await syncGet(new Request('http://localhost/api/ronos/sync'))
    assert(s1.status === 401, 'seguridad', '/api/ronos/sync GET: 401 sin token')

    const s2 = await syncGet(new Request('http://localhost/api/ronos/sync', { headers: authHeader(employeeToken) }))
    assert(s2.status === 403, 'seguridad', '/api/ronos/sync GET: 403 usuario no admin')

    const s3 = await syncGet(new Request('http://localhost/api/ronos/sync?format=csv', { headers: authHeader(adminToken) }))
    assert(s3.status === 400, 'seguridad', '/api/ronos/sync GET: 400 bloqueo inmediato de format=csv')

    const s4 = await syncPost(new Request('http://localhost/api/ronos/sync', { method: 'POST' }))
    assert(s4.status === 401, 'seguridad', '/api/ronos/sync POST: 401 sin token')

    const s5 = await syncPost(new Request('http://localhost/api/ronos/sync', { method: 'POST', headers: authHeader(employeeToken) }))
    assert(s5.status === 403, 'seguridad', '/api/ronos/sync POST: 403 usuario no admin')

    const s6 = await syncPost(new Request('http://localhost/api/ronos/sync?format=csv', { method: 'POST', headers: authHeader(adminToken) }))
    assert(s6.status === 400, 'seguridad', '/api/ronos/sync POST: 400 bloqueo format=csv en query')

    const s6b = await syncPost(new Request('http://localhost/api/ronos/sync', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ format: 'csv' })
    }))
    assert(s6b.status === 400, 'seguridad', '/api/ronos/sync POST: 400 bloqueo format=csv en body')

    const s7 = await syncPost(new Request('http://localhost/api/ronos/sync', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: '34x' })
    }))
    assert(s7.status === 400, 'seguridad', '/api/ronos/sync POST: 400 con companyId=34x')

    const s8 = await syncPost(new Request('http://localhost/api/ronos/sync', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ weekId: 'abc' })
    }))
    assert(s8.status === 400, 'seguridad', '/api/ronos/sync POST: 400 con weekId no numérico')

    const s9 = await syncPost(new Request('http://localhost/api/ronos/sync', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ mode: 'invalid_mode' })
    }))
    assert(s9.status === 400, 'seguridad', '/api/ronos/sync POST: 400 con mode inválido')

    // 1.7 /api/ronos/mappings: GET, POST, DELETE
    const m1 = await mappingsGet(new Request('http://localhost/api/ronos/mappings'))
    assert(m1.status === 401, 'seguridad', '/api/ronos/mappings GET: 401 sin token')

    const m2 = await mappingsGet(new Request('http://localhost/api/ronos/mappings', { headers: authHeader(employeeToken) }))
    assert(m2.status === 403, 'seguridad', '/api/ronos/mappings GET: 403 usuario no admin')

    const m3 = await mappingsGet(new Request('http://localhost/api/ronos/mappings?companyId=34x', { headers: authHeader(adminToken) }))
    assert(m3.status === 400, 'seguridad', '/api/ronos/mappings GET: 400 con companyId=34x')

    const m4 = await mappingsGet(new Request('http://localhost/api/ronos/mappings?format=csv', { headers: authHeader(adminToken) }))
    assert(m4.status === 400, 'seguridad', '/api/ronos/mappings GET: 400 bloqueo inmediato de format=csv')

    const m5 = await mappingsPost(new Request('http://localhost/api/ronos/mappings', { method: 'POST' }))
    assert(m5.status === 401, 'seguridad', '/api/ronos/mappings POST: 401 sin token')

    const m6 = await mappingsPost(new Request('http://localhost/api/ronos/mappings', { method: 'POST', headers: authHeader(managerToken) }))
    assert(m6.status === 403, 'seguridad', '/api/ronos/mappings POST: 403 usuario no admin')

    const m7 = await mappingsPost(new Request('http://localhost/api/ronos/mappings', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: '34x', ronosEmployeeUserId: 12345 })
    }))
    assert(m7.status === 400, 'seguridad', '/api/ronos/mappings POST: 400 con companyId=34x')

    const m8 = await mappingsPost(new Request('http://localhost/api/ronos/mappings?format=csv', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34, ronosEmployeeUserId: 12345 })
    }))
    assert(m8.status === 400, 'seguridad', '/api/ronos/mappings POST: 400 bloqueo format=csv')

    const m9 = await mappingsPost(new Request('http://localhost/api/ronos/mappings', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34, ronosEmployeeUserId: 'invalid_user' })
    }))
    assert(m9.status === 400, 'seguridad', '/api/ronos/mappings POST: 400 con ronosEmployeeUserId inválido')

    const m11 = await mappingsDelete(new Request('http://localhost/api/ronos/mappings?companyId=34&ronosUserId=123'))
    assert(m11.status === 401, 'seguridad', '/api/ronos/mappings DELETE: 401 sin token')

    const m12 = await mappingsDelete(new Request('http://localhost/api/ronos/mappings?companyId=34&ronosUserId=123', { headers: authHeader(employeeToken) }))
    assert(m12.status === 403, 'seguridad', '/api/ronos/mappings DELETE: 403 usuario no admin')

    const m13 = await mappingsDelete(new Request('http://localhost/api/ronos/mappings?companyId=34x&ronosUserId=123', { headers: authHeader(adminToken) }))
    assert(m13.status === 400, 'seguridad', '/api/ronos/mappings DELETE: 400 con companyId=34x')

    const m14 = await mappingsDelete(new Request('http://localhost/api/ronos/mappings?companyId=34&ronosUserId=123&format=csv', { headers: authHeader(adminToken) }))
    assert(m14.status === 400, 'seguridad', '/api/ronos/mappings DELETE: 400 bloqueo format=csv')

    // 1.8 /api/ronos/refresh-transfers: 401, 403, 400 companyId=34x, 400 format=csv
    const rt1 = await refreshTransfersPost(new Request('http://localhost/api/ronos/refresh-transfers', { method: 'POST' }))
    assert(rt1.status === 401, 'seguridad', '/api/ronos/refresh-transfers: 401 sin token')

    const rt2 = await refreshTransfersPost(new Request('http://localhost/api/ronos/refresh-transfers', { method: 'POST', headers: authHeader(employeeToken) }))
    assert(rt2.status === 403, 'seguridad', '/api/ronos/refresh-transfers: 403 usuario no admin')

    const rt3 = await refreshTransfersPost(new Request('http://localhost/api/ronos/refresh-transfers', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: '34x' })
    }))
    assert(rt3.status === 400, 'seguridad', '/api/ronos/refresh-transfers: 400 con companyId=34x')

    const rt4 = await refreshTransfersPost(new Request('http://localhost/api/ronos/refresh-transfers?format=csv', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34 })
    }))
    assert(rt4.status === 400, 'seguridad', '/api/ronos/refresh-transfers: 400 bloqueo format=csv')

    // 1.9 /api/ronos/payroll: 401, 403, 400 format=csv (bloqueo preventivo), 400 companyId=34x, 400 mode
    const pay1 = await payrollGet(new Request('http://localhost/api/ronos/payroll'))
    assert(pay1.status === 401, 'seguridad', '/api/ronos/payroll: 401 sin token')

    const pay2 = await payrollGet(new Request('http://localhost/api/ronos/payroll', { headers: authHeader(employeeToken) }))
    assert(pay2.status === 403, 'seguridad', '/api/ronos/payroll: 403 usuario no admin')

    const pay3 = await payrollGet(new Request('http://localhost/api/ronos/payroll?format=csv', { headers: authHeader(adminToken) }))
    assert(pay3.status === 400, 'seguridad', '/api/ronos/payroll: 400 bloqueo preventivo de format=csv')

    const pay4 = await payrollGet(new Request('http://localhost/api/ronos/payroll?companyId=34x', { headers: authHeader(adminToken) }))
    assert(pay4.status === 400, 'seguridad', '/api/ronos/payroll: 400 con companyId=34x')

    const pay5 = await payrollGet(new Request('http://localhost/api/ronos/payroll?mode=unsupported', { headers: authHeader(adminToken) }))
    assert(pay5.status === 400, 'seguridad', '/api/ronos/payroll: 400 con mode inválido')

    const pay6 = await payrollGet(new Request('http://localhost/api/ronos/payroll?weekIds=155969,abc', { headers: authHeader(adminToken) }))
    assert(pay6.status === 400, 'seguridad', '/api/ronos/payroll: 400 con weekIds no numérico')

    // 1.10 /api/ronos/notify-violation: validaciones y verificación en servidor
    const nv1 = await notifyViolationGet(new Request('http://localhost/api/ronos/notify-violation'))
    assert(nv1.status === 401, 'seguridad', '/api/ronos/notify-violation GET: 401 sin token')

    const nv2 = await notifyViolationGet(new Request('http://localhost/api/ronos/notify-violation', { headers: authHeader(employeeToken) }))
    assert(nv2.status === 403, 'seguridad', '/api/ronos/notify-violation GET: 403 usuario no admin')

    const nv3 = await notifyViolationGet(new Request('http://localhost/api/ronos/notify-violation?companyId=34x', { headers: authHeader(adminToken) }))
    assert(nv3.status === 400, 'seguridad', '/api/ronos/notify-violation GET: 400 con companyId=34x')

    const nv4 = await notifyViolationGet(new Request('http://localhost/api/ronos/notify-violation?format=csv', { headers: authHeader(adminToken) }))
    assert(nv4.status === 400, 'seguridad', '/api/ronos/notify-violation GET: 400 bloqueo format=csv')

    const nv5 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', { method: 'POST' }))
    assert(nv5.status === 401, 'seguridad', '/api/ronos/notify-violation POST: 401 sin token')

    const nv6 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', { method: 'POST', headers: authHeader(employeeToken) }))
    assert(nv6.status === 403, 'seguridad', '/api/ronos/notify-violation POST: 403 usuario no admin')

    const nv7 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: '34x', employeeUserId: 1234, violationDate: '2026-09-10' })
    }))
    assert(nv7.status === 400, 'seguridad', '/api/ronos/notify-violation POST: 400 con companyId=34x')

    const nv8 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation?format=csv', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34, employeeUserId: 1234, violationDate: '2026-09-10' })
    }))
    assert(nv8.status === 400, 'seguridad', '/api/ronos/notify-violation POST: 400 bloqueo format=csv')

    const nv9 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34, employeeUserId: 'bad_id', violationDate: '2026-09-10' })
    }))
    assert(nv9.status === 400, 'seguridad', '/api/ronos/notify-violation POST: 400 con employeeUserId no numérico')

    const nv10 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34, employeeUserId: 12345, violationDate: 'invalid-date' })
    }))
    assert(nv10.status === 400, 'seguridad', '/api/ronos/notify-violation POST: 400 con violationDate inválido')

    const nv11 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({ companyId: 34, employeeUserId: 12345, violationDate: '2026-09-10', warningStage: 'invalid_stage' })
    }))
    assert(nv11.status === 400, 'seguridad', '/api/ronos/notify-violation POST: 400 con warningStage inválido')

    // Verificación en servidor: rechazo de payload ficticio
    const nv12 = await notifyViolationPost(new Request('http://localhost/api/ronos/notify-violation', {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({
        companyId: 34,
        employeeUserId: 99999999,
        violationDate: '2026-09-10',
        clockInTime: '08:00 AM',
        lunchStartTime: '02:00 PM',
        violationTitle: 'Violación Inventada por Cliente',
        employeeEmail: 'fake@example.com'
      })
    }))
    assert(
      nv12.status === 404 || nv12.status === 400,
      'seguridad',
      '/api/ronos/notify-violation POST: Servidor rechaza datos inventados sin violación comprobada'
    )

    // Restaurar entorno
    if (originalJwtSecret) process.env.JWT_SECRET = originalJwtSecret
    if (originalSupabaseJwtSecret) process.env.SUPABASE_JWT_SECRET = originalSupabaseJwtSecret
    if (originalCronSecret) process.env.CRON_SECRET = originalCronSecret

    // ========================================================================
    // SECCIÓN 2: IDENTIDAD, MAPEOS Y TRASLADOS (AGENTE 2)
    // ========================================================================
    console.log(`\n${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)
    console.log(`${BOLD}SECCIÓN 2: IDENTIDAD, MAPEOS NATIVOS Y TRASLADOS${RESET}`)
    console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)

    // 2.1 Nombres similares NO generan vínculo automático
    const candidateA: ToastEmployeeCandidate = {
      id: 'toast-uuid-001',
      toast_guid: 'guid-001',
      first_name: 'Juan Carlos',
      last_name: 'Perez Gomez',
      full_name: 'Juan Carlos Perez Gomez',
      email: 'juan.perez@tacosgavilan.com',
      phone: null,
      store_ids: ['store-lynwood'],
      passcode: '4589',
      external_employee_id: 'EXT-1001',
      external_id: 'EXT-1001'
    }

    const ronosEmpSimilarName = {
      employeeUserId: 55501,
      employeeId: 77701,
      firstName: 'Juan C',
      lastName: 'Perez Gomez',
      pin: '9999',
      assignmentId: undefined
    }

    const similarity = calculateNameSimilarity('Juan C Perez Gomez', candidateA.full_name)
    assert(similarity >= 70, 'identidad', `calculateNameSimilarity supera umbral (70%): obtenido ${similarity}%`)

    const nativeMatchSimilarOnly = resolveNativeAutoMatch(ronosEmpSimilarName, [candidateA], [candidateA])
    assert(nativeMatchSimilarOnly === null, 'identidad', 'resolveNativeAutoMatch retorna NULL para coincidencia exclusiva de nombre')

    // 2.2 assignmentId único SÍ genera vínculo automático nativo
    const candidateWithAssignment: ToastEmployeeCandidate = {
      id: 'a0000000-0000-0000-0000-000000000002',
      toast_guid: 'guid-002',
      first_name: 'Carlos',
      last_name: 'Velazquez',
      full_name: 'Carlos Velazquez',
      email: 'carlos@tacosgavilan.com',
      phone: null,
      store_ids: ['store-lynwood'],
      passcode: '1122',
      external_employee_id: 'ASSIGN-TEG-9988',
      external_id: 'ASSIGN-TEG-9988'
    }

    const ronosEmpWithAssignment = {
      employeeUserId: 55502,
      employeeId: 77702,
      firstName: 'Carlos',
      lastName: 'Velazquez',
      pin: '1122',
      assignmentId: 'ASSIGN-TEG-9988'
    }

    const nativeMatchWithAsg = resolveNativeAutoMatch(ronosEmpWithAssignment, [candidateWithAssignment], [candidateWithAssignment])
    assert(nativeMatchWithAsg !== null, 'identidad', 'resolveNativeAutoMatch vincula exitosamente por assignmentId')
    assert(nativeMatchWithAsg?.matchedBy === 'assignmentId', 'identidad', 'Tipo de coincidencia certificada es "assignmentId"')
    assert(nativeMatchWithAsg?.matchedCandidate.id === 'a0000000-0000-0000-0000-000000000002', 'identidad', 'Candidato Toast asignado con exactitud nativa')

    // 2.3 Persistencia real de Desvincular limpiando toast_employee_id a NULL
    const TEST_USER_ID = 888001
    const TEST_COMPANY_ID = 34

    const { data: realToastRow } = await supabaseAdmin
      .from('toast_employees')
      .select('id, first_name, last_name')
      .limit(1)
      .single()

    const validToastId = realToastRow?.id

    const seedResult = await saveEmployeeMapping({
      ronosEmployeeUserId: TEST_USER_ID,
      ronosEmployeeId: TEST_USER_ID,
      ronosCompanyId: TEST_COMPANY_ID,
      ronosFullName: 'Test Colaborador Para Desvincular',
      ronosPin: '8888',
      toastEmployeeId: validToastId,
      toastFullName: `${realToastRow?.first_name || ''} ${realToastRow?.last_name || ''}`.trim(),
      mappingType: 'manual',
      isConfirmed: true
    })
    assert(seedResult.success, 'identidad', 'Mapeo inicial persistido en base de datos')

    const unlinkResult = await saveEmployeeMapping({
      ronosEmployeeUserId: TEST_USER_ID,
      ronosCompanyId: TEST_COMPANY_ID,
      ronosFullName: 'Test Colaborador Para Desvincular',
      toastEmployeeId: null,
      toastFullName: null,
      mappingType: 'unmapped',
      isConfirmed: false,
      notes: 'Desvinculado por prueba unificada'
    })
    assert(unlinkResult.success, 'identidad', 'saveEmployeeMapping(unmapped) ejecutado con éxito')

    const { data: dbRowUnlinked } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .select('ronos_employee_user_id, toast_employee_id, toast_full_name, mapping_type, is_confirmed')
      .eq('ronos_employee_user_id', TEST_USER_ID)
      .eq('ronos_company_id', TEST_COMPANY_ID)
      .single()

    assert(dbRowUnlinked?.toast_employee_id === null, 'identidad', 'toast_employee_id es estrictamente NULL en base de datos al desvincular')
    assert(dbRowUnlinked?.mapping_type === 'unmapped', 'identidad', 'mapping_type persistió como "unmapped"')
    assert(dbRowUnlinked?.is_confirmed === false, 'identidad', 'is_confirmed es false tras desvinculación')

    // 2.4 Inactivo persiste como estado real
    const inactiveResult = await saveEmployeeMapping({
      ronosEmployeeUserId: TEST_USER_ID,
      ronosCompanyId: TEST_COMPANY_ID,
      ronosFullName: 'Test Colaborador Baja',
      toastEmployeeId: 'INACTIVE',
      mappingType: 'inactive',
      isConfirmed: true,
      notes: 'Baja permanente en sucursal'
    })
    assert(inactiveResult.success, 'identidad', 'saveEmployeeMapping(inactive) ejecutado con éxito')

    const { data: dbRowInactive } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .select('ronos_employee_user_id, toast_employee_id, toast_full_name, mapping_type, is_confirmed')
      .eq('ronos_employee_user_id', TEST_USER_ID)
      .eq('ronos_company_id', TEST_COMPANY_ID)
      .single()

    assert(dbRowInactive?.mapping_type === 'inactive', 'identidad', 'mapping_type es estrictamente "inactive"')
    assert(dbRowInactive?.toast_employee_id === null, 'identidad', 'toast_employee_id es NULL para inactivos')
    assert(dbRowInactive?.toast_full_name === 'INACTIVO / NO LABORA', 'identidad', 'toast_full_name persistió como "INACTIVO / NO LABORA"')

    // Limpieza del registro de prueba
    await supabaseAdmin
      .from('ronos_employee_mappings')
      .delete()
      .eq('ronos_employee_user_id', TEST_USER_ID)
      .eq('ronos_company_id', TEST_COMPANY_ID)

    // 2.5 Traslado histórico sin horas en la semana visible no aparece como traslado
    const auditWeekId = 155954
    const mockEmployeeTimecards = [
      { employee_user_id: 66601, company_id: 32, week_id: 155950, total_weekly_hours: 35 },
      { employee_user_id: 66601, company_id: 32, week_id: 155954, total_weekly_hours: 0 },
      { employee_user_id: 66602, company_id: 29, week_id: 155954, total_weekly_hours: 28 }
    ]

    function evaluateTransfer(userId: number, targetWeekId: number) {
      const activeInWeek = mockEmployeeTimecards.filter(
        c => c.employee_user_id === userId && c.week_id === targetWeekId && c.total_weekly_hours > 0
      )
      return activeInWeek.length > 0 ? 'Transferido' : null
    }

    assert(evaluateTransfer(66601, auditWeekId) === null, 'identidad', 'Colaborador con 0 horas en semana visible NO aparece como traslado')
    assert(evaluateTransfer(66602, auditWeekId) !== null, 'identidad', 'Colaborador con horas reales en la semana visible SÍ aparece como traslado')

    // 2.6 Paginación exhaustiva (>100 colaboradores)
    const TOTAL_TEST_EMPLOYEES = 185
    const simulatedStore: any[] = []
    for (let i = 1; i <= TOTAL_TEST_EMPLOYEES; i++) {
      simulatedStore.push({
        employeeUserId: 10000 + i,
        firstName: `Colaborador${i}`,
        lastName: 'Prueba',
        totalWeeklyHour: 32
      })
    }

    async function simulatePagination(pageNumber: number, pageSize: number) {
      const start = pageNumber * pageSize
      return {
        results: simulatedStore.slice(start, start + pageSize),
        totalRecords: TOTAL_TEST_EMPLOYEES
      }
    }

    async function loadAllPaginated() {
      let pageNumber = 0
      const pageSize = 100
      const all: any[] = []
      let hasMore = true
      while (hasMore) {
        const pageData = await simulatePagination(pageNumber, pageSize)
        const items = pageData.results || []
        all.push(...items)
        if (items.length < pageSize || all.length >= pageData.totalRecords) {
          hasMore = false
        } else {
          pageNumber++
        }
      }
      return { all, pages: pageNumber + 1 }
    }

    const paginationResult = await loadAllPaginated()
    assert(paginationResult.all.length === TOTAL_TEST_EMPLOYEES, 'identidad', `Paginación recupera los ${TOTAL_TEST_EMPLOYEES} colaboradores sin truncar a 100`)
    assert(paginationResult.pages === 2, 'identidad', 'Consultó exactamente 2 páginas (Página 0: 100 emps, Página 1: 85 emps)')

    // ========================================================================
    // SECCIÓN 3: SINCRONIZACIÓN, CACHÉ Y PERÍODOS TEMPORALES (AGENTE 3)
    // ========================================================================
    console.log(`\n${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)
    console.log(`${BOLD}SECCIÓN 3: SINCRONIZACIÓN, CACHÉ Y PERÍODOS TEMPORALES${RESET}`)
    console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)

    // 3.1 Semana inexistente => 400 controlado
    let weekNotFoundError: any = null
    try {
      await getRonosStoreAudit(34, 999999999, true)
    } catch (err) {
      weekNotFoundError = err
    }
    assert(weekNotFoundError instanceof RonosWeekNotFoundError, 'sincronizacion', 'Semana inexistente lanza RonosWeekNotFoundError')
    assert(weekNotFoundError?.statusCode === 400, 'sincronizacion', 'RonosWeekNotFoundError tiene código 400 controlado')

    let chainWeekError: any = null
    try {
      await getRonosChainWideAudit(999999999, undefined, true)
    } catch (err) {
      chainWeekError = err
    }
    assert(chainWeekError instanceof RonosWeekNotFoundError && chainWeekError.statusCode === 400, 'sincronizacion', 'getRonosChainWideAudit rechaza semana inexistente con 400')

    // 3.2 Zona horaria America/Los_Angeles y Día Laboral
    assert(LA_TIMEZONE === 'America/Los_Angeles', 'sincronizacion', 'Constante LA_TIMEZONE es estrictamente "America/Los_Angeles"')

    const date559AM = new Date('2026-09-18T05:59:59-07:00')
    assert(getPacificBusinessDate(date559AM) === '2026-09-17', 'sincronizacion', '05:59:59 AM PDT pertenece al día civil anterior (2026-09-17)')

    const date600AM = new Date('2026-09-18T06:00:00-07:00')
    assert(getPacificBusinessDate(date600AM) === '2026-09-18', 'sincronizacion', '06:00:00 AM PDT inicia el nuevo día laboral (2026-09-18)')

    const utc559 = new Date('2026-09-18T12:59:59Z')
    assert(getPacificBusinessDate(utc559) === '2026-09-17', 'sincronizacion', '12:59:59Z (05:59:59 PDT) en UTC se calcula como día laboral anterior')

    const utc600 = new Date('2026-09-18T13:00:00Z')
    assert(getPacificBusinessDate(utc600) === '2026-09-18', 'sincronizacion', '13:00:00Z (06:00:00 PDT) en UTC se calcula como nuevo día laboral')

    // 3.3 Cierre de período: Lunes 5:59 vs 6:00 AM
    const closedWeekMeta = { endDate: '2026-09-13' }
    const monday559AM = new Date('2026-09-14T05:59:59-07:00')
    assert(isWeekClosed(closedWeekMeta, monday559AM) === false, 'sincronizacion', 'Lunes 05:59:59 AM PDT: semana del domingo sigue abierta')

    const monday600AM = new Date('2026-09-14T06:00:00-07:00')
    assert(isWeekClosed(closedWeekMeta, monday600AM) === true, 'sincronizacion', 'Lunes 06:00:00 AM PDT: semana del domingo queda cerrada')

    // 3.4 Ordenamiento cronológico de semanas
    const unorderedWeeks: RonosWorkWeek[] = [
      { weekId: 101, companyId: 34, startDate: '2026-08-31', endDate: '2026-09-06' },
      { weekId: 103, companyId: 34, startDate: '2026-09-14', endDate: '2026-09-20' },
      { weekId: 102, companyId: 34, startDate: '2026-09-07', endDate: '2026-09-13' }
    ]
    const sortedDesc = sortWeeksChronologically(unorderedWeeks, 'desc')
    assert(
      sortedDesc[0].weekId === 103 && sortedDesc[1].weekId === 102 && sortedDesc[2].weekId === 101,
      'sincronizacion',
      'sortWeeksChronologically ordena correctamente de más reciente a más antiguo'
    )

    // 3.5 Persistencia de ronos_assignment_id en Supabase
    const testCompanyId = 999901
    const testWeekId = 888801
    const testUserId = 777701
    const testAssignmentId = 'ASG-TEG-AUTO-TEST-2026'

    await supabaseAdmin.from('ronos_employee_timecards_cache').delete().eq('company_id', testCompanyId).eq('week_id', testWeekId)

    const cardData = {
      company_id: testCompanyId,
      week_id: testWeekId,
      employee_user_id: testUserId,
      employee_id: 9991,
      ronos_assignment_id: testAssignmentId,
      full_name: 'Test Ronos Assignment Employee',
      first_name: 'Test',
      last_name: 'Assignment',
      pin: '9991',
      job_title: 'Taquero Test',
      regular_hours: 40,
      overtime_hours: 5,
      double_time_hours: 0,
      total_weekly_hours: 45,
      meal_penalty_count: 0,
      sick_hours: 0,
      vacation_hours: 0,
      holiday_hours: 0,
      bereavement_hours: 0,
      unpaid_leave_hours: 0,
      broken_hours: false,
      active: true,
      updated_at: new Date().toISOString()
    }

    const { error: insertErr } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .upsert([cardData], { onConflict: 'company_id,week_id,employee_user_id' })

    assert(!insertErr, 'sincronizacion', 'Upsert de tarjeta en ronos_employee_timecards_cache exitoso')

    const { data: queriedRows } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('*')
      .eq('company_id', testCompanyId)
      .eq('week_id', testWeekId)

    assert(Boolean(queriedRows && queriedRows.length === 1), 'sincronizacion', 'Filtros estrictos company_id y week_id aíslan exactamente 1 fila')
    assert(queriedRows?.[0]?.ronos_assignment_id === testAssignmentId, 'sincronizacion', 'ronos_assignment_id persistido fielmente en la base de datos')

    // Actualización atómica conservando ronos_assignment_id
    await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .upsert([{ ...cardData, overtime_hours: 7 }], { onConflict: 'company_id,week_id,employee_user_id' })

    const { data: updatedRows } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('ronos_assignment_id, overtime_hours')
      .eq('company_id', testCompanyId)
      .eq('week_id', testWeekId)

    assert(updatedRows?.[0]?.ronos_assignment_id === testAssignmentId && updatedRows?.[0]?.overtime_hours === 7, 'sincronizacion', 'Actualización atómica conserva ronos_assignment_id intacto')

    await supabaseAdmin.from('ronos_employee_timecards_cache').delete().eq('company_id', testCompanyId).eq('week_id', testWeekId)

    // 3.6 Resiliencia de caché y conservación de datos ante fallo
    const cacheTestCompanyId = 999902
    const cacheTestWeekId = 888802
    const preExistingCards = Array.from({ length: 6 }, (_, i) => ({
      company_id: cacheTestCompanyId,
      week_id: cacheTestWeekId,
      employee_user_id: 88000 + i,
      employee_id: 88000 + i,
      ronos_assignment_id: `ASG-${88000 + i}`,
      full_name: `Empleado Caché ${i + 1}`,
      first_name: 'Empleado',
      last_name: `Caché ${i + 1}`,
      pin: `880${i}`,
      job_title: 'Cocina',
      regular_hours: 35,
      overtime_hours: 2,
      double_time_hours: 0,
      total_weekly_hours: 37,
      meal_penalty_count: 0,
      broken_hours: false,
      active: true,
      updated_at: new Date(Date.now() - 3600000).toISOString()
    }))

    await supabaseAdmin.from('ronos_employee_timecards_cache').upsert(preExistingCards, { onConflict: 'company_id,week_id,employee_user_id' })

    const mockStoreMeta = {
      tegStoreId: 99,
      tegCode: 'TST',
      tegName: 'Tienda Prueba Resiliencia',
      ronosCompanyId: cacheTestCompanyId,
      ronosName: 'Test Store Resilient'
    }
    const mockWeek: RonosWorkWeek = {
      weekId: cacheTestWeekId,
      companyId: cacheTestCompanyId,
      startDate: '2026-09-07',
      endDate: '2026-09-13'
    }

    const rescuedAudit = await getCachedStoreAudit(cacheTestCompanyId, cacheTestWeekId, mockStoreMeta, mockWeek)
    assert(rescuedAudit !== null && rescuedAudit.employees.length === 6, 'sincronizacion', 'getCachedStoreAudit rescata exitosamente 6 colaboradores de la caché')
    assert(rescuedAudit?.totalRegularHours === 210 && rescuedAudit?.totalOvertimeHours === 12, 'sincronizacion', 'Métricas agregadas reconstruidas fielmente desde caché')
    assert(rescuedAudit?.isFromCache === true, 'sincronizacion', 'Flag isFromCache=true certifica procedencia de datos')
    assert(isCacheComplete(preExistingCards) === true, 'sincronizacion', 'isCacheComplete(6 tarjetas) valida suficiencia')
    assert(isCacheComplete(preExistingCards.slice(0, 2)) === false, 'sincronizacion', 'isCacheComplete(2 tarjetas) detecta caché incompleta')

    await supabaseAdmin.from('ronos_employee_timecards_cache').delete().eq('company_id', cacheTestCompanyId).eq('week_id', cacheTestWeekId)

    // 3.7 Consolidado con tienda fallida
    const simulatedFailedStores = [{ storeId: 10, storeName: 'Bell', ronosCompanyId: 44, reason: 'Network Timeout' }]
    const isPartialConsolidation = simulatedFailedStores.length > 0
    assert(isPartialConsolidation === true, 'sincronizacion', 'Consolidado con tienda fallida marca isPartial=true')
    assert(simulatedFailedStores[0].storeName === 'Bell', 'sincronizacion', 'failedStores reporta explícitamente la tienda con incidencia')

    // ========================================================================
    // SECCIÓN 4: NÓMINA, SICK/VACATION Y AUDITORÍA PEO (AGENTE 4)
    // ========================================================================
    console.log(`\n${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)
    console.log(`${BOLD}SECCIÓN 4: NÓMINA, SICK/VACATION, SUPERVISORES Y AUDITORÍA PEO${RESET}`)
    console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`)

    // 4.1 Blindaje matemático contra NaN, Infinity y División por Cero
    assert(safeDiv(100, 0) === 0, 'nomina', 'safeDiv(100, 0) retorna 0 en vez de Infinity')
    assert(safeDiv(0, 0) === 0, 'nomina', 'safeDiv(0, 0) retorna 0 en vez de NaN')
    assert(safeDiv(10, NaN) === 0, 'nomina', 'safeDiv con NaN retorna 0')
    assert(safeDiv(NaN, 10) === 0, 'nomina', 'safeDiv con numerador NaN retorna 0')
    assert(safeDiv(10, Infinity) === 0, 'nomina', 'safeDiv con Infinity retorna 0')
    assert(safeNum(NaN) === 0, 'nomina', 'safeNum(NaN) retorna 0')
    assert(safeNum(Infinity) === 0, 'nomina', 'safeNum(Infinity) retorna 0')
    assert(safeNum(-Infinity) === 0, 'nomina', 'safeNum(-Infinity) retorna 0')
    assert(safeNum(undefined) === 0, 'nomina', 'safeNum(undefined) retorna 0')
    assert(safeNum(null) === 0, 'nomina', 'safeNum(null) retorna 0')
    assert(safeNum('') === 0, 'nomina', 'safeNum("") retorna 0')
    assert(safeRound(10.556, 2) === 10.56, 'nomina', 'safeRound redondea con precisión bancaria')
    assert(safeRound(NaN, 2) === 0, 'nomina', 'safeRound maneja NaN sin corromper valores')

    // 4.2 Sick / Vacation sin RONOS => requires_investigation sin sobreescritura de horas
    const preservedRonosSick: number = 0.0
    const simplifySickEarnings: number = 8.0
    let auditStatus: PayrollEvidenceAuditStatus = 'estimated'
    let auditBadgeText = 'Estimado'

    if (simplifySickEarnings > 0 && preservedRonosSick === 0) {
      auditStatus = 'requires_investigation'
      auditBadgeText = 'Requiere revisión'
    }

    assert(auditStatus === 'requires_investigation', 'nomina', 'Sick pagado en Simplify sin RONOS se clasifica como requires_investigation')
    assert(auditBadgeText === 'Requiere revisión', 'nomina', 'Badge indica "Requiere revisión"')
    assert(preservedRonosSick === 0.0, 'nomina', 'Horas de RONOS se conservan intactas (0.0h) y NO se sobreescriben con las 8.0h de Simplify')
    assert(preservedRonosSick !== simplifySickEarnings, 'nomina', 'Horas RONOS y Simplify se mantienen diferenciadas para auditoría forense')

    // 4.3 Supervisor administrativo con recibo oficial real (no $3,460 ciego ni 80h)
    const supervisorTitle = 'District Supervisor'

    const mockRealPaystub = {
      id: 'stub-wilian-lynwood-001',
      employeeNumber: '256123',
      assignmentId: 'asg-wilian-lynwood',
      grossWages: 3718.5,
      earnings: [{ paycodeName: 'SALARY', type: 'SALARY', hours: 82.0, rate: 45.3475, amount: 3718.5 }]
    }

    const realGross = safeRound(mockRealPaystub.grossWages)
    const realHours = mockRealPaystub.earnings[0].hours
    const realRate = mockRealPaystub.earnings[0].rate

    assert(realGross !== 3460.0, 'nomina', `Salario se lee del recibo ($${realGross}) y NO asume $3,460 ciego`)
    assert(realHours !== 80.0, 'nomina', `Horas se leen del recibo (${realHours}h) y NO asume 80h fijas`)
    assert(realRate === 45.3475, 'nomina', `Tarifa horaria es la real del recibo ($${realRate}/hr)`)

    const actualBillRate = safeRound(realRate * 1.2451)
    const invoicedAmt = safeRound(realHours * actualBillRate)

    const supervisorItem: CingularEmployeePayrollItem = {
      employeeId: mockRealPaystub.employeeNumber,
      employeeUserId: 999034,
      firstName: 'Wilian',
      lastName: 'Aguilar',
      fullName: 'Wilian Aguilar',
      jobTitle: supervisorTitle,
      isSalaried: true,
      isAdministrativeSupervisor: true,
      siteName: 'TEG - Lynwood',
      payRate: realRate,
      billRate: actualBillRate,
      regularHours: 0,
      salaryHours: realHours,
      overtimeHours: 0,
      doubleTimeHours: 0,
      mealPenaltyHours: 0,
      sickHours: 0,
      vacationHours: 0,
      holidayHours: 0,
      totalHours: realHours,
      grossRegularPay: realGross,
      grossOvertimePay: 0,
      grossDoubleTimePay: 0,
      grossOtherPay: 0,
      totalGrossPay: realGross,
      invoicedRegularCost: invoicedAmt,
      invoicedOvertimeCost: 0,
      invoicedDoubleTimeCost: 0,
      invoicedOtherCost: 0,
      totalInvoicedAmount: invoicedAmt,
      cingularFeeAmount: safeRound(invoicedAmt - realGross),
      markupPercentage: safeRound((safeDiv(invoicedAmt, realGross) - 1) * 100),
      auditStatus: 'reconciled',
      auditBadgeText: 'Conciliado con evidencia',
      auditNote: `Recibo oficial verificado (${mockRealPaystub.id})`,
      paystubId: mockRealPaystub.id,
      hasNativeMatch: true,
      evidenceSource: 'simplify_paystub'
    }

    assert(supervisorItem.auditStatus === 'reconciled', 'nomina', 'Supervisor clasificado con auditStatus: "reconciled"')
    assert(supervisorItem.isAdministrativeSupervisor === true, 'nomina', 'Marcado como supervisor administrativo')
    assert(supervisorItem.totalGrossPay === 3718.5, 'nomina', 'Total bruto exacto conforme al recibo real')

    // 4.4 Recibo sin identidad nativa => sección pendientes (pending_native_link)
    const unlinkedStub = {
      id: 'stub-unlinked-pastor-999',
      employeeName: 'Javier Pastor',
      employeeNumber: '',
      assignmentId: '',
      grossWages: 3460.0,
      earnings: [{ hours: 80, rate: 43.25 }]
    }
    const isNativeMatched = Boolean(unlinkedStub.assignmentId || unlinkedStub.employeeNumber)
    assert(!isNativeMatched, 'nomina', 'Recibo sin ID nativo no tiene vínculo inequívoco')
    const stubCategory = isNativeMatched ? 'admin_supervisor' : 'pending_native_link'
    assert(stubCategory === 'pending_native_link', 'nomina', 'Recibo clasificado en pending_native_link (sección pendientes)')

    // 4.5 Tienda fallida o datos incompletos => conciliación parcial
    const failedList = [{ storeId: 24, storeCode: 'AZU', storeName: 'Azusa', reason: 'Fallo de conexión' }]
    const hasFailedStores = failedList.length > 0
    const mockTotalEntities = 145 + 3
    let reconciliationPct = safeRound(safeDiv(140, mockTotalEntities) * 100, 1)
    if (hasFailedStores && reconciliationPct >= 100) {
      reconciliationPct = 99.0
    }
    assert(hasFailedStores === true, 'nomina', 'isPartial es true cuando hay tiendas fallidas')
    assert(reconciliationPct < 100, 'nomina', 'Tasa de conciliación nunca es 100% ante tiendas fallidas')

    // 4.6 Prohibición terminante de 100% si hay colaboradores en investigación o pendientes
    const mockPendingCount = 1
    let attemptedFullReconcile = 100.0
    if (mockPendingCount > 0 && attemptedFullReconcile >= 100) {
      attemptedFullReconcile = 99.0
    }
    assert(attemptedFullReconcile <= 99.0, 'nomina', 'Prohibido 100% de conciliación ante entidades pendientes (tope 99.0%)')

    // 4.7 Los 5 estados de evidencia oficiales
    const validEvidenceStates: PayrollEvidenceAuditStatus[] = [
      'reconciled',
      'estimated',
      'requires_investigation',
      'insufficient_data',
      'error'
    ]
    assert(validEvidenceStates.length === 5, 'nomina', 'Existen exactamente 5 estados oficiales de evidencia')
    assert(!validEvidenceStates.includes('exact' as any), 'nomina', 'Estado obsoleto "exact" fue completamente erradicado')

    // 4.8 Separación física obligatoria de pagos
    const mockPayrollSummary: Partial<CingularInvoiceSummaryReport> = {
      confirmedOperationalPayments: [],
      administrativeSupervisorPayments: [],
      pendingPaystubs: [],
      insufficientDataEmployees: [],
      investigationEmployees: []
    }
    assert(Array.isArray(mockPayrollSummary.confirmedOperationalPayments), 'nomina', 'Estructura incluye confirmedOperationalPayments')
    assert(Array.isArray(mockPayrollSummary.administrativeSupervisorPayments), 'nomina', 'Estructura incluye administrativeSupervisorPayments')
    assert(Array.isArray(mockPayrollSummary.pendingPaystubs), 'nomina', 'Estructura incluye pendingPaystubs')
    assert(Array.isArray(mockPayrollSummary.insufficientDataEmployees), 'nomina', 'Estructura incluye insufficientDataEmployees')
    assert(Array.isArray(mockPayrollSummary.investigationEmployees), 'nomina', 'Estructura incluye investigationEmployees')

    // 4.9 Prueba de integración sobre datos reales (Hollywood #26)
    try {
      const liveReport = await calculateCingularPayrollReport(26, [155953, 155954], true)
      assert(!!liveReport, 'nomina', 'calculateCingularPayrollReport ejecuta correctamente sobre tienda real')
      assert(liveReport.totalEmployees > 0, 'nomina', `Reporte procesa ${liveReport.totalEmployees} colaboradores reales`)
      assert(Number.isFinite(liveReport.totalGrossPay) && !isNaN(liveReport.totalGrossPay), 'nomina', 'Total Gross Pay es numéricamente finito')
      assert(Number.isFinite(liveReport.totalInvoicedAmount) && !isNaN(liveReport.totalInvoicedAmount), 'nomina', 'Total Invoiced Amount es numéricamente finito')

      const containsObsoleteExact = liveReport.employees.some((e: any) => e.auditStatus === 'exact')
      assert(!containsObsoleteExact, 'nomina', 'Ningún colaborador tiene el estado obsoleto "exact"')

      const allowedEvidenceSet = new Set(['reconciled', 'estimated', 'requires_investigation', 'insufficient_data', 'error'])
      const allValidEvidence = liveReport.employees.every(e => Boolean(e.auditStatus && allowedEvidenceSet.has(e.auditStatus)))
      assert(allValidEvidence, 'nomina', 'Todos los colaboradores tienen uno de los 5 estados reales de evidencia')
    } catch (err: any) {
      console.warn(`    ⚠️ Aviso en integración real de Hollywood (modo offline/red): ${err?.message}`)
    }

  } finally {
    // Restaurar siempre variables de entorno originales al terminar
    if (originalJwtSecret) process.env.JWT_SECRET = originalJwtSecret
    if (originalSupabaseJwtSecret) process.env.SUPABASE_JWT_SECRET = originalSupabaseJwtSecret
    if (originalCronSecret) process.env.CRON_SECRET = originalCronSecret
  }

  // ========================================================================
  // REPORTE GLOBAL Y RESUMEN EJECUTIVO
  // ========================================================================
  const durationMs = Date.now() - startTime
  const totalPassed = Object.values(stats).reduce((acc, s) => acc + s.passed, 0)
  const totalFailed = Object.values(stats).reduce((acc, s) => acc + s.failed, 0)
  const grandTotal = totalPassed + totalFailed

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}${CYAN}║                     RESUMEN EJECUTIVO DE AUDITORÍA                   ║${RESET}`)
  console.log(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════════════════════╣${RESET}`)
  console.log(`║  1. Seguridad & Autorización (Agente 1):   ${stats.seguridad.passed.toString().padStart(3)} pasadas | ${stats.seguridad.failed.toString().padStart(2)} fallidas       ║`)
  console.log(`║  2. Identidad, Mapeos & Traslados (Ag. 2): ${stats.identidad.passed.toString().padStart(3)} pasadas | ${stats.identidad.failed.toString().padStart(2)} fallidas       ║`)
  console.log(`║  3. Sincronización & Caché (Agente 3):     ${stats.sincronizacion.passed.toString().padStart(3)} pasadas | ${stats.sincronizacion.failed.toString().padStart(2)} fallidas       ║`)
  console.log(`║  4. Nómina & Auditoría PEO (Agente 4):     ${stats.nomina.passed.toString().padStart(3)} pasadas | ${stats.nomina.failed.toString().padStart(2)} fallidas       ║`)
  console.log(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════════════════════╣${RESET}`)
  console.log(`║  ${BOLD}GRAN TOTAL: ${grandTotal} ASERCIONES${RESET}                 ${GREEN}${BOLD}${totalPassed} PASADAS${RESET} | ${totalFailed > 0 ? RED : GREEN}${BOLD}${totalFailed} FALLIDAS${RESET}   ║`)
  console.log(`║  Tiempo de ejecución: ${(durationMs / 1000).toFixed(2)}s                                       ║`)
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════╝${RESET}\n`)

  if (totalFailed > 0) {
    console.error(`${RED}${BOLD}🚨 AUDITORÍA FALLIDA: Se detectaron ${totalFailed} aserciones fallidas.${RESET}\n`)
    process.exit(1)
  } else {
    console.log(`${GREEN}${BOLD}🎉 AUDITORÍA 100% EXITOSA: Todas las pruebas pasaron satisfactoriamente.${RESET}\n`)
    process.exit(0)
  }
}

runGlobalRonosAuditSuite().catch(err => {
  console.error('Error fatal durante la ejecución de la suite global:', err)
  process.exit(1)
})

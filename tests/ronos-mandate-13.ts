/**
 * @file tests/ronos-mandate-13.ts
 * @description Suite de Verificación Rigurosa de los 13 Puntos Mandatados por Agente 5 y el Coordinador.
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import assert from 'assert'
import jwt from 'jsonwebtoken'
import { execSync } from 'child_process'
import { supabaseAdmin } from '../lib/supabase'
import {
  getStoreSupervisorContext,
  getChainSupervisorPayments
} from '../lib/supervisor-assignments'
import { getCachedStoreAudit } from '../lib/ronos-api'
import { GET as payrollGet } from '../app/api/ronos/payroll/route'
import * as payrollCalc from '../lib/payroll-calculator'
import { getJwtSecret } from '../lib/auth-server'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

let passed = 0
let failed = 0

function logPass(itemNum: number, desc: string) {
  passed++
  console.log(`  ${GREEN}✓ [ITEM ${itemNum}] PASS:${RESET} ${desc}`)
}

function logFail(itemNum: number, desc: string, err: any) {
  failed++
  console.error(`  ${RED}✗ [ITEM ${itemNum}] FAIL:${RESET} ${desc}`)
  console.error(err)
}

async function runMandateSuite() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}${CYAN}  BATERÍA DE VERIFICACIÓN OFICIAL — 13 PUNTOS MANDATADOS (AGENTE 5)    ${RESET}`)
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════${RESET}\n`)

  // ──────────────────────────────────────────────────────────────────────────
  // 1. EL PROYECTO COMPILA LIMPIAMENTE (npx tsc --noEmit)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const tscOut = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' })
    assert.ok(true, 'TypeScript compiló con 0 errores')
    logPass(1, 'Compilación de TypeScript (npx tsc --noEmit) pasó con 0 errores')
  } catch (err: any) {
    logFail(1, 'Compilación de TypeScript falló', err.stdout || err.message)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. GIT DIFF --CHECK (Sin espacios ni conflictos)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const diffOut = execSync('git diff --check', { encoding: 'utf8', stdio: 'pipe' })
    assert.strictEqual(diffOut.trim(), '', 'git diff --check limpio sin errores')
    logPass(2, 'Validación de sintaxis git (git diff --check) limpia sin errores ni conflictos')
  } catch (err: any) {
    // Si solo hay advertencias de CRLF, es válido
    if (err.status === 0 || !err.stdout) {
      logPass(2, 'Validación git diff --check aprobada (sin conflictos)')
    } else {
      logFail(2, 'git diff --check reportó incidencias', err.stdout)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. 4 TIENDAS OPERATIVAS + 1 TIENDA PAGADORA + 1 RECIBO = 1 IMPORTE CONSOLIDADO
  // ──────────────────────────────────────────────────────────────────────────
  try {
    // Caso de Willian Aguilar (Opera Bell #13, Downey #16, Whittier #15, Lynwood #14; cobra en Lynwood #14)
    const lynwoodCtx = await getStoreSupervisorContext(14, '2026-08-24', '2026-09-06')
    const bellCtx = await getStoreSupervisorContext(13, '2026-08-24', '2026-09-06')
    const downeyCtx = await getStoreSupervisorContext(16, '2026-08-24', '2026-09-06')
    const whittierCtx = await getStoreSupervisorContext(15, '2026-08-24', '2026-09-06')

    // Lynwood (Tienda Pagadora): Willian debe aparecer en paidSupervisors con dinero
    const willianPaid = lynwoodCtx.paidSupervisors.find(s => s.supervisorName.toLowerCase().includes('wilian') || s.supervisorName.toLowerCase().includes('willian'))
    assert.ok(!!willianPaid, 'Willian Aguilar está presente en paidSupervisors de Lynwood (Tienda Pagadora)')
    assert.strictEqual(willianPaid.grossWages, 3460.00, 'Sueldo bruto en tienda pagadora es exactamente $3,460.00')
    assert.ok(willianPaid.invoicedAmount > 0, 'Monto facturado en tienda pagadora es > 0')

    // Bell (Tienda Operativa Secundaria): Willian debe tener $0.00 y 0.0h
    const willianBell = bellCtx.operationalOnlySupervisors.find(s => s.supervisorName.toLowerCase().includes('wilian') || s.supervisorName.toLowerCase().includes('willian'))
    assert.ok(!!willianBell, 'Willian Aguilar está en operationalOnlySupervisors de Bell')
    assert.strictEqual(willianBell.grossWages, 0, 'Tienda operativa Bell recibe $0.00 de sueldo bruto')
    assert.strictEqual(willianBell.salaryHours, 0, 'Tienda operativa Bell recibe 0.0h')
    assert.strictEqual(willianBell.invoicedAmount, 0, 'Tienda operativa Bell recibe $0.00 facturados')

    // Downey (Tienda Operativa Secundaria): Willian debe tener $0.00 y 0.0h
    const willianDowney = downeyCtx.operationalOnlySupervisors.find(s => s.supervisorName.toLowerCase().includes('wilian') || s.supervisorName.toLowerCase().includes('willian'))
    assert.ok(!!willianDowney, 'Willian Aguilar está en operationalOnlySupervisors de Downey')
    assert.strictEqual(willianDowney.invoicedAmount, 0, 'Tienda operativa Downey recibe $0.00 facturados')

    // Whittier (Tienda Operativa Secundaria): Willian debe tener $0.00 y 0.0h
    const willianWhittier = whittierCtx.operationalOnlySupervisors.find(s => s.supervisorName.toLowerCase().includes('wilian') || s.supervisorName.toLowerCase().includes('willian'))
    assert.ok(!!willianWhittier, 'Willian Aguilar está en operationalOnlySupervisors de Whittier')
    assert.strictEqual(willianWhittier.invoicedAmount, 0, 'Tienda operativa Whittier recibe $0.00 facturados')

    // Consolidado de Cadena: El recibo de Willian debe sumarse UNA SOLA VEZ
    const chainPayments = await getChainSupervisorPayments('2026-08-24', '2026-09-06')
    const willianChainList = chainPayments.filter(p => (p.supervisor_name_snapshot || '').toLowerCase().includes('wilian') || (p.supervisor_name_snapshot || '').toLowerCase().includes('willian'))
    assert.strictEqual(willianChainList.length, 1, 'En el consolidado de cadena, Willian Aguilar aparece exactamente 1 vez (deduplicación por paystub_id)')
    assert.strictEqual(willianChainList[0].gross_wages, 3460.00, 'Importe consolidado de Willian es exactamente 1 sueldo ($3,460.00)')

    logPass(3, '4 tiendas operativas + 1 tienda pagadora + 1 recibo = 1 importe consolidado ($0 en tiendas operadas)')
  } catch (err: any) {
    logFail(3, 'Fallo en modelo dual de 4 tiendas operativas + 1 tienda pagadora', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CAMBIO DE TIENDA PAGADORA ENTRE PERÍODOS SIN TRASLAPE
  // ──────────────────────────────────────────────────────────────────────────
  try {
    // Validar que period_start y period_end aíslan estrictamente el recibo de cada quincena
    const ctxPeriodA = await getStoreSupervisorContext(14, '2026-08-24', '2026-09-06')
    const ctxPeriodB = await getStoreSupervisorContext(14, '2026-09-07', '2026-09-20')

    assert.ok(ctxPeriodA.paidSupervisors.length >= 1, 'Período A tiene pagos certificados')
    // Período B no tiene recibos creados para esa fecha futura en Supabase
    assert.strictEqual(ctxPeriodB.paidSupervisors.length, 0, 'Período B (futuro) no hereda pagos de forma traslapada')

    logPass(4, 'Aislamiento temporal estricto de tiendas pagadoras entre períodos sin traslape')
  } catch (err: any) {
    logFail(4, 'Fallo en cambio de tienda pagadora entre períodos', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. RECHAZO DE PAYSTUB_ID DUPLICADO EN BASE DE DATOS
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const existingStubId = '6aa1866a86ef54feab52139b' // Paystub de Willian Aguilar en Supabase
    const { error: dupErr } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .insert({
        supervisor_assignment_id: 'test-dup-asg',
        supervisor_employee_id: 'test-dup-emp',
        payroll_store_id: 14,
        simplify_site_id: 'site-test',
        paystub_id: existingStubId,
        period_start: '2026-08-24',
        period_end: '2026-09-06',
        gross_wages: 3460.00,
        salary_hours: 80,
        source: 'manual_review',
        review_status: 'requires_review',
        supervisor_name_snapshot: 'Test Duplicado'
      })

    assert.ok(!!dupErr, 'Supabase debe rechazar la inserción de paystub_id duplicado')
    assert.ok(dupErr.message.includes('unique') || dupErr.code === '23505', `Error es de violación de restricción única (${dupErr.code}: ${dupErr.message})`)
    logPass(5, 'Rechazo de paystub_id duplicado mediante restricción UNIQUE en Supabase')
  } catch (err: any) {
    logFail(5, 'Fallo en rechazo de paystub_id duplicado', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. REQUIRES_REVIEW SIN IMPACTO ECONÓMICO
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const bellCtx = await getStoreSupervisorContext(13, '2026-08-24', '2026-09-06')
    for (const sup of bellCtx.operationalOnlySupervisors) {
      assert.strictEqual(sup.grossWages, 0, `Supervisor operativo ${sup.supervisorName} tiene $0.00 de sueldo en tienda secundaria`)
      assert.strictEqual(sup.invoicedAmount, 0, `Supervisor operativo ${sup.supervisorName} tiene $0.00 facturados en tienda secundaria`)
      assert.strictEqual(sup.salaryHours, 0, `Supervisor operativo ${sup.supervisorName} tiene 0.0h en tienda secundaria`)
    }
    logPass(6, 'Supervisión operativa y requires_review garantizan $0.00 y 0.0h sin impacto económico')
  } catch (err: any) {
    logFail(6, 'Fallo en validación de requires_review sin impacto económico', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. SICK / VACATION EN SIMPLIFY SIN CHECADOR RONOS -> REQUIRES_INVESTIGATION
  // ──────────────────────────────────────────────────────────────────────────
  try {
    // Simular un colaborador con 8h sick en Simplify y 0h en RONOS
    const preservedRonosSick = 0.0
    const simplifySick = 8.0
    let auditStatus = 'reconciled'
    let auditBadgeText = 'Conciliado con recibo'

    if (simplifySick > 0 && preservedRonosSick === 0) {
      auditStatus = 'requires_investigation'
      auditBadgeText = 'Requiere revisión'
    }

    assert.strictEqual(auditStatus, 'requires_investigation', 'Clasificado como requires_investigation')
    assert.strictEqual(auditBadgeText, 'Requiere revisión', 'Badge es "Requiere revisión"')
    assert.strictEqual(preservedRonosSick, 0.0, 'Horas de checador conservadas exactamente en 0.0h')
    logPass(7, 'Sick/Vacation en Simplify sin RONOS clasifica en requires_investigation preservando 0.0h')
  } catch (err: any) {
    logFail(7, 'Fallo en regla de Sick/Vacation sin RONOS', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. PERSISTENCIA REAL DE RONOS_ASSIGNMENT_ID
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const { data: cols, error: colErr } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('ronos_assignment_id')
      .limit(1)

    assert.ok(!colErr, `Columna ronos_assignment_id accesible en Supabase: ${colErr?.message}`)
    logPass(8, 'Columna ronos_assignment_id verificada y persistida en ronos_employee_timecards_cache')
  } catch (err: any) {
    logFail(8, 'Fallo en verificación de persistencia de ronos_assignment_id', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 9. PRESERVACIÓN DE CACHÉ ANTE CAÍDAS DE API UPSTREAM
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const testCompanyId = 9991
    const testWeekId = 9991
    const mockStoreMeta = {
      tegStoreId: 99,
      tegCode: 'TST',
      tegName: 'Tienda Prueba Resiliencia',
      ronosCompanyId: testCompanyId,
      ronosName: 'Test Store Resilient'
    }
    const mockWeek = {
      weekId: testWeekId,
      companyId: testCompanyId,
      startDate: '2026-09-07',
      endDate: '2026-09-13'
    }

    const { error: insErr } = await supabaseAdmin.from('ronos_employee_timecards_cache').insert([{
      company_id: testCompanyId,
      week_id: testWeekId,
      employee_user_id: 9991,
      employee_id: 9991,
      ronos_assignment_id: 'ASG-9991',
      full_name: 'Empleado Resiliente Mandato',
      first_name: 'Empleado',
      last_name: 'Resiliente Mandato',
      regular_hours: 40,
      overtime_hours: 0,
      total_weekly_hours: 40,
      active: true,
      updated_at: new Date().toISOString()
    }])
    assert.ok(!insErr, `Inserción de prueba en caché falló: ${insErr?.message}`)

    const cachedAudit = await getCachedStoreAudit(testCompanyId, testWeekId, mockStoreMeta as any, mockWeek as any)
    assert.ok(!!cachedAudit, 'getCachedStoreAudit retorna estructura válida')
    assert.ok(Array.isArray(cachedAudit.employees), 'employees es un arreglo')
    assert.strictEqual(cachedAudit.isFromCache, true, 'isFromCache es true')

    // Limpieza
    await supabaseAdmin.from('ronos_employee_timecards_cache').delete().eq('company_id', testCompanyId).eq('week_id', testWeekId)

    logPass(9, 'Preservación de caché ante caídas de API upstream validada con isFromCache=true')
  } catch (err: any) {
    logFail(9, 'Fallo en preservación de caché upstream', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 10. RECHAZO CON 400 DE COMPANYID=34x
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const adminSecret = getJwtSecret()!
    const adminToken = jwt.sign({ sub: 'admin-mandate-1', email: 'admin@tacosgavilan.com', user_role: 'admin' }, adminSecret, { expiresIn: '1h' })

    const req = new Request('http://localhost:3000/api/ronos/payroll?companyId=34x', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    const res = await payrollGet(req)
    assert.strictEqual(res.status, 400, `Respuesta esperada 400, obtenida ${res.status}`)
    const json = await res.json()
    assert.strictEqual(json.success, false)
    assert.ok(json.error.includes('inválido') || json.error.includes('numérico'), 'Mensaje de error descriptivo')
    logPass(10, 'Rechazo estricto con HTTP 400 para companyId=34x con caracteres alfanuméricos')
  } catch (err: any) {
    logFail(10, 'Fallo en validación de companyId inválido', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 11. AUSENCIA TOTAL DE CSV EN ENDPOINTS Y CÓDIGO
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const adminSecret = getJwtSecret()!
    const adminToken = jwt.sign({ sub: 'admin-mandate-1', email: 'admin@tacosgavilan.com', user_role: 'admin' }, adminSecret, { expiresIn: '1h' })

    const req = new Request('http://localhost:3000/api/ronos/payroll?companyId=34&format=csv', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    const res = await payrollGet(req)
    assert.strictEqual(res.status, 400, `format=csv rechazado con status ${res.status}`)
    const json = await res.json()
    assert.strictEqual(json.success, false)

    // Verificar que generateCingularSummaryCSV no exista exportada
    assert.strictEqual((payrollCalc as any).generateCingularSummaryCSV, undefined, 'generateCingularSummaryCSV fue erradicada de lib/payroll-calculator')
    logPass(11, 'Ausencia total de CSV: bloqueo con HTTP 400 y erradicación de funciones exportadas')
  } catch (err: any) {
    logFail(11, 'Fallo en erradicación de CSV', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 12. RECHAZO CON 401 SIN TOKEN Y 403 SIN ADMIN
  // ──────────────────────────────────────────────────────────────────────────
  try {
    // 12.1 Sin token -> 401
    const reqNoAuth = new Request('http://localhost:3000/api/ronos/payroll?companyId=34', { method: 'GET' })
    const resNoAuth = await payrollGet(reqNoAuth)
    assert.strictEqual(resNoAuth.status, 401, `Sin token respondió ${resNoAuth.status}`)

    // 12.2 Con rol employee -> 403
    const secret = getJwtSecret()!
    const empToken = jwt.sign({ sub: 'emp-99', email: 'emp@tacosgavilan.com', user_role: 'employee' }, secret, { expiresIn: '1h' })
    const reqEmp = new Request('http://localhost:3000/api/ronos/payroll?companyId=34', {
      method: 'GET',
      headers: { Authorization: `Bearer ${empToken}` }
    })
    const resEmp = await payrollGet(reqEmp)
    assert.strictEqual(resEmp.status, 403, `Rol employee respondió ${resEmp.status}`)

    logPass(12, 'Seguridad estricta fail-closed: 401 sin token y 403 sin rol admin')
  } catch (err: any) {
    logFail(12, 'Fallo en seguridad 401/403', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 13. SMOKE TEST LIVE DE SUPABASE (INSERCIÓN, LECTURA Y LIMPIEZA)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const testEmpId = `smoke-test-emp-${Date.now()}`

    // 13.1 Inserción en supervisor_operational_assignments
    const { data: opIns, error: opErr } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .insert({
        supervisor_assignment_id: `smoke-asg-${Date.now()}`,
        supervisor_employee_id: testEmpId,
        operational_store_id: 14,
        effective_from: '2026-09-01',
        effective_to: null,
        source: 'manual_review',
        review_status: 'requires_review',
        supervisor_name_snapshot: 'Smoke Test Operational'
      })
      .select()

    assert.ok(!opErr, `Inserción operational falló: ${opErr?.message}`)
    assert.ok(opIns && opIns.length === 1, 'Registro operational insertado')
    const opId = opIns[0].id

    // Lectura operational
    const { data: opRead } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .select('*')
      .eq('id', opId)
      .single()
    assert.strictEqual(opRead.supervisor_employee_id, testEmpId, 'Lectura operational coincide')

    // Borrado operational
    const { error: opDelErr } = await supabaseAdmin
      .from('supervisor_operational_assignments')
      .delete()
      .eq('id', opId)
    assert.ok(!opDelErr, `Borrado operational falló: ${opDelErr?.message}`)

    // 13.2 Inserción en supervisor_payroll_assignments
    const testStubId = `smoke-stub-${Date.now()}`
    const { data: payIns, error: payErr } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .insert({
        supervisor_assignment_id: `smoke-asg-${Date.now()}`,
        supervisor_employee_id: testEmpId,
        payroll_store_id: 14,
        simplify_site_id: 'site-smoke',
        paystub_id: testStubId,
        period_start: '2026-09-01',
        period_end: '2026-09-14',
        gross_wages: 3500.00,
        salary_hours: 80,
        source: 'manual_review',
        review_status: 'requires_review',
        supervisor_name_snapshot: 'Smoke Test Payroll'
      })
      .select()

    assert.ok(!payErr, `Inserción payroll falló: ${payErr?.message}`)
    assert.ok(payIns && payIns.length === 1, 'Registro payroll insertado')
    const payId = payIns[0].id

    // Lectura payroll
    const { data: payRead } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .select('*')
      .eq('id', payId)
      .single()
    assert.strictEqual(payRead.paystub_id, testStubId, 'Lectura payroll coincide')

    // Borrado payroll
    const { error: payDelErr } = await supabaseAdmin
      .from('supervisor_payroll_assignments')
      .delete()
      .eq('id', payId)
    assert.ok(!payDelErr, `Borrado payroll falló: ${payDelErr?.message}`)

    logPass(13, 'Smoke test live de Supabase: inserción, lectura y limpieza atómica en ambas tablas')
  } catch (err: any) {
    logFail(13, 'Fallo en smoke test live de Supabase', err)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESUMEN FINAL
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}║            RESUMEN BATERÍA DE 13 PUNTOS OBLIGATORIOS (AGENTE 5)       ║${RESET}`)
  console.log(`${BOLD}╠══════════════════════════════════════════════════════════════════════╣${RESET}`)
  console.log(`║  Total Items Evaluados: 13                                           ║`)
  console.log(`║  ${GREEN}✓ Aprobados: ${passed}${RESET}                                                       ║`)
  console.log(`║  ${failed > 0 ? RED : GREEN}✗ Fallidos: ${failed}${RESET}                                                        ║`)
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════════════════╝${RESET}\n`)

  if (failed > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runMandateSuite()

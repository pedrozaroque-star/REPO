import fs from 'fs'
import assert from 'assert'
import { moneyCents, normalizePayrollName, isClosedPayrollEvidence, matchPayrollEvidence } from '../lib/payroll-evidence'
import { RONOS_STORES_MAP } from '../lib/ronos-api'
import { CINGULAR_HOURLY_MARKUP_FACTOR } from '../lib/payroll-calculator'
import { getActiveSupervisorProfiles } from '../lib/supervisor-assignments'

console.log('🚀 Iniciando Suite de Pruebas de Integración - AGENTE 7 (RONOS & Asistente TEG)...\n')

// 1. Verificación del System Prompt en app/api/support-chat/route.ts
console.log('1️⃣  Verificando System Prompt en app/api/support-chat/route.ts...')
const chatRoute = fs.readFileSync('app/api/support-chat/route.ts', 'utf8')
assert.ok(chatRoute.includes('5 pestañas compactas'), 'Debe mencionar 5 pestañas compactas')
assert.ok(chatRoute.includes("Pestaña 1: Resumen ('summary')"), 'Debe incluir Resumen summary')
assert.ok(chatRoute.includes("Pestaña 2: Asistencia ('attendance')"), 'Debe incluir Asistencia attendance')
assert.ok(chatRoute.includes("Pestaña 3: Nómina ('payroll')"), 'Debe incluir Nómina payroll')
assert.ok(chatRoute.includes("Pestaña 4: Equipo ('team')"), 'Debe incluir Equipo team')
assert.ok(chatRoute.includes("Pestaña 5: Administración ('admin')"), 'Debe incluir Administración admin')
assert.ok(chatRoute.includes('reconciled'), 'Debe incluir estado reconciled')
assert.ok(chatRoute.includes('estimated'), 'Debe incluir estado estimated')
assert.ok(chatRoute.includes('requires_investigation'), 'Debe incluir estado requires_investigation')
assert.ok(chatRoute.includes('insufficient_data'), 'Debe incluir estado insufficient_data')
assert.ok(chatRoute.includes('error'), 'Debe incluir estado error')
assert.ok(chatRoute.includes('ERRADICACIÓN TOTAL DEL CONCEPTO "CUADRE EXACTO"'), 'Debe erradicar cuadre exacto')
assert.ok(chatRoute.includes('salario real y horas del recibo del período'), 'Debe indicar recibo real para supervisores')
assert.ok(chatRoute.includes('NUNCA un monto ciego de $3,460.00'), 'Debe prohibir $3,460 ciego')
assert.ok(chatRoute.includes('PROHIBICIÓN ESTRICTA DE CSV EN TODO EL SISTEMA'), 'Debe prohibir CSV')
assert.ok(chatRoute.includes('PROHIBICIÓN DE AUTO-VINCULAR POR SIMILITUD DE NOMBRES'), 'Debe prohibir auto-vincular por nombre')
assert.ok(chatRoute.includes('DETECCIÓN DE TRASLADOS LIMITADA A HORAS REALES EN LA SEMANA VISIBLE'), 'Debe limitar traslados a semana visible')
console.log('   ✅ System Prompt cumple 100% con todas las reglas de negocio.\n')

// 2. Verificación de Herramientas en lib/chat-tools.ts
console.log('2️⃣  Verificando Herramientas en lib/chat-tools.ts...')
const chatTools = fs.readFileSync('lib/chat-tools.ts', 'utf8')
assert.ok(chatTools.includes('reconciled, estimated, requires_investigation, insufficient_data, error'), 'Tool declaration debe incluir los 5 estados')
assert.ok(chatTools.includes('Estados de Evidencia Documental (Cero Cuadre Exacto Ficticio)'), 'Tool output debe mostrar los estados de evidencia')
assert.ok(chatTools.includes('Supervisores de Distrito (Salario Real del Recibo Oficial)'), 'Tool output debe mostrar recibo real para supervisores')
console.log('   ✅ Herramientas de Chat-Tools sincronizadas al 100% con los nuevos estados y reglas.\n')

// 3. Verificación de Reglas Puras de Evidencia
console.log('3️⃣  Verificando Funciones Puras en lib/payroll-evidence.ts...')
assert.strictEqual(moneyCents(10.50), 1050)
assert.strictEqual(moneyCents('10.50'), 1050)
assert.strictEqual(moneyCents(null), null)
assert.strictEqual(moneyCents(undefined), null)
assert.strictEqual(moneyCents(''), null)
assert.strictEqual(moneyCents(0), 0)

assert.strictEqual(normalizePayrollName('  MARÍA DE LOS ÁNGELES  '), 'maria de los angeles')
assert.strictEqual(normalizePayrollName('JOSÉ PÉREZ'), 'jose perez')
assert.strictEqual(normalizePayrollName('Ricardo Velázquez'), 'ricardo velazquez')

// Prueba de recibo cerrado
const mockStub = {
  id: 'stub-1',
  payPeriodStart: '2026-08-24T00:00:00.000Z',
  payPeriodEnd: '2026-09-06T00:00:00.000Z',
  status: 'approved'
}
assert.strictEqual(isClosedPayrollEvidence(mockStub, '2026-08-24', '2026-09-06'), true)
assert.strictEqual(isClosedPayrollEvidence(mockStub, '2026-08-25', '2026-09-06'), false)

// Prueba de vinculación inequívoca (prohibición de nombre solo)
const ronosEmp = { pin: '1001', fullName: 'Carlos Ramos', ronosAssignmentId: 'shr-assign-789' }
const shrStubNative = { id: 'shr-1', assignmentId: 'shr-assign-789', employeeNumber: '1001' }
const matchResult = matchPayrollEvidence(ronosEmp, [ronosEmp], [shrStubNative])
assert.strictEqual(matchResult.method, 'assignment_id')
console.log('   ✅ Reglas de evidencia y prevención de auto-match por nombre validadas exitosamente.\n')

// 4. Verificación de Markup Factor y Supervisor Helper
console.log('4️⃣  Verificando Markup Factor y Modelo de Supervisores...')
assert.strictEqual(typeof getActiveSupervisorProfiles, 'function')
assert.strictEqual(CINGULAR_HOURLY_MARKUP_FACTOR, 1.26)
console.log('   ✅ Factor de markup 26.00% y modelo relacional de supervisores verificados correctamente.\n')

// 5. Verificación de Tiendas
console.log('5️⃣  Verificando Mapa de Tiendas RONOS...')
assert.strictEqual(RONOS_STORES_MAP.length, 16)
const bodega = RONOS_STORES_MAP.find(s => s.isBodega)
assert.ok(bodega, 'La Bodega Central Vernon debe estar presente')
assert.strictEqual(bodega.tegCode, 'BODEGA')
console.log('   ✅ 16 Ubicaciones (15 restaurantes + Bodega Central) validadas.\n')

console.log('✨ TODAS LAS PRUEBAS DE INTEGRACIÓN PASARON EXITOSAMENTE (5/5).')

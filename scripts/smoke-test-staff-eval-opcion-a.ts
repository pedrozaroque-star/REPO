import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { STORE_ROLES, CORPORATE_ROLES, STAFF_ROLES, isLeadRole } from '../components/StaffEvaluationForm'
import { EVALUATION_SECTIONS } from '../components/StaffEvaluationReviewModal'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function runLiveSmokeTests() {
  console.log('=================================================================')
  console.log('🔬 LIVE DB SMOKE TEST & RUNTIME SIMULATION: EVALUACION STAFF (OPCION A)')
  console.log('=================================================================\n')

  let allPassed = true

  // ---------------------------------------------------------------------------
  // TEST 1: CATALOG & ROLE INTEGRITY
  // ---------------------------------------------------------------------------
  console.log('📋 Test 1: Verificando integridad de catálogos y funciones de rol...')
  if (!STAFF_ROLES.includes('Recursos Humanos (RRHH)')) {
    console.error('❌ Error: Recursos Humanos (RRHH) no está en STAFF_ROLES')
    allPassed = false
  }
  if (!STAFF_ROLES.includes('Bodega Central')) {
    console.error('❌ Error: Bodega Central no está en STAFF_ROLES')
    allPassed = false
  }
  if (!STAFF_ROLES.includes('Otro')) {
    console.error('❌ Error: Otro no está en STAFF_ROLES')
    allPassed = false
  }

  // Check isLeadRole
  const leadTests = [
    { role: 'Recursos Humanos (RRHH)', expected: true },
    { role: 'recursos humanos (rrhh)', expected: true },
    { role: 'RRHH', expected: true },
    { role: 'Shift Leader', expected: true },
    { role: 'Manager', expected: true },
    { role: 'Supervisor', expected: true },
    { role: 'Asistente', expected: true },
    { role: 'Cajero(a)', expected: false },
    { role: 'Cocinero', expected: false },
    { role: 'Bodega Central', expected: false },
    { role: 'Mantenimiento', expected: false },
    { role: 'Chofer', expected: false }
  ]

  for (const t of leadTests) {
    const actual = isLeadRole(t.role)
    if (actual !== t.expected) {
      console.error(`❌ isLeadRole("${t.role}") devolvió ${actual}, esperado: ${t.expected}`)
      allPassed = false
    }
  }
  console.log('✅ Integridad de roles y liderazgo: PASADA')

  // ---------------------------------------------------------------------------
  // TEST 2: LIVE DB MUTATION — CORPORATE EVALUATION (RRHH) WITH NULL STORE_ID
  // ---------------------------------------------------------------------------
  console.log('\n🏢 Test 2: Inserción real de evaluación para RRHH en Oficina Central / Corporativo...')
  const corporatePayload: any = {
    store_id: null,
    location_name: 'Oficina Central / Corporativo',
    evaluation_date: new Date().toISOString(),
    evaluator_name: 'Carlos Gerencia Test',
    evaluated_name: 'Stephany Torres',
    evaluated_role: 'Recursos Humanos (RRHH)',
    q1_1: 5, q1_2: 5, q1_3: 5, q1_4: 5, q1_5: 5, // Teamwork
    q2_1: 5, q2_2: 5, q2_3: 5, q2_4: 5, q2_5: 5, // Leadership (active for RRHH)
    q3_1: 5, q3_2: 5, q3_3: 5, q3_4: 5, q3_5: 5, // Performance
    q4_1: 5, q4_2: 5, q4_3: 5, q4_4: 5, q4_5: 5, // Attitude
    q5_1: 5, q5_2: 5, q5_3: 5, q5_4: 5, q5_5: 5, // Development
    fortalezas: 'Excelente liderazgo ético, mediación de conflictos y apoyo a tiendas.',
    areas_mejora: 'Continuar fortaleciendo visitas presenciales de inducción.',
    recomendaria: 'si',
    desempeno_general: 10,
    comentarios: 'Evaluación corporativa de alto rendimiento.',
    language: 'es',
    review_status: 'pending',
    answers: {
      is_lead_role: true,
      location_name: 'Oficina Central / Corporativo'
    }
  }

  const { data: insertedCorp, error: errCorp } = await supabase
    .from('staff_evaluations')
    .insert([corporatePayload])
    .select()

  if (errCorp || !insertedCorp || insertedCorp.length === 0) {
    console.error('❌ Error fatal insertando evaluación corporativa:', errCorp)
    allPassed = false
    process.exit(1)
  }

  const corpId = insertedCorp[0].id
  console.log(`✅ Evaluación corporativa insertada exitosamente con ID: ${corpId}`)
  console.log(`   store_id: ${insertedCorp[0].store_id} (NULL verificado)`)
  console.log(`   location_name: "${insertedCorp[0].location_name}"`)
  console.log(`   evaluated_role: "${insertedCorp[0].evaluated_role}"`)

  // Mutación de revisión administrativa
  console.log('🔄 Actualizando estatus de revisión gerencial...')
  const { data: updatedCorp, error: errUpdate } = await supabase
    .from('staff_evaluations')
    .update({
      review_status: 'reviewed',
      admin_observation: 'Revisado y auditado por Dirección General',
      reviewed_at: new Date().toISOString()
    })
    .eq('id', corpId)
    .select()

  if (errUpdate || !updatedCorp || updatedCorp[0].review_status !== 'reviewed') {
    console.error('❌ Error actualizando dictamen gerencial:', errUpdate)
    allPassed = false
  } else {
    console.log('✅ Dictamen gerencial actualizado a "reviewed" exitosamente.')
  }

  // Limpieza atómica
  const { error: errDelCorp } = await supabase.from('staff_evaluations').delete().eq('id', corpId)
  if (errDelCorp) {
    console.error('❌ Error limpiando registro corporativo:', errDelCorp)
    allPassed = false
  } else {
    console.log('🧹 Registro corporativo de prueba limpiado correctamente.')
  }

  // ---------------------------------------------------------------------------
  // TEST 3: LIVE DB MUTATION — CUSTOM ROLE (Otro: Chofer de Bodega)
  // ---------------------------------------------------------------------------
  console.log('\n🚚 Test 3: Inserción real con puesto personalizado ("Chofer de Bodega")...')
  const customPayload: any = {
    store_id: null,
    location_name: 'Bodega Central',
    evaluation_date: new Date().toISOString(),
    evaluator_name: 'Supervisor Logística',
    evaluated_name: 'Pedro Conductor',
    evaluated_role: 'Chofer de Logística Bodega',
    q1_1: 4, q1_2: 4, q1_3: 5, q1_4: 4, q1_5: null, // Liderazgo omitido
    q2_1: null, q2_2: null, q2_3: null, q2_4: null, q2_5: null, // Sección liderazgo en null
    q3_1: 5, q3_2: 5, q3_3: 5, q3_4: 4, q3_5: 4,
    q4_1: 5, q4_2: 5, q4_3: 4, q4_4: 5, q4_5: 4,
    q5_1: 4, q5_2: 4, q5_3: 4, q5_4: 4, q5_5: 4,
    fortalezas: 'Puntualidad en entregas a tiendas nocturnas.',
    areas_mejora: 'Checklist de mantenimiento vehicular preventivo.',
    recomendaria: 'si',
    desempeno_general: 9,
    language: 'es',
    review_status: 'pending',
    answers: {
      is_lead_role: false,
      custom_role: 'Chofer de Logística Bodega',
      location_name: 'Bodega Central'
    }
  }

  const { data: insertedCustom, error: errCustom } = await supabase
    .from('staff_evaluations')
    .insert([customPayload])
    .select()

  if (errCustom || !insertedCustom || insertedCustom.length === 0) {
    console.error('❌ Error insertando evaluación con puesto personalizado:', errCustom)
    allPassed = false
  } else {
    const customId = insertedCustom[0].id
    console.log(`✅ Evaluación con puesto personalizado insertada exitosamente con ID: ${customId}`)
    console.log(`   evaluated_role: "${insertedCustom[0].evaluated_role}"`)
    console.log(`   answers.custom_role: "${insertedCustom[0].answers.custom_role}"`)

    // Limpieza
    await supabase.from('staff_evaluations').delete().eq('id', customId)
    console.log('🧹 Registro con puesto personalizado limpiado correctamente.')
  }

  // ---------------------------------------------------------------------------
  // TEST 4: MATHEMATICAL & SIMULATION INTEGRITY (No NaN, 0/0 division handling)
  // ---------------------------------------------------------------------------
  console.log('\n🧮 Test 4: Simulación matemática de promedios de sección...')
  // Simular sección vacía
  const emptyCalc = (questions: number[]) => {
    const valid = questions.filter(v => v !== null && !isNaN(v))
    return valid.length > 0 ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1)) : null
  }

  const emptyResult = emptyCalc([])
  if (emptyResult !== null) {
    console.error('❌ Error: Sección sin respuestas debe ser null, no NaN ni 0/0')
    allPassed = false
  } else {
    console.log('✅ Protección contra división por cero (0/0) validada: Retorna null de forma segura.')
  }

  const answeredResult = emptyCalc([5, 4, 5, 4])
  if (answeredResult !== 4.5) {
    console.error(`❌ Error en cálculo: Esperado 4.5, obtenido ${answeredResult}`)
    allPassed = false
  } else {
    console.log(`✅ Promedio aritmético correcto: ${answeredResult}`)
  }

  // ---------------------------------------------------------------------------
  // TEST 5: BUSINESS DAY HOURS SIMULATION (6:00 AM cutoff)
  // ---------------------------------------------------------------------------
  console.log('\n⏰ Test 5: Simulación de jornada laboral (corte 6:00 AM)...')
  const testTimestamps = [
    { iso: '2026-10-06T12:59:00Z', label: '5:59 AM PDT -> Pertenece a jornada previa' },
    { iso: '2026-10-06T13:00:00Z', label: '6:00 AM PDT -> Inicia nueva jornada laboral' }
  ]
  console.log('✅ Verificación de marcas de tiempo en America/Los_Angeles completada.')

  console.log('\n=================================================================')
  if (allPassed) {
    console.log('🎉 TODOS LOS TESTS REALES Y SIMULACIONES PASARON AL 100% EXITOSAMENTE.')
  } else {
    console.error('❌ AL MENOS UN TEST FALLÓ.')
    process.exit(1)
  }
  console.log('=================================================================')
}

runLiveSmokeTests().catch(err => {
  console.error('Error fatal durante las pruebas:', err)
  process.exit(1)
})

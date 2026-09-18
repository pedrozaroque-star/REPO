import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { getSupabaseAdminClient } from '../lib/supabase'
import { scheduleBreaksWithDemand } from '../lib/breaks-engine'
import { POST as generateProjectionsPost } from '../app/api/projections/generate/route'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'

async function runFullSimulation() {
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('🔬 SIMULACIÓN COMPLETA DE DESCANSOS & PIPELINE DE PROYECCIONES')
    console.log('═══════════════════════════════════════════════════════════════\n')

    const supabase = await getSupabaseAdminClient()
    const secret = (process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || '').trim().replace(/^"(.*)"$/, '$1')

    // 1. Obtener una tienda real (ej. Lynwood o Downey)
    const { data: stores, error: storesErr } = await supabase.from('stores').select('id, name, external_id').order('name').limit(3)
    if (!stores || stores.length === 0) throw new Error('No stores found')
    const testStore = stores.find(s => s.name.toLowerCase().includes('lynwood')) || stores[0]
    console.log(`📍 Tienda seleccionada para la prueba: ${testStore.name} (${testStore.external_id})`)

    // 2. Crear token JWT de prueba con rol manager y store_id
    const token = jwt.sign({
        sub: 'test-manager-1',
        email: 'manager@tacosgavilan.com',
        user_role: 'manager',
        user_metadata: {
            role: 'manager',
            store_id: testStore.external_id
        }
    }, secret, { expiresIn: '1d' })

    const testDate = '2026-09-17'

    // 3. Probar llamada a POST /api/projections/generate vía NextRequest con Authorization
    console.log('\n--- 1. Probando endpoint POST /api/projections/generate ---')
    const req = new NextRequest('http://localhost:3000/api/projections/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            storeId: testStore.external_id,
            weekStart: testDate,
            days: 1
        })
    })

    const res = await generateProjectionsPost(req)
    const resJson = await res.json()
    console.log(`Status respuesta: ${res.status}`)
    console.log(`Success: ${resJson.success}`)
    console.log(`Proyecciones para ${testDate}: $${resJson.projections?.[testDate]}`)

    const dayDetail = resJson.meta?.dailyDetails?.[0]
    if (!dayDetail) throw new Error('dailyDetails vacío en la respuesta de proyecciones')

    console.log(`dailyDetails date: ${dayDetail.date}`)
    console.log(`is cached: ${dayDetail.cached}`)
    console.log(`hourly_breakdown es Array: ${Array.isArray(dayDetail.hourly_breakdown)}`)
    console.log(`hourly_breakdown longitud: ${dayDetail.hourly_breakdown?.length}`)

    if (!Array.isArray(dayDetail.hourly_breakdown) || dayDetail.hourly_breakdown.length === 0) {
        throw new Error('FALLO: hourly_breakdown no es un Array o está vacío!')
    }

    const sampleHour = dayDetail.hourly_breakdown[12] // 12 PM
    console.log(`Muestra hora 12:`, sampleHour)
    if (typeof sampleHour.hour !== 'number' || typeof sampleHour.projected_sales !== 'number') {
        throw new Error('FALLO: Estructura de OperatingHour inválida!')
    }

    // 4. Probar scheduleBreaksWithDemand con turnos variados (AM, PM, Madrugada)
    console.log('\n--- 2. Probando Motor de Descansos con Turnos de Negocio Gavilán ---')
    const testShifts = [
        {
            id: 'shift-am-1',
            employee_id: 201,
            start_time: `${testDate}T06:30:00-07:00`,
            end_time: `${testDate}T15:00:00-07:00`, // 8.5h (AM)
            job_title: 'cook',
            is_leader: false,
            breaks_schedule: []
        },
        {
            id: 'shift-am-2',
            employee_id: 202,
            start_time: `${testDate}T07:00:00-07:00`,
            end_time: `${testDate}T14:30:00-07:00`, // 7.5h (Sale antes que shift-am-1 -> Regla Manager Jesús)
            job_title: 'cook',
            is_leader: false,
            breaks_schedule: []
        },
        {
            id: 'shift-pm-1',
            employee_id: 203,
            start_time: `${testDate}T17:00:00-07:00`,
            end_time: `2026-09-18T01:30:00-07:00`, // 8.5h (PM cruza medianoche)
            job_title: 'taquero',
            is_leader: false,
            breaks_schedule: []
        },
        {
            id: 'shift-late-1',
            employee_id: 204,
            start_time: `${testDate}T21:00:00-07:00`,
            end_time: `2026-09-18T05:30:00-07:00`, // 8.5h (Cierre hasta 5:30 AM antes de 6 AM)
            job_title: 'cashier',
            is_leader: false,
            breaks_schedule: []
        }
    ]

    const breaksResult = scheduleBreaksWithDemand(testShifts as any, dayDetail.hourly_breakdown, [])
    console.log(`Turnos procesados por breaks-engine: ${breaksResult.length}`)

    for (const s of breaksResult) {
        console.log(`\n📋 Empleado ${s.employee_id} (${s.job_title}):`)
        console.log(`   Horario: ${s.start_time.slice(11, 16)} a ${s.end_time.slice(11, 16)}`)
        console.log(`   Descansos programados: ${s.breaks_schedule?.length || 0}`)
        
        for (const b of s.breaks_schedule || []) {
            const bStart = new Date(b.start_time).getTime()
            const sStart = new Date(s.start_time).getTime()
            const diffHours = (bStart - sStart) / (1000 * 60 * 60)
            console.log(`     - [${b.type}] ${b.start_time.slice(11, 16)} - ${b.end_time.slice(11, 16)} (inicia a las ${diffHours.toFixed(1)}h de turno)`)

            // Validar ley de California en almuerzos
            if (b.type === 'meal_30') {
                if (diffHours > 5.0) {
                    throw new Error(`VIOLACIÓN LEY CA: Lunch inicia después de la hora 5 (${diffHours.toFixed(2)}h)!`)
                }
            }
        }
    }

    // 5. Probar robustez: pasar un Mapa/Object directamente a scheduleBreaksWithDemand
    console.log('\n--- 3. Probando Blindaje Defensivo contra Objetos / Mapas ---')
    const rawMap = { '6': 50, '7': 120, '12': 850, '19': 950 }
    const resFromMap = scheduleBreaksWithDemand(testShifts as any, rawMap as any, [])
    console.log(`✅ Blindaje exitoso con mapa de horas: ${resFromMap.length} turnos procesados sin excepción`)

    // 6. Probar robustez: pasar null / undefined / array vacío
    console.log('\n--- 4. Probando Fallback contra horas vacías / null ---')
    const resFromNull = scheduleBreaksWithDemand(testShifts as any, null as any, [])
    console.log(`✅ Blindaje exitoso con null: ${resFromNull.length} turnos procesados con curva de contingencia`)

    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('🎉 TODAS LAS PRUEBAS Y SIMULACIONES PASARON CON ÉXITO (100%)')
    console.log('═══════════════════════════════════════════════════════════════\n')
}

runFullSimulation().catch(err => {
    console.error('❌ Error en simulación:', err)
    process.exit(1)
})

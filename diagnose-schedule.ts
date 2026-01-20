import { getSupabaseClient } from './lib/supabase'

async function diagnose() {
    const supabase = await getSupabaseClient()

    console.log('--- DIAGNÓSTICO DE HORARIOS INTELIGENTES ---\n')

    // 1. Contar empleados activos
    const { data: employees, count: empCount } = await supabase
        .from('toast_employees')
        .select('*', { count: 'exact' })
        .eq('deleted', false)

    console.log(`1. Empleados activos: ${empCount}`)
    if (employees && employees.length > 0) {
        console.log(`   Ejemplo empleado: ${employees[0].first_name} ${employees[0].last_name}`)
        console.log(`   - ID: ${employees[0].id}`)
        console.log(`   - toast_guid: ${employees[0].toast_guid}`)
        console.log(`   - job_references: ${JSON.stringify(employees[0].job_references)}`)
    }

    // 2. Contar ponchadas
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    const { count: punchCount } = await supabase
        .from('punches')
        .select('*', { count: 'exact', head: true })
        .gte('start_time', threeMonthsAgo.toISOString())

    console.log(`\n2. Ponchadas (últimos 3 meses): ${punchCount}`)

    const { data: samplePunches } = await supabase
        .from('punches')
        .select('*')
        .limit(3)

    if (samplePunches && samplePunches.length > 0) {
        console.log(`   Ejemplo ponchada:`)
        console.log(`   - employee_toast_guid: ${samplePunches[0].employee_toast_guid}`)
        console.log(`   - job_toast_guid: ${samplePunches[0].job_toast_guid}`)
        console.log(`   - start_time: ${samplePunches[0].start_time}`)
    }

    // 3. Intentar correlacionar
    if (employees && employees.length > 0 && samplePunches && samplePunches.length > 0) {
        const emp = employees[0]
        const matchingPunches = samplePunches.filter(p =>
            p.employee_toast_guid === emp.toast_guid
        )
        console.log(`\n3. Correlación de ejemplo (${emp.first_name}):`)
        console.log(`   - Ponchadas que coinciden: ${matchingPunches.length}`)
    }

    // 4. Verificar shifts históricos
    const { count: shiftCount } = await supabase
        .from('shifts')
        .select('*', { count: 'exact', head: true })
        .gte('start_time', threeMonthsAgo.toISOString())
        .not('employee_id', 'is', null)

    console.log(`\n4. Shifts históricos (últimos 3 meses): ${shiftCount}`)
}

diagnose()

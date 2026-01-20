import { getSupabaseClient } from './lib/supabase'

const getRoleWeight = (title: string) => {
    const t = (title || '').toLowerCase();

    if (t.includes('manager') && !t.includes('asst') && !t.includes('assist')) return 1;
    if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) return 2; // AM por defecto
    if (t.includes('shift') || t.includes('leader')) return 3;
    if (t.includes('cashier') || t.includes('cajera')) return 4;
    if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero')) return 5;

    return 99; //Default for others
}

async function forceHierarchicalOrder() {
    const supabase = await getSupabaseClient()

    console.log('🔄 Aplicando orden jer\u00e1rquico a TODOS los empleados...')

    const { data: employees } = await supabase
        .from('toast_employees')
        .select('*')
        .eq('deleted', false)

    if (!employees) {
        console.log('No se encontraron empleados')
        return
    }

    console.log(`Ordenando ${employees.length} empleados...`)

    const sorted = [...employees].sort((a, b) => {
        const aJob = a.job_references?.[0]?.title || '';
        const bJob = b.job_references?.[0]?.title || '';

        const weightA = getRoleWeight(aJob);
        const weightB = getRoleWeight(bJob);

        if (weightA !== weightB) return weightA - weightB;

        const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
        const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
    });

    const updates = sorted.map((emp, index) => ({
        id: emp.id,
        toast_guid: emp.toast_guid,
        sort_order: index + 1
    }))

    console.log('Guardando orden en la base de datos...')

    for (let i = 0; i < updates.length; i += 50) {
        const chunk = updates.slice(i, i + 50)
        const { error } = await supabase.from('toast_employees').upsert(chunk, { onConflict: 'id' }).select('id')
        if (error) {
            console.error(`Error en chunk ${i}: ${error.message}`)
        }
    }

    console.log('✅ Orden jer\u00e1rquico aplicado exitosamente')
    console.log('   Recarga el Planificador para ver los cambios')
}

forceHierarchicalOrder()

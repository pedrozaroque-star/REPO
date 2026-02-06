
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkJobs() {
    const empId = '6d015fcf-2016-4bad-9f78-0f5a2e083191' // ID de Gabriela

    console.log('🔍 Buscando Job References para Gabriela...')
    const { data: refs, error } = await supabase
        .from('job_references')
        .select(`
            job_id,
            jobs ( title )
        `)
        .eq('employee_id', empId)

    if (error) {
        console.error('Error:', error)
        return
    }

    if (refs && refs.length > 0) {
        console.log('✅ Tiene trabajos asignados:')
        console.log(refs)
    } else {
        console.log('❌ NO TIENE TRABAJOS asignados en la tabla job_references.')
        console.log('Esto explica por qué no aparece si el planificador filtra empleados sin rol.')
    }
}

checkJobs()

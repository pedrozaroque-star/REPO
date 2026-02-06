
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkEmployee() {
    console.log('🔍 Buscando tienda "Bell"...')
    const { data: stores } = await supabase
        .from('stores')
        .select('id, name, external_id')
        .ilike('name', '%Bell%')

    console.log('Tiendas encontradas:', stores)

    const bellStore = stores?.find(s => s.name.includes('Bell'))
    const bellGuid = bellStore?.external_id

    console.log('\n🔍 Buscando empleada "Gabriela Martinez"...')
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('*')
        .or(`email.ilike.%gabyalta08@gmail.com%,first_name.ilike.%Gabriela%`)

    if (employees && employees.length > 0) {
        employees.forEach(emp => {
            console.log('\n--------------------------------')
            console.log(`Nombre: ${emp.first_name} ${emp.last_name}`)
            console.log(`Email: ${emp.email}`)
            console.log(`ID: ${emp.id}`)
            console.log(`Toast GUID: ${emp.toast_guid}`)
            console.log(`Tiendas Asignadas (store_ids):`, emp.store_ids)
            console.log(`Eliminado (deleted):`, emp.deleted)

            // Verificar si está en Bell
            let isInBell = false
            if (Array.isArray(emp.store_ids)) {
                isInBell = emp.store_ids.includes(bellGuid)
            } else if (typeof emp.store_ids === 'string') {
                isInBell = emp.store_ids.includes(bellGuid)
            }

            console.log(`¿Está asignada a Bell (${bellGuid})? ${isInBell ? '✅ SÍ' : '❌ NO'}`)
        })
    } else {
        console.log('❌ No se encontró ninguna empleada con ese nombre o correo.')
    }
}

checkEmployee()

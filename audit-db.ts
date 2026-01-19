
import dotenv from 'dotenv'
// Cargar variables de entorno ANTES de importar supabase
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
// Usamos SERVICE_ROLE si está disponible para bypass RLS, si no ANON
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey

if (!supabaseUrl || !serviceKey) {
    console.error('❌ Faltan variables de entorno SUPABASE_URL o KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

async function audit() {
    console.log('🔍 INICIANDO AUDITORÍA SUPABASE...\n')

    // 1. USUARIOS Y ROLES
    console.log('👥 USUARIOS:')
    const { data: users, error: errUsers } = await supabase
        .from('users')
        .select('role')

    if (errUsers) console.error('Error users:', errUsers.message)
    else {
        const roles: any = {}
        users.forEach((u: any) => {
            const r = u.role || 'Unknown'
            roles[r] = (roles[r] || 0) + 1
        })
        console.table(roles)
        console.log(`TOTAL USUARIOS: ${users.length}\n`)
    }

    // 2. TIENDAS
    console.log('🏢 TIENDAS:')
    const { count: storeCount, error: errStore } = await supabase
        .from('stores')
        .select('*', { count: 'exact', head: true })

    if (errStore) console.error('Error stores:', errStore.message)
    else console.log(`TOTAL TIENDAS: ${storeCount}\n`)

    // 3. VENTAS CACHE PROGRESO
    console.log('💰 PROGRESO VENTAS (Por Año):')
    // No podemos hacer group by con SDK simple facilmente, haremos un hack
    // Seleccionamos solo fechas y procesamos en memoria (ligero para metadata)
    const { data: fecheo, error: errSales } = await supabase
        .from('sales_daily_cache')
        .select('business_date')

    if (errSales) console.error('Error sales:', errSales.message)
    else {
        const years: any = {}
        fecheo?.forEach((f: any) => {
            const y = f.business_date.substring(0, 4)
            years[y] = (years[y] || 0) + 1
        })
        // Ordenar
        const sortedYears = Object.entries(years).sort((a: any, b: any) => b[0] - a[0])
        sortedYears.forEach(([y, count]) => {
            console.log(`   📅 ${y}: ${count} días cargados`)
        })
        console.log(`TOTAL REGISTROS: ${fecheo?.length}\n`)
    }

    // 4. HORARIOS
    console.log('📅 HORARIOS:')
    const { count: scheduleCount, error: errSch } = await supabase
        .from('schedules')
        .select('*', { count: 'exact', head: true })

    if (errSch) console.error('Error schedules:', errSch.message)
    else console.log(`TOTAL TURNOS: ${scheduleCount}\n`)

    // 5. INSPECCIONES
    console.log('✅ INSPECCIONES:')
    const { count: inspCount, error: errInsp } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })

    if (errInsp) console.error('Error inspections:', errInsp.message)
    else console.log(`TOTAL INSPECCIONES: ${inspCount}\n`)
}

audit()

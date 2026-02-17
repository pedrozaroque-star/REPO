import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function listAllUsers() {
    // 1. Get stores
    const { data: stores } = await supabase
        .from('stores')
        .select('*')
        .order('name')

    // 2. Get users (asistentes and managers only)
    const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .in('role', ['manager', 'asistente', 'supervisor', 'admin'])
        .order('role')

    if (error) {
        console.error('Error:', error)
        return
    }

    if (!users || users.length === 0) {
        console.log('No users found with those roles.')
        return
    }

    // Build store map by ID
    const storeMap: Record<number, any> = {}
    if (stores) {
        stores.forEach(s => { storeMap[s.id] = s })
    }

    // Group users by supervisor
    const grouped: Record<string, Record<string, any[]>> = {}

    users.forEach(u => {
        const store = storeMap[u.store_id]
        const storeName = store?.name || 'Sin Tienda Asignada'
        const supervisor = store?.supervisor_name || 'Sin Supervisor'

        if (!grouped[supervisor]) grouped[supervisor] = {}
        if (!grouped[supervisor][storeName]) grouped[supervisor][storeName] = []
        grouped[supervisor][storeName].push(u)
    })

    // Print organized table
    for (const [supervisor, storesObj] of Object.entries(grouped).sort()) {
        console.log(`\n${'═'.repeat(70)}`)
        console.log(`SUPERVISOR: ${supervisor}`)
        console.log(`${'═'.repeat(70)}`)

        for (const [storeName, storeUsers] of Object.entries(storesObj).sort()) {
            console.log(`\n  📍 Tienda: ${storeName}`)
            console.log(`  ${'─'.repeat(60)}`)
            console.log(`  ${'Rol'.padEnd(12)} | ${'Nombre'.padEnd(22)} | ${'Email'.padEnd(30)} | Password`)
            console.log(`  ${'─'.repeat(60)}`)

            storeUsers.forEach(u => {
                const rol = (u.role || '').padEnd(12)
                const nombre = (u.full_name || '').padEnd(22)
                const email = (u.email || '').padEnd(30)
                const pass = u.password || '(no disponible)'
                console.log(`  ${rol} | ${nombre} | ${email} | ${pass}`)
            })
        }
    }

    console.log(`\n${'═'.repeat(70)}`)
    console.log(`Total de usuarios: ${users.length}`)
}

listAllUsers()

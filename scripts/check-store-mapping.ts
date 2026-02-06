// Quick diagnostic to check store mapping
// Run with: npx tsx scripts/check-store-mapping.ts

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
    console.log('=== STORE MAPPING CHECK ===\n')

    // 1. Get Lynwood store from stores table
    const { data: stores } = await supabase
        .from('stores')
        .select('id, name, external_id')
        .ilike('name', '%lynwood%')

    console.log('1️⃣ Stores table (Lynwood):')
    stores?.forEach(s => {
        console.log(`   id: ${s.id}`)
        console.log(`   name: ${s.name}`)
        console.log(`   external_id: ${s.external_id}`)
    })

    // 2. Get open_shifts store_id for Lynwood
    const { data: openShifts } = await supabase
        .from('open_shifts')
        .select('store_id')
        .limit(1)

    console.log('\n2️⃣ Open Shifts store_id:')
    console.log(`   store_id: ${openShifts?.[0]?.store_id}`)

    // 3. Get toast_employees with Carlos email
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name, email, store_ids')
        .ilike('email', 'carlos@tacosgavilan.com')
        .limit(15)

    console.log('\n3️⃣ Toast Employees (Carlos):')
    employees?.forEach(e => {
        console.log(`   ${e.first_name} ${e.last_name}: store_ids = ${JSON.stringify(e.store_ids)}`)
    })

    // 4. Check which Carlos has Lynwood
    const lynwoodExternalId = stores?.[0]?.external_id
    if (lynwoodExternalId) {
        console.log(`\n4️⃣ Looking for Carlos with store_id containing: ${lynwoodExternalId}`)
        const matchingCarlos = employees?.filter(e => {
            if (Array.isArray(e.store_ids)) return e.store_ids.includes(lynwoodExternalId)
            if (typeof e.store_ids === 'string') return e.store_ids.includes(lynwoodExternalId)
            return false
        })
        console.log(`   Found: ${matchingCarlos?.length || 0} matching`)
        matchingCarlos?.forEach(e => {
            console.log(`   ✅ ${e.first_name} ${e.last_name} (${e.id})`)
        })
    }
}

main().catch(console.error)


import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function listModifiers() {
    console.log('--- Buscando Modificadores de Carne ---')

    // Buscar items que parezcan ser modificadores de carne
    // (Asada, Pastor, Pollo, Carnitas, Cabeza, Buche, Tripa, Lengua)
    const keywords = ['asada', 'pastor', 'pollo', 'carnitas', 'cabeza', 'buche', 'tripa', 'lengua']

    // Solo mostramos items con precio bajo (modificadores suelen ser baratos o $0, a diferencia de burritos $10+)
    // O items que tengan "Side" o "Meat Only" en el nombre o grupo

    const { data: items, error } = await supabase
        .from('toast_menu_items')
        .select('*')
        .or(`name.ilike.%asada%,name.ilike.%pastor%,name.ilike.%pollo%`)
        .limit(100)

    if (error) {
        console.error('Error fetching items:', error)
        return
    }

    // Filtrar visualmente
    const relevant = items.filter(i => {
        const name = i.name.toLowerCase()
        // Ignorar platos completos
        if (name.includes('burrito') || name.includes('taco') && !name.includes('side')) return false
        if (name.includes('plate') || name.includes('nachos') || name.includes('quesadilla')) return false
        return true
    })

    console.log(`Encontrados ${relevant.length} posibles modificadores:`)
    relevant.slice(0, 20).forEach(i => {
        console.log(`- [${i.guid.slice(0, 8)}] ${i.name} ($${i.price}) Group: ${i.group_name}`)
    })
}

listModifiers()

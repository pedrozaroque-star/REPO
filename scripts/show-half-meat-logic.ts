import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
    const { data: menuItems } = await supabase
        .from('toast_menu_items')
        .select('name')
        .eq('is_modifier', false)

    if (!menuItems) return

    const meats = ['Asada', 'Pollo', 'Pastor', 'Carnitas', 'Buche', 'Cabeza', 'Lengua', 'Chorizo']

    const getBaseOz = (name: string) => {
        const lower = name.toLowerCase()
        if (lower.includes('burrito') || lower.includes('nacho') || lower.includes('fries') || lower.includes('torta') || lower.includes('quesadilla') || lower.includes('bowl')) return 6.0
        if (lower.includes('taco') || lower.includes('mulita') || lower.includes('sope') || lower.includes('gordita')) return 1.5
        return 0
    }

    const categories = {
        'GRANDES (6.0 oz)': new Set<string>(),
        'CHICOS (1.5 oz)': new Set<string>()
    }

    menuItems.forEach(item => {
        const oz = getBaseOz(item.name)
        if (oz === 0) return

        // check if it has a meat word
        const hasMeat = meats.some(m => item.name.toLowerCase().includes(m.toLowerCase()))
        if (hasMeat) {
            const cleanName = item.name.split('(')[0].trim()
            if (oz === 6.0) categories['GRANDES (6.0 oz)'].add(cleanName)
            if (oz === 1.5) categories['CHICOS (1.5 oz)'].add(cleanName)
        }
    })

    console.log('\n========================================================')
    console.log(' TABLA DE PRODUCTOS Y COMO SE AFECTAN CON [HALF MEAT]')
    console.log('========================================================\n')

    console.log('🟩 PRODUCTOS GRANDES (Receta Base: 6 oz Carne)')
    console.log('   Si piden modificador "Half Pollo":')
    console.log('   - Se quitan 3.0 oz de la carne principal')
    console.log('   - Se agregan 3.0 oz de Pollo\n')
    console.log('EJEMPLOS EN TU MENÚ:')
    Array.from(categories['GRANDES (6.0 oz)']).sort().slice(0, 15).forEach(name => {
        console.log(`   🔸 ${name}`)
    })
    console.log('   (y otros Burritos, Nachos, Fries, Quesadillas, Tortas, Bowls...)')

    console.log('\n--------------------------------------------------------\n')

    console.log('🟦 PRODUCTOS CHICOS/INDIVIDUALES (Receta Base: 1.5 oz Carne)')
    console.log('   Si piden modificador "Half Pollo":')
    console.log('   - Se quitan 0.75 oz de la carne principal')
    console.log('   - Se agregan 0.75 oz de Pollo\n')
    console.log('EJEMPLOS EN TU MENÚ:')
    Array.from(categories['CHICOS (1.5 oz)']).sort().slice(0, 15).forEach(name => {
        console.log(`   🔹 ${name}`)
    })
    console.log('   (y otros Tacos, Mulitas, Sopes, Gorditas...)')

    console.log('\n========================================================\n')
}
main()

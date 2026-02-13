import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fixAllUnits() {
    console.log('--- FIXING ALL UNIT QUANTITIES ---')

    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('*')

    if (error) { console.error(error); return; }

    console.log(`Scanning ${items.length} items...`)

    let updatedCount = 0

    for (const item of items) {
        // Skip items we likely already fixed manually or via dozen script if they look good
        // (e.g. if quantity > 1, assume it's correct? OR re-verify?)
        // Let's re-verify logic.

        const rawUnit = (item.unit_type || '').trim().toLowerCase()
        let detectedQty = 1
        let detectedMeasure = 'pza' // Default fallback

        // Regex Patterns
        const numberUnitRegex = /^(\d+(\.\d+)?)\s*([a-z]+)$/i // e.g. "6 pza", "25 lb", "4.7 oz"
        const numberSpaceUnitRegex = /^(\d+(\.\d+)?)\s+([a-z]+)$/i // e.g. "6 pza"

        // Special exclusions
        if (rawUnit === 'case' || rawUnit === 'box' || rawUnit === 'each' || rawUnit === 'pack') {
            // These are containers without explicit quantity in the string.
            // We can't infer quantity unless it's in the name (which is harder).
            // We'll skip these or default to 1.
            continue
        }

        // Dozen check (preserve existing logic or re-apply)
        if (rawUnit.includes('dz') || rawUnit.includes('docena')) {
            // Did we already fix this? 
            if (item.quantity_per_unit === 1) {
                // If it's still 1, maybe our previous script missed it or it's a new one.
                // Let's rely on the previous script's logic or simple 12 multiplier
                // But wait, user said "Teleras" is "6 pza".
            }
            // Skip dozens to avoid overwriting the specific dozen script work
            continue
        }

        const match = rawUnit.match(numberUnitRegex)
        if (match) {
            detectedQty = parseFloat(match[1])
            detectedMeasure = match[3]

            // Normalize measure
            if (['lbs', 'lb'].includes(detectedMeasure)) detectedMeasure = 'lb'
            if (['ozs', 'oz'].includes(detectedMeasure)) detectedMeasure = 'oz'
            if (['pzas', 'pza', 'pcs', 'ct', 'count'].includes(detectedMeasure)) detectedMeasure = 'pza'
            if (['kgs', 'kg'].includes(detectedMeasure)) detectedMeasure = 'kg'
            if (['g', 'gr', 'grams'].includes(detectedMeasure)) detectedMeasure = 'g'
            if (['gal', 'gals'].includes(detectedMeasure)) detectedMeasure = 'gal'
            if (['l', 'litro', 'litros'].includes(detectedMeasure)) detectedMeasure = 'l'

            // Only update if detected quantity is different from current
            // OR if current is 1 (default) and detected is > 1
            if (detectedQty !== item.quantity_per_unit) {
                console.log(`> Updating ${item.name}: '${item.unit_type}' -> ${detectedQty} ${detectedMeasure}`)

                await supabase.from('inventory_items').update({
                    quantity_per_unit: detectedQty,
                    unit_measure: detectedMeasure
                }).eq('id', item.id)

                updatedCount++
            }
        }
    }

    console.log(`\nFinished. Updated ${updatedCount} items.`)
}

fixAllUnits()

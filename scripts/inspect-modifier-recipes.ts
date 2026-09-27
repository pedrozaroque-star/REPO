/**
 * @module scripts/inspect-modifier-recipes
 * @description Inspecciona las recetas de modificadores y la lista de modificadores sin receta.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function main() {
  const { data: menuItems } = await supabase
    .from('toast_menu_items')
    .select('guid, name, price, group_name, is_modifier, active, recipe_na')
    .eq('is_modifier', true)

  const { data: recipes } = await supabase
    .from('recipes')
    .select('toast_menu_item_guid, inventory_item_id, quantity, unit, type')

  const { data: invItems } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type')
  const invMap = new Map(invItems?.map(i => [i.id, i]))

  const recipeMap = new Map<string, any[]>()
  recipes?.forEach(r => {
    const list = recipeMap.get(r.toast_menu_item_guid) || []
    list.push(r)
    recipeMap.set(r.toast_menu_item_guid, list)
  })

  console.log(`Total modificadores en toast_menu_items: ${menuItems?.length}`)

  const withoutRecipe: any[] = []
  const withRecipe: any[] = []

  for (const m of menuItems || []) {
    const rec = recipeMap.get(m.guid)
    if (rec && rec.length > 0) {
      withRecipe.push({
        ...m,
        ingredients: rec.map(r => ({
          name: invMap.get(r.inventory_item_id)?.name || r.inventory_item_id,
          quantity: r.quantity,
          unit: r.unit,
          type: r.type,
        })),
      })
    } else {
      withoutRecipe.push(m)
    }
  }

  console.log(`Modificadores CON receta: ${withRecipe.length}`)
  console.log(`Modificadores SIN receta: ${withoutRecipe.length}`)

  console.log('\n--- TODOS LOS MODIFICADORES SIN RECETA ---')
  withoutRecipe.forEach((m, idx) => {
    console.log(`${idx + 1}. [${m.guid}] "${m.name}" | $${m.price} | Grupo: "${m.group_name}" | NA: ${m.recipe_na}`)
  })

  console.log('\n--- MUESTRA DE MODIFICADORES CON RECETA (10 ejemplos) ---')
  withRecipe.slice(0, 10).forEach((m, idx) => {
    const ingStr = m.ingredients.map((i: any) => `${i.name} (${i.quantity} ${i.unit}) [${i.type}]`).join(', ')
    console.log(`${idx + 1}. [${m.guid}] "${m.name}" ($${m.price}) -> ${ingStr}`)
  })
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})

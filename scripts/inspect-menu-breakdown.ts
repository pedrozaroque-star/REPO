/**
 * @module scripts/inspect-menu-breakdown
 * @description Desglose de toast_menu_items por is_modifier y recipe status.
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
  const { data: menuItems, error: mErr } = await supabase
    .from('toast_menu_items')
    .select('guid, name, price, group_name, is_modifier, active, recipe_na')
  if (mErr) throw mErr

  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('toast_menu_item_guid')
  if (rErr) throw rErr
  const recipeGuids = new Set(recipes.map(r => r.toast_menu_item_guid))

  const productsWithRecipe: any[] = []
  const productsWithoutRecipe: any[] = []
  const modifiersWithRecipe: any[] = []
  const modifiersWithoutRecipe: any[] = []

  for (const item of menuItems || []) {
    const hasRec = recipeGuids.has(item.guid)
    if (item.is_modifier) {
      if (hasRec) modifiersWithRecipe.push(item)
      else modifiersWithoutRecipe.push(item)
    } else {
      if (hasRec) productsWithRecipe.push(item)
      else productsWithoutRecipe.push(item)
    }
  }

  console.log('=== DESGLOSE DE TOAST_MENU_ITEMS ===')
  console.log(`Productos base CON receta: ${productsWithRecipe.length}`)
  console.log(`Productos base SIN receta: ${productsWithoutRecipe.length}`)
  console.log(`Modificadores CON receta: ${modifiersWithRecipe.length}`)
  console.log(`Modificadores SIN receta: ${modifiersWithoutRecipe.length}`)

  console.log('\n--- PRODUCTOS BASE SIN RECETA ---')
  productsWithoutRecipe.forEach((p, idx) => {
    console.log(`${idx + 1}. [${p.guid}] ${p.name} ($${p.price}) | Grupo: ${p.group_name} | recipe_na: ${p.recipe_na}`)
  })

  console.log('\n--- MODIFICADORES CON RECETA (Muestra) ---')
  modifiersWithRecipe.slice(0, 10).forEach((m, idx) => {
    console.log(`${idx + 1}. [${m.guid}] ${m.name} ($${m.price}) | Grupo: ${m.group_name}`)
  })
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})

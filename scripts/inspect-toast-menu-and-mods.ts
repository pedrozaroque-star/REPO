/**
 * @module scripts/inspect-toast-menu-and-mods
 * @description Inspecciona la tabla toast_menu_items para entender cómo se registran los modificadores y productos.
 * @businessRules Identifica modificadores mapeados vs sin receta en el catálogo Toast de Supabase.
 * @dataFlow Supabase toast_menu_items + recipes → console.log.
 * @notes No expone credenciales.
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
  console.log('Consultando toast_menu_items...')
  const { data: menuItems, error: mErr } = await supabase
    .from('toast_menu_items')
    .select('*')
  if (mErr) throw mErr

  console.log(`Total items en toast_menu_items: ${menuItems?.length || 0}`)
  if (menuItems && menuItems.length > 0) {
    console.log('Columnas en toast_menu_items:', Object.keys(menuItems[0]))
  }

  // Cargar recetas para saber cuáles tienen receta
  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('toast_menu_item_guid')
  if (rErr) throw rErr
  const recipeGuids = new Set(recipes.map(r => r.toast_menu_item_guid))

  console.log(`GUIDs únicos con receta: ${recipeGuids.size}`)

  let withRecipe = 0
  let withoutRecipe = 0
  const unmapped: any[] = []

  for (const item of menuItems || []) {
    if (recipeGuids.has(item.guid)) {
      withRecipe++
    } else {
      withoutRecipe++
      unmapped.push(item)
    }
  }

  console.log(`Con receta: ${withRecipe} | Sin receta: ${withoutRecipe}`)

  console.log('\nMuestra de 15 items de toast_menu_items SIN receta:')
  unmapped.slice(0, 15).forEach((item, idx) => {
    console.log(`${idx + 1}. [${item.guid}] ${item.name} | Precio: $${item.price} | Grupo: ${item.group_name || 'N/A'}`)
  })
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exitCode = 1
})

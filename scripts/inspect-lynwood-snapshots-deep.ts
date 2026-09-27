/**
 * @module scripts/inspect-lynwood-snapshots-deep
 * @description Analiza en profundidad las selecciones, modificadores y canales de los 763 tickets ya sincronizados de Lynwood.
 * @businessRules Muestra la variedad real de nombres de productos, modificadores y combinaciones.
 * @dataFlow Supabase toast_ticket_consumption_snapshots → agregados y frecuencias.
 * @notes No expone credenciales ni datos de clientes.
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
  console.log('Cargando 763 tickets de Lynwood 2026-09-22...')
  const { data: tickets, error } = await supabase
    .from('toast_ticket_consumption_snapshots')
    .select('toast_order_guid, dining_option_name, channel_metadata, selections')
    .eq('business_date', '2026-09-22')

  if (error) throw error
  console.log(`Tickets cargados: ${tickets?.length || 0}`)

  const itemCounts = new Map<string, { count: number; guids: Set<string>; sampleModifiers: Set<string> }>()
  const modifierCounts = new Map<string, { count: number; guids: Set<string>; parentItems: Set<string> }>()
  const diningCounts = new Map<string, number>()

  for (const t of tickets || []) {
    const dining = t.dining_option_name || 'Sin Dining Option'
    diningCounts.set(dining, (diningCounts.get(dining) || 0) + 1)

    const selections = (t.selections || []) as any[]
    for (const s of selections) {
      const itemName = s.name || 'Sin Nombre'
      const itemGuid = s.guid || 'Sin GUID'

      const existingItem = itemCounts.get(itemName) || { count: 0, guids: new Set(), sampleModifiers: new Set() }
      existingItem.count += Number(s.quantity || 1)
      existingItem.guids.add(itemGuid)

      const modifiers = (s.modifiers || []) as any[]
      for (const m of modifiers) {
        const modName = m.name || 'Sin Nombre Mod'
        const modGuid = m.guid || 'Sin GUID Mod'
        existingItem.sampleModifiers.add(modName)

        const existingMod = modifierCounts.get(modName) || { count: 0, guids: new Set(), parentItems: new Set() }
        existingMod.count += Number(m.quantity || 1)
        existingMod.guids.add(modGuid)
        existingMod.parentItems.add(itemName)
        modifierCounts.set(modName, existingMod)
      }

      itemCounts.set(itemName, existingItem)
    }
  }

  console.log('\n=== CANALES / DINING OPTIONS (Lynwood 2026-09-22) ===')
  for (const [dining, count] of diningCounts.entries()) {
    console.log(`- ${dining}: ${count} tickets`)
  }

  console.log(`\n=== ÍTEMS ÚNICOS VENDIDOS EN LYNWOOD (${itemCounts.size} productos) ===`)
  const sortedItems = Array.from(itemCounts.entries()).sort((a, b) => b[1].count - a[1].count)
  sortedItems.forEach(([name, data]) => {
    const mods = Array.from(data.sampleModifiers).slice(0, 5).join(', ')
    console.log(`- ${name} (Qty: ${data.count}) [GUIDs: ${Array.from(data.guids).join(', ')}] | Mods muestra: ${mods || 'ninguno'}`)
  })

  console.log(`\n=== MODIFICADORES ÚNICOS EN LYNWOOD (${modifierCounts.size} modificadores) ===`)
  const sortedMods = Array.from(modifierCounts.entries()).sort((a, b) => b[1].count - a[1].count)
  sortedMods.forEach(([name, data]) => {
    const parents = Array.from(data.parentItems).slice(0, 4).join(', ')
    console.log(`- ${name} (Qty: ${data.count}) [GUIDs: ${Array.from(data.guids).join(', ')}] | En: ${parents}`)
  })
}

main().catch(err => {
  console.error('Error fatal:', err)
  process.exitCode = 1
})

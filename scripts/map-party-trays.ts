/**
 * Mapeo de insumos de Party Trays a la base de datos inventory_items / QuickBooks
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function mapPartyTrayItems() {
  console.log('=== MAPEO DE INSUMOS DE PARTY TRAYS VS INVENTORY_ITEMS / QUICKBOOKS ===\n')

  const partyTrayInsumos = [
    { label: 'Rice (Arroz)', searchTerms: ['Arroz', 'Rice'] },
    { label: 'Beans (Frijol)', searchTerms: ['Frijol', 'Beans'] },
    { label: 'Meat - Asada', searchTerms: ['Carne Asada', 'Asada'] },
    { label: 'Meat - Pollo', searchTerms: ['Pollo', 'Chicken'] },
    { label: 'Meat - Pastor', searchTerms: ['Pastor'] },
    { label: 'Meat - Carnitas', searchTerms: ['Carnitas'] },
    { label: 'Meat - Cabeza', searchTerms: ['Cabeza'] },
    { label: 'Meat - Lengua', searchTerms: ['Lengua'] },
    { label: 'Plates (Platos)', searchTerms: ['Plato', 'Plate'] },
    { label: 'Forks (Tenedores)', searchTerms: ['Tenedor', 'Fork'] },
    { label: 'Spoons (Cucharas)', searchTerms: ['Cuchara', 'Spoon'] },
    { label: 'Cups (Vasos)', searchTerms: ['Vaso', 'Cup'] },
    { label: 'Napkins (Servilletas)', searchTerms: ['Servilleta', 'Napkin', 'Papelito'] },
    { label: 'Salsa Roja packets', searchTerms: ['Salsa Roja', 'Roja'] },
    { label: 'Salsa Verde packets', searchTerms: ['Salsa Verde', 'Verde'] },
    { label: 'Onions packets', searchTerms: ['Mixta', 'Onion', 'Cebolla'] },
    { label: 'Limes packets', searchTerms: ['Lima', 'Limon', 'Lime'] },
    { label: 'Jalapeños', searchTerms: ['Rajas', 'Zanahoria', 'Jalapeño'] },
    { label: 'Corn Tortillas', searchTerms: ['Tortilla,White', 'Corn', 'Maiz'] },
    { label: 'Flour Tortillas', searchTerms: ['Flour Tortilla', 'Tortilla Regular', 'Harina'] },
    { label: 'Aguas (Horchata)', searchTerms: ['Horchata'] },
    { label: 'Aguas (Jamaica)', searchTerms: ['Jamaica'] },
    { label: 'Aguas (Piña)', searchTerms: ['Piña'] }
  ]

  const { data: allItems } = await supabase
    .from('inventory_items')
    .select('id, name, sku, unit_type, quantity_per_unit, yield_percent, purchase_unit_cost, is_bodega, excel_reference')
    .order('name')

  console.log('Insumo Guía Party Tray          | Item Encontrado en DB / QB                  | Unidad Pedido    | SKU / Ref')
  console.log('─'.repeat(110))

  for (const pt of partyTrayInsumos) {
    const matches = (allItems || []).filter(item => {
      const name = (item.name || '').toLowerCase()
      return pt.searchTerms.some(term => name.includes(term.toLowerCase()))
    })

    if (matches.length === 0) {
      console.log(`${pt.label.padEnd(31)} | ❌ NO ENCONTRADO                             |                  |`)
    } else {
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i]
        const labelStr = i === 0 ? pt.label.padEnd(31) : ' '.repeat(31)
        console.log(`${labelStr} | ✅ ${(m.name || '').padEnd(42)} | ${(m.unit_type || '?').padEnd(16)} | SKU: ${m.sku || '-'} (Ref: ${m.excel_reference || '-'})`)
      }
    }
  }

  console.log('\n=== FIN DEL MAPEO ===')
}

mapPartyTrayItems().catch(console.error)

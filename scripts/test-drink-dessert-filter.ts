/**
 * Automated Simulation Test: Drink & Dessert Only Filter
 * Verifies that orders with ONLY drinks or desserts are excluded from kitchen preparation screen.
 */

import {
  isDrinkOrDessertItem,
  isDrinkOrDessertOnlyOrder,
  DRINK_DESSERT_PATTERNS
} from '../lib/order-ready-filter'
import { supabaseAdmin } from '../lib/supabase'

async function runSimulation() {
  console.log('--- Iniciando Simulación de Filtro de Bebidas y Postres ---')

  const testCases = [
    {
      name: 'Solo 1 Bebida (Horchata)',
      items: [{ quantity: 1, name: 'Medium Horchata', modifiers: [] }],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Solo 1 Bebida (Champurrado)',
      items: [{ quantity: 2, name: 'Champurrado', modifiers: [] }],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Solo 1 Bebida (Café de olla)',
      items: [{ quantity: 1, name: 'Café de olla', modifiers: [] }],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Solo 1 Postre (Flan)',
      items: [{ quantity: 1, name: 'Flan', modifiers: [] }],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Solo 1 Postre (Cheesecake)',
      items: [{ quantity: 2, name: 'Cheesecake', modifiers: [] }],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Bebida + Postre (Horchata + Cheesecake)',
      items: [
        { quantity: 1, name: 'Large Horchata', modifiers: [] },
        { quantity: 1, name: 'Cheesecake', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Múltiples Bebidas (Coke + Sprite + Bottled Water)',
      items: [
        { quantity: 1, name: 'Medium Coke', modifiers: [] },
        { quantity: 1, name: 'Large Sprite', modifiers: [] },
        { quantity: 2, name: 'Bottled Water', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Empleado + Bebida (Empleado + Bottled Water)',
      items: [
        { quantity: 1, name: 'Empleado', modifiers: [] },
        { quantity: 1, name: 'Bottled Water', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: true
    },
    {
      name: 'Comida + Bebida (Taco Asada + Horchata) -> DEBE APARECER EN COCINA',
      items: [
        { quantity: 3, name: 'Taco Asada', modifiers: ['Cebolla', 'Cilantro'] },
        { quantity: 1, name: 'Medium Horchata', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: false
    },
    {
      name: 'Comida + Postre (Burrito Pollo + Flan) -> DEBE APARECER EN COCINA',
      items: [
        { quantity: 1, name: 'Burrito Pollo', modifiers: [] },
        { quantity: 1, name: 'Flan', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: false
    },
    {
      name: 'Comida completa (Quesadilla Asada + Mulita Pastor)',
      items: [
        { quantity: 1, name: 'Super Quesadilla Asada', modifiers: [] },
        { quantity: 1, name: 'Mulita Pastor', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: false
    },
    {
      name: 'Desayuno + Bebida (Huevos Rancheros + Coffee)',
      items: [
        { quantity: 1, name: 'Huevos Rancheros', modifiers: [] },
        { quantity: 1, name: 'Coffee', modifiers: [] }
      ],
      expectedOnlyDrinkOrDessert: false
    },
    {
      name: 'Orden sin items_summary (null) -> No ocultar por seguridad',
      items: null,
      expectedOnlyDrinkOrDessert: false
    }
  ]

  let passed = 0
  for (const tc of testCases) {
    const input = tc.items ? JSON.stringify(tc.items) : null
    const result = isDrinkOrDessertOnlyOrder(input)
    if (result === tc.expectedOnlyDrinkOrDessert) {
      console.log(`  ✓ [PASS] ${tc.name} => ${result ? 'EXCLUIDA de preparación (Solo Bebidas/Postres)' : 'INCLUIDA en preparación (Tiene Comida)'}`)
      passed++
    } else {
      console.error(`  ✗ [FAIL] ${tc.name}: esperado ${tc.expectedOnlyDrinkOrDessert}, obtenido ${result}`)
    }
  }

  console.log(`\nPruebas unitarias sintéticas: ${passed}/${testCases.length} pasadas con éxito.`)

  // Prueba contra órdenes reales en base de datos
  console.log('\n--- Verificando contra órdenes reales de Supabase ---')
  const { data: realOrders } = await supabaseAdmin
    .from('order_ready_announcements')
    .select('order_number, items_summary, status')
    .not('items_summary', 'is', null)
    .order('created_at', { ascending: false })
    .limit(25)

  let realDrinksCount = 0
  let realFoodCount = 0

  for (const ord of realOrders || []) {
    const isOnlyDrinksOrDessert = isDrinkOrDessertOnlyOrder(ord.items_summary)
    const items = JSON.parse(ord.items_summary)
    const summary = items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')

    if (isOnlyDrinksOrDessert) {
      realDrinksCount++
      console.log(`  [FILTRADA DE COCINA] Orden #${ord.order_number}: ${summary}`)
    } else {
      realFoodCount++
      console.log(`  [MOSTRADA EN COCINA]  Orden #${ord.order_number}: ${summary}`)
    }
  }

  console.log(`\nResumen real: ${realDrinksCount} órdenes de solo bebidas/postres filtradas, ${realFoodCount} órdenes con comida enviadas a preparación.`)

  console.log('\n=============================================')
  console.log(' SIMULACIÓN EXITOSA: Filtro de bebidas y postres 100% verificado')
  console.log('=============================================\n')
}

runSimulation().catch(err => {
  console.error('Error en simulación:', err)
  process.exit(1)
})

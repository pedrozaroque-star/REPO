function normalizeItemText(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const DRINK_DESSERT_PATTERNS = [
  // Postres (Desserts)
  /\bflan\b/i,
  /\bcheesecake\b/i,
  /\bpostre\b/i,
  /\bdessert\b/i,
  /\barroz con leche\b/i,
  /\bgelatina\b/i,
  /\btres leches\b/i,
  /\bchurros?\b/i,
  /\bpastel\b/i,

  // Aguas Frescas
  /\bhorchata\b/i,
  /\bjamaica\b/i,
  /\btamarindo\b/i,
  /\blemonade\b/i,
  /\blimonada\b/i,
  /\bmelon\b/i,
  /\bsandia\b/i,
  /\bagua fresca\b/i,
  /\bgallon agua\b/i,
  /\bagua de\b/i,
  /\b(large|medium|small|med|lg|sm|vaso)\s+(de\s+)?pina\b/i,
  /^pina$/i,

  // Bebidas Calientes (Hot drinks)
  /\bchampurrado\b/i,
  /\bcoffee\b/i,
  /\bcafe\b/i,
  /\bchocolate caliente\b/i,
  /\bhot chocolate\b/i,
  /\btea\b/i,
  /\bte\b/i,

  // Agua y Jugos (Water & Juices)
  /\bbottled water\b/i,
  /\bagua embotellada\b/i,
  /\bjugo\b/i,
  /\bjuice\b/i,
  /\borange juice\b/i,
  /^water$/i,

  // Sodas y Refrescos
  /\bcoke\b/i,
  /\bcoca(\s*cola)?\b/i,
  /\bsprite\b/i,
  /\bfanta\b/i,
  /\bjarritos?\b/i,
  /\bsidral\b/i,
  /\bsangria\b/i,
  /\btopo chico\b/i,
  /\bsquirt\b/i,
  /\bpepsi\b/i,
  /\bdr(\.|\s+)?pepper\b/i,
  /\bcrush\b/i,
  /\brefresco\b/i,
  /\bsoda\b/i,
  /\bbeverage\b/i,
  /\bdrink\b/i,
  /\bcan soda\b/i,
  /\bbottle soda\b/i,
]

function isDrinkOrDessertItem(name: string): boolean {
  const normalized = normalizeItemText(name)
  if (!normalized) return false
  return DRINK_DESSERT_PATTERNS.some(p => p.test(normalized))
}

const sampleItems = [
  // Drinks
  'Medium Horchata',
  'Large Horchata',
  'Medium Jamaica',
  'Large Jamaica',
  'Champurrado',
  'Bottled Water',
  'Medium Coke',
  'Large Coke',
  'Coffee',
  'Café de olla',
  'Medium Piña',
  'Large Piña',
  'Large Tamarindo',
  'Medium Tamarindo',
  'Large Lemonade',
  'Medium Lemonade',
  'Large Orange Fanta',
  'Large Sprite',
  'Medium Diet Coke',
  'Gallon Agua',

  // Desserts
  'Flan',
  'Cheesecake',

  // Foods (MUST BE FALSE)
  'Taco Asada',
  'Taco Pastor',
  'Taco Pollo',
  'Taco Cabeza',
  'Taco Lengua',
  'Taco Carnitas',
  'Taco Buche',
  'Taco Chorizo',
  'Taco Plate',
  'Taco Vegetariano',
  'Burrito Asada',
  'Super Burrito Asada',
  'Meat Only Burrito Asada',
  'Burrito Pastor',
  'Burrito Pollo',
  'Burrito Cabeza',
  'Burrito Carnitas',
  'Burrito Lengua',
  'Burrito Buche',
  'Burrito Chorizo',
  'Burrito Rice/Beans',
  'Burrito Beans/Cheese/Rice',
  'Burrito Beans/Cheese',
  'Burrito Huevos con Asada',
  'Burrito Huevos con Chorizo',
  'Burrito Huevos con Jamon',
  'Burrito Huevos con Queso',
  'Super Burrito Pastor',
  'Super Burrito Pollo',
  'Super Burrito Lengua',
  'Super Burrito Carnitas',
  'Super Burrito Cabeza',
  'Super Burrito Chorizo',
  'Super Burrito Buche',
  'Super Burrito Vegetariano',
  'Torta Asada',
  'Torta Cubana',
  'Torta Pollo',
  'Torta Pastor',
  'Torta Milanesa',
  'Torta Carnitas',
  'Torta Cabeza',
  'Torta Lengua',
  'Torta Chorizo',
  'Torta Buche',
  'Torta Vegetariana',
  'Torta de Huevo/Asada',
  'Torta Huevos con Jamon',
  'Torta Huevos con Chorizo',
  'Quesadilla Asada',
  'Super Quesadilla Asada',
  'Quesadilla Pollo',
  'Super Quesadilla Pollo',
  'Quesadilla Pastor',
  'Super Quesadilla Pastor',
  'Quesadilla Cabeza',
  'Quesadilla Buche',
  'Quesadilla Carnitas',
  'Quesadilla Lengua',
  'Quesadilla Queso',
  'Quesadilla Jamon',
  'Mulita Asada',
  'Super Mulita Asada',
  'Mulita Pollo',
  'Super Mulita Pollo',
  'Mulita Pastor',
  'Super Mulita Pastor',
  'Mulita Lengua',
  'Mulita Cabeza',
  'Mulita Carnitas',
  'Mulita Buche',
  'Mulita Chorizo',
  'Sope Asada',
  'Sope Pollo',
  'Sope Pastor',
  'Sope Lengua',
  'Sope Cabeza',
  'Sope Queso',
  'Plato Asada',
  'Plato Pollo',
  'Plato Pastor',
  'Plato Cabeza',
  'Plato Milanesa',
  'Plato Lengua',
  'Plato Carnitas',
  'Super Nachos Asada',
  'Super Nachos Pastor',
  'Super Nachos Pollo',
  'Super Nachos No Carne',
  'Huevos Rancheros',
  'Huevos con Asada',
  'Huevos con Chorizo',
  'Huevos con Jamon',
  'Egg',
  'Rice',
  'Beans',
  'Chips',
  'Guacamole',
  'Sour Cream',
  'Orden Harina',
  'Tortilla de Maiz',
  'Side Order Carne',
  'Side Order Beans/Rice'
]

let errors = 0
for (const item of sampleItems) {
  const isDrinkOrDessert = isDrinkOrDessertItem(item)
  const isExpectedDrinkOrDessert = [
    'Medium Horchata', 'Large Horchata', 'Medium Jamaica', 'Large Jamaica',
    'Champurrado', 'Bottled Water', 'Medium Coke', 'Large Coke',
    'Coffee', 'Café de olla', 'Medium Piña', 'Large Piña',
    'Large Tamarindo', 'Medium Tamarindo', 'Large Lemonade', 'Medium Lemonade',
    'Large Orange Fanta', 'Large Sprite', 'Medium Diet Coke', 'Gallon Agua',
    'Flan', 'Cheesecake'
  ].includes(item)

  if (isDrinkOrDessert !== isExpectedDrinkOrDessert) {
    console.error(`MISMATCH on "${item}": got ${isDrinkOrDessert}, expected ${isExpectedDrinkOrDessert}`)
    errors++
  }
}

if (errors === 0) {
  console.log(`✓ 100% de precisión en los ${sampleItems.length} items de prueba. Cero falsos positivos y cero falsos negativos.`)
} else {
  console.error(`✗ ${errors} errores encontrados`)
  process.exit(1)
}

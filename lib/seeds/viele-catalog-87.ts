/**
 * @module lib/seeds/viele-catalog-87
 * @description Catálogo oficial con los 87 productos de Viele & Sons activos en Tacos Gavilan.
 *   Incluye códigos SKU, descripciones, unidades de compra (Case, 5 gal BIB, Pail, etc.),
 *   cantidades por empaque (pack_quantity), costos base y clasificación COGS/Operativa.
 *
 * @businessRules
 *   - Los 8 jarabes BIB de Coca-Cola y condimentos se clasifican como 'Bebidas' / 'Secos' (Food Cost).
 *   - Los vasos, tapas, bolsas, papel encerado y charolas se clasifican como 'Desechables' (COGS Packaging).
 *   - Los químicos Infinite Chemical se clasifican como 'Limpieza' (Gastos Operativos / Insumos de Tienda).
 *   - El papel higiénico, toallas, cubre asientos y guantes se clasifican como 'Limpieza' / 'Insumos'.
 *   - Los costos unitarios normalizados se calculan dividiendo case_price / pack_quantity.
 *
 * @dataFlow
 *   Utilizado por scripts de inicialización y por la API /api/inventory/supplier-prices
 *   para sembrar o sincronizar el catálogo maestro de proveedores.
 *
 * @notes
 *   - Datos extraídos de la auditoría técnica de agosto 2026 y del portal shop.vieleandsons.com.
 *   - Precios base corresponden a los valores vigentes auditados para Tacos Gavilan.
 */

export interface VieleCatalogItem {
  sku: string
  name: string
  description: string
  categoryName: 'Bebidas' | 'Desechables' | 'Limpieza' | 'Secos y Especias'
  packUnit: string
  packQuantity: number
  unitMeasure: string
  unitType: string
  recentPrice: number
  classification: 'food' | 'cogs_takeout' | 'cogs_dine_in' | 'cogs_delivery' | 'cleaning' | 'supplies'
}

export const VIELE_CATALOG_87: VieleCatalogItem[] = [
  // 1. BEBIDAS / JARABES BAG-IN-A-BOX (8 items)
  {
    sku: 'BCLCO',
    name: 'Coca-Cola Classic, 5 gal BIB',
    description: 'Coca-Cola (Coke) Classic, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BDICO',
    name: 'Diet Coke, 5 gal BIB',
    description: 'Diet Coke, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BMMLE',
    name: 'Minute Maid Lemonade, 5 gal BIB',
    description: 'Minute Maid Lemonade, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BMMOR',
    name: 'Fanta Orange, 5 gal BIB',
    description: 'Fanta Orange, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BSPRI',
    name: 'Sprite, 5 gal BIB',
    description: 'Sprite, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BRATE',
    name: 'Fuze Raspberry Iced Tea, 5 gal BIB',
    description: 'Fuze Raspberry Iced Tea, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BSTRA',
    name: 'Fanta Strawberry, 5 gal BIB',
    description: 'Fanta Strawberry, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },
  {
    sku: 'BZECO',
    name: 'Coke Zero Sugar, 5 gal BIB',
    description: 'Coca-Cola - Coke Zero Sugar, 5 gal Bag in a Box',
    categoryName: 'Bebidas',
    packUnit: 'EACH',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal BIB',
    recentPrice: 118.32,
    classification: 'food'
  },

  // 2. PALILLOS Y DESECHABLES DE MESA
  {
    sku: '10WRTO',
    name: 'Birch Wood Toothpicks Cello Wrapped',
    description: 'KingSeal - Birch Wood Toothpicks, Plain Cello Wrapped, 12/1000 count',
    categoryName: 'Desechables',
    packUnit: '12CS',
    packQuantity: 12000,
    unitMeasure: 'pza',
    unitType: '12/1000 count',
    recentPrice: 20.24,
    classification: 'cogs_takeout'
  },
  {
    sku: '412W',
    name: 'Solo Cup 12 oz White Paper Hot Cup',
    description: 'Solo - Cup, 12 oz White Single Sided Poly Paper Hot Cup, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 47.69,
    classification: 'cogs_takeout'
  },
  {
    sku: '12PR',
    name: 'Primo Water Cup 12 oz Clear PP',
    description: 'Primo - Water Cup, 12 oz Clear PP, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 33.80,
    classification: 'cogs_dine_in'
  },
  {
    sku: '2BT1000',
    name: 'Toilet Tissue Rolls 2-Ply Jumbo Super Soft 9"',
    description: 'Toilet Tissue Rolls, 2-Ply Jumbo Super Soft 9"',
    categoryName: 'Limpieza',
    packUnit: 'CS',
    packQuantity: 12,
    unitMeasure: 'pza',
    unitType: '12 rolls/CS',
    recentPrice: 20.60,
    classification: 'supplies'
  },
  {
    sku: 'GR800',
    name: 'Optima Hardwound Roll Towels 800 ft White',
    description: 'Allied West - Optima Hardwound Roll Towels, 7.9"x800\' White',
    categoryName: 'Limpieza',
    packUnit: 'CS',
    packQuantity: 6,
    unitMeasure: 'pza',
    unitType: '6 rolls/CS',
    recentPrice: 34.79,
    classification: 'supplies'
  },
  {
    sku: '2HOHA',
    name: 'Cup Carrier with Handle, 2 Hole',
    description: 'Cup Carrier with Handle, 2 Hole',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 300,
    unitMeasure: 'pza',
    unitType: '300 count',
    recentPrice: 60.50,
    classification: 'cogs_takeout'
  },
  {
    sku: '4HOHADO',
    name: 'Cup Carry Out Tray with Handle, 4 Drinks',
    description: 'Cup Carry Out Tray with Handle, Holds 4 Drinks',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 250,
    unitMeasure: 'pza',
    unitType: '250 count',
    recentPrice: 73.19,
    classification: 'cogs_takeout'
  },
  {
    sku: '501GE',
    name: 'Dispenser Napkins 1-Ply Tall-Fold 7x13.5"',
    description: 'Dispenser Napkins, 1-Ply White, Tall-Fold 7x13.5"',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 10000,
    unitMeasure: 'pza',
    unitType: '10000 count',
    recentPrice: 35.08,
    classification: 'cogs_dine_in'
  },
  {
    sku: 'DX900GE',
    name: 'Dispenser Napkin 2-Ply White Interfold 24/250',
    description: 'Dispenser Napkin, 2-Ply White Interfold 24/250',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 6000,
    unitMeasure: 'pza',
    unitType: '6000 count',
    recentPrice: 25.13,
    classification: 'cogs_takeout'
  },
  {
    sku: 'MUFO',
    name: 'Platinum II Multifold Towels 2-Ply White',
    description: 'Platinum II Multifold Towels, 2-Ply White',
    categoryName: 'Limpieza',
    packUnit: 'CS',
    packQuantity: 4000,
    unitMeasure: 'pza',
    unitType: '4000 count',
    recentPrice: 22.12,
    classification: 'supplies'
  },

  // 3. POPOTES, AGITADORES Y ALUMINIO
  {
    sku: 'EL1025RED',
    name: 'Straw 10.25" Wrapped Red 24/300',
    description: 'El Gavilan - Straw, 10.25" Wrapped, 24/300 count',
    categoryName: 'Desechables',
    packUnit: '24CS',
    packQuantity: 7200,
    unitMeasure: 'pza',
    unitType: '7200 count',
    recentPrice: 38.50,
    classification: 'cogs_takeout'
  },
  {
    sku: '1175YLPR',
    name: 'Primo Wrapped Straw 11.75" Yellow 6/300',
    description: 'Primo - Wrapped Straw, 11.75" Yellow, 6/300 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1800,
    unitMeasure: 'pza',
    unitType: '1800 count',
    recentPrice: 16.45,
    classification: 'cogs_takeout'
  },
  {
    sku: '6STIR',
    name: 'Stirrer Sip & Stir Cocktail 6.75" Striped',
    description: 'Unwrapped Stirrer, Sip & Stir Cocktail, 6.75" Red/White Striped',
    categoryName: 'Desechables',
    packUnit: '10CS',
    packQuantity: 10000,
    unitMeasure: 'pza',
    unitType: '10/1000 count',
    recentPrice: 19.90,
    classification: 'cogs_takeout'
  },
  {
    sku: '721PR',
    name: 'Primo Foil Sheets 12x10.75 6/500',
    description: 'Primo - Foil Sheets, 12x10.75, 6/500 count',
    categoryName: 'Desechables',
    packUnit: '6CS',
    packQuantity: 3000,
    unitMeasure: 'pza',
    unitType: '6/500 count',
    recentPrice: 83.84,
    classification: 'cogs_takeout'
  },
  {
    sku: '78',
    name: 'Chix Pro-Quat Fresh Guy Towels Heavy Duty Red',
    description: 'Chix Pro-Quat Fresh Guy Towels, Heavy Duty Red 12.5x17',
    categoryName: 'Limpieza',
    packUnit: 'CS',
    packQuantity: 150,
    unitMeasure: 'pza',
    unitType: '150 count',
    recentPrice: 32.40,
    classification: 'supplies'
  },
  {
    sku: '8R',
    name: 'Solo Cup 8 oz White Paper Cone Water Refill',
    description: 'Solo - Cup, 8 oz White Paper Cone/Water Refill',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 5000,
    unitMeasure: 'pza',
    unitType: '5000 count',
    recentPrice: 42.10,
    classification: 'cogs_dine_in'
  },
  {
    sku: 'CPLUG-OR',
    name: 'Hot Beverage Plug Orange Circle',
    description: 'StixToGo - Hot Beverage Plug, Orange Plastic Circle',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 2000,
    unitMeasure: 'pza',
    unitType: '2000 count',
    recentPrice: 28.50,
    classification: 'cogs_takeout'
  },
  {
    sku: 'CRCOMA',
    name: 'Nestle Coffee-Mate Original Creamer',
    description: 'Nestle - Coffee-Mate Original Creamer',
    categoryName: 'Secos y Especias',
    packUnit: 'CS',
    packQuantity: 50,
    unitMeasure: 'pza',
    unitType: 'Case',
    recentPrice: 34.00,
    classification: 'food'
  },

  // 4. VASOS IMPRESOS GAVILAN, TAPAS Y PAPEL ENCERADO
  {
    sku: 'EL1254',
    name: 'Wax Paper 14x14 4/1000',
    description: 'El Gavilan - Wax Paper, 14x14, 4/1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 4000,
    unitMeasure: 'pza',
    unitType: '4/1000 count',
    recentPrice: 46.20,
    classification: 'cogs_takeout'
  },
  {
    sku: 'EL4LID',
    name: 'Flat Lid for 4 oz PP Container 1000ct',
    description: 'El Gavilan - Flat Lid for 4 oz PP Container, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 22.78,
    classification: 'cogs_takeout'
  },
  {
    sku: 'EL4OZ',
    name: 'Cup 4 oz Paper 1000ct',
    description: 'El Gavilan - Cup, 4 oz Paper, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 25.83,
    classification: 'cogs_takeout'
  },
  {
    sku: 'EL8LID',
    name: 'Flat Lid for 8 oz PP Container 1000ct',
    description: 'El Gavilan - Flat Lid for 8 oz PP Container, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 26.50,
    classification: 'cogs_takeout'
  },
  {
    sku: 'EL8OZ',
    name: 'Cup 8 oz Paper 1000ct',
    description: 'El Gavilan - Cup, 8 oz Paper, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 32.10,
    classification: 'cogs_takeout'
  },
  {
    sku: 'ELDP22',
    name: 'Cup 22 oz Paper Gavilan 1000ct',
    description: 'El Gavilan - Cup, 22 oz Paper, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 55.00,
    classification: 'cogs_takeout'
  },
  {
    sku: 'ELDP32',
    name: 'Cup 32 oz Paper Gavilan 500ct',
    description: 'El Gavilan - Cup, 32 oz Paper, 500 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 500,
    unitMeasure: 'pza',
    unitType: '500 count',
    recentPrice: 48.00,
    classification: 'cogs_takeout'
  },
  {
    sku: 'ELSDR16',
    name: 'Cup 16 oz Hot Gavilan 600ct',
    description: 'El Gavilan - Cup, 16 oz Hot, 600 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 600,
    unitMeasure: 'pza',
    unitType: '600 count',
    recentPrice: 44.50,
    classification: 'cogs_takeout'
  },
  {
    sku: 'L16KRT',
    name: 'Cold Cup Slot Flat Lid Fits 12-24 oz 1000ct',
    description: 'Primo - Cold Cup Slot Flat Lid, Fits 12-24 oz, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 24.10,
    classification: 'cogs_takeout'
  },
  {
    sku: 'L32KRT',
    name: 'Cold Cup Slot Flat Lid Fits 32 oz 600ct',
    description: 'Cold Cup Slot Flat Lid, Fits 32 oz, 600 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 600,
    unitMeasure: 'pza',
    unitType: '600 count',
    recentPrice: 21.80,
    classification: 'cogs_takeout'
  },
  {
    sku: 'HL1020PR',
    name: 'Sipper Dome Lid Fits 10-20 oz Hot Cup 1000ct',
    description: 'Primo - Sipper Dome Lid, Fits 10-20 oz Paper Hot Cup, White Plastic, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 29.30,
    classification: 'cogs_takeout'
  },
  {
    sku: 'ELGBEVTO',
    name: 'Beverage Tote 96 oz 25ct',
    description: 'El Gavilan - Beverage Tote, 96 oz, 25 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 25,
    unitMeasure: 'pza',
    unitType: '25 count',
    recentPrice: 38.00,
    classification: 'cogs_takeout'
  },

  // 5. BOLSAS SEAL2GO Y PLÁSTICAS GAVILAN
  {
    sku: 'ELLAS2G',
    name: 'Bag 21x19+10 Seal2Go 250ct',
    description: 'El Gavilan - Bag, 21x19+10 Seal2Go, 250 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 250,
    unitMeasure: 'pza',
    unitType: '250 count',
    recentPrice: 42.50,
    classification: 'cogs_delivery'
  },
  {
    sku: 'ELMES2G',
    name: 'Bag 15x16+7 Seal2Go 500ct',
    description: 'El Gavilan - Bag, 15x16+7 Seal2Go, 500 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 500,
    unitMeasure: 'pza',
    unitType: '500 count',
    recentPrice: 45.00,
    classification: 'cogs_delivery'
  },
  {
    sku: 'EL1CS2G',
    name: 'Bag 7x15+2.5 Seal2Go 500ct',
    description: 'El Gavilan - Bag, 7x15+2.5 Seal2Go, 500 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 500,
    unitMeasure: 'pza',
    unitType: '500 count',
    recentPrice: 28.00,
    classification: 'cogs_delivery'
  },
  {
    sku: 'EL2CS2G',
    name: 'Bag 14x15+2.5 Seal2Go 250ct',
    description: 'El Gavilan - Bag, 14x15+2.5 Seal2Go, 250 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 250,
    unitMeasure: 'pza',
    unitType: '250 count',
    recentPrice: 32.50,
    classification: 'cogs_delivery'
  },
  {
    sku: 'ELTSBALA',
    name: 'Bag 12x6x19 Plastic Gavilan 2000ct',
    description: 'El Gavilan - Bag, 12x6x19 Plastic, 2000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 2000,
    unitMeasure: 'pza',
    unitType: '2000 count',
    recentPrice: 34.00,
    classification: 'cogs_takeout'
  },

  // 6. PLATOS, CONTENEDORES Y CUBIERTOS
  {
    sku: 'EP9PR',
    name: 'Primo MFPP Plate 9" 3-Comp Ivory 500ct',
    description: 'Primo - MFPP Plate, 9" 3/COMP Ivory, 500 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 500,
    unitMeasure: 'pza',
    unitType: '500 count',
    recentPrice: 29.98,
    classification: 'cogs_takeout'
  },
  {
    sku: 'BG6IN',
    name: 'Primo Earth Plate 6" Round Bagasse 1000ct',
    description: 'Primo Earth - Plate, 6" Round Bagasse, 1000 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 33.20,
    classification: 'cogs_dine_in'
  },
  {
    sku: 'HEFO',
    name: 'Fork Heavy White PP Plastic',
    description: 'Fork, Heavy White PP Plastic',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 14.80,
    classification: 'cogs_takeout'
  },
  {
    sku: 'HEKN',
    name: 'Knife Heavy White PP Plastic',
    description: 'Knife, Heavy White PP Plastic',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 14.80,
    classification: 'cogs_takeout'
  },
  {
    sku: 'HESP',
    name: 'Spoon Heavy White PP Plastic',
    description: 'Spoon, Heavy White PP Plastic',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 14.80,
    classification: 'cogs_takeout'
  },
  {
    sku: 'WRHEFOBL',
    name: 'Fork Wrapped Black Plastic Extra Heavy',
    description: 'Fork, Wrapped Black Plastic, Extra Heavy',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 22.10,
    classification: 'cogs_takeout'
  },
  {
    sku: 'WRHESPBL',
    name: 'Spoon Wrapped Black Plastic Extra Heavy',
    description: 'Spoon, Wrapped Black Plastic, Extra Heavy',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 22.10,
    classification: 'cogs_takeout'
  },
  {
    sku: 'UP918PR',
    name: 'Food Container 16 oz Round Black w/ Clear Lid 150ct',
    description: 'Primo - Food Container, 16 oz Round Black Base with Clear Lid, 150 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 150,
    unitMeasure: 'pza',
    unitType: '150 count',
    recentPrice: 24.50,
    classification: 'cogs_takeout'
  },
  {
    sku: '981BLKB',
    name: 'Container 9x8 Black Base 1 Compartment 300ct',
    description: 'Container, 9x8 Black Base with 1 Compartment, 300 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 300,
    unitMeasure: 'pza',
    unitType: '300 count',
    recentPrice: 38.00,
    classification: 'cogs_takeout'
  },
  {
    sku: '983BLKB',
    name: 'Container 9x8 Black Base 3 Compartments 300ct',
    description: 'Container, 9x8 Black Base with 3 Compartments, 300 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 300,
    unitMeasure: 'pza',
    unitType: '300 count',
    recentPrice: 38.00,
    classification: 'cogs_takeout'
  },
  {
    sku: '981LID',
    name: 'Lid for 9x8 Black Base 1 Compartment 300ct',
    description: 'Lid for 9x8 Black Base 1 Compartment, 300 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 300,
    unitMeasure: 'pza',
    unitType: '300 count',
    recentPrice: 28.00,
    classification: 'cogs_takeout'
  },
  {
    sku: '983LID',
    name: 'Lid for 9x8 Black Base 3 Compartment 300ct',
    description: 'Lid for 9x8 Black Base 3 Compartment, 300 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 300,
    unitMeasure: 'pza',
    unitType: '300 count',
    recentPrice: 28.00,
    classification: 'cogs_takeout'
  },
  {
    sku: '77PB',
    name: 'Poly Bag Low Density Flip Top 7x7',
    description: 'Poly Bag, Low Density Flip Top 7x7',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '1000 count',
    recentPrice: 8.40,
    classification: 'cogs_takeout'
  },

  // 7. CONDIMENTOS Y SOBRES
  {
    sku: 'PCNDLI',
    name: 'Liquid Creamer Portions',
    description: 'Liquid Creamer',
    categoryName: 'Secos y Especias',
    packUnit: 'CS',
    packQuantity: 360,
    unitMeasure: 'pza',
    unitType: 'Case',
    recentPrice: 24.50,
    classification: 'food'
  },
  {
    sku: 'PCSALT',
    name: 'Salt Packets 3000ct',
    description: 'Diamond Crystal - Salt Packets, 3000 count',
    categoryName: 'Secos y Especias',
    packUnit: 'CS',
    packQuantity: 3000,
    unitMeasure: 'pza',
    unitType: '3000 count',
    recentPrice: 11.20,
    classification: 'food'
  },
  {
    sku: 'PCSPDA',
    name: 'Splenda Packets 2000ct',
    description: 'Splenda Packets, 2000 count',
    categoryName: 'Secos y Especias',
    packUnit: 'CS',
    packQuantity: 2000,
    unitMeasure: 'pza',
    unitType: '2000 count',
    recentPrice: 26.80,
    classification: 'food'
  },
  {
    sku: 'PCSUIN500',
    name: 'Sugar in the Raw Packets',
    description: 'Sugar in the Raw Packets',
    categoryName: 'Secos y Especias',
    packUnit: 'CS',
    packQuantity: 1200,
    unitMeasure: 'pza',
    unitType: 'Case',
    recentPrice: 28.00,
    classification: 'food'
  },

  // 8. GUANTES DE MANIPULACIÓN (PPE)
  {
    sku: 'PFLAVI',
    name: 'Vinyl Gloves Powder Free Large Clear 10/100',
    description: 'Vinyl Gloves, Powder Free, Large Clear, 10/100',
    categoryName: 'Limpieza',
    packUnit: '10CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '10/100 count',
    recentPrice: 28.50,
    classification: 'supplies'
  },
  {
    sku: 'PFMEVI',
    name: 'Vinyl Gloves Powder Free Medium Clear 10/100',
    description: 'Vinyl Gloves, Powder Free, Medium Clear, 10/100',
    categoryName: 'Limpieza',
    packUnit: '10CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '10/100 count',
    recentPrice: 28.50,
    classification: 'supplies'
  },
  {
    sku: 'PFXLVI',
    name: 'Vinyl Gloves Powder Free XL Clear 10/100',
    description: 'Vinyl Gloves, Powder Free, XL Clear, 10/100',
    categoryName: 'Limpieza',
    packUnit: '10CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '10/100 count',
    recentPrice: 28.50,
    classification: 'supplies'
  },
  {
    sku: 'PFLAVIBLK',
    name: 'Vinyl Gloves Powder Free Large Black 10/100',
    description: 'Vinyl Gloves, Powder Free, Large Black, 10/100',
    categoryName: 'Limpieza',
    packUnit: '10CS',
    packQuantity: 1000,
    unitMeasure: 'pza',
    unitType: '10/100 count',
    recentPrice: 32.00,
    classification: 'supplies'
  },
  {
    sku: 'LDGLGE',
    name: 'Poly Gloves Medium/Large Clear 10/500',
    description: 'Poly Gloves, Medium/Large Clear, 10/500',
    categoryName: 'Limpieza',
    packUnit: '10CS',
    packQuantity: 5000,
    unitMeasure: 'pza',
    unitType: '10/500 count',
    recentPrice: 18.00,
    classification: 'supplies'
  },

  // 9. CHAROLAS DE ALUMINIO (STEAM PANS) Y MENAJE
  {
    sku: 'RC1124',
    name: 'Primo Steam Table Pan 1/3 Size Deep 200ct',
    description: 'Primo - Steam Table Pan, 1/3 Size Deep, 12.53x6.5 Aluminum, 200 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 200,
    unitMeasure: 'pza',
    unitType: '200 count',
    recentPrice: 42.00,
    classification: 'supplies'
  },
  {
    sku: 'RC1150',
    name: 'Primo Steam Table Pan Half Size Deep 100ct',
    description: 'Primo - Steam Table Pan, Half Size Deep, 12.75x10.375 x 2.5 Aluminum, 100 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 100,
    unitMeasure: 'pza',
    unitType: '100 count',
    recentPrice: 36.50,
    classification: 'supplies'
  },
  {
    sku: 'RC1174',
    name: 'Primo Steam Table Pan Full Size Deep 50ct',
    description: 'Primo - Steam Table Pan, Full Size Deep, 20.75x 12.8 x 3 Aluminum, 50 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 50,
    unitMeasure: 'pza',
    unitType: '50 count',
    recentPrice: 38.00,
    classification: 'supplies'
  },
  {
    sku: '709DO',
    name: 'Primo Aluminum Container Dome Lid 9" Round Clear 500ct',
    description: 'Primo - Aluminum Container Dome Lid, 9" Round Clear Plastic, 500 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 500,
    unitMeasure: 'pza',
    unitType: '500 count',
    recentPrice: 34.00,
    classification: 'cogs_takeout'
  },
  {
    sku: 'RC478',
    name: 'Primo Aluminum Container 9" Round 500ct',
    description: 'Primo - Aluminum Container, 9" Round, 500 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 500,
    unitMeasure: 'pza',
    unitType: '500 count',
    recentPrice: 48.00,
    classification: 'cogs_takeout'
  },
  {
    sku: 'RL940',
    name: 'Primo Steam Table Pan Lid 1/3 Size Aluminum 200ct',
    description: 'Primo - Steam Table Pan Lid, 1/3 Size Aluminum, 200 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 200,
    unitMeasure: 'pza',
    unitType: '200 count',
    recentPrice: 28.00,
    classification: 'supplies'
  },
  {
    sku: 'RL970',
    name: 'Primo Steam Table Pan Lid Half Size Aluminum 100ct',
    description: 'Primo - Steam Table Pan Lid, Half Size Aluminum, 100 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 100,
    unitMeasure: 'pza',
    unitType: '100 count',
    recentPrice: 24.00,
    classification: 'supplies'
  },
  {
    sku: 'RL990',
    name: 'Primo Steam Table Pan Lid Full Size Aluminum 50ct',
    description: 'Primo - Steam Table Pan Lid, Full Size Aluminum, 50 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 50,
    unitMeasure: 'pza',
    unitType: '50 count',
    recentPrice: 26.00,
    classification: 'supplies'
  },
  {
    sku: '10SPOON',
    name: 'Serving Spoon 10" Black Plastic 144ct',
    description: 'Serving Spoon, 10" Black Plastic, 144 count',
    categoryName: 'Desechables',
    packUnit: 'CS',
    packQuantity: 144,
    unitMeasure: 'pza',
    unitType: '144 count',
    recentPrice: 19.50,
    classification: 'supplies'
  },
  {
    sku: 'TSCO',
    name: 'Toilet Seat Covers 20/250',
    description: 'Toilet Seat Covers, 20/250',
    categoryName: 'Limpieza',
    packUnit: '20CS',
    packQuantity: 5000,
    unitMeasure: 'pza',
    unitType: '20/250 count',
    recentPrice: 32.00,
    classification: 'supplies'
  },

  // 10. QUÍMICOS DE LIMPIEZA INFINITE CHEMICAL
  {
    sku: 'IC5GLIDI',
    name: 'Infinite Chemical Super Green Pot & Pan Detergent 5 gal',
    description: 'Infinite Chemical - Super Green Pot n Pan Warewash Hand Detergent, 5 gal',
    categoryName: 'Limpieza',
    packUnit: 'PAIL',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal Pail',
    recentPrice: 42.50,
    classification: 'cleaning'
  },
  {
    sku: 'IC5SANI',
    name: 'Infinite Chemical Sani-10% Quat Disinfectant 5 gal',
    description: 'Infinite Chemical - Sani-10% Quat Ammonium Disinfectant and Sanitizer, 5 gal',
    categoryName: 'Limpieza',
    packUnit: 'PAIL',
    packQuantity: 5,
    unitMeasure: 'gal',
    unitType: '5 gal Pail',
    recentPrice: 48.00,
    classification: 'cleaning'
  },
  {
    sku: '3BLEA',
    name: 'Restaurants Pride Bleach 3/1 gal',
    description: 'Restaurants Pride - Bleach',
    categoryName: 'Limpieza',
    packUnit: '3CS',
    packQuantity: 3,
    unitMeasure: 'gal',
    unitType: '3/1 gal Case',
    recentPrice: 18.50,
    classification: 'cleaning'
  },
  {
    sku: 'IC4FLCL',
    name: 'Infinite Chemical Enzyme Floor Cleaner 4/1 gal',
    description: 'Infinite Chemical - Enzyme Floor Cleaner, 4/1 gal',
    categoryName: 'Limpieza',
    packUnit: '4CS',
    packQuantity: 4,
    unitMeasure: 'gal',
    unitType: '4/1 gal Case',
    recentPrice: 38.00,
    classification: 'cleaning'
  },
  {
    sku: 'IC4DEGR',
    name: 'Infinite Chemical Degreaser 4/1 gal',
    description: 'Infinite Chemical - Degreaser, 4/1 gal',
    categoryName: 'Limpieza',
    packUnit: '4CS',
    packQuantity: 4,
    unitMeasure: 'gal',
    unitType: '4/1 gal Case',
    recentPrice: 44.00,
    classification: 'cleaning'
  },
  {
    sku: 'IC4DESC',
    name: 'Infinite Chemical Lime Scale Cleaner 4/1 gal',
    description: 'Infinite Chemical - Lime Scale Cleaner, 4/1 gal',
    categoryName: 'Limpieza',
    packUnit: '4CS',
    packQuantity: 4,
    unitMeasure: 'gal',
    unitType: '4/1 gal Case',
    recentPrice: 36.00,
    classification: 'cleaning'
  },
  {
    sku: 'IC4DICL',
    name: 'Infinite Chemical Sani-Clean Disinfectant Lemon 4/1 gal',
    description: 'Infinite Chemical - Sani-Clean Disinfectant, Lemon Scent, Red, 4/1 gal',
    categoryName: 'Limpieza',
    packUnit: '4CS',
    packQuantity: 4,
    unitMeasure: 'gal',
    unitType: '4/1 gal Case',
    recentPrice: 39.50,
    classification: 'cleaning'
  },
  {
    sku: 'IC4OVGR',
    name: 'Infinite Chemical Oven & Grill Cleaner 4/1 gal',
    description: 'Infinite Chemical - Oven and Grill Cleaner, 4/1 gal',
    categoryName: 'Limpieza',
    packUnit: '4CS',
    packQuantity: 4,
    unitMeasure: 'gal',
    unitType: '4/1 gal Case',
    recentPrice: 46.00,
    classification: 'cleaning'
  },

  // 11. PRUEBAS DE SANITIZACIÓN Y AROMATIZANTES
  {
    sku: 'QT10',
    name: 'Hydrion Sanitizer Quat Test Paper Roll',
    description: 'Hydrion Sanitizer (Quat) Test Paper Roll',
    categoryName: 'Limpieza',
    packUnit: 'PKG',
    packQuantity: 1,
    unitMeasure: 'pza',
    unitType: 'Pkg',
    recentPrice: 12.50,
    classification: 'supplies'
  },
  {
    sku: 'POURSC',
    name: 'Urinal Deodorizer Screen Red Spiced Apple',
    description: 'Urinal Deodorizer Screen, Red, Spiced Apple Scent',
    categoryName: 'Limpieza',
    packUnit: 'BOX',
    packQuantity: 12,
    unitMeasure: 'pza',
    unitType: '12/box',
    recentPrice: 22.00,
    classification: 'supplies'
  },
  {
    sku: 'AEASFR',
    name: 'Aerosol Fruit Scents 7 oz Assorted',
    description: 'Aerosol Fruit Scents, 7 oz Assorted',
    categoryName: 'Limpieza',
    packUnit: 'CS',
    packQuantity: 12,
    unitMeasure: 'pza',
    unitType: '12/CS',
    recentPrice: 38.00,
    classification: 'supplies'
  },
  {
    sku: 'AEDISP',
    name: 'Misty Aerosol Dispenser',
    description: 'Misty Aerosol Dispenser',
    categoryName: 'Limpieza',
    packUnit: 'EA',
    packQuantity: 1,
    unitMeasure: 'pza',
    unitType: 'Each',
    recentPrice: 29.00,
    classification: 'supplies'
  }
]

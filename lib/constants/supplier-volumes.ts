/**
 * @module lib/constants/supplier-volumes
 * @description Volúmenes anuales estimados de compra por SKU para la cadena de 15 sucursales
 *   de Tacos Gavilan. Se usa para calcular el impacto financiero anual ($USD) cuando un
 *   proveedor cambia sus precios.
 *
 * @businessRules
 *   - Los volúmenes representan el número total de cajas/año consumidas entre las 15 tiendas.
 *   - SKUs no listados usan un fallback de 200 cajas/año (conservador).
 *   - Se debe revisar y actualizar anualmente con datos reales de órdenes de compra.
 *
 * @dataFlow
 *   Este archivo es importado por:
 *   - app/api/inventory/supplier-prices/route.ts (POST — análisis de clipboard/CSV)
 *   - app/api/inventory/supplier-prices/sync/route.ts (POST — sincronización en vivo)
 *   - app/api/cron/sync-supplier-prices/route.ts (Cron semanal)
 *
 * @notes
 *   - Centralizado para evitar duplicación. Antes estaba copiado en 3 archivos.
 *   - Fuente original: análisis de órdenes de compra 2024-2025.
 */

/**
 * Mapa de volúmenes anuales estimados (cajas/año) por SKU del proveedor.
 * Cubre las 15 sucursales de Tacos Gavilan.
 *
 * Annual estimated purchase volumes (cases/year) per supplier SKU.
 * Covers all 15 Tacos Gavilan locations.
 */
export const ESTIMATED_ANNUAL_VOLUMES: Record<string, number> = {
  // === DESECHABLES / Disposables ===
  'EP9PR': 8776,     // Contenedor térmico 9x9 con bisagra (Hinged Foam 9x9)
  'EL4OZ': 4025,     // Vaso de salsa 4 oz (Portion Cup 4 oz)
  'ELDP22': 1450,    // Vaso para bebida 22 oz (Drink Paper Cup 22 oz)
  'EL4LID': 2701,    // Tapa para vaso de salsa 4 oz (Portion Cup Lid 4 oz)
  '721PR': 757,      // Charola / Plato 7x9 (Foam Tray 7x9)
  'ELDP32': 1139,    // Vaso para bebida 32 oz (Drink Paper Cup 32 oz)
  'ELSDR16': 800,    // Vaso para bebida 16 oz (Drink Paper Cup 16 oz)
  'EL1254': 1800,    // Tapa para vasos de bebida grandes (Cold Cup Lid)
  '501GE': 1600,     // Papel encerado / envoltura (Deli Patty Paper)
  'DX900GE': 1200,   // Papel para tacos / envoltura especial (Waxed Taco Wrap)
  'GR800': 1500,     // Papel aluminio para tacos (Aluminum Foil Sheet)
  '2BT1000': 1400,   // Bolsa plástica para llevar (T-Shirt Bag Takeout)
  'ELTSBALA': 2500,  // Servilletas de barra / despachador (Tallfold Dispenser Napkins)
  'HEFO': 1100,      // Tenedores plásticos de uso pesado (Heavy Duty Plastic Forks)
  'HESP': 800,       // Cucharas plásticas de uso pesado (Heavy Duty Plastic Spoons)

  // === BEBIDAS / Beverages (Coca-Cola BIB 5 gal) ===
  'BCLCO': 1200,     // Coca-Cola Clásica 5 gal BIB
  'BDICO': 400,      // Diet Coke 5 gal BIB
  'BSPRI': 600,      // Sprite 5 gal BIB
  'BMMLE': 500,      // Minute Maid Lemonade 5 gal BIB
  'BMMOR': 450,      // Minute Maid Orange 5 gal BIB
  'BSTRA': 450,      // Fanta Strawberry 5 gal BIB
  'BRATE': 300,      // Barq's Root Beer 5 gal BIB
  'BZECO': 350,      // Coca-Cola Zero 5 gal BIB

  // === LIMPIEZA / Cleaning & Chemicals ===
  'IC5GLIDI': 240,   // Detergente institucional líquido 5 gal (Liquid Dish Detergent 5 gal)
  'IC5SANI': 240,    // Sanitizante concentrado 5 gal (Institutional Sanitizer 5 gal)
  '3BLEA': 300,      // Blanqueador / Cloro institucional (Bleach 3/1 gal)
  'IC4FLCL': 360,    // Limpiador para pisos 4/1 gal (Floor Cleaner 4/1 gal)
  'IC4DEGR': 360,    // Desengrasante concentrado 4/1 gal (Heavy Duty Degreaser 4/1 gal)

  // === BOLSAS DE BASURA / Trash Liners ===
  'ELLAS2G': 900,    // Bolsa de basura pesada 2 mil (Heavy Duty Trash Liner)
  'ELMES2G': 1200,   // Bolsa de basura mediana (Medium Duty Trash Liner)
}

/**
 * Volumen anual predeterminado para SKUs que no están en el mapa.
 * Default annual volume for SKUs not in the map.
 */
export const DEFAULT_ANNUAL_VOLUME = 200

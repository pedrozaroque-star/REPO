/**
 * @module lib/inventory/daily-order-consumption-engine
 * @description Motor unificado determinista para calcular el consumo exacto de insumos de
 *              la Orden Diaria de Bodega a partir de tickets completos de Toast POS en Tacos Gavilan.
 *
 * @businessRules
 *   - Solo calcula insumos de la Orden Diaria de Bodega (alimentos, carnes, tortillas, quesos,
 *     preparados, salsas, y suministros internos). Viele & Sons permanece manual y excluido.
 *   - Procesa tickets completos con selecciones, modificadores anidados y canales de venta/empaque.
 *   - Recetas de carnes aplican rendimientos oficiales (yield %):
 *     Asada: 61.5%, Pastor: 61.5%, Pollo: 65.0%, Cabeza: 87.0%,
 *     Lengua: 100%, Carnitas: 100%, Buche: 100%, Chorizo: 75.0%.
 *   - Modificadores de carne:
 *     * Extra/Doble Carne: +1.5 oz cocida en tacos/sopes/mulitas; +6.0 oz en burritos/platos/tortas.
 *     * Mitad y Mitad (Half Meat): 50% de carne 1 y 50% de carne 2 sin duplicar la porción base.
 *     * Carne Dorada: 1.9 oz cocida servida copeteada en taco.
 *     * Side Order Carne: 6.0 oz cocida en vaso de papel de 8 oz.
 *     * Carne por libra (Catering 2 lb, 6 lb, 12 lb): peso cocido exacto (32, 96, 192 oz).
 *   - Tortillas:
 *     * "Tortillas, Tacos y Platos" (paquete de 60 / 5 dz):
 *       - Tacos: 2 tortillas (1 si lleva modificador "1 Tortilla").
 *       - Taco Plate: exactamente 3 tacos (6 tortillas base).
 *       - Platos con maíz: 4 pares = 8 tortillas.
 *       - Desayunos con maíz: 4 pares = 8 tortillas.
 *       - "Tortilla de Maiz" (artículo independiente): 4 pares = 8 tortillas.
 *       - "Dz. Tortillas Maiz": 12 tortillas.
 *       - Party Trays maíz: 15-20 (2 paq = 120), 20-25 (3 paq = 180), 25-30 (4 paq = 240), 30-40 (5 paq = 300).
 *         Si combinan maíz y harina, cada alternativa recibe el 50%.
 *       - Merma operativa de comal: +6.5% (pegado/quemado en comal, limpieza y extras en platos).
 *     * "Tortillas, Burritos" (13", paquete de 12 / 1 dz):
 *       - 1 por burrito / super burrito.
 *       - Merma operativa de vaporera: +7.8% (rotura y desgarro al calentar y enrollar burritos).
 *     * "Tortillas, Regular 8 in." (paquete de 12 / 1 dz):
 *       - Platos y desayunos si el cliente selecciona Harina: 2 tortillas.
 *       - Party Trays harina: 15-20 (5 paq = 60), 20-25 (7 paq = 84), 25-30 (9 paq = 108), 30-40 (12 paq = 144).
 *     * "Mulitas" (paquete de 12 pares / 24 tortillas): 1 par por mulita o super mulita.
 *     * "Tortillas, Nacho": 1 bolsa de 4.5 oz por orden de nachos.
 *   - Panadería y Masas:
 *     * Teleras (paquete de 6): 1 telera por torta.
 *     * Sopes (paquete de 12): 1 concha de sope por sope.
 *     * Quesadilla Bodega: 1 por quesadilla grande (paquete de 12).
 *   - Banquetes (Party Trays / Fiesta Platters):
 *     * Se detecta tamaño por nombre o por umbral de precio ($220, $265, $310).
 *     * Proyecta carnes, arroz, frijol molido, tortillas maíz/harina, salsas, mixta, lima y aguas.
 *   - Acompañamientos y Arroz/Frijol:
 *     * Burritos regulares/super: 4 oz arroz y 4 oz frijol molido.
 *     * Taco Plate y Platos combinados: 4 oz arroz y 4 oz frijol molido.
 *     * Órdenes individuales: 8 oz arroz / frijol.
 *   - Salsas y Condimentos:
 *     * 20 oz Salsa sin color = 50% roja, 50% verde.
 *     * Tortas especiales (Cubana, Milanesa, Jamon, Queso) = 2 salsas rojas por defecto.
 *   - Trazabilidad y Cero Rellenos Silenciosos:
 *     * Todo platillo vendido que carezca de receta se reporta explícitamente como "uncovered".
 *
 * @dataFlow
 *   RawToastTicket[] + Catálogo (recipes, inventory_items) -> calculateDailyOrderConsumption()
 *   -> Map<inventory_item_id, DailyItemConsumptionResult>
 *
 * @notes
 *   - [2026-10-02] Recetas generales conservan Papelito en piezas, incluso vendido
 *     como extra independiente; no dividirlo por las 60 piezas del empaque.
 *     Queso amarillo usa caja física de 440 oz también en recetas directas.
 *   - [2026-09-27] Módulo unificado de alta fidelidad para cerrar la brecha de recetas dispersas.
 *     Integra y consolida ticket-packaging, party-tray-guidelines, meat-allocation y recipes.
 *   - [2026-09-28] Correcciones dimensionales: consumo sin redondeo de compra, papelitos
 *     en piezas (no cajas), y empaques actuales de carnes y queso amarillo de Lynwood.
 *     Los tamaños históricos o de otra tienda requieren un override fechado por SKU.
 *   - [2026-10-01] Vasos Medium/Large For Here o To Go de caja son autoservicio
 *     de 22/32 oz: el botón no certifica si sirvieron soda Coca-Cola, agua fresca
 *     o mezcla, ni cuánto líquido tomaron. El vaso se cuenta aparte en empaque;
 *     este motor no atribuye galones ni BIB por sabor en estos canales.
 *     Sabor y tamaño de la bebida preparada sí pueden tomarse del pedido en Drive
 *     Thru, TakeOut de plataforma, Delivery y Party Trays; TakeOut no equivale al
 *     To Go de mostrador que entrega un vaso vacío para autoservicio.
 *   - [2026-10-01] Super Quesadilla Jamon y Plato Jamon usan sus recetas completas;
 *     antes las ramas genéricas omitían 5.6 oz de Jamon Pack por venta.
 *   - [2026-10-01] Las recetas directas convierten oz↔lb antes de dividir por
 *     quantity_per_unit. Guacamole (4 oz) no puede contar como 2 bolsas de 2 lb.
 *   - [2026-10-01] Mayonesa se convierte con el peso de bolsa vigente del catálogo;
 *     el divisor fijo de 5 lb no coincidía con la bolsa de 1.5 lb de Lynwood.
 *   - [2026-10-01] Porciones pesadas confirmadas por Carlos: dos disparos
 *     de aguacate 2.3 oz, uno en Super Mulita 1.15 oz; tres de crema 1.5 oz,
 *     uno en Super Mulita/Sope 0.75 oz; torta 0.6 oz mayonesa; cotija 0.15 oz
 *     aprox. en platos/Taco Plate/desayunos y 0.35 oz provisional por sope;
 *     Jack 2.1 oz en Super Burrito y 0.6 oz
 *     solo en taco que lo pide. Sustituyen cantidades volumétricas anteriores.
 *   - [2026-10-01] Corrección explícita: la torta NO lleva crema; conservar
 *     aguacate y mayonesa, pero no descontar crema aunque una receta vieja la liste.
 *   - [2026-10-01] Porciones fijas pesadas se leen de recipes (módulo Recetas);
 *     el valor operativo sirve solo de fallback si el producto carece de esa línea.
 *     Jack opcional de taco sigue condicionado al modificador Toast.
 *   - [2026-10-01] Auditoría de 231,009 tickets: Burrito con un solo Half reparte
 *     carne 50/50; Extra Salsa/Guacamole ya no duplica carne. Exclusiones parciales
 *     o inválidas se advierten y no se presentan como consumo certificado.
 *   - [2026-10-01] Side Order Nacho Cheese no es un platillo Nachos: la coincidencia
 *     de nombre no debe añadir chips, guacamole ni crema automáticamente.
 *   - [2026-10-01] Plato con modificador Half Flour/Corn recibe mitad de cada
 *     alternativa: cuatro tortillas de maíz y una de harina, no ocho de maíz.
 *   - [2026-10-01] No Cheese junto con Jack Cheese en una misma selección se
 *     reporta ambiguo hasta aclarar si se quitó queso base y se agregó Jack.
 *   - [2026-10-01] Las exclusiones explícitas de Aguacate/Crema/Mayo también
 *     aplican a recetas específicas cuando una nota añade texto después del No.
 *   - [2026-10-01] Las ramas genéricas respetan No Aguacate/Guacamole y No Crema
 *     registrados en Toast; antes seguían descontando la porción base.
 *   - [2026-10-01] Carlos confirmó que "Fiesta Platters" en Uber/plataformas
 *     Delivery es el tamaño pequeño 15-20, aun si Toast omite precio y tamaño.
 *   - [2026-10-01] Papelito Para Torta se contabiliza estrictamente en piezas_preparadas
 *     y se excluye de recetas directas en Step 18 para evitar divisiones fraccionarias
 *     entre 60; se detecta modificador Vegetariano en Super Burrito y platillos afines.
 *   - [2026-10-01] Carlos aprobó la Opción A: factores operativos de merma de comal
 *     (+6.5% maíz 1100) y rotura en vaporera (+7.8% harina 13") comprobados en Lynwood
 *     para cuadrar el consumo teórico con el inventario físico real y garantizar abasto.
 *   - [2026-09-28] Acepta los campos reales snake_case de los snapshots Toast;
 *     antes el backtest leía selecciones pero clasificaba todos los canales como unknown.
 *   - [2026-09-28] Se ignoran separadores antes de cualquier receta y Side Order Carne
 *     sin proteína explícita se reporta como incompleto, no como consumo cero.
 *   - [2026-09-28] Taco Plate valida tres tacos por plato; cantidades de modificador
 *     ya agregadas por Toast no se vuelven a multiplicar por cantidad de platos.
 *   - [2026-09-28] Empleado es una línea de descuento 50%; el platillo real se
 *     registra como otra selección del ticket. Solo se ignora si existe otra
 *     selección de comida, no un separador o Test Item del POS.
 *   - [2026-09-28] Test Item es una prueba de manager del POS, sin comida real.
 *   - [2026-09-30] "Bolsa Apadte" / "Bolsa Aparte" es instrucción de empaque
 *     asociada al platillo del ticket; no agrega comida ni una bolsa fija por sí sola.
 *   - [2026-09-30] Super Mulita incluye aguacate y crema; las porciones pesadas
 *     vigentes son 1.15 oz y 0.75 oz, respectivamente;
 *     si el cliente los quita se registra como Mulita regular, no Super.
 *   - [2026-09-30] Toast reutiliza el GUID de Special Request para textos distintos;
 *     las excepciones se agrupan por GUID y nombre para no atribuirlas a la primera nota.
 *   - [2026-09-30] Torta Milanesa consume 2 piezas y Plato Milanesa 4 piezas,
 *     según la regla operativa; la bolsa del catálogo contiene 20 piezas.
 *   - [2026-09-30] Huevos Rancheros entrega salsa ranchera en vaso de 4 oz;
 *     el consumo se expresa en bolsas de 2.30 lb de la Orden Diaria.
 *   - [2026-09-30] Frijol D/L/O es cortesía de un solo vasito de 4 oz;
 *     la selección registrada consume 4 oz, pero el salsabar libre no es observable.
 *   - [2026-09-30] Super Burrito Vegetariano usa dos papelitos preparados;
 *     los burritos de desayuno no llevan papelito aunque su nombre diga Huevos.
 *   - [2026-09-30] Desayunos y vegetarianos usan su receta por GUID con conversiones
 *     oz/lb/pza; exclusiones explícitas se aplican y extras no resueltos se advierten.
 *   - [2026-09-30] Torta Jamón lleva tres rebanadas de 1.4 oz del paquete
 *     Jamon Pack de 2 lb, según la porción confirmada por Carlos.
 *   - Torta Cubana: 1 pieza de milanesa, 1.4 oz jamón y 0.8 oz salchicha,
 *     confirmadas por Carlos conforme a receta; además conserva su base de torta.
 *   - Tortas Huevos y Taco Vegetariano ya no caen en ramas genéricas;
 *     el papelito se descuenta una sola vez, en piezas, no cajas.
 *   - [2026-09-30] Cada Gallon Agua/Agua Fresca consume un Galón Vacío;
 *     el catálogo cuenta cajas de 48 envases, no piezas sueltas.
 *   - Plato Asada incluye siempre 2 oz de aguacate y ~0.15 oz de cotija
 *     en su receta base, confirmado por Carlos; no requiere un extra en Toast.
 *   - Platos y desayunos descuentan ~0.15 oz de cotija por plato;
 *     el aguacate adicional depende de sus líneas de receta.
 *   - Exclusiones en recetas específicas requieren cantidad de modificador igual
 *     a la selección; cantidades parciales/ambiguas conservan base y bloquean certificación.
 *   - Meat Only Super Burrito, Sope/Torta Queso y Quesadilla Jamón también
 *     usan receta específica: no omitir toppings ni sustituir cantidades por defaults.
 *   - Tacos/platos identifican carne por nombre del producto y Half explícito;
 *     notas como Cebollas Asadas o juntar con otro taco no cambian la proteína.
 */

import { PARTY_TRAY_GUIDELINES, resolvePartyTraySize } from './party-tray-guidelines'
import { MEAT_COOKING_YIELDS, ACTIVE_PROTEIN_IDS } from './meat-allocation'
import { resolvePackagingChannel, resolveTicketChannel, type RecipeChannel } from './recipe-channels'

export interface RawTicketModifier {
  guid?: string | null
  name?: string | null
  quantity?: number | null
}

export interface RawTicketSelection {
  guid?: string | null
  name?: string | null
  price?: number | null
  quantity?: number | null
  modifiers?: RawTicketModifier[] | null
}

export interface RawToastTicket {
  orderGuid?: string | null
  toast_order_guid?: string | null
  businessDate?: string | null
  business_date?: string | null
  diningOptionName?: string | null
  diningOptionBehavior?: string | null
  dining_option_name?: string | null
  source?: string | null
  deliveryService?: string | null
  channel_metadata?: {
    diningOption?: { name?: string | null; behavior?: string | null } | null
    source?: string | null
    deliveryService?: string | null
  } | null
  selections?: RawTicketSelection[] | null
}

export interface RecipeRow {
  toast_menu_item_guid: string
  inventory_item_id: string
  quantity: number
  unit: string
  type: string
}

export interface InventoryItemCatalogEntry {
  id: string
  name: string
  unit_type?: string | null
  unit_measure?: string | null
  quantity_per_unit?: number | null
  order_rounding_rule?: string | null
  excel_reference?: string | null
}

export interface DailyItemConsumptionResult {
  inventoryItemId: string
  itemName: string
  unitType: string
  totalCalculatedUsage: number
  roundedOrderUsage: number
  breakdown: Record<string, number>
}

export interface UncoveredProductReport {
  guid: string
  name: string
  quantitySold: number
}

export interface DailyOrderCalculationOutput {
  storeId: number
  businessDate: string
  totalTickets: number
  totalSelections: number
  channels: Record<string, number>
  packagingChannels: Record<string, number>
  itemConsumption: Map<string, DailyItemConsumptionResult>
  uncoveredProducts: UncoveredProductReport[]
}

const normalize = (val: string | null | undefined): string =>
  String(val || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * Factores de merma operativa comprobados empíricamente en Lynwood #14:
 * - Maíz 1100 (60ct): +6.5% por merma de comal (pegado/quemado), limpieza y tortillas extra en platos.
 * - Harina 13" Burrito (1 dz): +7.8% por rotura y desgarro al calentar y enrollar en mesa de vapor.
 */
export const CORN_TORTILLA_GRILL_SCRAP_FACTOR = 0.065
export const BURRITO_TORTILLA_TEAR_SCRAP_FACTOR = 0.078

/**
 * Motor central de cálculo de consumo de la Orden Diaria de Bodega
 */
export function calculateDailyOrderConsumption(
  storeId: number,
  businessDate: string,
  tickets: RawToastTicket[],
  recipes: RecipeRow[],
  inventoryItems: InventoryItemCatalogEntry[],
  meatBagSizes: Record<string, number> = {
    asada: 10, pastor: 5, pollo: 5, cabeza: 2.5, lengua: 2.5, buche: 0.375, carnitas: 0.375, chorizo: 0.5
  }
): DailyOrderCalculationOutput {
  const invMap = new Map<string, InventoryItemCatalogEntry>(inventoryItems.map(i => [i.id, i]))
  const recipesByGuid = new Map<string, RecipeRow[]>()
  for (const r of recipes) {
    if (!r.toast_menu_item_guid) continue
    const list = recipesByGuid.get(r.toast_menu_item_guid) || []
    list.push(r)
    recipesByGuid.set(r.toast_menu_item_guid, list)
  }

  // Mapeo canónico de insumos clave de Bodega
  const findItemByName = (patterns: RegExp[]): InventoryItemCatalogEntry | undefined => {
    return inventoryItems.find(i => {
      const n = normalize(i.name)
      const ref = normalize(i.excel_reference)
      return patterns.some(p => p.test(n) || p.test(ref))
    })
  }

  const itemCornTortillas = findItemByName([/1100\s*tortilla/i, /tortillas?,\s*tacos?\s*y\s*platos?/i])
  const itemBurritoTortillas = findItemByName([/358-9673bt/i, /tortillas?,\s*burritos?/i])
  const itemRegular8Tortillas = findItemByName([/358_9604bt/i, /tortilla\s*regular\s*8\s*in/i])
  const itemMulitas = findItemByName([/mulitas?\s*con\s*queso/i, /^mulitas?$/i])
  const itemTeleras = findItemByName([/^teleras?$/i])
  const itemMilanesa = findItemByName([/^milanesa$/i, /^milaneza$/i])
  const itemJamon = findItemByName([/^jamon\s*pack$/i])
  const itemSalchicha = findItemByName([/^salchicha\s*bag$/i])
  const itemSopes = findItemByName([/^sopes?$/i])
  const itemNachoChips = findItemByName([/tortillas?,\s*nachos?/i, /tortilla\s*nacho/i])
  const itemHuevos = findItemByName([/^huevo$/i, /huevos?\/eggs?/i])
  const itemArroz = findItemByName([/^arroz$/i])
  const itemFrijolMolido = findItemByName([/^frijol\s*molido$/i])
  const itemFrijolEntero = findItemByName([/^frijol\s*entero$/i])
  const itemSalsaRanchera = findItemByName([/^salsa\s*huevos?\s*rancheros?$/i])
  const itemQuesadillaBodega = findItemByName([/^quesadilla\s*bodega$/i])
  const itemQuesoRayado = findItemByName([/^queso\s*rayado/i])
  // Orden Diaria usa Cotija 021 de 12 oz; el Cotija 002df de 5 lb es otro SKU.
  const itemQuesoCotija = inventoryItems.find(i =>
    /^queso\s*cotija\s*021/i.test(normalize(i.name)) &&
    normalize(i.unit_measure) === 'oz' && Number(i.quantity_per_unit) === 12
  )
  const itemCrema = findItemByName([/^bolsa\s*crema/i])
  const itemMayonesa = findItemByName([/^bolsa\s*mayonesa/i])
  const itemPapelitoTorta = findItemByName([/papelito\s*para\s*torta/i, /papelitos?\s*tortas?/i])
  const itemVivaLard = findItemByName([/viva\s*lard/i])
  const itemFlan = findItemByName([/^flan$/i])
  const itemCheesecake = findItemByName([/^cheesecake$/i])
  const itemAmarilloCheese = findItemByName([/amarillo\s*cheese/i, /queso\s*amarillo/i])
  const itemAguacate = findItemByName([/^bolsa\s*aguacate/i, /^aguacate\s*2\s*lbs?/i, /^aguacate$/i])
  const itemSalsaRojaPackets = findItemByName([/^1\.5\s*oz\s*salsa\s*roja\s*pack$/i])
  const itemSalsaVerdePackets = findItemByName([/^1\.5\s*oz\s*salsa\s*verde\s*pack$/i])
  const itemMixtaPackets = findItemByName([/^1\s*oz\s*bolsa\s*de\s*mixta$/i])
  const itemLimaPackets = findItemByName([/^lima\s*bolsita$/i])
  const itemJalapenoBulk = findItemByName([/^rajas\s*y\s*zanahorias$/i])
  const itemSalsaRojaGallon = findItemByName([/^salsa\s*roja$/i])
  const itemSalsaVerdeGallon = findItemByName([/^salsa\s*verde$/i])
  const itemGalonesVacios = findItemByName([/^galones\s+vacios$/i])

  const itemAguas: Record<string, InventoryItemCatalogEntry | undefined> = {
    horchata: findItemByName([/^horchata$/i]),
    tamarindo: findItemByName([/tamarindo/i]),
    jamaica: findItemByName([/jamaica/i]),
    pina: findItemByName([/pina|piña/i]),
    champurrado: findItemByName([/champurrado/i]),
  }

  const itemMeats: Record<string, InventoryItemCatalogEntry | undefined> = {
    asada: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.asada) || findItemByName([/carne\s*asada/i]),
    pastor: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.pastor) || findItemByName([/^pastor$/i]),
    pollo: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.pollo) || findItemByName([/^pollo$/i]),
    cabeza: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.cabeza) || findItemByName([/^cabeza$/i]),
    lengua: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.lengua) || findItemByName([/^lengua$/i]),
    chorizo: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.chorizo) || findItemByName([/^chorizo/i]),
    carnitas: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.carnitas) || findItemByName([/^carnitas/i]),
    buche: inventoryItems.find(i => i.id === ACTIVE_PROTEIN_IDS.buche) || findItemByName([/^buche/i]),
  }

  // Acumuladores de consumo atómico
  let cornTortillaCount = 0
  let burritoTortillaCount = 0
  let regular8TortillaCount = 0
  let mulitasPairCount = 0
  let teleraCount = 0
  let milanesaPieceCount = 0
  let jamonOz = 0
  let salchichaOz = 0
  let sopeCount = 0
  let nachoChipBags = 0
  let huevoCount = 0
  let quesadillaBodegaCount = 0
  let papelitoCount = 0
  let flanCount = 0
  let cheesecakeCount = 0

  const cookedMeatOz: Record<string, number> = {
    asada: 0, pastor: 0, pollo: 0, cabeza: 0, lengua: 0, chorizo: 0, carnitas: 0, buche: 0
  }

  let arrozOz = 0
  let frijolMolidoOz = 0
  let frijolEnteroOz = 0
  let salsaRancheraOz = 0
  let quesoRayadoOz = 0
  let quesoCotijaOz = 0
  let quesoAmarilloOz = 0
  let cremaOz = 0
  let mayonesaOz = 0
  let aguacateOz = 0
  let salsaRojaPackets = 0
  let salsaVerdePackets = 0
  let mixtaPackets = 0
  let limaPackets = 0
  let jalapenoBulkOz = 0
  let salsaRojaGallons = 0
  let salsaVerdeGallons = 0
  let galonesVaciosCount = 0

  const aguaGallons: Record<string, number> = {
    horchata: 0, tamarindo: 0, jamaica: 0, pina: 0, champurrado: 0
  }

  const generalItemUsage = new Map<string, number>()
  const uncoveredMap = new Map<string, { guid: string; name: string; qty: number }>()

  const channels: Record<string, number> = {}
  const packagingChannels: Record<string, number> = {}
  let totalSelections = 0

  for (const ticket of tickets) {
    const employeeHasCompanion = (ticket.selections || []).some(selection => {
      const name = normalize(selection.name)
      return name !== 'empleado' && !/separator|separador|add\s*value|test\s*item/.test(name)
    })
    const metadata = ticket.channel_metadata
    const channelContext = {
      diningOption: ticket.diningOptionName ?? ticket.dining_option_name ?? metadata?.diningOption?.name,
      behavior: ticket.diningOptionBehavior ?? metadata?.diningOption?.behavior,
      source: ticket.source ?? metadata?.source,
      deliveryService: ticket.deliveryService ?? metadata?.deliveryService,
    }
    const salesChannel = resolveTicketChannel(channelContext)
    const pkgChannel = resolvePackagingChannel(channelContext)

    channels[salesChannel] = (channels[salesChannel] || 0) + 1
    packagingChannels[pkgChannel] = (packagingChannels[pkgChannel] || 0) + 1

    for (const sel of ticket.selections || []) {
      const sName = String(sel.name || '')
      const normName = normalize(sName)
      const selectionKey = `${sel.guid || 'NO_GUID'}:${normName}`
      const sQty = sel.quantity === null || sel.quantity === undefined ? 1 : Number(sel.quantity)
      if (!Number.isFinite(sQty) || sQty <= 0) continue
      totalSelections += sQty

      const mods = (sel.modifiers || []).map(m => ({
        guid: m.guid,
        name: String(m.name || ''),
        norm: normalize(m.name || ''),
        qty: m.quantity === null || m.quantity === undefined ? 1 : Number(m.quantity)
      }))
      const hasFullRemoval = (pattern: RegExp) => {
        const matching = mods.filter(m => pattern.test(m.norm))
        for (const mod of matching.filter(m => !Number.isFinite(m.qty) || m.qty !== sQty)) {
          const key = `ambiguous_removal:${selectionKey}:${mod.norm}`
          if (!uncoveredMap.has(key)) uncoveredMap.set(key, { guid: sel.guid || 'NO_GUID',
            name: `${sName} (exclusión parcial/ambigua: ${mod.name})`, qty: sQty })
        }
        return matching.some(m => m.qty === sQty)
      }
      const noAvocado = hasFullRemoval(/^(?:no|sin)\s+(?:guacamole|aguacate|avocado)\b/)
      const noCrema = hasFullRemoval(/^(?:no|sin)\s+(?:sour\s*cream|crema)\b/)
      const noMayo = hasFullRemoval(/^(?:no|sin)\s+(?:mayo|mayonesa)\b/)
      const noCotija = hasFullRemoval(/^(?:no|sin)\s+(?:cotija|queso)\b/)
      const noJack = hasFullRemoval(/^(?:no|sin)\s+(?:jack|cheese|queso)\b/)
      if (noJack && mods.some(m => /^jack\s+cheese\b/.test(m.norm))) {
        const key = `contradictory_cheese:${selectionKey}`
        const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID',
          name: `${sName} (No Cheese y Jack Cheese simultáneos; queso pendiente)`, qty: 0 }
        prior.qty += sQty
        uncoveredMap.set(key, prior)
      }
      const isTorta = /\btorta\b/.test(normName)
      const isPlate = /\b(?:plato|plate)\b/.test(normName)
      const isBreakfast = !isTorta && !/burrito/.test(normName) &&
        /\b(?:huevos?|chilaquiles?|machaca|omelet)\b/.test(normName)
      const isSope = /^sope\b/.test(normName)
      const isSuperBurrito = /\bsuper\s+burrito\b/.test(normName)
      const isSuperQuesadilla = /\bsuper\s+quesadilla\b/.test(normName)
      const isNachos = /^(?:super\s+)?nachos?\b/.test(normName)
      // Para porciones FIJAS, la receta visible en el módulo es la fuente.
      // El fallback conserva la regla confirmada solo si el artículo carece de receta.
      // Jack opcional de taco sigue siendo una regla de modificador, no línea fija.
      const fixedRecipeOz = (item: InventoryItemCatalogEntry | undefined, fallbackOz: number): number => {
        if (!item) return fallbackOz
        const foodRows = (recipesByGuid.get(sel.guid || '') || []).filter(row =>
          ['food', 'raw', 'cooked'].includes(row.type))
        const matches = foodRows.filter(row =>
          row.inventory_item_id === item.id && ['food', 'raw', 'cooked'].includes(row.type))
        if (matches.length !== 1) {
          if (foodRows.length) {
            const key = `fixed_recipe:${selectionKey}:${item.id}`
            const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID',
              name: `${sName} (porción fija de ${item.name} ausente/duplicada en Recetas)`, qty: 0 }
            prior.qty += sQty
            uncoveredMap.set(key, prior)
          }
          return fallbackOz
        }
        const quantity = Number(matches[0].quantity)
        const unit = normalize(matches[0].unit)
        const ounces = unit === 'oz' ? quantity : unit === 'lb' ? quantity * 16 : NaN
        if (Number.isFinite(ounces) && ounces >= 0) return ounces
        const key = `fixed_recipe_unit:${selectionKey}:${item.id}`
        const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID',
          name: `${sName} (unidad fija de ${item.name} inválida en Recetas)`, qty: 0 }
        prior.qty += sQty
        uncoveredMap.set(key, prior)
        return fallbackOz
      }
      const fullText = [normName, ...mods.map(m => m.norm)].join(' ')
      const applyNamedMeatPortion = (ounces: number): boolean => {
        const proteins = Object.keys(MEAT_COOKING_YIELDS)
        const base = proteins.find(p => new RegExp(`\\b${p}\\b`).test(normName))
        if (!base) return false
        const halfModifiers = mods.filter(m => /^(?:half|mitad)\s+/.test(m.norm))
        const halves = halfModifiers.map(m => proteins.find(p => new RegExp(`^(?:half|mitad)\\s+${p}(?:\\s*\\(in store\\))?$`).test(m.norm)))
        const choices = [...new Set([base, ...halves.filter((p): p is string => !!p)])]
        const invalidHalf = halfModifiers.some((m, i) => !halves[i] || m.qty !== sQty) || choices.length > 2
        if (invalidHalf) {
          const key = `half_meat:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (mezcla de carnes ambigua)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        // Una proteína suelta puede ser sustitución: conservar base provisional
        // y advertir, nunca reemplazar por orden alfabético o por una nota libre.
        for (const mod of mods.filter(m =>
          (proteins.includes(m.norm) && m.norm !== base) ||
          (/\b(?:no|sin|con|cambiar)\b/.test(m.norm) &&
            (proteins.some(p => new RegExp(`\\b${p}\\b`).test(m.norm)) || /\bcarne\b/.test(m.norm)) &&
            !/^poner este taco con el de\s/.test(m.norm)))) {
          const key = `protein_substitution:${selectionKey}:${mod.norm}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (sustitución pendiente: ${mod.name})`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        const allocation = invalidHalf ? [base] : choices
        for (const protein of allocation) cookedMeatOz[protein] += ounces * sQty / allocation.length
        return true
      }

      if (normName === 'empleado' && employeeHasCompanion) continue

      // Los separadores son instrucciones de emplatado, incluso cuando contienen
      // palabras como "Sope" o "Mulita"; deben salir antes de cualquier receta.
      if (/separator|separador|add\s*value|test\s*item/.test(normName) || /^bolsa\s+apa(?:rte|dte)$/.test(normName)) continue

      // El papelito es un preparado por platillo, NO el papel wax de envolver.
      // La tienda lo cuenta por piezas incluso cuando la caja de 60 está abierta.
      const isVegetarianModifier = mods.some(m => /vegetar|veggie|vegie/.test(m.norm))
      const isVegetarianSuperBurrito = /super\s+burrito\s+(?:vegetar|veggie|vegie)/.test(normName) ||
        (isSuperBurrito && isVegetarianModifier)
      if (isVegetarianSuperBurrito) {
        papelitoCount += 2 * sQty
      } else if (/torta|plato|plate/.test(normName) ||
        (!/burrito/.test(normName) && (/vegetar|veggie|vegie/.test(normName) || isVegetarianModifier)) ||
        (!/burrito/.test(normName) && /huevos?|chilaquil|machaca|omelet/.test(normName))) {
        papelitoCount += sQty
      }
      // Toppings medidos para TODAS las tortas, incluidos los productos con
      // receta específica que continúan abajo. Evitar doble conteo de sus líneas DB.
      if (isTorta) {
        if (!noMayo) mayonesaOz += fixedRecipeOz(itemMayonesa, 0.6) * sQty
      }
      if ((isTorta || isSuperBurrito || isSuperQuesadilla || isNachos) && !noAvocado) {
        aguacateOz += fixedRecipeOz(itemAguacate, 2.3) * sQty
      }
      // Corrección de Carlos: las tortas NO llevan crema.
      if ((isSuperBurrito || isSuperQuesadilla || isNachos) && !noCrema) {
        cremaOz += fixedRecipeOz(itemCrema, 1.5) * sQty
      }
      if ((isPlate || isBreakfast) && !noCotija) quesoCotijaOz += fixedRecipeOz(itemQuesoCotija, 0.15) * sQty
      if (isSope) {
        if (!noCrema) cremaOz += fixedRecipeOz(itemCrema, 0.75) * sQty
        if (!noCotija) quesoCotijaOz += fixedRecipeOz(itemQuesoCotija, 0.35) * sQty
      }

      // Recetas específicas: antes estos productos caían en ramas genéricas que
      // omitían ingredientes. Papelito ya fue contabilizado en piezas arriba.
      if (/huevos?/.test(normName) || /^meat\s+only\s+super\s+burrito\b/.test(normName) ||
        /^(?:sope queso|torta queso|torta salchicha|(?:super )?quesadilla jamon|plato jamon)$/.test(normName) ||
        ((/vegetar|veggie|vegie/.test(normName) || isVegetarianModifier) && /^(?:super\s+)?(?:taco|burrito|torta)\b/.test(normName))) {
        const flag = (reason: string) => {
          const key = `specific_recipe:${selectionKey}:${reason}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (${reason})`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        const lines = (recipesByGuid.get(sel.guid || '') || []).filter(r => ['food', 'raw', 'cooked'].includes(r.type))
        if (!lines.length) flag('sin receta alimentaria')
        if (/^huevos?\s+con\s+(?:jamon|salchicha)$/.test(normName)) flag('porción de cotija en revisión')
        const removed = new Set<string>()
        if (noAvocado && itemAguacate) removed.add(itemAguacate.id)
        if (noCrema && itemCrema) removed.add(itemCrema.id)
        if (noMayo && itemMayonesa) removed.add(itemMayonesa.id)
        if (noJack && itemQuesoRayado) removed.add(itemQuesoRayado.id)
        const removalRules: [RegExp, InventoryItemCatalogEntry | undefined][] = [
          [/^(?:no|sin)\s+(?:rice|arroz)$/, itemArroz],
          [/^(?:no|sin)\s+(?:beans?|frijol(?:es)?)$/, itemFrijolMolido],
          [/^(?:no|sin)\s+(?:sour\s*cream|crema)(?:\s*\(in store\))?$/, itemCrema],
          [/^(?:no|sin)\s+(?:cheese|queso)$/, itemQuesoRayado],
          [/^(?:no|sin)\s+(?:guacamole|aguacate|avocado)(?:\s*\(in store\))?$/, itemAguacate],
          [/^(?:no|sin)\s+(?:mayo|mayonesa)(?:\s*\(in store\))?$/, itemMayonesa],
        ]
        for (const mod of mods) {
          const removal = removalRules.find(([pattern]) => pattern.test(mod.norm))
          if (removal?.[1] && lines.some(r => r.inventory_item_id === removal[1]!.id)) {
            if (Number.isFinite(mod.qty) && mod.qty === sQty) removed.add(removal[1].id)
            else flag(`cantidad de exclusión ambigua: ${mod.name}`)
          } else if (!/^(?:1\s*tortilla|(?:corn|flour)(?:\s+tortillas?)?|maiz|harina|tortillas?\s+(?:maiz|harina)|empleado|bolsa\s+apa(?:rte|dte)|well done|over easy|medium well|scrambled|partido en dos|poner en el grill)$/.test(mod.norm)) {
            // Extras, instrucciones libres y condimentos no se certifican como
            // receta base. No inventar cantidades ni ignorar cambios silenciosos.
            flag(`modificador pendiente: ${mod.name}`)
          }
        }
        for (const row of lines) {
          if (row.inventory_item_id === itemPapelitoTorta?.id || removed.has(row.inventory_item_id)) continue
          if (isTorta && row.inventory_item_id === itemMayonesa?.id) continue
          if ((isTorta || isSuperBurrito || isSuperQuesadilla || isNachos) &&
            row.inventory_item_id === itemAguacate?.id) continue
          if ((isTorta || isSuperBurrito || isSuperQuesadilla || isNachos) &&
            row.inventory_item_id === itemCrema?.id) continue
          if ((isPlate || isBreakfast) && row.inventory_item_id === itemQuesoCotija?.id) continue
          if (isSope && [itemCrema?.id, itemQuesoCotija?.id].includes(row.inventory_item_id)) continue
          if (isSuperBurrito && row.inventory_item_id === itemQuesoRayado?.id) continue
          const item = invMap.get(row.inventory_item_id)
          const amount = Number(row.quantity)
          const unit = normalize(row.unit)
          const measure = normalize(item?.unit_measure)
          const per = Number(item?.quantity_per_unit)
          if (!item || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(per) || per <= 0) {
            flag(`catálogo/cantidad inválida: ${row.inventory_item_id}`)
            continue
          }
          const protein = Object.keys(itemMeats).find(p => itemMeats[p]?.id === item.id)
          if (protein) {
            const ounces = unit === 'oz' ? amount : unit === 'lb' ? amount * 16 : NaN
            if (!Number.isFinite(ounces)) { flag(`unidad de carne incompatible: ${item.name}`); continue }
            const yieldFactor = MEAT_COOKING_YIELDS[protein as keyof typeof MEAT_COOKING_YIELDS]
            cookedMeatOz[protein] += ounces * sQty * (row.type === 'raw' ? yieldFactor : 1)
            continue
          }
          let base = unit === measure ? amount : unit === 'oz' && measure === 'lb' ? amount / 16 :
            unit === 'lb' && measure === 'oz' ? amount * 16 : NaN
          if (/^taco\s/.test(normName) && item.id === itemCornTortillas?.id && mods.some(m => /^1\s*tortilla$/.test(m.norm))) base = 1
          if (/^huevos?\s*rancheros?$/.test(normName) && item.id === itemSalsaRanchera?.id) base = measure === 'lb' ? 4 / 16 : measure === 'oz' ? 4 : NaN
          if (!Number.isFinite(base)) { flag(`unidad incompatible: ${item.name}`); continue }
          generalItemUsage.set(item.id, (generalItemUsage.get(item.id) || 0) + base * sQty)
        }
        if (isSuperBurrito && !noJack) quesoRayadoOz += fixedRecipeOz(itemQuesoRayado, 2.1) * sQty
        if (/^taco\s/.test(normName) && !noJack && mods.some(m => /^jack\s+cheese\b/.test(m.norm))) {
          quesoRayadoOz += 0.6 * sQty
        }
        if (/^huevos?\b/.test(normName) || normName === 'plato jamon') {
          const corn = mods.some(m => /corn|maiz/.test(m.norm))
          const flour = mods.some(m => /harina|flour/.test(m.norm))
          if (corn && flour) flag('elección de tortilla contradictoria')
          else if (corn) cornTortillaCount += 8 * sQty
          else if (flour) regular8TortillaCount += 2 * sQty
          else flag('tortilla de desayuno no registrada')
        }
        continue
      }

      // 1. PARTY TRAYS / FIESTA PLATTERS (Regla dinámica oficial)
      if (/party\s*tray|fiesta\s*platter|\d+\s*-\s*\d+\s*people/.test(normName)) {
        const hasExplicitSize = /\d+\s*-\s*\d+\s*people/.test(normName)
        const unitPrice = Number(sel.price)
        const isFixedFiesta15To20 = pkgChannel === 'delivery' && /^fiesta\s+platters?$/.test(normName)
        if (!isFixedFiesta15To20 && !hasExplicitSize && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
          // Otros Party Trays sin tamaño ni precio siguen siendo ambiguos.
          const key = selectionKey
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (tamaño no registrado)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
          continue
        }
        const size = isFixedFiesta15To20 ? '15-20' : resolvePartyTraySize(sName, unitPrice)
        const pt = PARTY_TRAY_GUIDELINES[size]

        const hasCorn = mods.some(m => /maiz|corn/.test(m.norm)) || normName.includes('maiz')
        const hasFlour = mods.some(m => /harina|flour/.test(m.norm)) || normName.includes('harina')
        const split = (hasCorn && hasFlour) || mods.some(m => /mitad|half/.test(m.norm))

        const cornP = (hasCorn ? pt.cornPacks * (split ? 0.5 : 1) : (!hasFlour ? pt.cornPacks : 0)) * sQty
        const flourP = (hasFlour ? pt.flourPacks * (split ? 0.5 : 1) : 0) * sQty
        cornTortillaCount += cornP * 60
        regular8TortillaCount += flourP * 12

        arrozOz += pt.riceLbs * 16 * sQty
        frijolMolidoOz += pt.beansLbs * 16 * sQty
        salsaRojaPackets += pt.salsaRojaPacks * sQty
        salsaVerdePackets += pt.salsaVerdePacks * sQty
        mixtaPackets += pt.mixtaBags * sQty
        limaPackets += pt.limeBags * sQty
        jalapenoBulkOz += pt.jalapenoOz * sQty

        const detectedMeats: string[] = []
        if (/asada/.test(fullText)) detectedMeats.push('asada')
        if (/pollo|chicken/.test(fullText)) detectedMeats.push('pollo')
        if (/pastor/.test(fullText)) detectedMeats.push('pastor')
        if (/carnitas/.test(fullText)) detectedMeats.push('carnitas')
        if (detectedMeats.length > 0) {
          const meatPerProtOz = (pt.meatLbs * 16 * sQty) / detectedMeats.length
          detectedMeats.forEach(p => { cookedMeatOz[p] = (cookedMeatOz[p] || 0) + meatPerProtOz })
        } else {
          const key = `party_meat:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (carne no registrada)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }

        const detectedAguas: string[] = []
        if (/horchata/.test(fullText)) detectedAguas.push('horchata')
        if (/jamaica/.test(fullText)) detectedAguas.push('jamaica')
        if (/tamarindo/.test(fullText)) detectedAguas.push('tamarindo')
        if (/pina|piña/.test(fullText)) detectedAguas.push('pina')
        if (detectedAguas.length > 0) {
          const aguaPerKind = (pt.aguaGallons * sQty) / detectedAguas.length
          detectedAguas.forEach(a => { aguaGallons[a] = (aguaGallons[a] || 0) + aguaPerKind })
        } else {
          const key = `party_agua:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (sabor de agua no registrado)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }

        continue
      }

      // 2. TACO PLATE (Exactamente 3 tacos + 4 oz arroz + 4 oz frijol)
      if (/taco\s*plate/.test(normName)) {
        cornTortillaCount += 3 * 2 * sQty
        arrozOz += 4 * sQty
        frijolMolidoOz += 4 * sQty
        // El modificador Jack Cheese corresponde a tacos concretos del plato;
        // Toast registra su cantidad, no implica queso para los tres tacos.
        if (!noJack) {
          quesoRayadoOz += 0.6 * mods.filter(m => /^jack\s+cheese\b/.test(m.norm))
            .reduce((sum, m) => sum + (Number.isFinite(m.qty) && m.qty > 0 ? m.qty : 0), 0)
        }

        const tacoChoices = mods.filter(m => /taco\s+(asada|pastor|pollo|cabeza|lengua|chorizo|carnitas|buche|vegetar|veggie|vegie)/.test(m.norm))
        if (tacoChoices.length > 0) {
          const tacosInModifiers = tacoChoices.reduce((sum, mod) => sum + mod.qty, 0)
          // Toast suele guardar la cantidad TOTAL de cada modificador para toda
          // la línea: Taco Plate qty=2 tiene 6 tacos en mods, no 3 que deban
          // multiplicarse otra vez por 2. Aceptar ambos formatos si son coherentes.
          const modifierFactor = Math.abs(tacosInModifiers - 3 * sQty) < 1e-9 ? 1 :
            Math.abs(tacosInModifiers - 3) < 1e-9 ? sQty : null
          if (modifierFactor === null || tacoChoices.some(mod => !Number.isFinite(mod.qty) || mod.qty <= 0)) {
            const key = `taco_plate_modifier_qty:${selectionKey}`
            const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (cantidad de tacos modificadores incongruente)`, qty: 0 }
            prior.qty += sQty
            uncoveredMap.set(key, prior)
          } else {
            tacoChoices.forEach(tm => {
              for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
                if (tm.norm.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + 1.5 * tm.qty * modifierFactor
              }
            })
          }
        } else {
          const key = `taco_plate_meat:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (tacos sin carne registrada)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        continue
      }

      // 3. TACOS INDIVIDUALES
      if (/^taco\s+/.test(normName) && !/separator|separador/.test(normName)) {
        const isOneTortilla = mods.some(m => /1\s*tortilla/.test(m.norm))
        cornTortillaCount += (isOneTortilla ? 1 : 2) * sQty

        const isExtra = mods.some(m => /^(?:extra|doble)\s+(?:carne|meat)(?:\s*\(in store\))?$/.test(m.norm))
        const isDorada = mods.some(m => /dorada/.test(m.norm))
        const tacoMeatOz = isDorada ? 1.9 : (isExtra ? 3.0 : 1.5)

        const meatFound = applyNamedMeatPortion(tacoMeatOz)
        if (!meatFound && !/vegetar|veggie|vegie/.test(normName)) {
          const key = selectionKey
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: sName, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        if (/vegetar|veggie|vegie/.test(normName)) {
          const key = `vegetarian_taco_recipe:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (acompañamientos de receta pendientes de validar)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        if (!noJack && mods.some(m => /^jack\s+cheese\b/.test(m.norm))) quesoRayadoOz += 0.6 * sQty
        continue
      }

      // 4. TORTILLAS INDEPENDIENTES
      if (/^tortilla\s*de\s*maiz$/.test(normName)) {
        cornTortillaCount += 8 * sQty
        continue
      }
      if (/^dz\.\s*tortillas?\s*maiz$/.test(normName)) {
        cornTortillaCount += 12 * sQty
        continue
      }

      // 5. PLATOS COMBINADOS Y DESAYUNOS
      if (/plato|plate|huevos?|chilaquil|machaca|omelet/.test(normName)) {
        for (const row of recipesByGuid.get(sel.guid || '') || []) {
          if (!['food', 'raw', 'cooked'].includes(row.type)) continue
          if (row.inventory_item_id !== itemAguacate?.id && row.inventory_item_id !== itemQuesoCotija?.id) continue
          const quantity = Number(row.quantity)
          const unit = normalize(row.unit)
          const ounces = unit === 'oz' ? quantity : unit === 'lb' ? quantity * 16 : NaN
          if (!Number.isFinite(ounces) || ounces < 0) {
            const key = `plate_recipe_unit:${selectionKey}:${row.inventory_item_id}`
            const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (unidad de acompañamiento incompatible)`, qty: 0 }
            prior.qty += sQty
            uncoveredMap.set(key, prior)
            continue
          }
          if (row.inventory_item_id === itemQuesoCotija?.id) continue
          if (row.inventory_item_id === itemAguacate?.id) {
            if (!noAvocado) aguacateOz += ounces * sQty
          }
        }
        const choseCorn = mods.some(m => /corn|maiz/.test(m.norm))
        const choseFlour = mods.some(m => /harina|flour/.test(m.norm))
        const halfCornFlour = mods.some(m => /^(?:half|mitad)\b/.test(m.norm) &&
          /corn|maiz/.test(m.norm) && /harina|flour/.test(m.norm))
        if (halfCornFlour) {
          cornTortillaCount += 4 * sQty
          regular8TortillaCount += 1 * sQty
        } else if (choseCorn) cornTortillaCount += 8 * sQty
        else if (choseFlour) regular8TortillaCount += 2 * sQty

        if (/huevos?/.test(normName)) huevoCount += 2 * sQty
        if (/huevos?\s*rancheros?/.test(normName)) salsaRancheraOz += 4 * sQty
        if (/milanesa|milaneza/.test(normName)) milanesaPieceCount += 4 * sQty

        arrozOz += 4 * sQty
        frijolMolidoOz += 4 * sQty

        applyNamedMeatPortion(mods.some(m => /^(?:extra|doble)\s+carne$/.test(m.norm)) ? 12 : 6)
        continue
      }

      // 6. BURRITOS
      if (/burrito/.test(normName)) {
        burritoTortillaCount += 1 * sQty
        const isExtra = mods.some(m => /^(?:extra|doble)\s+(?:carne|meat)(?:\s*\(in store\))?$/.test(m.norm))
        const meatOz = isExtra ? 12.0 : 6.0

        // Un solo Half es la forma habitual de Toast: mitad carne del nombre,
        // mitad proteína elegida. La función también valida cantidades y mezclas.
        const found = applyNamedMeatPortion(meatOz)
        if (!found && !/bean|cheese|veggie|vegie|vegetar/.test(normName)) {
          const key = `burrito_meat:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (carne no registrada)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }

        // Calibrado a la porción real operativa: 4 oz arroz y 4 oz frijol
        if (!/meat\s*only/.test(normName)) {
          arrozOz += 4 * sQty
          frijolMolidoOz += 4 * sQty
          // Jack pesado: 2.1 oz por Super Burrito o Burrito con queso.
          const hasCheese = /super|cheese|queso/.test(normName) || mods.some(m => /cheese|queso/.test(m.norm))
          if (hasCheese && !noJack) {
            // En burritos regulares el queso puede ser un extra opcional; su
            // ausencia en la receta base no significa una receta incompleta.
            quesoRayadoOz += (isSuperBurrito ? fixedRecipeOz(itemQuesoRayado, 2.1) : 2.1) * sQty
          }
          // Dos disparos de aguacate y tres de crema, medidos por peso.
          const isSuper = /super/.test(normName)
          const hasAvocado = isSuper || mods.some(m => /aguacate|avocado|guac/.test(m.norm))
          const hasCrema = isSuper || mods.some(m => /crema|sour\s*cream/.test(m.norm))
          if (hasAvocado && !isSuperBurrito && !noAvocado) aguacateOz += 2.3 * sQty
          if (hasCrema && !isSuperBurrito && !noCrema) cremaOz += 1.5 * sQty
        }
        continue
      }

      // 7. MULITAS Y SUPER MULITAS
      if (/mulita/.test(normName)) {
        mulitasPairCount += 1 * sQty
        if (/super/.test(normName)) {
          if (!noAvocado) aguacateOz += fixedRecipeOz(itemAguacate, 1.15) * sQty
          if (!noCrema) cremaOz += fixedRecipeOz(itemCrema, 0.75) * sQty
        }
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (normName.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + 1.5 * sQty
        }
        continue
      }

      // 8. TORTAS (toppings medidos arriba, también para recetas específicas)
      if (/torta/.test(normName)) {
        teleraCount += 1 * sQty
        if (/milanesa|milaneza/.test(normName)) milanesaPieceCount += 2 * sQty
        if (/^torta\s+jamon$/.test(normName)) jamonOz += 3 * 1.4 * sQty
        if (/^torta\s+cubana$/.test(normName)) {
          milanesaPieceCount += sQty
          jamonOz += 1.4 * sQty
          salchichaOz += 0.8 * sQty
        }
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (normName.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + 6.0 * sQty
        }
        frijolMolidoOz += 1.5 * sQty
        continue
      }

      // 9. SOPES (un disparo de crema y una cucharada de cotija)
      if (/sope/.test(normName)) {
        sopeCount += 1 * sQty
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (normName.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + 1.5 * sQty
        }
        frijolMolidoOz += 1.5 * sQty
        const cotijaRemovals = mods.filter(m => /^(?:no|sin)\s+(?:cotija|queso)\b/.test(m.norm))
        if (cotijaRemovals.some(m => m.qty !== sQty)) {
          const key = `sope_cotija_removal:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (No Cotija parcial ambiguo)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        continue
      }

      // 10. QUESADILLAS (Quesadilla Bodega es un paquete preformado de 12 ct que ya incluye queso)
      if (/quesadilla/.test(normName)) {
        quesadillaBodegaCount += 1 * sQty
        const qMeatOz = /super/.test(normName) ? 6.0 : 4.0
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (normName.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + qMeatOz * sQty
        }
        // Los toppings de la Super Quesadilla ya se agregaron antes de las recetas específicas.
        continue
      }

      // 11. NACHOS (Super Nachos lleva Queso Amarillo líquido, Aguacate y Crema)
      if (isNachos) {
        nachoChipBags += 1 * sQty
        quesoAmarilloOz += 4 * sQty
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (normName.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + 6.0 * sQty
        }
        continue
      }

      // 12. SIDES DE ARROZ Y FRIJOL
      if (/^rice$/.test(normName) || /^side\s*rice$/.test(normName)) {
        arrozOz += 8 * sQty
        continue
      }
      if (/^beans$/.test(normName) || /^side\s*beans$/.test(normName)) {
        frijolMolidoOz += 8 * sQty
        continue
      }
      if (/frijol\s*d\/?l\/?o/.test(normName)) {
        frijolEnteroOz += 4 * sQty
        continue
      }

      // 13. CARNE POR LIBRA (Catering)
      const lbMatch = normName.match(/(\d+)\s*lb\s*meat/)
      if (lbMatch) {
        const lbs = parseInt(lbMatch[1], 10)
        let found = false
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (fullText.includes(prot)) {
            cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + lbs * 16 * sQty
            found = true
            break
          }
        }
        if (!found) {
          // La distribución se calcula con mezcla observada por tienda/periodo;
          // adjudicarla toda a Asada produciría un consumo falso.
          const key = selectionKey
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: sName, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        continue
      }

      // 14. SIDE ORDER CARNE
      if (/side\s*(?:order\s*)?carne/.test(normName)) {
        let found = false
        for (const prot of Object.keys(MEAT_COOKING_YIELDS)) {
          if (fullText.includes(prot)) {
            cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + 6.0 * sQty
            found = true
            break
          }
        }
        if (!found) {
          const key = `side_carne:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (carne no registrada)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        continue
      }

      // 15. BEBIDAS Y AGUAS
      if (/20\s*oz\.?\s*salsa/.test(normName)) {
        const roja = /roja|red/.test(fullText)
        const verde = /verde|green/.test(fullText)
        const rojaOz = roja && !verde ? 20 : verde && !roja ? 0 : 10
        salsaRojaGallons += (rojaOz / 128) * sQty
        salsaVerdeGallons += ((20 - rojaOz) / 128) * sQty
        continue
      }
      if (/gallon\s*agua/.test(normName)) {
        galonesVaciosCount += 1 * sQty
        if (/horchata/.test(fullText)) aguaGallons.horchata += 1 * sQty
        else if (/tamarindo/.test(fullText)) aguaGallons.tamarindo += 1 * sQty
        else if (/jamaica/.test(fullText)) aguaGallons.jamaica += 1 * sQty
        else if (/pina|piña/.test(fullText)) aguaGallons.pina += 1 * sQty
        else {
          const key = `gallon_agua:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (sabor no registrado)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        continue
      }
      if (/champurrado/.test(normName)) {
        aguaGallons.champurrado += 0.125 * sQty // 16 oz por porción aprox
        continue
      }

      // 16. POSTRES
      if (/cheesecake/.test(normName) && !/full/.test(normName)) {
        cheesecakeCount += 1 * sQty
        continue
      }
      if (/flan/.test(normName) && !/whole/.test(normName)) {
        flanCount += 1 * sQty
        continue
      }

      // En autoservicio Medium/Large prueba vaso 22/32 oz, no bebida servida:
      // puede ser soda Coca-Cola, agua fresca o mezcla con hielo/refills.
      // No atribuir galones de agua ni jarabe BIB por el nombre del botón.
      if ((pkgChannel === 'for_here' || pkgChannel === 'to_go') && /^(medium|large)\s+/.test(normName)) {
        const key = `self_serve_flavor:${selectionKey}`
        const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (sabor autoservicio no observado)`, qty: 0 }
        prior.qty += sQty
        uncoveredMap.set(key, prior)
        continue
      }

      // 18. RECETAS GENERALES DE BASE DE DATOS
      const dbRecLines = sel.guid ? recipesByGuid.get(sel.guid) : undefined
      if (dbRecLines && dbRecLines.length > 0) {
        for (const r of dbRecLines) {
          // El extra independiente no pasó por el conteo de papelito del platillo.
          if (r.inventory_item_id === itemPapelitoTorta?.id && normName !== 'papelito') continue
          if (r.type === 'cogs_dine_in' && pkgChannel !== 'for_here') continue
          if (r.type === 'cogs_takeout' && pkgChannel !== 'to_go' && pkgChannel !== 'drive_thru') continue
          if (r.type === 'cogs_delivery' && pkgChannel !== 'delivery') continue

          let totalUnits = (Number(r.quantity) || 0) * sQty
          const targetItem = invMap.get(r.inventory_item_id)
          const recipeUnit = normalize(r.unit)
          const itemMeasure = normalize(targetItem?.unit_measure)
          // quantity_per_unit expresa la medida de catálogo, no necesariamente
          // la unidad de la receta. Convertir ANTES de normalizar a bolsas/cajas.
          if (recipeUnit === 'oz' && itemMeasure === 'lb') totalUnits /= 16
          else if (recipeUnit === 'lb' && itemMeasure === 'oz') totalUnits *= 16
          else if ((recipeUnit === 'oz' || recipeUnit === 'fl oz') &&
            (itemMeasure === 'gal' || targetItem?.unit_type?.toLowerCase().includes('gallon'))) {
            totalUnits /= 128
          }
          generalItemUsage.set(r.inventory_item_id, (generalItemUsage.get(r.inventory_item_id) || 0) + totalUnits)
        }
      } else {
        // Reportar producto vendido sin receta
        const key = selectionKey
        const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: sName, qty: 0 }
        prior.qty += sQty
        uncoveredMap.set(key, prior)
      }
    }
  }

  // Conversión a unidades de compra/orden de Bodega
  const itemConsumption = new Map<string, DailyItemConsumptionResult>()

  const registerUsage = (item: InventoryItemCatalogEntry | undefined, rawQty: number, reason: string) => {
    if (!Number.isFinite(rawQty) || rawQty < 0) throw new Error(`Consumo inválido en ${reason}: ${rawQty}`)
    if (!item) {
      if (rawQty > 0) {
        const key = `missing_inventory:${reason}`
        const prior = uncoveredMap.get(key) || { guid: 'MISSING_INVENTORY', name: `Insumo sin catálogo: ${reason}`, qty: 0 }
        prior.qty += rawQty
        uncoveredMap.set(key, prior)
      }
      return
    }
    const current = itemConsumption.get(item.id) || {
      inventoryItemId: item.id,
      itemName: item.name,
      unitType: item.id === itemPapelitoTorta?.id ? 'pza' :
        item.id === itemAmarilloCheese?.id ? 'caja 440 oz' : item.unit_type || 'pza',
      totalCalculatedUsage: 0,
      roundedOrderUsage: 0,
      breakdown: {}
    }
    current.totalCalculatedUsage += rawQty
    current.breakdown[reason] = (current.breakdown[reason] || 0) + rawQty

    // Compatibilidad: jamás redondear consumo por la presentación de compra.
    // El múltiplo se aplica únicamente a max(0, PAR - sobrante) al pedir.
    current.roundedOrderUsage = current.totalCalculatedUsage

    itemConsumption.set(item.id, current)
  }

  // Tortillas y Panes
  const cornBasePacks = cornTortillaCount / 60
  const cornScrapPacks = cornBasePacks * CORN_TORTILLA_GRILL_SCRAP_FACTOR
  registerUsage(itemCornTortillas, cornBasePacks, 'paquetes_de_60_receta_base')
  if (cornScrapPacks > 0) {
    registerUsage(itemCornTortillas, cornScrapPacks, 'merma_comal_y_platos_6.5%')
  }

  const burritoBasePacks = burritoTortillaCount / 12
  const burritoScrapPacks = burritoBasePacks * BURRITO_TORTILLA_TEAR_SCRAP_FACTOR
  registerUsage(itemBurritoTortillas, burritoBasePacks, 'paquetes_de_12_receta_base')
  if (burritoScrapPacks > 0) {
    registerUsage(itemBurritoTortillas, burritoScrapPacks, 'merma_rotura_vaporera_7.8%')
  }
  registerUsage(itemMulitas, mulitasPairCount / 12, 'paquetes_12_pares')
  registerUsage(itemRegular8Tortillas, regular8TortillaCount / 12, 'paquetes_de_12')
  registerUsage(itemTeleras, teleraCount / 6, 'paquetes_de_6')
  registerUsage(itemMilanesa, milanesaPieceCount / Number(itemMilanesa?.quantity_per_unit || 20), 'bolsas_milanesa_20_piezas')
  registerUsage(itemJamon, jamonOz / (16 * Number(itemJamon?.quantity_per_unit || 2)), 'paquetes_jamon_2_lb')
  registerUsage(itemSalchicha, salchichaOz / (16 * Number(itemSalchicha?.quantity_per_unit || 1)), 'bolsas_salchicha_1_lb')
  registerUsage(itemSopes, sopeCount / 12, 'paquetes_de_12')
  registerUsage(itemNachoChips, nachoChipBags, 'bolsas_4.5_oz')
  registerUsage(itemHuevos, huevoCount / 180, 'cajas_15_dz')
  registerUsage(itemQuesadillaBodega, quesadillaBodegaCount / 12, 'paquetes_12_ct')
  registerUsage(itemPapelitoTorta, papelitoCount, 'piezas_preparadas')
  registerUsage(itemFlan, flanCount, 'piezas')
  registerUsage(itemCheesecake, cheesecakeCount, 'piezas')

  // Carnes
  for (const [prot, yieldFactor] of Object.entries(MEAT_COOKING_YIELDS)) {
    const cookedOz = cookedMeatOz[prot] || 0
    const rawLbs = (cookedOz / 16) / yieldFactor
    const bagLbs = meatBagSizes[prot] || 10
    const bags = rawLbs / bagLbs
    registerUsage(itemMeats[prot], bags, `bolsas_${bagLbs}lb_yield_${(yieldFactor * 100).toFixed(1)}%`)
  }

  // Abarrotes y preparados
  registerUsage(itemArroz, (arrozOz / 16) / 5, 'bolsas_5_lb')
  registerUsage(itemFrijolMolido, (frijolMolidoOz / 16) / 10, 'bolsas_10_lb')
  registerUsage(itemFrijolEntero, (frijolEnteroOz / 16) / 10, 'bolsas_10_lb')
  registerUsage(itemSalsaRanchera, (salsaRancheraOz / 16) / Number(itemSalsaRanchera?.quantity_per_unit || 2.3), 'bolsas_salsa_ranchera_2_3_lb')
  registerUsage(itemQuesoRayado, (quesoRayadoOz / 16) / 2, 'bolsas_2_lb')
  registerUsage(itemQuesoCotija, quesoCotijaOz / 12, 'bolsas_cotija_12_oz')
  registerUsage(itemAmarilloCheese, (quesoAmarilloOz / 440), 'cajas_440_oz')
  registerUsage(itemCrema, (cremaOz / 16) / 1.5, 'bolsas_1.5_lb')
  registerUsage(itemAguacate, (aguacateOz / 16) / 2, 'bolsas_2_lb')
  registerUsage(itemMayonesa, (mayonesaOz / 16) / Number(itemMayonesa?.quantity_per_unit || 5), 'bolsas_mayonesa_catalogo')
  // La guía Party Tray expresa bolsitas individuales; la Orden Diaria las cuenta por caja.
  registerUsage(itemSalsaRojaPackets, salsaRojaPackets / Number(itemSalsaRojaPackets?.quantity_per_unit || 400), 'cajas_salsa_roja_packet')
  registerUsage(itemSalsaVerdePackets, salsaVerdePackets / Number(itemSalsaVerdePackets?.quantity_per_unit || 400), 'cajas_salsa_verde_packet')
  registerUsage(itemMixtaPackets, mixtaPackets / Number(itemMixtaPackets?.quantity_per_unit || 190), 'cajas_mixta_190')
  registerUsage(itemLimaPackets, limaPackets / Number(itemLimaPackets?.quantity_per_unit || 210), 'cajas_lima_210')
  registerUsage(itemJalapenoBulk, (jalapenoBulkOz / 16) / 6, 'bolsas_rajas_6_lb')
  registerUsage(itemSalsaRojaGallon, salsaRojaGallons, 'galones_salsa_20_oz')
  registerUsage(itemSalsaVerdeGallon, salsaVerdeGallons, 'galones_salsa_20_oz')
  registerUsage(itemGalonesVacios, galonesVaciosCount / Number(itemGalonesVacios?.quantity_per_unit || 48), 'cajas_galones_vacios_48')

  // Aguas
  for (const [aguaKey, gals] of Object.entries(aguaGallons)) {
    registerUsage(itemAguas[aguaKey], gals, 'galones')
  }

  // Items generales de base de datos
  for (const [itemId, qty] of generalItemUsage.entries()) {
    const item = invMap.get(itemId)
    if (!item) {
      const key = `MISSING_INVENTORY:${itemId}`
      const prior = uncoveredMap.get(key) || { guid: itemId, name: `Receta con insumo ausente del catálogo: ${itemId}`, qty: 0 }
      prior.qty += qty
      uncoveredMap.set(key, prior)
      continue
    }
    // La unidad del conteo operativo puede diferir del empaque del catálogo.
    // Aplicar el mismo contrato que en las ramas específicas de arriba.
    const perUnit = item.id === itemPapelitoTorta?.id ? 1 :
      item.id === itemAmarilloCheese?.id ? 440 : Number(item.quantity_per_unit || 1)
    const normalizedQty = perUnit > 0 ? qty / perUnit : qty
    registerUsage(item, normalizedQty, 'receta_directa_supabase')
  }

  return {
    storeId,
    businessDate,
    totalTickets: tickets.length,
    totalSelections,
    channels,
    packagingChannels,
    itemConsumption,
    uncoveredProducts: Array.from(uncoveredMap.values()).map(u => ({
      guid: u.guid,
      name: u.name,
      quantitySold: u.qty
    }))
  }
}
